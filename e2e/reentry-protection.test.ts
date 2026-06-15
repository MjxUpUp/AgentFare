import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "@agentfare/hook/fetch-patch";
import { RequestHandler } from "@agentfare/hook/request-handler";
import { DEFAULT_CONFIG } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import { makeInternalHeaders } from "@agentfare/hook/reentry-guard";

/**
 * E2E: Reentry protection tests.
 *
 * Verify that internal fetch calls (e.g., from L2 analyzer) are not
 * intercepted by the fetch patch, preventing infinite loops and double-routing.
 */
describe("E2E: Reentry protection", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
  });

  it("should NOT intercept internal fetch calls with x-agentfare-internal header", async () => {
    const outerCaptured: any[] = [];
    const innerCaptured: any[] = [];

    const realOriginalFetch = originalFetch;

    // The patched fetch should intercept normal calls but NOT internal ones
    let callCount = 0;
    globalThis.fetch = async function (input, init) {
      callCount++;
      const url = typeof input === "string" ? input : "";
      // Check if this is an internal request
      const headers = (init as any)?.headers;
      const isInternal = headers?.["x-agentfare-internal"] === "true"
        || headers?.["x-AgentFare-Internal"] === "true";

      if (isInternal) {
        innerCaptured.push({ url, isInternal });
      } else {
        outerCaptured.push({ url, isInternal });
      }

      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "done" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    uninstall = installFetchPatch({ handler });

    // Make an internal request with x-agentfare-internal header
    const internalResponse = await globalThis.fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-5.3-codex-spark",
          messages: [{ role: "user", content: "analyze this" }],
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test",
          ...makeInternalHeaders(),
        },
      },
    );

    expect(internalResponse.status).toBe(200);
    // The internal fetch should go through directly (bypass routing)
    // The handler's fetch (the patched one) should have been called once
    // but since it's internal, it should have been passed to original
    expect(innerCaptured.length).toBe(1);
    expect(innerCaptured[0].isInternal).toBe(true);
  });

  it("should only route the outer fetch, not nested internal fetches", async () => {
    const routedCalls: string[] = [];
    const directCalls: string[] = [];

    const registry = new ModelRegistry();

    // Track which calls get routed (body modified) vs direct (body unchanged)
    globalThis.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : "";
      const body = JSON.parse((init as any)?.body ?? "{}");
      const isInternal = (init as any)?.headers?.["x-agentfare-internal"] === "true";

      if (isInternal) {
        directCalls.push(url);
      } else {
        routedCalls.push(url);
      }

      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "response" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    uninstall = installFetchPatch({ handler });

    // Outer call — should be routed
    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    // Inner call with internal header — should NOT be routed
    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.3-codex-spark",
        messages: [{ role: "user", content: "internal analysis" }],
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test",
        ...makeInternalHeaders(),
      },
    });

    // The outer call should be captured by the routing pipeline
    expect(routedCalls.length).toBeGreaterThanOrEqual(1);
    // The inner call should bypass routing entirely
    expect(directCalls).toHaveLength(1);
    expect(directCalls[0]).toContain("openai");
  });

  it("should allow normal requests without internal header to be routed", async () => {
    const captured: any[] = [];

    globalThis.fetch = async (input, init) => {
      captured.push({
        url: typeof input === "string" ? input : "",
        body: (init as any)?.body,
      });
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "done" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);
    uninstall = installFetchPatch({ handler });

    // Normal request without internal header
    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(captured[0].body);
    // Should have been routed (model changed from gpt-5.5)
    expect(body.model).not.toBe("gpt-5.5");
  });
});
