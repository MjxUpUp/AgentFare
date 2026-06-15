import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getConfigPath } from "@agentfare/models";
import {
  generateProxyExports,
  restoreShellProfile,
  MARKER_START,
  MARKER_END,
} from "@agentfare/setup";
import type { DetectedTool, Platform } from "@agentfare/setup";

/**
 * E2E: `agentfare restore` data flow (feat/restore-command).
 *
 * Exercises the full init → restore lifecycle at the package boundary (dist):
 *   1. simulate `init` takeover: write a marker block of proxy exports + the
 *      user's original upstream URLs to config.json (mirrors saveUpstreamUrls).
 *   2. read captured URLs back from config.json (mirrors loadCapturedUpstreamUrls).
 *   3. call restoreShellProfile → strip markers, write back original BASE_URLs.
 *   4. assert the shell profile is clean, BASE_URLs point at the provider again,
 *      and the config.json survives (restore must not delete captured URLs).
 *
 * Isolation: AGENTFARE_HOME (config SSOT, refactor/paths-ssot) + an explicit
 * tmp shell home passed via homeDirOverride. We construct CLI_TOOLS literally
 * rather than calling detectTools(), which depends on system-installed CLIs and
 * cannot be reliably isolated in CI.
 */

const CLI_TOOLS: DetectedTool[] = [
  { name: "claude", type: "cli", provider: "anthropic", envVar: "ANTHROPIC_BASE_URL", proxyPath: "/anthropic" },
  { name: "codex", type: "cli", provider: "openai", envVar: "OPENAI_BASE_URL", proxyPath: "/openai" },
];

const ORIGINAL_UPSTREAM = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};

describe("E2E: agentfare restore (init → restore lifecycle)", () => {
  let tmpHome: string;       // AGENTFARE_HOME — config.json lives here
  let tmpShell: string;      // isolated shell home (passed via homeDirOverride)
  let zshrc: string;
  const ORIG_AGENTFARE_HOME = process.env.AGENTFARE_HOME;

  beforeEach(() => {
    const stamp = `${process.pid}-${Date.now()}`;
    tmpHome = path.join(os.tmpdir(), `af-restore-e2e-home-${stamp}`);
    tmpShell = path.join(os.tmpdir(), `af-restore-e2e-shell-${stamp}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    fs.mkdirSync(tmpShell, { recursive: true });
    process.env.AGENTFARE_HOME = tmpHome;
    zshrc = path.join(tmpShell, ".zshrc");
    fs.writeFileSync(zshrc, "# user shell\nalias ll='ls -la'\n");
  });

  afterEach(() => {
    if (ORIG_AGENTFARE_HOME === undefined) delete process.env.AGENTFARE_HOME;
    else process.env.AGENTFARE_HOME = ORIG_AGENTFARE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpShell, { recursive: true, force: true });
  });

  /** Simulate `init`: take over the shell with proxy exports. */
  function simulateInitTakeover(port: number): void {
    const block = generateProxyExports(CLI_TOOLS, port);
    const existing = fs.readFileSync(zshrc, "utf-8");
    fs.writeFileSync(zshrc, `${existing.replace(/\n+$/, "")}\n\n${block}\n`);
  }

  /** Simulate `init`'s saveUpstreamUrls: persist originals to config.json. */
  function simulateSaveUpstreamUrls(): void {
    const configPath = getConfigPath();
    const config = {
      providers: {
        anthropic: { upstreamUrl: ORIGINAL_UPSTREAM.anthropic },
        openai: { upstreamUrl: ORIGINAL_UPSTREAM.openai },
      },
    };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  /** Mirror `restore`'s loadCapturedUpstreamUrls: read providers[*].upstreamUrl. */
  function loadCapturedUpstreamUrls(): Record<string, string> {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) return {};
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      providers?: Record<string, { upstreamUrl?: string }>;
    };
    const result: Record<string, string> = {};
    for (const [provider, cfg] of Object.entries(raw.providers ?? {})) {
      if (typeof cfg.upstreamUrl === "string" && cfg.upstreamUrl.length > 0) {
        result[provider] = cfg.upstreamUrl;
      }
    }
    return result;
  }

  it("config.json resolves under AGENTFARE_HOME (paths SSOT)", () => {
    expect(getConfigPath()).toBe(path.join(tmpHome, "config.json"));
  });

  it("restore reverses the takeover: markers gone, BASE_URLs restored", () => {
    simulateInitTakeover(8787);
    simulateSaveUpstreamUrls();

    // Sanity: init wrote proxy URLs + markers.
    const takenOver = fs.readFileSync(zshrc, "utf-8");
    expect(takenOver).toContain(MARKER_START);
    expect(takenOver).toContain("localhost:8787");

    const captured = loadCapturedUpstreamUrls();
    expect(captured).toEqual(ORIGINAL_UPSTREAM);

    const result = restoreShellProfile(CLI_TOOLS, captured, "linux" as Platform, tmpShell);
    expect(result.platform).toBe("linux");
    expect(result.rcPath).toBe(zshrc);
    expect(result.restored).toEqual(expect.arrayContaining(["anthropic", "openai"]));

    const restored = fs.readFileSync(zshrc, "utf-8");
    expect(restored).not.toContain(MARKER_START);
    expect(restored).not.toContain(MARKER_END);
    expect(restored).not.toContain("localhost");
    expect(restored).toContain(`export ANTHROPIC_BASE_URL="${ORIGINAL_UPSTREAM.anthropic}"`);
    expect(restored).toContain(`export OPENAI_BASE_URL="${ORIGINAL_UPSTREAM.openai}"`);
    expect(restored).toContain("alias ll='ls -la'");
  });

  it("restore does not delete captured URLs from config.json", () => {
    simulateInitTakeover(8787);
    simulateSaveUpstreamUrls();
    const captured = loadCapturedUpstreamUrls();
    restoreShellProfile(CLI_TOOLS, captured, "linux" as Platform, tmpShell);

    // config.json must be untouched — restore only edits the shell profile.
    const stillCaptured = loadCapturedUpstreamUrls();
    expect(stillCaptured).toEqual(ORIGINAL_UPSTREAM);
  });

  it("restore is idempotent across repeated runs", () => {
    simulateInitTakeover(8787);
    simulateSaveUpstreamUrls();
    const captured = loadCapturedUpstreamUrls();

    restoreShellProfile(CLI_TOOLS, captured, "linux" as Platform, tmpShell);
    restoreShellProfile(CLI_TOOLS, captured, "linux" as Platform, tmpShell);
    restoreShellProfile(CLI_TOOLS, captured, "linux" as Platform, tmpShell);

    const after = fs.readFileSync(zshrc, "utf-8");
    expect(after.match(/export ANTHROPIC_BASE_URL=/g)?.length).toBe(1);
    expect(after.match(/export OPENAI_BASE_URL=/g)?.length).toBe(1);
    expect(after).not.toContain(MARKER_START);
    expect(after).not.toContain("localhost");
  });
});
