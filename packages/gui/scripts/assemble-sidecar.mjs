/**
 * Assemble the production daemon sidecar into packages/gui/sidecar/.
 *
 * The desktop GUI ships the proxy daemon as a child process. For that it needs
 * three things colocated as Tauri bundle resources:
 *
 *   sidecar/
 *     node(.exe)                        — the Node runtime (process.execPath)
 *     daemon.mjs                        — esbuild-bundled daemon entry
 *     node_modules/
 *       better-sqlite3/                 — package.json + lib/ + the native .node
 *       bindings/                       — runtime dep of better-sqlite3/lib/database.js
 *       file-uri-to-path/               — runtime dep of bindings
 *
 * Why three native-adjacent packages and not just the `.node`: better-sqlite3's
 * `lib/database.js` loads its native addon via `require('bindings')(...)`, and
 * `bindings` itself does `require('file-uri-to-path')`. The esbuild bundle marks
 * `better-sqlite3` external, so at runtime Node resolves the real package from
 * the sidecar's `node_modules` — which means its transitive `bindings` /
 * `file-uri-to-path` must be present too. (The alternative — passing
 * `nativeBinding` to the Database ctor — would require patching shared core
 * code; shipping the deps is mechanical and non-invasive.)
 *
 * Run after the daemon is bundled:
 *   pnpm --filter @agentfare/proxy build && pnpm --filter @agentfare/proxy bundle:daemon
 *   node scripts/assemble-sidecar.mjs
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiRoot = path.resolve(here, "..");
const outDir = path.join(guiRoot, "sidecar");

const daemonMjs = path.resolve(guiRoot, "../proxy/dist/daemon.mjs");
if (!fs.existsSync(daemonMjs)) {
  console.error(
    `[assemble-sidecar] missing ${daemonMjs} — run "pnpm --filter @agentfare/proxy build && pnpm --filter @agentfare/proxy bundle:daemon" first.`,
  );
  process.exit(1);
}

// Resolve the three native-adjacent packages the SAME way the daemon resolves
// them at runtime: createRequire rooted at better-sqlite3's lib/database.js,
// then file-uri-to-path rooted at bindings/bindings.js. Hardcoding the pnpm
// .pnpm/<pkg>@<ver>/ layout would break on any version bump.
//
// pkgRoot resolves the bare specifier (not "<pkg>/package.json") because some
// packages (e.g. file-uri-to-path) gate package.json behind an `exports` map,
// so the subpath throws. The bare resolve returns the entry .js; the package
// root is the nearest ancestor directory containing package.json. We then
// realpath it: under pnpm these paths are symlinks into .pnpm/, and copying a
// symlink as a symlink would leave dangling links in the production bundle.
function pkgRoot(req, spec) {
  const entry = req.resolve(spec);
  let dir = path.dirname(entry);
  for (let i = 0; i < 16 && dir !== path.dirname(dir); i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return fs.realpathSync(dir);
    dir = path.dirname(dir);
  }
  throw new Error(`could not locate package.json for ${spec} from ${entry}`);
}
const bsqRoot = pkgRoot(createRequire(daemonMjs), "better-sqlite3");
const bindingsRoot = pkgRoot(
  createRequire(path.join(bsqRoot, "lib/database.js")),
  "bindings",
);
const deps = {
  bindings: bindingsRoot,
  "file-uri-to-path": pkgRoot(createRequire(path.join(bindingsRoot, "bindings.js")), "file-uri-to-path"),
};

const nativeNode = path.join(
  bsqRoot,
  "build/Release/better_sqlite3.node".split("/").join(path.sep),
);
if (!fs.existsSync(nativeNode)) {
  console.error(`[assemble-sidecar] missing native addon ${nativeNode}`);
  process.exit(1);
}

// Fresh sidecar dir — never merge into a stale one (avoids shipping old .node
// or leftover intermediates after a better-sqlite3 rebuild).
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "node_modules"), { recursive: true });

// dereference:true by default: pnpm lays these out as symlinks into .pnpm/.
// Copying a symlink as a symlink leaves dangling links in the production
// bundle; we always want the real file contents.
function copy(src, dest, opts = {}) {
  fs.cpSync(src, dest, { recursive: true, dereference: true, ...opts });
}

// 1. daemon bundle
copy(daemonMjs, path.join(outDir, "daemon.mjs"));

// 2. Node runtime (the building platform's node — per-platform in CI)
const nodeDest = path.join(outDir, process.platform === "win32" ? "node.exe" : "node");
copy(process.execPath, nodeDest);
if (process.platform !== "win32") fs.chmodSync(nodeDest, 0o755);

// macOS: Tauri does NOT re-sign files under bundle.resources (they're treated
// as data), so the embedded node binary must be signed explicitly — otherwise
// Gatekeeper blocks its spawn at runtime even though the .app is signed. Only
// when an identity is configured (release CI); unsigned in local builds.
if (process.platform === "darwin" && process.env.APPLE_SIGNING_IDENTITY) {
  const r = spawnSync(
    "codesign",
    ["--force", "--options", "runtime", "--timestamp", "--sign", process.env.APPLE_SIGNING_IDENTITY, nodeDest],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error("[assemble-sidecar] codesign of node binary failed");
  console.log("  signed node with", process.env.APPLE_SIGNING_IDENTITY);
}

// 3. better-sqlite3: package.json + lib/ wholesale, but ONLY the real .node
//    from build/Release (skip MSVC intermediates obj/, test_extension.node, etc.)
const bsqOut = path.join(outDir, "node_modules/better-sqlite3");
copy(path.join(bsqRoot, "package.json"), path.join(bsqOut, "package.json"));
copy(path.join(bsqRoot, "lib"), path.join(bsqOut, "lib"));
fs.mkdirSync(path.join(bsqOut, "build/Release".split("/").join(path.sep)), {
  recursive: true,
});
copy(nativeNode, path.join(bsqOut, "build/Release/better_sqlite3.node"));

// 4. bindings + file-uri-to-path: copy whole packages (robust to future
//    multi-file layouts; currently single-file but cheap to copy wholesale).
for (const [name, root] of Object.entries(deps)) {
  copy(root, path.join(outDir, "node_modules", name));
}

function mb(p) {
  const st = fs.statSync(p);
  return (st.size / 1024 / 1024).toFixed(1) + "MB";
}
console.log("[assemble-sidecar] sidecar assembled at", outDir);
console.log("  node          ", mb(nodeDest), `(${process.platform}-${process.arch})`);
console.log("  daemon.mjs    ", mb(path.join(outDir, "daemon.mjs")));
console.log("  better_sqlite3.node", mb(nativeNode));
console.log("  + bindings, file-uri-to-path");
