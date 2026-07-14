import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const distDir = path.join(root, "dist");
const portableExe = path.join(distDir, "Riftbound Online.exe");
const builderBin = process.platform === "win32"
  ? path.join(root, "node_modules", ".bin", "electron-builder.cmd")
  : path.join(root, "node_modules", ".bin", "electron-builder");

const buildInfo = await prepareBuildInfo();
await cleanBuildArtifacts();
let code = await runBuilder();

if (code !== 0) {
  console.log("Build failed. Cleaning locked build artifacts and retrying once...");
  await delay(2500);
  await cleanBuildArtifacts();
  code = await runBuilder();
}

if (code === 0) await publishUpdate(buildInfo);
process.exit(code);

async function prepareBuildInfo() {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const publishedAt = new Date().toISOString();
  const buildId = `${packageJson.version}-${publishedAt.replace(/[-:.TZ]/gu, "")}`;
  const info = {
    buildId,
    version: packageJson.version,
    publishedAt,
    updateBaseUrl: process.env.RIFTBOUND_UPDATE_URL || packageJson.riftboundUpdateBaseUrl || ""
  };
  await writeFile(path.join(root, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`, "utf8");
  return info;
}

async function publishUpdate(buildInfo) {
  const artifact = await stat(portableExe);
  const sha256 = await sha256File(portableExe);
  const publishedDir = path.join(distDir, "updates", buildInfo.buildId);
  const publishedExe = path.join(publishedDir, "Riftbound Online.exe");
  await mkdir(publishedDir, { recursive: true });
  await copyFile(portableExe, publishedExe);

  const manifest = {
    ok: true,
    ...buildInfo,
    size: artifact.size,
    sha256,
    downloadUrl: `/api/update/download/${encodeURIComponent(buildInfo.buildId)}`
  };
  const manifestPath = path.join(distDir, "update.json");
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryPath, manifestPath);
  console.log(`Published update ${buildInfo.buildId} (${artifact.size} bytes).`);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function cleanBuildArtifacts() {
  await removeWithRetry(path.join(distDir, "win-unpacked"));
  await removeWithRetry(path.join(distDir, "riftbound-online-0.1.0-x64.nsis.7z"));
}

async function removeWithRetry(target) {
  if (!existsSync(target)) return;
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(attempt * 500);
    }
  }
  throw lastError;
}

function runBuilder() {
  return new Promise((resolve) => {
    const child = spawn(builderBin, ["--win", "portable"], {
      cwd: root,
      stdio: "inherit",
      shell: false
    });
    child.on("close", resolve);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
