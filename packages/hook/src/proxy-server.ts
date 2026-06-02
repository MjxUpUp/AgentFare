/**
 * @deprecated Use @agentfare/proxy instead.
 *
 * The proxy server implementation has moved to the @agentfare/proxy package.
 * This stub is kept for backward compatibility — importing it will log a warning.
 */

import * as http from "node:http";

export interface ProxyServerOptions {
  port: number;
  targetUpstream?: string;
}

export function startProxyServer(options: ProxyServerOptions): http.Server {
  console.warn("[AgentFare] WARNING: startProxyServer has moved to @agentfare/proxy. This stub will be removed in a future version.");

  const server = http.createServer((_req, res) => {
    res.writeHead(501, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "deprecated",
      message: "Proxy server has moved to @agentfare/proxy. Install and use that package instead.",
    }));
  });

  server.listen(options.port, () => {
    console.log(`[AgentFare] Proxy stub on port ${options.port} (deprecated)`);
  });

  return server;
}
