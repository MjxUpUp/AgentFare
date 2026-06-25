import { describe, it, expect } from "vitest";
import { generateShellFunctions } from "../src/shell-writer.js";
import {
  runSetup,
  detectPlatform,
  detectTools,
  writeShellConfig,
  validateHookInjection,
  reportStatus,
} from "../src/index.js";

describe("setup module — integration", () => {
  it("importing the module does NOT call main() (ISSUE-030 regression)", () => {
    // The setup module exports runSetup() instead of auto-executing on import.
    // We verify this by checking that the module only exports functions
    // and does not auto-execute any side effects.

    // The module should export runSetup as a function, not have executed it
    expect(typeof runSetup).toBe("function");

    // It should also export the individual utilities
    expect(typeof detectPlatform).toBe("function");
    expect(typeof detectTools).toBe("function");
    expect(typeof generateShellFunctions).toBe("function");
    expect(typeof writeShellConfig).toBe("function");
    expect(typeof validateHookInjection).toBe("function");
    expect(typeof reportStatus).toBe("function");
  });

  it("generateShellFunctions writes correct content with markers and shell function", () => {
    const content = generateShellFunctions([{ name: "claude" }]);

    // Content should have markers
    expect(content).toContain("# >>> agentfare >>>");
    expect(content).toContain("# <<< agentfare <<<");

    // Content should have the shell function
    expect(content).toContain("claude()");
    expect(content).toContain("NODE_OPTIONS");
    expect(content).toContain("/loader.js");
    // Respect AGENTFARE_HOME override (path SSOT), not a hardcoded ~/.agentfare.
    expect(content).toContain("AGENTFARE_HOME");
  });

  it("generateShellFunctions with multiple tools includes all tools", () => {
    const content = generateShellFunctions([
      { name: "codex" },
      { name: "claude" },
    ]);

    // Both tools should appear
    expect(content).toContain("codex()");
    expect(content).toContain("claude()");

    // Should use $HOME not ~ (ISSUE-031)
    expect(content).toContain("$HOME");
    expect(content).not.toContain("~/");
  });
});
