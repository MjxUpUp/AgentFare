import { describe, it, expect } from "vitest";
import { convertOpenAIToAnthropicResponse } from "../../src/protocol/openai-to-anthropic-response.js";

describe("convertOpenAIToAnthropicResponse", () => {
  it("should map finish_reason stop to end_turn", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-1",
        choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      },
      "claude-sonnet-4-6",
    );

    expect(result.stop_reason).toBe("end_turn");
  });

  it("should map finish_reason length to max_tokens", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-2",
        choices: [{ message: { content: "truncated..." }, finish_reason: "length" }],
        usage: { prompt_tokens: 5, completion_tokens: 100 },
      },
      "claude-sonnet-4-6",
    );

    expect(result.stop_reason).toBe("max_tokens");
  });

  it("should map finish_reason tool_calls to tool_use", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-3",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      },
      "claude-sonnet-4-6",
    );

    expect(result.stop_reason).toBe("tool_use");
  });

  it("should map unknown finish_reason to end_turn", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-4",
        choices: [{ message: { content: "hi" }, finish_reason: "content_filter" }],
        usage: {},
      },
      "claude-sonnet-4-6",
    );

    expect(result.stop_reason).toBe("end_turn");
  });

  it("should convert tool_calls to tool_use content blocks", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-5",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "call-1", type: "function", function: { name: "search", arguments: '{"query":"test"}' } },
                { id: "call-2", type: "function", function: { name: "read", arguments: '{"file":"a.ts"}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      },
      "claude-sonnet-4-6",
    );

    const toolUseBlocks = result.content.filter((b: any) => b.type === "tool_use");
    expect(toolUseBlocks).toHaveLength(2);
    expect(toolUseBlocks[0]).toEqual({
      type: "tool_use",
      id: "call-1",
      name: "search",
      input: { query: "test" },
    });
    expect(toolUseBlocks[1]).toEqual({
      type: "tool_use",
      id: "call-2",
      name: "read",
      input: { file: "a.ts" },
    });
  });

  it("should handle non-JSON function.arguments with fallback to empty object", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-6",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "call-1", type: "function", function: { name: "broken", arguments: "not-valid-json" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {},
      },
      "claude-sonnet-4-6",
    );

    const toolBlock = result.content.find((b: any) => b.type === "tool_use");
    expect(toolBlock).toBeDefined();
    expect(toolBlock.input).toEqual({});
  });

  it("should map usage tokens correctly", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-7",
        choices: [{ message: { content: "response" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 42, completion_tokens: 13 },
      },
      "claude-sonnet-4-6",
    );

    expect(result.usage.input_tokens).toBe(42);
    expect(result.usage.output_tokens).toBe(13);
  });

  it("should default usage to 0 when missing", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-8",
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
      },
      "claude-sonnet-4-6",
    );

    expect(result.usage.input_tokens).toBe(0);
    expect(result.usage.output_tokens).toBe(0);
  });

  it("should include text content block for message content", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-9",
        choices: [{ message: { content: "Hello world" }, finish_reason: "stop" }],
        usage: {},
      },
      "claude-sonnet-4-6",
    );

    expect(result.content[0]).toEqual({ type: "text", text: "Hello world" });
  });

  it("should add empty text block when no content and no tool_calls", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-10",
        choices: [{ message: { content: null }, finish_reason: "stop" }],
        usage: {},
      },
      "claude-sonnet-4-6",
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: "" });
  });

  it("should set correct top-level fields", () => {
    const result = convertOpenAIToAnthropicResponse(
      {
        id: "chatcmpl-11",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      "claude-sonnet-4-6",
    );

    expect(result.id).toBe("chatcmpl-11");
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.stop_sequence).toBeNull();
  });
});
