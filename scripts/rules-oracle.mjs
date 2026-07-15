/**
 * Executable Core Rules oracle.
 *
 * This module intentionally imports nothing from the production engine. It
 * observes only the public game state so an engine helper cannot become both
 * the implementation and the expected answer.
 */

export const RULE_ORACLE_CHECKS = Object.freeze([
  rule("RB-107.1.c/RB-323.7", "base-control", "Permanents and runes in a base must be controlled by that base's player."),
  rule("RB-107.3.b", "facedown-capacity", "A facedown zone cannot exceed its current occupancy limit."),
  rule("RB-107.3.c/RB-107.3.d/RB-323.7", "facedown-control", "A facedown card may remain only at a battlefield controlled by its controller."),
  rule("RB-107.4.d", "legend-zone", "A Champion Legend cannot leave its Legend Zone."),
  rule("RB-110", "non-board-reset", "Temporary modifications stop being tracked after a card moves to a non-board zone."),
  rule("RB-128.1", "single-zone", "A card must exist in exactly one game zone."),
  rule("RB-143.2.a/RB-323.5", "lethal-unit", "A stably lethal unit must be killed and leave the board."),
  rule("RB-183", "token-zone", "A token cannot exist outside the board or Chain."),
  rule("RB-187.4/RB-323.6", "battlefield-control", "Stable battlefield control must agree with its occupants."),
  rule("RB-319.8/RB-323.9", "opposition-stages-combat", "Opposing units created by a move must have a staged or active combat."),
  rule("RB-127.1/RB-108", "owned-zone", "A card in a player's private or non-board zone must be owned by that player."),
  rule("RB-142/RB-143.3", "damage-state", "Damage must be a non-negative finite value tracked only on units."),
  rule("RB-702.2/RB-702.3", "buff-state", "A Unit has at most one Buff object and non-Units cannot have Buffs."),
  rule("RB-133.4.a.2/RB-133.4.b.1/RB-133.5.a.1", "zone-type", "Only card types legal for a zone may occupy that zone."),
  rule("RB-127.1/RB-180", "player-reference", "Every recorded owner and controller must identify a player in the game."),
  rule("RB-329.2/RB-329.3/RB-330.1/RB-310.1/RB-310.2/RB-310.3/RB-310.4/RB-337.1.c.3/RB-340.4", "chain-state", "Only one Chain may exist; stable Items are finalized; and a new Execute window belongs to the newest Item's controller."),
  rule("RB-389/RB-390/RB-392/RB-397", "delayed-ability-state", "Delayed abilities retain a controller, lifetime, event condition, object identity, and linked-set identity independently of their source."),
  rule("RB-370.2/RB-370.3/RB-375", "replacement-event-state", "Replacement chains apply each source once, preserve simultaneous-event snapshots, and inherit relevant event modifications."),
  rule("RB-319.1/RB-319.2/RB-319.3/RB-319.4/RB-319.5/RB-319.6/RB-319.7/RB-319.8/RB-321.1/RB-322.1", "cleanup-request-state", "Every Cleanup request records its official cause and remains outstanding across Resolution or an interrupted Cleanup."),
  rule("RB-303.1/RB-321.1/RB-335.2.a", "turn-task-continuation", "A paused turn task must retain an explicit continuation until every intervening choice and Chain finishes."),
  rule("RB-718.5.d/RB-719.3.a", "attachment-state", "An attached card has exactly one board Top-Most card and moves as part of that attachment tree."),
  rule("RB-137.1/RB-423.1.a/RB-729.1.a", "numeric-state", "Might modifiers and public player counters must remain finite and non-negative where the rules require it."),
  rule("RB-460.2.c.5/RB-460.2.c.7/RB-460.2.c.9/RB-815/RB-826", "combat-damage-assignment-priority", "Combat damage choices obey Tank-first, Backline-last, conflicting, and damage-prevention assignment requirements."),
  rule("RB-144.2", "standard-move-cost", "A successful Standard Move exhausts every moved unit as its cost.", "transition"),
  rule("RB-419.4.a/RB-419.4.b", "resolved-play-accounting", "Only a card whose play process completed by resolution is counted as played.", "transition"),
  rule("RB-413.4/RB-431.2", "burn-out-sequence", "An overdraw recycles trash, awards an opponent a point, and then resumes drawing.", "transition"),
  rule("RB-166/RB-315.4.d/RB-317.2.d", "rune-pool-boundary", "Rune Pools persist between actions and empty only after a Draw Phase and at the end of a turn.", "transition"),
  rule("RB-317.2.b/RB-317.2.c/RB-317.2.d", "turn-expiration", "Ending cleanup heals units, expires every previous 'this turn' modifier, and empties Rune Pools.", "transition")
  ,rule("RB-450/RB-451/RB-719.3.a", "recall-preserves-board-state", "Recall relocates a permanent and its attachments to its controller's Base without becoming a Move or clearing board-only state.", "transition")
  ,rule("RB-383.3.d/RB-383.3.d.1", "simultaneous-trigger-order", "A controller orders simultaneous triggers, with controllers making those choices from the turn player forward and later players' groups resolving first.", "transition")
  ,rule("RB-372/RB-373/RB-373.1", "replacement-effect-order", "The affected object's owner orders multiple replacements, and a controller chooses how one replacement is applied across simultaneous events.", "transition")
  ,rule("RB-423.1.a.2", "stunned-ending-boundary", "Stunned expires at the beginning of the next Ending Step before end-of-turn triggers are placed on the Chain.", "transition")
  ,rule("RB-466.1.b/RB-466.1.b.1/RB-466.1.b.2", "winning-score-threshold", "The current mode Victory Score, including modifiers, controls whether Conquer awards the winning point or draws a card instead.", "transition")
]);

const NON_BOARD_ZONE_KINDS = new Set([
  "champion", "mainDeck", "runeDeck", "hand", "trash", "banished"
]);
const OWNER_ZONE_KINDS = new Set([
  "legend", "champion", "availableChampion", "availableBattlefield",
  "mainDeck", "runeDeck", "hand", "trash", "banished"
]);
const BOARD_ZONE_KINDS = new Set(["base", "runes", "battlefieldUnit", "hidden", "attachment", "battlefield"]);
const MAIN_DECK_TYPES = new Set(["unit", "spell", "gear"]);
const PERMANENT_TYPES = new Set(["unit", "gear"]);
const TEMPORARY_FIELDS = Object.freeze([
  "temporaryMight", "temporaryShieldAmount", "combatRole", "cantMoveThisTurn",
  "saveWithRuneUntilTurnSequence",
  "saveWithRuneDomain", "saveWithRuneSourceName", "preparedDeathRecallPaymentApproved",
  "playedFromHidden", "hiddenBattlefieldId", "declaredPlayTargets", "declaredPlayChoices",
  "deflectPaidTargetIds", "paidOptionalPowerEffects", "paidFriendlyExhaustAdditionalCost"
]);

export function evaluateRuleState(game) {
  const observations = collectObservations(game);
  const stable = isStableForRules(game);
  const violations = [];

  checkSingleZone(observations, violations);
  checkOwnedZones(observations, violations);
  checkLegendZones(game, observations, violations);
  checkBaseControl(game, observations, violations);
  checkDamageState(observations, violations);
  checkBuffState(observations, violations);
  checkZoneTypes(observations, violations);
  checkPlayerReferences(game, observations, violations);
  checkChainState(game, violations);
  checkDelayedAbilityState(game, violations);
  checkReplacementEventState(game, observations, stable, violations);
  checkCleanupRequestState(game, violations);
  checkTurnTaskContinuation(game, violations);
  checkAttachmentState(observations, violations);
  checkNumericState(game, observations, violations);
  checkCombatDamageAssignmentPriority(game, violations);
  checkNonBoardReset(observations, violations);
  checkTokenZones(observations, violations);

  if (stable) {
    checkFacedownZones(game, violations);
    checkLethalUnits(game, violations);
    checkBattlefieldControl(game, violations);
    checkOppositionFlow(game, violations);
  }

  return {
    stable,
    checkedRuleIds: RULE_ORACLE_CHECKS.filter((entry) => entry.scope === "state").map((entry) => entry.ruleId),
    observations,
    violations
  };
}

