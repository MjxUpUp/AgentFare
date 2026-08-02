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

// ── cc-switch 实时锁定（与 packages/proxy/src/admin.ts 的 ActiveLock 对齐）──

export type LockMode = "auto" | "model" | "provider";

/** GET /api/active — 当前路由锁定状态。 */
export interface ActiveLock {
  lockMode: LockMode;
  activeModel: string | null;
  activeProvider: string | null;
}

/** POST /api/active 请求体。 */
export interface ActiveLockRequest {
  lockMode: LockMode;
  /** lockMode="model" 时必填：注册表键，如 "deepseek/v4-pro"。 */
  activeModel?: string;
  /** lockMode="provider" 时必填：如 "deepseek"。 */
  activeProvider?: string;
}

/** POST /api/active 成功响应。 */
export interface ActiveLockResponse {
  ok: true;
  lockMode: LockMode;
  activeModel: string | null;
  activeProvider: string | null;
}

// In dev (vite) the dev proxy forwards /api + /health to 127.0.0.1:3456, so a
// relative path works. In a Tauri production build the webview origin is
// tauri://localhost, where a relative /api/* would 404 — point straight at the
// loopback daemon instead. (vitest runs with DEV=true, so tests stay relative.)
const BASE = import.meta.env.DEV ? "" : "http://127.0.0.1:3456";

/**
 * Shared response handling: surface the daemon's `error` field in the message
 * (pages render e.message verbatim), and wrap non-JSON bodies so a misconfigured
 * proxy returning an HTML error page doesn't leak a raw SyntaxError.
 *
 * Split out of getJson so the POST write path (setActive) reuses the exact same
 * error contract instead of diverging.
 */
async function parseJsonBody<T>(res: Response): Promise<T> {
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

/**
 * GET a JSON endpoint. Calls fetch with a single path argument (no init) —
 * existing tests pin that contract, and dev/prod resolve the same relative
 * path differently via BASE without needing per-call options.
 */
async function getJson<T>(path: string): Promise<T> {
  return parseJsonBody<T>(await fetch(BASE + path));
}

/**
 * POST a JSON body with extra headers (the cc-switch write endpoint needs an
 * admin-token header). content-type is always application/json; callers pass
 * only the auth/extra headers.
 */
async function postJson<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  return parseJsonBody<T>(
    await fetch(BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
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

  // ── cc-switch 实时锁定 ──

  /** 当前路由锁定状态（GET /api/active）。 */
  active: () => getJson<ActiveLock>("/api/active"),

  /** admin 写端点 token（GET /api/admin-token）；null 表示 daemon 未启用写端点。 */
  adminToken: () => getJson<{ token: string | null }>("/api/admin-token"),

  /**
   * 切换路由锁定（POST /api/active）。写端点 token-gated：先从 loopback 的
   * /api/admin-token bootstrap token，再带 x-agentfare-admin-token 头发 POST。
   * daemon 收到后热加载 config，下一个请求即按新锁定路由——无需重启。
   */
  setActive: async (lock: ActiveLockRequest): Promise<ActiveLockResponse> => {
    const { token } = await getJson<{ token: string | null }>("/api/admin-token");
    const headers: Record<string, string> = {};
    if (token) headers["x-agentfare-admin-token"] = token;
    return postJson<ActiveLockResponse>("/api/active", lock, headers);
  },
};
