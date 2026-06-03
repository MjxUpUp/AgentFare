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
  /** ISSUE-083: Accumulated tokens — onTokens called once in _flush */
  private accumulatedTokens: StreamTokenData = { input: 0, output: 0 };

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

      // ISSUE-083: Accumulate tokens instead of calling onTokens per event.
      // Anthropic splits usage across message_start (input) and message_delta (output),
      // causing double cost records. Accumulate and fire once in _flush.
      const extractor = this.protocol === "openai"
        ? extractTokenUsageOpenAI
        : extractTokenUsageAnthropic;
      const tokenData = extractor(part + "\n\n");
      if (tokenData) {
        this.accumulatedTokens.input += tokenData.input;
        this.accumulatedTokens.output += tokenData.output;
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
        this.accumulatedTokens.input += tokenData.input;
        this.accumulatedTokens.output += tokenData.output;
      }

      if (this.protocolConverter) {
        const converted = this.protocolConverter(this.buffer);
        if (converted) {
          // ISSUE-083: Fire accumulated tokens before ending
          if (this.accumulatedTokens.input > 0 || this.accumulatedTokens.output > 0) {
            this.onTokens(this.accumulatedTokens);
          }
          callback(null, Buffer.from(converted, "utf-8"));
          return;
        }
      }
      // ISSUE-083: Fire accumulated tokens before ending
      if (this.accumulatedTokens.input > 0 || this.accumulatedTokens.output > 0) {
        this.onTokens(this.accumulatedTokens);
      }
      callback(null, Buffer.from(this.buffer, "utf-8"));
    } else {
      // ISSUE-083: Fire accumulated tokens even if no trailing buffer
      if (this.accumulatedTokens.input > 0 || this.accumulatedTokens.output > 0) {
        this.onTokens(this.accumulatedTokens);
      }
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
