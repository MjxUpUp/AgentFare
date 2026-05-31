import { describe, it, expect } from "vitest";
import {
  parsePipelineYAML,
  computeTotalCombinations,
} from "../../src/optimizer/pipeline-parser.js";

describe("parsePipelineYAML", () => {
  it("should parse a simple pipeline", () => {
    const yaml = `name: "test-pipeline"
steps:
  - id: "plan"
    description: "planning step"
    candidates:
      - "openai/gpt-5.5"
      - "anthropic/claude-sonnet-4-6"
  - id: "execute"
    description: "execution step"
    candidates:
      - "openai/gpt-5.4"
      - "deepseek/v4-pro"`;

    const result = parsePipelineYAML(yaml);
    expect(result.name).toBe("test-pipeline");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].candidateModels).toHaveLength(2);
    expect(result.steps[1].candidateModels).toHaveLength(2);
  });

  it("should compute total combinations", () => {
    const yaml = `name: "test"
steps:
  - id: "a"
    description: ""
    candidates:
      - "m1"
      - "m2"
  - id: "b"
    description: ""
    candidates:
      - "m3"`;

    const result = parsePipelineYAML(yaml);
    expect(computeTotalCombinations(result)).toBe(2);
  });
});
