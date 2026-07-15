import { observeGame } from "../observation.mjs";
import { cards } from "../../cards.mjs";

export const CARD_VOCABULARY = Object.freeze([
  "<unknown>",
  ...Object.values(cards).map((card) => card.cardNumber).filter(Boolean).sort((left, right) => left.localeCompare(right))
]);
export const CARD_INDEX = new Map(CARD_VOCABULARY.map((cardNumber, index) => [cardNumber, index]));
export const CARD_VOCAB_SIZE = CARD_VOCABULARY.length;
const CARD_BY_NUMBER = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));
// Kept as a compatibility alias for archived trajectory readers. These are exact
// vocabulary slots, not hash bins.
export const CARD_BINS = CARD_VOCAB_SIZE;
export const STATE_SCALARS = 32;
export const STATE_DIM = STATE_SCALARS + CARD_BINS * 4;
export const ACTION_DIM = 128;
export const MAX_ACTIONS = 192;
export const MAX_SEQUENCE = 128;

const ACTION_KINDS = Object.freeze([
  "confirmFirstPlayer", "selectChampion", "selectBattlefield", "toggleMulliganCard",
  "confirmMulligan", "skipMulligan", "beginPlayCard", "beginPlayChampion", "hideCard",
  "moveUnit", "moveUnits", "activateCard", "togglePaymentRune", "togglePaymentPoolEnergy",
  "toggleOptionalPaymentEffect", "confirmPayment", "cancelPayment", "chooseEffectOption",
  "declineEffectChoice", "passShowdown", "endTurn", "sideboardSwap", "sideboardDone",
  "chooseFirstPlayer"
]);

const ACTION_KIND_INDEX = new Map(ACTION_KINDS.map((kind, index) => [kind, index]));

export function encodeState(game, viewerId) {
  const observation = observeGame(game, viewerId);
  if (!observation) return new Float32Array(STATE_DIM);
  const output = new Float32Array(STATE_DIM);
  const mine = observation.self;
  const theirs = observation.opponent;
  const myBoard = observation.battlefields.flatMap((field) => field.units.filter((card) => card.controllerId === viewerId));
  const opponentBoard = observation.battlefields.flatMap((field) => field.units.filter((card) => card.controllerId !== viewerId));
  const scalars = [
    mine.score / observation.victoryScore,
    theirs.score / observation.victoryScore,
    (mine.score - theirs.score) / observation.victoryScore,
    mine.handCount / 12,
    theirs.handCount / 12,
    mine.deckCount / 40,
    theirs.deckCount / 40,
    readyRunes(mine) / 12,
    readyRunes(theirs) / 12,
    mine.runes.length / 12,
    theirs.runes.length / 12,
    sumMight(myBoard) / 40,
    sumMight(opponentBoard) / 40,
    sumMight(mine.base) / 40,
    sumMight(theirs.base) / 40,
    controlled(observation, mine.id) / Math.max(1, observation.battlefields.length),
    controlled(observation, theirs.id) / Math.max(1, observation.battlefields.length),
    Math.min(1, observation.turnNumber / 20),
    observation.currentPlayerId === viewerId ? 1 : 0,
    observation.focusPlayerId === viewerId ? 1 : 0,
    observation.phase === "showdown" ? 1 : 0,
    observation.actionChainSize > 0 ? 1 : 0,
    observation.showdown?.chainSize ? Math.min(1, observation.showdown.chainSize / 8) : 0,
    mine.xp / 20,
    theirs.xp / 20,
    mine.trash.length / 20,
    theirs.trash.length / 20,
    mine.banished.length / 20,
    theirs.banished.length / 20,
    observation.battlefields.length / 3,
    mine.score >= observation.victoryScore - 2 ? 1 : 0,
    theirs.score >= observation.victoryScore - 2 ? 1 : 0
  ];
  output.set(scalars.slice(0, STATE_SCALARS));
  const sideboardContext = game.aiSideboardContext?.[viewerId];
  encodeCards(output, STATE_SCALARS, sideboardContext?.main || mine.hand, 1 / 3);
  encodeCards(output, STATE_SCALARS + CARD_BINS, sideboardContext?.sideboard || [...mine.base, ...myBoard], 1 / 3);
  encodeCards(output, STATE_SCALARS + CARD_BINS * 2, sideboardContext?.metaCards || [...theirs.base, ...opponentBoard, ...theirs.trash, ...theirs.banished], 1 / 3);
  encodeCards(output, STATE_SCALARS + CARD_BINS * 3, [...mine.trash, ...mine.banished], 1 / 3);
  return output;
}

