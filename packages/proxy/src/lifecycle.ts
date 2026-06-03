/**
 * Proxy server lifecycle management.
 *
 * Handles starting, stopping, and querying the proxy server daemon.
 * PID and state are persisted to ~/.agentfare/proxy.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { spawn } from "node:child_process";
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
 * Start the proxy as a detached background daemon.
 *
 * Forks a child process running daemon-entry.ts, waits for it to
 * become healthy, then returns. The parent process can exit independently.
 */
export async function startProxyDaemon(port: number): Promise<StartResult> {
  // Check if already running
  if (isProxyRunning()) {
    const state = readProxyState()!;
    // Verify it's actually responsive
    const healthy = await waitForProxy(state.port, 2000);
    if (healthy) {
      return { success: true, port: state.port, pid: state.pid };
    }
    // Stale state — clean up
    clearProxyState();
  }

  // Resolve daemon-entry.ts path (from this file's location)
  const daemonPath = path.join(__dirname, "daemon-entry.js");

  // Open log file for daemon output
  const logPath = path.join(getBaseDir(), "proxy.log");
  const logDir = path.dirname(logPath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logStream = fs.openSync(logPath, "a");

  const child = spawn(process.execPath, [daemonPath, "--port", String(port)], {
    detached: true,
    stdio: ["ignore", logStream, logStream],
  });

  // Close the log FD in the parent — the child has inherited it
  try { fs.closeSync(logStream); } catch {}

  child.unref();

  // Wait for the daemon to become healthy
  const healthy = await waitForProxy(port, 5000);
  if (!healthy) {
    return { success: false, port, pid: 0, error: "Proxy daemon failed to start (health check timeout)" };
  }

  // Read the PID from state file (written by the daemon)
  const state = readProxyState();
  return { success: true, port, pid: state?.pid ?? child.pid ?? 0 };
}

/**
 * Wait for the proxy to respond to a health check.
 *
 * @param port - Port to check
 * @param timeoutMs - Maximum time to wait
 * @returns true if healthy, false if timeout
 */
export async function waitForProxy(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const intervalMs = 200;

  while (Date.now() - start < timeoutMs) {
    try {
      const healthy = await healthCheck(port);
      if (healthy) return true;
    } catch {
      // Not yet listening
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Send a GET /health request to the proxy.
 */
function healthCheck(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "localhost", port, path: "/health", method: "GET", timeout: 1000 },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve(json.status === "ok");
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

/**
 * Stop the proxy server by sending a signal to the process.
 */
export function stopProxy(): { success: boolean; error?: string } {
  const state = readProxyState();
  if (!state) {
    return { success: false, error: "Proxy not running (no state file)" };
  }

  try {
    // Windows: process.kill(pid) without signal terminates the process.
    // Unix: use SIGTERM for graceful shutdown.
    if (process.platform === "win32") {
      process.kill(state.pid);
    } else {
      process.kill(state.pid, "SIGTERM");
    }
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
