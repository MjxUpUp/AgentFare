import { defineConfig } from "vitest/config";
import path from "node:path";

const pkgs = (name: string) => path.resolve(__dirname, `packages/${name}/dist/index.js`);

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      "@agentfare/core": pkgs("core"),
      "@agentfare/models": pkgs("models"),
      "@agentfare/models/paths": path.resolve(__dirname, "packages/models/dist/paths.js"),
      "@agentfare/hook/fetch-patch": path.resolve(__dirname, "packages/hook/dist/fetch-patch.js"),
      "@agentfare/hook/pipeline": path.resolve(__dirname, "packages/hook/dist/pipeline.js"),
      "@agentfare/hook/request-handler": path.resolve(__dirname, "packages/hook/dist/request-handler.js"),
      "@agentfare/hook/reentry-guard": path.resolve(__dirname, "packages/hook/dist/reentry-guard.js"),
      "@agentfare/hook/protocol/openai-to-anthropic": path.resolve(__dirname, "packages/hook/dist/protocol/openai-to-anthropic.js"),
      "@agentfare/hook/protocol/anthropic-to-openai": path.resolve(__dirname, "packages/hook/dist/protocol/anthropic-to-openai.js"),
      "@agentfare/hook/protocol/anthropic-to-openai-request": path.resolve(__dirname, "packages/hook/dist/protocol/anthropic-to-openai-request.js"),
      "@agentfare/hook/protocol/openai-to-anthropic-response": path.resolve(__dirname, "packages/hook/dist/protocol/openai-to-anthropic-response.js"),
      "@agentfare/hook/protocol/openai-to-anthropic-sse": path.resolve(__dirname, "packages/hook/dist/protocol/openai-to-anthropic-sse.js"),
      "@agentfare/hook/protocol/sse-transform": path.resolve(__dirname, "packages/hook/dist/protocol/sse-transform.js"),
      "@agentfare/hook/response-handler": path.resolve(__dirname, "packages/hook/dist/response-handler.js"),
      "@agentfare/hook/headers": path.resolve(__dirname, "packages/hook/dist/headers.js"),
      "@agentfare/hook": path.resolve(__dirname, "packages/hook/dist/index.js"),
      "@agentfare/proxy/server": path.resolve(__dirname, "packages/proxy/dist/server.js"),
      "@agentfare/proxy/lifecycle": path.resolve(__dirname, "packages/proxy/dist/lifecycle.js"),
      "@agentfare/proxy/provider-map": path.resolve(__dirname, "packages/proxy/dist/provider-map.js"),
      "@agentfare/proxy/key-store": path.resolve(__dirname, "packages/proxy/dist/key-store.js"),
      "@agentfare/proxy/sse-pipe": path.resolve(__dirname, "packages/proxy/dist/sse-pipe.js"),
      "@agentfare/proxy": pkgs("proxy"),
      "@agentfare/setup": pkgs("setup"),
      "@agentfare/cli": pkgs("cli"),
      "@agentfare/loader": pkgs("loader"),
    },
  },
});
