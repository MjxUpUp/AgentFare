import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { restoreCommand } from "../src/commands/restore.js";

describe("restore command", () => {
  it("is registered with name 'restore'", () => {
    expect(restoreCommand.name()).toBe("restore");
  });

  it("declares --tool and --stop-proxy options", () => {
    const longs = restoreCommand.options.map((o) => o.long);
    expect(longs).toContain("--tool");
    expect(longs).toContain("--stop-proxy");
  });

  it("registers into a program as a subcommand", () => {
    const program = new Command();
    program.name("agentfare").exitOverride();
    program.addCommand(restoreCommand);
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("restore");
  });
});
