import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createProxyServer } from "../src/server.js";

/**
 * CORS coverage for the read-only admin + health endpoints.
 *
 * The production GUI ships as a Tauri webview whose origin is
 * `tauri://localhost` (macOS/Linux) or `http://tauri.localhost` (Windows
 * WebView2) — a different origin from the loopback daemon (127.0.0.1:3456).
 * Without `Access-Control-Allow-Origin`, the webview blocks JS from reading
 * the response and the GUI is permanently offline. These read endpoints are
 * loopback-only (socket-level gate) and strictly GET, so allowing any origin
 * is safe — CORS is a browser-read gate layered on top, not the auth boundary.
 */

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });
}

function call(
  port: number,
  method: string,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString("utf-8")));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("CORS headers on read-only endpoints", () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("/health GET responds with Access-Control-Allow-Origin: *", async () => {
    server = createProxyServer({ port: 0, deps: { handler: {} as never } });
    const port = await listen(server);
    const res = await call(port, "GET", "/health");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("/health OPTIONS preflight returns 204 with CORS headers", async () => {
    server = createProxyServer({ port: 0, deps: { handler: {} as never } });
    const port = await listen(server);
    const res = await call(port, "OPTIONS", "/health");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toMatch(/GET/);
  });

  it("/api/providers GET responds with Access-Control-Allow-Origin: *", async () => {
    server = createProxyServer({
      port: 0,
      deps: { handler: {} as never, providerMap: {} },
    });
    const port = await listen(server);
    const res = await call(port, "GET", "/api/providers");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("/api OPTIONS preflight returns 204 with CORS headers (no 405)", async () => {
    server = createProxyServer({ port: 0, deps: { handler: {} as never } });
    const port = await listen(server);
    const res = await call(port, "OPTIONS", "/api/cost");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toMatch(/GET/);
  });
});
