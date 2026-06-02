import type { ModelEntry, ModelTier } from "@agentfare/models";
import type { ModelRegistry } from "@agentfare/models";

export function findSameProviderModel(
  registry: ModelRegistry,
  provider: string,
  tier: ModelTier,
  strategy: "cost-optimal" | "quality-first" | "balanced"
): ModelEntry | undefined {
  const candidates = registry.getByProvider(provider).filter((m) => m.tier === tier);
  if (candidates.length === 0) {
    const allSameProvider = registry.getByProvider(provider);
    if (allSameProvider.length > 0) return allSameProvider[0];
    return undefined;
  }
  if (candidates.length === 1) return candidates[0];

  switch (strategy) {
    case "cost-optimal":
      return candidates.reduce((min, m) =>
        m.pricing.outputPerMillion < min.pricing.outputPerMillion ? m : min
      );
    case "quality-first":
      return candidates.reduce((best, m) =>
        m.capabilities.codeGeneration > best.capabilities.codeGeneration ? m : best
      );
    case "balanced":
    default:
      return candidates[0];
  }
}
