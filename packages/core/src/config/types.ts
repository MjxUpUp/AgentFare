export type CrossProviderMode = "off" | "opt-in" | "enterprise";

export interface EnterpriseProviderConfig {
  baseUrl: string;
  authMode: "corporate-sso" | "service-account" | "api-key";
  allowedTiers: Array<"fast" | "standard" | "powerful">;
  dataRegion?: string;
}

export interface RoutingConfig {
  defaultStrategy: "cost-optimal" | "quality-first" | "balanced";
  analyzerModel: string;
  cacheResults: boolean;
  crossProvider: CrossProviderMode;
  crossProviderProviders: string[];
  enterpriseProviders: Record<string, EnterpriseProviderConfig>;
}

export interface ProviderConfig {
  baseUrl: string;
}

export interface TrackingConfig {
  enabled: boolean;
  storePath: string;
  reportFormat: "json" | "table";
}

export interface OnlineLearningConfig {
  enabled: boolean;
  minSamplesBeforeSuggest: number;
  suggestionChannel: "cli" | "log" | "off";
  autoApply: boolean;
  windowSize: number;
}

export interface AgentFareConfig {
  models: {
    fast: string[];
    standard: string[];
    powerful: string[];
  };
  routing: RoutingConfig;
  providers: Record<string, ProviderConfig>;
  customModels: Array<{
    id: string;
    provider: string;
    displayName: string;
    tier: "fast" | "standard" | "powerful";
    pricing: { inputPerMillion: number; outputPerMillion: number; cacheHitPerMillion: number | null };
    capabilities: {
      codeGeneration: number; codeReview: number; planning: number;
      reasoning: number; toolUse: number; contextWindow: number;
      maxOutputTokens: number; streaming: boolean; jsonMode: boolean;
    };
    routing: { avgLatencyMs: number; tokensPerSecond: number; availability: number; region: ("us" | "cn" | "global")[] };
    api: { protocol: "openai" | "anthropic"; baseUrl: string; modelId: string };
  }>;
  tracking: TrackingConfig;
  onlineLearning: OnlineLearningConfig;
}

export interface EnterpriseConfig {
  routing?: {
    crossProvider?: CrossProviderMode;
    enterpriseProviders?: Record<string, EnterpriseProviderConfig>;
  };
}
