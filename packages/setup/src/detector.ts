import { execSync } from "node:child_process";
import * as os from "node:os";
import * as fs from "node:fs";

export type Platform = "macos" | "linux" | "wsl" | "windows-native";

export interface DetectedTool {
  name: "codex" | "claude";
  path: string;
  provider: string;
  envKey: string;
  envKeyPresent: boolean;
}

export function detectTools(): DetectedTool[] {
  const tools: DetectedTool[] = [];
  const checks: Array<{
    name: "codex" | "claude";
    provider: string;
    envKey: string;
  }> = [
    { name: "codex", provider: "openai", envKey: "OPENAI_API_KEY" },
    { name: "claude", provider: "anthropic", envKey: "ANTHROPIC_API_KEY" },
  ];

  for (const check of checks) {
    try {
      const isWindows = os.platform() === "win32";
      const cmd = isWindows
        ? `where ${check.name} 2>nul`
        : `which ${check.name} 2>/dev/null`;
      const execResult = execSync(cmd, { encoding: "utf-8" }).trim();
      if (execResult) {
        tools.push({
          name: check.name,
          path: execResult.split("\n")[0].trim(),
          provider: check.provider,
          envKey: check.envKey,
          envKeyPresent: !!process.env[check.envKey],
        });
      }
    } catch {
      // Tool not found on PATH — skip
    }
  }
  return tools;
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
