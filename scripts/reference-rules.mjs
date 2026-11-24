/**
 * Small executable model of the Core Rules cleanup contracts.
 * It intentionally imports nothing from the production engine so a shared bug
 * cannot make both the implementation and the expected result agree.
 */
export function resolveCleanupReference(input) {
  const state = structuredClone(input);
  state.units = (state.units || []).map((unit) => ({
    damage: 0,
    exhausted: false,
    zone: "battlefield",
    auraOtherFriendlyMight: 0,
    ...unit
  }));
  const events = [];
  let passes = 0;

  const resolveLethalPass = () => {
    const live = state.units.filter((unit) => unit.zone === "battlefield" || unit.zone === "base");
    const lethal = live.filter((unit) => unit.damage > 0 && unit.damage >= referenceMight(unit, live));
    passes += 1;
    if (!lethal.length) return false;

    const replacedIds = new Set();
    for (const unit of lethal) {
      if (unit.replaceDeathWithRecall) {
        events.push({ kind: "deathReplacedByRecall", unitId: unit.id });
        unit.zone = "base";
        unit.damage = 0;
        unit.exhausted = true;
        unit.replaceDeathWithRecall = false;
        replacedIds.add(unit.id);
      }
    }
    const dying = lethal.filter((unit) => !replacedIds.has(unit.id));
    for (const unit of dying) {
      if (unit.hasDeathknell) events.push({ kind: "deathknellCaptured", unitId: unit.id });
    }
    for (const unit of dying) {
      events.push({ kind: "killed", unitId: unit.id });
      unit.zone = "trash";
    }
    return true;
  };

  if (state.combat) {
    resolveLethalPass();
  } else {
    while (passes < 20 && resolveLethalPass()) {
      // A normal cleanup repeats until no state change remains.
    }
  }

  if (state.combat) {
    const battlefieldUnits = state.units.filter((unit) => unit.zone === "battlefield");
    for (const unit of battlefieldUnits) unit.damage = 0;
    const defendersRemain = battlefieldUnits.some((unit) => unit.controllerId !== state.attackerId);
    if (defendersRemain) {
      for (const unit of battlefieldUnits.filter((candidate) => candidate.controllerId === state.attackerId)) {
        unit.zone = "base";
        events.push({ kind: "survivingAttackerRecalled", unitId: unit.id });
      }
    }
  }

  return { units: state.units, events, cleanupPasses: passes };
}

export function referenceMight(unit, liveUnits) {
  const aura = liveUnits
    .filter((source) => source.zone === unit.zone)
    .filter((source) => source.controllerId === unit.controllerId && source.id !== unit.id)
    .reduce((sum, source) => sum + (source.auraOtherFriendlyMight || 0), 0);
  return Math.max(0, (unit.might || 0) + (unit.buffs || 0) + (unit.mightModifier || 0) + aura);
}

export function referenceZone(result, unitId) {
  return result.units.find((unit) => unit.id === unitId)?.zone || null;
}

/**
 * Independent model for Core Rules 419.4: a card becomes "played" only when
 * its play process completes by resolution. Countered or resolution-prevented
 * cards do not increment card-play counts and do not emit played events.
 */
export function resolvePlayedReference({
  previousCardsPlayed = 0,
  isCard = true,
  resolution = "resolved"
} = {}) {
  const played = resolution === "resolved";
  const cardPlayed = played && isCard;
  return {
    played,
    cardPlayed,
    cardsPlayedThisTurn: previousCardsPlayed + (cardPlayed ? 1 : 0),
    emitPlayedTrigger: cardPlayed
  };
}

/**
 * Independent ordered-task model for Core Rules 315, 317, and 323.
 * Production traces are filtered to these rule IDs before comparison so
 * intervening card triggers and nested cleanups cannot hide task reordering.
 */
export function resolveTurnTaskOrderReference(kind, { expirationRepeats = 0 } = {}) {
  if (kind === "start") {
    return ["315.1.b", "315.2.a.1", "315.2.b.2", "315.3.b", "315.4.b", "315.4.d"];
  }
  if (kind === "ending") {
    const expiration = [];
    for (let attempt = 0; attempt <= expirationRepeats; attempt += 1) {
      expiration.push("317.2.a", "317.2.b", "317.2.c", "317.2.d", "317.2.f");
    }
    return ["423.1.a.2", "317.1.a", ...expiration, "317.3"];
  }
  if (kind === "cleanup") {
    return ["323.1", "323.2", "323.4", "323.5", "323.6", "323.7", "323.8", "323.9", "323.10", "323.14"];
  }
  throw new Error(`Unknown turn-task reference kind: ${kind}`);
}

