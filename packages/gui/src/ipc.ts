/**
 * Tauri IPC wrapper for shell takeover / restore.
 *
 * The Rust side (src-tauri/src/lib.rs) registers three commands that each spawn
 * the setup CLI (packages/setup/src/cli.ts) and return its single-line JSON
 * result. This module is the typed frontend entry to those commands, and gates
 * them on actually running inside Tauri: in a plain browser / `vite dev` server
 * (no `window.__TAURI_INTERNALS__`) the calls throw a clear, user-facing error
 * instead of a cryptic "invoke is not a function".
 */
import { invoke } from "@tauri-apps/api/core";

// Tauri v2 injects this global on the window only inside a built/dev desktop
// shell. Its presence is the canonical "are we in Tauri?" check.
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** A detected tool as emitted by the setup CLI's `capture` subcommand. */
export interface ShellTool {
  name: string;
  provider: string;
  type: "cli" | "ide";
  envVar?: string;
  proxyPath?: string;
}

/** Common shape of every setup-CLI result object (success and failure). */
export type CliResult<T extends { ok: true }> = T | { ok: false; error: string };

export type CaptureResult = CliResult<{
  ok: true;
  subcommand: "capture";
  tools: ShellTool[];
  capturedUrls: Record<string, string>;
}>;
export type TakeoverResult = CliResult<{
  ok: true;
  subcommand: "takeover";
  rcPath: string;
  platform: string;
  tools: ShellTool[];
  capturedUrls: Record<string, string>;
}>;
export type RestoreResult = CliResult<{
  ok: true;
  subcommand: "restore";
  rcPath: string;
  platform: string;
  restored: string[];
  capturedUrls: Record<string, string>;
}>;

const NOT_TAURI =
  "shell 接管仅在桌面应用中可用（当前运行在浏览器/开发服务器下）";

/** Read-only probe: detect CLI tools + capture their current *_BASE_URL. */
export async function detectShellTools(): Promise<CaptureResult> {
  if (!isTauri) throw new Error(NOT_TAURI);
  return invoke<CaptureResult>("detect_shell_tools");
}

/**
 * Take over the shell: persist current upstream URLs, rewrite *_BASE_URL to the
 * proxy. `port` defaults to the daemon port (3456) on the Rust side.
 */
export async function takeoverShell(port?: number): Promise<TakeoverResult> {
  if (!isTauri) throw new Error(NOT_TAURI);
  // Omit `port` entirely when undefined so Rust's Option<u16> sees None (default).
  const args = port != null ? { port } : {};
  return invoke<TakeoverResult>("takeover_shell", args);
}

/** Reverse the takeover: strip markers + restore original *_BASE_URL exports. */
export async function restoreShell(): Promise<RestoreResult> {
  if (!isTauri) throw new Error(NOT_TAURI);
  return invoke<RestoreResult>("restore_shell");
}

/** Exposed for tests / feature-gating UI on whether IPC is available. */
export function runningInTauri(): boolean {
  return isTauri;
}
