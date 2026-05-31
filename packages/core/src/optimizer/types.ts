export interface Pipeline {
  name: string;
  steps: PipelineStep[];
  eval?: { dataset: string; metric: string };
}

export interface PipelineStep {
  id: string;
  description: string;
  candidateModels: string[];
}

export interface RankedCombo {
  rank: number;
  models: Record<string, string>;
  estimatedAccuracy: number;
  estimatedCost: number;
  estimatedLatency: number;
  paretoFrontier: "cost-optimal" | "balanced" | "quality-optimal";
}

export type SearchAlgorithm =
  | "brute_force"
  | "arm_elimination"
  | "epsilon_lucb"
  | "hill_climbing"
  | "bayesian";

export interface SearchConfig {
  algorithm: SearchAlgorithm;
  maxEvaluations: number;
  parallelWorkers: number;
  earlyStop: boolean;
  cacheEvalResults: boolean;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  algorithm: "arm_elimination",
  maxEvaluations: 50,
  parallelWorkers: 4,
  earlyStop: true,
  cacheEvalResults: true,
};
