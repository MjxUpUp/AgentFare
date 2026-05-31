export type QualitySignal =
  | "success"
  | "retry"
  | "manual_switch"
  | "task_abandoned"
  | "error";

export interface QualitySignalEvent {
  sessionId: string;
  signal: QualitySignal;
  model: string;
  stepType: string;
  timestamp: Date;
}

export class QualitySignalCollector {
  private lastRoutedModels: Map<string, string> = new Map();
  private routedTiers: Map<string, string> = new Map();
  private sessionLastRequest: Map<
    string,
    { model: string; stepType: string; timestamp: number }
  > = new Map();

  recordRoutedModel(sessionId: string, model: string, tier: string): void {
    this.lastRoutedModels.set(sessionId, model);
    this.routedTiers.set(sessionId, tier);
  }

  recordRequest(
    sessionId: string,
    model: string,
    stepType: string
  ): void {
    this.sessionLastRequest.set(sessionId, {
      model,
      stepType,
      timestamp: Date.now(),
    });
  }

  detectManualSwitch(sessionId: string, currentModel: string): boolean {
    const lastRouted = this.lastRoutedModels.get(sessionId);
    if (!lastRouted) return false;
    if (currentModel === lastRouted) return false;
    return !isOurRouting(currentModel, lastRouted);
  }

  detectRetry(sessionId: string): boolean {
    const last = this.sessionLastRequest.get(sessionId);
    if (!last) return false;
    return Date.now() - last.timestamp < 10000;
  }

  detectAbandoned(sessionId: string): boolean {
    const last = this.sessionLastRequest.get(sessionId);
    if (!last) return false;
    return Date.now() - last.timestamp > 300000;
  }

  recordSignal(
    model: string,
    stepType: string,
    signal: QualitySignal
  ): void {
    // Signal consumed by OnlineLearner
  }

  inferFinalSignal(sessionId: string): QualitySignalEvent | null {
    const last = this.sessionLastRequest.get(sessionId);
    if (!last) return null;
    return {
      sessionId,
      signal: "success",
      model: last.model,
      stepType: last.stepType,
      timestamp: new Date(),
    };
  }
}

function isOurRouting(currentModel: string, lastRouted: string): boolean {
  const currentParts = currentModel.split("/");
  const lastParts = lastRouted.split("/");
  if (currentParts.length < 2 || lastParts.length < 2) return false;
  return currentParts[0] === lastParts[0];
}
