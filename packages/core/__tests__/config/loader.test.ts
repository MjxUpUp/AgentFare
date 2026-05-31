import { describe, it, expect } from "vitest";
import { mergeConfig } from "../../src/config/loader.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

describe("mergeConfig", () => {
  it("should return defaults when no overrides provided", () => {
    const result = mergeConfig();
    expect(result.routing.crossProvider).toBe("off");
    expect(result.routing.defaultStrategy).toBe("cost-optimal");
  });

  it("should merge global config over defaults", () => {
    const result = mergeConfig({
      global: { routing: { defaultStrategy: "quality-first" } } as any,
    });
    expect(result.routing.defaultStrategy).toBe("quality-first");
    expect(result.routing.crossProvider).toBe("off");
  });

  it("should merge project config over global config", () => {
    const result = mergeConfig({
      global: { routing: { defaultStrategy: "quality-first" } } as any,
      project: { routing: { crossProvider: "opt-in" } } as any,
    });
    expect(result.routing.defaultStrategy).toBe("quality-first");
    expect(result.routing.crossProvider).toBe("opt-in");
  });

  it("should merge models arrays by concatenating and deduplicating", () => {
    const result = mergeConfig({
      project: {
        models: { fast: ["custom/my-model"] },
      } as any,
    });
    expect(result.models.fast).toContain("custom/my-model");
    expect(result.models.fast).toContain("openai/gpt-5.3-codex-spark");
  });
});
