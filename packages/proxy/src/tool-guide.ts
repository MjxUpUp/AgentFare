/**
 * Tool configuration guide generator.
 *
 * Outputs the *_BASE_URL environment variables each tool needs to point at the proxy.
 */

export interface ToolConfig {
  tool: string;
  envVar: string;
  path: string;
}

/**
 * Known tools and their BASE_URL environment variables.
 */
const TOOL_CONFIGS: ToolConfig[] = [
  { tool: "Claude Code", envVar: "ANTHROPIC_BASE_URL", path: "/anthropic" },
  { tool: "OpenAI Codex", envVar: "OPENAI_BASE_URL", path: "/openai" },
  { tool: "Cursor", envVar: "OPENAI_API_BASE", path: "/openai" },
  { tool: "Windsurf", envVar: "OPENAI_API_BASE", path: "/openai" },
  { tool: "Kimi (Moonshot)", envVar: "MOONSHOT_BASE_URL", path: "/moonshot" },
  { tool: "Qoder", envVar: "OPENAI_API_BASE", path: "/openai" },
  { tool: "DeepSeek", envVar: "DEEPSEEK_BASE_URL", path: "/deepseek" },
  { tool: "GLM/智谱", envVar: "ZHIPU_BASE_URL", path: "/zhipu" },
  { tool: "Google Gemini", envVar: "GOOGLE_BASE_URL", path: "/google" },
  { tool: "Qwen/阿里", envVar: "ALIBABA_BASE_URL", path: "/alibaba" },
];

/**
 * Generate the tool configuration guide as a string.
 * Suitable for printing to stdout after `agentfare proxy start`.
 */
export function generateToolGuide(port: number): string {
  const lines: string[] = [];
  lines.push("Configure your tools with these environment variables:\n");

  const maxToolLen = Math.max(...TOOL_CONFIGS.map(t => t.tool.length));
  const maxEnvLen = Math.max(...TOOL_CONFIGS.map(t => t.envVar.length));

  for (const cfg of TOOL_CONFIGS) {
    const url = `http://localhost:${port}${cfg.path}`;
    lines.push(
      `  ${cfg.tool.padEnd(maxToolLen)}  ${cfg.envVar.padEnd(maxEnvLen)} = ${url}`,
    );
  }

  lines.push("");
  lines.push("Or export all at once:");
  lines.push(`  eval "$(agentfare proxy env --port ${port})"`);

  return lines.join("\n");
}

/**
 * Generate shell-exportable environment variable commands.
 */
export function generateExportCommands(port: number, shell: "bash" | "powershell" = "bash"): string {
  const lines: string[] = [];

  for (const cfg of TOOL_CONFIGS) {
    const url = `http://localhost:${port}${cfg.path}`;
    if (shell === "powershell") {
      lines.push(`$env:${cfg.envVar} = "${url}"`);
    } else {
      lines.push(`export ${cfg.envVar}="${url}"`);
    }
  }

  return lines.join("\n");
}
