import type { Pipeline, RankedCombo, SearchConfig } from "./types.js";
import { DEFAULT_SEARCH_CONFIG } from "./types.js";
import { computeTotalCombinations } from "./pipeline-parser.js";

export function bruteForceSearch(
  pipeline: Pipeline,
  costFn: (combo: Record<string, string>) => number,
  accuracyFn?: (combo: Record<string, string>) => number,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG,
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

export function armEliminationSearch(
  pipeline: Pipeline,
  costFn: (combo: Record<string, string>) => number,
  accuracyFn?: (combo: Record<string, string>) => number,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG,
): RankedCombo[] {
  const combos = generateAllCombinations(pipeline);
  const n = combos.length;
  if (n <= config.maxEvaluations)
    return bruteForceSearch(pipeline, costFn, accuracyFn, config);

  const totalCosts: number[] = new Array(n).fill(0);
  const counts: number[] = new Array(n).fill(0);
  const active = new Set<number>(Array.from({ length: n }, (_, i) => i));
  let totalEvals = 0;

  for (let i = 0; i < n; i++) {
    totalCosts[i] = costFn(combos[i]);
    counts[i] = 1;
    totalEvals++;
  }

  while (active.size > 1 && totalEvals < config.maxEvaluations) {
    const avgCosts = Array.from(active).map((i) => ({
      i,
      avg: totalCosts[i] / counts[i],
    }));
    avgCosts.sort((a, b) => a.avg - b.avg);
    const medianCost = avgCosts[Math.floor(avgCosts.length / 2)].avg;
    for (const item of avgCosts) {
      if (item.avg > medianCost * 1.5 && active.size > 1) active.delete(item.i);
    }
    const toEval = Array.from(active).slice(
      0,
      Math.min(config.parallelWorkers, active.size),
    );
    for (const i of toEval) {
      if (totalEvals >= config.maxEvaluations) break;
      totalCosts[i] += costFn(combos[i]);
      counts[i]++;
      totalEvals++;
    }
  }

  const results: RankedCombo[] = Array.from(active).map((i) => ({
    models: combos[i],
    estimatedCost: totalCosts[i] / counts[i],
    estimatedAccuracy: accuracyFn?.(combos[i]) ?? 0.8,
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
  config: SearchConfig = DEFAULT_SEARCH_CONFIG,
): RankedCombo[] {
  const combos = generateAllCombinations(pipeline);
  const n = combos.length;
  if (n <= config.maxEvaluations)
    return bruteForceSearch(pipeline, costFn, accuracyFn, config);

  const scores: number[] = new Array(n).fill(0);
  const counts: number[] = new Array(n).fill(0);
  const epsilon = 0.05;

  for (let i = 0; i < n; i++) {
    scores[i] = costFn(combos[i]);
    counts[i] = 1;
  }
  let totalEvals = n;

  while (totalEvals < config.maxEvaluations) {
    const means = scores.map((s, i) => s / counts[i]);
    const bounds = means.map(
      (_, i) => Math.sqrt((2 * Math.log(totalEvals)) / counts[i]),
    );
    const sorted = means
      .map((m, i) => ({ m, i }))
      .sort((a, b) => a.m - b.m);
    const bestIdx = sorted[0].i;
    const secondIdx = sorted[1].i;

    if (
      means[bestIdx] + bounds[bestIdx] <
      means[secondIdx] - bounds[secondIdx] + epsilon * means[secondIdx]
    ) {
      if (config.earlyStop) break;
    }

    const toEval =
      bounds[bestIdx] > bounds[secondIdx] ? bestIdx : secondIdx;
    scores[toEval] += costFn(combos[toEval]);
    counts[toEval]++;
    totalEvals++;
  }

  const results: RankedCombo[] = combos.map((combo, i) => ({
    models: combo,
    estimatedCost: scores[i] / counts[i],
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

export function hillClimbingSearch(
  pipeline: Pipeline,
  costFn: (combo: Record<string, string>) => number,
  accuracyFn?: (combo: Record<string, string>) => number,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG,
): RankedCombo[] {
  const steps = pipeline.steps;
  if (steps.length === 0) return [];

  let currentCombo: Record<string, string> = {};
  for (const step of steps) currentCombo[step.id] = step.candidateModels[0];
  let currentCost = costFn(currentCombo);
  let totalEvals = 1;
  const visited = new Set<string>();
  visited.add(comboKey(currentCombo));

  const allResults: RankedCombo[] = [
    {
      models: { ...currentCombo },
      estimatedCost: currentCost,
      estimatedAccuracy: accuracyFn?.(currentCombo) ?? 0.8,
      estimatedLatency: 0,
      rank: 0,
      paretoFrontier: "cost-optimal" as const,
    },
  ];

  while (totalEvals < config.maxEvaluations) {
    let improved = false;
    for (let s = 0; s < steps.length; s++) {
      for (const candidate of steps[s].candidateModels) {
        if (candidate === currentCombo[steps[s].id]) continue;
        const neighbor = { ...currentCombo, [steps[s].id]: candidate };
        const key = comboKey(neighbor);
        if (visited.has(key)) continue;
        const neighborCost = costFn(neighbor);
        totalEvals++;
        visited.add(key);
        allResults.push({
          models: neighbor,
          estimatedCost: neighborCost,
          estimatedAccuracy: accuracyFn?.(neighbor) ?? 0.8,
          estimatedLatency: 0,
          rank: 0,
          paretoFrontier: "cost-optimal" as const,
        });
        if (neighborCost < currentCost) {
          currentCombo = neighbor;
          currentCost = neighborCost;
          improved = true;
          break;
        }
        if (totalEvals >= config.maxEvaluations) break;
      }
      if (totalEvals >= config.maxEvaluations) break;
    }
    if (!improved) {
      if (config.earlyStop) break;
      for (const step of steps)
        currentCombo[step.id] = step.candidateModels[0];
      currentCost = costFn(currentCombo);
      totalEvals++;
    }
  }

  allResults.sort((a, b) => a.estimatedCost - b.estimatedCost);
  allResults.forEach((r, i) => {
    r.rank = i + 1;
  });
  return allResults;
}

export function bayesianSearch(
  pipeline: Pipeline,
  costFn: (combo: Record<string, string>) => number,
  accuracyFn?: (combo: Record<string, string>) => number,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG,
): RankedCombo[] {
  const combos = generateAllCombinations(pipeline);
  const n = combos.length;
  if (n <= config.maxEvaluations)
    return bruteForceSearch(pipeline, costFn, accuracyFn, config);

  const observed: Map<string, number> = new Map();
  const cKeys = combos.map(comboKey);
  const keyToCombo = new Map(cKeys.map((k, i) => [k, combos[i]]));

  const initialCount = Math.min(n, 10);
  const step = Math.floor(n / initialCount);
  for (let i = 0; i < initialCount; i++) {
    const idx = Math.min(i * step, n - 1);
    observed.set(cKeys[idx], costFn(combos[idx]));
  }

  let totalEvals = initialCount;
  while (totalEvals < config.maxEvaluations) {
    const observedCosts = Array.from(observed.values());
    const bestCost = Math.min(...observedCosts);
    let bestEI = -Infinity;
    let bestKey: string | null = null;

    for (const key of cKeys) {
      if (observed.has(key)) continue;
      let weightedSum = 0;
      let weightTotal = 0;
      for (const [obsKey, obsCost] of observed) {
        const dist = hammingDistance(key, obsKey);
        const weight = 1 / (1 + dist);
        weightedSum += weight * obsCost;
        weightTotal += weight;
      }
      const predictedMean = weightedSum / weightTotal;
      const minDist = Math.min(
        ...Array.from(observed.keys()).map((k) => hammingDistance(key, k)),
      );
      const predictedStd = 1 + minDist * 0.5;
      const improvement = bestCost - predictedMean;
      const ei =
        improvement > 0
          ? improvement *
            (1 - 0.5 * Math.exp(-improvement / predictedStd))
          : predictedStd *
            0.1 *
            Math.exp(improvement / predictedStd);
      if (ei > bestEI) {
        bestEI = ei;
        bestKey = key;
      }
    }
    if (!bestKey) break;
    observed.set(bestKey, costFn(keyToCombo.get(bestKey)!));
    totalEvals++;
  }

  const results: RankedCombo[] = [];
  for (const [key, cost] of observed) {
    results.push({
      models: keyToCombo.get(key)!,
      estimatedCost: cost,
      estimatedAccuracy: accuracyFn?.(keyToCombo.get(key)!) ?? 0.8,
      estimatedLatency: 0,
      rank: 0,
      paretoFrontier: "cost-optimal" as const,
    });
  }
  results.sort((a, b) => a.estimatedCost - b.estimatedCost);
  results.forEach((r, i) => {
    r.rank = i + 1;
  });
  return results;
}

function generateAllCombinations(pipeline: Pipeline): Record<string, string>[] {
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

function comboKey(combo: Record<string, string>): string {
  return Object.entries(combo)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function hammingDistance(a: string, b: string): number {
  let dist = 0;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}
