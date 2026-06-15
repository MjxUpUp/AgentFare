import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { restoreCommand, loadCapturedUpstreamUrls } from "../src/commands/restore.js";

describe("restore command (structure)", () => {
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

// M7: behavior of the captured-URL read path. loadCapturedUpstreamUrls is the
// bridge between `init`'s saveUpstreamUrls and `restore`'s writeRestoredBaseUrls.
// We isolate via AGENTFARE_HOME (config path is routed through getBaseDir SSOT).
describe("loadCapturedUpstreamUrls (M7 behavior)", () => {
  let tmpHome: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "af-restore-cli-"));
    savedHome = process.env.AGENTFARE_HOME;
    process.env.AGENTFARE_HOME = tmpHome;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.AGENTFARE_HOME;
    else process.env.AGENTFARE_HOME = savedHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function writeConfig(providers: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(tmpHome, "config.json"),
      JSON.stringify({ providers }),
      "utf-8",
    );
  }

  it("reads providers[*].upstreamUrl into a provider→url map", () => {
    writeConfig({
      anthropic: { upstreamUrl: "https://api.anthropic.com" },
      openai: { upstreamUrl: "https://relay.example.com/v1" },
    });
    expect(loadCapturedUpstreamUrls()).toEqual({
      anthropic: "https://api.anthropic.com",
      openai: "https://relay.example.com/v1",
    });
  });

  it("returns {} when config.json is absent", () => {
    expect(loadCapturedUpstreamUrls()).toEqual({});
  });

  it("returns {} when providers field is absent or malformed", () => {
    writeConfig({}); // no providers
    expect(loadCapturedUpstreamUrls()).toEqual({});
    writeConfig({ providers: "not-an-object" } as any);
    expect(loadCapturedUpstreamUrls()).toEqual({});
  });

  it("skips providers with empty/whitespace or non-string upstreamUrl", () => {
    writeConfig({
      anthropic: { upstreamUrl: "https://api.anthropic.com" },
      openai: { upstreamUrl: "" }, // empty → skip
      google: { upstreamUrl: "   " }, // whitespace → skip
      deepseek: { upstreamUrl: 123 }, // non-string → skip
      empty: {}, // missing field → skip
    });
    expect(loadCapturedUpstreamUrls()).toEqual({
      anthropic: "https://api.anthropic.com",
    });
  });

  it("returns {} when config.json is unparseable (no throw)", () => {
    fs.writeFileSync(path.join(tmpHome, "config.json"), "{ not valid json");
    expect(loadCapturedUpstreamUrls()).toEqual({});
  });
});
