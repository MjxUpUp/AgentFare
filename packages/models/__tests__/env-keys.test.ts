import { describe, it, expect } from "vitest";
import { isOfficialHost } from "../src/env-keys.js";

describe("isOfficialHost", () => {
  it("matches official endpoints by URL", () => {
    expect(isOfficialHost("https://api.openai.com/v1/chat")).toBe(true);
    expect(isOfficialHost("https://api.anthropic.com")).toBe(true);
  });

  it("rejects relay hosts", () => {
    expect(isOfficialHost("https://relay.example.com/v1")).toBe(false);
  });

  it("lowercases a bare hostname in the fallback path", () => {
    // A non-URL string with mixed case must still match the official host list,
    // which is stored lowercase. Regression for the missing toLowerCase().
    expect(isOfficialHost("API.OpenAI.com")).toBe(true);
    expect(isOfficialHost("api.openai.com")).toBe(true);
  });

  it("matches the hostname of a mixed-case URL", () => {
    expect(isOfficialHost("https://API.OPENAI.com/v1")).toBe(true);
  });
});
