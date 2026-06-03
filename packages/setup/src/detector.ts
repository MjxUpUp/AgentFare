import { execSync } from "node:child_process"
import * as os from "node:os"
import * as fs from "node:fs"
import * as path from "node:path"

export type Platform = "macos" | "linux" | "wsl" | "windows-native";

export type ToolName = "claude" | "codex" | "cursor" | "windsurf" | "kimi" | "qoder" | "deepseek" | "glm" | "gemini" | "qwen";

export interface DetectedTool {
  name: ToolName;
  path: string;
  provider: string;
  envKey: string;
  envKeyPresent: boolean;
  type: "cli" | "ide";
  envVar?: string;       // *_BASE_URL 环境变量名
  proxyPath?: string;    // proxy URL 路径前缀
}

export function detectTools(): DetectedTool[] {
  const tools: DetectedTool[] = [];
  const isWindows = os.platform() === "win32"
  const platform = detectPlatform()

  // ---- CLI 工具：用 which/where 探测 PATH ----
  const cliChecks: Array<{
    name: ToolName
    provider: string
    envKey: string
    envVar?: string
    proxyPath?: string
  }> = [
    { name: "claude", provider: "anthropic", envKey: "ANTHROPIC_API_KEY", envVar: "ANTHROPIC_BASE_URL", proxyPath: "/anthropic" },
    { name: "codex", provider: "openai", envKey: "OPENAI_API_KEY", envVar: "OPENAI_BASE_URL", proxyPath: "/openai" },
    { name: "qoder", provider: "openai", envKey: "OPENAI_API_KEY", envVar: "OPENAI_API_BASE", proxyPath: "/openai" },
    { name: "deepseek", provider: "deepseek", envKey: "DEEPSEEK_API_KEY", envVar: "DEEPSEEK_BASE_URL", proxyPath: "/deepseek" },
    { name: "glm", provider: "zhipu", envKey: "ZHIPU_API_KEY", envVar: "ZHIPU_BASE_URL", proxyPath: "/zhipu" },
    { name: "gemini", provider: "google", envKey: "GOOGLE_API_KEY", envVar: "GOOGLE_BASE_URL", proxyPath: "/google" },
    { name: "qwen", provider: "alibaba", envKey: "ALIBABA_API_KEY", envVar: "ALIBABA_BASE_URL", proxyPath: "/alibaba" },
    { name: "kimi", provider: "moonshot", envKey: "MOONSHOT_API_KEY", envVar: "MOONSHOT_BASE_URL", proxyPath: "/moonshot" },
  ]

  for (const check of cliChecks) {
    try {
      const cmd = isWindows
        ? `where ${check.name} 2>nul`
        : `which ${check.name} 2>/dev/null`
      const execResult = execSync(cmd, { encoding: "utf-8" }).trim()
      if (execResult) {
        tools.push({
          name: check.name,
          path: execResult.split("\n")[0].trim(),
          provider: check.provider,
          envKey: check.envKey,
          envKeyPresent: !!process.env[check.envKey],
          type: "cli",
          envVar: check.envVar,
          proxyPath: check.proxyPath,
        })
      }
    } catch {
      // Tool not found on PATH — skip
    }
  }

  // ---- IDE 工具：检查已知安装路径 ----
  const ideChecks: Array<{
    name: ToolName
    provider: string
    envKey: string
    proxyPath?: string
    macPaths: string[]
    winPaths: string[]
    linuxPaths: string[]
  }> = [
    {
      name: "cursor",
      provider: "openai",
      envKey: "OPENAI_API_KEY",
      proxyPath: "/openai",
      macPaths: ["/Applications/Cursor.app"],
      winPaths: [path.join(process.env.LOCALAPPDATA || "", "Programs", "cursor")],
      linuxPaths: [path.join(os.homedir(), ".cursor")],
    },
    {
      name: "windsurf",
      provider: "openai",
      envKey: "OPENAI_API_KEY",
      proxyPath: "/openai",
      macPaths: ["/Applications/Windsurf.app"],
      winPaths: [path.join(process.env.LOCALAPPDATA || "", "Programs", "windsurf")],
      linuxPaths: [path.join(os.homedir(), ".windsurf")],
    },
  ]

  for (const check of ideChecks) {
    const searchPaths =
      platform === "macos" ? check.macPaths :
      platform === "windows-native" || platform === "wsl" ? check.winPaths :
      check.linuxPaths

    const found = searchPaths.find((p) => fs.existsSync(p))
    if (found) {
      tools.push({
        name: check.name,
        path: found,
        provider: check.provider,
        envKey: check.envKey,
        envKeyPresent: !!process.env[check.envKey],
        type: "ide",
        proxyPath: check.proxyPath,
      })
    }
  }

  return tools
}

export function detectPlatform(): Platform {
  const platform = os.platform();
  if (platform === "darwin") return "macos";
  if (platform === "linux") {
    try {
      const release = fs.readFileSync("/proc/version", "utf-8");
      if (release.toLowerCase().includes("microsoft")) return "wsl";
    } catch {
      // Not WSL
    }
    return "linux";
  }
  if (platform === "win32") return "windows-native";
  return "linux";
}
