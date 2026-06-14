import { detectTools, detectPlatform } from "./detector.js";
import { generateShellFunctions, writeShellConfig } from "./shell-writer.js";
import { validateHookInjection } from "./validator.js";
import { reportStatus } from "./reporter.js";

export { detectTools, detectPlatform, type ToolName, type DetectedTool, type Platform } from "./detector.js";
export { generateShellFunctions, writeShellConfig, generatePowerShellFunctions, getPowerShellProfilePath, writePowerShellProfile, writeConfig, generateProxyExports, generatePowerShellExports, writeProxyConfig, captureUserBaseUrls, cleanShellMarkers, writeRestoredBaseUrls, restoreShellProfile, MARKER_START, MARKER_END } from "./shell-writer.js";
export { validateHookInjection } from "./validator.js";
export { reportStatus } from "./reporter.js";

/**
 * Run the full setup flow. ISSUE-030: exported instead of auto-executed on import.
 */
export async function runSetup(): Promise<void> {
  const platform = detectPlatform();
  if (platform === "windows-native") {
    console.warn("[AgentFare] Windows 原生平台支持为实验性功能，部分功能可能受限");
  }
  console.log(`detected platform: ${platform}`);

  const tools = detectTools();
  if (tools.length === 0) {
    console.error("No codex or claude CLI tools detected.");
    process.exit(1);
  }

  const shellContent = generateShellFunctions(tools);
  const rcPath = writeShellConfig(shellContent);
  console.log(`shell functions written to ${rcPath}`);

  const hookResult = validateHookInjection();
  if (hookResult.available) {
    console.log("hook injection available (monkey-patch mode)");
  } else {
    console.warn(`warning: ${hookResult.reason}`);
  }

  reportStatus(tools);
}
