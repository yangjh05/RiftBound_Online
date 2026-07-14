import { Worker } from "node:worker_threads";
import { createGame } from "../../engine.mjs";
import { activeActorId, applyAiAction, enumerateLegalActions } from "../actions.mjs";
import { updateDeckLearning } from "../deckbuilding.mjs";
import { encodeOpponentDeckTarget } from "./encoding.mjs";
import { createNeuralSession, deserializeNeuralModel, serializeNeuralModel } from "./model.mjs";

export function playNeuralSelfPlayGame(options) {
  const { decks, model, maxActions = 600, random = Math.random, firstPlayerId = "p1" } = options;
  const game = createGame({ decks, firstPlayerId, interactive: true, manualActionChainPriority: true });
  const models = options.models || [model, model];
  const sessions = models.map((seatModel) => createNeuralSession(seatModel));
  const trainableSeats = new Set(options.trainableSeats || [0, 1]);
  const trajectories = new Map(game.players.map((player) => [player.id, []]));
  let actionCount = 0;
  while (game.phase !== "complete" && actionCount < maxActions) {
    const actorId = activeActorId(game);
    const seat = game.players.findIndex((player) => player.id === actorId);
    const legal = enumerateLegalActions(game, actorId);
    if (!actorId || !legal.length) break;
    const decision = sessions[seat].decide(game, actorId, legal, { temperature: options.temperature || 0.8, random });
    const beforePotential = shapingPotential(game, actorId);
    const beliefTarget = encodeOpponentDeckTarget(game, actorId);
    let recordedStep = null;
    if (trainableSeats.has(seat)) {
      recordedStep = {
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      value: decision.value,
      beliefTarget,
        initialMemory: decision.initialMemory,
        shapedReward: 0
      };
      trajectories.get(actorId).push(recordedStep);
    }
    const result = applyAiAction(game, decision.action, actorId);
    if (!result?.ok) throw new Error(`Neural policy selected illegal action: ${decision.action.kind}`);
    if (recordedStep) recordedStep.shapedReward = (options.gamma || 0.997) * shapingPotential(game, actorId) - beforePotential;
    actionCount += 1;
  }
  const rewards = terminalRewards(game);
  const outputTrajectories = [];
  for (let seat = 0; seat < game.players.length; seat += 1) {
    const player = game.players[seat];
    if (!trainableSeats.has(seat)) continue;
    const steps = trajectories.get(player.id);
    applyGeneralizedAdvantageEstimation(steps, rewards[player.id], options.gamma || 0.997, options.gaeLambda || 0.95, options.shapingWeight || 0);
    outputTrajectories.push({ playerId: player.id, steps });
  }
  return {
    trajectories: outputTrajectories,
    summary: {
      winnerId: game.winnerId || null,
      completed: game.phase === "complete",
      actions: actionCount,
      scores: game.players.map((player) => player.score),
      deckIds: decks.map((deck) => deck.id)
    },
    game
  };
}

