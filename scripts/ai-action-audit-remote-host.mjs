import readline from "node:readline";
import process from "node:process";
import { readFileSync } from "node:fs";
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import path from "node:path";
import { createAuditPool } from "./detached-action-audit-coordinator.mjs";
import { readActionAuditOptionsHandoff } from "./ai-action-audit-options-handoff.mjs";
import {
  REMOTE_ACTION_AUDIT_PROTOCOL_VERSION,
  validateActionAuditTask
} from "./ai-action-audit-task-contract.mjs";
import { actionAuditRuntimeFingerprint } from "./ai-action-audit-runtime-fingerprint.mjs";

const args = parseArguments(process.argv.slice(2));
const optionsArchivePath = requiredArgument(args, "options-archive");
const expectedRuntimeFingerprint = requiredArgument(
  args,
  "runtime-fingerprint"
);
const projectRoot = requiredArgument(args, "project-root");
const sessionRoot = optionalArgument(args, "session-root");
const runtimeRoot = optionalArgument(args, "runtime-root");
const sessionTtlHours = boundedInteger(args["session-ttl-hours"], 1, 168, 24);
const initialWorkers = boundedInteger(args["initial-workers"], 1, 2, 1);
const maximumWorkers = boundedInteger(args["max-workers"], 1, 2, 2);
const minimumFreeMemoryBytes = boundedInteger(
  args["minimum-free-memory-mb"],
  128,
  768,
  250
) * 1024 * 1024;
const workerHeadroomBytes = boundedInteger(
  args["worker-headroom-mb"],
  128,
  768,
  256
) * 1024 * 1024;
process.env.RIFTBOUND_ACTION_AUDIT_CANDIDATE_CACHE_SIZE = String(
  boundedInteger(args["candidate-cache-size"], 1, 2, 1)
);

if (sessionRoot || runtimeRoot) {
  validateSessionOwnership(sessionRoot, runtimeRoot);
  await cleanupExpiredRemoteActionAuditSessions({
    runtimeRoot,
    currentSessionRoot: sessionRoot,
    ttlMs: sessionTtlHours * 60 * 60 * 1_000
  });
}
const leasePath = sessionRoot ? path.join(sessionRoot, ".lease") : null;
if (leasePath) await refreshSessionLease(leasePath);
const leaseTimer = leasePath
  ? setInterval(() => void refreshSessionLease(leasePath), 60_000)
  : null;
leaseTimer?.unref?.();

const actualRuntimeFingerprint = await actionAuditRuntimeFingerprint(projectRoot);
if (actualRuntimeFingerprint !== expectedRuntimeFingerprint) {
  throw new Error(
    "Remote action-audit runtime fingerprint does not match the local runtime."
  );
}
const commonOptions = await readActionAuditOptionsHandoff({
  optionsArchivePath
});
const pool = await createAuditPool({
  preparedActionAuditWorkerOptions: commonOptions,
  processes: maximumWorkers,
  initialProcesses: Math.min(initialWorkers, maximumWorkers),
  minimumFreeMemoryBytes,
  freeMemoryProvider: remotePhysicalAvailableMemoryBytes,
  requireObservedWorkerRssForScaleUp: true,
  dynamicWorkerHeadroomBytes: workerHeadroomBytes,
  dynamicScaleHealthySamples: 2,
  dynamicScaleIntervalMs: 10_000,
  onProgress(progress) {
    const memory = remoteMemoryStatus();
    writeProtocolMessage({
      type: "progress",
      progress: {
        ...progress,
        remotePhysicalAvailableMemoryBytes: memory.physicalAvailableBytes,
        remoteSwapFreeBytes: memory.swapFreeBytes
      }
    });
  }
});
let closing = false;
const activeRequests = new Set();
const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

writeProtocolMessage({
  type: "ready",
  protocolVersion: REMOTE_ACTION_AUDIT_PROTOCOL_VERSION,
  runtimeFingerprint: actualRuntimeFingerprint,
  engineFingerprint: commonOptions.engineFingerprint || null,
  initialWorkers,
  maximumWorkers,
  processCount: pool.processCount
});

input.on("line", (line) => {
  if (!line.trim()) return;
  void handleMessage(line);
});
input.on("close", () => void closeHost("stdin-closed"));
process.once("SIGINT", () => void closeHost("sigint"));
process.once("SIGTERM", () => void closeHost("sigterm"));

