# AgentDispatch — 产品设计文档

> 日期：2026-05-30
> 状态：已批准（v3，新增跨 Provider 三层路由模式：off / opt-in / enterprise）
> 基于：竞品技术验证调研报告、开发者痛点热点分析、Claude Code vs Cursor vs Codex 架构对比

---

## 1. 产品定位与核心价值

**AgentDispatch** — 一个 Node.js Hook + MCP Server，为 AI Coding Agent 提供 per-step 智能模型路由。

**一句话定位**：在 Agent 执行 pipeline 的每一步，自动选择性价比最优的模型，在保证质量的前提下最小化成本。

**核心价值主张**：

- **节省 40-70% 的 API 成本**（60-80% 的 agent 请求不需要最强模型）
- **零侵入集成**（通过 `NODE_OPTIONS='--require'` Hook 注入，agent 完全无感知）
- **双市场覆盖**（海外 OpenAI/Anthropic/Google + 中国 DeepSeek/智谱/月之暗面/阿里/小米）

**不是什么**：

- 不是 LLM Gateway（LiteLLM/OpenRouter 已做得很好）
- 不是可观测性平台（LangSmith/Langfuse 已有）
- 不是又一个 AI IDE

**为什么我们能做而大厂不会做**：

Anthropic 和 OpenAI 卖 token，自动路由到便宜模型 = 主动减少收入。这个利益冲突不会消失。第三方工具是唯一有正确激励做 per-step 自动路由的参与者。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                 @agentdispatch/hook                      │
│  (NODE_OPTIONS='--require' 注入到 codex / claude 进程)   │
│                                                         │
│  拦截 fetch → 分析请求 → 路由模型 → 记录成本 → 放行     │
│  透明、无感、不需要 prompt 引导                          │
│  负责：per-step 透明路由 + cost tracking                 │
├─────────────────────────────────────────────────────────┤
│                 @agentdispatch/core                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │          Step Analyzer (步骤分析器)              │    │
│  │  输入: messages / model / tools                 │    │
│  │  输出: 步骤类型 + 难度 + 推荐模型               │    │
│  └──────────────────────┬──────────────────────────┘    │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │         Combo Optimizer (组合优化器)             │    │
│  │  输入: pipeline + 候选模型池 + 偏好             │    │
│  │  输出: Pareto 最优模型组合                      │    │
│  │  算法: arm_elimination / epsilon_lucb / ...     │    │
│  └──────────────────────┬──────────────────────────┘    │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │         Model Registry (模型注册表)             │    │
│  │  海外 + 中国模型定价、能力、API 兼容性          │    │
│  │  远程数据更新，24h 缓存                         │    │
│  └──────────────────────┬──────────────────────────┘    │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │         Cost Tracker (成本追踪器)               │    │
│  │  SQLite 本地存储，per-step/per-session 报告     │    │
│  │  质量信号反馈闭环                               │    │
│  └──────────────────────┬──────────────────────────┘    │
│  ┌──────────────────────▼──────────────────────────┐    │
│  │       Protocol Adapter (协议适配器)             │    │
│  │  OpenAI ↔ Anthropic 请求/响应双向转换           │    │
│  │  SSE 流式事件格式转换                           │    │
│  │  TransformStream 包装提取 token 统计            │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│              MCP Server (可选，交互用)                    │
│  get_cost_report / optimize_pipeline / models_list      │
│  用户主动查报告、手动优化、调配置                        │
│  不是路由的必需品，是增值功能                            │
├─────────────────────────────────────────────────────────┤
│                    Provider Layer                        │
│  OpenAI / Anthropic / Google / DeepSeek / 智谱 / 月之暗面│
└─────────────────────────────────────────────────────────┘
```

---

## 3. 分发与安装

### 3.1 一键安装

用户只需执行一条命令，零交互，零配置：

```bash
npx @agentdispatch/setup
```

执行内容：
1. 检测已安装的 CLI 工具（codex、claude）
2. 写入 shell function 到 `~/.zshrc` 或 `~/.bashrc`
3. 验证 Hook 拦截可用性
4. 报告当前路由模式状态

安装完成后 `source ~/.zshrc` 或新开终端即生效。

**不需要用户输入任何信息，不需要管理 API Key。**

默认模式为**同 provider 内路由（`crossProvider: "off"`）**：Codex 请求里的 OpenAI key 直接复用，Claude Code 请求里的 Anthropic key 直接复用。Hook 只改写 `model` 字段，URL 和 key 原样转发。同 provider 内 opus→haiku 的差价已达 5x，默认模式已覆盖大部分成本优化需求。

### 3.2 Shell Function（替代 alias）

写入 `~/.zshrc` 或 `~/.bashrc` 的内容：

```bash
# >>> agentdispatch >>>
codex() {
  NODE_OPTIONS="--require @agentdispatch/loader" command codex "$@"
}
claude() {
  NODE_OPTIONS="--require @agentdispatch/loader" command claude "$@"
}
# <<< agentdispatch <<<
```

function 比 alias 的优势：
- `source` 立即生效，不需要重启终端
- `command codex` 避免递归调用
- 可以在函数内扩展逻辑（如检测更新）

### 3.3 跨 Provider 路由模式

默认模式（`crossProvider: "off"`）下，Hook 只在同 provider 内路由，不跨 provider。跨 provider 路由需要用户或企业显式选择，分为三种模式：

#### 模式一：`off`（默认）

零配置，开箱即用。覆盖场景：企业统一采购单一 provider（只用 Claude Code 或只用 Codex），开发者没有其他 provider 的 key。

```
开发者用 Claude Code (Anthropic key)
  └── Hook 只在 Anthropic 模型间路由：opus → sonnet → haiku

