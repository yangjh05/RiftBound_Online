import { createGame } from "../engine.mjs";
import { activeActorId, applyAiAction, enumerateLegalActions } from "./actions.mjs";
import { mutateDeck, updateDeckLearning } from "./deckbuilding.mjs";
import { observeGame, stateFeatures } from "./observation.mjs";
import { actionProbabilities, choosePolicyAction, createModel, DEFAULT_AI_MODEL } from "./policy.mjs";

export function runSelfPlayTraining(options = {}) {
  const games = Math.max(1, options.games || 100);
  const maxActions = Math.max(40, options.maxActions || 500);
  const learningRate = options.learningRate || 0.012;
  const valueLearningRate = options.valueLearningRate || 0.02;
  const random = options.random || Math.random;
  const model = createModel(options.model || DEFAULT_AI_MODEL);
  const population = (options.decks || []).map((deck) => structuredClone(deck));
  if (population.length < 2) throw new Error("Self-play training needs at least two decks.");
  const results = [];

  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    if (gameIndex > 0 && options.evolveEvery && gameIndex % options.evolveEvery === 0) {
      const parent = selectDeck(population, model, random);
      population.push(mutateDeck(parent, model, random));
      const maxPopulation = options.maxPopulation || Math.max(8, options.decks.length * 2);
      if (population.length > maxPopulation) removeWeakestDeck(population, model);
    }
    const deckA = selectDeck(population, model, random);
    let deckB = selectDeck(population, model, random);
    if (population.length > 1 && deckB === deckA) deckB = population[(population.indexOf(deckA) + 1) % population.length];
    const game = createGame({
      decks: [deckA, deckB],
      firstPlayerId: gameIndex % 2 ? "p2" : "p1",
      interactive: true,
      manualActionChainPriority: true
    });
    const trajectories = new Map(game.players.map((player) => [player.id, []]));
    let actions = 0;
    while (game.phase !== "complete" && actions < maxActions) {
      const actorId = activeActorId(game);
      const legal = enumerateLegalActions(game, actorId);
      if (!actorId || !legal.length) break;
      const distribution = actionProbabilities(game, actorId, legal, model, options.temperature || 0.85);
      const selected = sampleDistribution(distribution, random);
      trajectories.get(actorId).push({
        state: stateFeatures(observeGame(game, actorId)),
        selectedFeatures: selected.features,
        distribution: distribution.map((item) => ({ probability: item.probability, features: item.features }))
      });
      const result = applyAiAction(game, selected.action, actorId);
      if (!result?.ok) throw new Error(`Training selected an illegal action: ${selected.key}`);
      actions += 1;
    }
    const rewards = terminalRewards(game);
    for (const player of game.players) updateFromTrajectory(model, trajectories.get(player.id), rewards[player.id], learningRate, valueLearningRate);
    if (game.winnerId) updateDeckLearning(model, [deckA, deckB], game.winnerId, game.players);
    results.push({ winnerId: game.winnerId || null, deckIds: [deckA.id, deckB.id], actions, truncated: game.phase !== "complete" });
    model.gamesTrained += 1;
  }
  model.generation += 1;
  model.metadata = {
    ...model.metadata,
    algorithm: "self-play-policy-gradient",
    trainedAt: new Date().toISOString(),
    trainingGames: games,
    truncationRate: results.filter((result) => result.truncated).length / games
  };
  return { model, population, results };
}

export function evaluateModel(candidate, champion, decks, options = {}) {
  const games = Math.max(2, options.games || 20);
  const maxActions = options.maxActions || 500;
  const random = options.random || Math.random;
  let candidateWins = 0;
  let completed = 0;
  for (let index = 0; index < games; index += 1) {
    const candidateSeat = index % 2;
    const pair = [decks[index % decks.length], decks[(index * 7 + 1) % decks.length]];
    const game = createGame({ decks: pair, firstPlayerId: index % 2 ? "p2" : "p1", interactive: true, manualActionChainPriority: true });
    for (let actionCount = 0; actionCount < maxActions && game.phase !== "complete"; actionCount += 1) {
      const actorId = activeActorId(game);
      const actorSeat = game.players.findIndex((player) => player.id === actorId);
      const model = actorSeat === candidateSeat ? candidate : champion;
      const legal = enumerateLegalActions(game, actorId);
      const selected = choosePolicyAction(game, actorId, legal, model, { greedy: false, temperature: 0.25, random });
      if (!selected || !applyAiAction(game, selected.action, actorId)?.ok) break;
    }
    if (game.phase !== "complete") continue;
    completed += 1;
    if (game.winnerId === game.players[candidateSeat].id) candidateWins += 1;
  }
  const winRate = completed ? candidateWins / completed : 0;
  return { games, completed, candidateWins, winRate, promoted: completed >= Math.ceil(games * 0.7) && winRate >= (options.promotionThreshold || 0.55) };
}

function updateFromTrajectory(model, trajectory, reward, policyRate, valueRate) {
  if (!trajectory?.length) return;
  for (const step of trajectory) {
    const baseline = Math.tanh(dot(model.valueWeights, step.state));
    const advantage = reward - baseline;
    const expected = weightedFeatures(step.distribution);
    const keys = new Set([...Object.keys(step.selectedFeatures), ...Object.keys(expected)]);
    for (const key of keys) {
      const gradient = (step.selectedFeatures[key] || 0) - (expected[key] || 0);
      model.policyWeights[key] = clamp((model.policyWeights[key] || 0) + policyRate * advantage * gradient, -8, 8);
    }
    for (const [key, value] of Object.entries(step.state)) {
      model.valueWeights[key] = clamp((model.valueWeights[key] || 0) + valueRate * (reward - baseline) * value, -8, 8);
    }
  }
}

function terminalRewards(game) {
  if (game.phase === "complete" && game.winnerId) return Object.fromEntries(game.players.map((player) => [player.id, player.id === game.winnerId ? 1 : -1]));
  const [first, second] = game.players;
  const diff = Math.tanh(((first.score || 0) - (second.score || 0)) / Math.max(1, game.victoryScore));
  return { [first.id]: diff, [second.id]: -diff };
}

function weightedFeatures(distribution) {
  const output = {};
  for (const item of distribution) for (const [key, value] of Object.entries(item.features)) output[key] = (output[key] || 0) + item.probability * value;
  return output;
}

function sampleDistribution(distribution, random) {
  let roll = random();
  for (const item of distribution) {
    roll -= item.probability;
    if (roll <= 0) return item;
  }
  return distribution.at(-1);
}

function selectDeck(population, model, random) {
  const scored = population.map((deck) => {
    const stat = model.deckStats?.[deck.id];
    const winRate = stat?.games ? stat.wins / stat.games : 0.5;
    const uncertainty = 1 / Math.sqrt((stat?.games || 0) + 1);
    return { deck, weight: Math.exp(winRate + uncertainty) };
  });
  const total = scored.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;
  for (const item of scored) { roll -= item.weight; if (roll <= 0) return item.deck; }
  return scored.at(-1).deck;
}

function removeWeakestDeck(population, model) {
  population.sort((left, right) => deckFitness(model, right) - deckFitness(model, left));
  population.pop();
}

function deckFitness(model, deck) {
  const stat = model.deckStats?.[deck.id];
  return stat?.games ? stat.wins / stat.games : 0.5;
}

function dot(weights, features) { return Object.entries(features).reduce((sum, [key, value]) => sum + (weights[key] || 0) * value, 0); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
