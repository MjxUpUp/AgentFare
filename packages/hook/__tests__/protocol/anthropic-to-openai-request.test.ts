import { describe, it, expect } from "vitest";
import { convertAnthropicToOpenAIRequest } from "../../src/protocol/anthropic-to-openai-request.js";

describe("convertAnthropicToOpenAIRequest", () => {
  it("should extract system message to top-level system field", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
    });

    // System becomes first message in OpenAI format
    expect(result.messages[0]).toEqual({ role: "system", content: "You are a helpful assistant." });
    expect(result.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("should convert tool_result content block to role: tool messages", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is the result?" },
            { type: "tool_result", tool_use_id: "tool-123", content: "42" },
          ],
        },
      ],
      stream: false,
    });

    // Text parts stay as user message, tool_result becomes separate tool message
    const userMsg = result.messages.find((m) => m.role === "user");
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe("What is the result?");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe("42");
    expect(toolMsg!.tool_call_id).toBe("tool-123");
  });

  it("should handle tool_result with array content blocks", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-456",
              content: [
                { type: "text", text: "Part 1" },
                { type: "text", text: "Part 2" },
              ],
            },
          ],
        },
      ],
      stream: false,
    });

    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe("Part 1Part 2");
    expect(toolMsg!.tool_call_id).toBe("tool-456");
  });

  it("should convert tool_use content block to OpenAI tool_calls format", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will read the file." },
            { type: "tool_use", id: "tu-1", name: "read_file", input: { path: "test.ts" } },
          ],
        },
      ],
      stream: false,
    });

    const assistantMsg = result.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe("I will read the file.");
    expect(assistantMsg!.tool_calls).toHaveLength(1);
    expect(assistantMsg!.tool_calls![0].id).toBe("tu-1");
    expect(assistantMsg!.tool_calls![0].type).toBe("function");
    expect(assistantMsg!.tool_calls![0].function.name).toBe("read_file");
    expect(assistantMsg!.tool_calls![0].function.arguments).toBe('{"path":"test.ts"}');
  });

  it("should convert tool schema (input_schema to parameters)", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "list files" }],
      stream: false,
      tools: [
        {
          name: "list_files",
          description: "List files in a directory",
          input_schema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Directory path" },
            },
          },
        },
      ],
    });

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].type).toBe("function");
    expect(result.tools![0].function.name).toBe("list_files");
    expect(result.tools![0].function.description).toBe("List files in a directory");
    expect(result.tools![0].function.parameters).toEqual({
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path" },
      },
    });
  });

  it("should passthrough temperature", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hi" }],
      stream: false,
      temperature: 0.7,
    });

    expect(result.temperature).toBe(0.7);
  });

  it("should not include temperature when undefined", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hi" }],
      stream: false,
    });

    expect(result.temperature).toBeUndefined();
  });

  it("should passthrough stop_sequences as stop", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hi" }],
      stream: false,
      stop_sequences: ["\n\n", "END"],
    });

    expect(result.stop).toEqual(["\n\n", "END"]);
  });

  it("should use targetModelId when provided", () => {
    const result = convertAnthropicToOpenAIRequest(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      },
      "gpt-4o-mini",
    );

    expect(result.model).toBe("gpt-4o-mini");
  });

  it("should default model to gpt-4o when no targetModelId", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hi" }],
      stream: false,
    });

    expect(result.model).toBe("gpt-4o");
  });

  it("should handle assistant with string content", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        { role: "assistant", content: "Sure, I can help." },
      ],
      stream: false,
    });

    const assistantMsg = result.messages[0];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Sure, I can help.");
    expect(assistantMsg.tool_calls).toBeUndefined();
  });

  it("should handle assistant with only tool_use blocks (content becomes null)", () => {
    const result = convertAnthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu-2", name: "run", input: {} },
          ],
        },
      ],
      stream: false,
    });

    const assistantMsg = result.messages[0];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBeNull();
    expect(assistantMsg.tool_calls).toHaveLength(1);
  });
});
