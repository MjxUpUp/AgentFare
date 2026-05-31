import { describe, it, expect } from "vitest";
import { applyEnterprisePolicy } from "../../src/config/enterprise.js";
import type { AgentDispatchConfig, EnterpriseConfig } from "../../src/config/types.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

describe("applyEnterprisePolicy", () => {
  it("should lock crossProvider when enterprise sets it", () => {
    const enterprise: EnterpriseConfig = {
      routing: { crossProvider: "off" },
    };
    const userConfig: AgentDispatchConfig = {
      ...DEFAULT_CONFIG,
      routing: { ...DEFAULT_CONFIG.routing, crossProvider: "opt-in" },
    };

    const result = applyEnterprisePolicy(userConfig, enterprise);
    expect(result.config.routing.crossProvider).toBe("off");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("企业策略禁止跨 provider 路由"),
      ])
    );
  });

  it("should ignore user enterpriseProviders when enterprise config exists", () => {
    const enterprise: EnterpriseConfig = {
      routing: {
        enterpriseProviders: { deepseek: { baseUrl: "http://proxy", authMode: "corporate-sso", allowedTiers: ["fast"] } },
      },
    };
    const userConfig: AgentDispatchConfig = {
      ...DEFAULT_CONFIG,
      routing: {
        ...DEFAULT_CONFIG.routing,
        enterpriseProviders: { someother: { baseUrl: "http://evil", authMode: "api-key", allowedTiers: ["powerful"] } },
      },
    };

    const result = applyEnterprisePolicy(userConfig, enterprise);
    expect(Object.keys(result.config.routing.enterpriseProviders)).not.toContain("someother");
  });

  it("should pass through when no enterprise config", () => {
    const result = applyEnterprisePolicy(DEFAULT_CONFIG, undefined);
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.warnings).toEqual([]);
  });
});
