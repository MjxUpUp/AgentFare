import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  saveKeys,
  loadKeysFromDisk,
  invalidateKeyCache,
} from "../src/credential-store.js";
import { getKeysPath } from "@agentfare/models";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agentfare-cred-"));

beforeEach(() => {
  process.env.AGENTFARE_HOME = tmpHome;
  invalidateKeyCache();
});

afterEach(() => {
  invalidateKeyCache();
  try {
    fs.unlinkSync(getKeysPath());
  } catch {}
});

afterAll(() => {
  delete process.env.AGENTFARE_HOME;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {}
});

describe("credential-store", () => {
  it("saveKeys writes keys.json and loads them back", () => {
    saveKeys({ openai: "sk-test-123" });
    const loaded = loadKeysFromDisk(true);
    expect(loaded.openai).toBe("sk-test-123");
    expect(fs.existsSync(getKeysPath())).toBe(true);
  });

  it("saveKeys merges into existing keys without clobbering other providers", () => {
    saveKeys({ openai: "sk-1" });
    saveKeys({ anthropic: "sk-2" });
    const loaded = loadKeysFromDisk(true);
    expect(loaded.openai).toBe("sk-1");
    expect(loaded.anthropic).toBe("sk-2");
  });

  it("loadKeysFromDisk returns the cached object on a cache hit", () => {
    saveKeys({ openai: "sk-cache" });
    const first = loadKeysFromDisk();
    const cached = loadKeysFromDisk();
    // Same reference — no re-read since mtime unchanged.
    expect(cached).toBe(first);
  });

  it("loadKeysFromDisk re-reads after the file mtime changes", () => {
    saveKeys({ openai: "sk-v1" });
    expect(loadKeysFromDisk().openai).toBe("sk-v1");
    saveKeys({ openai: "sk-v2" });
    expect(loadKeysFromDisk().openai).toBe("sk-v2");
  });

  it("loadKeysFromDisk returns empty object when keys.json is missing", () => {
    invalidateKeyCache();
    const loaded = loadKeysFromDisk(true);
    expect(loaded).toEqual({});
  });

  it("saveKeys hardens keys.json permissions (POSIX 0o600)", () => {
    if (process.platform === "win32") {
      // Windows uses icacls (best-effort); just verify the write succeeds.
      saveKeys({ openai: "sk-win" });
      expect(fs.existsSync(getKeysPath())).toBe(true);
      return;
    }
    saveKeys({ openai: "sk-perm" });
    const stat = fs.statSync(getKeysPath());
    // owner-only: rw-------
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
