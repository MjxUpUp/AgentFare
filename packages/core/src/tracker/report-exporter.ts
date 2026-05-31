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

  // Build by-step report
  const logs = db.queryLogs({});
  const stepMap = new Map<string, { count: number; totalCost: number; totalSavings: number }>();
  const toolMap = new Map<string, { count: number; totalCost: number; totalSavings: number }>();

  for (const log of logs) {
    const step = log.step_type as string;
    const tool = log.tool as string;
    const cost = (log.actual_cost as number) ?? 0;
    const savings = (log.savings as number) ?? 0;

    const stepEntry = stepMap.get(step) ?? { count: 0, totalCost: 0, totalSavings: 0 };
    stepEntry.count++;
    stepEntry.totalCost += cost;
    stepEntry.totalSavings += savings;
    stepMap.set(step, stepEntry);

    const toolEntry = toolMap.get(tool) ?? { count: 0, totalCost: 0, totalSavings: 0 };
    toolEntry.count++;
    toolEntry.totalCost += cost;
    toolEntry.totalSavings += savings;
    toolMap.set(tool, toolEntry);
  }

  const byStep: StepReport[] = Array.from(stepMap.entries()).map(([stepType, data]) => ({
    stepType,
    count: data.count,
    totalCost: data.totalCost,
    totalSavings: data.totalSavings,
    avgSavingsPct: data.totalCost > 0 ? (data.totalSavings / (data.totalCost + data.totalSavings)) * 100 : 0,
  }));

  const byTool: ToolReport[] = Array.from(toolMap.entries()).map(([tool, data]) => ({
    tool,
    count: data.count,
    totalCost: data.totalCost,
    totalSavings: data.totalSavings,
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
