import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..");
export const RUNTIME_PATHS = [
  "manifest.json",
  "content.js",
  "service-worker.js",
  "youtube-main.js",
  "youtube-overlay.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "icons",
  "surface",
  "transcript",
  "detector",
  "utils"
];

export function loadManifest(rootDir = ROOT_DIR) {
  const manifestPath = path.join(rootDir, "manifest.json");
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

export function resolveReleasePaths(rootDir = ROOT_DIR) {
  const distRoot = process.env.SCRIPTLENS_DIST_ROOT
    ? path.resolve(process.env.SCRIPTLENS_DIST_ROOT)
    : path.join(rootDir, "dist");

  return {
    rootDir,
    distRoot,
    stagingDir: path.join(distRoot, "chrome-unpacked"),
    packageDir: path.join(distRoot, "packages")
  };
}

export function buildExtension(rootDir = ROOT_DIR) {
  const { stagingDir } = resolveReleasePaths(rootDir);

  resetDirectory(stagingDir);

  for (const relativePath of RUNTIME_PATHS) {
    const sourcePath = path.join(rootDir, relativePath);
    const destinationPath = path.join(stagingDir, relativePath);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing runtime asset: ${relativePath}`);
    }

    fs.cpSync(sourcePath, destinationPath, {
      recursive: true,
      force: true
    });
  }

  return {
    manifest: loadManifest(rootDir),
    stagingDir,
    runtimePaths: RUNTIME_PATHS.slice()
  };
}

export async function packageExtension(rootDir = ROOT_DIR) {
  const build = buildExtension(rootDir);
  const { packageDir } = resolveReleasePaths(rootDir);
  const packageName = `scriptlens-youtube-v${build.manifest.version}.zip`;
  const zipPath = path.join(packageDir, packageName);

  fs.mkdirSync(packageDir, { recursive: true });
  fs.rmSync(zipPath, { force: true });

  await createZipArchive(build.stagingDir, zipPath);

  return {
    manifest: build.manifest,
    stagingDir: build.stagingDir,
    zipPath
  };
}

function resetDirectory(targetDir) {
  fs.rmSync(targetDir, {
    recursive: true,
    force: true
  });
  fs.mkdirSync(targetDir, { recursive: true });
}

async function createZipArchive(sourceDir, zipPath) {
  if (process.platform === "win32") {
    const command = [
      "Compress-Archive",
      "-Path",
      `'${toPowerShellPath(path.join(sourceDir, "*"))}'`,
      "-DestinationPath",
      `'${toPowerShellPath(zipPath)}'`,
      "-Force"
    ].join(" ");

    await execFileAsync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      command
    ]);
    return;
  }

  await execFileAsync("zip", ["-qr", zipPath, "."], {
    cwd: sourceDir
  });
}

function toPowerShellPath(value) {
  return String(value).replace(/'/g, "''");
}
