import type { AgentFareConfig, EnterpriseConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { applyEnterprisePolicy } from "./enterprise.js";
import { log } from "../utils/logger.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { getBaseDir, getConfigPath } from "@agentfare/models";

interface ConfigSources {
  enterprise?: EnterpriseConfig;
  global?: Partial<AgentFareConfig>;
  project?: Partial<AgentFareConfig>;
}

interface ConfigParseResult<T> {
  data?: T;
  error?: string;
  line?: number;
  column?: number;
}

/**
 * Enhanced JSON parser with detailed error context
 */
function parseJsonWithDetails<T>(json: string, filePath: string): ConfigParseResult<T> {
  try {
    const data = JSON.parse(json) as T;
    return { data };
  } catch (e) {
    if (e instanceof SyntaxError) {
      // Extract line and column from SyntaxError message
      const match = e.message.match(/at position (\d+)/);
      if (match) {
        const position = parseInt(match[1], 10);
        const { line, column } = getLineAndColumn(json, position);
        return {
          error: e.message,
          line,
          column,
        };
      }
    }
    return {
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Get line and column from character position in text
 */
function getLineAndColumn(text: string, position: number): { line: number; column: number } {
  const lines = text.substring(0, position).split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

/**
 * Validate configuration structure.
 *
 * `isPartial` governs only required-field *presence*: a partial (global/project
 * override) config may omit sections without error — mergeConfig backfills them
 * from DEFAULT_CONFIG. But when a field IS present, its shape/value is validated
 * in every mode. A malformed override (e.g. `routing.defaultStrategy: 123`)
 * would otherwise be silently deep-merged over the default — deepMerge replaces
 * a mismatched-type override verbatim (it only recurses when both sides are
 * objects) — polluting the final config and failing at an unrelated call site.
 * loadConfigFile catches the thrown error for partial configs and warns instead
 * of aborting, so a bad override is surfaced rather than swallowed.
 */
function validateConfig(config: any, configType: string, isPartial: boolean = false): void {
  const errors: string[] = [];

  if (configType === "AgentFareConfig") {
    if (config.models === undefined || config.models === null) {
      if (!isPartial) errors.push("Missing 'models' section");
    } else if (typeof config.models !== "object") {
      errors.push("Invalid 'models' section: expected an object");
    } else {
      const tiers = ["fast", "standard", "powerful"];
      for (const tier of tiers) {
        if (config.models[tier] !== undefined && !Array.isArray(config.models[tier])) {
          errors.push(`'models.${tier}' must be an array`);
        }
      }
    }

    if (config.routing === undefined || config.routing === null) {
      if (!isPartial) errors.push("Missing 'routing' section");
    } else if (typeof config.routing !== "object") {
      errors.push("Invalid 'routing' section: expected an object");
    } else {
      const validStrategies = ["cost-optimal", "quality-first", "balanced"];
      if (config.routing.defaultStrategy !== undefined && !validStrategies.includes(config.routing.defaultStrategy)) {
        errors.push(`Invalid routing.defaultStrategy: must be one of ${validStrategies.join(", ")}`);
      }
      if (config.routing.analyzerModel !== undefined && typeof config.routing.analyzerModel !== "string") {
        errors.push("'routing.analyzerModel' must be a string");
      }
    }

    if (config.providers === undefined || config.providers === null) {
      if (!isPartial) errors.push("Missing 'providers' section");
    } else if (typeof config.providers !== "object") {
      errors.push("Invalid 'providers' section: expected an object");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  - ${errors.join("\n  - ")}`);
  }
}

/**
 * Load and parse a single configuration file with enhanced error reporting
 */
function loadConfigFile<T>(filePath: string, configType: string, isPartial: boolean = false): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Configuration file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const result = parseJsonWithDetails<T>(content, filePath);

  if (result.error) {
    const location = result.line && result.column
      ? ` (line ${result.line}, column ${result.column})`
      : "";
    throw new Error(
      `Failed to parse ${configType} from ${filePath}${location}\n` +
      `Error: ${result.error}\n` +
      `Context: See line ${result.line || "?"} near the error location`
    );
  }

  if (!result.data) {
    throw new Error(`Failed to load ${configType} from ${filePath}: no data returned`);
  }

  // Validate the configuration structure (skip strict validation for partial configs)
  try {
    validateConfig(result.data, configType, isPartial);
  } catch (e) {
    if (!isPartial) {
      throw new Error(`Configuration validation failed for ${filePath}:\n${e instanceof Error ? e.message : e}`);
    }
    // For partial configs, log warning but don't throw
    log().warn(`Partial config validation warning for ${filePath}: ${e instanceof Error ? e.message : e}`);
  }

  return result.data;
}

export function mergeConfig(sources: ConfigSources = {}): AgentFareConfig {
  let config: AgentFareConfig = structuredClone(DEFAULT_CONFIG);

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
        log().warn(`[AgentFare] ${w}`);
      }
    }
  }

  return config;
}

export function loadConfigFromDisk(projectDir?: string): AgentFareConfig {
  const sources: ConfigSources = {};

  const enterprisePaths = [
    "/etc/agentfare/enterprise.json",
    path.join(getBaseDir(), "enterprise.json"),
  ];
  for (const p of enterprisePaths) {
    if (fs.existsSync(p)) {
      try {
        sources.enterprise = loadConfigFile<EnterpriseConfig>(p, "EnterpriseConfig");
        log().info(`Loaded enterprise config from ${p}`);
        break;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        log().error(`Failed to load enterprise config: ${errorMsg}`);
        throw new Error(`Enterprise configuration error: ${errorMsg}`);
      }
    }
  }

  const globalPath = getConfigPath();
  if (fs.existsSync(globalPath)) {
    try {
      // Global config is partial - only validate fields that are present
      sources.global = loadConfigFile<Partial<AgentFareConfig>>(globalPath, "AgentFareConfig", true);
      log().info(`Loaded global config from ${globalPath}`);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      log().warn(`Failed to load global config (using defaults): ${errorMsg}`);
      // Don't throw for global config - it may be partial or incomplete
    }
  }

  const projDir = projectDir ?? process.cwd();
  const projectPath = path.join(projDir, "agentfare.config.json");
  if (fs.existsSync(projectPath)) {
    try {
      sources.project = loadConfigFile<Partial<AgentFareConfig>>(projectPath, "AgentFareConfig", true);
      log().info(`Loaded project config from ${projectPath}`);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      log().error(`Failed to load project config: ${errorMsg}`);
      throw new Error(`Project configuration error: ${errorMsg}`);
    }
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
