# Claude Code vs Cursor vs Codex：模型路由架构对比

> 2026-05-30 | 基于 GitHub issue 反编译分析、官方文档、社区讨论
> 核心问题：为什么三者模型路由能力差距这么大？根因是什么？

---

## 一、结论先行

三者的差距不是技术能力问题，是**架构设计选择 + 商业利益冲突**的结果：

| 维度 | Claude Code | Cursor | Codex CLI |
|------|-------------|--------|-----------|
| 模型路由能力 | 有基础设施但未自动化 | Best-of-N 并行竞争，非 step 级路由 | 基础设施刚建立，默认全用贵模型 |
| 自动路由 | ❌ 无 | ❌ 无（多模型是并行竞争不是路由） | ❌ 无 |
| Subagent 模型选择 | ✅ Task tool 支持 model 参数 | ❌ 子 agent 不独立选模型 | ✅ TOML 支持 model 字段 |
| 实际节省效果 | 差（93.8% token 打给 Opus） | 中（用户可选手动切模型） | 差（默认 gpt-5.5 全打） |
| 用户需要手动介入 | 高（需设 env var / 手动 /model） | 中（需手动选模型 /model） | 高（需写 TOML 自定义 agent） |
| 商业利益冲突 | 🔴 **有**（路由到便宜模型 = Anthropic 少赚钱） | 🟢 **无**（Cursor 卖订阅不卖 token） | 🔴 **有**（路由到便宜模型 = OpenAI 少赚钱） |

---

## 二、Claude Code：基础设施存在但故意不自动化

### 2.1 反编译证据（GitHub Issue #27665）

有人反编译了 Claude Code v2.1.50 的二进制，追踪了模型选择函数：

**主循环模型选择器**：
```javascript
function getRuntimeMainLoopModel({ permissionMode, mainLoopModel, exceeds200kTokens }) {
  // 唯一的路由逻辑：opusplan 模式下 plan 阶段用 Opus
  if (getUserSpecifiedModel() === "opusplan" && permissionMode === "plan" && !exceeds200kTokens)
    return getDefaultOpusModel();
  
  if (getUserSpecifiedModel() === "haiku" && permissionMode === "plan")
    return getDefaultSonnetModel();

  return mainLoopModel;  // ← 其他所有情况：直接返回 session 模型
}
```

**关键发现**：没有复杂度检查、没有任务类型检查、没有"这步只是处理工具输出"的判断。就是返回 session 模型。

**Subagent 模型选择器**：
```javascript
function getSubagentModel(config, parentModel, frontmatterModel, permissionMode) {
  if (process.env.CLAUDE_CODE_SUBAGENT_MODEL)
    return parse(process.env.CLAUDE_CODE_SUBAGENT_MODEL);  // 环境变量覆盖
  if (frontmatterModel) return parse(frontmatterModel);     // agent .md 的 model 字段
  if (config === "inherit")
    return getRuntimeMainLoopModel({...});  // 继承父模型
  return parse(config);
}
```

Subagent 默认**继承父模型**。如果主循环是 Opus → 所有 subagent 都是 Opus。唯一逃逸方式是设环境变量或在 agent frontmatter 中手动指定。

### 2.2 实际数据

Max 订阅用户 17 天数据：

```
模型            总 Token             占比    虚拟成本
opus-4-6      1,405,957,116       77.0%     $1,011.59
opus-4-5        305,903,815       16.8%       $234.43
haiku-4-5        94,216,971        5.2%        $16.02
sonnet-4-5       17,285,048        0.9%        $11.44
sonnet-4-6        1,046,090        0.1%         $0.92
───────────────────────────────────────────────────────
合计           1,825,500,411      100.0%     $1,274.40
```

**93.8% 的 token 打给 Opus，97.8% 的成本是 Opus。** Haiku 的 5.2% 是后台任务。没有任何自动路由。

### 2.3 唯一的路由尝试：opusplan（已坏）

文档承诺："plan 阶段用 Opus，执行阶段切 Sonnet"。实际表现：

| 场景 | 实际使用的模型 | 原因 |
|------|-------------|------|
| EnterPlanMode → ExitPlanMode 内 | Opus | permissionMode === "plan" |
| 普通对话 | Sonnet | 走 mainLoopModel 默认 |
| 工具调用 | Sonnet | 不在 plan mode |
| Subagent | Sonnet（继承） | 不在 plan mode |