export function assertRuleState(game, context = {}) {
  const result = evaluateRuleState(game);
  if (result.violations.length) throw ruleViolationError(result.violations, context);
  return result;
}

export function captureRuleState(game) {
  const observations = collectObservations(game);
  const cards = {};
  for (const [instanceId, entries] of observations.cards) {
    const first = entries[0];
    cards[instanceId] = {
      instanceId,
      name: first.card.name,
      type: first.card.type,
      ownerId: first.card.ownerId,
      controllerId: first.card.controllerId,
      exhausted: Boolean(first.card.exhausted),
      stunned: Boolean(first.card.stunned),
      damage: first.card.damage || 0,
      buffs: first.card.buffs || 0,
      mightModifier: first.card.mightModifier || 0,
      temporaryMight: first.card.temporaryMight || 0,
      turnScopedState: Boolean(
        first.card.temporaryMight
        || first.card.temporaryKeywords?.length
        || first.card.temporaryShieldAmount
        || first.card.cantMoveThisTurn
        || first.card.movesThisTurn
        || first.card.readyAnotherExhaustedMoveTurnSequence
        || first.card.saveWithRuneUntilTurnSequence != null
      ),
      locations: entries.map((entry) => entry.location),
      movesThisTurn: first.card.movesThisTurn || 0
      ,attachmentIds: (first.card.attachments || []).map((card) => card.instanceId).sort()
    };
  }
  return {
    cards,
    players: Object.fromEntries((game.players || []).map((player) => [player.id, {
      cardsPlayedThisTurn: player.cardsPlayedThisTurn || 0,
      score: player.score || 0,
      burnOuts: player.burnOuts || 0,
      handCount: player.hand?.length || 0,
      mainDeckCount: player.mainDeck?.length || 0,
      trashCount: player.trash?.length || 0,
      turnScopedState: Boolean(
        player.unitsEnterReadyThisTurn
        || player.nextUnitEnterReady
        || player.nextSpellEnergyReduction
        || player.nextSpellBonusDamage
        || player.killDamagedUnitsThisTurn
        || player.enemyUnitsDiedThisTurn
        || player.firstOtherFriendlyUnitDeathDrawnThisTurn
        || player.hideIgnoringCostsUntilTurnSequence != null
        || player.cannotPlayCardsUntilTurnSequence != null
      ),
      runePoolEnergy: Array.isArray(player.runePool?.energy) ? player.runePool.energy.length : Number(player.runePool?.energy || 0),
      runePoolPower: Array.isArray(player.runePool?.power) ? player.runePool.power.length : Number(player.runePool?.power || 0)
    }])),
    pendingPayment: game.pendingPayment ? {
      cardId: game.pendingPayment.cardId,
      destination: game.pendingPayment.destination,
      source: game.pendingPayment.source
    } : null,
    phase: game.phase,
    turnScopedDelayedAbilityCount: (game.delayedAbilities || [])
      .filter((ability) => ability.expiresAfterTurnSequence <= (game.turnSequence || 0)).length,
    turnSequence: game.turnSequence || 0
  };
}

