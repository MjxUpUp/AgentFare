import { Command } from "commander";
import {
  parsePipelineYAML,
  bruteForceSearch,
  epsilonLucbSearch,
  armEliminationSearch,
  hillClimbingSearch,
  DEFAULT_SEARCH_CONFIG,
} from "@agentfare/core";
import type { SearchConfig } from "@agentfare/core";
import { ModelRegistry } from "@agentfare/models";
import * as fs from "node:fs";
import * as path from "node:path";

export const optimizeCommand = new Command("optimize")
  .description("基于历史数据自动搜索最优模型组合")
  .option("--pipeline <file>", "指定 pipeline 定义文件 (YAML)")
  .option(
    "--algorithm <algo>",
    "搜索算法 (brute_force | epsilon_lucb | arm_elimination | hill_climbing)",
    "epsilon_lucb"
  )
  .option("--max-evals <n>", "最大评估次数", "50")
  .action(async (opts) => {
    if (!opts.pipeline) {
      console.error(
        "请指定 pipeline 文件：--pipeline ./my-pipeline.yaml"
      );
      process.exit(1);
    }

    const yaml = fs.readFileSync(opts.pipeline, "utf-8");
    const pipeline = parsePipelineYAML(yaml);

    // Parse and validate --max-evals (previously declared but never forwarded
    // to the search functions, so the flag silently did nothing).
    const maxEvals = parseInt(opts.maxEvals, 10);
    if (!Number.isFinite(maxEvals) || maxEvals <= 0) {
      console.error(`--max-evals 必须是正整数，收到: ${opts.maxEvals}`);
      process.exit(1);
    }
    const config: SearchConfig = {
      ...DEFAULT_SEARCH_CONFIG,
      algorithm: opts.algorithm as SearchConfig["algorithm"],
      maxEvaluations: maxEvals,
    };

    const registry = new ModelRegistry();
    const costFn = (combo: Record<string, string>) =>
      Object.values(combo).reduce((sum, m) => {
        const entry = registry.get(m);
        if (!entry) return sum + 10;
        return sum + entry.pricing.inputPerMillion + entry.pricing.outputPerMillion;
      }, 0);

    let results;
    switch (opts.algorithm) {
      case "brute_force":
        results = bruteForceSearch(pipeline, costFn, undefined, config);
        break;
      case "arm_elimination":
        results = armEliminationSearch(pipeline, costFn, undefined, config);
        break;
      case "hill_climbing":
        results = hillClimbingSearch(pipeline, costFn, undefined, config);
        break;
      case "epsilon_lucb":
      default:
        results = epsilonLucbSearch(pipeline, costFn, undefined, config);
        break;
    }

    console.log(`\n优化结果 (${pipeline.name})`);
    console.log(`${"─".repeat(50)}`);
    for (const combo of results.slice(0, 5)) {
      console.log(`\n  Rank #${combo.rank}:`);
      for (const [step, model] of Object.entries(combo.models))
        console.log(`    ${step}: ${model}`);
      console.log(`    预估成本: $${combo.estimatedCost.toFixed(2)}`);
    }

    const outputPath = path.join(process.cwd(), "agentfare-optimized.json");
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          pipeline: pipeline.name,
          optimizedAt: new Date().toISOString(),
          algorithm: opts.algorithm,
          topCombo: results[0]?.models,
          allResults: results,
        },
        null,
        2
      )
    );
    console.log(`\n结果已写入 ${outputPath}`);
  });
