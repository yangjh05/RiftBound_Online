import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { decklists } from "../src/cards.mjs";
import { CARD_POOL_FORMATS, deckAllowedInPool } from "../src/card-pools.mjs";
import { createNeuralModel, deserializeNeuralModel, serializeNeuralModel } from "../src/ai/neural/model.mjs";
import { evaluateBehaviorCloning, trainBehaviorCloning } from "../src/ai/neural/trainer.mjs";
import { seededRandom } from "../src/ai/neural/selfplay.mjs";
import { applyMetaSnapshot } from "../src/ai/meta.mjs";
import { buildMetaPreset } from "../src/ai/meta-presets.mjs";
import { assessBehaviorCloningQuality, auditImitationDataset } from "../src/ai/neural/quality.mjs";

const startedAt = Date.now();
const args = parseArgs(process.argv.slice(2));
assertKnownArgs(args);
const poolId = args["card-pool"] || "origins-era";
const output = path.resolve(args.output || "src/ai/checkpoints/neural-bootstrap.json");
const reportPath = path.resolve(args.report || `data/ai/runs/bootstrap-${timestamp()}.json`);
const recoveryDir = path.dirname(reportPath);
const latestCheckpointPath = path.join(recoveryDir, "latest-checkpoint.json");
const bestCheckpointPath = path.join(recoveryDir, "best-checkpoint.json");
const seed = integerArg("seed", 20251207, 0, 0xffffffff) >>> 0;
const games = integerArg("games", 128, 2, 1000000);
const workers = integerArg("workers", 4, 1, games);
const maxActions = integerArg("max-actions", 800, 160, 100000);
const epochs = integerArg("epochs", 5, 1, 1000);
const batchSize = integerArg("batch-size", 8, 1, 128);
const attemptMultiplier = integerArg("attempt-multiplier", 3, 1, 20);
const collectionRounds = integerArg("collection-rounds", 3, 1, 10);
const validationFraction = numberArg("validation-fraction", 0.1, 0.05, 0.3);
const metaFraction = numberArg("meta-fraction", 0.7, 0, 1);
const learningRate = numberArg("learning-rate", 0.0005, 1e-7, 1);
const datasetThresholds = {
  maxCapRate: numberArg("max-cap-rate", 0.15, 0, 1),
  maxTruncationRate: numberArg("max-truncation-rate", 0.01, 0, 1),
  minDeckCoverage: numberArg("min-deck-coverage", 0.9, 0, 1),
  maxSeatImbalance: numberArg("max-seat-imbalance", 0.15, 0, 1)
};
const modelThresholds = {
  minDecisionAdvantage: numberArg("min-decision-advantage", 0.01, 0, 1),
  minAccuracyImprovement: numberArg("min-accuracy-improvement", 0.002, 0, 1),
  minRelativePolicyLossImprovement: numberArg("min-policy-loss-improvement", 0.01, 0, 1),
  maxGeneralizationGap: numberArg("max-generalization-gap", 0.3, 0, 1),
  minDecisionStepsPerGame: numberArg("min-decision-steps-per-game", 5, 1, 100000)
};
const decks = Object.values(decklists).filter((deck) => deckAllowedInPool(deck, poolId));
const meta = buildMetaPreset("origins-houston-2025");
if (!CARD_POOL_FORMATS.some((pool) => pool.id === poolId)) throw new Error(`Unknown card pool: ${poolId}`);
if (meta.cardPoolId !== poolId) throw new Error(`Meta preset ${meta.id} targets ${meta.cardPoolId}, not ${poolId}.`);
if (decks.length < 2) throw new Error(`Card pool ${poolId} has only ${decks.length} playable deck(s).`);

console.log(JSON.stringify({ event: "bootstrap-start", games, workers, maxActions, epochs, poolId, output, report: reportPath }));
const collected = await collectParallel({ games, workers, decks, maxActions, meta, metaFraction, seed, attemptMultiplier, collectionRounds });
if (collected.completedGames < games) {
  const failedReport = buildReport({ state: "failed", reason: "insufficient-completed-games", collected });
  await writeAtomic(reportPath, failedReport);
  throw new Error(`Only ${collected.completedGames}/${games} games completed within the attempt limit. See ${reportPath}`);
}

