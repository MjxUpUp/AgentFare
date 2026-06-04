/**
 * Preinstall hook: stop any running AgentFare proxy daemon before npm
 * replaces the package files.
 *
 * On Windows, the proxy process holds a lock on native .node files
 * (better-sqlite3), causing EBUSY errors during npm install -g.
 * This script kills the daemon so the install can proceed.
 *
 * Before stopping, saves the proxy port to a marker file so the
 * postinstall hook can restart it automatically.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const AGENTFARE_DIR = path.join(os.homedir(), ".agentfare");
const STATE_FILE = path.join(AGENTFARE_DIR, "proxy.json");
const RESTART_MARKER = path.join(AGENTFARE_DIR, ".needs-restart");

function readState(): any | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function stopProxy(): void {
  if (!fs.existsSync(STATE_FILE)) return;

  const state = readState();
  if (!state?.pid) return;

  // Save port for postinstall restart
  if (state.port) {
    try {
      if (!fs.existsSync(AGENTFARE_DIR)) {
        fs.mkdirSync(AGENTFARE_DIR, { recursive: true });
      }
      fs.writeFileSync(RESTART_MARKER, JSON.stringify({ port: state.port }), "utf-8");
    } catch { /* best effort */ }
  }

  try {
    process.kill(state.pid);
  } catch {
    // Process already dead — that's fine
  }

  // Clean up state file
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // best effort
  }
}

stopProxy();
