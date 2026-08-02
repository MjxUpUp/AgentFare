import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

// defaults.ts 加了 cc-switch 的 routing 锁定字段。锁定默认必须 off（auto），
// 否则升级后所有用户会被静默锁死在某个模型上。router.test.ts 已覆盖"auto 默认
// 走自动路由"的行为；这里钉死默认值本身，防有人把默认改成 "model" 而行为测试
// 恰好也跟着变（默认值与行为解耦的护栏）。

describe("DEFAULT_CONFIG.routing — cc-switch lock fields", () => {
  it("lockMode defaults to 'auto' (no lock → automatic tier routing)", () => {
    expect(DEFAULT_CONFIG.routing.lockMode).toBe("auto");
  });

  it("activeModel / activeProvider are unset by default (no residual lock target)", () => {
    expect(DEFAULT_CONFIG.routing.activeModel).toBeUndefined();
    expect(DEFAULT_CONFIG.routing.activeProvider).toBeUndefined();
  });
});