/**
 * Independent Handle-Outstanding-Tasks / FEPR re-entry model for Core Rules
 * 334-336. The model deliberately knows nothing about the engine's continuation
 * objects. It only expresses the rule-level invariant: a Task incurred in any
 * stage pauses that exact stage, runs once, and resumes the same stage. A
 * Pending Item produced while Resolve is running restarts FEPR at Finalize.
 */
export function resolveOutstandingTaskFeprReference({
  taskKind = "cleanup",
  taskCreatedAt = "handle",
  pendingItemIds = ["item-1"],
  pendingItemCreatedDuringResolve = null,
  phase = "main"
} = {}) {
  const stages = ["handle", "finalize", "execute", "pass", "resolve"];
  if (!stages.includes(taskCreatedAt)) throw new Error(`Unknown HOT/FEPR stage: ${taskCreatedAt}`);

  const items = pendingItemIds.map((id) => ({ id, status: "pending" }));
  const trace = [];
  let taskRuns = 0;
  let resolveProducedPending = false;

  const runStage = (stage) => {
    trace.push(`${stage}:enter`);
    if (taskCreatedAt === stage && taskRuns === 0) {
      trace.push(
        `${stage}:pause`,
        `task:${taskKind}:start`,
        `task:${taskKind}:complete`,
        `${stage}:resume`
      );
      taskRuns += 1;
    }
    if (stage === "finalize") {
      for (const item of items) {
        if (item.status === "pending") item.status = "finalized";
      }
    }
    if (stage === "resolve") {
      const top = [...items].reverse().find((item) => item.status === "finalized");
      if (top) top.status = "resolved";
      if (pendingItemCreatedDuringResolve && !resolveProducedPending) {
        items.push({ id: pendingItemCreatedDuringResolve, status: "pending" });
        resolveProducedPending = true;
        trace.push(`resolve:created-pending:${pendingItemCreatedDuringResolve}`);
      }
    }
    trace.push(`${stage}:exit`);
  };

  runStage("handle");
  let feprIndex = 1;
  let safety = 0;
  while (feprIndex < stages.length && safety < 20) {
    safety += 1;
    const stage = stages[feprIndex];
    runStage(stage);
    if (stage === "resolve" && items.some((item) => item.status === "pending")) {
      feprIndex = 1;
      continue;
    }
    feprIndex += 1;
  }
  if (safety >= 20) throw new Error("HOT/FEPR reference model exceeded its safety limit.");

  return {
    trace,
    taskRuns,
    items,
    next: phase === "main" ? "turn-player-priority" : "advance-turn-structure"
  };
}

/**
 * Independent FEPR transition model for Core Rules 333-340.
 * Items are ordered oldest to newest, matching their order on the Chain.
 */
export function resolveChainTransitionReference(kind, {
  items = [],
  creatorId = null,
  focusPlayerId = null,
  nextPlayerId = null,
  suppressFocusPassOnEmpty = false
} = {}) {
  const chain = structuredClone(items).map((item) => ({ status: "finalized", ...item }));
  if (kind === "create") {
    return { items: chain, priorityPlayerId: creatorId, focusPlayerId };
  }
  if (kind === "finalize") {
    for (const item of chain) item.status = "finalized";
    const resolvedOnFinalize = chain.filter((item) => item.resolvesOnFinalize);
    const remaining = chain.filter((item) => !item.resolvesOnFinalize);
    if (!remaining.length && resolvedOnFinalize.length) {
      const nextFocus = suppressFocusPassOnEmpty ? focusPlayerId : (nextPlayerId || focusPlayerId);
      return {
        items: remaining,
        resolvedOnFinalizeIds: resolvedOnFinalize.map((item) => item.id),
        priorityPlayerId: nextFocus,
        focusPlayerId: nextFocus
      };
    }
    return {
      items: remaining,
      resolvedOnFinalizeIds: resolvedOnFinalize.map((item) => item.id),
      priorityPlayerId: remaining.at(-1)?.playerId || null,
      focusPlayerId
    };
  }
  if (kind === "resolve") {
    chain.pop();
    if (chain.length) {
      return {
        items: chain,
        priorityPlayerId: chain.at(-1).playerId,
        focusPlayerId
      };
    }
    const nextFocus = suppressFocusPassOnEmpty ? focusPlayerId : (nextPlayerId || focusPlayerId);
    return { items: chain, priorityPlayerId: nextFocus, focusPlayerId: nextFocus };
  }
  throw new Error(`Unknown Chain transition reference kind: ${kind}`);
}

