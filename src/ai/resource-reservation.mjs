import { isInherentReaction } from "../rules/keywords.mjs";
import { currentMight } from "../engine.mjs";
import { cardResourceAffordability, reactionReserveProfile, responseReserveCards } from "./resource-strategy.mjs";

const RESERVATION_ACTIONS = new Set(["endTurn", "passShowdown"]);
const MAX_RESERVATION_ACTIONS = 24;
const MAX_RESERVATION_TURN_SEQUENCES = 4;
const MAX_REPEATED_UNUSED_RESERVATIONS = 2;

export function createResourceReservationIntent(game, playerId, action, actionCount = 0, options = {}) {
  if (!RESERVATION_ACTIONS.has(action?.kind)) return null;
  const player = game?.players?.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  const resources = resourceSnapshot(game, playerId);
  if (resources.readyRunes + resources.generatedEnergy + resources.generatedPower + resources.readyResourceSources <= 0) return null;

  const candidates = reservationCandidates(game, playerId, action.kind);
  if (!candidates.length) return null;
  const target = candidates[0];
  return {
    version: 1,
    id: `${playerId}:${game.turnSequence || game.turnNumber || 0}:${actionCount}:${target.instanceId || target.cardNumber}`,
    playerId,
    actionKind: action.kind,
    createdActionCount: actionCount,
    createdTurnNumber: game.turnNumber || 0,
    createdTurnSequence: game.turnSequence || 0,
    inferredTarget: target,
    candidateCards: candidates.slice(0, 5),
    resourcesReserved: resources,
    boardBefore: resourceReservationBoardSnapshot(game, playerId),
    counterfactual: options.counterfactual ? structuredClone(options.counterfactual) : null,
    passesObserved: 1,
    resourceUses: [],
    targetUsed: false,
    targetUsedAtActionCount: null
  };
}

export function observeResourceReservationAction(reservation, game, action, actionCount = 0) {
  if (!reservation || reservation.playerId == null || !action) return reservation;
  if (RESERVATION_ACTIONS.has(action.kind)) {
    reservation.passesObserved += 1;
    return reservation;
  }
  const card = actionCard(game, reservation.playerId, action);
  if (!card) return reservation;
  const demand = actionResourceDemand(card, action);
  if (demand <= 0) return reservation;
  const intended = Boolean(reservation.inferredTarget?.instanceId
    ? card.instanceId === reservation.inferredTarget.instanceId
    : card.cardNumber === reservation.inferredTarget?.cardNumber);
  reservation.resourceUses.push({
    actionCount,
    actionKind: action.kind,
    cardNumber: card.cardNumber || null,
    cardName: card.name || null,
    instanceId: card.instanceId || null,
    energyDemand: demand,
    intended
  });
  if (intended && !reservation.targetUsed) {
    reservation.targetUsed = true;
    reservation.targetUsedAtActionCount = actionCount;
  }
  return reservation;
}

export function resourceReservationResolutionReason(reservation, game, actionCount = 0) {
  if (!reservation) return null;
  if (game?.phase === "complete") return "game-ended";
  if (reservation.targetUsed
    && actionCount - reservation.targetUsedAtActionCount >= 2
    && stableDecisionBoundary(game)) return "target-used";
  if (!reservation.targetUsed && !reservationTargetPresent(reservation, game)) return "target-lost";
  if (actionCount - reservation.createdActionCount >= MAX_RESERVATION_ACTIONS) return "action-window-expired";
  if ((game?.turnSequence || 0) - reservation.createdTurnSequence >= MAX_RESERVATION_TURN_SEQUENCES) return "turn-window-expired";
  return null;
}

