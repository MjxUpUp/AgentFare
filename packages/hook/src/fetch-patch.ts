import { LLMDetector } from "./url-detector.js";
import { isInternalRequest, extractHeaders } from "./headers.js";
import type { RequestHandler, HandleResult } from "./request-handler.js";
import { createStreamingResponseWrapper } from "./response-handler.js";
import type { SSEProtocolConverter } from "./response-handler.js";
import { resolveEffectiveBaseUrl, detectKeyHostConflict, type CostTracker, type QualitySignalCollector } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import type { ModelEntry } from "@agentfare/models";
import { convertAnthropicToOpenAIResponse } from "./protocol/anthropic-to-openai.js";
import { convertOpenAIToAnthropicResponse } from "./protocol/openai-to-anthropic-response.js";
import {
  ANALYZER_TIMEOUT_MS,
  PASS_THROUGH_ANALYSIS,
  lookupModelEntry,
  detectProtocol,
  createSSEConverterForDirection,
  convertRequestBody,
  sanitizeDecisionForCallback,
  asyncLogError,
  generatePassThroughId,
} from "./pipeline.js";
import { CircuitBreaker, shouldFailover, hostOf } from "./failover.js";

const ORIGINAL_FETCH_SYMBOL = Symbol("agentfare:originalFetch");

/**
 * Per-host circuit breaker for upstream providers. Module-level singleton so a
 * tripped host is short-circuited for the lifetime of the patched fetch.
 */
const upstreamCircuit = new CircuitBreaker();

export interface FetchPatchOptions {
  handler: RequestHandler;
  detector?: LLMDetector;
  registry?: ModelRegistry;
  costTracker?: CostTracker;
  qualitySignalCollector?: QualitySignalCollector;
  onlineLearner?: any;
  onRouting?: (result: HandleResult) => void;
  onError?: (err: unknown) => void;
  /**
   * Per-provider relay upstream base URLs (provider → relay URL). When a
   * cross-provider route targets a provider listed here, its relay URL is
   * preferred over the official api.baseUrl to avoid sending relay keys to
   * official endpoints (ban risk). Mirrors server.ts providerMap usage.
   */
  providerUpstreamBaseUrls?: Record<string, string>;
}

