import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import {
  readValidatedActionAuditSeedBatchOutput,
  REMOTE_ACTION_AUDIT_PROTOCOL_VERSION,
  serializableActionAuditTask
} from "./ai-action-audit-task-contract.mjs";
import { actionAuditRuntimeFingerprint } from "./ai-action-audit-runtime-fingerprint.mjs";
import { renameWithRetry } from "./file-replace.mjs";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

export function remoteActionAuditConfiguration(options = {}, environment = process.env) {
  const shouldReadConfigurationFile = Boolean(
    options.remoteActionAuditConfigurationFile
  ) || environment === process.env;
  const configuredEnvironment = shouldReadConfigurationFile
    ? {
      ...readRemoteActionAuditEnvironment(
        options.remoteActionAuditConfigurationFile
          || environment.RIFTBOUND_ACTION_AUDIT_REMOTE_CONFIG
          || path.resolve(".env.action-audit-remote")
      ),
      ...environment
    }
    : environment;
  const host = String(
    options.remoteActionAuditHost
      || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_HOST
      || ""
  ).trim();
  if (!host) return null;
  const projectRoot = String(
    options.remoteActionAuditProjectRoot
      || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_PROJECT_ROOT
      || "/home/ubuntu/riftbound-audit/current"
  ).trim();
  const runtimeRoot = String(
    options.remoteActionAuditRuntimeRoot
      || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_RUNTIME_ROOT
      || "/home/ubuntu/riftbound-audit/runtime"
  ).trim();
  validateSshHost(host);
  validateRemotePath(projectRoot, "project root");
  validateRemotePath(runtimeRoot, "runtime root");
  return {
    host,
    projectRoot,
    runtimeRoot,
    identityFile: optionalAbsolutePath(
      options.remoteActionAuditIdentityFile
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_IDENTITY_FILE
    ),
    port: boundedInteger(
      options.remoteActionAuditPort
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_PORT,
      1,
      65_535,
      22
    ),
    initialWorkers: 1,
    maximumWorkers: boundedInteger(
      options.remoteActionAuditMaximumWorkers
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_MAX_WORKERS,
      1,
      2,
      2
    ),
    minimumFreeMemoryMb: boundedInteger(
      options.remoteActionAuditMinimumFreeMemoryMb
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_MINIMUM_FREE_MEMORY_MB,
      128,
      768,
      250
    ),
    workerHeadroomMb: boundedInteger(
      options.remoteActionAuditWorkerHeadroomMb
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_WORKER_HEADROOM_MB,
      128,
      768,
      256
    ),
    maximumCandidateCacheBytes: boundedInteger(
      options.remoteActionAuditCandidateCacheMb
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_CANDIDATE_CACHE_MB,
      256,
      8 * 1024,
      2 * 1024
    ) * MEBIBYTE,
    nodeHeapMb: boundedInteger(
      options.remoteActionAuditNodeHeapMb
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_NODE_HEAP_MB,
      256,
      512,
      384
    ),
    connectTimeoutSeconds: boundedInteger(
      options.remoteActionAuditConnectTimeoutSeconds
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_CONNECT_TIMEOUT_SECONDS,
      5,
      60,
      15
    ),
    transferTimeoutMs: boundedInteger(
      options.remoteActionAuditTransferTimeoutSeconds
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_TRANSFER_TIMEOUT_SECONDS,
      30,
      3_600,
      600
    ) * 1_000,
    requestTimeoutMs: boundedInteger(
      options.remoteActionAuditRequestTimeoutMinutes
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_REQUEST_TIMEOUT_MINUTES,
      10,
      1_440,
      360
    ) * 60_000,
    sessionTtlHours: boundedInteger(
      options.remoteActionAuditSessionTtlHours
        || configuredEnvironment.RIFTBOUND_ACTION_AUDIT_REMOTE_SESSION_TTL_HOURS,
      1,
      168,
      24
    )
  };
}

