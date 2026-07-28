import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, type RoutingLogRow } from "../api";
import { moneyUsd } from "../utils";

const LIMITS = [50, 100, 200, 500];

export function LogsPage() {
  const [logs, setLogs] = useState<RoutingLogRow[] | null>(null);
  const [limit, setLimit] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);

  // Guard the auto-refresh poll: a slow prior fetch could otherwise resolve
  // last and overwrite newer logs with a stale response.
  const reqIdRef = useRef(0);
  const load = useCallback(() => {
    const myId = ++reqIdRef.current;
    setError(null);
    adminApi
      .logs(limit)
      .then((r) => {
        if (reqIdRef.current === myId) setLogs(r.logs);
      })
      .catch((e) => {
        if (reqIdRef.current === myId) setError(e.message);
      });
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  // Optional auto-refresh (polls every 3s). The admin layer is read-only, so
  // this is safe; long-poll/SSE can replace it later if needed.
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [auto, load]);

  return (
    <div className="page">
      <div className="page-head">
        <h2>实时日志</h2>
        <div className="controls">
          <label className="inline">
            条数
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            className={"toggle" + (auto ? " on" : "")}
            onClick={() => setAuto((a) => !a)}
          >
            {auto ? "⏸ 暂停自动刷新" : "▶ 自动刷新"}
          </button>
          <button className="refresh" onClick={load}>
            ↻ 刷新
          </button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {logs && (
        <section className="card">
          {logs.length === 0 ? (
            <p className="muted">暂无路由日志。</p>
          ) : (
            <table className="data-table logs">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>工具</th>
                  <th>step</th>
                  <th>原模型</th>
                  <th>→ 路由模型</th>
                  <th>实际成本</th>
                  <th>节省</th>
                  <th>质量</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="mono small">{l.timestamp}</td>
                    <td>{l.tool}</td>
                    <td>{l.step_type}</td>
                    <td className="mono">{l.original_model}</td>
                    <td className="mono routed">{l.routed_model}</td>
                    <td className="mono">{moneyUsd(l.actual_cost)}</td>
                    <td className="mono savings">{moneyUsd(l.savings)}</td>
                    <td>
                      {l.quality_signal ? (
                        <span className={"qsig q-" + l.quality_signal}>
                          {l.quality_signal}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
