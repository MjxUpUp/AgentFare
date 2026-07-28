/**
 * Endpoint resolution helpers for multi-endpoint models (方案A).
 *
 * A model has a primary `api` endpoint plus optional additional `endpoints`
 * (e.g. a domestic vendor exposing both OpenAI- and Anthropic-compatible URLs).
 * Routing prefers the endpoint whose protocol matches the client's source
 * protocol so no conversion is needed.
 */

import type { AuthScheme, ModelApi, ModelEntry } from "./types.js";

/** All endpoints for a model: primary `api` first, then any additional `endpoints`. */
export function getAllEndpoints(model: ModelEntry): ModelApi[] {
  return [model.api, ...(model.endpoints ?? [])];
}

/**
 * Pick the endpoint whose protocol matches the requested one.
 * Falls back to the primary `api` when no match exists (caller may then convert).
 */
export function findEndpointForProtocol(
  model: ModelEntry,
  protocol: "openai" | "anthropic",
): ModelApi {
  return getAllEndpoints(model).find((e) => e.protocol === protocol) ?? model.api;
}

/** True when a model has an endpoint speaking the given protocol. */
export function hasEndpointForProtocol(
  model: ModelEntry,
  protocol: "openai" | "anthropic",
): boolean {
  return getAllEndpoints(model).some((e) => e.protocol === protocol);
}

/**
 * Resolve the auth scheme for an endpoint, deriving from protocol when unset.
 * anthropic → x-api-key, openai → bearer (the historical defaults).
 * Accepts a partial so callers without a full ModelApi (e.g. a ProviderInfo with
 * only a protocol) can still derive the default scheme.
 */
export function resolveAuthScheme(endpoint: Pick<ModelApi, "protocol" | "authScheme">): AuthScheme {
  if (endpoint.authScheme) return endpoint.authScheme;
  return endpoint.protocol === "anthropic" ? "x-api-key" : "bearer";
}
