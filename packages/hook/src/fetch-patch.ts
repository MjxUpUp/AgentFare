import { LLMDetector } from "./url-detector.js";
import { isInternalRequest, extractHeaders } from "./headers.js";
import type { RequestHandler, HandleResult } from "./request-handler.js";
import { createStreamingResponseWrapper } from "./response-handler.js";
import type { SSEProtocolConverter } from "./response-handler.js";
import type { CostTracker, QualitySignalCollector } from "@agentfare/core";
import { convertOpenAIToAnthropicRequest } from "./protocol/openai-to-anthropic.js";
import { convertAnthropicToOpenAIResponse } from "./protocol/anthropic-to-openai.js";
import { convertAnthropicSSEToOpenAI } from "./protocol/sse-transform.js";
import { convertAnthropicToOpenAIRequest } from "./protocol/anthropic-to-openai-request.js";
import { convertOpenAIToAnthropicResponse } from "./protocol/openai-to-anthropic-response.js";
import { convertOpenAISSEToAnthropic, resetSSEState } from "./protocol/openai-to-anthropic-sse.js";

const ORIGINAL_FETCH_SYMBOL = Symbol("agentfare:originalFetch");
const ANALYZER_TIMEOUT_MS = 500;

export interface FetchPatchOptions {
  handler: RequestHandler;
  detector: LLMDetector;
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
    const logPath = path.join(os.homedir(), ".agentfare", "errors.log");
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

    if (!options.detector.isLLMApiCall(url)) {
      return originalFetch.call(this, input, init);
    }

    if (isInternalRequest(init)) {
      return originalFetch.call(this, input, init);
    }

