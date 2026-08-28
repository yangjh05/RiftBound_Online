import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.dataDir) throw new Error("--data-dir is required.");
const dataRoot = path.resolve(args.dataDir);
const processId = Number(args.pid);
const targetGeneration = Number(args.generation);
const trainingIteration = Number(args.iteration);
const excludedTrainingKey = args.excludeTrainingKey || null;
const pollMs = Math.max(500, Number(args.pollMs) || 1000);
if (!Number.isInteger(processId) || processId <= 0) throw new Error("--pid must identify the active training process.");
if (!Number.isInteger(targetGeneration) || targetGeneration < 1) throw new Error("--generation is required.");
if (!Number.isInteger(trainingIteration) || trainingIteration < 1) throw new Error("--iteration is required.");

const pendingPath = path.join(dataRoot, "resume", `iteration-${pad(trainingIteration)}`, "trained-candidate.json");
const watcherLogPath = path.join(dataRoot, "logs", `learner-only-iteration-${pad(trainingIteration)}.log`);
await log(`Watching PID ${processId} for generation ${targetGeneration} learner checkpoint.`);

while (true) {
  const pending = await readJsonIfReady(pendingPath);
  const candidate = pending?.candidateCheckpoint;
  const candidateGeneration = Number(candidate?.generation);
  if (candidateGeneration >= targetGeneration - 1
    && candidateGeneration <= targetGeneration
    && candidate.metadata?.trainingIteration === trainingIteration
    && pending.trainingKey !== excludedTrainingKey
    && pending.optimizerState?.modelGeneration === candidateGeneration
    && pending.optimizerState?.weights?.length) {
    await log(`Complete learner checkpoint detected at ${pendingPath}.`);
    await stopTrainingProcess(processId);
    await finalizeLearnerOnly(pending);
    break;
  }
  if (!isProcessAlive(processId)) {
    await log("Training process ended before the requested learner checkpoint was complete.");
    process.exitCode = 2;
    break;
  }
  await delay(pollMs);
}

async function finalizeLearnerOnly(pending) {
  const completedAt = new Date().toISOString();
  const candidate = structuredClone(pending.candidateCheckpoint);
  const learnerGeneration = Number(candidate.generation);
  candidate.metadata = {
    ...candidate.metadata,
    promoted: false,
    learnerOnly: true,
    finalEvaluationSkipped: true,
    learnerOnlyCompletedAt: completedAt
  };
  const learnerPath = path.join(dataRoot, "learner", "neural-learner.json");
  const optimizerPath = path.join(dataRoot, "learner", "optimizer-state.json");
  const candidatePath = path.join(dataRoot, "candidates",
    `iteration-${pad(trainingIteration)}-generation-${pad(learnerGeneration)}.json`);
  const runStatePath = path.join(dataRoot, "resume", "run.json");
  const progressPath = path.join(dataRoot, "progress", "latest.json");
  const statusPath = path.join(dataRoot, "status.json");
  const priorRunState = await readJsonIfReady(runStatePath) || {};
  const priorProgress = await readJsonIfReady(progressPath) || {};
  const eventLogPath = priorProgress.eventLogPath || null;
  const summary = {
    version: 1,
    state: "idle",
    stage: "learner-only-complete",
    generation: targetGeneration,
    trainingIteration,
    championGeneration: Number(priorRunState.championGeneration) || 0,
    learnerGeneration,
    promoted: false,
    finalEvaluationSkipped: true,
    reusedForNextTraining: true,
    candidatePath,
    learnerCheckpointPath: learnerPath,
    optimizerStatePath: optimizerPath,
    selectedEpoch: candidate.metadata?.selectedEpoch ?? null,
    requestedEpochs: candidate.metadata?.requestedEpochs ?? null,
    meanLoss: candidate.metadata?.meanLoss ?? null,
    completedAt
  };
  const runState = {
    ...priorRunState,
    version: 2,
    trainingIteration,
    championGeneration: summary.championGeneration,
    learnerGeneration,
    learnerOnly: true,
    updatedAt: completedAt
  };
  const updatedPending = {
    ...pending,
    candidateCheckpoint: candidate,
    learnerOnly: true,
    finalEvaluationSkipped: true,
    completedAt
  };

  await atomicWriteJson(pendingPath, updatedPending);
  await atomicWriteJson(candidatePath, candidate);
  await atomicWriteJson(learnerPath, candidate);
  await atomicWriteJson(optimizerPath, pending.optimizerState);
  await atomicWriteJson(runStatePath, runState);
  await atomicWriteJson(statusPath, summary);
  await atomicWriteJson(progressPath, { ...priorProgress, ...summary, sequence: (Number(priorProgress.sequence) || 0) + 1 });
  if (eventLogPath) await appendFile(path.resolve(eventLogPath), `${JSON.stringify({ ...summary, updatedAt: completedAt })}\n`, "utf8");
  const completionPath = path.join(dataRoot, "learner-only", `iteration-${pad(trainingIteration)}-generation-${pad(learnerGeneration)}.json`);
  await atomicWriteJson(completionPath, summary);
  await log(`Learner-only completion saved. Champion generation ${summary.championGeneration} was left unchanged.`);
}

async function stopTrainingProcess(pid) {
  if (!isProcessAlive(pid)) return;
  try { process.kill(pid, "SIGTERM"); } catch {}
  for (let attempt = 0; attempt < 10 && isProcessAlive(pid); attempt += 1) await delay(250);
  if (!isProcessAlive(pid)) {
    await log(`Stopped training PID ${pid} before final evaluation.`);
    return;
  }
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, encoding: "utf8" });
  if (result.status !== 0 && isProcessAlive(pid)) {
    throw new Error(`Could not stop training PID ${pid}: ${result.stderr || result.stdout || "unknown taskkill failure"}`);
  }
  await log(`Force-stopped training PID ${pid} and its process tree before final evaluation.`);
}

async function readJsonIfReady(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  await mkdir(path.dirname(watcherLogPath), { recursive: true });
  await appendFile(watcherLogPath, `${line}\n`, "utf8");
  console.log(line);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pad(value) {
  return String(value).padStart(5, "0");
}

function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    output[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = values[index + 1];
    index += 1;
  }
  return output;
}
