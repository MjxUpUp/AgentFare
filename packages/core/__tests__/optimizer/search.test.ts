import { describe, it, expect } from "vitest";
import {
  bruteForceSearch,
  armEliminationSearch,
  epsilonLucbSearch,
  hillClimbingSearch,
  bayesianSearch,
} from "../../src/optimizer/search.js";
import type { Pipeline } from "../../src/optimizer/types.js";
import { DEFAULT_SEARCH_CONFIG } from "../../src/optimizer/types.js";

describe("bruteForceSearch", () => {
  it("should find all combinations for a small pipeline", () => {
    const pipeline: Pipeline = {
      name: "test",
      steps: [
        { id: "a", description: "step a", candidateModels: ["m1", "m2"] },
        { id: "b", description: "step b", candidateModels: ["m3"] },
      ],
    };
    const costFn = (combo: Record<string, string>) =>
      Object.values(combo).reduce(
        (sum, m) => sum + (m === "m1" ? 1 : 2),
        0,
      );
    const results = bruteForceSearch(pipeline, costFn);
    expect(results).toHaveLength(2);
    expect(results[0].estimatedCost).toBeLessThanOrEqual(
      results[1].estimatedCost,
    );
  });
});

describe("armEliminationSearch", () => {
  it("should converge on the cheapest combination", () => {
    const pipeline: Pipeline = {
      name: "test",
      steps: [
        {
          id: "a",
          description: "step a",
          candidateModels: ["cheap", "expensive"],
        },
        { id: "b", description: "step b", candidateModels: ["low", "high"] },
      ],
    };
    const costMap: Record<string, number> = {
      cheap: 1,
      expensive: 10,
      low: 2,
      high: 20,
    };
    const costFn = (combo: Record<string, string>) =>
      Object.values(combo).reduce(
        (sum, m) => sum + (costMap[m] ?? 5),
        0,
      );
    const results = armEliminationSearch(pipeline, costFn);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].models.a).toBe("cheap");
    expect(results[0].models.b).toBe("low");
  });
});

describe("epsilonLucbSearch", () => {
  it("should find low-cost combinations", () => {
    const pipeline: Pipeline = {
      name: "test",
      steps: [
        {
          id: "a",
          description: "step a",
          candidateModels: ["cheap", "expensive"],
        },
        { id: "b", description: "step b", candidateModels: ["low", "high"] },
      ],
    };
    const costFn = (combo: Record<string, string>) =>
      (combo.a === "cheap" ? 1 : 10) + (combo.b === "low" ? 2 : 20);
    const results = epsilonLucbSearch(pipeline, costFn);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].estimatedCost).toBeLessThanOrEqual(12);
  });
});

describe("hillClimbingSearch", () => {
  it("should find local optimum", () => {
    const pipeline: Pipeline = {
      name: "test",
      steps: [
        { id: "a", description: "step a", candidateModels: ["m1", "m2"] },
        { id: "b", description: "step b", candidateModels: ["m3", "m4"] },
      ],
    };
    const costFn = (combo: Record<string, string>) =>
      (combo.a === "m1" ? 1 : 10) + (combo.b === "m3" ? 2 : 20);
    const results = hillClimbingSearch(pipeline, costFn);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].estimatedCost).toBeLessThanOrEqual(3);
  });
});

describe("bayesianSearch", () => {
  it("should find low-cost combinations", () => {
    const pipeline: Pipeline = {
      name: "test",
      steps: [
        {
          id: "a",
          description: "step a",
          candidateModels: ["cheap", "mid", "expensive"],
        },
        { id: "b", description: "step b", candidateModels: ["low", "high"] },
      ],
    };
    const costMap: Record<string, number> = {
      cheap: 1,
      mid: 5,
      expensive: 20,
      low: 2,
      high: 15,
    };
    const costFn = (combo: Record<string, string>) =>
      Object.values(combo).reduce(
        (sum, m) => sum + (costMap[m] ?? 5),
        0,
      );
    const results = bayesianSearch(pipeline, costFn, undefined, {
      ...DEFAULT_SEARCH_CONFIG,
      maxEvaluations: 4,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].estimatedCost).toBeLessThanOrEqual(6);
  });
});
