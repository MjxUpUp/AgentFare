/**
 * Unified path constants for AgentFare.
 * ISSUE-052: Single source of truth for all data/config directory paths.
 */

import * as path from "node:path";
import * as os from "node:os";

/** Base directory for all AgentFare data. */
export function getBaseDir(): string {
  const override = process.env.AGENTFARE_HOME;
  return override ?? path.join(os.homedir(), ".agentfare");
}

/** Path to the SQLite tracking database. */
export function getDbPath(): string {
  return path.join(getBaseDir(), "data.db");
}

/** Path to the global config file. */
export function getConfigPath(): string {
  return path.join(getBaseDir(), "config.json");
}

/** Path to the route cache directory. */
export function getCacheDir(): string {
  return path.join(getBaseDir(), "cache");
}

/** Path to the remote model cache file. */
export function getRemoteModelCachePath(): string {
  return path.join(getCacheDir(), "remote-models.json");
}

/** Path to the loader script. */
export function getLoaderPath(): string {
  return path.join(getBaseDir(), "loader.js");
}

/** Path to the error log. */
export function getErrorLogPath(): string {
  return path.join(getBaseDir(), "errors.log");
}
