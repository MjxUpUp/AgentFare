import { describe, it, expect } from "vitest";
import { convertOpenAIToAnthropicRequest } from "../../src/protocol/openai-to-anthropic.js";

describe("convertOpenAIToAnthropicRequest", () => {
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
});
