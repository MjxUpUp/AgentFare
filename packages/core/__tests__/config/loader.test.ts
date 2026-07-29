import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { mergeConfig, loadConfigFromDisk } from "../../src/config/loader.js";
import { setLogger } from "../../src/utils/logger.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

describe("mergeConfig", () => {
  it("should return defaults when no overrides provided", () => {
    const result = mergeConfig();
    expect(result.routing.crossProvider).toBe("off");
    expect(result.routing.defaultStrategy).toBe("cost-optimal");
  });

  it("should merge global config over defaults", () => {
    const result = mergeConfig({
      global: { routing: { defaultStrategy: "quality-first" } } as any,
    });
    expect(result.routing.defaultStrategy).toBe("quality-first");
    expect(result.routing.crossProvider).toBe("off");
  });

  it("should merge project config over global config", () => {
    const result = mergeConfig({
      global: { routing: { defaultStrategy: "quality-first" } } as any,
      project: { routing: { crossProvider: "opt-in" } } as any,
    });
    expect(result.routing.defaultStrategy).toBe("quality-first");
    expect(result.routing.crossProvider).toBe("opt-in");
  });

  it("should merge models arrays by concatenating and deduplicating", () => {
    const result = mergeConfig({
      project: {
        models: { fast: ["custom/my-model"] },
      } as any,
    });
    expect(result.models.fast).toContain("custom/my-model");
    expect(result.models.fast).toContain("openai/gpt-5.3-codex-spark");
  });
});

// ---------------------------------------------------------------------------
// Phase 5.2: loadConfigFromDisk error handling
// ---------------------------------------------------------------------------
describe("loadConfigFromDisk error handling", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `agentfare-loader-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports file path on malformed JSON in project config", () => {
    const configPath = path.join(tmpDir, "agentfare.config.json");
    fs.writeFileSync(configPath, "{ this is not valid json !!!");

    expect(() => loadConfigFromDisk(tmpDir)).toThrow(configPath);
  });

  it("reports file path on malformed JSON with truncated content", () => {
    const configPath = path.join(tmpDir, "agentfare.config.json");
    fs.writeFileSync(configPath, '{"routing": {');

    expect(() => loadConfigFromDisk(tmpDir)).toThrow(configPath);
  });

  it("handles empty project config file gracefully", () => {
    const configPath = path.join(tmpDir, "agentfare.config.json");
    fs.writeFileSync(configPath, "");

    expect(() => loadConfigFromDisk(tmpDir)).toThrow(configPath);
  });

  it("returns defaults when no config files exist", () => {
    const result = loadConfigFromDisk(tmpDir);
    expect(result.routing.defaultStrategy).toBe(DEFAULT_CONFIG.routing.defaultStrategy);
    expect(result.routing.crossProvider).toBe(DEFAULT_CONFIG.routing.crossProvider);
  });

  it("returns valid config for well-formed JSON", () => {
    const configPath = path.join(tmpDir, "agentfare.config.json");
    fs.writeFileSync(configPath, JSON.stringify({
      routing: { defaultStrategy: "quality-first" },
    }));

    const result = loadConfigFromDisk(tmpDir);
    expect(result.routing.defaultStrategy).toBe("quality-first");
  });

  it("loads partial config that omits required sections (isPartial skips presence)", () => {
    const configPath = path.join(tmpDir, "agentfare.config.json");
    // only routing provided; models/providers absent — partial must not require them
    fs.writeFileSync(configPath, JSON.stringify({
      routing: { defaultStrategy: "quality-first" },
    }));

    const result = loadConfigFromDisk(tmpDir);
    expect(result.routing.defaultStrategy).toBe("quality-first");
    // absent sections backfilled (mergeConfig bases on DEFAULT_CONFIG), not undefined.
    // Not asserting exact equality: the test process may have a global config
    // (getConfigPath) that merges providers/models over the default.
    expect(result.models).toBeDefined();
    expect(result.providers).toBeDefined();
  });

  it("warns (not throws) when a partial config has a malformed present field", () => {
    const warnings: string[] = [];
    setLogger({ info() {}, warn: (m) => warnings.push(m), error() {} });
    try {
      const configPath = path.join(tmpDir, "agentfare.config.json");
      // defaultStrategy present but invalid value — must be caught & warned,
      // not silently deep-merged over the default (regression guard for the
      // isPartial dead-code that previously skipped ALL field validation)
      fs.writeFileSync(configPath, JSON.stringify({
        routing: { defaultStrategy: "bogus-strategy" },
      }));

      expect(() => loadConfigFromDisk(tmpDir)).not.toThrow();
      expect(warnings.some((w) => w.includes("defaultStrategy"))).toBe(true);
    } finally {
      setLogger({ info() {}, warn() {}, error() {} });
    }
  });
});