    try {
      const bodyStr = typeof init?.body === "string" ? init.body : undefined;
      if (!bodyStr) return originalFetch.call(this, input, init);

      const headers = extractHeaders(init?.headers);
      const body = JSON.parse(bodyStr);
      const currentModel = body.model;

      if (qualityCollector && currentModel) {
        const sessionId = headers["x-request-id"] ?? headers["x-session-id"] ?? "default";
        if (qualityCollector.detectManualSwitch(sessionId, currentModel)) {
          qualityCollector.recordSignal(currentModel, "unknown", "manual_switch", sessionId);
        }
      }

      // ISSUE-013: use AbortController to cancel handler on timeout
      const abortCtrl = new AbortController();
      let handlerError: unknown;
      const result = await Promise.race([
        options.handler.handle(url, bodyStr, headers, abortCtrl.signal).catch((err) => {
          handlerError = err;
          return null;
        }),
        new Promise<null>((resolve) => {
          setTimeout(() => { abortCtrl.abort(); resolve(null); }, ANALYZER_TIMEOUT_MS);
        }),
      ]) as HandleResult | null;

      if (handlerError) throw handlerError;

      if (!result || !result.decision.targetModel) {
        return originalFetch.call(this, input, init);
      }

      const targetModel = result.decision.targetModel;

      const modifiedInit: RequestInit = {
        ...init,
        body: result.modifiedBody,
      };

      // Cross-provider: rewrite URL, headers, and convert request body
      let sourceProtocol: "openai" | "anthropic" | null = null;
      let needsProtocolConversion = false;

      if (result.decision.providerSwitched) {
        const targetApi = targetModel.api;
        const effectiveBaseUrl = result.decision.enterpriseConfig?.baseUrl ?? targetApi.baseUrl;

        // Detect source protocol from original URL
        sourceProtocol = url.includes("anthropic.com") ? "anthropic" : "openai";
        const targetProtocol = targetApi.protocol;
        needsProtocolConversion = sourceProtocol !== targetProtocol;

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

        // ISSUE-028: Protocol conversion — convert request body when crossing providers
        if (needsProtocolConversion && sourceProtocol) {
          try {
            const requestBody = JSON.parse(result.modifiedBody);
            let converted: any;
            if (sourceProtocol === "openai" && targetProtocol === "anthropic") {
              converted = convertOpenAIToAnthropicRequest(requestBody, targetApi.modelId);
            } else if (sourceProtocol === "anthropic" && targetProtocol === "openai") {
              converted = convertAnthropicToOpenAIRequest(requestBody, targetApi.modelId);
            }
            if (converted) {
              modifiedInit.body = JSON.stringify(converted);
            }
          } catch (conversionErr) {
            logErrorToFile(`协议转换请求体失败: ${conversionErr}`);
          }
        }
      }

      const response = await originalFetch.call(this, input, modifiedInit);

      // 5xx fallback
      if (response.status >= 500) {
        logErrorToFile(`目标模型 ${targetModel.id} 返回 ${response.status}`);
        if (qualityCollector) {
          qualityCollector.recordSignal(targetModel.id, result.analysis.stepType, "error", result.sessionId);
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

      // ISSUE-009: strip apiKey from onRouting callback to prevent accidental leakage
      const { apiKey: _apiKey, enterpriseConfig: _ec, ...safeDecision } = result.decision;
      options.onRouting?.({ ...result, decision: safeDecision } as HandleResult);

      // ISSUE-028: Protocol conversion — convert response when crossing providers
      // When same-provider routing (URL not rewritten), infer protocol from original URL
      // because the response format matches the original endpoint, not the target model's registered protocol
      const protocol = result.decision.providerSwitched
        ? targetModel.api.protocol
        : detectProtocolFromUrl(url);

      // Streaming response: wrap with optional SSE protocol converter
      if (response.body && isStreamingResponse(response)) {
        let sseConverter: SSEProtocolConverter | undefined;
        if (needsProtocolConversion && sourceProtocol) {
          // ISSU-028 fix: response comes FROM target endpoint (protocol), must convert TO sourceProtocol
          if (sourceProtocol === "anthropic" && protocol === "openai") {
            // Response from OpenAI endpoint → convert to Anthropic SSE for original caller
            resetSSEState();
            sseConverter = (chunk: string) => convertOpenAISSEToAnthropic(chunk, body.model ?? "");
          } else if (sourceProtocol === "openai" && protocol === "anthropic") {
            // Response from Anthropic endpoint → convert to OpenAI SSE for original caller
            sseConverter = (chunk: string) => convertAnthropicSSEToOpenAI(chunk, body.model ?? "");
          }
        }

        return createStreamingResponseWrapper(response, protocol, (tokens) => {
          if (options.costTracker) {
            options.costTracker.record(
              result.analysis,
              body.model ?? "",
              undefined,
              targetModel,
              result.sessionId,
              "unknown",
              tokens,
            );
          }
          if (qualityCollector) {
            qualityCollector.recordSignal(targetModel.id, result.analysis.stepType, "success", result.sessionId);
            onlineLearner?.recordSignal(targetModel.id, result.analysis.stepType, "success");
          }
          // ISSUE-009: strip apiKey from onRouting callback
          const { apiKey: _ak, enterpriseConfig: _aec, ...safeDec } = result.decision;
          options.onRouting?.({ ...result, decision: safeDec, tokenUsage: tokens } as any);
        }, sseConverter);
      }

      // Non-streaming response: convert response body if protocol mismatch
      if (needsProtocolConversion && sourceProtocol) {
        try {
          const respBody = await response.json();
          let converted: any;
          // ISSUE-028 fix: response comes FROM target endpoint (protocol), must convert TO sourceProtocol
          if (sourceProtocol === "anthropic" && protocol === "openai") {
            // Response from OpenAI endpoint → convert to Anthropic format for original caller
            converted = convertOpenAIToAnthropicResponse(respBody, body.model ?? "");
          } else if (sourceProtocol === "openai" && protocol === "anthropic") {
            // Response from Anthropic endpoint → convert to OpenAI format for original caller
            converted = convertAnthropicToOpenAIResponse(respBody, body.model ?? "");
          }
          if (converted) {
            return new Response(JSON.stringify(converted), {
              status: response.status,
              headers: response.headers,
            });
          }
        } catch (conversionErr) {
          logErrorToFile(`协议转换响应体失败: ${conversionErr}`);
        }
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

function isStreamingResponse(response: Response): boolean {
  const ct = response.headers.get("content-type") ?? "";
  return ct.includes("text/event-stream");
}

function detectProtocolFromUrl(url: string): "openai" | "anthropic" {
  if (url.includes("anthropic.com") || url.includes("/api/anthropic/")) {
    return "anthropic";
  }
  return "openai";
}

export function getOriginalFetch(): typeof globalThis.fetch {
  return (globalThis as any)[ORIGINAL_FETCH_SYMBOL] ?? globalThis.fetch;
}
