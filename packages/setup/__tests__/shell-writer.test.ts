import { describe, it, expect } from "vitest";
import { generateShellFunctions } from "../src/shell-writer.js";

describe("generateShellFunctions", () => {
  it("should generate shell functions for detected tools", () => {
    const result = generateShellFunctions([
      { name: "codex" },
      { name: "claude" },
    ]);
    expect(result).toContain("codex()");
    expect(result).toContain("claude()");
    expect(result).toContain("~/.agentdispatch/loader.js");
  });

  it("should wrap output in markers", () => {
    const result = generateShellFunctions([{ name: "codex" }]);
    expect(result).toContain("# >>> agentdispatch >>>");
    expect(result).toContain("# <<< agentdispatch <<<");
  });
});
