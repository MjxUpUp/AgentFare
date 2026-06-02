# @agentfare/hook

fetch 拦截层 —— 拦截全局 `fetch` 调用，将 LLM API 请求通过路由引擎处理后转发。

## 功能

- 自动拦截 OpenAI / Anthropic API 调用
- 跨 Provider 协议转换（OpenAI ↔ Anthropic SSE）
- 重入保护（防止路由请求被二次拦截）

## 集成方式

### Node.js --require 预加载

```bash
NODE_OPTIONS="--require @agentfare/hook" node your-app.js
```

### 编程式

```typescript
import { installFetchPatch } from "@agentfare/hook/fetch-patch";

const uninstall = installFetchPatch({
  handler,
  costTracker,
  onRouting: (result) => console.log(result),
});

// 卸载
uninstall();
```

## License

MIT
