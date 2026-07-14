import { actionKey } from "./actions.mjs";
import { observeGame, stateFeatures } from "./observation.mjs";
import { publicOpponentPlan } from "./belief.mjs";

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
  const features = stateFeatures(observeGame(game, viewerId));
  return Math.tanh(dot(model.valueWeights, features));
}

export function actionFeatures(game, actorId, action) {
  const observation = observeGame(game, actorId);
  const player = game.players.find((candidate) => candidate.id === actorId);
  const opponent = game.players.find((candidate) => candidate.id !== actorId);
  const cardId = action.cardId || action.unitId || action.unitIds?.[0];
  const card = findVisibleCard(game, cardId);
  const destination = game.battlefields.find((field) => field.instanceId === (action.destination || action.destinationId));
  const payment = game.pendingPayment;
  const mulliganSelected = new Set(game.mulligan?.selectedCardIds || []);
  const paymentEnergySelected = new Set(payment?.energyRuneIds || []);
  const paymentPowerSelected = new Set(payment?.powerRuneIds || []);
  const selectedEnergy = (payment?.energyRuneIds?.length || 0) + (payment?.poolEnergyIds?.length || 0);
  const energyCost = payment?.energyCost || 0;
  const selectedPower = payment?.powerRuneIds?.length || 0;
  const powerCost = (payment?.powerCost || []).reduce((sum, item) => sum + (item.amount || 0), 0);
  return {
    [`kind:${action.kind}`]: 1,
    [`phase:${game.phase}`]: 1,
    [`kindPhase:${action.kind}:${game.phase}`]: 1,
    ...(opponent?.legend?.cardNumber ? { [`versusLegend:${opponent.legend.cardNumber}:${action.kind}`]: 1 } : {}),
    ...(card?.type ? { [`cardType:${card.type}:${action.kind}`]: 1 } : {}),
    ...(card?.tags || []).reduce((output, tag) => ({ ...output, [`tag:${tag}:${action.kind}`]: 1 }), {}),
    ...(card?.keywords || []).reduce((output, keyword) => ({ ...output, [`keyword:${keyword}:${action.kind}`]: 1 }), {}),
    ...(destination ? { [`destinationControl:${destination.controlledBy === actorId ? "friendly" : destination.controlledBy ? "enemy" : "open"}`]: 1 } : {}),
    cardEnergy: (card?.energy || 0) / 10,
    cardMight: (card?.might || 0) / 10,
    scoreLead: ((observation?.self.score || 0) - (observation?.opponent.score || 0)) / 8,
    readyRunes: (player?.runes.filter((rune) => !rune.exhausted).length || 0) / 12,
    paymentEnergyProgress: energyCost ? selectedEnergy / energyCost : 0,
    paymentPowerProgress: powerCost ? selectedPower / powerCost : 0,
    confirmReady: action.kind === "confirmPayment" && selectedEnergy >= energyCost && selectedPower >= powerCost ? 1 : 0,
    toggleRemovesSelection: action.kind === "togglePaymentRune" && (paymentEnergySelected.has(action.runeId) || paymentPowerSelected.has(action.runeId)) ? 1 : 0,
    mulliganRemovesSelection: action.kind === "toggleMulliganCard" && mulliganSelected.has(action.cardId) ? 1 : 0,
    mulliganCardEnergy: action.kind === "toggleMulliganCard" ? (card?.energy || 0) / 10 : 0,
    passWithChain: action.kind === "passShowdown" && ((game.showdown?.chain?.length || 0) + (game.actionChain?.chain?.length || 0)) > 0 ? 1 : 0
  };
}

export function scoreActions(game, actorId, actions, model = DEFAULT_AI_MODEL) {
  const plan = determineStrategicPlan(game, actorId, model);
  return actions.map((action) => {
    const features = actionFeatures(game, actorId, action);
    features[`plan:${plan.kind}:${action.kind}`] = 1;
    let score = dot(model.policyWeights, features) + bootstrapActionScore(game, actorId, action, features) + planActionBias(plan, action, features);
    if (!Number.isFinite(score)) score = 0;
    return { action, key: actionKey(action), score, features };
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
  if (options.greedy) return ranked[0];
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
  if (action.kind === "cancelPayment") score -= 2;
  if (action.kind === "togglePaymentRune") score += 1.2 - features.paymentEnergyProgress * 0.25 - features.paymentPowerProgress * 0.25;
  if (features.toggleRemovesSelection) score -= 4;
  if (action.kind === "togglePaymentPoolEnergy") score += 1.5;
  if (action.kind === "skipMulligan") score += 0.15;
  if (action.kind === "confirmMulligan") score += 0.4;
  if (action.kind === "toggleMulliganCard") score += features.mulliganRemovesSelection ? -4 : Math.max(0, features.mulliganCardEnergy - 0.18);
  if (action.kind === "beginPlayCard") score += 0.4 + features.cardMight * 0.3;
  if (action.kind === "moveUnit" || action.kind === "moveUnits") score += action.destinationId === "base" ? -0.15 : 0.35;
  if (action.kind === "endTurn") score -= game.turnNumber < 2 ? 0.1 : 0;
  if (action.kind === "passShowdown") score += 0.1;
  if (action.kind === "declineEffectChoice") score -= 0.15;
  if (action.kind === "chooseEffectOption") score += 0.1;
  if (game.currentPlayerId !== actorId && action.kind === "endTurn") score -= 5;
  return score;
}

function planActionBias(plan, action, features) {
  if (plan.kind === "pressure") {
    if (["moveUnit", "moveUnits", "beginPlayCard", "beginPlayChampion"].includes(action.kind)) return 0.22 + features.cardMight * 0.2;
    if (action.kind === "endTurn") return -0.18;
  }
  if (plan.kind === "stabilize" || plan.kind === "protectLead") {
    if (action.kind === "passShowdown") return 0.12;
    if (action.kind === "beginPlayCard" && features.cardEnergy > 0.55) return -0.16;
    if (action.kind === "moveUnit" && action.destinationId === "base") return 0.08;
  }
  if (plan.kind === "probe") {
    if (action.kind === "beginPlayCard" && features.cardEnergy <= 0.3) return 0.18;
    if (action.kind === "beginPlayCard" && features.cardEnergy >= 0.6) return -0.2;
  }
  return 0;
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

function findVisibleCard(game, cardId) {
  if (!cardId) return null;
  for (const player of game.players) {
    const found = [player.legend, player.champion, ...player.hand, ...player.base, ...player.trash, ...(player.banished || [])]
      .filter(Boolean).find((card) => card.instanceId === cardId);
    if (found) return found;
  }
  for (const field of game.battlefields) {
    const found = [...field.units, ...(field.hidden || []).map((item) => item.card)].find((card) => card?.instanceId === cardId);
    if (found) return found;
  }
  return null;
}
