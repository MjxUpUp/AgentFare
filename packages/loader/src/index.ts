// @agentfare/loader — --require entry point
// Generates ~/.agentfare/loader.js (user-editable), then loads it

import * as fs from "node:fs";
import { getBaseDir, getLoaderPath } from "@agentfare/models";

// SSOT: packages/models/src/paths.ts. Paths are re-read inside ensureLoaderScript()
// (NOT module-level consts) so AGENTFARE_HOME changes are honored at call time —
// this also lets tests isolate under a tmpdir without touching the real ~/.agentfare.

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
  const LOADER_DIR = getBaseDir();
  const LOADER_FILE = getLoaderPath();
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

  // Template for the loader script (versioned so stale formats auto-upgrade)
  const LOADER_TEMPLATE = `// AgentFare Loader v2 — editable
// Add other hook requires to this array:
const hooks = [
  require(${hookRequirePath}),
];
hooks.forEach(mod => {
  if (mod && typeof mod.setup === 'function') mod.setup();
  else if (typeof mod === 'function') mod();
});
`;

  const needsRegen = !fs.existsSync(LOADER_FILE)
    || !fs.readFileSync(LOADER_FILE, "utf-8").includes("mod.setup");

  if (needsRegen) {
    // Generate fresh loader.js (missing file or old format without mod.setup)
    fs.writeFileSync(LOADER_FILE, LOADER_TEMPLATE);
  } else {
    // Update the require path in-place if it changed (e.g. after npm global update)
    // without overwriting user edits
    const existing = fs.readFileSync(LOADER_FILE, "utf-8");
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
