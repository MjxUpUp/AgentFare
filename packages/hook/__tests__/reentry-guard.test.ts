import { describe, it, expect } from "vitest";
import { isInternalRequest, makeInternalHeaders } from "../src/reentry-guard.js";

describe("isInternalRequest", () => {
  it("should return true when x-agentfare-internal header is set", () => {
    const init: RequestInit = {
      headers: { "x-agentfare-internal": "true" },
    };
    expect(isInternalRequest(init)).toBe(true);
  });

  it("should return false without header", () => {
    const init: RequestInit = {
      headers: { "content-type": "application/json" },
    };
    expect(isInternalRequest(init)).toBe(false);
  });

  it("should return false when init is undefined", () => {
    expect(isInternalRequest(undefined)).toBe(false);
  });

  it("should detect header from Headers object (ISSUE-021)", () => {
    const h = new Headers();
    h.set("x-agentfare-internal", "true");
    expect(isInternalRequest({ headers: h })).toBe(true);
  });

  it("should detect header from [string, string][] format (ISSUE-021)", () => {
    const headers: [string, string][] = [
      ["content-type", "application/json"],
      ["x-agentfare-internal", "true"],
    ];
    expect(isInternalRequest({ headers })).toBe(true);
  });

  it("should return false for Headers object without internal header", () => {
    const h = new Headers();
    h.set("content-type", "application/json");
    expect(isInternalRequest({ headers: h })).toBe(false);
  });

  it("should return false for array format without internal header", () => {
    const headers: [string, string][] = [
      ["content-type", "application/json"],
    ];
    expect(isInternalRequest({ headers })).toBe(false);
  });
});

describe("makeInternalHeaders", () => {
  it("should return headers with x-agentfare-internal set to true", () => {
    const result = makeInternalHeaders();
    expect(result["x-agentfare-internal"]).toBe("true");
  });

  it("should merge with existing headers", () => {
    const result = makeInternalHeaders({ "content-type": "application/json", "x-custom": "value" });
    expect(result["x-agentfare-internal"]).toBe("true");
    expect(result["content-type"]).toBe("application/json");
    expect(result["x-custom"]).toBe("value");
  });

  it("should not mutate the original headers object", () => {
    const existing = { "content-type": "application/json" };
    const result = makeInternalHeaders(existing);
    expect(result["x-agentfare-internal"]).toBe("true");
    expect(existing).toEqual({ "content-type": "application/json" });
  });
});
