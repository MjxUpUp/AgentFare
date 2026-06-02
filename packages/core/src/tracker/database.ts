import * as path from "node:path";
import * as fs from "node:fs";

let Database: typeof import("better-sqlite3") | undefined;
try {
  Database = require("better-sqlite3");
} catch {
  // better-sqlite3 is an optional native dependency.
  // It requires a C++ toolchain to compile; without it, TrackingDatabase will
  // throw a clear error at construction time rather than failing at install.
}

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

// ISSUE-042: Strongly typed query result
export interface RoutingLogRow {
  id: number;
  timestamp: string;
  session_id: string;
  tool: string;
  step_type: string;
  original_model: string;
  routed_model: string;
  difficulty: number | null;
  confidence: number | null;
  reasoning: string | null;
  input_tokens: number;
  output_tokens: number;
  original_cost: number;
  actual_cost: number;
  savings: number;
  quality_signal: string | null;
}

// ISSUE-036: SQL-level aggregation result
export interface StepToolSummary {
  key: string;
  count: number;
  totalCost: number;
  totalSavings: number;
}

/** Check whether better-sqlite3 is available in the current environment. */
export function isSqliteAvailable(): boolean {
  return Database !== undefined;
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
  private db: InstanceType<NonNullable<typeof Database>>;

  constructor(dbPath: string) {
    if (!Database) {
      throw new Error(
        "better-sqlite3 is not available. " +
        "Please install it (requires a C++ build toolchain) or use a storage backend that does not depend on SQLite."
      );
    }
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
  }): RoutingLogRow[] {
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
      .all(...params) as RoutingLogRow[];
  }

  // ISSUE-036: SQL-level aggregation to avoid loading all rows into memory
  getStepSummary(timeRange?: string): StepToolSummary[] {
    return this.aggregateBy("step_type", timeRange);
  }

  getToolSummary(timeRange?: string): StepToolSummary[] {
    return this.aggregateBy("tool", timeRange);
  }

  // ISSUE-062: whitelist allowed aggregation columns to prevent SQL injection
  private static readonly ALLOWED_AGG_COLUMNS = ["step_type", "tool"] as const;

  private aggregateBy(column: string, timeRange?: string): StepToolSummary[] {
    if (!(TrackingDatabase.ALLOWED_AGG_COLUMNS as readonly string[]).includes(column)) {
      throw new Error(`Invalid aggregation column: ${column}`);
    }
    const timeCondition = timeRange
      ? `WHERE timestamp >= datetime('now', ?)`
      : "";
    const stmt = timeRange
      ? this.db.prepare(
          `SELECT ${column} as key, COUNT(*) as count, COALESCE(SUM(actual_cost), 0) as totalCost, COALESCE(SUM(savings), 0) as totalSavings FROM routing_logs ${timeCondition} GROUP BY ${column} ORDER BY totalCost DESC`
        )
      : this.db.prepare(
          `SELECT ${column} as key, COUNT(*) as count, COALESCE(SUM(actual_cost), 0) as totalCost, COALESCE(SUM(savings), 0) as totalSavings FROM routing_logs GROUP BY ${column} ORDER BY totalCost DESC`
        );
    const params = timeRange ? [`-${parseTimeRange(timeRange)}`] : [];
    return stmt.all(...params) as StepToolSummary[];
  }

  getCostSummary(timeRange?: string): CostSummary {
    // ISSUE-008: use parameterized query instead of string interpolation
    const stmt = timeRange
      ? this.db.prepare(
          `SELECT
            COUNT(*) as totalRequests,
            COALESCE(SUM(original_cost), 0) as totalOriginalCost,
            COALESCE(SUM(actual_cost), 0) as totalActualCost,
            COALESCE(SUM(savings), 0) as totalSavings
           FROM routing_logs
           WHERE timestamp >= datetime('now', ?)`
        )
      : this.db.prepare(
          `SELECT
            COUNT(*) as totalRequests,
            COALESCE(SUM(original_cost), 0) as totalOriginalCost,
            COALESCE(SUM(actual_cost), 0) as totalActualCost,
            COALESCE(SUM(savings), 0) as totalSavings
           FROM routing_logs`
        );
    const params = timeRange ? [`-${parseTimeRange(timeRange)}`] : [];
    const row = stmt.get(...params) as any;
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
  if (!match) throw new Error(`Invalid timeRange: "${range}". Expected format: <number><d|h|m> (e.g. "7d", "24h", "30m")`);
  const [, num, unit] = match;
  // regex guarantees unit is one of d/h/m
  if (unit === "d") return `${num} days`;
  if (unit === "h") return `${num} hours`;
  return `${num} minutes`;
}
