import { actionKey, planPaymentActions } from "./actions.mjs";
import { observeGame, stateFeatures } from "./observation.mjs";
import { publicOpponentPlan } from "./belief.mjs";
import { mulliganPlanProfile } from "./mulligan.mjs";
import { remainingDeckProfile } from "./deck-memory.mjs";
import { tacticalActionProfile } from "./action-tactics.mjs";

export const DEFAULT_AI_MODEL = {
  version: 1,
  generation: 0,
  gamesTrained: 0,
  policyWeights: {},
  valueWeights: {
    scoreDiff: 2.8,
    boardMightDiff: 0.55,
    baseMightDiff: 0.18,
    handDiff: 0.2,
    readyRuneDiff: 0.12,
    battlefieldControlDiff: 0.65,
    nearVictory: 0.3,
    nearDefeat: -0.3
  },
  metadata: { algorithm: "self-play-policy-gradient", promoted: false }
};

export function createModel(source = DEFAULT_AI_MODEL) {
  return structuredClone(source);
}

export function evaluateState(game, viewerId, model = DEFAULT_AI_MODEL) {
  if (game.phase === "complete") return game.winnerId === viewerId ? 1 : -1;
  const features = stateFeatures(observeGame(game, viewerId, {
    includeExtendedContext: false
  }));
  return Math.tanh(dot(model.valueWeights, features));
}

