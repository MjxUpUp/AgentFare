// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// App.test 只验证外壳的离线诊断 banner（slice④）：health 离线 → 自助提示 +
// 重新检测按钮。子页面 mocked 为空，避免引入各自的数据请求依赖。banner 的
// 文案在 Tauri / 非 Tauri 分流；jsdom 无 __TAURI_INTERNALS__，恒走非 Tauri 分支。

vi.mock("./api", () => ({
  adminApi: {
    health: vi.fn(),
    cost: vi.fn(),
    logs: vi.fn(),
    models: vi.fn(),
    scores: vi.fn(),
    providers: vi.fn(),
    active: vi.fn(),
    adminToken: vi.fn(),
    setActive: vi.fn(),
    setKeys: vi.fn(),
    setProviders: vi.fn(),
  },
}));
vi.mock("./pages/CostDashboard", () => ({ CostDashboard: () => null }));
vi.mock("./pages/ModelsPage", () => ({ ModelsPage: () => null }));
vi.mock("./pages/LogsPage", () => ({ LogsPage: () => null }));
vi.mock("./pages/ProvidersPage", () => ({ ProvidersPage: () => null }));

import { App } from "./App";
import { adminApi } from "./api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("App — 离线诊断自助（slice④）", () => {
  it("daemon 在线时不显示离线 banner", async () => {
    vi.mocked(adminApi.health).mockResolvedValue({
      status: "ok",
      service: "proxy",
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.queryByText(/代理 daemon 未运行/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/daemon 在线/)).toBeInTheDocument();
  });

  it("daemon 离线时显示自助提示 + 重新检测按钮（非 Tauri 文案）", async () => {
    vi.mocked(adminApi.health).mockRejectedValue(new Error("fetch failed"));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/代理 daemon 未运行/)).toBeInTheDocument(),
    );
    // jsdom 无 __TAURI_INTERNALS__ → 走非桌面环境分支
    expect(screen.getByText(/开发模式下请启动 daemon/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重新检测/ })).toBeInTheDocument();
  });

  it("点「重新检测」再次调用 health，恢复在线后 banner 消失", async () => {
    // 首次离线，重新检测后在线
    vi.mocked(adminApi.health)
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ status: "ok", service: "proxy" });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/代理 daemon 未运行/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /重新检测/ }));
    await waitFor(() =>
      expect(screen.queryByText(/代理 daemon 未运行/)).not.toBeInTheDocument(),
    );
    expect(adminApi.health).toHaveBeenCalledTimes(2);
  });
});
