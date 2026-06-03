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
    if (allSameProvider.length > 0) {
      // Fallback: pick the model closest to the requested tier
      const tierOrder: Record<ModelTier, number> = { fast: 0, standard: 1, powerful: 2 };
      const targetRank = tierOrder[tier];
      const sorted = [...allSameProvider].sort((a, b) =>
        Math.abs(tierOrder[a.tier] - targetRank) - Math.abs(tierOrder[b.tier] - targetRank)
      );
      return sorted[0];
    }
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
    default: {
      // Weighted selection: score = quality / cost (higher is better)
      // Pick the candidate with the best quality-per-cost ratio
      const scored = candidates.map((m) => {
        const quality =
          (m.capabilities.codeGeneration + m.capabilities.reasoning + m.capabilities.toolUse) / 3;
        const cost = m.pricing.outputPerMillion || 0.01; // avoid division by zero
        return { model: m, score: quality / cost };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored[0].model;
    }
  }
}
