import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@agentfare/hook": path.resolve(__dirname, "src"),
      "@agentfare/core": path.resolve(__dirname, "../core/src"),
    },
  },
});
