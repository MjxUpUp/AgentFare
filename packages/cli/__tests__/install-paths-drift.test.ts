import { describe, it, expect, afterEach } from "vitest";
import { getBaseDir } from "@agentfare/models";
import { resolveAgentFareDir } from "../src/preinstall-stop-proxy.js";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Drift guard for the install-lifecycle scripts.
 *
 * preinstall-stop-proxy.ts runs BEFORE deps are on disk, so it CANNOT import
 * @agentfare/models — it mirrors getBaseDir() inline via resolveAgentFareDir().
 * This test imports that exact function and pins it to the SSOT so the two can
 * never silently diverge (e.g. one gains empty-string handling and the other
 * doesn't). postinstall-start-proxy.ts prefers the real getBaseDir() via
 * require, so only the preinstall mirror is at drift risk.
 */
describe("preinstall resolveAgentFareDir drifts from getBaseDir SSOT", () => {
  const cases: Array<{ name: string; value: string | undefined }> = [
    { name: "unset", value: undefined },
    { name: "real path", value: "/tmp/agentfare-home" },
    { name: "empty string", value: "" },
    { name: "whitespace only", value: "   " },
    { name: "path with surrounding spaces", value: "  /tmp/af  " },
  ];

  afterEach(() => {
    delete process.env.AGENTFARE_HOME;
  });

  for (const c of cases) {
    it(`matches getBaseDir() when AGENTFARE_HOME is ${c.name}`, () => {
      if (c.value === undefined) delete process.env.AGENTFARE_HOME;
      else process.env.AGENTFARE_HOME = c.value;
      expect(resolveAgentFareDir()).toBe(getBaseDir());
    });
  }

  it("falls back to os.homedir()/.agentfare when override is unset/blank", () => {
    delete process.env.AGENTFARE_HOME;
    expect(resolveAgentFareDir()).toBe(path.join(os.homedir(), ".agentfare"));
    process.env.AGENTFARE_HOME = "   ";
    // Both getBaseDir and the mirror collapse blank to the default.
    expect(resolveAgentFareDir()).toBe(path.join(os.homedir(), ".agentfare"));
    expect(getBaseDir()).toBe(path.join(os.homedir(), ".agentfare"));
  });
});