/**
 * Independent Pass-cycle model for Core Rules 339. Items are oldest to newest.
 * Adding any Item invalidates every earlier pass. A complete uninterrupted pass
 * cycle resolves exactly the newest Item, then a new cycle is required.
 */
export function resolvePassCycleReference({
  playerIds = [],
  priorityPlayerId = null,
  consecutivePasses = 0,
  items = [],
  operations = []
} = {}) {
  const state = {
    playerIds: [...playerIds],
    priorityPlayerId,
    consecutivePasses,
    items: structuredClone(items),
    resolvedItemIds: []
  };

  for (const operation of operations) {
    if (operation.kind === "add") {
      state.items.push(structuredClone(operation.item));
      state.consecutivePasses = 0;
      state.priorityPlayerId = operation.playerId;
      continue;
    }
    if (operation.kind !== "pass") throw new Error(`Unknown Pass-cycle operation: ${operation.kind}`);
    if (operation.playerId !== state.priorityPlayerId) throw new Error("Only the player with Priority may pass.");

    state.consecutivePasses += 1;
    if (state.consecutivePasses < state.playerIds.length) {
      const playerIndex = state.playerIds.indexOf(operation.playerId);
      state.priorityPlayerId = state.playerIds[(playerIndex + 1) % state.playerIds.length];
      continue;
    }

    const resolved = state.items.pop();
    if (resolved) state.resolvedItemIds.push(resolved.id);
    state.consecutivePasses = 0;
    state.priorityPlayerId = state.items.at(-1)?.playerId || null;
  }

  return state;
}

/** Independent Execute-window model for Core Rules 338. */
export function resolveExecuteWindowReference({
  playerIds = [],
  priorityPlayerId = null,
  items = [],
  operations = []
} = {}) {
  const state = {
    playerIds: [...playerIds],
    priorityPlayerId,
    consecutivePasses: 0,
    items: structuredClone(items),
    trace: []
  };

  for (const operation of operations) {
    if (operation.playerId !== state.priorityPlayerId) throw new Error("Only the player with Priority may use an Execute window.");
    if (operation.kind === "pass") {
      const index = state.playerIds.indexOf(operation.playerId);
      state.priorityPlayerId = state.playerIds[(index + 1) % state.playerIds.length];
      state.consecutivePasses += 1;
      state.trace.push("execute:pass", "pass:next-player");
      continue;
    }
    if (!["card", "activated"].includes(operation.kind)) throw new Error(`Unknown Execute operation: ${operation.kind}`);
    if (!operation.legallyTimed) throw new Error("An illegally timed Item cannot be added during Execute.");
    state.items.push({ id: operation.id, itemType: operation.kind, playerId: operation.playerId, status: "pending" });
    state.consecutivePasses = 0;
    state.trace.push(`execute:${operation.kind}`, "append:pending", "return:finalize");
    for (const item of state.items) {
      if (item.status === "pending") item.status = "finalized";
    }
  }
  return state;
}

/** Independent post-Resolve model for Core Rules 340. */
export function resolvePostResolutionReference({
  items = [],
  createdItems = [],
  focusPlayerId = null,
  nextFocusPlayerId = null,
  suppressFocusPassOnEmpty = false
} = {}) {
  const remaining = structuredClone(items);
  const resolved = remaining.pop() || null;
  const trace = ["resolve:newest", "execute:entire-effect"];
  for (const item of createdItems) {
    remaining.push({ ...structuredClone(item), status: "pending" });
    trace.push("append:pending");
  }
  if (remaining.some((item) => item.status === "pending")) {
    trace.push("return:finalize");
    for (const item of remaining) {
      if (item.status === "pending") item.status = "finalized";
    }
    return {
      resolvedItemId: resolved?.id || null,
      items: remaining,
      priorityPlayerId: remaining.at(-1)?.playerId || null,
      focusPlayerId,
      trace
    };
  }
  if (remaining.length) {
    trace.push("return:execute");
    return {
      resolvedItemId: resolved?.id || null,
      items: remaining,
      priorityPlayerId: remaining.at(-1).playerId,
      focusPlayerId,
      trace
    };
  }
  const nextFocus = suppressFocusPassOnEmpty ? focusPlayerId : (nextFocusPlayerId || focusPlayerId);
  trace.push("chain:open");
  return {
    resolvedItemId: resolved?.id || null,
    items: remaining,
    priorityPlayerId: nextFocus,
    focusPlayerId: nextFocus,
    trace
  };
}

