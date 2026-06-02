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
      const rows = (this.db as any).db
        .prepare("SELECT model, step_type, avg_accuracy, avg_latency_ms, avg_cost_per_task, sample_count FROM model_scores")
        .all() as Array<{ model: string; step_type: string; avg_accuracy: number; avg_latency_ms: number; avg_cost_per_task: number; sample_count: number }>;
      for (const row of rows) {
        const key = `${row.model}::${row.step_type}`;
        this.modelScores.set(key, {
          model: row.model,
          stepType: row.step_type,
          avgAccuracy: row.avg_accuracy,
          avgLatencyMs: row.avg_latency_ms,
          avgCostPerTask: row.avg_cost_per_task,
          sampleCount: row.sample_count,
        });
      }
    } catch {}
  }

  persistToDB(): void {
    if (!this.dirty) return;
    try {
      const upsert = (this.db as any).db.prepare(`
        INSERT INTO model_scores (model, step_type, avg_accuracy, avg_latency_ms, avg_cost_per_task, sample_count, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(model, step_type) DO UPDATE SET
          avg_accuracy = excluded.avg_accuracy,
          avg_latency_ms = excluded.avg_latency_ms,
          avg_cost_per_task = excluded.avg_cost_per_task,
          sample_count = excluded.sample_count,
          last_updated = datetime('now')
      `);
      const batch = (this.db as any).db.transaction((scores: ModelScore[]) => {
        for (const s of scores) {
          upsert.run(s.model, s.stepType, s.avgAccuracy, s.avgLatencyMs, s.avgCostPerTask, s.sampleCount);
        }
      });
      batch(Array.from(this.modelScores.values()));
      this.dirty = false;
    } catch {}
  }
}
