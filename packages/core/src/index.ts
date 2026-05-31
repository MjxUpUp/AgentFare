// @agentdispatch/core — 统一导出
// 每完成一个 Task，在此文件末尾追加对应导出

// === Task 4: 配置系统 ===
export { mergeConfig, loadConfigFromDisk } from "./config/loader.js";
export { applyEnterprisePolicy } from "./config/enterprise.js";
export { DEFAULT_CONFIG } from "./config/defaults.js";
export type {
  AgentDispatchConfig,
  RoutingConfig,
  CrossProviderMode,
  EnterpriseProviderConfig,
  TrackingConfig,
  OnlineLearningConfig,
} from "./config/types.js";

// === Task 5: Step Analyzer L1 ===
export { analyzeStepRules } from "./analyzer/rules.js";
export { extractTaskFromMessages } from "./analyzer/types.js";
export type {
  StepType,
  StepAnalysis,
  StepAnalysisRequest,
  LLMAnalysisInput,
  Message,
  ContentBlock,
  ToolCall,
} from "./analyzer/types.js";

// === Task 6: Cost Tracker + SQLite ===
export { TrackingDatabase } from "./tracker/database.js";
export { CostTracker } from "./tracker/cost-tracker.js";
export { QualitySignalCollector } from "./tracker/quality-signal.js";
export type { QualitySignal, QualitySignalEvent } from "./tracker/quality-signal.js";
export type { RoutingLogEntry, CostSummary } from "./tracker/database.js";
