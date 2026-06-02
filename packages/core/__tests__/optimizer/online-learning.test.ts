import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OnlineLearner } from "../../src/optimizer/online-learning.js";
import { TrackingDatabase } from "../../src/tracker/database.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("OnlineLearner", () => {
  let db: TrackingDatabase;
  let dbPath: string;
  let learner: OnlineLearner;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `agentfare-learner-test-${Date.now()}.db`,
    );
    db = new TrackingDatabase(dbPath);
    learner = new OnlineLearner(db, { windowSize: 10 });
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("should update model scores based on quality signals", () => {
    for (let i = 0; i < 5; i++) {
      learner.recordSignal(
        "openai/gpt-5.3-codex-spark",
        "exploration",
        "success",
      );
    }
    const score = learner.getScore(
      "openai/gpt-5.3-codex-spark",
      "exploration",
    );
    expect(score).toBeDefined();
    expect(score!.sampleCount).toBe(5);
    expect(score!.avgAccuracy).toBeGreaterThan(0.5);
  });

  it("should degrade score on retry signals", () => {
    learner.recordSignal(
      "openai/gpt-5.3-codex-spark",
      "editing",
      "success",
    );
    learner.recordSignal("openai/gpt-5.3-codex-spark", "editing", "retry");
    const score = learner.getScore("openai/gpt-5.3-codex-spark", "editing");
    expect(score!.avgAccuracy).toBeLessThan(1.0);
  });

  it("should generate suggestions for poor-performing models", () => {
    for (let i = 0; i < 50; i++) {
      learner.recordSignal("openai/gpt-5.3-codex-spark", "editing", "error");
    }
    const suggestions = learner.getSuggestions();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].from).toBe("openai/gpt-5.3-codex-spark");
  });
});
