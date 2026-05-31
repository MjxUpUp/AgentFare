import { describe, it, expect } from "vitest";
import { RouteCache } from "../../src/analyzer/cache.js";

describe("RouteCache", () => {
  it("should cache and retrieve analysis results", () => {
    const cache = new RouteCache(100);
    cache.set("hash-1", { stepType: "exploration", recommendedTier: "fast" } as any);
    const result = cache.get("hash-1");
    expect(result).toBeDefined();
    expect(result!.recommendedTier).toBe("fast");
  });

  it("should return null for missing keys", () => {
    const cache = new RouteCache(100);
    expect(cache.get("missing")).toBeNull();
  });

  it("should evict oldest entries when at capacity", () => {
    const cache = new RouteCache(2);
    cache.set("a", { stepType: "a" } as any);
    cache.set("b", { stepType: "b" } as any);
    cache.set("c", { stepType: "c" } as any);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });
});
