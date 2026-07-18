const { createHash, createPublicKey, verify: verifySignature } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const UPDATE_HEADERS = {};
const UPDATE_STATE_VERSION = 1;
const DEFER_DURATION_MS = 24 * 60 * 60 * 1000;
const PENDING_GRACE_MS = 5 * 60 * 1000;
const HELPER_READY_TIMEOUT_MS = 30000;

async function startAutoUpdate({ app, dialog, win, logger = console, onStatus = () => {} }) {
  onStatus({ phase: "initializing", message: "업데이트 시스템을 준비하고 있습니다…" });
  if (!app.isPackaged || process.platform !== "win32") {
    onStatus({ phase: "disabled", message: "개발 모드로 게임을 시작합니다.", progress: 1 });
    return { status: "skipped" };
  }

  let progressVisible = false;
  const statePath = path.join(app.getPath("userData"), "updater-state.json");
  try {
    const current = await readBuildInfo(path.resolve(__dirname, "..", "build-info.json"));
    const publicKey = await fsp.readFile(path.resolve(__dirname, "update-public-key.pub"), "utf8");
    let state = await readUpdateState(statePath, logger);
    onStatus({ phase: "recovering", message: "이전 업데이트 상태를 확인하고 있습니다…" });
    const recovery = await recoverPendingUpdate({ current, state, statePath, dialog, win, logger });
    state = recovery.state;
    if (recovery.status === "pending") {
      onStatus({ phase: "applying", message: "업데이트 교체가 완료되기를 기다리고 있습니다…" });
      app.quit();
      return { status: "applying", current };
    }

    const baseUrl = String(process.env.RIFTBOUND_UPDATE_URL || current.updateBaseUrl || "").replace(/\/+$/u, "");
    if (!baseUrl || !current.buildId) {
      onStatus({ phase: "disabled", message: "업데이트가 비활성화되어 있습니다.", detail: "현재 버전으로 시작합니다.", progress: 1 });
      return { status: "disabled" };
    }

    onStatus({ phase: "checking", message: "새로운 버전을 확인하고 있습니다…", detail: `현재 버전 ${current.version || "알 수 없음"}` });
    const latest = await fetchLatestManifest(`${baseUrl}/api/update/latest`, publicKey);
    if (!isNewerBuild(current, latest)) {
      onStatus({ phase: "current", message: "최신 버전입니다.", detail: `버전 ${current.version}`, progress: 1 });
      return { status: "current", current, latest };
    }
    if (isDeferredBuild(state, latest.buildId)) {
      onStatus({ phase: "deferred", message: "보류한 업데이트가 있습니다.", detail: "현재 버전으로 시작합니다.", progress: 1 });
      return { status: "deferred", current, latest };
    }
    onStatus({ phase: "available", message: `새 버전 ${latest.version}을 준비합니다.`, detail: formatBytes(latest.size) });

    const updateDir = path.join(app.getPath("temp"), "riftbound-online-updates", latest.buildId);
    const downloadedExe = path.join(updateDir, "Riftbound Online.exe");
    const resultPath = path.join(updateDir, "apply-update-result.json");
    const logPath = path.join(updateDir, "apply-update.log");
    const readyPath = path.join(updateDir, "apply-update-ready");
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
        onStatus({
          phase: "downloading",
          message: "업데이트를 다운로드하고 있습니다…",
          detail: `${formatBytes(received)} / ${formatBytes(total)}`,
          progress: total > 0 ? received / total : undefined
        });
        if (!win || win.isDestroyed?.()) return;
        win.setProgressBar(total > 0 ? Math.min(1, received / total) : 2);
      });
    } else {
      onStatus({ phase: "downloading", message: "다운로드된 업데이트를 불러왔습니다.", detail: formatBytes(latest.size), progress: 1 });
    }
    onStatus({ phase: "verifying", message: "업데이트 파일의 무결성을 검증하고 있습니다…" });
    await verifyFile(downloadedExe, latest);

    if (progressVisible && win && !win.isDestroyed?.()) win.setProgressBar(-1);
    progressVisible = false;

    onStatus({ phase: "ready", message: "업데이트 준비가 완료되었습니다.", detail: "확인 후 앱을 교체하고 자동으로 재실행합니다.", progress: 1 });
    const choice = await dialog.showMessageBox(win, {
      type: "info",
      title: "Riftbound Online 업데이트",
      message: "새 버전 다운로드와 검증이 완료되었습니다.",
      detail: `버전 ${latest.version}\n\n지금 업데이트하면 앱을 안전하게 교체한 뒤 자동으로 다시 실행합니다. 최대 30초 정도 걸릴 수 있습니다.`,
      buttons: ["지금 업데이트", "이번에는 건너뛰기"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (choice.response !== 0) {
      state.deferred = { buildId: latest.buildId, until: new Date(Date.now() + DEFER_DURATION_MS).toISOString() };
      await writeUpdateState(statePath, state);
      onStatus({ phase: "deferred", message: "업데이트를 건너뛰었습니다.", detail: "현재 버전으로 시작합니다.", progress: 1 });
      return { status: "deferred", latest, downloadedExe };
    }

    onStatus({ phase: "preparing", message: "실행파일 교체를 준비하고 있습니다…", detail: "앱이 잠시 종료된 뒤 자동으로 다시 열립니다." });
    const targetExe = resolvePortableTarget();
    if (!targetExe) throw new Error("The original portable executable path is unavailable.");
    state.pending = {
      buildId: latest.buildId,
      targetExe,
      resultPath,
      logPath,
      startedAt: new Date().toISOString()
    };
    state.deferred = null;
    await fsp.rm(resultPath, { force: true });
    await writeUpdateState(statePath, state);
    try {
      await launchUpdateHelper({ sourceExe: downloadedExe, targetExe, processId: process.pid, readyPath, resultPath, logPath });
    } catch (error) {
      state.pending = null;
      state.deferred = { buildId: latest.buildId, until: new Date(Date.now() + DEFER_DURATION_MS).toISOString() };
      state.lastFailure = failureRecord(latest.buildId, error?.message || String(error));
      await writeUpdateState(statePath, state);
      await dialog.showMessageBox(win, {
        type: "error",
        title: "Riftbound Online 업데이트 실패",
        message: "업데이트 도구를 실행하지 못했습니다.",
        detail: `${error?.message || error}\n\n같은 업데이트는 24시간 동안 다시 알리지 않습니다.`,
        buttons: ["확인"],
        defaultId: 0,
        noLink: true
      });
      throw error;
    }
    onStatus({ phase: "applying", message: "앱을 종료하고 실행파일을 교체합니다…", detail: "완료되면 자동으로 다시 실행됩니다.", progress: 1 });
    app.quit();
    return { status: "applying", latest, downloadedExe, targetExe };
  } catch (error) {
    if (progressVisible && win && !win.isDestroyed?.()) win.setProgressBar(-1);
    logger.warn?.(`[Updater] ${error?.message || error}`);
    onStatus({ phase: "error", message: "업데이트 확인 중 문제가 발생했습니다.", detail: error?.message || String(error) });
    return { status: "error", error };
  }
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "크기 확인 중";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function recoverPendingUpdate({ current, state, statePath, dialog, win, logger = console, now = Date.now() }) {
  const pending = state.pending;
  if (!pending?.buildId) return { status: "none", state };

  if (current.buildId === pending.buildId) {
    await fsp.rm(pending.resultPath || "", { force: true }).catch(() => {});
    if (pending.targetExe) await fsp.rm(`${pending.targetExe}.previous`, { force: true }).catch(() => {});
    state.pending = null;
    state.deferred = null;
    state.lastFailure = null;
    await writeUpdateState(statePath, state);
    return { status: "applied", state };
  }

  const result = await readJsonIfPresent(pending.resultPath);
  const age = now - Date.parse(pending.startedAt || "");
  if (!result && Number.isFinite(age) && age < PENDING_GRACE_MS) return { status: "pending", state };
  if (result?.status === "success" && Number.isFinite(age) && age < PENDING_GRACE_MS) return { status: "pending", state };

  const reason = result?.message || "업데이트 적용 후에도 이전 버전이 실행되었습니다.";
  state.pending = null;
  state.deferred = { buildId: pending.buildId, until: new Date(now + DEFER_DURATION_MS).toISOString() };
  state.lastFailure = failureRecord(pending.buildId, reason, now);
  await writeUpdateState(statePath, state);
  logger.warn?.(`[Updater] ${reason}`);
  await dialog.showMessageBox(win, {
    type: "error",
    title: "Riftbound Online 업데이트 실패",
    message: "업데이트를 적용하지 못했습니다.",
    detail: `${reason}\n\n24시간 동안 같은 업데이트 알림을 다시 표시하지 않습니다.${pending.logPath ? `\n로그: ${pending.logPath}` : ""}`,
    buttons: ["확인"],
    defaultId: 0,
    noLink: true
  });
  return { status: "failed", state };
}

function failureRecord(buildId, message, now = Date.now()) {
  return { buildId, message, failedAt: new Date(now).toISOString() };
}

function isDeferredBuild(state, buildId, now = Date.now()) {
  return state?.deferred?.buildId === buildId && Date.parse(state.deferred.until || "") > now;
}

async function readUpdateState(filePath, logger = console) {
  try {
    const state = JSON.parse(await fsp.readFile(filePath, "utf8"));
    if (state?.schemaVersion !== UPDATE_STATE_VERSION) throw new Error("Unsupported updater state version.");
    return state;
  } catch (error) {
    if (error?.code !== "ENOENT") logger.warn?.(`[Updater] Ignoring invalid updater state: ${error?.message || error}`);
    return { schemaVersion: UPDATE_STATE_VERSION, deferred: null, pending: null, lastFailure: null };
  }
}

async function writeUpdateState(filePath, state) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify({ ...state, schemaVersion: UPDATE_STATE_VERSION }, null, 2)}\n`, "utf8");
  await fsp.rename(temporary, filePath);
}

async function readJsonIfPresent(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse((await fsp.readFile(filePath, "utf8")).replace(/^\uFEFF/u, ""));
  } catch {
    return null;
  }
}

async function readBuildInfo(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

async function fetchLatestManifest(url, publicKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers: UPDATE_HEADERS, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Update check failed with HTTP ${response.status}.`);
    const manifest = await response.json();
    validateRemoteManifest(manifest);
    verifyManifestSignature(manifest, publicKey);
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
  if (typeof manifest.version !== "string" || !manifest.version) throw new Error("The update version is invalid.");
  if (!Number.isFinite(Date.parse(manifest.publishedAt || ""))) throw new Error("The update publication time is invalid.");
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) throw new Error("The update size is invalid.");
  if (!/^[a-f0-9]{64}$/u.test(manifest.sha256 || "")) throw new Error("The update checksum is invalid.");
  if (typeof manifest.downloadUrl !== "string" || !/^\/api\/update\/download\/[A-Za-z0-9._-]+$/u.test(manifest.downloadUrl)) {
    throw new Error("The update download URL is invalid.");
  }
  if (typeof manifest.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/u.test(manifest.signature)) {
    throw new Error("The update signature is invalid.");
  }
  return manifest;
}

