import * as http from "node:http";

export interface ProxyServerOptions {
  port: number;
  targetUpstream?: string;
}

export function startProxyServer(options: ProxyServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    // Simple pass-through proxy
    // In production, this would route through the RequestHandler
    const targetUrl = options.targetUpstream ?? `http://localhost:${options.port}`;

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", message: "AgentDispatch proxy mode - not yet fully implemented" }));
    });
  });

  server.listen(options.port, () => {
    console.log(`[AgentDispatch] Proxy server started on port ${options.port}`);
  });

  return server;
}
