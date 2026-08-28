import { resourceReservationBoardSnapshot } from "./resource-reservation.mjs";

const PLAY_FROM_HAND_ACTIONS = new Set(["beginPlayCard"]);
const TERMINAL_PASS_ACTIONS = new Set(["endTurn", "passShowdown"]);
const STALE_PLAYABLE_TURNS = 3;

export function createHandOpportunityTracker(playerId) {
  return {
    version: 1,
    playerId,
    active: new Map(),
    outcomes: []
  };
}

export function observeHandOpportunityWindow(tracker, game, legalActions, actionCount = 0) {
  if (!tracker || !game) return [];
  const completed = resolveMissingHandCards(tracker, game, actionCount);
  const player = game.players?.find((candidate) => candidate.id === tracker.playerId);
  if (!player) return completed;
  const turnSequence = Number(game.turnSequence || game.turnNumber || 0);
  const playableIds = new Set((legalActions || [])
    .filter((action) => PLAY_FROM_HAND_ACTIONS.has(action?.kind) && action.cardId)
    .map((action) => action.cardId));

  for (const card of player.hand || []) {
    const id = handCardId(card);
    if (!id) continue;
    let entry = tracker.active.get(id);
    if (!entry) {
      entry = createHandEntry(card, game, tracker.playerId, actionCount);
      tracker.active.set(id, entry);
    }
    addUnique(entry.observedTurnSequences, turnSequence);
    entry.lastSeenActionCount = actionCount;
    entry.lastSeenTurnSequence = turnSequence;
    entry.playableThisDecision = playableIds.has(id);
    if (!entry.playableThisDecision) continue;
    entry.playableOpportunityCount += 1;
    addUnique(entry.playableTurnSequences, turnSequence);
    if (!entry.firstOpportunityBoard) {
      entry.firstOpportunityActionCount = actionCount;
      entry.firstOpportunityBoard = resourceReservationBoardSnapshot(game, tracker.playerId);
    }
  }
  publishHandOpportunityContext(tracker, game);
  return completed;
}

export function recordHandOpportunityDecision(tracker, game, selectedAction, actionCount = 0, recordedStep = null) {
  if (!tracker || !game || !selectedAction) return tracker;
  const selectedCardId = PLAY_FROM_HAND_ACTIONS.has(selectedAction.kind) ? selectedAction.cardId || null : null;
  const terminalPass = TERMINAL_PASS_ACTIONS.has(selectedAction.kind);
  for (const entry of tracker.active.values()) {
    if (!entry.playableThisDecision) continue;
    if (selectedCardId && selectedCardId === entry.instanceId) {
      entry.selectedForPlay = true;
      entry.selectedForPlayActionCount = actionCount;
      entry.selectedForPlayTurnSequence = Number(game.turnSequence || game.turnNumber || 0);
      // If the card was already deferred, credit the eventual regret to the
      // last decision to keep holding it rather than to the later play itself.
      if (!entry.creditStep) {
        entry.creditActionCount = actionCount;
        entry.creditStep = recordedStep;
      }
      continue;
    }
    entry.deferredOpportunityCount += 1;
    entry.creditActionCount = actionCount;
    entry.creditStep = recordedStep;
    if (terminalPass) {
      entry.terminalPassCount += 1;
      entry.lastTerminalPassActionCount = actionCount;
    }
  }
  publishHandOpportunityContext(tracker, game);
  return tracker;
}

export function resolveHandOpportunityCards(tracker, game, actionCount = 0) {
  if (!tracker || !game) return [];
  const completed = resolveMissingHandCards(tracker, game, actionCount);
  publishHandOpportunityContext(tracker, game);
  return completed;
}

export function completeHandOpportunityTracking(tracker, game, actionCount = 0, reason = "game-ended") {
  if (!tracker || !game) return [];
  resolveMissingHandCards(tracker, game, actionCount);
  for (const entry of [...tracker.active.values()]) {
    completeEntry(tracker, entry, game, actionCount, reason, false);
  }
  publishHandOpportunityContext(tracker, game);
  return tracker.outcomes;
}

