/**
 * Convert an OpenAI chat completion response into Anthropic message format.
 */
export function convertOpenAIToAnthropicResponse(openaiResp: any, model: string): any {
  const choice = openaiResp.choices?.[0];
  const message = choice?.message;

  const content: any[] = [];

  if (message?.content) {
    content.push({ type: "text", text: message.content });
  }

  if (message?.tool_calls && Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      let input: any = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = {};
      }
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // If no content blocks at all, add an empty text block
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return {
    id: openaiResp.id ?? `msg-${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens ?? 0,
      output_tokens: openaiResp.usage?.completion_tokens ?? 0,
    },
  };
}

function mapFinishReason(reason: string | undefined): string {
  switch (reason) {
    case "stop": return "end_turn";
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    default: return "end_turn";
  }
}
