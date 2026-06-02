import type { ModelRegistry, ModelEntry, ModelTier } from "@agentfare/models";
import type { EnterpriseProviderConfig, RoutingConfig } from "../config/types.js";

export function tryCrossProviderEnterprise(
  registry: ModelRegistry,
  targetProvider: string,
  tier: ModelTier,
  routing: RoutingConfig,
): { model: ModelEntry; config: EnterpriseProviderConfig } | null {
  const enterpriseConfig = routing.enterpriseProviders[targetProvider];
  if (!enterpriseConfig) return null;

  if (!enterpriseConfig.allowedTiers.includes(tier as any)) {
    return null;
  }

  const model = registry.findCheapest(targetProvider, tier);
  if (!model) return null;

  return { model, config: enterpriseConfig };
}
