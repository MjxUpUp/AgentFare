import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  runCliCommand,
  saveUpstreamUrls,
  loadCapturedUpstreamUrls,
} from "../src/cli.js";
import type { DetectedTool, Platform } from "../src/detector.js";

// Mixed CLI + IDE tools so we can assert IDE tools are reported but never passed
// to the takeover/restore writers (only type === "cli" tools get shell exports).
const TOOLS: DetectedTool[] = [
  { name: "claude", type: "cli", provider: "anthropic", envVar: "ANTHROPIC_BASE_URL", proxyPath: "/anthropic" },
  { name: "codex", type: "cli", provider: "openai", envVar: "OPENAI_BASE_URL", proxyPath: "/openai" },
  { name: "cursor", type: "ide", provider: "openai", proxyPath: "/openai" },
];
const CLI_TOOLS = TOOLS.filter((t) => t.type === "cli");

const CAPTURED = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};

describe("runCliCommand", () => {
  let tmpHome: string;
  let configPath: string;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `af-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    configPath = path.join(tmpHome, "config.json");
  });
  afterEach(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

  it("capture: read-only probe returns tools + captured URLs, writes nothing", async () => {
    const detectBaseUrls = vi.fn(() => ({ ...CAPTURED }));
    const result = await runCliCommand(["capture"], {
      tools: TOOLS,
      configPath,
      detectBaseUrls,
    });
    expect(result).toEqual({ ok: true, subcommand: "capture", tools: TOOLS, capturedUrls: CAPTURED });
    // detectBaseUrls receives ONLY the CLI tools (IDE tools get no BASE_URL export).
    expect(detectBaseUrls).toHaveBeenCalledWith(CLI_TOOLS);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("takeover: captures → persists URLs → writes proxy exports, returns rcPath/platform", async () => {
    const detectBaseUrls = vi.fn(() => ({ ...CAPTURED }));
    const writeProxy = vi.fn(
      (_tools: DetectedTool[], port: number) => ({
        rcPath: `/home/x/.zshrc`,
        platform: "linux" as Platform,
      }),
    );
    const result = await runCliCommand(["takeover", "--port", "3456"], {
      tools: TOOLS,
      configPath,
      detectBaseUrls,
      writeProxy,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.subcommand !== "takeover") return;
    // writeProxy got the CLI tools + parsed port.
    expect(writeProxy).toHaveBeenCalledWith(CLI_TOOLS, 3456);
    expect(result.platform).toBe("linux");
    expect(result.rcPath).toBe("/home/x/.zshrc");
    expect(result.capturedUrls).toEqual(CAPTURED);

    // Captured URLs persisted to config.json (the SSOT restore reads back from).
    const persisted = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(persisted.providers.anthropic.upstreamUrl).toBe(CAPTURED.anthropic);
    expect(persisted.providers.openai.upstreamUrl).toBe(CAPTURED.openai);
  });

  it("takeover: writes config.json only when there are captured URLs", async () => {
    const result = await runCliCommand(["takeover", "--port", "9999"], {
      tools: TOOLS,
      configPath,
      detectBaseUrls: () => ({}), // nothing to capture
      writeProxy: () => ({ rcPath: "/x", platform: "linux" }),
    });
    expect(result.ok).toBe(true);
    // No captures → no config.json written.
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("takeover: missing --port is an error result (not a throw)", async () => {
    const result = await runCliCommand(["takeover"], { tools: TOOLS, configPath });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("invalid --port"),
    });
  });

  it("takeover: rejects out-of-range port", async () => {
    const result = await runCliCommand(["takeover", "--port", "70000"], { tools: TOOLS, configPath });
    expect(result.ok).toBe(false);
  });

  it("takeover: no CLI tools → error (IDE-only can't take over the shell)", async () => {
    const ideOnly: DetectedTool[] = [{ name: "cursor", type: "ide", provider: "openai", proxyPath: "/openai" }];
    const result = await runCliCommand(["takeover", "--port", "3456"], {
      tools: ideOnly,
      configPath,
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("CLI 工具") });
  });

  it("restore: loads persisted URLs → restores profile → reports restored providers", async () => {
    // Pre-seed config.json exactly as `takeover` would have written it.
    saveUpstreamUrls(CAPTURED, configPath);

    const restoreProfile = vi.fn(
      (_tools: DetectedTool[], urls: Record<string, string>) => ({
        rcPath: "/home/x/.zshrc",
        platform: "linux" as Platform,
        restored: Object.keys(urls),
      }),
    );
    const result = await runCliCommand(["restore"], {
      tools: TOOLS,
      configPath,
      restoreProfile,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.subcommand !== "restore") return;
    // restoreProfile got back the SAME captured map persisted by takeover.
    expect(restoreProfile).toHaveBeenCalledWith(CLI_TOOLS, CAPTURED);
    expect(result.restored).toEqual(["anthropic", "openai"]);
    expect(result.capturedUrls).toEqual(CAPTURED);
  });

  it("restore: no CLI tools → error", async () => {
    const ideOnly: DetectedTool[] = [{ name: "cursor", type: "ide", provider: "openai", proxyPath: "/openai" }];
    const result = await runCliCommand(["restore"], { tools: ideOnly, configPath });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("CLI 工具") });
  });

  it("unknown subcommand → error", async () => {
    const result = await runCliCommand(["frobnicate"], { tools: TOOLS, configPath });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("unknown subcommand") });
  });

  it("missing subcommand → error", async () => {
    const result = await runCliCommand([], { tools: TOOLS, configPath });
    expect(result.ok).toBe(false);
  });

  it("end-to-end round trip: takeover persists URLs that restore reads back", async () => {
    // Two independent runCliCommand calls sharing one config.json, simulating a
    // user taking over now and restoring later — possibly after a GUI restart.
    await runCliCommand(["takeover", "--port", "3456"], {
      tools: TOOLS,
      configPath,
      detectBaseUrls: () => ({ ...CAPTURED }),
      writeProxy: () => ({ rcPath: "/x/.zshrc", platform: "linux" }),
    });

    let restoredUrls: Record<string, string> = {};
    await runCliCommand(["restore"], {
      tools: TOOLS,
      configPath,
      restoreProfile: (_t, urls) => {
        restoredUrls = urls;
        return { rcPath: "/x/.zshrc", platform: "linux", restored: Object.keys(urls) };
      },
    });
    expect(restoredUrls).toEqual(CAPTURED);
  });
});

describe("saveUpstreamUrls / loadCapturedUpstreamUrls (config.json SSOT)", () => {
  let tmpHome: string;
  let configPath: string;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `af-cli-io-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    configPath = path.join(tmpHome, "config.json");
  });
  afterEach(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

  it("round-trips provider URLs and preserves unrelated config fields", () => {
    // Pre-existing config with a non-providers field that must survive untouched.
    fs.writeFileSync(
      configPath,
      JSON.stringify({ port: 3456, providers: { anthropic: { apiKey: "existing" } } }),
    );

    saveUpstreamUrls({ openai: "https://api.openai.com/v1" }, configPath);

    const loaded = loadCapturedUpstreamUrls(configPath);
    expect(loaded).toEqual({ openai: "https://api.openai.com/v1" });

    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(raw.port).toBe(3456); // unrelated field preserved
    expect(raw.providers.anthropic.apiKey).toBe("existing"); // existing provider field preserved
    expect(raw.providers.anthropic.upstreamUrl).toBeUndefined(); // not touched
  });

  it("loadCapturedUpstreamUrls: {} when file absent", () => {
    expect(loadCapturedUpstreamUrls(configPath)).toEqual({});
  });

  it("loadCapturedUpstreamUrls: {} on corrupt JSON (no throw)", () => {
    fs.writeFileSync(configPath, "{not json");
    expect(loadCapturedUpstreamUrls(configPath)).toEqual({});
  });

  it("loadCapturedUpstreamUrls: skips whitespace-only / non-string upstreamUrl", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        providers: {
          anthropic: { upstreamUrl: "   " }, // whitespace-only → drop
          openai: { upstreamUrl: 42 }, // wrong type → drop
          deepseek: { upstreamUrl: "https://api.deepseek.com" }, // valid → keep
        },
      }),
    );
    expect(loadCapturedUpstreamUrls(configPath)).toEqual({
      deepseek: "https://api.deepseek.com",
    });
  });
});
