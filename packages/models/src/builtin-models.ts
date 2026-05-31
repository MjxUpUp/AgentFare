import type { ModelEntry } from "./types.js";

export const BUILTIN_MODELS: ModelEntry[] = [
  // === OpenAI ===
  {
    id: "openai/gpt-5.5",
    provider: "openai",
    displayName: "GPT-5.5",
    tier: "powerful",
    pricing: { inputPerMillion: 30, outputPerMillion: 120, cacheHitPerMillion: -1, currency: "USD" },
    capabilities: { codeGeneration: 10, codeReview: 10, planning: 10, reasoning: 10, toolUse: 10, contextWindow: 200, maxOutputTokens: 32, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 2000, tokensPerSecond: 40, availability: 0.999, region: ["us", "global"] },
    api: { protocol: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-5.5" },
  },
  {
    id: "openai/gpt-5.4",
    provider: "openai",
    displayName: "GPT-5.4",
    tier: "standard",
    pricing: { inputPerMillion: 5, outputPerMillion: 20, cacheHitPerMillion: -1, currency: "USD" },
    capabilities: { codeGeneration: 9, codeReview: 9, planning: 9, reasoning: 9, toolUse: 9, contextWindow: 200, maxOutputTokens: 32, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 1200, tokensPerSecond: 60, availability: 0.999, region: ["us", "global"] },
    api: { protocol: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-5.4" },
  },
  {
    id: "openai/gpt-5.3-codex-spark",
    provider: "openai",
    displayName: "GPT-5.3 Codex Spark",
    tier: "fast",
    pricing: { inputPerMillion: 0.5, outputPerMillion: 2, cacheHitPerMillion: -1, currency: "USD" },
    capabilities: { codeGeneration: 7, codeReview: 6, planning: 6, reasoning: 6, toolUse: 7, contextWindow: 128, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 500, tokensPerSecond: 120, availability: 0.999, region: ["us", "global"] },
    api: { protocol: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-5.3-codex-spark" },
  },
  {
    id: "openai/gpt-5.4-mini",
    provider: "openai",
    displayName: "GPT-5.4 Mini",
    tier: "fast",
    pricing: { inputPerMillion: 0.25, outputPerMillion: 1, cacheHitPerMillion: -1, currency: "USD" },
    capabilities: { codeGeneration: 6, codeReview: 5, planning: 5, reasoning: 5, toolUse: 6, contextWindow: 128, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 300, tokensPerSecond: 150, availability: 0.999, region: ["us", "global"] },
    api: { protocol: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-5.4-mini" },
  },

  // === Anthropic ===
  {
    id: "anthropic/claude-opus-4-6",
    provider: "anthropic",
    displayName: "Claude Opus 4.6",
    tier: "powerful",
    pricing: { inputPerMillion: 5, outputPerMillion: 25, cacheHitPerMillion: 0.625, currency: "USD" },
    capabilities: { codeGeneration: 10, codeReview: 10, planning: 10, reasoning: 10, toolUse: 10, contextWindow: 200, maxOutputTokens: 32, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 2500, tokensPerSecond: 35, availability: 0.999, region: ["us", "global"] },
    api: { protocol: "anthropic", baseUrl: "https://api.anthropic.com", modelId: "claude-opus-4-6" },
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.6",
    tier: "standard",
    pricing: { inputPerMillion: 3, outputPerMillion: 15, cacheHitPerMillion: 0.375, currency: "USD" },
    capabilities: { codeGeneration: 9, codeReview: 9, planning: 9, reasoning: 9, toolUse: 9, contextWindow: 200, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 1500, tokensPerSecond: 55, availability: 0.999, region: ["us", "global"] },
    api: { protocol: "anthropic", baseUrl: "https://api.anthropic.com", modelId: "claude-sonnet-4-6" },
  },
  {
    id: "anthropic/claude-haiku-4-5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    tier: "fast",
    pricing: { inputPerMillion: 1, outputPerMillion: 5, cacheHitPerMillion: 0.125, currency: "USD" },
    capabilities: { codeGeneration: 7, codeReview: 6, planning: 6, reasoning: 6, toolUse: 7, contextWindow: 200, maxOutputTokens: 8, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 400, tokensPerSecond: 100, availability: 0.999, region: ["us", "global"] },
    api: { protocol: "anthropic", baseUrl: "https://api.anthropic.com", modelId: "claude-haiku-4-5-20251001" },
  },

  // === Google ===
  {
    id: "google/gemini-2.5-pro",
    provider: "google",
    displayName: "Gemini 2.5 Pro",
    tier: "powerful",
    pricing: { inputPerMillion: 1.25, outputPerMillion: 10, cacheHitPerMillion: -1, currency: "USD" },
    capabilities: { codeGeneration: 9, codeReview: 9, planning: 9, reasoning: 10, toolUse: 9, contextWindow: 1000, maxOutputTokens: 64, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 2000, tokensPerSecond: 50, availability: 0.998, region: ["us", "global"] },
    api: { protocol: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelId: "gemini-2.5-pro" },
  },
  {
    id: "google/gemini-2.5-flash",
    provider: "google",
    displayName: "Gemini 2.5 Flash",
    tier: "fast",
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6, cacheHitPerMillion: -1, currency: "USD" },
    capabilities: { codeGeneration: 7, codeReview: 6, planning: 7, reasoning: 7, toolUse: 7, contextWindow: 1000, maxOutputTokens: 64, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 500, tokensPerSecond: 150, availability: 0.998, region: ["us", "global"] },
    api: { protocol: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelId: "gemini-2.5-flash" },
  },

  // === DeepSeek ===
  {
    id: "deepseek/v4-pro",
    provider: "deepseek",
    displayName: "DeepSeek V4 Pro",
    tier: "standard",
    pricing: { inputPerMillion: 0.435, outputPerMillion: 0.87, cacheHitPerMillion: 0.003625, currency: "USD" },
    capabilities: { codeGeneration: 9, codeReview: 8, planning: 8, reasoning: 9, toolUse: 8, contextWindow: 128, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 1500, tokensPerSecond: 50, availability: 0.995, region: ["cn", "global"] },
    api: { protocol: "openai", baseUrl: "https://api.deepseek.com", modelId: "deepseek-v4-pro" },
  },
  {
    id: "deepseek/v4-flash",
    provider: "deepseek",
    displayName: "DeepSeek V4 Flash",
    tier: "fast",
    pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28, cacheHitPerMillion: 0.02, currency: "USD" },
    capabilities: { codeGeneration: 7, codeReview: 6, planning: 7, reasoning: 7, toolUse: 7, contextWindow: 1000, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 500, tokensPerSecond: 120, availability: 0.995, region: ["cn", "global"] },
    api: { protocol: "openai", baseUrl: "https://api.deepseek.com", modelId: "deepseek-v4-flash" },
  },

  // === 智谱 ===
  {
    id: "zhipu/glm-5",
    provider: "zhipu",
    displayName: "GLM-5",
    tier: "powerful",
    pricing: { inputPerMillion: 1.0, outputPerMillion: 3.2, cacheHitPerMillion: -1, currency: "USD" },
    capabilities: { codeGeneration: 8, codeReview: 8, planning: 8, reasoning: 8, toolUse: 8, contextWindow: 200, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 1500, tokensPerSecond: 50, availability: 0.99, region: ["cn"] },
    api: { protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", modelId: "glm-5" },
  },

  // === 月之暗面 ===
  {
    id: "moonshot/kimi-k2.6",
    provider: "moonshot",
    displayName: "Kimi K2.6",
    tier: "standard",
    pricing: { inputPerMillion: 0.16, outputPerMillion: 2.5, cacheHitPerMillion: 0.07, currency: "USD" },
    capabilities: { codeGeneration: 8, codeReview: 7, planning: 8, reasoning: 8, toolUse: 7, contextWindow: 128, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 1200, tokensPerSecond: 60, availability: 0.99, region: ["cn"] },
    api: { protocol: "openai", baseUrl: "https://api.moonshot.cn/v1", modelId: "kimi-k2.6" },
  },

  // === 阿里 ===
  {
    id: "alibaba/qwen3-max",
    provider: "alibaba",
    displayName: "Qwen3 Max",
    tier: "standard",
    pricing: { inputPerMillion: 0.78, outputPerMillion: 3.9, cacheHitPerMillion: 0.156, currency: "USD" },
    capabilities: { codeGeneration: 8, codeReview: 8, planning: 8, reasoning: 8, toolUse: 8, contextWindow: 262, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 1000, tokensPerSecond: 70, availability: 0.995, region: ["cn"] },
    api: { protocol: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelId: "qwen3-max" },
  },

  // === 小米 ===
  {
    id: "xiaomi/mimo-v2.5",
    provider: "xiaomi",
    displayName: "MiMo V2.5",
    tier: "standard",
    pricing: { inputPerMillion: 1.0, outputPerMillion: 3.0, cacheHitPerMillion: 0.2, currency: "USD" },
    capabilities: { codeGeneration: 7, codeReview: 7, planning: 7, reasoning: 7, toolUse: 7, contextWindow: 1000, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 1200, tokensPerSecond: 55, availability: 0.99, region: ["cn"] },
    api: { protocol: "openai", baseUrl: "https://platform.xiaomimimo.com/v1", modelId: "mimo-v2.5" },
  },
];