开发者用 Codex (OpenAI key)
  └── Hook 只在 OpenAI 模型间路由：gpt-5.5 → gpt-5.4 → gpt-5.3-spark
```

即使 Step Analyzer 推荐了其他 provider 的模型，Hook 也**不会**跨 provider——自动降级到同 provider 内的最优替代。企业 IT 不需要做任何额外配置，也不需要担心代码发到非授权 provider。

#### 模式二：`opt-in`（个人开发者主动开启）

覆盖场景：个人开发者拥有多个 provider 的 key，愿意跨 provider 路由以获取更大成本优化。

```jsonc
// agentdispatch.config.json
{
  "routing": {
    "crossProvider": "opt-in",
    "crossProviderProviders": ["deepseek", "alibaba"]  // 白名单：只允许路由到这些 provider
  }
}
```

规则：
- 必须同时设置白名单（`crossProviderProviders`）和对应的环境变量 key → 才会触发跨 provider 路由
- 只设了白名单没设 key → 静默降级到同 provider，不报错
- 不在白名单中的 provider 不会被考虑，即使有 key
- 不是"有 key 就用"，而是"明确声明了才用"

```bash
# 开发者需要做两件事才能启用跨 provider：
# 1. 配置白名单
agentdispatch config set routing.crossProvider opt-in
agentdispatch config set routing.crossProviderProviders '["deepseek"]'

# 2. 设置对应环境变量
export DEEPSEEK_API_KEY=xxx
```

#### 模式三：`enterprise`（企业统一管理多 provider）

覆盖场景：企业同时采购了多个 provider 的服务，由 IT 统一配置认证和策略。

```jsonc
// /etc/agentdispatch/enterprise.json（IT 通过 MDM / 内网下发，开发者不可修改）
{
  "routing": {
    "crossProvider": "enterprise",
    "enterpriseProviders": {
      "deepseek": {
        "baseUrl": "https://llm-proxy.company.internal/deepseek",
        "authMode": "corporate-sso",           // 不是个人 key，是企业认证
        "allowedTiers": ["fast", "standard"],  // 限制只能路由到便宜模型
        "dataRegion": "cn"                      // 数据必须留在中国
      },
      "openai": {
        "baseUrl": "https://llm-proxy.company.internal/openai",
        "authMode": "corporate-sso",
        "allowedTiers": ["standard"],
        "dataRegion": "us"
      }
    }
  }
}
```

关键区别：
- **认证方式由企业指定**（SSO / 内网代理 / 服务账号），不依赖开发者个人的环境变量
- **IT 控制**哪些 provider 可用、可用哪些 tier、数据必须留在哪个区域
- **开发者不可覆盖**企业配置（配置合并时企业配置优先级最高且锁定关键字段）
- 如果企业配置锁定了 `crossProvider: "off"`，开发者自己的 `opt-in` 设置会被忽略并输出提示：

```
[AgentDispatch] 企业策略禁止跨 provider 路由，已忽略个人配置中的 crossProvider: "opt-in"
```

#### 安装输出示例

```
检测环境...
✓ 检测到 Claude Code (Anthropic)
✓ 检测到 ANTHROPIC_API_KEY

同 Provider 路由: ✓ 已就绪（Claude opus/sonnet/haiku）

跨 Provider 路由:
  ● 当前模式: off（仅同 provider 内路由）
  ● 未检测到其他 provider 的 API Key
  ● 如需启用，请设置对应环境变量并运行：
    agentdispatch config set routing.crossProvider opt-in
  ● 企业用户请联系 IT 获取企业配置
```

不再自动扫描所有环境变量然后"有什么用什么"，而是**明确告知用户当前模式、如何开启更高阶的模式**。

### 3.4 包结构

```
@agentdispatch/setup       # 唯一入口包（npx 一键安装）
  ├── 依赖 @agentdispatch/loader    # --require 加载入口，组合多 hook
  ├── 依赖 @agentdispatch/core      # 核心引擎（StepAnalyzer / Optimizer / Registry / Tracker）
  └── 依赖 @agentdispatch/models    # 模型定价/能力数据库