export async function createRemoteActionAuditPool(options = {}) {
  const configuration = options.configuration
    || remoteActionAuditConfiguration(options);
  if (!configuration) return null;
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const runtimeFingerprint = await actionAuditRuntimeFingerprint(projectRoot);
  const sessionId = `session-${process.pid}-${randomUUID()}`;
  const sessionRoot = `${configuration.runtimeRoot}/${sessionId}`;
  const candidatesRoot = `${sessionRoot}/candidates`;
  const resultsRoot = `${sessionRoot}/results`;
  const optionsRoot = `${sessionRoot}/options`;
  try {
    await runSsh(configuration, [
      "mkdir",
      "-p",
      candidatesRoot,
      resultsRoot,
      optionsRoot
    ]);
  } catch (error) {
    await cleanupRemoteSession(configuration, sessionRoot);
    throw error;
  }
  let remoteOptionsArchive;
  try {
    const localOptionsArchive = requiredLocalFile(
      options.optionsHandoff?.optionsArchivePath,
      "action-audit options archive"
    );
    const optionsDigest = await fileDigest(localOptionsArchive);
    remoteOptionsArchive = `${optionsRoot}/${optionsDigest}.json.gz`;
    await copyToRemote(configuration, localOptionsArchive, remoteOptionsArchive);
  } catch (error) {
    await cleanupRemoteSession(configuration, sessionRoot);
    throw error;
  }
  const remoteHostScript = `${configuration.projectRoot}/scripts/ai-action-audit-remote-host.mjs`;
  const child = spawn("ssh", [
    ...sshConnectionArguments(configuration),
    configuration.host,
    "node",
    `--max-old-space-size=${configuration.nodeHeapMb}`,
    remoteHostScript,
    "--options-archive",
    remoteOptionsArchive,
    "--runtime-fingerprint",
    runtimeFingerprint,
    "--project-root",
    configuration.projectRoot,
    "--session-root",
    sessionRoot,
    "--runtime-root",
    configuration.runtimeRoot,
    "--session-ttl-hours",
    String(configuration.sessionTtlHours),
    "--initial-workers",
    String(configuration.initialWorkers),
    "--max-workers",
    String(configuration.maximumWorkers),
    "--minimum-free-memory-mb",
    String(configuration.minimumFreeMemoryMb),
    "--worker-headroom-mb",
    String(configuration.workerHeadroomMb),
    "--candidate-cache-size",
    "1"
  ], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pendingRequests = new Map();
  const candidateCache = new Map();
  let candidateCacheBytes = 0;
  let closed = false;
  let ready = false;
  let processCount = configuration.initialWorkers;
  let desiredProcessCount = configuration.initialWorkers;
  let stderrTail = "";
  const readyPromise = deferred();
  const exitPromise = deferred();
  const output = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
  });
  output.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      failAll(new Error("Remote action-audit host emitted invalid protocol data."));
      return;
    }
    if (message.type === "ready") {
      if (message.protocolVersion !== REMOTE_ACTION_AUDIT_PROTOCOL_VERSION
        || message.runtimeFingerprint !== runtimeFingerprint
        || message.engineFingerprint
          !== (options.engineFingerprint || null)) {
        readyPromise.reject(new Error(
          "Remote action-audit host failed its runtime or engine handshake."
        ));
        return;
      }
      ready = true;
      processCount = Number(message.processCount) || configuration.initialWorkers;
      desiredProcessCount = processCount;
      readyPromise.resolve(message);
      return;
    }
    if (message.type === "progress") {
      processCount = Number(message.progress?.processCount) || processCount;
      desiredProcessCount = Number(message.progress?.desiredProcessCount)
        || desiredProcessCount;
      options.onProgress?.({
        ...message.progress,
        remote: true,
        remoteHost: configuration.host
      });
      return;
    }
    if (message.type === "complete" || message.type === "error") {
      const request = pendingRequests.get(message.requestId);
      if (!request) return;
      pendingRequests.delete(message.requestId);
      if (message.type === "complete") {
        processCount = Number(message.processCount) || processCount;
        desiredProcessCount = Number(message.desiredProcessCount)
          || desiredProcessCount;
        request.resolve(message.outputs || []);
      } else {
        request.reject(remoteError(message.error, stderrTail));
      }
      return;
    }
    if (message.type === "protocol-error") {
      const error = remoteError(message.error, stderrTail);
      const request = message.requestId
        ? pendingRequests.get(message.requestId)
        : null;
      if (request) {
        pendingRequests.delete(message.requestId);
        request.reject(error);
      } else {
        failAll(error);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-32_768);
  });
  child.once("error", (error) => {
    readyPromise.reject(error);
    failAll(error);
    exitPromise.resolve({ error });
  });
  child.once("exit", (code, signal) => {
    const error = closed
      ? null
      : new Error(
        `Remote action-audit SSH process exited unexpectedly (${code}, ${signal || "none"}).\n${stderrTail}`
      );
    if (!ready) {
      readyPromise.reject(error || new Error(
        "Remote action-audit SSH process exited before its handshake."
      ));
    }
    if (error) failAll(error);
    exitPromise.resolve({ code, signal, error });
  });
  await promiseWithTimeout(
    readyPromise.promise,
    60_000,
    "Remote action-audit host did not become ready within 60 seconds."
  ).catch(async (error) => {
    child.kill();
    await cleanupRemoteSession(configuration, sessionRoot);
    throw error;
  });

  return {
    get processCount() {
      return processCount;
    },
    get desiredProcessCount() {
      return desiredProcessCount;
    },
    get maximumProcessCount() {
      return configuration.maximumWorkers;
    },
    get host() {
      return configuration.host;
    },
    async run(tasks = [], progress = {}) {
      if (closed) throw new Error("Remote action-audit pool is closed.");
      if (tasks.length === 0) return [];
      const cached = [];
      const pending = [];
      for (const task of tasks) {
        if (existsSync(task.outputPath)) {
          try {
            await readValidatedActionAuditSeedBatchOutput(task, task.outputPath);
            cached.push({ task, outputPath: task.outputPath });
            continue;
          } catch {
            await rm(task.outputPath, { force: true }).catch(() => {});
          }
        }
        pending.push(task);
      }
      if (pending.length === 0) return cached;
      const staged = [];
      try {
        for (const task of pending) {
          staged.push({
            task,
            candidate: await retainRemoteCandidate(task.candidatePath)
          });
        }
        const requestId = randomUUID();
        const remoteTasks = staged.map(({ task, candidate }) => ({
          ...serializableActionAuditTask(task),
          candidatePath: candidate.remotePath,
          outputPath: `${resultsRoot}/${safeComponent(task.taskId)}.json.gz`
        }));
        const request = deferred();
        pendingRequests.set(requestId, request);
        writeMessage({
          type: "run",
          requestId,
          stage: progress.stage || "remote-seed-batch",
          tasks: remoteTasks
        });
        const remoteOutputs = await promiseWithTimeout(
          request.promise,
          configuration.requestTimeoutMs,
          `Remote action-audit request ${requestId} exceeded its time limit.`
        ).catch((error) => {
          pendingRequests.delete(requestId);
          throw error;
        });
        const outputByTaskId = new Map(remoteOutputs.map((item) => [
          item.taskId,
          item.outputPath
        ]));
        const downloaded = [];
        for (const task of pending) {
          const remoteOutputPath = outputByTaskId.get(task.taskId);
          if (!remoteOutputPath) {
            throw new Error(
              `Remote action-audit result omitted task ${task.taskId}.`
            );
          }
          const temporaryPath = `${task.outputPath}.remote-${randomUUID()}.tmp`;
          await mkdir(path.dirname(task.outputPath), { recursive: true });
          try {
            await copyFromRemote(
              configuration,
              remoteOutputPath,
              temporaryPath
            );
            await readValidatedActionAuditSeedBatchOutput(task, temporaryPath);
            await renameWithRetry(temporaryPath, task.outputPath);
          } finally {
            await rm(temporaryPath, { force: true }).catch(() => {});
            await runSsh(configuration, ["rm", "-f", remoteOutputPath])
              .catch(() => {});
          }
          downloaded.push({ task, outputPath: task.outputPath });
        }
        return [...cached, ...downloaded];
      } finally {
        for (const item of staged) releaseRemoteCandidate(item.candidate);
        await evictRemoteCandidateCache();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (child.stdin.writable) writeMessage({ type: "shutdown" });
      await promiseWithTimeout(exitPromise.promise, 15_000, "remote close")
        .catch(() => child.kill());
      output.close();
      failAll(new Error("Remote action-audit pool closed."));
      await cleanupRemoteSession(configuration, sessionRoot);
    }
  };

  function writeMessage(message) {
    if (!child.stdin.writable) {
      throw new Error("Remote action-audit SSH input is unavailable.");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function failAll(error) {
    for (const request of pendingRequests.values()) request.reject(error);
    pendingRequests.clear();
  }

  async function retainRemoteCandidate(candidatePath) {
    const localPath = requiredLocalFile(candidatePath, "candidate archive");
    let entry = candidateCache.get(localPath);
    if (!entry) {
      entry = {
        localPath,
        remotePath: null,
        size: 0,
        references: 0,
        lastUsedAt: Date.now(),
        staged: null,
        failed: false
      };
      candidateCache.set(localPath, entry);
      entry.staged = (async () => {
        const details = await stat(localPath);
        const digest = await fileDigest(localPath);
        entry.remotePath = `${candidatesRoot}/${digest}.json.gz`;
        entry.size = details.size;
        candidateCacheBytes += entry.size;
        await copyToRemote(configuration, localPath, entry.remotePath);
      })();
    }
    entry.references += 1;
    entry.lastUsedAt = Date.now();
    try {
      await entry.staged;
      return entry;
    } catch (error) {
      entry.references -= 1;
      if (!entry.failed) {
        entry.failed = true;
        if (candidateCache.get(localPath) === entry) {
          candidateCache.delete(localPath);
          candidateCacheBytes -= entry.size;
        }
      }
      throw error;
    }
  }

  function releaseRemoteCandidate(entry) {
    entry.references = Math.max(0, entry.references - 1);
    entry.lastUsedAt = Date.now();
  }

  async function evictRemoteCandidateCache() {
    if (candidateCacheBytes <= configuration.maximumCandidateCacheBytes) return;
    const candidates = [...candidateCache.values()]
      .filter((entry) => entry.references === 0)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    for (const entry of candidates) {
      if (candidateCacheBytes <= configuration.maximumCandidateCacheBytes) break;
      candidateCache.delete(entry.localPath);
      candidateCacheBytes -= entry.size;
      await runSsh(configuration, ["rm", "-f", entry.remotePath])
        .catch(() => {});
    }
  }
}

export function remoteActionAuditTaskShare(
  taskCount,
  localProcesses,
  remoteProcesses,
  credit = 0
) {
  const count = Math.max(0, Math.floor(Number(taskCount) || 0));
  const local = Math.max(1, Math.floor(Number(localProcesses) || 1));
  const remote = Math.max(0, Math.floor(Number(remoteProcesses) || 0));
  if (count === 0 || remote === 0) return { remoteTasks: 0, credit: 0 };
  const nextCredit = Math.min(
    remote * 4,
    Math.max(0, Number(credit) || 0) + count * remote / (local + remote)
  );
  const remoteTasks = Math.min(count, Math.floor(nextCredit));
  return { remoteTasks, credit: nextCredit - remoteTasks };
}

async function fileDigest(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

function sshConnectionArguments(configuration) {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${configuration.connectTimeoutSeconds}`,
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-p",
    String(configuration.port)
  ];
  if (configuration.identityFile) args.push("-i", configuration.identityFile);
  return args;
}

function scpConnectionArguments(configuration) {
  const args = [
    "-q",
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${configuration.connectTimeoutSeconds}`,
    "-P",
    String(configuration.port)
  ];
  if (configuration.identityFile) args.push("-i", configuration.identityFile);
  return args;
}

function runSsh(configuration, remoteArguments) {
  return runProcess("ssh", [
    ...sshConnectionArguments(configuration),
    configuration.host,
    ...remoteArguments
  ], {
    timeoutMs: Math.min(configuration.transferTimeoutMs, 60_000)
  });
}

function copyToRemote(configuration, source, destination) {
  return runProcess("scp", [
    ...scpConnectionArguments(configuration),
    source,
    `${configuration.host}:${destination}`
  ], { timeoutMs: configuration.transferTimeoutMs });
}

function copyFromRemote(configuration, source, destination) {
  return runProcess("scp", [
    ...scpConnectionArguments(configuration),
    `${configuration.host}:${source}`,
    destination
  ], { timeoutMs: configuration.transferTimeoutMs });
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 0, ...spawnOptions } = options;
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        const error = new Error(
          `${command} exceeded its ${Math.ceil(timeoutMs / 1_000)} second time limit.`
        );
        error.code = "REMOTE_ACTION_AUDIT_PROCESS_TIMEOUT";
        child.kill();
        finish(reject, error);
      }, timeoutMs)
      : null;
    timer?.unref?.();
    child.stdout?.on("data", (chunk) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-65_536);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-65_536);
    });
    child.once("error", (error) => finish(reject, error));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish(resolve, { stdout, stderr });
      } else {
        finish(reject, new Error(
          `${command} failed (${code}, ${signal || "none"}): ${stderr || stdout}`
        ));
      }
    });
  });
}

