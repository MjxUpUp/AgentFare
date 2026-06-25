import { describe, it, expect } from "vitest";
import {
  extractTokenUsageOpenAI,
  extractTokenUsageAnthropic,
  createStreamingResponseWrapper,
} from "../src/response-handler.js";

describe("extractTokenUsageOpenAI", () => {
  it("should extract token usage from usage chunk", () => {
    const sseText = [
      'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}',
    ].join("\n");

    const result = extractTokenUsageOpenAI(sseText);
    expect(result).toEqual({ input: 10, output: 20 });
  });

  it("should skip [DONE] message", () => {
    const sseText = "data: [DONE]";
    expect(extractTokenUsageOpenAI(sseText)).toBeNull();
  });

  it("should skip non-JSON lines", () => {
    const sseText = "data: not-json-at-all\ndata: [DONE]";
    expect(extractTokenUsageOpenAI(sseText)).toBeNull();
  });

  it("should return null when no usage field exists", () => {
    const sseText = 'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"hi"}}]}';
    expect(extractTokenUsageOpenAI(sseText)).toBeNull();
  });

  it("should handle missing prompt_tokens with fallback to 0", () => {
    const sseText = 'data: {"id":"chatcmpl-1","usage":{"completion_tokens":5}}';
    const result = extractTokenUsageOpenAI(sseText);
    expect(result).toEqual({ input: 0, output: 5 });
  });
});

describe("extractTokenUsageAnthropic", () => {
  it("should extract input_tokens from message_start", () => {
    const sseText = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":15}}}',
    ].join("\n");

    const result = extractTokenUsageAnthropic(sseText);
    expect(result).toEqual({ input: 15, output: 0 });
  });

  it("should extract output_tokens from message_delta", () => {
    const sseText = [
      'data: {"type":"message_delta","usage":{"output_tokens":8}}',
    ].join("\n");

    const result = extractTokenUsageAnthropic(sseText);
    expect(result).toEqual({ input: 0, output: 8 });
  });

  it("should combine input and output from multiple events", () => {
    const sseText = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}',
      'data: {"type":"content_block_delta","delta":{"text":"hi"}}',
      'data: {"type":"message_delta","usage":{"output_tokens":42}}',
    ].join("\n");

    const result = extractTokenUsageAnthropic(sseText);
    expect(result).toEqual({ input: 100, output: 42 });
  });

  it("should return null when no token data present", () => {
    const sseText = 'data: {"type":"content_block_delta","delta":{"text":"hello"}}';
    expect(extractTokenUsageAnthropic(sseText)).toBeNull();
  });
});

/**
 * Helper: feed chunks into a Response stream and read the wrapped output.
 * Writes to the source concurrently with reading from the wrapper to avoid
 * deadlock between pipeTo and reader.read().
 */
async function feedAndCollect(
  chunks: Uint8Array[],
  protocol: "openai" | "anthropic",
  onTokens: (tokens: any) => void,
): Promise<{ output: Uint8Array[]; tokens: any[] }> {
  const { readable: srcReadable, writable: srcWritable } = new TransformStream();
  const originalResponse = new Response(srcReadable, { status: 200 });
  const collectedTokens: any[] = [];

  const wrapped = createStreamingResponseWrapper(
    originalResponse,
    protocol,
    (t) => collectedTokens.push(t),
  );

  // Write and read concurrently to avoid deadlock
  const writeDone = (async () => {
    const writer = srcWritable.getWriter();
    for (const chunk of chunks) {
      await writer.write(chunk);
    }
    await writer.close();
  })();

  const collected: Uint8Array[] = [];
  const reader = wrapped.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    collected.push(value);
  }

  await writeDone;
  return { output: collected, tokens: collectedTokens };
}

describe("createStreamingResponseWrapper", () => {
  it("should pass through SSE chunks and call onTokens callback (openai)", async () => {
    const chunks = [
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'),
      new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":10}}\n\n'),
    ];

    const { output, tokens } = await feedAndCollect(chunks, "openai", () => {});

    // Verify passthrough: total bytes should be preserved
    const totalOutput = output.reduce((sum, c) => sum + c.length, 0);
    const totalInput = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalOutput).toBe(totalInput);

    // Verify token callback was invoked
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ input: 5, output: 10 });
  });

  it("should pass through SSE chunks and call onTokens callback (anthropic)", async () => {
    const chunks = [
      new TextEncoder().encode('data: {"type":"message_start","message":{"usage":{"input_tokens":25}}}\n\n'),
      new TextEncoder().encode('data: {"type":"message_delta","usage":{"output_tokens":12}}\n\n'),
    ];

    const { output, tokens } = await feedAndCollect(chunks, "anthropic", () => {});

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ input: 25, output: 0 });
    expect(tokens[1]).toEqual({ input: 0, output: 12 });
  });

  it("should preserve response status and headers", () => {
    const originalResponse = new Response(null, {
      status: 201,
      headers: { "x-custom": "test" },
    });

    const wrapped = createStreamingResponseWrapper(
      originalResponse,
      "openai",
      () => {},
    );

    expect(wrapped.status).toBe(201);
    expect(wrapped.headers.get("x-custom")).toBe("test");
  });

  it("regression ISSUE-040: cross-chunk boundary SSE parsing", async () => {
    // Simulate a chunk boundary splitting an SSE event across two chunks
    const part1 = new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tok');
    const part2 = new TextEncoder().encode('ens":7,"completion_tokens":3}}\n\n');

    const { output } = await feedAndCollect([part1, part2], "openai", () => {});

    // In passthrough mode (no protocolConverter), chunks are forwarded as-is.
    // Token extraction may fail if the boundary splits the JSON — this test
    // documents that the stream still completes without error.
    const totalOutput = output.reduce((sum, c) => sum + c.length, 0);
    expect(totalOutput).toBe(part1.length + part2.length);
  });

  it("reassembles an SSE event split across chunks before converting", async () => {
    // A single SSE event is split across two TCP chunks in the middle of its
    // JSON. Without the pendingTail buffer the first half (no closing \n\n)
    // would be fed to the converter as an incomplete event and lost.
    const event = 'data: {"choices":[{"delta":{"content":"HELLO"}}]}\n\n';
    const part1 = new TextEncoder().encode(event.slice(0, 12));
    const part2 = new TextEncoder().encode(event.slice(12));

    let seenComplete = false;
    const converter = (raw: string): string | null => {
      // Only a complete event parses cleanly — this proves the two halves were
      // joined before the converter ran.
      const m = raw.match(/^data: (.*)$/m);
      if (m) {
        try { JSON.parse(m[1]); seenComplete = true; return raw + "\n"; } catch { return null; }
      }
      return null;
    };

    const { readable: src, writable: sink } = new TransformStream();
    const wrapped = createStreamingResponseWrapper(
      new Response(src, { status: 200 }),
      "openai",
      () => {},
      converter,
    );

    // Write and read concurrently to avoid deadlock between pipeTo and
    // reader.read() (same pattern as feedAndCollect above).
    const writeDone = (async () => {
      const writer = sink.getWriter();
      for (const c of [part1, part2]) await writer.write(c);
      await writer.close();
    })();

    const out: string[] = [];
    const reader = wrapped.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(new TextDecoder().decode(value));
    }
    await writeDone;

    expect(seenComplete).toBe(true);
    expect(out.join("")).toContain("HELLO");
  });
});
