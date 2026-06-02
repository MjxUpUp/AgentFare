import { describe, it, expect } from "vitest";
import { generateReport } from "../../src/tracker/report-exporter.js";
import type { CostSummary, StepToolSummary } from "../../src/tracker/database.js";

interface MockDb {
  getCostSummary: (timeRange?: string) => CostSummary;
  getStepSummary: (timeRange?: string) => StepToolSummary[];
  getToolSummary: (timeRange?: string) => StepToolSummary[];
}

function makeMockDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    getCostSummary: overrides.getCostSummary ?? ((_timeRange?: string) => ({
      totalRequests: 0,
      totalOriginalCost: 0,
      totalActualCost: 0,
      totalSavings: 0,
    })),
    getStepSummary: overrides.getStepSummary ?? ((_timeRange?: string) => []),
    getToolSummary: overrides.getToolSummary ?? ((_timeRange?: string) => []),
  };
}

describe("generateReport", () => {
  it("returns zeroed summary with no data", () => {
    const db = makeMockDb();
    const report = generateReport(db as any);

    expect(report.summary.totalRequests).toBe(0);
    expect(report.summary.totalOriginalCost).toBe(0);
    expect(report.summary.totalActualCost).toBe(0);
    expect(report.summary.totalSavings).toBe(0);
    expect(report.summary.savingsPct).toBe(0);
    expect(report.byStep).toEqual([]);
    expect(report.byTool).toEqual([]);
    expect(report.generatedAt).toBeTruthy();
  });

  it("produces no NaN or Infinity when zero requests", () => {
    const db = makeMockDb();
    const report = generateReport(db as any);

    expect(Number.isFinite(report.summary.savingsPct)).toBe(true);
    expect(Number.isNaN(report.summary.savingsPct)).toBe(false);
  });

  // Regression for ISSUE-037: division by zero in avgSavingsPct
  it("does not produce NaN in avgSavingsPct when cost and savings are zero (ISSUE-037)", () => {
    const db = makeMockDb({
      getStepSummary: () => [
        { key: "tool_use", count: 5, totalCost: 0, totalSavings: 0 },
      ],
    });
    const report = generateReport(db as any);

    expect(report.byStep).toHaveLength(1);
    expect(Number.isFinite(report.byStep[0].avgSavingsPct)).toBe(true);
    expect(Number.isNaN(report.byStep[0].avgSavingsPct)).toBe(false);
    expect(report.byStep[0].avgSavingsPct).toBe(0);
  });

  it("computes savingsPct from summary data", () => {
    const db = makeMockDb({
      getCostSummary: () => ({
        totalRequests: 10,
        totalOriginalCost: 1.0,
        totalActualCost: 0.4,
        totalSavings: 0.6,
      }),
    });
    const report = generateReport(db as any);

    expect(report.summary.savingsPct).toBeCloseTo(60);
    expect(report.summary.totalRequests).toBe(10);
    expect(report.summary.totalOriginalCost).toBeCloseTo(1.0);
    expect(report.summary.totalActualCost).toBeCloseTo(0.4);
    expect(report.summary.totalSavings).toBeCloseTo(0.6);
  });

  it("returns savingsPct=0 when totalOriginalCost is 0", () => {
    const db = makeMockDb({
      getCostSummary: () => ({
        totalRequests: 0,
        totalOriginalCost: 0,
        totalActualCost: 0,
        totalSavings: 0,
      }),
    });
    const report = generateReport(db as any);
    expect(report.summary.savingsPct).toBe(0);
  });

  it("groups by step type correctly", () => {
    const db = makeMockDb({
      getStepSummary: () => [
        { key: "tool_use", count: 8, totalCost: 0.05, totalSavings: 0.02 },
        { key: "editing", count: 3, totalCost: 0.10, totalSavings: 0.07 },
      ],
    });
    const report = generateReport(db as any);

    expect(report.byStep).toHaveLength(2);
    expect(report.byStep[0].stepType).toBe("tool_use");
    expect(report.byStep[0].count).toBe(8);
    expect(report.byStep[1].stepType).toBe("editing");
    expect(report.byStep[1].count).toBe(3);
  });

  it("computes avgSavingsPct for steps with non-zero denominator", () => {
    const db = makeMockDb({
      getStepSummary: () => [
        // totalCost + totalSavings = 0.07, totalSavings/0.07 * 100 ≈ 28.57
        { key: "tool_use", count: 5, totalCost: 0.05, totalSavings: 0.02 },
      ],
    });
    const report = generateReport(db as any);

    expect(report.byStep[0].avgSavingsPct).toBeCloseTo(
      (0.02 / (0.05 + 0.02)) * 100
    );
  });

  it("groups by tool correctly", () => {
    const db = makeMockDb({
      getToolSummary: () => [
        { key: "codex", count: 10, totalCost: 0.3, totalSavings: 0.1 },
        { key: "web_search", count: 4, totalCost: 0.1, totalSavings: 0.05 },
      ],
    });
    const report = generateReport(db as any);

    expect(report.byTool).toHaveLength(2);
    expect(report.byTool[0].tool).toBe("codex");
    expect(report.byTool[0].count).toBe(10);
    expect(report.byTool[0].totalCost).toBeCloseTo(0.3);
    expect(report.byTool[0].totalSavings).toBeCloseTo(0.1);
    expect(report.byTool[1].tool).toBe("web_search");
  });

  it("passes timeRange to db methods", () => {
    let capturedRange: string | undefined;
    const db = makeMockDb({
      getCostSummary: (timeRange?: string) => {
        capturedRange = timeRange;
        return { totalRequests: 0, totalOriginalCost: 0, totalActualCost: 0, totalSavings: 0 };
      },
      getStepSummary: (_timeRange?: string) => [],
      getToolSummary: (_timeRange?: string) => [],
    });

    generateReport(db as any, "7d");
    expect(capturedRange).toBe("7d");
  });

  it("passes undefined timeRange when not provided", () => {
    let capturedRange: string | undefined = "SENTINEL";
    const db = makeMockDb({
      getCostSummary: (timeRange?: string) => {
        capturedRange = timeRange;
        return { totalRequests: 0, totalOriginalCost: 0, totalActualCost: 0, totalSavings: 0 };
      },
      getStepSummary: (_timeRange?: string) => [],
      getToolSummary: (_timeRange?: string) => [],
    });

    generateReport(db as any);
    expect(capturedRange).toBeUndefined();
  });
});
