import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigPath } from "@agentfare/models";
import { saveKeys } from "@agentfare/proxy";

export const configCommand = new Command("config").description(
  "管理配置"
);

configCommand
  .command("set <key> <value>")
  .description("设置配置项")
  .action((key, value) => {
    // providers.<name>.apiKey → keys.json (credential SSOT, read by key-store).
    // Writing it to config.json was a no-op: key-store only reads keys.json.
    const apiKeyMatch = key.match(/^providers\.([^.]+)\.apiKey$/);
    if (apiKeyMatch) {
      saveKeys({ [apiKeyMatch[1]]: value });
      console.log(`set ${key} (keys.json, hardened)`);
      return;
    }
    const configPath = getConfigPath();
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath))
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    setNestedValue(config, key, value);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`set ${key}`);
  });

configCommand
  .command("get <key>")
  .description("查看配置项")
  .action((key) => {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      console.log("config file not found");
      return;
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const value = key
      .split(".")
      .reduce((o: unknown, k: string) => (o as Record<string, unknown>)?.[k], config);
    console.log(value !== undefined ? JSON.stringify(value) : "not found");
  });

// ISSUE-054: exported for testing — validates and sets a nested config value.
export function setNestedValue(
  obj: Record<string, unknown>,
  key: string,
  value: string
): void {
  const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const SAFE_KEY = /^[a-zA-Z0-9_-]+$/;
  const parts = key.split(".");
  if (parts.some(p => UNSAFE_KEYS.has(p) || !SAFE_KEY.test(p))) {
    throw new Error(`Invalid config key: ${key} (each segment must match ${SAFE_KEY.source})`);
  }
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  try {
    current[parts[parts.length - 1]] = JSON.parse(value);
  } catch {
    current[parts[parts.length - 1]] = value;
  }
}
