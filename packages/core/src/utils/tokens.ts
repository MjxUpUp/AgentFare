/**
 * Shared token estimation utility.
 * Estimates token count from message arrays using ~4 chars/token heuristic.
 */
import type { Message } from "../analyzer/types.js";

export function estimateTokensFromMessages(messages: Message[]): {
  input: number;
  output: number;
} {
  let totalChars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.text) totalChars += block.text.length;
      }
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        totalChars += tc.function.arguments.length;
      }
    }
  }
  const inputTokens = Math.ceil(totalChars / 4);
  const outputTokens = Math.ceil(inputTokens * 0.3);
  return { input: inputTokens, output: outputTokens };
}
