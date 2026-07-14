import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { decklists } from "../src/cards.mjs";
import { deckAllowedInPool } from "../src/card-pools.mjs";
import { createNeuralModel, serializeNeuralModel } from "../src/ai/neural/model.mjs";
import { evaluateBehaviorCloning, trainBehaviorCloning } from "../src/ai/neural/trainer.mjs";
import { seededRandom } from "../src/ai/neural/selfplay.mjs";
import { applyMetaSnapshot } from "../src/ai/meta.mjs";
import { buildMetaPreset } from "../src/ai/meta-presets.mjs";

const startedAt = Date.now();
const args = parseArgs(process.argv.slice(2));
const poolId = args["card-pool"] || "origins-era";
const output = path.resolve(args.output || "src/ai/checkpoints/neural-bootstrap.json");
const reportPath = path.resolve(args.report || `data/ai/runs/bootstrap-${timestamp()}.json`);
const seed = (Number(args.seed) || 20251207) >>> 0;
const games = Math.max(2, Number(args.games) || 128);
const workers = Math.max(1, Math.min(games, Number(args.workers) || 4));
const maxActions = Math.max(160, Number(args["max-actions"]) || 640);
const epochs = Math.max(1, Number(args.epochs) || 5);
const batchSize = Math.max(1, Number(args["batch-size"]) || 8);
const validationFraction = Math.max(0.05, Math.min(0.3, Number(args["validation-fraction"]) || 0.1));
const metaFraction = Math.max(0, Math.min(1, Number(args["meta-fraction"]) || 0.7));
const decks = Object.values(decklists).filter((deck) => deckAllowedInPool(deck, poolId));
const meta = buildMetaPreset("origins-houston-2025");

console.log(JSON.stringify({ event: "bootstrap-start", games, workers, maxActions, epochs, poolId, output, report: reportPath }));
const collected = await collectParallel({ games, workers, decks, maxActions, meta, metaFraction, seed });
if (collected.completedGames < games) {
  const failedReport = buildReport({ state: "failed", reason: "insufficient-completed-games", collected });
  await writeAtomic(reportPath, failedReport);
  throw new Error(`Only ${collected.completedGames}/${games} games completed within the attempt limit. See ${reportPath}`);
}

const split = splitByGame(collected.trajectories, validationFraction, seed);
const model = createNeuralModel({ metadata: { stage: "baseline-imitation" } });
model.knowledge.cardPoolId = poolId;
applyMetaSnapshot(model.knowledge, meta);
const random = seededRandom(seed ^ 0x9e3779b9);
const training = trainBehaviorCloning(model, split.training, {
  epochs,
  batchSize,
  learningRate: Number(args["learning-rate"]) || 0.0005,
  random,
  onEpoch(progress) { console.log(JSON.stringify({ event: "training-epoch", ...progress })); }
});
const validation = evaluateBehaviorCloning(model, split.validation, { batchSize });
model.generation = 0;
model.gamesTrained = collected.completedGames;
model.calibration = validation.calibration;
model.metadata.stage = "bootstrap-complete";
model.metadata.imitationGames = collected.completedGames;
model.metadata.validation = withoutBins(validation);
model.metadata.bootstrapReport = reportPath;
const report = buildReport({ state: "complete", collected, split, training, validation });
await writeAtomic(output, serializeNeuralModel(model));
await writeAtomic(reportPath, report);
console.log(JSON.stringify({ event: "bootstrap-complete", output, report: reportPath, completedGames: collected.completedGames, attemptedGames: collected.attemptedGames, trajectories: collected.trajectories.length, steps: report.data.steps, validation: withoutBins(validation), elapsedSeconds: report.elapsedSeconds }));

async function collectParallel(options) {
  const assignments = Array.from({ length: options.workers }, (_, index) => Math.floor(options.games / options.workers) + (index < options.games % options.workers ? 1 : 0));
  let offset = 0;
  const tasks = assignments.filter(Boolean).map((workerGames, workerIndex) => {
    const gameOffset = offset;
    offset += workerGames * 3;
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./ai-imitation-worker.mjs", import.meta.url), {
        workerData: {
          workerIndex, games: workerGames, maxAttempts: workerGames * 2,
          maxActions: options.maxActions, meta: options.meta, metaFraction: options.metaFraction,
          gameOffset, seed: options.seed + workerIndex * 100003,
          deckIds: options.decks.map((deck) => deck.id)
        }
      });
      worker.on("message", (message) => {
        if (message.kind === "progress") console.log(JSON.stringify({ event: "collection-progress", ...message }));
        if (message.kind === "result") resolve(message.result);
      });
      worker.on("error", reject);
      worker.on("exit", (code) => { if (code !== 0) reject(new Error(`Imitation worker ${workerIndex} exited with code ${code}`)); });
    });
  });
  const results = await Promise.all(tasks);
  return {
    trajectories: results.flatMap((result) => result.trajectories),
    summaries: results.flatMap((result) => result.summaries),
    completedGames: results.reduce((sum, result) => sum + result.completedGames, 0),
    attemptedGames: results.reduce((sum, result) => sum + result.attemptedGames, 0),
    targetGames: options.games
  };
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

function buildReport({ state, reason = null, collected, split = null, training = null, validation = null }) {
  const completed = collected.summaries.filter((summary) => summary.completed);
  const steps = collected.trajectories.reduce((sum, trajectory) => sum + trajectory.steps.length, 0);
  const confidence = collected.trajectories.flatMap((trajectory) => trajectory.steps).reduce((sum, step) => sum + (step.teacherConfidence || 0), 0) / Math.max(1, steps);
  return {
    version: 1, state, reason,
    startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    command: process.argv,
    configuration: { poolId, metaId: meta.id, games, workers, maxActions, epochs, batchSize, validationFraction, metaFraction, seed },
    data: {
      targetGames: games, attemptedGames: collected.attemptedGames, completedGames: collected.completedGames,
      completionRate: collected.attemptedGames ? collected.completedGames / collected.attemptedGames : 0,
      cappedGames: collected.summaries.filter((summary) => summary.capped).length,
      failedGames: collected.summaries.filter((summary) => !summary.completed && !summary.capped).length,
      trajectories: collected.trajectories.length, steps, meanTeacherConfidence: confidence,
      averageActionsCompleted: mean(completed.map((summary) => summary.actions)),
      averageTurnsCompleted: mean(completed.map((summary) => summary.turns)),
      deckAppearances: countDeckAppearances(collected.summaries)
    },
    split: split ? { trainingGames: split.trainingGames, validationGames: split.validationGames, trainingTrajectories: split.training.length, validationTrajectories: split.validation.length } : null,
    training: training ? { ...aggregateHistory(training.history), epochs } : null,
    validation: validation ? withoutBins(validation) : null,
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
function timestamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function countDeckAppearances(summaries) { const counts = {}; for (const summary of summaries) for (const deckId of summary.deckIds || []) counts[deckId] = (counts[deckId] || 0) + 1; return counts; }
function aggregateHistory(history) { const keys = ["loss", "policyLoss", "valueLoss", "beliefLoss", "entropy"]; return Object.fromEntries(keys.map((key) => [`mean${key[0].toUpperCase()}${key.slice(1)}`, mean(history.map((item) => item[key]))])); }
function withoutBins(validation) { return { ...validation, calibration: validation?.calibration ? { ...validation.calibration, bins: undefined } : undefined }; }
