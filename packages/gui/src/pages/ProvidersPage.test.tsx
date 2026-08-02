// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProvidersPage } from "./ProvidersPage";
import { adminApi } from "../api";

// ProvidersPage 是 cc-switch 的 GUI 交付物：拉 providers/models/active，按
// 「锁定该模型/解锁」调 adminApi.setActive。api.ts 的 setActive 两步流程已有
// 自己的单元测试；这里验证 UI 接线——点击 → 正确的 lock 载荷 → 状态/徽章更新
// → daemon 错误回显。mock adminApi 的四个方法。

vi.mock("../api", () => ({
  adminApi: {
    providers: vi.fn(),
    models: vi.fn(),
    active: vi.fn(),
    setActive: vi.fn(),
    setKeys: vi.fn(),
  },
}));

const mockModels = [
  { id: "deepseek/v4-pro", provider: "deepseek", tier: "powerful", pricing: { inputPerMillion: 2, outputPerMillion: 8 } },
  { id: "openai/gpt-5.4-mini", provider: "openai", tier: "fast", pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6 } },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.providers).mockResolvedValue({
    providers: { openai: { provider: "openai", protocol: "openai", upstreamBaseUrl: "https://api.openai.com" } },
  });
  vi.mocked(adminApi.models).mockResolvedValue({ models: mockModels });
  vi.mocked(adminApi.active).mockResolvedValue({ lockMode: "auto", activeModel: null, activeProvider: null });
  // 默认 setActive 成功返回 model 锁定结果（成功路径测试用）
  vi.mocked(adminApi.setActive).mockResolvedValue({
    ok: true, lockMode: "model", activeModel: "deepseek/v4-pro", activeProvider: null,
  });
  // 默认 setKeys 成功（key 管理成功路径测试用）
  vi.mocked(adminApi.setKeys).mockResolvedValue({ ok: true, providers: ["deepseek"] });
});

describe("ProvidersPage — cc-switch 实时锁定 UI", () => {
  it("renders the lock card and shows the auto state before any lock", async () => {
    const { container } = render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByText(/实时路由锁定/)).toBeInTheDocument());
    // 锁定前徽章是「自动路由」；用 .lock-badge 类精确定位，避免「解锁（自动路由）」按钮文案造成多元素歧义
    const badge = container.querySelector(".lock-badge");
    expect(badge?.textContent).toMatch(/自动路由/);
    // 三个数据源都被拉取
    expect(adminApi.providers).toHaveBeenCalledTimes(1);
    expect(adminApi.models).toHaveBeenCalledTimes(1);
    expect(adminApi.active).toHaveBeenCalledTimes(1);
  });

  it("populates the model dropdown grouped by provider", async () => {
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByRole("group", { name: "deepseek" })).toBeInTheDocument());
    expect(screen.getByRole("group", { name: "openai" })).toBeInTheDocument();
  });

  it("locks the selected model when 「锁定该模型」 is clicked", async () => {
    const { container } = render(<ProvidersPage />);
    // 等 models 加载完，selected 默认 = 第一个模型 deepseek/v4-pro
    await waitFor(() => expect(screen.getByRole("group", { name: "deepseek" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /锁定该模型/ }));
    await waitFor(() =>
      expect(adminApi.setActive).toHaveBeenCalledWith({ lockMode: "model", activeModel: "deepseek/v4-pro" }),
    );
    // 成功后徽章切到锁定态（含模型名）；用 .lock-badge 精确定位，避免 notice banner / option 文案造成多元素歧义
    await waitFor(() => {
      const badge = container.querySelector(".lock-badge");
      expect(badge?.textContent).toMatch(/deepseek\/v4-pro/);
    });
  });

  it("keeps 「解锁」 disabled while in auto mode, enables it once locked", async () => {
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /锁定该模型/ })).toBeInTheDocument());

    const unlockBtn = screen.getByRole("button", { name: /解锁/ });
    // auto 状态下解锁应禁用
    expect(unlockBtn).toBeDisabled();

    // 锁定 → active.lockMode 变 model → locked=true → 解锁启用
    fireEvent.click(screen.getByRole("button", { name: /锁定该模型/ }));
    await waitFor(() => expect(unlockBtn).not.toBeDisabled());

    vi.mocked(adminApi.setActive).mockResolvedValueOnce({
      ok: true, lockMode: "auto", activeModel: null, activeProvider: null,
    });
    fireEvent.click(unlockBtn);
    await waitFor(() => expect(adminApi.setActive).toHaveBeenCalledWith({ lockMode: "auto" }));
  });

  it("surfaces the daemon error in a banner when setActive rejects", async () => {
    vi.mocked(adminApi.setActive).mockRejectedValue(new Error("401 invalid_admin_token"));
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /锁定该模型/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /锁定该模型/ }));
    await waitFor(() => expect(screen.getByText(/401 invalid_admin_token/)).toBeInTheDocument());
  });
});

describe("ProvidersPage — API 密钥管理（slice③）", () => {
  it("保存密钥时以 {provider: key} 调 adminApi.setKeys 并回显成功", async () => {
    render(<ProvidersPage />);
    // 等 models 加载（provider 下拉依赖 grouped）
    await waitFor(() => expect(screen.getByRole("group", { name: "deepseek" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test-123" } });
    fireEvent.click(screen.getByRole("button", { name: /保存密钥/ }));

    await waitFor(() =>
      expect(adminApi.setKeys).toHaveBeenCalledWith({ deepseek: "sk-test-123" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/已保存 deepseek 密钥/)).toBeInTheDocument(),
    );
  });

  it("setKeys 失败时在 banner 回显 daemon 错误", async () => {
    vi.mocked(adminApi.setKeys).mockRejectedValueOnce(new Error("403 forbidden_origin"));
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByRole("group", { name: "deepseek" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-x" } });
    fireEvent.click(screen.getByRole("button", { name: /保存密钥/ }));

    await waitFor(() =>
      expect(screen.getByText(/403 forbidden_origin/)).toBeInTheDocument(),
    );
  });

  it("provider 或 key 为空时保存按钮禁用", async () => {
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByRole("group", { name: "deepseek" })).toBeInTheDocument());
    const saveBtn = screen.getByRole("button", { name: /保存密钥/ });
    expect(saveBtn).toBeDisabled();
    // 选了 provider 但没填 key —— 仍禁用
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "deepseek" } });
    expect(saveBtn).toBeDisabled();
  });
});