```

monorepo 内部结构：

```
agentdispatch/
├── packages/
│   ├── core/              # 核心路由引擎
│   ├── hook/              # fetch 拦截 Hook
│   ├── loader/            # --require 入口，组合 hook
│   ├── setup/             # 安装脚本（npx @agentdispatch/setup）
│   ├── mcp-server/        # MCP Server（可选，交互功能）
│   ├── langchain/         # LangChain callback handler
│   ├── cli/               # CLI 工具（cost / optimize / config 命令）
│   └── models/            # 模型数据库
├── config/
└── e2e/
```

---

## 4. 配置文件

`agentdispatch.config.json`（存放于项目根目录或 `~/.agentdispatch/`）：

```jsonc
{
  // 模型池定义 — 用户可增删
  "models": {
    "fast": ["openai/gpt-5.3-codex-spark", "anthropic/claude-haiku-4-5", "deepseek/v4-flash"],
    "standard": ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6", "deepseek/v4-pro", "alibaba/qwen3-max"],
    "powerful": ["openai/gpt-5.5", "anthropic/claude-opus-4-6", "zhipu/glm-5"]
  },

  // 路由偏好
  "routing": {
    "defaultStrategy": "cost-optimal",  // cost-optimal / quality-first / balanced
    "analyzerModel": "auto",            // auto = 用注册表中最便宜的可用模型
    "cacheResults": true,               // 缓存路由决策，相似请求不重复分析
    "crossProvider": "off",             // off / opt-in / enterprise（见 §3.3）
    "crossProviderProviders": [],        // opt-in 白名单，如 ["deepseek", "alibaba"]
    "enterpriseProviders": {}           // enterprise 模式，由 IT 下发（见 §3.3）
  },

  // Provider 配置（密钥从环境变量读取，不写入配置文件）
  "providers": {
    "openai":    { "baseUrl": "https://api.openai.com/v1" },
    "anthropic": { "baseUrl": "https://api.anthropic.com" },
    "deepseek":  { "baseUrl": "https://api.deepseek.com" },
    "zhipu":     { "baseUrl": "https://open.bigmodel.cn/api/paas/v4" },
    "moonshot":  { "baseUrl": "https://api.moonshot.cn/v1" },
    "alibaba":   { "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    "xiaomi":    { "baseUrl": "https://platform.xiaomimimo.com/v1" }
  },

  // 用户自定义模型
  "customModels": [
    {
      "id": "my-company/self-hosted-llama",
      "provider": "custom",
      "tier": "fast",
      "pricing": { "inputPerMillion": 0, "outputPerMillion": 0, "cacheHitPerMillion": 0 },
      "api": {
        "protocol": "openai",
        "baseUrl": "http://internal-llm.mycompany.com:8080/v1",
        "modelId": "llama-4-maverick"
      }
    }
  ],

  // 成本追踪
  "tracking": {
    "enabled": true,
    "storePath": "./agentdispatch-data/",
    "reportFormat": "json"
  },

  // 在线学习
  "onlineLearning": {
    "enabled": true,
    "minSamplesBeforeSuggest": 50,
    "suggestionChannel": "cli",
    "autoApply": false,
    "windowSize": 200
  }
}
```

---

## 5. CLI 命令

```bash
# 初始化
agentdispatch init                    # 自动检测工具并配置
agentdispatch init --tool codex       # 只配置 Codex
agentdispatch init --tool claude-code # 只配置 Claude Code

# 成本分析
agentdispatch cost                    # 当前月度成本报告
agentdispatch cost --last 7d          # 最近 7 天
agentdispatch cost --by-step          # 按步骤类型分组

# 组合优化
agentdispatch optimize                # 基于历史数据自动搜索最优组合
agentdispatch optimize --pipeline ./my-pipeline.yaml  # 指定 pipeline 定义

# 模型管理
agentdispatch models list             # 列出所有可用模型和定价
agentdispatch models update           # 手动拉取最新模型数据

# 配置
agentdispatch config set routing.defaultStrategy balanced
agentdispatch config get models.fast
agentdispatch config set updates.autoCheck false
```

---

## 6. Step Analyzer（步骤分析器）

### 6.1 输入

Hook 拦截到 LLM API 请求后，从请求内容中提取分析所需信息：

```typescript
interface StepAnalysisRequest {
  task: string;              // 从 messages 中提取的任务描述
  stepType?: StepType;       // 步骤类型（可选，自动推断）
  context?: string;          // 对话历史摘要（最近几轮）
  availableTools?: string[]; // 当前请求的 tools 字段
  previousModel?: string;    // 上一步用的模型
  originalModel?: string;    // 原始请求的模型
}

type StepType =
  | "planning"        // 规划：分析问题、制定方案
  | "exploration"     // 探索：搜索代码、读取文件
  | "editing"         // 编辑：修改代码、写文件
  | "testing"         // 测试：运行测试、检查输出
  | "reviewing"       // 审查：代码审查、质量检查
  | "reasoning"       // 推理：复杂逻辑、架构决策
  | "formatting"      // 格式化：JSON 格式化、lint fix
  | "simple_tool_use" // 简单工具：grep、ls、cat
  | "confirmation"    // 确认：用户确认、简单回复
  | "unknown";
```

### 6.2 输出

```typescript
interface StepAnalysisResponse {
  recommendedModel: string;
  recommendedTier: "fast" | "standard" | "powerful";
  stepType: StepType;
  difficulty: number;            // 0-1
  confidence: number;            // 0-1
  reasoning: string;
  estimatedTokens: { input: number; output: number };
  alternatives: Array<{
    model: string;
    tier: string;
    costSavingsVsRecommended: number;
    qualityRisk: "none" | "low" | "medium" | "high";
  }>;
}
```

### 6.3 三级决策逻辑

```
Level 1: 规则匹配（< 1ms，零成本）
  ├── stepType === "confirmation" → fast tier
  ├── stepType === "formatting" → fast tier
  ├── stepType === "simple_tool_use" → fast tier
  ├── stepType === "exploration" && 无复杂推理关键词 → fast tier
  └── 无匹配 → 进入 Level 2

Level 2: 轻量模型分类（~300-500ms，~$0.001）
  ├── 用 fast tier 模型（如 gpt-5.3-spark / DeepSeek V4-Flash）分析
  ├── 输入: task + context 摘要（压缩到 < 2K token）
  ├── 输出: stepType + difficulty + recommendedTier
  └── confidence > 0.8 → 返回结果；否则进入 Level 3

Level 3: 缓存历史 + 保守策略
  ├── 查询相似历史决策（本地 SQLite）
  ├── 有高置信历史记录 → 复用
  └── 无历史 → 保守策略：standard tier
```

### 6.4 分类 Prompt（Level 2 内部使用）

```
你是一个 AI Agent 步骤分析器。根据以下信息判断这个步骤的难度和推荐模型等级。

任务: {task}
对话上下文: {context}
可用工具: {tools}

输出 JSON:
{
  "stepType": "planning|exploration|editing|testing|reviewing|reasoning|formatting|simple_tool_use|confirmation",
  "difficulty": 0.0-1.0,
  "recommendedTier": "fast|standard|powerful",
  "confidence": 0.0-1.0,
  "reasoning": "一句话解释"
}

判断标准:
- fast: 格式化、简单搜索、文件读取、确认操作、样板代码生成
- standard: 常规代码编写、标准重构、测试编写、中等复杂度的 bug 修复
- powerful: 架构设计、复杂多文件调试、安全审计、需要深度推理的问题
```

### 6.5 从消息内容推断步骤类型

Hook 不依赖 prompt 引导，直接从 HTTP 请求的 messages 字段推断：

```typescript
function inferStepFromMessages(messages: Message[]): StepAnalysis {
  const lastUserMsg = messages.filter(m => m.role === "user").at(-1)?.content ?? "";
  const toolResults = messages.filter(m => m.role === "tool");
  const hasToolCalls = messages.some(m => m.role === "assistant" && m.tool_calls?.length);

  // Level 1 规则匹配
  if (isSimpleToolCall(lastUserMsg))         return { type: "simple_tool_use", tier: "fast" };
  if (isFormattingOrLint(lastUserMsg))       return { type: "formatting", tier: "fast" };
  if (isFileRead(toolResults))               return { type: "exploration", tier: "fast" };
  if (isCodeEdit(lastUserMsg) && !isComplex(lastUserMsg)) return { type: "editing", tier: "standard" };

  // Level 2 内容分析
  return analyzeWithLLM(lastUserMsg, extractContext(messages));
}
```

### 6.6 缓存策略

- 缓存 key = hash(task + stepType)
- 命中缓存时直接返回，不走 LLM
- TTL: 24h
- 存储: 内存 LRU + SQLite 持久化
- 失效: 模型定价变化时清空

---

## 7. Combo Optimizer（组合优化器）

解决的核心问题：**单个步骤的最优模型 ≠ 整个 pipeline 的最优组合**。

### 7.1 核心抽象

```typescript
interface Pipeline {
  name: string;
  steps: PipelineStep[];
}

interface PipelineStep {
  id: string;
  description: string;
  candidateModels: string[];
}

interface OptimizationResult {
  pipeline: string;
  combos: RankedCombo[];
  searchStats: {
    totalCombos: number;
    evaluated: number;
    savingsVsAllPowerful: number;
    searchTimeMs: number;
  };
}

interface RankedCombo {
  rank: number;
  models: Record<string, string>;
  estimatedAccuracy: number;
  estimatedCost: number;
  estimatedLatency: number;
  paretoFrontier: "cost-optimal" | "balanced" | "quality-optimal";
}
```

### 7.2 Pipeline 定义文件

```yaml
# my-pipeline.yaml
pipeline:
  name: "code-review-agent"
  steps:
    - id: "explorer"
      description: "搜索并理解相关代码"
      candidates: ["openai/gpt-5.3-codex-spark", "deepseek/v4-flash", "openai/gpt-5.4"]
    - id: "reviewer"
      description: "审查代码质量、安全性、正确性"
      candidates: ["openai/gpt-5.4", "openai/gpt-5.5", "anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-6"]
    - id: "summarizer"
      description: "生成审查报告摘要"
      candidates: ["openai/gpt-5.3-codex-spark", "deepseek/v4-flash", "anthropic/claude-haiku-4-5"]

eval:
  dataset: "./eval-samples.json"
  metric: "accuracy"
```

### 7.3 搜索算法

TypeScript 原生重写（不依赖 AgentOpt Python 包）：

```typescript
type SearchAlgorithm =
  | "brute_force"      // 小空间（< 100 组合）
  | "arm_elimination"  // 默认：bandit 算法
  | "epsilon_lucb"     // ε-最优即停
  | "hill_climbing"    // 贪心搜索
  | "bayesian";        // GP Bayesian 优化

const DEFAULT_SEARCH: SearchConfig = {
  algorithm: "arm_elimination",
  maxEvaluations: 50,
  parallelWorkers: 4,
  earlyStop: true,
  cacheEvalResults: true,
};
```

### 7.4 在线学习

Pipeline 在生产运行时，Cost Tracker 记录每步实际效果。Combo Optimizer 后台分析：

```typescript
interface OnlineLearningConfig {
  enabled: boolean;
  minSamplesBeforeSuggest: 50;
  suggestionChannel: "cli" | "log" | "off";
  autoApply: false;
  windowSize: 200;
}
```

反馈闭环：

```
Hook 路由到推荐模型 → Agent 执行 → Cost Tracker 记录结果
                                          │
                                          ▼
                                   隐式质量信号：
                                   - success: 无重试
                                   - retry: 同任务重复请求
                                   - manual_switch: 用户手动切模型
                                   - error: API 错误
                                          │
                                          ▼
                                   Combo Optimizer 更新
                                   该步骤类型的模型评分
```

---

## 8. Model Registry（模型注册表）

### 8.1 模型数据结构

```typescript
interface ModelEntry {
  id: string;                    // "openai/gpt-5.3-codex-spark"
  provider: string;              // openai / anthropic / deepseek / zhipu / moonshot / alibaba / xiaomi
  displayName: string;
  tier: "fast" | "standard" | "powerful";

  pricing: {
    inputPerMillion: number;     // $/MTok
    outputPerMillion: number;
    cacheHitPerMillion: number;  // -1 = 不支持缓存
    currency: "USD";
  };

  capabilities: {
    codeGeneration: number;      // 0-10
    codeReview: number;
    planning: number;
    reasoning: number;
    toolUse: number;
    contextWindow: number;       // K tokens
    maxOutputTokens: number;     // K tokens
    streaming: boolean;
    jsonMode: boolean;
  };

  routing: {
    avgLatencyMs: number;
    tokensPerSecond: number;
    availability: number;        // 0-1
    region: ("us" | "cn" | "global")[];
  };

  api: {
    protocol: "openai" | "anthropic";
    baseUrl: string;
    modelId: string;
  };
}
```

### 8.2 预置模型清单

**海外**：

| ID | Tier | 输入 $/MTok | 输出 $/MTok | 协议 |
|----|------|-----------|-----------|------|
| openai/gpt-5.5 | powerful | 30 | 120 | openai |
| openai/gpt-5.4 | standard | 5 | 20 | openai |
| openai/gpt-5.3-codex-spark | fast | 0.5 | 2 | openai |
| openai/gpt-5.4-mini | fast | 0.25 | 1 | openai |
| anthropic/claude-opus-4-6 | powerful | 5 | 25 | anthropic |
| anthropic/claude-sonnet-4-6 | standard | 3 | 15 | anthropic |
| anthropic/claude-haiku-4-5 | fast | 1 | 5 | anthropic |
| google/gemini-2.5-pro | powerful | — | — | openai |
| google/gemini-2.5-flash | fast | — | — | openai |

**中国**：

| ID | Tier | 输入 $/MTok | 输出 $/MTok | 缓存命中 | 上下文 | 协议 |
|----|------|-----------|-----------|--------|--------|------|
| deepseek/v4-pro | standard | 0.435 | 0.87 | 0.003625 | 128K | openai |
| deepseek/v4-flash | fast | 0.14 | 0.28 | 0.02 | 1M | openai |
| zhipu/glm-5 | powerful | 1.0 | 3.2 | — | 200K | openai |
| moonshot/kimi-k2.6 | standard | 0.16-2.0 | 2.5 | 0.07 | 128K | openai |
| alibaba/qwen3-max | standard | 0.78 | 3.9 | 0.156 | 262K | openai |
| xiaomi/mimo-v2.5 | standard | 1.0 | 3.0 | 0.2 | 1M | openai |

### 8.3 远程数据更新

```
npm 包内置 models.json（发版时快照）
         │
         └── 启动时检查远程源 → 合并最新定价 → 本地缓存 24h
             远程源: GitHub Release / npm @agentdispatch/models
```

### 8.4 跨 Provider API 适配

```typescript
function buildRequest(originalReq: any, targetModel: ModelEntry): { url: string; body: any; headers: any } {
  if (targetModel.api.protocol === "openai") {
    return {
      url: `${targetModel.api.baseUrl}/chat/completions`,
      body: { ...originalReq.body, model: targetModel.api.modelId },
      headers: getAuthHeaders(targetModel.provider),
    };
  }

  if (targetModel.api.protocol === "anthropic") {
    return {
      url: `${targetModel.api.baseUrl}/v1/messages`,
      body: openaiToAnthropic(originalReq.body, targetModel.api.modelId),
      headers: getAuthHeaders(targetModel.provider),
    };
  }
}
```

---

## 9. Hook 集成机制

### 9.1 核心 Hook 实现

```typescript
// @agentdispatch/hook — 入口
const originalFetch = globalThis.fetch;

globalThis.fetch = async function patchedFetch(input: RequestInfo, init?: RequestInit) {
  const url = typeof input === 'string' ? input : input.url;

  // 只拦截 LLM API 请求
  if (!isLLMApiCall(url)) {
    return originalFetch.call(this, input, init);
  }

  try {
    const body = JSON.parse(init?.body as string);
    const analysis = stepAnalyzer.analyzeFromMessages(body.messages, body.model);

    if (analysis.recommendedModel !== body.model) {
      body.model = analysis.recommendedModel;

      // 跨 provider 时改写 URL 和 headers
      if (analysis.needsProviderSwitch) {
        input = rewriteURL(input, analysis.recommendedModel);
        init = rewriteHeaders(init, analysis.recommendedModel);
      } else {
        init = { ...init, body: JSON.stringify(body) };
      }
    }

    const response = await originalFetch.call(this, input, init);

    // 异步记录，不阻塞响应
    costTracker.recordAsync(analysis, response);

    return response;
  } catch (err) {
    // 任何错误 → 原样放行
    logError(err);
    return originalFetch.call(this, input, init);
  }
};
```

### 9.2 API Key 处理与跨 Provider 路由策略

Hook 不管理 API Key，只做转发和复用。跨 provider 行为由配置中的 `routing.crossProvider` 模式决定：

**模式 `off`（默认）**：
原始请求已包含完整的 URL 和 Authorization header。Hook 只改写 `body.model`，其他原样转发。key 从原始请求自动获取。即使推荐模型属于其他 provider，也**不会**跨 provider——降级到同 provider 内的最优替代。

**模式 `opt-in`**：
如果推荐模型属于白名单中的 provider（`crossProviderProviders`），Hook 检查环境变量中是否有对应的 key。有则改写 URL + key 转发；没有则降级到同 provider。不在白名单中的 provider 不会被考虑。

**模式 `enterprise`**：
路由目标由企业 IT 配置（`enterpriseProviders`）决定。认证方式由企业指定（SSO / 内网代理 / 服务账号），不依赖个人环境变量。IT 同时限制可用 provider、tier 和数据区域。

```typescript
function handleRouting(originalRequest: Request, analysis: StepAnalysis): Request {
  const targetModel = modelRegistry.get(analysis.recommendedModel);
  const originalProvider = detectProvider(originalRequest.url);

  if (targetModel.provider === originalProvider) {
    // 同 provider：只改 model 字段，url 和 key 原样保留
    return rewriteModelOnly(originalRequest, targetModel.api.modelId);
  }

  // 跨 provider：根据模式决策
  const mode = config.routing.crossProvider;

  if (mode === "off") {
    // 默认模式：不跨 provider，降级到同 provider 最优替代
    const fallback = findCheapestModel(originalProvider, analysis.recommendedTier);
    return rewriteModelOnly(originalRequest, fallback.api.modelId);
  }

  if (mode === "opt-in") {
    // 个人模式：检查白名单 + 环境变量
    if (!config.routing.crossProviderProviders.includes(targetModel.provider)) {
      const fallback = findCheapestModel(originalProvider, analysis.recommendedTier);
      return rewriteModelOnly(originalRequest, fallback.api.modelId);
    }
    const crossProviderKey = getEnvKey(targetModel.provider);
    if (crossProviderKey) {
      return rewriteFullRequest(originalRequest, targetModel, crossProviderKey);
    } else {
      const fallback = findCheapestModel(originalProvider, analysis.recommendedTier);
      return rewriteModelOnly(originalRequest, fallback.api.modelId);
    }
  }

  if (mode === "enterprise") {
    // 企业模式：检查 IT 配置的 provider 策略
    const enterpriseConfig = config.routing.enterpriseProviders[targetModel.provider];
    if (!enterpriseConfig) {
      const fallback = findCheapestModel(originalProvider, analysis.recommendedTier);
      return rewriteModelOnly(originalRequest, fallback.api.modelId);
    }
    // 检查 tier 限制
    if (!enterpriseConfig.allowedTiers.includes(targetModel.tier)) {
      const fallback = findCheapestModel(originalProvider, analysis.recommendedTier);
      return rewriteModelOnly(originalRequest, fallback.api.modelId);
    }
    return rewriteEnterpriseRequest(originalRequest, targetModel, enterpriseConfig);
  }

  // 兜底
  return originalRequest;
}
```

### 9.3 用户手动切模型检测

```typescript
function detectManualSwitch(sessionId: string, currentModel: string): boolean {
  const lastRouted = sessionState.getLastRoutedModel(sessionId);
  return lastRouted !== null && currentModel !== lastRouted &&
         !isOurRouting(currentModel, lastRouted);
}
```

---

## 10. 数据存储

### 10.1 存储结构

```
~/.agentdispatch/
├── data.db                # SQLite 主数据库（WAL 模式）
├── config.json            # 用户配置
├── cache/
│   └── route-cache.json   # 路由缓存持久化
├── reports/               # 导出的成本报告
└── errors.log             # Hook 错误日志
```

### 10.2 数据库 Schema

```sql
CREATE TABLE routing_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
  session_id      TEXT NOT NULL,
  tool            TEXT NOT NULL,          -- codex / claude-code / langchain
  step_type       TEXT NOT NULL,
  original_model  TEXT NOT NULL,
  routed_model    TEXT NOT NULL,
  difficulty      REAL,
  confidence      REAL,
  reasoning       TEXT,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  original_cost   REAL DEFAULT 0,
  actual_cost     REAL DEFAULT 0,
  savings         REAL DEFAULT 0,
  quality_signal  TEXT DEFAULT NULL       -- success / retry / manual_switch / error
);

