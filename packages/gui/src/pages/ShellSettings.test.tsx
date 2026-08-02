// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ShellSettings 是 slice② IPC（ipc.ts）的 UI 消费方：调 detectShellTools /
// takeoverShell / restoreShell，并用 runningInTauri() 在浏览器环境降级为静态
// 提示。这里 mock 整个 ipc 模块，只验证 UI 接线——IPC→Rust→node 的链路由
// ipc.test.ts（invoke mock）+ setup_cli_integration.rs（真实 spawn）覆盖。

vi.mock("../ipc", () => ({
  runningInTauri: vi.fn(),
  detectShellTools: vi.fn(),
  takeoverShell: vi.fn(),
  restoreShell: vi.fn(),
}));

import { ShellSettings } from "./ShellSettings";
import {
  runningInTauri,
  detectShellTools,
  takeoverShell,
  restoreShell,
} from "../ipc";

beforeEach(() => {
  vi.clearAllMocks();
  // takeover() gates on window.confirm (destructive op); jsdom's confirm is
  // not implemented and returns false, which would short-circuit takeover before
  // the IPC call. Stub it true so the takeover tests exercise the IPC path.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("ShellSettings — shell 接管面板", () => {
  it("非 Tauri 环境显示静态提示而非操作按钮", () => {
    vi.mocked(runningInTauri).mockReturnValue(false);
    render(<ShellSettings />);
    expect(
      screen.getByText(/Shell 接管仅在桌面应用中可用/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /检测工具/ }),
    ).not.toBeInTheDocument();
  });

  it("Tauri 环境渲染三个操作按钮", () => {
    vi.mocked(runningInTauri).mockReturnValue(true);
    render(<ShellSettings />);
    expect(screen.getByRole("button", { name: /检测工具/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /接管 shell/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /还原 shell/ })).toBeInTheDocument();
  });

  it("检测后展示发现的 CLI 工具及其原始 baseUrl", async () => {
    vi.mocked(runningInTauri).mockReturnValue(true);
    vi.mocked(detectShellTools).mockResolvedValue({
      ok: true,
      subcommand: "capture",
      tools: [
        { name: "claude", provider: "anthropic", type: "cli" },
        { name: "codex", provider: "openai", type: "cli" },
      ],
      capturedUrls: { anthropic: "https://api.anthropic.com" },
    });
    render(<ShellSettings />);
    fireEvent.click(screen.getByRole("button", { name: /检测工具/ }));
    await waitFor(() =>
      expect(screen.getByText(/claude · anthropic/)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/原 https:\/\/api\.anthropic\.com/),
    ).toBeInTheDocument();
  });

  it("接管成功显示写入的 rc 路径 + 重开终端提示", async () => {
    vi.mocked(runningInTauri).mockReturnValue(true);
    vi.mocked(takeoverShell).mockResolvedValue({
      ok: true,
      subcommand: "takeover",
      rcPath: "/home/u/.zshrc",
      platform: "darwin",
      tools: [],
      capturedUrls: {},
    });
    render(<ShellSettings />);
    fireEvent.click(screen.getByRole("button", { name: /接管 shell/ }));
    await waitFor(() =>
      expect(screen.getByText(/已接管 shell（darwin）：写入 \/home\/u\/\.zshrc/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/重开终端/)).toBeInTheDocument();
  });

  it("CLI 返回 ok:false 时前端展示具体错误（不被 generic spawn fail 掩盖）", async () => {
    // 这正是 lib.rs 忽略 exit code、把 {ok:false} 当 Value 返回的设计动机。
    vi.mocked(runningInTauri).mockReturnValue(true);
    vi.mocked(takeoverShell).mockResolvedValue({
      ok: false,
      error: "no writable shell rc file found",
    });
    render(<ShellSettings />);
    fireEvent.click(screen.getByRole("button", { name: /接管 shell/ }));
    await waitFor(() =>
      expect(screen.getByText(/no writable shell rc file found/)).toBeInTheDocument(),
    );
  });

  it("还原成功且无已记录 URL 时提示仅清理 proxy 标记", async () => {
    vi.mocked(runningInTauri).mockReturnValue(true);
    vi.mocked(restoreShell).mockResolvedValue({
      ok: true,
      subcommand: "restore",
      rcPath: "/home/u/.zshrc",
      platform: "darwin",
      restored: [],
      capturedUrls: {},
    });
    render(<ShellSettings />);
    fireEvent.click(screen.getByRole("button", { name: /还原 shell/ }));
    await waitFor(() =>
      expect(screen.getByText(/仅清理 proxy 标记/)).toBeInTheDocument(),
    );
  });

  it("还原成功且有已记录 URL 时列出恢复的 provider", async () => {
    vi.mocked(runningInTauri).mockReturnValue(true);
    vi.mocked(restoreShell).mockResolvedValue({
      ok: true,
      subcommand: "restore",
      rcPath: "/home/u/.zshrc",
      platform: "linux",
      restored: ["anthropic", "openai"],
      capturedUrls: {},
    });
    render(<ShellSettings />);
    fireEvent.click(screen.getByRole("button", { name: /还原 shell/ }));
    await waitFor(() =>
      expect(screen.getByText(/恢复 provider：anthropic, openai/)).toBeInTheDocument(),
    );
  });
});
