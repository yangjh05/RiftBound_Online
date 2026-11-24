import { analyzeDecision, analyzeDecisionWithRollouts, buildMatchReport } from "./coach.mjs";
import { actionFromCommand, isStrategicAction } from "./actions.mjs";
import { DEFAULT_AI_MODEL } from "./policy.mjs";
import { encodeHumanDecisionSample } from "./human-data.mjs";

const MAX_REPLAY_DECISION_STATES = 10;
const retainedDecisionStatesByReplay = new WeakMap();

export const REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES = Object.freeze({
  request: "analyze-replay-decision",
  result: "replay-decision-analyzed",
  error: "replay-decision-analysis-error"
});

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
    executedActions: [],
    winnerId: null,
    report: null
  };
}

export function recordReplayDecision(replay, gameBefore, actorId, command, result, model = DEFAULT_AI_MODEL, options = {}) {
  if (!replay || !result?.ok) return null;
  const payload = analyzeReplayDecisionPayload(gameBefore, actorId, command, model, options);
  return appendAnalyzedReplayDecision(replay, payload, gameBefore, options);
}

// Execution telemetry is separate from human coaching/training labels.
export function recordExecutedReplayAction(replay, before, actorId, command, result) {
  if (!replay || !result?.ok) return;
  const actions=replay.executedActions ||= [];
  if(actions.length>=20000){replay.droppedExecutedActions=(replay.droppedExecutedActions||0)+1;return;}
  actions.push({sequence:actions.length+1,actorId,ai:actorId===replay.aiPlayerId,
    turnNumber:before.turnNumber,phase:before.phase,command:structuredClone(command),
    ...(result.appliedActions?{appliedActions:structuredClone(result.appliedActions)}:{})});
}

// This payload deliberately excludes sequence and gameState. A Worker receives
// its own structured clone of gameBefore, while the main thread can retain and
// attach the original snapshot without cloning the full state back from the
// Worker a second time.
export function analyzeReplayDecisionPayload(gameBefore, actorId, command, model = DEFAULT_AI_MODEL, options = {}) {
  const action = actionFromCommand(command);
  if (!isStrategicAction(action)) return null;
  const analysis = analyzeDecision(gameBefore, actorId, action, model, options);
  return {
    actorId,
    command: options.cloneCommand === false ? command : structuredClone(command),
    turnNumber: gameBefore.turnNumber,
    phase: gameBefore.phase,
    analysis,
    trainingSample: encodeHumanDecisionSample(gameBefore, actorId, action, analysis)
  };
}

export function appendAnalyzedReplayDecision(replay, payload, gameBefore, options = {}) {
  if (!replay || !payload) return null;
  const decision = {
    sequence: replay.decisions.length + 1,
    actorId: payload.actorId,
    command: payload.command,
    turnNumber: payload.turnNumber,
    phase: payload.phase,
    gameState: options.keepState === false
      ? null
      : options.stateAlreadyCloned === true
        ? gameBefore
        : structuredClone(gameBefore),
    analysis: payload.analysis,
    trainingSample: payload.trainingSample
  };
  replay.decisions.push(decision);
  retainHighestRegretDecisionStates(replay, decision);
  return decision;
}

function retainHighestRegretDecisionStates(replay, appendedDecision) {
  if (!appendedDecision?.gameState) return;
  let retained = retainedDecisionStatesByReplay.get(replay);
  if (!retained) {
    retained = replay.decisions.filter((decision) => decision?.gameState && decision !== appendedDecision);
  }
  retained.push(appendedDecision);
  retained.sort((left, right) => (Number(right.analysis?.regret) || 0) - (Number(left.analysis?.regret) || 0));
  for (const discarded of retained.splice(MAX_REPLAY_DECISION_STATES)) discarded.gameState = null;
  retainedDecisionStatesByReplay.set(replay, retained);
}

export function createReplayAnalysisWorkerRequest({ requestId, gameBefore, actorId, command, model, options } = {}) {
  return {
    type: REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES.request,
    requestId,
    gameBefore,
    actorId,
    command,
    ...(model === undefined ? {} : { model }),
    ...(options === undefined ? {} : { options })
  };
}

export function handleReplayAnalysisWorkerRequest(message) {
  const requestId = validReplayWorkerRequestId(message?.requestId) ? message.requestId : null;
  try {
    validateReplayAnalysisWorkerRequest(message);
    const decision = analyzeReplayDecisionPayload(
      message.gameBefore,
      message.actorId,
      message.command,
      message.model || DEFAULT_AI_MODEL,
      { ...(message.options || {}), cloneCommand: false }
    );
    return {
      type: REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES.result,
      requestId: message.requestId,
      ok: true,
      decision
    };
  } catch (error) {
    return {
      type: REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES.error,
      requestId,
      ok: false,
      error: replayAnalysisWorkerError(error)
    };
  }
}

function validateReplayAnalysisWorkerRequest(message) {
  if (!message || typeof message !== "object") {
    throw replayWorkerRequestError("Replay analysis request must be an object.");
  }
  if (message.type !== REPLAY_ANALYSIS_WORKER_MESSAGE_TYPES.request) {
    throw replayWorkerRequestError(`Unsupported replay analysis message type: ${String(message.type || "")}.`, "UNSUPPORTED_MESSAGE");
  }
  if (!validReplayWorkerRequestId(message.requestId)) {
    throw replayWorkerRequestError("Replay analysis requestId must be a string or finite number.");
  }
  if (!message.gameBefore || typeof message.gameBefore !== "object") {
    throw replayWorkerRequestError("Replay analysis requires gameBefore.");
  }
  if (typeof message.actorId !== "string" || !message.actorId) {
    throw replayWorkerRequestError("Replay analysis requires actorId.");
  }
  if (!message.command || typeof message.command !== "object" || typeof message.command.kind !== "string") {
    throw replayWorkerRequestError("Replay analysis requires a command with a kind.");
  }
  if (message.model != null && typeof message.model !== "object") {
    throw replayWorkerRequestError("Replay analysis model must be an object.");
  }
  if (message.options != null && typeof message.options !== "object") {
    throw replayWorkerRequestError("Replay analysis options must be an object.");
  }
}

function validReplayWorkerRequestId(requestId) {
  return typeof requestId === "string"
    || (typeof requestId === "number" && Number.isFinite(requestId));
}

function replayWorkerRequestError(message, code = "INVALID_REQUEST") {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function replayAnalysisWorkerError(error) {
  return {
    code: error?.code || "REPLAY_ANALYSIS_FAILED",
    name: error?.name || "Error",
    message: error?.message || String(error)
  };
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
  const leanReplay = {};
  for (const key of Object.keys(replay)) {
    leanReplay[key] = key === "decisions"
      ? replay.decisions.map(decisionWithoutGameState)
      : replay[key];
  }
  return structuredClone(leanReplay);
}

function decisionWithoutGameState(decision) {
  const persisted = {};
  for (const key of Object.keys(decision)) {
    if (key !== "gameState") persisted[key] = decision[key];
  }
  return persisted;
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
