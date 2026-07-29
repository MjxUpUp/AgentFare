import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * 自动解析 workspace 包的 alias
 * 支持直接读取 TS 源码进行测试，无需先构建
 */
const workspaces = [
  "core",
  "models",
  "hook",
  "proxy",
  "cli",
  "loader",
  "setup",
  "mcp-server",
];

const aliasMap: Record<string, string> = {};

for (const pkg of workspaces) {
  const pkgName = `@agentfare/${pkg}`;
  aliasMap[pkgName] = path.resolve(__dirname, `packages/${pkg}/src`);

  // hook 包有多个子导出
  if (pkg === "hook") {
    aliasMap[`${pkgName}/fetch-patch`] = path.resolve(__dirname, `packages/hook/src/fetch-patch.ts`);
    aliasMap[`${pkgName}/pipeline`] = path.resolve(__dirname, `packages/hook/src/pipeline.ts`);
    aliasMap[`${pkgName}/request-handler`] = path.resolve(__dirname, `packages/hook/src/request-handler.ts`);
    aliasMap[`${pkgName}/reentry-guard`] = path.resolve(__dirname, `packages/hook/src/reentry-guard.ts`);
    aliasMap[`${pkgName}/failover`] = path.resolve(__dirname, `packages/hook/src/failover.ts`);
    aliasMap[`${pkgName}/response-handler`] = path.resolve(__dirname, `packages/hook/src/response-handler.ts`);
    aliasMap[`${pkgName}/headers`] = path.resolve(__dirname, `packages/hook/src/headers.ts`);
    aliasMap[`${pkgName}/protocol/openai-to-anthropic`] = path.resolve(__dirname, `packages/hook/src/protocol/openai-to-anthropic.ts`);
    aliasMap[`${pkgName}/protocol/anthropic-to-openai`] = path.resolve(__dirname, `packages/hook/src/protocol/anthropic-to-openai.ts`);
    aliasMap[`${pkgName}/protocol/anthropic-to-openai-request`] = path.resolve(__dirname, `packages/hook/src/protocol/anthropic-to-openai-request.ts`);
    aliasMap[`${pkgName}/protocol/openai-to-anthropic-response`] = path.resolve(__dirname, `packages/hook/src/protocol/openai-to-anthropic-response.ts`);
    aliasMap[`${pkgName}/protocol/openai-to-anthropic-sse`] = path.resolve(__dirname, `packages/hook/src/protocol/openai-to-anthropic-sse.ts`);
    aliasMap[`${pkgName}/protocol/sse-transform`] = path.resolve(__dirname, `packages/hook/src/protocol/sse-transform.ts`);
  }

  // proxy 包有多个子导出
  if (pkg === "proxy") {
    aliasMap[`${pkgName}/server`] = path.resolve(__dirname, `packages/proxy/src/server.ts`);
    aliasMap[`${pkgName}/lifecycle`] = path.resolve(__dirname, `packages/proxy/src/lifecycle.ts`);
    aliasMap[`${pkgName}/provider-map`] = path.resolve(__dirname, `packages/proxy/src/provider-map.ts`);
    aliasMap[`${pkgName}/key-store`] = path.resolve(__dirname, `packages/proxy/src/key-store.ts`);
    aliasMap[`${pkgName}/sse-pipe`] = path.resolve(__dirname, `packages/proxy/src/sse-pipe.ts`);
  }

  // models 包有 paths 子导出
  if (pkg === "models") {
    aliasMap[`${pkgName}/paths`] = path.resolve(__dirname, `packages/models/src/paths.ts`);
  }
}

export default defineConfig({
  test: {
    globals: true,
    include: ["packages/**/*.test.ts"],
    // 当在各包内独立运行时，使用相对路径
    dir: ".",
  },
  resolve: {
    alias: aliasMap,
  },
});