export function completeResourceReservation(reservation, game, actionCount = 0, reason = "completed") {
  const boardAfter = resourceReservationBoardSnapshot(game, reservation.playerId);
  const before = reservation.boardBefore;
  const selfScoreGain = boardAfter.selfScore - before.selfScore;
  const opponentScoreGain = boardAfter.opponentScore - before.opponentScore;
  const scoreSwing = selfScoreGain - opponentScoreGain;
  const controlSwing = boardAfter.controlLead - before.controlLead;
  const mightSwing = boardAfter.boardMightLead - before.boardMightLead;
  const usedAlternative = reservation.resourceUses.some((use) => !use.intended);
  const rawReward = scoreSwing / Math.max(2, before.victoryScore / 2)
    + controlSwing * 0.12
    + mightSwing / 80;
  const attributionConfidence = reservation.targetUsed ? 0.85 : usedAlternative ? 0.55 : 0.35;
  const reservedResourceUnits = reservedResourceCount(reservation.resourcesReserved);
  // Passing while holding resources has a real opportunity cost when the
  // inferred target is never used and no measurable benefit follows. Without
  // this term, unrelated later board gains could teach the policy to reserve
  // indefinitely. Alternative resource use reduces the penalty because the
  // original intent may simply have named the wrong eventual card.
  const unusedOpportunityCost = !reservation.targetUsed && rawReward <= 0.03
    ? Math.min(0.12, 0.015
      + Math.min(0.06, Math.max(0, reservation.passesObserved - 1) * 0.005)
      + Math.min(0.04, reservedResourceUnits * 0.005)) * (usedAlternative ? 0.35 : 1)
    : 0;
  const learningReward = clamp(rawReward * attributionConfidence - unusedOpportunityCost, -0.5, 0.5);
  const outcome = {
    version: 1,
    id: reservation.id,
    reason,
    resolvedActionCount: actionCount,
    actionsElapsed: Math.max(0, actionCount - reservation.createdActionCount),
    turnsElapsed: Math.max(0, (game?.turnSequence || 0) - reservation.createdTurnSequence),
    inferredTarget: reservation.inferredTarget,
    candidateCards: reservation.candidateCards,
    targetUsed: reservation.targetUsed,
    targetUsedAfterActions: reservation.targetUsed
      ? Math.max(0, reservation.targetUsedAtActionCount - reservation.createdActionCount)
      : null,
    resourceUses: reservation.resourceUses,
    resourcesReserved: reservation.resourcesReserved,
    boardBefore: reservation.boardBefore,
    boardAfter,
    counterfactual: reservation.counterfactual || null,
    result: {
      selfScoreGain,
      opponentScoreGain,
      scoreSwing,
      controlSwing,
      boardMightSwing: mightSwing,
      wonGame: game?.phase === "complete" ? game.winnerId === reservation.playerId : null,
      beneficial: learningReward > 0.03,
      harmful: learningReward < -0.03,
      attributionConfidence,
      rawReward,
      usedAlternative,
      reservedResourceUnits,
      unusedOpportunityCost,
      learningReward
    }
  };
  recordReservationOutcome(game, outcome);
  return outcome;
}

