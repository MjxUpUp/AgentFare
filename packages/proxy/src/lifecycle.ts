/**
 * Proxy server lifecycle management.
 *
 * Handles starting, stopping, and querying the proxy server daemon.
 * PID and state are persisted to ~/.agentfare/proxy.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getBaseDir } from "@agentfare/models";
import { createProxyServer, type ProxyServerOptions } from "./server.js";

export interface ProxyState {
  pid: number;
  port: number;
  startedAt: string;
}

/** Get the path to the proxy state file. */
export function getProxyStatePath(): string {
  return path.join(getBaseDir(), "proxy.json");
}

/** Read proxy state from disk. Returns null if not running. */
export function readProxyState(): ProxyState | null {
  try {
    const statePath = getProxyStatePath();
    if (!fs.existsSync(statePath)) return null;
    const raw = fs.readFileSync(statePath, "utf-8");
    return JSON.parse(raw) as ProxyState;
  } catch {
    return null;
  }
}

/** Write proxy state to disk. */
function writeProxyState(state: ProxyState): void {
  const statePath = getProxyStatePath();
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/** Remove proxy state file. */
function clearProxyState(): void {
  try {
    const statePath = getProxyStatePath();
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  } catch { /* best effort */ }
}

/** Check if the proxy is currently running. */
export function isProxyRunning(): boolean {
  const state = readProxyState();
  if (!state) return false;
  try {
    // Send signal 0 to check if process exists
    process.kill(state.pid, 0);
    return true;
  } catch {
    // Process doesn't exist — clean up stale state
    clearProxyState();
    return false;
  }
}

export interface StartResult {
  success: boolean;
  port: number;
  pid: number;
  error?: string;
}

/**
 * Start the proxy server in the current process (foreground).
 * Returns a Promise that resolves once the server is listening.
 */
export async function startProxy(
  options: ProxyServerOptions,
): Promise<StartResult> {
  // Check if already running
  if (isProxyRunning()) {
    const state = readProxyState()!;
    return { success: false, port: state.port, pid: state.pid, error: "Proxy already running" };
  }

  return new Promise((resolve) => {
    try {
      const server = createProxyServer(options);

      server.listen(options.port, () => {
        const state: ProxyState = {
          pid: process.pid,
          port: options.port,
          startedAt: new Date().toISOString(),
        };
        writeProxyState(state);

        // Clean up state on process exit
        const cleanup = () => {
          clearProxyState();
          server.close();
        };
        process.on("exit", cleanup);
        process.on("SIGINT", () => { cleanup(); process.exit(0); });
        process.on("SIGTERM", () => { cleanup(); process.exit(0); });

        resolve({ success: true, port: options.port, pid: process.pid });
      });

      server.on("error", (err: any) => {
        resolve({ success: false, port: options.port, pid: 0, error: err.message });
      });
    } catch (err: any) {
      resolve({ success: false, port: options.port, pid: 0, error: err.message });
    }
  });
}

/**
 * Stop the proxy server by sending SIGTERM to the process.
 */
export function stopProxy(): { success: boolean; error?: string } {
  const state = readProxyState();
  if (!state) {
    return { success: false, error: "Proxy not running (no state file)" };
  }

  try {
    process.kill(state.pid, "SIGTERM");
  } catch (err: any) {
    if (err.code === "ESRCH") {
      // Process already dead
      clearProxyState();
      return { success: true };
    }
    return { success: false, error: `Failed to kill process ${state.pid}: ${err.message}` };
  }

  // Wait a bit then clean up state
  setTimeout(() => {
    clearProxyState();
  }, 1000);

  return { success: true };
}

/**
 * Get proxy status info.
 */
export function getProxyStatus(): {
  running: boolean;
  pid?: number;
  port?: number;
  startedAt?: string;
} {
  const state = readProxyState();
  const running = isProxyRunning();
  return {
    running,
    pid: state?.pid,
    port: state?.port,
    startedAt: state?.startedAt,
  };
}
