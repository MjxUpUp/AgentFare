import { defineConfig } from "vitest/config";
import path from "node:path";

const pkgs = (name: string) => path.resolve(__dirname, `../packages/${name}/dist/index.js`);

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      // Longer/more-specific paths MUST come before shorter prefix matches
      "@agentfare/hook/protocol/openai-to-anthropic": path.resolve(__dirname, "../packages/hook/dist/protocol/openai-to-anthropic.js"),
      "@agentfare/hook/protocol/anthropic-to-openai": path.resolve(__dirname, "../packages/hook/dist/protocol/anthropic-to-openai.js"),
      "@agentfare/hook/fetch-patch": path.resolve(__dirname, "../packages/hook/dist/fetch-patch.js"),
      "@agentfare/hook/request-handler": path.resolve(__dirname, "../packages/hook/dist/request-handler.js"),
      "@agentfare/hook/reentry-guard": path.resolve(__dirname, "../packages/hook/dist/reentry-guard.js"),
      "@agentfare/core": pkgs("core"),
      "@agentfare/models": pkgs("models"),
      "@agentfare/hook": pkgs("hook"),
      "@agentfare/loader": pkgs("loader"),
    },
  },
});
