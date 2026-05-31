import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "@agentdispatch/hook/fetch-patch";
import { RequestHandler } from "@agentdispatch/hook/request-handler";
import { DEFAULT_CONFIG } from "@agentdispatch/core";
import { ModelRegistry } from "@agentdispatch/models";

describe("E2E: Basic same-provider routing", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
  });

  it("should route OpenAI powerful → fast for simple tasks", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({ url: typeof input === "string" ? input : "", body: (init as any)?.body });
      return new Response(JSON.stringify({ id: "test", choices: [{ message: { content: "done" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    uninstall = installFetchPatch({ handler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files in src/" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0].body);
    expect(body.model).not.toBe("gpt-5.5");
    expect(body.model).toMatch(/gpt-5\.3|gpt-5\.4-mini/);
  });

  it("should route Anthropic opus → haiku for simple tasks", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({ url: typeof input === "string" ? input : "", body: (init as any)?.body });
      return new Response(JSON.stringify({ id: "test", content: [{ type: "text", text: "done" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    uninstall = installFetchPatch({ handler });

    await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-opus-4-6",
        messages: [{ role: "user", content: "yes, proceed" }],
      }),
      headers: { "Content-Type": "application/json", "x-api-key": "test-key" },
    });

    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0].body);
    expect(body.model).not.toBe("claude-opus-4-6");
    expect(body.model).toMatch(/haiku/);
  });

  it("should NOT cross provider in off mode even if cheaper", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({ url: typeof input === "string" ? input : "", body: (init as any)?.body });
      return new Response(JSON.stringify({ id: "test" }), { status: 200 });
    };

    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    uninstall = installFetchPatch({ handler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "format this code with prettier" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0].body);
    expect(body.model).toMatch(/gpt/);
  });
});
