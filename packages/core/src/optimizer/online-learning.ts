import type { TrackingDatabase } from "../tracker/database.js";
import type { QualitySignal } from "../tracker/quality-signal.js";

export interface ModelScore {
  model: string;
  stepType: string;
  avgAccuracy: number;
  avgLatencyMs: number;
  avgCostPerTask: number;
  sampleCount: number;
}

export interface OnlineLearnerConfig {
  minSamplesBeforeSuggest: number;
  suggestionChannel: "cli" | "log" | "off";
  autoApply: boolean;
  windowSize: number;
}

const DEFAULT_CONFIG: OnlineLearnerConfig = {
  minSamplesBeforeSuggest: 50,
  suggestionChannel: "cli",
  autoApply: false,
  windowSize: 200,
};

interface SignalRecord {
  model: string;
  stepType: string;
  signal: QualitySignal;
  timestamp: number;
}

export class OnlineLearner {
  private config: OnlineLearnerConfig;
  private signals: SignalRecord[] = [];
  private modelScores: Map<string, ModelScore> = new Map();
  private dirty: boolean = false;

  constructor(
    private db: TrackingDatabase,
    config?: Partial<OnlineLearnerConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // ISSUE-038: Load historical scores from DB
    this.loadScoresFromDB();
    process.on("exit", () => this.persistToDB());
  }

  recordSignal(
    model: string,
    stepType: string,
    signal: QualitySignal,
  ): void {
    this.signals.push({ model, stepType, signal, timestamp: Date.now() });
    if (this.signals.length > this.config.windowSize) {
      this.signals = this.signals.slice(-this.config.windowSize);
    }
    this.updateModelScore(model, stepType, signal);
  }

  getScore(model: string, stepType: string): ModelScore | undefined {
    const key = `${model}::${stepType}`;
    return this.modelScores.get(key);
  }

  getAllScores(): ModelScore[] {
    return Array.from(this.modelScores.values());
  }

  getSuggestions(): Array<{
    from: string;
    to: string;
    stepType: string;
    reason: string;
  }> {
    const suggestions: Array<{
      from: string;
      to: string;
      stepType: string;
      reason: string;
    }> = [];

    for (const score of this.modelScores.values()) {
      if (score.sampleCount < this.config.minSamplesBeforeSuggest) continue;
      if (score.avgAccuracy < 0.5) {
        suggestions.push({
          from: score.model,
          to: "",
          stepType: score.stepType,
          reason: `${score.model} 在 ${score.stepType} 步骤准确率仅 ${(score.avgAccuracy * 100).toFixed(0)}%，建议考虑其他模型`,
        });
      }
    }

    return suggestions;
  }

  private updateModelScore(
    model: string,
    stepType: string,
    signal: QualitySignal,
  ): void {
    const key = `${model}::${stepType}`;
    const existing = this.modelScores.get(key);

    const accuracy =
      signal === "success"
        ? 1.0
        : signal === "retry"
          ? 0.3
          : signal === "manual_switch"
            ? 0.0
            : signal === "error"
              ? 0.0
              : 0.5;

    if (existing) {
      const totalSamples = existing.sampleCount + 1;
      existing.avgAccuracy =
        (existing.avgAccuracy * existing.sampleCount + accuracy) / totalSamples;
      existing.sampleCount = totalSamples;
    } else {
      this.modelScores.set(key, {
        model,
        stepType,
        avgAccuracy: accuracy,
        avgLatencyMs: 0,
        avgCostPerTask: 0,
        sampleCount: 1,
      });
    }
    this.dirty = true;
  }

  private loadScoresFromDB(): void {
    try {
      const rows = this.db.loadAllModelScores();
      for (const row of rows) {
        const key = `${row.model}::${row.stepType}`;
        this.modelScores.set(key, {
          model: row.model,
          stepType: row.stepType,
          avgAccuracy: row.avgAccuracy,
          avgLatencyMs: row.avgLatencyMs,
          avgCostPerTask: row.avgCostPerTask,
          sampleCount: row.sampleCount,
        });
      }
    } catch (err) {
      console.warn("[agentfare] Failed to load scores from DB:", err instanceof Error ? err.message : err);
    }
  }

  persistToDB(): void {
    if (!this.dirty) return;
    try {
      this.db.upsertModelScores(Array.from(this.modelScores.values()));
      this.dirty = false;
    } catch (err) {
      console.warn("[agentfare] Failed to persist scores to DB:", err instanceof Error ? err.message : err);
    }
  }
}
