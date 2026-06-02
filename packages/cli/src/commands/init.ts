import { Command } from "commander";

export const initCommand = new Command("init")
  .description("初始化 AgentFare")
  .option("--tool <tool>", "只配置指定工具")
  .action(async (opts) => {
    const { detectTools, writeConfig } = await import("@agentfare/setup");
    const { ensureLoaderScript } = await import("@agentfare/loader");

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

    // Generate loader.js before writing shell config
    const loaderPath = ensureLoaderScript();
    console.log(`loader script generated: ${loaderPath}`);

    const { rcPath, platform } = writeConfig(tools);
    console.log(
      `已配置 ${tools.map((t: { name: string }) => t.name).join(", ")} -> ${rcPath}`
    );
    if (platform === "windows-native") {
      console.log("请重新打开 PowerShell 终端，或运行: . $PROFILE");
    } else {
      console.log(`请运行 source ${rcPath} 或重新打开终端。`);
    }
  });
