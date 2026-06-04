import { describe, it, expect } from "vitest";
import { convertOpenAIToAnthropicRequest } from "../../src/protocol/openai-to-anthropic.js";

describe("convertOpenAIToAnthropicRequest", () => {
  // ── Basic conversion ──────────────────────────────────────────────────

  it("should convert basic user message", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("should extract system prompt to top-level field", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" },
      ],
    });
    expect(result.system).toBe("You are helpful");
    expect(result.messages).toHaveLength(1);
  });

  it("should use targetModelId when provided", () => {
    const result = convertOpenAIToAnthropicRequest(
      { model: "gpt-5.4", messages: [{ role: "user", content: "Hi" }] },
      "claude-opus-4-8",
    );
    expect(result.model).toBe("claude-opus-4-8");
  });

  it("should default max_tokens to 4096", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.max_tokens).toBe(4096);
  });

  it("should forward max_tokens from source request", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 2048,
    });
    expect(result.max_tokens).toBe(2048);
  });

  it("should forward stream flag", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hi" }],
      stream: true,
    });
    expect(result.stream).toBe(true);
  });

  it("should forward temperature and stop", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.5,
      stop: ["\n"],
    });
    expect(result.temperature).toBe(0.5);
    expect(result.stop_sequences).toEqual(["\n"]);
  });

  // ── System message edge cases ─────────────────────────────────────────

  it("should drop non-string system message content (array)", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: [{ type: "text", text: "You are helpful" }] } as any,
        { role: "user", content: "Hi" },
      ],
    });
    expect(result.system).toBeUndefined();
    expect(result.messages).toHaveLength(1);
  });

  it("should only extract first system message (not join multiple)", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: "First system" },
        { role: "system", content: "Second system" },
        { role: "user", content: "Hi" },
      ],
    });
    // Current implementation uses find(), so only the first system message is captured
    expect(result.system).toBe("First system");
    // Both system messages are filtered out from messages array
    const userMsgs = result.messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
  });

  // ── Null / empty content ──────────────────────────────────────────────

  it("should handle null content on user message", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{ role: "user", content: null }],
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("");
  });

  it("should handle empty messages array", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [],
    });
    expect(result.messages).toHaveLength(0);
  });

  // ── Tool call conversations ───────────────────────────────────────────

  it("should convert tool_calls to tool_use content blocks", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "read file" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"test.ts"}' } }],
        },
        { role: "tool", content: "file contents", tool_call_id: "call-1" },
      ],
    });
    const assistantMsg = result.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    const content = assistantMsg!.content as any[];
    expect(content.some((b: any) => b.type === "tool_use")).toBe(true);
  });

  it("should merge consecutive tool messages into single user message", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "multi tool" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call-1", type: "function", function: { name: "tool_a", arguments: "{}" } },
            { id: "call-2", type: "function", function: { name: "tool_b", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "result a", tool_call_id: "call-1" },
        { role: "tool", content: "result b", tool_call_id: "call-2" },
      ],
    });

    // Consecutive tool messages should be merged into a single user message with tool_result blocks
    const userMsgs = result.messages.filter((m) => m.role === "user");
    // First is "multi tool", second is the merged tool results
    const toolResultMsg = userMsgs[userMsgs.length - 1];
    const blocks = toolResultMsg.content as any[];
    expect(blocks.every((b: any) => b.type === "tool_result")).toBe(true);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tool_use_id).toBe("call-1");
    expect(blocks[1].tool_use_id).toBe("call-2");
  });

  it("should handle malformed tool_call arguments (fallback to empty object)", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "test" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call-bad",
            type: "function",
            function: { name: "broken_tool", arguments: "not-valid-json" },
          }],
        },
      ],
    });
    const assistantMsg = result.messages.find((m) => m.role === "assistant");
    const toolUse = (assistantMsg!.content as any[]).find((b: any) => b.type === "tool_use");
    expect(toolUse.input).toEqual({});
  });

  it("should handle multi-turn conversation with interleaved tool calls", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "read file and search" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
          ],
        },
        { role: "tool", content: "file content", tool_call_id: "call-1" },
        {
          role: "assistant",
          content: "I found the content. Now searching.",
          tool_calls: [
            { id: "call-2", type: "function", function: { name: "search", arguments: '{"query":"todo"}' } },
          ],
        },
        { role: "tool", content: "3 results found", tool_call_id: "call-2" },
        { role: "assistant", content: "Here are the results: ..." },
      ],
    });

    // Expect: user, assistant(1 tool_use), user(tool_result), assistant(text+tool_use), user(tool_result), assistant(text)
    const roles = result.messages.map((m) => m.role);
    // First assistant has tool_use, so merged tool_result from first tool goes into user
    // Second assistant has both text and tool_use, second tool_result goes into user
    expect(roles).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);

    // Verify second assistant has both text and tool_use
    const secondAssistant = result.messages[3];
    const content = secondAssistant.content as any[];
    expect(content.some((b: any) => b.type === "text")).toBe(true);
    expect(content.some((b: any) => b.type === "tool_use")).toBe(true);
  });

  it("should handle assistant with both text content and tool_calls", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "analyze" },
        {
          role: "assistant",
          content: "I will analyze the file.",
          tool_calls: [{ id: "call-1", type: "function", function: { name: "read", arguments: '{"f":"x"}' } }],
        },
      ],
    });
    const assistantMsg = result.messages.find((m) => m.role === "assistant");
    const content = assistantMsg!.content as any[];
    const textBlock = content.find((b: any) => b.type === "text");
    const toolBlock = content.find((b: any) => b.type === "tool_use");
    expect(textBlock).toBeDefined();
    expect(textBlock.text).toBe("I will analyze the file.");
    expect(toolBlock).toBeDefined();
    expect(toolBlock.name).toBe("read");
  });

  // ── Multimodal content ────────────────────────────────────────────────

  it("should convert image_url with base64 data URL to Anthropic base64 source", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      }],
    });
    const userMsg = result.messages[0];
    const blocks = userMsg.content as any[];
    const imageBlock = blocks.find((b: any) => b.type === "image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source.type).toBe("base64");
    expect(imageBlock.source.media_type).toBe("image/png");
    expect(imageBlock.source.data).toBe("iVBORw0KGgo=");
  });

  it("should convert image_url with external URL to Anthropic url source", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "https://example.com/image.jpg" } },
        ],
      }],
    });
    const userMsg = result.messages[0];
    const blocks = userMsg.content as any[];
    const imageBlock = blocks.find((b: any) => b.type === "image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source.type).toBe("url");
    expect(imageBlock.source.url).toBe("https://example.com/image.jpg");
  });

  it("should return plain string for single text content part", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{
        role: "user",
        content: [{ type: "text", text: "Just text" }],
      }],
    });
    // Single text block should be simplified to plain string
    expect(result.messages[0].content).toBe("Just text");
  });

  // ── Tools definition ──────────────────────────────────────────────────

  it("should convert OpenAI tools to Anthropic format", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "list files" }],
      tools: [{
        type: "function",
        function: {
          name: "list_files",
          description: "List files in a directory",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      }],
    });
    expect(result.tools).toHaveLength(1);
    expect(result.tools![0]).toEqual({
      name: "list_files",
      description: "List files in a directory",
      input_schema: { type: "object", properties: { path: { type: "string" } } },
    });
  });

  it("should not include tools when undefined", () => {
    const result = convertOpenAIToAnthropicRequest({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(result.tools).toBeUndefined();
  });
});