async function cleanupRemoteSession(configuration, sessionRoot) {
  await runSsh(configuration, ["rm", "-rf", sessionRoot]).catch(() => {});
}

function validateSshHost(value) {
  if (!/^[A-Za-z0-9_.@-]+$/.test(value) || value.startsWith("-")) {
    throw new Error("Remote action-audit SSH host or alias is invalid.");
  }
}

function validateRemotePath(value, label) {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value) || value.includes("..")) {
    throw new Error(`Remote action-audit ${label} must be an absolute safe path.`);
  }
}

function requiredLocalFile(value, label) {
  const resolved = value ? path.resolve(value) : "";
  if (!resolved || !existsSync(resolved)) {
    throw new Error(`Remote action-audit ${label} is unavailable: ${resolved}`);
  }
  return resolved;
}

function optionalAbsolutePath(value) {
  if (!value) return null;
  const resolved = path.resolve(String(value));
  if (!existsSync(resolved)) {
    throw new Error(`Remote action-audit SSH identity file is missing: ${resolved}`);
  }
  return resolved;
}

function safeComponent(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function promiseWithTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function remoteError(error, stderrTail) {
  const output = new Error(
    `${error?.message || "Remote action-audit request failed."}`
    + (stderrTail ? `\n${stderrTail}` : "")
  );
  output.code = error?.code || null;
  if (error?.stack) output.remoteStack = error.stack;
  return output;
}

function readRemoteActionAuditEnvironment(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  const output = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;
    output[match[1]] = unquoteConfigurationValue(match[2].trim());
  }
  return output;
}

function unquoteConfigurationValue(value) {
  if (value.length < 2) return value;
  const quote = value[0];
  return (quote === "\"" || quote === "'") && value.at(-1) === quote
    ? value.slice(1, -1)
    : value;
}
