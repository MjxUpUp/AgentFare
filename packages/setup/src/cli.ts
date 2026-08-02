#!/usr/bin/env node
/**
 * GUI-side setup CLI — spawned by the Tauri shell's IPC layer to perform shell
 * takeover / restore WITHOUT the GUI depending on the `agentfare` CLI binary
 * (which drags in commander + the proxy/hook/loader graph and assumes an
 * interactive terminal). The Rust side spawns `node …/cli.js <subcommand>` and
 * reads a single JSON line off stdout.
 *
 * Wire protocol: every invocation prints exactly ONE JSON object (the CliResult
 * below) on stdout then exits 0 (ok) or 1 (error). A single JSON line is far
 * more robust to parse from Rust than scraping mixed console.log prose.
 *
 * Subcommands:
 *   capture              detect tools + capture current *_BASE_URL (read-only)
 *   takeover --port N    capture → persist upstream URLs → write proxy exports
 *   restore              load persisted URLs → strip markers → restore exports
 *
 * The captured-URL persistence reuses the SAME SSOT as `agentfare init` /
 * `restore` (cli/src/commands/{init,restore}.ts): ~/.agentfare/config.json under
 * providers[*].upstreamUrl. This keeps CLI and GUI takeovers interchangeable
 * (init via GUI → restore via CLI, or vice versa) and avoids a second source of
 * truth for the user's original upstream URLs.
 */
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  detectTools,
  captureUserBaseUrls,
  writeProxyConfig,
  restoreShellProfile,
  atomicWriteFileSync,
  type DetectedTool,
  type Platform,
} from "./index.js";
import { getConfigPath } from "@agentfare/models";

export type CliResult =
  | {
      ok: true;
      subcommand: "capture";
      tools: DetectedTool[];
      capturedUrls: Record<string, string>;
    }
  | {
      ok: true;
      subcommand: "takeover";
      rcPath: string;
      platform: Platform;
      tools: DetectedTool[];
      capturedUrls: Record<string, string>;
    }
  | {
      ok: true;
      subcommand: "restore";
      rcPath: string;
      platform: Platform;
      restored: string[];
      capturedUrls: Record<string, string>;
    }
  | { ok: false; error: string };

/**
 * Dependency-injection seam so the orchestration logic is unit-testable without
 * touching the real shell profile or relying on `detectTools()` hitting PATH.
 * Every field is optional and defaults to the real implementation.
 */
export interface CliDeps {
  /** Detected tools; defaults to detectTools(). */
  tools?: DetectedTool[];
  /** config.json path for save/load of captured URLs; defaults to getConfigPath(). */
  configPath?: string;
  /** Override the BASE_URL capture probe (reads env/config/profile). */
  detectBaseUrls?: (tools: DetectedTool[]) => Record<string, string>;
  /** Override the proxy-export writer (mutates shell profile). */
  writeProxy?: (
    tools: DetectedTool[],
    port: number,
  ) => { rcPath: string; platform: Platform };
  /** Override the profile restorer (mutates shell profile). */
  restoreProfile?: (
    tools: DetectedTool[],
    capturedUrls: Record<string, string>,
    platformOverride?: Platform,
    homeDirOverride?: string,
  ) => { rcPath: string; platform: Platform; restored: string[] };
}

/**
 * Persist captured upstream URLs into config.json providers[*].upstreamUrl.
 * Mirrors cli/src/commands/init.ts saveUpstreamUrls verbatim so the file layout
 * stays identical across CLI/GUI — kept here (not imported from the cli package)
 * because the cli package is a heavy interactive dependency we deliberately avoid.
 */
export function saveUpstreamUrls(
  urls: Record<string, string>,
  configPath: string = getConfigPath(),
): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let config: Record<string, any> = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      config = {};
    }
  }

  if (!config.providers) config.providers = {};
  for (const [provider, url] of Object.entries(urls)) {
    if (!config.providers[provider]) config.providers[provider] = {};
    config.providers[provider].upstreamUrl = url;
  }

  // Atomic write (temp+rename) so a crash mid-write can't truncate the SSOT
  // config.json — daemon's applyProviders uses the same primitive; this keeps
  // both writers at the same safety level instead of a second non-atomic one.
  atomicWriteFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Read captured upstream URLs from config.json (written by takeover / `init`).
 * Mirrors cli/src/commands/restore.ts loadCapturedUpstreamUrls — same SSOT file,
 * same trim() gate so whitespace-only values never pollute the restored export.
 */
