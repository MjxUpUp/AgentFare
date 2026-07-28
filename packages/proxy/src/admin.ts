/**
 * @agentfare/proxy — Admin API (loopback-only).
 *
 * Read-only JSON endpoints the GUI (and any local tooling) use to inspect cost
 * data, logs, the model registry and the provider map. They reuse the same
 * library-level APIs the CLI uses (TrackingDatabase / ModelRegistry), so there
 * is no second source of truth — the daemon just exposes what it already has
 * in memory over HTTP.
 *
 * Security: these endpoints carry no auth of their own; the HTTP layer in
 * server.ts gates them on a loopback remote address as defense-in-depth. Do
 * not add write/mutation endpoints here without a token scheme.
 */

import type { TrackingDatabase } from "@agentfare/core";
import type { ModelRegistry } from "@agentfare/models";
import type { ProviderInfo } from "./provider-map.js";

export interface AdminDeps {
  db?: TrackingDatabase;
  registry?: ModelRegistry;
  providerMap?: Record<string, ProviderInfo>;
}

export interface AdminResponse {
  status: number;
  body: unknown;
}

const RANGE_RE = /^(\d+)([dhm])$/;
const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 1000;

/**
 * Parse a time range (e.g. "7d", "24h", "30m"). Invalid input is ignored
 * (treated as "all-time") rather than rejected — the GUI may forward
 * user-typed values, and the read path fails soft.
 */
function parseRange(range: string | undefined): string | undefined {
  if (!range) return undefined;
  return RANGE_RE.test(range) ? range : undefined;
}

function parseLimit(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LOG_LIMIT;
  return Math.min(n, MAX_LOG_LIMIT);
}

/**
 * Whether a request's remote address is loopback (127.0.0.0/8 or ::1, incl.
 * IPv4-mapped ::ffff:127.x.x.x). Admin endpoints are loopback-only.
 */
export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  if (addr === "::1") return true;
  if (addr.startsWith("::ffff:")) {
    const v4 = addr.slice(7);
    return v4.startsWith("127.");
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

/**
 * Dispatch a /api/* admin request. Returns null when the path is not under
 * /api, so the caller can fall through to normal proxy routing.
 */
export function handleAdminRequest(
  method: string,
  pathname: string,
  query: Record<string, string | undefined>,
  deps: AdminDeps,
): AdminResponse | null {
  if (!pathname.startsWith("/api")) return null;
  if (method !== "GET") return { status: 405, body: { error: "method_not_allowed" } };

  switch (pathname) {
    case "/api/cost": {
      if (!deps.db) return { status: 503, body: { error: "db_unavailable" } };
      const range = parseRange(query.range);
      return {
        status: 200,
        body: {
          summary: deps.db.getCostSummary(range),
          byStep: deps.db.getStepSummary(range),
          byTool: deps.db.getToolSummary(range),
        },
      };
    }
    case "/api/logs": {
      if (!deps.db) return { status: 503, body: { error: "db_unavailable" } };
      const limit = parseLimit(query.limit);
      const logs = deps.db.queryLogs({}, limit);
      return { status: 200, body: { logs } };
    }
    case "/api/models": {
      if (!deps.registry) return { status: 503, body: { error: "registry_unavailable" } };
      const models = deps.registry.getAll().map((m) => ({
        id: m.id,
        provider: m.provider,
        tier: m.tier,
        pricing: {
          inputPerMillion: m.pricing.inputPerMillion,
          outputPerMillion: m.pricing.outputPerMillion,
        },
      }));
      return { status: 200, body: { models } };
    }
    case "/api/scores": {
      if (!deps.db) return { status: 503, body: { error: "db_unavailable" } };
      return { status: 200, body: { scores: deps.db.loadAllModelScores() } };
    }
    case "/api/providers": {
      return { status: 200, body: { providers: deps.providerMap ?? {} } };
    }
    default:
      // Don't echo the raw pathname back — the GUI may render this string and
      // an attacker controlling the URL (e.g. via a crafted link) could inject
      // markup. The error code alone is enough for the client to branch on.
      return { status: 404, body: { error: "unknown_admin_endpoint" } };
  }
}
