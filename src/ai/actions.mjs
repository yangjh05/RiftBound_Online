import { hiddenCardIsControlledBy } from "../rules/zones.mjs";
import {
  activateCard,
  beginPlayCard,
  beginPlayChampion,
  cancelPayment,
  chooseFirstPlayer,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmMulligan,
  confirmPayment,
  declineEffectChoice,
  endTurn,
  firstPlayerDecisionActorId,
  hideCard,
  legalActivatedAbilityOptions,
  legalCardPlayDestinations,
  legalChampionPlayDestinations,
  legalPaymentPoolEnergyOptions,
  moveUnit,
  moveUnits,
  passShowdown,
  rollFirstPlayer,
  selectBattlefield,
  selectChampion,
  skipMulligan,
  toggleMulliganCard,
  toggleOptionalPaymentEffect,
  togglePaymentPoolEnergy,
  togglePaymentPoolPower,
  togglePaymentRune
} from "../engine.mjs";

const STRATEGIC_KINDS = new Set([
  "selectChampion", "selectBattlefield", "confirmMulligan", "skipMulligan",
  "beginPlayCard", "beginPlayChampion", "hideCard", "moveUnit", "moveUnits",
  "activateCard", "chooseEffectOption", "declineEffectChoice", "passShowdown", "endTurn"
]);

// These fields describe the current decision for scoring/encoding, but they are
// not part of the command that is executed by the engine. Keeping them in an
// action identity makes an explicit { kind, optionId } choice look different
// from the corresponding enumerated AI action.
const ACTION_ANNOTATION_FIELDS = new Set([
  "confirmTriggerOrder",
  "triggerOrderSelected",
  "triggerOrderOptional"
]);

export function activeActorId(game) {
  if (game.pendingChoice?.playerId) return game.pendingChoice.playerId;
  if (game.pendingPayment?.playerId) return game.pendingPayment.playerId;
  if (game.phase === "champion-select") return game.championSelectPlayerId;
  if (game.phase === "battlefield-select") return game.setupPlayerId;
  if (game.phase === "mulligan") return game.mulligan?.playerId || null;
  if (game.actionChain?.priorityPlayerId) return game.actionChain.priorityPlayerId;
  if (game.phase === "showdown") return game.showdown?.priorityPlayerId || null;
  if (game.phase === "first-player") return firstPlayerDecisionActorId(game);
  if (game.phase === "action") return game.currentPlayerId;
  return null;
}

export function enumerateLegalActions(game, actorId = activeActorId(game)) {
  if (!actorId || game.phase === "complete") return [];
  const candidates = candidateActions(game, actorId);
  const unique = new Map();
  for (const action of candidates) unique.set(actionKey(action), action);
  const declined = new Set(game.aiDeclinedIntents?.turnSequence === game.turnSequence ? game.aiDeclinedIntents.keys : []);
  return [...unique.values()].filter((action) => {
    if (declined.has(actionKey(action))) return false;
    const clone = cloneGame(game);
    if (!applyAiAction(clone, action, actorId)?.ok) return false;
    if (["beginPlayCard", "beginPlayChampion", "hideCard", "activateCard"].includes(action.kind) && clone.pendingPayment) {
      return canCompletePayment(clone);
    }
    return true;
  });
}

export function resolveLegalAction(game, command, actorId = activeActorId(game)) {
  if (!command || !actorId) return null;
  const normalized = Object.fromEntries(Object.entries(command)
    .filter(([, value]) => value !== undefined && value !== null));
  if (normalized.kind === "moveUnit") {
    if (typeof normalized.unitId !== "string" || typeof normalized.destinationId !== "string") return null;
    const explicitMove = {
      kind: "moveUnit",
      unitId: normalized.unitId,
      destinationId: normalized.destinationId
    };
    const clone = cloneGame(game);
    return applyAiAction(clone, explicitMove, actorId)?.ok ? explicitMove : null;
  }
  if (normalized.kind === "moveUnits") {
    const unitIds = Array.isArray(normalized.unitIds) ? normalized.unitIds : [];
    if (unitIds.length < 2 || new Set(unitIds).size !== unitIds.length || !normalized.destinationId) return null;
    const explicitMove = { kind: "moveUnits", unitIds: [...unitIds], destinationId: normalized.destinationId };
    const clone = cloneGame(game);
    return applyAiAction(clone, explicitMove, actorId)?.ok ? explicitMove : null;
  }
  // Command authorization must evaluate only the command the player actually
  // submitted. Enumerating every possible play/activation here made an
  // unrelated broken card candidate capable of rejecting a valid multiplayer
  // pass or end-turn command.
  const candidates = candidateActions(game, actorId, normalized.kind);
  const unique = new Map();
  for (const action of candidates) unique.set(actionKey(action), action);
  const declined = new Set(game.aiDeclinedIntents?.turnSequence === game.turnSequence ? game.aiDeclinedIntents.keys : []);
  const legal = [...unique.values()].filter((action) => {
    if (declined.has(actionKey(action))) return false;
    const clone = cloneGame(game);
    if (!applyAiAction(clone, action, actorId)?.ok) return false;
    return true;
  });
  const exactKey = actionKey(normalized);
  const exact = legal.find((action) => actionKey(action) === exactKey);
  if (exact) return exact;
  // Backward compatibility is intentionally limited to the old activation
  // command shape. Never infer a target, payment, or effect choice on behalf
  // of a player, even when only one option currently exists.
  if (normalized.kind !== "activateCard" || normalized.abilityId != null) return null;
  const compatible = legal.filter((action) => Object.entries(normalized)
    .every(([key, value]) => sameActionValue(action[key], value)));
  return compatible.length === 1 ? compatible[0] : null;
}

