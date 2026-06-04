/**
 * HTTP proxy server for AgentFare.
 *
 * Accepts LLM API requests from any tool via *_BASE_URL environment variables,
 * runs routing analysis, optionally converts protocol, forwards to the real
 * provider, and streams the response back while extracting token usage for
 * cost tracking.
 */

import * as nodeHttps from "node:https";
import * as nodeHttp from "node:http";
import { URL } from "node:url";
import { resolveProvider, getUpstreamPath, buildVirtualUrl, type ProviderInfo } from "./provider-map.js";
import { resolveApiKey, buildAuthHeaders } from "./key-store.js";
import { SSEPipe, type StreamTokenData } from "./sse-pipe.js";
import type { RequestHandler, HandleResult } from "@agentfare/hook/request-handler";
import type { CostTracker, QualitySignalCollector } from "@agentfare/core";
import type { ModelRegistry, ModelEntry } from "@agentfare/models";
import {
  ANALYZER_TIMEOUT_MS,
  PASS_THROUGH_ANALYSIS,
  lookupModelEntry,
  createPassThroughModelEntry,
  detectProtocol,
  createSSEConverterForDirection,
  convertRequestBody,
  sanitizeDecisionForCallback,
  asyncLogError,
  generatePassThroughId,
} from "@agentfare/hook/pipeline";
import type { SSEProtocolConverter } from "@agentfare/hook/response-handler";

export interface ProxyServerDeps {
  handler: RequestHandler;
  costTracker?: CostTracker;
  qualitySignalCollector?: QualitySignalCollector;
  onlineLearner?: any;
  registry?: ModelRegistry;
  /** Dynamic provider map (built from config). Falls back to DEFAULT if not provided. */
  providerMap?: Record<string, ProviderInfo>;
}

export interface ProxyServerOptions {
  port: number;
  deps: ProxyServerDeps;
  /** Called when a routing decision is made (for logging/telemetry) */
  onRouting?: (result: HandleResult) => void;
  /** Called on unhandled errors */
  onError?: (err: unknown) => void;
  /**
   * Override upstream URL resolution for testing.
   * Receives the computed target URL, returns the actual URL to forward to.
   * If not provided, uses the target URL as-is.
   */
  resolveUpstream?: (targetUrl: string) => string;
}

const UPSTREAM_TIMEOUT_MS = 120_000;

/**
 * Create and return the proxy HTTP server (not yet listening).
 */
export function createProxyServer(options: ProxyServerOptions): nodeHttp.Server {
  const { deps, onRouting, onError } = options;

  const server = nodeHttp.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, options);
    } catch (err) {
      asyncLogError(err, "proxy");
      onError?.(err);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "proxy_error", message: String(err) }));
      }
    }
  });

  server.timeout = UPSTREAM_TIMEOUT_MS;
  server.keepAliveTimeout = 60_000;

  return server;
}

/**
 * Core request handler for every incoming request.
 */
