import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import { createProxyServer, type ProxyServerDeps } from "@agentfare/proxy/server";
import { startProxy, stopProxy, getProxyStatus } from "@agentfare/proxy/lifecycle";
import { resolveProvider, getUpstreamPath } from "@agentfare/proxy/provider-map";
import { resolveApiKey, buildAuthHeaders } from "@agentfare/proxy/key-store";
import { RequestHandler } from "@agentfare/hook/request-handler";
import { DEFAULT_CONFIG, TrackingDatabase, CostTracker, QualitySignalCollector } from "@agentfare/core";
import { ModelRegistry, getDbPath } from "@agentfare/models";
import { makeOpenAIStream, makeAnthropicStream } from "./setup.js";

/** Find a free port */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("No port")));
      }
    });
  });
}

/** Make an HTTP request and return the response */
function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const reqHeaders: Record<string, string> = { "Content-Type": "application/json", ...headers };
    if (body) {
      reqHeaders["Content-Length"] = String(Buffer.byteLength(body));
    }
    const req = http.request(
      `http://localhost:${port}${path}`,
      { method, headers: reqHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const respHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") respHeaders[k] = v;
          }
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
            headers: respHeaders,
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("E2E: Proxy provider-map", () => {
  it("should resolve /anthropic/* to anthropic provider", () => {
    const info = resolveProvider("/anthropic/v1/messages");
    expect(info).not.toBeNull();
    expect(info!.provider).toBe("anthropic");
    expect(info!.protocol).toBe("anthropic");
    expect(info!.upstreamBaseUrl).toContain("anthropic.com");
  });

  it("should resolve /openai/* to openai provider", () => {
    const info = resolveProvider("/openai/v1/chat/completions");
    expect(info).not.toBeNull();
    expect(info!.provider).toBe("openai");
    expect(info!.protocol).toBe("openai");
  });

  it("should resolve all supported providers", () => {
    const providers = ["openai", "anthropic", "deepseek", "google", "zhipu", "moonshot", "alibaba", "xiaomi"];
    for (const p of providers) {
      const info = resolveProvider(`/${p}/v1/test`);
      expect(info, `Provider ${p} not found`).not.toBeNull();
      expect(info!.provider).toBe(p);
    }
  });

  it("should return null for unknown paths", () => {
    expect(resolveProvider("/health")).toBeNull();
    expect(resolveProvider("/unknown/v1/test")).toBeNull();
  });

  it("should extract upstream path correctly", () => {
    expect(getUpstreamPath("/anthropic/v1/messages")).toBe("/v1/messages");
    expect(getUpstreamPath("/openai/v1/chat/completions")).toBe("/v1/chat/completions");
    expect(getUpstreamPath("/deepseek/chat/completions")).toBe("/chat/completions");
  });
});

describe("E2E: Proxy key-store", () => {
  it("should build openai auth headers", () => {
    const h = buildAuthHeaders("openai", "sk-test", "openai");
    expect(h["Authorization"]).toBe("Bearer sk-test");
    expect(h["x-api-key"]).toBeUndefined();
  });

  it("should build anthropic auth headers", () => {
    const h = buildAuthHeaders("anthropic", "sk-ant-test", "anthropic");
    expect(h["x-api-key"]).toBe("sk-ant-test");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h["Authorization"]).toBeUndefined();
  });

  it("should resolve key from headers (openai)", () => {
    process.env.OPENAI_API_KEY = "env-key";
    const key = resolveApiKey("openai", { authorization: "Bearer header-key" });
    expect(key).toBe("header-key");
    delete process.env.OPENAI_API_KEY;
  });

  it("should resolve key from environment when not in headers", () => {
    process.env.OPENAI_API_KEY = "env-key-123";
    const key = resolveApiKey("openai", {});
    expect(key).toBe("env-key-123");
    delete process.env.OPENAI_API_KEY;
  });

  it("should return undefined when no key available", () => {
    const key = resolveApiKey("unknown_provider", {});
    expect(key).toBeUndefined();
  });
});

