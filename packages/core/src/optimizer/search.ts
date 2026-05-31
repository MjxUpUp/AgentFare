import type { Pipeline, RankedCombo, SearchConfig } from "./types.js";
import { DEFAULT_SEARCH_CONFIG } from "./types.js";

export function bruteForceSearch(
  pipeline: Pipeline,
  costFn: (combo: Record<string, string>) => number,
  accuracyFn?: (combo: Record<string, string>) => number,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG
): RankedCombo[] {
  const combos = generateAllCombinations(pipeline);
  const results: RankedCombo[] = combos.map((combo) => ({
    models: combo,
    estimatedCost: costFn(combo),
    estimatedAccuracy: accuracyFn?.(combo) ?? 0.8,
    estimatedLatency: 0,
    rank: 0,
    paretoFrontier: "cost-optimal" as const,
  }));
  results.sort((a, b) => a.estimatedCost - b.estimatedCost);
  results.forEach((r, i) => {
    r.rank = i + 1;
  });
  return results;
}

export function epsilonLucbSearch(
  pipeline: Pipeline,
  costFn: (combo: Record<string, string>) => number,
  accuracyFn?: (combo: Record<string, string>) => number,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG
): RankedCombo[] {
  return bruteForceSearch(pipeline, costFn, accuracyFn, config);
}

export function armEliminationSearch(
  pipeline: Pipeline,
  costFn: (combo: Record<string, string>) => number,
  accuracyFn?: (combo: Record<string, string>) => number,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG
): RankedCombo[] {
  return bruteForceSearch(pipeline, costFn, accuracyFn, config);
}

function generateAllCombinations(
  pipeline: Pipeline
): Record<string, string>[] {
  if (pipeline.steps.length === 0) return [{}];
  const results: Record<string, string>[] = [];
  const step = pipeline.steps[0];
  const rest = generateAllCombinations({
    ...pipeline,
    steps: pipeline.steps.slice(1),
  });
  for (const model of step.candidateModels) {
    for (const r of rest) {
      results.push({ [step.id]: model, ...r });
    }
  }
  return results;
}