export function evaluateRuleTransition(before, game, context = {}) {
  const after = captureRuleState(game);
  const violations = [];
  const action = normalizeActionContext(context);
  if (action.kind === "standardMove" && action.ok !== false) {
    for (const unitId of action.unitIds) {
      const prior = before?.cards?.[unitId];
      const next = after.cards?.[unitId];
      if (!prior || !next || !changedBoardLocation(prior.locations, next.locations)) continue;
      if (!next.exhausted && next.movesThisTurn <= (prior.movesThisTurn || 0)) {
        addViolation(violations, "standard-move-cost", `${next.name} (${unitId}) changed locations through a Standard Move without remaining exhausted or recording the paid move cost.`, {
          unitId,
          before: prior.locations,
          after: next.locations
        });
      }
    }
  }
  if (action.kind === "cardResolution" && action.playerId) {
    const priorCount = before?.players?.[action.playerId]?.cardsPlayedThisTurn || 0;
    const nextCount = after.players?.[action.playerId]?.cardsPlayedThisTurn || 0;
    const expectedDelta = action.resolved && !action.countered && !action.resolutionPrevented ? 1 : 0;
    const actualDelta = nextCount - priorCount;
    if (actualDelta !== expectedDelta) {
      addViolation(
        violations,
        "resolved-play-accounting",
        `${action.playerId}'s played-card count changed by ${actualDelta}; the resolved play state requires ${expectedDelta}.`,
        { playerId: action.playerId, priorCount, nextCount, expectedDelta, action }
      );
    }
  }
  if (action.kind === "burnOut" && action.playerId && action.opponentId) {
    const expectedCount = action.expectedCount || 1;
    const playerBefore = before?.players?.[action.playerId];
    const playerAfter = after.players?.[action.playerId];
    const opponentBefore = before?.players?.[action.opponentId];
    const opponentAfter = after.players?.[action.opponentId];
    const burnOutDelta = (playerAfter?.burnOuts || 0) - (playerBefore?.burnOuts || 0);
    const pointDelta = (opponentAfter?.score || 0) - (opponentBefore?.score || 0);
    if (burnOutDelta !== expectedCount || pointDelta !== expectedCount) {
      addViolation(violations, "burn-out-sequence", `Burn Out count ${burnOutDelta} awarded ${pointDelta} points; expected ${expectedCount} of each.`, {
        playerId: action.playerId,
        opponentId: action.opponentId,
        burnOutDelta,
        pointDelta,
        expectedCount
      });
    }
    if ((playerBefore?.trashCount || 0) > 0 && (playerAfter?.trashCount || 0) >= (playerBefore?.trashCount || 0)) {
      addViolation(violations, "burn-out-sequence", `${action.playerId}'s trash was not recycled during Burn Out.`, {
        beforeTrash: playerBefore.trashCount,
        afterTrash: playerAfter?.trashCount || 0
      });
    }
  }
  if (action.kind === "turnExpiration" && action.ok !== false) {
    for (const [unitId, prior] of Object.entries(before?.cards || {})) {
      if (!prior.temporaryMight) continue;
      const next = after.cards?.[unitId];
      if (!next || next.temporaryMight === 0) continue;
      addViolation(violations, "turn-expiration", `${next.name} (${unitId}) retained ${next.temporaryMight} previous-turn Might after expiration.`, {
        unitId,
        beforeTemporaryMight: prior.temporaryMight,
        afterTemporaryMight: next.temporaryMight
      });
    }
    for (const [cardId, state] of Object.entries(after.cards || {})) {
      if (!state.turnScopedState) continue;
      addViolation(violations, "turn-expiration", `${state.name} (${cardId}) retained a turn-scoped card state after expiration.`, { cardId, state });
    }
    for (const [playerId, state] of Object.entries(after.players || {})) {
      if (state.turnScopedState) {
        addViolation(violations, "turn-expiration", `${playerId} retained a turn-scoped player state after expiration.`, { playerId, state });
      }
      if (state.runePoolEnergy === 0 && state.runePoolPower === 0) continue;
      addViolation(violations, "turn-expiration", `${playerId}'s Rune Pool did not empty during expiration.`, { playerId, state });
    }
    if (after.turnScopedDelayedAbilityCount > 0) {
      addViolation(violations, "turn-expiration", `${after.turnScopedDelayedAbilityCount} expired delayed abilities remained active.`, {
        count: after.turnScopedDelayedAbilityCount
      });
    }
  }
  if (action.kind === "recall" && action.ok !== false) {
    const healIds = new Set(action.healIds || []);
    const exhaustIds = new Set(action.exhaustIds || []);
    for (const unitId of action.unitIds || []) {
      const prior = before?.cards?.[unitId];
      const next = after.cards?.[unitId];
      if (!prior || !next) {
        addViolation(violations, "recall-preserves-board-state", `Recalled unit ${unitId} disappeared.`, { unitId, prior, next });
        continue;
      }
      const expectedBase = `base:${prior.controllerId}`;
      if (!next.locations.includes(expectedBase)) {
        addViolation(violations, "recall-preserves-board-state", `${next.name} (${unitId}) was not recalled to its controller's Base.`, {
          unitId, expectedBase, locations: next.locations
        });
      }
      for (const field of ["buffs", "mightModifier", "temporaryMight", "stunned"]) {
        if (field === "stunned" || !healIds.has(unitId)) {
          if (next[field] === prior[field]) continue;
          addViolation(violations, "recall-preserves-board-state", `${next.name} (${unitId}) changed ${field} merely because it was recalled.`, {
            unitId, field, before: prior[field], after: next[field]
          });
        }
      }
      if (JSON.stringify(next.attachmentIds) !== JSON.stringify(prior.attachmentIds)) {
        addViolation(violations, "recall-preserves-board-state", `${next.name} (${unitId}) did not carry its attachment tree during Recall.`, {
          unitId, before: prior.attachmentIds, after: next.attachmentIds
        });
      }
      if (!exhaustIds.has(unitId) && next.exhausted !== prior.exhausted) {
        addViolation(violations, "recall-preserves-board-state", `${next.name} (${unitId}) changed ready/exhausted state merely because it was recalled.`, {
          unitId, before: prior.exhausted, after: next.exhausted
        });
      }
      if (healIds.has(unitId) && next.damage !== 0) {
        addViolation(violations, "recall-preserves-board-state", `${next.name} (${unitId}) was instructed to heal during Recall but retained damage.`, {
          unitId, damage: next.damage
        });
      }
    }
  }
  if (action.kind === "showdownCompletion" && action.ok !== false) {
    for (const [playerId, prior] of Object.entries(before?.players || {})) {
      const next = after.players?.[playerId];
      if (!next) continue;
      if (prior.runePoolEnergy === next.runePoolEnergy && prior.runePoolPower === next.runePoolPower) continue;
      addViolation(violations, "rune-pool-boundary", `${playerId}'s Rune Pool changed merely because a Showdown completed.`, {
        playerId,
        before: { energy: prior.runePoolEnergy, power: prior.runePoolPower },
        after: { energy: next.runePoolEnergy, power: next.runePoolPower }
      });
    }
  }
  if (["drawPhaseEnd", "turnExpiration"].includes(action.kind) && action.ok !== false) {
    for (const [playerId, state] of Object.entries(after.players || {})) {
      if (state.runePoolEnergy === 0 && state.runePoolPower === 0) continue;
      addViolation(violations, "rune-pool-boundary", `${playerId}'s Rune Pool did not empty at ${action.kind}.`, { playerId, state });
    }
  }
  if (action.kind === "triggerBatch" && action.ok !== false) {
    const turnOrder = action.turnOrder || [];
    const controllerCounts = action.controllerCounts || {};
    const expectedChooserOrder = turnOrder.filter((playerId) => (controllerCounts[playerId] || 0) > 1);
    if (JSON.stringify(action.chooserOrder || []) !== JSON.stringify(expectedChooserOrder)) {
      addViolation(violations, "simultaneous-trigger-order", "Simultaneous trigger ordering choices were not offered from the turn player forward.", {
        expectedChooserOrder,
        actualChooserOrder: action.chooserOrder || []
      });
    }
    const expectedResolutionControllers = [...turnOrder]
      .filter((playerId) => (controllerCounts[playerId] || 0) > 0)
      .reverse();
    if (JSON.stringify(action.resolutionControllerOrder || []) !== JSON.stringify(expectedResolutionControllers)) {
      addViolation(violations, "simultaneous-trigger-order", "Simultaneous controller groups are not ordered correctly for last-in-first-out Chain resolution.", {
        expectedResolutionControllers,
        actualResolutionControllerOrder: action.resolutionControllerOrder || []
      });
    }
  }
  if (action.kind === "replacementSequence" && action.ok !== false) {
    if ((action.applicableReplacementCount || 0) > 1 && !action.sourceChoiceOffered) {
      addViolation(violations, "replacement-effect-order", "Multiple applicable replacement effects were resolved without the affected object's owner choosing their order.", action);
    }
    if ((action.simultaneousQualifiedEventCount || 0) > 1 && !action.eventChoiceOffered) {
      addViolation(violations, "replacement-effect-order", "One replacement effect qualified for multiple simultaneous events without its controller choosing the event sequence.", action);
    }
  }
  if (action.kind === "endingStepBegin" && action.ok !== false && (action.stunnedIdsAfter || []).length) {
    addViolation(violations, "stunned-ending-boundary", "One or more Units remained Stunned after the beginning of the Ending Step.", {
      stunnedIdsBefore: action.stunnedIdsBefore || [],
      stunnedIdsAfter: action.stunnedIdsAfter || []
    });
  }
  if (action.kind === "conquestScore" && action.ok !== false) {
    const scoreBefore = action.scoreBefore || 0;
    const scoreAfter = action.scoreAfter || 0;
    const drawDelta = action.drawDelta || 0;
    const wouldReachVictory = scoreBefore + 1 >= (action.victoryScore || 0);
    const expectedScoreDelta = wouldReachVictory && !action.scoredAllBattlefields ? 0 : 1;
    const expectedDrawDelta = wouldReachVictory && !action.scoredAllBattlefields ? 1 : 0;
    if (scoreAfter - scoreBefore !== expectedScoreDelta || drawDelta !== expectedDrawDelta) {
      addViolation(violations, "winning-score-threshold", "Conquest scoring did not use the current Victory Score boundary.", {
        scoreBefore,
        scoreAfter,
        victoryScore: action.victoryScore,
        scoredAllBattlefields: Boolean(action.scoredAllBattlefields),
        drawDelta,
        expectedScoreDelta,
        expectedDrawDelta
      });
    }
  }
  return {
    checkedRuleIds: RULE_ORACLE_CHECKS.filter((entry) => entry.scope === "transition").map((entry) => entry.ruleId),
    before,
    after,
    context: action,
    violations
  };
}

export function assertRuleTransition(before, game, context = {}) {
  const result = evaluateRuleTransition(before, game, context);
  if (result.violations.length) throw ruleViolationError(result.violations, context);
  return result;
}

export function createRuleOracleSession() {
  const counts = new Map(RULE_ORACLE_CHECKS.map((entry) => [entry.ruleId, 0]));
  const violations = [];
  return {
    checkState(game, context = {}) {
      const result = evaluateRuleState(game);
      for (const id of result.checkedRuleIds) counts.set(id, (counts.get(id) || 0) + 1);
      violations.push(...result.violations.map((entry) => ({ ...entry, context })));
      if (result.violations.length) throw ruleViolationError(result.violations, context);
      return result;
    },
    checkTransition(before, game, context = {}) {
      const result = evaluateRuleTransition(before, game, context);
      for (const id of result.checkedRuleIds) counts.set(id, (counts.get(id) || 0) + 1);
      violations.push(...result.violations.map((entry) => ({ ...entry, context })));
      if (result.violations.length) throw ruleViolationError(result.violations, context);
      return result;
    },
    report() {
      return {
        rules: RULE_ORACLE_CHECKS.map((entry) => ({ ...entry, evaluations: counts.get(entry.ruleId) || 0 })),
        violations: structuredClone(violations)
      };
    }
  };
}

