import type { AgentDispatchConfig, EnterpriseConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { applyEnterprisePolicy } from "./enterprise.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

interface ConfigSources {
  enterprise?: EnterpriseConfig;
  global?: Partial<AgentDispatchConfig>;
  project?: Partial<AgentDispatchConfig>;
}

export function mergeConfig(sources: ConfigSources = {}): AgentDispatchConfig {
  let config: AgentDispatchConfig = structuredClone(DEFAULT_CONFIG);

  if (sources.global) {
    config = deepMerge(config, sources.global);
  }

  if (sources.project) {
    config = deepMerge(config, sources.project);
  }

  if (sources.enterprise) {
    const result = applyEnterprisePolicy(config, sources.enterprise);
    config = result.config;
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.warn(`[AgentDispatch] ${w}`);
      }
    }
  }

  return config;
}

export function loadConfigFromDisk(projectDir?: string): AgentDispatchConfig {
  const sources: ConfigSources = {};

  const enterprisePaths = [
    "/etc/agentdispatch/enterprise.json",
    path.join(os.homedir(), ".agentdispatch", "enterprise.json"),
  ];
  for (const p of enterprisePaths) {
    if (fs.existsSync(p)) {
      sources.enterprise = JSON.parse(fs.readFileSync(p, "utf-8"));
      break;
    }
  }

  const globalPath = path.join(os.homedir(), ".agentdispatch", "config.json");
  if (fs.existsSync(globalPath)) {
    sources.global = JSON.parse(fs.readFileSync(globalPath, "utf-8"));
  }

  const projDir = projectDir ?? process.cwd();
  const projectPath = path.join(projDir, "agentdispatch.config.json");
  if (fs.existsSync(projectPath)) {
    sources.project = JSON.parse(fs.readFileSync(projectPath, "utf-8"));
  }

  return mergeConfig(sources);
}

function deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
  const result = structuredClone(base);

  for (const key of Object.keys(override) as Array<keyof T>) {
    const baseVal = base[key];
    const overVal = override[key];

    if (key === "models" && typeof baseVal === "object" && typeof overVal === "object") {
      result[key] = mergeModels(baseVal as any, overVal as any) as any;
    } else if (key === "customModels" && Array.isArray(overVal)) {
      result[key] = [...(Array.isArray(baseVal) ? baseVal : []), ...overVal] as any;
    } else if (key === "providers" && typeof baseVal === "object" && typeof overVal === "object") {
      result[key] = { ...baseVal, ...overVal } as any;
    } else if (
      typeof baseVal === "object" && baseVal !== null && !Array.isArray(baseVal) &&
      typeof overVal === "object" && overVal !== null && !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(baseVal as any, overVal as any);
    } else {
      result[key] = overVal as any;
    }
  }
  return result;
}

function mergeModels(
  base: Record<string, string[]>,
  override: Record<string, string[]>
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);
  for (const key of allKeys) {
    const baseArr = base[key] ?? [];
    const overArr = override[key] ?? [];
    result[key] = [...new Set([...baseArr, ...overArr])];
  }
  return result;
}
