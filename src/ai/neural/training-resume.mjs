import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readTrajectoryArchive, writeTrajectoryArchive } from "./archive.mjs";

export function createCollectionDescriptor(options) {
  const descriptor = {
    version: 21,
    runContract: options.runContract || "C",
    experimentId: options.experimentId || null,
    generation: options.generation,
    modelGeneration: options.modelGeneration,
    learningTargetVersion: options.learningTargetVersion,
    engineFingerprint: options.engineFingerprint,
    cardPoolId: options.cardPoolId,
    games: options.games,
    workers: options.workers,
    seed: options.seed,
    maxActions: options.maxActions,
    temperature: options.temperature,
    shapingWeight: options.shapingWeight,
    diagnosticWeight: options.diagnosticWeight,
    gamma: options.gamma,
    gaeLambda: options.gaeLambda,
    longHorizonLambda: options.longHorizonLambda,
    longHorizonWeight: options.longHorizonWeight,
    bestOfThreeFraction: options.bestOfThreeFraction,
    mirrorFraction: options.mirrorFraction,
    evolveDecks: options.evolveDecks,
    balancedPairings: options.balancedPairings !== false,
    deckCurriculum: options.deckCurriculum || null,
    leagueSamplingMode: options.leagueSamplingMode || "uniform",
    leagueSamplingWeights: options.leagueSamplingWeights || null,
    paymentPlannerVersion: 1,
    teacherFraction: options.teacherFraction,
    teacherBudget: options.teacherBudget,
    teacherCriticalBudget: options.teacherCriticalBudget,
    teacherUrgentBudget: options.teacherUrgentBudget,
    teacherScreenSimulations: options.teacherScreenSimulations,
    teacherConfirmationSimulations: options.teacherConfirmationSimulations,
    teacherConfirmationMaxSimulations: options.teacherConfirmationMaxSimulations,
    teacherDepth: options.teacherDepth,
    teacherCandidates: options.teacherCandidates,
    teacherLeafAuditSimulations: options.teacherLeafAuditSimulations,
    teacherEvaluatorMode: options.teacherEvaluatorMode || "certified-neural-ensemble",
    teacherEvaluatorEnsembleVersion: options.teacherEvaluatorEnsembleVersion || 0,
    evaluatorCertificateVersion: options.evaluatorCertificateVersion || 0,
    actionRankingReferenceVersion:
      Number(options.actionRankingReferenceVersion) || 0,
    actionRankingAuditReferenceVersion:
      Number(options.actionRankingAuditReferenceVersion) || 0,
    leafValueReferenceVersion: Number(options.leafValueReferenceVersion) || 0,
    captureProductionLeafAudit:
      options.captureProductionLeafAudit === true,
    captureIndependentActionAudit:
      options.captureIndependentActionAudit === true,
    teacherActionAuditBudget:
      Math.max(0, Number(options.teacherActionAuditBudget) || 0),
    teacherActionAuditMaximumSteps:
      Math.max(0, Number(options.teacherActionAuditMaximumSteps) || 0),
    certifiedEvaluatorHashes: [...(options.certifiedEvaluatorHashes || [])],
    certifiedEvaluatorCount: Number(options.certifiedEvaluatorCount) || 0,
    postmortemReviews: options.postmortemReviews,
    postmortemCaptureLimit: options.postmortemCaptureLimit,
    postmortemAuditInterval: options.postmortemAuditInterval,
    postmortemWinnerReviewFraction: options.postmortemWinnerReviewFraction,
    postmortemSimulations: options.postmortemSimulations,
    postmortemDepth: options.postmortemDepth,
    postmortemCandidates: options.postmortemCandidates,
    trainingDeckIds: [...options.trainingDeckIds]
  };
  if (Array.isArray(options.teacherLeafAuditSchedule)) {
    descriptor.teacherLeafAuditSchedule =
      options.teacherLeafAuditSchedule.map(Number);
  }
  return {
    ...descriptor,
    collectionKey: createHash("sha256").update(JSON.stringify(descriptor)).digest("hex")
  };
}

