import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { selectAnalyzerModel } from "../../src/analyzer/auto-model-selector.js";
import type { ModelRegistry, ModelEntry, ModelTier } from "@agentfare/models";

function makeModelEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: overrides.id ?? "openai/gpt-5.3-codex-spark",
    provider: overrides.provider ?? "openai",
    displayName: overrides.displayName ?? "GPT 5.3 Codex Spark",
    tier: overrides.tier ?? "fast",
    pricing: overrides.pricing ?? {
      inputPerMillion: 0.15,
      outputPerMillion: 0.60,
      cacheHitPerMillion: null,
      currency: "USD",
    },
    capabilities: overrides.capabilities ?? {
      codeGeneration: 7,
      codeReview: 6,
      planning: 5,
      reasoning: 6,
      toolUse: 8,
      contextWindow: 128,
      maxOutputTokens: 16,
      streaming: true,
      jsonMode: true,
    },
    routing: overrides.routing ?? {
      avgLatencyMs: 200,
      tokensPerSecond: 80,
      availability: 0.999,
      region: ["us"],
    },
    api: overrides.api ?? {
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-5.3-codex-spark",
    },
  };
}

function makeMockRegistry(models: ModelEntry[]): ModelRegistry {
  const modelMap = new Map(models.map((m) => [m.id, m]));
  return {
    get: (id: string) => modelMap.get(id),
    getAll: () => Array.from(modelMap.values()),
    getByProvider: (provider: string) =>
      Array.from(modelMap.values()).filter((m) => m.provider === provider),
    getByTier: (tier: ModelTier) =>
      Array.from(modelMap.values()).filter((m) => m.tier === tier),
    findCheapest: (provider: string, tier: ModelTier) => {
      const candidates = Array.from(modelMap.values())
        .filter((m) => m.provider === provider && m.tier === tier);
      if (candidates.length === 0) return undefined;
      return candidates.reduce((best, m) =>
        m.pricing.outputPerMillion < best.pricing.outputPerMillion ? m : best
      );
    },
    detectProvider: () => null,
    addCustomModel: () => {},
  } as unknown as ModelRegistry;
}

describe("selectAnalyzerModel", () => {
  const originalOpenaiKey = process.env.OPENAI_API_KEY;
  const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    if (originalOpenaiKey !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenaiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (originalDeepseekKey !== undefined) {
      process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it("returns the cheapest fast model with API key", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";

    const models = [
      makeModelEntry({
        id: "openai/gpt-5.3-codex-spark",
        tier: "fast",
        provider: "openai",
        pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60, cacheHitPerMillion: null, currency: "USD" },
      }),
      makeModelEntry({
        id: "openai/gpt-5.4",
        tier: "fast",
        provider: "openai",
        pricing: { inputPerMillion: 0.30, outputPerMillion: 1.20, cacheHitPerMillion: null, currency: "USD" },
        api: { protocol: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-5.4" },
        displayName: "GPT 5.4",
      }),
    ];

    const registry = makeMockRegistry(models);
    const result = selectAnalyzerModel(registry);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("openai/gpt-5.3-codex-spark");
  });

  it("returns null when no API key is set", () => {
    const models = [
      makeModelEntry({
        id: "openai/gpt-5.3-codex-spark",
        tier: "fast",
        provider: "openai",
      }),
    ];

    const registry = makeMockRegistry(models);
    const result = selectAnalyzerModel(registry);

    expect(result).toBeNull();
  });

  it("returns null when no fast tier models exist", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";

    const models = [
      makeModelEntry({
        id: "openai/gpt-5.5",
        tier: "powerful",
        provider: "openai",
        api: { protocol: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-5.5" },
        displayName: "GPT 5.5",
      }),
    ];

    const registry = makeMockRegistry(models);
    const result = selectAnalyzerModel(registry);

    expect(result).toBeNull();
  });

  it("picks the cheapest among multiple fast models with keys", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.DEEPSEEK_API_KEY = "ds-test-key";

    const models = [
      makeModelEntry({
        id: "openai/gpt-5.3-codex-spark",
        tier: "fast",
        provider: "openai",
        pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60, cacheHitPerMillion: null, currency: "USD" },
      }),
      makeModelEntry({
        id: "deepseek/deepseek-chat",
        tier: "fast",
        provider: "deepseek",
        pricing: { inputPerMillion: 0.07, outputPerMillion: 0.28, cacheHitPerMillion: null, currency: "USD" },
        api: { protocol: "openai", baseUrl: "https://api.deepseek.com/v1", modelId: "deepseek-chat" },
        displayName: "DeepSeek Chat",
      }),
    ];

    const registry = makeMockRegistry(models);
    const result = selectAnalyzerModel(registry);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("deepseek/deepseek-chat");
  });

  it("ignores fast models without API key", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    // deepseek key is NOT set

    const models = [
      makeModelEntry({
        id: "openai/gpt-5.3-codex-spark",
        tier: "fast",
        provider: "openai",
        pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60, cacheHitPerMillion: null, currency: "USD" },
      }),
      makeModelEntry({
        id: "deepseek/deepseek-chat",
        tier: "fast",
        provider: "deepseek",
        pricing: { inputPerMillion: 0.07, outputPerMillion: 0.28, cacheHitPerMillion: null, currency: "USD" },
        api: { protocol: "openai", baseUrl: "https://api.deepseek.com/v1", modelId: "deepseek-chat" },
        displayName: "DeepSeek Chat",
      }),
    ];

    const registry = makeMockRegistry(models);
    const result = selectAnalyzerModel(registry);

    // Should pick openai since deepseek has no key, even though deepseek is cheaper
    expect(result).not.toBeNull();
    expect(result!.id).toBe("openai/gpt-5.3-codex-spark");
  });
});