export function actionFeatures(game, actorId, action, preparedContext = null) {
  const context = preparedContext || createActionFeatureContext(game, actorId);
  const {
    observation,
    player,
    opponent,
    payment,
    mulliganSelected,
    paymentEnergySelected,
    paymentPowerSelected,
    paymentPoolSelected,
    paymentPoolPowerSelected,
    selectedEnergy,
    energyCost,
    selectedPower,
    powerCost,
    drawProfile
  } = context;
  const cardId = action.cardId || action.unitId || action.unitIds?.[0];
  const card = context.visibleCards.get(cardId)
    || (action.kind === "beginPlayChampion" ? player?.champion : null);
  const destination = context.battlefieldsById.get(
    action.destination || action.destinationId
  );
  const optionalPaymentEffect = (payment?.optionalPowerEffects || payment?.optionalEffects || []).find((effect) => effect.id === action.effectId);
  const abilityId = String(action.abilityId || "").split(":").at(-1) || "";
  const mulliganPlan = mulliganPlanProfile(game, actorId, action);
  const tactics = tacticalActionProfile(game, actorId, action);
  return {
    [`kind:${action.kind}`]: 1,
    [`phase:${game.phase}`]: 1,
    [`kindPhase:${action.kind}:${game.phase}`]: 1,
    ...(abilityId ? {
      [`ability:${abilityId}`]: 1,
      [`kindAbility:${action.kind}:${abilityId}`]: 1
    } : {}),
    ...(opponent?.legend?.cardNumber ? { [`versusLegend:${opponent.legend.cardNumber}:${action.kind}`]: 1 } : {}),
    ...(card?.type ? { [`cardType:${card.type}:${action.kind}`]: 1 } : {}),
    ...(card?.tags || []).reduce((output, tag) => ({ ...output, [`tag:${tag}:${action.kind}`]: 1 }), {}),
    ...(card?.keywords || []).reduce((output, keyword) => ({ ...output, [`keyword:${keyword}:${action.kind}`]: 1 }), {}),
    ...(action.kind === "submitMulligan" ? mulliganPlan.selectedCardNumbers.reduce((output, cardNumber) => ({
      ...output,
      [`mulliganCard:${cardNumber}`]: 1
    }), {
      [`mulliganCount:${mulliganPlan.selectedCount}`]: 1,
      [`mulliganPair:${mulliganPlan.selectedCardNumbers.join("|") || "keep"}`]: 1
    }) : {}),
    ...(observation.self.mulliganBottomCards || []).reduce((output, bottomedCard) => ({
      ...output,
      [`mulliganBottomCard:${bottomedCard.cardNumber}:${action.kind}`]: 1
    }), {}),
    ...drawProfile.topCards.slice(0, 8).reduce((output, drawCard) => ({
      ...output,
      [`nextDrawCard:${drawCard.cardNumber}:${action.kind}`]: drawCard.nextDrawProbability,
      [`withinThreeCard:${drawCard.cardNumber}:${action.kind}`]: drawCard.withinThreeProbability
    }), {}),
    ...(destination ? { [`destinationControl:${destination.controlledBy === actorId ? "friendly" : destination.controlledBy ? "enemy" : "open"}`]: 1 } : {}),
    cardEnergy: (card?.energy || 0) / 10,
    cardMight: (card?.might || 0) / 10,
    scoreLead: ((observation?.self.score || 0) - (observation?.opponent.score || 0)) / 8,
    readyRunes: (player?.runes.filter((rune) => !rune.exhausted).length || 0) / 12,
    paymentEnergyProgress: energyCost ? selectedEnergy / energyCost : 0,
    paymentPowerProgress: powerCost ? selectedPower / powerCost : 0,
    confirmReady: action.kind === "confirmPayment" ? 1 : 0,
    toggleRemovesSelection: action.kind === "togglePaymentRune" && (paymentEnergySelected.has(action.runeId) || paymentPowerSelected.has(action.runeId)) ? 1 : 0,
    togglePoolRemovesSelection: action.kind === "togglePaymentPoolEnergy" && paymentPoolSelected.has(action.energyId) ? 1 : 0,
    togglePoolPowerRemovesSelection: action.kind === "togglePaymentPoolPower" && paymentPoolPowerSelected.has(action.powerId) ? 1 : 0,
    toggleOptionalRemovesSelection: action.kind === "toggleOptionalPaymentEffect" && optionalPaymentEffect?.selected ? 1 : 0,
    mulliganRemovesSelection: action.kind === "toggleMulliganCard" && mulliganSelected.has(action.cardId) ? 1 : 0,
    mulliganCardEnergy: action.kind === "toggleMulliganCard" ? (card?.energy || 0) / 10 : 0,
    mulliganExpectedDelta: mulliganPlan.expectedDelta,
    mulliganSelectedCount: mulliganPlan.selectedCount / 2,
    mulliganSelectedHighCost: mulliganPlan.selectedHighCostRatio,
    mulliganSelectedEarly: mulliganPlan.selectedEarlyRatio,
    mulliganKeptEarly: Math.min(1, mulliganPlan.keptEarlyCards / 3),
    mulliganDuplicatePenalty: Math.min(1, mulliganPlan.keptDuplicatePenalty),
    mulliganBottomCount: Math.min(1, (observation.self.mulliganBottomCards?.length || 0) / 2),
    mulliganBottomCardsAhead: observation.self.mulliganBottomCardsAhead == null
      ? 0
      : Math.min(1, observation.self.mulliganBottomCardsAhead / 40),
    nextDrawExpectedEnergy: Math.min(1, drawProfile.expectedEnergy / 8),
    nextDrawEarlyProbability: drawProfile.earlyProbability,
    nextDrawHighCostProbability: drawProfile.highCostProbability,
    nextDrawUnitProbability: drawProfile.unitProbability,
    nextDrawReactionProbability: drawProfile.reactionProbability,
    nextDrawDevelopmentProbability: drawProfile.developmentProbability,
    knownBottomCardRatio: drawProfile.deckCount ? drawProfile.knownBottomCount / drawProfile.deckCount : 0,
    knownBottomBatchCount: Math.min(1, drawProfile.knownBottomBatchCount / 6),
    passWithChain: action.kind === "passShowdown" && ((game.showdown?.chain?.length || 0) + (game.actionChain?.chain?.length || 0)) > 0 ? 1 : 0,
    targetFriendly: tactics.targetRelation === "friendly" ? 1 : 0,
    targetEnemy: tactics.targetRelation === "enemy" ? 1 : 0,
    targetEffectAligned: tactics.targetAlignment > 0 ? 1 : 0,
    targetEffectMisaligned: tactics.targetAlignment < 0 ? 1 : 0,
    targetEffectImpact: tactics.targetImpact,
    casterSideBenefit: tactics.casterSideBenefit,
    drawUrgency: tactics.drawUrgency,
    savesFromLethal: tactics.savesFromLethal ? 1 : 0,
    hopelessReinforcement: tactics.hopelessReinforcement ? 1 : 0,
    projectedFieldAdvantage: tactics.projectedFieldAdvantage
  };
}

