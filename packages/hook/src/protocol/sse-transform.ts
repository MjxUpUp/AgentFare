export function convertAnthropicSSEToOpenAI(sseChunk: string, model: string): string | null {
  const lines = sseChunk.split("\n");
  let eventType = "";
  let data: any = null;

  for (const line of lines) {
    if (line.startsWith("event: ")) eventType = line.slice(7).trim();
    if (line.startsWith("data: ")) {
      try { data = JSON.parse(line.slice(6)); } catch { return null; }
    }
  }

  if (!data) return null;

  switch (data.type) {
    case "message_start": {
      const id = data.message?.id ?? "chatcmpl-agentdispatch";
      return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`;
    }
    case "content_block_delta": {
      const text = data.delta?.text ?? "";
      return `data: ${JSON.stringify({ id: "chatcmpl-agentdispatch", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`;
    }
    case "message_delta": {
      const finishReason = data.delta?.stop_reason === "tool_use" ? "tool_calls" : "stop";
      return `data: ${JSON.stringify({ id: "chatcmpl-agentdispatch", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`;
    }
    case "message_stop":
      return "data: [DONE]\n\n";
    default:
      return null;
  }
}
