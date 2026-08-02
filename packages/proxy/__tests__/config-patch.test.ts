import { describe, it, expect } from "vitest";
import { buildProvidersConfigJson } from "../src/config-patch.js";
import type { ProviderConfig } from "@agentfare/core";

// buildProvidersConfigJson 是 daemon-entry.applyProviders 的纯函数核心：决定
// "providers update → config.json 内容"。corrupt 拒写 / 保留非 providers 字段
// / shallow merge 不动其他 provider 的不变式值得独立测，避免靠 mock daemon 假阳性。

describe("buildProvidersConfigJson", () => {
  it("refuses to overwrite a corrupt config (ok:false, no content)", () => {
    const r = buildProvidersConfigJson("{ not valid json", { openai: { baseUrl: "x" } });
    expect(r).toEqual({ ok: false, error: "config_corrupt" });
  });

  it("absent config (null) → starts from {} with just the providers update", () => {
    const r = buildProvidersConfigJson(null, { openai: { baseUrl: "https://up.example.com" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.content);
    expect(parsed.providers).toEqual({ openai: { baseUrl: "https://up.example.com" } });
  });

  it("merges update into existing providers, preserving other providers + non-providers fields", () => {
    const existing = JSON.stringify({
      routing: { defaultStrategy: "balanced", crossProvider: "off" },
      models: { fast: ["a"], standard: [], powerful: [] },
      providers: {
        openai: { baseUrl: "https://api.openai.com" },
        deepseek: { baseUrl: "https://api.deepseek.com" },
      },
    });
    const update: Record<string, ProviderConfig> = {
      // 改 openai 指向中转站，保留官方端点为 upstreamUrl
      openai: { baseUrl: "https://relay.example.com", upstreamUrl: "https://api.openai.com" },
    };
    const r = buildProvidersConfigJson(existing, update);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.content);
    // 非 providers 字段原样保留（corrupt 拒写的反面：正常路径不丢字段）
    expect(parsed.routing).toEqual({ defaultStrategy: "balanced", crossProvider: "off" });
    expect(parsed.models).toEqual({ fast: ["a"], standard: [], powerful: [] });
    // openai 被整体覆盖（新 baseUrl + upstreamUrl），deepseek 保留
    expect(parsed.providers.openai).toEqual({
      baseUrl: "https://relay.example.com",
      upstreamUrl: "https://api.openai.com",
    });
    expect(parsed.providers.deepseek).toEqual({ baseUrl: "https://api.deepseek.com" });
  });

  it("adding a new provider preserves existing ones (shallow merge)", () => {
    const existing = JSON.stringify({ providers: { openai: { baseUrl: "a" } } });
    const r = buildProvidersConfigJson(existing, { custom: { baseUrl: "https://custom.example.com" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.content);
    expect(parsed.providers.openai).toEqual({ baseUrl: "a" });
    expect(parsed.providers.custom).toEqual({ baseUrl: "https://custom.example.com" });
  });
});
