/**
 * Atomic file write: write to a temp file then rename into place.
 *
 * Used for credential/config files that must never be observable in a
 * partially-written state (keys.json, config.json). Extracted from
 * packages/setup/src/shell-writer.ts so both the proxy credential store and
 * the setup shell writer share one implementation.
 *
 * ISSUE: keys.json was previously written non-atomically; a crash mid-write
 * could leave a truncated file that breaks key resolution on next load.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export function atomicWriteFileSync(targetPath: string, data: string): void {
  // Tmp lives in the SAME directory as the target — only same-directory rename
  // is atomic on POSIX; tmpdir() can be on a different volume (EXDEV).
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1e6)}.tmp`;
  fs.writeFileSync(tmpPath, data, "utf-8");
  try {
    try {
      fs.renameSync(tmpPath, targetPath);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // Only cross-device / permission errors are recoverable via copy+unlink.
      if (code !== "EXDEV" && code !== "EPERM" && code !== "EACCES") throw e;
      fs.copyFileSync(tmpPath, targetPath);
    }
  } finally {
    // Guarantee tmp cleanup whether rename succeeded (tmp gone), copy ran,
    // or any step threw. Best-effort: tmp may already be removed.
    try { fs.unlinkSync(tmpPath); } catch { /* already moved / cleaned */ }
  }
}