function manifestSignaturePayload(manifest) {
  return Buffer.from(JSON.stringify({
    buildId: manifest.buildId,
    version: manifest.version,
    publishedAt: manifest.publishedAt,
    updateBaseUrl: manifest.updateBaseUrl || "",
    size: manifest.size,
    sha256: manifest.sha256,
    downloadUrl: manifest.downloadUrl
  }), "utf8");
}

function verifyManifestSignature(manifest, publicKey) {
  let key;
  try {
    key = createPublicKey(publicKey);
  } catch {
    throw new Error("The bundled update public key is invalid.");
  }
  const valid = verifySignature(null, manifestSignaturePayload(manifest), key, Buffer.from(manifest.signature, "base64"));
  if (!valid) throw new Error("The update manifest signature verification failed.");
  return true;
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

async function launchUpdateHelper({ sourceExe, targetExe, processId, readyPath, resultPath, logPath, spawnImpl = spawn }) {
  const helperDir = path.dirname(sourceExe);
  const workerPath = path.join(helperDir, "apply-update.ps1");
  const bootstrapPath = path.join(helperDir, "start-apply-update.ps1");
  const workerReadyPath = `${readyPath}.worker`;
  await fsp.writeFile(workerPath, powershellHelper(), "utf8");
  await fsp.writeFile(bootstrapPath, powershellBootstrap(), "utf8");
  await Promise.all([
    fsp.rm(readyPath, { force: true }),
    fsp.rm(workerReadyPath, { force: true })
  ]);
  const child = await new Promise((resolve, reject) => {
    const child = spawnImpl(resolvePowerShellCommand(), [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-WindowStyle", "Hidden",
      "-File", bootstrapPath,
      "-PowerShell", resolvePowerShellCommand(),
      "-Worker", workerPath,
      "-ProcessId", String(processId),
      "-Source", sourceExe,
      "-Target", targetExe,
      "-Ready", workerReadyPath,
      "-BootstrapReady", readyPath,
      "-Result", resultPath,
      "-Log", logPath
    ], {
      windowsHide: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      resolve(child);
    });
  });
  try {
    await Promise.race([
      waitForFile(readyPath, HELPER_READY_TIMEOUT_MS),
      new Promise((_, reject) => {
        child.once("exit", async (code, signal) => {
          try {
            await fsp.stat(readyPath);
          } catch {
            reject(new Error(`The update helper exited before it was ready (code ${code ?? "unknown"}, signal ${signal || "none"}).`));
          }
        });
      })
    ]);
  } catch (error) {
    child.kill?.();
    throw error;
  }
  child.unref();
}

function resolvePowerShellCommand() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  const bundledPowerShell = systemRoot
    ? path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "";
  return bundledPowerShell && fs.existsSync(bundledPowerShell) ? bundledPowerShell : "powershell.exe";
}

