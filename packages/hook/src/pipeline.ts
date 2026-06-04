/**
 * Shared pipeline utilities for AgentFare request processing.
 *
 * ISSUE-087: Extracted from the duplicated logic in proxy/server.ts and
 * hook/fetch-patch.ts. All functions are pure — no side effects, no globals.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { StepAnalysis } from "@agentfare/core";
import type { ModelRegistry, ModelEntry } from "@agentfare/models";
import type { SSEProtocolConverter } from "./response-handler.js";
import { createSSEStreamConverter } from "./protocol/openai-to-anthropic-sse.js";
import { convertAnthropicSSEToOpenAI } from "./protocol/sse-transform.js";
import { convertOpenAIToAnthropicRequest } from "./protocol/openai-to-anthropic.js";
import { convertAnthropicToOpenAIRequest } from "./protocol/anthropic-to-openai-request.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time to wait for the routing analyzer before falling back. */
export const ANALYZER_TIMEOUT_MS = 500;

/** Synthetic StepAnalysis for pass-through requests (no reroute). */
export const PASS_THROUGH_ANALYSIS: StepAnalysis = {
  stepType: "unknown",
  difficulty: 0.5,
  confidence: 0.3,
  recommendedTier: "standard",
  recommendedModel: "",
  reasoning: "pass-through (no reroute)",
  needsProviderSwitch: false,
  estimatedTokens: { input: 0, output: 0 },
  alternatives: [],
};

// ---------------------------------------------------------------------------
// Model lookup
// ---------------------------------------------------------------------------

/**
 * Lookup a model by ID, trying multiple strategies:
 * 1. Exact match on registry id (e.g. "anthropic/claude-sonnet-4-6")
 * 2. Exact match on api.modelId (e.g. "claude-sonnet-4-6")
 * 3. Strip Anthropic date suffix (e.g. "claude-sonnet-4-20250514" → "claude-sonnet-4")
 *    then match by prefix (finds "claude-sonnet-4-6")
 */
