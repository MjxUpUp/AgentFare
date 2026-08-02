import type { ModelEntry } from "@agentfare/models";

/**
 * Telemetry shape reported by the router.
 * - "off" / "opt-in" / "enterprise": mirror {@link RoutingConfig.crossProvider}
 *   (the configured cross-provider policy) on automatic routes.
 * - "lock": a manual cc-switch lock (lockMode=model|provider) short-circuited
 *   the policy. Reported instead of the config value so providerSwitched=true
 *   never appears alongside crossProviderMode="off" (L2: router.ts is the sole
 *   source consumer — no downstream switches on this — but the field stays
 *   honest rather than self-contradictory).
 */
export type CrossProviderMode = "off" | "opt-in" | "enterprise" | "lock";

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
  /**
   * cc-switch 式手动锁定。默认/缺省 "auto" 走自动路由引擎；
   * "model" 强制锁定到 activeModel（忽略 tier 分析与 crossProvider 策略）；
   * "provider" 强制锁定到 activeProvider（在该 provider 内仍按 defaultStrategy+tier 选模型）。
   * 缺省按 "auto" 处理，向后兼容不含此字段的老 config。
   */
  lockMode?: "auto" | "model" | "provider";
  /** lockMode="model" 时锁定的模型 id（registry key，如 "deepseek/v4-pro"）。 */
  activeModel?: string;
  /** lockMode="provider" 时锁定的 provider（如 "deepseek"）。 */
  activeProvider?: string;
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
