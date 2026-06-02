import { Command } from "commander";
import { ModelRegistry, fetchRemoteModels, mergeRemoteModels, saveRemoteModels, BUILTIN_MODELS } from "@agentfare/models";

export const modelsCommand = new Command("models").description(
  "模型管理"
);

modelsCommand
  .command("list")
  .description("列出所有可用模型")
  .option("--provider <provider>", "按 provider 过滤")
  .option("--tier <tier>", "按 tier 过滤")
  .action((opts) => {
    const registry = new ModelRegistry();
    let models = registry.getAll();
    if (opts.provider)
      models = models.filter((m) => m.provider === opts.provider);
    if (opts.tier) models = models.filter((m) => m.tier === opts.tier);
    for (const m of models) {
      console.log(
        `${m.id.padEnd(35)} tier=${m.tier.padEnd(10)} in=$${m.pricing.inputPerMillion}/MTok  out=$${m.pricing.outputPerMillion}/MTok`
      );
    }
  });

modelsCommand
  .command("update")
  .description("手动拉取最新模型数据")
  .action(async () => {
    try {
      const remote = await fetchRemoteModels();
      if (remote.length === 0) {
        console.log("没有可用的远程模型更新");
        return;
      }
      const merged = mergeRemoteModels(BUILTIN_MODELS, remote);
      saveRemoteModels(merged);
      console.log(`更新完成: ${remote.length} 个模型已更新`);
    } catch (err) {
      console.error(`远程更新失败: ${(err as Error).message}`);
      process.exit(1);
    }
  });