export function auditDecisionBoundary(game, actorId = activeActorId(game)) {
  const violations = [...(game.decisionSafety?.violations || [])];
  if (game.phase === "complete") return violations;
  if (!actorId) {
    violations.push({ kind: "missing-active-actor", phase: game.phase });
    return violations;
  }
  if (game.pendingChoice) {
    const choice = game.pendingChoice;
    if (choice.playerId !== actorId) {
      violations.push({ kind: "choice-actor-mismatch", expected: choice.playerId, actual: actorId, effect: choice.effect });
    }
    const enabled = (choice.options || []).filter((option) => !option?.disabled);
    const optionIds = enabled.map((option) => option?.id ?? option?.value ?? option);
    if (!enabled.length && !choice.optional) {
      violations.push({ kind: "required-choice-without-options", effect: choice.effect, playerId: choice.playerId });
    }
    if (new Set(optionIds).size !== optionIds.length) {
      violations.push({ kind: "duplicate-choice-option", effect: choice.effect, playerId: choice.playerId });
    }
    const legalKeys = new Set(enumerateLegalActions(game, actorId).map(actionKey));
    for (const optionId of optionIds) {
      const key = actionKey({ kind: "chooseEffectOption", optionId });
      if (!legalKeys.has(key)) violations.push({ kind: "choice-option-not-actionable", effect: choice.effect, optionId });
    }
    const declineKey = actionKey({ kind: "declineEffectChoice" });
    if (choice.optional !== legalKeys.has(declineKey)) {
      violations.push({ kind: "choice-decline-parity", effect: choice.effect, optional: Boolean(choice.optional) });
    }
  }
  if (game.pendingPayment?.playerId && game.pendingPayment.playerId !== actorId) {
    violations.push({ kind: "payment-actor-mismatch", expected: game.pendingPayment.playerId, actual: actorId });
  }
  const legal = enumerateLegalActions(game, actorId);
  if (!legal.length) violations.push({ kind: "no-legal-action", phase: game.phase, actorId });
  return uniqueViolations(violations);
}

function canCompletePayment(game) {
  return Boolean(planPaymentActions(game));
}

export function planPaymentActions(source) {
  const orders = [
    { reverse: false, powerFirst: false },
    { reverse: true, powerFirst: false },
    { reverse: false, powerFirst: true },
    { reverse: true, powerFirst: true }
  ];
  for (const order of orders) {
    const plan = attemptPaymentPlan(source, order);
    if (plan) return plan;
  }
  return null;
}

