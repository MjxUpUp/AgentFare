/**
 * Convert Anthropic streaming SSE events into OpenAI chat.completion.chunk SSE.
 *
 * Two entry points:
 *  - convertAnthropicSSEToOpenAI: stateless, one event in → zero or one chunk
 *    out. Correct for plain-text streams, but it CANNOT carry tool_use across
 *    events — an OpenAI tool_call needs a stable per-call index remembered
 *    between the content_block_start and its input_json_deltas, which a
 *    stateless per-event function cannot do. Kept for backward compatibility
 *    and the stateless unit tests.
 *  - createAnthropicToOpenAISSEConverter: stateful, tool_use-aware. This is
 *    what the live proxy/hook pipeline uses (see pipeline.ts) so streaming
 *    tool calls survive an Anthropic→OpenAI cross-provider hop.
 */

// ── Stateless converter (legacy / unit-tested) ──────────────────────────

export function convertAnthropicSSEToOpenAI(sseChunk: string, model: string): string | null {
  const lines = sseChunk.split("\n");
  let data: any = null;

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try { data = JSON.parse(line.slice(6)); } catch { return null; }
    }
  }

  if (!data) return null;

  switch (data.type) {
    case "message_start": {
      const id = data.message?.id ?? "chatcmpl-agentfare";
      return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`;
    }
    case "content_block_delta": {
      const text = data.delta?.text ?? "";
      return `data: ${JSON.stringify({ id: "chatcmpl-agentfare", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`;
    }
    case "message_delta": {
      const finishReason = mapStopReasonToFinish(data.delta?.stop_reason);
      return `data: ${JSON.stringify({ id: "chatcmpl-agentfare", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`;
    }
    case "message_stop":
      return "data: [DONE]\n\n";
    default:
      return null;
  }
}

// ── Stateful converter (tool_use-aware) ─────────────────────────────────

export interface AnthropicToOpenAISSEConverter {
  convert(rawEvent: string): string | null;
  reset(): void;
}

/**
 * Stateful Anthropic→OpenAI SSE converter that preserves streaming tool_use.
 * Maintains a map from the Anthropic content_block index of each tool_use
 * block to a dense 0-based OpenAI tool_call index, so the opening delta
 * (id + name) and the subsequent argument deltas share the same index.
 */
export function createAnthropicToOpenAISSEConverter(model: string): AnthropicToOpenAISSEConverter {
  const s = {
    msgId: "chatcmpl-agentfare",
    /** Anthropic content_block index → OpenAI tool_call index. */
    toolBlockIndex: new Map<number, number>(),
    /** Next OpenAI tool_call index to assign (dense, 0-based). */
    nextToolCallIndex: 0,
  };

  const emit = (delta: any, finishReason: string | null = null): string => {
    return `data: ${JSON.stringify({
      id: s.msgId,
      object: "chat.completion.chunk",
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
  };

  return {
    reset() {
      s.msgId = "chatcmpl-agentfare";
      s.toolBlockIndex = new Map();
      s.nextToolCallIndex = 0;
    },
    convert(rawEvent: string): string | null {
      const lines = rawEvent.split("\n");
      let data: any = null;
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try { data = JSON.parse(line.slice(6)); } catch { return null; }
        }
      }
      if (!data) return null;

      switch (data.type) {
        case "message_start": {
          s.msgId = data.message?.id ?? "chatcmpl-agentfare";
          return emit({ role: "assistant" });
        }
        case "content_block_start": {
          const cb = data.content_block;
          if (cb?.type === "tool_use") {
            // Assign a dense 0-based OpenAI tool_call index and emit the
            // opening delta (id + name + empty arguments). Later
            // input_json_delta events reuse this index to append arguments.
            const blockIndex: number = data.index ?? 0;
            const openaiIndex = s.nextToolCallIndex++;
            s.toolBlockIndex.set(blockIndex, openaiIndex);
            return emit({
              tool_calls: [{
                index: openaiIndex,
                id: cb.id ?? `call_${openaiIndex}`,
                type: "function",
                function: { name: cb.name ?? "", arguments: "" },
              }],
            });
          }
          // A text content_block_start carries no information OpenAI needs —
          // the text arrives via text_delta. Null lets the wrapper drop it.
          return null;
        }
        case "content_block_delta": {
          const delta = data.delta;
          if (!delta) return null;
          if (delta.type === "text_delta") {
            return emit({ content: delta.text ?? "" });
          }
          if (delta.type === "input_json_delta") {
            const blockIndex: number = data.index ?? 0;
            const openaiIndex = s.toolBlockIndex.get(blockIndex);
            if (openaiIndex === undefined) return null;
            return emit({
              tool_calls: [{
                index: openaiIndex,
                function: { arguments: delta.partial_json ?? "" },
              }],
            });
          }
          return null;
        }
        case "content_block_stop":
          // OpenAI signals tool-call completion only via finish_reason; there
          // is no per-block stop equivalent to emit.
          return null;
        case "message_delta": {
          return emit({}, mapStopReasonToFinish(data.delta?.stop_reason));
        }
        case "message_stop":
          return "data: [DONE]\n\n";
        default:
          return null;
      }
    },
  };
}

function mapStopReasonToFinish(stopReason: string | undefined): string {
  switch (stopReason) {
    case "tool_use": return "tool_calls";
    case "max_tokens": return "length";
    case "end_turn":
    case "stop_sequence":
    default:
      return "stop";
  }
}