export function playNeuralBestOfThree(options) {
  const random = options.random || Math.random;
  const currentDecks = options.decks.map((deck) => structuredClone(deck));
  const models = options.models || [options.model, options.model];
  const sideboardSessions = models.map((model) => createNeuralSession(model));
  const trainableSeats = new Set(options.trainableSeats || [0, 1]);
  const matchSteps = [[], []];
  const wins = [0, 0];
  const games = [];
  let firstPlayerId = options.firstPlayerId || "p1";
  let lastGame = null;
  for (let gameNumber = 1; gameNumber <= 3 && Math.max(...wins) < 2; gameNumber += 1) {
    const played = playNeuralSelfPlayGame({
      ...options,
      decks: currentDecks,
      models,
      trainableSeats: [...trainableSeats],
      firstPlayerId,
      random
    });
    lastGame = played.game;
    games.push(played.summary);
    for (const trajectory of played.trajectories) {
      const seat = trajectory.playerId === "p1" ? 0 : 1;
      matchSteps[seat].push(...trajectory.steps);
    }
    const actualWinnerSeat = played.game.winnerId === "p1" ? 0 : played.game.winnerId === "p2" ? 1 : -1;
    const scoreDifference = played.game.players[0].score - played.game.players[1].score;
    const winnerSeat = actualWinnerSeat >= 0
      ? actualWinnerSeat
      : options.adjudicateIncomplete === false || scoreDifference === 0 ? -1 : scoreDifference > 0 ? 0 : 1;
    if (actualWinnerSeat < 0 && winnerSeat >= 0) games.at(-1).adjudicatedWinnerId = `p${winnerSeat + 1}`;
    if (winnerSeat >= 0) wins[winnerSeat] += 1;
    if (Math.max(...wins) >= 2 || gameNumber === 3) break;
    if (winnerSeat < 0) continue;
    for (let seat = 0; seat < 2; seat += 1) {
      if (!currentDecks[seat].sideboard?.length) continue;
      const playerId = `p${seat + 1}`;
      const sideboardSession = sideboardSessions[seat];
      lastGame.aiSideboardContext ||= {};
      lastGame.aiSideboardContext[playerId] = {
        main: currentDecks[seat].main,
        sideboard: currentDecks[seat].sideboard,
        metaCards: metaWeightedCards(options.meta || models[seat].knowledge)
      };
      for (let swap = 0; swap < Math.min(3, currentDecks[seat].sideboard.length); swap += 1) {
        const legal = enumerateSideboardActions(currentDecks[seat], models[seat].knowledge, 191);
        const decision = sideboardSession.decide(lastGame, playerId, legal, { temperature: options.temperature || 0.8, random });
        if (trainableSeats.has(seat)) matchSteps[seat].push(sideboardStep(decision, lastGame, playerId));
        if (!decision || decision.action.kind === "sideboardDone") break;
        applyResolvedSideboardSwap(currentDecks[seat], decision.action);
      }
    }
    if (winnerSeat >= 0) {
      const chooserSeat = 1 - winnerSeat;
      const chooserId = `p${chooserSeat + 1}`;
      const decision = sideboardSessions[chooserSeat].decide(lastGame, chooserId, [
        { kind: "chooseFirstPlayer", playerId: "p1" },
        { kind: "chooseFirstPlayer", playerId: "p2" }
      ], { temperature: options.temperature || 0.8, random });
      if (trainableSeats.has(chooserSeat)) matchSteps[chooserSeat].push(sideboardStep(decision, lastGame, chooserId));
      firstPlayerId = decision.action.playerId;
    }
  }
  const winnerSeat = wins[0] > wins[1] ? 0 : wins[1] > wins[0] ? 1 : -1;
  const trajectories = [];
  for (let seat = 0; seat < 2; seat += 1) {
    if (!trainableSeats.has(seat)) continue;
    const reward = winnerSeat < 0 ? 0 : winnerSeat === seat ? 1 : -1;
    applyGeneralizedAdvantageEstimation(matchSteps[seat], reward, options.gamma || 0.997, options.gaeLambda || 0.95, options.shapingWeight || 0);
    trajectories.push({ playerId: `p${seat + 1}`, match: true, steps: matchSteps[seat] });
  }
  return {
    trajectories,
    summary: {
      type: "bestOfThree",
      completed: winnerSeat >= 0,
      winnerId: winnerSeat >= 0 ? `p${winnerSeat + 1}` : null,
      wins,
      games,
      deckIds: options.decks.map((deck) => deck.id)
    },
    game: lastGame
  };
}

export function enumerateSideboardActions(deck, knowledge = {}, limit = 191) {
  const main = [...new Map((deck.main || []).map((card) => [card.cardNumber, card])).values()];
  const sideboard = [...new Map((deck.sideboard || []).map((card) => [card.cardNumber, card])).values()];
  const scored = [];
  for (const outgoing of main) {
    for (const incoming of sideboard) {
      scored.push({
        kind: "sideboardSwap",
        outCardNumber: outgoing.cardNumber,
        inCardNumber: incoming.cardNumber,
        score: sideboardPrior(knowledge, incoming.cardNumber) - sideboardPrior(knowledge, outgoing.cardNumber)
      });
    }
  }
  scored.sort((left, right) => right.score - left.score || left.outCardNumber.localeCompare(right.outCardNumber) || left.inCardNumber.localeCompare(right.inCardNumber));
  return [...scored.slice(0, limit).map(({ score, ...action }) => action), { kind: "sideboardDone" }];
}

