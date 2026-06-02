import { describe, it, expect, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { TrackingDatabase } from "../../src/tracker/database.js";
import { CostTracker } from "../../src/tracker/cost-tracker.js";
import type { RoutingLogEntry } from "../../src/tracker/database.js";
import type { StepAnalysis } from "../../src/analyzer/types.js";
import type { ModelEntry } from "@agentfare/models";

function tempDbPath(): string {
  return path.join(os.tmpdir(), `agentfare-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function makeModelEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "test/model-a",
    provider: "test",
    displayName: "Test Model A",
    tier: "fast",
    pricing: { inputPerMillion: 10, outputPerMillion: 40, cacheHitPerMillion: null },
    capabilities: { codeGeneration: 7, codeReview: 7, planning: 7, reasoning: 7, toolUse: 7, contextWindow: 128, maxOutputTokens: 16, streaming: true, jsonMode: true },
    routing: { avgLatencyMs: 500, tokensPerSecond: 100, availability: 0.999, region: ["us"] },
    api: { protocol: "openai", baseUrl: "https://api.test.com/v1", modelId: "model-a" },
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<StepAnalysis> = {}): StepAnalysis {
  return {
    stepType: "simple_tool_use",
    difficulty: 0.1,
    confidence: 0.95,
    recommendedTier: "fast",
    recommendedModel: "",
    reasoning: "test analysis",
    needsProviderSwitch: false,
    estimatedTokens: { input: 100, output: 50 },
    alternatives: [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<RoutingLogEntry> = {}): RoutingLogEntry {
  return {
    sessionId: "sess-001",
    tool: "bash",
    stepType: "simple_tool_use",
    originalModel: "openai/gpt-5.5",
    routedModel: "openai/gpt-5.4-mini",
    difficulty: 0.2,
    confidence: 0.9,
    reasoning: "simple task",
    inputTokens: 1000,
    outputTokens: 500,
    originalCost: 0.07,
    actualCost: 0.00075,
    savings: 0.06925,
    ...overrides,
  };
}

describe("CostTracker integration (real SQLite)", () => {
  const dbs: TrackingDatabase[] = [];

  function createDb(): TrackingDatabase {
    const dbPath = tempDbPath();
    const db = new TrackingDatabase(dbPath);
    dbs.push(db);
    return db;
  }

  afterEach(() => {
    for (const db of dbs) {
      try { db.close(); } catch {}
    }
    dbs.length = 0;
  });

  it("record a routing log and getCostSummary returns correct totals", () => {
    const db = createDb();
    const tracker = new CostTracker(db);

    const originalModelEntry = makeModelEntry({
      id: "openai/gpt-5.5",
      pricing: { inputPerMillion: 5, outputPerMillion: 30, cacheHitPerMillion: null },
    });
    const targetModelEntry = makeModelEntry({
      id: "openai/gpt-5.4-mini",
      pricing: { inputPerMillion: 0.75, outputPerMillion: 4.50, cacheHitPerMillion: null },
    });

    tracker.record(
      makeAnalysis(),
      "openai/gpt-5.5",
      originalModelEntry,
      targetModelEntry,
      "sess-001",
      "bash",
      { input: 10000, output: 5000 },
    );

    const summary = db.getCostSummary();
    expect(summary.totalRequests).toBe(1);
    // originalCost = (10000/1e6)*5 + (5000/1e6)*30 = 0.05 + 0.15 = 0.2
    expect(summary.totalOriginalCost).toBeCloseTo(0.2, 4);
    // actualCost = (10000/1e6)*0.75 + (5000/1e6)*4.50 = 0.0075 + 0.0225 = 0.03
    expect(summary.totalActualCost).toBeCloseTo(0.03, 4);
    // savings > 0
    expect(summary.totalSavings).toBeGreaterThan(0);
  });

  it("timeRange filtering returns only recent records", () => {
    const db = createDb();

    // Insert a record normally (timestamp = now)
    db.insertRoutingLog(makeEntry({ sessionId: "recent-1" }));

    // Insert an old record by directly manipulating the database
    (db as any).db.prepare(
      `INSERT INTO routing_logs (session_id, tool, step_type, original_model, routed_model,
        difficulty, confidence, reasoning, input_tokens, output_tokens,
        original_cost, actual_cost, savings, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 days'))`
    ).run("old-1", "bash", "exploration", "openai/gpt-5.5", "openai/gpt-5.4-mini",
      0.3, 0.8, "old", 500, 200, 0.065, 0.0006, 0.0644);

    // Query last 1 day — should only get the recent record
    const summary1d = db.getCostSummary("1d");
    expect(summary1d.totalRequests).toBe(1);

    // Query all — should get both
    const summaryAll = db.getCostSummary();
    expect(summaryAll.totalRequests).toBe(2);
  });

  it("SQL injection in timeRange does not crash or corrupt data", () => {
    const db = createDb();
    db.insertRoutingLog(makeEntry({ sessionId: "safe-1" }));

    const malicious = "1'; DROP TABLE routing_logs; --";

    // Should throw validation error, NOT silently drop the table
    expect(() => db.getCostSummary(malicious)).toThrow();

    // Verify data is still intact
    const summary = db.getCostSummary();
    expect(summary.totalRequests).toBe(1);

    // Also verify the table still exists
    const tables = db.listTables();
    expect(tables).toContain("routing_logs");
  });

  it("getStepSummary groups by step_type correctly", () => {
    const db = createDb();

    db.insertRoutingLog(makeEntry({ stepType: "simple_tool_use", sessionId: "s1", actualCost: 0.01, savings: 0.05 }));
    db.insertRoutingLog(makeEntry({ stepType: "simple_tool_use", sessionId: "s2", actualCost: 0.02, savings: 0.03 }));
    db.insertRoutingLog(makeEntry({ stepType: "editing", sessionId: "s3", actualCost: 0.1, savings: 0.2 }));
    db.insertRoutingLog(makeEntry({ stepType: "reasoning", sessionId: "s4", actualCost: 0.15, savings: 0.1 }));

    const stepSummary = db.getStepSummary();

    const toolUse = stepSummary.find(s => s.key === "simple_tool_use");
    expect(toolUse).toBeDefined();
    expect(toolUse!.count).toBe(2);
    expect(toolUse!.totalCost).toBeCloseTo(0.03, 4);
    expect(toolUse!.totalSavings).toBeCloseTo(0.08, 4);

    const editing = stepSummary.find(s => s.key === "editing");
    expect(editing).toBeDefined();
    expect(editing!.count).toBe(1);
    expect(editing!.totalCost).toBeCloseTo(0.1, 4);

    const reasoning = stepSummary.find(s => s.key === "reasoning");
    expect(reasoning).toBeDefined();
    expect(reasoning!.count).toBe(1);
    expect(reasoning!.totalCost).toBeCloseTo(0.15, 4);
  });

  it("getToolSummary groups by tool correctly", () => {
    const db = createDb();

    db.insertRoutingLog(makeEntry({ tool: "bash", sessionId: "s1", actualCost: 0.01, savings: 0.05 }));
    db.insertRoutingLog(makeEntry({ tool: "bash", sessionId: "s2", actualCost: 0.02, savings: 0.03 }));
    db.insertRoutingLog(makeEntry({ tool: "read_file", sessionId: "s3", actualCost: 0.1, savings: 0.2 }));
    db.insertRoutingLog(makeEntry({ tool: "write_file", sessionId: "s4", actualCost: 0.15, savings: 0.1 }));

    const toolSummary = db.getToolSummary();

    const bash = toolSummary.find(s => s.key === "bash");
    expect(bash).toBeDefined();
    expect(bash!.count).toBe(2);
    expect(bash!.totalCost).toBeCloseTo(0.03, 4);
    expect(bash!.totalSavings).toBeCloseTo(0.08, 4);

    const readFile = toolSummary.find(s => s.key === "read_file");
    expect(readFile).toBeDefined();
    expect(readFile!.count).toBe(1);

    const writeFile = toolSummary.find(s => s.key === "write_file");
    expect(writeFile).toBeDefined();
    expect(writeFile!.count).toBe(1);
  });

  it("open/close database multiple times without connection leak", () => {
    const dbPath = tempDbPath();
    const db1 = new TrackingDatabase(dbPath);
    db1.insertRoutingLog(makeEntry({ sessionId: "leak-1" }));
    db1.close();

    // Reopen same file
    const db2 = new TrackingDatabase(dbPath);
    const summary = db2.getCostSummary();
    expect(summary.totalRequests).toBe(1);
    db2.close();

    // Third time
    const db3 = new TrackingDatabase(dbPath);
    const summary3 = db3.getCostSummary();
    expect(summary3.totalRequests).toBe(1);
    db3.close();

    // Clean up
    try { fs.unlinkSync(dbPath); } catch {}
  });
});
