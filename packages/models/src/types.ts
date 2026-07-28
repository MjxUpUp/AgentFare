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

export type AuthScheme = "bearer" | "x-api-key" | "sigv4" | "oauth";

export interface ModelApi {
  protocol: "openai" | "anthropic";
  baseUrl: string;
  modelId: string;
  /**
   * Auth scheme for this endpoint. If omitted, derived from `protocol`
   * (anthropic → x-api-key, openai → bearer) for backward compatibility.
   * Vendors that deviate (e.g. Kimi's Anthropic endpoint uses Bearer) set this explicitly.
   */
  authScheme?: AuthScheme;
}

export interface ModelEntry {
  id: string;                    // "openai/gpt-5.3-codex-spark"
  provider: ProviderId;          // openai / anthropic / deepseek / ...
  displayName: string;
  tier: ModelTier;

  pricing: ModelPricing;
  capabilities: ModelCapabilities;
  routing: ModelRouting;
  /** Primary endpoint. Always treated as the first entry of the endpoint set. */
  api: ModelApi;
  /**
   * Additional protocol endpoints for the same model — e.g. a domestic vendor
   * exposing both OpenAI- and Anthropic-compatible URLs. Lets a request pick the
   * endpoint whose protocol matches the client, avoiding protocol conversion.
   * (方案A: multi-endpoint per model.)
   */
  endpoints?: ModelApi[];
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
