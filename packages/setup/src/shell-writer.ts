import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const MARKER_START = "# >>> agentdispatch >>>";
const MARKER_END = "# <<< agentdispatch <<<";

export function generateShellFunctions(
  tools: Array<{ name: string }>
): string {
  const functions = tools
    .map(
      (tool) =>
        `${tool.name}() {\n  NODE_OPTIONS="--require ~/.agentdispatch/loader.js" command ${tool.name} "$@"\n}`
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
      fs.writeFileSync(rcPath, updated);
      return rcPath;
    }
  }
  const bashrc = path.join(homeDir, ".bashrc");
  fs.writeFileSync(bashrc, content);
  return bashrc;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