async function handleRequest(
  req: nodeHttp.IncomingMessage,
  res: nodeHttp.ServerResponse,
  options: ProxyServerOptions,
): Promise<void> {
  const requestPath = req.url ?? "/";

  // Health check
  if (requestPath === "/health" || requestPath === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "agentfare-proxy" }));
    return;
  }

  // Resolve provider from path prefix
  const providerInfo = resolveProvider(requestPath, options.deps.providerMap);
  if (!providerInfo) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unknown_provider", path: requestPath }));
    return;
  }

  // Only handle POST requests (LLM API calls)
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  // Read request body
  const bodyStr = await readBody(req);
  if (!bodyStr) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "empty_body" }));
    return;
  }

  // Extract headers
  const headers = extractNodeHeaders(req);

  // Build virtual URL (what the client thinks it's calling)
  const upstreamPath = getUpstreamPath(requestPath);
  const virtualUrl = buildVirtualUrl(providerInfo, upstreamPath);

  // Determine if streaming
  let body: any;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }
  const isStreaming = body.stream === true;
  const originalModel = body.model ?? "";

  // --- Quality signal: detect manual model switch ---
  if (options.deps.qualitySignalCollector && originalModel) {
    const sessionId = headers["x-request-id"] ?? headers["x-session-id"] ?? "default";
    if (options.deps.qualitySignalCollector.detectManualSwitch(sessionId, originalModel)) {
      options.deps.qualitySignalCollector.recordSignal(originalModel, "unknown", "manual_switch", sessionId);
    }
  }

  // --- Run routing analysis ---
  const result = await Promise.race([
    options.deps.handler.handle(virtualUrl, bodyStr, headers),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ANALYZER_TIMEOUT_MS)),
  ]) as HandleResult | null;

  // Determine target URL, body, headers, and whether protocol conversion is needed
  let targetUrl: string;
  let targetBodyStr: string;
  let targetHeaders: Record<string, string>;
  let sourceProtocol: "openai" | "anthropic" = providerInfo.protocol;
  let targetProtocol: "openai" | "anthropic" = providerInfo.protocol;
  let needsProtocolConversion = false;
  let targetProvider = providerInfo.provider;

  if (result && result.decision.targetModel) {
    const targetModel = result.decision.targetModel;
    const targetApi = targetModel.api;

    if (result.decision.providerSwitched) {
      // Cross-provider routing
      const effectiveBaseUrl = result.decision.enterpriseConfig?.baseUrl ?? targetApi.baseUrl;
      targetUrl = targetApi.protocol === "anthropic"
        ? `${effectiveBaseUrl}/v1/messages`
        : `${effectiveBaseUrl}/chat/completions`;
      targetProtocol = targetApi.protocol;
      needsProtocolConversion = sourceProtocol !== targetProtocol;
      targetProvider = targetModel.provider;

      // Resolve API key for target provider
      const apiKey = result.decision.apiKey ?? resolveApiKey(targetModel.provider, headers);
      if (apiKey) {
        targetHeaders = { ...headers, ...buildAuthHeaders(targetModel.provider, apiKey, targetApi.protocol) };
        // Remove conflicting auth headers
        if (targetApi.protocol === "anthropic") {
          delete targetHeaders["Authorization"];
        } else {
          delete targetHeaders["x-api-key"];
        }
      } else {
        targetHeaders = { ...headers };
      }

      // Convert request body if protocol changes (using shared pipeline)
      if (needsProtocolConversion) {
        targetBodyStr = convertRequestBody(sourceProtocol, targetProtocol, result.modifiedBody, targetApi.modelId);
      } else {
        targetBodyStr = result.modifiedBody;
      }
    } else {
      // Same-provider routing: just change the model in the body
      targetUrl = virtualUrl;
      targetBodyStr = result.modifiedBody;
      targetHeaders = { ...headers };
    }
  } else {
    // No routing change — pass through to original provider
    targetUrl = virtualUrl;
    targetBodyStr = bodyStr;
    targetHeaders = { ...headers };

    // Resolve API key for original provider if not in headers
    if (!resolveApiKey(providerInfo.provider, targetHeaders)) {
      const key = resolveApiKey(providerInfo.provider, headers);
      if (key) {
        targetHeaders = { ...targetHeaders, ...buildAuthHeaders(providerInfo.provider, key, providerInfo.protocol) };
      }
    }
  }

  // --- Strip proxy-specific internal headers ---
  delete targetHeaders["host"];
  delete targetHeaders["content-length"];

  // --- Forward to upstream ---
  const upstreamRes = await forwardRequest(targetUrl, targetBodyStr, targetHeaders, options.resolveUpstream);

  // --- Handle 5xx fallback ---
  if (upstreamRes.statusCode && upstreamRes.statusCode >= 500 && result?.decision.targetModel) {
    asyncLogError(`目标模型 ${result.decision.targetModel.id} 返回 ${upstreamRes.statusCode}`, "proxy");
    if (options.deps.qualitySignalCollector) {
      options.deps.qualitySignalCollector.recordSignal(
        result.decision.targetModel.id,
        result.analysis.stepType,
        "error",
        result.sessionId,
      );
    }
    // Fallback to original request
    upstreamRes.resume(); // drain
    const fallbackRes = await forwardRequest(virtualUrl, bodyStr, headers, options.resolveUpstream);
    pipeResponse(fallbackRes, res, targetProtocol, isStreaming, originalModel, undefined, options, result, sourceProtocol, targetProtocol);
    return;
  }

  // --- Record quality signals ---
  if (result?.decision.targetModel && options.deps.qualitySignalCollector) {
    options.deps.qualitySignalCollector.recordRoutedModel(
      result.sessionId,
      result.decision.targetModel.id,
      result.decision.targetModel.tier,
    );
    options.deps.qualitySignalCollector.recordRequest(
      result.sessionId,
      result.decision.targetModel.id,
      result.analysis.stepType,
    );
  }

  // --- Fire onRouting callback (strip sensitive fields) ---
  if (result?.decision) {
    const safeDecision = sanitizeDecisionForCallback(result.decision);
    options.onRouting?.({ ...result, decision: safeDecision } as HandleResult);
  }

  // --- Determine SSE converter for cross-provider streaming ---
  const sseConverter = (needsProtocolConversion && result?.decision.targetModel)
    ? createSSEConverterForDirection(sourceProtocol, targetProtocol, originalModel)
    : undefined;

  // --- Pipe response back to client ---
  pipeResponse(
    upstreamRes, res,
    targetProtocol, isStreaming,
    originalModel,
    sseConverter,
    options,
    result,
    sourceProtocol,
    targetProtocol,
  );
}

