import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TrackingDatabase, type RoutingLogEntry } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import { handleAdminRequest, isLoopback, type AdminDeps, type AdminResponse } from "../src/admin.js";
import { createProxyServer } from "../src/server.js";

// ── helpers ──────────────────────────────────────────────────────────────

function tmpDbPath(): string {
  // unique per test run; Date.now/random are fine in vitest (real node process)
  const tag = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return path.join(os.tmpdir(), `af-admin-${tag}.db`);
}

function cleanupDbFiles(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { fs.unlinkSync(f); } catch {}
  }
}

/**
 * Convenience wrappers for the 6-arg handleAdminRequest signature (the headers
 * and body params were added with the cc-switch POST /api/active write
 * endpoint). GET admin calls carry empty headers/body; POST serializes a JSON
 * body. Keeps call sites readable without obscuring which arguments flow in.
 */
function adminGet(
  pathname: string,
  deps: AdminDeps,
  query: Record<string, string | undefined> = {},
  headers: Record<string, string | undefined> = {},
): AdminResponse | null {
  return handleAdminRequest("GET", pathname, query, headers, undefined, deps);
}

function adminPost(
  pathname: string,
  deps: AdminDeps,
  body: unknown = {},
  headers: Record<string, string | undefined> = {},
): AdminResponse | null {
  return handleAdminRequest("POST", pathname, {}, headers, JSON.stringify(body), deps);
}

/**
 * First non-internal IPv4 of the host, or undefined in a pure-loopback sandbox.
 * Used to construct a real non-loopback peer for the 403 HTTP test —
 * socket.remoteAddress is set by the kernel and can't be faked from userspace,
 * so the guard's HTTP-level path is only exercisable when the host actually
 * has a LAN address to connect from.
 */
function pickLanIp(): string | undefined {
  for (const list of Object.values(os.networkInterfaces())) {
    if (!list) continue;
    for (const ni of list) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return undefined;
}

function sampleEntry(i: number): RoutingLogEntry {
  return {
    sessionId: "sess-test",
    tool: "claude-code",
    stepType: "coding",
    originalModel: "gpt-4o",
    routedModel: "deepseek-chat",
    difficulty: 0.3,
    confidence: 0.9,
    reasoning: "low difficulty, route to cheaper model",
    inputTokens: 1000,
    outputTokens: 200,
    originalCost: 0.0045,
    actualCost: 0.0006,
    savings: 0.0039,
  };
}

// ── pure function: routing logic ─────────────────────────────────────────

describe("handleAdminRequest — routing", () => {
  const db = new TrackingDatabase(tmpDbPath());
  const registry = new ModelRegistry();
  const deps: AdminDeps = { db, registry, providerMap: { openai: { provider: "openai", protocol: "openai", upstreamBaseUrl: "https://api.openai.com" } } };

  afterAll(() => db.close());

  it("returns null for non-/api/ paths (lets the proxy keep handling them)", () => {
    expect(adminGet("/health", deps)).toBeNull();
    expect(adminGet("/openai/v1/chat/completions", deps)).toBeNull();
  });

  it("rejects non-GET methods on /api/* with 405", () => {
    const r = adminPost("/api/cost", deps);
    expect(r?.status).toBe(405);
    expect(r?.body).toEqual({ error: "method_not_allowed" });
  });

  it("returns 404 for unknown /api/ endpoint", () => {
    const r = adminGet("/api/unknown", deps);
    expect(r?.status).toBe(404);
  });

  it("/api/cost returns summary + byStep + byTool aggregates", () => {
    const r = adminGet("/api/cost", deps);
    expect(r?.status).toBe(200);
    const body = r!.body as any;
    expect(body).toHaveProperty("summary");
    expect(body).toHaveProperty("byStep");
    expect(body).toHaveProperty("byTool");
    expect(body.summary).toHaveProperty("totalRequests");
    expect(body.summary).toHaveProperty("totalActualCost");
    expect(body.summary).toHaveProperty("totalSavings");
  });

  it("/api/logs returns an array of recent logs", () => {
    const r = adminGet("/api/logs", deps);
    expect(r?.status).toBe(200);
    expect(Array.isArray((r!.body as any).logs)).toBe(true);
  });

  it("/api/models returns registry entries with pricing", () => {
    const r = adminGet("/api/models", deps);
    expect(r?.status).toBe(200);
    const models = (r!.body as any).models as any[];
    expect(Array.isArray(models)).toBe(true);
    if (models.length > 0) {
      expect(models[0]).toHaveProperty("id");
      expect(models[0]).toHaveProperty("pricing");
    }
  });

  it("/api/scores returns model score rows", () => {
    const r = adminGet("/api/scores", deps);
    expect(r?.status).toBe(200);
    expect(Array.isArray((r!.body as any).scores)).toBe(true);
  });

  it("/api/providers returns the provider map", () => {
    const r = adminGet("/api/providers", deps);
    expect(r?.status).toBe(200);
    expect((r!.body as any).providers).toHaveProperty("openai");
  });

  it("returns 503 when db is required but absent", () => {
    const noDb: AdminDeps = { registry };
    expect(adminGet("/api/cost", noDb)?.status).toBe(503);
    expect(adminGet("/api/logs", noDb)?.status).toBe(503);
    expect(adminGet("/api/scores", noDb)?.status).toBe(503);
  });

  it("accepts a valid time range (7d) without throwing", () => {
    const r = adminGet("/api/cost", deps, { range: "7d" });
    expect(r?.status).toBe(200);
  });

  it("ignores an invalid time range (falls back to all-time, not 400)", () => {
    // invalid range must not crash the endpoint; treat as no filter
    const r = adminGet("/api/cost", deps, { range: "not-a-range" });
    expect(r?.status).toBe(200);
  });
});

// ── pure function: loopback guard ────────────────────────────────────────

describe("isLoopback", () => {
  it("accepts IPv4 loopback", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("127.0.0.42")).toBe(true); // whole 127.0.0.0/8 is loopback
  });
  it("accepts IPv6 loopback", () => {
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
  });
  it("rejects non-loopback addresses", () => {
    expect(isLoopback("192.168.1.5")).toBe(false);
    expect(isLoopback("10.0.0.1")).toBe(false);
    expect(isLoopback("8.8.8.8")).toBe(false);
    // IPv4-mapped non-loopback must NOT pass just because it carries ::ffff:
    expect(isLoopback("::ffff:192.168.1.5")).toBe(false);
    expect(isLoopback("::ffff:8.8.8.8")).toBe(false);
  });
  it("handles undefined", () => {
    expect(isLoopback(undefined)).toBe(false);
  });
});

