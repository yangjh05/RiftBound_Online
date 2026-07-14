import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { decklists } from "../src/cards.mjs";
import { mutateDeck } from "../src/ai/deckbuilding.mjs";
import { createNeuralModel, deserializeNeuralModel, serializeNeuralModel } from "../src/ai/neural/model.mjs";
import { collectParallelSelfPlay, evaluateNeuralLeague, evaluateNeuralModels, seededRandom } from "../src/ai/neural/selfplay.mjs";
import { restoreAdamOptimizer, serializeOptimizer, trainRecurrentPpo } from "../src/ai/neural/trainer.mjs";
import { writeAiStatus } from "../server/ai-data.mjs";
import { applyMetaSnapshot } from "../src/ai/meta.mjs";
import { hydrateHumanReplayTrajectories } from "../src/ai/human-data.mjs";
import { buildMetaPreset } from "../src/ai/meta-presets.mjs";
import { deckAllowedInPool } from "../src/card-pools.mjs";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const checkpointPath = path.resolve(args.output || "src/ai/checkpoints/neural-champion.json");
const dataRoot = path.resolve(args["data-dir"] || "data/ai");
const generations = args.continuous === "true" ? Infinity : Math.max(1, Number(args.generations) || 1);
const games = Math.max(1, Number(args.games) || 32);
const evaluationGames = Math.max(2, Number(args["evaluation-games"]) || 20);
const workers = Math.max(1, Number(args.workers) || Math.min(4, games));
const maxActions = Math.max(80, Number(args["max-actions"]) || 600);
const seed = (Number(args.seed) || Date.now()) >>> 0;
const cardPoolId = args["card-pool"] || "origins-era";
const random = seededRandom(seed);
let championCheckpoint = await readCheckpoint(checkpointPath);
let champion = championCheckpoint ? deserializeNeuralModel(championCheckpoint) : createNeuralModel();
let population = Object.values(decklists).filter((deck) => deckAllowedInPool(deck, cardPoolId)).map((deck) => structuredClone(deck));
const leagueRoot = path.join(dataRoot, "league");
const optimizerStatePath = path.join(dataRoot, "optimizer-state.json");
let league = await loadLeague(leagueRoot, Math.max(1, Number(args["league-size"]) || 8));
const importedMeta = await readCheckpoint(path.resolve(args.meta || path.join(dataRoot, "meta", "current.json")));
applyMetaSnapshot(champion.knowledge, importedMeta || buildMetaPreset("origins-houston-2025"));
champion.knowledge.cardPoolId = cardPoolId;
const savedOptimizerState = await readCheckpoint(optimizerStatePath);
let optimizer = await restoreAdamOptimizer(savedOptimizerState?.modelGeneration === champion.generation ? savedOptimizerState : null, Number(args["learning-rate"]) || 0.0003);