结果：Opus 只在 ~5% 的 plan 时间窗口内使用，其余全是 Sonnet。用户预期是"Opus 推理 + Sonnet 执行"，实际是"Sonnet 干几乎所有活"。

### 2.4 用户在自建路由

因为官方不提供，用户在做：
- 自定义 skill，在 Task 中手动指定 `model: "haiku"` 或 `model: "sonnet"`
- 设环境变量 `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`
- 手动 `/model` 切换（繁琐，全局生效）
- 写 wrapper 脚本包装 claude 二进制
- 第三方插件 `claude-router`（28 stars，单人维护）

### 2.5 为什么 Anthropic 不做自动路由

**核心矛盾：Anthropic 卖 token，自动路由到便宜模型 = 收入减少。**

- Opus 的单价是 Haiku 的 25 倍（$5/$25 vs $0.2/$1 per MTok）
- 如果自动把 60-80% 的请求路由到 Haiku，Max 用户的 token 消耗（和收入）可能下降 60%+
- Anthropic 2026 年推理利润率从 38% 跃升至 70%，部分靠的就是让更多人用 Opus

**但 Task tool 的 model 参数存在说明 Anthropic 知道这个需求。** 他们提供了基础设施但选择不自动化——把决策推给用户，既满足了高级用户的需求，又不主动减少收入。

---

## 三、Cursor：Best-of-N 竞争式编排，非 step 级路由

### 3.1 核心架构

Cursor 的多模型机制是 **Best-of-N（最佳择优）**，不是 per-step 路由：

1. 用户开启 "Use Multiple Models"
2. Cursor 在隔离的 git worktree 中用**不同模型同时跑同一个任务**
3. 每个 agent 独立工作，互不可见，互相竞争
4. 用户（或 Multi-Agent Judging）选最优结果
5. Apply 获胜者的变更到主工作树

**这是并行竞争，不是协作编排。** Agent 之间不共享中间结果，不分工。

### 3.2 Cursor 为什么看起来"有路由"

Cursor 的模型选择能力来自：
- **多 Provider 选择**：用户可以在 Claude/GPT/Gemini 之间切换
- **Composer 模型**：Cursor 自研的模型，针对 agent loop 优化，比前沿模型快 4 倍
- **Best-of-N 比较**：同一个问题用不同模型跑，看哪个最好
- **手动 /model 切换**：用户可以在对话中手动切换

### 3.3 为什么这不算真正的模型路由

| 特征 | Cursor 的做法 | 真正的 Per-step 路由 |
|------|-------------|-------------------|
| 粒度 | 整个任务 | Pipeline 的每一步 |
| 决策方式 | 多模型并行竞争，人工选胜者 | 自动判断每步难度，自动选模型 |
| 成本影响 | **更高**（N 个模型跑同一个任务 = N 倍成本） | **更低**（每步用最合适的模型） |
| 步骤间关系 | 不考虑 | 显式建模耦合依赖 |

Cursor 的 Best-of-N 是**用成本换质量**——花更多钱探索不同方案。而 per-step routing 是**用智能省成本**——每步用最合适的模型。两者方向完全相反。

### 3.4 Cursor 没有利益冲突

Cursor 卖 IDE 订阅，不卖 token。用户成本越低越好——用户省钱 = 更愿意续订。所以 Cursor 天然有动力帮用户优化成本，只是他们的方法（Best-of-N）不是 per-step routing。

---

## 四、Codex CLI：基础设施刚建，默认全打贵模型

### 4.1 核心架构

- 默认使用 **gpt-5.5**（OpenAI 最新旗舰），一切任务都打给它
- Subagent 模型选择**硬编码为 gpt-5.1-codex-mini**（GitHub issue #12224）
- 支持自定义 agent（TOML 配置），可以在其中指定 `model` 字段
- **但 subagent 只在用户明确要求时才生成**，不是自动的

### 4.2 自定义 Agent 示例

Codex 官方文档给出的例子展示了模型分级的可能性：

```toml
# explorer agent - 用便宜模型
name = "pr_explorer"
model = "gpt-5.3-codex-spark"        # 便宜快速的模型
model_reasoning_effort = "medium"
sandbox_mode = "read-only"

# reviewer agent - 用强模型
name = "reviewer"
model = "gpt-5.4"                     # 更强的模型
model_reasoning_effort = "high"
sandbox_mode = "read-only"
```

这证明 **Codex 的基础设施支持 per-step/per-agent 模型选择**，但：
- 需要用户手动写 TOML 配置
- 需要用户手动在 prompt 中指示"用 explorer agent 做这个，用 reviewer agent 做那个"
- 没有自动的难度判断和路由

