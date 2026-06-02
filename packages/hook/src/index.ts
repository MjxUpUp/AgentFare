// @agentfare/hook — Entry point
// ISSUE-067a: no top-level side effects. Callers (loader.js) must invoke setup() explicitly.

import { loadConfigFromDisk, TrackingDatabase, CostTracker, QualitySignalCollector } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import { RequestHandler } from "./request-handler.js";
import { installFetchPatch } from "./fetch-patch.js";
import { LLMDetector } from "./url-detector.js";
import { getDbPath, getErrorLogPath } from "@agentfare/models";

let initialized = false;

/**
 * Initialize the AgentFare hook: load config, open DB, install fetch patch.
 * Must be called explicitly — the module no longer auto-initializes on import.
 * Safe to call multiple times; subsequent calls are no-ops.
 */
export function setup(): void {
  if (initialized) return;
  initialized = true;

  try {
    const config = loadConfigFromDisk();
    const registry = new ModelRegistry(config.customModels as any);
    const handler = new RequestHandler(config, registry);

    const dbPath = getDbPath();
    const db = new TrackingDatabase(dbPath);
    const costTracker = new CostTracker(db);
    const qualitySignalCollector = new QualitySignalCollector();

    // ISSUE-011: close DB connection on process exit
    process.on("exit", () => {
      try { db.close(); } catch {}
    });

    installFetchPatch({
      handler,
      detector: new LLMDetector(registry),
      registry,
      costTracker,
      qualitySignalCollector,
      onRouting: () => {},
    });

    console.log("[AgentFare] Hook 已安装 — 智能模型路由已启用");
  } catch (err) {
    try {
      const fs = require("node:fs");
      const logPath = getErrorLogPath();
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Hook init failed: ${err}\n`);
    } catch {}
    console.warn("[AgentFare] Hook 初始化失败，已跳过（不影响宿主进程）");
  }
}
