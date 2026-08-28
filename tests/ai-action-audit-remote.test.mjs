import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  createActionAuditOptionsHandoff,
  discardActionAuditOptionsHandoff
} from "../scripts/ai-action-audit-options-handoff.mjs";
import {
  ACTION_AUDIT_SEED_BATCH_CONTRACT,
  readValidatedActionAuditSeedBatchOutput,
  validateActionAuditTask
} from "../scripts/ai-action-audit-task-contract.mjs";
import {
  remoteActionAuditConfiguration,
  remoteActionAuditTaskShare
} from "../scripts/ai-action-audit-remote-pool.mjs";
import {
  ACTION_AUDIT_WORKER_OPTIONS_CONTRACT,
  actionAuditPoolShouldScaleUp,
  actionAuditWorkerOptions,
  partitionRemoteActionAuditTasks,
  validatePreparedActionAuditWorkerOptions
} from "../scripts/detached-action-audit-coordinator.mjs";
import { actionAuditRuntimeFingerprint } from "../scripts/ai-action-audit-runtime-fingerprint.mjs";
import { writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";

const workspaceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("remote action-audit configuration caps Lightsail at two workers", () => {
  const configuration = remoteActionAuditConfiguration({}, {
    RIFTBOUND_ACTION_AUDIT_REMOTE_HOST: "ubuntu@lightsail-test",
    RIFTBOUND_ACTION_AUDIT_REMOTE_PROJECT_ROOT:
      "/home/ubuntu/riftbound-audit/current",
    RIFTBOUND_ACTION_AUDIT_REMOTE_RUNTIME_ROOT:
      "/home/ubuntu/riftbound-audit/runtime",
    RIFTBOUND_ACTION_AUDIT_REMOTE_MAX_WORKERS: "9"
  });
  assert.equal(configuration.initialWorkers, 1);
  assert.equal(configuration.maximumWorkers, 2);
  assert.equal(configuration.minimumFreeMemoryMb, 250);
  assert.equal(configuration.nodeHeapMb, 384);
  assert.throws(() => remoteActionAuditConfiguration({}, {
    RIFTBOUND_ACTION_AUDIT_REMOTE_HOST: "-unsafe-host"
  }), /host or alias is invalid/);
});

test("remote action-audit configuration loads the deploy-time local file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-remote-config-"));
  try {
    const configurationFile = path.join(directory, ".env.action-audit-remote");
    await writeFile(configurationFile, [
      "RIFTBOUND_ACTION_AUDIT_REMOTE_HOST=ubuntu@15.164.73.107",
      "RIFTBOUND_ACTION_AUDIT_REMOTE_PROJECT_ROOT=/home/ubuntu/riftbound-audit/current",
      "RIFTBOUND_ACTION_AUDIT_REMOTE_RUNTIME_ROOT=/home/ubuntu/riftbound-audit/runtime",
      "RIFTBOUND_ACTION_AUDIT_REMOTE_MAX_WORKERS=2"
    ].join("\n"), "utf8");
    const configuration = remoteActionAuditConfiguration({
      remoteActionAuditConfigurationFile: configurationFile
    }, {});
    assert.equal(configuration.host, "ubuntu@15.164.73.107");
    assert.equal(configuration.initialWorkers, 1);
    assert.equal(configuration.maximumWorkers, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("remote action-audit weighted share eventually assigns small batches", () => {
  let credit = 0;
  let remoteTasks = 0;
  for (let index = 0; index < 18; index += 1) {
    const share = remoteActionAuditTaskShare(1, 16, 2, credit);
    credit = share.credit;
    remoteTasks += share.remoteTasks;
  }
  assert.equal(remoteTasks, 2);
  assert.equal(Math.abs(credit) < 1e-9, true);
  assert.deepEqual(remoteActionAuditTaskShare(18, 16, 2, 0), {
    remoteTasks: 2,
    credit: 0
  });
});

test("remote action-audit task assignment is hash-based rather than prefix-based", () => {
  const tasks = Array.from({ length: 8 }, (_, index) => ({
    taskId: `task-${index}`,
    candidateId: `candidate-${index % 3}`,
    bank: index % 2 ? "selection" : "final",
    seeds: [index + 1]
  }));
  const forward = partitionRemoteActionAuditTasks(tasks, 3).remoteTasks
    .map((task) => task.taskId)
    .sort();
  const reverse = partitionRemoteActionAuditTasks([...tasks].reverse(), 3).remoteTasks
    .map((task) => task.taskId)
    .sort();
  assert.deepEqual(reverse, forward);
  assert.notDeepEqual(forward, tasks.slice(0, 3).map((task) => task.taskId));
});

test("remote scale-up waits for a real worker RSS observation", () => {
  const options = {
    currentProcesses: 1,
    maximumProcesses: 2,
    queuedTasks: 8,
    idleProcesses: 0,
    freeMemoryBytes: 2 * 1024 ** 3,
    minimumFreeMemoryBytes: 512 * 1024 ** 2,
    workerHeadroomBytes: 1024 ** 3
  };
  assert.equal(actionAuditPoolShouldScaleUp({
    ...options,
    workerRssObserved: false
  }), false);
  assert.equal(actionAuditPoolShouldScaleUp({
    ...options,
    workerRssObserved: true
  }), true);
});

test("remote action-audit result validation binds provenance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-remote-contract-"));
  try {
    const outputPath = path.join(directory, "result.json.gz");
    const task = {
      taskId: "remote-task",
      candidateId: "remote-candidate",
      candidatePath: path.join(directory, "candidate.json.gz"),
      outputPath,
      bank: "selection",
      seeds: [11, 22],
      maximumSteps: 100,
      datasetKey: "dataset-a",
      informationSetHash: "information-a",
      engineFingerprint: "sha256:engine-a"
    };
    await writeTrajectoryArchive(outputPath, {
      contract: ACTION_AUDIT_SEED_BATCH_CONTRACT,
      taskId: task.taskId,
      candidateId: task.candidateId,
      bank: task.bank,
      seeds: task.seeds,
      datasetKey: task.datasetKey,
      informationSetHash: task.informationSetHash,
      engineFingerprint: task.engineFingerprint
    });
    assert.equal(
      (await readValidatedActionAuditSeedBatchOutput(task, outputPath)).datasetKey,
      task.datasetKey
    );
    await assert.rejects(
      readValidatedActionAuditSeedBatchOutput({
        ...task,
        informationSetHash: "information-b"
      }, outputPath),
      /does not match task/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("protocol seed batches bind each shard to its exact frozen policy pair and seeds", async () => {
  const directory = await mkdtemp(path.join(
    os.tmpdir(),
    "riftbound-remote-protocol-contract-"
  ));
  try {
    const outputPath = path.join(directory, "result.json.gz");
    const task = {
      taskId: "protocol-task",
      candidateId: "protocol-candidate",
      candidatePath: path.join(directory, "candidate.json.gz"),
      outputPath,
      bank: "final-v2",
      seeds: [11, 22],
      maximumSteps: 100,
      evidenceProtocolHash: "sha256:protocol",
      protocolPairIds: ["continuation::opponent"]
    };
    const actionResult = (kind) => ({
      action: { kind },
      simulationSeeds: task.seeds,
      samples: task.seeds.map((simulationSeed) => ({ simulationSeed }))
    });
    await writeTrajectoryArchive(outputPath, {
      contract: ACTION_AUDIT_SEED_BATCH_CONTRACT,
      taskId: task.taskId,
      candidateId: task.candidateId,
      bank: task.bank,
      seeds: task.seeds,
      evidenceProtocolHash: task.evidenceProtocolHash,
      protocolResults: [{
        continuationId: "continuation",
        opponentId: "opponent",
        results: [actionResult("pass"), actionResult("endTurn")]
      }]
    });
    assert.equal(
      (await readValidatedActionAuditSeedBatchOutput(task, outputPath))
        .protocolResults.length,
      1
    );
    await assert.rejects(
      readValidatedActionAuditSeedBatchOutput({
        ...task,
        protocolPairIds: [
          "continuation::opponent",
          "continuation::missing"
        ]
      }, outputPath),
      /does not match task/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("remote action-audit tasks reject wrapped seeds and invalid step counts", () => {
  const task = {
    taskId: "strict-task",
    candidateId: "strict-candidate",
    candidatePath: "candidate.json.gz",
    outputPath: "result.json.gz",
    bank: "selection",
    seeds: [1],
    maximumSteps: 8
  };
  assert.equal(validateActionAuditTask(task).seeds[0], 1);
  assert.throws(
    () => validateActionAuditTask({ ...task, seeds: [-1] }),
    /invalid uint32 seed/
  );
  assert.throws(
    () => validateActionAuditTask({ ...task, maximumSteps: 0 }),
    /invalid maximum step count/
  );
});

test("remote action-audit host completes a versioned local handshake", async () => {
  const optionsHandoff = await createActionAuditOptionsHandoff(actionAuditWorkerOptions({
    teacherEvaluatorMode: "heuristic-only",
    engineFingerprint: "sha256:remote-host-test"
  }));
  const runtimeFingerprint = await actionAuditRuntimeFingerprint(workspaceRoot);
  const child = spawn(process.execPath, [
    "--max-old-space-size=384",
    path.join(workspaceRoot, "scripts", "ai-action-audit-remote-host.mjs"),
    "--options-archive",
    optionsHandoff.optionsArchivePath,
    "--runtime-fingerprint",
    runtimeFingerprint,
    "--project-root",
    workspaceRoot,
    "--initial-workers",
    "1",
    "--max-workers",
    "2",
    "--minimum-free-memory-mb",
    "250",
    "--worker-headroom-mb",
    "256",
    "--candidate-cache-size",
    "1"
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const messages = [];
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(stderr || "handshake timeout")), 60_000);
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.type === "ready") {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
  try {
    const message = await ready;
    assert.equal(message.runtimeFingerprint, runtimeFingerprint);
    assert.equal(message.initialWorkers, 1);
    assert.equal(message.maximumWorkers, 2);
    child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(stderr || "remote host close timeout"));
      }, 20_000);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    assert.equal(exit.code, 0);
    assert.equal(messages.some((item) => item.type === "closed"), true);
  } finally {
    child.kill();
    lines.close();
    await discardActionAuditOptionsHandoff(optionsHandoff);
  }
});

test("remote host accepts one serialized certified neural evaluator without reserializing it", async () => {
  const checkpoint = JSON.parse(await readFile(
    path.join(workspaceRoot, "src", "ai", "checkpoints", "neural-champion.json"),
    "utf8"
  ));
  const prepared = validatePreparedActionAuditWorkerOptions({
    contract: ACTION_AUDIT_WORKER_OPTIONS_CONTRACT,
    model: checkpoint,
    league: [],
    teacherEvaluatorModels: [checkpoint],
    teacherEvaluatorMode: "certified-neural-ensemble",
    engineFingerprint: "sha256:remote-neural-host-test"
  });
  assert.throws(() => validatePreparedActionAuditWorkerOptions({
    ...prepared,
    model: { ...checkpoint, layers: {} }
  }), /serialized checkpoints/);
  const optionsHandoff = await createActionAuditOptionsHandoff(prepared);
  const runtimeFingerprint = await actionAuditRuntimeFingerprint(workspaceRoot);
  const child = spawn(process.execPath, [
    "--max-old-space-size=384",
    path.join(workspaceRoot, "scripts", "ai-action-audit-remote-host.mjs"),
    "--options-archive",
    optionsHandoff.optionsArchivePath,
    "--runtime-fingerprint",
    runtimeFingerprint,
    "--project-root",
    workspaceRoot,
    "--initial-workers",
    "1",
    "--max-workers",
    "1",
    "--minimum-free-memory-mb",
    "250",
    "--worker-headroom-mb",
    "256",
    "--candidate-cache-size",
    "1"
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(stderr || "neural handshake timeout")),
        90_000
      );
      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.type !== "ready") return;
        clearTimeout(timer);
        resolve(message);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(stderr || `neural host exited ${code}`));
      });
    });
    assert.equal(ready.engineFingerprint, prepared.engineFingerprint);
    child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
    const exitCode = await new Promise((resolve) => child.once(
      "exit",
      (code) => resolve(code)
    ));
    assert.equal(exitCode, 0);
  } finally {
    child.kill();
    lines.close();
    await discardActionAuditOptionsHandoff(optionsHandoff);
  }
});

