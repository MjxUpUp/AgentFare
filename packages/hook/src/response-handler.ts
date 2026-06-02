export interface StreamTokenData {
  input: number;
  output: number;
}

export function extractTokenUsageOpenAI(sseText: string): StreamTokenData | null {
  const lines = sseText.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.usage) {
          return {
            input: data.usage.prompt_tokens ?? 0,
            output: data.usage.completion_tokens ?? 0,
          };
        }
      } catch {}
    }
  }
  return null;
}

export function extractTokenUsageAnthropic(sseText: string): StreamTokenData | null {
  let inputTokens = 0;
  let outputTokens = 0;
  const lines = sseText.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "message_start" && data.message?.usage) {
          inputTokens = data.message.usage.input_tokens ?? 0;
        }
        if (data.type === "message_delta" && data.usage) {
          outputTokens = data.usage.output_tokens ?? 0;
        }
      } catch {}
    }
  }
  return inputTokens > 0 || outputTokens > 0 ? { input: inputTokens, output: outputTokens } : null;
}

export type SSEProtocolConverter = (sseChunk: string) => string | null;

export function createStreamingResponseWrapper(
  originalResponse: Response,
  protocol: "openai" | "anthropic",
  onTokens: (tokens: StreamTokenData) => void,
  protocolConverter?: SSEProtocolConverter,
): Response {
  const decoder = new TextDecoder();

  const { readable, writable } = new TransformStream({
    transform(chunk, controller) {
      if (protocolConverter) {
        const text = decoder.decode(chunk, { stream: true });
        // SSE chunks are separated by double newlines
        const rawEvents = text.split(/\n\n/);
        const convertedParts: string[] = [];

        for (const rawEvent of rawEvents) {
          if (!rawEvent.trim()) continue;
          const converted = protocolConverter(rawEvent);
          if (converted) {
            convertedParts.push(converted);
          } else {
            // Passthrough unconverted events
            convertedParts.push(rawEvent + "\n\n");
          }
        }

        if (convertedParts.length > 0) {
          controller.enqueue(new TextEncoder().encode(convertedParts.join("")));
        }

        // Token extraction from original text
        const extractor = protocol === "openai" ? extractTokenUsageOpenAI : extractTokenUsageAnthropic;
        const tokenData = extractor(text);
        if (tokenData) {
          onTokens(tokenData);
        }
      } else {
        controller.enqueue(chunk);
        const text = decoder.decode(chunk, { stream: true });
        const extractor = protocol === "openai" ? extractTokenUsageOpenAI : extractTokenUsageAnthropic;
        const tokenData = extractor(text);
        if (tokenData) {
          onTokens(tokenData);
        }
      }
    },
  });

  originalResponse.body?.pipeTo(writable).catch(() => {});

  return new Response(readable, {
    status: originalResponse.status,
    headers: originalResponse.headers,
  });
}
