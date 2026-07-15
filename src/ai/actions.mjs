import { hiddenCardIsControlledBy } from "../rules/zones.mjs";
import {
  activateCard,
  beginPlayCard,
  beginPlayChampion,
  cancelPayment,
  chooseEffectOption,
  confirmFirstPlayer,
  confirmMulligan,
  confirmPayment,
  declineEffectChoice,
  endTurn,
  hideCard,
  moveUnit,
  moveUnits,
  passShowdown,
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

export function activeActorId(game) {
  if (game.pendingChoice?.playerId) return game.pendingChoice.playerId;
  if (game.pendingPayment?.playerId) return game.pendingPayment.playerId;
  if (game.phase === "champion-select") return game.championSelectPlayerId;
  if (game.phase === "battlefield-select") return game.setupPlayerId;
  if (game.phase === "mulligan") return game.mulligan?.playerId || null;
  if (game.actionChain?.priorityPlayerId) return game.actionChain.priorityPlayerId;
  if (game.phase === "showdown") return game.showdown?.priorityPlayerId || null;
  if (game.phase === "first-player") return game.hostPlayerId || game.firstPlayerId || game.players[0]?.id;
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
  const selectedPool = new Set(payment.poolEnergyIds || []);
  for (const energy of payment.poolEnergyOptions || payment.poolEnergy || []) {
    if (selectedPool.has(energy.id)) continue;
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

function candidateActions(game, actorId) {
  const player = game.players.find((candidate) => candidate.id === actorId);
  if (!player) return [];
  if (game.phase === "first-player") return [{ kind: "confirmFirstPlayer" }];
  if (game.phase === "champion-select") {
    return player.availableChampions.map((card) => ({ kind: "selectChampion", cardId: card.instanceId }));
  }
  if (game.phase === "battlefield-select") {
    return player.availableBattlefields.map((field) => ({ kind: "selectBattlefield", battlefieldId: field.instanceId }));
  }
  if (game.phase === "mulligan") {
    const selected = new Set(game.mulligan?.selectedCardIds || []);
    return [
      ...player.hand.map((card) => ({ kind: "toggleMulliganCard", cardId: card.instanceId })),
      ...(selected.size ? [{ kind: "confirmMulligan" }] : []),
      { kind: "skipMulligan" }
    ];
  }
  if (game.pendingChoice) {
    return [
      ...(game.pendingChoice.options || []).filter((option) => !option.disabled).map((option) => ({
        kind: "chooseEffectOption",
        optionId: option.id ?? option.value ?? option
      })),
      ...(game.pendingChoice.optional ? [{ kind: "declineEffectChoice" }] : [])
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
      ...addSources.map((card) => ({ kind: "activateCard", cardId: card.instanceId })),
      ...player.runes.flatMap((rune) => [
        { kind: "togglePaymentRune", runeId: rune.instanceId, mode: "energy" },
        { kind: "togglePaymentRune", runeId: rune.instanceId, mode: "power" }
      ]),
      ...(payment.poolEnergyOptions || payment.poolEnergy || []).map((energy) => ({ kind: "togglePaymentPoolEnergy", energyId: energy.id })),
      ...(player.runePool?.power || []).filter((power) => power?.id).map((power) => ({ kind: "togglePaymentPoolPower", powerId: power.id })),
      ...(payment.optionalPowerEffects || payment.optionalEffects || []).map((effect) => ({ kind: "toggleOptionalPaymentEffect", effectId: effect.id })),
      { kind: "confirmPayment" },
      { kind: "cancelPayment" }
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
  const movable = [
    ...player.base.filter((card) => card.type === "unit"),
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.type === "unit" && card.controllerId === actorId))
  ];
  const actions = [
    ...player.hand.flatMap((card) => destinations.map((destination) => ({ kind: "beginPlayCard", cardId: card.instanceId, destination }))),
    ...hiddenCards.map(({ card, destination }) => ({ kind: "beginPlayCard", cardId: card.instanceId, destination })),
    ...player.hand.flatMap((card) => game.battlefields.map((field) => ({ kind: "hideCard", cardId: card.instanceId, destination: field.instanceId }))),
    ...movable.flatMap((unit) => destinations.map((destinationId) => ({ kind: "moveUnit", unitId: unit.instanceId, destinationId }))),
    ...batchMoveCandidates(movable, destinations),
    ...controlledCards.map((card) => ({ kind: "activateCard", cardId: card.instanceId })),
    ...destinations.map((destination) => ({ kind: "beginPlayChampion", destination }))
  ];
  if (game.phase === "showdown" || game.actionChain) actions.push({ kind: "passShowdown" });
  if (game.phase === "action" && !game.actionChain) actions.push({ kind: "endTurn" });
  return actions;
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
    case "activateCard": return activateCard(game, action.cardId);
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
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(entries));
}

export function cloneGame(game) {
  return structuredClone(game);
}
