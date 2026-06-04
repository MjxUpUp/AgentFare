import type { ModelEntry } from "@agentfare/models";

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
  /** User's original upstream URL (captured before proxy overwrites env vars) */
  upstreamUrl?: string;
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
  customModels: ModelEntry[];
  tracking: TrackingConfig;
  onlineLearning: OnlineLearningConfig;
}

export interface EnterpriseConfig {
  routing?: {
    crossProvider?: CrossProviderMode;
    enterpriseProviders?: Record<string, EnterpriseProviderConfig>;
  };
}