// ── pure function: active lock + admin token (cc-switch) ─────────────────

describe("handleAdminRequest — active lock + admin token (cc-switch)", () => {
  const registry = new ModelRegistry();
  const baseDeps: AdminDeps = {
    registry,
    providerMap: { openai: { provider: "openai", protocol: "openai", upstreamBaseUrl: "https://api.openai.com" } },
    adminToken: "secret-token-xyz",
  };

  // GET /api/active — reads the current routing lock
  it("GET /api/active defaults to lockMode=auto when getRouting is absent", () => {
    const r = adminGet("/api/active", baseDeps);
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ lockMode: "auto", activeModel: null, activeProvider: null });
  });

  it("GET /api/active reflects the current routing lock", () => {
    const deps: AdminDeps = {
      ...baseDeps,
      getRouting: () => ({ lockMode: "model", activeModel: "deepseek/v4-pro" } as any),
    };
    const r = adminGet("/api/active", deps);
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ lockMode: "model", activeModel: "deepseek/v4-pro", activeProvider: null });
  });

  it("GET /api/active reflects lockMode=provider", () => {
    const deps: AdminDeps = {
      ...baseDeps,
      getRouting: () => ({ lockMode: "provider", activeProvider: "anthropic" } as any),
    };
    const r = adminGet("/api/active", deps);
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ lockMode: "provider", activeModel: null, activeProvider: "anthropic" });
  });

  // GET /api/admin-token — bootstraps the GUI's first write
  it("GET /api/admin-token returns the configured token", () => {
    const r = adminGet("/api/admin-token", baseDeps);
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ token: "secret-token-xyz" });
  });

  it("GET /api/admin-token returns null when no token configured", () => {
    const r = adminGet("/api/admin-token", { ...baseDeps, adminToken: undefined });
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ token: null });
  });

  // ── Origin gate (C1: ACAO:* + GET /api/admin-token let any same-machine
  // website steal the token and re-route all LLM traffic). A web page visited
  // in a browser has a loopback source IP, so isLoopback can't stop it; but
  // browsers always send Origin on cross-site fetches, so the token endpoint
  // and the write endpoint require Origin to be absent (curl/SDK — already
  // gated by loopback + token) or on the allowlist (Tauri webview / vite dev).
  it("GET /api/admin-token with a non-allowlisted Origin → 403 forbidden_origin (no token leak to web pages)", () => {
    const r = adminGet("/api/admin-token", baseDeps, {}, { origin: "https://evil.com" });
    expect(r?.status).toBe(403);
    expect(r?.body).toEqual({ error: "forbidden_origin" });
  });

  it("GET /api/admin-token with allowlisted Origin → returns the token", () => {
    const r = adminGet("/api/admin-token", baseDeps, {}, { origin: "http://localhost:5173" });
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ token: "secret-token-xyz" });
  });

  it("GET /api/admin-token with no Origin (curl/SDK) → still returns the token", () => {
    const r = adminGet("/api/admin-token", baseDeps);
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ token: "secret-token-xyz" });
  });

  it("POST /api/active with a non-allowlisted Origin → 403 before the token is checked", () => {
    const r = adminPost(
      "/api/active", baseDeps,
      { lockMode: "model", activeModel: "x" },
      { origin: "https://evil.com", "x-agentfare-admin-token": "secret-token-xyz" },
    );
    expect(r?.status).toBe(403);
    expect(r?.body).toEqual({ error: "forbidden_origin" });
  });

  it("POST /api/active with allowlisted Origin + valid token → 200", () => {
    const r = adminPost(
      "/api/active", { ...baseDeps, applyLock: () => ({ ok: true }) },
      { lockMode: "model", activeModel: "gpt-4o" },
      { origin: "tauri://localhost", "x-agentfare-admin-token": "secret-token-xyz" },
    );
    expect(r?.status).toBe(200);
  });

  // M2: adminTokenOk hashes both sides to equal length before timingSafeEqual,
  // so a length mismatch no longer short-circuits (would leak len(token) as an
  // oracle if tokens were ever variable-length). Behavior stays: wrong token → 401.
  it("POST /api/active with a different-length wrong token → 401 (hash compare, no length oracle)", () => {
    const r = adminPost(
      "/api/active", baseDeps,
      { lockMode: "model", activeModel: "x" },
      { "x-agentfare-admin-token": "short" },
    );
    expect(r?.status).toBe(401);
    expect(r?.body).toEqual({ error: "invalid_admin_token" });
  });

  // POST /api/active — token gate
  it("POST /api/active with no adminToken configured → 501 admin_disabled", () => {
    const r = adminPost(
      "/api/active",
      { ...baseDeps, adminToken: undefined },
      { lockMode: "model", activeModel: "deepseek/v4-pro" },
    );
    expect(r?.status).toBe(501);
    expect(r?.body).toEqual({ error: "admin_disabled" });
  });

  it("POST /api/active without a token header → 401 invalid_admin_token", () => {
    const r = adminPost("/api/active", baseDeps, { lockMode: "model", activeModel: "x" });
    expect(r?.status).toBe(401);
    expect(r?.body).toEqual({ error: "invalid_admin_token" });
  });

  it("POST /api/active with the wrong token → 401 invalid_admin_token", () => {
    const r = adminPost(
      "/api/active",
      baseDeps,
      { lockMode: "model", activeModel: "x" },
      { "x-agentfare-admin-token": "wrong-token" },
    );
    expect(r?.status).toBe(401);
    expect(r?.body).toEqual({ error: "invalid_admin_token" });
  });

  it("POST /api/active token-gated but applyLock missing → 503 reload_unavailable", () => {
    // baseDeps has the token but no applyLock wired (e.g. foreground startProxy)
    const r = adminPost(
      "/api/active",
      baseDeps,
      { lockMode: "model", activeModel: "x" },
      { "x-agentfare-admin-token": "secret-token-xyz" },
    );
    expect(r?.status).toBe(503);
    expect(r?.body).toEqual({ error: "reload_unavailable" });
  });

  // POST /api/active — payload validation (token always checked first)
  it("POST /api/active with invalid JSON body → 400 invalid_json", () => {
    const deps: AdminDeps = { ...baseDeps, applyLock: () => ({ ok: true }) };
    const r = handleAdminRequest(
      "POST", "/api/active", {},
      { "x-agentfare-admin-token": "secret-token-xyz" },
      "{not valid json",
      deps,
    );
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "invalid_json" });
  });

  it("POST /api/active with invalid lockMode → 400 invalid_lock_mode (+ valid list)", () => {
    const deps: AdminDeps = { ...baseDeps, applyLock: () => ({ ok: true }) };
    const r = adminPost("/api/active", deps, { lockMode: "bogus" }, { "x-agentfare-admin-token": "secret-token-xyz" });
    expect(r?.status).toBe(400);
    expect((r?.body as any).error).toBe("invalid_lock_mode");
    expect((r?.body as any).valid).toEqual(["auto", "model", "provider"]);
  });

  it("POST /api/active lockMode=model without activeModel → 400 active_model_required", () => {
    const deps: AdminDeps = { ...baseDeps, applyLock: () => ({ ok: true }) };
    const r = adminPost("/api/active", deps, { lockMode: "model" }, { "x-agentfare-admin-token": "secret-token-xyz" });
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "active_model_required" });
  });

  it("POST /api/active lockMode=provider without activeProvider → 400 active_provider_required", () => {
    const deps: AdminDeps = { ...baseDeps, applyLock: () => ({ ok: true }) };
    const r = adminPost("/api/active", deps, { lockMode: "provider" }, { "x-agentfare-admin-token": "secret-token-xyz" });
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "active_provider_required" });
  });

  // POST /api/active — success paths
  it("POST /api/active valid model lock applies the lock and returns 200", () => {
    let applied: any = null;
    const deps: AdminDeps = {
      ...baseDeps,
      applyLock: (lock) => { applied = lock; return { ok: true }; },
    };
    const r = adminPost(
      "/api/active",
      deps,
      { lockMode: "model", activeModel: "deepseek/v4-pro" },
      { "x-agentfare-admin-token": "secret-token-xyz" },
    );
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ ok: true, lockMode: "model", activeModel: "deepseek/v4-pro", activeProvider: null });
    // applyLock received exactly the parsed lock (activeProvider absent → undefined)
    expect(applied).toEqual({ lockMode: "model", activeModel: "deepseek/v4-pro", activeProvider: undefined });
  });

  it("POST /api/active lockMode=auto unlocks (clears lock) and returns 200", () => {
    let applied: any = null;
    const deps: AdminDeps = {
      ...baseDeps,
      applyLock: (lock) => { applied = lock; return { ok: true }; },
    };
    const r = adminPost("/api/active", deps, { lockMode: "auto" }, { "x-agentfare-admin-token": "secret-token-xyz" });
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ ok: true, lockMode: "auto", activeModel: null, activeProvider: null });
    expect(applied).toEqual({ lockMode: "auto", activeModel: undefined, activeProvider: undefined });
  });

  it("POST /api/active when applyLock reports failure → 400 with daemon error", () => {
    const deps: AdminDeps = {
      ...baseDeps,
      applyLock: () => ({ ok: false, error: "config_write_failed" }),
    };
    const r = adminPost(
      "/api/active",
      deps,
      { lockMode: "model", activeModel: "deepseek/v4-pro" },
      { "x-agentfare-admin-token": "secret-token-xyz" },
    );
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "config_write_failed" });
  });
});

