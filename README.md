# AgentFare

智能 LLM 模型路由代理 —— 自动为每次 API 调用选择最优模型，降低成本同时保持质量。

## 快速开始

最终用户无需 clone 本仓库，直接用已发布的 CLI（npm 包 `@agentfare/cli`，bin 名 `agentfare`）：

```bash
# 全局安装
npm install -g @agentfare/cli

# 初始化：检测已装的客户端、启动本地代理（端口 3456，仅 127.0.0.1）、自动改写 *_BASE_URL
agentfare init

# 像平时一样用 Claude Code / Codex / Cursor …，请求会自动经本地代理路由
agentfare cost          # 随时查看成本与节省
```

不想全局安装可用 `npx @agentfare/cli init`（注意包名是 scoped 的 `@agentfare/cli`，npm 上没有 unscoped 的 `agentfare` 包）。

### 桌面应用（AgentFare 控制台）

图形化完成全部 onboarding——填 API key、选 provider、一键接管/还原 shell、查看成本与日志，**无需命令行**。基于 Tauri 2 的跨平台桌面应用（Windows / macOS / Linux），与 CLI 共用同一本地代理 daemon、配置互通。

首个 installer 随 [Releases](https://github.com/MjxUpUp/AgentFare/releases) 发布；发布前可从源码构建（见[开发](#开发)）。

从源码开发构建见下方[开发](#开发)一节。

## 架构

默认 **proxy 模式**（本地常驻代理，接管全部请求；`agentfare init` 默认走此模式）：

```
Claude Code / Codex / 任意 OpenAI·Anthropic 兼容客户端
    │  *_BASE_URL → http://localhost:3456/{anthropic|openai|...}
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
| `@agentfare/gui` | Tauri 桌面控制台（React/Vite）：图形化 onboarding、key/provider 管理、shell 接管、成本与日志查看 |
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

构建桌面应用 installer（Tauri 会自动串联前端构建 + proxy daemon / setup CLI 的 sidecar 打包；需 Rust 工具链与各平台原生依赖）：

```bash
pnpm --filter @agentfare/gui exec tauri build
```

## License

MIT
