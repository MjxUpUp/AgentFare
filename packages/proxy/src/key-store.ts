/**
 * API key resolution for the proxy server.
 *
 * Three-tier priority:
 * 1. Keys from the client request (Authorization / x-api-key headers)
 * 2. Environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
 * 3. Config file (~/.agentfare/keys.json)
 */

import { PROVIDER_ENV_KEY_MAP } from "@agentfare/models";
import { getBaseDir } from "@agentfare/models";
import * as fs from "node:fs";
import * as path from "node:path";

/** Cached keys loaded from disk. */
let cachedKeys: Record<string, string> | null = null;

/**
 * Load keys from ~/.agentfare/keys.json.
 * Results are cached for the process lifetime.
 */
function loadKeysFromDisk(): Record<string, string> {
  if (cachedKeys !== null) return cachedKeys;
  try {
    const keysPath = path.join(getBaseDir(), "keys.json");
    if (fs.existsSync(keysPath)) {
      const raw = fs.readFileSync(keysPath, "utf-8");
      cachedKeys = JSON.parse(raw);
      return cachedKeys!;
    }
  } catch {
    // Ignore parse errors — fall back to empty
  }
  cachedKeys = {};
  return cachedKeys;
}

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

  // Tier 3: Config file
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
