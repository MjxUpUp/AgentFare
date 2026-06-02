import type { Pipeline } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";

export interface EvalSample {
  input: string;
  expected?: string;
  metadata?: Record<string, any>;
}

export interface EvalResult {
  combo: Record<string, string>;
  samples: Array<{
    input: string;
    output: string;
    passed: boolean;
    latencyMs: number;
  }>;
  accuracy: number;
  avgLatencyMs: number;
}

export function loadEvalDataset(datasetPath: string): EvalSample[] {
  const resolved = path.resolve(datasetPath);
  if (!fs.existsSync(resolved))
    throw new Error(`eval dataset 不存在: ${resolved}`);
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  if (!Array.isArray(raw)) throw new Error("eval dataset 必须是 JSON 数组");
  return raw.map((item: any) => ({
    input: typeof item.input === "string" ? item.input : JSON.stringify(item),
    expected: item.expected ?? undefined,
    metadata: item.metadata ?? undefined,
  }));
}

export async function evaluateCombo(
  combo: Record<string, string>,
  samples: EvalSample[],
  fetchFn: typeof globalThis.fetch,
  options?: { baseUrl?: string; apiKey?: string; metric?: string },
): Promise<EvalResult> {
  // For multi-step pipelines, use the most capable (last) model for the actual API call.
  // This is a known limitation: a true multi-step eval would need sequential step execution,
  // but eval datasets typically provide flat input/output pairs.
  // The combo description is included in the prompt to give the model context about the pipeline.
  const modelIds = Object.values(combo);
  const modelId = modelIds[modelIds.length - 1] ?? "";
  const comboDescription = Object.entries(combo).map(([step, model]) => `${step}=${model}`).join('|');
  const baseUrl = options?.baseUrl ?? "https://api.openai.com/v1";
  const url = `${baseUrl}/chat/completions`;
  const results: EvalResult["samples"] = [];

  for (const sample of samples) {
    const start = Date.now();
    let output = "";
    let passed = false;
    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options?.apiKey
            ? { Authorization: `Bearer ${options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: `[pipeline: ${comboDescription}] ${sample.input}` }],
          max_tokens: 100,
        }),
      });
      const data = await response.json();
      output = data.choices?.[0]?.message?.content ?? "";
      if (sample.expected) {
        const metric = options?.metric ?? "accuracy";
        passed =
          metric === "contains"
            ? output.toLowerCase().includes(sample.expected.toLowerCase())
            : output.trim().toLowerCase() ===
                sample.expected.trim().toLowerCase() ||
              output.includes(sample.expected);
      } else {
        passed = true;
      }
    } catch {
      output = "[error]";
      passed = false;
    }
    results.push({
      input: sample.input,
      output,
      passed,
      latencyMs: Date.now() - start,
    });
  }

  const passedCount = results.filter((r) => r.passed).length;
  const totalLatency = results.reduce((sum, r) => sum + r.latencyMs, 0);
  return {
    combo,
    samples: results,
    accuracy: results.length > 0 ? passedCount / results.length : 0,
    avgLatencyMs: results.length > 0 ? totalLatency / results.length : 0,
  };
}
