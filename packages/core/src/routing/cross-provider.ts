import type { ModelRegistry, ModelEntry, ModelTier } from "@agentfare/models";
import { getApiKeyForProvider } from "@agentfare/models";
import type { RoutingConfig } from "../config/types.js";

export function tryCrossProviderOptIn(
  registry: ModelRegistry,
  targetProvider: string,
  tier: ModelTier,
  routing: RoutingConfig,
): { model: ModelEntry; apiKey: string } | null {
  if (!routing.crossProviderProviders.includes(targetProvider)) {
    return null;
  }

  const apiKey = getApiKeyForProvider(targetProvider);
  if (!apiKey) {
    return null;
  }

  const model = registry.findCheapest(targetProvider, tier);
  if (!model) return null;

  return { model, apiKey };
}

export function getEnvKey(provider: string): string | undefined {
  return getApiKeyForProvider(provider);
}
