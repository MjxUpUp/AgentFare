import { describe, it, expect } from "vitest";
import { convertAnthropicSSEToOpenAI } from "../../src/protocol/sse-transform.js";

describe("convertAnthropicSSEToOpenAI", () => {
  it("should convert content_block_delta to OpenAI format", () => {
    const anthropicEvent = `event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`;

    const result = convertAnthropicSSEToOpenAI(anthropicEvent, "claude-sonnet-4-6");
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result!.replace("data: ", ""));
    expect(parsed.choices[0].delta.content).toBe("Hello");
  });

  it("should convert message_stop to [DONE]", () => {
    const event = `event: message_stop\ndata: {"type":"message_stop"}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toContain("[DONE]");
  });
});
