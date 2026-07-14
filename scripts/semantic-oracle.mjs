const UNIT_CHOICES = new Set([
  "buffUnit", "damageUnit", "killUnit", "modifyMight", "readyUnit", "readyUnitAny",
  "stunUnit", "returnUnitToHand", "returnUnitToBase", "saveFriendlyUnitThisTurn",
  "giveKeyword", "doubleMightTemporary", "enGarde", "possession", "standUnited",
  "moveUnitSpellTarget", "playTrashUnit"
]);
const GEAR_CHOICES = new Set(["trashGear", "markTemporaryGear", "stealEnemyGear"]);
const FRIENDLY_CHOICES = new Set([
  "buffUnit", "readyUnit", "saveFriendlyUnitThisTurn", "standUnited",
  "doubleMightTemporary", "enGarde", "playTrashUnit", "returnTrashUnitToHand"
]);
const ENEMY_CHOICES = new Set(["possession", "stealEnemyGear"]);

export function validateSemanticChoice(game, choice) {
  const errors = [];
  const player = game.players.find((entry) => entry.id === choice.playerId);
  const cardOptions = (choice.options || []).filter((option) => option.cardId && option.card);
  const ids = cardOptions.map((option) => option.cardId);
  if (ids.length !== new Set(ids).size) errors.push("duplicate card options");
  for (const option of cardOptions) {
    const card = findCard(game, option.cardId);
    if (!card) { errors.push(`missing option card ${option.cardId}`); continue; }
    if (option.card?.instanceId && option.card.instanceId !== card.instanceId) errors.push(`stale option card ${option.cardId}`);
    if (UNIT_CHOICES.has(choice.effect) && card.type !== "unit") errors.push(`${choice.effect} offered non-unit ${card.name}`);
    if (GEAR_CHOICES.has(choice.effect) && card.type !== "gear") errors.push(`${choice.effect} offered non-gear ${card.name}`);
    if (FRIENDLY_CHOICES.has(choice.effect) && card.controllerId !== player?.id && card.ownerId !== player?.id) errors.push(`${choice.effect} offered non-friendly ${card.name}`);
    if (ENEMY_CHOICES.has(choice.effect) && card.controllerId === player?.id) errors.push(`${choice.effect} offered friendly ${card.name}`);
    if (choice.effect === "returnTrashUnitToHand") {
      const expected = choice.data?.cardType || "unit";
      if (card.type !== expected || !player?.trash.some((entry) => entry.instanceId === card.instanceId)) errors.push(`trash return offered invalid ${card.name}`);
    }
    if (choice.effect === "playTrashUnit" && !player?.trash.some((entry) => entry.instanceId === card.instanceId)) errors.push(`trash play offered card outside trash: ${card.name}`);
  }
  if (errors.length) throw new Error(`Semantic choice violation for ${choice.card?.name || choice.effect}: ${errors.join("; ")}`);
}

export function captureResolutionContract(game, choice, optionId) {
  const target = findCard(game, optionId);
  if (!target) return null;
  return {
    effect: choice.effect,
    playerId: choice.playerId,
    targetId: target.instanceId,
    before: { damage: target.damage || 0, stunned: Boolean(target.stunned), exhausted: Boolean(target.exhausted), zone: locateCard(game, target.instanceId) }
  };
}

export function validateResolutionContract(game, contract, result) {
  if (!contract || result?.ok === false) return;
  const target = findCard(game, contract.targetId);
  const afterZone = locateCard(game, contract.targetId);
  const fail = (message) => { throw new Error(`Semantic resolution violation for ${contract.effect}: ${message}`); };
  if (contract.effect === "returnTrashUnitToHand" && afterZone !== `hand:${contract.playerId}`) fail("chosen trash card did not move to hand");
  if (contract.effect === "playTrashUnit" && afterZone?.startsWith("trash:")) fail("chosen unit remained in trash");
  if (["returnUnitToHand"].includes(contract.effect) && !afterZone?.startsWith("hand:")) fail("chosen unit did not move to hand");
  if (contract.effect === "returnUnitToBase" && !afterZone?.startsWith("base:")) fail("chosen unit did not move to base");
  if (["killUnit", "trashGear"].includes(contract.effect) && !afterZone?.startsWith("trash:")) fail("chosen permanent did not move to trash");
  if (["stunUnit"].includes(contract.effect) && target && !target.stunned) fail("chosen unit was not stunned");
  if (["readyUnit", "readyUnitAny"].includes(contract.effect) && target?.exhausted) fail("chosen unit was not readied");
  if (contract.effect === "damageUnit" && target && afterZone === contract.before.zone && (target.damage || 0) <= contract.before.damage) fail("chosen unit took no damage");
}