function attemptPaymentPlan(source, order) {
  const game = cloneGame(source);
  const payment = game.pendingPayment;
  const player = game.players.find((candidate) => candidate.id === payment?.playerId);
  if (!payment || !player) return false;
  if (confirmPayment(cloneGame(game))?.ok) return [{ kind: "confirmPayment" }];
  const actions = [];
  for (const action of paymentAddAbilityActions(game, player)) {
    const branch = cloneGame(game);
    if (!activateCard(branch, action.cardId, action.abilityId || null)?.ok) continue;
    // Generated resource ids are assigned while the ability resolves, so only
    // return the executable next step. The following payment decision replans
    // against the authoritative ids now present in the real game state.
    if (attemptPaymentPlan(branch, order)) return [action];
  }
  const selectedPool = new Set(payment.poolEnergyIds || []);
  for (const energy of legalPaymentPoolEnergyOptions(game)) {
    if (selectedPool.has(energy.id) || !energy.canToggle) continue;
    const action = { kind: "togglePaymentPoolEnergy", energyId: energy.id };
    if (!togglePaymentPoolEnergy(game, energy.id)?.ok) continue;
    actions.push(action);
    if (confirmPayment(cloneGame(game))?.ok) return [...actions, { kind: "confirmPayment" }];
  }
  const selectedPoolPower = new Set(payment.poolPowerIds || []);
  for (const power of player.runePool?.power || []) {
    if (!power?.id || selectedPoolPower.has(power.id)) continue;
    const action = { kind: "togglePaymentPoolPower", powerId: power.id };
    if (!togglePaymentPoolPower(game, power.id)?.ok) continue;
    actions.push(action);
    if (confirmPayment(cloneGame(game))?.ok) return [...actions, { kind: "confirmPayment" }];
  }
  const runes = order.reverse ? [...player.runes].reverse() : [...player.runes];
  const modes = order.powerFirst ? ["power", "energy"] : ["energy", "power"];
  for (const mode of modes) {
    for (const rune of runes) {
      const selected = mode === "energy" ? game.pendingPayment.energyRuneIds : game.pendingPayment.powerRuneIds;
      if (selected?.includes(rune.instanceId)) continue;
      const action = { kind: "togglePaymentRune", runeId: rune.instanceId, mode };
      const result = togglePaymentRune(game, rune.instanceId, mode);
      if (!result?.ok) continue;
      actions.push(action);
      if (confirmPayment(cloneGame(game))?.ok) return [...actions, { kind: "confirmPayment" }];
    }
  }
  return null;
}

function paymentAddAbilityActions(game, player) {
  const sources = [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...player.base,
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.controllerId === player.id))
  ].filter(Boolean);
  return sources.flatMap((card) => legalActivatedAbilityOptions(game, card.instanceId)
    .filter((ability) => ability.kind === "addEnergy" || ability.kind === "addPower")
    .map((ability) => ({
      kind: "activateCard",
      cardId: card.instanceId,
      ...(ability.id ? { abilityId: ability.id } : {})
    })));
}

