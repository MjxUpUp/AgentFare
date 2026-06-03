/**
 * `agentfare init` command — proxy-first setup.
 *
 * Default mode: starts the proxy daemon and writes *_BASE_URL exports
 * to the user's shell profile. Falls back to hook mode via --mode hook.
 */

import { Command } from "commander";
import { detectTools, writeProxyConfig, writeConfig } from "@agentfare/setup";
import { startProxyDaemon, getProxyStatus, isProxyVersionCurrent, stopProxy, type StartResult } from "@agentfare/proxy";
import { ensureLoaderScript } from "@agentfare/loader";

const DEFAULT_PORT = 3456;

export const initCommand = new Command("init")
  .description("初始化 AgentFare")
  .option("--mode <mode>", "Setup mode: proxy (default) or hook (legacy)", "proxy")
  .option("--tool <tool>", "只配置指定工具")
  .option("--port <port>", "Proxy 端口 (proxy 模式)", String(DEFAULT_PORT))
  .action(async (opts: { mode: string; tool?: string; port: string }) => {
    const mode = opts.mode === "hook" ? "hook" : "proxy";
    const port = parseInt(opts.port, 10);

    if (mode === "hook") {
      await runHookInit(opts.tool);
    } else {
      await runProxyInit(opts.tool, port);
    }
  });

// ---------------------------------------------------------------------------
// Proxy mode (default)
// ---------------------------------------------------------------------------

async function runProxyInit(toolFilter: string | undefined, port: number): Promise<void> {
  // 1. Detect tools
  let tools = detectTools();
  if (toolFilter) {
    tools = tools.filter((t) =>
      t.name === toolFilter || t.name === toolFilter.replace("claude-code", "claude")
    );
  }
  if (tools.length === 0) {
    console.error("未检测到任何工具");
    process.exit(1);
  }

  const cliTools = tools.filter((t) => t.type === "cli");
  const ideTools = tools.filter((t) => t.type === "ide");

  // 2. Start proxy daemon (if not already running)
  const existingStatus = getProxyStatus();
  let result: StartResult;

  if (existingStatus.running) {
    const effectivePort = existingStatus.port ?? port;
    if (!isProxyVersionCurrent()) {
      // Running proxy is from an older CLI version — restart it
      console.log(`Proxy outdated (PID ${existingStatus.pid}), restarting with current version...`);
      stopProxy();
      // Brief wait for process to die
      await new Promise((r) => setTimeout(r, 500));
      result = await startProxyDaemon(effectivePort);
      if (!result.success) {
        console.error(`Proxy 重启失败: ${result.error}`);
        process.exit(1);
      }
      console.log(`AgentFare proxy restarted on port ${result.port} (PID ${result.pid})`);
    } else {
      console.log(`Proxy already running (PID ${existingStatus.pid}, port ${effectivePort})`);
      result = { success: true, port: effectivePort, pid: existingStatus.pid! };
    }
  } else {
    result = await startProxyDaemon(port);
    if (!result.success) {
      console.error(`Proxy 启动失败: ${result.error}`);
      process.exit(1);
    }
    console.log(`AgentFare proxy started on port ${result.port} (PID ${result.pid})`);
  }

  // 3. Write shell exports for CLI tools
  if (cliTools.length > 0) {
    const { rcPath, platform } = writeProxyConfig(cliTools, result.port);

    console.log("");
    console.log("Configured CLI tools:");
    for (const t of cliTools) {
      if (t.envVar) {
        console.log(`  ${toolDisplayName(t.name)} → ${t.envVar}=http://localhost:${result.port}${t.proxyPath}`);
      }
    }

    console.log("");
    console.log(`Shell profile updated: ${rcPath}`);
    if (platform === "windows-native") {
      console.log("请重新打开 PowerShell 终端，或运行: . $PROFILE");
    } else {
      console.log(`请运行: source ${rcPath}`);
    }
  }

  // 4. Print IDE tool instructions
  if (ideTools.length > 0) {
    console.log("");
    console.log("IDE tools (configure manually):");
    for (const t of ideTools) {
      const url = `http://localhost:${result.port}${t.proxyPath ?? "/openai"}`;
      if (t.name === "cursor") {
        console.log(`  Cursor:   Settings → Override OpenAI Base URL → ${url}`);
      } else if (t.name === "windsurf") {
        console.log(`  Windsurf: Settings → AI Settings → API Base URL → ${url}`);
      } else {
        console.log(`  ${toolDisplayName(t.name)}: ${url}`);
      }
    }
  }

  console.log("");
  console.log("Run 'agentfare cost' to check routing savings.");
}

function toolDisplayName(name: string): string {
  const names: Record<string, string> = {
    claude: "Claude Code",
    codex: "Codex",
    cursor: "Cursor",
    windsurf: "Windsurf",
    kimi: "Kimi (Moonshot)",
    qoder: "Qoder",
    deepseek: "DeepSeek",
    glm: "GLM/智谱",
    gemini: "Google Gemini",
    qwen: "Qwen/阿里",
  };
  return names[name] ?? name;
}

// ---------------------------------------------------------------------------
// Hook mode (legacy)
// ---------------------------------------------------------------------------

async function runHookInit(toolFilter: string | undefined): Promise<void> {
  let tools: Array<{ name: string }> = detectTools();
  if (toolFilter) {
    tools = tools.filter(
      (t) =>
        t.name === toolFilter || t.name === toolFilter.replace("claude-code", "claude")
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
    `已配置 ${tools.map((t) => t.name).join(", ")} -> ${rcPath}`
  );
  if (platform === "windows-native") {
    console.log("请重新打开 PowerShell 终端，或运行: . $PROFILE");
  } else {
    console.log(`请运行 source ${rcPath} 或重新打开终端。`);
  }
}
