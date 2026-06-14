import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { atomicWriteFileSync } from "../../src/utils/atomic-write.js";

const tmpFiles: string[] = [];

afterEach(() => {
  for (const f of tmpFiles) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
  tmpFiles.length = 0;
});

describe("atomicWriteFileSync", () => {
  it("writes content verbatim to the target path", () => {
    const target = path.join(os.tmpdir(), `aw-write-${Date.now()}.json`);
    tmpFiles.push(target);
    atomicWriteFileSync(target, '{"hello":"world"}');
    expect(fs.readFileSync(target, "utf-8")).toBe('{"hello":"world"}');
  });

  it("overwrites an existing file", () => {
    const target = path.join(os.tmpdir(), `aw-overwrite-${Date.now()}.json`);
    tmpFiles.push(target);
    fs.writeFileSync(target, "old-content");
    atomicWriteFileSync(target, "new-content");
    expect(fs.readFileSync(target, "utf-8")).toBe("new-content");
  });

  it("creates the file even when the directory initially lacks it", () => {
    const target = path.join(os.tmpdir(), `aw-create-${Date.now()}.json`);
    tmpFiles.push(target);
    expect(fs.existsSync(target)).toBe(false);
    atomicWriteFileSync(target, "created");
    expect(fs.existsSync(target)).toBe(true);
  });
});