export function createEvaluationDescriptor(options) {
  const descriptor = {
    version: 5,
    runContract: options.runContract || "C",
    auditRole: options.auditRole || null,
    trainingIteration: options.trainingIteration,
    stage: options.stage,
    candidateHash: options.candidateHash,
    opponentHashes: [...(options.opponentHashes || [])],
    engineFingerprint: options.engineFingerprint,
    games: options.games,
    gamesPerOpponent: options.gamesPerOpponent || null,
    seed: options.seed,
    maxActions: options.maxActions,
    greedy: options.greedy !== false,
    temperature: options.temperature ?? 0,
    adjudicationVersion: 2,
    opponentSeeds: options.opponentSeeds || null,
    evaluationMode: options.evaluationMode || "same-deck-mirror-v1",
    trainingDeckIds: [...options.trainingDeckIds]
  };
  return {
    ...descriptor,
    evaluationKey: createHash("sha256").update(JSON.stringify(descriptor)).digest("hex")
  };
}

export function loadEvaluationGames(dataRoot, descriptor) {
  const directory = evaluationDirectory(dataRoot, descriptor);
  try {
    const output = new Map();
    for (const name of readdirSync(directory).filter((entry) => /^game-\d+\.json$/.test(entry)).sort()) {
      try {
        const record = JSON.parse(readFileSync(path.join(directory, name), "utf8"));
        if (record.evaluationKey !== descriptor.evaluationKey || !Number.isInteger(record.gameIndex) || !record.summary) continue;
        output.set(record.gameIndex, record.summary);
      } catch {}
    }
    return output;
  } catch {
    return new Map();
  }
}