const split = splitByGame(collected.trajectories, validationFraction, seed);
const datasetGate = auditImitationDataset({ collected, split, deckIds: decks.map((deck) => deck.id), thresholds: datasetThresholds });
if (!datasetGate.passed) {
  const failedReport = buildReport({ state: "quality-rejected", reason: "dataset-quality-gate", collected, split, datasetGate });
  await writeAtomic(reportPath, failedReport);
  throw new Error(`Collected data failed its quality gate. See ${reportPath}`);
}

let model = createNeuralModel({ metadata: { stage: "baseline-imitation" } });
model.knowledge.cardPoolId = poolId;
applyMetaSnapshot(model.knowledge, meta);
const random = seededRandom(seed ^ 0x9e3779b9);
const baselineValidation = evaluateBehaviorCloning(model, split.validation, { batchSize });
let optimizer = null;
let best = null;
const epochHistory = [];
for (let epoch = 1; epoch <= epochs; epoch += 1) {
  const trained = trainBehaviorCloning(model, split.training, {
    epochs: 1, batchSize, learningRate, random, optimizer
  });
  optimizer = trained.optimizer;
  const epochMetrics = trained.history.map((item) => ({ ...item, epoch }));
  epochHistory.push(...epochMetrics);
  const epochValidation = evaluateBehaviorCloning(model, split.validation, { batchSize });
  const checkpoint = serializeNeuralModel(model);
  const candidate = { epoch, validation: epochValidation, checkpoint };
  await writeAtomic(latestCheckpointPath, checkpoint);
  if (!best || betterValidation(candidate.validation, best.validation)) {
    best = candidate;
    await writeAtomic(bestCheckpointPath, checkpoint);
  }
  await writeAtomic(reportPath, buildReport({
    state: "training", collected, split, datasetGate,
    training: { history: epochHistory }, validation: epochValidation,
    baselineValidation, bestEpoch: best.epoch
  }));
  console.log(JSON.stringify({ event: "training-epoch", epoch, epochs, metrics: aggregateHistory(epochMetrics), validation: withoutBins(epochValidation), bestEpoch: best.epoch }));
}
model = deserializeNeuralModel(best.checkpoint);
const training = { model, optimizer, history: epochHistory };
const trainingEvaluation = evaluateBehaviorCloning(model, split.training, { batchSize });
const validation = best.validation;
const qualityGate = assessBehaviorCloningQuality({ baseline: baselineValidation, validation, training: trainingEvaluation, validationGames: split.validationGames, thresholds: modelThresholds });
model.generation = 0;
model.gamesTrained = collected.completedGames;
model.calibration = validation.calibration;
model.metadata.stage = "bootstrap-complete";
model.metadata.imitationGames = collected.completedGames;
model.metadata.validation = withoutBins(validation);
model.metadata.baselineValidation = withoutBins(baselineValidation);
model.metadata.trainingEvaluation = withoutBins(trainingEvaluation);
model.metadata.bestEpoch = best.epoch;
model.metadata.datasetFingerprint = datasetGate.metrics.fingerprint;
model.metadata.qualityGate = qualityGate;
model.metadata.bootstrapReport = reportPath;
if (!qualityGate.passed) {
  const failedReport = buildReport({ state: "quality-rejected", reason: "model-quality-gate", collected, split, datasetGate, training, validation, baselineValidation, trainingEvaluation, qualityGate, bestEpoch: best.epoch });
  await writeAtomic(reportPath, failedReport);
  throw new Error(`Trained model failed its quality gate. Best recovery checkpoint: ${bestCheckpointPath}`);
}
const serializedModel = serializeNeuralModel(model);
const modelSha256 = payloadSha256(serializedModel);
const report = buildReport({ state: "complete", collected, split, datasetGate, training, validation, baselineValidation, trainingEvaluation, qualityGate, bestEpoch: best.epoch, modelSha256 });
await writeAtomic(output, serializedModel);
await writeAtomic(reportPath, report);
console.log(JSON.stringify({ event: "bootstrap-complete", output, report: reportPath, completedGames: collected.completedGames, attemptedGames: collected.attemptedGames, trajectories: collected.trajectories.length, steps: report.data.steps, validation: withoutBins(validation), elapsedSeconds: report.elapsedSeconds }));

