/**
 * Bundle the GUI-side setup CLI into a single ESM file for the Tauri sidecar.
 *
 * The desktop shell's IPC commands spawn `node …/setup-cli.mjs` to perform shell
 * takeover/restore (see src/cli.ts). For an installer that must be one
 * self-contained script — workspace `@agentfare/models` and the package's own
 * internal modules are inlined. Unlike the daemon, setup has NO native addon
 * dependency, so nothing is marked external.
 *
 *   node scripts/bundle-cli.mjs   →   dist/setup-cli.mjs
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  // ESM: cli.ts uses `import.meta.url` for the script-invoked check, which is
  // empty in CJS output. Matches the daemon's ESM choice for consistency.
  format: "esm",
  target: ["node22"],
  outfile: "dist/setup-cli.mjs",
  banner: {
    js: [
      "// AgentFare setup CLI — bundled by esbuild.",
      "// Spawned by the Tauri shell's IPC (takeover/restore/detect).",
      "// No external deps: setup + @agentfare/models are fully inlined.",
    ].join("\n"),
  },
  logLevel: "info",
});
