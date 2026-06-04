/**
 * `agentfare proxy` subcommand.
 *
 * Usage:
 *   agentfare proxy start [--port 3456]
 *   agentfare proxy stop
 *   agentfare proxy status
 *   agentfare proxy env [--port 3456] [--shell bash|powershell]
 */

import { Command } from "commander";
import { loadConfigFromDisk, TrackingDatabase, CostTracker, QualitySignalCollector } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import { getDbPath } from "@agentfare/models";
import { RequestHandler } from "@agentfare/hook/request-handler";
import {
  startProxy,
  stopProxy,
  getProxyStatus,
  generateToolGuide,
  generateExportCommands,
} from "@agentfare/proxy";

const DEFAULT_PORT = 3456;

export const proxyCommand = new Command("proxy")
  .description("Manage the AgentFare local proxy server");

proxyCommand
  .command("start")
  .description("Start the proxy server")
  .option("--port <port>", "Port to listen on", String(DEFAULT_PORT))
  .action(async (opts: { port: string }) => {
    const port = parseInt(opts.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`Invalid port: ${opts.port}`);
      process.exit(1);
    }

    // Initialize deps from config
    const config = loadConfigFromDisk();
    const registry = new ModelRegistry(config.customModels);
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
      console.error(`Failed to start proxy: ${result.error}`);
      process.exit(1);
    }

    console.log(`AgentFare proxy running on port ${result.port} (PID ${result.pid})`);
    console.log(generateToolGuide(result.port));
  });

proxyCommand
  .command("stop")
  .description("Stop the proxy server")
  .action(() => {
    const result = stopProxy();
    if (!result.success) {
      console.error(`Failed to stop proxy: ${result.error}`);
      process.exit(1);
    }
    console.log("Proxy stopped.");
  });

proxyCommand
  .command("status")
  .description("Show proxy server status")
  .action(() => {
    const status = getProxyStatus();
    if (status.running) {
      console.log(`Proxy is running (PID ${status.pid}, port ${status.port}, started ${status.startedAt})`);
    } else {
      console.log("Proxy is not running.");
    }
  });

proxyCommand
  .command("env")
  .description("Output shell-exportable environment variables")
  .option("--port <port>", "Port the proxy is running on", String(DEFAULT_PORT))
  .option("--shell <shell>", "Shell format: bash or powershell", "bash")
  .action((opts: { port: string; shell: string }) => {
    const port = parseInt(opts.port, 10);
    const shell = opts.shell === "powershell" ? "powershell" : "bash";
    console.log(generateExportCommands(port, shell as "bash" | "powershell"));
  });
