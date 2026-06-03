#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { initCommand } from "./commands/init.js";
import { costCommand } from "./commands/cost.js";
import { configCommand } from "./commands/config-cmd.js";
import { modelsCommand } from "./commands/models.js";
import { optimizeCommand } from "./commands/optimize.js";
import { proxyCommand } from "./commands/proxy.js";

// ISSUE-051: global error handling
process.on("unhandledRejection", (err) => {
  console.error("agentfare: unexpected error");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

const program = new Command();
program
  .name("agentfare")
  .description("AI Agent 智能模型路由 — 成本优化工具")
  .version(require("../package.json").version)
  .exitOverride(); // throw instead of calling process.exit for wrong flags

// Silently upgrade loader.js if it already exists (i.e. user previously used
// hook mode). Only runs when ~/.agentfare/loader.js is present — new proxy-first
// users never trigger this.
void (async () => {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const os = require("node:os") as typeof import("node:os");
    const loaderPath = path.join(os.homedir(), ".agentfare", "loader.js");
    if (fs.existsSync(loaderPath)) {
      const { ensureLoaderScript } = await import("@agentfare/loader");
      ensureLoaderScript();
    }
  } catch { /* non-critical: init command will handle full setup */ }
})();

program.addCommand(initCommand);
program.addCommand(costCommand);
program.addCommand(configCommand);
program.addCommand(modelsCommand);
program.addCommand(optimizeCommand);
program.addCommand(proxyCommand);

// Suppress CommanderError stack traces for --help/--version (exitCode 0)
// while still re-throwing genuine unexpected errors.
try {
  program.parse();
} catch (err) {
  if (err instanceof CommanderError) {
    process.exit(err.exitCode);
  }
  throw err;
}
