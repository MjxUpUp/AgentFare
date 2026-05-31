import { Command } from "commander";

export const initCommand = new Command("init")
  .description("初始化 AgentDispatch")
  .option("--tool <tool>", "只配置指定工具")
  .action(async (opts) => {
    const { detectTools } = await import("@agentdispatch/setup");
    const { generateShellFunctions, writeShellConfig } = await import(
      "@agentdispatch/setup"
    );

    let tools: Array<{ name: string }> = detectTools();
    if (opts.tool) {
      tools = tools.filter(
        (t: { name: string }) =>
          t.name === opts.tool || t.name === opts.tool.replace("claude-code", "claude")
      );
    }
    if (tools.length === 0) {
      console.error("未检测到指定工具");
      process.exit(1);
    }

    const content = generateShellFunctions(tools);
    const rcPath = writeShellConfig(content);
    console.log(
      `已配置 ${tools.map((t: { name: string }) => t.name).join(", ")} -> ${rcPath}`
    );
    console.log(`请运行 source ${rcPath} 或重新打开终端。`);
  });