export function applyResolvedSideboardSwap(deck, action) {
  if (action?.kind !== "sideboardSwap") return false;
  const outIndex = deck.main.findIndex((card) => card.cardNumber === action.outCardNumber);
  const inIndex = deck.sideboard.findIndex((card) => card.cardNumber === action.inCardNumber);
  if (outIndex < 0 || inIndex < 0) return false;
  const outgoing = deck.main[outIndex];
  deck.main[outIndex] = deck.sideboard[inIndex];
  deck.sideboard[inIndex] = outgoing;
  return true;
}

export function evaluateNeuralModels(candidate, champion, decks, options = {}) {
  const games = Math.max(2, options.games || 20);
  const random = seededRandom(options.seed || Date.now());
  let candidateWins = 0;
  let completed = 0;
  const seatStats = [{ games: 0, completed: 0, wins: 0 }, { games: 0, completed: 0, wins: 0 }];
  const summaries = [];
  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const candidateSeat = gameIndex % 2;
    const pair = pickDeckPair(decks, random);
    const game = createGame({ decks: pair, firstPlayerId: gameIndex % 2 ? "p2" : "p1", interactive: true, manualActionChainPriority: true });
    const sessions = [createNeuralSession(candidateSeat === 0 ? candidate : champion), createNeuralSession(candidateSeat === 1 ? candidate : champion)];
    for (let actionCount = 0; actionCount < (options.maxActions || 600) && game.phase !== "complete"; actionCount += 1) {
      const actorId = activeActorId(game);
      const seat = game.players.findIndex((player) => player.id === actorId);
      const legal = enumerateLegalActions(game, actorId);
      const selected = sessions[seat].decide(game, actorId, legal, { temperature: options.temperature || 0.2, random });
      if (!selected || !applyAiAction(game, selected.action, actorId)?.ok) break;
    }
    const didComplete = game.phase === "complete";
    seatStats[candidateSeat].games += 1;
    if (didComplete) {
      completed += 1;
      seatStats[candidateSeat].completed += 1;
      if (game.winnerId === game.players[candidateSeat].id) candidateWins += 1;
      if (game.winnerId === game.players[candidateSeat].id) seatStats[candidateSeat].wins += 1;
    }
    summaries.push({ completed: didComplete, winnerId: game.winnerId || null, candidateSeat, scores: game.players.map((player) => player.score) });
  }
  const winRate = completed ? candidateWins / completed : 0;
  const wilsonLowerBound = wilsonLower(candidateWins, completed);
  for (const stat of seatStats) {
    stat.winRate = stat.completed ? stat.wins / stat.completed : 0;
    stat.wilsonLowerBound = wilsonLower(stat.wins, stat.completed);
  }
  const seatGap = Math.abs(seatStats[0].winRate - seatStats[1].winRate);
  return { games, completed, candidateWins, winRate, wilsonLowerBound, seatStats, seatGap, promoted: completed >= Math.ceil(games * 0.8) && wilsonLowerBound > (options.wilsonThreshold || 0.5) && seatGap <= (options.maxSeatGap || 0.2), summaries };
}

export function evaluateNeuralLeague(candidate, opponents, decks, options = {}) {
  const pool = opponents.length ? opponents : [candidate];
  const gamesPerOpponent = Math.max(2, Math.ceil((options.games || 20) / pool.length));
  const results = pool.map((opponent, index) => evaluateNeuralModels(candidate, opponent, decks, {
    ...options,
    games: gamesPerOpponent,
    seed: (options.seed || Date.now()) + index * 7919
  }));
  const completed = results.reduce((sum, result) => sum + result.completed, 0);
  const candidateWins = results.reduce((sum, result) => sum + result.candidateWins, 0);
  return {
    opponents: pool.length,
    games: results.reduce((sum, result) => sum + result.games, 0),
    completed,
    candidateWins,
    winRate: completed ? candidateWins / completed : 0,
    wilsonLowerBound: wilsonLower(candidateWins, completed),
    worstOpponentWinRate: Math.min(...results.map((result) => result.winRate)),
    worstOpponentWilsonLowerBound: Math.min(...results.map((result) => result.wilsonLowerBound)),
    maxSeatGap: Math.max(...results.map((result) => result.seatGap || 0)),
    results
  };
}

