# AgentFare

智能 LLM 模型路由代理 —— 自动为每次 API 调用选择最优模型，降低成本同时保持质量。

## 快速开始

```bash
# 安装
pnpm install

# 构建
pnpm build

# 初始化（检测已安装的 CLI 工具）
npx agentfare init

# 查看成本报告
npx agentfare cost
```

## 架构

默认 **proxy 模式**（本地常驻代理，接管全部请求；`agentfare init` 默认走此模式）：

```
Claude Code / Codex / 任意 OpenAI·Anthropic 兼容客户端
    │  *_BASE_URL → http://localhost:8787/{anthropic|openai|...}
    ▼
@agentfare/proxy ─── HTTP 代理 daemon：路由转发 + 协议转换 + failover/熔断 + 成本追踪
    │
    ▼
@agentfare/core ─── 路由决策 + 在线学习
    │
    ▼
LLM Provider (OpenAI / Anthropic / DeepSeek / Zhipu / Alibaba / Moonshot / Xiaomi)
```

> Legacy **hook 模式**（`agentfare init --mode hook`）：`@agentfare/hook` 通过 `fetch` 拦截实现协议转换与 failover，无独立 daemon。

## 包结构

| 包 | 说明 |
|---|---|
| `@agentfare/cli` | 命令行工具：`init` / `cost` / `config` / `models` / `optimize` / `proxy` / `restore` |
| `@agentfare/proxy` | HTTP 代理 daemon（默认模式）：路由转发、failover/熔断、成本追踪 |
| `@agentfare/core` | 路由引擎、成本追踪、优化器 |
| `@agentfare/hook` | `fetch` 拦截、协议转换、failover（legacy hook 模式） |
| `@agentfare/models` | 模型注册表、定价数据 |
| `@agentfare/loader` | Node.js `--require` 预加载器 |
| `@agentfare/setup` | 环境检测、Shell 配置 |
| `@agentfare/mcp-server` | MCP 协议服务 |

## 开发

```bash
pnpm install
pnpm build
pnpm test
pnpm test:e2e
```

## License

MIT