/** Independent duel Showdown-opening model for Core Rules 342 and 344-346. */
export function referenceShowdownOpening({
  neutralOpen = true,
  contestedAppliedBy = null,
  battlefieldControllerId = null,
  unitControllerIds = []
} = {}) {
  const controllers = [...new Set(unitControllerIds.filter(Boolean))];
  const hasApplier = Boolean(contestedAppliedBy && controllers.includes(contestedAppliedBy));
  const hasOpponent = controllers.some((controllerId) => controllerId !== contestedAppliedBy);
  const opensCombat = neutralOpen && hasApplier && hasOpponent;
  const opensNonCombat = neutralOpen && hasApplier && !hasOpponent && battlefieldControllerId !== contestedAppliedBy;
  const opens = opensCombat || opensNonCombat;
  return {
    opens,
    combat: opens ? opensCombat : null,
    focusPlayerId: opens ? contestedAppliedBy : null,
    priorityPlayerId: opens ? contestedAppliedBy : null
  };
}

/** Independent Showdown-exit model for Core Rules 347-348. */
export function referenceShowdownExit({
  combat = false,
  attackerId,
  defenderId,
  controlledBy = null,
  alreadyScoredBy = [],
  units = []
} = {}) {
  const survivors = units.filter((unit) => (unit.damage || 0) < (unit.might || 0));
  const attackersRemain = survivors.some((unit) => unit.controllerId === attackerId);
  const defendersRemain = survivors.some((unit) => unit.controllerId === defenderId);
  if (attackersRemain && defendersRemain) {
    return {
      survivors: survivors.map((unit) => unit.id),
      next: combat ? "combat" : "stage-combat",
      controlledBy,
      conquerPlayerId: null,
      score: false
    };
  }
  const solePlayerId = attackersRemain ? attackerId : defendersRemain ? defenderId : null;
  const establishesControl = Boolean(solePlayerId && controlledBy !== solePlayerId);
  return {
    survivors: survivors.map((unit) => unit.id),
    next: "action",
    controlledBy: solePlayerId,
    conquerPlayerId: establishesControl ? solePlayerId : null,
    score: establishesControl && !alreadyScoredBy.includes(solePlayerId)
  };
}

/** Independent card/token play lifecycle for Core Rules 349-354. */
export function resolvePlayLifecycleReference({
  objectKind = "spell",
  isToken = false,
  resolved = true,
  enclosingEffect = false,
  outstandingTask = false
} = {}) {
  const trace = ["close", "pending"];
  if (enclosingEffect) trace.push("wait-for-enclosing-effect");
  if (outstandingTask) trace.push("wait-for-outstanding-task");
  trace.push("choices", "costs", "legality", "finalized");
  if (!resolved) return { trace: [...trace, "countered"], played: false, cardOrdinalDelta: 0, zone: "trash" };
  if (isToken) trace.push("resolve-on-finalize");
  else trace.push("execute", "pass", "resolve");
  if (objectKind === "spell") trace.push("execute-effect", "owner-trash", "played");
  else trace.push("enter-board", "played");
  return {
    trace,
    played: true,
    cardOrdinalDelta: isToken ? 0 : 1,
    zone: objectKind === "spell" ? "trash" : "board"
  };
}

/**
 * Independent permission matrix for Core Rules 308-313, 326, 331, 338,
 * and 343. `timing` describes the permission printed on the card or ability;
 * an explicit card effect can supply the equivalent of Reaction via
 * `reactionException` (for example, Ambush at a legal destination).
 */
