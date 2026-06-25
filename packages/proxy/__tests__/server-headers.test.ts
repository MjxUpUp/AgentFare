import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import { createProxyServer } from "../src/server.js";

/**
 * Integration tests for createProxyServer's response piping — verifies the
 * header-hygiene fixes (hop-by-hop stripping, content-length recomputation) and
 * that a pass-through request body reaches the upstream intact.
 *
 * Layout: a mock upstream (node:http) returns controlled headers/body; the
 * proxy's `resolveUpstream` rewrites every upstream URL to point at the mock,
 * so we can assert exactly what the client receives without real network calls.
 */

function closeServer(s: http.Server | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!s) return resolve();
    s.close(() => resolve());
  });
}

interface Harness {
  mockUp: http.Server;
  proxy: http.Server;
  mockPort: number;
  proxyPort: number;
}

async function startHarness(mockHandler: http.RequestListener): Promise<Harness> {
  const mockUp = http.createServer(mockHandler);
  await new Promise<void>((r) => mockUp.listen(0, "127.0.0.1", r));
  const mockPort = (mockUp.address() as any).port;

  const proxy = createProxyServer({
    port: 0,
    deps: { handler: { handle: async () => null } as any },
    // Redirect every upstream call to the mock, preserving the path.
    resolveUpstream: (url) =>
      url.replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${mockPort}`),
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyPort = (proxy.address() as any).port;

  return { mockUp, proxy, mockPort, proxyPort };
}

function post(port: number, path: string, bodyStr: string): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(bodyStr).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          }),
        );
      },
    );
    r.on("error", reject);
    r.end(bodyStr);
  });
}

describe("createProxyServer — response header hygiene & body integrity", () => {
  let h: Harness | undefined;

  afterEach(async () => {
    if (!h) return;
    await closeServer(h.mockUp);
    await closeServer(h.proxy);
    h = undefined;
  });

  it("strips hop-by-hop headers and recomputes content-length", async () => {
    const payload = '{"ok":true}';
    h = await startHarness((_q, res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        // Hop-by-hop headers that must NOT be forwarded verbatim. We pick
        // proxy-authenticate / proxy-authorization (node never auto-adds and
        // never special-cases these), rather than `connection` / `keep-alive`
        // which node re-injects itself under HTTP/1.1 keep-alive regardless of
        // proxy stripping.
        "proxy-authenticate": 'Basic realm="x"',
        "proxy-authorization": "Bearer xyz",
        // End-to-end header that MUST survive.
        "x-custom": "kept",
      });
      res.end(payload);
    });

    const { status, headers, body } = await post(
      h.proxyPort,
      "/openai/v1/chat/completions",
      JSON.stringify({ model: "gpt-4o", stream: false }),
    );

    expect(status).toBe(200);
    expect(body).toBe(payload);
    // Hop-by-hop headers are stripped before forwarding.
    expect(headers["proxy-authenticate"]).toBeUndefined();
    expect(headers["proxy-authorization"]).toBeUndefined();
    // content-length is recomputed (not blindly forwarded) and matches the body.
    expect(headers["content-length"]).toBe(String(Buffer.byteLength(payload)));
    // End-to-end headers are preserved.
    expect(headers["x-custom"]).toBe("kept");
  });

  it("forwards the client request body to the upstream intact (pass-through)", async () => {
    let captured = "";
    const sentBody = JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "ping" }] });
    h = await startHarness((req, res) => {
      req.on("data", (c) => (captured += c.toString("utf-8")));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"id":"r"}');
      });
    });

    const { status, body } = await post(h.proxyPort, "/openai/v1/chat/completions", sentBody);
    expect(status).toBe(200);
    expect(body).toBe('{"id":"r"}');
    // The upstream saw exactly what the client sent (no mutation on pass-through).
    expect(captured).toBe(sentBody);
  });
});
