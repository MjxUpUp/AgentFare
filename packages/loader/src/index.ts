// @agentfare/loader — --require entry point
// Generates ~/.agentfare/loader.js (user-editable), then loads it

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LOADER_DIR = path.join(os.homedir(), ".agentfare");
const LOADER_FILE = path.join(LOADER_DIR, "loader.js");

/**
 * Resolve the absolute path to a package entry point.
 * Uses __dirname (the location of this compiled file) as the base for resolution,
 * so it always resolves from the installed @agentfare/loader location regardless of CWD.
 */
function resolvePackagePath(specifier: string): string {
  // __dirname is the dist/ folder of @agentfare/loader — the correct node_modules
  // tree is always accessible from there (global install or monorepo).
  return require.resolve(specifier, { paths: [__dirname] });
}

export function ensureLoaderScript(): string {
  if (!fs.existsSync(LOADER_DIR)) {
    fs.mkdirSync(LOADER_DIR, { recursive: true });
  }

  // Resolve the hook path from this package's location (not CWD-dependent)
  let hookPath: string;
  try {
    hookPath = resolvePackagePath("@agentfare/hook");
    // Normalize to forward slashes — backslashes break require() in loader.js
    // because \n, \t etc. are interpreted as escape sequences by the JS parser
    hookPath = hookPath.replace(/\\/g, "/");
  } catch {
    hookPath = "@agentfare/hook";
  }
  const hookRequirePath = JSON.stringify(hookPath);

  if (!fs.existsSync(LOADER_FILE)) {
    // Generate fresh loader.js with absolute path
    const content = `// AgentFare Loader — editable
// Add other hook requires to this array:
const hooks = [
  require(${hookRequirePath}),
];
hooks.forEach(h => { if (typeof h === 'function') h(); });
`;
    fs.writeFileSync(LOADER_FILE, content);
  } else {
    // Update the require path in-place if it changed (e.g. after npm global update)
    // without overwriting user edits
    const existing = fs.readFileSync(LOADER_FILE, "utf-8");
    // Match require("...") or require('...') in the hooks array
    const updated = existing.replace(
      /require\(["'][^"']*(@agentfare\/hook|agentfare.*hook[^"']*)["']\)/,
      `require(${hookRequirePath})`
    );
    if (updated !== existing) {
      fs.writeFileSync(LOADER_FILE, updated);
    }
  }

  return LOADER_FILE;
}
