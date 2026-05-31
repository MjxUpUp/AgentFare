const DISPATCH_INTERNAL_HEADER = "x-agentdispatch-internal";

export function isInternalRequest(init: RequestInit | undefined): boolean {
  if (!init?.headers) return false;
  const headers = init.headers as Record<string, string>;
  return headers[DISPATCH_INTERNAL_HEADER] === "true";
}

export function makeInternalHeaders(existing?: Record<string, string>): Record<string, string> {
  return { ...existing, [DISPATCH_INTERNAL_HEADER]: "true" };
}