export function resourceReservationBoardSnapshot(game, playerId) {
  const self = game?.players?.find((player) => player.id === playerId);
  const opponent = game?.players?.find((player) => player.id !== playerId);
  const battlefields = (game?.battlefields || []).map((field) => ({
    id: field.instanceId || field.id || field.cardNumber || null,
    cardNumber: field.cardNumber || null,
    name: field.name || null,
    controller: field.controlledBy === playerId ? "self" : field.controlledBy ? "opponent" : "none",
    units: (field.units || []).map((unit) => ({
      instanceId: unit.instanceId || null,
      cardNumber: unit.cardNumber || null,
      name: unit.name || null,
      controller: unit.controllerId === playerId ? "self" : "opponent",
      might: currentMight(game, unit),
      damage: Math.max(0, Number(unit.damage) || 0),
      exhausted: Boolean(unit.exhausted),
      buffs: Math.max(0, Number(unit.buffs) || 0)
    }))
  }));
  const friendlyUnits = battlefields.flatMap((field) => field.units).filter((unit) => unit.controller === "self");
  const enemyUnits = battlefields.flatMap((field) => field.units).filter((unit) => unit.controller === "opponent");
  const controlledSelf = battlefields.filter((field) => field.controller === "self").length;
  const controlledOpponent = battlefields.filter((field) => field.controller === "opponent").length;
  const friendlyMight = friendlyUnits.reduce((sum, unit) => sum + Math.max(0, unit.might - unit.damage), 0);
  const enemyMight = enemyUnits.reduce((sum, unit) => sum + Math.max(0, unit.might - unit.damage), 0);
  return {
    phase: game?.phase || null,
    turnNumber: game?.turnNumber || 0,
    turnSequence: game?.turnSequence || 0,
    currentPlayer: game?.currentPlayerId === playerId ? "self" : "opponent",
    turnPlayer: (game?.turnPlayerId || game?.currentPlayerId) === playerId ? "self" : "opponent",
    victoryScore: game?.victoryScore || 8,
    selfScore: self?.score || 0,
    opponentScore: opponent?.score || 0,
    scoreLead: (self?.score || 0) - (opponent?.score || 0),
    controlledSelf,
    controlledOpponent,
    controlLead: controlledSelf - controlledOpponent,
    friendlyBoardMight: friendlyMight,
    enemyBoardMight: enemyMight,
    boardMightLead: friendlyMight - enemyMight,
    selfBase: zoneSummary(self?.base, playerId),
    opponentBase: zoneSummary(opponent?.base, playerId),
    selfHandSize: self?.hand?.length || 0,
    opponentHandSize: opponent?.hand?.length || 0,
    selfDeckSize: self?.mainDeck?.length || 0,
    opponentDeckSize: opponent?.mainDeck?.length || 0,
    selfResources: resourceSnapshot(game, playerId),
    opponentPublicResources: opponent ? resourceSnapshot(game, opponent.id, false) : null,
    battlefields
  };
}

export function compactResourceReservationOutcome(outcome) {
  return {
    id: outcome.id,
    reason: outcome.reason,
    targetCardNumber: outcome.inferredTarget?.cardNumber || null,
    targetCardName: outcome.inferredTarget?.cardName || null,
    targetPurpose: outcome.inferredTarget?.purpose || null,
    targetUsed: outcome.targetUsed,
    targetUsedAfterActions: outcome.targetUsedAfterActions,
    actualResourceUses: outcome.resourceUses.map((use) => ({
      cardNumber: use.cardNumber,
      cardName: use.cardName,
      intended: use.intended,
      actionCount: use.actionCount
    })),
    counterfactual: outcome.counterfactual || null,
    boardBefore: boardDigest(outcome.boardBefore),
    boardAfter: boardDigest(outcome.boardAfter),
    result: outcome.result
  };
}

function reservationCandidates(game, playerId, actionKind) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const responses = responseReserveCards(game,playerId);
  const responseIds = new Set(responses.map(c=>c.instanceId));
  const cards = [...responses,...(player.hand||[]).filter(c=>!responseIds.has(c.instanceId)),
    player.champion?.zone === "played" ? null : player.champion].filter(Boolean);
  const threat = reactionReserveProfile(game, playerId).threat;
  const history = game.aiResourceReservationContext?.[playerId]?.cards || {};
  return cards.map((card) => {
    const affordability = cardResourceAffordability(game, playerId, card);
    const reaction = responseIds.has(card.instanceId);
    const shortfall = Math.max(0, affordability.energyCost - affordability.energyCapacity)
      + Math.max(0, affordability.powerCost - affordability.powerMatched);
    const cardKey = card.instanceId || card.cardNumber;
    const prior = history[cardKey] || history[card.cardNumber] || {};
    const reactionPurpose = reaction && affordability.payable
      && reactionReservationHasPurpose(game, playerId, card, threat, actionKind);
    const repeatedUnused = Math.max(0, Number(prior.unused) || 0);
    const eligible = actionKind === "passShowdown"
      ? reactionPurpose
      : reaction
        ? reactionPurpose && repeatedUnused < MAX_REPEATED_UNUSED_RESERVATIONS
        : shortfall <= 1;
    const purpose = reactionPurpose
      ? "reaction-window"
      : shortfall <= 1 ? "next-turn-play" : "future-curve";
    const priority = (reaction ? 2.5 + threat : 0)
      + (affordability.payable ? 0.8 : Math.max(0, 0.7 - shortfall * 0.15))
      + affordability.energyCost * 0.12
      + affordability.powerCost * 0.18
      + (card.type === "champion" || card.isChampion ? 0.25 : 0)
      - repeatedUnused * 1.25;
    return {
      instanceId: card.instanceId || null,
      cardNumber: card.cardNumber || null,
      cardName: card.name || null,
      cardType: card.type || null,
      reaction,
      purpose,
      energyCost: affordability.energyCost,
      powerCost: affordability.powerCost,
      requiredPowerDomains: affordability.requiredPowerDomains,
      payableNow: affordability.payable,
      currentCoverage: affordability.coverage,
      resourceShortfall: shortfall,
      reactionPurpose,
      repeatedUnused,
      eligible,
      priority
    };
  }).filter((candidate) => candidate.eligible && candidate.energyCost + candidate.powerCost > 0)
    .sort((left, right) => right.priority - left.priority
      || right.energyCost + right.powerCost - left.energyCost - left.powerCost
      || String(left.cardNumber).localeCompare(String(right.cardNumber)));
}

