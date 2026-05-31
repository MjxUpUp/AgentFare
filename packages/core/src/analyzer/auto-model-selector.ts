import type { ModelRegistry, ModelEntry } from "@agentdispatch/models";

const ENV_KEY_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GOOGLE_API_KEY",
};

export function selectAnalyzerModel(registry: ModelRegistry): ModelEntry | null {
  const fastModels = registry.getByTier("fast");

  const withKey = fastModels.filter((m) => {
    const envKey = ENV_KEY_MAP[m.provider];
    return envKey ? !!process.env[envKey] : false;
  });

  if (withKey.length > 0) {
    return withKey.reduce((cheapest, m) =>
      m.pricing.outputPerMillion < cheapest.pricing.outputPerMillion ? m : cheapest
    );
  }

  return null;
}
