import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname, uptime } from "node:os";
import path from "node:path";

export async function withFileLock(lockPath, action, options = {}) {
  const resolved = path.resolve(lockPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 60000);
  const staleMs = Math.max(timeoutMs, Number(options.staleMs) || 300000);
  const retryMs = Math.max(10, Number(options.retryMs) || 50);
  const startedAt = Date.now();
  const token = `${process.pid}:${randomUUID()}`;
  const ownerHostname = hostname();
  let handle = null;
  while (!handle) {
    try {
      const candidate = await open(resolved, "wx");
      try {
        await candidate.writeFile(JSON.stringify({
          version: 2,
          token,
          pid: process.pid,
          hostname: ownerHostname,
          bootTimeMs: Date.now() - uptime() * 1000,
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
      if (await staleLockMayBeRemoved(resolved, staleMs, ownerHostname)) {
        try { await unlink(resolved); } catch {}
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
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

async function staleLockMayBeRemoved(filename, staleMs, localHostname) {
  try {
    const details = await stat(filename);
    try {
      const owner = JSON.parse(await readFile(filename, "utf8"));
      if (owner?.hostname === localHostname) {
        if (ownerBelongsToThisBoot(owner) && processIsAlive(owner.pid)) return false;
        // A locally-owned lock whose process is gone cannot still be holding
        // the protected section. Recover it immediately instead of forcing a
        // replacement long-running training stage to wait for the full lease.
        const confirmation = await stat(filename);
        return confirmation.mtimeMs === details.mtimeMs;
      }
    } catch {
      // An unreadable lock is removable only after its filesystem lease expires.
    }
    if (Date.now() - details.mtimeMs <= staleMs) return false;
    const confirmation = await stat(filename);
    return confirmation.mtimeMs === details.mtimeMs
      && Date.now() - confirmation.mtimeMs > staleMs;
  } catch {
    return false;
  }
}

function ownerBelongsToThisBoot(owner) {
  const bootTimeMs = Date.now() - uptime() * 1000;
  if (owner.bootTimeMs != null) return Math.abs(owner.bootTimeMs - bootTimeMs) <= 60000;
  const acquiredAt = Date.parse(owner.acquiredAt);
  return !Number.isFinite(acquiredAt) || acquiredAt >= bootTimeMs - 60000;
}

export async function readLiveFileLockOwner(filename) {
  try {
    const owner = JSON.parse(await readFile(filename, "utf8"));
    return owner.hostname === hostname() && ownerBelongsToThisBoot(owner) && processIsAlive(owner.pid) ? owner : null;
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