export function compactHandOpportunityOutcome(outcome) {
  return {
    id: outcome.id,
    cardNumber: outcome.cardNumber,
    cardName: outcome.cardName,
    reason: outcome.reason,
    used: outcome.used,
    heldTurnCount: outcome.heldTurnCount,
    playableTurnCount: outcome.playableTurnCount,
    playableOpportunityCount: outcome.playableOpportunityCount,
    deferredOpportunityCount: outcome.deferredOpportunityCount,
    terminalPassCount: outcome.terminalPassCount,
    firstOpportunityActionCount: outcome.firstOpportunityActionCount,
    creditActionCount: outcome.creditActionCount,
    boardBefore: outcome.boardBefore ? boardDigest(outcome.boardBefore) : null,
    boardAfter: boardDigest(outcome.boardAfter),
    result: outcome.result
  };
}

function resolveMissingHandCards(tracker, game, actionCount) {
  const player = game.players?.find((candidate) => candidate.id === tracker.playerId);
  if (!player) return [];
  const handIds = new Set((player.hand || []).map(handCardId).filter(Boolean));
  const completed = [];
  for (const entry of [...tracker.active.values()]) {
    if (handIds.has(entry.instanceId)) continue;
    completed.push(completeEntry(tracker, entry, game, actionCount,
      entry.selectedForPlay ? "used" : "left-hand", entry.selectedForPlay));
  }
  return completed;
}

function completeEntry(tracker, entry, game, actionCount, reason, used) {
  const boardAfter = resourceReservationBoardSnapshot(game, tracker.playerId);
  const boardBefore = entry.firstOpportunityBoard || entry.firstSeenBoard;
  const selfScoreGain = boardAfter.selfScore - boardBefore.selfScore;
  const opponentScoreGain = boardAfter.opponentScore - boardBefore.opponentScore;
  const scoreSwing = selfScoreGain - opponentScoreGain;
  const controlSwing = boardAfter.controlLead - boardBefore.controlLead;
  const boardMightSwing = boardAfter.boardMightLead - boardBefore.boardMightLead;
  const rawBoardOutcome = scoreSwing / Math.max(2, boardBefore.victoryScore / 2)
    + controlSwing * 0.12
    + boardMightSwing / 80;
  const heldTurnCount = entry.observedTurnSequences.length;
  const playableTurnCount = entry.playableTurnSequences.length;
  const stale = playableTurnCount >= STALE_PLAYABLE_TURNS || entry.terminalPassCount >= STALE_PLAYABLE_TURNS;
  const unplayableDormancy = heldTurnCount >= 4 && playableTurnCount === 0;
  const wonGame = game.phase === "complete" ? game.winnerId === tracker.playerId : null;
  const laterPayoff = used && rawBoardOutcome > 0.05;
  const stalePressure = Math.max(0, playableTurnCount - 2) * 0.04
    + Math.max(0, entry.terminalPassCount - 1) * 0.03
    + Math.min(0.08, entry.deferredOpportunityCount * 0.005);
  const outcomePressure = Math.max(0, -rawBoardOutcome) * 0.3 + (wonGame === false ? 0.1 : 0);
  const attributionConfidence = used ? 0.45 : stale ? 0.75 : 0.3;
  const reservationRegret = laterPayoff || !stale
    ? 0
    : clamp((stalePressure + outcomePressure) * attributionConfidence, 0, 0.5);
  const outcome = {
    version: 1,
    id: entry.id,
    playerId: tracker.playerId,
    instanceId: entry.instanceId,
    cardNumber: entry.cardNumber,
    cardName: entry.cardName,
    reason,
    used,
    createdActionCount: entry.createdActionCount,
    resolvedActionCount: actionCount,
    firstOpportunityActionCount: entry.firstOpportunityActionCount,
    creditActionCount: entry.creditActionCount,
    heldTurnCount,
    playableTurnCount,
    playableOpportunityCount: entry.playableOpportunityCount,
    deferredOpportunityCount: entry.deferredOpportunityCount,
    terminalPassCount: entry.terminalPassCount,
    boardBefore,
    boardAfter,
    result: {
      selfScoreGain,
      opponentScoreGain,
      scoreSwing,
      controlSwing,
      boardMightSwing,
      wonGame,
      stale,
      unplayableDormancy,
      laterPayoff,
      rawBoardOutcome,
      attributionConfidence,
      reservationRegret,
      harmful: reservationRegret >= 0.1,
      beneficial: laterPayoff
    }
  };
  if (entry.creditStep) {
    const diagnosticReward = outcome.result.beneficial
      ? Math.min(0.25, Math.max(0, outcome.result.rawBoardOutcome) * outcome.result.attributionConfidence)
      : -Math.min(0.25, Math.max(0, outcome.result.reservationRegret));
    outcome.result.learningReward = diagnosticReward;
    entry.creditStep.handOpportunityOutcomes ||= [];
    entry.creditStep.handOpportunityOutcomes.push(compactHandOpportunityOutcome(outcome));
    entry.creditStep.handOpportunityDiagnosticReward = (entry.creditStep.handOpportunityDiagnosticReward || 0)
      + diagnosticReward;
    if (outcome.result.harmful && !entry.creditStep.turningPoint) entry.creditStep.turningPoint = "stale-hand";
  }
  tracker.active.delete(entry.instanceId);
  tracker.outcomes.push(outcome);
  return outcome;
}