export async function collectParallelSelfPlay(options) {
  const workers = Math.max(1, Math.min(options.workers || 1, options.games));
  if (workers === 1) return collectSequential(options);
  const serializedModel = serializeNeuralModel(options.model);
  const serializedLeague = (options.league || []).map(serializeNeuralModel);
  const assignments = Array.from({ length: workers }, (_, index) => Math.floor(options.games / workers) + (index < options.games % workers ? 1 : 0));
  const results = await Promise.all(assignments.filter(Boolean).map((games, index) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../../scripts/ai-selfplay-worker.mjs", import.meta.url), {
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
      workerData: {
        games,
        workerIndex: index,
        seed: (options.seed || Date.now()) + index * 100003,
        maxActions: options.maxActions || 600,
        temperature: options.temperature || 0.8,
        model: serializedModel,
        league: serializedLeague,
        meta: options.meta || null,
        matchFraction: options.matchFraction ?? 0.25,
        shapingWeight: options.shapingWeight || 0,
        deckIds: options.decks.map((deck) => deck.id)
      }
    });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`Self-play worker exited with code ${code}`)); });
  })));
  return {
    trajectories: results.flatMap((result) => result.trajectories),
    summaries: results.flatMap((result) => result.summaries),
    deckLearning: mergeLearningSnapshots(results.map((result) => result.deckLearning))
  };
}

export function collectSequential(options) {
  const trajectories = [];
  const summaries = [];
  const learningModel = { deckStats: {}, cardStats: {}, matchupStats: {}, metaStats: { games: 0, cardAppearances: {} }, archetypeStats: {} };
  const random = seededRandom(options.seed || Date.now());
  for (let index = 0; index < options.games; index += 1) {
    const decks = pickDeckPair(options.decks, random, options.meta);
    const league = options.league || [];
    const opponent = league.length ? league[Math.floor(random() * league.length)] : options.model;
    const trainedSeat = league.length ? index % 2 : null;
    const models = trainedSeat == null ? [options.model, options.model] : trainedSeat === 0 ? [options.model, opponent] : [opponent, options.model];
    const playMatch = decks.every((deck) => deck.sideboard?.length) && random() < (options.matchFraction ?? 0.25);
    const result = (playMatch ? playNeuralBestOfThree : playNeuralSelfPlayGame)({
      ...options,
      decks,
      models,
      trainableSeats: trainedSeat == null ? [0, 1] : [trainedSeat],
      random,
      firstPlayerId: index % 2 ? "p2" : "p1"
    });
    trajectories.push(...result.trajectories);
    summaries.push(result.summary);
    recordSideboardLearning(learningModel, result.trajectories);
    if (result.summary.winnerId) updateDeckLearning(learningModel, decks, result.summary.winnerId, result.game.players);
  }
  return { trajectories, summaries, deckLearning: learningModel };
}

function sideboardStep(decision, game, playerId) {
  return {
    action: structuredClone(decision.action),
    state: decision.stateEncoding,
    actions: decision.actionEncoding,
    selectedIndex: decision.selectedIndex,
    legalCount: decision.legalCount,
    oldLogProbability: decision.logProbability,
    value: decision.value,
    beliefTarget: encodeOpponentDeckTarget(game, playerId),
    initialMemory: decision.initialMemory,
    decisionType: "sideboard"
  };
}

function recordSideboardLearning(model, trajectories) {
  model.sideboardStats ||= {};
  for (const trajectory of trajectories) {
    for (const step of trajectory.steps.filter((item) => item.decisionType === "sideboard" && item.action?.kind === "sideboardSwap")) {
      const reward = trajectory.steps.at(-1)?.return || 0;
      for (const [cardNumber, direction] of [[step.action.inCardNumber, 1], [step.action.outCardNumber, -1]]) {
        const stat = model.sideboardStats[cardNumber] ||= { games: 0, returnSum: 0 };
        stat.games += 1;
        stat.returnSum += reward * direction;
      }
    }
  }
}

function sideboardPrior(knowledge, cardNumber) {
  const sideboard = knowledge?.sideboardStats?.[cardNumber];
  const meta = knowledge?.externalMeta?.cardStats?.[cardNumber];
  return (sideboard?.games ? sideboard.returnSum / sideboard.games : 0) + (meta?.winRate || 0) * (meta?.inclusionRate || 0);
}

function metaWeightedCards(knowledge) {
  const profiles = Object.values(knowledge?.deckProfiles || {});
  const weights = knowledge?.externalMeta?.deckWeights || {};
  const cards = [];
  for (const profile of profiles) {
    const weight = weights[profile.id] || 1;
    for (const [cardNumber, count] of Object.entries(profile.cardCounts || {})) {
      for (let index = 0; index < Math.min(3, Math.ceil(count * weight)); index += 1) cards.push({ cardNumber });
    }
  }
  return cards;
}

