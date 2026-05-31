import { isLLMApiCall } from "./url-detector.js";
import { isInternalRequest } from "./reentry-guard.js";
import type { RequestHandler, HandleResult } from "./request-handler.js";
import { createStreamingResponseWrapper } from "./response-handler.js";
import type { CostTracker, QualitySignalCollector } from "@agentdispatch/core";

const ORIGINAL_FETCH_SYMBOL = Symbol("agentdispatch:originalFetch");
const ANALYZER_TIMEOUT_MS = 500;

export interface FetchPatchOptions {
  handler: RequestHandler;
  costTracker?: CostTracker;
  qualitySignalCollector?: QualitySignalCollector;
  onlineLearner?: any;
  onRouting?: (result: HandleResult) => void;
  onError?: (err: unknown) => void;
}

function logErrorToFile(err: unknown): void {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const os = require("node:os") as typeof import("node:os");
    const logPath = path.join(os.homedir(), ".agentdispatch", "errors.log");
    const timestamp = new Date().toISOString();
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch {}
}

export function installFetchPatch(options: FetchPatchOptions): () => void {
  const originalFetch = globalThis.fetch;
  (globalThis as any)[ORIGINAL_FETCH_SYMBOL] = originalFetch;

  const qualityCollector = options.qualitySignalCollector;
  const onlineLearner = options.onlineLearner;

  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (!isLLMApiCall(url)) {
      return originalFetch.call(this, input, init);
    }

    if (isInternalRequest(init)) {
      return originalFetch.call(this, input, init);
    }

    try {
      const bodyStr = init?.body as string | undefined;
      if (!bodyStr) return originalFetch.call(this, input, init);

      const headers = extractHeaders(init?.headers);
      const body = JSON.parse(bodyStr);
      const currentModel = body.model;

      if (qualityCollector && currentModel) {
        const sessionId = headers["x-request-id"] ?? headers["x-session-id"] ?? "default";
        if (qualityCollector.detectManualSwitch(sessionId, currentModel)) {
          qualityCollector.recordSignal(currentModel, "unknown", "manual_switch");
        }
      }

      const result = await Promise.race([
        options.handler.handle(url, bodyStr, headers),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ANALYZER_TIMEOUT_MS)),
      ]);

      if (!result || !result.decision.targetModel) {
        return originalFetch.call(this, input, init);
      }

      const targetModel = result.decision.targetModel;

      const modifiedInit: RequestInit = {
        ...init,
        body: result.modifiedBody,
      };

      // Cross-provider: rewrite URL, headers
      if (result.decision.providerSwitched) {
        const targetApi = targetModel.api;
        const effectiveBaseUrl = result.decision.enterpriseConfig?.baseUrl ?? targetApi.baseUrl;

        // Note: Protocol conversion is done in Task 14 files. For now, just rewrite URL and auth.
        input = targetApi.protocol === "anthropic"
          ? `${effectiveBaseUrl}/v1/messages`
          : `${effectiveBaseUrl}/chat/completions`;

        if (result.decision.apiKey) {
          const authHeaders: Record<string, string> = { ...headers };
          if (targetApi.protocol === "anthropic") {
            delete authHeaders["Authorization"];
            authHeaders["x-api-key"] = result.decision.apiKey;
            authHeaders["anthropic-version"] = "2023-06-01";
          } else {
            authHeaders["Authorization"] = `Bearer ${result.decision.apiKey}`;
          }
          (modifiedInit.headers as any) = authHeaders;
        }
      }

      const response = await originalFetch.call(this, input, modifiedInit);

      // 5xx fallback
      if (response.status >= 500) {
        logErrorToFile(`目标模型 ${targetModel.id} 返回 ${response.status}`);
        if (qualityCollector) {
          qualityCollector.recordSignal(targetModel.id, result.analysis.stepType, "error");
          onlineLearner?.recordSignal(targetModel.id, result.analysis.stepType, "error");
        }
        return originalFetch.call(this, input, init);
      }

      if (qualityCollector) {
        qualityCollector.recordRoutedModel(
          result.sessionId,
          targetModel.id,
          targetModel.tier,
        );
        qualityCollector.recordRequest(
          result.sessionId,
          targetModel.id,
          result.analysis.stepType,
        );
      }

      options.onRouting?.(result);

      // Streaming response wrapper for token tracking
      const protocol = targetModel.api.protocol;
      if (response.body && isStreamingResponse(response)) {
        return createStreamingResponseWrapper(response, protocol, (tokens) => {
          if (options.costTracker) {
            options.costTracker.recordAsync(
              result.analysis,
              body.model ?? "",
              undefined,
              targetModel,
              result.sessionId,
              "unknown",
              tokens,
            ).catch(() => {});
          }
          if (qualityCollector) {
            qualityCollector.recordSignal(targetModel.id, result.analysis.stepType, "success");
            onlineLearner?.recordSignal(targetModel.id, result.analysis.stepType, "success");
          }
          options.onRouting?.({ ...result, tokenUsage: tokens } as any);
        });
      }

      return response;
    } catch (err) {
      logErrorToFile(err);
      options.onError?.(err);
      return originalFetch.call(this, input, init);
    }
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function extractHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((v, k) => { result[k] = v; });
    return result;
  }
  if (Array.isArray(headers)) {
    const result: Record<string, string> = {};
    for (const [k, v] of headers) result[k] = v;
    return result;
  }
  return headers as Record<string, string>;
}

function isStreamingResponse(response: Response): boolean {
  const ct = response.headers.get("content-type") ?? "";
  return ct.includes("text/event-stream");
}

export function getOriginalFetch(): typeof globalThis.fetch {
  return (globalThis as any)[ORIGINAL_FETCH_SYMBOL] ?? globalThis.fetch;
}
