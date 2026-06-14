/**
 * Credential store: atomic write + permission hardening + mtime-aware cache.
 *
 * keys.json (getKeysPath()) is the credential SSOT — provider → API key.
 * This module is the single writer (CLI `config set providers.*.apiKey`) and
 * the mtime-aware reader (key-store.ts resolveApiKey).
 *
 * Fixes three gaps:
 *  - Non-atomic writes could truncate keys.json on crash → atomicWriteFileSync.
 *  - keys.json was world-readable (mode 0644 default) → chmod 0o600 / icacls.
 *  - The proxy daemon cached keys for its whole lifetime, so a key written by
 *    the CLI never reached a running proxy → mtime-based cache invalidation.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";
import { atomicWriteFileSync } from "@agentfare/core";
import { getKeysPath } from "@agentfare/models";

/**
 * Persist keys atomically, harden permissions, and bust the read cache.
 * Merges into any existing keys.json (does not overwrite unrelated providers).
 */
export function saveKeys(updates: Record<string, string>): void {
  const keysPath = getKeysPath();
  const existing = loadKeysFromDisk(true);
  const merged = { ...existing, ...updates };
  fs.mkdirSync(path.dirname(keysPath), { recursive: true });
  atomicWriteFileSync(keysPath, JSON.stringify(merged, null, 2));
  applyKeyPermissions(keysPath);
  invalidateKeyCache();
}

/**
 * Restrict keys.json to owner-only. POSIX: 0o600. Windows: icacls /inheritance:r
 * granting only the current user R,W. Failures are best-effort and swallowed —
 * permission hardening must never block a key write from succeeding.
 */
export function applyKeyPermissions(keysPath: string = getKeysPath()): void {
  if (!fs.existsSync(keysPath)) return;
  if (process.platform === "win32") {
    const user = process.env.USERNAME ?? process.env.USER ?? "";
    if (!user) return;
    try {
      child_process.execSync(
        `icacls "${keysPath}" /inheritance:r /grant:r "${user}:(R,W)"`,
        { stdio: "ignore" },
      );
    } catch {
      // best-effort: restricted/sandboxed environments may block icacls
    }
  } else {
    try {
      fs.chmodSync(keysPath, 0o600);
    } catch {
      // best-effort: some filesystems ignore chmod
    }
  }
}

/** In-process key cache state (mtime-keyed). */
let cachedKeys: Record<string, string> | null = null;
let cachedMtime: number | null = null;

/** Drop the in-process cache so the next read reloads from disk. */
export function invalidateKeyCache(): void {
  cachedKeys = null;
  cachedMtime = null;
}

/**
 * Load keys.json, re-reading whenever its mtime changes.
 *
 * The proxy is a long-lived daemon while the CLI is a short-lived process;
 * mtime probing on each call keeps the daemon in sync with CLI writes without
 * any IPC. stat() per request is cheap (syscall, no file read on cache hit).
 */
export function loadKeysFromDisk(force = false): Record<string, string> {
  const keysPath = getKeysPath();
  let mtime: number;
  try {
    mtime = fs.statSync(keysPath).mtimeMs;
  } catch {
    // File missing. Preserve a prior cache unless forced; else empty.
    if (!force && cachedKeys !== null) return cachedKeys;
    cachedKeys = {};
    cachedMtime = null;
    return cachedKeys;
  }

  if (!force && cachedKeys !== null && cachedMtime === mtime) {
    return cachedKeys;
  }

  try {
    const raw = fs.readFileSync(keysPath, "utf-8");
    cachedKeys = JSON.parse(raw);
  } catch {
    // Unreadable or unparseable: treat as empty rather than poisoning the cache.
    cachedKeys = {};
  }
  cachedMtime = mtime;
  return cachedKeys!;
}
