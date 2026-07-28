// Admin API client — mirrors the loopback-only endpoints in
// packages/proxy/src/admin.ts. Types are re-declared here (the GUI is a
// browser bundle and must not import node-only @agentfare/core); keep them
// in sync with the daemon's response shapes.

export interface CostSummary {
  totalRequests: number;
  totalOriginalCost: number;
  totalActualCost: number;
  totalSavings: number;
}

export interface StepToolSummary {
  key: string;
  count: number;
  totalCost: number;
  totalSavings: number;
}

export interface CostResponse {
  summary: CostSummary;
  byStep: StepToolSummary[];
  byTool: StepToolSummary[];
}

export interface RoutingLogRow {
  id: number;
  timestamp: string;
  session_id: string;
  tool: string;
  step_type: string;
  original_model: string;
  routed_model: string;
  difficulty: number | null;
  confidence: number | null;
  reasoning: string | null;
  input_tokens: number;
  output_tokens: number;
  original_cost: number;
  actual_cost: number;
  savings: number;
  quality_signal: string | null;
}

export interface ModelInfo {
  id: string;
  provider: string;
  tier: string;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
}

export interface ModelScore {
  model: string;
  stepType: string;
  avgAccuracy: number;
  avgLatencyMs: number;
  avgCostPerTask: number;
  sampleCount: number;
}

export interface ProviderInfo {
  provider: string;
  protocol: "openai" | "anthropic";
  upstreamBaseUrl: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      // non-JSON body — fall back to status text
    }
    throw new Error(`${res.status} ${detail || res.statusText}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    // 200 with a non-JSON body (e.g. an HTML error page from a misconfigured
    // proxy) would otherwise surface as a raw "Unexpected token..." SyntaxError.
    throw new Error(`${res.status} invalid JSON body`);
  }
}

export const adminApi = {
  health: () =>
    getJson<{ status: string; service: string }>("/health"),
  cost: (range?: string) =>
    getJson<CostResponse>(`/api/cost${range ? `?range=${encodeURIComponent(range)}` : ""}`),
  logs: (limit?: number) =>
    getJson<{ logs: RoutingLogRow[] }>(`/api/logs${limit != null ? `?limit=${limit}` : ""}`),
  models: () => getJson<{ models: ModelInfo[] }>("/api/models"),
  scores: () => getJson<{ scores: ModelScore[] }>("/api/scores"),
  providers: () =>
    getJson<{ providers: Record<string, ProviderInfo> }>("/api/providers"),
};
