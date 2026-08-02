// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TakeoverResult, RestoreResult } from "../src/ipc";

// vi.hoisted so the mock reference exists when the hoisted vi.mock factory runs.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// ipc.ts evaluates `isTauri` at module load. vi.resetModules() before each
// dynamic import forces re-evaluation so the window-state at load time is what
// we set up, not whatever the first import saw.
async function loadIpc() {
  vi.resetModules();
  return await import("../src/ipc");
}

describe("ipc — inside Tauri (window.__TAURI_INTERNALS__ present)", () => {
  beforeEach(() => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    invokeMock.mockReset();
  });
  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("runningInTauri() is true", async () => {
    const ipc = await loadIpc();
    expect(ipc.runningInTauri()).toBe(true);
  });

  it("detectShellTools invokes the detect_shell_tools command and forwards the result", async () => {
    const fakeResult = {
      ok: true,
      subcommand: "capture" as const,
      tools: [{ name: "claude", provider: "anthropic", type: "cli" as const }],
      capturedUrls: { anthropic: "https://api.anthropic.com" },
    };
    invokeMock.mockResolvedValue(fakeResult);
    const ipc = await loadIpc();
    const result = await ipc.detectShellTools();
    expect(invokeMock).toHaveBeenCalledWith("detect_shell_tools");
    expect(result).toEqual(fakeResult);
  });

  it("takeoverShell passes port when given", async () => {
    invokeMock.mockResolvedValue({ ok: true, subcommand: "takeover", rcPath: "/home/u/.zshrc", platform: "darwin", tools: [], capturedUrls: {} } as TakeoverResult);
    const ipc = await loadIpc();
    await ipc.takeoverShell(8787);
    expect(invokeMock).toHaveBeenCalledWith("takeover_shell", { port: 8787 });
  });

  it("takeoverShell omits the port arg entirely when undefined (Rust sees None → default)", async () => {
    invokeMock.mockResolvedValue({ ok: true, subcommand: "takeover", rcPath: "/home/u/.zshrc", platform: "darwin", tools: [], capturedUrls: {} } as TakeoverResult);
    const ipc = await loadIpc();
    await ipc.takeoverShell();
    expect(invokeMock).toHaveBeenCalledWith("takeover_shell", {});
  });

  it("restoreShell invokes the restore_shell command", async () => {
    invokeMock.mockResolvedValue({ ok: true, subcommand: "restore", rcPath: "/home/u/.zshrc", platform: "darwin", restored: [], capturedUrls: {} } as RestoreResult);
    const ipc = await loadIpc();
    await ipc.restoreShell();
    expect(invokeMock).toHaveBeenCalledWith("restore_shell");
  });

  it("forwards the CLI's own {ok:false} error result verbatim (does not throw)", async () => {
    // The CLI reports "未检测到任何 CLI 工具" as {ok:false} on stdout; the Rust
    // command returns it as a value, and the wrapper must pass it through so the
    // UI can show the message rather than hit a generic rejection.
    invokeMock.mockResolvedValue({ ok: false, error: "未检测到任何 CLI 工具" });
    const ipc = await loadIpc();
    const result = await ipc.takeoverShell(3456);
    expect(result).toEqual({ ok: false, error: "未检测到任何 CLI 工具" });
  });
});

describe("ipc — outside Tauri (browser / vite dev server)", () => {
  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("runningInTauri() is false", async () => {
    const ipc = await loadIpc();
    expect(ipc.runningInTauri()).toBe(false);
  });

  it("detectShellTools throws a clear NOT_TAURI error", async () => {
    const ipc = await loadIpc();
    await expect(ipc.detectShellTools()).rejects.toThrow(/桌面应用/);
  });

  it("takeoverShell throws outside Tauri", async () => {
    const ipc = await loadIpc();
    await expect(ipc.takeoverShell(3456)).rejects.toThrow(/桌面应用/);
  });

  it("restoreShell throws outside Tauri", async () => {
    const ipc = await loadIpc();
    await expect(ipc.restoreShell()).rejects.toThrow(/桌面应用/);
  });
});
