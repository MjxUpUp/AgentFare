import type { OpenAIChatMessage, OpenAIContentPart, AnthropicMessage, AnthropicContentBlock } from "./types.js";
import { getLogger } from "@agentfare/core";

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

/** Internal type for tool result entries during merge */
interface ToolResultEntry {
  tool_call_id?: string;
  content: string | null;
}

/** Internal type for merged message pass */
type MergedItem =
  | { kind: "system" | "user" | "assistant"; msg: OpenAIChatMessage }
  | { kind: "tool_group"; tools: ToolResultEntry[] };

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

  // Collect all system messages and join them (OpenAI allows multiple)
  const systemParts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "system") continue;
    if (typeof msg.content === "string") {
      systemParts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      // Extract text from content parts (e.g. [{type:"text",text:"..."}])
      for (const part of msg.content) {
        if (typeof part === "object" && part.type === "text" && typeof part.text === "string") {
          systemParts.push(part.text);
        }
      }
    }
  }
  if (systemParts.length > 0) {
    result.system = systemParts.join("\n\n");
  }

  // Pass 1: merge consecutive tool messages into groups
  const merged: MergedItem[] = [];
  for (const msg of messages) {
    if (msg.role === "tool") {
      const toolContent = typeof msg.content === "string" ? msg.content : null;
      const last = merged[merged.length - 1];
      if (last && last.kind === "tool_group") {
        last.tools.push({ tool_call_id: msg.tool_call_id, content: toolContent });
      } else {
        merged.push({ kind: "tool_group", tools: [{ tool_call_id: msg.tool_call_id, content: toolContent }] });
      }
    } else {
      merged.push({ kind: msg.role, msg });
    }
  }

  // Pass 2: convert each merged item to Anthropic format
  for (const item of merged) {
    if (item.kind === "system") continue;

    if (item.kind === "user") {
      const content = convertUserContent(item.msg.content);
      result.messages.push({ role: "user", content });
    } else if (item.kind === "assistant") {
      const content: AnthropicContentBlock[] = [];
      const msg = item.msg;
      if (msg.content && typeof msg.content === "string") content.push({ type: "text", text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let parsedInput: any;
          try {
            parsedInput = JSON.parse(tc.function.arguments);
          } catch {
            getLogger().warn(
              `openai-to-anthropic: failed to parse tool_call arguments (id=${tc.id}, name=${tc.function.name}), falling back to empty object`,
            );
            parsedInput = {};
          }
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: parsedInput,
          });
        }
      }
      result.messages.push({ role: "assistant", content });
    } else if (item.kind === "tool_group") {
      // Anthropic requires consecutive tool_results in a single user message
      const toolBlocks: AnthropicContentBlock[] = item.tools.map((t) => ({
        type: "tool_result" as const,
        tool_use_id: t.tool_call_id ?? "",
        content: t.content ?? "",
      }));
      result.messages.push({ role: "user", content: toolBlocks });
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

/**
 * Convert OpenAI user message content to Anthropic format.
 * Handles string, null, and ContentPart[] (multimodal) inputs.
 */
function convertUserContent(
  content: string | null | OpenAIContentPart[],
): string | AnthropicContentBlock[] {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === "text" && part.text) {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image_url" && part.image_url?.url) {
      const url = part.image_url.url;
      if (url.startsWith("data:")) {
        const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (match) {
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: match[1],
              data: match[2],
            },
          });
        }
      } else {
        blocks.push({
          type: "image",
          source: {
            type: "url",
            url,
          },
        });
      }
    }
  }

  // If only one text block, return as plain string for simplicity
  if (blocks.length === 1 && blocks[0].type === "text") {
    return (blocks[0] as { type: "text"; text: string }).text;
  }
  return blocks.length > 0 ? blocks : "";
}
