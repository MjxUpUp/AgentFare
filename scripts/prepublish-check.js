#!/usr/bin/env node
/**
 * Prepublish guard for pnpm monorepo.
 *
 * Blocks `npm publish` if package.json contains `workspace:` protocol references.
 * pnpm publish resolves these automatically; npm publish does not, causing
 * EUNSUPPORTEDPROTOCOL errors for end users.
 *
 * Usage: add to each package.json:
 *   "prepublishOnly": "node ../../scripts/prepublish-check.js"
 */

const fs = require("fs");
const path = require("path");

const pkgPath = path.resolve(process.cwd(), "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

// pnpm publish resolves workspace: automatically — allow it through
const npmExecPath = (process.env.npm_execpath || "").toLowerCase();
const isPnpm = npmExecPath.includes("pnpm") || process.env.PNPM_HOME !== undefined;
if (isPnpm) {
  process.exit(0);
}

const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
const workspaceRefs = Object.entries(allDeps).filter(([, v]) =>
  typeof v === "string" && v.startsWith("workspace:"),
);

if (workspaceRefs.length > 0) {
  console.error("\nBLOCKED: workspace: protocol found in package.json.");
  console.error("npm publish does not resolve workspace: references.\n");
  console.error("Affected dependencies:");
  for (const [name, ref] of workspaceRefs) {
    console.error(`  ${name}: ${ref}`);
  }
  console.error("\nUse pnpm publish instead:");
  console.error("  pnpm publish --filter <package-name> --access public --registry https://registry.npmjs.org/\n");
  process.exit(1);
}

process.exit(0);