### 4.3 社区在求这个功能

OpenAI 社区帖子（community.openai.com/t/model-aware-task-delegation-for-subagents）明确请求：
> "This would enable much better cost/performance optimization: cheap models for scaffolding and boilerplate, stronger models for architecture and..."

用户知道需要什么，但 OpenAI 没做。

### 4.4 为什么 Codex 做得最差

1. **只有自家的模型**：不像 Cursor 可以选 Claude/GPT/Gemini，Codex 只能用 OpenAI 模型
2. **OpenAI 卖 token**：和 Anthropic 一样的利益冲突
3. **产品优先级不同**：Codex 的重心在沙箱安全和可靠性，不在成本优化
4. **Subagent 是新功能**：2026 年才默认启用，还在快速迭代中

---

## 五、根因分析：差距是怎么造成的

### 5.1 三个层面的根因

**层面一：架构设计哲学不同**

| 产品 | 设计哲学 | 对路由的影响 |
|------|---------|------------|
| Claude Code | Manager-Worker 编排 | Task tool 有 model 参数，但主循环不自动路由 |
| Cursor | Best-of-N 竞争 | 天然多模型但不是 step 级路由，成本反而更高 |
| Codex | 单模型 + 可选 Subagent | 基础设施刚建，默认体验是全打贵模型 |

**层面二：模型所有权**

| 产品 | 模型来源 | 路由激励 |
|------|---------|---------|
| Claude Code | 自家模型（Haiku/Sonnet/Opus） | 🔴 路由到便宜模型 = 收入减少 |
| Cursor | 多家模型（Claude/GPT/Gemini/自研） | 🟢 帮用户省钱 = 订阅续费 |
| Codex | 自家模型（gpt-5.5/5.4/5.3-spark） | 🔴 路由到便宜模型 = 收入减少 |

**层面三：Subagent 设计**

Claude Code 的 subagent 设计最接近 per-step routing：
- Task tool 支持 `model` 参数 → 可以每步指定不同模型
- 但默认继承父模型 → 需要手动覆盖
- 没有自动复杂度判断 → 不知道什么时候该用便宜模型

Cursor 的 subagent 是独立的 worktree 隔离 → 天然适合并行竞争但不适合 step 级路由。

Codex 的 subagent 支持自定义 TOML → 基础设施最灵活但门槛最高（需要用户写配置文件）。

### 5.2 核心洞察

**模型提供商（Anthropic、OpenAI）有根本性的利益冲突——自动路由到便宜模型直接减少他们的收入。这个冲突不会消失。**

这意味着：
1. 等 Anthropic/OpenAI 做自动 per-step routing = 等他们主动减少收入 = 不现实
2. **第三方工具（如我们要做的）是唯一有正确激励的参与者**
3. Cursor 没有利益冲突但选择了不同的架构路径（Best-of-N 而非 per-step routing）
4. 我们的定位就是填补这个"没有人有动力做"的空白

---

## 六、对我们的启示

1. **不要等大厂做**——他们有利益冲突，不会主动优化到便宜模型
2. **Claude Code 的 Task tool model 参数是集成点**——我们可以通过 MCP/hook 在调用 Task 时自动注入最优模型选择
3. **Cursor 的 Best-of-N 模式成本更高**——我们的方案可以互补，在 Cursor 内部做 step 级优化
4. **Codex 的 TOML 配置是模板**——我们可以自动生成最优的 agent 配置

---

## 数据来源

1. GitHub Issue #27665 — Claude Code 反编译分析，93.8% token 打给 Opus
2. Claude Code v2.1.50 二进制反编译 — getRuntimeMainLoopModel / getSubagentModel 函数
3. Cursor 官方文档 — Best-of-N 多模型并行执行
4. Elegant Software Solutions — "Cursor Multi-Agent Isn't What You Think"
5. OpenAI Developers 文档 — Codex Subagents / CLI Features
6. GitHub Issue #12224 (openai/codex) — Subagent 模型硬编码为 gpt-5.1-codex-mini
7. OpenAI Community — "Model-aware task delegation for subagents" 功能请求
8. Augment Code — "Best AI Model for Coding Agents in 2026: A Routing Guide"
9. LinkedIn — "Stop Paying Opus Prices for Haiku Work: A Cost Routing Pattern"
10. Reddit r/vibecoding — "How do you all do Codex CLI dynamic model routing"
