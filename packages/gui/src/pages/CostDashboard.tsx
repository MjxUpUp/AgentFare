import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, type CostResponse, type StepToolSummary } from "../api";
import { moneyUsd } from "../utils";

const RANGES = [
  { label: "全部", value: "" },
  { label: "近 24h", value: "24h" },
  { label: "近 7d", value: "7d" },
  { label: "近 30d", value: "30d" },
];

function Metric({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent?: boolean;
  sub?: string;
}) {
  return (
    <div className={"metric" + (accent ? " accent" : "")}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: StepToolSummary[] }) {
  if (rows.length === 0) return null;
  const maxCost = Math.max(...rows.map((r) => r.totalCost), 0.0001);
  return (
    <section className="breakdown">
      <h3>{title}</h3>
      <div className="bar-list">
        {rows.map((r) => (
          <div className="bar-row" key={r.key}>
            <div className="bar-label" title={r.key}>
              {r.key}
              <span className="bar-count">×{r.count}</span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(r.totalCost / maxCost) * 100}%` }}
              />
            </div>
            <div className="bar-value">
              {moneyUsd(r.totalCost)}
              {r.totalSavings > 0 && (
                <span className="bar-savings">省 {moneyUsd(r.totalSavings)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CostDashboard() {
  const [data, setData] = useState<CostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("");

  // Guard against out-of-order responses: switching range tabs quickly can
  // leave a slow prior request in flight; without this guard it would
  // overwrite the freshest data when it resolves last.
  const reqIdRef = useRef(0);
  const load = useCallback((r: string) => {
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    adminApi
      .cost(r || undefined)
      .then((d) => {
        if (reqIdRef.current === myId) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (reqIdRef.current === myId) {
          setError(e.message);
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  const s = data?.summary;
  const savingsPct =
    s && s.totalOriginalCost > 0
      ? Math.round((s.totalSavings / s.totalOriginalCost) * 100)
      : 0;

  return (
    <div className="page">
      <div className="page-head">
        <h2>成本看板</h2>
        <div className="range-tabs">
          {RANGES.map((r) => (
            <button
              key={r.value}
              className={"tab" + (range === r.value ? " active" : "")}
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </button>
          ))}
          <button className="refresh" onClick={() => load(range)} disabled={loading}>
            {loading ? "…" : "↻ 刷新"}
          </button>
        </div>
      </div>

      {error && <div className="banner error">读取成本数据失败：{error}</div>}

      {data && s && (
        <>
          <div className="metric-grid">
            <Metric label="总请求数" value={String(s.totalRequests)} />
            <Metric label="原始成本" value={moneyUsd(s.totalOriginalCost)} />
            <Metric label="实际成本" value={moneyUsd(s.totalActualCost)} />
            <Metric
              label="节省"
              value={moneyUsd(s.totalSavings)}
              accent
              sub={savingsPct > 0 ? `相比原始降低 ${savingsPct}%` : undefined}
            />
          </div>
          <div className="grid-2">
            <Breakdown title="按 step 类型" rows={data.byStep} />
            <Breakdown title="按工具" rows={data.byTool} />
          </div>
        </>
      )}

      {data && s && s.totalRequests === 0 && (
        <div className="banner muted">
          暂无成本数据。通过 <code>agentfare init</code> 配置后发起几次请求，
          路由与计费会写入本地 SQLite，刷新本页即可看到。
        </div>
      )}
    </div>
  );
}
