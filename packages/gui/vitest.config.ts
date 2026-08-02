import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Two test environments coexist:
//  - api.test.ts / utils.test.ts run under node (pure fetch-mock logic)
//  - *.test.tsx component tests run under jsdom via a per-file
//    `// @vitest-environment jsdom` pragma (so node tests stay unaffected).
// plugin-react is required for the tsx tests' JSX transform; the root
// vitest.config.ts has no such plugin, so gui tsx tests MUST run under this
// config (via `pnpm --filter @agentfare/gui test`), not the root one.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
