import type { ModelRegistry, ModelEntry } from "@agentfare/models";
import { getApiKeyForProvider } from "@agentfare/models";

export function selectAnalyzerModel(registry: ModelRegistry): ModelEntry | null {
  const fastModels = registry.getByTier("fast");

  const withKey = fastModels.filter((m) => {
    return !!getApiKeyForProvider(m.provider);
  });

  if (withKey.length > 0) {
    return withKey.reduce((cheapest, m) =>
      m.pricing.outputPerMillion < cheapest.pricing.outputPerMillion ? m : cheapest
    );
  }

  return null;
}
