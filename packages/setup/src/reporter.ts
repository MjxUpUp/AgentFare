import type { DetectedTool } from "./detector.js";

export function reportStatus(tools: DetectedTool[]): void {
  console.log("\n检测环境...");
  for (const tool of tools) {
    console.log(
      `  found ${tool.name === "codex" ? "Codex" : "Claude Code"} (${tool.provider})`
    );
    if (tool.envKeyPresent) console.log(`  found ${tool.envKey}`);
  }
  console.log(`\nsame-provider routing: ready`);
  console.log(`\ncross-provider routing:`);
  console.log(`  mode: off (same-provider only)`);
  console.log(
    `  enable with: agentfare config set routing.crossProvider opt-in\n`
  );
}
