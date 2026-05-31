#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { costCommand } from "./commands/cost.js";
import { configCommand } from "./commands/config-cmd.js";
import { modelsCommand } from "./commands/models.js";
import { optimizeCommand } from "./commands/optimize.js";

const program = new Command();
program
  .name("agentdispatch")
  .description("AI Agent 智能模型路由 — 成本优化工具")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(costCommand);
program.addCommand(configCommand);
program.addCommand(modelsCommand);
program.addCommand(optimizeCommand);

program.parse();
