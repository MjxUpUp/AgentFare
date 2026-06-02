import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tryCrossProviderOptIn } from "../../src/routing/cross-provider.js";
import type { ModelRegistry, ModelEntry, ModelTier } from "@agentfare/models";
import type { RoutingConfig } from "../../src/config/types.js";

function makeModelEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: overrides.id ?? "deepseek/deepseek-chat",
    provider: overrides.provider ?? "deepseek",
    displayName: overrides.displayName ?? "DeepSeek Chat",
    tier: overrides.tier ?? "fast",
    pricing: overrides.pricing ?? {
      inputPerMillion: 0.07,
      outputPerMillion: 0.28,
      cacheHitPerMillion: null,
      currency: "USD",
    },
    capabilities: {
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
    routing: {
      avgLatencyMs: 300,
      tokensPerSecond: 60,
      availability: 0.99,
      region: ["cn"],
    },
    api: overrides.api ?? {
      protocol: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      modelId: "deepseek-chat",
    },
  };
}

function makeMockRegistry(model: ModelEntry | null): ModelRegistry {
  return {
    getByProvider: () => model ? [model] : [],
    getByTier: () => model ? [model] : [],
    findCheapest: (_provider: string, _tier: ModelTier) => model,
    get: () => undefined,
    getAll: () => model ? [model] : [],
    detectProvider: () => null,
    addCustomModel: () => {},
  } as unknown as ModelRegistry;
}

function makeRoutingConfig(overrides: Partial<RoutingConfig> = {}): RoutingConfig {
  return {
    defaultStrategy: overrides.defaultStrategy ?? "cost-optimal",
    analyzerModel: overrides.analyzerModel ?? "openai/gpt-5.3-codex-spark",
    cacheResults: overrides.cacheResults ?? true,
    crossProvider: overrides.crossProvider ?? "opt-in",
    crossProviderProviders: overrides.crossProviderProviders ?? ["deepseek"],
    enterpriseProviders: overrides.enterpriseProviders ?? {},
  };
}

describe("tryCrossProviderOptIn", () => {
  const originalDeepseekKey = process.env.DEEPSEEK_API_KEY;
  const originalOpenaiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalDeepseekKey !== undefined) {
      process.env.DEEPSEEK_API_KEY = originalDeepseekKey;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
    if (originalOpenaiKey !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenaiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("returns model and apiKey when provider is in whitelist and key exists", () => {
    process.env.DEEPSEEK_API_KEY = "ds-test-key";
    const model = makeModelEntry();
    const registry = makeMockRegistry(model);
    const routing = makeRoutingConfig({ crossProviderProviders: ["deepseek"] });

    const result = tryCrossProviderOptIn(registry, "deepseek", "fast", routing);

    expect(result).not.toBeNull();
    expect(result!.model.id).toBe("deepseek/deepseek-chat");
    expect(result!.apiKey).toBe("ds-test-key");
  });

  it("returns null when provider is not in whitelist", () => {
    process.env.DEEPSEEK_API_KEY = "ds-test-key";
    const model = makeModelEntry();
    const registry = makeMockRegistry(model);
    const routing = makeRoutingConfig({ crossProviderProviders: ["openai"] });

    const result = tryCrossProviderOptIn(registry, "deepseek", "fast", routing);

    expect(result).toBeNull();
  });

  it("returns null when provider is in whitelist but no API key", () => {
    // DEEPSEEK_API_KEY is not set
    const model = makeModelEntry();
    const registry = makeMockRegistry(model);
    const routing = makeRoutingConfig({ crossProviderProviders: ["deepseek"] });

    const result = tryCrossProviderOptIn(registry, "deepseek", "fast", routing);

    expect(result).toBeNull();
  });

  it("returns null when provider has key but no matching tier model", () => {
    process.env.DEEPSEEK_API_KEY = "ds-test-key";
    // Registry returns null for findCheapest (no matching model)
    const registry = makeMockRegistry(null);
    const routing = makeRoutingConfig({ crossProviderProviders: ["deepseek"] });

    const result = tryCrossProviderOptIn(registry, "deepseek", "powerful", routing);

    expect(result).toBeNull();
  });

  it("returns null with empty whitelist", () => {
    process.env.DEEPSEEK_API_KEY = "ds-test-key";
    const model = makeModelEntry();
    const registry = makeMockRegistry(model);
    const routing = makeRoutingConfig({ crossProviderProviders: [] });

    const result = tryCrossProviderOptIn(registry, "deepseek", "fast", routing);

    expect(result).toBeNull();
  });

  it("works with multiple providers in whitelist", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const model = makeModelEntry({
      id: "openai/gpt-5.3-codex-spark",
      provider: "openai",
      tier: "fast",
      api: { protocol: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-5.3-codex-spark" },
    });
    const registry = makeMockRegistry(model);
    const routing = makeRoutingConfig({ crossProviderProviders: ["deepseek", "openai"] });

    const result = tryCrossProviderOptIn(registry, "openai", "fast", routing);

    expect(result).not.toBeNull();
    expect(result!.model.id).toBe("openai/gpt-5.3-codex-spark");
    expect(result!.apiKey).toBe("sk-test-key");
  });
});
