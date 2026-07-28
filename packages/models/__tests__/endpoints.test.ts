import { describe, it, expect } from "vitest";
import {
  getAllEndpoints,
  findEndpointForProtocol,
  hasEndpointForProtocol,
  resolveAuthScheme,
  BUILTIN_MODELS,
} from "@agentfare/models";
import type { ModelEntry, ModelApi } from "@agentfare/models";

const makeModel = (api: ModelApi, endpoints?: ModelApi[]): ModelEntry => ({
  id: "test/m",
  provider: "custom",
  displayName: "T",
  tier: "fast",
  pricing: { inputPerMillion: 1, outputPerMillion: 1, cacheHitPerMillion: null, currency: "USD" },
  capabilities: { codeGeneration: 1, codeReview: 1, planning: 1, reasoning: 1, toolUse: 1, contextWindow: 1, maxOutputTokens: 1, streaming: true, jsonMode: true },
  routing: { avgLatencyMs: 1, tokensPerSecond: 1, availability: 1, region: ["global"] },
  api,
  endpoints,
});

describe("getAllEndpoints", () => {
  it("returns [api] when no extra endpoints", () => {
    const m = makeModel({ protocol: "openai", baseUrl: "u", modelId: "m" });
    expect(getAllEndpoints(m)).toHaveLength(1);
    expect(getAllEndpoints(m)[0].baseUrl).toBe("u");
  });

  it("concatenates api first then endpoints", () => {
    const m = makeModel(
      { protocol: "openai", baseUrl: "o", modelId: "m" },
      [{ protocol: "anthropic", baseUrl: "a", modelId: "m" }],
    );
    expect(getAllEndpoints(m).map((e) => e.protocol)).toEqual(["openai", "anthropic"]);
  });
});

describe("findEndpointForProtocol", () => {
  it("matches the requested protocol", () => {
    const m = makeModel(
      { protocol: "openai", baseUrl: "o", modelId: "m" },
      [{ protocol: "anthropic", baseUrl: "a", modelId: "m" }],
    );
    expect(findEndpointForProtocol(m, "anthropic").baseUrl).toBe("a");
    expect(findEndpointForProtocol(m, "openai").baseUrl).toBe("o");
  });

  it("falls back to primary api when no match", () => {
    const m = makeModel({ protocol: "openai", baseUrl: "o", modelId: "m" });
    expect(findEndpointForProtocol(m, "anthropic").baseUrl).toBe("o");
  });
});

describe("hasEndpointForProtocol", () => {
  it("true when protocol exists in api or endpoints", () => {
    const m = makeModel(
      { protocol: "openai", baseUrl: "o", modelId: "m" },
      [{ protocol: "anthropic", baseUrl: "a", modelId: "m" }],
    );
    expect(hasEndpointForProtocol(m, "anthropic")).toBe(true);
    expect(hasEndpointForProtocol(m, "openai")).toBe(true);
  });

  it("false when protocol absent", () => {
    const m = makeModel({ protocol: "openai", baseUrl: "o", modelId: "m" });
    expect(hasEndpointForProtocol(m, "anthropic")).toBe(false);
  });
});

describe("resolveAuthScheme", () => {
  it("uses explicit authScheme when set", () => {
    expect(resolveAuthScheme({ protocol: "anthropic", baseUrl: "a", modelId: "m", authScheme: "bearer" })).toBe("bearer");
  });

  it("derives x-api-key for anthropic when unset", () => {
    expect(resolveAuthScheme({ protocol: "anthropic", baseUrl: "a", modelId: "m" })).toBe("x-api-key");
  });

  it("derives bearer for openai when unset", () => {
    expect(resolveAuthScheme({ protocol: "openai", baseUrl: "a", modelId: "m" })).toBe("bearer");
  });
});

describe("builtin multi-endpoint models (方案A)", () => {
  it("DeepSeek v4-pro/v4-flash expose an anthropic endpoint with x-api-key", () => {
    for (const id of ["deepseek/v4-pro", "deepseek/v4-flash"]) {
      const m = BUILTIN_MODELS.find((x) => x.id === id)!;
      expect(hasEndpointForProtocol(m, "anthropic"), id).toBe(true);
      const ep = findEndpointForProtocol(m, "anthropic");
      expect(ep.baseUrl).toBe("https://api.deepseek.com/anthropic");
      expect(resolveAuthScheme(ep)).toBe("x-api-key");
    }
  });

  it("Kimi exposes an anthropic endpoint with bearer auth", () => {
    const kimi = BUILTIN_MODELS.find((m) => m.id === "moonshot/kimi-k2.6")!;
    expect(hasEndpointForProtocol(kimi, "anthropic")).toBe(true);
    const ep = findEndpointForProtocol(kimi, "anthropic");
    expect(ep.baseUrl).toBe("https://api.moonshot.cn/anthropic");
    expect(resolveAuthScheme(ep)).toBe("bearer");
  });

  it("Zhipu exposes an anthropic endpoint", () => {
    const glm = BUILTIN_MODELS.find((m) => m.id === "zhipu/glm-5")!;
    expect(hasEndpointForProtocol(glm, "anthropic")).toBe(true);
    expect(findEndpointForProtocol(glm, "anthropic").baseUrl).toBe("https://open.bigmodel.cn/api/anthropic");
  });

  it("pure-openai models have no anthropic endpoint", () => {
    const gpt = BUILTIN_MODELS.find((m) => m.id === "openai/gpt-5.5")!;
    expect(hasEndpointForProtocol(gpt, "anthropic")).toBe(false);
  });
});
