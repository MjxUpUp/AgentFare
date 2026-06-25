/**
 * Convert an OpenAI SSE chunk (chat.completion.chunk) into an Anthropic SSE event.
 *
 * OpenAI streaming emits chunks like:
 *   data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"},...}],...}
 *   data: {"id":"...","choices":[{"delta":{"content":"Hello"},...}],...}
 *   data: {"id":"...","choices":[{"delta":{},"finish_reason":"stop"}],...}
 *   data: [DONE]
 *
 * Anthropic streaming expects:
 *   event: message_start       data: {"type":"message_start","message":{...}}
 *   event: content_block_start data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
 *   event: content_block_delta data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
 *   event: content_block_stop  data: {"type":"content_block_stop","index":0}
 *   event: content_block_start data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"...","name":"...","input":{}}}
 *   event: content_block_delta data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"..."}}
 *   event: content_block_stop  data: {"type":"content_block_stop","index":1}
 *   event: message_delta       data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},...}
 *   event: message_stop        data: {"type":"message_stop"}
 */

// ── Stateful core (per-instance state, safe for concurrent streams) ──────

export interface SSEStreamConverter {
  convert(sseChunk: string, model: string): string | null;
  reset(): void;
}

/** Tracks per-tool-call state across streaming chunks. */
interface ToolCallTracker {
  /** Anthropic content block index. */
  blockIndex: number;
  /** Whether the content_block_start has been emitted. */
  started: boolean;
}

type StreamState = "idle" | "started" | "terminated";

export function createSSEStreamConverter(): SSEStreamConverter {
  const s = {
    state: "idle" as StreamState,
    msgId: "",
    /** Next content block index to assign. */
    nextBlockIndex: 0,
    /** Track tool calls by their OpenAI index. */
    toolCalls: new Map<number, ToolCallTracker>(),
  };

  return {
    reset() {
      s.state = "idle";
      s.msgId = "";
      s.nextBlockIndex = 0;
      s.toolCalls = new Map();
    },
    convert(sseChunk: string, model: string): string | null {
      return convertChunk(
        sseChunk, model,
        () => s.state, (v: StreamState) => { s.state = v; },
        () => s.msgId, (id) => { s.msgId = id; },
        () => s.nextBlockIndex, (i) => { s.nextBlockIndex = i; },
        () => s.toolCalls, (tc) => { s.toolCalls = tc; },
      );
    },
  };
}

