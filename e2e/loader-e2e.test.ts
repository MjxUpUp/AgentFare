import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getLoaderPath, getBaseDir } from "@agentfare/models";

/**
 * E2E: Loader script generation tests (refactor/paths-ssot).
 *
 * ensureLoaderScript() resolves its target via the paths SSOT (getBaseDir/getLoaderPath),
 * honoring AGENTFARE_HOME. All cases run fully isolated under a tmpdir and never touch
 * the real ~/.agentfare.
 */
describe("E2E: Loader script generation", () => {
  let tmpHome: string;
  const ORIG = process.env.AGENTFARE_HOME;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `agentfare-loader-e2e-${process.pid}-${Date.now()}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    process.env.AGENTFARE_HOME = tmpHome;
  });

  afterEach(() => {
    if (ORIG === undefined) delete process.env.AGENTFARE_HOME;
    else process.env.AGENTFARE_HOME = ORIG;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("should return a path to loader.js inside AGENTFARE_HOME", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");
    const result = ensureLoaderScript();
    expect(result).toBe(getLoaderPath());
    expect(result).toBe(path.join(tmpHome, "loader.js"));
  });

  it("should create the .agentfare directory if it does not exist", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");
    ensureLoaderScript();
    expect(fs.existsSync(getBaseDir())).toBe(true);
    expect(fs.statSync(getBaseDir()).isDirectory()).toBe(true);
  });

  it("should create loader.js file that contains hook require", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");
    ensureLoaderScript();
    const file = getLoaderPath();
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toMatch(/require\(["'].*hook/);
    expect(content).toContain("require");
    expect(content).toContain("hooks");
  });

  it("should not overwrite existing loader.js with custom edits", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");
    const file = getLoaderPath();
    ensureLoaderScript();
    const contentBefore = fs.readFileSync(file, "utf-8");
    const customMarker = `// E2E_TEST_MARKER_${Date.now()}`;
    if (!contentBefore.includes("E2E_TEST_MARKER_")) {
      fs.appendFileSync(file, `\n${customMarker}\n`);
    }
    ensureLoaderScript();
    const contentAfter = fs.readFileSync(file, "utf-8");
    expect(contentAfter).toContain(customMarker);
  });

  it("should produce a valid JavaScript file that can be parsed", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");
    ensureLoaderScript();
    const content = fs.readFileSync(getLoaderPath(), "utf-8");
    expect(() => new Function(content)).not.toThrow();
  });

  it("AGENTFARE_HOME override isolates loader from real home (refactor/paths-ssot)", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");
    const result = ensureLoaderScript();
    const realHomeLoader = path.join(os.homedir(), ".agentfare", "loader.js");
    expect(result).not.toBe(realHomeLoader);
    expect(result).toBe(path.join(tmpHome, "loader.js"));
  });
});
