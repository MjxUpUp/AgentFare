import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "@agentfare/hook/fetch-patch";
import { DEFAULT_CONFIG } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import type { RequestHandler, HandleResult } from "@agentfare/hook/request-handler";

/**
 * E2E: Cross-provider routing integration tests.
 *
 * These tests verify the full fetch-patch → URL rewrite → auth header rewrite
 * pipeline when the RequestHandler decides to route to a different provider.
 *
 * Because the rule-based analyzer (L1) never sets recommendedModel (required
 * for cross-provider), and L2 is not injected in E2E tests, we mock the
 * RequestHandler.handle() to return cross-provider decisions directly.
 * This tests the integration layer (fetch-patch URL/header rewriting) end-to-end.
 */
describe("E2E: Cross-provider routing", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("should route to DeepSeek when handler decides cross-provider (opt-in)", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
        headers: (init as any)?.headers,
      });
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "done" } }] }),
        { status: 200 },
      );
    };

    const registry = new ModelRegistry();
    const deepseekModel = registry.get("deepseek/v4-flash")!;

    const mockHandler: RequestHandler = {
      handle: async () =>
        ({
          decision: {
            targetModel: deepseekModel,
            providerSwitched: true,
            crossProviderMode: "opt-in" as const,
            apiKey: process.env.DEEPSEEK_API_KEY,
            reasoning: "跨 provider (opt-in): cheap exploration",
          },
          modifiedBody: JSON.stringify({ model: deepseekModel.api.modelId, messages: [] }),
          analysis: {
            stepType: "exploration",
            difficulty: 0.2,
            confidence: 0.9,
            recommendedTier: "fast",
            recommendedModel: deepseekModel.id,
            reasoning: "simple exploration",
            needsProviderSwitch: true,
            estimatedTokens: { input: 100, output: 50 },
            alternatives: [],
          },
          sessionId: "ad-test-cross-1",
        }) as HandleResult,
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files in src/" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const req = captured[0];
    // URL should be rewritten to DeepSeek
    expect(req.url).toContain("deepseek");
    // Auth header should use the DeepSeek API key
    expect(req.headers?.Authorization).toContain("test-deepseek-key");
    // Body should contain the DeepSeek model ID
    const body = JSON.parse(req.body);
    expect(body.model).toBe("deepseek-v4-flash");
  });

  it("should NOT cross provider when handler keeps same provider", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
      });
      return new Response(JSON.stringify({ id: "test" }), { status: 200 });
    };

    const registry = new ModelRegistry();
    const openaiModel = registry.get("openai/gpt-5.4-mini")!;

    const mockHandler: RequestHandler = {
      handle: async () =>
        ({
          decision: {
            targetModel: openaiModel,
            providerSwitched: false,
            crossProviderMode: "off" as const,
            reasoning: "same provider fast model",
          },
          modifiedBody: JSON.stringify({ model: openaiModel.api.modelId, messages: [] }),
          analysis: {
            stepType: "simple_tool_use",
            difficulty: 0.1,
            confidence: 0.95,
            recommendedTier: "fast",
            recommendedModel: "",
            reasoning: "simple tool call",
            needsProviderSwitch: false,
            estimatedTokens: { input: 100, output: 50 },
            alternatives: [],
          },
          sessionId: "ad-test-same-1",
        }) as HandleResult,
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    // Should remain on OpenAI
    expect(captured[0].url).toContain("openai");
    // Should use the cheaper model
    const body = JSON.parse(captured[0].body);
    expect(body.model).toBe("gpt-5.4-mini");
  });

  it("should use enterprise baseUrl when enterprise config is provided", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        headers: (init as any)?.headers,
      });
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "done" } }] }),
        { status: 200 },
      );
    };

    const registry = new ModelRegistry();
    const deepseekModel = registry.get("deepseek/v4-flash")!;

    const mockHandler: RequestHandler = {
      handle: async () =>
        ({
          decision: {
            targetModel: deepseekModel,
            providerSwitched: true,
            crossProviderMode: "enterprise" as const,
            enterpriseConfig: {
              baseUrl: "https://llm-proxy.company.internal/deepseek",
              authMode: "corporate-sso" as const,
              allowedTiers: ["fast"] as Array<"fast" | "standard" | "powerful">,
              dataRegion: "cn",
            },
            reasoning: "跨 provider (enterprise): corporate routing",
          },
          modifiedBody: JSON.stringify({ model: deepseekModel.api.modelId, messages: [] }),
          analysis: {
            stepType: "exploration",
            difficulty: 0.2,
            confidence: 0.9,
            recommendedTier: "fast",
            recommendedModel: deepseekModel.id,
            reasoning: "enterprise exploration",
            needsProviderSwitch: true,
            estimatedTokens: { input: 100, output: 50 },
            alternatives: [],
          },
          sessionId: "ad-test-enterprise-1",
        }) as HandleResult,
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files in src/" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    // URL should use enterprise proxy, not direct DeepSeek
    expect(captured[0].url).toContain("llm-proxy.company.internal");
    expect(captured[0].url).toContain("deepseek");
  });
});
