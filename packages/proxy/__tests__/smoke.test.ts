import { describe, it, expect } from "vitest";
import { resolveProvider, getUpstreamPath, getRegisteredProviders } from "../src/provider-map.js";
import { resolveApiKey, buildAuthHeaders } from "../src/key-store.js";
import { SSEPipe } from "../src/sse-pipe.js";
import { getProxyStatePath } from "../src/lifecycle.js";
import { generateToolGuide, generateExportCommands } from "../src/tool-guide.js";

describe("provider-map", () => {
  it("resolves all providers", () => {
    const providers = getRegisteredProviders();
    expect(providers.length).toBeGreaterThanOrEqual(8);
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
  });

  it("resolves /anthropic/* to anthropic provider", () => {
    const info = resolveProvider("/anthropic/v1/messages");
    expect(info).not.toBeNull();
    expect(info!.provider).toBe("anthropic");
    expect(info!.protocol).toBe("anthropic");
  });

  it("resolves /openai/* to openai provider", () => {
    const info = resolveProvider("/openai/v1/chat/completions");
    expect(info).not.toBeNull();
    expect(info!.provider).toBe("openai");
    expect(info!.protocol).toBe("openai");
  });

  it("returns null for unknown paths", () => {
    expect(resolveProvider("/health")).toBeNull();
    expect(resolveProvider("/foo/bar")).toBeNull();
  });

  it("extracts upstream path", () => {
    expect(getUpstreamPath("/anthropic/v1/messages")).toBe("/v1/messages");
    expect(getUpstreamPath("/openai/v1/chat/completions")).toBe("/v1/chat/completions");
  });
});

describe("key-store", () => {
  it("builds openai auth headers", () => {
    const h = buildAuthHeaders("openai", "sk-test", "openai");
    expect(h["Authorization"]).toBe("Bearer sk-test");
    expect(h["x-api-key"]).toBeUndefined();
  });

  it("builds anthropic auth headers", () => {
    const h = buildAuthHeaders("anthropic", "sk-ant", "anthropic");
    expect(h["x-api-key"]).toBe("sk-ant");
    expect(h["anthropic-version"]).toBe("2023-06-01");
  });
});

describe("lifecycle", () => {
  it("returns proxy state path", () => {
    const p = getProxyStatePath();
    expect(p).toContain(".agentfare");
    expect(p).toContain("proxy.json");
  });
});

describe("tool-guide", () => {
  it("generates tool guide", () => {
    const guide = generateToolGuide(3456);
    expect(guide).toContain("Claude Code");
    expect(guide).toContain("ANTHROPIC_BASE_URL");
    expect(guide).toContain("localhost:3456");
  });

  it("generates export commands for bash", () => {
    const cmds = generateExportCommands(3456, "bash");
    expect(cmds).toContain("export ANTHROPIC_BASE_URL");
  });

  it("generates export commands for powershell", () => {
    const cmds = generateExportCommands(3456, "powershell");
    expect(cmds).toContain("$env:ANTHROPIC_BASE_URL");
  });
});

describe("SSEPipe", () => {
  it("passes through data without conversion", async () => {
    const { Writable } = await import("node:stream");
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        chunks.push(chunk);
        cb();
      },
    });

    const pipe = new SSEPipe("openai", () => {});
    pipe.pipe(writable);

    const done = new Promise<void>((resolve) => {
      writable.on("finish", () => resolve());
    });

    pipe.write(Buffer.from('data: {"choices":[]}\n\n'));
    pipe.end();

    await done;
    const output = Buffer.concat(chunks).toString("utf-8");
    expect(output).toContain("choices");
  });

  it("extracts tokens from OpenAI SSE", async () => {
    const { Writable } = await import("node:stream");
    const tokens: any[] = [];
    const pipe = new SSEPipe("openai", (t) => tokens.push(t));

    const writable = new Writable({ write(_chunk: Buffer, _enc: string, cb: () => void) { cb(); } });
    const done = new Promise<void>((resolve) => { writable.on("finish", () => resolve()); });
    pipe.pipe(writable);

    // OpenAI format with usage
    pipe.write(Buffer.from('data: {"id":"test","object":"chat.completion.chunk","model":"gpt","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n'));
    pipe.write(Buffer.from('data: {"id":"test","object":"chat.completion.chunk","model":"gpt","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n'));
    pipe.write(Buffer.from('data: [DONE]\n\n'));
    pipe.end();

    await done;
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect(tokens[0].input).toBe(10);
    expect(tokens[0].output).toBe(20);
  });
});