CREATE TABLE model_scores (
  model           TEXT NOT NULL,
  step_type       TEXT NOT NULL,
  avg_accuracy    REAL DEFAULT 0.5,
  avg_latency_ms  INTEGER DEFAULT 0,
  avg_cost_per_task REAL DEFAULT 0,
  sample_count    INTEGER DEFAULT 0,
  last_updated    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (model, step_type)
);

CREATE TABLE pipeline_combos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_name     TEXT NOT NULL,
  combo_json        TEXT NOT NULL,
  estimated_accuracy REAL,
  estimated_cost    REAL,
  pareto_type       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 10.3 质量信号

Hook 捕获的隐式质量信号：

| 信号类型 | 含义 | 捕获方式 |
|---------|------|---------|
| success | 任务顺利完成 | 同 session 后续无重试 |
| retry | 需要重试 | 检测到相似 prompt 的重复请求 |
| manual_switch | 用户不满意 | 用户通过 /model 手动切换 |
| task_abandoned | 任务放弃 | session 中断 |
| error | 执行出错 | API 返回错误或超时 |

---

## 11. 错误处理

**核心原则：Hook 失败时必须降级为原样放行，永远不阻断用户的工作流。**

| 场景 | 处理方式 |
|------|---------|
| Hook 加载失败 | 静默跳过，写 errors.log，不阻断 codex/claude 启动 |
| StepAnalyzer 超时（>500ms） | 跳过路由，用原始模型放行 |
| 目标模型 API 不可用 | 自动 fallback 到原始模型，记录失败 |
| 流式响应（SSE） | 只改写请求，响应流原样透传 |
| 请求包含图片/附件 | 跳过内容分析，按规则匹配路由 |
| 用户手动指定模型 | 检测到 manual switch，尊重用户选择 |
| 并发请求 | 无状态，每个请求独立分析，无锁 |
| SQLite 写入冲突 | WAL 模式 + 重试，写入失败不阻塞请求 |
| 跨 Provider key 缺失（opt-in 模式） | 跳过该 provider，降级到同 provider 替代模型 |
| 企业策略禁止跨 Provider | 忽略个人 crossProvider 配置，输出提示，使用同 provider 替代 |

