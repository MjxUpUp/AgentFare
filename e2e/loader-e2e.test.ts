import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * E2E: Loader script generation tests.
 *
 * Tests that ensureLoaderScript() creates a valid loader.js file
 * in the expected ~/.agentfare/ directory with the correct content.
 *
 * Note: Because ensureLoaderScript() uses os.homedir() evaluated at
 * module scope, we test against the real home directory. The function
 * is idempotent and safe to call repeatedly — it only creates the file
 * if it doesn't already exist.
 */
describe("E2E: Loader script generation", () => {
  const loaderDir = path.join(os.homedir(), ".agentfare");
  const loaderFile = path.join(loaderDir, "loader.js");
  let fileExistedBefore: boolean;

  afterEach(() => {
    // If the file didn't exist before the test and we're in a test-specific
    // temp location, clean up. For the real homedir, we leave it (it's
    // the expected production path).
  });

  it("should return a path to loader.js inside ~/.agentfare/", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");

    const result = ensureLoaderScript();

    expect(result).toBe(path.join(os.homedir(), ".agentfare", "loader.js"));
  });

  it("should create the .agentfare directory if it does not exist", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");

    ensureLoaderScript();

    // Directory should exist
    expect(fs.existsSync(loaderDir)).toBe(true);
    expect(fs.statSync(loaderDir).isDirectory()).toBe(true);
  });

  it("should create loader.js file that contains hook require", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");

    ensureLoaderScript();

    // File should exist
    expect(fs.existsSync(loaderFile)).toBe(true);

    // Content should contain the hook require (absolute path or bare specifier)
    const content = fs.readFileSync(loaderFile, "utf-8");
    expect(content).toMatch(/require\(["'].*hook/);
    expect(content).toContain("require");
    expect(content).toContain("hooks");
  });

  it("should not overwrite existing loader.js with custom edits", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");

    // First call to ensure file exists
    ensureLoaderScript();

    // If the file was just created, add a custom marker
    const contentBefore = fs.readFileSync(loaderFile, "utf-8");
    const customMarker = "// E2E_TEST_MARKER_" + Date.now();

    // Only add marker if it doesn't already have one (file was fresh)
    if (!contentBefore.includes("E2E_TEST_MARKER_")) {
      fs.appendFileSync(loaderFile, `\n${customMarker}\n`);
    }

    // Second call should NOT overwrite
    ensureLoaderScript();

    const contentAfter = fs.readFileSync(loaderFile, "utf-8");
    expect(contentAfter).toContain(customMarker);

    // Clean up the marker
    const cleaned = contentAfter.replace(`\n${customMarker}\n`, "");
    fs.writeFileSync(loaderFile, cleaned);
  });

  it("should produce a valid JavaScript file that can be parsed", async () => {
    const { ensureLoaderScript } = await import("@agentfare/loader");

    ensureLoaderScript();

    const content = fs.readFileSync(loaderFile, "utf-8");

    // Verify it's parseable JavaScript (no syntax errors)
    expect(() => new Function(content)).not.toThrow();
  });
});
