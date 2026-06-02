import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadEvalDataset, evaluateCombo } from "../../src/optimizer/eval-runner.js";
import type { EvalSample } from "../../src/optimizer/eval-runner.js";

function makeSample(overrides: Partial<EvalSample> = {}): EvalSample {
  return {
    input: overrides.input ?? "What is 2+2?",
    expected: overrides.expected ?? "4",
    metadata: overrides.metadata ?? undefined,
  };
}

function makeResponseJson(content: string): object {
  return {
    choices: [
      {
        message: { content },
      },
    ],
  };
}

describe("loadEvalDataset", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `agentfare-eval-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads valid JSON array dataset", () => {
    const filePath = path.join(tmpDir, `dataset-${Date.now()}.json`);
    const data = [
      { input: "What is 1+1?", expected: "2" },
      { input: "What is the capital of France?", expected: "Paris" },
    ];
    fs.writeFileSync(filePath, JSON.stringify(data));

    const samples = loadEvalDataset(filePath);

    expect(samples).toHaveLength(2);
    expect(samples[0].input).toBe("What is 1+1?");
    expect(samples[0].expected).toBe("2");
    expect(samples[1].input).toBe("What is the capital of France?");
  });

  it("preserves metadata if present", () => {
    const filePath = path.join(tmpDir, `dataset-meta-${Date.now()}.json`);
    const data = [
      { input: "test", expected: "ok", metadata: { difficulty: "easy" } },
    ];
    fs.writeFileSync(filePath, JSON.stringify(data));

    const samples = loadEvalDataset(filePath);

    expect(samples[0].metadata).toEqual({ difficulty: "easy" });
  });

  it("sets expected to undefined when not provided", () => {
    const filePath = path.join(tmpDir, `dataset-noexp-${Date.now()}.json`);
    const data = [{ input: "hello" }];
    fs.writeFileSync(filePath, JSON.stringify(data));

    const samples = loadEvalDataset(filePath);

    expect(samples[0].expected).toBeUndefined();
  });

  it("throws when file does not exist", () => {
    const badPath = path.join(tmpDir, "nonexistent.json");
    expect(() => loadEvalDataset(badPath)).toThrow(/eval dataset/);
  });

  it("throws when content is not a JSON array", () => {
    const filePath = path.join(tmpDir, `dataset-bad-${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ not: "an array" }));

    expect(() => loadEvalDataset(filePath)).toThrow(/JSON 数组/);
  });
});

describe("evaluateCombo", () => {
  function makeMockFetch(
    responses: Array<{ ok: boolean; json: () => Promise<any> }>,
  ): typeof globalThis.fetch {
    let callIndex = 0;
    return (async (_url: any, _opts: any) => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return resp as any;
    }) as any;
  }

  function makeOkFetch(content: string) {
    return makeMockFetch([
      {
        ok: true,
        json: async () => makeResponseJson(content),
      },
    ]);
  }

  it("evaluates accuracy with exact match (default metric)", async () => {
    const fetch = makeMockFetch([
      { ok: true, json: async () => makeResponseJson("4") },
      { ok: true, json: async () => makeResponseJson("paris") },
    ]);

    const result = await evaluateCombo(
      { step1: "openai/gpt-5.3-codex-spark" },
      [
        makeSample({ input: "2+2?", expected: "4" }),
        makeSample({ input: "capital of france?", expected: "Paris" }),
      ],
      fetch,
    );

    expect(result.samples).toHaveLength(2);
    expect(result.samples[0].passed).toBe(true);
    expect(result.samples[1].passed).toBe(true);
    expect(result.accuracy).toBe(1);
  });

  it("evaluates accuracy with 'contains' metric", async () => {
    const fetch = makeMockFetch([
      { ok: true, json: async () => makeResponseJson("The answer is 42") },
    ]);

    const result = await evaluateCombo(
      { step1: "openai/gpt-5.3-codex-spark" },
      [makeSample({ input: "What is the answer?", expected: "42" })],
      fetch,
      { metric: "contains" },
    );

    expect(result.samples[0].passed).toBe(true);
    expect(result.accuracy).toBe(1);
  });

  it("marks passed=false on fetch error", async () => {
    const fetch = async () => {
      throw new Error("Network error");
    };

    const result = await evaluateCombo(
      { step1: "openai/gpt-5.3-codex-spark" },
      [makeSample({ input: "test", expected: "ok" })],
      fetch as any,
    );

    expect(result.samples[0].passed).toBe(false);
    expect(result.samples[0].output).toBe("[error]");
  });

  it("handles empty samples without division by zero", async () => {
    const fetch = makeOkFetch("unused");

    const result = await evaluateCombo(
      { step1: "openai/gpt-5.3-codex-spark" },
      [],
      fetch,
    );

    expect(result.accuracy).toBe(0);
    expect(result.avgLatencyMs).toBe(0);
    expect(result.samples).toHaveLength(0);
  });

  it("computes partial accuracy", async () => {
    const fetch = makeMockFetch([
      { ok: true, json: async () => makeResponseJson("4") },
      { ok: true, json: async () => makeResponseJson("wrong answer") },
    ]);

    const result = await evaluateCombo(
      { step1: "openai/gpt-5.3-codex-spark" },
      [
        makeSample({ input: "2+2?", expected: "4" }),
        makeSample({ input: "capital?", expected: "Paris" }),
      ],
      fetch,
    );

    expect(result.accuracy).toBeCloseTo(0.5);
  });

  // Regression for ISSUE-033: evaluateCombo must use ALL models in combo, not just first
  it("includes all combo models in the pipeline description sent to fetch (ISSUE-033)", async () => {
    let capturedBody: any = null;
    const fetch = async (_url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => makeResponseJson("ok"),
      };
    };

    await evaluateCombo(
      { plan: "openai/gpt-5.5", code: "openai/gpt-5.3-codex-spark", review: "anthropic/claude-sonnet-4" },
      [makeSample({ input: "test", expected: "ok" })],
      fetch as any,
    );

    expect(capturedBody).not.toBeNull();
    const prompt: string = capturedBody.messages[0].content;
    // The prompt should contain all three step assignments
    expect(prompt).toContain("plan=openai/gpt-5.5");
    expect(prompt).toContain("code=openai/gpt-5.3-codex-spark");
    expect(prompt).toContain("review=anthropic/claude-sonnet-4");
  });

  it("passes apiKey as Bearer token in headers", async () => {
    let capturedHeaders: any = null;
    const fetch = async (_url: any, opts: any) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => makeResponseJson("ok"),
      };
    };

    await evaluateCombo(
      { step1: "openai/gpt-5.3-codex-spark" },
      [makeSample({ input: "test", expected: "ok" })],
      fetch as any,
      { apiKey: "sk-test-123" },
    );

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-test-123");
  });

  it("does not include Authorization header when no apiKey", async () => {
    let capturedHeaders: any = null;
    const fetch = async (_url: any, opts: any) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => makeResponseJson("ok"),
      };
    };

    await evaluateCombo(
      { step1: "openai/gpt-5.3-codex-spark" },
      [makeSample({ input: "test", expected: "ok" })],
      fetch as any,
    );

    expect(capturedHeaders["Authorization"]).toBeUndefined();
  });

  it("marks passed=true when no expected value", async () => {
    const fetch = makeOkFetch("anything");

    const result = await evaluateCombo(
      { step1: "openai/gpt-5.3-codex-spark" },
      [{ input: "test" }],
      fetch,
    );

    expect(result.samples[0].passed).toBe(true);
  });
});
