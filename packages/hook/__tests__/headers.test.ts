import { describe, it, expect } from "vitest";
import { extractHeaders, isInternalRequest, makeInternalHeaders } from "../src/headers.js";

describe("extractHeaders", () => {
  it("should convert Headers object to Record", () => {
    const h = new Headers();
    h.set("content-type", "application/json");
    h.set("authorization", "Bearer test");
    const result = extractHeaders(h);
    expect(result["content-type"]).toBe("application/json");
    expect(result["authorization"]).toBe("Bearer test");
  });

  it("should convert [string, string][] to Record", () => {
    const headers: [string, string][] = [
      ["content-type", "text/plain"],
      ["x-custom", "value"],
    ];
    const result = extractHeaders(headers);
    expect(result["content-type"]).toBe("text/plain");
    expect(result["x-custom"]).toBe("value");
  });

  it("should pass through plain object", () => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "*/*",
    };
    const result = extractHeaders(headers);
    expect(result).toEqual(headers);
  });

  it("should return empty object for undefined input", () => {
    const result = extractHeaders(undefined);
    expect(result).toEqual({});
  });

  it("should handle empty Headers object", () => {
    const result = extractHeaders(new Headers());
    expect(result).toEqual({});
  });

  it("should handle empty array", () => {
    const result = extractHeaders([]);
    expect(result).toEqual({});
  });
});

describe("isInternalRequest (headers)", () => {
  it("should return true when x-agentfare-internal is set via Headers object", () => {
    const h = new Headers();
    h.set("x-agentfare-internal", "true");
    expect(isInternalRequest({ headers: h })).toBe(true);
  });

  it("should return true when x-agentfare-internal is set via array", () => {
    const headers: [string, string][] = [["x-agentfare-internal", "true"]];
    expect(isInternalRequest({ headers })).toBe(true);
  });

  it("should return true when x-agentfare-internal is set via plain object", () => {
    expect(isInternalRequest({ headers: { "x-agentfare-internal": "true" } })).toBe(true);
  });

  it("should return false when init is undefined", () => {
    expect(isInternalRequest(undefined)).toBe(false);
  });

  it("should return false when headers are missing", () => {
    expect(isInternalRequest({})).toBe(false);
  });

  it("should return false when header value is not 'true'", () => {
    expect(isInternalRequest({ headers: { "x-agentfare-internal": "false" } })).toBe(false);
  });
});

describe("makeInternalHeaders (headers)", () => {
  it("should create headers with x-agentfare-internal", () => {
    const result = makeInternalHeaders();
    expect(result["x-agentfare-internal"]).toBe("true");
  });

  it("should merge with existing headers", () => {
    const result = makeInternalHeaders({ "content-type": "application/json" });
    expect(result["content-type"]).toBe("application/json");
    expect(result["x-agentfare-internal"]).toBe("true");
  });

  it("should not mutate the original object", () => {
    const original = { "content-type": "text/plain" };
    const result = makeInternalHeaders(original);
    expect(result["x-agentfare-internal"]).toBe("true");
    expect(original).toEqual({ "content-type": "text/plain" });
  });
});
