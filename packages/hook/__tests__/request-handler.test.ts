import { describe, it, expect } from "vitest";
import { RequestHandler } from "../src/request-handler.js";
import { ModelRegistry } from "@agentdispatch/models";
import { DEFAULT_CONFIG } from "@agentdispatch/core";

describe("RequestHandler", () => {
  const registry = new ModelRegistry();
  const handler = new RequestHandler(DEFAULT_CONFIG, registry);

  it("should parse OpenAI request and return routing decision", async () => {
    const body = JSON.stringify({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "list files in src/" }],
      stream: true,
    });

    const result = await handler.handle(
      "https://api.openai.com/v1/chat/completions",
      body,
      { Authorization: "Bearer sk-test" },
    );

    expect(result).toBeDefined();
    expect(result!.decision.targetModel!.provider).toBe("openai");
    expect(result!.decision.targetModel!.tier).toBe("fast");
    expect(result!.decision.providerSwitched).toBe(false);
    expect(result!.modifiedBody).toBeDefined();
  });
});
