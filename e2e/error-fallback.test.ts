import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installFetchPatch } from "@agentfare/hook/fetch-patch";
import { DEFAULT_CONFIG } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import type { RequestHandler, HandleResult } from "@agentfare/hook/request-handler";

/**
 * E2E: Error fallback tests.
 *
 * Verify that when the routing handler fails (throws, times out, or the
 * target API returns 5xx), the original request passes through correctly.
 */
describe("E2E: Error fallback", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
  });

  it("should pass through original request when handler throws exception", async () => {
    const captured: any[] = [];

    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
      });
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "original response" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const registry = new ModelRegistry();

    // Handler that always throws
    const mockHandler: RequestHandler = {
      handle: async () => {
        throw new Error("Simulated handler failure");
      },
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    const response = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    // User should still get a valid response
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe("original response");

    // The original request should have been passed through unchanged
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toContain("openai");
    const reqBody = JSON.parse(captured[0].body);
    expect(reqBody.model).toBe("gpt-5.5");
  });

  it("should fall back to original model when handler exceeds timeout (§11)", async () => {
    const captured: any[] = [];

    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
      });
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "fallback response" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const registry = new ModelRegistry();

    // Handler that takes >500ms (the ANALYZER_TIMEOUT_MS in fetch-patch.ts)
    const mockHandler: RequestHandler = {
      handle: async () => {
        // Wait longer than the 500ms timeout
        await new Promise((resolve) => setTimeout(resolve, 600));
        return null;
      },
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    const response = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    // Should still get a response via fallback
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe("fallback response");

    // Original request should have been sent unchanged (original model)
    expect(captured).toHaveLength(1);
    const reqBody = JSON.parse(captured[0].body);
    expect(reqBody.model).toBe("gpt-5.5");
  });

  it("should pass through 500 error from target API to caller", async () => {
    const captured: any[] = [];
    let callCount = 0;

    globalThis.fetch = async (input, init) => {
      callCount++;
      const url = typeof input === "string" ? input : "";
      captured.push({ url, callCount });

      // First call (routed) returns 500
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: { message: "Internal server error", type: "server_error" } }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }

      // Second call (fallback to original) returns success
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "fallback ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const registry = new ModelRegistry();
    const cheapModel = registry.get("openai/gpt-5.3-codex-spark")!;

    const mockHandler: RequestHandler = {
      handle: async () =>
        ({
          decision: {
            targetModel: cheapModel,
            providerSwitched: false,
            crossProviderMode: "off" as const,
            reasoning: "route to cheaper model",
          },
          modifiedBody: JSON.stringify({
            model: cheapModel.api.modelId,
            messages: [{ role: "user", content: "list files" }],
          }),
          analysis: {
            stepType: "simple_tool_use",
            difficulty: 0.1,
            confidence: 0.9,
            recommendedTier: "fast",
            recommendedModel: "",
            reasoning: "simple task",
            needsProviderSwitch: false,
            estimatedTokens: { input: 100, output: 50 },
            alternatives: [],
          },
          sessionId: "ad-error-500-1",
        }) as HandleResult,
    } as any as RequestHandler;

    uninstall = installFetchPatch({ handler: mockHandler });

    const response = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    // The 5xx fallback should trigger: re-send with original request
    // The caller should get the fallback response (200 with original model)
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe("fallback ok");

    // Two calls should have been made: first (failed), second (fallback)
    expect(callCount).toBe(2);
  });

  it("should invoke onError callback when handler throws", async () => {
    const errors: unknown[] = [];

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ id: "test" }),
        { status: 200 },
      );
    };

    const registry = new ModelRegistry();

    const mockHandler: RequestHandler = {
      handle: async () => {
        throw new Error("Test error for onError callback");
      },
    } as any as RequestHandler;

    uninstall = installFetchPatch({
      handler: mockHandler,
      onError: (err) => { errors.push(err); },
    });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "test" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe("Test error for onError callback");
  });
});
