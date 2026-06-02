/**
 * Shared header extraction utility.
 * Handles all three HeadersInit formats: Headers object, [string, string][], Record<string, string>.
 */

const DISPATCH_INTERNAL_HEADER = "x-agentfare-internal";

export function extractHeaders(headers: HeadersInit | undefined): Record<string, string> {
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

export function isInternalRequest(init: RequestInit | undefined): boolean {
  if (!init?.headers) return false;
  const headers = extractHeaders(init.headers);
  return headers[DISPATCH_INTERNAL_HEADER] === "true";
}

export function makeInternalHeaders(existing?: Record<string, string>): Record<string, string> {
  return { ...existing, [DISPATCH_INTERNAL_HEADER]: "true" };
}
