# @agentfare/setup

环境检测和 Shell 配置工具。

## 功能

- 检测平台（macOS / Linux / WSL / Windows）
- 检测已安装的 CLI 工具
- 生成并写入 Shell 函数到 `.zshrc` / `.bashrc`
- 验证 hook 注入状态

## 使用

```typescript
import { detectTools, detectPlatform, runSetup } from "@agentfare/setup";

const tools = detectTools();
const platform = detectPlatform();
await runSetup();
```

## License

MIT
