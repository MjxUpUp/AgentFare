import { describe, it, expect } from "vitest";
import { isLLMApiCall } from "../src/url-detector.js";

describe("isLLMApiCall", () => {
  it("should detect OpenAI chat completions", () => {
    expect(isLLMApiCall("https://api.openai.com/v1/chat/completions")).toBe(true);
  });

  it("should detect Anthropic messages", () => {
    expect(isLLMApiCall("https://api.anthropic.com/v1/messages")).toBe(true);
  });

  it("should detect DeepSeek API", () => {
    expect(isLLMApiCall("https://api.deepseek.com/chat/completions")).toBe(true);
  });

  it("should not detect non-LLM URLs", () => {
    expect(isLLMApiCall("https://api.github.com/repos")).toBe(false);
    expect(isLLMApiCall("https://google.com")).toBe(false);
    expect(isLLMApiCall("https://registry.npmjs.org")).toBe(false);
  });
});
