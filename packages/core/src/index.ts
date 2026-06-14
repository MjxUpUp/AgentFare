// @agentfare/core — 统一导出
// 每完成一个 Task，在此文件末尾追加对应导出

// === Task 4: 配置系统 ===
export { mergeConfig, loadConfigFromDisk } from "./config/loader.js";
export { applyEnterprisePolicy } from "./config/enterprise.js";
export { DEFAULT_CONFIG } from "./config/defaults.js";
export type {
  AgentFareConfig,
  RoutingConfig,
  CrossProviderMode,
  EnterpriseProviderConfig,
  TrackingConfig,
  OnlineLearningConfig,
} from "./config/types.js";

// === Errors ===
export { AgentFareError, ConfigError, RoutingError, AnalysisError } from "./errors.js";

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
export { TrackingDatabase, isSqliteAvailable } from "./tracker/database.js";
export { CostTracker } from "./tracker/cost-tracker.js";
export { QualitySignalCollector } from "./tracker/quality-signal.js";
export type { QualitySignal, QualitySignalEvent } from "./tracker/quality-signal.js";
export type { RoutingLogEntry, CostSummary, RoutingLogRow, StepToolSummary } from "./tracker/database.js";

// === Task 7: Routing Engine ===
export { Router } from "./routing/router.js";
export type { RoutingDecision } from "./routing/router.js";

// === Task 12: Step Analyzer L2 ===
export { analyzeWithLLM, buildAnalyzerPrompt } from "./analyzer/llm-analyzer.js";

// === Task 13: Route Cache + Auto Model Selector ===
export { RouteCache } from "./analyzer/cache.js";
export { selectAnalyzerModel } from "./analyzer/auto-model-selector.js";

// === Task 20: Optimizer eval runner ===
export { parsePipeline, parsePipelineYAML, computeTotalCombinations } from "./optimizer/pipeline-parser.js";
export { loadEvalDataset, evaluateCombo } from "./optimizer/eval-runner.js";
export type { EvalSample, EvalResult } from "./optimizer/eval-runner.js";

// === Task 21: Search algorithms ===
export { bruteForceSearch, armEliminationSearch, epsilonLucbSearch, hillClimbingSearch, bayesianSearch } from "./optimizer/search.js";
export type { Pipeline, PipelineStep, RankedCombo, SearchConfig, SearchAlgorithm } from "./optimizer/types.js";
export { DEFAULT_SEARCH_CONFIG } from "./optimizer/types.js";

// === Task 22: Online learning ===
export { OnlineLearner } from "./optimizer/online-learning.js";
export type { ModelScore, OnlineLearnerConfig } from "./optimizer/online-learning.js";

// === Task 23: Report Exporter ===
export { generateReport } from "./tracker/report-exporter.js";
export type { CostReport, StepReport, ToolReport } from "./tracker/report-exporter.js";

// === Shared utilities ===
export { estimateTokensFromMessages } from "./utils/tokens.js";
export { log as getLogger, setLogger, consoleLogger } from "./utils/logger.js";
export type { Logger } from "./utils/logger.js";
export { atomicWriteFileSync } from "./utils/atomic-write.js";
export {
  resolveEffectiveBaseUrl,
  detectKeyHostConflict,
  isOfficialHost,
} from "./utils/upstream-guard.js";
export type {
  EffectiveBaseUrlInput,
  KeyHostConflictInput,
  KeyHostConflictResult,
} from "./utils/upstream-guard.js";
