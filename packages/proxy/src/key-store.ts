/**
 * API key resolution for the proxy server.
 *
 * Three-tier priority:
 * 1. Keys from the client request (Authorization / x-api-key headers)
 * 2. Environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
 * 3. Config file (~/.agentfare/keys.json) — read via credential-store, which
 *    re-loads on mtime change so CLI writes reach a running daemon.
 */

import { PROVIDER_ENV_KEY_MAP } from "@agentfare/models";
import { loadKeysFromDisk } from "./credential-store.js";

/**
 * Extract API key from request headers.
 *
 * OpenAI-style: Authorization: Bearer sk-...
 * Anthropic-style: x-api-key: sk-...
 */
function extractKeyFromHeaders(headers: Record<string, string>): string | undefined {
  // Check x-api-key first (Anthropic convention)
  const apiKey = headers["x-api-key"];
  if (apiKey) return apiKey;

  // Check Authorization: Bearer ...
  const auth = headers["authorization"];
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }

  return undefined;
}

/**
 * Resolve API key for a given provider using the three-tier strategy.
 *
 * @param provider - Provider name (e.g. "openai", "anthropic")
 * @param requestHeaders - Headers from the incoming request (may contain client's key)
 * @returns The API key, or undefined if none found
 */
export function resolveApiKey(
  provider: string,
  requestHeaders: Record<string, string>,
): string | undefined {
  // Tier 1: Key from client request
  const clientKey = extractKeyFromHeaders(requestHeaders);
  if (clientKey) return clientKey;

  // Tier 2: Environment variable
  const envKey = PROVIDER_ENV_KEY_MAP[provider];
  if (envKey) {
    const envValue = process.env[envKey];
    if (envValue) return envValue;
  }

  // Tier 3: keys.json (mtime-aware cache in credential-store)
  const diskKeys = loadKeysFromDisk();
  return diskKeys[provider];
}

/**
 * Build auth headers for the upstream request.
 */
export function buildAuthHeaders(
  provider: string,
  apiKey: string,
  protocol: "openai" | "anthropic",
): Record<string, string> {
  if (protocol === "anthropic") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "Authorization": `Bearer ${apiKey}`,
  };
}
