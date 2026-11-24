import { observeGame } from "../observation.mjs";
import { cards } from "../../cards.mjs";
import { opponentResponseProfile, reactionReserveProfile } from "../resource-strategy.mjs";
import { mulliganPlanProfile } from "../mulligan.mjs";
import { remainingDeckProfile } from "../deck-memory.mjs";
import { tacticalActionProfile } from "../action-tactics.mjs";
import { deckInventoryCards } from "../deck-inventory.mjs";
import { declarationTargetContext, publicUnit } from "../damage-context.mjs";
import {paymentOptionProfile} from '../payment-options.mjs';
import {scoreRaceContext} from '../score-race.mjs';
import {hiddenCardIsControlledBy} from '../../rules/zones.mjs';

// Keep Run C indices stable; append other registered cards. The checkpoint
// loader explicitly migrates zone matrices and belief outputs by card identity.
// Late printings of older sets must follow the already shipped vocabulary,
// rather than shifting the indices of cards learned by existing checkpoints.
const APPENDED_CARD_VOCABULARY = Object.freeze(["OGN-303a/298"]);
const APPENDED_CARD_NUMBERS = new Set(APPENDED_CARD_VOCABULARY);
const RUN_C_LEGACY_COMPATIBILITY_CARDS = Object.freeze([
  "SFD-032/221", "SFD-036/221", "SFD-051/221", "SFD-097/221",
  "SFD-105/221", "SFD-109/221", "SFD-115/221", "SFD-136/221",
  "SFD-140/221", "SFD-146/221", "SFD-208/221", "SFD-215/221",
  "UNL-042/219", "UNL-053/219", "UNL-060/219", "UNL-063/219",
  "UNL-070/219", "UNL-074/219", "UNL-079/219", "UNL-080/219",
  "UNL-113/219", "UNL-120/219", "UNL-128/219", "UNL-134/219",
  "UNL-143/219", "UNL-150/219", "UNL-192/219", "UNL-197/219",
  "UNL-198/219", "UNL-205/219"
]);
const RUN_C_CARD_PREFIXES = new Set(["OGN", "OGS"]);
const RUN_C_CARD_NUMBERS = new Set(RUN_C_LEGACY_COMPATIBILITY_CARDS);
for (const card of Object.values(cards)) {
  const cardNumber = card?.cardNumber;
  if (RUN_C_CARD_PREFIXES.has(String(cardNumber || "").split("-")[0]) && !APPENDED_CARD_NUMBERS.has(cardNumber)) {
    RUN_C_CARD_NUMBERS.add(cardNumber);
  }
}
const RUN_C_CARD_VOCABULARY = [...RUN_C_CARD_NUMBERS]
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right));

