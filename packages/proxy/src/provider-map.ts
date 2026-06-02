/**
 * Path-prefix → provider mapping for the proxy server.
 *
 * Each tool configures its BASE_URL to point at the proxy with a path prefix:
 *   ANTHROPIC_BASE_URL=http://localhost:3456/anthropic
 *   OPENAI_BASE_URL=http://localhost:3456/openai
 *
 * The proxy uses the first path segment to determine the source provider and protocol.
 */

import { DEFAULT_CONFIG } from "@agentfare/core";

export interface ProviderInfo {
  /** Provider identifier (e.g. "openai", "anthropic") */
  provider: string;
  /** Request/response protocol this provider uses */
  protocol: "openai" | "anthropic";
  /** Real upstream base URL to forward requests to */
  upstreamBaseUrl: string;
}

/**
 * Mapping from URL path prefix to provider info.
 * Derived from DEFAULT_CONFIG.providers and known protocol info.
 */
const PROVIDER_MAP: Record<string, ProviderInfo> = {
  openai: {
    provider: "openai",
    protocol: "openai",
    upstreamBaseUrl: DEFAULT_CONFIG.providers.openai!.baseUrl,
  },
  anthropic: {
    provider: "anthropic",
    protocol: "anthropic",
    upstreamBaseUrl: DEFAULT_CONFIG.providers.anthropic!.baseUrl,
  },
  deepseek: {
    provider: "deepseek",
    protocol: "openai",
    upstreamBaseUrl: DEFAULT_CONFIG.providers.deepseek!.baseUrl,
  },
  google: {
    provider: "google",
    protocol: "openai",
    upstreamBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  zhipu: {
    provider: "zhipu",
    protocol: "openai",
    upstreamBaseUrl: DEFAULT_CONFIG.providers.zhipu!.baseUrl,
  },
  moonshot: {
    provider: "moonshot",
    protocol: "openai",
    upstreamBaseUrl: DEFAULT_CONFIG.providers.moonshot!.baseUrl,
  },
  alibaba: {
    provider: "alibaba",
    protocol: "openai",
    upstreamBaseUrl: DEFAULT_CONFIG.providers.alibaba!.baseUrl,
  },
  xiaomi: {
    provider: "xiaomi",
    protocol: "openai",
    upstreamBaseUrl: DEFAULT_CONFIG.providers.xiaomi!.baseUrl,
  },
};

/**
 * Resolve provider info from the incoming request path.
 * The first segment of the path is the provider prefix.
 *
 * @example
 *   resolveProvider("/anthropic/v1/messages") → { provider: "anthropic", protocol: "anthropic", upstreamBaseUrl: "..." }
 *   resolveProvider("/openai/v1/chat/completions") → { provider: "openai", protocol: "openai", upstreamBaseUrl: "..." }
 *   resolveProvider("/health") → null
 */
export function resolveProvider(requestPath: string): ProviderInfo | null {
  // Normalize: remove leading slash, get first segment
  const segments = requestPath.replace(/^\//, "").split("/");
  const prefix = segments[0]?.toLowerCase();
  if (!prefix) return null;
  return PROVIDER_MAP[prefix] ?? null;
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
export function getRegisteredProviders(): string[] {
  return Object.keys(PROVIDER_MAP);
}
