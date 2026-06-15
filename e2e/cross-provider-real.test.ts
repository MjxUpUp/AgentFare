import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "@agentfare/hook/fetch-patch";
import { RequestHandler } from "@agentfare/hook/request-handler";
import { DEFAULT_CONFIG } from "@agentfare/core";
import type { AgentFareConfig, StepAnalysis } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";

/**
 * E2E: Cross-provider routing with real RequestHandler (not mocked handler).
 *
 * Tests use the actual RequestHandler with injected L2/L3 mocks to verify
 * the full routing pipeline: URL rewrite, auth header rewrite, provider selection.
 *
 * IMPORTANT: messages must NOT match any L1 rule patterns in analyzer/rules.ts,
 * otherwise L1 will produce an analysis and the L2 mock will never be called.
 * Use gibberish text that won't trigger any pattern.
 */
const L1_BYPASS_MSG = "Qux zlm fnord pqrst uvwxyz";

describe("E2E: Cross-provider routing with real RequestHandler", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-test-key";
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("should route to DeepSeek when opt-in mode enabled and DEEPSEEK_API_KEY set", async () => {
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
    const config: AgentFareConfig = {
      ...DEFAULT_CONFIG,
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "opt-in",
        crossProviderProviders: ["deepseek"],
      },
    };

    // Inject L2 mock that recommends DeepSeek
    const deepseekFlash = registry.get("deepseek/v4-flash")!;
    const mockAnalysis: StepAnalysis = {
      stepType: "exploration",
      difficulty: 0.2,
      confidence: 0.92,
      recommendedTier: "fast",
      recommendedModel: deepseekFlash.id,
      reasoning: "simple exploration task, route to cheapest fast model",
      needsProviderSwitch: true,
      estimatedTokens: { input: 100, output: 50 },
      alternatives: [],
    };

    const handler = new RequestHandler(config, registry);
    handler.injectL2L3({
      cache: {
        get: () => null,
        set: () => {},
      },
      analyzeWithLLM: async () => mockAnalysis,
      selectAnalyzerModel: () => deepseekFlash,
      getOriginalFetch: () => originalFetch,
    });

    uninstall = installFetchPatch({ handler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: L1_BYPASS_MSG }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const req = captured[0];
    // URL should be rewritten to DeepSeek
    expect(req.url).toContain("deepseek");
    // Auth should use DeepSeek key
    expect(req.headers?.Authorization).toContain("sk-deepseek-test-key");
    // Body should contain the DeepSeek model ID
    const body = JSON.parse(req.body);
    expect(body.model).toBe(deepseekFlash.api.modelId);
  });

  it("should stay on same provider when provider NOT in whitelist", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
      });
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "done" } }] }),
        { status: 200 },
      );
    };

    const registry = new ModelRegistry();
    // opt-in but only allow "google" (not in the model registry with API key)
    const config: AgentFareConfig = {
      ...DEFAULT_CONFIG,
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "opt-in",
        crossProviderProviders: ["google"],
      },
    };

    const handler = new RequestHandler(config, registry);
    // No L2 injection — relies on L1 rules for same-provider routing

    uninstall = installFetchPatch({ handler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: L1_BYPASS_MSG }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    // Should stay on OpenAI — no cross-provider because google has no key
    expect(captured[0].url).toContain("openai");
  });

  it("should degrade to same provider when env key is missing for whitelisted provider", async () => {
    // Remove the DeepSeek key to simulate missing key
    delete process.env.DEEPSEEK_API_KEY;

    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
      });
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "done" } }] }),
        { status: 200 },
      );
    };

    const registry = new ModelRegistry();
    const config: AgentFareConfig = {
      ...DEFAULT_CONFIG,
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "opt-in",
        crossProviderProviders: ["deepseek"],
      },
    };

    const deepseekFlash = registry.get("deepseek/v4-flash")!;
    const mockAnalysis: StepAnalysis = {
      stepType: "exploration",
      difficulty: 0.2,
      confidence: 0.92,
      recommendedTier: "fast",
      recommendedModel: deepseekFlash.id,
      reasoning: "simple exploration",
      needsProviderSwitch: true,
      estimatedTokens: { input: 100, output: 50 },
      alternatives: [],
    };

    const handler = new RequestHandler(config, registry);
    handler.injectL2L3({
      cache: { get: () => null, set: () => {} },
      analyzeWithLLM: async () => mockAnalysis,
      selectAnalyzerModel: () => deepseekFlash,
      getOriginalFetch: () => originalFetch,
    });

    uninstall = installFetchPatch({ handler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: L1_BYPASS_MSG }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    // Without DEEPSEEK_API_KEY, cross-provider should degrade to same provider
    expect(captured[0].url).toContain("openai");
  });

  it("should use enterprise baseUrl when enterprise mode is configured", async () => {
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
    const enterpriseBaseUrl = "https://llm-proxy.mycompany.com/deepseek";
    const config: AgentFareConfig = {
      ...DEFAULT_CONFIG,
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "enterprise",
        crossProviderProviders: ["deepseek"],
        enterpriseProviders: {
          deepseek: {
            baseUrl: enterpriseBaseUrl,
            authMode: "corporate-sso",
            allowedTiers: ["fast", "standard"],
            dataRegion: "cn",
          },
        },
      },
    };

    const deepseekFlash = registry.get("deepseek/v4-flash")!;
    const mockAnalysis: StepAnalysis = {
      stepType: "exploration",
      difficulty: 0.2,
      confidence: 0.92,
      recommendedTier: "fast",
      recommendedModel: deepseekFlash.id,
      reasoning: "enterprise route to DeepSeek",
      needsProviderSwitch: true,
      estimatedTokens: { input: 100, output: 50 },
      alternatives: [],
    };

    const handler = new RequestHandler(config, registry);
    handler.injectL2L3({
      cache: { get: () => null, set: () => {} },
      analyzeWithLLM: async () => mockAnalysis,
      selectAnalyzerModel: () => deepseekFlash,
      getOriginalFetch: () => originalFetch,
    });

    uninstall = installFetchPatch({ handler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: L1_BYPASS_MSG }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    // URL should use enterprise proxy, not direct DeepSeek
    expect(captured[0].url).toContain("llm-proxy.mycompany.com");
    expect(captured[0].url).toContain("deepseek");
  });
});
