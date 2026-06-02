# @agentfare/cli

AgentFare 命令行工具。

## 安装

```bash
npm install -g @agentfare/cli
# 或
pnpm add -g @agentfare/cli
```

## 命令

### `agentfare init`

检测已安装的 CLI 工具（Claude、Codex）并配置环境。

### `agentfare cost`

查看成本报告。

```bash
agentfare cost              # 最近 30 天
agentfare cost --last 7d    # 最近 7 天
agentfare cost --json       # JSON 输出
```

### `agentfare config`

管理配置项。

```bash
agentfare config set routing.strategy tiered
agentfare config get routing.strategy
```

### `agentfare models`

模型管理。

```bash
agentfare models list                    # 列出所有模型
agentfare models list --provider openai  # 按 provider 过滤
agentfare models update                  # 拉取最新模型数据
```

### `agentfare optimize`

运行路由优化。

## License

MIT
