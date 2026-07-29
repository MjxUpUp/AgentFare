import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@agentfare/models": path.resolve(__dirname, "src"),
      "@agentfare/models/paths": path.resolve(__dirname, "src/paths.ts"),
    },
  },
});