async function waitForFile(filePath, timeoutMs, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const file = await fsp.stat(filePath);
      if (file.isFile()) return true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("The update helper did not signal readiness.");
}

function powershellHelper() {
  return `param(
  [int]$ProcessId,
  [string]$Source,
  [string]$Target,
  [string]$Ready,
  [string]$Result,
  [string]$Log
)
$ErrorActionPreference = "Stop"
"ready" | Out-File -LiteralPath $Ready -Encoding ascii
function Write-Result([string]$Status, [string]$Message) {
  $Temporary = "$Result.tmp"
  @{ status = $Status; message = $Message; completedAt = (Get-Date).ToUniversalTime().ToString("o") } |
    ConvertTo-Json | Out-File -LiteralPath $Temporary -Encoding utf8
  Move-Item -LiteralPath $Temporary -Destination $Result -Force
}
try {
  "Waiting for application process $ProcessId" | Out-File -LiteralPath $Log -Encoding utf8
  Wait-Process -Id $ProcessId -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700
  $Staged = "$Target.update"
  $Backup = "$Target.previous"
  "Staging update executable" | Out-File -LiteralPath $Log -Encoding utf8 -Append
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
  "Starting updated application" | Out-File -LiteralPath $Log -Encoding utf8 -Append
  Start-Process -FilePath $Target -WorkingDirectory (Split-Path -Parent $Target)
  Write-Result "success" "Update executable replaced and started successfully."
} catch {
  $Message = ($_ | Out-String).Trim()
  $Message | Out-File -LiteralPath $Log -Encoding utf8
  Write-Result "failure" $Message
}
`;
}