export function encodeAction(game, actorId, action) {
  const output = new Float32Array(ACTION_DIM);
  const kindIndex = ACTION_KIND_INDEX.get(action.kind);
  if (kindIndex != null) output[kindIndex] = 1;
  const card = findCard(game, action.cardId || action.unitId || action.unitIds?.[0]) || cardByNumber(action.cardNumber || action.outCardNumber);
  const secondaryCard = cardByNumber(action.inCardNumber);
  encodeIndexBits(output, 24, cardIndex(card?.cardNumber));
  encodeIndexBits(output, 34, cardIndex(secondaryCard?.cardNumber));
  output[86] = action.playerId === actorId ? 1 : 0;
  output[87] = action.playerId && action.playerId !== actorId ? 1 : 0;
  const destinationId = action.destination || action.destinationId;
  const destination = game.battlefields.find((field) => field.instanceId === destinationId);
  output[88] = destinationId === "base" ? 1 : 0;
  output[89] = destination?.controlledBy === actorId ? 1 : 0;
  output[90] = destination?.controlledBy && destination.controlledBy !== actorId ? 1 : 0;
  output[91] = destination && !destination.controlledBy ? 1 : 0;
  output[92] = (card?.energy || 0) / 10;
  output[93] = (card?.might || 0) / 12;
  output[94] = card?.type === "unit" ? 1 : 0;
  output[95] = card?.type === "spell" ? 1 : 0;
  output[96] = card?.type === "gear" ? 1 : 0;
  output[97] = action.mode === "energy" ? 1 : 0;
  output[98] = action.mode === "power" ? 1 : 0;
  output[99] = Math.min(1, (action.unitIds?.length || (action.unitId ? 1 : 0)) / 5);
  for (const tag of [...(card?.tags || []), ...(card?.keywords || [])]) output[100 + stableHash(tag) % 20] += 0.5;
  const player = game.players.find((candidate) => candidate.id === actorId);
  output[120] = (player?.runes.filter((rune) => !rune.exhausted).length || 0) / 12;
  output[121] = game.phase === "showdown" ? 1 : 0;
  output[122] = game.actionChain ? 1 : 0;
  output[123] = game.pendingChoice ? 1 : 0;
  output[124] = game.pendingPayment ? 1 : 0;
  output[125] = game.currentPlayerId === actorId ? 1 : 0;
  output[126] = action.kind === "endTurn" || action.kind === "passShowdown" ? 1 : 0;
  output[127] = 1;
  return output;
}

export function encodeActionSet(game, actorId, actions, options = {}) {
  const selected = selectHierarchicalActions(actions, MAX_ACTIONS);
  preserveRequiredActions(selected, options.requiredActions || [], MAX_ACTIONS);
  const output = new Float32Array(MAX_ACTIONS * ACTION_DIM);
  selected.forEach((action, index) => output.set(encodeAction(game, actorId, action), index * ACTION_DIM));
  return {
    actions: selected,
    encoded: output,
    legalCount: selected.length,
    originalLegalCount: actions.length,
    truncated: actions.length > selected.length
  };
}

export function selectHierarchicalActions(actions, limit = MAX_ACTIONS) {
  if (actions.length <= limit) return [...actions];
  const groups = new Map();
  for (const action of actions) {
    const stage = actionStage(action);
    const group = groups.get(stage) || [];
    group.push(action);
    groups.set(stage, group);
  }
  const selected = [];
  const queues = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([stage, items]) => ({ stage, items, cursor: 0 }));
  while (selected.length < limit && queues.some((queue) => queue.cursor < queue.items.length)) {
    for (const queue of queues) {
      if (selected.length >= limit || queue.cursor >= queue.items.length) continue;
      const remaining = queue.items.length - queue.cursor;
      const slots = Math.max(1, limit - selected.length);
      const stride = Math.max(1, Math.floor(remaining / slots));
      selected.push(queue.items[queue.cursor]);
      queue.cursor += stride;
    }
  }
  return selected.slice(0, limit);
}

