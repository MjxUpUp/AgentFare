/**
 * Bundle the proxy daemon into a single CJS file for use as a Tauri sidecar.
 *
 * The desktop GUI spawns the daemon as a child process. For that to ship
 * inside an installer it must be a single self-contained script (Node SEA, or
 * a `node daemon.cjs` resource) rather than a tangle of workspace `@agentfare/*`
 * imports + node_modules. esbuild inlines the workspace packages; the native
 * addon `better-sqlite3` stays external (it cannot be bundled into JS and must
 * resolve to its platform-specific `.node` at runtime).
 *
 *   node scripts/bundle-daemon.mjs   →   dist/daemon.cjs
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/daemon-entry.ts"],
  bundle: true,
  platform: "node",
  // ESM, not CJS: @agentfare/core loads better-sqlite3 via
  // `createRequire(import.meta.url)`, and import.meta.url is EMPTY in CJS
  // output (esbuild warns + breaks the native require). ESM preserves it.
  // Node SEA (node22+) and the bundled-node sidecar both accept an ESM entry.
  format: "esm",
  target: ["node22"],
  outfile: "dist/daemon.mjs",
  // Native addon — cannot be bundled into JS; resolves from node_modules
  // (dev/repo) or the sidecar's resource dir (production, handled later).
  external: ["better-sqlite3"],
  banner: {
    js: [
      "// AgentFare proxy daemon — bundled by esbuild.",
      "// better-sqlite3 is external (native addon).",
      "// ESM output (import.meta.url required by core's createRequire).",
    ].join("\n"),
  },
  logLevel: "info",
});