export function lookupModelEntry(registry: ModelRegistry, modelId: string): ModelEntry | undefined {
  // 1. Exact match on id
  const exact = registry.get(modelId);
  if (exact) return exact;

  const all = registry.getAll();

  // 2. Exact match on api.modelId
  const byApiId = all.find(m => m.api.modelId === modelId);
  if (byApiId) return byApiId;

  // 3. Strip date suffix (-YYYYMMDD) and match by prefix
  const stripped = modelId.replace(/-\d{8}$/, "");
  if (stripped !== modelId) {
    const byPrefix = all.find(m =>
      m.api.modelId === stripped || m.api.modelId.startsWith(stripped + "-"),
    );
    if (byPrefix) return byPrefix;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Synthetic model entry for pass-through cost tracking
// ---------------------------------------------------------------------------

/**
 * Create a synthetic ModelEntry for pass-through cost tracking.
 * Uses zero pricing as fallback when model is not in registry.
 */
export function createPassThroughModelEntry(modelId: string): ModelEntry {
  return {
    id: modelId,
    displayName: modelId,
    provider: "custom" as const,
    tier: "standard" as const,
    api: { baseUrl: "", protocol: "openai" as const, modelId },
    pricing: { inputPerMillion: 0, outputPerMillion: 0, cacheHitPerMillion: null, currency: "USD" as const },
    capabilities: {
      codeGeneration: 0, codeReview: 0, planning: 0, reasoning: 0, toolUse: 0,
      contextWindow: 0, maxOutputTokens: 0, streaming: true, jsonMode: false,
    },
    routing: { avgLatencyMs: 0, tokensPerSecond: 0, availability: 1, region: ["global"] },
  };
}

// ---------------------------------------------------------------------------
// Protocol detection
// ---------------------------------------------------------------------------

/**
 * Detect the LLM protocol from a URL.
 * Checks for known Anthropic URL patterns; defaults to OpenAI.
 */
export function detectProtocol(url: string): "openai" | "anthropic" {
  if (url.includes("anthropic.com") || url.includes("/api/anthropic/")) {
    return "anthropic";
  }
  return "openai";
}

// ---------------------------------------------------------------------------
// SSE converter selection
// ---------------------------------------------------------------------------

/**
 * Create the appropriate SSE converter for a cross-provider streaming response.
 *
 * @param sourceProtocol - Protocol the client expects (original caller's protocol)
 * @param targetProtocol - Protocol the upstream uses (target model's protocol)
 * @param modelName - Model name to embed in converted events
 * @returns An SSEProtocolConverter function, or undefined if no conversion needed
 */
export function createSSEConverterForDirection(
  sourceProtocol: "openai" | "anthropic",
  targetProtocol: "openai" | "anthropic",
  modelName: string,
): SSEProtocolConverter | undefined {
  if (sourceProtocol === targetProtocol) return undefined;

  // Response comes FROM target (targetProtocol), needs converting TO source (sourceProtocol)
  if (sourceProtocol === "anthropic" && targetProtocol === "openai") {
    // Upstream sends OpenAI SSE → convert to Anthropic SSE for client
    const sseConv = createSSEStreamConverter();
    return (chunk: string) => sseConv.convert(chunk, modelName);
  } else if (sourceProtocol === "openai" && targetProtocol === "anthropic") {
    // Upstream sends Anthropic SSE → convert to OpenAI SSE for client
    return (chunk: string) => convertAnthropicSSEToOpenAI(chunk, modelName);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Request body protocol conversion
// ---------------------------------------------------------------------------

/**
 * Convert a request body between OpenAI and Anthropic protocols.
 *
 * @param sourceProtocol - Protocol of the original request
 * @param targetProtocol - Protocol expected by the upstream
 * @param bodyStr - JSON string of the request body
 * @param targetModelId - Model ID for the target endpoint
 * @returns Converted body string, or original if no conversion needed/failed
 */
export function convertRequestBody(
  sourceProtocol: "openai" | "anthropic",
  targetProtocol: "openai" | "anthropic",
  bodyStr: string,
  targetModelId: string,
): string {
  if (sourceProtocol === targetProtocol) return bodyStr;

  try {
    const requestBody = JSON.parse(bodyStr);
    let converted: any;
    if (sourceProtocol === "openai" && targetProtocol === "anthropic") {
      converted = convertOpenAIToAnthropicRequest(requestBody, targetModelId);
    } else if (sourceProtocol === "anthropic" && targetProtocol === "openai") {
      converted = convertAnthropicToOpenAIRequest(requestBody, targetModelId);
    }
    if (converted) {
      return JSON.stringify(converted);
    }
  } catch (conversionErr) {
    asyncLogError(conversionErr, "protocol-conversion");
  }

  return bodyStr;
}

// ---------------------------------------------------------------------------
// Decision sanitization for callbacks
// ---------------------------------------------------------------------------

/**
 * Strip sensitive fields (apiKey, enterpriseConfig) from a routing decision
 * for safe logging/telemetry callbacks.
 */
export function sanitizeDecisionForCallback(decision: any): any {
  const { apiKey: _apiKey, enterpriseConfig: _ec, ...safe } = decision;
  return safe;
}

// ---------------------------------------------------------------------------
// Async error logging
// ---------------------------------------------------------------------------

/**
 * Async error logger — replaces sync appendFileSync to avoid blocking the event loop.
 * ISSUE-090: Write errors to ~/.agentfare/errors.log asynchronously.
 */
export async function asyncLogError(err: unknown, prefix?: string): Promise<void> {
  try {
    const logPath = path.join(os.homedir(), ".agentfare", "errors.log");
    const timestamp = new Date().toISOString();
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    const prefixStr = prefix ? `[${prefix}] ` : "";
    await fs.promises.appendFile(logPath, `[${timestamp}] ${prefixStr}${message}\n`);
  } catch (writeErr) {
    // Error logger failed — last resort stderr
    try { process.stderr.write(`[agentfare] asyncLogError failed: ${writeErr}\n`); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Pass-through ID generation
// ---------------------------------------------------------------------------

let passThroughCounter = 0;

/** Generate a unique ID for pass-through cost tracking. */
export function generatePassThroughId(): string {
  return `pt-${Date.now()}-${++passThroughCounter}`;
}
