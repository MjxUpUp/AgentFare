export function convertAnthropicToOpenAIResponse(
  anthropicResp: any,
  model: string,
): any {
  return {
    id: anthropicResp.id ?? "chatcmpl-agentfare",
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
    usage: buildOpenAIUsage(anthropicResp.usage),
  };
}

/**
 * Map Anthropic token usage to OpenAI usage. Anthropic reports prompt-cache
 * tokens (cache_creation_input_tokens / cache_read_input_tokens) separately;
 * OpenAI's prompt_tokens is the billable input total and counts cached tokens
 * as input. Folding them in keeps cost tracking accurate on cached requests —
 * previously cache tokens were dropped, undercounting input cost.
 */
function buildOpenAIUsage(usage: any) {
  const u = usage ?? {};
  const input = u.input_tokens ?? 0;
  const cacheCreation = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const promptTokens = input + cacheCreation + cacheRead;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: output,
    total_tokens: promptTokens + output,
    ...(cacheRead > 0 ? { prompt_tokens_details: { cached_tokens: cacheRead } } : {}),
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