function collectObservations(game) {
  const cards = new Map();
  const locations = [];
  const observe = (card, kind, ownerId, containerId = null) => {
    if (!card?.instanceId) return;
    const location = `${kind}:${containerId || ownerId || "game"}`;
    const entry = { card, kind, ownerId, containerId, location };
    if (!cards.has(card.instanceId)) cards.set(card.instanceId, []);
    cards.get(card.instanceId).push(entry);
    locations.push(entry);
    for (const attachment of card.attachments || []) observe(attachment, "attachment", ownerId, card.instanceId);
  };

  for (const player of game.players || []) {
    observe(player.legend, "legend", player.id);
    if (player.champion?.zone === "champion") observe(player.champion, "champion", player.id);
    for (const card of player.availableChampions || []) observe(card, "availableChampion", player.id);
    for (const card of player.availableBattlefields || []) observe(card, "availableBattlefield", player.id);
    for (const kind of ["mainDeck", "runeDeck", "hand", "base", "runes", "trash", "banished"]) {
      for (const card of player[kind] || []) observe(card, kind, player.id);
    }
  }
  for (const battlefield of game.battlefields || []) {
    observe(battlefield, "battlefield", battlefield.ownerId, battlefield.instanceId);
    for (const unit of battlefield.units || []) observe(unit, "battlefieldUnit", unit.ownerId, battlefield.instanceId);
    for (const wrapper of battlefield.hidden || []) {
      const card = wrapper?.card || wrapper;
      observe(card, "hidden", card?.ownerId, battlefield.instanceId);
    }
  }
    for (const [chainName, chain] of activeChains(game)) {
      for (const item of chain || []) {
        if (item?.card && (!item.itemType || item.itemType === "card")) {
          observe(item.card, "chain", item.card.ownerId, chainName);
        }
      }
    }
  return { cards, locations };
}

function checkSingleZone(observations, violations) {
  for (const [instanceId, entries] of observations.cards) {
    const unique = [...new Set(entries.map((entry) => entry.location))];
    if (unique.length <= 1) continue;
    addViolation(violations, "single-zone", `${entries[0].card.name} (${instanceId}) exists in multiple zones: ${unique.join(", ")}.`, { instanceId, locations: unique });
  }
}

function checkOwnedZones(observations, violations) {
  for (const entry of observations.locations) {
    if (!OWNER_ZONE_KINDS.has(entry.kind) || !entry.ownerId) continue;
    if (entry.card.ownerId === entry.ownerId) continue;
    addViolation(violations, "owned-zone", `${entry.card.name} (${entry.card.instanceId}) is owned by ${entry.card.ownerId} but is in ${entry.ownerId}'s ${entry.kind}.`, {
      instanceId: entry.card.instanceId,
      ownerId: entry.card.ownerId,
      zoneOwnerId: entry.ownerId,
      zone: entry.kind
    });
  }
}

function checkLegendZones(game, observations, violations) {
  for (const player of game.players || []) {
    if (!player.legend?.instanceId) {
      addViolation(violations, "legend-zone", `${player.id} has no Champion Legend in its Legend Zone.`, { playerId: player.id });
      continue;
    }
    const entries = observations.cards.get(player.legend.instanceId) || [];
    if (!entries.some((entry) => entry.kind === "legend" && entry.ownerId === player.id)) {
      addViolation(violations, "legend-zone", `${player.legend.name} is not in ${player.id}'s Legend Zone.`, { playerId: player.id, instanceId: player.legend.instanceId });
    }
  }
}

function checkBaseControl(game, observations, violations) {
  for (const player of game.players || []) {
    for (const card of [...(player.base || []), ...(player.runes || [])]) {
      if (card.controllerId === player.id) continue;
      addViolation(violations, "base-control", `${card.name} (${card.instanceId}) is in ${player.id}'s base but controlled by ${card.controllerId}.`, {
        instanceId: card.instanceId,
        basePlayerId: player.id,
        controllerId: card.controllerId
      });
    }
  }
}

function checkDamageState(observations, violations) {
  for (const entries of observations.cards.values()) {
    const card = entries[0].card;
    const damage = card.damage ?? 0;
    if (!Number.isFinite(damage) || damage < 0) {
      addViolation(violations, "damage-state", `${card.name} (${card.instanceId}) has invalid damage ${String(damage)}.`, { instanceId: card.instanceId, damage });
    } else if (card.type !== "unit" && damage !== 0) {
      addViolation(violations, "damage-state", `${card.name} (${card.instanceId}) is not a unit but has ${damage} damage.`, { instanceId: card.instanceId, damage, type: card.type });
    }
  }
}

function checkBuffState(observations, violations) {
  for (const entries of observations.cards.values()) {
    const card = entries[0].card;
    const buffs = card.buffs ?? 0;
    const unlimited = card.type === "unit" && /any number of buffs/i.test(card.text || "");
    const exceedsLimit = !unlimited && buffs > 1;
    if (!Number.isInteger(buffs) || buffs < 0 || exceedsLimit || (card.type !== "unit" && buffs !== 0)) {
      addViolation(violations, "buff-state", `${card.name} (${card.instanceId}) has invalid Buff state ${String(buffs)}.`, {
        instanceId: card.instanceId,
        buffs,
        type: card.type,
        unlimitedByCardText: unlimited
      });
    }
  }
}

function checkZoneTypes(observations, violations) {
  for (const entry of observations.locations) {
    const { card, kind } = entry;
    let valid = true;
    if (["mainDeck", "hand", "trash", "banished", "hidden", "chain"].includes(kind)) valid = MAIN_DECK_TYPES.has(card.type);
    else if (kind === "runeDeck" || kind === "runes") valid = card.type === "rune";
    else if (kind === "base") valid = PERMANENT_TYPES.has(card.type);
    else if (kind === "battlefieldUnit") valid = card.type === "unit";
    else if (kind === "legend") valid = card.type === "legend";
    else if (kind === "champion" || kind === "availableChampion") valid = card.type === "unit" && Boolean(card.isChampion || card.tags?.includes("Champion"));
    else if (kind === "battlefield" || kind === "availableBattlefield") valid = card.type === "battlefield";
    if (valid) continue;
    addViolation(violations, "zone-type", `${card.name} (${card.instanceId}) of type ${card.type} cannot occupy ${kind}.`, {
      instanceId: card.instanceId,
      type: card.type,
      zone: kind
    });
  }
}

function checkPlayerReferences(game, observations, violations) {
  const playerIds = new Set((game.players || []).map((player) => player.id));
  for (const entries of observations.cards.values()) {
    const card = entries[0].card;
    for (const field of ["ownerId", "controllerId"]) {
      const value = card[field];
      if (value == null || playerIds.has(value)) continue;
      addViolation(violations, "player-reference", `${card.name} (${card.instanceId}) has unknown ${field} ${value}.`, {
        instanceId: card.instanceId,
        field,
        value
      });
    }
  }
  for (const battlefield of game.battlefields || []) {
    if (battlefield.controlledBy == null || playerIds.has(battlefield.controlledBy)) continue;
    addViolation(violations, "player-reference", `${battlefield.name} is controlled by unknown player ${battlefield.controlledBy}.`, {
      battlefieldId: battlefield.instanceId,
      field: "controlledBy",
      value: battlefield.controlledBy
    });
  }
}

