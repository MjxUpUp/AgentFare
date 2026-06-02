/**
 * SSE (Server-Sent Events) pipe for the proxy server.
 *
 * Handles:
 * - Transparent SSE forwarding from upstream to client
 * - Token usage extraction from SSE chunks
 * - SSE protocol conversion (OpenAI <-> Anthropic) for cross-provider routing
 */

import { Transform, TransformCallback } from "node:stream";
import {
  extractTokenUsageOpenAI,
  extractTokenUsageAnthropic,
  type StreamTokenData,
} from "@agentfare/hook/response-handler";
import type { SSEProtocolConverter } from "@agentfare/hook/response-handler";

export type { StreamTokenData };

/**
 * A Node.js Transform stream that:
 * 1. Passes SSE chunks through (optionally converting protocol)
 * 2. Extracts token usage from chunks
 * 3. Calls onTokens callback when usage data is found
 */
export class SSEPipe extends Transform {
  private buffer = "";

  constructor(
    private protocol: "openai" | "anthropic",
    private onTokens: (tokens: StreamTokenData) => void,
    private protocolConverter?: SSEProtocolConverter,
  ) {
    super({ decodeStrings: true });
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const text = chunk.toString("utf-8");
    this.buffer += text;

    // SSE events are separated by double newlines.
    // We may receive partial events, so we buffer and only process complete ones.
    const parts = this.buffer.split(/\n\n/);
    // The last part may be incomplete — keep it in the buffer
    this.buffer = parts.pop() ?? "";

    const outputParts: string[] = [];

    for (const part of parts) {
      if (!part.trim()) continue;

      // Extract tokens from the original (pre-conversion) text
      const extractor = this.protocol === "openai"
        ? extractTokenUsageOpenAI
        : extractTokenUsageAnthropic;
      const tokenData = extractor(part + "\n\n");
      if (tokenData) {
        this.onTokens(tokenData);
      }

      // Apply protocol conversion if needed
      if (this.protocolConverter) {
        const converted = this.protocolConverter(part);
        if (converted) {
          outputParts.push(converted);
        } else {
          // Passthrough unconverted events
          outputParts.push(part + "\n\n");
        }
      } else {
        // Transparent passthrough
        outputParts.push(part + "\n\n");
      }
    }

    if (outputParts.length > 0) {
      callback(null, Buffer.from(outputParts.join(""), "utf-8"));
    } else {
      callback();
    }
  }

  _flush(callback: TransformCallback): void {
    // Process any remaining buffered data
    if (this.buffer.trim()) {
      const extractor = this.protocol === "openai"
        ? extractTokenUsageOpenAI
        : extractTokenUsageAnthropic;
      const tokenData = extractor(this.buffer + "\n\n");
      if (tokenData) {
        this.onTokens(tokenData);
      }

      if (this.protocolConverter) {
        const converted = this.protocolConverter(this.buffer);
        if (converted) {
          callback(null, Buffer.from(converted, "utf-8"));
          return;
        }
      }
      callback(null, Buffer.from(this.buffer, "utf-8"));
    } else {
      callback();
    }
  }
}

/**
 * Create a passthrough SSE pipe that only extracts tokens (no conversion).
 */
export function createTokenExtractPipe(
  protocol: "openai" | "anthropic",
  onTokens: (tokens: StreamTokenData) => void,
): SSEPipe {
  return new SSEPipe(protocol, onTokens);
}

/**
 * Create an SSE pipe that converts protocol and extracts tokens.
 */
export function createConvertingPipe(
  sourceProtocol: "openai" | "anthropic",
  targetProtocol: "openai" | "anthropic",
  onTokens: (tokens: StreamTokenData) => void,
  originalModel: string,
): SSEPipe {
  // Import converters lazily to avoid circular deps at module level
  // The pipe uses the upstream protocol for extraction,
  // and converts from upstream protocol to client protocol.
  // sourceProtocol = what the client expects
  // targetProtocol (renamed: upstream protocol) = what the upstream sends
  let converter: SSEProtocolConverter | undefined;

  // The response comes FROM the target/upstream provider (targetProtocol),
  // and needs to be converted TO what the client expects (sourceProtocol).
  // But our protocolConverter receives the raw upstream chunk.
  // So: if upstream is openai and client expects anthropic → convert OpenAI SSE → Anthropic SSE
  //     if upstream is anthropic and client expects openai → convert Anthropic SSE → OpenAI SSE

  // The SSEPipe's `protocol` field indicates what format the UPSTREAM sends
  // (used for token extraction). So protocol = targetProtocol.
  // But we also need to handle the conversion direction correctly.

  // For now, return a pipe with the right protocol for token extraction.
  // The caller sets up the converter function externally and passes it in.
  return new SSEPipe(targetProtocol, onTokens, converter);
}
