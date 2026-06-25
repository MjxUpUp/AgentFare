import { describe, it, expect } from "vitest";
import { convertAnthropicSSEToOpenAI, createAnthropicToOpenAISSEConverter } from "../../src/protocol/sse-transform.js";

describe("convertAnthropicSSEToOpenAI", () => {
  // ── content_block_delta ───────────────────────────────────────────────

  it("should convert content_block_delta to OpenAI format", () => {
    const anthropicEvent = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`;

    const result = convertAnthropicSSEToOpenAI(anthropicEvent, "claude-sonnet-4-6");
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result!.replace("data: ", ""));
    expect(parsed.choices[0].delta.content).toBe("Hello");
  });

  it("should handle empty text delta in content_block_delta", () => {
    const event = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result!.replace("data: ", ""));
    expect(parsed.choices[0].delta.content).toBe("");
  });

  it("should handle missing delta.text gracefully (defaults to empty string)", () => {
    const event = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{}}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result!.replace("data: ", ""));
    expect(parsed.choices[0].delta.content).toBe("");
  });

  // ── message_start ─────────────────────────────────────────────────────

  it("should convert message_start to OpenAI role chunk", () => {
    const event = `event: message_start\ndata: {"type":"message_start","message":{"id":"msg-123","role":"assistant","model":"claude-sonnet-4-6"}}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeTruthy();

    const parsed = JSON.parse(result!.replace("data: ", ""));
    expect(parsed.id).toBe("msg-123");
    expect(parsed.object).toBe("chat.completion.chunk");
    expect(parsed.choices[0].delta.role).toBe("assistant");
    expect(parsed.choices[0].finish_reason).toBeNull();
  });

  it("should use default id when message.id is missing", () => {
    const event = `event: message_start\ndata: {"type":"message_start","message":{"role":"assistant"}}`;
    const result = convertAnthropicSSEToOpenAI(event, "test-model");
    const parsed = JSON.parse(result!.replace("data: ", ""));
    expect(parsed.id).toBe("chatcmpl-agentfare");
    expect(parsed.model).toBe("test-model");
  });

  // ── message_delta ─────────────────────────────────────────────────────

  it("should convert message_delta with stop_reason end_turn to finish_reason stop", () => {
    const event = `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result!.replace("data: ", ""));
    expect(parsed.choices[0].finish_reason).toBe("stop");
    expect(parsed.choices[0].delta).toEqual({});
  });

  it("should convert message_delta with stop_reason tool_use to finish_reason tool_calls", () => {
    const event = `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result!.replace("data: ", ""));
    expect(parsed.choices[0].finish_reason).toBe("tool_calls");
  });

  it("should convert message_delta with stop_reason max_tokens to finish_reason length", () => {
    const event = `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result!.replace("data: ", ""));
    // max_tokens (Anthropic) maps to length (OpenAI) — both signal the token
    // limit was hit, distinct from a clean stop.
    expect(parsed.choices[0].finish_reason).toBe("length");
  });

  // ── message_stop ──────────────────────────────────────────────────────

  it("should convert message_stop to [DONE]", () => {
    const event = `event: message_stop\ndata: {"type":"message_stop"}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toContain("[DONE]");
  });

  // ── Unknown / edge cases ──────────────────────────────────────────────

  it("should return null for unknown event types", () => {
    const event = `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeNull();
  });

  it("should return null for content_block_stop event", () => {
    const event = `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeNull();
  });

  it("should return null for invalid JSON data", () => {
    const event = `event: content_block_delta\ndata: not-json`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeNull();
  });

  it("should return null when no data line is present", () => {
    const event = `event: message_start`;
    const result = convertAnthropicSSEToOpenAI(event, "claude-sonnet-4-6");
    expect(result).toBeNull();
  });

  // ── Full streaming sequence ───────────────────────────────────────────

  it("should handle each event in a typical streaming sequence independently", () => {
    // Each event is processed independently (no state between calls)
    const model = "claude-sonnet-4-6";

    // 1. message_start
    const startResult = convertAnthropicSSEToOpenAI(
      `event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1"}}`,
      model,
    );
    expect(startResult).toContain("role");
    expect(startResult).toContain("assistant");

    // 2. content_block_delta
    const deltaResult = convertAnthropicSSEToOpenAI(
      `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hi"}}`,
      model,
    );
    expect(deltaResult).toContain("Hi");

    // 3. message_delta
    const mdResult = convertAnthropicSSEToOpenAI(
      `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}`,
      model,
    );
    expect(mdResult).toContain("stop");

    // 4. message_stop
    const stopResult = convertAnthropicSSEToOpenAI(
      `event: message_stop\ndata: {"type":"message_stop"}`,
      model,
    );
    expect(stopResult).toContain("[DONE]");
  });
});

