# @agentfare/models

模型注册表与定价数据。

## 使用

```typescript
import { ModelRegistry, BUILTIN_MODELS } from "@agentfare/models";

const registry = new ModelRegistry();
const allModels = registry.getAll();
const openaiModels = registry.getByProvider("openai");
```

## 远程更新

```typescript
import { fetchRemoteModels, mergeRemoteModels } from "@agentfare/models";

const remote = await fetchRemoteModels();
const merged = mergeRemoteModels(BUILTIN_MODELS, remote);
```

## License

MIT
