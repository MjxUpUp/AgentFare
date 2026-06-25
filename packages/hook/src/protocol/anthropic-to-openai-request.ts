import type { AnthropicMessage, AnthropicContentBlock, OpenAIContentPart } from "./types.js";

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

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | OpenAIContentPart[];
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  tools?: any[];
  temperature?: number;
  stop?: string[];
}

export function convertAnthropicToOpenAIRequest(
  anthropic: AnthropicRequest,
  targetModelId?: string,
): OpenAIRequest {
  // OpenAI's o-series (o1/o3/...) rejects `max_tokens` and requires
  // `max_completion_tokens`; other models accept `max_tokens`. Route by id
  // prefix so a cross-provider hop onto an o-series model isn't rejected.
  const targetModel = targetModelId ?? "gpt-4o";
  const isOSeries = /^o\d/i.test(targetModel);
  const result: OpenAIRequest = {
    model: targetModel,
    messages: [],
    ...(isOSeries
      ? { max_completion_tokens: anthropic.max_tokens }
      : { max_tokens: anthropic.max_tokens }),
    stream: anthropic.stream,
  };

  // Anthropic system prompt -> OpenAI system message
  if (anthropic.system) {
    result.messages.push({ role: "system", content: anthropic.system });
  }

  for (const msg of anthropic.messages) {
    if (msg.role === "user") {
      const converted = convertUserMessage(msg);
      result.messages.push(...converted);
    } else if (msg.role === "assistant") {
      result.messages.push(convertAssistantMessage(msg));
    }
  }

  if (anthropic.tools) {
    result.tools = anthropic.tools.map((t: any) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  if (anthropic.temperature !== undefined) result.temperature = anthropic.temperature;
  if (anthropic.stop_sequences) result.stop = anthropic.stop_sequences;

  return result;
}

/**
 * Anthropic user messages may contain tool_result content blocks.
 * These need to become separate "tool" role messages in OpenAI format.
 */
function convertUserMessage(msg: AnthropicMessage): OpenAIChatMessage[] {
  const results: OpenAIChatMessage[] = [];

  if (typeof msg.content === "string") {
    results.push({ role: "user", content: msg.content });
    return results;
  }
  if (!Array.isArray(msg.content)) return results;

  // Collect text, images, and tool_results separately. Images force OpenAI
  // multipart content (an array of text/image_url parts); tool_results still
  // become their own role:"tool" messages. Previously image blocks were
  // silently dropped, losing multimodal input on a cross-provider hop.
  const textParts: string[] = [];
  const imageParts: OpenAIContentPart[] = [];
  const toolResults: Array<{ tool_use_id: string; content: string }> = [];

  for (const block of msg.content) {
    const typed = block as AnthropicContentBlock;
    if (typed.type === "text") {
      textParts.push(typed.text);
    } else if (typed.type === "image") {
      const url = anthropicImageToOpenAIUrl(typed);
      if (url) imageParts.push({ type: "image_url", image_url: { url } });
    } else if (typed.type === "tool_result") {
      let resultContent: string;
      if (typeof typed.content === "string") {
        resultContent = typed.content;
      } else if (Array.isArray(typed.content)) {
        resultContent = typed.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
      } else {
        resultContent = "";
      }
      toolResults.push({ tool_use_id: typed.tool_use_id, content: resultContent });
    }
  }

  if (imageParts.length > 0) {
    // Multipart content: text (if any) followed by image parts.
    const parts: OpenAIContentPart[] = [];
    if (textParts.length > 0) parts.push({ type: "text", text: textParts.join("\n") });
    parts.push(...imageParts);
    results.push({ role: "user", content: parts });
  } else if (textParts.length > 0) {
    results.push({ role: "user", content: textParts.join("\n") });
  }

  for (const tr of toolResults) {
    results.push({ role: "tool", content: tr.content, tool_call_id: tr.tool_use_id });
  }

  return results;
}

/**
 * Convert an Anthropic image content block's source to an OpenAI image_url.
 * Anthropic supports base64 ({type:"base64", media_type, data}) and url
 * ({type:"url", url}) sources; both map to a single OpenAI image_url.url
 * (a data: URI for base64, the raw URL otherwise).
 */
function anthropicImageToOpenAIUrl(
  block: Extract<AnthropicContentBlock, { type: "image" }>,
): string | null {
  const source = block.source;
  if (!source) return null;
  if (source.type === "base64") {
    if (!source.data) return null;
    return `data:${source.media_type ?? "image/png"};base64,${source.data}`;
  }
  if (source.type === "url") {
    return source.url ?? null;
  }
  return null;
}

/**
 * Anthropic assistant messages may contain tool_use content blocks.
 * These map to OpenAI tool_calls on the assistant message.
 */
function convertAssistantMessage(msg: AnthropicMessage): OpenAIChatMessage {
  const result: OpenAIChatMessage = { role: "assistant", content: null };

  if (typeof msg.content === "string") {
    result.content = msg.content;
  } else if (Array.isArray(msg.content)) {
    const textParts: string[] = [];
    const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

    for (const block of msg.content) {
      const typed = block as AnthropicContentBlock;
      if (typed.type === "text") {
        textParts.push(typed.text);
      } else if (typed.type === "tool_use") {
        let args: string;
        try {
          args = JSON.stringify(typed.input);
        } catch {
          args = "{}";
        }
        toolCalls.push({
          id: typed.id,
          type: "function",
          function: { name: typed.name, arguments: args },
        });
      }
    }

    result.content = textParts.length > 0 ? textParts.join("\n") : null;
    if (toolCalls.length > 0) {
      result.tool_calls = toolCalls;
    }
  }

  return result;
}
