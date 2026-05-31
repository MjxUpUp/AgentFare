// @agentdispatch/loader — --require entry point
// Generates ~/.agentdispatch/loader.js (user-editable), then loads it

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LOADER_DIR = path.join(os.homedir(), ".agentdispatch");
const LOADER_FILE = path.join(LOADER_DIR, "loader.js");

export function ensureLoaderScript(): string {
  if (!fs.existsSync(LOADER_DIR)) {
    fs.mkdirSync(LOADER_DIR, { recursive: true });
  }

  if (!fs.existsSync(LOADER_FILE)) {
    const content = `// AgentDispatch Loader — editable
// Add other hook requires to this array:
const hooks = [
  require("@agentdispatch/hook"),
];
hooks.forEach(h => { if (typeof h === 'function') h(); });
`;
    fs.writeFileSync(LOADER_FILE, content);
  }

  return LOADER_FILE;
}
