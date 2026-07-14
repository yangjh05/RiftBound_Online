const { createHash } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const UPDATE_HEADERS = { "ngrok-skip-browser-warning": "true" };

async function startAutoUpdate({ app, dialog, win, logger = console }) {
  if (!app.isPackaged || process.platform !== "win32") return { status: "skipped" };

  let progressVisible = false;
  try {
    const current = await readBuildInfo(path.resolve(__dirname, "..", "build-info.json"));
    const baseUrl = String(process.env.RIFTBOUND_UPDATE_URL || current.updateBaseUrl || "").replace(/\/+$/u, "");
    if (!baseUrl || !current.buildId) return { status: "disabled" };

    const latest = await fetchLatestManifest(`${baseUrl}/api/update/latest`);
    if (!isNewerBuild(current, latest)) return { status: "current", current, latest };

    const updateDir = path.join(app.getPath("temp"), "riftbound-online-updates", latest.buildId);
    const downloadedExe = path.join(updateDir, "Riftbound Online.exe");
    await fsp.mkdir(updateDir, { recursive: true });

    let cached = false;
    try {
      await verifyFile(downloadedExe, latest);
      cached = true;
    } catch {
      await fsp.rm(downloadedExe, { force: true });
    }

    if (!cached) {
      progressVisible = true;
      win?.setProgressBar?.(0.01);
      const downloadUrl = new URL(latest.downloadUrl, `${baseUrl}/`).href;
      await downloadUpdate(downloadUrl, downloadedExe, latest, (received, total) => {
        if (!win || win.isDestroyed?.()) return;
        win.setProgressBar(total > 0 ? Math.min(1, received / total) : 2);
      });
      await verifyFile(downloadedExe, latest);
    }

    if (progressVisible && win && !win.isDestroyed?.()) win.setProgressBar(-1);
    progressVisible = false;

    const choice = await dialog.showMessageBox(win, {
      type: "info",
      title: "Riftbound Online 업데이트",
      message: "새 버전 다운로드가 완료되었습니다.",
      detail: `버전 ${latest.version} (${latest.publishedAt})\n지금 재시작하면 업데이트가 적용됩니다.`,
      buttons: ["지금 업데이트", "나중에"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (choice.response !== 0) return { status: "ready", latest, downloadedExe };

    const targetExe = resolvePortableTarget();
    if (!targetExe) throw new Error("The original portable executable path is unavailable.");
    await launchUpdateHelper({ sourceExe: downloadedExe, targetExe, processId: process.pid });
    app.quit();
    return { status: "applying", latest, downloadedExe, targetExe };
  } catch (error) {
    if (progressVisible && win && !win.isDestroyed?.()) win.setProgressBar(-1);
    logger.warn?.(`[Updater] ${error?.message || error}`);
    return { status: "error", error };
  }
}

async function readBuildInfo(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

async function fetchLatestManifest(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers: UPDATE_HEADERS, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Update check failed with HTTP ${response.status}.`);
    const manifest = await response.json();
    validateRemoteManifest(manifest);
    return manifest;
  } finally {
    clearTimeout(timer);
  }
}

function isNewerBuild(current, latest) {
  if (!current?.buildId || !latest?.buildId || current.buildId === latest.buildId) return false;
  const currentTime = Date.parse(current.publishedAt || "");
  const latestTime = Date.parse(latest.publishedAt || "");
  if (Number.isFinite(currentTime) && Number.isFinite(latestTime)) return latestTime > currentTime;
  return String(latest.buildId) > String(current.buildId);
}

function validateRemoteManifest(manifest) {
  if (!manifest || manifest.ok !== true) throw new Error("The update manifest is invalid.");
  if (!/^[A-Za-z0-9._-]+$/u.test(manifest.buildId || "")) throw new Error("The update build ID is invalid.");
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) throw new Error("The update size is invalid.");
  if (!/^[a-f0-9]{64}$/u.test(manifest.sha256 || "")) throw new Error("The update checksum is invalid.");
  if (typeof manifest.downloadUrl !== "string" || !manifest.downloadUrl.startsWith("/api/update/download/")) {
    throw new Error("The update download URL is invalid.");
  }
  return manifest;
}

async function downloadUpdate(url, destination, manifest, onProgress = () => {}) {
  const partial = `${destination}.part`;
  await fsp.rm(partial, { force: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    const response = await fetch(url, { headers: UPDATE_HEADERS, signal: controller.signal, cache: "no-store" });
    if (!response.ok || !response.body) throw new Error(`Update download failed with HTTP ${response.status}.`);
    const headerSize = Number(response.headers.get("content-length") || 0);
    if (headerSize && headerSize !== manifest.size) throw new Error("The update download size does not match the manifest.");
    let received = 0;
    const progress = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        onProgress(received, manifest.size);
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(partial, { flags: "wx" }));
    await fsp.rename(partial, destination);
  } catch (error) {
    await fsp.rm(partial, { force: true });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyFile(filePath, manifest) {
  const file = await fsp.stat(filePath);
  if (!file.isFile() || file.size !== manifest.size) throw new Error("Downloaded update size verification failed.");
  const digest = await sha256File(filePath);
  if (digest !== manifest.sha256) throw new Error("Downloaded update checksum verification failed.");
  return true;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function resolvePortableTarget() {
  const target = process.env.PORTABLE_EXECUTABLE_FILE || "";
  if (!target || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== ".exe") return null;
  return path.resolve(target);
}

async function launchUpdateHelper({ sourceExe, targetExe, processId }) {
  const helperDir = path.dirname(sourceExe);
  const helperPath = path.join(helperDir, "apply-update.ps1");
  const logPath = path.join(helperDir, "apply-update.log");
  await fsp.writeFile(helperPath, powershellHelper(), "utf8");
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", helperPath,
    "-ProcessId", String(processId),
    "-Source", sourceExe,
    "-Target", targetExe,
    "-Log", logPath
  ], {
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref();
}

function powershellHelper() {
  return `param(
  [int]$ProcessId,
  [string]$Source,
  [string]$Target,
  [string]$Log
)
$ErrorActionPreference = "Stop"
try {
  Wait-Process -Id $ProcessId -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700
  $Staged = "$Target.update"
  $Backup = "$Target.previous"
  Copy-Item -LiteralPath $Source -Destination $Staged -Force
  if (Test-Path -LiteralPath $Backup) { Remove-Item -LiteralPath $Backup -Force }
  if (Test-Path -LiteralPath $Target) { Move-Item -LiteralPath $Target -Destination $Backup -Force }
  try {
    Move-Item -LiteralPath $Staged -Destination $Target -Force
  } catch {
    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force }
    if (Test-Path -LiteralPath $Backup) { Move-Item -LiteralPath $Backup -Destination $Target -Force }
    throw
  }
  Start-Process -FilePath $Target
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $Backup) { Remove-Item -LiteralPath $Backup -Force }
} catch {
  $_ | Out-File -LiteralPath $Log -Encoding utf8
}
`;
}

module.exports = {
  downloadUpdate,
  fetchLatestManifest,
  isNewerBuild,
  launchUpdateHelper,
  readBuildInfo,
  resolvePortableTarget,
  sha256File,
  startAutoUpdate,
  validateRemoteManifest,
  verifyFile
};
