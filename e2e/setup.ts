import { ModelRegistry } from "@agentfare/models";
import { DEFAULT_CONFIG } from "@agentfare/core";
import type { AgentFareConfig } from "@agentfare/core";

export function createTestEnv(configOverrides: Partial<AgentFareConfig> = {}) {
  const config: AgentFareConfig = {
    ...DEFAULT_CONFIG,
    ...configOverrides,
    routing: { ...DEFAULT_CONFIG.routing, ...configOverrides.routing },
  };
  const registry = new ModelRegistry();
  return { config, registry };
}

// --- SSE Helper Functions ---

/**
 * Build a single SSE `data:` line from a JSON object or raw string.
 * Returns a string ending with `\n\n` per SSE spec.
 */
export function makeSSEChunk(data: object | string): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `data: ${payload}\n\n`;
}

/**
 * Build a complete OpenAI streaming response body.
 * Each item in `chunks` becomes one SSE `data:` line with the OpenAI chunk envelope.
 * If `withUsage` is true, the last chunk includes `usage` fields.
 * Ends with `data: [DONE]\n\n`.
 */
export function makeOpenAIStream(chunks: object[], withUsage?: boolean): string {
  const lines: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (withUsage && i === chunks.length - 1) {
      const withUsageChunk = { ...chunk, usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };
      lines.push(makeSSEChunk(withUsageChunk));
    } else {
      lines.push(makeSSEChunk(chunk));
    }
  }
  lines.push(makeSSEChunk("[DONE]"));
  return lines.join("");
}

/**
 * Build a complete Anthropic streaming response body.
 * Generates SSE events for: message_start, content_block_delta (with text),
 * message_delta (with stop_reason and usage), and message_stop.
 */
export function makeAnthropicStream(content: string, inputTokens: number, outputTokens: number): string {
  const parts: string[] = [];

  // message_start
  parts.push(makeSSEChunk({
    type: "message_start",
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-test",
      stop_reason: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  }));

  // content_block_delta for the text content
  parts.push(makeSSEChunk({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  }));

  parts.push(makeSSEChunk({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: content },
  }));

  parts.push(makeSSEChunk({
    type: "content_block_stop",
    index: 0,
  }));

  // message_delta with stop_reason and usage
  parts.push(makeSSEChunk({
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: outputTokens },
  }));

  // message_stop
  parts.push(makeSSEChunk({
    type: "message_stop",
  }));

  return parts.join("");
}
