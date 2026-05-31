import { describe, it, expect } from "vitest";
import { BUILTIN_MODELS } from "../src/builtin-models.js";

describe("BUILTIN_MODELS", () => {
  it("should contain at least one model per major provider", () => {
    const providers = new Set(BUILTIN_MODELS.map((m) => m.provider));
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("deepseek")).toBe(true);
  });

  it("should have valid pricing for all models", () => {
    for (const model of BUILTIN_MODELS) {
      expect(model.pricing.inputPerMillion).toBeGreaterThanOrEqual(0);
      expect(model.pricing.outputPerMillion).toBeGreaterThanOrEqual(0);
      expect(model.pricing.currency).toBe("USD");
    }
  });

  it("should have valid tier for all models", () => {
    const validTiers = new Set(["fast", "standard", "powerful"]);
    for (const model of BUILTIN_MODELS) {
      expect(validTiers.has(model.tier)).toBe(true);
    }
  });

  it("should have unique ids", () => {
    const ids = BUILTIN_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
