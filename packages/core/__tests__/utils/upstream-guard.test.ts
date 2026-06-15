import { describe, it, expect } from "vitest";
import { resolveEffectiveBaseUrl, detectKeyHostConflict } from "../../src/utils/upstream-guard.js";
import { isOfficialHost } from "@agentfare/models";

describe("resolveEffectiveBaseUrl", () => {
  it("prefers enterprise over relay over official", () => {
    expect(
      resolveEffectiveBaseUrl({
        enterpriseBaseUrl: "https://ent.corp.com",
        providerUpstreamBaseUrl: "https://relay.example.com",
        targetApiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toBe("https://ent.corp.com");
  });

  it("falls back to relay upstream when no enterprise configured", () => {
    expect(
      resolveEffectiveBaseUrl({
        providerUpstreamBaseUrl: "https://relay.example.com",
        targetApiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toBe("https://relay.example.com");
  });

  it("falls back to official default when no relay configured", () => {
    expect(
      resolveEffectiveBaseUrl({
        targetApiBaseUrl: "https://api.anthropic.com",
      }),
    ).toBe("https://api.anthropic.com");
  });

  it("treats empty-string enterpriseBaseUrl as unset (not the empty URL)", () => {
    expect(
      resolveEffectiveBaseUrl({
        enterpriseBaseUrl: "",
        providerUpstreamBaseUrl: "https://relay.example.com",
        targetApiBaseUrl: "https://api.anthropic.com",
      }),
    ).toBe("https://relay.example.com");
  });

  it("treats whitespace-only enterpriseBaseUrl as unset", () => {
    expect(
      resolveEffectiveBaseUrl({
        enterpriseBaseUrl: "   ",
        targetApiBaseUrl: "https://api.anthropic.com",
      }),
    ).toBe("https://api.anthropic.com");
  });

  it("treats empty-string providerUpstreamBaseUrl as unset", () => {
    expect(
      resolveEffectiveBaseUrl({
        providerUpstreamBaseUrl: "",
        targetApiBaseUrl: "https://api.anthropic.com",
      }),
    ).toBe("https://api.anthropic.com");
  });
});

describe("isOfficialHost", () => {
  it("recognizes official OpenAI and Anthropic hosts", () => {
    expect(isOfficialHost("https://api.openai.com/v1")).toBe(true);
    expect(isOfficialHost("https://api.anthropic.com")).toBe(true);
  });

  it("flags relay hosts as non-official", () => {
    expect(isOfficialHost("https://relay.example.com/v1")).toBe(false);
    expect(isOfficialHost("https://api.openai-relay.cn")).toBe(false);
  });

  it("accepts a bare hostname", () => {
    expect(isOfficialHost("api.openai.com")).toBe(true);
    expect(isOfficialHost("relay.example.com")).toBe(false);
  });
});

describe("detectKeyHostConflict", () => {
  it("flags a relay-configured provider routed to an official host", () => {
    const r = detectKeyHostConflict({
      effectiveBaseUrl: "https://api.anthropic.com",
      providerUpstreamBaseUrl: "https://relay.example.com",
    });
    expect(r.conflict).toBe(true);
    expect(r.reason).toMatch(/ban risk/);
  });

  it("no conflict when a relay routes to its own relay host", () => {
    expect(
      detectKeyHostConflict({
        effectiveBaseUrl: "https://relay.example.com",
        providerUpstreamBaseUrl: "https://relay.example.com",
      }).conflict,
    ).toBe(false);
  });

  it("no conflict when no relay is configured (key is official)", () => {
    expect(
      detectKeyHostConflict({
        effectiveBaseUrl: "https://api.openai.com",
      }).conflict,
    ).toBe(false);
  });

  it("flags conflict when providerUpstreamBaseUrl is empty string (explicit config error)", () => {
    // "" is an explicit override, not "no relay" — surface it as conflict
    // rather than silently routing a non-official key to the official host.
    expect(
      detectKeyHostConflict({
        effectiveBaseUrl: "https://api.anthropic.com",
        providerUpstreamBaseUrl: "",
      }).conflict,
    ).toBe(true);
  });

  it("treats undefined providerUpstreamBaseUrl as no-relay (no false conflict)", () => {
    expect(
      detectKeyHostConflict({
        effectiveBaseUrl: "https://api.anthropic.com",
      }).conflict,
    ).toBe(false);
  });
});