function reactionReservationHasPurpose(game, playerId, card, threat, actionKind) {
  const currentWindow = game.phase === "showdown" || Boolean(game.showdown || game.actionChain);
  if (actionKind === "passShowdown" && !currentWindow) return false;
  const friendlyUnits = (game.battlefields || []).flatMap((field) => (field.units || [])
    .filter((unit) => unit.controllerId === playerId));
  const enemyUnits = (game.battlefields || []).flatMap((field) => (field.units || [])
    .filter((unit) => unit.controllerId !== playerId));
  const effects = card.effects || [];
  const kinds = effects.map((effect) => String(effect?.kind || "").toLowerCase());
  const beneficial = kinds.some((kind) => /might|buff|heal|prevent|shield|barrier|ready|save/.test(kind));
  const harmful = kinds.some((kind) => /damage|kill|destroy|banish|stun|exhaust|return|recall|reduce/.test(kind));
  if (beneficial && friendlyUnits.length && (currentWindow || threat >= 0.3)) return true;
  if (harmful && enemyUnits.length && (currentWindow || threat >= 0.25)) return true;
  // Being one point from defeat is already enough reason to keep a generic
  // Reaction available: the opponent can create the relevant board threat
  // after we pass, so requiring a target to exist right now is too late.
  return currentWindow || threat >= 0.5;
}

function recordReservationOutcome(game, outcome) {
  if (!game || !outcome?.inferredTarget || !outcome.playerId && !outcome.id) return;
  const playerId = outcome.id?.split(":")[0];
  if (!playerId) return;
  const cardKey = outcome.inferredTarget.instanceId || outcome.inferredTarget.cardNumber;
  if (!cardKey) return;
  game.aiResourceReservationContext ||= {};
  const context = game.aiResourceReservationContext[playerId] ||= { cards: {} };
  const record = context.cards[cardKey] ||= { attempts: 0, used: 0, unused: 0, harmful: 0 };
  record.attempts += 1;
  if (outcome.targetUsed) {
    record.used += 1;
    record.unused = 0;
  } else {
    record.unused += 1;
  }
  if (outcome.result.harmful) record.harmful += 1;
  if (outcome.inferredTarget.cardNumber) context.cards[outcome.inferredTarget.cardNumber] = record;
}

function resourceSnapshot(game, playerId, includePrivatePool = true) {
  const player = game?.players?.find((candidate) => candidate.id === playerId);
  if (!player) return {
    readyRunes: 0, exhaustedRunes: 0, runeDomains: {}, generatedEnergy: 0,
    generatedPower: 0, generatedPowerDomains: {}, readyResourceSources: 0,
    affordableReactions: 0, reserveValue: 0, opponentThreat: 0
  };
  const reserve = reactionReserveProfile(game, playerId);
  return {
    readyRunes: player.runes?.filter((rune) => !rune.exhausted).length || 0,
    exhaustedRunes: player.runes?.filter((rune) => rune.exhausted).length || 0,
    runeDomains: countDomains(player.runes || []),
    generatedEnergy: includePrivatePool ? player.runePool?.energy?.length || 0 : 0,
    generatedPower: includePrivatePool ? player.runePool?.power?.length || 0 : 0,
    generatedPowerDomains: includePrivatePool ? countDomains(player.runePool?.power || []) : {},
    readyResourceSources: reserve.readyResourceSources,
    affordableReactions: includePrivatePool ? reserve.affordableReactions : 0,
    reserveValue: includePrivatePool ? reserve.reserveValue : 0,
    opponentThreat: reserve.threat
  };
}