function checkChainState(game, violations) {
  const actionChainExists = Boolean(game.actionChain);
  const showdownExists = Boolean(game.showdown);
  if (actionChainExists && showdownExists) {
    addViolation(violations, "chain-state", "A neutral Chain and a Showdown Chain exist simultaneously.", {
      actionItems: game.actionChain?.chain?.length || 0,
      showdownItems: game.showdown?.chain?.length || 0
    });
  }
  if (game.phase === "showdown" && !showdownExists) {
    addViolation(violations, "chain-state", "The turn is in Showdown state without a Showdown.", { phase: game.phase });
  }
  if (showdownExists && game.phase !== "showdown") {
    addViolation(violations, "chain-state", `A Showdown exists while the phase is ${game.phase}.`, { phase: game.phase });
  }
  if (actionChainExists && game.phase === "showdown") {
    addViolation(violations, "chain-state", "A neutral action Chain exists during a Showdown.", { phase: game.phase });
  }
  const activeChain = actionChainExists ? game.actionChain : showdownExists ? game.showdown : null;
  const items = activeChain?.chain || [];
  const unresolvedTask = Boolean(
    game.pendingChoice || game.pendingPayment || game.resolvingChainContext
    || game.resolvingGameEffect || game.inCleanup || game.cleanupOutstanding
  );
  const pending = items.filter((item) => item.status === "pending");
  if (pending.length && !unresolvedTask) {
    addViolation(violations, "chain-state", "Pending Chain Items remained after all outstanding Tasks completed.", {
      pendingItemIds: pending.map((item) => item.id || item.card?.instanceId || null)
    });
  }
  if (items.length && !pending.length && (activeChain.consecutivePasses || 0) === 0) {
    const newestControllerId = items.at(-1).playerId;
    if (newestControllerId && activeChain.priorityPlayerId !== newestControllerId) {
      addViolation(violations, "chain-state", "The newest finalized Chain Item's controller did not receive Priority.", {
        expectedPriorityPlayerId: newestControllerId,
        actualPriorityPlayerId: activeChain.priorityPlayerId
      });
    }
  }
}

function checkDelayedAbilityState(game, violations) {
  const playerIds = new Set((game.players || []).map((player) => player.id));
  const records = game.delayedAbilities;
  if (records !== undefined && !Array.isArray(records)) {
    addViolation(violations, "delayed-ability-state", "Delayed abilities are not stored as an ordered collection.", {
      actualType: typeof records
    });
    return;
  }
  const ids = new Set();
  for (const record of records || []) {
    const details = { delayedAbilityId: record?.id || null };
    if (!record || typeof record !== "object") {
      addViolation(violations, "delayed-ability-state", "A delayed ability record is not an object.", details);
      continue;
    }
    if (typeof record.id !== "string" || !record.id || ids.has(record.id)) {
      addViolation(violations, "delayed-ability-state", "A delayed ability has a missing or reused event identity.", details);
    } else ids.add(record.id);
    if (!["triggered", "replacement", "passive"].includes(record.abilityClass)) {
      addViolation(violations, "delayed-ability-state", "A delayed ability has no recognized ability classification.", {
        ...details, abilityClass: record.abilityClass
      });
    }
    if (!playerIds.has(record.controllerId)) {
      addViolation(violations, "delayed-ability-state", "A delayed ability has no current controller.", {
        ...details, controllerId: record.controllerId
      });
    }
    if (typeof record.condition !== "string" || !record.condition) {
      addViolation(violations, "delayed-ability-state", "A delayed ability has no event condition.", details);
    }
    if (!Number.isInteger(record.createdTurnSequence) || !Number.isInteger(record.expiresAfterTurnSequence)
      || record.expiresAfterTurnSequence < record.createdTurnSequence) {
      addViolation(violations, "delayed-ability-state", "A delayed ability has an invalid creation or expiration lifetime.", {
        ...details,
        createdTurnSequence: record.createdTurnSequence,
        expiresAfterTurnSequence: record.expiresAfterTurnSequence
      });
    }
    if (typeof record.linkedSetId !== "string" || !record.linkedSetId) {
      addViolation(violations, "delayed-ability-state", "A delayed ability is not attached to an explicit linked set.", details);
    }
    if (record.condition === "unitTakesDamage"
      && (typeof record.targetId !== "string" || !record.targetId || !Number.isInteger(record.targetZoneChangeCounter))) {
      addViolation(violations, "delayed-ability-state", "A delayed unit event does not preserve the target object's identity.", {
        ...details,
        targetId: record.targetId,
        targetZoneChangeCounter: record.targetZoneChangeCounter
      });
    }
  }

  for (const [, items] of activeChains(game)) {
    for (const item of items) {
      const trigger = item?.trigger;
      if (trigger?.kind !== "delayedKillDamagedUnit") continue;
      const data = trigger.data || {};
      if (typeof data.delayedAbilityId === "string" && data.delayedAbilityId
        && typeof trigger.linkedSetId === "string" && trigger.linkedSetId
        && typeof data.targetId === "string" && data.targetId
        && Number.isInteger(data.targetZoneChangeCounter)
        && playerIds.has(trigger.playerId)
        && !(records || []).some((record) => record.id === data.delayedAbilityId)) continue;
      addViolation(violations, "delayed-ability-state", "A queued delayed trigger lost its consumed event, target, controller, or linked-set identity.", {
        delayedAbilityId: data.delayedAbilityId || null,
        linkedSetId: trigger.linkedSetId || null,
        targetId: data.targetId || null,
        targetZoneChangeCounter: data.targetZoneChangeCounter,
        playerId: trigger.playerId
      });
    }
  }
}

function checkReplacementEventState(game, observations, stable, violations) {
  for (const entries of observations.cards.values()) {
    const card = entries[0].card;
    const event = card.lastReplacementEvent;
    if (!event) continue;
    const applied = event.appliedReplacementKeys;
    if (typeof event.rootEventId !== "string" || !event.rootEventId
      || typeof event.eventId !== "string" || !event.eventId
      || !Array.isArray(applied) || new Set(applied).size !== applied.length) {
      addViolation(violations, "replacement-event-state", `${card.name} has an invalid replacement-event identity or applies one source more than once.`, {
        instanceId: card.instanceId,
        event
      });
      continue;
    }
    const modifications = event.modifications || {};
    if (modifications.ready === true && card.exhausted) {
      addViolation(violations, "replacement-event-state", `${card.name} did not inherit the replaced event's ready modification.`, {
        instanceId: card.instanceId,
        event
      });
    }
    if (modifications.temporary === true && card.temporary !== true) {
      addViolation(violations, "replacement-event-state", `${card.name} did not inherit the replaced event's Temporary modification.`, {
        instanceId: card.instanceId,
        event
      });
    }
  }
  if (stable && game.cleanupDeathReplacementBatch) {
    addViolation(violations, "replacement-event-state", "A simultaneous replacement candidate snapshot remained after its Cleanup sequence ended.", {
      signature: game.cleanupDeathReplacementBatch.signature || null
    });
  }
}

const CLEANUP_REQUEST_RULES = Object.freeze({
  "state-transition": "319.1",
  "phase-transition": "319.2",
  "pending-item-added": "319.3",
  "pending-item-finalized": "319.4",
  "chain-item-removed": "319.5",
  "board-zone-change": "319.6",
  "object-status-change": "319.7",
  "move-completed": "319.8",
  "chain-resolution-deferred": "321.1",
  "cleanup-repeat": "322.1",
  "ending-special-cleanup": "317.2.a",
  "combat-special-cleanup": "324.1"
});

