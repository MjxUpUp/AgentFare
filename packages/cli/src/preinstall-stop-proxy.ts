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

// Runs at npm `preinstall` — deps not on disk yet, cannot import @agentfare/models.
// Mirrors getBaseDir() (packages/models/src/paths.ts) inline to respect
// AGENTFARE_HOME. MUST stay byte-for-byte consistent with the SSOT: a drift
// test (packages/cli/__tests__/install-paths-drift.test.ts) imports this and
// asserts equality with getBaseDir() across override values.
// Empty/whitespace AGENTFARE_HOME is treated as unset (matches getBaseDir).
export function resolveAgentFareDir(): string {
  const HOME_OVERRIDE = process.env.AGENTFARE_HOME;
  return HOME_OVERRIDE && HOME_OVERRIDE.trim()
    ? HOME_OVERRIDE
    : path.join(os.homedir(), ".agentfare");
}

function readState(stateFile: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch {
    return null;
  }
}

function stopProxy(): void {
  const AGENTFARE_DIR = resolveAgentFareDir();
  const STATE_FILE = path.join(AGENTFARE_DIR, "proxy.json");
  const RESTART_MARKER = path.join(AGENTFARE_DIR, ".needs-restart");

  if (!fs.existsSync(STATE_FILE)) return;

  const state = readState(STATE_FILE);
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

// Only act when run directly by npm (node dist/preinstall-stop-proxy.js), not
// when imported by the drift test.
if (require.main === module) {
  stopProxy();
}
