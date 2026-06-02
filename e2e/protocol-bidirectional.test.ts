import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "@agentfare/hook/fetch-patch";
import { DEFAULT_CONFIG } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import type { RequestHandler, HandleResult } from "@agentfare/hook/request-handler";
import { makeOpenAIStream, makeAnthropicStream } from "./setup";

/**
 * E2E: Protocol bidirectional conversion tests (ISSUE-028 regression).
 *
 * Tests the full pipeline when cross-provider routing requires protocol
 * conversion: OpenAI request → route to Anthropic → request body converted
 * to Anthropic format, response converted back to OpenAI format (and vice versa).
 */
describe("E2E: Protocol bidirectional conversion", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    process.env.DEEPSEEK_API_KEY = "sk-deepseek-test-key";
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("should convert OpenAI request body to Anthropic format when routing to Anthropic (ISSUE-028)", async () => {
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
          id: "msg_test",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Here is the formatted code" }],
          model: "claude-haiku-4-5-20251001",
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 50, output_tokens: 20 },
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
            reasoning: "route OpenAI → Anthropic",
          },
          modifiedBody: JSON.stringify({
            model: claudeModel.api.modelId,
            messages: [
              { role: "system", content: "You are helpful" },
              { role: "user", content: "format this code" },
            ],
            max_tokens: 1024,
            stream: false,
          }),
          analysis: {
            stepType: "simple_tool_use",
            difficulty: 0.1,
            confidence: 0.9,
            recommendedTier: "fast",
            recommendedModel: claudeModel.id,
            reasoning: "fast task",
            needsProviderSwitch: true,
            estimatedTokens: { input: 100, output: 50 },
            alternatives: [],
          },
          sessionId: "ad-proto-bidir-1",
        }) as HandleResult,
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    const response = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "format this code" },
        ],
        max_tokens: 1024,
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    // Verify the request was converted to Anthropic format
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const req = captured[0];
    const reqBody = JSON.parse(req.body);

    // Protocol conversion: system message extracted to top-level "system" field
    expect(reqBody.system).toBe("You are helpful");
    // Messages should not contain system role
    expect(reqBody.messages.some((m: any) => m.role === "system")).toBe(false);
    // URL rewritten to Anthropic
    expect(req.url).toContain("anthropic.com");
    expect(req.url).toContain("/v1/messages");
    // Auth headers switched
    expect(req.headers?.["x-api-key"]).toBe("sk-ant-test-key");

    // Verify the response was converted back to OpenAI format
    const respBody = await response.json();
    expect(respBody.object).toBe("chat.completion");
    expect(respBody.choices).toBeDefined();
    expect(respBody.choices[0].message.content).toBe("Here is the formatted code");
    expect(respBody.usage.prompt_tokens).toBe(50);
    expect(respBody.usage.completion_tokens).toBe(20);
  });

  it("should convert Anthropic request body to OpenAI format when routing to OpenAI-compatible endpoint (ISSUE-028)", async () => {
    const captured: any[] = [];
    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
        headers: (init as any)?.headers,
      });
      // Return OpenAI-format response
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          model: "deepseek-chat",
          choices: [{
            index: 0,
            message: { role: "assistant", content: "Task completed" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
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
            reasoning: "route Anthropic → DeepSeek",
          },
          modifiedBody: JSON.stringify({
            model: deepseekModel.api.modelId,
            messages: [
              { role: "user", content: "yes, proceed" },
            ],
            max_tokens: 4096,
            stream: false,
          }),
          analysis: {
            stepType: "confirmation",
            difficulty: 0.05,
            confidence: 0.95,
            recommendedTier: "fast",
            recommendedModel: deepseekModel.id,
            reasoning: "confirmation, route to cheapest",
            needsProviderSwitch: true,
            estimatedTokens: { input: 50, output: 20 },
            alternatives: [],
          },
          sessionId: "ad-proto-bidir-2",
        }) as HandleResult,
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    const response = await globalThis.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-opus-4-6",
        messages: [{ role: "user", content: "yes, proceed" }],
        max_tokens: 4096,
      }),
      headers: { "Content-Type": "application/json", "x-api-key": "sk-ant-original-key" },
    });

    // Verify the request was sent to DeepSeek (OpenAI-compatible)
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const req = captured[0];
    expect(req.url).toContain("deepseek.com");
    expect(req.url).toContain("/chat/completions");
    expect(req.headers?.Authorization).toContain("sk-deepseek-test-key");

    // Verify the response was converted back to Anthropic format
    const respBody = await response.json();
    expect(respBody.type).toBe("message");
    expect(respBody.role).toBe("assistant");
    expect(respBody.content).toBeDefined();
    expect(respBody.content[0].type).toBe("text");
    expect(respBody.content[0].text).toBe("Task completed");
    expect(respBody.usage.input_tokens).toBe(30);
    expect(respBody.usage.output_tokens).toBe(10);
  });

  it("should convert SSE streaming bidirectionally between OpenAI and Anthropic protocols", async () => {
    // Test: Anthropic request → route to DeepSeek → Anthropic SSE response streamed back
    // But here we test the reverse: OpenAI request → route to Anthropic → stream conversion
    const captured: any[] = [];

    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
      });
      // Return an Anthropic SSE stream
      const sseBody = makeAnthropicStream("Hello from Claude", 40, 25);
      return new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
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
            reasoning: "route OpenAI → Anthropic streaming",
          },
          modifiedBody: JSON.stringify({
            model: claudeModel.api.modelId,
            messages: [{ role: "user", content: "hello" }],
            max_tokens: 1024,
            stream: true,
          }),
          analysis: {
            stepType: "simple_tool_use",
            difficulty: 0.1,
            confidence: 0.9,
            recommendedTier: "fast",
            recommendedModel: claudeModel.id,
            reasoning: "streaming test",
            needsProviderSwitch: true,
            estimatedTokens: { input: 100, output: 50 },
            alternatives: [],
          },
          sessionId: "ad-proto-bidir-3",
        }) as HandleResult,
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    const response = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(response.status).toBe(200);
    // Request should go to Anthropic
    expect(captured[0].url).toContain("anthropic.com");

    // The streaming response should be converted from Anthropic SSE to OpenAI SSE
    const text = await response.text();
    // After conversion, we should see OpenAI-format SSE data
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("[DONE]");
  });
});
