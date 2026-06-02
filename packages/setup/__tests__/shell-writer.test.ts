import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  generateShellFunctions,
  writeShellConfig,
  generatePowerShellFunctions,
  writePowerShellProfile,
  getPowerShellProfilePath,
} from "../src/shell-writer.js";

describe("generateShellFunctions", () => {
  it("should generate shell functions for detected tools", () => {
    const result = generateShellFunctions([
      { name: "codex" },
      { name: "claude" },
    ]);
    expect(result).toContain("codex()");
    expect(result).toContain("claude()");
    expect(result).toContain("$HOME/.agentfare/loader.js");
  });

  it("should wrap output in markers", () => {
    const result = generateShellFunctions([{ name: "codex" }]);
    expect(result).toContain("# >>> agentfare >>>");
    expect(result).toContain("# <<< agentfare <<<");
  });
});

// ---------------------------------------------------------------------------
// Phase 5.3: writeShellConfig — idempotent writes & platform handling
// ---------------------------------------------------------------------------
describe("writeShellConfig", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `agentfare-shell-test-${Date.now()}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    // Also set USERPROFILE on Windows since os.homedir() may use it
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("idempotent write: writing twice produces only one set of markers", () => {
    // Create .bashrc so writeShellConfig finds it
    const bashrc = path.join(tmpHome, ".bashrc");
    fs.writeFileSync(bashrc, "# my bashrc\n");

    const content = generateShellFunctions([{ name: "codex" }]);

    writeShellConfig(content);
    writeShellConfig(content);

    const result = fs.readFileSync(bashrc, "utf-8");
    const markerCount = (result.match(/# >>> agentfare >>>/g) || []).length;
    expect(markerCount).toBe(1);
  });

  it("idempotent write: updating config replaces old content", () => {
    const bashrc = path.join(tmpHome, ".bashrc");
    fs.writeFileSync(bashrc, "# my bashrc\n");

    const content1 = generateShellFunctions([{ name: "codex" }]);
    writeShellConfig(content1);

    const content2 = generateShellFunctions([{ name: "claude" }]);
    writeShellConfig(content2);

    const result = fs.readFileSync(bashrc, "utf-8");
    // Should have claude, not codex
    expect(result).toContain("claude()");
    // Should NOT have codex since old block was replaced
    expect(result).not.toContain("codex()");
    // Only one set of markers
    const markerCount = (result.match(/# >>> agentfare >>>/g) || []).length;
    expect(markerCount).toBe(1);
  });

  it("writes to .bashrc when no rc file exists (fallback)", () => {
    // tmpHome has no .zshrc and no .bashrc
    const content = generateShellFunctions([{ name: "codex" }]);
    const writtenPath = writeShellConfig(content);

    expect(writtenPath).toBe(path.join(tmpHome, ".bashrc"));
    expect(fs.existsSync(writtenPath)).toBe(true);
    const result = fs.readFileSync(writtenPath, "utf-8");
    expect(result).toContain("codex()");
  });

  it("prefers .zshrc over .bashrc when both exist", () => {
    fs.writeFileSync(path.join(tmpHome, ".zshrc"), "# zsh\n");
    fs.writeFileSync(path.join(tmpHome, ".bashrc"), "# bash\n");

    const content = generateShellFunctions([{ name: "codex" }]);
    const writtenPath = writeShellConfig(content);

    expect(writtenPath).toBe(path.join(tmpHome, ".zshrc"));
    // .bashrc should remain untouched
    expect(fs.readFileSync(path.join(tmpHome, ".bashrc"), "utf-8")).toBe("# bash\n");
  });
});

// ---------------------------------------------------------------------------
// PowerShell function generation and profile writing
// ---------------------------------------------------------------------------

describe("generatePowerShellFunctions", () => {
  it("generates PowerShell functions for detected tools", () => {
    const result = generatePowerShellFunctions([
      { name: "codex" },
      { name: "claude" },
    ]);
    expect(result).toContain("function codex");
    expect(result).toContain("function claude");
    expect(result).toContain("$env:NODE_OPTIONS");
    expect(result).toContain("loader.js");
    expect(result).toContain("Get-Command 'codex.cmd'");
    expect(result).toContain("Get-Command 'claude.cmd'");
    expect(result).toContain("& $__agentfare_bin @args");
    expect(result).toContain("Remove-Item Env:\\NODE_OPTIONS");
  });

  it("wraps output in markers", () => {
    const result = generatePowerShellFunctions([{ name: "codex" }]);
    expect(result).toContain("# >>> agentfare >>>");
    expect(result).toContain("# <<< agentfare <<<");
  });
});

describe("writePowerShellProfile", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `agentfare-ps-test-${Date.now()}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("creates profile directory and file when none exists", () => {
    const content = generatePowerShellFunctions([{ name: "claude" }]);
    const writtenPath = writePowerShellProfile(content);
    expect(fs.existsSync(writtenPath)).toBe(true);
    const result = fs.readFileSync(writtenPath, "utf-8");
    expect(result).toContain("function claude");
  });

  it("idempotent: writing twice produces only one set of markers", () => {
    const content = generatePowerShellFunctions([{ name: "claude" }]);
    writePowerShellProfile(content);
    writePowerShellProfile(content);
    const writtenPath = getPowerShellProfilePath();
    const result = fs.readFileSync(writtenPath, "utf-8");
    const markerCount = (result.match(/# >>> agentfare >>>/g) || []).length;
    expect(markerCount).toBe(1);
  });

  it("replaces old block when tools change", () => {
    const content1 = generatePowerShellFunctions([{ name: "codex" }]);
    writePowerShellProfile(content1);
    const content2 = generatePowerShellFunctions([{ name: "claude" }]);
    writePowerShellProfile(content2);
    const writtenPath = getPowerShellProfilePath();
    const result = fs.readFileSync(writtenPath, "utf-8");
    expect(result).toContain("function claude");
    expect(result).not.toContain("function codex");
  });

  it("prefers existing PS7 profile over PS5", () => {
    const ps7Dir = path.join(tmpHome, "Documents", "PowerShell");
    fs.mkdirSync(ps7Dir, { recursive: true });
    fs.writeFileSync(
      path.join(ps7Dir, "Microsoft.PowerShell_profile.ps1"),
      "# PS7\n"
    );
    const content = generatePowerShellFunctions([{ name: "claude" }]);
    const writtenPath = writePowerShellProfile(content);
    expect(writtenPath).toContain("PowerShell");
    expect(writtenPath).not.toContain("WindowsPowerShell");
  });

  it("uses PS5 profile if it exists and PS7 does not", () => {
    const ps5Dir = path.join(tmpHome, "Documents", "WindowsPowerShell");
    fs.mkdirSync(ps5Dir, { recursive: true });
    fs.writeFileSync(
      path.join(ps5Dir, "Microsoft.PowerShell_profile.ps1"),
      "# PS5\n"
    );
    const content = generatePowerShellFunctions([{ name: "claude" }]);
    const writtenPath = writePowerShellProfile(content);
    expect(writtenPath).toContain("WindowsPowerShell");
  });
});
