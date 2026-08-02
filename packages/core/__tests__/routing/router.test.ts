import { describe, it, expect } from "vitest";
import { Router } from "../../src/routing/router.js";
import { ModelRegistry } from "@agentfare/models";
import type { AgentFareConfig } from "../../src/config/types.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { StepAnalysis } from "../../src/analyzer/types.js";

function makeAnalysis(overrides: Partial<StepAnalysis> = {}): StepAnalysis {
  return {
    stepType: "simple_tool_use",
    difficulty: 0.1,
    confidence: 0.95,
    recommendedTier: "fast",
    recommendedModel: "",
    reasoning: "test",
    needsProviderSwitch: false,
    estimatedTokens: { input: 100, output: 50 },
    alternatives: [],
    ...overrides,
  };
}

describe("Router", () => {
  const registry = new ModelRegistry();

  function makeRouter(config: Partial<AgentFareConfig> = {}): Router {
    const merged = {
      ...DEFAULT_CONFIG,
      ...config,
      routing: { ...DEFAULT_CONFIG.routing, ...config.routing },
    };
    return new Router(merged, registry);
  }

  it("should route to same provider fast model when step is easy", () => {
    const router = makeRouter();
    const analysis = makeAnalysis({
      stepType: "simple_tool_use",
      difficulty: 0.1,
      confidence: 0.95,
      recommendedTier: "fast",
      recommendedModel: "",
      reasoning: "simple tool call",
    });

    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    expect(result.targetModel!.provider).toBe("openai");
    expect(result.targetModel!.tier).toBe("fast");
    expect(result.providerSwitched).toBe(false);
  });

  it("should route to same provider standard model when tier is standard", () => {
    const router = makeRouter();
    const analysis = makeAnalysis({
      stepType: "editing",
      difficulty: 0.5,
      confidence: 0.8,
      recommendedTier: "standard",
      recommendedModel: "",
      reasoning: "code editing",
    });

    const result = router.decide("https://api.anthropic.com/v1/messages", analysis);
    expect(result.targetModel!.provider).toBe("anthropic");
    expect(result.targetModel!.tier).toBe("standard");
    expect(result.providerSwitched).toBe(false);
  });

  it("should NOT cross provider when crossProvider is off", () => {
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "off",
      },
    });
    const analysis = makeAnalysis({
      stepType: "exploration",
      difficulty: 0.2,
      confidence: 0.9,
      recommendedTier: "fast",
      recommendedModel: "deepseek/v4-flash",
      reasoning: "exploration",
    });

    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    expect(result.targetModel!.provider).toBe("openai");
    expect(result.providerSwitched).toBe(false);
  });

  it("should cross provider when opt-in and provider is whitelisted", () => {
    process.env.DEEPSEEK_API_KEY = "test-key";

    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "opt-in",
        crossProviderProviders: ["deepseek"],
      },
    });

    const analysis = makeAnalysis({
      stepType: "exploration",
      difficulty: 0.2,
      confidence: 0.9,
      recommendedTier: "fast",
      recommendedModel: "deepseek/v4-flash",
      reasoning: "exploration - cheap model",
    });

    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    expect(result.targetModel!.provider).toBe("deepseek");
    expect(result.providerSwitched).toBe(true);
    expect(result.apiKey).toBe("test-key");

    delete process.env.DEEPSEEK_API_KEY;
  });

  it("should fallback to same provider when opt-in key is missing", () => {
    delete process.env.DEEPSEEK_API_KEY;

    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "opt-in",
        crossProviderProviders: ["deepseek"],
      },
    });

    const analysis = makeAnalysis({
      stepType: "exploration",
      difficulty: 0.2,
      confidence: 0.9,
      recommendedTier: "fast",
      recommendedModel: "deepseek/v4-flash",
      reasoning: "exploration",
    });

    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    expect(result.targetModel!.provider).toBe("openai");
    expect(result.providerSwitched).toBe(false);
  });

  it("should return null targetModel for unrecognized URL", () => {
    const router = makeRouter();
    const analysis = makeAnalysis();

    const result = router.decide("https://unknown.example.com/api/chat", analysis);
    expect(result.targetModel).toBeNull();
    expect(result.reasoning).toContain("无法识别 provider");
  });

  it("should use cost-optimal strategy to pick cheapest model", () => {
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        defaultStrategy: "cost-optimal",
      },
    });
    const analysis = makeAnalysis({
      recommendedTier: "fast",
      recommendedModel: "",
    });

    // OpenAI has two fast models: gpt-5.3-codex-spark ($0.35/M output) and gpt-5.4-mini ($4.50/M output)
    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    expect(result.targetModel!.provider).toBe("openai");
    expect(result.targetModel!.id).toBe("openai/gpt-5.3-codex-spark");
  });

  it("should use quality-first strategy to pick best model", () => {
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        defaultStrategy: "quality-first",
      },
    });
    const analysis = makeAnalysis({
      recommendedTier: "fast",
      recommendedModel: "",
    });

    // OpenAI fast models: codex-spark (codeGeneration: 7) vs gpt-5.4-mini (codeGeneration: 6)
    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    expect(result.targetModel!.provider).toBe("openai");
    expect(result.targetModel!.id).toBe("openai/gpt-5.3-codex-spark");
  });

  it("should route via enterprise when enterprise mode and config exists", () => {
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "enterprise",
        enterpriseProviders: {
          deepseek: {
            baseUrl: "https://enterprise.deepseek.com",
            authMode: "corporate-sso",
            allowedTiers: ["fast", "standard"],
          },
        },
      },
    });

    const analysis = makeAnalysis({
      recommendedTier: "fast",
      recommendedModel: "deepseek/v4-flash",
      reasoning: "cheap exploration",
    });

    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    expect(result.targetModel!.provider).toBe("deepseek");
    expect(result.providerSwitched).toBe(true);
    expect(result.enterpriseConfig).toBeDefined();
    expect(result.enterpriseConfig!.authMode).toBe("corporate-sso");
  });

  it("should fallback when enterprise tier is not allowed", () => {
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "enterprise",
        enterpriseProviders: {
          deepseek: {
            baseUrl: "https://enterprise.deepseek.com",
            authMode: "corporate-sso",
            allowedTiers: ["powerful"],
          },
        },
      },
    });

    const analysis = makeAnalysis({
      recommendedTier: "fast",
      recommendedModel: "deepseek/v4-flash",
      reasoning: "exploration",
    });

    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    // Tier "fast" not allowed, falls back to same provider
    expect(result.targetModel!.provider).toBe("openai");
    expect(result.providerSwitched).toBe(false);
  });

  // M1: every decision is enriched with the selection tier and same-tier
  // failover candidates, so transport layers and onRouting can observe them.
  it("enriches decisions with tier and same-tier failover candidates (M1)", () => {
    const router = makeRouter(); // crossProvider off → same-provider route
    const analysis = makeAnalysis({ recommendedTier: "fast", reasoning: "easy" });
    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    expect(result.targetModel).not.toBeNull();
    expect(result.tier).toBe("fast");
    // failoverCandidates excludes the chosen target and is capped.
    expect(Array.isArray(result.failoverCandidates)).toBe(true);
    expect(result.failoverCandidates!.length).toBeLessThanOrEqual(5);
    expect(result.failoverCandidates!.every((m) => m.tier === "fast")).toBe(true);
    expect(result.failoverCandidates!.map((m) => m.id)).not.toContain(result.targetModel!.id);
  });

  // M1: null-target decisions still carry the tier but no candidates.
  it("enriches null-target decisions with tier but no candidates (M1)", () => {
    const router = makeRouter();
    const result = router.decide("https://unrecognized.example.com/v1", makeAnalysis({ recommendedTier: "standard" }));
    expect(result.targetModel).toBeNull();
    expect(result.tier).toBe("standard");
    expect(result.failoverCandidates).toBeUndefined();
  });

  // --- cc-switch 手动锁定（lockMode）---
  it("lockMode=model locks to activeModel across providers (cc-switch)", () => {
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "off", // 锁定必须优先生效，即使策略关跨 provider
        lockMode: "model",
        activeModel: "deepseek/v4-pro",
      },
    });
    const analysis = makeAnalysis({ recommendedTier: "fast", recommendedModel: "" });
    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    expect(result.targetModel!.id).toBe("deepseek/v4-pro");
    expect(result.targetModel!.provider).toBe("deepseek");
    expect(result.providerSwitched).toBe(true); // openai → deepseek
    expect(result.reasoning).toContain("lockMode=model");
  });

  it("lockMode=model with unknown activeModel silently falls back to auto routing", () => {
    const router = makeRouter({
      routing: { ...DEFAULT_CONFIG.routing, lockMode: "model", activeModel: "nonexistent/model" },
    });
    const result = router.decide(
      "https://api.openai.com/v1/chat/completions",
      makeAnalysis({ recommendedTier: "fast" }),
    );
    // 锁定目标缺失 → 降级自动同 provider 路由，绝不返回 null 把请求打成 404
    expect(result.targetModel).not.toBeNull();
    expect(result.targetModel!.provider).toBe("openai");
  });

  it("lockMode=provider locks to activeProvider (picks tier model within provider)", () => {
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "off",
        lockMode: "provider",
        activeProvider: "anthropic",
      },
    });
    const result = router.decide(
      "https://api.openai.com/v1/chat/completions",
      makeAnalysis({ recommendedTier: "standard" }),
    );
    expect(result.targetModel!.provider).toBe("anthropic");
    expect(result.providerSwitched).toBe(true); // openai → anthropic
    expect(result.reasoning).toContain("lockMode=provider");
  });

  it("lockMode=auto (default) keeps automatic routing unchanged", () => {
    const router = makeRouter(); // DEFAULT_CONFIG.routing.lockMode === "auto"
    const result = router.decide(
      "https://api.openai.com/v1/chat/completions",
      makeAnalysis({ recommendedTier: "fast" }),
    );
    expect(result.targetModel!.provider).toBe("openai");
    expect(result.providerSwitched).toBe(false);
  });

  it("lockMode reports crossProviderMode='lock' so telemetry never contradicts providerSwitched (L2)", () => {
    // L2: 锁定态短路了 crossProvider 策略，crossProviderMode 应报 "lock" 而非 config
    // 值。否则 providerSwitched=true 与 crossProviderMode='off' 自相矛盾。字段语义
    // 分层：crossProviderMode=配置策略镜像（自动路由）/ "lock"（手动锁定短路），
    // providerSwitched=实际是否跨 provider，reasoning=锁定态标注。
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "off", // 即便策略关跨 provider，锁定仍跨 provider
        lockMode: "model",
        activeModel: "deepseek/v4-pro",
      },
    });
    const result = router.decide(
      "https://api.openai.com/v1/chat/completions",
      makeAnalysis({ recommendedTier: "fast", recommendedModel: "" }),
    );
    expect(result.providerSwitched).toBe(true); // openai → deepseek
    expect(result.crossProviderMode).toBe("lock");
  });
});