---

## 12. 成本报告

```bash
$ agentdispatch cost
```

```
╭──────────────────────────────────────────────────────────╮
│  AgentDispatch 成本报告 — 2026年5月                       │
│                                                          │
│  总览                                                     │
│  ─────                                                    │
│  总请求数:        1,247                                   │
│  原始模型成本:    $142.30  (全部用原始模型)                │
│  实际成本:        $58.70                                  │
│  节省:            $83.60  (58.7%)                         │
│                                                          │
│  按步骤类型                                                │
│  ──────────                                               │
│  exploration    412次  95%→fast tier   节省 $38.20        │
│  editing        298次  62%→standard     节省 $22.10        │
│  formatting     187次  100%→fast tier   节省 $15.80        │
│  reasoning       89次  78%→powerful     节省 $1.20         │
│  simple_tool     261次  100%→fast tier   节省 $6.30         │
│                                                          │
│  按工具                                                    │
│  ──────                                                   │
│  Codex         823次  原始$94.10  实际$37.80  节省59.8%    │
│  Claude Code   424次  原始$48.20  实际$20.90  节省56.6%    │
│                                                          │
│  路由准确率:  94.2%                                       │
╰──────────────────────────────────────────────────────────╯
```

---

## 附录 A：技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript | 用户指定；MCP SDK 有官方 TS 实现；Codex/Claude Code 都是 Node.js |
| 构建 | pnpm workspaces + Turborepo | monorepo 管理，增量构建 |
| Hook 注入 | `--require` + monkey-patch fetch | 进程内拦截，无需额外 daemon |
| 数据存储 | SQLite (better-sqlite3) | 本地文件，零运维，WAL 模式支持并发 |
| MCP Server | @modelcontextprotocol/sdk | 官方 SDK，TypeScript 原生 |
| 测试 | Vitest + 测试容器 | 单元测试 + 集成测试 |
| 发布 | npm (public registry) | 标准分发渠道 |