// GUI 一等公民 A2/A3：keys/providers 写端点。与 POST /api/active 同模式（origin
// 门控 → token → handler → 校验 → apply），让纯 GUI 用户无需 CLI 即可填 key、
// 配 provider（含中转站 baseUrl）。错误响应不回显用户输入（admin.ts 契约）。
describe("handleAdminRequest — keys/providers write endpoints (GUI 一等公民 A2/A3)", () => {
  const registry = new ModelRegistry();
  const baseDeps: AdminDeps = {
    registry,
    providerMap: {},
    adminToken: "secret-token-xyz",
  };
  const tok = { "x-agentfare-admin-token": "secret-token-xyz" };

  // ── POST /api/keys ──
  it("POST /api/keys evil origin → 403 (origin gate before token)", () => {
    const r = adminPost("/api/keys", { ...baseDeps, saveKeys: () => {} }, { openai: "sk-x" }, { origin: "https://evil.com", ...tok });
    expect(r?.status).toBe(403);
    expect(r?.body).toEqual({ error: "forbidden_origin" });
  });

  it("POST /api/keys no adminToken → 501 admin_disabled", () => {
    const r = adminPost("/api/keys", { ...baseDeps, adminToken: undefined }, { openai: "sk-x" }, tok);
    expect(r?.status).toBe(501);
    expect(r?.body).toEqual({ error: "admin_disabled" });
  });

  it("POST /api/keys wrong token → 401 invalid_admin_token", () => {
    const r = adminPost("/api/keys", { ...baseDeps, saveKeys: () => {} }, { openai: "sk-x" }, { "x-agentfare-admin-token": "wrong" });
    expect(r?.status).toBe(401);
    expect(r?.body).toEqual({ error: "invalid_admin_token" });
  });

  it("POST /api/keys saveKeys missing → 503 key_store_unavailable", () => {
    const r = adminPost("/api/keys", baseDeps, { openai: "sk-x" }, tok);
    expect(r?.status).toBe(503);
    expect(r?.body).toEqual({ error: "key_store_unavailable" });
  });

  it("POST /api/keys array body → 400 invalid_keys_shape", () => {
    const r = adminPost("/api/keys", { ...baseDeps, saveKeys: () => {} }, ["sk-x"], tok);
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "invalid_keys_shape" });
  });

  it("POST /api/keys empty value → 400 invalid_key_entry", () => {
    const r = adminPost("/api/keys", { ...baseDeps, saveKeys: () => {} }, { openai: "" }, tok);
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "invalid_key_entry" });
  });

  it("POST /api/keys empty object → 400 no_keys_provided", () => {
    const r = adminPost("/api/keys", { ...baseDeps, saveKeys: () => {} }, {}, tok);
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "no_keys_provided" });
  });

  it("POST /api/keys valid → 200, calls saveKeys, echoes provider names only (no key value)", () => {
    const saved: Record<string, string>[] = [];
    const r = adminPost(
      "/api/keys",
      { ...baseDeps, saveKeys: (u) => { saved.push(u); } },
      { openai: "sk-x", deepseek: "sk-y" },
      tok,
    );
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ ok: true, providers: ["openai", "deepseek"] });
    expect(saved).toEqual([{ openai: "sk-x", deepseek: "sk-y" }]);
    // 响应绝不回显 key 值（admin.ts 契约：不泄露凭据）
    expect(JSON.stringify(r?.body)).not.toContain("sk-x");
  });

  // ── POST /api/providers ──
  it("POST /api/providers evil origin → 403", () => {
    const r = adminPost("/api/providers", { ...baseDeps, applyProviders: () => ({ ok: true }) }, { openai: { baseUrl: "https://relay.example.com" } }, { origin: "https://evil.com", ...tok });
    expect(r?.status).toBe(403);
  });

  it("POST /api/providers applyProviders missing → 503 reload_unavailable", () => {
    const r = adminPost("/api/providers", baseDeps, { openai: { baseUrl: "https://relay.example.com" } }, tok);
    expect(r?.status).toBe(503);
    expect(r?.body).toEqual({ error: "reload_unavailable" });
  });

  it("POST /api/providers missing baseUrl → 400 base_url_required", () => {
    const r = adminPost("/api/providers", { ...baseDeps, applyProviders: () => ({ ok: true }) }, { openai: {} }, tok);
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "base_url_required" });
  });

  it("POST /api/providers non-http baseUrl → 400 invalid_base_url", () => {
    // baseUrl URL 形态校验（防 GUI 用户拼错 / file:// 等静默落盘触发隐蔽路由失败）
    const r = adminPost("/api/providers", { ...baseDeps, applyProviders: () => ({ ok: true }) }, { openai: { baseUrl: "file:///etc/passwd" } }, tok);
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "invalid_base_url" });
  });

  it("POST /api/providers malformed baseUrl → 400 invalid_base_url", () => {
    const r = adminPost("/api/providers", { ...baseDeps, applyProviders: () => ({ ok: true }) }, { openai: { baseUrl: "not-a-url" } }, tok);
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "invalid_base_url" });
  });

  it("POST /api/providers invalid upstreamUrl → 400 invalid_upstream_url", () => {
    const r = adminPost("/api/providers", { ...baseDeps, applyProviders: () => ({ ok: true }) }, { openai: { baseUrl: "https://relay.example.com", upstreamUrl: "javascript:alert(1)" } }, tok);
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "invalid_upstream_url" });
  });

  it("POST /api/providers valid → 200, calls applyProviders with normalized config", () => {
    const applied: Record<string, unknown>[] = [];
    const r = adminPost(
      "/api/providers",
      { ...baseDeps, applyProviders: (u) => { applied.push(u); return { ok: true }; } },
      { openai: { baseUrl: "https://relay.example.com", upstreamUrl: "https://api.openai.com" } },
      tok,
    );
    expect(r?.status).toBe(200);
    expect(r?.body).toEqual({ ok: true, providers: ["openai"] });
    expect(applied).toEqual([{ openai: { baseUrl: "https://relay.example.com", upstreamUrl: "https://api.openai.com" } }]);
  });

  it("POST /api/providers applyProviders reports failure → 400 with daemon error", () => {
    const r = adminPost(
      "/api/providers",
      { ...baseDeps, applyProviders: () => ({ ok: false, error: "config_corrupt" }) },
      { openai: { baseUrl: "https://relay.example.com" } },
      tok,
    );
    expect(r?.status).toBe(400);
    expect(r?.body).toEqual({ error: "config_corrupt" });
  });
});

