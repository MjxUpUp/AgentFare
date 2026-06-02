export function validateHookInjection(): {
  available: boolean;
  mode: "monkey-patch" | "proxy-required";
  reason?: string;
} {
  try {
    const original = globalThis.fetch;
    let patched = false;
    globalThis.fetch = () => {
      patched = true;
      return Promise.resolve(
        new Response(null, { status: 200 })
      );
    };
    try {
      globalThis.fetch("https://test.agentfare.local/ping");
    } catch {
      // Expected — we're not actually making a real request
    }
    globalThis.fetch = original;
    if (patched) return { available: true, mode: "monkey-patch" };
    return {
      available: false,
      mode: "proxy-required",
      reason:
        "fetch 拦截不可用，请使用 Proxy 模式：agentfare init --mode proxy",
    };
  } catch (err) {
    return {
      available: false,
      mode: "proxy-required",
      reason: `Hook 验证异常: ${err}`,
    };
  }
}
