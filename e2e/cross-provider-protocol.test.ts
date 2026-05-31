import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "@agentdispatch/hook/fetch-patch";
import { DEFAULT_CONFIG } from "@agentdispatch/core";
import { ModelRegistry } from "@agentdispatch/models";
import type { RequestHandler, HandleResult } from "@agentdispatch/hook/request-handler";
import { convertOpenAIToAnthropicRequest } from "@agentdispatch/hook/protocol/openai-to-anthropic";
import { convertAnthropicToOpenAIResponse } from "@agentdispatch/hook/protocol/anthropic-to-openai";

/**
 * E2E: Cross-provider protocol conversion tests.
 *
 * Tests the full pipeline when cross-provider routing involves a protocol
 * switch (OpenAI ↔ Anthropic). Verifies URL rewriting, auth header rewriting,
 * and protocol conversion functions work correctly together.
 */
describe("E2E: Cross-provider protocol conversion", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("should rewrite URL to Anthropic and set x-api-key when cross-routing from OpenAI to Claude", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
        headers: (init as any)?.headers,
      });
      // Return Anthropic-format response
      return new Response(
        JSON.stringify({
          id: "msg-test",
          type: "message",
          content: [{ type: "text", text: "done" }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: "end_turn",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const registry = new ModelRegistry();
    const claudeModel = registry.get("anthropic/claude-haiku-4-5")!;

    const mockHandler: RequestHandler = {
      handle: async () =>
        ({
          decision: {
            targetModel: claudeModel,
            providerSwitched: true,
            crossProviderMode: "opt-in" as const,
            apiKey: process.env.ANTHROPIC_API_KEY,
            reasoning: "跨 provider (opt-in): route to Anthropic",
          },
          modifiedBody: JSON.stringify({ model: claudeModel.api.modelId, messages: [] }),
          analysis: {
            stepType: "simple_tool_use",
            difficulty: 0.1,
            confidence: 0.9,
            recommendedTier: "fast",
            recommendedModel: claudeModel.id,
            reasoning: "fast task, cross to Anthropic",
            needsProviderSwitch: true,
            estimatedTokens: { input: 100, output: 50 },
            alternatives: [],
          },
          sessionId: "ad-test-protocol-1",
        }) as HandleResult,
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "format this code" },
        ],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const req = captured[0];

    // URL should be rewritten to Anthropic messages endpoint
    expect(req.url).toContain("anthropic.com");
    expect(req.url).toContain("/v1/messages");

    // Auth should switch from Bearer to x-api-key
    expect(req.headers?.Authorization).toBeFalsy();
    expect(req.headers?.["x-api-key"]).toBe("test-anthropic-key");
    expect(req.headers?.["anthropic-version"]).toBe("2023-06-01");
  });

  it("should NOT cross provider when mode is off, even with keys set", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({ url: typeof input === "string" ? input : "" });
      return new Response(JSON.stringify({ id: "test" }), { status: 200 });
    };

    // Use real RequestHandler with default config (crossProvider: "off")
    const registry = new ModelRegistry();
    // We need to import the real RequestHandler for this test
    const { RequestHandler } = await import("@agentdispatch/hook/request-handler");
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    uninstall = installFetchPatch({ handler });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    // Should stay on OpenAI (may be rewritten to cheaper OpenAI model but same provider)
    expect(captured[0].url).toContain("openai");
  });

  it("should rewrite URL to DeepSeek OpenAI-compatible endpoint when cross-routing from Anthropic", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
        headers: (init as any)?.headers,
      });
      return new Response(
        JSON.stringify({
          id: "test",
          object: "chat.completion",
          choices: [
            { index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
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
            reasoning: "跨 provider (opt-in): route to DeepSeek",
          },
          modifiedBody: JSON.stringify({ model: deepseekModel.api.modelId, messages: [] }),
          analysis: {
            stepType: "confirmation",
            difficulty: 0.1,
            confidence: 0.95,
            recommendedTier: "fast",
            recommendedModel: deepseekModel.id,
            reasoning: "confirmation, route to cheapest fast model",
            needsProviderSwitch: true,
            estimatedTokens: { input: 50, output: 20 },
            alternatives: [],
          },
          sessionId: "ad-test-protocol-3",
        }) as HandleResult,
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-opus-4-6",
        messages: [{ role: "user", content: "yes, proceed" }],
      }),
      headers: { "Content-Type": "application/json", "x-api-key": "test-anthropic-key" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const req = captured[0];

    // URL should be rewritten to DeepSeek (OpenAI-compatible endpoint)
    expect(req.url).toContain("deepseek.com");
    expect(req.url).toContain("/chat/completions");

    // Auth should use Bearer with DeepSeek key
    expect(req.headers?.Authorization).toContain("test-deepseek-key");
  });

  it("should use enterprise baseUrl instead of default when enterprise config provided", async () => {
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
            reasoning: "跨 provider (enterprise): corporate proxy",
          },
          modifiedBody: JSON.stringify({ model: deepseekModel.api.modelId, messages: [] }),
          analysis: {
            stepType: "exploration",
            difficulty: 0.2,
            confidence: 0.9,
            recommendedTier: "fast",
            recommendedModel: deepseekModel.id,
            reasoning: "enterprise fast exploration",
            needsProviderSwitch: true,
            estimatedTokens: { input: 100, output: 50 },
            alternatives: [],
          },
          sessionId: "ad-test-protocol-4",
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
    // Enterprise proxy URL should be used, not the default api.deepseek.com
    expect(captured[0].url).toContain("llm-proxy.company.internal");
    expect(captured[0].url).not.toContain("api.deepseek.com");
  });

  it("should correctly convert OpenAI request body to Anthropic format via protocol adapter", () => {
    // Unit-level verification of the protocol conversion function
    const openaiRequest = {
      model: "gpt-5.5",
      messages: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "format this code" },
        { role: "assistant", content: "Here is the formatted code:" },
        { role: "user", content: "looks good, thanks" },
      ],
      max_tokens: 1024,
      stream: false,
    };

    const result = convertOpenAIToAnthropicRequest(openaiRequest, "claude-haiku-4-5-20251001");

    expect(result.model).toBe("claude-haiku-4-5-20251001");
    expect(result.max_tokens).toBe(1024);
    expect(result.system).toBe("You are a helpful assistant");
    expect(result.messages).toHaveLength(3); // system excluded
    expect(result.messages[0]).toEqual({ role: "user", content: "format this code" });
    expect(result.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Here is the formatted code:" }],
    });
    expect(result.messages[2]).toEqual({ role: "user", content: "looks good, thanks" });
    expect(result.stream).toBe(false);
  });

  it("should correctly convert Anthropic response to OpenAI format via protocol adapter", () => {
    // Unit-level verification of the response conversion function
    const anthropicResponse = {
      id: "msg_abc123",
      type: "message",
      content: [
        { type: "text", text: "Here is your formatted code" },
        { type: "tool_use", id: "tu_1", name: "format_code", input: { lang: "ts" } },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: "tool_use",
    };

    const result = convertAnthropicToOpenAIResponse(anthropicResponse, "claude-haiku-4-5-20251001");

    expect(result.id).toBe("msg_abc123");
    expect(result.object).toBe("chat.completion");
    expect(result.model).toBe("claude-haiku-4-5-20251001");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.content).toBe("Here is your formatted code");
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls[0].function.name).toBe("format_code");
    expect(result.choices[0].finish_reason).toBe("tool_calls");
    expect(result.usage.prompt_tokens).toBe(100);
    expect(result.usage.completion_tokens).toBe(50);
    expect(result.usage.total_tokens).toBe(150);
  });
});
