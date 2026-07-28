/**
 * API key resolution for the proxy server.
 *
 * Three-tier priority:
 * 1. Keys from the client request (Authorization / x-api-key headers)
 * 2. Environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
 * 3. Config file (~/.agentfare/keys.json) — read via credential-store, which
 *    re-loads on mtime change so CLI writes reach a running daemon.
 */

import { PROVIDER_ENV_KEY_MAP, type AuthScheme } from "@agentfare/models";
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

  // Check Authorization: Bearer ... (scheme is case-insensitive per RFC 7235,
  // so accept "bearer"/"BEARER"/etc.; the credential itself is case-sensitive).
  const auth = headers["authorization"];
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
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
 * Build auth headers for the upstream request, keyed by auth scheme rather than
 * protocol — because a single protocol can use different schemes across vendors
 * (e.g. DeepSeek's Anthropic endpoint takes x-api-key, Kimi's takes Bearer).
 *
 * Callers pass `resolveAuthScheme(endpoint)` so unset schemes derive from protocol.
 */
export function buildAuthHeaders(
  provider: string,
  apiKey: string,
  authScheme: AuthScheme,
): Record<string, string> {
  switch (authScheme) {
    case "x-api-key":
      return {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
    case "bearer":
      return {
        "Authorization": `Bearer ${apiKey}`,
      };
    case "sigv4":
      // Bedrock SigV4 signing is not yet wired (requires AWS SDK + IAM creds).
      // Throw loudly rather than silently sending an unsigned request.
      throw new Error(`SigV4 auth for provider "${provider}" is not implemented (Bedrock)`);
    case "oauth":
      throw new Error(`OAuth auth for provider "${provider}" is not implemented (Vertex)`);
  }
}
