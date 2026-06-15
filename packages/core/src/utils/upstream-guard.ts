/**
 * Upstream URL resolution + key↔host binding guard.
 *
 * ISSUE: cross-provider routing used the builtin official `api.baseUrl`
 * (e.g. api.anthropic.com), ignoring the user's relay `upstreamUrl`. When the
 * user stored a relay key (中转站 key) in keys.json / OPENAI_API_KEY, that key
 * got sent to the official endpoint — triggering provider bans.
 *
 * resolveEffectiveBaseUrl() restores the correct priority:
 *   enterprise > providerUpstreamBaseUrl (relay) > targetApi.baseUrl (official).
 * detectKeyHostConflict() flags the residual mismatch where a relay-configured
 * provider is still routed to an official host.
 *
 * Shared by the two transport twins: packages/proxy/src/server.ts (node:http)
 * and packages/hook/src/fetch-patch.ts (globalThis.fetch).
 */
import { isOfficialHost } from "@agentfare/models";

export { isOfficialHost };

export interface EffectiveBaseUrlInput {
  /** Enterprise policy override (highest priority). */
  enterpriseBaseUrl?: string;
  /** Provider's relay upstream URL (from providerMap), if a relay is configured. */
  providerUpstreamBaseUrl?: string;
  /** Official default from the target ModelEntry's api.baseUrl (lowest priority). */
  targetApiBaseUrl: string;
}

/**
 * Resolve the real upstream base URL for a routed request.
 * Priority: enterprise > provider relay upstream > official default.
 */
export function resolveEffectiveBaseUrl(opts: EffectiveBaseUrlInput): string {
  // Empty strings are treated as unset (a user clearing an override must not
  // collapse the URL to "" → downstream path concatenation crashes). trim()
  // also tolerates accidental whitespace in config files.
  return opts.enterpriseBaseUrl?.trim() || opts.providerUpstreamBaseUrl?.trim() || opts.targetApiBaseUrl;
}

export interface KeyHostConflictInput {
  effectiveBaseUrl: string;
  /** The relay URL configured for this provider (providerMap.upstreamBaseUrl). */
  providerUpstreamBaseUrl?: string;
}

export interface KeyHostConflictResult {
  conflict: boolean;
  reason?: string;
}

/**
 * Detect a credential/host mismatch that risks a provider ban.
 *
 * A provider whose `upstreamUrl` points at a relay holds a *relay* key. If the
 * resolved target host is nonetheless an official endpoint, that relay key is
 * about to be sent to the vendor — a ban risk. Returns conflict=true so the
 * caller can fall back to the original request instead.
 */
export function detectKeyHostConflict(opts: KeyHostConflictInput): KeyHostConflictResult {
  const effectiveOfficial = isOfficialHost(opts.effectiveBaseUrl);
  const relay = opts.providerUpstreamBaseUrl;
  // `undefined` = no relay configured → key is official → no mismatch possible.
  // An explicit non-undefined value (incl. empty/whitespace) = user set an
  // override → treat as a non-official relay so a config error still surfaces
  // as conflict rather than silently routing a relay key to the official host.
  let providerOfficial: boolean;
  if (relay === undefined) {
    providerOfficial = true;
  } else if (relay.trim() === "") {
    providerOfficial = false; // explicit empty override = config error
  } else {
    providerOfficial = isOfficialHost(relay);
  }
  if (!providerOfficial && effectiveOfficial) {
    return {
      conflict: true,
      reason: "relay-configured provider routed to official host (ban risk)",
    };
  }
  return { conflict: false };
}
