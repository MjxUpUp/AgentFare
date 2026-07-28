import { defineConfig } from "vitest/config";

// The GUI runs in the browser, but src/api.ts is pure fetch-based logic that
// is fully testable under node (node 18+ has a global fetch). Component tests
// (App/pages) would need jsdom + @testing-library — left as a follow-up; the
// data contract with the daemon is the highest-risk surface and lives here.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
