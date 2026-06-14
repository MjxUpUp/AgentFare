import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectPlatform, type Platform, type DetectedTool } from "./detector.js";

export const MARKER_START = "# >>> agentfare >>>";
export const MARKER_END = "# <<< agentfare <<<";

export function generateShellFunctions(
  tools: Array<{ name: string }>
): string {
  const functions = tools
    .map(
      (tool) =>
        // ISSUE-031: use $HOME instead of ~ for reliable shell expansion
        `${tool.name}() {\n  NODE_OPTIONS="--require \"$HOME/.agentfare/loader.js\"" command ${tool.name} "$@"\n}`
    )
    .join("\n");
  return `${MARKER_START}\n${functions}\n${MARKER_END}`;
}

export function writeShellConfig(content: string): string {
  const homeDir = os.homedir();
  const shellRcPaths = [
    path.join(homeDir, ".zshrc"),
    path.join(homeDir, ".bashrc"),
  ];
  for (const rcPath of shellRcPaths) {
    if (fs.existsSync(rcPath)) {
      const existing = fs.readFileSync(rcPath, "utf-8");
      const cleaned = existing
        .replace(
          new RegExp(
            `${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}`,
            "g"
          ),
          ""
        )
        .trim();
      const updated = `${cleaned}\n\n${content}\n`;
      atomicWriteFileSync(rcPath, updated);
      return rcPath;
    }
  }
  const bashrc = path.join(homeDir, ".bashrc");
  atomicWriteFileSync(bashrc, content);
  return bashrc;
}

/**
 * ISSUE-063: Atomic file write to prevent corruption on crash.
 * Writes to a temp file first, then renames (POSIX atomic).
 * On Windows where cross-drive rename may fail, falls back to copy+unlink.
 */
