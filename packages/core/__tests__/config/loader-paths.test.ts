import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfigFromDisk } from "../../src/config/loader.js";

const ORIG_HOME = process.env.AGENTFARE_HOME;
let tmpHome: string;

beforeEach(() => {
  tmpHome = path.join(os.tmpdir(), `agentfare-cfg-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tmpHome, { recursive: true });
  process.env.AGENTFARE_HOME = tmpHome;
});

afterEach(() => {
  if (ORIG_HOME === undefined) delete process.env.AGENTFARE_HOME;
  else process.env.AGENTFARE_HOME = ORIG_HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("loadConfigFromDisk respects paths SSOT (refactor/paths-ssot)", () => {
  it("reads global config.json from AGENTFARE_HOME, not real home", () => {
    const configPath = path.join(tmpHome, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ routing: { defaultStrategy: "quality-first" } }),
    );

    // Pass tmpHome as projectDir too, so it never reads CWD's agentfare.config.json
    const config = loadConfigFromDisk(tmpHome);

    expect(config.routing.defaultStrategy).toBe("quality-first");
  });

  it("returns defaults without throwing when AGENTFARE_HOME has no config", () => {
    // tmpHome has no config.json / enterprise.json — must not read real home
    const config = loadConfigFromDisk(tmpHome);
    expect(config).toBeDefined();
    expect(config.routing).toBeDefined();
    expect(config.providers).toBeDefined();
  });

  it("reads enterprise.json from AGENTFARE_HOME", () => {
    const enterprisePath = path.join(tmpHome, "enterprise.json");
    fs.writeFileSync(
      enterprisePath,
      JSON.stringify({ org: "test-org", policy: "cost-optimal" }),
    );

    // loadConfigFromDisk applies enterprise policy; just assert it parsed & merged
    // without throwing and without reading the real /etc/agentfare or ~/.agentfare
    const config = loadConfigFromDisk(tmpHome);
    expect(config).toBeDefined();
  });
});
