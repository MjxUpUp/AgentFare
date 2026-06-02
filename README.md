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

```
用户代码 (Claude / Codex / 任意 OpenAI 兼容客户端)
    │
    ▼
agentfare/hook ─── fetch 拦截 + 协议转换 (OpenAI ↔ Anthropic)
    │
    ▼
agentfare/core ─── 路由决策 + 成本追踪 + 在线学习
    │
    ▼
LLM Provider (OpenAI / Anthropic / Google / DeepSeek / ...)
```

## 包结构

| 包 | 说明 |
|---|---|
| `@agentfare/cli` | 命令行工具 |
| `@agentfare/core` | 路由引擎、成本追踪、优化器 |
| `@agentfare/hook` | fetch 拦截、协议转换 |
| `@agentfare/models` | 模型注册表、定价数据 |
| `agentfare/loader` | Node.js `--require` 预加载器 |
| `@agentfare/setup` | 环境检测、Shell 配置 |
| `@agentfare/mcp-server` | MCP 协议服务 |
| `@agentfare/langchain` | LangChain 回调集成 (alpha) |

## 开发

```bash
pnpm install
pnpm build
pnpm test
pnpm test:e2e
```

## License

MIT
