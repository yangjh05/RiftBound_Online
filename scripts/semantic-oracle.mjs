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
  // Declaring a triggered ability's target only records the identity that the
  // eventual Chain resolution must use. It does not resolve the effect yet.
  if (choice.data?.declareTrigger) return null;
  const target = findCard(game, optionId);
  if (!target) return null;
  return {
    effect: choice.effect,
    sourceName: choice.card?.name || null,
    choiceData: structuredClone(choice.data || {}),
    playerId: choice.playerId,
    targetId: target.instanceId,
    before: {
      damage: target.damage || 0,
      stunned: Boolean(target.stunned),
      exhausted: Boolean(target.exhausted),
      zone: locateCard(game, target.instanceId),
      deathRecallAllowed: hasDeathRecallReplacement(game, target),
      damageMayBePrevented: choice.effect === "damageUnit" && damageCanBePrevented(game, choice, target),
      movesThisTurn: target.movesThisTurn || 0,
      damagePreventions: structuredClone(target.damagePreventions || []),
      globalDamagePreventionTurn: game.preventSpellAbilityDamageUntilTurnSequence ?? null,
      turnSequence: game.turnSequence || 0
    }
  };
}

export function validateResolutionContract(game, contract, result) {
  if (!contract || result?.ok === false) return;
  const deferredByDeflect = game.pendingChoice?.effect === "payDeflect"
    && game.pendingChoice.data?.targetId === contract.targetId
    && game.pendingChoice.data?.originalChoice?.effect === contract.effect;
  if (deferredByDeflect) return;
  const target = findCard(game, contract.targetId);
  const afterZone = locateCard(game, contract.targetId);
  const fail = (message) => { throw new Error(`Semantic resolution violation for ${contract.sourceName || "unknown source"} ${contract.effect}: ${message}; data=${JSON.stringify(contract.choiceData || {})}`); };
  if (contract.effect === "returnTrashUnitToHand" && afterZone !== `hand:${contract.playerId}`) fail("chosen trash card did not move to hand");
  if (contract.effect === "playTrashUnit" && afterZone?.startsWith("trash:")) fail("chosen unit remained in trash");
  if (["returnUnitToHand"].includes(contract.effect) && !afterZone?.startsWith("hand:")) fail("chosen unit did not move to hand");
  if (contract.effect === "returnUnitToBase" && !afterZone?.startsWith("base:")) fail("chosen unit did not move to base");
  if (["killUnit", "trashGear"].includes(contract.effect) && !afterZone?.startsWith("trash:")) {
    const replacementPending = ["deathReplacementSource", "deathReplacementEvent", "preparedDeathRecallPayment"]
      .includes(game.pendingChoice?.effect)
      && (game.pendingChoice?.data?.unitId === contract.targetId
        || game.pendingChoice?.options?.some((option) => option.cardId === contract.targetId));
    const legallyRecalled = contract.before.deathRecallAllowed && afterZone?.startsWith("base:");
    if (!replacementPending && !legallyRecalled) fail("chosen permanent neither died nor used a declared death-replacement effect");
  }
  if (["stunUnit"].includes(contract.effect) && target && !target.stunned) fail("chosen unit was not stunned");
  if (["readyUnit", "readyUnitAny"].includes(contract.effect) && target?.exhausted) fail("chosen unit was not readied");
  if (contract.effect === "damageUnit") {
    const deathReplacementApplied = contract.before.deathRecallAllowed
      && afterZone?.startsWith("base:")
      && target
      && (target.damage || 0) === 0;
    if (!contract.before.damageMayBePrevented && !deathReplacementApplied
      && target && afterZone === contract.before.zone && (target.damage || 0) <= contract.before.damage) {
      fail(`chosen unit took no damage (target ${contract.targetId}, damage ${contract.before.damage} -> ${target.damage || 0}, zone ${contract.before.zone} -> ${afterZone}, before=${JSON.stringify(contract.before)})`);
    }
    if (contract.before.zone?.startsWith("battlefield:") && afterZone?.startsWith("base:") && !contract.before.deathRecallAllowed) {
      fail("damage moved a unit from a battlefield to base without a declared death-replacement effect");
    }
  }
}