export const CARD_VOCABULARY = Object.freeze([
  "<unknown>",
  ...RUN_C_CARD_VOCABULARY,
  ...[...new Set(Object.values(cards).map((card) => card.cardNumber))]
    .filter((number) => number && !RUN_C_CARD_NUMBERS.has(number) && !APPENDED_CARD_NUMBERS.has(number))
    .sort((left, right) => left.localeCompare(right)),
  ...APPENDED_CARD_VOCABULARY
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
export const CONTEXT_HASH_FEATURES = 64;
export const CONTEXT_RULE_FEATURES = 10;
export const CONTEXT_READY_FEATURES = 4;
export const CONTEXT_FEATURES = CONTEXT_HASH_FEATURES + CONTEXT_RULE_FEATURES + CONTEXT_READY_FEATURES;
export const CARD_ZONE_FEATURES = CARD_BINS * 4;
export const BATTLEFIELD_STATE_FEATURES = MAX_BATTLEFIELDS * (BATTLEFIELD_FEATURES + MAX_FIELD_UNITS * UNIT_FEATURES);
export const BASE_STATE_FEATURES = 2 * MAX_BASE_UNITS * UNIT_FEATURES;
export const STATE_DIM = STATE_SCALARS + CARD_ZONE_FEATURES + BATTLEFIELD_STATE_FEATURES + BASE_STATE_FEATURES + CONTEXT_FEATURES;
export const STRUCTURED_STATE_TOKEN_VERSION = 2;
export const STRUCTURED_STATE_LAYOUT = Object.freeze({
  version: STRUCTURED_STATE_TOKEN_VERSION,
  scalars: Object.freeze({ offset: 0, count: STATE_SCALARS, width: 1 }),
  cardZones: Object.freeze({ offset: STATE_SCALARS, count: 4, width: CARD_BINS }),
  battlefields: Object.freeze({
    offset: STATE_SCALARS + CARD_ZONE_FEATURES,
    count: MAX_BATTLEFIELDS,
    width: BATTLEFIELD_FEATURES + MAX_FIELD_UNITS * UNIT_FEATURES,
    battlefieldWidth: BATTLEFIELD_FEATURES,
    unitCount: MAX_FIELD_UNITS,
    unitWidth: UNIT_FEATURES
  }),
  bases: Object.freeze({
    offset: STATE_SCALARS + CARD_ZONE_FEATURES + BATTLEFIELD_STATE_FEATURES,
    count: 2,
    width: MAX_BASE_UNITS * UNIT_FEATURES,
    unitCount: MAX_BASE_UNITS,
    unitWidth: UNIT_FEATURES
  }),
  context: Object.freeze({
    offset: STATE_DIM - CONTEXT_FEATURES,
    count: CONTEXT_FEATURES,
    width: 1
  })
});
export const ACTION_SEMANTIC_DIM = 256;
// The suffix is reserved for collision disambiguation inside the current legal
// action set. It guarantees that two legal actions never reach the model as the
// same vector, even when engine-generated identifiers happen to hash alike.
export const LEGACY_ACTION_DIM = ACTION_SEMANTIC_DIM + 192;
export const ACTION_TACTICAL_DIM = 16;
export const ACTION_TARGET_CONTEXT_DIM = 16;
export const ACTION_PLAN_CONTEXT_DIM = 16;
export const ACTION_OUTCOME_CONTEXT_DIM = 25;
export const ACTION_DIM = LEGACY_ACTION_DIM + ACTION_TACTICAL_DIM + ACTION_TARGET_CONTEXT_DIM + ACTION_PLAN_CONTEXT_DIM + ACTION_OUTCOME_CONTEXT_DIM;
export const MAX_ACTIONS = 192;
export const MAX_SEQUENCE = 128;
export const NEURAL_HIDDEN_SIZE = 64;

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
ACTION_KIND_INDEX.set("submitMulligan", ACTION_KIND_INDEX.get("toggleMulliganCard"));
ACTION_KIND_INDEX.set('choosePaymentOptions', ACTION_KIND_INDEX.get('toggleOptionalPaymentEffect'));

export function encodeState(game, viewerId) {
  // The flat encoder consumes board, zone and decision context only. Avoid
  // copying response logs and the full public turn ledger on every inference;
  // Structured-v2 snapshots request those fields through the default observer.
  const observation = observeGame(game, viewerId, {
    includeExtendedContext: false
  });
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
  encodeOwnDeckContext(output, relationalOffset, game, viewerId);
  // Collision-free scoring history and durability, separate from combat Might.
  const ruleOffset = relationalOffset + CONTEXT_HASH_FEATURES;
  [mine, theirs].forEach((player, side) => {
    const scored = new Set(player.turnScoredBattlefields);
    observation.battlefields.slice(0, MAX_BATTLEFIELDS).forEach((field, index) => {
      output[ruleOffset + side * MAX_BATTLEFIELDS + index] = scored.has(field.id) ? 1 : 0;
    });
  });
  [myBoard, opponentBoard, mine.base, theirs.base].forEach((units, index) => {
    output[ruleOffset + 6 + index] = units.reduce((sum, unit) =>
      sum + Math.max(0, (unit.might || 0) - (unit.damage || 0)), 0) / 40;
  });
  [mine, theirs].forEach((player, side) => {
    output[ruleOffset + CONTEXT_RULE_FEATURES + side * 2] = player.unitsEnterReadyThisTurn ? 1 : 0;
    output[ruleOffset + CONTEXT_RULE_FEATURES + side * 2 + 1] = player.nextUnitEnterReady ? 1 : 0;
  });
  return output;
}

export function encodeAction(game, actorId, action) {
  const output = new Float32Array(ACTION_DIM);
  const kindIndex = ACTION_KIND_INDEX.get(action.kind);
  if (kindIndex != null) output[kindIndex] = 1;
  const player = game.players.find((candidate) => candidate.id === actorId);
  const card = findCard(game, action.cardId || action.cardIds?.[0] || action.unitId || action.unitIds?.[0])
    || cardByNumber(action.cardNumber || action.outCardNumber)
    || (action.kind === "beginPlayChampion" ? player?.champion : null)
    || (action.kind === 'choosePaymentOptions' ? game.pendingPayment?.playProcess?.card : null);
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
  encodeCardEffectSemantics(output, 69, 17, card);
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
  output[120] = (player?.runes.filter((rune) => !rune.exhausted).length || 0) / 12;
  output[121] = game.phase === "showdown" ? 1 : 0;
  output[122] = game.actionChain ? 1 : 0;
  output[123] = game.pendingChoice ? 1 : 0;
  output[124] = game.pendingPayment ? 1 : 0;
  output[125] = game.currentPlayerId === actorId ? 1 : 0;
  output[126] = action.kind === "endTurn" || action.kind === "passShowdown" ? 1 : 0;
  output[127] = 1;
  encodeActionSemantics(output, game, actorId, action, card);
  encodeTacticalActionSemantics(output, LEGACY_ACTION_DIM, game, actorId, action);
  const option=paymentOptionProfile(game,action),race=scoreRaceContext(game,actorId);
  output.set([Number(Boolean(option)),(option?.selected||0)/4,Number(option?.accelerate||false),
    (option?.energy||0)/8,(option?.power||0)/4,(option?.draw||0)/3,
    race.pressure,race.gap,race.opponentHeld/3,race.openFields/3,
    Number(race.nearVictory),Number(race.exposedFinish),(option?.available||0)/4,
    Math.min(1,(game.pendingPayment?.energyCost||0)/12),
    Number(Boolean(option)&&option.selected===0),Number(Boolean(option)&&option.selected>0)],
    LEGACY_ACTION_DIM+ACTION_TACTICAL_DIM+ACTION_TARGET_CONTEXT_DIM);
  const profile=tacticalActionProfile(game,actorId,action),target=profile.targetContext;
  output.set([
    Number(Boolean(target)),Number(target?.stunned||false),Number(target?.activeCombat||false),
    Math.min(1,(target?.combatDamage||0)/12),Math.min(1,(target?.otherEnemyCombatDamage||0)/24),
    Math.min(1,(target?.friendlyCombatDamage||0)/24),Math.min(1,(target?.otherFriendlyHere||0)/8),
    Math.min(1,(target?.drawController||0)/4),Math.min(1,(target?.deathDraw||0)/4),
    Number(target?.kind==='kill'),Number(target?.kind==='stun'),Number(target?.kind==='relocation'),
    Number(target?.ready||false),Number(target?.enemyControlledField||false),
    Math.min(1,(target?.energy||0)/12),Math.min(1,(target?.remainingBeforeHit||0)/12),
    Math.min(1,profile.attackingMight/24),Math.min(1,profile.defendingMight/24),
    Math.min(1,profile.enemyLethalThreshold/12),Math.min(1,profile.friendlyLethalThreshold/12),
    Number(profile.enemyCanRemoveFriendly),Number(profile.sourceControlRisk),
    Math.min(1,profile.movingMight/24),Math.min(1,profile.movingUnitCount/8),
    Number(Boolean(profile.movementTriggersUnresolved))
  ],ACTION_DIM-ACTION_OUTCOME_CONTEXT_DIM);
  return output;
}

export function encodeActionSet(game, actorId, actions, options = {}) {
  const selected = selectHierarchicalActions(actions, MAX_ACTIONS);
  const requiredActions = (options.requiredActions || []).filter(Boolean).map((required) => {
    const canonical = actions.find((action) => semanticActionDescriptor(action) === semanticActionDescriptor(required));
    if (!canonical) throw new Error("Required action is not in the legal action set.");
    return canonical;
  });
  preserveRequiredActions(selected, requiredActions, MAX_ACTIONS);
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
  if (["togglePaymentRune", "togglePaymentPoolEnergy", "togglePaymentPoolPower", "toggleOptionalPaymentEffect", "choosePaymentOptions", "confirmPayment", "cancelPayment"].includes(action.kind)) return "payment";
  if (["chooseEffectOption", "declineEffectChoice"].includes(action.kind)) return "choice";
  if (["passShowdown", "activateCard"].includes(action.kind)) return "reaction";
  if (["sideboardSwap", "sideboardDone", "chooseFirstPlayer"].includes(action.kind)) return "match";
  if (["toggleMulliganCard", "confirmMulligan", "skipMulligan", "submitMulligan"].includes(action.kind)) return "mulligan";
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
  const cards = deckInventoryCards(game, opponent.id);
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
  for (const [fieldIndex,field] of game.battlefields.entries()) {
    for (const hidden of field.hidden||[]) {
      if (hiddenCardIsControlledBy(hidden,viewerId))
        addContextFeature(output,offset,`hidden:${fieldIndex}:${hidden.card?.cardNumber||'unknown'}`,0.5);
    }
  }
  const declaration = declarationTargetContext(game);
  addContextFeature(output, offset, 'declaration:selected-count', declaration.selected.length / 8);
  addContextFeature(output, offset, 'declaration:remaining-count', Math.max(0, declaration.maximum - declaration.selected.length) / 8);
  for (const id of declaration.selected) {
    const target = publicUnit(game, id);
    const fieldIndex = game.battlefields.findIndex(f => f.units.some(u => u.instanceId === id));
    const units = fieldIndex >= 0 ? game.battlefields[fieldIndex].units
      : game.players.find(p => p.id === target?.controllerId)?.base || [];
    const unitIndex = stableCards(units).findIndex(unit => unit.instanceId === id);
    addContextFeature(output, offset, `declaration:target:${target?.cardNumber || 'unknown'}:${target?.controllerId === viewerId ? 'self' : 'opponent'}:${fieldIndex}:${unitIndex}`, 0.25);
  }
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
  for (const token of tokens) output[offset + stableHash(token) % CONTEXT_HASH_FEATURES] = Math.min(1, output[offset + stableHash(token) % CONTEXT_HASH_FEATURES] + 0.5);
  const reserve = reactionReserveProfile(game, viewerId);
  const opponentResponse = opponentResponseProfile(game, viewerId);
  addContextFeature(output, offset, "reserve:reaction-count", Math.min(1, reserve.reactionCards / 4));
  addContextFeature(output, offset, "reserve:affordable-reactions", Math.min(1, reserve.affordableReactions / 3));
  addContextFeature(output, offset, "reserve:coverage", reserve.coverage);
  addContextFeature(output, offset, "reserve:minimum-energy", Math.min(1, reserve.minimumEnergy / 8));
  addContextFeature(output, offset, "reserve:maximum-energy", Math.min(1, reserve.maximumEnergy / 8));
  addContextFeature(output, offset, "reserve:ready-runes", Math.min(1, reserve.readyRunes / 12));
  addContextFeature(output, offset, "reserve:ready-resource-sources", Math.min(1, reserve.readyResourceSources / 4));
  addContextFeature(output, offset, "reserve:generated-energy", Math.min(1, reserve.generatedEnergy / 8));
  addContextFeature(output, offset, "reserve:generated-power", Math.min(1, reserve.generatedPower / 8));
  addContextFeature(output, offset, "reserve:opponent-threat", Math.min(1, reserve.threat));
  addContextFeature(output, offset, "opponent-response:probability", opponentResponse.responseProbability);
  addContextFeature(output, offset, "opponent-response:severity", Math.min(1, opponentResponse.expectedSeverity / 2));
  addContextFeature(output, offset, "opponent-response:expected-threat", Math.min(1, opponentResponse.expectedThreat));
  addContextFeature(output, offset, "opponent-response:affordable-count", Math.min(1, opponentResponse.affordableResponses / 4));
  addContextFeature(output, offset, "opponent-response:recent-passes", Math.min(1, opponentResponse.recentPasses / 4));
  addContextFeature(output, offset, "opponent-response:pass-evidence", Math.min(1, opponentResponse.passEvidenceStrength / 3));
  const mulliganBottomCards = observation.self.mulliganBottomCards || [];
  addContextFeature(output, offset, "mulligan-bottom:count", Math.min(1, mulliganBottomCards.length / 2));
  addContextFeature(output, offset, "mulligan-bottom:cards-ahead", observation.self.mulliganBottomCardsAhead == null
    ? 0
    : Math.min(1, observation.self.mulliganBottomCardsAhead / 40));
  for (const card of mulliganBottomCards) {
    addContextFeature(output, offset, `mulligan-bottom:card:${card.cardNumber || "unknown"}`, 0.8);
    addContextFeature(output, offset, `mulligan-bottom:type:${card.type || "unknown"}`, 0.35);
    addContextFeature(output, offset, `mulligan-bottom:energy:${Math.min(12, Math.max(0, card.energy || 0))}`, 0.35);
  }
  if (reserve.bestReactionCardNumber) addContextFeature(output, offset, `reserve:best-card:${reserve.bestReactionCardNumber}`, 0.75);
  for (const domain of reserve.requiredPowerDomains) addContextFeature(output, offset, `reserve:required-domain:${domain}`, 0.5);
  for (const [domain, amount] of Object.entries(reserve.runeDomains)) {
    addContextFeature(output, offset, `reserve:rune-domain:${domain}`, Math.min(1, amount / 6));
  }
  for (const [domain, amount] of Object.entries(reserve.readyRuneDomains)) {
    addContextFeature(output, offset, `reserve:ready-domain:${domain}`, Math.min(1, amount / 6));
  }
  if (game.phase === "mulligan") {
    const player = game.players.find((candidate) => candidate.id === viewerId);
    const hand = player?.hand || [];
    const counts = new Map();
    for (const card of hand) counts.set(card.cardNumber || card.name, (counts.get(card.cardNumber || card.name) || 0) + 1);
    addContextFeature(output, offset, "mulligan:hand-average-energy", hand.length
      ? Math.min(1, hand.reduce((sum, card) => sum + Math.max(0, Number(card.energy) || 0), 0) / hand.length / 8)
      : 0);
    addContextFeature(output, offset, "mulligan:early-card-count", Math.min(1, hand.filter((card) => (Number(card.energy) || 0) <= 3).length / 3));
    addContextFeature(output, offset, "mulligan:high-card-count", Math.min(1, hand.filter((card) => (Number(card.energy) || 0) >= 5).length / 3));
    addContextFeature(output, offset, "mulligan:duplicate-count", Math.min(1, [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0) / 2));
  }
}

function encodeOwnDeckContext(output, offset, game, viewerId) {
  const player = game.players.find((candidate) => candidate.id === viewerId);
  if (!player) return;
  const ownedBattlefieldCards = game.battlefields.flatMap((field) => [
    ...field.units.filter((card) => card.ownerId === viewerId),
    ...(field.hidden || []).filter((item) => item.ownerId === viewerId).map((item) => item.card)
  ]);
  const deckCards = [
    ...player.mainDeck, ...player.hand, ...player.base, ...player.trash, ...(player.banished || []),
    ...ownedBattlefieldCards,
    ...(player.champion ? [player.champion] : [])
  ].filter(Boolean);
  const scale = 1 / Math.max(1, deckCards.length);
  for (const card of deckCards) {
    addContextFeature(output, offset, `deck:type:${card.type || "unknown"}`, scale);
    addContextFeature(output, offset, `deck:energy:${Math.min(12, Math.max(0, card.energy || 0))}`, scale);
    for (const effect of card.effects || []) {
      addContextFeature(output, offset, `deck:effect:${effect.timing || "none"}:${effect.kind || "unknown"}`, scale);
    }
    for (const keyword of card.keywords || []) addContextFeature(output, offset, `deck:keyword:${keyword}`, scale);
  }
  const remainingScale = 1 / Math.max(1, player.mainDeck.length);
  for (const card of player.mainDeck) {
    addContextFeature(output, offset, `remaining:type:${card.type || "unknown"}`, remainingScale * 0.5);
    for (const effect of card.effects || []) {
      addContextFeature(output, offset, `remaining:effect:${effect.timing || "none"}:${effect.kind || "unknown"}`, remainingScale * 0.5);
    }
  }
  const draw = remainingDeckProfile(game, viewerId);
  addContextFeature(output, offset, "next-draw:expected-energy", Math.min(1, draw.expectedEnergy / 8));
  addContextFeature(output, offset, "next-draw:early-probability", draw.earlyProbability);
  addContextFeature(output, offset, "next-draw:high-cost-probability", draw.highCostProbability);
  addContextFeature(output, offset, "next-draw:unit-probability", draw.unitProbability);
  addContextFeature(output, offset, "next-draw:reaction-probability", draw.reactionProbability);
  addContextFeature(output, offset, "next-draw:development-probability", draw.developmentProbability);
  addContextFeature(output, offset, "known-bottom:count", Math.min(1, draw.knownBottomCount / 12));
  addContextFeature(output, offset, "known-bottom:batches", Math.min(1, draw.knownBottomBatchCount / 6));
  for (const card of draw.topCards.slice(0, 8)) {
    addContextFeature(output, offset, `next-draw:card:${card.cardNumber}`, card.nextDrawProbability);
    addContextFeature(output, offset, `within-three:card:${card.cardNumber}`, card.withinThreeProbability * 0.75);
  }
}

function addContextFeature(output, offset, token, amount) {
  const index = offset + stableHash(token) % CONTEXT_HASH_FEATURES;
  output[index] = Math.min(1, output[index] + amount);
}

function encodeCardEffectSemantics(output, offset, size, card) {
  for (const effect of card?.effects || []) {
    const token = `${effect.timing || "none"}:${effect.kind || "unknown"}`;
    const amount = Math.max(0.25, Math.min(1, Math.abs(Number(effect.amount || effect.draw || effect.damage || 1)) / 4));
    const index = offset + stableHash(token) % size;
    output[index] = Math.min(1, output[index] + amount);
  }
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
  const mulligan = mulliganPlanProfile(game, actorId, action);
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
  encodeHashBits(output, 208, action.kind === "submitMulligan"
    ? mulligan.selectedCardNumbers.join("|") || "keep"
    : action.runeId || action.energyId || action.powerId || action.effectId || action.abilityId || "");
  encodeHashBits(output, 224, battlefieldId || action.playerId || "");
  encodeHashBits(output, 240, `${game.pendingChoice?.effect || ""}|${semanticActionDescriptor(action)}`);
  if (action.kind === "submitMulligan") {
    output[168] = mulligan.selectedCount / 2;
    output[169] = Math.min(1, mulligan.averageSelectedEnergy / 10);
    output[170] = mulligan.selectedHighCostRatio;
    output[171] = mulligan.selectedEarlyRatio;
    output[172] = (mulligan.expectedDelta + 1) / 2;
    output[173] = Math.min(1, mulligan.keptEarlyCards / 3);
    output[174] = Math.min(1, mulligan.keptDuplicatePenalty);
    output[175] = 1;
  }
}

function encodeTacticalActionSemantics(output, offset, game, actorId, action) {
  const profile = tacticalActionProfile(game, actorId, action);
  output[offset] = profile.targetRelation === "friendly" ? 1 : 0;
  output[offset + 1] = profile.targetRelation === "enemy" ? 1 : 0;
  output[offset + 2] = profile.polarity === "beneficial" ? 1 : 0;
  output[offset + 3] = profile.polarity === "harmful" ? 1 : 0;
  output[offset + 4] = profile.targetAlignment > 0 ? 1 : 0;
  output[offset + 5] = profile.targetAlignment < 0 ? 1 : 0;
  output[offset + 6] = Math.min(1, profile.effectAmount / 12);
  output[offset + 7] = profile.savesFromLethal ? 1 : 0;
  output[offset + 8] = profile.isMovement ? 1 : 0;
  output[offset + 9] = Math.min(1, profile.casterSideBenefit);
  output[offset + 10] = profile.targetImpact;
  output[offset + 11] = profile.projectedFieldAdvantage;
  output[offset + 12] = profile.hopelessReinforcement ? 1 : 0;
  output[offset + 13] = profile.controlGain ? 1 : 0;
  output[offset + 14] = profile.reversesRemoval ? 1 : 0;
  // Keep raw, observable facts in the model input. The former composite
  // tacticalPrior collapsed several judgments into one hand-written answer.
  output[offset + 15] = Math.min(1, profile.incomingDamage / 12);
  // Append facts without moving any trained input rows. Old checkpoints load
  // these rows as zero and learn them from new-contract trajectories.
  const target = profile.damageContext;
  const response = profile.responseContext;
  const start = offset + ACTION_TACTICAL_DIM;
  const opponent = game.players.find(p => p.id !== actorId);
  const held = game.battlefields.filter(f => f.controlledBy === opponent?.id).length;
  output[start] = Math.min(1, (target?.selectedCount || 0) / 8);
  output[start + 1] = Math.min(1, (target?.previousHits || 0) / 8);
  output[start + 2] = Math.min(1, (target?.allocatedDamage || 0) / 12);
  output[start + 3] = Math.min(1, (target?.usefulDamage || 0) / 12);
  output[start + 4] = Math.min(1, (target?.remainingBeforeHit || 0) / 12);
  output[start + 5] = target?.lethal ? 1 : 0;
  output[start + 6] = target?.alreadyLethal ? 1 : 0;
  output[start + 7] = target?.fieldId ? 1 : 0;
  output[start + 8] = response?.protection || 0;
  output[start + 9] = response?.relocation || 0;
  output[start + 10] = response?.unknown || 0;
  output[start + 11] = Math.min(1, (target?.remainingSelections || 0) / 8);
  output[start + 12] = Math.min(1, held / 3);
  output[start + 13] = held > 0 && (opponent.score || 0) + held >= (game.victoryScore || 8) ? 1 : 0;
  output[start + 14] = Math.min(1, profile.targetMight / 12);
  output[start + 15] = profile.canRemoveEnemyNoResponse ? 1 : 0;
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
function sumMight(cards) { return cards.reduce((sum, card) => sum + Math.max(0, card.might || 0), 0); }
function controlled(observation, playerId) { return observation.battlefields.filter((field) => field.controlledBy === playerId).length; }
