/**
 * Configurable logger for AgentFare library packages.
 *
 * Library code (@agentfare/core, @agentfare/hook) MUST NOT call
 * console.log/warn/error directly — that pollutes the host process.
 * Instead, use the shared logger which defaults to silent.
 *
 * CLI and proxy packages can call `setLogger(consoleLogger)` at startup
 * to enable output.
 */

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Silent logger — default for library mode. */
const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

/** Console-backed logger — for CLI/proxy processes that own their stdout. */
export const consoleLogger: Logger = {
  info(message: string) { console.log(message); },
  warn(message: string) { console.warn(message); },
  error(message: string) { console.error(message); },
};

let current: Logger = silentLogger;

/** Replace the active logger. Called once at process startup. */
export function setLogger(logger: Logger): void {
  current = logger;
}

/** Read the active logger. */
export function log(): Logger {
  return current;
}
