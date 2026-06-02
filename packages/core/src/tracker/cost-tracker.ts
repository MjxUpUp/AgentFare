import type { TrackingDatabase, RoutingLogEntry } from "./database.js";
import type { StepAnalysis } from "../analyzer/types.js";
import type { ModelEntry } from "@agentfare/models";

export class CostTracker {
  constructor(private db: TrackingDatabase) {}

  record(
    analysis: StepAnalysis,
    originalModel: string,
    originalModelEntry: ModelEntry | undefined,
    targetModel: ModelEntry,
    sessionId: string,
    tool: string,
    tokenUsage: { input: number; output: number }
  ): void {
    const originalCost = originalModelEntry
      ? this.calculateCostFromEntry(originalModelEntry, tokenUsage)
      : 0;
    const actualCost = this.calculateCostFromEntry(targetModel, tokenUsage);
    const savings = originalCost - actualCost;

    const entry: RoutingLogEntry = {
      sessionId,
      tool,
      stepType: analysis.stepType,
      originalModel,
      routedModel: targetModel.id,
      difficulty: analysis.difficulty,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
      inputTokens: tokenUsage.input,
      outputTokens: tokenUsage.output,
      originalCost,
      actualCost,
      savings,
    };

    this.db.insertRoutingLog(entry);
  }

  private calculateCostFromEntry(
    model: ModelEntry,
    tokens: { input: number; output: number }
  ): number {
    const inputCost =
      (tokens.input / 1_000_000) * model.pricing.inputPerMillion;
    const outputCost =
      (tokens.output / 1_000_000) * model.pricing.outputPerMillion;
    return inputCost + outputCost;
  }
}