export function loadCapturedUpstreamUrls(
  configPath: string = getConfigPath(),
): Record<string, string> {
  if (!fs.existsSync(configPath)) return {};
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const result: Record<string, string> = {};
    const providers = (config as any)?.providers;
    if (providers && typeof providers === "object") {
      for (const [provider, cfg] of Object.entries(providers)) {
        const url = (cfg as any)?.upstreamUrl;
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

/** Parse `--port N` from the post-subcommand argv. Throws on missing/invalid. */
function parsePort(argv: string[]): number {
  const i = argv.indexOf("--port");
  const raw = i >= 0 ? argv[i + 1] : undefined;
  const port = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid --port: ${raw ?? "(missing)"}（需要 1-65535）`);
  }
  return port;
}

/**
 * Core orchestration — pure & injectable. Returns a structured CliResult instead
 * of printing/exiting so tests can assert directly. The thin `main()` wrapper
 * below turns a result into the stdout JSON line + exit code.
 */
export async function runCliCommand(
  argv: string[],
  deps: CliDeps = {},
): Promise<CliResult> {
  const subcommand = argv[0];
  const tools = deps.tools ?? detectTools();
  const cliTools = tools.filter((t) => t.type === "cli");
  const detectBaseUrls = deps.detectBaseUrls ?? captureUserBaseUrls;
  const configPath = deps.configPath ?? getConfigPath();

  try {
    if (subcommand === "capture") {
      // Read-only probe: detect tools + capture current *_BASE_URL so the GUI can
      // preview "these will be switched to localhost:N" BEFORE the user confirms.
      const capturedUrls = detectBaseUrls(cliTools);
      return { ok: true, subcommand: "capture", tools, capturedUrls };
    }

    if (subcommand === "takeover") {
      const port = parsePort(argv.slice(1));
      if (cliTools.length === 0) {
        throw new Error("未检测到任何 CLI 工具，无法接管 shell");
      }
      // Order matters: capture BEFORE writeProxyConfig overwrites the profile
      // with localhost exports — otherwise capture reads back our own takeover.
      const capturedUrls = detectBaseUrls(cliTools);
      if (Object.keys(capturedUrls).length > 0) {
        saveUpstreamUrls(capturedUrls, configPath);
      }
      const writeProxy = deps.writeProxy ?? writeProxyConfig;
      const { rcPath, platform } = writeProxy(cliTools, port);
      return {
        ok: true,
        subcommand: "takeover",
        rcPath,
        platform,
        tools,
        capturedUrls,
      };
    }

    if (subcommand === "restore") {
      if (cliTools.length === 0) {
        throw new Error("未检测到任何 CLI 工具，无需还原");
      }
      const capturedUrls = loadCapturedUpstreamUrls(configPath);
      const restoreProfile = deps.restoreProfile ?? restoreShellProfile;
      const { rcPath, platform, restored } = restoreProfile(cliTools, capturedUrls);
      return {
        ok: true,
        subcommand: "restore",
        rcPath,
        platform,
        restored,
        capturedUrls,
      };
    }

    throw new Error(
      `unknown subcommand: ${subcommand ?? "(none)"}（预期 capture|takeover|restore）`,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main(): Promise<void> {
  const result = await runCliCommand(process.argv.slice(2));
  // Drain stdout before exiting: process.exit() does not wait for pipes to
  // drain, so under pipe-buffer pressure (high CI load / Windows pipe behavior)
  // Rust's Stdio::piped() read could be truncated → "non-JSON: EOF while
  // parsing". Exit from the write callback so the buffer is flushed first.
  process.stdout.write(JSON.stringify(result) + "\n", () => {
    process.exit(result.ok ? 0 : 1);
  });
}

// Run only when invoked as a script (not when imported by tests). ESM has no
// `require.main === module`, so compare the resolved entry path instead.
// path.resolve normalizes separators + drive-letter case so the entry-path
// check is robust on Windows (where argv[1] may use backslashes / differing
// drive-case vs the file:// URL).
if (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
