import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import * as net from "node:net";
import { waitForProxy, stopProxy, startProxy, getProxyStatePath } from "../src/lifecycle.js";

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

// ---------------------------------------------------------------------------
// startProxy — loopback-only binding
//
// The proxy holds the user's upstream API keys, so it must never bind a
// non-loopback interface. `server.listen(port)` with no host binds `::` /
// 0.0.0.0 (every interface); this guards the regression by asserting the LAN
// address is refused while 127.0.0.1 still serves.
// ---------------------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const p = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

// GET /health → status code, or 0 on connection refusal / timeout.
function getHealth(host: string, port: number): Promise<number> {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve(0)); // ECONNREFUSED → 0
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
  });
}

function lanIpv4(): string | undefined {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return undefined;
}

describe("startProxy binds loopback only", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `agentfare-bind-test-${Date.now()}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    originalHome = process.env.AGENTFARE_HOME;
    process.env.AGENTFARE_HOME = tmpHome;
  });

  afterEach(() => {
    // Delete the state file so isProxyRunning() doesn't see a stale "running"
    // entry (pid = this process) and mislead later tests. The foreground
    // server lingers on its unique port until the worker exits — no other test
    // reuses that port.
    try {
      fs.unlinkSync(getProxyStatePath());
    } catch {
      /* best effort */
    }
    process.env.AGENTFARE_HOME = originalHome;
  });

  it("serves /health on 127.0.0.1 and refuses LAN interfaces", { timeout: 10000 }, async () => {
    const port = await freePort();
    const result = await startProxy({ port, deps: { handler: {} as never } });
    expect(result.success).toBe(true);

    // Reachable on loopback.
    expect(await getHealth("127.0.0.1", port)).toBe(200);

    // NOT reachable from a non-loopback interface — proves listen() bound
    // 127.0.0.1 rather than 0.0.0.0/::, which would expose the proxy and its
    // upstream API keys to the whole LAN.
    const lan = lanIpv4();
    if (lan) {
      expect(await getHealth(lan, port)).toBe(0); // ECONNREFUSED
    }
  });
});
