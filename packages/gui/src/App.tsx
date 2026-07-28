import { useEffect, useState } from "react";
import { adminApi } from "./api";
import { CostDashboard } from "./pages/CostDashboard";
import { ModelsPage } from "./pages/ModelsPage";
import { LogsPage } from "./pages/LogsPage";
import { ProvidersPage } from "./pages/ProvidersPage";

type PageId = "cost" | "models" | "logs" | "providers";

const NAV: Array<{ id: PageId; label: string }> = [
  { id: "cost", label: "成本看板" },
  { id: "models", label: "模型管理" },
  { id: "logs", label: "实时日志" },
  { id: "providers", label: "端点配置" },
];

export function App() {
  const [page, setPage] = useState<PageId>("cost");
  const [daemonUp, setDaemonUp] = useState<boolean | null>(null);
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem("af-theme");
    if (saved) return saved === "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("af-theme", dark ? "dark" : "light");
  }, [dark]);

  // Probe the daemon once on load. The admin endpoints are loopback-only and
  // only exist when `agentfare proxy` is running — surface that to the user
  // instead of letting every page fail with an opaque fetch error.
  useEffect(() => {
    let cancelled = false;
    adminApi
      .health()
      .then(() => !cancelled && setDaemonUp(true))
      .catch(() => !cancelled && setDaemonUp(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span>
          <h1>AgentFare 控制台</h1>
        </div>
        <span
          className="daemon-status"
          data-up={daemonUp ?? ""}
          title="proxy daemon /health"
        >
          <span className="dot" />
          {daemonUp === null
            ? "检测中…"
            : daemonUp
              ? "daemon 在线"
              : "daemon 离线（请运行 agentfare proxy）"}
        </span>
        <div className="spacer" />
        <button className="theme-btn" onClick={() => setDark((d) => !d)}>
          {dark ? "☀ 浅色" : "🌙 深色"}
        </button>
      </header>
      <div className="body">
        <nav className="sidebar">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={"nav-item" + (page === item.id ? " active" : "")}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <main className="content">
          {daemonUp === false && (
            <div className="banner warning">
              代理 daemon 未运行。GUI 读取的成本/日志/模型数据来自
              <code>agentfare proxy</code>（默认 127.0.0.1:3456），请先启动它。
            </div>
          )}
          {page === "cost" && <CostDashboard />}
          {page === "models" && <ModelsPage />}
          {page === "logs" && <LogsPage />}
          {page === "providers" && <ProvidersPage />}
        </main>
      </div>
    </div>
  );
}
