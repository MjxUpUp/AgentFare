import { defineConfig } from "vitest/config";
import path from "node:path";

const pkgs = (name: string) => path.resolve(__dirname, `packages/${name}/dist/index.js`);

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      "@agentdispatch/core": pkgs("core"),
      "@agentdispatch/models": pkgs("models"),
      "@agentdispatch/hook/fetch-patch": path.resolve(__dirname, "packages/hook/dist/fetch-patch.js"),
      "@agentdispatch/hook/request-handler": path.resolve(__dirname, "packages/hook/dist/request-handler.js"),
      "@agentdispatch/hook": path.resolve(__dirname, "packages/hook/dist/index.js"),
    },
  },
});
