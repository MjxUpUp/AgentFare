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
 *   event: message_start   data: {"type":"message_start","message":{...}}
 *   event: content_block_start data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
 *   event: content_block_delta  data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
 *   event: content_block_stop   data: {"type":"content_block_stop","index":0}
 *   event: message_delta        data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},...}
 *   event: message_stop         data: {"type":"message_stop"}
 */

let state: "idle" | "started" | "text_block_started" = "idle";
let msgId = "";

export function resetSSEState(): void {
  state = "idle";
  msgId = "";
}

export function convertOpenAISSEToAnthropic(sseChunk: string, model: string): string | null {
  const lines = sseChunk.split("\n");
  const results: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const dataStr = line.slice(6).trim();

    if (dataStr === "[DONE]") {
      // Emit content_block_stop, message_delta, message_stop
      if (state === "text_block_started") {
        results.push(formatSSE("content_block_stop", { type: "content_block_stop", index: 0 }));
      }
      results.push(formatSSE("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 0 },
      }));
      results.push(formatSSE("message_stop", { type: "message_stop" }));
      state = "idle";
      continue;
    }

    let data: any;
    try { data = JSON.parse(dataStr); } catch { continue; }

    const choice = data.choices?.[0];
    if (!choice) continue;

    // First chunk with role -> message_start
    if (state === "idle" && choice.delta?.role) {
      msgId = data.id ?? `msg_${Date.now()}`;
      results.push(formatSSE("message_start", {
        type: "message_start",
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));
      // Also start a text content block
      results.push(formatSSE("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }));
      state = "text_block_started";
    }

    // Content delta
    if (choice.delta?.content !== undefined && choice.delta.content !== null) {
      if (state === "idle") {
        // Edge case: content arrived before role — start message first
        msgId = data.id ?? `msg_${Date.now()}`;
        results.push(formatSSE("message_start", {
          type: "message_start",
          message: {
            id: msgId,
            type: "message",
            role: "assistant",
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }));
        results.push(formatSSE("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        }));
        state = "text_block_started";
      }
      results.push(formatSSE("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: choice.delta.content },
      }));
    }

    // Finish reason
    if (choice.finish_reason) {
      if (state === "text_block_started") {
        results.push(formatSSE("content_block_stop", { type: "content_block_stop", index: 0 }));
      }
      const stopReason = mapFinishReason(choice.finish_reason);
      results.push(formatSSE("message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 0 },
      }));
      results.push(formatSSE("message_stop", { type: "message_stop" }));
      state = "idle";
    }

    // Tool calls delta — emit as tool_use content blocks
    if (choice.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        // Simplified: emit text delta with tool call info as JSON text
        // A full implementation would track partial tool call state
        if (tc.function?.name) {
          results.push(formatSSE("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: `[tool_call: ${tc.function.name}]` },
          }));
        }
      }
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
