import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.dataDir) throw new Error("--data-dir is required.");

const dataRoot = path.resolve(args.dataDir);
const failurePath = args.failure
  ? path.resolve(args.failure)
  : await latestFailurePath(path.join(dataRoot, "failures"));
const failure = await readJson(failurePath);
const generation = Number(failure.generation);
const trainingIteration = Number(failure.trainingIteration);
if (!Number.isInteger(generation) || !Number.isInteger(trainingIteration)) {
  throw new Error("Failure record does not identify a recoverable generation and training iteration.");
}

const candidatePath = path.join(dataRoot, "candidates", `iteration-${pad(trainingIteration)}-generation-${pad(generation)}.json`);
const pendingPath = path.join(dataRoot, "resume", `iteration-${pad(trainingIteration)}`, "trained-candidate.json");
const learnerPath = path.resolve(failure.learnerCheckpointPath || path.join(dataRoot, "learner", "neural-learner.json"));
const optimizerPath = path.resolve(failure.optimizerStatePath || path.join(dataRoot, "learner", "optimizer-state.json"));
const runStatePath = path.join(dataRoot, "resume", "run.json");

const [candidate, learner, pending] = await Promise.all([
  readJson(candidatePath),
  readJson(learnerPath),
  readJson(pendingPath)
]);
assertEqual(candidate.generation, generation, "candidate generation");
assertEqual(learner.generation, generation, "learner generation");
assertEqual(pending.candidateCheckpoint?.generation, generation, "pending candidate generation");
assertEqual(pending.optimizerState?.modelGeneration, generation, "pending optimizer generation");
assertEqual(candidate.metadata?.trainingIteration, trainingIteration, "candidate training iteration");
assertEqual(learner.metadata?.trainingIteration, trainingIteration, "learner training iteration");
assertEqual(checkpointWeightHash(candidate), checkpointWeightHash(learner), "candidate/learner weights");
assertEqual(checkpointWeightHash(candidate), checkpointWeightHash(pending.candidateCheckpoint), "candidate/pending weights");
if (!pending.optimizerState?.weights?.length) throw new Error("Pending optimizer snapshot is empty.");
if (!candidate.metadata?.evaluation || !candidate.metadata?.absoluteEvaluation || !candidate.metadata?.leagueEvaluation) {
  throw new Error("Candidate evaluation metadata is incomplete; refusing to finalize recovery.");
}

const championGeneration = Number(candidate.metadata.championGenerationAtTraining) || 0;
const completedGames = await collectedGameCount(dataRoot, generation);
const summary = {
  state: "idle",
  stage: "recovered-complete",
  generation,
  trainingIteration,
  championGeneration,
  learnerGeneration: generation,
  promoted: candidate.metadata.promoted === true,
  games: Number(failure.descriptor?.games) || completedGames,
  completedGames,
  candidatePath,
  learnerCheckpointPath: learnerPath,
  evaluation: compactEvaluation(candidate.metadata.evaluation, candidate.metadata.candidateDeckGate, candidate.metadata.candidateGate),
  absoluteEvaluation: compactEvaluation(candidate.metadata.absoluteEvaluation, candidate.metadata.absoluteDeckGate, candidate.metadata.absoluteGate),
  leagueEvaluation: compactLeagueEvaluation(candidate.metadata.leagueEvaluation, candidate.metadata.leagueGate),
  calibration: pending.calibration || candidate.calibration || null,
  meanLoss: candidate.metadata.meanLoss ?? null,
  recovery: {
    recoveredAt: new Date().toISOString(),
    failurePath,
    pendingPath,
    reusedCollection: true,
    reusedTraining: true,
    reusedEvaluation: true,
    engineFingerprint: args.engineFingerprint || learner.metadata?.engineFingerprint || null
  }
};
const runState = {
  version: 2,
  seed: Number(failure.descriptor?.seed) ? Number(failure.descriptor.seed) - (trainingIteration - 1) * 1000003 : null,
  trainingIteration,
  championGeneration,
  learnerGeneration: generation,
  updatedAt: new Date().toISOString()
};

await atomicWriteJson(optimizerPath, pending.optimizerState);
if (args.engineFingerprint && learner.metadata?.engineFingerprint !== args.engineFingerprint) {
  const previousFingerprint = learner.metadata?.engineFingerprint || null;
  learner.metadata = {
    ...learner.metadata,
    engineFingerprint: args.engineFingerprint,
    checkpointMigration: {
      migratedAt: new Date().toISOString(),
      fromEngineFingerprint: previousFingerprint,
      reason: "Optimizer serialization ownership fix only; model weights and training semantics are unchanged."
    }
  };
  await atomicWriteJson(learnerPath, learner);
}
await atomicWriteJson(runStatePath, runState);
await atomicWriteJson(path.join(dataRoot, "status.json"), summary);
if (args.statusMirror) await atomicWriteJson(path.resolve(args.statusMirror), summary);
if (failure.progressPath) await atomicWriteJson(path.resolve(failure.progressPath), summary);
if (failure.eventLogPath) await appendFile(path.resolve(failure.eventLogPath), `${JSON.stringify({ ...summary, updatedAt: new Date().toISOString() })}\n`, "utf8");
const recoveryPath = path.join(dataRoot, "recoveries", `iteration-${pad(trainingIteration)}-generation-${pad(generation)}.json`);
await atomicWriteJson(recoveryPath, summary);

console.log(JSON.stringify({ recovered: true, generation, trainingIteration, completedGames, optimizerWeights: pending.optimizerState.weights.length, recoveryPath, statusPath: path.join(dataRoot, "status.json") }, null, 2));

function compactEvaluation(evaluation, deckGate, passed) {
  return {
    completed: evaluation.completed,
    wins: evaluation.candidateWins,
    winRate: evaluation.winRate,
    wilsonLowerBound: evaluation.wilsonLowerBound,
    seatStats: evaluation.seatStats,
    conditionStats: evaluation.conditionStats,
    deckStats: evaluation.deckStats,
    deckGate,
    seatGap: evaluation.seatGap,
    passed: passed === true
  };
}

function compactLeagueEvaluation(evaluation, passed) {
  return {
    opponents: evaluation.opponents,
    completed: evaluation.completed,
    winRate: evaluation.winRate,
    wilsonLowerBound: evaluation.wilsonLowerBound,
    worstOpponentWilsonLowerBound: evaluation.worstOpponentWilsonLowerBound,
    maxSeatGap: evaluation.maxSeatGap,
    passed: passed === true
  };
}

function checkpointWeightHash(checkpoint) {
  return createHash("sha256").update(JSON.stringify(checkpoint?.weights || null)).digest("hex");
}

async function collectedGameCount(root, targetGeneration) {
  try {
    const manifest = await readJson(path.join(root, "trajectories", `generation-${pad(targetGeneration)}.manifest.json`));
    return Number(manifest.gameCount) || 0;
  } catch {
    return 0;
  }
}

async function latestFailurePath(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(root, entry.name));
  if (!files.length) throw new Error(`No failure records found in ${root}.`);
  const records = await Promise.all(files.map(async (file) => ({ file, record: await readJson(file) })));
  records.sort((left, right) => String(right.record.createdAt || "").localeCompare(String(left.record.createdAt || "")));
  return records[0].file;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, received ${actual}.`);
}

function pad(value) {
  return String(value).padStart(5, "0");
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    result[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = values[index + 1];
    index += 1;
  }
  return result;
}
