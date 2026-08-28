import {
  createActionAuditOptionsHandoff,
  discardActionAuditOptionsHandoff
} from "./ai-action-audit-options-handoff.mjs";
import {
  createRemoteActionAuditPool,
  remoteActionAuditConfiguration
} from "./ai-action-audit-remote-pool.mjs";
import {
  ACTION_AUDIT_WORKER_OPTIONS_CONTRACT,
  actionAuditWorkerOptions,
  createAuditPool,
  validatePreparedActionAuditWorkerOptions
} from "./detached-action-audit-coordinator.mjs";
import { isDeepStrictEqual } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readTrajectoryArchive } from "../src/ai/neural/archive.mjs";

const candidatePath = argumentValue(process.argv.slice(2), "candidate");
const neuralCheckpointPath = argumentValue(
  process.argv.slice(2),
  "neural-checkpoint"
);
const compareLocal = argumentValue(process.argv.slice(2), "compare-local")
  === "true";
const candidatePayload = candidatePath
  ? await readTrajectoryArchive(path.resolve(candidatePath))
  : null;
const candidate = candidatePayload?.candidate || null;
const engineFingerprint = candidate?.engineFingerprint || "deployment-smoke-v1";
const configuration = remoteActionAuditConfiguration();
if (!configuration) {
  throw new Error(
    "Remote action-audit configuration is missing. Deploy the Lightsail runtime first."
  );
}
const neuralCheckpoint = neuralCheckpointPath
  ? JSON.parse(await readFile(path.resolve(neuralCheckpointPath), "utf8"))
  : null;
const maximumLeagueIndex = Math.max(
  -1,
  ...(candidatePayload?.modelSeatSources || [])
    .filter((source) => source?.kind === "league")
    .map((source) => Number(source.index) || 0)
);
const preparedWorkerOptions = neuralCheckpoint
  ? validatePreparedActionAuditWorkerOptions({
    contract: ACTION_AUDIT_WORKER_OPTIONS_CONTRACT,
    model: neuralCheckpoint,
    league: Array.from(
      { length: maximumLeagueIndex + 1 },
      () => neuralCheckpoint
    ),
    teacherEvaluatorModels: [neuralCheckpoint],
    teacherEvaluatorMode: "certified-neural-ensemble",
    engineFingerprint
  })
  : actionAuditWorkerOptions({
    teacherEvaluatorMode: "heuristic-only",
    engineFingerprint
  });
const optionsHandoff = await createActionAuditOptionsHandoff(
  preparedWorkerOptions
);
let pool = null;
let localPool = null;
let temporaryRoot = null;
try {
  pool = await createRemoteActionAuditPool({
    configuration,
    optionsHandoff,
    projectRoot: process.cwd(),
    engineFingerprint
  });
  console.log(JSON.stringify({
    event: "lightsail-action-audit-ready",
    host: pool.host,
    initialWorkers: pool.processCount,
    desiredWorkers: pool.desiredProcessCount,
    maximumWorkers: pool.maximumProcessCount
  }));
  if (candidate) {
    temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "riftbound-lightsail-audit-smoke-")
    );
    const occupiedSeeds = new Set(
      (candidate.descriptor?.occupiedAuditSeeds || [])
        .map((seed) => Number(seed) >>> 0)
    );
    const taskCount = Math.max(
      1,
      Math.min(
        32,
        Math.floor(Number(argumentValue(process.argv.slice(2), "tasks")) || 1)
      )
    );
    let nextSeed = 0x51a7e;
    const tasks = Array.from({ length: taskCount }, (_, index) => {
      while (occupiedSeeds.has(nextSeed)) nextSeed = (nextSeed + 1) >>> 0;
      const seed = nextSeed;
      occupiedSeeds.add(seed);
      nextSeed = (nextSeed + 1) >>> 0;
      return {
        taskId: `deployment-smoke-${Date.now()}-${index}`,
        candidateId: candidatePayload.candidateId
          || path.basename(candidatePath).replace(/\.candidate\.json\.gz$/u, ""),
        candidatePath: path.resolve(candidatePath),
        outputPath: path.join(temporaryRoot, `result-${index}.json.gz`),
        bank: "selection",
        seeds: [seed],
        maximumSteps: Math.max(
          1,
          Math.floor(Number(
            argumentValue(process.argv.slice(2), "maximum-steps")
          ) || 8)
        ),
        informationSetHash: candidate.descriptor?.informationSetHash || null,
        engineFingerprint
      };
    });
    const completed = await pool.run(tasks, {
      stage: "deployment-seed-smoke",
      pairedSeeds: taskCount
    });
    const result = await readTrajectoryArchive(completed[0].outputPath);
    if (compareLocal) {
      localPool = await createAuditPool({
        preparedActionAuditWorkerOptions: preparedWorkerOptions,
        processes: 1,
        initialProcesses: 1,
        minimumFreeMemoryBytes: 0
      });
      const localTask = {
        ...tasks[0],
        outputPath: path.join(temporaryRoot, "local-parity-result.json.gz")
      };
      const [localCompleted] = await localPool.run([localTask], {
        stage: "deployment-local-parity",
        pairedSeeds: 1
      });
      const localResult = await readTrajectoryArchive(localCompleted.outputPath);
      if (!isDeepStrictEqual(result, localResult)) {
        throw new Error(
          "Lightsail action-audit raw outcome failed exact local parity."
        );
      }
      console.log(JSON.stringify({
        event: "lightsail-action-audit-local-parity-verified",
        taskId: result.taskId,
        seed: result.seeds?.[0] ?? null,
        evaluatorMode: preparedWorkerOptions.teacherEvaluatorMode
      }));
    }
    console.log(JSON.stringify({
      event: "lightsail-action-audit-seed-complete",
      taskId: result.taskId,
      tasks: completed.length,
      seed: result.seeds?.[0] ?? null,
      pairedResults: result.results?.length || 0,
      maximumSteps: tasks[0].maximumSteps,
      finalWorkers: pool.processCount,
      desiredWorkers: pool.desiredProcessCount
    }));
  }
} finally {
  await localPool?.close().catch(() => {});
  await pool?.close().catch(() => {});
  await discardActionAuditOptionsHandoff(optionsHandoff);
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function argumentValue(values, name) {
  const index = values.indexOf(`--${name}`);
  return index >= 0 ? values[index + 1] : null;
}
