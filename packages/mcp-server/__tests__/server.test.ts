/**
 * @agentfare/mcp-server tests
 *
 * Uses the official MCP SDK InMemoryTransport for in-process integration testing.
 * Tests the full MCP protocol stack: Client → InMemoryTransport → Server → Tool Handler.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type ServerDeps } from "../src/server.js";
import { TrackingDatabase } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";

async function connectTestClient(deps: Partial<ServerDeps>) {
  const mcpServer = createServer(deps);
  const client = new Client({ name: "test-client", version: "1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    mcpServer.server.connect(serverTransport),
  ]);
  return { client, mcpServer };
}

describe("MCP Server — get_cost_report", () => {
  let dbPath: string;
  let db: TrackingDatabase;
  let client: Client;
  let mcpServer: ReturnType<typeof createServer>;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `agentfare-mcp-test-${Date.now()}.db`);
    db = new TrackingDatabase(dbPath);
    const connected = await connectTestClient({ db });
    client = connected.client;
    mcpServer = connected.mcpServer;
  });

  afterEach(async () => {
    await client.close();
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("should return a valid cost report via MCP protocol", async () => {
    db.insertRoutingLog({
      sessionId: "s1",
      tool: "codex",
      stepType: "exploration",
      originalModel: "openai/gpt-5.5",
      routedModel: "openai/gpt-5.3-codex-spark",
      difficulty: 0.2,
      confidence: 0.9,
      reasoning: "simple task",
      inputTokens: 1000,
      outputTokens: 500,
      originalCost: 0.09,
      actualCost: 0.0015,
      savings: 0.0885,
    });

    const result = await client.callTool({ name: "get_cost_report", arguments: {} });
    expect(result.content).toBeDefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const report = JSON.parse(text);
    expect(report.summary.totalRequests).toBe(1);
    expect(report.summary.totalSavings).toBeCloseTo(0.0885);
    expect(report.summary.savingsPct).toBeGreaterThan(0);
  });

  it("should handle empty database without error", async () => {
    const result = await client.callTool({ name: "get_cost_report", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const report = JSON.parse(text);
    expect(report.summary.totalRequests).toBe(0);
    expect(report.summary.savingsPct).toBe(0);
  });

  it("should accept timeRange parameter", async () => {
    const result = await client.callTool({ name: "get_cost_report", arguments: { timeRange: "7d" } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const report = JSON.parse(text);
    expect(report.summary).toBeDefined();
  });
});

describe("MCP Server — models_list", () => {
  let client: Client;

  beforeEach(async () => {
    const connected = await connectTestClient({ registry: new ModelRegistry() });
    client = connected.client;
  });

  afterEach(async () => {
    await client.close();
  });

  it("should list all models with pricing via MCP protocol", async () => {
    const result = await client.callTool({ name: "models_list", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const models = JSON.parse(text);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.id).toBeTruthy();
      expect(m.provider).toBeTruthy();
      expect(["fast", "standard", "powerful"]).toContain(m.tier);
      expect(m.pricing.input).toMatch(/\$/);
      expect(m.pricing.output).toMatch(/\$/);
    }
  });
});

describe("MCP Server — optimize_pipeline", () => {
  let client: Client;

  beforeEach(async () => {
    const connected = await connectTestClient({ registry: new ModelRegistry() });
    client = connected.client;
  });

  afterEach(async () => {
    await client.close();
  });

  it("should optimize a pipeline via MCP protocol", async () => {
    const yaml = `
name: test-pipeline
- id: step1
  description: "First step"
  candidates:
    - openai/gpt-5.4
    - openai/gpt-5.3-codex-spark
`;
    const result = await client.callTool({ name: "optimize_pipeline", arguments: { pipeline: yaml } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const results = JSON.parse(text);
    expect(results).toHaveLength(2);
    expect(results[0].models).toBeDefined();
    expect(results[0].models.step1).toBeTruthy();
  });

  it("should return top 5 results max", async () => {
    const yaml = `
name: many-candidates
- id: step1
  candidates:
    - openai/gpt-5.4
    - openai/gpt-5.3-codex-spark
- id: step2
  candidates:
    - openai/gpt-5.4
    - anthropic/claude-sonnet-4-6
    - anthropic/claude-haiku-4-5
`;
    const result = await client.callTool({ name: "optimize_pipeline", arguments: { pipeline: yaml } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const results = JSON.parse(text);
    expect(results.length).toBeLessThanOrEqual(5);
  });
});

describe("MCP Server — tool registration", () => {
  let client: Client;

  beforeEach(async () => {
    const connected = await connectTestClient({});
    client = connected.client;
  });

  afterEach(async () => {
    await client.close();
  });

  it("should register all 3 tools and list them via tools/list", async () => {
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("get_cost_report");
    expect(toolNames).toContain("models_list");
    expect(toolNames).toContain("optimize_pipeline");
    expect(toolNames).toHaveLength(3);
  });
});
