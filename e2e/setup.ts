import { ModelRegistry } from "@agentdispatch/models";
import { DEFAULT_CONFIG } from "@agentdispatch/core";
import type { AgentDispatchConfig } from "@agentdispatch/core";

export function createTestEnv(configOverrides: Partial<AgentDispatchConfig> = {}) {
  const config: AgentDispatchConfig = {
    ...DEFAULT_CONFIG,
    ...configOverrides,
    routing: { ...DEFAULT_CONFIG.routing, ...configOverrides.routing },
  };
  const registry = new ModelRegistry();
  return { config, registry };
}
