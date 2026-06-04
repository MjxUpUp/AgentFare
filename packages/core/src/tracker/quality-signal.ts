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
  private static readonly MAX_SESSION_MAP_SIZE = 5000;

  private lastRoutedModels: Map<string, string> = new Map();
  private routedTiers: Map<string, string> = new Map();
  private sessionLastRequest: Map<
    string,
    { model: string; stepType: string; timestamp: number }
  > = new Map();
  private signals: Array<{
    sessionId: string;
    model: string;
    stepType: string;
    signal: QualitySignal;
    timestamp: number;
  }> = [];

  recordRoutedModel(sessionId: string, model: string, tier: string): void {
    this.evictIfNeeded(this.lastRoutedModels);
    this.evictIfNeeded(this.routedTiers);
    this.lastRoutedModels.set(sessionId, model);
    this.routedTiers.set(sessionId, tier);
  }

  recordRequest(
    sessionId: string,
    model: string,
    stepType: string
  ): void {
    this.evictIfNeeded(this.sessionLastRequest);
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
    signal: QualitySignal,
    sessionId?: string
  ): void {
    this.signals.push({
      sessionId: sessionId ?? "",
      model,
      stepType,
      signal,
      timestamp: Date.now(),
    });
    // Keep bounded to prevent memory leak
    if (this.signals.length > 1000) {
      this.signals = this.signals.slice(-500);
    }
  }

  getSignals(): Array<{
    sessionId: string;
    model: string;
    stepType: string;
    signal: QualitySignal;
    timestamp: number;
  }> {
    return this.signals;
  }

  inferFinalSignal(sessionId: string): QualitySignalEvent | null {
    const last = this.sessionLastRequest.get(sessionId);
    if (!last) return null;

    // Find the worst signal for this session: error > task_abandoned > retry > manual_switch > success
    const priority: Record<QualitySignal, number> = {
      error: 4,
      task_abandoned: 3,
      retry: 2,
      manual_switch: 1,
      success: 0,
    };
    const sessionSignals = this.signals.filter(
      (s) => s.sessionId === sessionId
    );
    let worstSignal: QualitySignal = "success";
    let worstPriority = 0;
    for (const s of sessionSignals) {
      const p = priority[s.signal] ?? 0;
      if (p > worstPriority) {
        worstPriority = p;
        worstSignal = s.signal;
      }
    }

    return {
      sessionId,
      signal: worstSignal,
      model: last.model,
      stepType: last.stepType,
      timestamp: new Date(),
    };
  }

  private evictIfNeeded(map: Map<string, unknown>): void {
    if (map.size < QualitySignalCollector.MAX_SESSION_MAP_SIZE) return;
    // Delete oldest half (first entries in insertion order)
    const toDelete = Math.floor(map.size / 2);
    let deleted = 0;
    for (const key of map.keys()) {
      if (deleted >= toDelete) break;
      map.delete(key);
      deleted++;
    }
  }
}

function isOurRouting(currentModel: string, lastRouted: string): boolean {
  const currentParts = currentModel.split("/");
  const lastParts = lastRouted.split("/");
  if (currentParts.length < 2 || lastParts.length < 2) return false;
  return currentParts[0] === lastParts[0];
}
