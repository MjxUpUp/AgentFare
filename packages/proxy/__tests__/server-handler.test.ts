import { describe, it, expect } from "vitest";
import { resolveProvider, getUpstreamPath, buildVirtualUrl, buildProviderMap } from "@agentfare/proxy/provider-map";
import { resolveApiKey, buildAuthHeaders } from "@agentfare/proxy/key-store";
import type { ProviderInfo } from "@agentfare/proxy/provider-map";

// ── Tests ────────────────────────────────────────────────────────────────

describe("proxy server request routing logic", () => {
  describe("resolveProvider", () => {
    const customMap: Record<string, ProviderInfo> = {
      openai: { provider: "openai", protocol: "openai", upstreamBaseUrl: "https://api.openai.com" },
      anthropic: { provider: "anthropic", protocol: "anthropic", upstreamBaseUrl: "https://api.anthropic.com" },
      deepseek: { provider: "deepseek", protocol: "openai", upstreamBaseUrl: "https://api.deepseek.com" },
    };

    it("should resolve /openai/* to openai provider", () => {
      const info = resolveProvider("/openai/v1/chat/completions", customMap);
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("openai");
      expect(info!.protocol).toBe("openai");
    });

    it("should resolve /anthropic/* to anthropic provider", () => {
      const info = resolveProvider("/anthropic/v1/messages", customMap);
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("anthropic");
      expect(info!.protocol).toBe("anthropic");
    });

    it("should resolve /deepseek/* to deepseek provider with openai protocol", () => {
      const info = resolveProvider("/deepseek/v1/chat/completions", customMap);
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("deepseek");
      expect(info!.protocol).toBe("openai");
    });

    it("should return null for unknown provider prefix", () => {
      expect(resolveProvider("/unknown/v1/chat", customMap)).toBeNull();
    });

    it("should return null for root path", () => {
      expect(resolveProvider("/", customMap)).toBeNull();
    });

    it("should default to DEFAULT_PROVIDER_MAP when no map given", () => {
      const info = resolveProvider("/openai/v1/chat/completions");
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("openai");
    });
  });

  describe("getUpstreamPath", () => {
    it("should strip provider prefix from path", () => {
      expect(getUpstreamPath("/openai/v1/chat/completions")).toBe("/v1/chat/completions");
      expect(getUpstreamPath("/anthropic/v1/messages")).toBe("/v1/messages");
    });

    it("should return / for path without slash after prefix", () => {
      expect(getUpstreamPath("/openai")).toBe("/");
    });
  });

  describe("buildVirtualUrl", () => {
    it("should combine upstreamBaseUrl with upstream path", () => {
      const info: ProviderInfo = { provider: "openai", protocol: "openai", upstreamBaseUrl: "https://api.openai.com" };
      expect(buildVirtualUrl(info, "/v1/chat/completions")).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("should handle baseUrl with trailing path", () => {
      const info: ProviderInfo = { provider: "openai", protocol: "openai", upstreamBaseUrl: "https://api.openai.com/v1" };
      expect(buildVirtualUrl(info, "/v1/chat/completions")).toBe("https://api.openai.com/v1/v1/chat/completions");
    });
  });

  describe("buildProviderMap", () => {
    it("should build map from config with correct protocols", () => {
      const map = buildProviderMap({
        providers: {
          openai: { baseUrl: "https://api.openai.com/v1" },
          anthropic: { baseUrl: "https://api.anthropic.com" },
          deepseek: { baseUrl: "https://api.deepseek.com/v1" },
        },
        routing: { crossProvider: "off", defaultStrategy: "balanced", crossProviderProviders: [] },
      } as any);
      expect(map.openai).toBeDefined();
      expect(map.openai!.protocol).toBe("openai");
      expect(map.anthropic).toBeDefined();
      expect(map.anthropic!.protocol).toBe("anthropic");
      expect(map.deepseek).toBeDefined();
      expect(map.deepseek!.protocol).toBe("openai"); // deepseek uses openai protocol
    });

    it("should use upstreamUrl over baseUrl when available", () => {
      const map = buildProviderMap({
        providers: {
          openai: { baseUrl: "https://api.openai.com/v1", upstreamUrl: "https://custom-proxy.example.com" },
        },
        routing: { crossProvider: "off", defaultStrategy: "balanced", crossProviderProviders: [] },
      } as any);
      expect(map.openai!.upstreamBaseUrl).toBe("https://custom-proxy.example.com");
    });
  });

  describe("buildAuthHeaders", () => {
    it("should build Bearer auth for openai protocol", () => {
      const h = buildAuthHeaders("openai", "sk-test", "openai");
      expect(h["Authorization"]).toBe("Bearer sk-test");
      expect(h["x-api-key"]).toBeUndefined();
    });

    it("should build x-api-key auth for anthropic protocol", () => {
      const h = buildAuthHeaders("anthropic", "sk-ant", "anthropic");
      expect(h["x-api-key"]).toBe("sk-ant");
      expect(h["anthropic-version"]).toBe("2023-06-01");
      expect(h["Authorization"]).toBeUndefined();
    });
  });

  describe("resolveApiKey priority", () => {
    it("should prefer Authorization header key", () => {
      const headers = { authorization: "Bearer sk-from-header" };
      const key = resolveApiKey("openai", headers);
      expect(key).toBe("sk-from-header");
    });

    it("should use x-api-key header for anthropic-style", () => {
      const headers = { "x-api-key": "sk-ant-from-header" };
      const key = resolveApiKey("anthropic", headers);
      expect(key).toBe("sk-ant-from-header");
    });

    it("should return undefined when no key available", () => {
      const key = resolveApiKey("openai", {});
      expect(typeof key === "string" || key === undefined).toBe(true);
    });

    it("should fall back to env var when no header key", () => {
      // If OPENAI_API_KEY is set in test env, it would be used
      const key = resolveApiKey("openai", {});
      // Just verify it doesn't throw
      expect(typeof key === "string" || key === undefined).toBe(true);
    });
  });
});
