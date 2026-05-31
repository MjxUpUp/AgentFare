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
