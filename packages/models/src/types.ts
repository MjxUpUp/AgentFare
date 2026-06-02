export interface ModelPricing {
  inputPerMillion: number;     // $/MTok
  outputPerMillion: number;
  cacheHitPerMillion: number | null;  // null = 不支持缓存
  currency: "USD";
}

export interface ModelCapabilities {
  codeGeneration: number;      // 0-10
  codeReview: number;
  planning: number;
  reasoning: number;
  toolUse: number;
  contextWindow: number;       // K tokens
  maxOutputTokens: number;     // K tokens
  streaming: boolean;
  jsonMode: boolean;
}

export interface ModelRouting {
  avgLatencyMs: number;
  tokensPerSecond: number;
  availability: number;        // 0-1
  region: ("us" | "cn" | "global")[];
}

export interface ModelApi {
  protocol: "openai" | "anthropic";
  baseUrl: string;
  modelId: string;
}

export interface ModelEntry {
  id: string;                    // "openai/gpt-5.3-codex-spark"
  provider: ProviderId;          // openai / anthropic / deepseek / ...
  displayName: string;
  tier: ModelTier;

  pricing: ModelPricing;
  capabilities: ModelCapabilities;
  routing: ModelRouting;
  api: ModelApi;
}

export type ModelTier = "fast" | "standard" | "powerful";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "zhipu"
  | "moonshot"
  | "alibaba"
  | "xiaomi"
  | "custom";