## 附录 B：文件存储位置

| 路径 | 用途 |
|------|------|
| `/etc/agentdispatch/enterprise.json` | 企业配置（IT 下发，优先级最高，不可被用户覆盖） |
| `~/.agentdispatch/` | 全局数据目录 |
| `~/.agentdispatch/data.db` | SQLite 数据库 |
| `~/.agentdispatch/config.json` | 全局配置（被企业配置和项目级覆盖） |
| `./agentdispatch.config.json` | 项目级配置 |
| `./agentdispatch-data/` | 项目级数据存储（可 gitignore） |
| `./agentdispatch-optimized.json` | 优化结果输出 |

---

## 附录 C：Spec Review 修复记录

> 以下问题由独立 spec review 发现，已在 v2 中修复。

### C1 修复：Protocol Adapter（协议适配器）

跨 provider 路由（如 OpenAI → Anthropic 或 Anthropic → DeepSeek）不只是改 URL，需要完整的请求/响应双向格式转换。新增 Protocol Adapter 为一等公民组件。

**请求转换（以 Anthropic → OpenAI 为例）**：

```typescript
// Codex (OpenAI 格式) 请求路由到 Anthropic Claude
function openaiToAnthropicRequest(openaiBody: any, modelId: string): AnthropicRequest {
  return {
    model: modelId,
    max_tokens: openaiBody.max_tokens ?? 4096,
    system: extractSystemPrompt(openaiBody.messages),
    messages: convertMessages(openaiBody.messages),
    tools: convertTools(openaiBody.tools),
    stream: openaiBody.stream ?? false,
  };
}

// 核心转换逻辑：
// - system role message → 顶层 system 字段
// - function/tool role → tool_result content block
// - tool_calls array → tool_use content blocks
// - stop → stop_sequences
// - response_format.type=json → JSON mode flag
```

