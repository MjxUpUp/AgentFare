import { describe, it, expect, vi, beforeEach } from "vitest";
import { adminApi } from "./api";

// api.ts is a thin fetch wrapper; these tests pin the exact URLs the GUI hits
// and the error contract (must surface the daemon's `error` field, since the
// pages render it verbatim). A regression here breaks every page at once.

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(body: unknown, ok = true, status = 200, statusText = "OK") {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
    statusText,
    json: async () => body,
  } as unknown as Response);
}

describe("adminApi — endpoint URLs", () => {
  it("cost() with no range hits /api/cost", async () => {
    mockFetch({ summary: emptySummary(), byStep: [], byTool: [] });
    await adminApi.cost();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/cost");
  });

  it("cost('7d') appends ?range=7d", async () => {
    mockFetch({ summary: emptySummary(), byStep: [], byTool: [] });
    await adminApi.cost("7d");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/cost?range=7d");
  });

  it("logs(100) appends ?limit=100", async () => {
    mockFetch({ logs: [] });
    await adminApi.logs(100);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/logs?limit=100");
  });

  it("logs() with no limit omits the query string", async () => {
    mockFetch({ logs: [] });
    await adminApi.logs();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/logs");
  });

  it("models / scores / providers / health hit the right paths", async () => {
    mockFetch({ models: [] });
    await adminApi.models();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/models");

    mockFetch({ scores: [] });
    await adminApi.scores();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/scores");

    mockFetch({ providers: {} });
    await adminApi.providers();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/providers");

    mockFetch({ status: "ok", service: "agentfare-proxy" });
    await adminApi.health();
    expect(globalThis.fetch).toHaveBeenCalledWith("/health");
  });

  it("active() / adminToken() hit the cc-switch endpoints", async () => {
    mockFetch({ lockMode: "auto", activeModel: null, activeProvider: null });
    await adminApi.active();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/active");

    mockFetch({ token: "abc" });
    await adminApi.adminToken();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/admin-token");
  });
});

describe("adminApi — response parsing", () => {
  it("returns parsed JSON on ok", async () => {
    const payload = { summary: emptySummary(), byStep: [], byTool: [] };
    mockFetch(payload);
    await expect(adminApi.cost()).resolves.toEqual(payload);
  });

  it("rejects with `<status> <error>` when body carries error field", async () => {
    // Daemon returns { error: "db_unavailable" } with 503 when SQLite is
    // absent. The pages render e.message directly, so the error code must be
    // in the message (not just the status number).
    mockFetch({ error: "db_unavailable" }, false, 503, "Service Unavailable");
    await expect(adminApi.cost()).rejects.toThrow("503 db_unavailable");
  });

  it("rejects with statusText when body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new SyntaxError("not json");
      },
    } as unknown as Response);
    await expect(adminApi.cost()).rejects.toThrow("500 Internal Server Error");
  });

  it("logs(0) explicitly sends ?limit=0 (distinct from undefined)", async () => {
    // limit=0 is a real value the daemon accepts (no SQL LIMIT). It must not
    // be collapsed with undefined — `limit ?` would drop the query string.
    mockFetch({ logs: [] });
    await adminApi.logs(0);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/logs?limit=0");
  });

  it("rejects with `<status> invalid JSON body` when a 200 body is not JSON", async () => {
    // A misconfigured proxy returning an HTML error page with 200 would make
    // res.json() throw a raw SyntaxError ("Unexpected token..."). Wrap it so
    // the page surfaces a meaningful code instead.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new SyntaxError("not json");
      },
    } as unknown as Response);
    await expect(adminApi.cost()).rejects.toThrow("200 invalid JSON body");
  });
});

describe("adminApi — setActive (cc-switch write endpoint)", () => {
  // setActive is two-step: GET /api/admin-token to bootstrap the token, then
  // POST /api/active carrying x-agentfare-admin-token. mockImplementation
  // branches on the method so each step gets the right fixture.

  function mockTwoStep(
    token: string | null,
    postOk: boolean,
    postStatus: number,
    postBody: unknown,
  ) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (_input: any, init?: any) => {
      if (init?.method === "POST") {
        return { ok: postOk, status: postStatus, statusText: "OK", json: async () => postBody } as unknown as Response;
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ token }) } as unknown as Response;
    });
  }

  it("bootstraps the admin token then POSTs /api/active with the header", async () => {
    const fetchSpy = mockTwoStep("tok-123", true, 200, {
      ok: true, lockMode: "model", activeModel: "deepseek/v4-pro", activeProvider: null,
    });
    const r = await adminApi.setActive({ lockMode: "model", activeModel: "deepseek/v4-pro" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/admin-token"); // step 1: GET token
    const postInit = fetchSpy.mock.calls[1][1] as any;          // step 2: POST lock
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/active");
    expect(postInit.method).toBe("POST");
    expect(postInit.headers["x-agentfare-admin-token"]).toBe("tok-123");
    expect(postInit.headers["content-type"]).toBe("application/json");
    expect(postInit.body).toBe(JSON.stringify({ lockMode: "model", activeModel: "deepseek/v4-pro" }));
    expect(r).toEqual({ ok: true, lockMode: "model", activeModel: "deepseek/v4-pro", activeProvider: null });
  });

  it("omits the token header when /api/admin-token returns null (daemon write disabled)", async () => {
    const fetchSpy = mockTwoStep(null, true, 200, {
      ok: true, lockMode: "auto", activeModel: null, activeProvider: null,
    });
    await adminApi.setActive({ lockMode: "auto" });
    const postInit = fetchSpy.mock.calls[1][1] as any;
    expect(postInit.headers).toEqual({ "content-type": "application/json" });
    expect(postInit.headers["x-agentfare-admin-token"]).toBeUndefined();
  });

  it("rejects with `<status> <error>` when POST fails (e.g. 401 invalid_admin_token)", async () => {
    mockTwoStep("tok", false, 401, { error: "invalid_admin_token" });
    await expect(adminApi.setActive({ lockMode: "model", activeModel: "x" })).rejects.toThrow("401 invalid_admin_token");
  });

  it("rejects when the token bootstrap GET itself fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, status: 502, statusText: "Bad Gateway",
      json: async () => ({ error: "daemon_down" }),
    } as unknown as Response);
    await expect(adminApi.setActive({ lockMode: "auto" })).rejects.toThrow("502 daemon_down");
  });
});

function emptySummary() {
  return {
    totalRequests: 0,
    totalOriginalCost: 0,
    totalActualCost: 0,
    totalSavings: 0,
  };
}
