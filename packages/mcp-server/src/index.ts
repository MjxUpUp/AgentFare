#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TrackingDatabase, generateReport } from "@agentdispatch/core";
import { ModelRegistry } from "@agentdispatch/models";
import { parsePipelineYAML, bruteForceSearch } from "@agentdispatch/core";
import * as path from "node:path";
import * as os from "node:os";

const server = new McpServer({ name: "agentdispatch", version: "0.1.0" });

const dbPath = path.join(os.homedir(), ".agentdispatch", "data.db");

server.tool("get_cost_report", "获取 AgentDispatch 成本报告", { timeRange: z.string().optional().describe("时间范围 (1d, 7d, 30d)") }, async (params) => {
  const db = new TrackingDatabase(dbPath);
  try {
    const report = generateReport(db, params.timeRange);
    return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
  } finally { db.close(); }
});

server.tool("models_list", "列出所有可用模型", {}, async () => {
  const registry = new ModelRegistry();
  const models = registry.getAll().map((m) => ({
    id: m.id, provider: m.provider, tier: m.tier,
    pricing: { input: `$${m.pricing.inputPerMillion}/MTok`, output: `$${m.pricing.outputPerMillion}/MTok` },
  }));
  return { content: [{ type: "text" as const, text: JSON.stringify(models, null, 2) }] };
});

server.tool("optimize_pipeline", "优化模型组合", { pipeline: z.string().describe("Pipeline YAML") }, async (params) => {
  const pipeline = parsePipelineYAML(params.pipeline);
  const registry = new ModelRegistry();
  const costFn = (combo: Record<string, string>) =>
    Object.values(combo).reduce((sum, m) => { const entry = registry.get(m); return sum + (entry ? entry.pricing.inputPerMillion + entry.pricing.outputPerMillion : 10); }, 0);
  const results = bruteForceSearch(pipeline, costFn);
  return { content: [{ type: "text" as const, text: JSON.stringify(results.slice(0, 5), null, 2) }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