**响应转换（以 Anthropic → OpenAI 为例）**：

```typescript
// Anthropic 响应 → OpenAI 格式（非流式）
function anthropicToOpenaiResponse(anthropicResp: any, model: string): OpenAIResponse {
  return {
    id: anthropicResp.id,
    object: "chat.completion",
    model: model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: extractTextContent(anthropicResp.content),
        tool_calls: extractToolCalls(anthropicResp.content),
      },
      finish_reason: mapFinishReason(anthropicResp.stop_reason),
    }],
    usage: {
      prompt_tokens: anthropicResp.usage.input_tokens,
      completion_tokens: anthropicResp.usage.output_tokens,
      total_tokens: anthropicResp.usage.input_tokens + anthropicResp.usage.output_tokens,
    },
  };
}
```

**流式 SSE 事件转换**：

```typescript
// Anthropic SSE 事件 → OpenAI SSE 事件
// Anthropic 格式:
//   event: message_start     → OpenAI: 无等价（在第一个 chunk 中发送 role）
//   event: content_block_start → OpenAI: 无等价
//   event: content_block_delta → OpenAI: choices[0].delta.content / choices[0].delta.tool_calls
//   event: message_delta      → OpenAI: choices[0].delta + usage
//   event: message_stop        → OpenAI: [DONE]

// 实现方式：TransformStream 包装 Response.body
function createSSETransformStream(targetFormat: "openai" | "anthropic"): TransformStream {
  return new TransformStream({
    transform(chunk, controller) {
      const events = parseSSEEvents(chunk);
      for (const event of events) {
        const converted = convertSSEEvent(event, targetFormat);
        if (converted) controller.enqueue(converted);
      }
    }
  });
}
```

**策略决策**：同协议路由（OpenAI → OpenAI 兼容的 DeepSeek/智谱等）和跨协议转换（Anthropic ↔ OpenAI）一并实现。大部分中国模型兼容 OpenAI 格式，Anthropic 的跨协议转换通过 Protocol Adapter 统一处理。

### C2 修复：流式响应成本追踪

Hook 拦截流式响应时，通过 TransformStream 包装 `Response.body`，在 SSE 事件流过时提取 token 统计，不缓冲整个响应：

