/**
 * Path-prefix → provider mapping for the proxy server.
 *
 * Each tool configures its BASE_URL to point at the proxy with a path prefix:
 *   ANTHROPIC_BASE_URL=http://localhost:3456/anthropic
 *   OPENAI_BASE_URL=http://localhost:3456/openai
 *
 * The proxy uses the first path segment to determine the source provider and protocol.
 *
 * ISSUE-106/088: Now dynamically built from config, supporting user-defined upstream URLs.
 */

import type { AgentFareConfig } from "@agentfare/core";
import { DEFAULT_CONFIG } from "@agentfare/core";

export interface ProviderInfo {
  /** Provider identifier (e.g. "openai", "anthropic") */
  provider: string;
  /** Request/response protocol this provider uses */
  protocol: "openai" | "anthropic";
  /** Real upstream base URL to forward requests to */
  upstreamBaseUrl: string;
}

/** Known protocol for each provider. Used when building the provider map. */
const KNOWN_PROTOCOLS: Record<string, "openai" | "anthropic"> = {
  openai: "openai",
  anthropic: "anthropic",
  deepseek: "openai",
  google: "openai",
  zhipu: "openai",
  moonshot: "openai",
  alibaba: "openai",
  xiaomi: "openai",
};

/** Extra providers not in DEFAULT_CONFIG.providers but needed by the proxy. */
const EXTRA_PROVIDERS: Record<string, { baseUrl: string; protocol: "openai" | "anthropic" }> = {
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    protocol: "openai",
  },
};

/**
 * Build a provider map from the given config.
 *
 * For each provider in config.providers:
 * - Uses `upstreamUrl` if set (captured from user's env vars during init),
 *   otherwise falls back to `baseUrl`.
 * - Protocol is determined from KNOWN_PROTOCOLS, falling back to "openai".
 *
 * Also includes any EXTRA_PROVIDERS not in config.
 */
export function buildProviderMap(config: AgentFareConfig): Record<string, ProviderInfo> {
  const map: Record<string, ProviderInfo> = {};

  // Build from config.providers
  for (const [name, providerConfig] of Object.entries(config.providers)) {
    const upstreamUrl = providerConfig.upstreamUrl ?? providerConfig.baseUrl;
    const protocol = KNOWN_PROTOCOLS[name] ?? "openai";
    map[name] = {
      provider: name,
      protocol,
      upstreamBaseUrl: upstreamUrl,
    };
  }

  // Add extra providers not covered by config
  for (const [name, extra] of Object.entries(EXTRA_PROVIDERS)) {
    if (!map[name]) {
      map[name] = {
        provider: name,
        protocol: extra.protocol,
        upstreamBaseUrl: extra.baseUrl,
      };
    }
  }

  return map;
}

/** Default provider map built from DEFAULT_CONFIG. Used for backward compatibility. */
const DEFAULT_PROVIDER_MAP = buildProviderMap(DEFAULT_CONFIG);

/**
 * Resolve provider info from the incoming request path.
 * The first segment of the path is the provider prefix.
 *
 * @example
 *   resolveProvider("/anthropic/v1/messages") → { provider: "anthropic", protocol: "anthropic", upstreamBaseUrl: "..." }
 *   resolveProvider("/openai/v1/chat/completions") → { provider: "openai", protocol: "openai", upstreamBaseUrl: "..." }
 *   resolveProvider("/health") → null
 */
export function resolveProvider(
  requestPath: string,
  providerMap?: Record<string, ProviderInfo>
): ProviderInfo | null {
  const map = providerMap ?? DEFAULT_PROVIDER_MAP;
  // Normalize: remove leading slash, get first segment
  const segments = requestPath.replace(/^\//, "").split("/");
  const prefix = segments[0]?.toLowerCase();
  if (!prefix) return null;
  return map[prefix] ?? null;
}

/**
 * Get the upstream path by stripping the provider prefix from the request path.
 *
 * @example
 *   getUpstreamPath("/anthropic/v1/messages") → "/v1/messages"
 *   getUpstreamPath("/openai/v1/chat/completions") → "/v1/chat/completions"
 */
export function getUpstreamPath(requestPath: string): string {
  const normalized = requestPath.replace(/^\//, "");
  const slashIndex = normalized.indexOf("/");
  if (slashIndex === -1) return "/";
  return normalized.slice(slashIndex);
}

/**
 * Construct the virtual "original URL" that the RequestHandler expects.
 * This mimics the URL the client would have called without the proxy.
 */
export function buildVirtualUrl(providerInfo: ProviderInfo, upstreamPath: string): string {
  return `${providerInfo.upstreamBaseUrl}${upstreamPath}`;
}

/**
 * Get all registered provider prefixes (for health/debug).
 */
export function getRegisteredProviders(providerMap?: Record<string, ProviderInfo>): string[] {
  return Object.keys(providerMap ?? DEFAULT_PROVIDER_MAP);
}
