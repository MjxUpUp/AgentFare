import type { Pipeline } from "./types.js";

/**
 * ISSUE-043: Accept both JSON and simple YAML pipeline definitions.
 * JSON is the preferred format (exact, no parsing ambiguity).
 * YAML support uses a line-by-line parser that handles the subset of YAML
 * used by pipeline definitions (flat key-value, list items, no nesting beyond one level).
 */

export function parsePipeline(input: string): Pipeline {
  const trimmed = input.trim();
  // JSON format: starts with { — parse directly
  if (trimmed.startsWith("{")) {
    return parsePipelineJSON(trimmed);
  }
  // Otherwise treat as YAML
  return parsePipelineYAMLImpl(trimmed);
}

/** Alias for backward compatibility */
export const parsePipelineYAML = parsePipeline;

function parsePipelineJSON(json: string): Pipeline {
  const data = JSON.parse(json);
  if (!data.name || !Array.isArray(data.steps)) {
    throw new Error("Pipeline JSON must have 'name' (string) and 'steps' (array)");
  }
  return {
    name: String(data.name),
    steps: data.steps.map((s: any, i: number) => ({
      id: String(s.id ?? `step${i + 1}`),
      description: String(s.description ?? ""),
      candidateModels: Array.isArray(s.candidateModels) ? s.candidateModels.map(String) : [],
    })),
  };
}

function extractValue(line: string, key: string): string | null {
  const prefix = key + ":";
  if (!line.startsWith(prefix)) return null;
  let value = line.slice(prefix.length).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  return value;
}

function parsePipelineYAMLImpl(yaml: string): Pipeline {
  const lines = yaml.split("\n");
  let name = "";
  const steps: Pipeline["steps"] = [];
  let currentStep: {
    id: string;
    description: string;
    candidateModels: string[];
  } | null = null;
  let inCandidates = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const nameVal = extractValue(trimmed, "name");
    if (nameVal !== null) {
      name = nameVal;
      continue;
    }
    const idVal = extractValue(trimmed, "- id");
    if (idVal !== null) {
      if (currentStep) steps.push(currentStep);
      currentStep = {
        id: idVal,
        description: "",
        candidateModels: [],
      };
      inCandidates = false;
      continue;
    }
    if (currentStep) {
      const descVal = extractValue(trimmed, "description");
      if (descVal !== null) {
        currentStep.description = descVal;
        continue;
      }
    }
    if (currentStep && trimmed.startsWith("candidates:")) {
      inCandidates = true;
      continue;
    }
    if (inCandidates && currentStep && trimmed.startsWith("- "))
      currentStep.candidateModels.push(
        trimmed
          .slice(2)
          .trim()
          .replace(/"/g, "")
      );
  }
  if (currentStep) steps.push(currentStep);
  return { name, steps };
}

export function computeTotalCombinations(pipeline: Pipeline): number {
  return pipeline.steps.reduce(
    (total, step) => total * step.candidateModels.length,
    1
  );
}