```typescript
async function handleStreamingResponse(
  originalResponse: Response,
  analysis: StepAnalysis,
  targetFormat: "openai" | "anthropic"
): Promise<Response> {
  // 用 TransformStream 包装原始 body
  const { readable, writable } = new TransformStream({
    transform(chunk, controller) {
      // 透传原始 SSE 数据
      controller.enqueue(chunk);

      // 同时解析 SSE 事件提取 token 统计
      const text = new TextDecoder().decode(chunk);
      const tokenData = extractTokenUsageFromSSE(text, targetFormat);
      if (tokenData) {
        // 异步记录，不阻塞流
        costTracker.recordTokensAsync(analysis.sessionId, tokenData);
      }
    }
  });

  // 将原始 body pipe 到 transform
  originalResponse.body?.pipeTo(writable);

  // 返回新的 Response，body 是 transform 后的 readable
  return new Response(readable, {
    status: originalResponse.status,
    headers: originalResponse.headers,
  });
}
```

提取 token 统计的规则：
- **OpenAI 格式**：最后一个 `choices[0].delta` chunk 之前的 chunk 包含 `usage` 字段
- **Anthropic 格式**：`message_delta` 事件的 `usage.output_tokens` 和 `message_start` 的 `usage.input_tokens`

### M3 修复：重入保护

Step Analyzer 自身的 LLM 调用会触发 Hook 的 fetch 拦截，导致无限递归。解决方案：

```typescript
// 方案：Hook 检测标记 header，跳过自身调用
const DISPATCH_INTERNAL_HEADER = "x-agentdispatch-internal";

globalThis.fetch = async function patchedFetch(input, init) {
  // 重入保护：跳过 AgentDispatch 自身的 LLM 调用
  if (init?.headers && getHeader(init.headers, DISPATCH_INTERNAL_HEADER)) {
    return originalFetch.call(this, input, init);
  }

  // ... 正常路由逻辑
};

// Step Analyzer 调用 LLM 时带上标记
function callAnalyzerLLM(prompt: string): Promise<Analysis> {
  return originalFetch.call(/* 不走 patched fetch */, ...);
  // 或者在 fetch 选项中加 header:
  // headers: { [DISPATCH_INTERNAL_HEADER]: "true", ... }
}
```

### M5 修复：`needsProviderSwitch` 字段

在 `StepAnalysisResponse` 中补充该字段：

```typescript
interface StepAnalysisResponse {
  recommendedModel: string;
  recommendedTier: "fast" | "standard" | "powerful";
  stepType: StepType;
  difficulty: number;
  confidence: number;
  reasoning: string;
  needsProviderSwitch: boolean;   // ← 新增：推荐模型是否与原始请求属于不同 provider
  estimatedTokens: { input: number; output: number };
  alternatives: Array<{
    model: string;
    tier: "fast" | "standard" | "powerful";   // ← 修复：用联合类型替代 string
    costSavingsVsRecommended: number;
    qualityRisk: "none" | "low" | "medium" | "high";
  }>;
}
```

### M1 修复：NODE_OPTIONS 组合策略

```bash
# 不直接覆盖 NODE_OPTIONS，而是生成一个 loader 脚本
# ~/.agentdispatch/loader.js
const hooks = [
  require("@agentdispatch/hook"),
  // 其他工具的 hook 也可以在这里注册
];
hooks.forEach(h => { if (typeof h === 'function') h(); });

# alias 使用 loader 脚本
alias codex='NODE_OPTIONS="--require ~/.agentdispatch/loader.js" codex'
```

用户如果已使用其他 hook（如 cmux/dario），只需把对方的 require 加入 loader 脚本。

### M2 修复：Hook 降级策略

```typescript
// Hook 入口：检测 globalThis.fetch 是否可被正确拦截
try {
  const testUrl = "https://test.agentdispatch.local/ping";
  const original = globalThis.fetch;

  // 验证 monkey-patch 是否生效
  let patched = false;
  globalThis.fetch = (input) => { patched = true; return original.call(this, input); };
  globalThis.fetch(testUrl).catch(() => {});  // 不关心结果
  globalThis.fetch = original;

  if (!patched) {
    // monkey-patch 不生效，输出提示用户使用 Proxy 模式
    console.warn(
      "[AgentDispatch] fetch 拦截不可用（可能使用了 bundled undici）。\n" +
      "请使用 Proxy 模式：agentdispatch init --mode proxy"
    );
    return;  // 不安装 hook
  }

  // 正常安装 hook
  installFetchHook();
} catch (err) {
  logError(err);
}
```

降级路径：`--require` Hook → HTTP Proxy（本地 daemon）→ 手动配置 base URL

### M7 修复：平台支持

**MVP 明确支持**：macOS + Linux（bash/zsh）
**Windows**：通过 WSL2 运行 Codex/Claude Code 时天然支持。原生 Windows 作为后续支持。

`agentdispatch init` 检测平台：
- macOS/Linux → 写入 `.zshrc` 或 `.bashrc`
- Windows (WSL) → 写入 `~/.bashrc` (WSL 内)
- Windows (原生) → 提示 "请通过 WSL2 使用"

### m3 修复：配置文件合并策略

```
合并规则（逐层覆盖，优先级从低到高）:
1. 内置默认值（代码中的 defaults）
2. 企业配置 /etc/agentdispatch/enterprise.json（IT 下发，锁定字段不可覆盖）
3. 全局配置 ~/.agentdispatch/config.json（覆盖默认值，但不可覆盖企业锁定的字段）
4. 项目配置 ./agentdispatch.config.json（覆盖全局配置，但不可覆盖企业锁定的字段）

字段行为：
- 顶层字段（routing, tracking, updates）→ 整体替换
- routing.crossProvider → 企业配置锁定时，用户配置被忽略并输出提示
- models → 按组合并（models.fast 合并去重）
- providers → 按 key 合并
- customModels → 追加（不替换内置模型）
- enterpriseProviders → 仅企业配置可设置，用户配置中写该字段会被忽略
```
