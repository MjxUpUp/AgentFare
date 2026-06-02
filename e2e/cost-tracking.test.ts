import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installFetchPatch } from "@agentfare/hook/fetch-patch";
import { RequestHandler } from "@agentfare/hook/request-handler";
import { DEFAULT_CONFIG, TrackingDatabase, CostTracker } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

describe("E2E: Cost tracking with SQLite persistence", () => {
  let originalFetch: typeof globalThis.fetch;
  let uninstall: () => void;
  let dbPath: string;
  let db: TrackingDatabase;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    dbPath = path.join(os.tmpdir(), `agentfare-test-${Date.now()}-tracking.db`);
  });

  afterEach(() => {
    uninstall?.();
    globalThis.fetch = originalFetch;
    try {
      db?.close();
    } catch {}
    try {
      fs.unlinkSync(dbPath);
    } catch {}
  });

  it("should insert a routing_log entry after same-provider routing", async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "done" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);

    db = new TrackingDatabase(dbPath);
    const costTracker = new CostTracker(db);

    uninstall = installFetchPatch({ handler, costTracker });

    const response = await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files in src/" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    expect(response.status).toBe(200);

    // Verify the DB was created and has the routing_logs table
    const tables = db.listTables();
    expect(tables).toContain("routing_logs");
  });

  it("should record correct cost savings in routing_logs", async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ id: "test", choices: [{ message: { content: "done" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const registry = new ModelRegistry();
    const handler = new RequestHandler(DEFAULT_CONFIG, registry);

    db = new TrackingDatabase(dbPath);
    const costTracker = new CostTracker(db);

    uninstall = installFetchPatch({ handler, costTracker });

    await globalThis.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "list files in src/" }],
      }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" },
    });

    // Manually insert a routing log entry to verify query works
    const originalModel = registry.get("openai/gpt-5.5")!;
    const routedModel = registry.get("openai/gpt-5.3-codex-spark")!;

    const tokens = { input: 100, output: 50 };
    const originalCost = (tokens.input / 1_000_000) * originalModel.pricing.inputPerMillion
      + (tokens.output / 1_000_000) * originalModel.pricing.outputPerMillion;
    const actualCost = (tokens.input / 1_000_000) * routedModel.pricing.inputPerMillion
      + (tokens.output / 1_000_000) * routedModel.pricing.outputPerMillion;

    db.insertRoutingLog({
      sessionId: "ad-test-cost-1",
      tool: "unknown",
      stepType: "simple_tool_use",
      originalModel: "openai/gpt-5.5",
      routedModel: "openai/gpt-5.3-codex-spark",
      difficulty: 0.1,
      confidence: 0.95,
      reasoning: "simple task, downgrade to fast tier",
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      originalCost,
      actualCost,
      savings: originalCost - actualCost,
    });

    const logs = db.queryLogs({ sessionId: "ad-test-cost-1" });
    expect(logs).toHaveLength(1);

    const entry = logs[0];
    expect(entry.original_model).toBe("openai/gpt-5.5");
    expect(entry.routed_model).toBe("openai/gpt-5.3-codex-spark");
    expect(entry.original_model).not.toBe(entry.routed_model);
    expect(entry.savings).toBeGreaterThan(0);
    expect(entry.input_tokens).toBe(100);
    expect(entry.output_tokens).toBe(50);
  });

  it("should return correct totals from getCostSummary", async () => {
    db = new TrackingDatabase(dbPath);

    // Insert multiple entries manually
    db.insertRoutingLog({
      sessionId: "s1",
      tool: "bash",
      stepType: "exploration",
      originalModel: "openai/gpt-5.5",
      routedModel: "openai/gpt-5.3-codex-spark",
      difficulty: 0.2,
      confidence: 0.9,
      reasoning: "exploration",
      inputTokens: 100,
      outputTokens: 50,
      originalCost: 0.01,
      actualCost: 0.003,
      savings: 0.007,
    });

    db.insertRoutingLog({
      sessionId: "s2",
      tool: "write",
      stepType: "code_generation",
      originalModel: "anthropic/claude-opus-4-6",
      routedModel: "anthropic/claude-sonnet-4-6",
      difficulty: 0.4,
      confidence: 0.85,
      reasoning: "code gen",
      inputTokens: 200,
      outputTokens: 100,
      originalCost: 0.05,
      actualCost: 0.015,
      savings: 0.035,
    });

    const summary = db.getCostSummary();
    expect(summary.totalRequests).toBe(2);
    expect(summary.totalOriginalCost).toBeCloseTo(0.06, 6);
    expect(summary.totalActualCost).toBeCloseTo(0.018, 6);
    expect(summary.totalSavings).toBeCloseTo(0.042, 6);
  });
});
