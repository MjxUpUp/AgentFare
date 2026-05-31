import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { TrackingDatabase } from "../../src/tracker/database.js";
import { CostTracker } from "../../src/tracker/cost-tracker.js";
import { ModelRegistry } from "@agentdispatch/models";
import type { StepAnalysis } from "../../src/analyzer/types.js";

describe("CostTracker", () => {
  let db: TrackingDatabase;
  let tracker: CostTracker;
  let dbPath: string;
  const registry = new ModelRegistry();

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `agentdispatch-cost-test-${Date.now()}.db`
    );
    db = new TrackingDatabase(dbPath);
    tracker = new CostTracker(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("should record cost savings", async () => {
    const analysis: StepAnalysis = {
      stepType: "simple_tool_use",
      difficulty: 0.1,
      confidence: 0.95,
      recommendedTier: "fast",
      recommendedModel: "",
      reasoning: "test",
      needsProviderSwitch: false,
      estimatedTokens: { input: 1000, output: 500 },
      alternatives: [],
    };

    const originalModel = registry.get("openai/gpt-5.5")!;
    const targetModel = registry.get("openai/gpt-5.3-codex-spark")!;

    await tracker.recordAsync(
      analysis,
      "openai/gpt-5.5",
      originalModel,
      targetModel,
      "sess-1",
      "codex",
      { input: 1000, output: 500 }
    );

    const summary = db.getCostSummary();
    expect(summary.totalRequests).toBe(1);
    expect(summary.totalSavings).toBeGreaterThan(0);
  });
});