function powershellBootstrap() {
  return `param(
  [string]$PowerShell,
  [string]$Worker,
  [int]$ProcessId,
  [string]$Source,
  [string]$Target,
  [string]$Ready,
  [string]$BootstrapReady,
  [string]$Result,
  [string]$Log
)
$ErrorActionPreference = "Stop"
function Quote-Argument([string]$Value) {
  return '"' + $Value.Replace('"', '\\"') + '"'
}
try {
  Remove-Item -LiteralPath $Ready -Force -ErrorAction SilentlyContinue
  $Arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", $Worker,
    "-ProcessId", $ProcessId,
    "-Source", $Source,
    "-Target", $Target,
    "-Ready", $Ready,
    "-Result", $Result,
    "-Log", $Log
  )
  $ArgumentLine = (($Arguments | ForEach-Object { Quote-Argument ([string]$_) }) -join " ")
  Start-Process -FilePath $PowerShell -ArgumentList $ArgumentLine -WindowStyle Hidden | Out-Null
  $Deadline = (Get-Date).AddMilliseconds(${HELPER_READY_TIMEOUT_MS})
  while ((Get-Date) -lt $Deadline -and -not (Test-Path -LiteralPath $Ready)) {
    Start-Sleep -Milliseconds 50
  }
  if (-not (Test-Path -LiteralPath $Ready)) {
    throw "The update worker did not signal readiness."
  }
  Move-Item -LiteralPath $Ready -Destination $BootstrapReady -Force
} catch {
  $Message = ($_ | Out-String).Trim()
  try { $Message | Out-File -LiteralPath $Log -Encoding utf8 } catch {}
  exit 1
}
`;
}

module.exports = {
  DEFER_DURATION_MS,
  PENDING_GRACE_MS,
  HELPER_READY_TIMEOUT_MS,
  downloadUpdate,
  fetchLatestManifest,
  isDeferredBuild,
  isNewerBuild,
  launchUpdateHelper,
  manifestSignaturePayload,
  powershellBootstrap,
  powershellHelper,
  readBuildInfo,
  readUpdateState,
  recoverPendingUpdate,
  resolvePortableTarget,
  sha256File,
  startAutoUpdate,
  validateRemoteManifest,
  verifyFile,
  verifyManifestSignature,
  waitForFile,
  writeUpdateState
};