export function scoreActions(game, actorId, actions, model = DEFAULT_AI_MODEL) {
  const plannedPaymentKey = game.pendingPayment ? actionKey(planPaymentActions(game)?.[0]) : null;
  const mechanicalContext = createMechanicalActionContext(game);
  const policyWeights = model?.policyWeights || {};
  const usesLearnedFeatures = Object.values(policyWeights)
    .some((weight) => Number(weight) !== 0);
  let preparedContext = null;
  let plan = null;
  const fullFeatures = (action) => {
    preparedContext ||= createActionFeatureContext(game, actorId);
    plan ||= determineStrategicPlan(game, actorId, model);
    const features = actionFeatures(game, actorId, action, preparedContext);
    features[`plan:${plan.kind}:${action.kind}`] = 1;
    return features;
  };
  return actions.map((action) => {
    const features = usesLearnedFeatures
      ? fullFeatures(action)
      : mechanicalActionFeatures(action, mechanicalContext);
    // Strategic heuristics are features learned from outcomes, not fixed
    // additions to the selected action. Only mechanical completion/safety
    // rules remain in bootstrapActionScore.
    let score = (usesLearnedFeatures ? dot(policyWeights, features) : 0)
      + bootstrapActionScore(game, actorId, action, features);
    if (plannedPaymentKey && actionKey(action) === plannedPaymentKey) score += 12;
    if (game.pendingPayment && !plannedPaymentKey && action.kind === "cancelPayment") score += 12;
    if (!Number.isFinite(score)) score = 0;
    const result = { action, key: actionKey(action), score };
    if (usesLearnedFeatures) result.features = features;
    else defineLazyFeatures(result, () => fullFeatures(action));
    return result;
  }).sort((left, right) => right.score - left.score);
}

export function determineStrategicPlan(game, actorId, model = DEFAULT_AI_MODEL) {
  const plan = publicOpponentPlan(game, actorId, model);
  return { ...plan, confidence: plan.belief.confidence };
}

export function choosePolicyAction(game, actorId, actions, model = DEFAULT_AI_MODEL, options = {}) {
  const ranked = scoreActions(game, actorId, actions, model);
  if (!ranked.length) return null;
  const temperature = Math.max(0.03, options.temperature ?? 0.35);
  if (options.greedy) {
    // Preserve the historical decision-time feature snapshot for callers that
    // inspect the selected action after mutating the game. Empty-weight score
    // audits that never read features still keep the lazy fast path.
    void ranked[0].features;
    return ranked[0];
  }
  const probabilities = softmax(ranked.map((item) => item.score), temperature);
  let roll = (options.random || Math.random)();
  for (let index = 0; index < ranked.length; index += 1) {
    roll -= probabilities[index];
    if (roll <= 0) return { ...ranked[index], probability: probabilities[index] };
  }
  return { ...ranked.at(-1), probability: probabilities.at(-1) };
}

export function actionProbabilities(game, actorId, actions, model = DEFAULT_AI_MODEL, temperature = 0.7) {
  const ranked = scoreActions(game, actorId, actions, model);
  const probabilities = softmax(ranked.map((item) => item.score), temperature);
  return ranked.map((item, index) => ({ ...item, probability: probabilities[index] }));
}

function bootstrapActionScore(game, actorId, action, features) {
  let score = 0;
  if (action.kind === "confirmPayment") score += features.confirmReady ? 4 : -5;
  if (action.kind === "togglePaymentRune") score += 1.2 - features.paymentEnergyProgress * 0.25 - features.paymentPowerProgress * 0.25;
  if (features.toggleRemovesSelection) score -= 4;
  if (action.kind === "togglePaymentPoolEnergy") score += features.togglePoolRemovesSelection ? -4 : 1.5;
  if (action.kind === "togglePaymentPoolPower") score += features.togglePoolPowerRemovesSelection ? -4 : 1.5;
  if (action.kind === "toggleMulliganCard" && features.mulliganRemovesSelection) score -= 4;
  if (action.confirmTriggerOrder) score += 4;
  if (action.kind === "chooseEffectOption" && action.triggerOrderSelected) score -= 4;
  if (action.kind === "chooseEffectOption" && action.triggerOrderOptional && !action.triggerOrderSelected) score -= 0.1;
  if (game.currentPlayerId !== actorId && action.kind === "endTurn") score -= 5;
  return score;
}