export function referenceOpportunityPermission({
  state = "neutral",
  chainExists = false,
  hasPriority = true,
  hasFocus = state !== "showdown",
  timing = "ordinary",
  reactionException = false
} = {}) {
  if (!hasPriority) return false;
  const isReaction = timing === "reaction" || reactionException;
  const isAction = timing === "action" || isReaction;
  if (chainExists) return isReaction;
  if (state === "showdown") return hasFocus && isAction;
  return state === "neutral";
}

/**
 * Independent placement model for Core Rules 328 and 330. Once a Chain
 * exists, every subsequently played card, activated ability, and queued
 * trigger is assigned to that same Chain; no entry kind can create a sibling
 * Chain while the first one still exists.
 */
export function referenceSingleChainPlacement({
  existingChainId = null,
  entries = []
} = {}) {
  const chainId = existingChainId || (entries.length ? "chain-1" : null);
  return {
    chainCount: chainId ? 1 : 0,
    chainId,
    placements: entries.map((kind) => ({ kind, chainId }))
  };
}

/** Independent target-classification model for Core Rules 355.5-355.10. */
export function referenceTargetClassification({
  mentioned = true,
  specificallyChosen = true,
  zone = "board",
  partOfRestriction = false,
  partOfCostTriggerOrReplacement = false,
  programmaticallySelected = false,
  noChoiceEverPossible = false,
  chosenInWholeOrPartByOtherPlayers = false,
  mustInstruction = false,
  isSourceObject = false
} = {}) {
  const publicZones = new Set([
    "board", "battlefield", "base", "trash", "legend", "champion", "facedown", "chain"
  ]);
  const publicInformation = publicZones.has(zone);
  const excluded = !mentioned
    || !specificallyChosen
    || !publicInformation
    || partOfRestriction
    || partOfCostTriggerOrReplacement
    || (programmaticallySelected && noChoiceEverPossible)
    || chosenInWholeOrPartByOtherPlayers
    || mustInstruction
    || isSourceObject;
  return {
    targeted: !excluded,
    publicInformation,
    choiceTiming: !publicInformation || chosenInWholeOrPartByOtherPlayers || mustInstruction
      ? "resolution"
      : "finalize"
  };
}

/** Independent aggregate-target repair model for Core Rule 355.11. */
export function resolveAggregateTargetsReference({
  originalTargets = [],
  chosenTargetIds = [],
  maxTotal = Number.POSITIVE_INFINITY
} = {}) {
  const originalIds = new Set(originalTargets.map((target) => target.id));
  const chosen = chosenTargetIds
    .map((id) => originalTargets.find((target) => target.id === id))
    .filter(Boolean);
  const oneBattlefield = chosen.length === 0
    || chosen.every((target) => target.battlefieldId === chosen[0].battlefieldId);
  const total = chosen.reduce((sum, target) => sum + (target.might || 0), 0);
  return {
    legal: chosenTargetIds.every((id) => originalIds.has(id)) && oneBattlefield && total <= maxTotal,
    chosenTargetIds: chosen.map((target) => target.id),
    total,
    oneBattlefield
  };
}

/** Independent split-damage choice model for Core Rules 355.14.a-i. */
export function resolveSplitDamageReference({
  initialDamage = 0,
  resolutionDamage = initialDamage,
  declaredTargetIds = [],
  retainedTargetIds = declaredTargetIds,
  allocations = []
} = {}) {
  const declared = new Set(declaredTargetIds);
  const retained = new Set(retainedTargetIds);
  const allocated = new Map(allocations.map((allocation) => [allocation.targetId, allocation.amount]));
  const violations = [];
  if (declared.size > initialDamage) violations.push("too-many-initial-targets");
  if ([...retained].some((id) => !declared.has(id))) violations.push("retargeted-at-resolution");
  if (retained.size > resolutionDamage) violations.push("too-many-resolution-targets");
  if ([...retained].some((id) => !Number.isInteger(allocated.get(id)) || allocated.get(id) < 1)) {
    violations.push("non-positive-or-missing-allocation");
  }
  if ([...allocated].some(([id]) => !retained.has(id))) violations.push("allocation-to-removed-target");
  const totalAllocated = [...allocated.values()].reduce((sum, amount) => sum + amount, 0);
  if (retained.size && totalAllocated !== resolutionDamage) violations.push("damage-not-fully-divided");
  return { legal: violations.length === 0, violations, totalAllocated };
}