async function collectParallel(options) {
  const combined = { trajectories: [], summaries: [], completedGames: 0, attemptedGames: 0, targetGames: options.games };
  let offset = 0;
  for (let round = 0; round < options.collectionRounds && combined.completedGames < options.games; round += 1) {
    const missingGames = options.games - combined.completedGames;
    const assignments = Array.from({ length: Math.min(options.workers, missingGames) }, (_, index) => Math.floor(missingGames / Math.min(options.workers, missingGames)) + (index < missingGames % Math.min(options.workers, missingGames) ? 1 : 0));
    const roundResult = await collectRound(assignments, round);
    combined.trajectories.push(...roundResult.flatMap((result) => result.trajectories));
    combined.summaries.push(...roundResult.flatMap((result) => result.summaries));
    combined.completedGames += roundResult.reduce((sum, result) => sum + result.completedGames, 0);
    combined.attemptedGames += roundResult.reduce((sum, result) => sum + result.attemptedGames, 0);
    console.log(JSON.stringify({ event: "collection-round", round: round + 1, collectionRounds: options.collectionRounds, completedGames: combined.completedGames, targetGames: options.games, attemptedGames: combined.attemptedGames }));
  }
  return combined;

  async function collectRound(assignments, round) {
    const tasks = assignments.filter(Boolean).map((workerGames, workerIndex) => {
      const gameOffset = offset;
      const maxAttempts = workerGames * options.attemptMultiplier;
      offset += maxAttempts + 1;
      return new Promise((resolve, reject) => {
        let receivedResult = false;
        const worker = new Worker(new URL("./ai-imitation-worker.mjs", import.meta.url), {
          workerData: {
            workerIndex, games: workerGames, maxAttempts,
            maxActions: options.maxActions, meta: options.meta, metaFraction: options.metaFraction,
            gameOffset, seed: options.seed + round * 1000003 + workerIndex * 100003,
            deckIds: options.decks.map((deck) => deck.id)
          }
        });
        worker.on("message", (message) => {
          if (message.kind === "progress") console.log(JSON.stringify({ event: "collection-progress", ...message }));
          if (message.kind === "result") { receivedResult = true; resolve(message.result); }
        });
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0) reject(new Error(`Imitation worker ${workerIndex} exited with code ${code}`));
          else if (!receivedResult) reject(new Error(`Imitation worker ${workerIndex} exited without a result.`));
        });
      });
    });
    return Promise.all(tasks);
  }
}

function splitByGame(trajectories, fraction, splitSeed) {
  const gameIds = [...new Set(trajectories.map((trajectory) => trajectory.gameId))];
  const splitRandom = seededRandom(splitSeed ^ 0x85ebca6b);
  for (let index = gameIds.length - 1; index > 0; index -= 1) {
    const target = Math.floor(splitRandom() * (index + 1));
    [gameIds[index], gameIds[target]] = [gameIds[target], gameIds[index]];
  }
  const validationCount = Math.max(1, Math.min(gameIds.length - 1, Math.round(gameIds.length * fraction)));
  const validationIds = new Set(gameIds.slice(0, validationCount));
  return {
    training: trajectories.filter((trajectory) => !validationIds.has(trajectory.gameId)),
    validation: trajectories.filter((trajectory) => validationIds.has(trajectory.gameId)),
    trainingGames: gameIds.length - validationCount,
    validationGames: validationCount
  };
}

