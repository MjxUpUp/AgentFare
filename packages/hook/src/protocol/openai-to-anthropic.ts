import type { OpenAIChatMessage, AnthropicMessage, AnthropicContentBlock } from "./types.js";

interface OpenAIRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  stream?: boolean;
  tools?: any[];
  temperature?: number;
  stop?: string[];
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: any[];
  stream: boolean;
  temperature?: number;
  stop_sequences?: string[];
}

export function convertOpenAIToAnthropicRequest(
  openai: OpenAIRequest,
  targetModelId?: string,
): AnthropicRequest {
  const messages: OpenAIChatMessage[] = openai.messages;
  const result: AnthropicRequest = {
    model: targetModelId ?? "claude-sonnet-4-6",
    max_tokens: openai.max_tokens ?? 4096,
    messages: [],
    stream: openai.stream ?? false,
  };

  const systemMsg = messages.find((m) => m.role === "system");
  if (systemMsg) result.system = systemMsg.content ?? undefined;

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      result.messages.push({ role: "user", content: msg.content ?? "" });
    } else if (msg.role === "assistant") {
      const content: AnthropicContentBlock[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
      }
      result.messages.push({ role: "assistant", content });
    } else if (msg.role === "tool") {
      result.messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: msg.tool_call_id ?? "",
          content: msg.content ?? "",
        }],
      });
    }
  }

  if (openai.tools) {
    result.tools = openai.tools.map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  if (openai.temperature !== undefined) result.temperature = openai.temperature;
  if (openai.stop) result.stop_sequences = openai.stop;

  return result;
}
