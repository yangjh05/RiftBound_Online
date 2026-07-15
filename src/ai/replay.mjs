import { analyzeDecision, analyzeDecisionWithRollouts, buildMatchReport } from "./coach.mjs";
import { actionFromCommand, isStrategicAction } from "./actions.mjs";
import { DEFAULT_AI_MODEL } from "./policy.mjs";
import { encodeHumanDecisionSample } from "./human-data.mjs";

export function createAiReplay(game, options = {}) {
  return {
    version: 1,
    id: `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    humanPlayerId: options.humanPlayerId || game.players[0]?.id,
    aiPlayerId: options.aiPlayerId || game.players[1]?.id,
    modelGeneration: options.model?.generation || 0,
    decks: game.players.map((player, index) => ({
      playerId: player.id,
      id: options.deckIds?.[index] || `seat-${index + 1}`,
      legend: compactCard(player.legend),
      main: player.mainDeck.map(compactCard),
      battlefields: player.availableBattlefields.map(compactCard)
    })),
    decisions: [],
    winnerId: null,
    report: null
  };
}

export function recordReplayDecision(replay, gameBefore, actorId, command, result, model = DEFAULT_AI_MODEL, options = {}) {
  if (!replay || !result?.ok) return null;
  const action = actionFromCommand(command);
  if (!isStrategicAction(action)) return null;
  const analysis = analyzeDecision(gameBefore, actorId, action, model, options);
  const decision = {
    sequence: replay.decisions.length + 1,
    actorId,
    command: structuredClone(command),
    turnNumber: gameBefore.turnNumber,
    phase: gameBefore.phase,
    gameState: options.keepState === false ? null : structuredClone(gameBefore),
    analysis,
    trainingSample: encodeHumanDecisionSample(gameBefore, actorId, action, analysis)
  };
  replay.decisions.push(decision);
  return decision;
}

export function finalizeAiReplay(replay, game, model = DEFAULT_AI_MODEL) {
  if (!replay) return null;
  replay.winnerId = game.winnerId || null;
  replay.completedAt = new Date().toISOString();
  replay.report = buildMatchReport(replay, model);
  return replay.report;
}

export function persistableAiReplay(replay) {
  if (!replay) return null;
  return {
    ...structuredClone(replay),
    decisions: replay.decisions.map(({ gameState, ...decision }) => decision)
  };
}

export async function refineAiReplay(replay, model = DEFAULT_AI_MODEL, options = {}) {
  if (!replay) return null;
  const candidates = replay.decisions.filter((decision) => decision.actorId === replay.humanPlayerId && decision.gameState)
    .sort((left, right) => (right.analysis?.regret || 0) - (left.analysis?.regret || 0))
    .slice(0, options.limit || 5);
  for (const decision of candidates) {
    decision.analysis = await analyzeDecisionWithRollouts(decision.gameState, decision.actorId, decision.command, model, {
      rollouts: options.rollouts || 8,
      rolloutDepth: options.rolloutDepth || 32,
      neuralModel: options.neuralModel
    });
    const action = actionFromCommand(decision.command);
    decision.trainingSample = encodeHumanDecisionSample(decision.gameState, decision.actorId, action, decision.analysis);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  replay.report = buildMatchReport(replay, model);
  replay.report.refined = true;
  replay.report.rolloutSettings = { decisions: candidates.length, rollouts: options.rollouts || 8, depth: options.rolloutDepth || 32 };
  return replay.report;
}

function compactCard(card) {
  if (!card) return null;
  return { id: card.id, name: card.name, cardNumber: card.cardNumber, type: card.type, energy: card.energy || 0, domains: [...(card.domains || [])], tags: [...(card.tags || [])], isChampion: Boolean(card.isChampion) };
}
