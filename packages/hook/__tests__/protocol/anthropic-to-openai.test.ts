import { describe, it, expect } from "vitest";
import { convertAnthropicToOpenAIResponse } from "../../src/protocol/anthropic-to-openai.js";

describe("convertAnthropicToOpenAIResponse", () => {
  it("maps basic text content and finish reason", () => {
    const result = convertAnthropicToOpenAIResponse({
      id: "msg-1",
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }, "gpt-4o");
    expect(result.choices[0].message.content).toBe("hello");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(5);
    expect(result.usage.total_tokens).toBe(15);
  });

  it("folds Anthropic cache tokens into prompt_tokens", () => {
    // Anthropic reports prompt-cache tokens separately; they are billable input
    // and must count toward prompt_tokens or input cost is undercounted.
    const result = convertAnthropicToOpenAIResponse({
      content: [{ type: "text", text: "x" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 200,
        output_tokens: 30,
      },
    }, "gpt-4o");
    expect(result.usage.prompt_tokens).toBe(350); // 100 + 50 + 200
    expect(result.usage.completion_tokens).toBe(30);
    expect(result.usage.total_tokens).toBe(380);
    expect(result.usage.prompt_tokens_details?.cached_tokens).toBe(200);
  });

  it("omits prompt_tokens_details when there are no cached tokens", () => {
    const result = convertAnthropicToOpenAIResponse({
      content: [{ type: "text", text: "x" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }, "gpt-4o");
    expect(result.usage.prompt_tokens_details).toBeUndefined();
  });

  it("maps tool_use blocks to OpenAI tool_calls", () => {
    const result = convertAnthropicToOpenAIResponse({
      content: [
        { type: "text", text: "calling" },
        { type: "tool_use", id: "tu-1", name: "run", input: { x: 1 } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 5 },
    }, "gpt-4o");
    expect(result.choices[0].finish_reason).toBe("tool_calls");
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls![0]).toMatchObject({
      id: "tu-1",
      type: "function",
      function: { name: "run", arguments: '{"x":1}' },
    });
  });
});
