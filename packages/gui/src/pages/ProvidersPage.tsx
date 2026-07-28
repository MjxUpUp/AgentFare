import { useCallback, useEffect, useState } from "react";
import { adminApi, type ProviderInfo } from "../api";

export function ProvidersPage() {
  const [providers, setProviders] = useState<Record<string, ProviderInfo> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    adminApi
      .providers()
      .then((r) => setProviders(r.providers))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const entries = providers ? Object.entries(providers) : [];

  return (
    <div className="page">
      <div className="page-head">
        <h2>端点配置</h2>
        <button className="refresh" onClick={load}>
          ↻ 刷新
        </button>
      </div>

      <div className="banner info">
        当前展示 daemon 已加载的 provider 映射（只读）。修改端点/密钥请通过
        <code>agentfare config</code> —— admin API 暂未开放写端点，写入需要
        token 鉴权方案，将在后续版本加入。
      </div>

      {error && <div className="banner error">{error}</div>}

      <section className="card">
        <h3>Provider 映射（{entries.length}）</h3>
        {entries.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>路径前缀</th>
                <th>厂商</th>
                <th>协议</th>
                <th>上游 baseUrl</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([prefix, info]) => (
                <tr key={prefix}>
                  <td className="mono">/{prefix}</td>
                  <td>{info.provider}</td>
                  <td>
                    <span className={"proto proto-" + info.protocol}>
                      {info.protocol}
                    </span>
                  </td>
                  <td className="mono small">{info.upstreamBaseUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">未加载任何 provider。</p>
        )}
      </section>
    </div>
  );
}
