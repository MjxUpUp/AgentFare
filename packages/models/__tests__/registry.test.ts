import { describe, it, expect } from "vitest";
import { ModelRegistry } from "../src/registry.js";

describe("ModelRegistry", () => {
  const registry = new ModelRegistry();

  it("should get model by id", () => {
    const model = registry.get("openai/gpt-5.4");
    expect(model).toBeDefined();
    expect(model!.id).toBe("openai/gpt-5.4");
    expect(model!.provider).toBe("openai");
    expect(model!.tier).toBe("standard");
  });

  it("should return undefined for unknown model", () => {
    expect(registry.get("unknown/model")).toBeUndefined();
  });

  it("should list models by provider", () => {
    const openaiModels = registry.getByProvider("openai");
    expect(openaiModels.length).toBeGreaterThanOrEqual(3);
    expect(openaiModels.every((m) => m.provider === "openai")).toBe(true);
  });

  it("should list models by tier", () => {
    const fastModels = registry.getByTier("fast");
    expect(fastModels.length).toBeGreaterThanOrEqual(2);
    expect(fastModels.every((m) => m.tier === "fast")).toBe(true);
  });

  it("should find cheapest model for a provider and tier", () => {
    const cheapest = registry.findCheapest("openai", "fast");
    expect(cheapest).toBeDefined();
    expect(cheapest!.id).toBe("openai/gpt-5.4-mini");
  });

  it("should detect provider from URL", () => {
    expect(registry.detectProvider("https://api.openai.com/v1/chat/completions")).toBe("openai");
    expect(registry.detectProvider("https://api.anthropic.com/v1/messages")).toBe("anthropic");
    expect(registry.detectProvider("https://unknown.api.com/v1")).toBeNull();
  });

  it("should add custom model", () => {
    registry.addCustomModel({
      id: "custom/my-model",
      provider: "custom",
      displayName: "My Model",
      tier: "fast",
      pricing: { inputPerMillion: 0, outputPerMillion: 0, cacheHitPerMillion: 0, currency: "USD" },
      capabilities: { codeGeneration: 5, codeReview: 5, planning: 5, reasoning: 5, toolUse: 5, contextWindow: 32, maxOutputTokens: 4, streaming: true, jsonMode: false },
      routing: { avgLatencyMs: 100, tokensPerSecond: 200, availability: 1, region: ["us"] },
      api: { protocol: "openai", baseUrl: "http://localhost:8080/v1", modelId: "my-model" },
    });
    expect(registry.get("custom/my-model")).toBeDefined();
  });
});
