/**
 * @agentfare/proxy — Local HTTP proxy server for universal LLM routing.
 *
 * Provides a standalone HTTP proxy that any AI coding tool can point to
 * via its *_BASE_URL environment variable. The proxy analyzes requests,
 * routes to optimal models, converts protocols when crossing providers,
 * and tracks costs.
 */

export { createProxyServer, type ProxyServerOptions, type ProxyServerDeps } from "./server.js";
export {
  startProxy,
  startProxyDaemon,
  waitForProxy,
  stopProxy,
  getProxyStatus,
  isProxyRunning,
  isProxyVersionCurrent,
  readProxyState,
  getProxyStatePath,
  type ProxyState,
  type StartResult,
} from "./lifecycle.js";
export {
  resolveProvider,
  getUpstreamPath,
  buildVirtualUrl,
  getRegisteredProviders,
  buildProviderMap,
  type ProviderInfo,
} from "./provider-map.js";
export {
  resolveApiKey,
  buildAuthHeaders,
} from "./key-store.js";
export {
  SSEPipe,
  type StreamTokenData,
} from "./sse-pipe.js";
export {
  generateToolGuide,
  generateExportCommands,
  type ToolConfig,
} from "./tool-guide.js";
