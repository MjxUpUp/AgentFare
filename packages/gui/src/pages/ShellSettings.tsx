// @vitest-environment jsdom
import { useState } from "react";
import {
  detectShellTools,
  takeoverShell,
  restoreShell,
  runningInTauri,
  type ShellTool,
} from "../ipc";

type Notice = { kind: "ok" | "err"; text: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Shell takeover / restore panel — consumes the slice② IPC wrappers (ipc.ts).
 *
 * In a browser / `vite dev` context `runningInTauri()` is false and the panel
 * shows a static notice instead of the buttons, so the component is safe to
 * render in both web and desktop builds. Inside Tauri, "检测工具" previews the
 * detected CLI tools + their current *_BASE_URL (read-only), "接管" rewrites the
 * profile to point at the proxy, "还原" strips the markers + restores originals.
 */
export function ShellSettings() {
  const [tools, setTools] = useState<ShellTool[] | null>(null);
  const [captured, setCaptured] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const inTauri = runningInTauri();

  async function detect() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await detectShellTools();
      if (r.ok) {
        setTools(r.tools);
        setCaptured(r.capturedUrls);
      } else {
        setNotice({ kind: "err", text: r.error });
      }
    } catch (e) {
      setNotice({ kind: "err", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  async function takeover() {
    // Destructive: rewrites the shell profile (backed up + restorable, but a
    // stray click shouldn't silently mutate ~/.zshrc). Confirm first.
    if (
      typeof window !== "undefined" &&
      !window.confirm("将修改 shell 配置文件（rc 文件会先备份，可经「还原 shell」恢复）。确认接管？")
    ) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await takeoverShell();
      if (r.ok) {
        setNotice({
          kind: "ok",
          text: `已接管 shell（${r.platform ?? "?"}）：写入 ${r.rcPath ?? "?"}。请重开终端或 source 该文件生效。`,
        });
      } else {
        setNotice({ kind: "err", text: r.error });
      }
    } catch (e) {
      setNotice({ kind: "err", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await restoreShell();
      if (r.ok) {
        const tail =
          r.restored.length > 0
            ? `恢复 provider：${r.restored.join(", ")}。`
            : "无已记录的原始 URL，仅清理 proxy 标记。";
        setNotice({
          kind: "ok",
          text: `已还原 shell（${r.platform ?? "?"}）：${r.rcPath ?? "?"}。${tail}`,
        });
      } else {
        setNotice({ kind: "err", text: r.error });
      }
    } catch (e) {
      setNotice({ kind: "err", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h3>Shell 接管</h3>
      {!inTauri ? (
        <div className="banner info">
          Shell 接管仅在桌面应用中可用。当前运行在浏览器 / 开发服务器下。
        </div>
      ) : (
        <>
          <p className="muted small">
            接管会把检测到的 CLI 工具（claude / codex 等）的 <code>*_BASE_URL</code> 指向本地
            proxy；还原则清理标记并恢复接管前的原始值（重启 GUI 也能还原）。
          </p>
          <div className="lock-actions">
            <button className="refresh" disabled={busy} onClick={detect}>
              检测工具
            </button>
            <button className="toggle" disabled={busy} onClick={takeover}>
              接管 shell
            </button>
            <button className="refresh" disabled={busy} onClick={restore}>
              还原 shell
            </button>
          </div>

          {tools && (
            <ul className="tool-list">
              {tools.length === 0 && (
                <li className="muted">未检测到任何 CLI 工具</li>
              )}
              {tools.map((t) => (
                <li key={t.name + t.provider}>
                  {t.name} · {t.provider}
                  {t.type === "ide" && "（IDE，需手动配置）"}
                  {captured[t.provider]
                    ? `（原 ${captured[t.provider]}）`
                    : ""}
                </li>
              ))}
            </ul>
          )}

          {notice && (
            <div
              className={"banner " + (notice.kind === "ok" ? "info" : "error")}
            >
              {notice.text}
            </div>
          )}
        </>
      )}
    </section>
  );
}