function convertChunk(
  sseChunk: string,
  model: string,
  getState: () => StreamState,
  setState: (s: StreamState) => void,
  getMsgId: () => string,
  setMsgId: (id: string) => void,
  getNextBlockIndex: () => number,
  setNextBlockIndex: (i: number) => void,
  getToolCalls: () => Map<number, ToolCallTracker>,
  setToolCalls: (tc: Map<number, ToolCallTracker>) => void,
): string | null {
  const lines = sseChunk.split("\n");
  const results: string[] = [];

  // Ensure the Anthropic message preamble (message_start + content_block_start
  // for block 0) exists before emitting any content or close event. Defined
  // ONCE before the loop so the [DONE] and finish_reason branches can call it
  // even when they are the very first (or only) event in the stream — without
  // this, a stream that ends with only [DONE] (or only a finish_reason, no
  // content) yields content_block_stop / message_stop with no preceding start,
  // which is a protocol-illegal Anthropic sequence.
  const ensureStarted = (id?: string) => {
    if (getState() !== "idle") return;
    setMsgId(id ?? `msg_${Date.now()}`);
    results.push(formatSSE("message_start", {
      type: "message_start",
      message: {
        id: getMsgId(),
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }));
    // Start text content block (index 0)
    results.push(formatSSE("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }));
    setNextBlockIndex(1);
    setState("started");
  };

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const dataStr = line.slice(6).trim();

    if (dataStr === "[DONE]") {
      // finish_reason may have already terminated the stream — don't emit a
      // second closing sequence (would duplicate message_stop). For streams
      // that end with [DONE] only (no finish_reason, possibly no content at
      // all), synthesize a well-formed Anthropic sequence; that requires the
      // preamble, hence ensureStarted() first.
      if (getState() === "terminated") continue;
      ensureStarted();
      // Close text block if it was started and not already closed by tool calls
      if (getNextBlockIndex() > 0 && getToolCalls().size === 0) {
        results.push(formatSSE("content_block_stop", { type: "content_block_stop", index: 0 }));
      }
      // Close any open tool_use blocks
      const toolCalls = getToolCalls();
      for (const [, tracker] of toolCalls) {
        results.push(formatSSE("content_block_stop", { type: "content_block_stop", index: tracker.blockIndex }));
      }
      results.push(formatSSE("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 },
      }));
      results.push(formatSSE("message_stop", { type: "message_stop" }));
      setState("terminated");
      continue;
    }

    let data: any;
    try { data = JSON.parse(dataStr); } catch { continue; }

    const choice = data.choices?.[0];
    if (!choice) continue;

    // First chunk with role -> message_start (no content block yet)
    if (getState() === "idle" && choice.delta?.role) {
      ensureStarted(data.id);
    }

    // Content delta — always uses block index 0 if no tool calls have been emitted
    if (choice.delta?.content !== undefined && choice.delta.content !== null) {
      ensureStarted(data.id);
      results.push(formatSSE("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: choice.delta.content },
      }));
    }

    // Tool calls delta — proper tool_use content blocks
    if (choice.delta?.tool_calls) {
      ensureStarted(data.id);
      const toolCalls = getToolCalls();

      for (const tc of choice.delta.tool_calls) {
        const tcIndex: number = tc.index ?? 0;

        if (!toolCalls.has(tcIndex)) {
          // New tool call — emit content_block_start
          const blockIndex = getNextBlockIndex();
          const tracker: ToolCallTracker = { blockIndex, started: true };
          toolCalls.set(tcIndex, tracker);
          setNextBlockIndex(blockIndex + 1);

          // If we had text content on block 0, close it first
          if (blockIndex === 1) {
            results.push(formatSSE("content_block_stop", { type: "content_block_stop", index: 0 }));
          }

          results.push(formatSSE("content_block_start", {
            type: "content_block_start",
            index: blockIndex,
            content_block: {
              type: "tool_use",
              id: tc.id ?? `toolu_${tcIndex}`,
              name: tc.function?.name ?? "",
              input: {},
            },
          }));
        }

        const tracker = toolCalls.get(tcIndex)!;

        // Arguments delta — emit as input_json_delta
        if (tc.function?.arguments) {
          results.push(formatSSE("content_block_delta", {
            type: "content_block_delta",
            index: tracker.blockIndex,
            delta: { type: "input_json_delta", partial_json: tc.function.arguments },
          }));
        }
      }
    }

    // Finish reason
    if (choice.finish_reason) {
      // Guard against a duplicate terminator after [DONE] already closed the
      // stream (some upstreams send both).
      if (getState() === "terminated") continue;
      // Close any open tool_use blocks
      const toolCalls = getToolCalls();
      for (const [, tracker] of toolCalls) {
        results.push(formatSSE("content_block_stop", { type: "content_block_stop", index: tracker.blockIndex }));
      }
      // Close text block (index 0) if no tool calls were opened (tool calls close it themselves)
      if (toolCalls.size === 0 && getNextBlockIndex() > 0) {
        results.push(formatSSE("content_block_stop", { type: "content_block_stop", index: 0 }));
      }
      const stopReason = mapFinishReason(choice.finish_reason);
      results.push(formatSSE("message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 0 },
      }));
      results.push(formatSSE("message_stop", { type: "message_stop" }));
      setState("terminated");
    }
  }

  return results.length > 0 ? results.join("") : null;
}

function formatSSE(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function mapFinishReason(reason: string): string {
  switch (reason) {
    case "stop": return "end_turn";
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    default: return "end_turn";
  }
}
