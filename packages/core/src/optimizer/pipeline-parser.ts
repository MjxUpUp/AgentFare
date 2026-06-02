import type { Pipeline } from "./types.js";

/**
 * ISSUE-043: Robust key-value extraction that handles colons inside values.
 */
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

export function parsePipelineYAML(yaml: string): Pipeline {
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