describe("createAnthropicToOpenAISSEConverter (stateful, tool_use-aware)", () => {
  const parse = (out: string) => JSON.parse(out.replace("data: ", "").trim());

  it("preserves a streaming tool_use across content_block_start + input_json_delta", () => {
    const conv = createAnthropicToOpenAISSEConverter("gpt-4o");
    conv.convert('event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1"}}');

    const start = conv.convert('event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}');
    const pStart = parse(start!);
    // Opening delta carries id + name + empty args; index is dense 0-based.
    expect(pStart.choices[0].delta.tool_calls[0]).toMatchObject({
      index: 0, id: "toolu_1", type: "function", function: { name: "get_weather", arguments: "" },
    });

    // Argument fragments arrive as separate input_json_delta events and MUST
    // reuse the same tool_call index (0) — the stateless converter dropped these.
    const arg1 = conv.convert('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"loc"}}');
    const arg2 = conv.convert('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\":\\"SF\\"}"}}');
    expect(parse(arg1!).choices[0].delta.tool_calls[0]).toEqual({ index: 0, function: { arguments: '{"loc' } });
    expect(parse(arg2!).choices[0].delta.tool_calls[0]).toEqual({ index: 0, function: { arguments: '":"SF"}' } });
  });

  it("assigns independent dense indices to two parallel tool_use blocks", () => {
    const conv = createAnthropicToOpenAISSEConverter("gpt-4o");
    conv.convert('event: message_start\ndata: {"type":"message_start","message":{"id":"m"}}');
    const s1 = conv.convert('event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"a","name":"f1","input":{}}}');
    const s2 = conv.convert('event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"b","name":"f2","input":{}}}');
    expect(parse(s1!).choices[0].delta.tool_calls[0].index).toBe(0);
    expect(parse(s2!).choices[0].delta.tool_calls[0].index).toBe(1);
  });

  it("converts text_delta to a content delta", () => {
    const conv = createAnthropicToOpenAISSEConverter("gpt-4o");
    conv.convert('event: message_start\ndata: {"type":"message_start","message":{"id":"m"}}');
    const d = conv.convert('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}');
    expect(parse(d!).choices[0].delta.content).toBe("hi");
  });

  it("maps stop_reason tool_use → tool_calls and max_tokens → length", () => {
    const conv = createAnthropicToOpenAISSEConverter("gpt-4o");
    conv.convert('event: message_start\ndata: {"type":"message_start","message":{"id":"m"}}');
    const tu = conv.convert('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}');
    expect(parse(tu!).choices[0].finish_reason).toBe("tool_calls");

    const conv2 = createAnthropicToOpenAISSEConverter("gpt-4o");
    conv2.convert('event: message_start\ndata: {"type":"message_start","message":{"id":"m"}}');
    const mt = conv2.convert('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}');
    expect(parse(mt!).choices[0].finish_reason).toBe("length");
  });

  it("emits [DONE] on message_stop", () => {
    const conv = createAnthropicToOpenAISSEConverter("gpt-4o");
    expect(conv.convert('event: message_stop\ndata: {"type":"message_stop"}')).toContain("[DONE]");
  });
});