export function actionStage(action) {
  if (["togglePaymentRune", "togglePaymentPoolEnergy", "toggleOptionalPaymentEffect", "confirmPayment", "cancelPayment"].includes(action.kind)) return "payment";
  if (["chooseEffectOption", "declineEffectChoice"].includes(action.kind)) return "choice";
  if (["passShowdown", "activateCard"].includes(action.kind)) return "reaction";
  if (["sideboardSwap", "sideboardDone", "chooseFirstPlayer"].includes(action.kind)) return "match";
  if (["toggleMulliganCard", "confirmMulligan", "skipMulligan"].includes(action.kind)) return "mulligan";
  if (["moveUnit", "moveUnits"].includes(action.kind)) return "movement";
  return "main";
}

function preserveRequiredActions(selected, requiredActions, limit) {
  for (const required of requiredActions) {
    if (!required || selected.includes(required)) continue;
    if (selected.length < limit) {
      selected.push(required);
      continue;
    }
    const requiredStage = actionStage(required);
    let replaceIndex = -1;
    for (let index = selected.length - 1; index >= 0; index -= 1) {
      if (actionStage(selected[index]) === requiredStage && !requiredActions.includes(selected[index])) {
        replaceIndex = index;
        break;
      }
    }
    if (replaceIndex < 0) replaceIndex = selected.findLastIndex((action) => !requiredActions.includes(action));
    if (replaceIndex < 0) throw new Error("Required actions exceed the neural action capacity.");
    selected[replaceIndex] = required;
  }
}

export function encodeOpponentDeckTarget(game, viewerId) {
  const output = new Float32Array(CARD_BINS);
  const opponent = game.players.find((player) => player.id !== viewerId);
  if (!opponent) return output;
  const cards = [
    ...opponent.mainDeck, ...opponent.hand, ...opponent.base, ...opponent.trash, ...(opponent.banished || []),
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.ownerId === opponent.id)),
    ...game.battlefields.flatMap((field) => (field.hidden || []).filter((item) => item.ownerId === opponent.id).map((item) => item.card))
  ];
  for (const card of cards) if (card.cardNumber) output[cardBin(card.cardNumber)] += 1 / 3;
  for (let index = 0; index < output.length; index += 1) output[index] = Math.min(1, output[index]);
  return output;
}

export function padSequence(steps, field, itemSize, maxLength = MAX_SEQUENCE) {
  const sequence = steps.slice(-maxLength);
  const output = new Float32Array(maxLength * itemSize);
  sequence.forEach((step, index) => output.set(step[field], index * itemSize));
  return { data: output, length: sequence.length };
}

export function cardBin(cardNumber) {
  return cardIndex(cardNumber);
}

export function cardIndex(cardNumber) { return CARD_INDEX.get(cardNumber) || 0; }

function encodeCards(output, offset, cards, scale) {
  for (const card of cards || []) if (card?.cardNumber) output[offset + cardBin(card.cardNumber)] += scale;
}

function findCard(game, id) {
  if (!id) return null;
  for (const player of game.players) {
    const found = [player.legend, player.champion, ...player.availableChampions, ...player.availableBattlefields, ...player.hand, ...player.base, ...player.trash, ...(player.banished || [])]
      .filter(Boolean).find((card) => card.instanceId === id);
    if (found) return found;
  }
  return game.battlefields.flatMap((field) => [...field.units, ...(field.hidden || []).map((item) => item.card)]).find((card) => card?.instanceId === id) || null;
}

function cardByNumber(cardNumber) { return CARD_BY_NUMBER.get(cardNumber) || null; }

function encodeIndexBits(output, offset, index) {
  for (let bit = 0; bit < 10; bit += 1) output[offset + bit] = (index >> bit) & 1;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function readyRunes(player) { return player.runes.filter((rune) => !rune.exhausted).length; }
function sumMight(cards) { return cards.reduce((sum, card) => sum + Math.max(0, (card.might || 0) - (card.damage || 0)), 0); }
function controlled(observation, playerId) { return observation.battlefields.filter((field) => field.controlledBy === playerId).length; }
