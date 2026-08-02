import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type ProviderInfo, type ModelInfo, type ActiveLock } from "../api";

type Notice = { kind: "ok" | "err"; text: string };

/** 当前锁定状态的徽章文案 + 样式类。 */
function lockState(a: ActiveLock | null): { text: string; cls: string } {
  if (!a || a.lockMode === "auto") {
    return { text: "● 自动路由", cls: "lock-auto" };
  }
  if (a.lockMode === "model") {
    return { text: `🔒 ${a.activeModel ?? "?"}`, cls: "lock-on" };
  }
  return { text: `🔒 ${a.activeProvider ?? "?"}（厂商）`, cls: "lock-on" };
}

/** strict 下 catch 的 e 是 unknown，统一取 message。 */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ProvidersPage() {
  const [providers, setProviders] = useState<Record<string, ProviderInfo> | null>(
    null,
  );
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [active, setActive] = useState<ActiveLock | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // 三路独立请求：providers/models/active 任一失败不连累其余（与 ModelsPage
  // 同模式）。active() 在旧版 daemon（无 cc-switch 端点）上会 404，徽章退回
  // "自动路由"，写操作会向用户报错 —— 不静默吞掉。
  const load = useCallback(() => {
    setError(null);
    adminApi
      .providers()
      .then((r) => setProviders(r.providers))
      .catch((e) => setError(e.message));
    adminApi
      .models()
      .then((r) => {
        setModels(r.models);
        setSelected((cur) => cur || r.models[0]?.id || "");
      })
      .catch((e) =>
        setError((p) => (p ? `${p}；模型：${e.message}` : `模型：${e.message}`)),
      );
    adminApi
      .active()
      .then((r) => {
        setActive(r);
        // 默认选中当前锁定的模型，方便用户在它基础上切换
        if (r.activeModel) setSelected((cur) => cur || r.activeModel || "");
      })
      .catch((e) =>
        setError((p) =>
          p ? `${p}；锁定状态：${e.message}` : `锁定状态：${e.message}`,
        ),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 按 provider 分组，下拉里用 optgroup 呈现
  const grouped = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const m of models ?? []) {
      if (!map.has(m.provider)) map.set(m.provider, []);
      map.get(m.provider)!.push(m);
    }
    return [...map.entries()];
  }, [models]);

  const lockModel = useCallback(async (modelId: string) => {
    if (!modelId) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await adminApi.setActive({ lockMode: "model", activeModel: modelId });
      setActive({ lockMode: r.lockMode, activeModel: r.activeModel, activeProvider: r.activeProvider });
      setNotice({ kind: "ok", text: `已锁定到 ${r.activeModel}，下一个请求即生效` });
    } catch (e) {
      setNotice({ kind: "err", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  const unlock = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await adminApi.setActive({ lockMode: "auto" });
      setActive({ lockMode: r.lockMode, activeModel: r.activeModel, activeProvider: r.activeProvider });
      setNotice({ kind: "ok", text: "已解锁，恢复自动分层路由" });
    } catch (e) {
      setNotice({ kind: "err", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  const entries = providers ? Object.entries(providers) : [];
  const state = lockState(active);
  const locked = active != null && active.lockMode !== "auto";

  return (
    <div className="page">
      <div className="page-head">
        <h2>端点配置</h2>
        <button className="refresh" onClick={load}>
          ↻ 刷新
        </button>
      </div>

      <div className="banner info">
        实时切换：下方一键锁定目标模型，下一个请求即按新锁定路由，无需重启 daemon
        （类似 cc-switch）。端点 / 密钥的增删改仍通过 <code>agentfare config</code>。
      </div>

      {error && <div className="banner error">{error}</div>}

      {/* ── 实时路由锁定 ── */}
      <section className="card">
        <h3>
          实时路由锁定
          <span className={"lock-badge " + state.cls}>{state.text}</span>
        </h3>

        <div className="inline">
          <label htmlFor="lock-model">目标模型</label>
          <select
            id="lock-model"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy}
          >
            {grouped.length === 0 && <option value="">（无可用模型）</option>}
            {grouped.map(([provider, list]) => (
              <optgroup key={provider} label={provider}>
                {list.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} · {m.tier}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="lock-actions">
          <button
            className={"toggle" + (locked && active?.lockMode === "model" ? " on" : "")}
            disabled={busy || !selected}
            onClick={() => lockModel(selected)}
          >
            🔒 锁定该模型
          </button>
          <button
            className="refresh"
            disabled={busy || !locked}
            onClick={unlock}
          >
            🔓 解锁（自动路由）
          </button>
        </div>

        {notice && (
          <div className={"banner " + (notice.kind === "ok" ? "info" : "error")}>
            {notice.text}
          </div>
        )}
      </section>

      {/* ── Provider 映射（只读） ── */}
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
