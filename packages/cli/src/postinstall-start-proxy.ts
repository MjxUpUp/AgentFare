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
 *  - npm_config_skip_agentfare_restart is set
 */

import * as child_process from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const AGENTFARE_DIR = path.join(os.homedir(), ".agentfare");
const STATE_FILE = path.join(AGENTFARE_DIR, "proxy.json");
const RESTART_MARKER = path.join(AGENTFARE_DIR, ".needs-restart");
const DEFAULT_PORT = 3456;

/** Check if this is a global install. */
function isGlobalInstall(): boolean {
  if (process.env.npm_config_global === "true") return true;
  if (process.env.npm_config_location === "global") return true;
  if (process.env.npm_config_dir?.includes("global")) return true;
  return false;
}

/** Resolve the agentfare CLI binary path from this script's location. */
function resolveCliBin(): string {
  // process.argv[1] = .../node_modules/@agentfare/cli/dist/postinstall-start-proxy.js
  // Bin entry in package.json: { "agentfare": "dist/index.js" }
  return path.resolve(path.dirname(process.argv[1]), "index.js");
}

/** Read the port from restart marker or fall back to default. */
function resolvePort(): number {
  // Prefer explicit marker (written by preinstall from 0.1.27+)
  try {
    if (fs.existsSync(RESTART_MARKER)) {
      const data = JSON.parse(fs.readFileSync(RESTART_MARKER, "utf-8"));
      if (data.port) return data.port;
    }
  } catch { /* ignore */ }

  // No marker — this might be the first upgrade from a version that
  // didn't write markers. If proxy.json is missing (preinstall deleted it)
  // and we're in a global install, assume the proxy was running on the default port.
  if (!fs.existsSync(STATE_FILE)) {
    return DEFAULT_PORT;
  }

  // proxy.json still exists — proxy wasn't stopped, nothing to do
  return 0;
}

/** Start the proxy daemon using the installed agentfare CLI. */
function startProxy(port: number): void {
  const cliBin = resolveCliBin();

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

const port = resolvePort();
if (port === 0) {
  // Proxy still running or never was — nothing to do
  try { fs.unlinkSync(RESTART_MARKER); } catch { /* ignore */ }
  process.exit(0);
}

startProxy(port);