describe("E2E: Proxy server health check", () => {
  let proxyServer: http.Server;
  let port: number;

  beforeEach(async () => {
    port = await getFreePort();
    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    proxyServer = createProxyServer({
      port,
      deps: { handler },
    });

    await new Promise<void>((resolve) => {
      proxyServer.listen(port, () => resolve());
    });
  });

  afterEach(() => {
    proxyServer.close();
  });

  it("should respond to /health", async () => {
    const res = await httpRequest(port, "GET", "/health");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
  });

  it("should return 404 for unknown provider path", async () => {
    const res = await httpRequest(port, "POST", "/unknown/v1/test");
    expect(res.status).toBe(404);
  });

  it("should return 405 for GET on provider path", async () => {
    const res = await httpRequest(port, "GET", "/openai/v1/chat/completions");
    expect(res.status).toBe(405);
  });
});

describe("E2E: Proxy server request forwarding with mock upstream", () => {
  let proxyServer: http.Server;
  let proxyPort: number;
  let mockUpstream: http.Server;
  let upstreamPort: number;
  let capturedRequests: any[];

  beforeEach(async () => {
    capturedRequests = [];

    // Mock upstream LLM API server
    upstreamPort = await getFreePort();
    mockUpstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        capturedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body ? JSON.parse(body) : null,
        });

        // Return a standard OpenAI chat completion response
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          model: "gpt-5.4-mini",
          choices: [{
            index: 0,
            message: { role: "assistant", content: "Hello from mock!" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
        }));
      });
    });
    await new Promise<void>((resolve) => { mockUpstream.listen(upstreamPort, () => resolve()); });

    // Proxy server with resolveUpstream pointing to mock
    proxyPort = await getFreePort();
    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    proxyServer = createProxyServer({
      port: proxyPort,
      deps: { handler },
      // Rewrite any upstream URL to our mock server
      resolveUpstream: (_targetUrl: string) => `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
    });
    await new Promise<void>((resolve) => { proxyServer.listen(proxyPort, () => resolve()); });
  });

  afterEach(() => {
    proxyServer.close();
    mockUpstream.close();
  });

  it("should forward OpenAI request to upstream and return response", async () => {
    const res = await httpRequest(
      proxyPort,
      "POST",
      "/openai/v1/chat/completions",
      JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: "hello" }],
      }),
      { authorization: "Bearer test-key" },
    );

    // Should get the mock upstream's response
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe("chatcmpl-test");
    expect(body.choices[0].message.content).toBe("Hello from mock!");
    expect(body.usage.prompt_tokens).toBe(15);
  });

  it("should pass auth headers to upstream", async () => {
    await httpRequest(
      proxyPort,
      "POST",
      "/openai/v1/chat/completions",
      JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: "test" }],
      }),
      { authorization: "Bearer sk-my-secret-key" },
    );

    expect(capturedRequests.length).toBe(1);
    expect(capturedRequests[0].headers["authorization"]).toBe("Bearer sk-my-secret-key");
  });

  it("should route simple tasks to cheaper model", async () => {
    await httpRequest(
      proxyPort,
      "POST",
      "/openai/v1/chat/completions",
      JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files in src/" }],
      }),
      { authorization: "Bearer test-key" },
    );

    expect(capturedRequests.length).toBe(1);
    const routedModel = capturedRequests[0].body.model;
    // Should have routed gpt-5.5 (powerful) to a cheaper fast-tier model
    expect(routedModel).not.toBe("gpt-5.5");
    expect(routedModel).toMatch(/gpt-5\.3|gpt-5\.4-mini/);
  });
});

describe("E2E: Proxy streaming with mock upstream", () => {
  let proxyServer: http.Server;
  let proxyPort: number;
  let mockUpstream: http.Server;
  let upstreamPort: number;
  let capturedRequests: any[];

  beforeEach(async () => {
    capturedRequests = [];

    upstreamPort = await getFreePort();
    mockUpstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        capturedRequests.push({
          method: req.method,
          url: req.url,
          body: body ? JSON.parse(body) : null,
        });

        // Return an OpenAI SSE streaming response
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        const sseData = makeOpenAIStream([
          { id: "chatcmpl-stream", object: "chat.completion.chunk", model: "gpt-5.4-mini", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
          { id: "chatcmpl-stream", object: "chat.completion.chunk", model: "gpt-5.4-mini", choices: [{ index: 0, delta: { content: "Hello streaming!" }, finish_reason: null }] },
          { id: "chatcmpl-stream", object: "chat.completion.chunk", model: "gpt-5.4-mini", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ], true);

        res.end(sseData);
      });
    });
    await new Promise<void>((resolve) => { mockUpstream.listen(upstreamPort, () => resolve()); });

    proxyPort = await getFreePort();
    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    proxyServer = createProxyServer({
      port: proxyPort,
      deps: { handler },
      resolveUpstream: (_url: string) => `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
    });
    await new Promise<void>((resolve) => { proxyServer.listen(proxyPort, () => resolve()); });
  });

  afterEach(() => {
    proxyServer.close();
    mockUpstream.close();
  });

  it("should stream SSE response from upstream to client", async () => {
    const res = await httpRequest(
      proxyPort,
      "POST",
      "/openai/v1/chat/completions",
      JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      }),
      { authorization: "Bearer test-key" },
    );

    expect(res.status).toBe(200);
    // Should contain SSE data
    expect(res.body).toContain("data:");
    expect(res.body).toContain("Hello streaming!");
    expect(res.body).toContain("[DONE]");
  });

  it("should route streaming requests to cheaper model", async () => {
    await httpRequest(
      proxyPort,
      "POST",
      "/openai/v1/chat/completions",
      JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "yes, do it" }],
        stream: true,
      }),
      { authorization: "Bearer test-key" },
    );

    expect(capturedRequests.length).toBe(1);
    expect(capturedRequests[0].body.model).not.toBe("gpt-5.5");
  });
});

