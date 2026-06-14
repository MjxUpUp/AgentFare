#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { setLogger } from "@agentfare/core";
import { getLoaderPath } from "@agentfare/models";
import { initCommand } from "./commands/init.js";
import { costCommand } from "./commands/cost.js";
import { configCommand } from "./commands/config-cmd.js";
import { modelsCommand } from "./commands/models.js";
import { optimizeCommand } from "./commands/optimize.js";
import { proxyCommand } from "./commands/proxy.js";
import { restoreCommand } from "./commands/restore.js";

// CLI owns the process — enable console logging
setLogger({
  info(message: string) { console.log(message); },
  warn(message: string) { console.warn(message); },
  error(message: string) { console.error(message); },
});

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
    const loaderPath = getLoaderPath();
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
program.addCommand(restoreCommand);

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
