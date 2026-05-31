import { describe, it, expect } from "vitest";
import { analyzeStepRules } from "../../src/analyzer/rules.js";

describe("analyzeStepRules (L1)", () => {
  it("should classify simple tool calls as fast tier", () => {
    const result = analyzeStepRules({
      messages: [{ role: "user", content: "list files in src/" }],
      originalModel: "anthropic/claude-opus-4-6",
    });
    expect(result).not.toBeNull();
    expect(result!.recommendedTier).toBe("fast");
    expect(result!.stepType).toBe("simple_tool_use");
  });

  it("should classify file read tool results as exploration", () => {
    const result = analyzeStepRules({
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "1",
              type: "function",
              function: { name: "read_file", arguments: "{}" },
            },
          ],
        },
        { role: "tool", content: "file contents here..." },
      ],
      originalModel: "anthropic/claude-opus-4-6",
    });
    expect(result).not.toBeNull();
    expect(result!.stepType).toBe("exploration");
    expect(result!.recommendedTier).toBe("fast");
  });

  it("should classify formatting/lint as fast tier", () => {
    const result = analyzeStepRules({
      messages: [
        { role: "user", content: "format this code with prettier" },
      ],
      originalModel: "openai/gpt-5.5",
    });
    expect(result).not.toBeNull();
    expect(result!.recommendedTier).toBe("fast");
  });

  it("should return null for complex tasks that need L2 analysis", () => {
    const result = analyzeStepRules({
      messages: [
        {
          role: "user",
          content: "Design a new authentication system with OAuth2 and JWT",
        },
      ],
      originalModel: "openai/gpt-5.5",
    });
    expect(result).toBeNull();
  });

  it("should classify confirmation replies as fast tier", () => {
    const result = analyzeStepRules({
      messages: [{ role: "user", content: "yes, proceed" }],
      originalModel: "anthropic/claude-opus-4-6",
    });
    expect(result).not.toBeNull();
    expect(result!.stepType).toBe("confirmation");
    expect(result!.recommendedTier).toBe("fast");
  });
});
