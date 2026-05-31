import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";

export interface RoutingLogEntry {
  sessionId: string;
  tool: string;
  stepType: string;
  originalModel: string;
  routedModel: string;
  difficulty: number;
  confidence: number;
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
  originalCost: number;
  actualCost: number;
  savings: number;
  qualitySignal?: string | null;
}

export interface CostSummary {
  totalRequests: number;
  totalOriginalCost: number;
  totalActualCost: number;
  totalSavings: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS routing_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
  session_id      TEXT NOT NULL,
  tool            TEXT NOT NULL,
  step_type       TEXT NOT NULL,
  original_model  TEXT NOT NULL,
  routed_model    TEXT NOT NULL,
  difficulty      REAL,
  confidence      REAL,
  reasoning       TEXT,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  original_cost   REAL DEFAULT 0,
  actual_cost     REAL DEFAULT 0,
  savings         REAL DEFAULT 0,
  quality_signal  TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS model_scores (
  model           TEXT NOT NULL,
  step_type       TEXT NOT NULL,
  avg_accuracy    REAL DEFAULT 0.5,
  avg_latency_ms  INTEGER DEFAULT 0,
  avg_cost_per_task REAL DEFAULT 0,
  sample_count    INTEGER DEFAULT 0,
  last_updated    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (model, step_type)
);

CREATE TABLE IF NOT EXISTS pipeline_combos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_name     TEXT NOT NULL,
  combo_json        TEXT NOT NULL,
  estimated_accuracy REAL,
  estimated_cost    REAL,
  pareto_type       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export class TrackingDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  listTables(): string[] {
    const rows = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  insertRoutingLog(entry: RoutingLogEntry): void {
    this.db
      .prepare(
        `
      INSERT INTO routing_logs (session_id, tool, step_type, original_model, routed_model,
        difficulty, confidence, reasoning, input_tokens, output_tokens,
        original_cost, actual_cost, savings, quality_signal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        entry.sessionId,
        entry.tool,
        entry.stepType,
        entry.originalModel,
        entry.routedModel,
        entry.difficulty,
        entry.confidence,
        entry.reasoning,
        entry.inputTokens,
        entry.outputTokens,
        entry.originalCost,
        entry.actualCost,
        entry.savings,
        entry.qualitySignal ?? null
      );
  }

  queryLogs(filter: {
    sessionId?: string;
    tool?: string;
    stepType?: string;
  }): any[] {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filter.sessionId) {
      conditions.push("session_id = ?");
      params.push(filter.sessionId);
    }
    if (filter.tool) {
      conditions.push("tool = ?");
      params.push(filter.tool);
    }
    if (filter.stepType) {
      conditions.push("step_type = ?");
      params.push(filter.stepType);
    }
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT * FROM routing_logs ${where} ORDER BY timestamp DESC`
      )
      .all(...params);
  }

  getCostSummary(timeRange?: string): CostSummary {
    const whereClause = timeRange
      ? `WHERE timestamp >= datetime('now', '-${parseTimeRange(timeRange)}')`
      : "";
    const row = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as totalRequests,
        COALESCE(SUM(original_cost), 0) as totalOriginalCost,
        COALESCE(SUM(actual_cost), 0) as totalActualCost,
        COALESCE(SUM(savings), 0) as totalSavings
      FROM routing_logs
      ${whereClause}
    `
      )
      .get() as any;
    return {
      totalRequests: row.totalRequests,
      totalOriginalCost: row.totalOriginalCost,
      totalActualCost: row.totalActualCost,
      totalSavings: row.totalSavings,
    };
  }

  close(): void {
    this.db.close();
  }
}

function parseTimeRange(range: string): string {
  const match = range.match(/^(\d+)([dhm])$/);
  if (!match) return "30 days";
  const [, num, unit] = match;
  switch (unit) {
    case "d":
      return `${num} days`;
    case "h":
      return `${num} hours`;
    case "m":
      return `${num} minutes`;
    default:
      return "30 days";
  }
}
