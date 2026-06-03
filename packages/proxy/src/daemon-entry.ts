/**
 * @agentfare/proxy — Daemon entry point.
 *
 * This file is run as a detached child process by `startProxyDaemon()`.
 * It initializes all dependencies, starts the proxy server, and keeps
 * running until signaled to stop.
 *
 * Usage: node dist/daemon-entry.js --port <port>
 */

import { loadConfigFromDisk, TrackingDatabase, CostTracker, QualitySignalCollector } from "@agentfare/core";
import { ModelRegistry, getDbPath } from "@agentfare/models";
import { RequestHandler } from "@agentfare/hook/request-handler";
import { startProxy } from "./lifecycle.js";

// Parse --port from argv
function parsePort(): number {
  const portArg = process.argv.find((a, i) => process.argv[i - 1] === "--port");
  const port = portArg ? parseInt(portArg, 10) : 3456;
  if (isNaN(port) || port < 1 || port > 65535) {
    process.stderr.write(`Invalid port: ${portArg}\n`);
    process.exit(1);
  }
  return port;
}

async function main(): Promise<void> {
  const port = parsePort();

  // Initialize deps (mirrors packages/cli/src/commands/proxy.ts)
  const config = loadConfigFromDisk();
  const registry = new ModelRegistry(config.customModels as any);
  const handler = new RequestHandler(config, registry);

  const dbPath = getDbPath();
  const db = new TrackingDatabase(dbPath);
  const costTracker = new CostTracker(db);
  const qualitySignalCollector = new QualitySignalCollector();

  process.on("exit", () => {
    try { db.close(); } catch {}
  });

  const result = await startProxy({
    port,
    deps: { handler, costTracker, qualitySignalCollector },
  });

  if (!result.success) {
    process.stderr.write(`Failed to start proxy daemon: ${result.error}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Daemon error: ${err}\n`);
  process.exit(1);
});
