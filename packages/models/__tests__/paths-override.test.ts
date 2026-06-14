import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import {
  getBaseDir,
  getDbPath,
  getConfigPath,
  getLoaderPath,
  getKeysPath,
  getErrorLogPath,
  getCacheDir,
} from "../src/paths.js";

const ORIG = process.env.AGENTFARE_HOME;

afterEach(() => {
  if (ORIG === undefined) delete process.env.AGENTFARE_HOME;
  else process.env.AGENTFARE_HOME = ORIG;
});

describe("paths SSOT — AGENTFARE_HOME override (refactor/paths-ssot)", () => {
  it("all derived paths fall under AGENTFARE_HOME when set", () => {
    process.env.AGENTFARE_HOME = path.join(os.tmpdir(), "agentfare-override-xyz");
    const base = getBaseDir();
    expect(base).toBe(process.env.AGENTFARE_HOME);
    expect(getDbPath()).toBe(path.join(base, "data.db"));
    expect(getConfigPath()).toBe(path.join(base, "config.json"));
    expect(getLoaderPath()).toBe(path.join(base, "loader.js"));
    expect(getKeysPath()).toBe(path.join(base, "keys.json"));
    expect(getErrorLogPath()).toBe(path.join(base, "errors.log"));
    expect(getCacheDir()).toBe(path.join(base, "cache"));
  });

  it("falls back to ~/.agentfare when AGENTFARE_HOME unset", () => {
    delete process.env.AGENTFARE_HOME;
    const expected = path.join(os.homedir(), ".agentfare");
    expect(getBaseDir()).toBe(expected);
    expect(getLoaderPath()).toBe(path.join(expected, "loader.js"));
    expect(getKeysPath()).toBe(path.join(expected, "keys.json"));
    expect(getConfigPath()).toBe(path.join(expected, "config.json"));
  });

  it("getKeysPath is a new SSOT entry for credential store (Task 2 consumer)", () => {
    process.env.AGENTFARE_HOME = path.join(os.tmpdir(), "agentfare-keys-test");
    expect(getKeysPath()).toBe(path.join(process.env.AGENTFARE_HOME, "keys.json"));
    expect(getKeysPath()).toMatch(/keys\.json$/);
  });
});