function checkCleanupRequestState(game, violations) {
  const trace = game.cleanupRequestTrace || [];
  let previousSequence = 0;
  for (const entry of trace) {
    const expectedRuleId = CLEANUP_REQUEST_RULES[entry?.cause];
    if (!Number.isInteger(entry?.sequence) || entry.sequence <= previousSequence
      || !expectedRuleId || entry.ruleId !== expectedRuleId
      || typeof entry.duringCleanup !== "boolean" || typeof entry.duringResolution !== "boolean") {
      addViolation(violations, "cleanup-request-state", "A Cleanup request has an invalid sequence, cause, rule mapping, or execution boundary.", {
        entry,
        expectedRuleId: expectedRuleId || null,
        previousSequence
      });
    }
    if (Number.isInteger(entry?.sequence)) previousSequence = Math.max(previousSequence, entry.sequence);
  }
  if (game.cleanupOutstanding && trace.length === 0) {
    addViolation(violations, "cleanup-request-state", "Cleanup is Outstanding without a recorded qualifying event.", {});
  }
  if (game.cleanupRequested && !game.inCleanup) {
    addViolation(violations, "cleanup-request-state", "A repeated Cleanup request exists outside an active Cleanup.", {});
  }
}

function checkTurnTaskContinuation(game, violations) {
  const continuations = [
    game.actionChain?.continuation,
    game.triggerQueueContinuation,
    game.pendingChoice?.data?.continuation,
    game.pendingPayment?.effectPayment?.continuation
  ].filter(Boolean);
  const hasContinuation = (kind, playerId) => continuations.some((continuation) =>
    continuation.kind === kind && (!playerId || continuation.playerId === playerId));
  const paused = Boolean(game.pendingChoice || game.pendingPayment || game.actionChain || game.triggerQueue?.length);

  if (game.startTurnProcess) {
    const { playerId, step } = game.startTurnProcess;
    const validPlayer = (game.players || []).some((player) => player.id === playerId);
    const validStep = ["beginning", "scoring", "channel", "draw", "drawCleanup"].includes(step);
    if (!validPlayer || !validStep || (paused && !hasContinuation("continueStartTurn", playerId))) {
      addViolation(violations, "turn-task-continuation", `Start-of-turn task for ${playerId || "unknown"} at ${step || "unknown"} has no valid continuation owner.`, {
        playerId,
        step,
        continuations
      });
    }
  }

  if (game.endTurnProcess) {
    const { playerId, step } = game.endTurnProcess;
    const validPlayer = (game.players || []).some((player) => player.id === playerId);
    const validStep = ["endingTriggers", "expiration", "expirationCleanup"].includes(step);
    const internallyOwned = step === "expirationCleanup" && game.endingCleanupProcess?.playerId === playerId;
    if (!validPlayer || !validStep || (paused && !internallyOwned && !hasContinuation("continueEndTurn", playerId))) {
      addViolation(violations, "turn-task-continuation", `End-of-turn task for ${playerId || "unknown"} at ${step || "unknown"} has no valid continuation owner.`, {
        playerId,
        step,
        continuations
      });
    }
  }

  if (game.endingCleanupProcess) {
    const { playerId, specialApplied, itemsUnderwentFepr } = game.endingCleanupProcess;
    const ownsEndingTask = game.endTurnProcess?.playerId === playerId
      && game.endTurnProcess?.step === "expirationCleanup";
    if (!ownsEndingTask || typeof specialApplied !== "boolean" || typeof itemsUnderwentFepr !== "boolean") {
      addViolation(violations, "turn-task-continuation", `Ending Cleanup for ${playerId || "unknown"} has no valid internal Task owner.`, {
        playerId,
        endTurnProcess: game.endTurnProcess || null,
        specialApplied,
        itemsUnderwentFepr
      });
    }
  }

  if (game.combatCleanupProcess) {
    const { battlefieldId, attackerId, defenderId, specialApplied } = game.combatCleanupProcess;
    const validBattlefield = (game.battlefields || []).some((battlefield) => battlefield.instanceId === battlefieldId);
    const validAttacker = (game.players || []).some((player) => player.id === attackerId);
    const validDefender = (game.players || []).some((player) => player.id === defenderId);
    if (!validBattlefield || !validAttacker || !validDefender || attackerId === defenderId || typeof specialApplied !== "boolean") {
      addViolation(violations, "turn-task-continuation", `Combat Cleanup at ${battlefieldId || "unknown"} has no valid internal Task owner.`, {
        battlefieldId,
        attackerId,
        defenderId,
        specialApplied
      });
    }
  }

  if (game.showdownExitProcess) {
    const { battlefieldId, turnPlayerId, attackerId, defenderId, combat } = game.showdownExitProcess;
    const validBattlefield = (game.battlefields || []).some((battlefield) => battlefield.instanceId === battlefieldId);
    const playerIds = new Set((game.players || []).map((player) => player.id));
    if (!validBattlefield || !playerIds.has(turnPlayerId) || !playerIds.has(attackerId)
      || !playerIds.has(defenderId) || attackerId === defenderId || typeof combat !== "boolean") {
      addViolation(violations, "turn-task-continuation", `Showdown exit at ${battlefieldId || "unknown"} has no valid Cleanup continuation owner.`, {
        battlefieldId,
        turnPlayerId,
        attackerId,
        defenderId,
        combat
      });
    }
  }

  const stagedEndTurnOwner = Boolean(game.showdown || game.stagedEvents?.length || game.pendingChoice?.effect === "stagedEvent");
  if (game.pendingEndTurnPlayerId && !game.endTurnProcess && !stagedEndTurnOwner) {
    addViolation(violations, "turn-task-continuation", `End-of-turn task for ${game.pendingEndTurnPlayerId} has no valid continuation owner.`, {
      playerId: game.pendingEndTurnPlayerId,
      continuations
    });
  }
}

function checkAttachmentState(observations, violations) {
  for (const entry of observations.locations) {
    if (entry.kind !== "attachment") continue;
    const parentEntries = observations.cards.get(entry.containerId) || [];
    const boardParents = parentEntries.filter((candidate) => ["base", "battlefieldUnit"].includes(candidate.kind));
    if (boardParents.length === 1 && PERMANENT_TYPES.has(boardParents[0].card.type)) continue;
    addViolation(violations, "attachment-state", `${entry.card.name} (${entry.card.instanceId}) has no unique board Top-Most permanent.`, {
      instanceId: entry.card.instanceId,
      topMostId: entry.containerId,
      parentLocations: parentEntries.map((candidate) => candidate.location)
    });
  }
}

function checkNumericState(game, observations, violations) {
  for (const entries of observations.cards.values()) {
    const card = entries[0].card;
    for (const field of ["mightModifier", "temporaryMight"]) {
      const value = card[field] ?? 0;
      if (Number.isFinite(value)) continue;
      addViolation(violations, "numeric-state", `${card.name} (${card.instanceId}) has non-finite ${field}.`, {
        instanceId: card.instanceId,
        field,
        value: String(value)
      });
    }
    if (card.type === "unit" && !Number.isFinite(card.might)) {
      addViolation(violations, "numeric-state", `${card.name} (${card.instanceId}) has non-finite inherent Might.`, {
        instanceId: card.instanceId,
        field: "might",
        value: String(card.might)
      });
    }
    if (card.stunned != null && typeof card.stunned !== "boolean") {
      addViolation(violations, "numeric-state", `${card.name} (${card.instanceId}) has a non-binary Stunned state.`, {
        instanceId: card.instanceId,
        field: "stunned",
        value: card.stunned
      });
    }
  }
  for (const player of game.players || []) {
    for (const field of ["score", "xp"]) {
      const value = player[field] ?? 0;
      if (Number.isInteger(value) && value >= 0) continue;
      addViolation(violations, "numeric-state", `${player.id} has invalid ${field} ${String(value)}.`, { playerId: player.id, field, value });
    }
  }
}

