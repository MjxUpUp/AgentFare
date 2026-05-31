import { detectTools, detectPlatform } from "./detector.js";
import { generateShellFunctions, writeShellConfig } from "./shell-writer.js";
import { validateHookInjection } from "./validator.js";
import { reportStatus } from "./reporter.js";

export { detectTools, detectPlatform } from "./detector.js";
export { generateShellFunctions, writeShellConfig } from "./shell-writer.js";
export { validateHookInjection } from "./validator.js";
export { reportStatus } from "./reporter.js";

async function main() {
  const platform = detectPlatform();
  if (platform === "windows-native") {
    console.error(
      "Native Windows is not supported. Please run via WSL2."
    );
    process.exit(1);
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

main().catch((err) => {
  console.error("setup failed:", err);
  process.exit(1);
});