/**
 * Pipe the upstream response to the client response,
 * optionally running through SSEPipe for token extraction.
 */
function pipeResponse(
  upstreamRes: nodeHttp.IncomingMessage,
  res: nodeHttp.ServerResponse,
  upstreamProtocol: "openai" | "anthropic",
  isStreaming: boolean,
  originalModel: string,
  sseConverter: SSEProtocolConverter | undefined,
  options: ProxyServerOptions,
  result: HandleResult | null,
  sourceProtocol?: "openai" | "anthropic",
  targetProtocol?: "openai" | "anthropic",
): void {
  // Resolve original model pricing entry for accurate cost tracking
  const originalModelEntry = options.deps.registry
    ? lookupModelEntry(options.deps.registry, originalModel)
    : undefined;

  // Forward status code and headers
  const statusCode = upstreamRes.statusCode ?? 200;
  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(upstreamRes.headers)) {
    if (typeof value === "string") {
      responseHeaders[key] = value;
    } else if (Array.isArray(value)) {
      responseHeaders[key] = value.join(", ");
    }
  }
  res.writeHead(statusCode, responseHeaders);

  if (isStreaming) {
    // Use SSEPipe to extract tokens (and optionally convert protocol)
    const pipe = new SSEPipe(
      upstreamProtocol,
      (tokens: StreamTokenData) => {
        if (options.deps.costTracker && (tokens.input > 0 || tokens.output > 0)) {
          if (result) {
            options.deps.costTracker.record(
              result.analysis,
              originalModel,
              originalModelEntry,
              result.decision.targetModel!,
              result.sessionId,
              "unknown",
              tokens,
            );
          } else {
            // Pass-through: record cost for observability (no reroute)
            recordPassThroughCost(options, originalModel, tokens);
          }
        }
        if (result && options.deps.qualitySignalCollector) {
          options.deps.qualitySignalCollector.recordSignal(
            result.decision.targetModel!.id,
            result.analysis.stepType,
            "success",
            result.sessionId,
          );
        }
      },
      sseConverter,
    );
    upstreamRes.pipe(pipe).pipe(res);
  } else {
    // Non-streaming: buffer the response, optionally convert, then send
    const chunks: Buffer[] = [];
    upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
    upstreamRes.on("end", () => {
      let fullBody = Buffer.concat(chunks).toString("utf-8");

      // Extract tokens from non-streaming response
      try {
        const respJson = JSON.parse(fullBody);
        const tokens = upstreamProtocol === "openai"
          ? { input: respJson.usage?.prompt_tokens ?? 0, output: respJson.usage?.completion_tokens ?? 0 }
          : { input: respJson.usage?.input_tokens ?? 0, output: respJson.usage?.output_tokens ?? 0 };
        if (tokens.input > 0 || tokens.output > 0) {
          if (result) {
            options.deps.costTracker?.record(
              result.analysis,
              originalModel,
              originalModelEntry,
              result.decision.targetModel!,
              result.sessionId,
              "unknown",
              tokens,
            );
          } else {
            // Pass-through: record cost for observability (no reroute)
            recordPassThroughCost(options, originalModel, tokens);
          }
        }
      } catch (costErr) {
        process.stderr.write(`[agentfare] cost tracking error: ${costErr instanceof Error ? costErr.message : costErr}\n`);
      }

      // Non-streaming protocol conversion (ISSUE-082: previously unimplemented)
      if (sseConverter && sourceProtocol && targetProtocol && sourceProtocol !== targetProtocol) {
        try {
          const respJson = JSON.parse(fullBody);
          let converted: any;
          // Response comes FROM upstream (targetProtocol), needs converting TO client (sourceProtocol)
          if (sourceProtocol === "anthropic" && targetProtocol === "openai") {
            const { convertOpenAIToAnthropicResponse } = require("@agentfare/hook/protocol/openai-to-anthropic-response") as typeof import("@agentfare/hook/protocol/openai-to-anthropic-response");
            converted = convertOpenAIToAnthropicResponse(respJson, originalModel);
          } else if (sourceProtocol === "openai" && targetProtocol === "anthropic") {
            const { convertAnthropicToOpenAIResponse } = require("@agentfare/hook/protocol/anthropic-to-openai") as typeof import("@agentfare/hook/protocol/anthropic-to-openai");
            converted = convertAnthropicToOpenAIResponse(respJson, originalModel);
          }
          if (converted) {
            fullBody = JSON.stringify(converted);
          }
        } catch (conversionErr) {
          asyncLogError(`非流式协议转换失败: ${conversionErr}`, "proxy");
        }
      }

      res.end(fullBody);
    });
  }
}