function candidateActions(game, actorId, kindFilter = null) {
  const wants = (kind) => !kindFilter || kindFilter === kind;
  const player = game.players.find((candidate) => candidate.id === actorId);
  if (!player) return [];
  if (game.phase === "first-player") {
    const decision = game.firstPlayerDecision;
    if (decision?.method === "roll" && decision.status === "rolling") {
      return wants("rollFirstPlayer") ? [{ kind: "rollFirstPlayer" }] : [];
    }
    if (decision?.method === "roll" && decision.status === "choosing") {
      return wants("chooseFirstPlayer")
        ? game.players.map((candidate) => ({ kind: "chooseFirstPlayer", playerId: candidate.id }))
        : [];
    }
    return wants("confirmFirstPlayer") ? [{ kind: "confirmFirstPlayer" }] : [];
  }
  if (game.phase === "champion-select") {
    return wants("selectChampion")
      ? player.availableChampions.map((card) => ({ kind: "selectChampion", cardId: card.instanceId }))
      : [];
  }
  if (game.phase === "battlefield-select") {
    return wants("selectBattlefield")
      ? player.availableBattlefields.map((field) => ({ kind: "selectBattlefield", battlefieldId: field.instanceId }))
      : [];
  }
  if (game.phase === "mulligan") {
    const selected = new Set(game.mulligan?.selectedCardIds || []);
    return [
      ...(wants("toggleMulliganCard") ? player.hand.map((card) => ({ kind: "toggleMulliganCard", cardId: card.instanceId })) : []),
      ...(wants("confirmMulligan") && selected.size ? [{ kind: "confirmMulligan" }] : []),
      ...(wants("skipMulligan") ? [{ kind: "skipMulligan" }] : [])
    ];
  }
  if (game.pendingChoice) {
    return [
      ...(wants("chooseEffectOption") ? (game.pendingChoice.options || []).filter((option) => !option.disabled).map((option) => ({
        kind: "chooseEffectOption",
        optionId: option.id ?? option.value ?? option,
        ...(game.pendingChoice.effect === "triggerOrder" ? {
          confirmTriggerOrder: Boolean(option.confirmTriggerOrder),
          triggerOrderSelected: Boolean(option.selected),
          triggerOrderOptional: Boolean(option.optionalTrigger)
        } : {})
      })) : []),
      ...(wants("declineEffectChoice") && game.pendingChoice.optional ? [{ kind: "declineEffectChoice" }] : [])
    ];
  }
  if (game.pendingPayment) {
    const payment = game.pendingPayment;
    const addSources = [
      player.legend,
      player.champion?.zone === "played" ? player.champion : null,
      ...player.base,
      ...player.runes,
      ...game.battlefields.flatMap((field) => field.units.filter((card) => card.controllerId === actorId))
    ].filter(Boolean);
    return [
      ...(wants("activateCard") ? addSources.flatMap((card) => activatedAbilityActions(game, card)) : []),
      ...(wants("togglePaymentRune") ? player.runes.flatMap((rune) => [
        { kind: "togglePaymentRune", runeId: rune.instanceId, mode: "energy" },
        { kind: "togglePaymentRune", runeId: rune.instanceId, mode: "power" }
      ]) : []),
      ...(wants("togglePaymentPoolEnergy") ? legalPaymentPoolEnergyOptions(game)
        .filter((energy) => energy.canToggle)
        .map((energy) => ({ kind: "togglePaymentPoolEnergy", energyId: energy.id })) : []),
      ...(wants("togglePaymentPoolPower") ? (player.runePool?.power || []).filter((power) => power?.id).map((power) => ({ kind: "togglePaymentPoolPower", powerId: power.id })) : []),
      ...(wants("toggleOptionalPaymentEffect") ? (payment.optionalPowerEffects || payment.optionalEffects || []).map((effect) => ({ kind: "toggleOptionalPaymentEffect", effectId: effect.id })) : []),
      ...(wants("confirmPayment") ? [{ kind: "confirmPayment" }] : []),
      ...(wants("cancelPayment") ? [{ kind: "cancelPayment" }] : [])
    ];
  }

  const destinations = ["base", ...game.battlefields.map((field) => field.instanceId)];
  const hiddenCards = game.battlefields.flatMap((field) => (field.hidden || [])
    .filter((item) => hiddenCardIsControlledBy(item, actorId))
    .map((item) => ({ card: item.card, destination: field.instanceId })));
  const controlledCards = [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...player.base,
    ...player.runes,
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.controllerId === actorId))
  ].filter(Boolean);
  const movable = wants("moveUnit") || wants("moveUnits") ? [
    ...player.base.filter((card) => card.type === "unit"),
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.type === "unit" && card.controllerId === actorId))
  ] : [];
  const actions = [
    ...(wants("beginPlayCard") ? player.hand.flatMap((card) => legalCardPlayDestinations(game, card.instanceId)
      .map((destination) => ({ kind: "beginPlayCard", cardId: card.instanceId, destination }))) : []),
    ...(wants("beginPlayCard") ? hiddenCards.map(({ card, destination }) => ({ kind: "beginPlayCard", cardId: card.instanceId, destination })) : []),
    ...(wants("hideCard") ? player.hand.flatMap((card) => game.battlefields.map((field) => ({ kind: "hideCard", cardId: card.instanceId, destination: field.instanceId }))) : []),
    ...(wants("moveUnit") ? movable.flatMap((unit) => destinations.map((destinationId) => ({ kind: "moveUnit", unitId: unit.instanceId, destinationId }))) : []),
    ...(wants("moveUnits") ? batchMoveCandidates(movable, destinations) : []),
    ...(wants("activateCard") ? controlledCards.flatMap((card) => activatedAbilityActions(game, card)) : []),
    ...(wants("beginPlayChampion") ? legalChampionPlayDestinations(game)
      .map((destination) => ({ kind: "beginPlayChampion", destination })) : [])
  ];
  if (wants("passShowdown") && (game.phase === "showdown" || game.actionChain)) actions.push({ kind: "passShowdown" });
  if (wants("endTurn") && game.phase === "action" && !game.actionChain) actions.push({ kind: "endTurn" });
  return actions;
}

export function enumerateCommandCandidates(game, actorId = activeActorId(game)) {
  return actorId ? candidateActions(game, actorId) : [];
}

function activatedAbilityActions(game, card) {
  return legalActivatedAbilityOptions(game, card.instanceId).map((ability) => ({
    kind: "activateCard",
    cardId: card.instanceId,
    ...(ability.id ? { abilityId: ability.id } : {})
  }));
}

