import { useCallback, useEffect, useState } from "react";
import { adminApi, type ModelInfo, type ModelScore } from "../api";
import { pricePerMillion } from "../utils";

export function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [scores, setScores] = useState<ModelScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Two independent requests: if /api/scores is temporarily unhealthy the
  // models table still renders. Promise.all would have blanked both tables
  // on a single failure (review MEDIUM).
  const load = useCallback(() => {
    setError(null);
    adminApi
      .models()
      .then((m) => setModels(m.models))
      .catch((e) => setError(`模型列表：${e.message}`));
    adminApi
      .scores()
      .then((s) => setScores(s.scores))
      .catch((e) =>
        setError((prev) =>
          prev ? `${prev}；在线分数：${e.message}` : `在线分数：${e.message}`,
        ),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <h2>模型管理</h2>
        <button className="refresh" onClick={load}>
          ↻ 刷新
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}

      <section className="card">
        <h3>注册模型（{models?.length ?? 0}）</h3>
        {models && models.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>厂商</th>
                <th>层级</th>
                <th>输入价</th>
                <th>输出价</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.id}</td>
                  <td>{m.provider}</td>
                  <td>
                    <span className={"tier tier-" + m.tier}>{m.tier}</span>
                  </td>
                  <td className="mono">{pricePerMillion(m.pricing.inputPerMillion)}</td>
                  <td className="mono">{pricePerMillion(m.pricing.outputPerMillion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">注册表为空。</p>
        )}
      </section>

      <section className="card">
        <h3>在线学习分数（{scores?.length ?? 0}）</h3>
        {scores && scores.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>step</th>
                <th>准确率</th>
                <th>延迟</th>
                <th>样本数</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={`${s.model}-${s.stepType}`}>
                  <td className="mono">{s.model}</td>
                  <td>{s.stepType}</td>
                  <td className="mono">{(s.avgAccuracy * 100).toFixed(0)}%</td>
                  <td className="mono">{s.avgLatencyMs}ms</td>
                  <td className="mono">{s.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">尚无在线学习样本（运行一段时间后会自动累计）。</p>
        )}
      </section>
    </div>
  );
}
