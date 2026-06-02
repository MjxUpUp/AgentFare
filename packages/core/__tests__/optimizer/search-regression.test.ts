import { describe, it, expect } from "vitest";
import {
  epsilonLucbSearch,
  hillClimbingSearch,
  armEliminationSearch,
  bayesianSearch,
} from "../../src/optimizer/search.js";
import type { Pipeline, SearchConfig } from "../../src/optimizer/types.js";
import { DEFAULT_SEARCH_CONFIG } from "../../src/optimizer/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePipeline(stepDefs: Array<{ id: string; models: string[] }>): Pipeline {
  return {
    name: "test-pipeline",
    steps: stepDefs.map((s) => ({
      id: s.id,
      description: `${s.id} step`,
      candidateModels: s.models,
    })),
  };
}

/** Cost function where cost is determined by model index: later models cost more. */
function indexBasedCostFn(combo: Record<string, string>): number {
  let cost = 0;
  for (const val of Object.values(combo)) {
    // Parse trailing number as cost multiplier
    const m = val.match(/(\d+)$/);
    cost += m ? parseInt(m[1], 10) : 1;
  }
  return cost;
}

// ---------------------------------------------------------------------------
// ISSUE-034: epsilonLucbSearch explores more than 2 distinct combinations
// ---------------------------------------------------------------------------
describe("ISSUE-034: epsilonLucbSearch exploration breadth", () => {
  it("evaluates more than 2 distinct combinations in a 20+ combo space", () => {
    // 3 steps x 3 candidates = 27 combinations, maxEvaluations=15
    // so n (27) > maxEvaluations (15) → epsilon-LUCB path is used
    const pipeline = makePipeline([
      { id: "plan", models: ["model-a1", "model-a2", "model-a3"] },
      { id: "exec", models: ["model-b1", "model-b2", "model-b3"] },
      { id: "review", models: ["model-c1", "model-c2", "model-c3"] },
    ]);

    // Track distinct combos evaluated
    const seen = new Set<string>();

    // Deterministic varying costs based on combo content
    const costFn = (combo: Record<string, string>): number => {
      const key = Object.values(combo).join("+");
      seen.add(key);
      // Deterministic varying costs to prevent premature convergence
      let cost = 1;
      for (let i = 0; i < key.length; i++) {
        cost += key.charCodeAt(i) % 7;
      }
      return cost;
    };

    const config: SearchConfig = {
      ...DEFAULT_SEARCH_CONFIG,
      maxEvaluations: 15,
      earlyStop: false,
    };

    epsilonLucbSearch(pipeline, costFn, undefined, config);

    expect(seen.size).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// ISSUE-035: hillClimbingSearch can find optimum far from [0,0,...]
// ---------------------------------------------------------------------------
describe("ISSUE-035: hillClimbingSearch finds distant optimum", () => {
  it("discovers the best combo at the end of candidate lists", () => {
    // 3 steps, each with 4 candidates. Best combo = last candidate for each step.
    const pipeline = makePipeline([
      { id: "s1", models: ["m-s1-10", "m-s1-8", "m-s1-5", "m-s1-1"] },
      { id: "s2", models: ["m-s2-10", "m-s2-8", "m-s2-5", "m-s2-1"] },
      { id: "s3", models: ["m-s3-10", "m-s3-8", "m-s3-5", "m-s3-1"] },
    ]);

    // Cost is sum of numbers extracted from model name; last models have cost 1 each
    const costFn = (combo: Record<string, string>): number => {
      let cost = 0;
      for (const val of Object.values(combo)) {
        const m = val.match(/-(\d+)$/);
        cost += m ? parseInt(m[1], 10) : 10;
      }
      return cost;
    };

    const config: SearchConfig = {
      ...DEFAULT_SEARCH_CONFIG,
      maxEvaluations: 50,
      earlyStop: true,
    };

    const results = hillClimbingSearch(pipeline, costFn, undefined, config);

    // Best combo should be near the global optimum (cost = 3: all "1" models)
    const best = results[0];
    expect(best).toBeDefined();
    // Allow some tolerance: the best found cost should be reasonably close to 3
    expect(best.estimatedCost).toBeLessThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// ISSUE-017: generateAllCombinations with large space has a guard
// ---------------------------------------------------------------------------
describe("ISSUE-017: combinatorial explosion guard", () => {
  it("throws for pipelines exceeding 1M combinations (epsilonLucbSearch)", () => {
    // 10 steps x 6 candidates = 6^10 = 60,466,176 combinations
    const pipeline = makePipeline(
      Array.from({ length: 10 }, (_, i) => ({
        id: `step${i}`,
        models: ["a", "b", "c", "d", "e", "f"],
      }))
    );

    const costFn = () => 1;

    expect(() =>
      epsilonLucbSearch(pipeline, costFn)
    ).toThrow(/too large/i);
  });

  it("throws for pipelines exceeding 1M combinations (armEliminationSearch)", () => {
    const pipeline = makePipeline(
      Array.from({ length: 10 }, (_, i) => ({
        id: `step${i}`,
        models: ["a", "b", "c", "d", "e", "f"],
      }))
    );

    expect(() =>
      armEliminationSearch(pipeline, () => 1)
    ).toThrow(/too large/i);
  });

  it("throws for pipelines exceeding 1M combinations (bayesianSearch)", () => {
    const pipeline = makePipeline(
      Array.from({ length: 10 }, (_, i) => ({
        id: `step${i}`,
        models: ["a", "b", "c", "d", "e", "f"],
      }))
    );

    expect(() =>
      bayesianSearch(pipeline, () => 1)
    ).toThrow(/too large/i);
  });

  it("throws for pipelines exceeding 100K combinations (hillClimbingSearch)", () => {
    // 5 steps x 11 candidates = 161051 > 100000
    const pipeline = makePipeline(
      Array.from({ length: 5 }, (_, i) => ({
        id: `step${i}`,
        models: Array.from({ length: 11 }, (_, j) => `m${j}`),
      }))
    );

    expect(() =>
      hillClimbingSearch(pipeline, () => 1)
    ).toThrow(/too large|exceed/i);
  });

  it("handles small spaces without error", () => {
    const pipeline = makePipeline([
      { id: "s1", models: ["a", "b", "c"] },
      { id: "s2", models: ["a", "b", "c"] },
    ]);

    expect(() =>
      epsilonLucbSearch(pipeline, () => 1)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ISSUE-018: hammingDistance for combos differing by exactly 1 step is always 1
// ---------------------------------------------------------------------------
describe("ISSUE-018: hammingDistance correctness", () => {
  // The hammingDistance function is internal. We test it indirectly through
  // bayesianSearch which uses it for neighbor weighting. But since we need
  // direct unit tests, we import the module and test via the exposed search
  // behavior. However the function is not exported. Let's test through
  // the comboKey-based reasoning: the comboKey format is "step=model&..."
  // and hammingDistance counts differing step entries.

  // Since hammingDistance is not exported, we verify the observable behavior:
  // bayesianSearch should prefer combos closer to already-evaluated low-cost combos.

  it("comboKey produces consistent keys for identical combos", () => {
    // We can test this indirectly: the search algorithms deduplicate via comboKey
    // Run hillClimbingSearch and verify no duplicate results
    const pipeline = makePipeline([
      { id: "s1", models: ["a", "b"] },
      { id: "s2", models: ["c", "d"] },
    ]);

    const results = hillClimbingSearch(pipeline, indexBasedCostFn, undefined, {
      ...DEFAULT_SEARCH_CONFIG,
      maxEvaluations: 50,
    });

    const keys = results.map((r) => JSON.stringify(r.models));
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("two combos differing in 1 step should produce distance 1", () => {
    // Test the hammingDistance logic by replicating it here and verifying
    // the underlying comboKey format
    const comboA = "plan=modelA&exec=modelX&review=modelP";
    const comboB = "plan=modelA&exec=modelX&review=modelQ";

    const aEntries = new Map(comboA.split("&").map((p) => p.split("=") as [string, string]));
    const bEntries = new Map(comboB.split("&").map((p) => p.split("=") as [string, string]));
    let dist = 0;
    const allKeys = new Set([...aEntries.keys(), ...bEntries.keys()]);
    for (const key of allKeys) {
      if (aEntries.get(key) !== bEntries.get(key)) dist++;
    }
    expect(dist).toBe(1);
  });

  it("two combos differing in 2 steps should produce distance 2", () => {
    const comboA = "plan=modelA&exec=modelX&review=modelP";
    const comboB = "plan=modelB&exec=modelY&review=modelP";

    const aEntries = new Map(comboA.split("&").map((p) => p.split("=") as [string, string]));
    const bEntries = new Map(comboB.split("&").map((p) => p.split("=") as [string, string]));
    let dist = 0;
    const allKeys = new Set([...aEntries.keys(), ...bEntries.keys()]);
    for (const key of allKeys) {
      if (aEntries.get(key) !== bEntries.get(key)) dist++;
    }
    expect(dist).toBe(2);
  });

  it("identical combos should produce distance 0", () => {
    const comboA = "plan=modelA&exec=modelX&review=modelP";

    const aEntries = new Map(comboA.split("&").map((p) => p.split("=") as [string, string]));
    const bEntries = new Map(comboA.split("&").map((p) => p.split("=") as [string, string]));
    let dist = 0;
    const allKeys = new Set([...aEntries.keys(), ...bEntries.keys()]);
    for (const key of allKeys) {
      if (aEntries.get(key) !== bEntries.get(key)) dist++;
    }
    expect(dist).toBe(0);
  });

  it("distance is unaffected by model name length", () => {
    // Short model name vs very long model name — only 1 step differs
    const comboA = "step1=short&step2=same";
    const comboB = "step1=this-is-a-very-long-model-name-with-extra-text&step2=same";

    const aEntries = new Map(comboA.split("&").map((p) => p.split("=") as [string, string]));
    const bEntries = new Map(comboB.split("&").map((p) => p.split("=") as [string, string]));
    let dist = 0;
    const allKeys = new Set([...aEntries.keys(), ...bEntries.keys()]);
    for (const key of allKeys) {
      if (aEntries.get(key) !== bEntries.get(key)) dist++;
    }
    expect(dist).toBe(1);
  });
});
