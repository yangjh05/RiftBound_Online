import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname, uptime } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const executeFile = promisify(execFile);
let bootTimePromise = null;
const legacyOwnerChecks = new Map();

// Date.now() - uptime() moves when Windows corrects its clock after sleep.
// Use the OS boot record, cached for this process lifetime, so a living lock
// cannot become a previous-boot lock merely because the wall clock moved.
export function readLockBootTimeMs() {
  if (!bootTimePromise) bootTimePromise = (async () => {
    if (process.platform !== "win32") return Date.now() - uptime() * 1000;
    const { stdout } = await executeFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference='Stop'; $boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime; ([DateTimeOffset]$boot).ToUnixTimeMilliseconds()"],
    { windowsHide: true, timeout: 15000, maxBuffer: 16384 });
    const value = Number(stdout.trim());
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Cannot read Windows boot time for file-lock ownership.");
    return value;
  })().catch(error => { bootTimePromise = null; throw error; });
  return bootTimePromise;
}

export async function withFileLock(lockPath, action, options = {}) {
  const bootTimeMs = await readLockBootTimeMs();
  const resolved = path.resolve(lockPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 60000);
  const staleMs = Math.max(timeoutMs, Number(options.staleMs) || 300000);
  const retryMs = Math.max(10, Number(options.retryMs) || 50);
  const startedAt = performance.now();
  const token = `${process.pid}:${randomUUID()}`;
  const ownerHostname = hostname();
  let handle = null;
  while (!handle) {
    try {
      const candidate = await open(resolved, "wx");
      try {
        await candidate.writeFile(JSON.stringify({
          version: 3,
          token,
          pid: process.pid,
          hostname: ownerHostname,
          bootTimeMs,
          acquiredAt: new Date().toISOString()
        }), "utf8");
        handle = candidate;
      } catch (error) {
        try { await candidate.close(); } catch {}
        try { await unlink(resolved); } catch {}
        throw error;
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await staleLockMayBeRemoved(resolved, staleMs, ownerHostname, options)) {
        try { await unlink(resolved); } catch {}
        continue;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for file lock: ${resolved}`);
      }
      await delay(retryMs);
    }
  }
  const heartbeatMs = Math.max(
    250,
    Math.min(Math.floor(staleMs / 3), Number(options.heartbeatMs) || 30000)
  );
  let heartbeatInFlight = Promise.resolve();
  const heartbeatTimer = setInterval(() => {
    heartbeatInFlight = heartbeatInFlight
      .catch(() => {})
      .then(async () => {
        const now = new Date();
        await handle.utimes(now, now);
      });
  }, heartbeatMs);
  heartbeatTimer.unref?.();
  try {
    return await action();
  } finally {
    clearInterval(heartbeatTimer);
    try { await heartbeatInFlight; } catch {}
    try { await handle.close(); } catch {}
    try {
      const current = JSON.parse(await readFile(resolved, "utf8"));
      if (current?.token === token) await unlink(resolved);
    } catch {}
  }
}

async function staleLockMayBeRemoved(filename, staleMs, localHostname, options) {
  try {
    const details = await stat(filename);
    let owner = null;
    try {
      owner = JSON.parse(await readFile(filename, "utf8"));
    } catch {
      // An unreadable lock is removable only after its filesystem lease expires.
    }
      if (owner?.hostname === localHostname) {
        // Unknown identity is busy, never permission to start a second writer.
        if (processIsAlive(owner.pid) && await ownerBelongsToThisBoot(owner, options) !== false) return false;
        // A locally-owned lock whose process is gone cannot still be holding
        // the protected section. Recover it immediately instead of forcing a
        // replacement long-running training stage to wait for the full lease.
        const confirmation = await stat(filename);
        return confirmation.mtimeMs === details.mtimeMs;
      }
    if (Date.now() - details.mtimeMs <= staleMs) return false;
    const confirmation = await stat(filename);
    return confirmation.mtimeMs === details.mtimeMs
      && Date.now() - confirmation.mtimeMs > staleMs;
  } catch {
    return false;
  }
}

export async function readWindowsProcessStartTimeMs(pid, { execute = executeFile, isAlive = processIsAlive, pause = delay } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const queries = [
    `$started=(Get-Process -Id ${pid}).StartTime`,
    `$started=(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CreationDate`,
    `$started=(Get-Process -Id ${pid}).StartTime`
  ];
  for (let attempt = 0; attempt < queries.length; attempt++) {
    if (!isAlive(pid)) return null;
    try {
      const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `$ErrorActionPreference='Stop'; ${queries[attempt]}; if ($null -eq $started) { throw 'Missing process start time' }; [Console]::Out.Write(([DateTimeOffset]$started).ToUnixTimeMilliseconds().ToString([Globalization.CultureInfo]::InvariantCulture))`],
      { windowsHide: true, timeout: 15000, maxBuffer: 16384 });
      const started = Number(stdout?.trim());
      if (Number.isSafeInteger(started) && started > 0) return started;
    } catch { /* A failed query is not evidence that the owner exited. */ }
    if (!isAlive(pid)) return null;
    if (attempt + 1 < queries.length) await pause(100);
  }
  // undefined = alive but unverifiable; null = confirmed gone/invalid PID.
  return undefined;
}

async function ownerBelongsToThisBoot(owner, options = {}) {
  const bootTimeMs = await readLockBootTimeMs();
  // Version 2 stored a wall-clock-minus-uptime estimate, which also excludes
  // earlier sleep on this PC. Its value cannot be compared with the OS record.
  // Adopt a legacy live owner only if its real process started in this boot
  // and before the lock was acquired. Cache positive checks briefly: at worst
  // this delays stale-lock recovery; it never authorizes a second writer.
  if (process.platform === "win32" && owner.version !== 3) {
    const acquiredAt = Date.parse(owner.acquiredAt);
    if (!Number.isFinite(acquiredAt) || acquiredAt < bootTimeMs - 60000
      || !Number.isInteger(owner.pid) || owner.pid <= 0 || !processIsAlive(owner.pid)) return false;
    const key = JSON.stringify([owner.pid, owner.token, owner.acquiredAt]);
    if (!options.processStartTimeQuery && (legacyOwnerChecks.get(key) || 0) > performance.now()) return true;
    const started = await (options.processStartTimeQuery || readWindowsProcessStartTimeMs)(owner.pid);
    if (started === null || !processIsAlive(owner.pid)) return false;
    if (!Number.isSafeInteger(started) || started <= 0) return null;
    const matches = started >= bootTimeMs - 60000 && started <= acquiredAt + 1000;
    if (matches && !options.processStartTimeQuery) {
      for (const [cachedKey, expiry] of legacyOwnerChecks) if (expiry <= performance.now()) legacyOwnerChecks.delete(cachedKey);
      legacyOwnerChecks.set(key, performance.now() + 10000);
    }
    return matches;
  }
  if (owner.bootTimeMs != null) return Math.abs(owner.bootTimeMs - bootTimeMs) <= 60000;
  const acquiredAt = Date.parse(owner.acquiredAt);
  return !Number.isFinite(acquiredAt) || acquiredAt >= bootTimeMs - 60000;
}

export async function readLiveFileLockOwner(filename, options = {}) {
  try {
    const owner = JSON.parse(await readFile(filename, "utf8"));
    if (owner.hostname !== hostname() || !processIsAlive(owner.pid)) return null;
    const belongs = await ownerBelongsToThisBoot(owner, options);
    if (belongs === false) return null;
    // Keep a live but temporarily unverifiable owner reserved. Pollers retry
    // verification later without terminating training or launching duplicates.
    return belongs === null ? { ...owner, verificationPending: true } : owner;
  } catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
