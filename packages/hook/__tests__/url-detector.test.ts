import { describe, it, expect } from "vitest";
import { LLMDetector } from "../src/url-detector.js";
import { ModelRegistry } from "@agentfare/models";

describe("LLMDetector", () => {
  const registry = new ModelRegistry();
  const detector = new LLMDetector(registry);

  it("should detect OpenAI chat completions", () => {
    expect(detector.isLLMApiCall("https://api.openai.com/v1/chat/completions")).toBe(true);
  });

  it("should detect Anthropic messages", () => {
    expect(detector.isLLMApiCall("https://api.anthropic.com/v1/messages")).toBe(true);
  });

  it("should detect DeepSeek API", () => {
    expect(detector.isLLMApiCall("https://api.deepseek.com/chat/completions")).toBe(true);
  });

  it("should detect Zhipu OpenAI-compatible endpoint", () => {
    expect(detector.isLLMApiCall("https://open.bigmodel.cn/api/paas/v4/chat/completions")).toBe(true);
  });

  it("should detect Zhipu Anthropic-compatible endpoint", () => {
    expect(detector.isLLMApiCall("https://open.bigmodel.cn/api/anthropic/v1/messages")).toBe(true);
  });

  it("should detect Google Gemini endpoint", () => {
    expect(detector.isLLMApiCall("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")).toBe(true);
  });

  it("should not detect non-LLM URLs", () => {
    expect(detector.isLLMApiCall("https://api.github.com/repos")).toBe(false);
    expect(detector.isLLMApiCall("https://google.com")).toBe(false);
    expect(detector.isLLMApiCall("https://registry.npmjs.org")).toBe(false);
  });

  it("should not detect unknown host even with LLM path", () => {
    expect(detector.isLLMApiCall("https://unknown.example.com/v1/chat/completions")).toBe(false);
  });

  it("should detect custom model providers", () => {
    const customRegistry = new ModelRegistry([
      {
        id: "custom/my-model",
        provider: "custom",
        displayName: "My Model",
        tier: "standard",
        pricing: { inputPerMillion: 1, outputPerMillion: 2, cacheHitPerMillion: null, currency: "USD" as const },
        capabilities: { codeGeneration: 7, codeReview: 6, planning: 6, reasoning: 6, toolUse: 7, contextWindow: 128, maxOutputTokens: 16, streaming: true, jsonMode: true },
        routing: { avgLatencyMs: 500, tokensPerSecond: 100, availability: 0.99, region: ["us" as const] },
        api: { protocol: "openai" as const, baseUrl: "https://my-llm.example.com/v1", modelId: "my-model" },
      },
    ]);
    const customDetector = new LLMDetector(customRegistry);
    expect(customDetector.isLLMApiCall("https://my-llm.example.com/v1/chat/completions")).toBe(true);
  });
});
