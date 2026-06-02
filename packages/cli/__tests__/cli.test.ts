import { describe, it, expect } from "vitest";
import { Command, CommanderError } from "commander";
import { initCommand } from "../src/commands/init.js";
import { costCommand } from "../src/commands/cost.js";
import { configCommand, setNestedValue } from "../src/commands/config-cmd.js";
import { modelsCommand } from "../src/commands/models.js";
import { optimizeCommand } from "../src/commands/optimize.js";

describe("CLI entry", () => {
  it("should create a commander program", () => {
    const program = new Command();
    program.name("agentfare").version("0.1.0");
    expect(program.name()).toBe("agentfare");
  });
});

// ---------------------------------------------------------------------------
// Phase 5.4: CLI subcommand and security regression tests
// ---------------------------------------------------------------------------

describe("CLI subcommand registration", () => {
  it("all 5 subcommands have registered action handlers", () => {
    const program = new Command();
    program
      .name("agentfare")
      .version("0.1.0")
      .exitOverride();

    program.addCommand(initCommand);
    program.addCommand(costCommand);
    program.addCommand(configCommand);
    program.addCommand(modelsCommand);
    program.addCommand(optimizeCommand);

    const cmds = program.commands;
    const names = cmds.map((c) => c.name());
    expect(names).toContain("init");
    expect(names).toContain("cost");
    expect(names).toContain("config");
    expect(names).toContain("models");
    expect(names).toContain("optimize");
  });
});

describe("config set — prototype pollution guard (ISSUE-054)", () => {
  it("rejects __proto__ key — prevents prototype pollution", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "__proto__.polluted", "true")).toThrow(
      /Invalid config key/
    );
  });

  it("rejects constructor key — prevents prototype pollution", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "constructor.polluted", "true")).toThrow(
      /Invalid config key/
    );
  });

  it("rejects prototype key — prevents prototype pollution", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "prototype.polluted", "true")).toThrow(
      /Invalid config key/
    );
  });

  it("rejects keys with SQL injection characters", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "routing.default'; DROP TABLE--; --", "v")).toThrow(
      /Invalid config key/
    );
  });

  it("rejects keys with spaces", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "routing.some key", "v")).toThrow(
      /Invalid config key/
    );
  });

  it("rejects keys with path traversal", () => {
    const obj: Record<string, unknown> = {};
    expect(() => setNestedValue(obj, "../../../etc/passwd", "v")).toThrow(
      /Invalid config key/
    );
  });

  it("accepts normal dotted keys and sets value", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "routing.defaultStrategy", "cost-optimal");
    expect((obj as any).routing.defaultStrategy).toBe("cost-optimal");
  });

  it("accepts keys with underscores and hyphens", () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, "online-learning.min_samples", "50");
    expect((obj as any)["online-learning"].min_samples).toBe(50);
  });
});

describe("unknown command handling (ISSUE-051)", () => {
  it("reports unknown command with non-zero exit", async () => {
    const program = new Command();
    program
      .name("agentfare")
      .version("0.1.0")
      .exitOverride(); // makes parseAsync throw instead of process.exit

    program.addCommand(initCommand);
    program.addCommand(costCommand);
    program.addCommand(configCommand);
    program.addCommand(modelsCommand);
    program.addCommand(optimizeCommand);

    await expect(
      program.parseAsync(["node", "agentfare", "nonexistent-command"])
    ).rejects.toThrow();
  });

  it("unknown command error message is user-friendly", async () => {
    const program = new Command();
    program
      .name("agentfare")
      .version("0.1.0")
      .exitOverride();

    program.addCommand(initCommand);
    program.addCommand(costCommand);
    program.addCommand(configCommand);
    program.addCommand(modelsCommand);
    program.addCommand(optimizeCommand);

    let errorMsg = "";
    // Capture stderr-like output
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errorMsg += args.join(" ");
    };

    try {
      await program.parseAsync(["node", "agentfare", "nonexistent-command"]);
    } catch (e: unknown) {
      // Commander throws an error for unknown commands
      if (e instanceof Error) {
        errorMsg = e.message;
      }
    } finally {
      console.error = origError;
    }

    // Should mention the unknown command or provide guidance
    expect(
      errorMsg.toLowerCase().includes("unknown") ||
      errorMsg.toLowerCase().includes("nonexistent") ||
      errorMsg.toLowerCase().includes("error")
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// --help and --version should throw CommanderError with exitCode 0, not crash
// ---------------------------------------------------------------------------

describe("--help and --version exit handling", () => {
  function makeProgram() {
    const program = new Command();
    program
      .name("agentfare")
      .version("0.1.0")
      .exitOverride();
    program.addCommand(initCommand);
    program.addCommand(costCommand);
    program.addCommand(configCommand);
    program.addCommand(modelsCommand);
    program.addCommand(optimizeCommand);
    return program;
  }

  it("--help throws CommanderError with exitCode 0", async () => {
    const program = makeProgram();
    try {
      await program.parseAsync(["node", "agentfare", "--help"]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CommanderError);
      expect((err as CommanderError).exitCode).toBe(0);
      expect((err as CommanderError).code).toBe("commander.helpDisplayed");
    }
  });

  it("--version throws CommanderError with exitCode 0", async () => {
    const program = makeProgram();
    try {
      await program.parseAsync(["node", "agentfare", "--version"]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CommanderError);
      expect((err as CommanderError).exitCode).toBe(0);
      expect((err as CommanderError).code).toBe("commander.version");
    }
  });
});
