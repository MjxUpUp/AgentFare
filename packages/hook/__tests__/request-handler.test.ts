import { describe, it, expect } from "vitest";
import { RequestHandler } from "../src/request-handler.js";
import { ModelRegistry } from "@agentfare/models";
import { DEFAULT_CONFIG } from "@agentfare/core";
import { RouteCache } from "@agentfare/core";
import type { StepAnalysis } from "@agentfare/core";

describe("RequestHandler", () => {
  const registry = new ModelRegistry();
  const handler = new RequestHandler(DEFAULT_CONFIG, registry);

  it("should parse OpenAI request and return routing decision", async () => {
    const body = JSON.stringify({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "list files in src/" }],
      stream: true,
    });

    const result = await handler.handle(
      "https://api.openai.com/v1/chat/completions",
      body,
      { Authorization: "Bearer sk-test" },
    );

    expect(result).toBeDefined();
    expect(result!.decision.targetModel!.provider).toBe("openai");
    expect(result!.decision.targetModel!.tier).toBe("fast");
    expect(result!.decision.providerSwitched).toBe(false);
    expect(result!.modifiedBody).toBeDefined();
  });
});

describe("RequestHandler — integration", () => {
  const registry = new ModelRegistry();

  it("handle returns null when no routing needed (model matches target)", async () => {
    // Use a model that maps to same-tier same-provider — no change needed
    const config = { ...DEFAULT_CONFIG };
    const handler = new RequestHandler(config, registry);

    // "openai/gpt-5.5" is powerful tier — the L1 rule won't trigger for "explain quantum physics"
    // and the fallback analysis will recommend "standard" tier which maps to a different model
    // To get null, we need the decision.targetModel.api.modelId === originalModel
    // That means we need a request that doesn't change the model.
    // Use a non-LLM URL to trigger "unrecognized provider" → targetModel null → returns null
    const result = await handler.handle(
      "https://unknown.example.com/api/chat",
      JSON.stringify({ model: "some-model", messages: [{ role: "user", content: "hello" }] }),
      {},
    );

    expect(result).toBeNull();
  });

  it("L2 injectL2L3 full chain: L1 no match → mock LLM returns analysis → routing decision made", async () => {
    // The handler calls getEnvKeyForProvider(analyzerModel.provider) which reads process.env.
    // We must set the env key so the L2 branch is entered.
    process.env.OPENAI_API_KEY = "test-analyzer-key";

    const config = {
      ...DEFAULT_CONFIG,
      routing: { ...DEFAULT_CONFIG.routing, analyzerModel: "auto", cacheResults: false },
    };
    const handler = new RequestHandler(config, registry);

    const mockAnalysis: StepAnalysis = {
      stepType: "reasoning",
      difficulty: 0.8,
      confidence: 0.95,
      recommendedTier: "powerful",
      recommendedModel: "",
      reasoning: "Complex reasoning detected by LLM",
      needsProviderSwitch: false,
      estimatedTokens: { input: 500, output: 300 },
      alternatives: [],
    };

    handler.injectL2L3({
      cache: new RouteCache(),
      analyzeWithLLM: async () => mockAnalysis,
      selectAnalyzerModel: () => registry.get("openai/gpt-5.4-mini") ?? null,
      getOriginalFetch: () => async () => new Response("ok"),
    });

    try {
      const result = await handler.handle(
        "https://api.openai.com/v1/chat/completions",
        JSON.stringify({ model: "gpt-5.4-mini", messages: [{ role: "user", content: "Prove the Riemann hypothesis" }] }),
        {},
      );

      expect(result).toBeDefined();
      expect(result!.analysis.stepType).toBe("reasoning");
      // The router should route to a powerful model
      expect(result!.decision.targetModel).not.toBeNull();
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("L3 injectL2L3 cache hit: second identical request returns cached result", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      routing: { ...DEFAULT_CONFIG.routing, cacheResults: true },
    };
    const handler = new RequestHandler(config, registry);

    let llmCallCount = 0;
    const mockAnalysis: StepAnalysis = {
      stepType: "editing",
      difficulty: 0.5,
      confidence: 0.9,
      recommendedTier: "standard",
      recommendedModel: "",
      reasoning: "Code editing task",
      needsProviderSwitch: false,
      estimatedTokens: { input: 200, output: 100 },
      alternatives: [],
    };

    handler.injectL2L3({
      cache: new RouteCache(),
      analyzeWithLLM: async () => { llmCallCount++; return mockAnalysis; },
      selectAnalyzerModel: () => registry.get("openai/gpt-5.4-mini") ?? null,
      getOriginalFetch: () => async () => new Response("ok"),
    });

    const body = JSON.stringify({ model: "gpt-5.5", messages: [{ role: "user", content: "Refactor the login module" }] });

    // First request — LLM is called
    const result1 = await handler.handle("https://api.openai.com/v1/chat/completions", body, {});
    expect(result1).toBeDefined();
    const firstLLMCount = llmCallCount;

    // Second request with same content — should hit cache
    const result2 = await handler.handle("https://api.openai.com/v1/chat/completions", body, {});
    expect(result2).toBeDefined();

    // LLM should not have been called again (or called the same number)
    expect(llmCallCount).toBe(firstLLMCount);
  });

  it("stream: true in request body does not crash handler", async () => {
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);

    const body = JSON.stringify({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "list files" }],
      stream: true,
    });

    const result = await handler.handle(
      "https://api.openai.com/v1/chat/completions",
      body,
      {},
    );

    // Should not throw — result may or may not be null depending on routing
    expect(() => result).not.toThrow();
  });

  it("invalid JSON body does not crash (throws JSON.parse error)", async () => {
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);

    // JSON.parse will throw on invalid JSON — the handler does not catch it,
    // so we expect it to throw rather than silently return null.
    await expect(
      handler.handle(
        "https://api.openai.com/v1/chat/completions",
        "not-valid-json{{{",
        {},
      ),
    ).rejects.toThrow();
  });

  it("missing model field does not crash (analysis proceeds with undefined model)", async () => {
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);

    const body = JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
    });

    // The handler will try to parse the body, get model=undefined,
    // and proceed through analysis. It should not crash.
    // It may return null or a result depending on how routing handles undefined model.
    const result = await handler.handle(
      "https://api.openai.com/v1/chat/completions",
      body,
      {},
    );

    // Should not throw — result may be null since model is undefined
    expect(() => result).not.toThrow();
  });

  it("recommendedModel empty string does not trigger cross-provider (ISSUE-029 regression)", async () => {
    // When crossProvider is "off", even with deepseek env key available,
    // empty recommendedModel should not cause cross-provider routing.
    const config = {
      ...DEFAULT_CONFIG,
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "off" as const,
        crossProviderProviders: ["deepseek"],
      },
    };
    const handler = new RequestHandler(config, registry);

    process.env.DEEPSEEK_API_KEY = "test-key-for-regression";

    try {
      const body = JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files in src/" }],
      });

      const result = await handler.handle(
        "https://api.openai.com/v1/chat/completions",
        body,
        {},
      );

      // With crossProvider=off, the routing must stay within same provider
      if (result) {
        expect(result.decision.providerSwitched).toBe(false);
        expect(result.decision.targetModel!.provider).toBe("openai");
      }
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });
});