function checkCombatDamageAssignmentPriority(game, violations) {
  const choice = game.pendingChoice;
  if (choice?.effect !== "combatDamage") return;
  const battlefield = (game.battlefields || []).find((field) => field.instanceId === choice.data?.battlefieldId);
  if (!battlefield) return;
  const remaining = choice.data?.remaining || 0;
  const targetRole = choice.data?.role === "attacker" ? "defender" : "attacker";
  const candidates = (battlefield.units || [])
    .filter((unit) => unit.controllerId === choice.data?.targetPlayerId)
    .map((unit) => {
      const damagePrevented = hasEffect(unit, "static", "preventDamageAfterSecondMove") && (unit.movesThisTurn || 0) >= 2;
      const lethalRemaining = damagePrevented
        ? Number.POSITIVE_INFINITY
        : Math.max(0, referenceCombatMight(game, battlefield, unit, targetRole) - (unit.damage || 0));
      return {
        unit,
        damagePrevented,
        lethalRemaining,
        lethalNow: !damagePrevented && lethalRemaining > 0 && lethalRemaining <= remaining,
        first: !damagePrevented && hasKeywordReference(unit, "Tank"),
        last: !damagePrevented && (
          hasKeywordReference(unit, "Backline")
          || hasEffect(unit, "static", "combatDamageAssignmentLast")
        )
      };
    });
  let active = candidates.filter((candidate) => candidate.lethalRemaining > 0);
  if (!active.length) active = candidates;
  const mandatoryFirst = active.filter((candidate) => candidate.first && !candidate.last);
  const conflicting = active.filter((candidate) => candidate.first && candidate.last);
  const ordinary = active.filter((candidate) => !candidate.first && !candidate.last);
  let priorityEligible;
  if (mandatoryFirst.length) priorityEligible = [...mandatoryFirst, ...conflicting];
  else if (ordinary.length) priorityEligible = [...ordinary, ...conflicting];
  else priorityEligible = active;
  const lethalEligible = priorityEligible.filter((candidate) => candidate.lethalNow);
  const expected = new Set((lethalEligible.length ? lethalEligible : priorityEligible).map((candidate) => candidate.unit.instanceId));
  const offered = new Set((choice.options || []).map((option) => option.cardId).filter(Boolean));
  if (setsEqual(expected, offered)) return;
  addViolation(violations, "combat-damage-assignment-priority", "The combat damage choice exposes targets outside the legal first/last assignment tier.", {
    expected: [...expected],
    offered: [...offered],
    remaining
  });
}

function checkNonBoardReset(observations, violations) {
  for (const entry of observations.locations) {
    if (!NON_BOARD_ZONE_KINDS.has(entry.kind)) continue;
    const card = entry.card;
    const retained = [];
    if ((card.damage || 0) !== 0) retained.push(`damage=${card.damage}`);
    if ((card.buffs || 0) !== 0) retained.push(`buffs=${card.buffs}`);
    if ((card.mightModifier || 0) !== 0) retained.push(`mightModifier=${card.mightModifier}`);
    if (card.stunned) retained.push("stunned");
    if (card.exhausted) retained.push("exhausted");
    if ((card.temporaryKeywords || []).length) retained.push("temporaryKeywords");
    if ((card.attachments || []).length) retained.push("attachments");
    for (const field of TEMPORARY_FIELDS) {
      if (card[field] != null && card[field] !== false && card[field] !== 0 && field !== "temporaryKeywords") retained.push(field);
    }
    if (!retained.length) continue;
    addViolation(violations, "non-board-reset", `${card.name} (${card.instanceId}) retains temporary state in ${entry.kind}: ${[...new Set(retained)].join(", ")}.`, {
      instanceId: card.instanceId,
      zone: entry.kind,
      retained: [...new Set(retained)]
    });
  }
}

function checkTokenZones(observations, violations) {
  for (const entry of observations.locations) {
    if (!isToken(entry.card)) continue;
    if (BOARD_ZONE_KINDS.has(entry.kind) || entry.kind === "chain") continue;
    addViolation(violations, "token-zone", `${entry.card.name} token (${entry.card.instanceId}) illegally exists in ${entry.kind}.`, {
      instanceId: entry.card.instanceId,
      zone: entry.kind
    });
  }
}

function checkFacedownZones(game, violations) {
  for (const battlefield of game.battlefields || []) {
    const hidden = battlefield.hidden || [];
    const limit = facedownLimit(battlefield);
    if (hidden.length > limit) {
      addViolation(violations, "facedown-capacity", `${battlefield.name} contains ${hidden.length} facedown cards but its limit is ${limit}.`, {
        battlefieldId: battlefield.instanceId,
        count: hidden.length,
        limit
      });
    }
    for (const wrapper of hidden) {
      const card = wrapper?.card || wrapper;
      if (!card) continue;
      if (battlefield.controlledBy === card.controllerId) continue;
      addViolation(violations, "facedown-control", `${card.name} (${card.instanceId}) remains facedown at ${battlefield.name}, controlled by ${battlefield.controlledBy || "no one"}.`, {
        instanceId: card.instanceId,
        battlefieldId: battlefield.instanceId,
        battlefieldControllerId: battlefield.controlledBy,
        cardControllerId: card.controllerId
      });
    }
  }
}

function checkLethalUnits(game, violations) {
  for (const { unit, zone } of boardUnits(game)) {
    const might = referenceCurrentMight(game, unit, zone);
    if (!(unit.damage > 0 && unit.damage >= might)) continue;
    addViolation(violations, "lethal-unit", `${unit.name} (${unit.instanceId}) is still in ${zone.kind} with ${unit.damage} damage and ${might} current Might.`, {
      instanceId: unit.instanceId,
      damage: unit.damage,
      might,
      zone: zone.kind
    });
  }
}

function checkBattlefieldControl(game, violations) {
  const turnIsOpen = !game.actionChain && !(game.showdown?.chain || []).length;
  if (!turnIsOpen) return;
  for (const battlefield of game.battlefields || []) {
    if (game.showdown?.battlefieldId === battlefield.instanceId || battlefield.contestedBy
      || (game.stagedEvents || []).some((event) => event.battlefieldId === battlefield.instanceId)) continue;
    if (battlefield.controlledBy == null
      || (battlefield.units || []).some((unit) => unit.controllerId === battlefield.controlledBy)) continue;
    addViolation(violations, "battlefield-control", `${battlefield.name} is controlled by ${battlefield.controlledBy}, but that player has no unit there during an Open-state cleanup.`, {
      battlefieldId: battlefield.instanceId,
      actual: battlefield.controlledBy,
      expected: null
    });
  }
}

function checkOppositionFlow(game, violations) {
  if (game.phase !== "action" || game.showdown) return;
  for (const battlefield of game.battlefields || []) {
    const controllers = new Set((battlefield.units || []).map((unit) => unit.controllerId).filter(Boolean));
    if (controllers.size < 2) continue;
    const staged = (game.stagedEvents || []).some((event) => event.battlefieldId === battlefield.instanceId && event.type === "combat");
    if (staged) continue;
    addViolation(violations, "opposition-stages-combat", `${battlefield.name} has opposing units but no staged or active combat.`, {
      battlefieldId: battlefield.instanceId,
      controllers: [...controllers]
    });
  }
}