export function hydrateWorkerModel(checkpoint) {
  return deserializeNeuralModel(checkpoint);
}

export function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function applyGeneralizedAdvantageEstimation(steps, terminalReward, gamma, lambda, shapingWeight = 0) {
  let gae = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const terminal = index === steps.length - 1;
    const reward = (terminal ? terminalReward : 0) + (steps[index].shapedReward || 0) * shapingWeight;
    const nextValue = terminal ? 0 : steps[index + 1].value;
    const delta = reward + gamma * nextValue - steps[index].value;
    gae = delta + gamma * lambda * (terminal ? 0 : gae);
    steps[index].advantage = gae;
    steps[index].return = gae + steps[index].value;
  }
}

function shapingPotential(game, viewerId) {
  const self = game.players.find((player) => player.id === viewerId);
  const opponent = game.players.find((player) => player.id !== viewerId);
  if (!self || !opponent) return 0;
  const boardMight = (playerId) => game.battlefields.flatMap((field) => field.units)
    .filter((unit) => unit.controllerId === playerId)
    .reduce((sum, unit) => sum + Math.max(0, (unit.might || 0) - (unit.damage || 0)), 0);
  const score = ((self.score || 0) - (opponent.score || 0)) / Math.max(1, game.victoryScore || 8);
  const board = (boardMight(self.id) - boardMight(opponent.id)) / 40;
  const resources = ((self.hand?.length || 0) - (opponent.hand?.length || 0)) / 20;
  return Math.tanh(score * 1.5 + board * 0.35 + resources * 0.1);
}

function terminalRewards(game) {
  if (game.phase === "complete" && game.winnerId) return Object.fromEntries(game.players.map((player) => [player.id, player.id === game.winnerId ? 1 : -1]));
  const [first, second] = game.players;
  const partial = Math.tanh(((first.score || 0) - (second.score || 0)) / Math.max(1, game.victoryScore));
  return { [first.id]: partial, [second.id]: -partial };
}

function pickDeckPair(decks, random, meta = null) {
  const first = weightedDeckPick(decks, random, meta);
  let second = weightedDeckPick(decks, random, meta);
  if (decks.length > 1 && second === first) second = decks[(decks.indexOf(first) + 1) % decks.length];
  return [first, second];
}

function weightedDeckPick(decks, random, meta) {
  const weights = decks.map((deck) => {
    const exact = meta?.externalMeta?.deckWeights?.[deck.id] ?? meta?.deckWeights?.[deck.id];
    if (exact != null) return Math.max(0.0001, exact);
    const legendNumber = deck.legend?.cardNumber;
    const externalDecks = meta?.externalMeta?.decks || meta?.decks || [];
    const legendWeight = externalDecks.filter((item) => item.legendCardNumber === legendNumber)
      .reduce((sum, item) => sum + (item.share || 0), 0);
    return Math.max(0.0001, legendWeight || 1);
  });
  let roll = random() * weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < decks.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return decks[index];
  }
  return decks.at(-1);
}

function mergeLearningSnapshots(snapshots) {
  const output = { deckStats: {}, cardStats: {}, matchupStats: {}, metaStats: { games: 0, cardAppearances: {} }, archetypeStats: {} };
  for (const snapshot of snapshots) mergeObjects(output, snapshot);
  return output;
}

function mergeObjects(target, source, path = []) {
  for (const [key, value] of Object.entries(source || {})) {
    if (path[0] === "deckProfiles") {
      if (target[key] == null) target[key] = structuredClone(value);
      continue;
    }
    if (typeof value === "number") target[key] = (target[key] || 0) + value;
    else if (value && typeof value === "object") mergeObjects(target[key] ||= {}, value, [...path, key]);
    else if (target[key] == null) target[key] = value;
  }
  return target;
}

function wilsonLower(wins, games, z = 1.645) {
  if (!games) return 0;
  const proportion = wins / games;
  const denominator = 1 + z * z / games;
  const center = proportion + z * z / (2 * games);
  const margin = z * Math.sqrt((proportion * (1 - proportion) + z * z / (4 * games)) / games);
  return (center - margin) / denominator;
}
