import { describe, it, expect } from "vitest";
import { computeLockRouting, buildLockedConfigJson } from "../src/lock-config.js";
import type { ActiveLock } from "../src/admin.js";

// computeLockRouting 是从 daemon-entry.applyLock 抽出的纯函数：决定"锁定模式
// → routing 子对象"的字面量。daemon-entry 本身是入口（fs/spawn/reload IO），
// 但这块决策逻辑（含"切目标清旧字段"不变式）值得独立测，避免靠 mock spawn
// 的假阳性（daemon.test.ts 历史问题）。

describe("computeLockRouting", () => {
  it("model lock → { lockMode, activeModel }", () => {
    const lock: ActiveLock = { lockMode: "model", activeModel: "deepseek/v4-pro" };
    expect(computeLockRouting(lock)).toEqual({
      lockMode: "model",
      activeModel: "deepseek/v4-pro",
    });
  });

  it("provider lock → { lockMode, activeProvider }", () => {
    const lock: ActiveLock = { lockMode: "provider", activeProvider: "anthropic" };
    expect(computeLockRouting(lock)).toEqual({
      lockMode: "provider",
      activeProvider: "anthropic",
    });
  });

  it("auto unlock → { lockMode: 'auto' } with NO active* keys (clears residual)", () => {
    // 关键不变式：解锁时结果不含 activeModel/activeProvider。调用方用返回值
    // 覆盖这两键，undefined 落盘丢弃 → admin GET /api/active 不会误显示旧锁定。
    const lock: ActiveLock = { lockMode: "auto" };
    const r = computeLockRouting(lock);
    expect(r).toEqual({ lockMode: "auto" });
    expect(r).not.toHaveProperty("activeModel");
    expect(r).not.toHaveProperty("activeProvider");
  });

  it("model lock without activeModel → { lockMode: 'model' } (no activeModel)", () => {
    // 缺 activeModel 时不设该键（admin.ts 的 POST 校验已挡，这里防御性不残留）
    const lock: ActiveLock = { lockMode: "model" };
    const r = computeLockRouting(lock);
    expect(r).toEqual({ lockMode: "model" });
    expect(r).not.toHaveProperty("activeModel");
  });

  it("provider lock without activeProvider → { lockMode: 'provider' } (no activeProvider)", () => {
    const lock: ActiveLock = { lockMode: "provider" };
    const r = computeLockRouting(lock);
    expect(r).toEqual({ lockMode: "provider" });
    expect(r).not.toHaveProperty("activeProvider");
  });

  it("switching target type drops the other active* key", () => {
    // 从 model 锁切到 provider 锁：结果只含 activeProvider，不含 activeModel。
    // 调用方合并时 activeModel 键为 undefined 被覆盖清除。
    const lock: ActiveLock = { lockMode: "provider", activeProvider: "openai" };
    const r = computeLockRouting(lock);
    expect(r).toEqual({ lockMode: "provider", activeProvider: "openai" });
    expect(r).not.toHaveProperty("activeModel");
  });
});

describe("buildLockedConfigJson", () => {
  it("refuses to overwrite a corrupt config (H2: ok:false, no content)", () => {
    // 旧实现 catch { partial = {} } 会把 providers/customModels 全清后写回，
    // 一次 GUI 切换覆盖整个 config。现在 corrupt → 拒绝写，由 GUI 提示用户修。
    const r = buildLockedConfigJson("{ not valid json", { lockMode: "model", activeModel: "x" });
    expect(r).toEqual({ ok: false, error: "config_corrupt" });
  });

  it("absent config (null) → starts from {} with just the lock", () => {
    const r = buildLockedConfigJson(null, { lockMode: "auto" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.content);
    expect(parsed.routing).toEqual({ lockMode: "auto" });
    expect(parsed.routing).not.toHaveProperty("activeModel");
  });

  it("preserves non-routing fields + other routing fields when applying a model lock", () => {
    const existing = JSON.stringify({
      providers: { openai: { apiKey: "sk-x" } },
      customModels: [{ id: "foo" }],
      routing: { crossProvider: "off", defaultStrategy: "balanced", lockMode: "auto" },
    });
    const r = buildLockedConfigJson(existing, { lockMode: "model", activeModel: "deepseek/v4-pro" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.content);
    // 非 routing 字段原样保留（H2 的反面：正常路径不丢字段）
    expect(parsed.providers).toEqual({ openai: { apiKey: "sk-x" } });
    expect(parsed.customModels).toEqual([{ id: "foo" }]);
    // routing: lockMode/activeModel 更新，crossProvider/defaultStrategy 保留
    expect(parsed.routing).toEqual({
      crossProvider: "off",
      defaultStrategy: "balanced",
      lockMode: "model",
      activeModel: "deepseek/v4-pro",
    });
  });

  it("switching model→provider clears the stale activeModel", () => {
    const existing = JSON.stringify({ routing: { lockMode: "model", activeModel: "deepseek/v4-pro" } });
    const r = buildLockedConfigJson(existing, { lockMode: "provider", activeProvider: "anthropic" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.content);
    expect(parsed.routing.lockMode).toBe("provider");
    expect(parsed.routing.activeProvider).toBe("anthropic");
    expect(parsed.routing).not.toHaveProperty("activeModel");
  });

  it("unlocking (auto) clears both active* keys", () => {
    const existing = JSON.stringify({ routing: { lockMode: "model", activeModel: "x", activeProvider: "y" } });
    const r = buildLockedConfigJson(existing, { lockMode: "auto" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.content);
    expect(parsed.routing.lockMode).toBe("auto");
    expect(parsed.routing).not.toHaveProperty("activeModel");
    expect(parsed.routing).not.toHaveProperty("activeProvider");
  });
});