function actionCard(game, playerId, action) {
  const player = game?.players?.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  const cardId = action.cardId || action.unitId || action.unitIds?.[0];
  if (action.kind === "beginPlayChampion") return player.champion || null;
  return ownCards(game, player).find((card) => card.instanceId === cardId) || null;
}

function actionResourceDemand(card, action) {
  if (!card) return 0;
  if (action.kind !== "activateCard") return Math.max(0, Number(card.energy) || 0)
    + (card.power || []).reduce((sum, requirement) => sum + Math.max(0, Number(requirement.amount) || 0), 0);
  const abilityId = String(action.abilityId || "").split(":").at(-1);
  const effects = (card.effects || []).filter((effect, index) => (effect.abilityId || `effect-${index}`) === abilityId);
  return effects.reduce((sum, effect) => sum
    + Math.max(0, Number(effect.energyCost) || 0)
    + (effect.powerCost || []).reduce((power, requirement) => power + Math.max(0, Number(requirement.amount) || 0), 0), 0);
}

function reservationTargetPresent(reservation, game) {
  const player = game?.players?.find((candidate) => candidate.id === reservation.playerId);
  if (!player) return false;
  const target = reservation.inferredTarget;
  return ownCards(game, player).some((card) => target.instanceId
    ? card.instanceId === target.instanceId
    : card.cardNumber === target.cardNumber);
}

function ownCards(game, player) {
  return [
    player.legend,
    player.champion,
    ...(player.hand || []),
    ...(player.base || []),
    ...(player.trash || []),
    ...(player.banished || []),
    ...(game?.battlefields || []).flatMap((field) => (field.units || []).filter((unit) => unit.controllerId === player.id))
  ].filter(Boolean);
}

function stableDecisionBoundary(game) {
  return !game?.pendingChoice && !game?.pendingPayment && !game?.actionChain && game?.phase !== "showdown";
}

function zoneSummary(cards = [], viewerId) {
  const units = (cards || []).filter((card) => card && (card.controllerId || card.ownerId) != null);
  const friendly = units.filter((card) => (card.controllerId || card.ownerId) === viewerId);
  return {
    count: units.length,
    friendlyCount: friendly.length,
    totalMight: units.reduce((sum, card) => sum + Math.max(0, effectiveMight(card) - (Number(card.damage) || 0)), 0)
  };
}

function effectiveMight(card) {
  return Math.max(0, Number(card?.might) || 0) + (Number(card?.mightModifier) || 0) + (Number(card?.buffs) || 0);
}

function countDomains(resources) {
  const counts = {};
  for (const resource of resources || []) {
    const domain = resource.domain || resource.color || "Any";
    counts[domain] = (counts[domain] || 0) + 1;
  }
  return counts;
}

function boardDigest(board) {
  return {
    turnNumber: board.turnNumber,
    turnSequence: board.turnSequence,
    score: `${board.selfScore}:${board.opponentScore}`,
    controlLead: board.controlLead,
    boardMightLead: board.boardMightLead,
    friendlyBoardMight: board.friendlyBoardMight,
    enemyBoardMight: board.enemyBoardMight,
    selfHandSize: board.selfHandSize,
    opponentHandSize: board.opponentHandSize,
    selfResources: board.selfResources,
    battlefields: board.battlefields
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function reservedResourceCount(resources = {}) {
  return (Number(resources.readyRunes) || 0)
    + (Number(resources.generatedEnergy) || 0)
    + (Number(resources.generatedPower) || 0)
    + (Number(resources.readyResourceSources) || 0);
}
