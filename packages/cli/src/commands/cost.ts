import { Command } from "commander";
import { TrackingDatabase } from "@agentfare/core";
import * as path from "node:path";
import * as os from "node:os";

export const costCommand = new Command("cost")
  .description("查看成本报告")
  .option("--last <period>", "时间范围 (1d, 7d, 30d)", "30d")
  .option("--json", "JSON 格式输出", false)
  .action((opts) => {
    const dbPath = path.join(os.homedir(), ".agentfare", "data.db");
    let db: TrackingDatabase | undefined;
    try {
      db = new TrackingDatabase(dbPath);
      const summary = db.getCostSummary(opts.last);
      const pct =
        summary.totalOriginalCost > 0
          ? ((summary.totalSavings / summary.totalOriginalCost) * 100).toFixed(
              1
            )
          : "0.0";
      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`\n  AgentFare Cost Report`);
        console.log(`  ${"─".repeat(40)}`);
        console.log(`  Total requests:    ${summary.totalRequests}`);
        console.log(
          `  Original cost:     $${summary.totalOriginalCost.toFixed(2)}`
        );
        console.log(
          `  Actual cost:       $${summary.totalActualCost.toFixed(2)}`
        );
        console.log(
          `  Savings:           $${summary.totalSavings.toFixed(2)} (${pct}%)\n`
        );
      }
    } catch (err) {
      console.error(`无法打开数据库: ${(err as Error).message}`);
      process.exit(1);
    } finally {
      db?.close?.();
    }
  });
