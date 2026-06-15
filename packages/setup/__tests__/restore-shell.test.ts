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

  it("drops a leftover localhost proxy URL for tools without a captured URL (no unset)", () => {
    // No capture for openai means restore can't know the original value. It must
    // strip init's localhost proxy line and write NOTHING for that var — emitting
    // `unset` would clobber a hand-written real upstream URL if one exists
    // (see the S5 test below) and is a no-op in rc files for the current shell.
    simulateTakeover(8787);
    const result = restoreShellProfile(CLI_TOOLS, { anthropic: "https://api.anthropic.com" }, "linux", tmpHome);
    expect(result.restored).toEqual(["anthropic"]);
    const after = fs.readFileSync(zshrc, "utf-8");
    expect(after).toContain('export ANTHROPIC_BASE_URL="https://api.anthropic.com"');
    expect(after).not.toContain("localhost");
    // No destructive unset emitted for the uncaptured provider.
    expect(after).not.toMatch(/unset OPENAI_BASE_URL/);
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

  // S5: a provider with NO captured URL must keep the user's own hand-written
  // real upstream URL — restore must not delete it then emit `unset`. Only
  // localhost/proxy-takeover assignments and prior `unset` lines are removed.
  it("preserves a hand-written real upstream URL when no capture exists (S5)", () => {
    simulateTakeover(8787);
    // User had their own real relay for openai (not localhost, not captured).
    const existing = fs.readFileSync(zshrc, "utf-8");
    fs.writeFileSync(
      zshrc,
      `${existing.replace(/\n+$/, "")}\nexport OPENAI_BASE_URL="https://my-relay.example.com/v1"\n`,
    );
    const result = restoreShellProfile(
      CLI_TOOLS,
      { anthropic: "https://api.anthropic.com" }, // openai NOT captured
      "linux",
      tmpHome,
    );
    const after = fs.readFileSync(zshrc, "utf-8");
    expect(after).not.toContain("localhost");
    expect(after).toContain('export ANTHROPIC_BASE_URL="https://api.anthropic.com"');
    // The user's own openai relay line MUST survive — not be replaced by unset.
    expect(after).toContain('export OPENAI_BASE_URL="https://my-relay.example.com/v1"');
    expect(after).not.toContain("unset OPENAI_BASE_URL");
    expect(result.restored).toEqual(["anthropic"]);
  });

  // M2: when both .zshrc and .bashrc exist and were takeover targets, both must
  // get their BASE_URL restored — not just the first one.
  it("restores BASE_URLs into BOTH .zshrc and .bashrc (M2)", () => {
    const bashrc = path.join(tmpHome, ".bashrc");
    fs.writeFileSync(bashrc, "# bash user\n");

    // Takeover both rc files with proxy exports.
    for (const rc of [zshrc, bashrc]) {
      const block = generateProxyExports(CLI_TOOLS, 8787);
      const existing = fs.readFileSync(rc, "utf-8");
      fs.writeFileSync(rc, `${existing.replace(/\n+$/, "")}\n\n${block}\n`);
    }

    const captured = {
      anthropic: "https://api.anthropic.com",
      openai: "https://api.openai.com/v1",
    };
    restoreShellProfile(CLI_TOOLS, captured, "linux", tmpHome);

    for (const rc of [zshrc, bashrc]) {
      const after = fs.readFileSync(rc, "utf-8");
      expect(after).not.toContain(MARKER_START);
      expect(after).not.toContain("localhost");
      expect(after).toContain('export ANTHROPIC_BASE_URL="https://api.anthropic.com"');
      expect(after).toContain('export OPENAI_BASE_URL="https://api.openai.com/v1"');
    }
  });

  // M4: the Windows branch must honor homeDirOverride so tests can isolate the
  // real home (getPowerShellProfilePath previously ignored the override).
  it("Windows branch honors homeDirOverride for the profile path (M4)", () => {
    const result = restoreShellProfile(
      CLI_TOOLS,
      { anthropic: "https://api.anthropic.com" },
      "windows-native",
      tmpHome,
    );
    expect(result.platform).toBe("windows-native");
    expect(result.rcPath.startsWith(tmpHome)).toBe(true);
    // The restored $env line lands in the isolated profile, not the real one.
    const after = fs.readFileSync(result.rcPath, "utf-8");
    expect(after).toContain('$env:ANTHROPIC_BASE_URL = "https://api.anthropic.com"');
  });
});