function batchMoveCandidates(units, destinations) {
  if (units.length < 2) return [];
  const subsets = [];
  const limit = Math.min(units.length, 3);
  for (let size = 2; size <= limit; size += 1) choose([], 0, size);
  if (units.length > 3) subsets.push(units.map((unit) => unit.instanceId));
  return subsets.flatMap((unitIds) => destinations.map((destinationId) => ({ kind: "moveUnits", unitIds, destinationId })));

  function choose(chosen, start, remaining) {
    if (!remaining) {
      subsets.push(chosen.map((unit) => unit.instanceId));
      return;
    }
    for (let index = start; index <= units.length - remaining; index += 1) choose([...chosen, units[index]], index + 1, remaining - 1);
  }
}

export function applyAiAction(game, action, actorId = activeActorId(game)) {
  if (!action || actorId !== activeActorId(game)) return { ok: false, message: "AI action actor does not have focus." };
  const result = execute();
  if (result?.ok && ["beginPlayCard", "beginPlayChampion", "hideCard", "activateCard"].includes(action.kind)
    && (game.pendingPayment || game.pendingChoice)) {
    game.aiDecisionContext = { key: actionKey(action), turnSequence: game.turnSequence };
  }
  if (result?.ok && action.kind === "cancelPayment" && game.aiDecisionContext) {
    if (game.aiDecisionContext.turnSequence === game.turnSequence) {
      const prior = game.aiDeclinedIntents?.turnSequence === game.turnSequence ? game.aiDeclinedIntents.keys : [];
      game.aiDeclinedIntents = { turnSequence: game.turnSequence, keys: [...new Set([...prior, game.aiDecisionContext.key])] };
    }
    game.aiDecisionContext = null;
  }
  if (result?.ok && ["confirmPayment", "declineEffectChoice"].includes(action.kind) && !game.pendingPayment && !game.pendingChoice) game.aiDecisionContext = null;
  return result;

  function execute() {
    switch (action.kind) {
    case "rollFirstPlayer": return rollFirstPlayer(game, actorId);
    case "chooseFirstPlayer": return chooseFirstPlayer(game, actorId, action.playerId);
    case "confirmFirstPlayer": return confirmFirstPlayer(game);
    case "selectChampion": return selectChampion(game, actorId, action.cardId);
    case "selectBattlefield": return selectBattlefield(game, actorId, action.battlefieldId);
    case "toggleMulliganCard": return toggleMulliganCard(game, action.cardId);
    case "confirmMulligan": return confirmMulligan(game);
    case "skipMulligan": return skipMulligan(game);
    case "beginPlayCard": return beginPlayCard(game, action.cardId, action.destination);
    case "beginPlayChampion": return beginPlayChampion(game, action.destination);
    case "hideCard": return hideCard(game, action.cardId, action.destination);
    case "moveUnit": return moveUnit(game, action.unitId, action.destinationId);
    case "moveUnits": return moveUnits(game, action.unitIds, action.destinationId);
    case "activateCard": return activateCard(game, action.cardId, action.abilityId || null);
    case "togglePaymentRune": return togglePaymentRune(game, action.runeId, action.mode);
    case "togglePaymentPoolEnergy": return togglePaymentPoolEnergy(game, action.energyId);
    case "togglePaymentPoolPower": return togglePaymentPoolPower(game, action.powerId);
    case "toggleOptionalPaymentEffect": return toggleOptionalPaymentEffect(game, action.effectId);
    case "confirmPayment": return confirmPayment(game);
    case "cancelPayment": return cancelPayment(game);
    case "chooseEffectOption": return chooseEffectOption(game, action.optionId);
    case "declineEffectChoice": return declineEffectChoice(game);
    case "passShowdown": return passShowdown(game, actorId);
    case "endTurn": return endTurn(game);
    default: return { ok: false, message: `Unknown AI action: ${action.kind}` };
    }
  }
}

export function actionFromCommand(command) {
  if (!command?.kind) return null;
  return { ...command };
}

export function isStrategicAction(action) {
  return STRATEGIC_KINDS.has(action?.kind);
}

export function actionKey(action) {
  if (!action) return "none";
  const entries = Object.entries(action)
    .filter(([key, value]) => value !== undefined && !ACTION_ANNOTATION_FIELDS.has(key))
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(entries));
}

export function cloneGame(game) {
  return structuredClone(game);
}

function uniqueViolations(violations) {
  const unique = new Map();
  for (const violation of violations) unique.set(JSON.stringify(violation), violation);
  return [...unique.values()];
}

function sameActionValue(left, right) {
  if (left === right) return true;
  if (left == null || right == null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  return JSON.stringify(left) === JSON.stringify(right);
}
