import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "../src/fetch-patch.js";
import type { RequestHandler, HandleResult } from "../src/request-handler.js";

describe("installFetchPatch — integration", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: (() => void) | undefined;
  let routingResults: HandleResult[];
  let capturedErrors: unknown[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routingResults = [];
    capturedErrors = [];
    uninstall = undefined;
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
  });

  it("handler throws → original request passes through (error fallback, §11)", async () => {
    let originalFetchCalled = false;
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    globalThis.fetch = async (_input: any, _init?: any) => {
      originalFetchCalled = true;
      return mockResponse;
    };

    const mockHandler: RequestHandler = {
      handle: async () => { throw new Error("handler exploded"); },
    } as any;

    uninstall = installFetchPatch({
      handler: mockHandler,
      onError: (err) => capturedErrors.push(err),
    });

    const response = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.5", messages: [] }),
      headers: { "Content-Type": "application/json" },
    });

    // Original fetch was called as fallback
    expect(originalFetchCalled).toBe(true);
    expect(response.status).toBe(200);
    // Error was reported
    expect(capturedErrors).toHaveLength(1);
    expect((capturedErrors[0] as Error).message).toBe("handler exploded");
  });

  it("reentry protection — request with x-agentfare-internal header is not intercepted", async () => {
    let originalFetchCalled = false;
    let handlerCalled = false;
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    globalThis.fetch = async (_input: any, _init?: any) => {
      originalFetchCalled = true;
      return mockResponse;
    };

    const mockHandler: RequestHandler = {
      handle: async () => { handlerCalled = true; return null; },
    } as any;

    uninstall = installFetchPatch({ handler: mockHandler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.5", messages: [] }),
      headers: {
        "Content-Type": "application/json",
        "x-agentfare-internal": "true",
      },
    });

    // Handler should NOT have been called — reentry guard passes through
    expect(handlerCalled).toBe(false);
    expect(originalFetchCalled).toBe(true);
  });

  it("non-LLM URL → fetch not intercepted", async () => {
    let originalFetchCalled = false;
    let handlerCalled = false;
    globalThis.fetch = async () => { originalFetchCalled = true; return new Response("ok"); };

    const mockHandler: RequestHandler = {
      handle: async () => { handlerCalled = true; return null; },
    } as any;

    uninstall = installFetchPatch({ handler: mockHandler });

    await globalThis.fetch("https://example.com/api/data", {
      method: "GET",
    });

    expect(handlerCalled).toBe(false);
    expect(originalFetchCalled).toBe(true);
  });

  it("onRouting callback does NOT contain apiKey field (ISSUE-009 regression)", async () => {
    const mockResponse = new Response(JSON.stringify({ id: "test" }), { status: 200 });
    globalThis.fetch = async () => mockResponse;

    const mockHandler: RequestHandler = {
      handle: async () => ({
        decision: {
          targetModel: {
            id: "openai/gpt-5.4-mini", provider: "openai", tier: "fast",
            api: { modelId: "gpt-5.4-mini", protocol: "openai", baseUrl: "https://api.openai.com/v1" },
          } as any,
          providerSwitched: true,
          crossProviderMode: "opt-in",
          apiKey: "sk-super-secret-key-12345",
          reasoning: "test",
        },
        modifiedBody: JSON.stringify({ model: "gpt-5.4-mini", messages: [] }),
        analysis: { stepType: "simple_tool_use" } as any,
        sessionId: "ad-regression-001",
      }),
    } as any;

    const captured: HandleResult[] = [];
    uninstall = installFetchPatch({
      handler: mockHandler,
      onRouting: (r) => captured.push(r),
    });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.5", messages: [] }),
      headers: { "Content-Type": "application/json" },
    });

    expect(captured).toHaveLength(1);
    const decision = captured[0].decision as any;
    // apiKey must be stripped from the callback
    expect(decision.apiKey).toBeUndefined();
    // enterpriseConfig must also be stripped
    expect(decision.enterpriseConfig).toBeUndefined();
    // Other fields should still be present
    expect(decision.crossProviderMode).toBe("opt-in");
    expect(decision.providerSwitched).toBe(true);
  });

  it("body is not a string (e.g., ReadableStream simulation) → graceful fallback (ISSUE-022 regression)", async () => {
    let originalFetchCalled = false;
    const mockResponse = new Response("ok");
    globalThis.fetch = async (_input: any, _init?: any) => {
      originalFetchCalled = true;
      return mockResponse;
    };

    let handlerCalled = false;
    const mockHandler: RequestHandler = {
      handle: async () => { handlerCalled = true; return null; },
    } as any;

    uninstall = installFetchPatch({ handler: mockHandler });

    // Simulate body as a non-string (e.g., ReadableStream or undefined)
    const response = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"model":"gpt-5.5"}'));
          controller.close();
        },
      }) as any,
      headers: { "Content-Type": "application/json" },
    });

    // Should not crash, should fall through to original fetch
    expect(originalFetchCalled).toBe(true);
    expect(response).toBeDefined();
    // Handler should NOT have been called since bodyStr is undefined for non-string body
    expect(handlerCalled).toBe(false);
  });
});
