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
  // pid + timestamp + random avoids collisions across concurrent writes
  const tmpPath = path.join(
    os.tmpdir(),
    `.agentfare-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.tmp`,
  );
  fs.writeFileSync(tmpPath, data, "utf-8");
  try {
    fs.renameSync(tmpPath, targetPath);
  } catch {
    // Cross-device rename (e.g. Windows %TMP% on C: → home on D:): copy + unlink.
    // rename across volumes throws EXDEV on POSIX and an error on Windows.
    fs.copyFileSync(tmpPath, targetPath);
    fs.unlinkSync(tmpPath);
  }
}
