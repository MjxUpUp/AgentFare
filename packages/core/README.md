# @agentfare/core

核心路由引擎、成本追踪器和优化器。

## 主要模块

- **路由引擎** (`routing/`) — 基于任务难度和置信度的模型路由
- **成本追踪** (`tracker/`) — SQLite 持久化的请求日志和费用统计
- **优化器** (`optimizer/`) — 多策略搜索和在线学习
- **分析器** (`analyzer/`) — LLM 分析流水线和缓存

## 使用

```typescript
import { TrackingDatabase, CostTracker, QualitySignalCollector } from "@agentfare/core";

const db = new TrackingDatabase("~/.agentfare/data.db");
const costTracker = new CostTracker(db);
const quality = new QualitySignalCollector();
```

## License

MIT
