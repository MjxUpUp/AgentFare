import { describe, it, expect } from "vitest";
import { Command } from "commander";

describe("CLI entry", () => {
  it("should create a commander program", () => {
    const program = new Command();
    program.name("agentdispatch").version("0.1.0");
    expect(program.name()).toBe("agentdispatch");
  });
});
