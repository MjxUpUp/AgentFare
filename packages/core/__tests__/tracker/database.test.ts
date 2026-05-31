import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { TrackingDatabase } from "../../src/tracker/database.js";

describe("TrackingDatabase", () => {
  let db: TrackingDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `agentdispatch-test-${Date.now()}.db`);
    db = new TrackingDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("should create tables on init", () => {
    const tables = db.listTables();
    expect(tables).toContain("routing_logs");
    expect(tables).toContain("model_scores");
  });

  it("should insert and query routing logs", () => {
    db.insertRoutingLog({
      sessionId: "sess-1",
      tool: "codex",
      stepType: "exploration",
      originalModel: "openai/gpt-5.5",
      routedModel: "openai/gpt-5.3-codex-spark",
      difficulty: 0.2,
      confidence: 0.9,
      reasoning: "file read",
      inputTokens: 500,
      outputTokens: 200,
      originalCost: 0.012,
      actualCost: 0.0004,
      savings: 0.0116,
    });

    const logs = db.queryLogs({ sessionId: "sess-1" });
    expect(logs).toHaveLength(1);
    expect(logs[0].routed_model).toBe("openai/gpt-5.3-codex-spark");
    expect(logs[0].savings).toBeCloseTo(0.0116);
  });

  it("should query cost summary", () => {
    db.insertRoutingLog({
      sessionId: "s1",
      tool: "codex",
      stepType: "exploration",
      originalModel: "openai/gpt-5.5",
      routedModel: "openai/gpt-5.3-codex-spark",
      difficulty: 0.2,
      confidence: 0.9,
      reasoning: "",
      inputTokens: 1000,
      outputTokens: 500,
      originalCost: 0.09,
      actualCost: 0.0015,
      savings: 0.0885,
    });
    db.insertRoutingLog({
      sessionId: "s1",
      tool: "codex",
      stepType: "editing",
      originalModel: "openai/gpt-5.5",
      routedModel: "openai/gpt-5.4",
      difficulty: 0.5,
      confidence: 0.8,
      reasoning: "",
      inputTokens: 2000,
      outputTokens: 1000,
      originalCost: 0.18,
      actualCost: 0.03,
      savings: 0.15,
    });

    const summary = db.getCostSummary();
    expect(summary.totalRequests).toBe(2);
    expect(summary.totalOriginalCost).toBeCloseTo(0.27);
    expect(summary.totalActualCost).toBeCloseTo(0.0315);
    expect(summary.totalSavings).toBeCloseTo(0.2385);
  });
});