function referenceCurrentMight(game, unit, zone) {
  const controller = (game.players || []).find((player) => player.id === unit.controllerId);
  const nearby = zone.kind === "battlefieldUnit"
    ? zone.battlefield.units
    : zone.kind === "base"
      ? zone.player.base.filter((card) => card.type === "unit")
      : [];
  let amount = (unit.might || 0) + (unit.buffs || 0) + (unit.mightModifier || 0);
  for (const gear of unit.attachments || []) amount += effectAmount(gear, "static", "attachedMight", gear.might || 0);
  amount += hasEffect(unit, "static", "selfMightByPoints") ? (controller?.score || 0) : 0;
  amount += hasEffect(unit, "static", "selfMightByTrash") ? (controller?.trash?.length || 0) : 0;
  for (const effect of effects(unit, "static", "runeThresholdMight")) {
    if ((controller?.runes?.length || 0) >= (effect.threshold || 8)) amount += effect.amount || 0;
  }
  if ((unit.buffs || 0) > 0) amount += effectAmount(unit, "static", "selfMightWhileBuffed", 0);
  if (hasEffect(unit, "static", "selfMightByBuffedFriendlyHere")) {
    amount += nearby.filter((candidate) => candidate.controllerId === unit.controllerId && (candidate.buffs || 0) > 0).length
      * effectAmount(unit, "static", "selfMightByBuffedFriendlyHere", 1);
  }
  for (const source of nearby) {
    if (source.instanceId === unit.instanceId) continue;
    if (source.controllerId === unit.controllerId) {
      amount += effectAmount(source, "static", "otherFriendlyHereMight", 0);
      if ((unit.buffs || 0) > 0) amount += effectAmount(source, "static", "otherBuffedFriendlyHereMight", 0);
    } else if (unit.stunned) {
      amount += effectAmount(source, "static", "stunnedEnemyHereMight", 0);
    }
  }
  if (zone.battlefield) amount += effectAmount(zone.battlefield, "static", "unitsHereMight", 0);
  return Math.max(0, amount);
}

function referenceCombatMight(game, battlefield, unit, role) {
  const zone = { kind: "battlefieldUnit", battlefield };
  let amount = referenceCurrentMight(game, unit, zone);
  if (role === "attacker" && hasKeywordReference(unit, "Assault")) {
    amount += referenceKeywordAmount(unit, "Assault", 1);
  }
  if (role === "defender" && (hasKeywordReference(unit, "Shield") || hasEffect(unit, "static", "shield"))) {
    amount += referenceKeywordAmount(unit, "Shield", 1)
      + effectAmount(unit, "static", "shield", 0)
      + (unit.temporaryKeywordAmounts?.shield == null ? (unit.temporaryShieldAmount || 0) : 0);
  }
  const allies = (battlefield.units || []).filter((candidate) => candidate.controllerId === unit.controllerId);
  if (allies.length === 1) {
    amount += effectAmount(unit, "static", "selfMightWhileAloneCombat", 0);
    const controller = (game.players || []).find((player) => player.id === unit.controllerId);
    if (role === "defender") amount += effectAmount(controller?.legend, "static", "defendAloneMight", 0);
  }
  return Math.max(0, amount);
}

function hasKeywordReference(card, keyword) {
  const expected = keyword.toLowerCase();
  return [...(card?.keywords || []), ...(card?.temporaryKeywords || [])]
    .some((candidate) => String(candidate).toLowerCase() === expected);
}

function referenceKeywordAmount(card, keyword, fallback = 1) {
  const expected = keyword.toLowerCase();
  const printedCount = (card?.keywords || []).filter((candidate) => String(candidate).toLowerCase() === expected).length;
  const temporaryCount = (card?.temporaryKeywords || []).filter((candidate) => String(candidate).toLowerCase() === expected).length;
  const temporary = card?.temporaryKeywordAmounts?.[expected];
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...String(card?.text || "").matchAll(new RegExp(`\\[\\s*${escaped}(?:\\s+(\\d+))?\\s*\\]`, "gi"))];
  const printed = matches.length
    ? matches.reduce((sum, match) => sum + (match[1] == null ? fallback : Number(match[1])), 0)
      + Math.max(0, printedCount - matches.length) * fallback
    : printedCount * fallback;
  const temporaryValue = temporary != null ? Number(temporary) || 0 : temporaryCount * fallback;
  return printed + temporaryValue;
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function boardUnits(game) {
  const output = [];
  for (const player of game.players || []) {
    for (const unit of (player.base || []).filter((card) => card.type === "unit")) {
      output.push({ unit, zone: { kind: "base", player } });
    }
  }
  for (const battlefield of game.battlefields || []) {
    for (const unit of battlefield.units || []) output.push({ unit, zone: { kind: "battlefieldUnit", battlefield } });
  }
  return output;
}

function facedownLimit(battlefield) {
  return 1 + effects(battlefield, "static", "additionalHiddenSlots")
    .reduce((sum, effect) => sum + (effect.amount || 1), 0);
}

function activeChains(game) {
  return [
    ["action", game.actionChain?.chain || []],
    ["showdown", game.showdown?.chain || []]
  ];
}

function effects(card, timing, kind) {
  return (card?.effects || []).filter((effect) => effect.timing === timing && effect.kind === kind);
}

function hasEffect(card, timing, kind) {
  return effects(card, timing, kind).length > 0;
}

function effectAmount(card, timing, kind, fallback = 0) {
  return effects(card, timing, kind).reduce((sum, effect) => sum + (effect.amount ?? fallback), 0);
}

function isToken(card) {
  return Boolean(card?.isToken || (card?.tags || []).some((tag) => String(tag).toLowerCase() === "token"));
}

function isStableForRules(game) {
  return !(
    game.pendingChoice || game.pendingPayment || game.actionChain || game.inCleanup
    || game.startTurnProcess || game.pendingEndTurnPlayerId || game.triggerQueue?.length || game.triggerQueueContinuation
    || (game.operations || []).some((operation) => operation.status === "pending")
  );
}

function normalizeActionContext(context) {
  if (context.kind) return {
    ...structuredClone(context),
    kind: context.kind,
    unitIds: [...(context.unitIds || [])],
    ok: context.ok,
    playerId: context.playerId,
    opponentId: context.opponentId,
    expectedCount: context.expectedCount,
    resolved: Boolean(context.resolved),
    countered: Boolean(context.countered),
    resolutionPrevented: Boolean(context.resolutionPrevented)
  };
  const label = String(context.action || context.description || "");
  const parts = label.split(":");
  if (parts[0] === "move") return {
    kind: "standardMove",
    unitIds: parts[1] ? parts[1].split(",").filter(Boolean) : [],
    ok: !label.endsWith(":rejected")
  };
  return { kind: parts[0] || "unknown", unitIds: [], ok: !label.endsWith(":rejected") };
}

function changedBoardLocation(before = [], after = []) {
  const prior = before.find((location) => /^(base|battlefieldUnit):/.test(location));
  const next = after.find((location) => /^(base|battlefieldUnit):/.test(location));
  return Boolean(prior && next && prior !== next);
}

function addViolation(violations, checkId, message, details = {}) {
  const definition = RULE_ORACLE_CHECKS.find((entry) => entry.checkId === checkId);
  violations.push({
    ruleId: definition?.ruleId || "RB-UNKNOWN",
    checkId,
    message,
    details
  });
}

function rule(ruleId, checkId, summary, scope = "state") {
  return Object.freeze({ ruleId, checkId, summary, scope });
}

function ruleViolationError(violations, context) {
  const label = context.action || context.description || context.kind || "state check";
  const error = new Error(`Core Rules oracle found ${violations.length} violation(s) after ${label}: ${violations.map((entry) => `[${entry.ruleId}] ${entry.message}`).join(" | ")}`);
  error.name = "CoreRulesViolationError";
  error.violations = violations;
  return error;
}
