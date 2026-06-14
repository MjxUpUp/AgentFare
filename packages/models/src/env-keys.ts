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

/**
 * Official vendor API hosts per provider — single source of truth.
 *
 * These are the vendor defaults and are DISTINCT from the user-configurable
 * `providers[].baseUrl` / `upstreamUrl` in config, which may point at a relay
 * (中转站). Used by upstream-guard to detect when a relay key would be routed
 * to an official endpoint — a provider ban risk.
 *
 * Keep in sync with the `baseUrl` values in packages/core/src/config/defaults.ts.
 */
export const PROVIDER_OFFICIAL_HOSTS: Record<string, string[]> = {
  openai: ["api.openai.com"],
  anthropic: ["api.anthropic.com"],
  deepseek: ["api.deepseek.com"],
  zhipu: ["open.bigmodel.cn"],
  moonshot: ["api.moonshot.cn"],
  alibaba: ["dashscope.aliyuncs.com"],
  xiaomi: ["platform.xiaomimimo.com"],
  google: ["generativelanguage.googleapis.com"],
};

/**
 * True if `url` points at a provider's official endpoint (not a relay).
 * Accepts either a full URL or a bare hostname.
 */
export function isOfficialHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // Not a parseable URL — treat the raw string as a hostname.
    host = url.replace(/^[./]+/, "").split("/")[0];
  }
  for (const hosts of Object.values(PROVIDER_OFFICIAL_HOSTS)) {
    if (hosts.includes(host)) return true;
  }
  return false;
}