describe("Router — enterprise and cross-provider integration", () => {
  const registry = new ModelRegistry();

  function makeRouter(config: Partial<AgentFareConfig> = {}): Router {
    const merged = {
      ...DEFAULT_CONFIG,
      ...config,
      routing: { ...DEFAULT_CONFIG.routing, ...config.routing },
    };
    return new Router(merged, registry);
  }

  it("enterprise mode: allowedTiers restriction enforced (target tier not in allowedTiers → fallback)", () => {
    // Enterprise config only allows "powerful" tier, but analysis recommends "fast"
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "enterprise",
        crossProviderProviders: ["deepseek"],
        enterpriseProviders: {
          deepseek: {
            baseUrl: "https://enterprise.deepseek.com",
            authMode: "corporate-sso",
            allowedTiers: ["powerful"],  // Only powerful allowed
          },
        },
      },
    });

    const analysis = makeAnalysis({
      recommendedTier: "fast",  // Not in allowedTiers
      recommendedModel: "deepseek/v4-flash",  // fast tier
      reasoning: "fast task",
    });

    const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
    // "fast" tier is not in allowedTiers ["powerful"], so enterprise rejects it
    // Falls back to same-provider model
    expect(result.targetModel!.provider).toBe("openai");
    expect(result.providerSwitched).toBe(false);
  });

  it("enterprise mode: enterprise crossProvider 'off' overrides user 'opt-in'", () => {
    // The router config has crossProvider: "off", which should prevent any cross-provider routing
    // even if the analysis recommends a cross-provider model
    const router = makeRouter({
      routing: {
        ...DEFAULT_CONFIG.routing,
        crossProvider: "off",  // Enterprise sets "off"
        crossProviderProviders: ["deepseek"],
      },
    });

    process.env.DEEPSEEK_API_KEY = "test-key";

    try {
      const analysis = makeAnalysis({
        recommendedTier: "fast",
        recommendedModel: "deepseek/v4-flash",  // Cross-provider recommendation
        reasoning: "user opted in but enterprise says off",
      });

      const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
      // crossProvider=off must override any user preference
      expect(result.providerSwitched).toBe(false);
      expect(result.crossProviderMode).toBe("off");
      // Should route to same provider
      expect(result.targetModel!.provider).toBe("openai");
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it("recommendedModel non-empty triggers cross-provider branch (ISSUE-029 regression)", () => {
    process.env.DEEPSEEK_API_KEY = "regression-test-key";

    try {
      const router = makeRouter({
        routing: {
          ...DEFAULT_CONFIG.routing,
          crossProvider: "opt-in",
          crossProviderProviders: ["deepseek"],
        },
      });

      const analysis = makeAnalysis({
        recommendedTier: "fast",
        recommendedModel: "deepseek/v4-flash",  // Non-empty, cross-provider
        reasoning: "ISSUE-029 regression test",
      });

      const result = router.decide("https://api.openai.com/v1/chat/completions", analysis);
      // Should cross to deepseek since recommendedModel is set and provider differs
      expect(result.targetModel!.provider).toBe("deepseek");
      expect(result.providerSwitched).toBe(true);
      expect(result.apiKey).toBe("regression-test-key");
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });
});