// ── HTTP integration: real server + fetch ────────────────────────────────

describe("admin HTTP endpoints (end-to-end)", () => {
  let db: TrackingDatabase;
  let dbFile: string;
  let server: http.Server;
  let baseUrl: string;
  const deps: AdminDeps = {};

  beforeEach(async () => {
    dbFile = tmpDbPath();
    db = new TrackingDatabase(dbFile);
    // seed two routing logs so cost/logs endpoints have real data
    db.insertRoutingLog(sampleEntry(1));
    db.insertRoutingLog(sampleEntry(2));
    deps.db = db;
    deps.registry = new ModelRegistry();
    deps.providerMap = { openai: { provider: "openai", protocol: "openai", upstreamBaseUrl: "https://api.openai.com" } };

    server = createProxyServer({
      port: 0,
      // handler is required by the type but never reached for /api/* requests
      deps: { ...deps, handler: { handle: async () => null } } as any,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address() as http.AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    try { db.close(); } catch {}
    cleanupDbFiles(dbFile);
  });

  it("GET /api/cost returns seeded totals over HTTP", async () => {
    const r = await fetch(`${baseUrl}/api/cost`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.summary.totalRequests).toBe(2);
    expect(body.summary.totalActualCost).toBeCloseTo(0.0012, 6);
  });

  it("GET /api/logs returns the seeded logs", async () => {
    const r = await fetch(`${baseUrl}/api/logs`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.logs.length).toBe(2);
    expect(body.logs[0].routed_model).toBe("deepseek-chat");
  });

  it("GET /api/cost?range=7d still returns 200", async () => {
    const r = await fetch(`${baseUrl}/api/cost?range=7d`);
    expect(r.status).toBe(200);
  });

  it("/health still works (admin mount did not break existing routes)", async () => {
    const r = await fetch(`${baseUrl}/health`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe("ok");
  });

  it("unknown /api/foo returns 404 as JSON", async () => {
    const r = await fetch(`${baseUrl}/api/foo`);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error).toBeDefined();
  });

  it("non-/api paths fall through to the provider layer (not hijacked by admin)", async () => {
    // Use a provider prefix absent from providerMap so the proxy resolves it
    // to null and returns unknown_provider — without ever contacting a real
    // upstream. The point: the request reached provider resolution, so it was
    // NOT swallowed by the admin interceptor (which would answer unknown_admin_endpoint).
    const r = await fetch(`${baseUrl}/nosuch/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", stream: false }),
    });
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error).toBe("unknown_provider");
  });

  it("returns 500 admin_internal on db error without leaking internals", async () => {
    // A db read failure (SQLITE_BUSY, schema drift, WAL corruption) must be
    // isolated to a 500 admin_internal — it must NOT bubble to the outer 502
    // catch, which emits `message: String(err)` and would echo the raw SQL
    // error (column names, file paths) into the response body.
    const breakingDb = Object.create(db) as TrackingDatabase;
    breakingDb.getCostSummary = () => {
      throw new Error("SqliteError: no such column: secret_col");
    };
    const breakingServer = createProxyServer({
      port: 0,
      deps: {
        db: breakingDb,
        registry: deps.registry,
        providerMap: deps.providerMap,
        handler: { handle: async () => null },
      } as any,
    });
    await new Promise<void>((r) => breakingServer.listen(0, "127.0.0.1", r));
    const addr = breakingServer.address() as http.AddressInfo;
    try {
      const r = await fetch(`http://127.0.0.1:${addr.port}/api/cost`);
      expect(r.status).toBe(500);
      const body = await r.json();
      expect(body.error).toBe("admin_internal");
      // Critical: the raw DB error text must NOT appear in the response.
      expect(JSON.stringify(body)).not.toContain("secret_col");
      expect(JSON.stringify(body)).not.toContain("SqliteError");
    } finally {
      await new Promise<void>((r) => breakingServer.close(() => r()));
    }
  });

  (pickLanIp() ? it : it.skip)(
    "refuses /api/* from a non-loopback peer with 403 (loopback guard, HTTP-level)",
    async (ctx) => {
      // Bind on 0.0.0.0 and connect via the host's LAN IP so the server observes
      // a non-loopback remoteAddress. This is the one path the loopback guard
      // exists for; without an HTTP-level check, flipping isLoopback or dropping
      // the branch would leak cost/logs data while unit tests stay green.
      const lanIp = pickLanIp()!;
      const lanServer = createProxyServer({
        port: 0,
        deps: { ...deps, handler: { handle: async () => null } } as any,
      });
      await new Promise<void>((r) => lanServer.listen(0, "0.0.0.0", r));
      const addr = lanServer.address() as http.AddressInfo;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        let res: Response;
        try {
          res = await fetch(`http://${lanIp}:${addr.port}/api/cost`, { signal: ctrl.signal });
        } catch {
          // LAN IP unreachable from this process (firewall / pure-loopback
          // container). Can't construct a non-loopback peer — skip, don't fail.
          ctx.skip();
          return;
        }
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body).toEqual({ error: "forbidden", reason: "loopback_only" });
      } finally {
        clearTimeout(timer);
        await new Promise<void>((r) => lanServer.close(() => r()));
      }
    },
  );

  it("POST /api/active switches the lock over HTTP (server.ts write path, token-gated)", async () => {
    // 走 server.ts 的 POST 分支完整链路：readBody → extractNodeHeaders →
    // handleAdminRequest → ADMIN_CORS_HEADERS。applyLock 是 mock，验证调用契约
    // 与响应形状（覆盖 server.ts 的写端点改动，而非纯函数层）。
    let applied: any = null;
    const lockServer = createProxyServer({
      port: 0,
      adminToken: "e2e-token",
      deps: {
        registry: deps.registry,
        providerMap: deps.providerMap,
        handler: { handle: async () => null },
        applyLock: (lock: any) => { applied = lock; return { ok: true }; },
        getRouting: () => ({ lockMode: "auto" } as any),
      } as any,
    });
    await new Promise<void>((r) => lockServer.listen(0, "127.0.0.1", r));
    const addr = lockServer.address() as http.AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/active`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agentfare-admin-token": "e2e-token",
        },
        body: JSON.stringify({ lockMode: "model", activeModel: "deepseek/v4-pro" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, lockMode: "model", activeModel: "deepseek/v4-pro", activeProvider: null });
      expect(applied).toEqual({ lockMode: "model", activeModel: "deepseek/v4-pro", activeProvider: undefined });
      // 写端点 CORS 头存在（允许 GUI webview 跨 origin 带 token 调用）
      expect(res.headers.get("access-control-allow-headers")).toContain("x-agentfare-admin-token");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    } finally {
      await new Promise<void>((r) => lockServer.close(() => r()));
    }
  });

  it("POST /api/active without token → 401 over HTTP (token gate at the server layer)", async () => {
    const lockServer = createProxyServer({
      port: 0,
      adminToken: "e2e-token",
      deps: {
        registry: deps.registry,
        providerMap: deps.providerMap,
        handler: { handle: async () => null },
        applyLock: () => ({ ok: true }),
      } as any,
    });
    await new Promise<void>((r) => lockServer.listen(0, "127.0.0.1", r));
    const addr = lockServer.address() as http.AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/active`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lockMode: "auto" }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "invalid_admin_token" });
    } finally {
      await new Promise<void>((r) => lockServer.close(() => r()));
    }
  });

  it("admin responses echo ACAO only for allowlisted origins (C1 CORS layer)", async () => {
    const corsServer = createProxyServer({
      port: 0,
      adminToken: "t",
      deps: { registry: deps.registry, providerMap: deps.providerMap, handler: { handle: async () => null } } as any,
    });
    await new Promise<void>((r) => corsServer.listen(0, "127.0.0.1", r));
    const addr = corsServer.address() as http.AddressInfo;
    try {
      // 非白名单 origin → 无 ACAO：浏览器拒读响应，admin-token 不外泄给同机网页
      const evil = await fetch(`http://127.0.0.1:${addr.port}/api/admin-token`, {
        headers: { origin: "https://evil.com" },
      });
      expect(evil.headers.get("access-control-allow-origin")).toBeNull();
      // 白名单 origin → echo 该 origin，Tauri webview / vite dev 可读
      const good = await fetch(`http://127.0.0.1:${addr.port}/api/admin-token`, {
        headers: { origin: "tauri://localhost" },
      });
      expect(good.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    } finally {
      await new Promise<void>((r) => corsServer.close(() => r()));
    }
  });

  it("admin POST body over 8 KB → 413 (M3: admin body cap, not 100 MB)", async () => {
    const bodyServer = createProxyServer({
      port: 0,
      adminToken: "t",
      deps: { registry: deps.registry, providerMap: deps.providerMap, handler: { handle: async () => null }, applyLock: () => ({ ok: true }) } as any,
    });
    await new Promise<void>((r) => bodyServer.listen(0, "127.0.0.1", r));
    const addr = bodyServer.address() as http.AddressInfo;
    try {
      // 8 KB 上限：activeModel 填 ~9 KB 让整个 body 超阈值
      const big = JSON.stringify({ lockMode: "model", activeModel: "x".repeat(9 * 1024) });
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/active`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agentfare-admin-token": "t" },
        body: big,
      });
      expect(res.status).toBe(413);
    } finally {
      await new Promise<void>((r) => bodyServer.close(() => r()));
    }
  });

  // GUI 一等公民 A2/A3 端到端：照 POST /api/active 模式（createProxyServer 真实
  // http.Server + adminToken + mock 回调），验证 server.ts 写端点完整链路——
  // readBody → extractNodeHeaders → origin gate → token → handleAdminRequest →
  // 响应序列化 + CORS 头。回调 mock（saveKeys/applyProviders）够：HTTP 层是
  // server.ts，纯函数层（buildProvidersConfigJson）由 config-patch.test.ts 守护。
  it("POST /api/keys persists keys over HTTP (server.ts write path, no key echoed)", async () => {
    let saved: Record<string, string> | null = null;
    const keysServer = createProxyServer({
      port: 0,
      adminToken: "e2e-token",
      deps: {
        registry: deps.registry,
        providerMap: deps.providerMap,
        handler: { handle: async () => null },
        saveKeys: (u: Record<string, string>) => { saved = u; },
      } as any,
    });
    await new Promise<void>((r) => keysServer.listen(0, "127.0.0.1", r));
    const addr = keysServer.address() as http.AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/keys`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agentfare-admin-token": "e2e-token" },
        body: JSON.stringify({ openai: "sk-real-key-123", deepseek: "sk-ds-456" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, providers: ["openai", "deepseek"] });
      // saveKeys 收到完整 updates（HTTP 层把 body 正确传给回调）
      expect(saved).toEqual({ openai: "sk-real-key-123", deepseek: "sk-ds-456" });
      // 响应绝不回显 key 值（凭据不泄露契约，admin.ts 核心安全约束）
      expect(JSON.stringify(body)).not.toContain("sk-real-key-123");
      expect(JSON.stringify(body)).not.toContain("sk-ds-456");
      // 写端点 CORS 头存在（GUI webview 跨 origin 带 token 调用）
      expect(res.headers.get("access-control-allow-headers")).toContain("x-agentfare-admin-token");
    } finally {
      await new Promise<void>((r) => keysServer.close(() => r()));
    }
  });

  it("POST /api/keys rejects evil origin with 403 over HTTP (origin gate at server layer)", async () => {
    const keysServer = createProxyServer({
      port: 0,
      adminToken: "e2e-token",
      deps: {
        registry: deps.registry,
        providerMap: deps.providerMap,
        handler: { handle: async () => null },
        // 回调绝不该被执行——origin 门控必须在 token/handler 之前
        saveKeys: () => { throw new Error("saveKeys must not run for evil origin"); },
      } as any,
    });
    await new Promise<void>((r) => keysServer.listen(0, "127.0.0.1", r));
    const addr = keysServer.address() as http.AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/keys`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agentfare-admin-token": "e2e-token",
          origin: "https://evil.example.com",
        },
        body: JSON.stringify({ openai: "sk-x" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toEqual({ error: "forbidden_origin" });
    } finally {
      await new Promise<void>((r) => keysServer.close(() => r()));
    }
  });

  it("POST /api/providers merges config over HTTP (server.ts write path, normalized)", async () => {
    let applied: Record<string, unknown> | null = null;
    const providersServer = createProxyServer({
      port: 0,
      adminToken: "e2e-token",
      deps: {
        registry: deps.registry,
        providerMap: deps.providerMap,
        handler: { handle: async () => null },
        applyProviders: (u: Record<string, unknown>) => { applied = u; return { ok: true }; },
      } as any,
    });
    await new Promise<void>((r) => providersServer.listen(0, "127.0.0.1", r));
    const addr = providersServer.address() as http.AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/providers`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agentfare-admin-token": "e2e-token" },
        body: JSON.stringify({ openai: { baseUrl: "https://relay.example.com", upstreamUrl: "https://api.openai.com" } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, providers: ["openai"] });
      // applyProviders 收到规范化后的 config（baseUrl + upstreamUrl 透传）
      expect(applied).toEqual({ openai: { baseUrl: "https://relay.example.com", upstreamUrl: "https://api.openai.com" } });
      expect(res.headers.get("access-control-allow-headers")).toContain("x-agentfare-admin-token");
    } finally {
      await new Promise<void>((r) => providersServer.close(() => r()));
    }
  });
});
