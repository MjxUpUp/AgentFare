import { describe, it, expect } from "vitest";
import { detectTools } from "../src/detector.js";

describe("detectTools", () => {
  it("should return an array", () => {
    const tools = detectTools();
    expect(Array.isArray(tools)).toBe(true);
  });
});
