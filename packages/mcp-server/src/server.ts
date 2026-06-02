import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TrackingDatabase, generateReport, parsePipelineYAML, bruteForceSearch } from "@agentfare/core";
import { ModelRegistry, getDbPath } from "@agentfare/models";

export interface ServerDeps {
  db: TrackingDatabase;
  registry: ModelRegistry;
}

/**
 * Create an MCP Server instance with all tool handlers registered.
 * Accepts explicit dependencies for testability.
 * When no deps provided, uses production singletons.
 */
export function createServer(deps?: Partial<ServerDeps>): McpServer {
  const db = deps?.db ?? new TrackingDatabase(getDbPath());
  const registry = deps?.registry ?? new ModelRegistry();

  // Register exit cleanup only for the production singleton path
  if (!deps?.db) {
    process.on("exit", () => { try { db.close(); } catch {} });
  }

  const server = new McpServer({ name: "agentfare", version: "0.1.0" });

  server.tool("get_cost_report", "获取 AgentFare 成本报告", { timeRange: z.string().optional().describe("时间范围 (1d, 7d, 30d)") }, async (params) => {
    const report = generateReport(db, params.timeRange);
    return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
  });

  server.tool("models_list", "列出所有可用模型", {}, async () => {
    const models = registry.getAll().map((m) => ({
      id: m.id, provider: m.provider, tier: m.tier,
      pricing: { input: `$${m.pricing.inputPerMillion}/MTok`, output: `$${m.pricing.outputPerMillion}/MTok` },
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(models, null, 2) }] };
  });

  server.tool("optimize_pipeline", "优化模型组合", { pipeline: z.string().describe("Pipeline YAML") }, async (params) => {
    const pipeline = parsePipelineYAML(params.pipeline);
    const costFn = (combo: Record<string, string>) =>
      Object.values(combo).reduce((sum, m) => { const entry = registry.get(m); return sum + (entry ? entry.pricing.inputPerMillion + entry.pricing.outputPerMillion : 10); }, 0);
    const results = bruteForceSearch(pipeline, costFn);
    return { content: [{ type: "text" as const, text: JSON.stringify(results.slice(0, 5), null, 2) }] };
  });

  return server;
}