export function saveEvaluationGame(dataRoot, descriptor, gameIndex, summary) {
  const directory = evaluationDirectory(dataRoot, descriptor);
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `game-${String(gameIndex).padStart(4, "0")}.json`);
  const temporary = `${filename}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify({ version: 1, evaluationKey: descriptor.evaluationKey, gameIndex, summary, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  renameSync(temporary, filename);
}

export async function loadGenerationResume(dataRoot, descriptor) {
  const filename = resumeManifestPath(dataRoot, descriptor.generation);
  const manifest = await readJson(filename);
  if (manifest?.collectionKey !== descriptor.collectionKey || !Array.isArray(manifest.population)) return null;
  return manifest;
}

export async function saveGenerationResume(dataRoot, descriptor, population) {
  const filename = resumeManifestPath(dataRoot, descriptor.generation);
  const manifest = {
    ...descriptor,
    state: "collecting",
    createdAt: new Date().toISOString(),
    population: structuredClone(population)
  };
  await writeJsonAtomic(filename, manifest);
  return manifest;
}

export async function inspectCollectedGames(dataRoot, descriptor) {
  const output = new Map();
  const assignments = workerAssignments(descriptor.games, descriptor.workers);
  await Promise.all(assignments.map(async (games, workerIndex) => {
    const completed = new Set();
    for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
      const manifest = await readGameManifest(dataRoot, descriptor, workerIndex, gameIndex);
      if (manifest) completed.add(gameIndex);
    }
    output.set(workerIndex, completed);
  }));
  return output;
}

export async function saveCollectedGame(dataRoot, descriptor, game) {
  const directory = gameDirectory(dataRoot, descriptor.generation, game.workerIndex, game.gameIndex);
  const trajectories = [];
  for (let trajectoryIndex = 0; trajectoryIndex < game.result.trajectories.length; trajectoryIndex += 1) {
    const trajectory = game.result.trajectories[trajectoryIndex];
    const { steps = [], ...metadata } = trajectory;
    const chunks = [];
    for (let start = 0, chunkIndex = 0; start < steps.length; start += 128, chunkIndex += 1) {
      const filename = `trajectory-${String(trajectoryIndex).padStart(2, "0")}-chunk-${String(chunkIndex).padStart(3, "0")}.json.gz`;
      await writeTrajectoryArchive(path.join(directory, filename), {
        version: 1,
        collectionKey: descriptor.collectionKey,
        workerIndex: game.workerIndex,
        gameIndex: game.gameIndex,
        trajectoryIndex,
        chunkIndex,
        steps: steps.slice(start, start + 128)
      });
      chunks.push(filename);
    }
    trajectories.push({ metadata, chunks, stepCount: steps.length });
  }
  await writeJsonAtomic(path.join(directory, "manifest.json"), {
    version: 1,
    collectionKey: descriptor.collectionKey,
    generation: descriptor.generation,
    workerIndex: game.workerIndex,
    gameIndex: game.gameIndex,
    seed: game.seed,
    createdAt: new Date().toISOString(),
    summaries: game.result.summaries,
    deckLearning: game.result.deckLearning,
    performance: game.result.performance || null,
    trajectories
  });
}

export async function loadCompletedCollection(dataRoot, descriptor) {
  const archived = await readJson(collectionArchivePath(dataRoot, descriptor.generation));
  if (archived?.collectionKey !== descriptor.collectionKey || archived.gameCount !== descriptor.games) return null;
  const collected = await loadPersistedCollection(dataRoot, descriptor);
  collected.workerStats = { total: descriptor.workers, reusedGames: descriptor.games, collectedGames: 0 };
  collected.resumedFromArchive = true;
  return collected;
}

export async function saveCompletedCollection(dataRoot, descriptor) {
  await writeJsonAtomic(collectionArchivePath(dataRoot, descriptor.generation), {
    ...descriptor,
    createdAt: new Date().toISOString(),
    gameCount: descriptor.games,
    storage: "per-game-trajectory-chunks"
  });
}

export async function loadPersistedCollection(dataRoot, descriptor) {
  const trajectories = [];
  const summaries = [];
  const learningSnapshots = [];
  const assignments = workerAssignments(descriptor.games, descriptor.workers);
  for (let workerIndex = 0; workerIndex < assignments.length; workerIndex += 1) {
    for (let gameIndex = 0; gameIndex < assignments[workerIndex]; gameIndex += 1) {
      const result = await loadCollectedGame(dataRoot, descriptor, workerIndex, gameIndex);
      if (!result) throw new Error(`Missing persisted self-play game ${workerIndex}:${gameIndex}.`);
      trajectories.push(...result.trajectories);
      summaries.push(...result.summaries);
      learningSnapshots.push(result.deckLearning);
    }
  }
  return { trajectories, summaries, deckLearning: mergeLearningSnapshots(learningSnapshots) };
}

export async function loadAvailablePersistedCollection(dataRoot, descriptor) {
  const trajectories = [];
  const summaries = [];
  const learningSnapshots = [];
  const completed = await inspectCollectedGames(dataRoot, descriptor);
  for (const [workerIndex, gameIndexes] of completed) {
    for (const gameIndex of [...gameIndexes].sort((left, right) => left - right)) {
      const result = await loadCollectedGame(
        dataRoot,
        descriptor,
        workerIndex,
        gameIndex
      );
      if (!result) continue;
      trajectories.push(...result.trajectories);
      summaries.push(...result.summaries);
      learningSnapshots.push(result.deckLearning);
    }
  }
  return {
    trajectories,
    summaries,
    deckLearning: mergeLearningSnapshots(learningSnapshots)
  };
}

export async function writeTrainingFailure(dataRoot, context, error) {
  const safeGeneration = String(context.generation || 0).padStart(5, "0");
  const id = `generation-${safeGeneration}-${Date.now()}`;
  const failure = {
    version: 1,
    state: "error",
    createdAt: new Date().toISOString(),
    ...context,
    error: serializeError(error)
  };
  const filename = path.join(dataRoot, "failures", `${id}.json`);
  await writeJsonAtomic(filename, failure);
  await writeJsonAtomic(path.join(dataRoot, "failures", "latest.json"), failure);
  return filename;
}

export function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    code: error?.code || null,
    stack: error?.stack || null,
    diagnostic: error?.diagnostic || null
  };
}

export function collectionArchivePath(dataRoot, generation) {
  return path.join(dataRoot, "trajectories", `generation-${String(generation).padStart(5, "0")}.manifest.json`);
}

function resumeManifestPath(dataRoot, generation) {
  return path.join(dataRoot, "resume", `generation-${String(generation).padStart(5, "0")}`, "manifest.json");
}

function evaluationDirectory(dataRoot, descriptor) {
  return path.join(dataRoot, "resume", "evaluations", `iteration-${String(descriptor.trainingIteration).padStart(5, "0")}`, descriptor.stage, descriptor.evaluationKey);
}

function gameDirectory(dataRoot, generation, workerIndex, gameIndex) {
  return path.join(dataRoot, "resume", `generation-${String(generation).padStart(5, "0")}`, "games", `worker-${String(workerIndex).padStart(2, "0")}`, `game-${String(gameIndex).padStart(3, "0")}`);
}

function workerAssignments(games, workers) {
  const count = Math.max(1, Math.min(workers || 1, games));
  return Array.from({ length: count }, (_, index) => Math.floor(games / count) + (index < games % count ? 1 : 0));
}

async function readJson(filename) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch { return null; }
}

async function readGameManifest(dataRoot, descriptor, workerIndex, gameIndex) {
  const manifest = await readJson(path.join(gameDirectory(dataRoot, descriptor.generation, workerIndex, gameIndex), "manifest.json"));
  if (manifest?.collectionKey !== descriptor.collectionKey || manifest.workerIndex !== workerIndex || manifest.gameIndex !== gameIndex) return null;
  if (!Array.isArray(manifest.trajectories) || !Array.isArray(manifest.summaries)) return null;
  return manifest;
}

async function loadCollectedGame(dataRoot, descriptor, workerIndex, gameIndex) {
  const manifest = await readGameManifest(dataRoot, descriptor, workerIndex, gameIndex);
  if (!manifest) return null;
  const directory = gameDirectory(dataRoot, descriptor.generation, workerIndex, gameIndex);
  const trajectories = [];
  for (let trajectoryIndex = 0; trajectoryIndex < manifest.trajectories.length; trajectoryIndex += 1) {
    const entry = manifest.trajectories[trajectoryIndex];
    const steps = [];
    for (let chunkIndex = 0; chunkIndex < entry.chunks.length; chunkIndex += 1) {
      const chunk = await readTrajectoryArchive(path.join(directory, entry.chunks[chunkIndex]));
      if (chunk.collectionKey !== descriptor.collectionKey || chunk.workerIndex !== workerIndex || chunk.gameIndex !== gameIndex
        || chunk.trajectoryIndex !== trajectoryIndex || chunk.chunkIndex !== chunkIndex || !Array.isArray(chunk.steps)) return null;
      steps.push(...chunk.steps);
    }
    if (steps.length !== entry.stepCount) return null;
    trajectories.push({ ...entry.metadata, steps });
  }
  return { trajectories, summaries: manifest.summaries, deckLearning: manifest.deckLearning || {} };
}

function mergeLearningSnapshots(snapshots) {
  const output = { deckStats: {}, cardStats: {}, matchupStats: {}, metaStats: { games: 0, cardAppearances: {} }, archetypeStats: {} };
  for (const snapshot of snapshots) mergeObjects(output, snapshot);
  return output;
}

function mergeObjects(target, source, pathParts = []) {
  for (const [key, value] of Object.entries(source || {})) {
    if (pathParts[0] === "deckProfiles") {
      if (target[key] == null) target[key] = structuredClone(value);
      continue;
    }
    if (typeof value === "number") target[key] = (target[key] || 0) + value;
    else if (value && typeof value === "object") mergeObjects(target[key] ||= {}, value, [...pathParts, key]);
    else if (target[key] == null) target[key] = value;
  }
  return target;
}

async function writeJsonAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filename);
}
