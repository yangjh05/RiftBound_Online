import { cards } from "../cards.mjs";
import { activeActorId, applyAiAction, cloneGame, enumerateLegalActions } from "./actions.mjs";
import { inferOpponentDeckBelief } from "./belief.mjs";
import { choosePolicyAction, evaluateState } from "./policy.mjs";
import { createNeuralSession, estimateNeuralValue } from "./neural/model.mjs";
import { calibratedProbability } from "./neural/trainer.mjs";

const CARD_BY_NUMBER = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));

export function rolloutAlternatives(game, viewerId, actions, model, options = {}) {
  const simulations = Math.max(1, options.simulations || 16);
  const depth = Math.max(1, options.depth || 48);
  const random = options.random || Math.random;
  const belief = inferOpponentDeckBelief(game, viewerId, model);
  return actions.map((action) => {
    const outcomes = [];
    for (let simulation = 0; simulation < simulations; simulation += 1) {
      const determinized = determinizeGame(game, viewerId, belief, random);
      if (!applyAiAction(determinized, action, viewerId)?.ok) { outcomes.push(0); continue; }
      outcomes.push(simulateContinuation(determinized, viewerId, model, depth, random, options.neuralModel));
    }
    const mean = average(outcomes);
    const variance = average(outcomes.map((value) => (value - mean) ** 2));
    const halfWidth = 1.96 * Math.sqrt(variance / Math.max(1, outcomes.length));
    return {
      action,
      expectedWinRate: mean,
      confidenceInterval: [Math.max(0, mean - halfWidth), Math.min(1, mean + halfWidth)],
      simulations,
      beliefConfidence: belief.confidence,
      opponentDeckPosterior: belief.posterior.slice(0, 3).map(({ deckId, name, probability }) => ({ deckId, name, probability }))
    };
  });
}

export function determinizeGame(game, viewerId, belief = inferOpponentDeckBelief(game, viewerId), random = Math.random) {
  const clone = cloneGame(game);
  const opponent = clone.players.find((player) => player.id !== viewerId);
  if (!opponent || !belief.posterior.length) return clone;
  const selected = weightedPick(belief.posterior, random);
  const remaining = [];
  const observed = new Map(Object.entries(belief.observedCards || {}));
  for (const [cardNumber, copies] of Object.entries(selected.profile.cardCounts || {})) {
    const count = Math.max(0, copies - (observed.get(cardNumber) || 0));
    for (let index = 0; index < count; index += 1) if (CARD_BY_NUMBER.has(cardNumber)) remaining.push(CARD_BY_NUMBER.get(cardNumber));
  }
  shuffle(remaining, random);
  const privateSlots = [
    ...opponent.hand.map((card, index) => ({ zone: opponent.hand, index, original: card })),
    ...opponent.mainDeck.map((card, index) => ({ zone: opponent.mainDeck, index, original: card })),
    ...clone.battlefields.flatMap((field) => (field.hidden || []).filter((item) => item.ownerId === opponent.id).map((item) => ({ hidden: item, original: item.card })))
  ];
  for (const slot of privateSlots) {
    const source = remaining.shift();
    if (!source) break;
    const replacement = instantiatePrivateCard(source, slot.original, opponent.id);
    if (slot.hidden) slot.hidden.card = replacement;
    else slot.zone[slot.index] = replacement;
  }
  return clone;
}

function simulateContinuation(game, viewerId, model, depth, random, neuralModel = null) {
  const neuralSession = neuralModel ? createNeuralSession(neuralModel) : null;
  for (let step = 0; step < depth && game.phase !== "complete"; step += 1) {
    const actorId = activeActorId(game);
    const legal = enumerateLegalActions(game, actorId);
    const selected = neuralSession
      ? neuralSession.decide(game, actorId, legal, { temperature: 0.35, random })
      : choosePolicyAction(game, actorId, legal, model, { temperature: 0.35, random });
    if (!selected || !applyAiAction(game, selected.action, actorId)?.ok) break;
  }
  if (game.phase === "complete") return game.winnerId === viewerId ? 1 : 0;
  if (neuralSession) {
    const value = estimateNeuralValue(neuralModel, game, viewerId);
    return calibratedProbability(value, neuralModel.calibration?.temperature || 1);
  }
  return (evaluateState(game, viewerId, model) + 1) / 2;
}

function instantiatePrivateCard(source, original, ownerId) {
  return {
    ...structuredClone(source),
    instanceId: original.instanceId,
    ownerId,
    controllerId: ownerId,
    zone: original.zone,
    damage: 0,
    buffs: 0,
    exhausted: Boolean(original.exhausted),
    attachments: []
  };
}

function weightedPick(items, random) { let roll = random(); for (const item of items) { roll -= item.probability; if (roll <= 0) return item; } return items.at(-1); }
function shuffle(items, random) { for (let index = items.length - 1; index > 0; index -= 1) { const target = Math.floor(random() * (index + 1)); [items[index], items[target]] = [items[target], items[index]]; } }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
