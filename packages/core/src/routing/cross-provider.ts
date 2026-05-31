import type { ModelRegistry, ModelEntry, ModelTier } from "@agentdispatch/models";
import type { RoutingConfig } from "../config/types.js";

const ENV_KEY_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  alibaba: "ALIBABA_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  google: "GOOGLE_API_KEY",
};

export function tryCrossProviderOptIn(
  registry: ModelRegistry,
  targetProvider: string,
  tier: ModelTier,
  routing: RoutingConfig,
): { model: ModelEntry; apiKey: string } | null {
  if (!routing.crossProviderProviders.includes(targetProvider)) {
    return null;
  }

  const envKey = ENV_KEY_MAP[targetProvider];
  const apiKey = envKey ? process.env[envKey] : undefined;
  if (!apiKey) {
    return null;
  }

  const model = registry.findCheapest(targetProvider, tier);
  if (!model) return null;

  return { model, apiKey };
}

export function getEnvKey(provider: string): string | undefined {
  const envKey = ENV_KEY_MAP[provider];
  return envKey ? process.env[envKey] : undefined;
}
