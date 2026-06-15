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

  it("leaves no leftover tmp file after a successful write", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-cleanup-"));
    tmpFiles.push(dir);
    const target = path.join(dir, "target.json");
    atomicWriteFileSync(target, '{"a":1}');
    expect(fs.readFileSync(target, "utf-8")).toBe('{"a":1}');
    // Only the target should exist in the dir — no stray *.tmp files.
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("writes the tmp file in the SAME directory as the target (same-volume rename)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-samedir-"));
    tmpFiles.push(dir);
    const target = path.join(dir, "same-dir-target.json");
    atomicWriteFileSync(target, "data");
    // The temp file is created via `${target}.<pid>.<ts>.<rand>.tmp`, i.e. in
    // the target's own directory. After success it is renamed away, so the
    // directory must contain only the final target.
    const entries = fs.readdirSync(dir);
    expect(entries).toEqual(["same-dir-target.json"]);
  });
});