for (let generationIndex = 0; generationIndex < generations; generationIndex += 1) {
  const generation = champion.generation + 1;
  const curriculum = curriculumStage(generation, maxActions);
  await writeAiStatus({ state: "collecting", generation, games, workers, seed, curriculum });
  population = evolvePopulation(population, champion.knowledge, random, Math.max(population.length * 2, Number(args.population) || 32), cardPoolId);
  const collected = await collectParallelSelfPlay({
    games,
    workers,
    decks: population,
    model: champion,
    league,
    meta: champion.knowledge,
    matchFraction: Math.max(0, Math.min(1, Number(args["match-fraction"]) || 0.25)),
    maxActions: curriculum.maxActions,
    temperature: Number(args.temperature) || curriculum.temperature,
    shapingWeight: curriculum.shapingWeight,
    seed: seed + generationIndex * 1000003
  });
  const distributed = await loadTrajectoryShards(args["trajectory-shards"], champion.generation, cardPoolId);
  collected.trajectories.push(...distributed.flatMap((shard) => shard.trajectories || []));
  collected.summaries.push(...distributed.flatMap((shard) => shard.summaries || []));
  await archiveGeneration(dataRoot, generation, collected);
  const candidate = deserializeNeuralModel(serializeNeuralModel(champion));
  mergeKnowledge(candidate.knowledge, collected.deckLearning);
  normalizeKnowledge(candidate.knowledge);
  await writeAiStatus({ state: "training", generation, games, trajectories: collected.trajectories.length });
  const humanTrajectories = await loadHumanReplayData(path.join(dataRoot, "replays"), Math.max(0, Number(args["human-replays"]) || 32));
  const trainingTrajectories = [...collected.trajectories, ...humanTrajectories.slice(0, Math.max(1, Math.ceil(collected.trajectories.length * 0.25)))];
  const optimizerBeforeTraining = await serializeOptimizer(optimizer, champion.generation);
  const trained = trainRecurrentPpo(candidate, trainingTrajectories, {
    epochs: Math.max(1, Number(args.epochs) || 4),
    batchSize: Math.max(1, Number(args["batch-size"]) || 4),
    learningRate: Number(args["learning-rate"]) || 0.0003,
    optimizer,
    random
  });
  optimizer = trained.optimizer;
  await writeAiStatus({ state: "evaluating", generation, evaluationGames });
  const evaluationDecks = Object.values(decklists).filter((deck) => deckAllowedInPool(deck, cardPoolId));
  const evaluation = evaluateNeuralModels(candidate, champion, evaluationDecks, {
    games: evaluationGames,
    maxActions,
    seed: seed + generationIndex * 1000003 + 77
  });
  const leagueEvaluation = evaluateNeuralLeague(candidate, [champion, ...league], evaluationDecks, {
    games: Math.max(2, Math.floor(evaluationGames / 2)),
    maxActions,
    seed: seed + generationIndex * 1000003 + 177
  });
  const bootstrap = !championCheckpoint;
  const leagueGate = leagueEvaluation.results.every((result) => result.completed >= Math.ceil(result.games * 0.8))
    && leagueEvaluation.worstOpponentWilsonLowerBound >= (Number(args["league-wilson-threshold"]) || 0.45)
    && leagueEvaluation.maxSeatGap <= (Number(args["max-seat-gap"]) || 0.2);
  const promoted = args["force-promote"] === "true" || bootstrap || (evaluation.promoted && leagueGate);
  candidate.metadata.evaluation = evaluation;
  candidate.metadata.leagueEvaluation = leagueEvaluation;
  candidate.metadata.leagueGate = leagueGate;
  candidate.metadata.promoted = promoted;
  const candidatePath = path.join(dataRoot, "candidates", `generation-${String(generation).padStart(5, "0")}.json`);
  await writeCheckpoint(candidatePath, serializeNeuralModel(candidate));
  if (promoted) {
    if (championCheckpoint) await writeCheckpoint(path.join(leagueRoot, `generation-${String(champion.generation).padStart(5, "0")}.json`), championCheckpoint);
    champion = candidate;
    championCheckpoint = serializeNeuralModel(candidate);
    await writeCheckpoint(checkpointPath, championCheckpoint);
    await writeCheckpoint(path.join(leagueRoot, `generation-${String(candidate.generation).padStart(5, "0")}.json`), championCheckpoint);
    league = await loadLeague(leagueRoot, Math.max(1, Number(args["league-size"]) || 8));
  } else {
    optimizer = await restoreAdamOptimizer(optimizerBeforeTraining, Number(args["learning-rate"]) || 0.0003);
  }
  await writeCheckpoint(optimizerStatePath, await serializeOptimizer(optimizer, champion.generation));
  const summary = {
    state: "idle",
    generation,
    promoted,
    games,
    humanTrajectories: humanTrajectories.length,
    completedGames: collected.summaries.filter((item) => item.completed).length,
    evaluation: { completed: evaluation.completed, wins: evaluation.candidateWins, winRate: evaluation.winRate, wilsonLowerBound: evaluation.wilsonLowerBound },
    leagueEvaluation: { opponents: leagueEvaluation.opponents, completed: leagueEvaluation.completed, winRate: leagueEvaluation.winRate, wilsonLowerBound: leagueEvaluation.wilsonLowerBound, worstOpponentWilsonLowerBound: leagueEvaluation.worstOpponentWilsonLowerBound, maxSeatGap: leagueEvaluation.maxSeatGap, passed: leagueGate },
    calibration: trained.calibration,
    meanLoss: candidate.metadata.meanLoss
  };
  await writeAiStatus(summary);
  console.log(JSON.stringify(summary));
  if (generations === Infinity) await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Number(args["generation-delay-ms"]) || 5000)));
}