/**
 * Forward a request to the upstream provider.
 */
function forwardRequest(
  targetUrl: string,
  body: string,
  headers: Record<string, string>,
  resolveUpstream?: (url: string) => string,
): Promise<nodeHttp.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const effectiveUrl = resolveUpstream ? resolveUpstream(targetUrl) : targetUrl;
    const parsed = new URL(effectiveUrl);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? nodeHttps : nodeHttp;

    const options: nodeHttp.RequestOptions = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port, 10) || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body).toString(),
      },
    };

    const upstreamReq = lib.request(options, (upstreamRes) => {
      resolve(upstreamRes);
    });

    upstreamReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      upstreamReq.destroy(new Error("upstream timeout"));
    });

    upstreamReq.on("error", reject);
    upstreamReq.write(body);
    upstreamReq.end();
  });
}

/**
 * Read the entire request body from an IncomingMessage.
 */
function readBody(req: nodeHttp.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Extract headers from an IncomingMessage into a plain object.
 */
function extractNodeHeaders(req: nodeHttp.IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.join(", ");
    }
  }
  return result;
}

/**
 * Record cost for pass-through requests (no model reroute).
 * Uses the registry to look up real pricing for accurate cost tracking.
 */
function recordPassThroughCost(
  options: ProxyServerOptions,
  originalModel: string,
  tokens: { input: number; output: number },
): void {
  if (!options.deps.costTracker) return;

  const registry = options.deps.registry;
  const modelEntry = registry ? lookupModelEntry(registry, originalModel) : undefined;
  const targetEntry = modelEntry ?? createPassThroughModelEntry(originalModel);

  if (!modelEntry) {
    console.warn(`[agentfare] pass-through cost tracking: model "${originalModel}" not in registry, pricing unavailable`);
  }

  options.deps.costTracker.record(
    PASS_THROUGH_ANALYSIS,
    originalModel,
    modelEntry,
    targetEntry,
    generatePassThroughId(),
    "unknown",
    tokens,
  );
}
