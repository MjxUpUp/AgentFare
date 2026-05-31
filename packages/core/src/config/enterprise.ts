import type { AgentDispatchConfig, EnterpriseConfig } from "./types.js";

export interface EnterprisePolicyResult {
  config: AgentDispatchConfig;
  warnings: string[];
}

export function applyEnterprisePolicy(
  userConfig: AgentDispatchConfig,
  enterpriseConfig?: EnterpriseConfig
): EnterprisePolicyResult {
  const warnings: string[] = [];

  if (!enterpriseConfig?.routing) {
    return { config: userConfig, warnings };
  }

  const config = structuredClone(userConfig);
  const eRouting = enterpriseConfig.routing;

  if (eRouting.crossProvider !== undefined) {
    if (config.routing.crossProvider !== eRouting.crossProvider) {
      warnings.push(
        `企业策略禁止跨 provider 路由，已忽略个人配置中的 crossProvider: "${config.routing.crossProvider}"`
      );
      config.routing.crossProvider = eRouting.crossProvider;
    }
  }

  if (eRouting.enterpriseProviders !== undefined) {
    if (Object.keys(config.routing.enterpriseProviders).length > 0) {
      warnings.push("enterpriseProviders 仅可由企业配置设置，已忽略个人配置");
    }
    config.routing.enterpriseProviders = structuredClone(eRouting.enterpriseProviders);
  }

  return { config, warnings };
}
