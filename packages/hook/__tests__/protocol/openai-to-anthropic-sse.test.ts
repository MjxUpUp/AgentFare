import { describe, it, expect, beforeEach } from "vitest";
import { createSSEStreamConverter } from "../../src/protocol/openai-to-anthropic-sse.js";

describe("createSSEStreamConverter", () => {
  let converter: ReturnType<typeof createSSEStreamConverter>;

  beforeEach(() => {
    converter = createSSEStreamConverter();
  });

  it("should transition idle -> started -> text_block_started -> idle", () => {
    // First chunk: role triggers message_start + content_block_start (idle -> text_block_started)
    const chunk1 = 'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n';
    const result1 = converter.convert(chunk1, "claude-sonnet-4-6");
    expect(result1).toContain("message_start");
    expect(result1).toContain("content_block_start");

    // Final chunk: finish_reason triggers content_block_stop + message_delta + message_stop (text_block_started -> idle)
    const chunk2 = 'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
    const result2 = converter.convert(chunk2, "claude-sonnet-4-6");
    expect(result2).toContain("content_block_stop");
    expect(result2).toContain("message_delta");
    expect(result2).toContain("message_stop");
  });

  it("should emit message_start + content_block_start on first chunk with role", () => {
    const chunk = 'data: {"id":"chatcmpl-2","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    const result = converter.convert(chunk, "claude-sonnet-4-6");

    expect(result).not.toBeNull();

    // Parse out the SSE events
    const lines = result!.split("\n");
    const eventTypes = lines.filter((l) => l.startsWith("event: ")).map((l) => l.slice(7));
    expect(eventTypes).toContain("message_start");
    expect(eventTypes).toContain("content_block_start");

    // Verify message_start data
    const dataLines = lines.filter((l) => l.startsWith("data: "));
    const msgStartData = JSON.parse(dataLines[0].slice(6));
    expect(msgStartData.type).toBe("message_start");
    expect(msgStartData.message.role).toBe("assistant");
    expect(msgStartData.message.model).toBe("claude-sonnet-4-6");
  });

  it("should emit content_block_delta for content", () => {
    // Start the stream first
    const startChunk = 'data: {"id":"chatcmpl-3","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    converter.convert(startChunk, "claude-sonnet-4-6");

    // Content delta
    const contentChunk = 'data: {"id":"chatcmpl-3","choices":[{"delta":{"content":"Hello world"}}]}\n\n';
    const result = converter.convert(contentChunk, "claude-sonnet-4-6");

    expect(result).not.toBeNull();
    expect(result).toContain("content_block_delta");

    const lines = result!.split("\n");
    const dataLine = lines.find((l) => l.startsWith("data: ") && l.includes("content_block_delta"));
    expect(dataLine).toBeDefined();
    const parsed = JSON.parse(dataLine!.slice(6));
    expect(parsed.delta.text).toBe("Hello world");
  });

  it("should emit content_block_stop + message_delta + message_stop on finish_reason", () => {
    // Start the stream
    const startChunk = 'data: {"id":"chatcmpl-4","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    converter.convert(startChunk, "claude-sonnet-4-6");

    // Finish
    const finishChunk = 'data: {"id":"chatcmpl-4","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
    const result = converter.convert(finishChunk, "claude-sonnet-4-6");

    expect(result).toContain("content_block_stop");
    expect(result).toContain("message_delta");
    expect(result).toContain("message_stop");

    // Verify stop_reason mapping
    const lines = result!.split("\n");
    const dataLines = lines.filter((l) => l.startsWith("data: "));
    for (const dl of dataLines) {
      const parsed = JSON.parse(dl.slice(6));
      if (parsed.type === "message_delta") {
        expect(parsed.delta.stop_reason).toBe("end_turn");
      }
    }
  });

  it("should handle [DONE] and emit proper closing events", () => {
    // Start the stream
    const startChunk = 'data: {"id":"chatcmpl-5","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    converter.convert(startChunk, "claude-sonnet-4-6");

    const doneChunk = "data: [DONE]\n\n";
    const result = converter.convert(doneChunk, "claude-sonnet-4-6");

    expect(result).toContain("content_block_stop");
    expect(result).toContain("message_delta");
    expect(result).toContain("message_stop");
  });

  it("should return null for non-matching chunks", () => {
    const chunk = 'data: {"id":"chatcmpl-6","choices":[]}\n\n';
    const result = converter.convert(chunk, "claude-sonnet-4-6");
    expect(result).toBeNull();
  });

  it("reset() should clear state between streams", () => {
    // First stream
    const startChunk = 'data: {"id":"chatcmpl-7","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    const contentChunk = 'data: {"id":"chatcmpl-7","choices":[{"delta":{"content":"first"}}]}\n\n';
    const finishChunk = 'data: {"id":"chatcmpl-7","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';

    converter.convert(startChunk, "claude-sonnet-4-6");
    converter.convert(contentChunk, "claude-sonnet-4-6");
    converter.convert(finishChunk, "claude-sonnet-4-6");

    // Reset
    converter.reset();

    // Second stream should work independently
    const startChunk2 = 'data: {"id":"chatcmpl-8","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    const result = converter.convert(startChunk2, "claude-sonnet-4-6");
    expect(result).toContain("message_start");
    expect(result).toContain("content_block_start");
  });

  it("should map finish_reason length to max_tokens", () => {
    const startChunk = 'data: {"id":"chatcmpl-9","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    converter.convert(startChunk, "claude-sonnet-4-6");

    const finishChunk = 'data: {"id":"chatcmpl-9","choices":[{"delta":{},"finish_reason":"length"}]}\n\n';
    const result = converter.convert(finishChunk, "claude-sonnet-4-6");

    const lines = result!.split("\n");
    const dataLines = lines.filter((l) => l.startsWith("data: "));
    for (const dl of dataLines) {
      const parsed = JSON.parse(dl.slice(6));
      if (parsed.type === "message_delta") {
        expect(parsed.delta.stop_reason).toBe("max_tokens");
      }
    }
  });

  it("should map finish_reason tool_calls to tool_use", () => {
    const startChunk = 'data: {"id":"chatcmpl-10","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    converter.convert(startChunk, "claude-sonnet-4-6");

    const finishChunk = 'data: {"id":"chatcmpl-10","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n';
    const result = converter.convert(finishChunk, "claude-sonnet-4-6");

    const lines = result!.split("\n");
    const dataLines = lines.filter((l) => l.startsWith("data: "));
    for (const dl of dataLines) {
      const parsed = JSON.parse(dl.slice(6));
      if (parsed.type === "message_delta") {
        expect(parsed.delta.stop_reason).toBe("tool_use");
      }
    }
  });

  it("should handle content arriving before role (edge case)", () => {
    // Content arrives without prior role chunk
    const contentChunk = 'data: {"id":"chatcmpl-11","choices":[{"delta":{"content":"early content"}}]}\n\n';
    const result = converter.convert(contentChunk, "claude-sonnet-4-6");

    expect(result).toContain("message_start");
    expect(result).toContain("content_block_start");
    expect(result).toContain("content_block_delta");
  });

  it("should skip invalid JSON lines", () => {
    const startChunk = 'data: {"id":"chatcmpl-12","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    converter.convert(startChunk, "claude-sonnet-4-6");

    const badChunk = "data: not-valid-json\n\n";
    const result = converter.convert(badChunk, "claude-sonnet-4-6");
    expect(result).toBeNull();
  });

  it("should handle [DONE] without prior stream start", () => {
    // [DONE] arrives in idle state (no content was emitted). The converter must
    // synthesize a COMPLETE, protocol-legal Anthropic sequence: message_start +
    // content_block_start, then close the block, then message_delta + stop.
    // Previously it emitted content_block_stop / message_stop with NO preceding
    // message_start — an invalid sequence Anthropic clients reject.
    const doneChunk = "data: [DONE]\n\n";
    const result = converter.convert(doneChunk, "claude-sonnet-4-6");

    expect(result).toContain("message_start");
    expect(result).toContain("content_block_start");
    expect(result).toContain("content_block_stop");
    expect(result).toContain("message_delta");
    expect(result).toContain("message_stop");
    // Correct ordering: the block is opened before it is closed, and the
    // message is started before any block event.
    expect(result!.indexOf("message_start")).toBeLessThan(result!.indexOf("content_block_start"));
    expect(result!.indexOf("content_block_start")).toBeLessThan(result!.indexOf("content_block_stop"));
  });

  it("multiple converters should be independent (concurrency safety)", () => {
    const conv1 = createSSEStreamConverter();
    const conv2 = createSSEStreamConverter();

    // Start stream on conv1
    const startChunk = 'data: {"id":"chatcmpl-A","choices":[{"delta":{"role":"assistant"}}]}\n\n';
    const r1 = conv1.convert(startChunk, "model-a");
    expect(r1).toContain("message_start");

    // conv2 should still be idle — can start its own independent stream
    const r2 = conv2.convert(startChunk, "model-b");
    expect(r2).toContain("message_start");

    // Content on conv1 should not affect conv2
    const contentChunk = 'data: {"id":"chatcmpl-A","choices":[{"delta":{"content":"hello"}}]}\n\n';
    const r3 = conv1.convert(contentChunk, "model-a");
    expect(r3).toContain("content_block_delta");
  });
});
