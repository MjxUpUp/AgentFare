/**
 * @agentfare/proxy — cc-switch 锁定的 routing patch 计算（纯函数）。
 *
 * 从 daemon-entry 的 applyLock 抽出，使"锁定模式 → routing 子对象"的决策逻辑
 * 可独立单元测试（applyLock 本身是入口 IO：读 config.json、写盘、reloadConfig，
 * 属入口白名单）。daemon-entry.applyLock 调用 computeLockRouting 得到 patch，
 * 再合并进既有 routing（保留 crossProvider/defaultStrategy 等字段）。
 */

import type { ActiveLock } from "./admin.js";

export type LockMode = ActiveLock["lockMode"];

/**
 * 计算锁定后的 routing 字面量（lockMode + 条件 activeModel/activeProvider）。
 *
 * 关键不变式：解锁（auto）或切换锁定目标时，结果不携带旧的 activeModel /
 * activeProvider —— 调用方用返回值覆盖这两个键，undefined 经 JSON.stringify
 * 落盘时被丢弃，等价于 delete，避免 admin GET /api/active 误显示残留锁定。
 */
export function computeLockRouting(lock: ActiveLock): {
  lockMode: LockMode;
  activeModel?: string;
  activeProvider?: string;
} {
  const next: { lockMode: LockMode; activeModel?: string; activeProvider?: string } = {
    lockMode: lock.lockMode,
  };
  if (lock.lockMode === "model" && lock.activeModel) {
    next.activeModel = lock.activeModel;
  } else if (lock.lockMode === "provider" && lock.activeProvider) {
    next.activeProvider = lock.activeProvider;
  }
  return next;
}

/**
 * Result of {@link buildLockedConfigJson} — either the serialized new config or
 * a structured refusal (the caller surfaces the error to the GUI).
 */
export type BuildLockedConfigResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

/**
 * Build the config.json contents that apply a lock to its routing section.
 * Pure (no IO): takes the existing raw file contents — or null when absent —
 * and the lock, returns the serialized new contents or a structured error.
 * Extracted from daemon-entry.applyLock so the merge + corrupt-handling is
 * unit-testable.
 *
 * Invariants:
 *  - **corrupt existing → { ok: false }** (H2): never overwrite a file we
 *    couldn't parse. An earlier version reset partial to {} and wrote, which
 *    erased every non-routing field (providers / customModels / …) the first
 *    time the user clicked a model switch on a corrupted config.
 *  - non-routing fields are preserved verbatim.
 *  - routing fields other than lockMode / activeModel / activeProvider are
 *    preserved (crossProvider, defaultStrategy, …).
 *  - switching lock target or unlocking clears the stale active* keys
 *    (undefined drops during JSON.stringify, ≡ delete) so GET /api/active
 *    never shows a residual lock.
 */
export function buildLockedConfigJson(
  existingRaw: string | null,
  lock: ActiveLock,
): BuildLockedConfigResult {
  let partial: Record<string, unknown> = {};
  if (existingRaw !== null) {
    try {
      partial = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      // H2: refuse to overwrite a config we couldn't read. Writing a fresh
      // routing-only object would erase the user's non-routing config.
      return { ok: false, error: "config_corrupt" };
    }
  }
  const existing = (partial.routing ?? {}) as Record<string, unknown>;
  const patch = computeLockRouting(lock);
  partial.routing = {
    ...existing,
    lockMode: patch.lockMode,
    activeModel: patch.activeModel,
    activeProvider: patch.activeProvider,
  };
  return { ok: true, content: JSON.stringify(partial, null, 2) };
}