function buildReport({
  state, reason = null, collected, split = null, datasetGate = null, training = null,
  validation = null, baselineValidation = null, trainingEvaluation = null,
  qualityGate = null, bestEpoch = null, modelSha256 = null
}) {
  const completed = collected.summaries.filter((summary) => summary.completed);
  const steps = collected.trajectories.reduce((sum, trajectory) => sum + trajectory.steps.length, 0);
  const confidence = collected.trajectories.flatMap((trajectory) => trajectory.steps).reduce((sum, step) => sum + (step.teacherConfidence || 0), 0) / Math.max(1, steps);
  return {
    version: 2, state, reason,
    startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    command: process.argv,
    sourceCommit: process.env.GITHUB_SHA || process.env.GIT_COMMIT || null,
    configuration: { poolId, metaId: meta.id, games, workers, maxActions, epochs, batchSize, validationFraction, metaFraction, attemptMultiplier, collectionRounds, learningRate, seed },
    data: {
      targetGames: games, attemptedGames: collected.attemptedGames, completedGames: collected.completedGames,
      completionRate: collected.attemptedGames ? collected.completedGames / collected.attemptedGames : 0,
      cappedGames: collected.summaries.filter((summary) => summary.capped).length,
      failedGames: collected.summaries.filter((summary) => !summary.completed && !summary.capped).length,
      trajectories: collected.trajectories.length, steps, meanTeacherConfidence: confidence,
      averageActionsCompleted: mean(completed.map((summary) => summary.actions)),
      averageTurnsCompleted: mean(completed.map((summary) => summary.turns)),
      deckAppearances: countDeckAppearances(completed),
      attemptedDeckAppearances: countDeckAppearances(collected.summaries)
    },
    datasetGate,
    split: split ? { trainingGames: split.trainingGames, validationGames: split.validationGames, trainingTrajectories: split.training.length, validationTrajectories: split.validation.length } : null,
    training: training ? { ...aggregateHistory(training.history), epochs } : null,
    baselineValidation: baselineValidation ? withoutBins(baselineValidation) : null,
    trainingEvaluation: trainingEvaluation ? withoutBins(trainingEvaluation) : null,
    validation: validation ? withoutBins(validation) : null,
    qualityGate,
    bestEpoch,
    modelSha256,
    recovery: { latestCheckpoint: latestCheckpointPath, bestCheckpoint: bestCheckpointPath },
    output, report: reportPath
  };
}

async function writeAtomic(filename, payload) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(payload)}\n`, "utf8");
  await rename(temporary, filename);
}

function parseArgs(values) { const parsed = {}; for (let index = 0; index < values.length; index += 1) if (values[index].startsWith("--")) parsed[values[index].slice(2)] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : "true"; return parsed; }
function assertKnownArgs(values) {
  const known = new Set([
    "card-pool", "output", "report", "seed", "games", "workers", "max-actions", "epochs", "batch-size",
    "attempt-multiplier", "collection-rounds", "validation-fraction", "meta-fraction", "learning-rate",
    "max-cap-rate", "max-truncation-rate", "min-deck-coverage", "max-seat-imbalance",
    "min-decision-advantage", "min-accuracy-improvement", "min-policy-loss-improvement",
    "max-generalization-gap", "min-decision-steps-per-game"
  ]);
  const unknown = Object.keys(values).filter((name) => !known.has(name));
  if (unknown.length) throw new Error(`Unknown bootstrap argument(s): ${unknown.map((name) => `--${name}`).join(", ")}`);
}
function integerArg(name, fallback, minimum, maximum) {
  const value = args[name] == null ? fallback : Number(args[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}
function numberArg(name, fallback, minimum, maximum) {
  const value = args[name] == null ? fallback : Number(args[name]);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`--${name} must be a number from ${minimum} to ${maximum}.`);
  return value;
}
function timestamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function countDeckAppearances(summaries) { const counts = {}; for (const summary of summaries) for (const deckId of summary.deckIds || []) counts[deckId] = (counts[deckId] || 0) + 1; return counts; }
function aggregateHistory(history) {
  const keys = ["loss", "policyLoss", "valueLoss", "beliefLoss", "entropy"];
  const weight = history.reduce((sum, item) => sum + (item.steps || 0), 0);
  return Object.fromEntries(keys.map((key) => [
    `mean${key[0].toUpperCase()}${key.slice(1)}`,
    weight ? history.reduce((sum, item) => sum + item[key] * item.steps, 0) / weight : mean(history.map((item) => item[key]))
  ]));
}
function withoutBins(validation) { return { ...validation, calibration: validation?.calibration ? { ...validation.calibration, bins: undefined } : undefined }; }
function betterValidation(candidate, incumbent) {
  if (candidate.decisionAccuracy !== incumbent.decisionAccuracy) return candidate.decisionAccuracy > incumbent.decisionAccuracy;
  return candidate.policyLoss < incumbent.policyLoss;
}
function payloadSha256(payload) { return `sha256:${createHash("sha256").update(`${JSON.stringify(payload)}\n`).digest("hex")}`; }
