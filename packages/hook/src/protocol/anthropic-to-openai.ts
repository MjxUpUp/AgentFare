export function convertAnthropicToOpenAIResponse(
  anthropicResp: any,
  model: string,
): any {
  return {
    id: anthropicResp.id ?? "chatcmpl-agentdispatch",
    object: "chat.completion",
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: extractTextContent(anthropicResp.content),
        tool_calls: extractToolCalls(anthropicResp.content),
      },
      finish_reason: mapFinishReason(anthropicResp.stop_reason),
    }],
    usage: {
      prompt_tokens: anthropicResp.usage?.input_tokens ?? 0,
      completion_tokens: anthropicResp.usage?.output_tokens ?? 0,
      total_tokens: (anthropicResp.usage?.input_tokens ?? 0) + (anthropicResp.usage?.output_tokens ?? 0),
    },
  };
}

function extractTextContent(content: any[]): string {
  if (!Array.isArray(content)) return "";
  return content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

function extractToolCalls(content: any[]): any[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const toolUses = content.filter((b: any) => b.type === "tool_use");
  if (toolUses.length === 0) return undefined;
  return toolUses.map((tu: any, i: number) => ({
    id: tu.id,
    type: "function",
    function: { name: tu.name, arguments: JSON.stringify(tu.input) },
  }));
}

function mapFinishReason(reason: string | undefined): string {
  switch (reason) {
    case "end_turn": return "stop";
    case "max_tokens": return "length";
    case "stop_sequence": return "stop";
    case "tool_use": return "tool_calls";
    default: return "stop";
  }
}
