#!/usr/bin/env node
/**
 * Postinstall hook: restart the AgentFare proxy daemon after npm install.
 *
 * The preinstall hook stops the proxy (to release Windows file locks on
 * better-sqlite3). This script starts it back up so the user doesn't
 * need to manually run `agentfare init` after every upgrade.
 *
 * Silently skips if:
 *  - Not a global install (local dev installs don't need proxy)
 *  - Proxy wasn't running before the install
 *  - npm_config_skip_agentfare_restart is set
 */

import * as child_process from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const AGENTFARE_DIR = path.join(os.homedir(), ".agentfare");
const STATE_FILE = path.join(AGENTFARE_DIR, "proxy.json");
const RESTART_MARKER = path.join(AGENTFARE_DIR, ".needs-restart");

/** Check if this is a global install. */
function isGlobalInstall(): boolean {
  // npm sets npm_config_global or npm_config_location for global installs
  if (process.env.npm_config_global === "true") return true;
  if (process.env.npm_config_location === "global") return true;
  // pnpm global install
  if (process.env.npm_config_dir?.includes("global")) return true;
  return false;
}

/** Read the port from state file or marker. */
function getSavedPort(): number | null {
  // Try the restart marker first (written by preinstall before killing proxy)
  try {
    if (fs.existsSync(RESTART_MARKER)) {
      const data = JSON.parse(fs.readFileSync(RESTART_MARKER, "utf-8"));
      return data.port ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

/** Start the proxy daemon using the installed agentfare CLI. */
function startProxy(port: number): void {
  const cliBin = path.resolve(path.dirname(process.argv[1]), "agentfare");

  try {
    const child = child_process.spawn(
      process.execPath,
      [cliBin, "proxy", "start", "--port", String(port)],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    child.unref();
  } catch {
    // Silently fail — user can run `agentfare init` manually
  }

  // Clean up marker
  try { fs.unlinkSync(RESTART_MARKER); } catch { /* ignore */ }
}

// --- Main ---

// Skip if explicitly disabled
if (process.env.npm_config_skip_agentfare_restart) {
  try { fs.unlinkSync(RESTART_MARKER); } catch { /* ignore */ }
  process.exit(0);
}

// Only restart for global installs
if (!isGlobalInstall()) {
  try { fs.unlinkSync(RESTART_MARKER); } catch { /* ignore */ }
  process.exit(0);
}

const port = getSavedPort();
if (!port) {
  // No previous proxy to restart
  try { fs.unlinkSync(RESTART_MARKER); } catch { /* ignore */ }
  process.exit(0);
}

startProxy(port);
