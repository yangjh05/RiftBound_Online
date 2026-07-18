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
export const STATE_SCALARS = 40;
export const MAX_BATTLEFIELDS = 3;
export const MAX_FIELD_UNITS = 12;
export const MAX_BASE_UNITS = 8;
export const UNIT_FEATURES = 36;
export const BATTLEFIELD_FEATURES = 24;
export const CONTEXT_FEATURES = 64;
const CARD_ZONE_FEATURES = CARD_BINS * 4;
const BATTLEFIELD_STATE_FEATURES = MAX_BATTLEFIELDS * (BATTLEFIELD_FEATURES + MAX_FIELD_UNITS * UNIT_FEATURES);
const BASE_STATE_FEATURES = 2 * MAX_BASE_UNITS * UNIT_FEATURES;
export const STATE_DIM = STATE_SCALARS + CARD_ZONE_FEATURES + BATTLEFIELD_STATE_FEATURES + BASE_STATE_FEATURES + CONTEXT_FEATURES;
export const ACTION_SEMANTIC_DIM = 256;
// The suffix is reserved for collision disambiguation inside the current legal
// action set. It guarantees that two legal actions never reach the model as the
// same vector, even when engine-generated identifiers happen to hash alike.
export const ACTION_DIM = ACTION_SEMANTIC_DIM + 192;
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
// Preserve every existing feature index for checkpoint compatibility. New action
// kinds use previously unused feature slots instead of shifting the legacy map.
ACTION_KIND_INDEX.set("togglePaymentPoolPower", 67);
ACTION_KIND_INDEX.set("rollFirstPlayer", 68);

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
    theirs.score >= observation.victoryScore - 2 ? 1 : 0,
    Math.min(1, (game.pendingChoice?.options?.length || 0) / 12),
    game.pendingChoice?.playerId === viewerId ? 1 : 0,
    game.pendingChoice?.optional ? 1 : 0,
    game.pendingPayment?.playerId === viewerId ? 1 : 0,
    Math.min(1, (game.pendingPayment?.energyCost || 0) / 12),
    Math.min(1, totalPowerCost(game.pendingPayment) / 12),
    Math.min(1, (game.actionChain?.chain?.length || 0) / 8),
    Math.min(1, (game.showdown?.chain?.length || 0) / 8)
  ];
  output.set(scalars.slice(0, STATE_SCALARS));
  const sideboardContext = game.aiSideboardContext?.[viewerId];
  encodeCards(output, STATE_SCALARS, sideboardContext?.main || mine.hand, 1 / 3);
  encodeCards(output, STATE_SCALARS + CARD_BINS, sideboardContext?.sideboard || [...mine.base, ...myBoard], 1 / 3);
  encodeCards(output, STATE_SCALARS + CARD_BINS * 2, sideboardContext?.metaCards || [...theirs.base, ...opponentBoard, ...theirs.trash, ...theirs.banished], 1 / 3);
  encodeCards(output, STATE_SCALARS + CARD_BINS * 3, [...mine.trash, ...mine.banished], 1 / 3);
  let relationalOffset = STATE_SCALARS + CARD_ZONE_FEATURES;
  for (let fieldIndex = 0; fieldIndex < MAX_BATTLEFIELDS; fieldIndex += 1) {
    const field = observation.battlefields[fieldIndex];
    encodeBattlefield(output, relationalOffset, field, observation, viewerId);
    relationalOffset += BATTLEFIELD_FEATURES;
    const units = stableCards(field?.units || []);
    for (let unitIndex = 0; unitIndex < MAX_FIELD_UNITS; unitIndex += 1) {
      encodeUnit(output, relationalOffset, units[unitIndex], viewerId);
      relationalOffset += UNIT_FEATURES;
    }
  }
  for (const units of [stableCards(mine.base), stableCards(theirs.base)]) {
    for (let unitIndex = 0; unitIndex < MAX_BASE_UNITS; unitIndex += 1) {
      encodeUnit(output, relationalOffset, units[unitIndex], viewerId);
      relationalOffset += UNIT_FEATURES;
    }
  }
  encodeDecisionContext(output, relationalOffset, game, observation, viewerId);
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
  const ability = splitAbilityId(action.abilityId);
  if (ability.localId) {
    encodeIndexBits(output, 44, stableHash(ability.localId));
    output[54] = 1;
    output[55] = /energy/iu.test(ability.localId) ? 1 : 0;
    output[56] = /power/iu.test(ability.localId) ? 1 : 0;
    encodeIndexBits(output, 57, cardIndex(findCard(game, ability.sourceId)?.cardNumber));
  }
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
  encodeActionSemantics(output, game, actorId, action, card);
  return output;
}

