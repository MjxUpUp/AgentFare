import type { Pipeline } from "./types.js";

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
    if (trimmed.startsWith("name:"))
      name = trimmed
        .split(":")
        .slice(1)
        .join(":")
        .trim()
        .replace(/"/g, "");
    if (trimmed.startsWith("- id:")) {
      if (currentStep) steps.push(currentStep);
      currentStep = {
        id: trimmed
          .split(":")[1]
          .trim()
          .replace(/"/g, ""),
        description: "",
        candidateModels: [],
      };
      inCandidates = false;
    }
    if (currentStep && trimmed.startsWith("description:"))
      currentStep.description = trimmed
        .split(":")
        .slice(1)
        .join(":")
        .trim()
        .replace(/"/g, "");
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