export function semanticCoverageKey(choice) {
  return `${choice.card?.id || choice.card?.name || "system"}:${choice.effect}`;
}

export function validateStableGameState(game) {
  const blockers = Boolean(
    game.pendingChoice || game.pendingPayment || game.actionChain
    || game.triggerQueue?.length || game.triggerQueueContinuation || game.pendingEndTurnPlayerId
  );
  const pendingOperations = (game.operations || []).filter((operation) => operation.status === "pending");
  if (game.phase === "showdown" && pendingOperations.length) {
    throw new Error(`Lifecycle violation: showdown began with pending operations ${pendingOperations.map((operation) => operation.id).join(", ")}`);
  }
  if (!blockers && game.phase === "action" && pendingOperations.length) {
    throw new Error(`Lifecycle violation: stable game has pending operations ${pendingOperations.map((operation) => `${operation.id}:${operation.kind}`).join(", ")}`);
  }
  for (const operation of pendingOperations) {
    if (!blockers) continue;
    const referenced = containsOperationId(game.pendingChoice, operation.id)
      || containsOperationId(game.pendingPayment, operation.id)
      || containsOperationId(game.actionChain?.continuation, operation.id)
      || containsOperationId(game.triggerQueueContinuation, operation.id)
      || (game.triggerQueue || []).some((trigger) => containsOperationId(trigger, operation.id));
    if (!referenced) throw new Error(`Lifecycle violation: pending operation ${operation.id}:${operation.kind} has no continuation owner (choice=${game.pendingChoice?.effect || "none"}, chain=${Boolean(game.actionChain)}, triggers=${game.triggerQueue?.length || 0})`);
  }
  if (!blockers && game.phase === "action" && !game.showdown) {
    for (const battlefield of game.battlefields || []) {
      const controllers = new Set((battlefield.units || []).map((unit) => unit.controllerId).filter(Boolean));
      if (controllers.size < 2) continue;
      const scheduled = (game.stagedEvents || []).some((event) => event.battlefieldId === battlefield.instanceId);
      if (!scheduled) throw new Error(`Flow violation: opposing units at ${battlefield.name} have no showdown or staged combat`);
    }
  }
}

export function interactionCoverageKeys(game, eventKey) {
  const effects = new Set();
  for (const card of activeCards(game)) {
    for (const effect of card.effects || []) effects.add(`${effect.timing}:${effect.kind}`);
  }
  if (eventKey) effects.add(`event:${eventKey}`);
  const values = [...effects].sort();
  const keys = [];
  for (let first = 0; first < values.length; first += 1) {
    for (let second = first + 1; second < values.length; second += 1) {
      keys.push(`2|${values[first]}|${values[second]}`);
      for (let third = second + 1; third < values.length; third += 1) {
        keys.push(`3|${values[first]}|${values[second]}|${values[third]}`);
        if (keys.length >= 500) return keys;
      }
    }
  }
  return keys;
}

function containsOperationId(value, operationId, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (value.operationId === operationId) return true;
  return Object.values(value).some((entry) => containsOperationId(entry, operationId, seen));
}

function activeCards(game) {
  return game.players.flatMap((player) => [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...player.base,
    ...game.battlefields.flatMap((field) => field.units.filter((unit) => unit.controllerId === player.id))
  ]).filter(Boolean);
}

function findCard(game, id) {
  if (!id) return null;
  for (const player of game.players) for (const card of playerCards(game, player)) if (card?.instanceId === id) return card;
  for (const battlefield of game.battlefields) if (battlefield.instanceId === id) return battlefield;
  return null;
}

function locateCard(game, id) {
  for (const player of game.players) {
    for (const zone of ["hand", "base", "trash", "banished", "mainDeck", "runeDeck"]) if ((player[zone] || []).some((card) => card.instanceId === id)) return `${zone}:${player.id}`;
  }
  for (const battlefield of game.battlefields) {
    if (battlefield.units.some((card) => card.instanceId === id)) return `battlefield:${battlefield.instanceId}`;
    if ((battlefield.hidden || []).some((card) => card.instanceId === id)) return `hidden:${battlefield.instanceId}`;
  }
  return null;
}

function playerCards(game, player) {
  return [player.legend, player.champion, ...player.availableChampions, ...player.availableBattlefields,
    ...player.mainDeck, ...player.runeDeck, ...player.hand, ...player.base, ...player.runes, ...player.trash, ...(player.banished || []),
    ...game.battlefields.flatMap((field) => [...field.units, ...(field.hidden || [])])].filter(Boolean);
}