export function installFetchPatch(options: FetchPatchOptions): () => void {
  const originalFetch = globalThis.fetch;
  (globalThis as any)[ORIGINAL_FETCH_SYMBOL] = originalFetch;

  const qualityCollector = options.qualitySignalCollector;
  const onlineLearner = options.onlineLearner;
  const detector = options.detector ?? new LLMDetector(options.registry ?? new ModelRegistry());

  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (!detector.isLLMApiCall(url)) {
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
        // Pass-through: no reroute, but still track cost for observability
        const response = await originalFetch.call(this, input, init);
        if (options.costTracker && response.body && isStreamingResponse(response)) {
          const protocol = detectProtocol(url);
          const modelEntry = options.registry && currentModel ? lookupModelEntry(options.registry, currentModel) : undefined;
          const sid = headers["x-request-id"] ?? headers["x-session-id"] ?? generatePassThroughId();
          return createStreamingResponseWrapper(response, protocol, (tokens) => {
            if (modelEntry) {
              options.costTracker!.record(
                PASS_THROUGH_ANALYSIS,
                currentModel ?? "",
                modelEntry,
                modelEntry,
                sid,
                "unknown",
                tokens,
              );
            }
          });
        }
        return response;
      }

      const targetModel = result.decision.targetModel;
      const originalModelEntry = options.registry && currentModel ? lookupModelEntry(options.registry, currentModel) : undefined;

      // Snapshot the ORIGINAL request before any cross-provider rewriting.
      // On failover we must replay the original URL/body, not the rewritten
      // cross-provider URL + converted body (which would re-request a host
      // that just failed with the wrong shape).
      const originalInput = input;
      const originalInit = init;

      const modifiedInit: RequestInit = {
        ...init,
        body: result.modifiedBody,
      };

      // Cross-provider: rewrite URL, headers, and convert request body
      let sourceProtocol: "openai" | "anthropic" | null = null;
      let needsProtocolConversion = false;

      if (result.decision.providerSwitched) {
        const targetApi = targetModel.api;
        // ISSUE: previously used targetApi.baseUrl (official), ignoring the user's
        // relay upstreamUrl — relay keys hit the official endpoint (ban risk).
        const providerUpstreamBaseUrl = options.providerUpstreamBaseUrls?.[targetModel.provider];
        const effectiveBaseUrl = resolveEffectiveBaseUrl({
          enterpriseBaseUrl: result.decision.enterpriseConfig?.baseUrl,
          providerUpstreamBaseUrl,
          targetApiBaseUrl: targetApi.baseUrl,
        });
        // Ban-guard: refuse the cross-provider hop when it would route a relay
        // key to an official host (conflicting enterprise policy / empty
        // override). Fall back to the original request instead of logging only.
        const hostConflict = detectKeyHostConflict({ effectiveBaseUrl, providerUpstreamBaseUrl });
        // Surface the resolved host + validation result on the decision so
        // onRouting/telemetry can audit which upstream a route actually reached.
        result.decision.effectiveBaseUrl = effectiveBaseUrl;
        result.decision.keyHostBindingValidated = !hostConflict.conflict;
        if (hostConflict.conflict) {
          asyncLogError(
            `封号风险,跳过跨provider改写: ${hostConflict.reason} (provider=${targetModel.provider})`,
            "hook",
          );
          // Keep input/init at their original values (no cross-provider rewrite).
          // The request reaches the client's configured provider, not the vendor.
        } else {
          // Detect source protocol from original URL
          sourceProtocol = detectProtocol(url);
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
            const convertedBody = convertRequestBody(sourceProtocol, targetProtocol, result.modifiedBody, targetApi.modelId);
            modifiedInit.body = convertedBody;
          }
        }
      }

      // --- Forward to upstream (circuit breaker + failover) ---
      // ISSUE: previously only HTTP >= 500 triggered a single fallback; 429/408
      // were not covered, and there was no circuit breaker — a downed upstream
      // kept getting hammered on every request.
      const targetHost = hostOf(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      let upstreamResponse: Response | undefined;
      let forwardError: unknown;
      if (upstreamCircuit.allowRequest(targetHost)) {
        upstreamCircuit.onAttempt(targetHost);
        try {
          upstreamResponse = await originalFetch.call(this, input, modifiedInit);
        } catch (err) {
          forwardError = err; // network error / abort — recorded as a circuit failure
        }
      } else {
        asyncLogError(`熔断器开启: 跳过 ${targetHost}`, "hook");
      }

      // Failover: 5xx / 429 / 408 / network error / timeout → fall back to original
      if (shouldFailover(upstreamResponse?.status, forwardError)) {
        asyncLogError(
          `目标模型 ${targetModel.id} 失败 (${forwardError ? "网络错误/超时" : `状态 ${upstreamResponse?.status}`})`,
          "hook",
        );
        if (qualityCollector) {
          qualityCollector.recordSignal(targetModel.id, result.analysis.stepType, "error", result.sessionId);
          onlineLearner?.recordSignal(targetModel.id, result.analysis.stepType, "error");
        }
        upstreamCircuit.recordFailure(targetHost);
        // Replay the ORIGINAL request, not the rewritten cross-provider URL/body.
        return originalFetch.call(this, originalInput, originalInit);
      }

      upstreamCircuit.recordSuccess(targetHost);
      // upstreamResponse is defined on this path: shouldFailover() returned false
      // ⇒ a concrete non-failover status (undefined status ⇒ failover).
      const response = upstreamResponse!;

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
      const safeDecision = sanitizeDecisionForCallback(result.decision);
      options.onRouting?.({ ...result, decision: safeDecision } as HandleResult);

      // ISSUE-028: Protocol conversion — convert response when crossing providers
      const protocol = result.decision.providerSwitched
        ? targetModel.api.protocol
        : detectProtocol(url);

      // Streaming response: wrap with optional SSE protocol converter
      if (response.body && isStreamingResponse(response)) {
        const sseConverter = (needsProtocolConversion && sourceProtocol)
          ? createSSEConverterForDirection(sourceProtocol, protocol, body.model ?? "")
          : undefined;

        return createStreamingResponseWrapper(response, protocol, (tokens) => {
          if (options.costTracker) {
            options.costTracker.record(
              result.analysis,
              body.model ?? "",
              originalModelEntry,
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
        }, sseConverter);
      }

      // Non-streaming response: convert response body if protocol mismatch
      if (needsProtocolConversion && sourceProtocol) {
        try {
          const respBody = await response.json();
          let converted: any;
          if (sourceProtocol === "anthropic" && protocol === "openai") {
            converted = convertOpenAIToAnthropicResponse(respBody, body.model ?? "");
          } else if (sourceProtocol === "openai" && protocol === "anthropic") {
            converted = convertAnthropicToOpenAIResponse(respBody, body.model ?? "");
          }
          if (converted) {
            return new Response(JSON.stringify(converted), {
              status: response.status,
              headers: response.headers,
            });
          }
        } catch (conversionErr) {
          asyncLogError(`协议转换响应体失败: ${conversionErr}`, "hook");
        }
      }

      return response;
    } catch (err) {
      asyncLogError(err, "hook");
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

export function getOriginalFetch(): typeof globalThis.fetch {
  return (globalThis as any)[ORIGINAL_FETCH_SYMBOL] ?? globalThis.fetch;
}
