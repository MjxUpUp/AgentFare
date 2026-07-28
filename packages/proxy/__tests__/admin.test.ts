import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TrackingDatabase, type RoutingLogEntry } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import { handleAdminRequest, isLoopback, type AdminDeps } from "../src/admin.js";
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
    expect(handleAdminRequest("GET", "/health", {}, deps)).toBeNull();
    expect(handleAdminRequest("GET", "/openai/v1/chat/completions", {}, deps)).toBeNull();
  });

  it("rejects non-GET methods on /api/* with 405", () => {
    const r = handleAdminRequest("POST", "/api/cost", {}, deps);
    expect(r?.status).toBe(405);
    expect(r?.body).toEqual({ error: "method_not_allowed" });
  });

  it("returns 404 for unknown /api/ endpoint", () => {
    const r = handleAdminRequest("GET", "/api/unknown", {}, deps);
    expect(r?.status).toBe(404);
  });

  it("/api/cost returns summary + byStep + byTool aggregates", () => {
    const r = handleAdminRequest("GET", "/api/cost", {}, deps);
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
    const r = handleAdminRequest("GET", "/api/logs", {}, deps);
    expect(r?.status).toBe(200);
    expect(Array.isArray((r!.body as any).logs)).toBe(true);
  });

  it("/api/models returns registry entries with pricing", () => {
    const r = handleAdminRequest("GET", "/api/models", {}, deps);
    expect(r?.status).toBe(200);
    const models = (r!.body as any).models as any[];
    expect(Array.isArray(models)).toBe(true);
    if (models.length > 0) {
      expect(models[0]).toHaveProperty("id");
      expect(models[0]).toHaveProperty("pricing");
    }
  });

  it("/api/scores returns model score rows", () => {
    const r = handleAdminRequest("GET", "/api/scores", {}, deps);
    expect(r?.status).toBe(200);
    expect(Array.isArray((r!.body as any).scores)).toBe(true);
  });

  it("/api/providers returns the provider map", () => {
    const r = handleAdminRequest("GET", "/api/providers", {}, deps);
    expect(r?.status).toBe(200);
    expect((r!.body as any).providers).toHaveProperty("openai");
  });

  it("returns 503 when db is required but absent", () => {
    const noDb: AdminDeps = { registry };
    expect(handleAdminRequest("GET", "/api/cost", {}, noDb)?.status).toBe(503);
    expect(handleAdminRequest("GET", "/api/logs", {}, noDb)?.status).toBe(503);
    expect(handleAdminRequest("GET", "/api/scores", {}, noDb)?.status).toBe(503);
  });

  it("accepts a valid time range (7d) without throwing", () => {
    const r = handleAdminRequest("GET", "/api/cost", { range: "7d" }, deps);
    expect(r?.status).toBe(200);
  });

  it("ignores an invalid time range (falls back to all-time, not 400)", () => {
    // invalid range must not crash the endpoint; treat as no filter
    const r = handleAdminRequest("GET", "/api/cost", { range: "not-a-range" }, deps);
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
  });
  it("handles undefined", () => {
    expect(isLoopback(undefined)).toBe(false);
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
});