async function handleMessage(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    writeProtocolMessage({
      type: "protocol-error",
      error: { message: "Remote action-audit host received invalid JSON." }
    });
    return;
  }
  if (message?.type === "shutdown") {
    await closeHost("requested");
    return;
  }
  if (message?.type !== "run" || !message.requestId) {
    writeProtocolMessage({
      type: "protocol-error",
      requestId: message?.requestId || null,
      error: { message: "Remote action-audit host received an unknown message." }
    });
    return;
  }
  if (closing) {
    writeProtocolMessage({
      type: "error",
      requestId: message.requestId,
      error: { message: "Remote action-audit host is closing." }
    });
    return;
  }
  const operation = runRequest(message);
  activeRequests.add(operation);
  try {
    await operation;
  } finally {
    activeRequests.delete(operation);
  }
}

async function runRequest(message) {
  try {
    const tasks = (message.tasks || []).map(validateActionAuditTask);
    const outputs = await pool.run(tasks, {
      stage: message.stage || "remote-seed-batch",
      pairedSeeds: tasks.reduce((sum, task) => sum + task.seeds.length, 0)
    });
    writeProtocolMessage({
      type: "complete",
      requestId: message.requestId,
      outputs: outputs.map(({ task, outputPath }) => ({
        taskId: task.taskId,
        outputPath
      })),
      processCount: pool.processCount,
      desiredProcessCount: pool.desiredProcessCount
    });
  } catch (error) {
    writeProtocolMessage({
      type: "error",
      requestId: message.requestId,
      error: serializeError(error)
    });
  }
}

async function closeHost(reason) {
  if (closing) return;
  closing = true;
  if (leaseTimer) clearInterval(leaseTimer);
  input.close();
  await Promise.allSettled([...activeRequests]);
  await pool.close().catch(() => {});
  if (sessionRoot) await rm(sessionRoot, { recursive: true, force: true })
    .catch(() => {});
  await new Promise((resolve) => {
    process.stdout.write(
      `${JSON.stringify({ type: "closed", reason })}\n`,
      resolve
    );
  });
  process.exit(0);
}

function writeProtocolMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function serializeError(error) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || null,
    code: error?.code || null
  };
}

function parseArguments(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) continue;
    output[values[index].slice(2)] = values[index + 1];
    index += 1;
  }
  return output;
}

function requiredArgument(values, key) {
  const value = String(values[key] || "").trim();
  if (!value) throw new Error(`Missing required --${key} argument.`);
  return value;
}

function optionalArgument(values, key) {
  const value = String(values[key] || "").trim();
  return value || null;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function remotePhysicalAvailableMemoryBytes() {
  return remoteMemoryStatus().physicalAvailableBytes;
}

function remoteMemoryStatus() {
  try {
    const values = Object.fromEntries(
      readFileSync("/proc/meminfo", "utf8")
        .split(/\r?\n/u)
        .map((line) => line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/u))
        .filter(Boolean)
        .map((match) => [match[1], Number(match[2]) * 1024])
    );
    const physicalAvailable = Number(values.MemAvailable) || freemem();
    return {
      physicalAvailableBytes: physicalAvailable,
      swapFreeBytes: Number(values.SwapFree) || 0
    };
  } catch {
    return {
      physicalAvailableBytes: freemem(),
      swapFreeBytes: 0
    };
  }
}

function validateSessionOwnership(currentSessionRoot, currentRuntimeRoot) {
  if (!currentSessionRoot || !currentRuntimeRoot) {
    throw new Error(
      "Remote action-audit session-root and runtime-root must be provided together."
    );
  }
  const resolvedSession = path.resolve(currentSessionRoot);
  const resolvedRuntime = path.resolve(currentRuntimeRoot);
  if (path.dirname(resolvedSession) !== resolvedRuntime
    || !path.basename(resolvedSession).startsWith("session-")) {
    throw new Error(
      "Remote action-audit session must be a direct session-* child of runtime-root."
    );
  }
}

export async function cleanupExpiredRemoteActionAuditSessions({
  runtimeRoot: currentRuntimeRoot,
  currentSessionRoot,
  ttlMs,
  now = Date.now()
}) {
  const resolvedRuntime = path.resolve(currentRuntimeRoot);
  const resolvedCurrent = path.resolve(currentSessionRoot);
  let entries;
  try {
    entries = await readdir(resolvedRuntime, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("session-")) continue;
    const candidate = path.join(resolvedRuntime, entry.name);
    if (candidate === resolvedCurrent) continue;
    const lease = path.join(candidate, ".lease");
    let details;
    try {
      details = await stat(lease);
    } catch (error) {
      if (error?.code !== "ENOENT") continue;
      try {
        details = await stat(candidate);
      } catch {
        continue;
      }
    }
    if (now - details.mtimeMs < ttlMs) continue;
    await rm(candidate, { recursive: true, force: true });
    removed.push(candidate);
  }
  return removed;
}

async function refreshSessionLease(filePath) {
  await writeFile(filePath, `${new Date().toISOString()}\n`, "utf8")
    .catch(() => {});
}