function evolvePopulation(current, knowledge, random, limit, poolId) {
  const seeds = Object.values(decklists).filter((deck) => deckAllowedInPool(deck, poolId)).map((deck) => structuredClone(deck));
  const parents = [...current].sort((left, right) => deckFitness(knowledge, right) - deckFitness(knowledge, left)).slice(0, Math.max(4, Math.floor(limit / 2)));
  const variants = [];
  while (seeds.length + parents.length + variants.length < limit && parents.length) {
    variants.push(mutateDeck(parents[Math.floor(random() * parents.length)], knowledge || {}, random));
  }
  return [...new Map([...seeds, ...parents, ...variants].map((deck) => [deck.id, deck])).values()].slice(0, limit);
}

function deckFitness(knowledge, deck) {
  const stat = knowledge?.deckStats?.[deck.id];
  return stat?.games ? stat.wins / stat.games : 0.5;
}

async function archiveGeneration(root, generation, collected) {
  const directory = path.join(root, "trajectories");
  await writeTrajectoryArchive(path.join(directory, `generation-${String(generation).padStart(5, "0")}.json.gz`), {
    version: 1,
    generation,
    createdAt: new Date().toISOString(),
    summaries: collected.summaries,
    deckLearning: collected.deckLearning,
    trajectories: collected.trajectories
  });
}

async function readCheckpoint(filename) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch { return null; }
}

async function writeCheckpoint(filename, checkpoint) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, "utf8");
  await import("node:fs/promises").then(({ rename }) => rename(temporary, filename));
}

async function loadLeague(directory, limit) {
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort().slice(-limit);
    const loaded = [];
    for (const name of names) {
      const checkpoint = await readCheckpoint(path.join(directory, name));
      if (checkpoint) loaded.push(deserializeNeuralModel(checkpoint));
    }
    return loaded;
  } catch { return []; }
}

async function loadHumanReplayData(directory, limit) {
  if (!limit) return [];
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort().slice(-limit);
    const replays = [];
    for (const name of names) {
      const replay = await readCheckpoint(path.join(directory, name));
      if (replay) replays.push(replay);
    }
    return hydrateHumanReplayTrajectories(replays);
  } catch { return []; }
}

async function loadTrajectoryShards(directory, modelGeneration, poolId) {
  if (!directory) return [];
  const root = path.resolve(directory);
  const names = (await readdir(root)).filter((name) => name.endsWith(".json.gz")).sort();
  const shards = [];
  for (const name of names) {
    const shard = await readTrajectoryArchive(path.join(root, name));
    if (shard.modelGeneration !== modelGeneration || shard.cardPoolId !== poolId) continue;
    shards.push(shard);
  }
  return shards;
}

function curriculumStage(generation, configuredMaxActions) {
  if (generation <= 3) return { name: "bootstrap", maxActions: Math.min(configuredMaxActions, 220), temperature: 1, shapingWeight: 0.35 };
  if (generation <= 10) return { name: "guided", maxActions: Math.min(configuredMaxActions, 420), temperature: 0.85, shapingWeight: 0.18 };
  return { name: "competitive", maxActions: configuredMaxActions, temperature: 0.72, shapingWeight: Math.max(0, 0.08 - (generation - 10) * 0.005) };
}

function mergeKnowledge(target, source, path = []) {
  for (const [key, value] of Object.entries(source || {})) {
    if (path[0] === "deckProfiles") {
      target[key] = structuredClone(value);
      continue;
    }
    if (typeof value === "number") target[key] = (target[key] || 0) + value;
    else if (value && typeof value === "object" && !Array.isArray(value)) mergeKnowledge(target[key] ||= {}, value, [...path, key]);
    else if (target[key] == null) target[key] = structuredClone(value);
  }
}

function normalizeKnowledge(knowledge) {
  for (const stat of Object.values(knowledge.archetypeStats || {})) {
    stat.unitRatio = stat.cardTotal ? stat.unitTotal / stat.cardTotal : 0;
    stat.spellRatio = stat.cardTotal ? stat.spellTotal / stat.cardTotal : 0;
    stat.gearRatio = stat.cardTotal ? stat.gearTotal / stat.cardTotal : 0;
    stat.averageEnergy = stat.cardTotal ? stat.energyTotal / stat.cardTotal : 0;
  }
}
