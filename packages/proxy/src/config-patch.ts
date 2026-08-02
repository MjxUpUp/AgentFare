/**
 * @agentfare/proxy — config.json providers 段 patch（纯函数）。
 *
 * 从 daemon-entry.applyProviders 抽出，使"providers 配置写入"可独立单测
 * （applyProviders 本身是入口 IO：读 config.json、写盘、reloadConfig，属
 * 入口白名单）。与 lock-config.ts 的 buildLockedConfigJson 同模式：corrupt
 * 拒写、保留非 providers 字段、merge 而非整体替换——POST /api/providers
 * 只覆盖调用方指定的 provider，不动其他 provider。
 *
 * 这是 GUI 一等公民的 provider 配置写入通道（A3）：GUI Settings 页经
 * admin API POST /api/providers 改 provider 的 baseUrl（如指向中转站）或
 * 加新 provider，daemon 热加载后下一个请求即用新配置。
 */
import type { ProviderConfig } from "@agentfare/core";

export type BuildConfigResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

/**
 * Build config.json contents that merge a providers update into the providers
 * section. Pure (no IO). Invariants mirror buildLockedConfigJson:
 *  - **corrupt existing → { ok: false }** (H2 同理): never overwrite a file we
 *    couldn't parse — writing a fresh providers-only object would erase the
 *    user's routing/models/customModels config.
 *  - non-providers fields (routing/models/customModels/tracking/onlineLearning)
 *    are preserved verbatim.
 *  - `update` is a **shallow merge** into providers: each named provider in
 *    `update` fully replaces that provider's config (baseUrl/upstreamUrl);
 *    providers not in `update` are kept untouched. Deletion is intentionally
 *    NOT supported here (POST is add/update semantics; a future DELETE endpoint
 *    or null-value convention would handle removal).
 */
export function buildProvidersConfigJson(
  existingRaw: string | null,
  update: Record<string, ProviderConfig>,
): BuildConfigResult {
  let partial: Record<string, unknown> = {};
  if (existingRaw !== null) {
    try {
      partial = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      // 与 buildLockedConfigJson 一致：拒写不可读的 config，避免擦除非
      // providers 字段。由 GUI 提示用户修复 config。
      return { ok: false, error: "config_corrupt" };
    }
  }
  const existing = (partial.providers ?? {}) as Record<string, unknown>;
  partial.providers = { ...existing, ...update };
  return { ok: true, content: JSON.stringify(partial, null, 2) };
}
