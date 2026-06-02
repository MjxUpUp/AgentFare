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
  .version("0.1.0")
  .exitOverride(); // throw instead of calling process.exit for wrong flags

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