test("remote host removes stale sessions and its own session on shutdown", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-remote-sessions-"));
  const staleSession = path.join(directory, "session-stale");
  const currentSession = path.join(directory, "session-current");
  await mkdir(staleSession, { recursive: true });
  await mkdir(currentSession, { recursive: true });
  const oldTime = new Date(Date.now() - 3 * 60 * 60 * 1_000);
  await utimes(staleSession, oldTime, oldTime);
  const optionsHandoff = await createActionAuditOptionsHandoff(actionAuditWorkerOptions({
    teacherEvaluatorMode: "heuristic-only",
    engineFingerprint: "sha256:remote-session-test"
  }));
  const runtimeFingerprint = await actionAuditRuntimeFingerprint(workspaceRoot);
  const child = spawn(process.execPath, [
    path.join(workspaceRoot, "scripts", "ai-action-audit-remote-host.mjs"),
    "--options-archive",
    optionsHandoff.optionsArchivePath,
    "--runtime-fingerprint",
    runtimeFingerprint,
    "--project-root",
    workspaceRoot,
    "--session-root",
    currentSession,
    "--runtime-root",
    directory,
    "--session-ttl-hours",
    "1",
    "--initial-workers",
    "1",
    "--max-workers",
    "1"
  ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(stderr || "session timeout")), 60_000);
      lines.on("line", (line) => {
        if (JSON.parse(line).type !== "ready") return;
        clearTimeout(timer);
        resolve();
      });
    });
    await assert.rejects(stat(staleSession), { code: "ENOENT" });
    child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
    await new Promise((resolve) => child.once("exit", resolve));
    await assert.rejects(stat(currentSession), { code: "ENOENT" });
  } finally {
    child.kill();
    lines.close();
    await discardActionAuditOptionsHandoff(optionsHandoff);
    await rm(directory, { recursive: true, force: true });
  }
});