function createHandEntry(card, game, playerId, actionCount) {
  const instanceId = handCardId(card);
  return {
    id: `${playerId}:${instanceId}:${game.turnSequence || game.turnNumber || 0}:${actionCount}`,
    instanceId,
    cardNumber: card.cardNumber || null,
    cardName: card.name || null,
    createdActionCount: actionCount,
    firstSeenBoard: resourceReservationBoardSnapshot(game, playerId),
    firstOpportunityBoard: null,
    firstOpportunityActionCount: null,
    observedTurnSequences: [],
    playableTurnSequences: [],
    playableOpportunityCount: 0,
    deferredOpportunityCount: 0,
    terminalPassCount: 0,
    lastTerminalPassActionCount: null,
    selectedForPlay: false,
    selectedForPlayActionCount: null,
    selectedForPlayTurnSequence: null,
    creditActionCount: null,
    creditStep: null,
    playableThisDecision: false
  };
}

function publishHandOpportunityContext(tracker, game) {
  game.aiHandOpportunityContext ||= {};
  const cards = {};
  for (const entry of tracker.active.values()) {
    cards[entry.instanceId] = {
      cardNumber: entry.cardNumber,
      heldTurnCount: entry.observedTurnSequences.length,
      playableTurnCount: entry.playableTurnSequences.length,
      playableOpportunityCount: entry.playableOpportunityCount,
      deferredOpportunityCount: entry.deferredOpportunityCount,
      terminalPassCount: entry.terminalPassCount
    };
  }
  game.aiHandOpportunityContext[tracker.playerId] = { version: 1, cards };
}

function handCardId(card) {
  return card?.instanceId || null;
}

function addUnique(values, value) {
  if (!values.includes(value)) values.push(value);
}

function boardDigest(board) {
  return {
    turnNumber: board.turnNumber,
    turnSequence: board.turnSequence,
    score: `${board.selfScore}:${board.opponentScore}`,
    controlLead: board.controlLead,
    boardMightLead: board.boardMightLead,
    selfHandSize: board.selfHandSize,
    opponentHandSize: board.opponentHandSize,
    selfResources: board.selfResources
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}
