const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect } = require("@playwright/test");

const rootDir = path.join(__dirname, "..");

test.describe("ScriptLens release packaging", () => {
  test("manifest stays trimmed to the YouTube-only release permissions", async () => {
    const { loadManifest } = await import(path.join(rootDir, "scripts", "release-lib.mjs"));
    const manifest = loadManifest(rootDir);

    expect(manifest.permissions).toEqual(["sidePanel", "storage"]);
    expect(manifest.host_permissions).toEqual(["https://www.youtube.com/*"]);
    expect(manifest.description).toContain("YouTube");
    expect(manifest.description).not.toContain("page");
  });

  test("buildExtension stages only runtime assets", async () => {
    const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriptlens-build-"));
    process.env.SCRIPTLENS_DIST_ROOT = distRoot;

    try {
      const { buildExtension } = await import(path.join(rootDir, "scripts", "release-lib.mjs"));
      const build = buildExtension(rootDir);
      const entries = listRelativeFiles(build.stagingDir);

      expect(entries).toContain("manifest.json");
      expect(entries).toContain("surface/shared.js");
      expect(entries).toContain("icons/icon128.png");
      expect(entries.some((entry) => entry.startsWith("tests/"))).toBeFalsy();
      expect(entries.some((entry) => entry.startsWith("backend/"))).toBeFalsy();
      expect(entries.some((entry) => entry.startsWith("node_modules/"))).toBeFalsy();
      expect(entries).not.toContain("playwright.config.js");
    } finally {
      delete process.env.SCRIPTLENS_DIST_ROOT;
      fs.rmSync(distRoot, { recursive: true, force: true });
    }
  });

  test("packageExtension creates a non-empty Chrome Web Store zip", async () => {
    const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scriptlens-package-"));
    process.env.SCRIPTLENS_DIST_ROOT = distRoot;

    try {
      const { packageExtension } = await import(path.join(rootDir, "scripts", "release-lib.mjs"));
      const artifact = await packageExtension(rootDir);

      expect(fs.existsSync(artifact.zipPath)).toBeTruthy();
      expect(fs.statSync(artifact.zipPath).size).toBeGreaterThan(0);
    } finally {
      delete process.env.SCRIPTLENS_DIST_ROOT;
      fs.rmSync(distRoot, { recursive: true, force: true });
    }
  });
});

function listRelativeFiles(targetDir, prefix = "") {
  return fs.readdirSync(targetDir, { withFileTypes: true }).flatMap((entry) => {
    const nextRelative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const nextPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      return listRelativeFiles(nextPath, nextRelative);
    }
    return [nextRelative];
  });
}
