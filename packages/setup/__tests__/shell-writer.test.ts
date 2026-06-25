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
  generateProxyExports,
  generatePowerShellExports,
  writeProxyConfig,
  captureUserBaseUrls,
} from "../src/shell-writer.js";
import { detectPlatform, type DetectedTool } from "../src/detector.js";

describe("generateShellFunctions", () => {
  it("should generate shell functions for detected tools", () => {
    const result = generateShellFunctions([
      { name: "codex" },
      { name: "claude" },
    ]);
    expect(result).toContain("codex()");
    expect(result).toContain("claude()");
    expect(result).toContain("${AGENTFARE_HOME:-$HOME/.agentfare}/loader.js");
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

// ---------------------------------------------------------------------------
// Proxy export generators
// ---------------------------------------------------------------------------

const cliTools: DetectedTool[] = [
  { name: "claude" as const, type: "cli" as const, envVar: "ANTHROPIC_BASE_URL", proxyPath: "/anthropic", provider: "anthropic", envKey: "ANTHROPIC_API_KEY", envKeyPresent: true, path: "/usr/local/bin/claude" },
  { name: "codex" as const, type: "cli" as const, envVar: "OPENAI_BASE_URL", proxyPath: "/openai", provider: "openai", envKey: "OPENAI_API_KEY", envKeyPresent: false, path: "/usr/local/bin/codex" },
];
const ideTools: DetectedTool[] = [
  { name: "cursor" as const, type: "ide" as const, proxyPath: "/openai", provider: "openai", envKey: "OPENAI_API_KEY", envKeyPresent: false, path: "/Applications/Cursor.app" },
];

describe("generateProxyExports", () => {
  it("should generate export lines for CLI tools", () => {
    const result = generateProxyExports(cliTools, 3456);
    expect(result).toContain('export ANTHROPIC_BASE_URL="http://localhost:3456/anthropic"');
    expect(result).toContain('export OPENAI_BASE_URL="http://localhost:3456/openai"');
  });

  it("should filter out IDE tools", () => {
    const mixed = [...cliTools, ...ideTools];
    const result = generateProxyExports(mixed, 3456);
    expect(result).not.toContain("cursor");
    expect(result).toContain("ANTHROPIC_BASE_URL");
    expect(result).toContain("OPENAI_BASE_URL");
  });

  it("should wrap output in markers", () => {
    const result = generateProxyExports(cliTools, 3456);
    expect(result).toContain("# >>> agentfare >>>");
    expect(result).toContain("# <<< agentfare <<<");
  });
});

describe("generatePowerShellExports", () => {
  it("should generate $env: lines for CLI tools", () => {
    const result = generatePowerShellExports(cliTools, 3456);
    expect(result).toContain('$env:ANTHROPIC_BASE_URL = "http://localhost:3456/anthropic"');
    expect(result).toContain('$env:OPENAI_BASE_URL = "http://localhost:3456/openai"');
  });

  it("should wrap output in markers", () => {
    const result = generatePowerShellExports(cliTools, 3456);
    expect(result).toContain("# >>> agentfare >>>");
    expect(result).toContain("# <<< agentfare <<<");
  });
});

describe("writeProxyConfig", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `agentfare-proxy-test-${Date.now()}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("writes proxy exports to shell config", () => {
    const platform = detectPlatform();
    if (platform === "windows-native") {
      // writeProxyConfig delegates to PowerShell on Windows
      const { rcPath } = writeProxyConfig(cliTools, 3456);
      expect(fs.existsSync(rcPath)).toBe(true);
      const result = fs.readFileSync(rcPath, "utf-8");
      expect(result).toContain('$env:ANTHROPIC_BASE_URL = "http://localhost:3456/anthropic"');
      expect(result).toContain('$env:OPENAI_BASE_URL = "http://localhost:3456/openai"');
    } else {
      // POSIX: writes to .bashrc
      const bashrc = path.join(tmpHome, ".bashrc");
      fs.writeFileSync(bashrc, "# my bashrc\n");
      writeProxyConfig(cliTools, 3456);
      const result = fs.readFileSync(bashrc, "utf-8");
      expect(result).toContain('export ANTHROPIC_BASE_URL="http://localhost:3456/anthropic"');
      expect(result).toContain('export OPENAI_BASE_URL="http://localhost:3456/openai"');
    }
  });

  it("idempotent: writing twice produces only one set of markers", () => {
    const platform = detectPlatform();
    if (platform === "windows-native") {
      writeProxyConfig(cliTools, 3456);
      writeProxyConfig(cliTools, 3456);
      const profilePath = getPowerShellProfilePath();
      const result = fs.readFileSync(profilePath, "utf-8");
      const markerCount = (result.match(/# >>> agentfare >>>/g) || []).length;
      expect(markerCount).toBe(1);
    } else {
      const bashrc = path.join(tmpHome, ".bashrc");
      fs.writeFileSync(bashrc, "# my bashrc\n");
      writeProxyConfig(cliTools, 3456);
      writeProxyConfig(cliTools, 3456);
      const result = fs.readFileSync(bashrc, "utf-8");
      const markerCount = (result.match(/# >>> agentfare >>>/g) || []).length;
      expect(markerCount).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// captureUserBaseUrls — multi-source upstream URL capture
// ---------------------------------------------------------------------------
describe("captureUserBaseUrls", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = path.join(os.tmpdir(), `agentfare-capture-test-${Date.now()}`);
    fs.mkdirSync(tmpHome, { recursive: true });
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("captures from process.env", () => {
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    const result = captureUserBaseUrls(cliTools);
    expect(result.anthropic).toBe("https://api.anthropic.com");
  });

  it("skips localhost URLs from process.env", () => {
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3456/anthropic";
    const result = captureUserBaseUrls(cliTools);
    expect(result.anthropic).toBeUndefined();
  });

  it("falls back to Claude Code's settings.json when env var is absent", () => {
    // No process.env set — simulate Claude Code's settings.json
    const claudeDir = path.join(tmpHome, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        env: { ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic" },
      })
    );

    const result = captureUserBaseUrls(cliTools);
    expect(result.anthropic).toBe("https://open.bigmodel.cn/api/anthropic");
  });

  it("falls back to settings.json when env var is localhost", () => {
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3456/anthropic";
    const claudeDir = path.join(tmpHome, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        env: { ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic" },
      })
    );

    const result = captureUserBaseUrls(cliTools);
    expect(result.anthropic).toBe("https://open.bigmodel.cn/api/anthropic");
  });

  it("prefers process.env over settings.json when both have non-localhost values", () => {
    process.env.ANTHROPIC_BASE_URL = "https://real.anthropic.com";
    const claudeDir = path.join(tmpHome, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        env: { ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic" },
      })
    );

    const result = captureUserBaseUrls(cliTools);
    expect(result.anthropic).toBe("https://real.anthropic.com");
  });

  it("returns empty when no source has the value", () => {
    const result = captureUserBaseUrls(cliTools);
    expect(result.anthropic).toBeUndefined();
  });

  it("captures multiple providers from mixed sources", () => {
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    // ANTHROPIC from settings.json, OPENAI from process.env
    const claudeDir = path.join(tmpHome, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        env: { ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic" },
      })
    );

    const result = captureUserBaseUrls(cliTools);
    expect(result.anthropic).toBe("https://open.bigmodel.cn/api/anthropic");
    expect(result.openai).toBe("https://api.openai.com/v1");
  });
});
