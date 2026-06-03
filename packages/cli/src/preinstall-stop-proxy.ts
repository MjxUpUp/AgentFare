/**
 * Preinstall hook: stop any running AgentFare proxy daemon before npm
 * replaces the package files.
 *
 * On Windows, the proxy process holds a lock on native .node files
 * (better-sqlite3), causing EBUSY errors during npm install -g.
 * This script kills the daemon so the install can proceed.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

function getProxyStatePath(): string {
  return path.join(os.homedir(), ".agentfare", "proxy.json");
}

function stopProxy(): void {
  const statePath = getProxyStatePath();
  if (!fs.existsSync(statePath)) return;

  let state: any;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch {
    return;
  }

  if (!state?.pid) return;

  try {
    process.kill(state.pid);
  } catch {
    // Process already dead — that's fine
  }

  // Clean up state file
  try {
    fs.unlinkSync(statePath);
  } catch {
    // best effort
  }
}

stopProxy();
