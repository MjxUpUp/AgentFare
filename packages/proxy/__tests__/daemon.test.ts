import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { waitForProxy, stopProxy, getProxyStatePath } from "../src/lifecycle.js";

// Mock child_process so spawn() returns a stub instead of spawning a real process.
vi.mock("node:child_process", () => ({
  spawn: vi.fn().mockReturnValue({
    unref: () => {},
    pid: 12345,
  }),
}));

// ---------------------------------------------------------------------------
// waitForProxy
// ---------------------------------------------------------------------------

describe("waitForProxy", () => {
  it("should return true when health check succeeds", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = addr && typeof addr === "object" ? addr.port : 0;

    try {
      const result = await waitForProxy(port, 2000);
      expect(result).toBe(true);
    } finally {
      server.close();
    }
  });

  it("should return false when no server is listening", async () => {
    // Use a port that is very unlikely to have a listener.
    // waitForProxy polls with 200ms intervals, so 300ms means ~1 attempt.
    const result = await waitForProxy(1, 300);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startProxyDaemon — port-in-use detection
// ---------------------------------------------------------------------------

describe("startProxyDaemon", () => {
  let tmpAgentfareHome: string;
  let originalAgentfareHome: string | undefined;

  beforeEach(() => {
    // Isolate state file to a temp directory
    tmpAgentfareHome = path.join(
      os.tmpdir(),
      `agentfare-daemon-test-${Date.now()}`
    );
    fs.mkdirSync(tmpAgentfareHome, { recursive: true });
    originalAgentfareHome = process.env.AGENTFARE_HOME;
    process.env.AGENTFARE_HOME = tmpAgentfareHome;
  });

  afterEach(() => {
    process.env.AGENTFARE_HOME = originalAgentfareHome;
    fs.rmSync(tmpAgentfareHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should detect EADDRINUSE when port is occupied", { timeout: 10000 }, async () => {
    // Occupy a port with a dummy server that does NOT respond with
    // { status: "ok" } — this simulates a port already in use.
    const blocker = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("blocker");
    });
    await new Promise<void>((resolve) => blocker.listen(0, resolve));
    const addr = blocker.address();
    const port = addr && typeof addr === "object" ? addr.port : 0;

    // Dynamic import so the module-level vi.mock("node:child_process")
    // is in effect when lifecycle.js is loaded.
    const { startProxyDaemon } = await import("../src/lifecycle.js");

    try {
      const result = await startProxyDaemon(port);
      // Health check will fail because the blocker responds with plain
      // text, not { status: "ok" }. The daemon should report failure.
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      blocker.close();
    }
  });
});

// ---------------------------------------------------------------------------
// stopProxy — stale state cleanup
// ---------------------------------------------------------------------------

describe("stopProxy", () => {
  let tmpAgentfareHome: string;
  let originalAgentfareHome: string | undefined;

  beforeEach(() => {
    tmpAgentfareHome = path.join(
      os.tmpdir(),
      `agentfare-stop-test-${Date.now()}`
    );
    fs.mkdirSync(tmpAgentfareHome, { recursive: true });
    originalAgentfareHome = process.env.AGENTFARE_HOME;
    process.env.AGENTFARE_HOME = tmpAgentfareHome;
  });

  afterEach(() => {
    process.env.AGENTFARE_HOME = originalAgentfareHome;
    fs.rmSync(tmpAgentfareHome, { recursive: true, force: true });
  });

  it("should clear stale state when process is dead", () => {
    // Write a fake proxy.json pointing to a PID that does not exist.
    // Use PID 999999999 which is practically guaranteed to be unused.
    const statePath = getProxyStatePath();
    const stateDir = path.dirname(statePath);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        pid: 999999999,
        port: 3456,
        startedAt: new Date().toISOString(),
      }),
      "utf-8"
    );

    // Verify the state file exists before calling stopProxy
    expect(fs.existsSync(statePath)).toBe(true);

    const result = stopProxy();

    // stopProxy should return success: true (ESRCH → process dead → cleanup)
    expect(result.success).toBe(true);

    // The stale state file should have been cleaned up
    expect(fs.existsSync(statePath)).toBe(false);
  });
});
