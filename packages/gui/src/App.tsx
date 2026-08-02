import { useCallback, useEffect, useState } from "react";
import { adminApi } from "./api";
import { runningInTauri } from "./ipc";
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

  // Probe the loopback daemon. The admin endpoints only exist when the proxy is
  // running (auto-spawned as a sidecar in Tauri, or `pnpm dev:daemon` in dev) —
  // surface an offline state instead of letting every page fail with an opaque
  // fetch error. probeDaemon is reused by the offline banner's "重新检测" button
  // so the user can retry without leaving the GUI.
  const probeDaemon = useCallback(() => {
    setDaemonUp(null);
    adminApi
      .health()
      .then(() => setDaemonUp(true))
      .catch(() => setDaemonUp(false));
  }, []);

  useEffect(() => {
    probeDaemon();
  }, [probeDaemon]);

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
              : "daemon 离线"}
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
              代理 daemon 未运行，GUI 读取的成本 / 日志 / 模型数据均来自本地代理（127.0.0.1:3456）。
              {runningInTauri()
                ? "桌面应用通常会自动拉起代理进程；若持续离线，请重启应用，并确认已在「端点配置」配置至少一个 provider 与密钥。"
                : "开发模式下请启动 daemon（pnpm dev:daemon），或使用桌面应用以自动管理代理。"}
              <div className="lock-actions" style={{ marginTop: 8 }}>
                <button className="refresh" onClick={probeDaemon}>
                  重新检测
                </button>
              </div>
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
