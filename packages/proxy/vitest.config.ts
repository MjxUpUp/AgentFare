import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@agentfare/proxy": path.resolve(__dirname, "src"),
      "@agentfare/core": path.resolve(__dirname, "../core/src"),
      "@agentfare/models": path.resolve(__dirname, "../models/src"),
    },
  },
});
