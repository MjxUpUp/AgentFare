# @agentfare/proxy

HTTP 代理服务器 —— 接收 LLM API 请求，根据路由策略转发到目标 Provider，支持 SSE 流式透传。

## 功能

- HTTP 代理服务器，接收请求并路由到目标 Provider
- 跨 Provider 协议转换（OpenAI ↔ Anthropic）
- SSE 流式响应透传
- API Key 管理与请求头构建
- Provider 路径解析

## 使用

```typescript
import { createProxyServer } from "@agentfare/proxy/server";
import { startProxy, stopProxy } from "@agentfare/proxy/lifecycle";

const server = createProxyServer(deps);
startProxy(server, 8080);
```

## License

MIT
