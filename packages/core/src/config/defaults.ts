import type { AgentDispatchConfig } from "./types.js";

export const DEFAULT_CONFIG: AgentDispatchConfig = {
  models: {
    fast: ["openai/gpt-5.3-codex-spark", "anthropic/claude-haiku-4-5", "deepseek/v4-flash"],
    standard: ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6", "deepseek/v4-pro", "alibaba/qwen3-max"],
    powerful: ["openai/gpt-5.5", "anthropic/claude-opus-4-6", "zhipu/glm-5"],
  },
  routing: {
    defaultStrategy: "cost-optimal",
    analyzerModel: "auto",
    cacheResults: true,
    crossProvider: "off",
    crossProviderProviders: [],
    enterpriseProviders: {},
  },
  providers: {
    openai:    { baseUrl: "https://api.openai.com/v1" },
    anthropic: { baseUrl: "https://api.anthropic.com" },
    deepseek:  { baseUrl: "https://api.deepseek.com" },
    zhipu:     { baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    moonshot:  { baseUrl: "https://api.moonshot.cn/v1" },
    alibaba:   { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    xiaomi:    { baseUrl: "https://platform.xiaomimimo.com/v1" },
  },
  customModels: [],
  tracking: {
    enabled: true,
    storePath: "./agentdispatch-data/",
    reportFormat: "json",
  },
  onlineLearning: {
    enabled: true,
    minSamplesBeforeSuggest: 50,
    suggestionChannel: "cli",
    autoApply: false,
    windowSize: 200,
  },
};
