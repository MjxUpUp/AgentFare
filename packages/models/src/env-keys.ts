/**
 * Shared provider → environment variable mapping.
 * Single source of truth for all provider API key lookups.
 */

export const PROVIDER_ENV_KEY_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  google: "GOOGLE_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  alibaba: "ALIBABA_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
};

/** Returns the API key value from environment for the given provider. */
export function getApiKeyForProvider(provider: string): string | undefined {
  const envKey = PROVIDER_ENV_KEY_MAP[provider];
  return envKey ? process.env[envKey] : undefined;
}
