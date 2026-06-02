import type { TrackingDatabase } from "./database.js";

export interface StepReport {
  stepType: string;
  count: number;
  totalCost: number;
  totalSavings: number;
  avgSavingsPct: number;
}

export interface ToolReport {
  tool: string;
  count: number;
  totalCost: number;
  totalSavings: number;
}

export interface CostReport {
  summary: {
    totalRequests: number;
    totalOriginalCost: number;
    totalActualCost: number;
    totalSavings: number;
    savingsPct: number;
  };
  byStep: StepReport[];
  byTool: ToolReport[];
  generatedAt: string;
}

export function generateReport(db: TrackingDatabase, timeRange?: string): CostReport {
  const summary = db.getCostSummary(timeRange);
  const savingsPct = summary.totalOriginalCost > 0
    ? (summary.totalSavings / summary.totalOriginalCost) * 100
    : 0;

  // ISSUE-036: Use SQL-level aggregation instead of loading all rows into memory
  const stepRows = db.getStepSummary(timeRange);
  const toolRows = db.getToolSummary(timeRange);

  const byStep: StepReport[] = stepRows.map((row) => ({
    stepType: row.key,
    count: row.count,
    totalCost: row.totalCost,
    totalSavings: row.totalSavings,
    // ISSUE-037: guard against division by zero
    avgSavingsPct: (() => { const denom = row.totalCost + row.totalSavings; return Math.abs(denom) > 0.01 ? (row.totalSavings / denom) * 100 : 0; })(),
  }));

  const byTool: ToolReport[] = toolRows.map((row) => ({
    tool: row.key,
    count: row.count,
    totalCost: row.totalCost,
    totalSavings: row.totalSavings,
  }));

  return {
    summary: {
      totalRequests: summary.totalRequests,
      totalOriginalCost: summary.totalOriginalCost,
      totalActualCost: summary.totalActualCost,
      totalSavings: summary.totalSavings,
      savingsPct,
    },
    byStep,
    byTool,
    generatedAt: new Date().toISOString(),
  };
}
