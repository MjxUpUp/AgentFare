import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  generateProxyExports,
  restoreShellProfile,
  MARKER_START,
  MARKER_END,
} from "../src/shell-writer.js";
import type { DetectedTool } from "../src/detector.js";

// Isolation strategy: pass homeDirOverride explicitly to restoreShellProfile.
// We do NOT touch process.env.HOME/USERPROFILE — on Windows os.homedir() reads
// USERPROFILE via the OS API, and mutating it leaks across vitest's parallel
// test files (corrupting shell-writer.test.ts). Passing an explicit tmp home
// sidesteps os.homedir() entirely.

const CLI_TOOLS: DetectedTool[] = [
  { name: "claude", type: "cli", provider: "anthropic", envVar: "ANTHROPIC_BASE_URL", proxyPath: "/anthropic" },
  { name: "codex", type: "cli", provider: "openai", envVar: "OPENAI_BASE_URL", proxyPath: "/openai" },
];

describe("restoreShellProfile (POSIX branch, isolated tmp home)", () => {
  let tmpHome: string;
  let zshrc: string;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `af-restore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    zshrc = path.join(tmpHome, ".zshrc");
    fs.writeFileSync(zshrc, "# user shell\nalias ll='ls -la'\n");
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  /** Simulate `init`'s takeover: append a marker block of proxy exports. */
  function simulateTakeover(port: number): void {
    const block = generateProxyExports(CLI_TOOLS, port);
    const existing = fs.readFileSync(zshrc, "utf-8");
    fs.writeFileSync(zshrc, `${existing.replace(/\n+$/, "")}\n\n${block}\n`);
  }

  it("strips the marker block and writes back captured URLs", () => {
    simulateTakeover(8787);
    expect(fs.readFileSync(zshrc, "utf-8")).toContain("localhost:8787");

    const captured = {
      anthropic: "https://api.anthropic.com",
      openai: "https://api.openai.com/v1",
    };
    const result = restoreShellProfile(CLI_TOOLS, captured, "linux", tmpHome);
    expect(result.platform).toBe("linux");
    expect(result.rcPath).toBe(zshrc);
    expect(result.restored).toEqual(expect.arrayContaining(["anthropic", "openai"]));

    const after = fs.readFileSync(zshrc, "utf-8");
    expect(after).not.toContain(MARKER_START);
    expect(after).not.toContain("localhost");
    expect(after).toContain('export ANTHROPIC_BASE_URL="https://api.anthropic.com"');
    expect(after).toContain('export OPENAI_BASE_URL="https://api.openai.com/v1"');
    expect(after).toContain("alias ll='ls -la'");
  });

  it("emits unset for tools without a captured URL", () => {
    simulateTakeover(8787);
    const result = restoreShellProfile(CLI_TOOLS, { anthropic: "https://api.anthropic.com" }, "linux", tmpHome);
    expect(result.restored).toEqual(["anthropic"]);
    const after = fs.readFileSync(zshrc, "utf-8");
    expect(after).toContain('export ANTHROPIC_BASE_URL="https://api.anthropic.com"');
    expect(after).toContain("unset OPENAI_BASE_URL");
    expect(after).not.toContain("localhost");
  });

  it("is idempotent — running twice yields the same exports", () => {
    simulateTakeover(8787);
    const captured = {
      anthropic: "https://api.anthropic.com",
      openai: "https://api.openai.com/v1",
    };
    restoreShellProfile(CLI_TOOLS, captured, "linux", tmpHome);
    restoreShellProfile(CLI_TOOLS, captured, "linux", tmpHome);
    const after = fs.readFileSync(zshrc, "utf-8");
    expect(after.match(/export ANTHROPIC_BASE_URL=/g)?.length).toBe(1);
    expect(after.match(/export OPENAI_BASE_URL=/g)?.length).toBe(1);
    expect(after).not.toContain(MARKER_START);
    expect(after).not.toContain("localhost");
  });

  it("removes markers but writes nothing when no CLI tools apply", () => {
    simulateTakeover(8787);
    const ideTools: DetectedTool[] = [
      { name: "cursor", type: "ide", provider: "openai", envVar: undefined, proxyPath: "/openai" },
    ];
    const result = restoreShellProfile(ideTools, {}, "linux", tmpHome);
    expect(result.restored).toEqual([]);
    const after = fs.readFileSync(zshrc, "utf-8");
    expect(after).not.toContain(MARKER_START);
    expect(after).not.toContain(MARKER_END);
    expect(after).not.toMatch(/^export /m);
    expect(after).toContain("alias ll='ls -la'");
  });
});