function damageCanBePrevented(game, choice, target) {
  const origin = choice.card?.type === "spell" ? "spell" : "ability";
  if ((game.preventSpellAbilityDamageUntilTurnSequence ?? -1) >= (game.turnSequence || 0)) return true;
  if (hasEffect(target, "static", "preventDamageAfterSecondMove") && (target.movesThisTurn || 0) >= 2) return true;
  const currentTurn = game.turnSequence || 0;
  return (target.damagePreventions || []).some((prevention) => {
    if ((prevention.expiresAtTurnSequence ?? currentTurn) < currentTurn) return false;
    if (!(prevention.remaining === "all" || prevention.remaining > 0)) return false;
    if (!prevention.source || prevention.source === "any") return true;
    if (prevention.source === "spellOrAbility") return origin === "spell" || origin === "ability";
    return prevention.source === origin;
  });
}

function hasEffect(card, timing, kind) {
  return (card?.effects || []).some((effect) => effect.timing === timing && effect.kind === kind);
}

export function semanticCoverageKey(choice) {
  return `${choice.card?.id || choice.card?.name || "system"}:${choice.effect}`;
}

export function validateStableGameState(game) {
  for (const chain of [game.showdown, game.actionChain].filter(Boolean)) {
    for (const item of chain.chain || []) {
      const process = item.playOptions?.playProcess;
      const isPlayerCardPlay = item.itemType === "card"
        && ["hand", "champion", "hidden"].includes(process?.source)
        && item.status === "pending"
        && item.playOptions?.declarationsComplete !== true;
      if (!isPlayerCardPlay || pendingInteractionOwnsChainItem(game, item.id)) continue;
      throw new Error(`Lifecycle violation: Pending Chain item ${item.id} has incomplete declarations without a choice or payment owner`);
    }
  }
  const blockers = Boolean(
    game.pendingChoice || game.pendingPayment || game.actionChain
    || game.triggerQueue?.length || game.triggerQueueContinuation || game.pendingEndTurnPlayerId
    || game.cleanupPendingTriggerBatches?.length || game.deferredTriggerContinuations?.length
    || game.combatCleanupProcess || game.showdownExitProcess || game.resolvingGameEffect || game.effectSequenceContinuation
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
      || containsOperationId(game.cleanupPendingTriggerBatches, operation.id)
      || containsOperationId(game.deferredTriggerContinuations, operation.id)
      || containsOperationId(game.combatCleanupProcess, operation.id)
      || containsOperationId(game.showdownExitProcess, operation.id)
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

function pendingInteractionOwnsChainItem(game, itemId) {
  return game.pendingPayment?.playProcess?.chainItemId === itemId
    || game.pendingChoice?.data?.completion?.chainItemId === itemId
    || game.pendingChoice?.completion?.chainItemId === itemId
    || containsChainItemId(game.pendingChoice?.data, itemId)
    || containsChainItemId(game.pendingPayment, itemId);
}

function containsChainItemId(value, itemId, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (value.chainItemId === itemId) return true;
  return Object.values(value).some((entry) => containsChainItemId(entry, itemId, seen));
}

export function captureInteractionState(game) {
  const cards = {};
  for (const player of game.players) {
    for (const card of playerCards(game, player)) {
      if (!card?.instanceId || cards[card.instanceId]) continue;
      cards[card.instanceId] = interactionCardState(game, card);
      for (const attachment of card.attachments || []) {
        if (attachment?.instanceId && !cards[attachment.instanceId]) cards[attachment.instanceId] = interactionCardState(game, attachment);
      }
    }
  }
  return {
    cards,
    activeEffects: [...new Set(activeCards(game).flatMap((card) => (card.effects || [])
      .map((effect) => `${card.cardNumber || card.id}:${effect.timing}:${effect.kind}`)))].sort(),
    lifecycle: interactionLifecycleState(game)
  };
}

export function causalInteractionCoverageKeys(before, game, eventKey) {
  const after = captureInteractionState(game);
  const transitions = new Set();
  const cardIds = new Set([...Object.keys(before.cards || {}), ...Object.keys(after.cards || {})]);
  for (const id of cardIds) {
    const prior = before.cards?.[id];
    const next = after.cards?.[id];
    if (!prior || !next) {
      transitions.add(`card-${prior ? "removed" : "created"}`);
      continue;
    }
    if (prior.zone !== next.zone) transitions.add(`zone:${zoneKind(prior.zone)}>${zoneKind(next.zone)}`);
    if (prior.damage !== next.damage) transitions.add(`damage:${Math.sign(next.damage - prior.damage)}`);
    if (prior.exhausted !== next.exhausted) transitions.add(`exhausted:${next.exhausted}`);
    if (prior.stunned !== next.stunned) transitions.add(`stunned:${next.stunned}`);
    if (prior.buffs !== next.buffs) transitions.add(`buffs:${Math.sign(next.buffs - prior.buffs)}`);
    if (prior.mightModifier !== next.mightModifier) transitions.add(`might-modifier:${Math.sign(next.mightModifier - prior.mightModifier)}`);
  }
  for (const key of Object.keys(before.lifecycle || {})) {
    if (before.lifecycle[key] !== after.lifecycle[key]) transitions.add(`lifecycle:${key}:${String(before.lifecycle[key])}>${String(after.lifecycle[key])}`);
  }
  if (!transitions.size) transitions.add("no-observable-state-change");

  const cause = `event:${eventKey || "unknown"}`;
  const keys = [...transitions].map((transition) => `cause|${cause}|${transition}`);
  for (const effect of before.activeEffects || []) {
    for (const transition of transitions) {
      keys.push(`interaction|${cause}|${effect}|${transition}`);
      if (keys.length >= 500) return keys;
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
  const topLevel = game.players.flatMap((player) => [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...player.base,
    ...game.battlefields.flatMap((field) => field.units.filter((unit) => unit.controllerId === player.id))
  ]).filter(Boolean);
  return topLevel.flatMap((card) => [card, ...(card.attachments || [])]);
}

function hasDeathRecallReplacement(game, target) {
  if (target.saveWithRuneUntilTurnSequence === (game.turnSequence || 0)) return true;
  return activeCards(game).some((card) => card.controllerId === target.controllerId
    && (card.effects || []).some((effect) => effect.timing === "replacement"
      && ["saveFriendlyUnitByKillingThis", "saveBuffedFriendlyUnitBySett"].includes(effect.kind)));
}

function interactionCardState(game, card) {
  return {
    zone: locateCard(game, card.instanceId),
    damage: card.damage || 0,
    exhausted: Boolean(card.exhausted),
    stunned: Boolean(card.stunned),
    buffs: card.buffs || 0,
    mightModifier: card.mightModifier || 0
  };
}

function interactionLifecycleState(game) {
  return {
    phase: game.phase,
    choice: game.pendingChoice?.effect || null,
    payment: Boolean(game.pendingPayment),
    actionChain: Boolean(game.actionChain),
    triggerQueue: game.triggerQueue?.length || 0,
    cleanupTriggerBatches: game.cleanupPendingTriggerBatches?.length || 0,
    deferredTriggerContinuations: game.deferredTriggerContinuations?.length || 0,
    combatCleanup: Boolean(game.combatCleanupProcess),
    showdownExit: Boolean(game.showdownExitProcess),
    resolvingGameEffect: Boolean(game.resolvingGameEffect),
    showdown: game.showdown?.battlefieldId || null
  };
}

function zoneKind(zone) {
  return zone?.split(":")[0] || "missing";
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
