import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "@agentdispatch/hook/fetch-patch";
import { RequestHandler } from "@agentdispatch/hook/request-handler";
import { DEFAULT_CONFIG } from "@agentdispatch/core";
import { ModelRegistry } from "@agentdispatch/models";

describe("E2E: Streaming response handling", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
  });

  it("should handle SSE streaming responses", async () => {
    const sseBody = `data: {"id":"test","object":"chat.completion.chunk","model":"gpt-5.3-codex-spark","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\ndata: {"id":"test","object":"chat.completion.chunk","model":"gpt-5.3-codex-spark","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\ndata: [DONE]\n\n`;

    globalThis.fetch = async () => {
      return new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    uninstall = installFetchPatch({ handler });

    const response = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files in src/" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("[DONE]");
  });
});