function createActionFeatureContext(game, actorId) {
  const observation = observeGame(game, actorId, {
    includeExtendedContext: false
  });
  const player = game.players.find((candidate) => candidate.id === actorId);
  const opponent = game.players.find((candidate) => candidate.id !== actorId);
  const payment = game.pendingPayment;
  return {
    observation,
    player,
    opponent,
    payment,
    mulliganSelected: new Set(game.mulligan?.selectedCardIds || []),
    paymentEnergySelected: new Set(payment?.energyRuneIds || []),
    paymentPowerSelected: new Set(payment?.powerRuneIds || []),
    paymentPoolSelected: new Set(payment?.poolEnergyIds || []),
    paymentPoolPowerSelected: new Set(payment?.poolPowerIds || []),
    selectedEnergy: (payment?.energyRuneIds?.length || 0)
      + (payment?.poolEnergyIds?.length || 0),
    energyCost: payment?.energyCost || 0,
    selectedPower: (payment?.powerRuneIds?.length || 0)
      + (payment?.poolPowerIds?.length || 0),
    powerCost: (payment?.powerCost || [])
      .reduce((sum, item) => sum + (item.amount || 0), 0),
    drawProfile: remainingDeckProfile(game, actorId),
    visibleCards: visibleCardsById(game),
    battlefieldsById: new Map(
      game.battlefields.map((field) => [field.instanceId, field])
    )
  };
}

function createMechanicalActionContext(game) {
  const payment = game.pendingPayment;
  const powerCost = (payment?.powerCost || [])
    .reduce((sum, item) => sum + (item.amount || 0), 0);
  return {
    payment,
    powerCost,
    energySelected: new Set(payment?.energyRuneIds || []),
    powerSelected: new Set(payment?.powerRuneIds || []),
    poolEnergySelected: new Set(payment?.poolEnergyIds || []),
    poolPowerSelected: new Set(payment?.poolPowerIds || []),
    mulliganSelected: new Set(game.mulligan?.selectedCardIds || [])
  };
}

function mechanicalActionFeatures(action, context) {
  const {
    payment,
    powerCost,
    energySelected,
    powerSelected,
    poolEnergySelected,
    poolPowerSelected,
    mulliganSelected
  } = context;
  return {
    confirmReady: action.kind === "confirmPayment" ? 1 : 0,
    paymentEnergyProgress: payment?.energyCost
      ? ((payment.energyRuneIds?.length || 0)
        + (payment.poolEnergyIds?.length || 0)) / payment.energyCost
      : 0,
    paymentPowerProgress: powerCost
      ? ((payment?.powerRuneIds?.length || 0)
        + (payment.poolPowerIds?.length || 0))
        / powerCost
      : 0,
    toggleRemovesSelection: action.kind === "togglePaymentRune"
      && (energySelected.has(action.runeId) || powerSelected.has(action.runeId))
      ? 1 : 0,
    togglePoolRemovesSelection: action.kind === "togglePaymentPoolEnergy"
      && poolEnergySelected.has(action.energyId) ? 1 : 0,
    togglePoolPowerRemovesSelection: action.kind === "togglePaymentPoolPower"
      && poolPowerSelected.has(action.powerId) ? 1 : 0,
    mulliganRemovesSelection: action.kind === "toggleMulliganCard"
      && mulliganSelected.has(action.cardId) ? 1 : 0
  };
}

function defineLazyFeatures(result, createFeatures) {
  let cached = null;
  Object.defineProperty(result, "features", {
    enumerable: true,
    configurable: true,
    get() {
      cached ||= createFeatures();
      return cached;
    }
  });
}

function visibleCardsById(game) {
  const output = new Map();
  const add = (card) => {
    if (card?.instanceId) output.set(card.instanceId, card);
  };
  for (const player of game.players) {
    for (const card of [
      player.legend,
      player.champion,
      ...player.availableChampions,
      ...player.availableBattlefields,
      ...player.hand,
      ...player.base,
      ...player.runes,
      ...player.trash,
      ...(player.banished || [])
    ]) add(card);
  }
  for (const field of game.battlefields) {
    for (const card of field.units) add(card);
    for (const item of field.hidden || []) add(item.card);
  }
  return output;
}

function softmax(values, temperature) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp((value - max) / temperature));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

function dot(weights = {}, features = {}) {
  return Object.entries(features).reduce((sum, [key, value]) => sum + (weights[key] || 0) * value, 0);
}