export function encodeActionSet(game, actorId, actions, options = {}) {
  const selected = selectHierarchicalActions(actions, MAX_ACTIONS);
  preserveRequiredActions(selected, options.requiredActions || [], MAX_ACTIONS);
  const output = new Float32Array(MAX_ACTIONS * ACTION_DIM);
  const encoded = selected.map((action) => encodeAction(game, actorId, action));
  const collisions = new Map();
  encoded.forEach((vector, index) => {
    const signature = Array.from(vector.subarray(0, ACTION_SEMANTIC_DIM)).join(",");
    const group = collisions.get(signature) || [];
    group.push(index);
    collisions.set(signature, group);
  });
  for (const group of collisions.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((left, right) => semanticActionDescriptor(selected[left]).localeCompare(semanticActionDescriptor(selected[right])) || left - right);
    ordered.forEach((actionIndex, collisionIndex) => { encoded[actionIndex][ACTION_SEMANTIC_DIM + collisionIndex] = 1; });
  }
  encoded.forEach((vector, index) => output.set(vector, index * ACTION_DIM));
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
  if (["togglePaymentRune", "togglePaymentPoolEnergy", "togglePaymentPoolPower", "toggleOptionalPaymentEffect", "confirmPayment", "cancelPayment"].includes(action.kind)) return "payment";
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

function encodeBattlefield(output, offset, field, observation, viewerId) {
  if (!field) return;
  const opponentId = observation.opponent.id;
  const mine = field.units.filter((unit) => unit.controllerId === viewerId);
  const theirs = field.units.filter((unit) => unit.controllerId === opponentId);
  output[offset] = 1;
  output[offset + 1] = field.controlledBy === viewerId ? 1 : 0;
  output[offset + 2] = field.controlledBy === opponentId ? 1 : 0;
  output[offset + 3] = field.controlledBy ? 0 : 1;
  output[offset + 4] = observation.showdown?.battlefieldId === field.id ? 1 : 0;
  output[offset + 5] = Math.min(1, field.hidden.filter((item) => item.ownerId === viewerId).length / 4);
  output[offset + 6] = Math.min(1, field.hidden.filter((item) => item.ownerId !== viewerId).length / 4);
  encodeIndexBits(output, offset + 7, cardIndex(field.cardNumber));
  output[offset + 17] = Math.min(1, mine.length / MAX_FIELD_UNITS);
  output[offset + 18] = Math.min(1, theirs.length / MAX_FIELD_UNITS);
  output[offset + 19] = sumMight(mine) / 40;
  output[offset + 20] = sumMight(theirs) / 40;
  output[offset + 21] = Math.min(1, field.units.reduce((sum, unit) => sum + (unit.damage || 0), 0) / 30);
  output[offset + 22] = Math.min(1, field.units.filter((unit) => unit.exhausted).length / MAX_FIELD_UNITS);
  output[offset + 23] = Math.min(1, field.units.length / MAX_FIELD_UNITS);
}

function encodeUnit(output, offset, unit, viewerId) {
  if (!unit) return;
  output[offset] = 1;
  output[offset + 1] = unit.controllerId === viewerId ? 1 : 0;
  output[offset + 2] = unit.controllerId && unit.controllerId !== viewerId ? 1 : 0;
  output[offset + 3] = unit.ownerId === viewerId ? 1 : 0;
  output[offset + 4] = unit.exhausted ? 1 : 0;
  output[offset + 5] = Math.min(1, (unit.might || 0) / 12);
  output[offset + 6] = Math.min(1, (unit.damage || 0) / 12);
  output[offset + 7] = clampSigned((unit.buffs || 0) / 8);
  output[offset + 8] = clampSigned((unit.mightModifier || 0) / 8);
  output[offset + 9] = Math.min(1, (unit.energy || 0) / 12);
  encodeIndexBits(output, offset + 10, cardIndex(unit.cardNumber));
  output[offset + 20] = Math.min(1, (unit.tags?.length || 0) / 6);
  output[offset + 21] = Math.min(1, (unit.keywords?.length || 0) / 6);
  output[offset + 22] = unit.stunned ? 1 : 0;
  output[offset + 23] = Math.min(1, (unit.attachments?.length || 0) / 3);
  encodeIndexBits(output, offset + 24, cardIndex(unit.attachments?.[0]?.cardNumber));
  output[offset + 34] = Math.min(1, (unit.attachments?.length || 0) / 3);
  output[offset + 35] = hasStatus(unit, /barrier|shield|armor/iu) ? 1 : 0;
}

function encodeDecisionContext(output, offset, game, observation, viewerId) {
  const tokens = [
    `phase:${observation.phase}`,
    `choice:${game.pendingChoice?.effect || "none"}`,
    `choice-source:${publicSourceNumber(game, game.pendingChoice?.sourceId)}`,
    `payment-kind:${game.pendingPayment?.kind || game.pendingPayment?.purpose || "none"}`,
    `payment-source:${publicSourceNumber(game, game.pendingPayment?.cardId || game.pendingPayment?.sourceId)}`,
    `chain:${game.actionChain?.chain?.at(-1)?.kind || game.actionChain?.chain?.at(-1)?.effect || "none"}`,
    `showdown:${observation.showdown ? "active" : "none"}`,
    `showdown-attacker:${observation.showdown?.attackerId === viewerId ? "self" : "opponent"}`,
    `priority:${observation.focusPlayerId === viewerId ? "self" : "opponent"}`
  ];
  for (const token of tokens) output[offset + stableHash(token) % CONTEXT_FEATURES] = Math.min(1, output[offset + stableHash(token) % CONTEXT_FEATURES] + 0.5);
}

function encodeActionSemantics(output, game, actorId, action, primaryCard) {
  const option = game.pendingChoice?.options?.find((candidate) => String(candidate?.id ?? candidate?.value ?? candidate) === String(action.optionId));
  const optionCard = findCard(game, option?.cardId || option?.unitId || action.optionId);
  const battlefieldId = action.battlefieldId || action.destinationId || action.destination;
  const battlefieldIndex = battlefieldId === "base" ? -1 : game.battlefields.findIndex((field) => field.instanceId === battlefieldId);
  const battlefield = battlefieldIndex >= 0 ? game.battlefields[battlefieldIndex] : null;
  const battlefieldCard = battlefield || findCard(game, battlefieldId);
  const rune = findCard(game, action.runeId);
  const player = game.players.find((candidate) => candidate.id === actorId);
  const resource = player?.runePool?.energy?.find((candidate) => candidate.id === action.energyId)
    || player?.runePool?.power?.find((candidate) => candidate.id === action.powerId);
  const effect = (game.pendingPayment?.optionalPowerEffects || game.pendingPayment?.optionalEffects || []).find((candidate) => candidate.id === action.effectId);
  encodeIndexBits(output, 128, cardIndex(optionCard?.cardNumber));
  encodeIndexBits(output, 138, cardIndex(battlefieldCard?.cardNumber));
  if (battlefieldId === "base") output[148] = 1;
  else if (battlefieldIndex >= 0 && battlefieldIndex < MAX_BATTLEFIELDS) output[149 + battlefieldIndex] = 1;
  encodeIndexBits(output, 152, cardIndex(rune?.cardNumber || primaryCard?.cardNumber));
  const domain = resource?.domain || rune?.domain || effect?.domain;
  const domains = ["Body", "Calm", "Chaos", "Fury", "Mind", "Order"];
  const domainIndex = domains.findIndex((candidate) => String(domain).toLowerCase().includes(candidate.toLowerCase()));
  if (domainIndex >= 0) output[162 + domainIndex] = 1;
  output[168] = Math.min(1, Number(option?.amount || option?.count || 0) / 12);
  output[169] = option?.selected || action.triggerOrderSelected ? 1 : 0;
  output[170] = option?.optionalTrigger || action.triggerOrderOptional ? 1 : 0;
  output[171] = action.confirmTriggerOrder ? 1 : 0;
  output[172] = resource?.selected ? 1 : 0;
  output[173] = effect?.selected ? 1 : 0;
  output[174] = action.optionId != null ? 1 : 0;
  output[175] = action.runeId || action.energyId || action.powerId || action.effectId ? 1 : 0;
  encodeHashBits(output, 176, action.cardId || action.unitId || action.unitIds?.join("|") || "");
  encodeHashBits(output, 192, action.optionId || "");
  encodeHashBits(output, 208, action.runeId || action.energyId || action.powerId || action.effectId || action.abilityId || "");
  encodeHashBits(output, 224, battlefieldId || action.playerId || "");
  encodeHashBits(output, 240, `${game.pendingChoice?.effect || ""}|${semanticActionDescriptor(action)}`);
}

function semanticActionDescriptor(action) {
  return JSON.stringify(Object.keys(action || {}).sort().reduce((result, key) => {
    if (!["score", "probability"].includes(key)) result[key] = action[key];
    return result;
  }, {}));
}

function encodeHashBits(output, offset, value) {
  const first = stableHash(value);
  const second = stableHash(`secondary:${value}`);
  for (let bit = 0; bit < 16; bit += 1) output[offset + bit] = bit < 8 ? (first >> bit) & 1 : (second >> (bit - 8)) & 1;
}

function stableCards(cards) {
  return [...(cards || [])].filter(Boolean).sort((left, right) =>
    (left.controllerId || "").localeCompare(right.controllerId || "")
    || cardIndex(left.cardNumber) - cardIndex(right.cardNumber)
    || (left.instanceId || "").localeCompare(right.instanceId || ""));
}

function publicSourceNumber(game, id) { return findCard(game, id)?.cardNumber || "none"; }
function hasStatus(card, pattern) { return [...(card.tags || []), ...(card.keywords || [])].some((value) => pattern.test(String(value))); }
function totalPowerCost(payment) {
  if (Number.isFinite(payment?.powerCost)) return Number(payment.powerCost);
  if (Array.isArray(payment?.powerCost)) return payment.powerCost.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0);
  return Object.values(payment?.powerCost || {}).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
}
function clampSigned(value) { return Math.max(-1, Math.min(1, value)); }

function findCard(game, id) {
  if (!id) return null;
  for (const player of game.players) {
    const found = [player.legend, player.champion, ...player.availableChampions, ...player.availableBattlefields, ...player.hand, ...player.base, ...player.runes, ...player.trash, ...(player.banished || [])]
      .filter(Boolean).find((card) => card.instanceId === id);
    if (found) return found;
  }
  return game.battlefields.flatMap((field) => [...field.units, ...(field.hidden || []).map((item) => item.card)]).find((card) => card?.instanceId === id) || null;
}

function splitAbilityId(abilityId) {
  const value = String(abilityId || "");
  const separator = value.lastIndexOf(":");
  if (separator < 0) return { sourceId: "", localId: value };
  return { sourceId: value.slice(0, separator), localId: value.slice(separator + 1) };
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
