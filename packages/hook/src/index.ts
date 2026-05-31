// @agentdispatch/hook — Entry point
// Initializes config, registry, handler, tracker, quality signal collector, and installs fetch patch

import { loadConfigFromDisk, TrackingDatabase, CostTracker, QualitySignalCollector } from "@agentdispatch/core";
import { ModelRegistry } from "@agentdispatch/models";
import { RequestHandler } from "./request-handler.js";
import { installFetchPatch } from "./fetch-patch.js";
import * as path from "node:path";
import * as os from "node:os";

function initializeHook(): void {
  try {
    const config = loadConfigFromDisk();
    const registry = new ModelRegistry(config.customModels as any);
    const handler = new RequestHandler(config, registry);

    const dbPath = path.join(os.homedir(), ".agentdispatch", "data.db");
    const db = new TrackingDatabase(dbPath);
    const costTracker = new CostTracker(db);
    const qualitySignalCollector = new QualitySignalCollector();

    installFetchPatch({
      handler,
      costTracker,
      qualitySignalCollector,
      onRouting: () => {},
    });

    console.log("[AgentDispatch] Hook 已安装 — 智能模型路由已启用");
  } catch (err) {
    try {
      const fs = require("node:fs");
      const logPath = path.join(os.homedir(), ".agentdispatch", "errors.log");
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Hook init failed: ${err}\n`);
    } catch {}
    console.warn("[AgentDispatch] Hook 初始化失败，已跳过（不影响宿主进程）");
  }
}

initializeHook();
