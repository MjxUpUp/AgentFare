import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectPlatform, type Platform, type DetectedTool } from "./detector.js";

const MARKER_START = "# >>> agentfare >>>";
const MARKER_END = "# <<< agentfare <<<";

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
  const tmpPath = path.join(os.tmpdir(), `.agentfare-rc-${Date.now()}.tmp`);
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