function atomicWriteFileSync(targetPath: string, data: string): void {
  const tmpPath = path.join(
    os.tmpdir(),
    `.agentfare-rc-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  );
  fs.writeFileSync(tmpPath, data, "utf-8");
  try {
    fs.renameSync(tmpPath, targetPath);
  } catch {
    // Cross-device rename (Windows): fall back to copy + unlink
    fs.copyFileSync(tmpPath, targetPath);
    fs.unlinkSync(tmpPath);
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Windows PowerShell support
// ---------------------------------------------------------------------------

export function generatePowerShellFunctions(
  tools: Array<{ name: string }>
): string {
  const loaderPath = `$HOME\\.agentfare\\loader.js`;
  const functions = tools
    .map(
      (tool) =>
        `function ${tool.name} {\n` +
        `  $__agentfare_bin = (Get-Command '${tool.name}.cmd' -ErrorAction SilentlyContinue).Source\n` +
        `  if (-not $__agentfare_bin) { $__agentfare_bin = (Get-Command '${tool.name}' -CommandType Application -ErrorAction SilentlyContinue).Source }\n` +
        `  if (-not $__agentfare_bin) { $__agentfare_bin = '${tool.name}' }\n` +
        `  $env:NODE_OPTIONS = "--require ${loaderPath}"\n` +
        `  & $__agentfare_bin @args\n` +
        `  Remove-Item Env:\\NODE_OPTIONS\n` +
        `}`
    )
    .join("\n");
  return `${MARKER_START}\n${functions}\n${MARKER_END}`;
}

export function getPowerShellProfilePath(): string {
  const homeDir = os.homedir();
  const ps7Path = path.join(
    homeDir, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"
  );
  const ps5Path = path.join(
    homeDir, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"
  );
  if (fs.existsSync(ps7Path)) return ps7Path;
  if (fs.existsSync(ps5Path)) return ps5Path;
  return ps7Path;
}

export function writePowerShellProfile(content: string): string {
  const profilePath = getPowerShellProfilePath();
  const profileDir = path.dirname(profilePath);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  if (fs.existsSync(profilePath)) {
    const existing = fs.readFileSync(profilePath, "utf-8");
    const cleaned = existing
      .replace(
        new RegExp(
          `${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}`,
          "g"
        ),
        ""
      )
      .trim();
    const updated = `${cleaned}\n\n${content}\n`;
    atomicWriteFileSync(profilePath, updated);
  } else {
    atomicWriteFileSync(profilePath, `${content}\n`);
  }
  return profilePath;
}

/**
 * Unified config writer — detects platform and dispatches to the correct
 * shell config file (bash/zsh rc or PowerShell profile).
 */
export function writeConfig(
  tools: Array<{ name: string }>
): { rcPath: string; platform: Platform } {
  const platform = detectPlatform();
  if (platform === "windows-native") {
    const content = generatePowerShellFunctions(tools);
    const rcPath = writePowerShellProfile(content);
    return { rcPath, platform };
  }
  const content = generateShellFunctions(tools);
  const rcPath = writeShellConfig(content);
  return { rcPath, platform };
}

// ---------------------------------------------------------------------------
// Proxy export 生成器
// ---------------------------------------------------------------------------

export function generateProxyExports(
  tools: Array<DetectedTool>,
  port: number
): string {
  const lines = tools
    .filter((t) => t.type === "cli" && t.envVar && t.proxyPath)
    .map((t) => `export ${t.envVar}="http://localhost:${port}${t.proxyPath}"`)
    .join("\n")
  return `${MARKER_START}\n${lines}\n${MARKER_END}`
}

export function generatePowerShellExports(
  tools: Array<DetectedTool>,
  port: number
): string {
  const lines = tools
    .filter((t) => t.type === "cli" && t.envVar && t.proxyPath)
    .map((t) => `$env:${t.envVar} = "http://localhost:${port}${t.proxyPath}"`)
    .join("\n")
  return `${MARKER_START}\n${lines}\n${MARKER_END}`
}

/**
 * Tool-specific config files where *_BASE_URL might be defined.
 * Used as fallback when the env var isn't in process.env.
 */
const TOOL_ENV_CONFIGS: Record<string, { configRelPath: string; envField: string }> = {
  claude: { configRelPath: ".claude/settings.json", envField: "env" },
};

function isLocalhostUrl(value: string): boolean {
  return value.startsWith("http://localhost:") || value.startsWith("http://127.0.0.1:");
}

/**
 * Read an env var from a tool's config file (e.g. Claude Code's settings.json).
 */
function readEnvFromToolConfig(toolName: string, envVar: string): string | undefined {
  const source = TOOL_ENV_CONFIGS[toolName];
  if (!source) return undefined;

  const configPath = path.join(os.homedir(), source.configRelPath);
  try {
    if (!fs.existsSync(configPath)) return undefined;
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const env = raw[source.envField];
    if (typeof env === "object" && env !== null) {
      const value = env[envVar];
      if (typeof value === "string" && value.length > 0) return value;
    }
  } catch { /* ignore parse errors */ }
  return undefined;
}

/**
 * Read an env var assignment from the existing shell profile.
 * Handles PowerShell ($env:VAR = "...") and bash/zsh (export VAR="...").
 */
function readEnvFromShellProfile(envVar: string): string | undefined {
  const platform = detectPlatform();
  if (platform === "windows-native") {
    const profilePath = getPowerShellProfilePath();
    try {
      if (!fs.existsSync(profilePath)) return undefined;
      const content = fs.readFileSync(profilePath, "utf-8");
      const match = content.match(new RegExp(`\\$env:${envVar}\\s*=\\s*["']([^"']+)["']`));
      if (match) return match[1];
    } catch { /* ignore */ }
  } else {
    for (const rc of [path.join(os.homedir(), ".zshrc"), path.join(os.homedir(), ".bashrc")]) {
      try {
        if (!fs.existsSync(rc)) continue;
        const content = fs.readFileSync(rc, "utf-8");
        const match = content.match(new RegExp(`export ${envVar}=["']([^"']+)["']`));
        if (match) return match[1];
      } catch { /* ignore */ }
    }
  }
  return undefined;
}

/**
 * Capture user's current *_BASE_URL env var values before proxy overwrites them.
 * Returns a map of provider name → original URL.
 *
 * Sources tried in order (first non-localhost value wins):
 * 1. process.env (current environment)
 * 2. Tool-specific config files (e.g. Claude Code's settings.json)
 * 3. Existing shell profile assignments
 */
export function captureUserBaseUrls(
  tools: Array<DetectedTool>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const tool of tools) {
    if (!tool.envVar || !tool.provider) continue;
    if (result[tool.provider]) continue;

    // Source 1: process.env
    let value = process.env[tool.envVar];

    // Source 2: Tool-specific config (e.g., Claude Code's settings.json)
    if (!value || isLocalhostUrl(value)) {
      value = readEnvFromToolConfig(tool.name, tool.envVar) ?? value;
    }

    // Source 3: Existing shell profile
    if (!value || isLocalhostUrl(value)) {
      value = readEnvFromShellProfile(tool.envVar) ?? value;
    }

    if (!value || isLocalhostUrl(value)) continue;
    result[tool.provider] = value;
  }
  return result;
}

export function writeProxyConfig(
  tools: Array<DetectedTool>,
  port: number
): { rcPath: string; platform: Platform } {
  const platform = detectPlatform()
  if (platform === "windows-native") {
    const content = generatePowerShellExports(tools, port)
    const rcPath = writePowerShellProfile(content)
    return { rcPath, platform }
  }
  const content = generateProxyExports(tools, port)
  const rcPath = writeShellConfig(content)
  return { rcPath, platform }
}

// ---------------------------------------------------------------------------
// Restore (reverse of init / proxy takeover)
// ---------------------------------------------------------------------------

/** Regex matching one full agentfare marker block (start ... end, inclusive). */
function markerRegex(): RegExp {
  return new RegExp(
    `${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}`,
    "g"
  );
}

/**
 * Remove every agentfare marker block from a shell profile.
 * Without an argument, cleans the first existing POSIX rc (.zshrc then .bashrc).
 * With an explicit rcPath, cleans only that file.
 * Returns the path that was cleaned, or undefined if none existed.
 */
export function cleanShellMarkers(
  rcPath?: string,
  homeDirOverride?: string
): string | undefined {
  const homeDir = homeDirOverride ?? os.homedir();
  const candidates = rcPath
    ? [rcPath]
    : [path.join(homeDir, ".zshrc"), path.join(homeDir, ".bashrc")];
  let touched: string | undefined;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const existing = fs.readFileSync(p, "utf-8");
    const cleaned = existing
      .replace(markerRegex(), "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    atomicWriteFileSync(p, cleaned + "\n");
    touched = p;
    if (rcPath) break;
  }
  return touched;
}

/**
 * Append restored *_BASE_URL exports (or unsets) to a profile.
 * For each CLI tool: if a captured upstream URL exists, write it back;
 * otherwise emit an `unset` / `Remove-Item` so no stale proxy URL lingers.
 * Returns the list of provider names whose URL was restored.
 */
export function writeRestoredBaseUrls(
  tools: Array<DetectedTool>,
  capturedUrls: Record<string, string>,
  rcPath: string,
  platform: Platform
): string[] {
  const restored: string[] = [];
  const lines: string[] = [];
  for (const t of tools) {
    if (t.type !== "cli" || !t.envVar || !t.provider) continue;
    const url = capturedUrls[t.provider];
    if (typeof url === "string" && url.length > 0) {
      lines.push(
        platform === "windows-native"
          ? `$env:${t.envVar} = "${url}"`
          : `export ${t.envVar}="${url}"`
      );
      restored.push(t.provider);
    } else {
      // No captured URL — clear any leftover proxy assignment
      lines.push(
        platform === "windows-native"
          ? `Remove-Item Env:\\${t.envVar} -ErrorAction SilentlyContinue`
          : `unset ${t.envVar}`
      );
    }
  }
  if (lines.length === 0) return restored;
  const dir = path.dirname(rcPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, "utf-8") : "";
  // Idempotency: strip any prior assignment for these vars so re-running restore
  // does not duplicate export/unset lines.
  for (const t of tools) {
    if (!t.envVar) continue;
    const v = escapeRegex(t.envVar);
    existing = existing
      .replace(new RegExp(`^export ${v}=.*$\\n?`, "gm"), "")
      .replace(new RegExp(`^unset ${v}\\b.*$\\n?`, "gm"), "")
      .replace(new RegExp(`^\\$env:${v}\\s*=.*$\\n?`, "gm"), "")
      .replace(new RegExp(`^Remove-Item Env:\\\\${v}.*$\\n?`, "gm"), "");
  }
  const base = existing.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
  atomicWriteFileSync(rcPath, `${base}\n\n${lines.join("\n")}\n`);
  return restored;
}

/**
 * Reverse the shell-profile takeover: strip agentfare marker blocks, then write
 * back the user's original *_BASE_URL exports (captured during `init`).
 * Idempotent — running twice produces the same profile state.
 */
export function restoreShellProfile(
  tools: Array<DetectedTool>,
  capturedUrls: Record<string, string> = {},
  platformOverride?: Platform,
  homeDirOverride?: string
): { rcPath: string; platform: Platform; restored: string[] } {
  const platform = platformOverride ?? detectPlatform();
  if (platform === "windows-native") {
    const rcPath = getPowerShellProfilePath();
    const dir = path.dirname(rcPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(rcPath)) {
      const existing = fs.readFileSync(rcPath, "utf-8");
      const cleaned = existing.replace(markerRegex(), "").replace(/\n{3,}/g, "\n\n").trim();
      atomicWriteFileSync(rcPath, cleaned + "\n");
    } else {
      atomicWriteFileSync(rcPath, "");
    }
    const restored = writeRestoredBaseUrls(tools, capturedUrls, rcPath, platform);
    return { rcPath, platform, restored };
  }

  // POSIX: clean markers from candidate rc files, write to the first existing.
  const homeDir = homeDirOverride ?? os.homedir();
  cleanShellMarkers(undefined, homeDir);
  let rcPath = path.join(homeDir, ".zshrc");
  if (!fs.existsSync(rcPath)) rcPath = path.join(homeDir, ".bashrc");
  const restored = writeRestoredBaseUrls(tools, capturedUrls, rcPath, platform);
  return { rcPath, platform, restored };
}
