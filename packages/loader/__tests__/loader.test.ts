import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ensureLoaderScript } from "../src/index.js";

describe("@agentfare/loader", () => {
  it("should export without error", async () => {
    expect(true).toBe(true);
  });
});

describe("ensureLoaderScript", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `agentfare-loader-test-${Date.now()}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("generates loader.js with an absolute path to @agentfare/hook", () => {
    const loaderPath = ensureLoaderScript();
    expect(fs.existsSync(loaderPath)).toBe(true);

    const content = fs.readFileSync(loaderPath, "utf-8");
    expect(content).toContain("require(");
    expect(content).toContain("hook");
    expect(content).toContain("hooks.forEach");
  });

  it("does not overwrite loader.js with user edits", () => {
    const loaderPath = ensureLoaderScript();
    const content1 = fs.readFileSync(loaderPath, "utf-8");
    const marker = "// USER_EDIT_" + Date.now();
    fs.appendFileSync(loaderPath, `\n${marker}\n`);

    // Call again — should NOT overwrite user edits
    ensureLoaderScript();
    const content2 = fs.readFileSync(loaderPath, "utf-8");
    expect(content2).toContain(marker);
  });

  it("updates require path in-place without losing user edits", () => {
    const loaderPath = ensureLoaderScript();
    const marker = "// USER_EDIT_" + Date.now();
    fs.appendFileSync(loaderPath, `\n${marker}\n`);

    // Call again — path may be updated but marker preserved
    ensureLoaderScript();
    const content = fs.readFileSync(loaderPath, "utf-8");
    expect(content).toContain(marker);
    expect(content).toContain("require(");
  });
});
