/**
 * `agentfare restore` — reverse of `init`.
 *
 * Reads the upstream URLs captured during `init` (stored in config.json under
 * providers[*].upstreamUrl), strips the agentfare marker block from the shell
 * profile, and writes back the original *_BASE_URL exports so tools connect
 * directly to their providers again. Optionally stops the proxy daemon.
 *
 * This closes the "one-way takeover" gap: previously `init` rewrote *_BASE_URL
 * to point at the proxy but there was no way back — the user's original URLs
 * were persisted in config.json yet never restored.
 */

import { Command } from "commander";
import { detectTools, restoreShellProfile } from "@agentfare/setup";
import { stopProxy } from "@agentfare/proxy";
import { getConfigPath } from "@agentfare/models";
import * as fs from "node:fs";

export const restoreCommand = new Command("restore")
  .description("还原 AgentFare 接管：恢复原始 *_BASE_URL，清理 shell profile")
  .option("--tool <tool>", "只还原指定工具")
  .option("--stop-proxy", "同时停止 proxy daemon")
  .action(async (opts: { tool?: string; stopProxy?: boolean }) => {
    let tools = detectTools();
    if (opts.tool) {
      tools = tools.filter(
        (t) =>
          t.name === opts.tool || t.name === opts.tool!.replace("claude-code", "claude")
      );
    }
    const cliTools = tools.filter((t) => t.type === "cli");
    if (cliTools.length === 0) {
      console.error("未检测到任何 CLI 工具，无需还原");
      process.exit(1);
    }

    const capturedUrls = loadCapturedUpstreamUrls();
    const { rcPath, platform, restored } = restoreShellProfile(cliTools, capturedUrls);

    console.log("已还原 BASE_URL（恢复直连 provider）:");
    for (const t of cliTools) {
      if (!t.envVar) continue;
      const target = capturedUrls[t.provider] ?? "(无原始 URL — 仅清理 proxy localhost 行)";
      console.log(`  ${t.envVar} → ${target}`);
    }
    if (restored.length > 0) {
      console.log(`还原的 provider: ${restored.join(", ")}`);
    }
    console.log(`Shell profile cleaned: ${rcPath}`);
    if (platform === "windows-native") {
      console.log("请重新打开 PowerShell 终端，或运行: . $PROFILE");
    } else {
      console.log(`请运行: source ${rcPath}`);
    }

    if (opts.stopProxy) {
      stopProxy();
      console.log("Proxy daemon stopped.");
    }
  });

/**
 * Read providers[*].upstreamUrl from config.json (written by `init`'s
 * saveUpstreamUrls). Returns {} if the file or field is absent.
 *
 * Provider keys here are the SAME names detector.ts emits as DetectedTool.provider
 * and init's saveUpstreamUrls writes — so restore can index captured URLs by
 * `t.provider` directly. Exported so the read path can be behavior-tested in
 * isolation (set AGENTFARE_HOME, write config.json, assert the parsed map).
 */
export function loadCapturedUpstreamUrls(): Record<string, string> {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const result: Record<string, string> = {};
    const providers = (config as any)?.providers;
    if (providers && typeof providers === "object") {
      for (const [provider, cfg] of Object.entries(providers)) {
        const url = (cfg as any)?.upstreamUrl;
        // trim(): a whitespace-only upstreamUrl is not a valid target and would
        // otherwise pollute the restored export (`export VAR="   "`).
        if (typeof url === "string" && url.trim().length > 0) {
          result[provider] = url.trim();
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}
