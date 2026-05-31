import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "../src/fetch-patch.js";
import type { RequestHandler, HandleResult } from "../src/request-handler.js";

describe("installFetchPatch", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;
  let routingResults: HandleResult[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routingResults = [];
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
  });

  it("should intercept LLM API calls and route", async () => {
    const mockResponse = new Response(JSON.stringify({ id: "test" }), { status: 200 });
    globalThis.fetch = async () => mockResponse;

    const mockHandler: RequestHandler = {
      handle: async () => ({
        decision: {
          targetModel: { id: "openai/gpt-5.4-mini", provider: "openai", tier: "fast", api: { modelId: "gpt-5.4-mini", protocol: "openai", baseUrl: "https://api.openai.com/v1" } } as any,
          providerSwitched: false,
          crossProviderMode: "off",
          reasoning: "test",
        },
        modifiedBody: JSON.stringify({ model: "gpt-5.4-mini", messages: [] }),
        analysis: {} as any,
        sessionId: "ad-test-1",
      }),
    } as any;

    uninstall = installFetchPatch({
      handler: mockHandler,
      onRouting: (r) => routingResults.push(r),
    });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.5", messages: [] }),
      headers: { "Content-Type": "application/json" },
    });

    expect(routingResults).toHaveLength(1);
  });

  it("should pass through non-LLM requests", async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("ok"); };

    const mockHandler: RequestHandler = { handle: async () => null } as any;
    uninstall = installFetchPatch({ handler: mockHandler });

    await globalThis.fetch("https://api.github.com/repos");

    expect(called).toBe(true);
  });

  it("should pass through on handler error", async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("ok"); };

    const mockHandler: RequestHandler = { handle: async () => { throw new Error("boom"); } } as any;
    const errors: unknown[] = [];
    uninstall = installFetchPatch({ handler: mockHandler, onError: (e) => errors.push(e) });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.5", messages: [] }),
    });

    expect(called).toBe(true);
    expect(errors).toHaveLength(1);
  });
});