describe("E2E: Proxy server streaming with SSE pipe", () => {
  it("should extract tokens from OpenAI SSE chunks", async () => {
    const { SSEPipe } = await import("@agentfare/proxy/sse-pipe");
    const tokens: any[] = [];

    const pipe = new SSEPipe("openai", (t) => tokens.push(t));

    const stream = makeOpenAIStream([
      { id: "test", object: "chat.completion.chunk", model: "gpt-test", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
    ], true);

    // Write all data then end; use Writable to collect and wait for finish
    const chunks: Buffer[] = [];
    const writable = new (await import("node:stream")).Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        chunks.push(chunk);
        cb();
      },
    });

    // Register end listener BEFORE writing
    const done = new Promise<void>((resolve) => {
      writable.on("finish", () => resolve());
    });

    pipe.pipe(writable);
    pipe.write(Buffer.from(stream));
    pipe.end();

    await done;

    // Should have extracted tokens from the usage chunk
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect(tokens[0]).toHaveProperty("input");
    expect(tokens[0]).toHaveProperty("output");
  });

  it("should extract tokens from Anthropic SSE chunks", async () => {
    const { SSEPipe } = await import("@agentfare/proxy/sse-pipe");
    const tokens: any[] = [];

    const pipe = new SSEPipe("anthropic", (t) => tokens.push(t));

    const stream = makeAnthropicStream("Hello", 50, 20);

    const { Writable } = await import("node:stream");
    const writable = new Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) { cb(); },
    });

    const done = new Promise<void>((resolve) => {
      writable.on("finish", () => resolve());
    });

    pipe.pipe(writable);
    pipe.write(Buffer.from(stream));
    pipe.end();

    await done;

    expect(tokens.length).toBeGreaterThanOrEqual(1);
    const hasInput = tokens.some((t: any) => t.input > 0);
    const hasOutput = tokens.some((t: any) => t.output > 0);
    expect(hasInput).toBe(true);
    expect(hasOutput).toBe(true);
  });

  it("should pass through SSE data unchanged when no converter", async () => {
    const { SSEPipe } = await import("@agentfare/proxy/sse-pipe");
    const { Writable } = await import("node:stream");

    const pipe = new SSEPipe("openai", () => {});
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        chunks.push(chunk);
        cb();
      },
    });

    const done = new Promise<void>((resolve) => {
      writable.on("finish", () => resolve());
    });

    pipe.pipe(writable);
    const input = "data: {\"test\":true}\n\n";
    pipe.write(Buffer.from(input));
    pipe.end();

    await done;

    const output = Buffer.concat(chunks).toString("utf-8");
    expect(output).toContain("test");
  });
});
