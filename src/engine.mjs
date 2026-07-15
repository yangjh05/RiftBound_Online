import { decklists } from "./cards.mjs";

import { cards as cardRegistry } from "./cards.mjs";
import { TARGET_PROVIDERS, effectDefinition, spellTargetDeclaration } from "./effects/registry.mjs";
import {
  cardEffects,
  effectIsEnabled,
  effectIsEnabledByMutation,
  firstCardEffect,
  hasAnyEffect,
  hasStaticEffect,
  replacementEffect,
  staticEffectAmount,
  staticEffectAmountTotal
} from "./effects/runtime.mjs";
import { championMatchesLegend, createPlayers, isChampionCard } from "./engine/setup.mjs";
import {
  addTemporaryKeyword,
  cardReactionPermissionSources,
  keywordPlayEffectSpecs,
  keywordListCount,
  keywordListHas,
  printedKeywordValue,
  temporaryKeywordValue
} from "./rules/keywords.mjs";
import { resolveLayeredNumber } from "./rules/layers.mjs";
import { officialTokenDefinition } from "./rules/tokens.mjs";
import { hiddenCardControllerId, hiddenCardIsControlledBy } from "./rules/zones.mjs";

export function createGame(options = {}) {
  const sourceDecks = Array.isArray(options.decks) && options.decks.length >= 2
    ? options.decks
    : [decklists.keenanXiong, decklists.drowsy];
  const players = createPlayers(sourceDecks);
  const unavailableBattlefields = options.unavailableBattlefields || {};
  for (const player of players) {
    const unavailable = new Set(unavailableBattlefields[player.id] || []);
    player.availableBattlefields = player.availableBattlefields.filter((field) =>
      !unavailable.has(field.cardNumber) && !unavailable.has(field.collectorNumber));
  }
  const sanctionedFormat = options.format === "match" ? "match" : "duel";
  const firstPlayerId = options.firstPlayerId
    || (options.randomFirstPlayer ? players[Math.floor(Math.random() * players.length)].id : players[0].id);
  const firstPlayer = players.find((player) => player.id === firstPlayerId) || players[0];
  const turnOrder = [
    firstPlayer.id,
    ...players.filter((player) => player.id !== firstPlayer.id).map((player) => player.id)
  ];
  const game = {
    mode: "duel",
    sanctionedFormat,
    battlefieldSelectionMode: options.battlefieldSelectionMode
      || (sanctionedFormat === "match" ? "manual" : "random"),
    victoryScore: 8,
    players,
    turnOrder,
    firstPlayerId: firstPlayer.id,
    currentPlayerId: firstPlayer.id,
    championSelectPlayerId: null,
    setupPlayerId: null,
    turnNumber: 1,
    turnSequence: 0,
    phase: "first-player",
    interactive: Boolean(options.interactive),
    manualActionChainPriority: Boolean(options.manualActionChainPriority),
    enforceChampionLegendMatch: true,
    battlefields: [],
    mulligan: null,
    showdown: null,
    actionChain: null,
    pendingPayment: null,
    pendingChoice: null,
    cleanupOutstanding: false,
    triggerQueue: [],
    triggerQueueContinuation: null,
    stagedEvents: [],
    operations: [],
    lifecycleEvents: [],
    nextOperationSequence: 0,
    ruleTaskTrace: [],
    nextRuleTaskSequence: 0,
    cleanupRequestTrace: [],
    nextCleanupRequestSequence: 0,
    revealedIntel: [],
    effectFlash: null,
    selectedCardId: players[0].legend.instanceId,
    log: []
  };
  if (Number.isInteger(options.randomSeed)) game.deterministicRandomState = options.randomSeed >>> 0;
  const setupRandom = typeof options.random === "function" ? options.random : Math.random;
  game.setupRandomValues = players.map(() => Number(setupRandom()));
  game.setupBattlefieldSelections = {};
  game.forcedBattlefieldSelections = options.lockedBattlefields || null;

  log(game, `${firstPlayer.name} wins the random first-player roll.`);
  return game;
}

export function confirmFirstPlayer(game) {
  if (game.phase !== "first-player") return fail(game, "First player has already been confirmed.");
  const first = game.players.find((player) => player.id === game.firstPlayerId) || game.players[0];
  game.phase = "champion-select";
  game.currentPlayerId = first.id;
  game.championSelectPlayerId = first.id;
  game.setupPlayerId = first.id;
  game.selectedCardId = first.legend.instanceId;
  log(game, "Each player chooses one starting champion.");
  return { ok: true };
}

export function isChosenChampion(game, playerId, card) {
  if (!card) return false;
  const player = game.players.find((candidate) => candidate.id === playerId);
  return Boolean(player?.chosenChampionName && isChampionCard(card) && card.name === player.chosenChampionName);
}

function shuffle(cards, game = null) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(nextShuffleRandom(game) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function nextShuffleRandom(game) {
  if (!Number.isInteger(game?.deterministicRandomState)) return Math.random();
  let state = game.deterministicRandomState >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  game.deterministicRandomState = state >>> 0;
  return (game.deterministicRandomState >>> 0) / 4294967296;
}

export function selectBattlefield(game, playerId, battlefieldId) {
  if (game.phase !== "battlefield-select") return fail(game, "Battlefield selection is already complete.");
  if (game.setupPlayerId !== playerId) return fail(game, "It is not that player's battlefield selection.");
  const player = game.players.find((candidate) => candidate.id === playerId);
  const chosenIndex = player.availableBattlefields.findIndex((field) => field.instanceId === battlefieldId || field.id === battlefieldId);
  if (chosenIndex < 0) return fail(game, "Unknown battlefield.");
  const [chosen] = player.availableBattlefields.splice(chosenIndex, 1);
  stageBattlefieldSelection(game, player, chosen);

  const next = turnOrderedPlayers(game).find((candidate) => !candidate.selectedBattlefieldId);
  if (next) {
    game.setupPlayerId = next.id;
    return { ok: true };
  }

  finalizeBattlefieldSelections(game);
  return { ok: true };
}

function stageBattlefieldSelection(game, player, chosen) {
  game.setupBattlefieldSelections ||= {};
  player.selectedBattlefieldId = chosen.instanceId;
  game.setupBattlefieldSelections[player.id] = chosen;
  game.selectedCardId = chosen.instanceId;
  log(game, `${player.name} selects a Battlefield.`);
}

function finalizeBattlefieldSelections(game) {
  const selected = turnOrderedPlayers(game).map((player) => ({
    player,
    battlefield: game.setupBattlefieldSelections?.[player.id]
  }));
  if (selected.some(({ battlefield }) => !battlefield)) return false;
  for (const { player, battlefield } of selected) {
    game.battlefields.push({
      ...battlefield,
      controlledBy: null,
      units: [],
      hidden: []
    });
    log(game, `${player.name} reveals ${battlefield.name}.`);
  }
  game.setupBattlefieldSelections = {};
  game.setupPlayerId = null;
  log(game, "Battlefields are set. Each player may mulligan up to 2 cards.");
  beginMulligans(game);
  return true;
}

function randomlySelectBattlefields(game) {
  for (const [playerIndex, player] of turnOrderedPlayers(game).entries()) {
    if (!player.availableBattlefields.length) return fail(game, `${player.name} has no unused Battlefield.`);
    const randomValue = Number(game.setupRandomValues?.[playerIndex] ?? Math.random());
    const index = Math.min(player.availableBattlefields.length - 1,
      Math.max(0, Math.floor(randomValue * player.availableBattlefields.length)));
    const [chosen] = player.availableBattlefields.splice(index, 1);
    stageBattlefieldSelection(game, player, chosen);
  }
  delete game.setupRandomValues;
  finalizeBattlefieldSelections(game);
  return { ok: true };
}

export function selectChampion(game, playerId, championId) {
  if (game.phase !== "champion-select") return fail(game, "Champion selection is already complete.");
  if (game.championSelectPlayerId !== playerId) return fail(game, "It is not that player's champion selection.");
  const player = game.players.find((candidate) => candidate.id === playerId);
  const index = player.availableChampions.findIndex((card) => card.instanceId === championId || card.id === championId);
  if (index < 0) return fail(game, "Unknown champion.");
  if (!championMatchesLegend(player.availableChampions[index], player.legend)) return fail(game, "Chosen Champion must share a Champion tag with the current Legend.");

  const [chosen] = player.availableChampions.splice(index, 1);
  player.champion = chosen;
  setChampionZoneState(player, chosen, "champion");
  player.chosenChampionName = chosen.name;
  recycleMainDeckCards(game, player, player.availableChampions);
  player.availableChampions = [];
  game.selectedCardId = chosen.instanceId;
  log(game, `${player.name} chooses ${chosen.name} as their starting champion.`);

  const next = turnOrderedPlayers(game).find((candidate) => !candidate.champion);
  if (next) {
    game.championSelectPlayerId = next.id;
    game.currentPlayerId = next.id;
    return { ok: true };
  }

  game.championSelectPlayerId = null;
  game.setupPlayerId = game.firstPlayerId;
  game.currentPlayerId = game.firstPlayerId;
  for (const candidate of game.players) {
    candidate.mainDeck = shuffle(candidate.mainDeck, game);
    candidate.runeDeck = shuffle(candidate.runeDeck, game);
    draw(candidate, 4);
  }
  game.phase = "battlefield-select";
  log(game, game.battlefieldSelectionMode === "random"
    ? "Each player randomly selects one starting Battlefield."
    : "Each player selects one starting Battlefield.");
  if (game.forcedBattlefieldSelections) {
    for (const candidate of turnOrderedPlayers(game)) {
      const cardNumber = game.forcedBattlefieldSelections[candidate.id];
      const battlefield = candidate.availableBattlefields.find((field) => field.cardNumber === cardNumber || field.collectorNumber === cardNumber);
      if (!battlefield) return fail(game, "The Battlefield locked after a draw is not registered.");
      const result = selectBattlefield(game, candidate.id, battlefield.instanceId);
      if (!result.ok) return result;
    }
  } else if (game.battlefieldSelectionMode === "random") {
    return randomlySelectBattlefields(game);
  }
  return { ok: true };
}

function beginMulligans(game) {
  const first = turnOrderedPlayers(game)[0];
  game.phase = "mulligan";
  game.currentPlayerId = first.id;
  game.mulligan = {
    playerId: first.id,
    selectedCardIds: []
  };
  log(game, `${first.name} chooses cards to mulligan.`);
}

function advanceMulligan(game) {
  const ordered = turnOrderedPlayers(game);
  const currentIndex = ordered.findIndex((player) => player.id === game.mulligan?.playerId);
  const next = ordered[currentIndex + 1];
  if (next) {
    game.currentPlayerId = next.id;
    game.mulligan = {
      playerId: next.id,
      selectedCardIds: []
    };
    log(game, `${next.name} chooses cards to mulligan.`);
    return;
  }

  game.mulligan = null;
  game.currentPlayerId = game.firstPlayerId;
  log(game, "Mulligans are complete. The first turn begins.");
  startTurn(game);
}

export function toggleMulliganCard(game, cardId) {
  if (game.phase !== "mulligan" || !game.mulligan) return fail(game, "Mulligan is not active.");
  const player = game.players.find((candidate) => candidate.id === game.mulligan.playerId);
  if (!player.hand.some((card) => card.instanceId === cardId)) return fail(game, "That card is not in the mulligan player's hand.");

  const selected = new Set(game.mulligan.selectedCardIds);
  if (selected.has(cardId)) selected.delete(cardId);
  else {
    if (selected.size >= 2) return fail(game, "You can mulligan at most 2 cards.");
    selected.add(cardId);
  }
  game.mulligan.selectedCardIds = [...selected];
  game.selectedCardId = cardId;
  return { ok: true };
}

export function confirmMulligan(game) {
  if (game.phase !== "mulligan" || !game.mulligan) return fail(game, "Mulligan is not active.");
  const player = game.players.find((candidate) => candidate.id === game.mulligan.playerId);
  const selected = new Set(game.mulligan.selectedCardIds);
  if (selected.size > 2) return fail(game, "You can mulligan at most 2 cards.");
  const bottomed = [];
  player.hand = player.hand.filter((card) => {
    if (!selected.has(card.instanceId)) return true;
    bottomed.push(card);
    return false;
  });
  draw(player, bottomed.length, game);
  recycleMainDeckCards(game, player, bottomed);
  log(game, `${player.name} mulligans ${bottomed.length} card${bottomed.length === 1 ? "" : "s"} and draws ${bottomed.length}.`);
  advanceMulligan(game);
  return { ok: true };
}

export function skipMulligan(game) {
  if (game.phase !== "mulligan" || !game.mulligan) return fail(game, "Mulligan is not active.");
  const player = game.players.find((candidate) => candidate.id === game.mulligan.playerId);
  log(game, `${player.name} keeps their opening hand.`);
  advanceMulligan(game);
  return { ok: true };
}

export function currentPlayer(game) {
  return game.players.find((player) => player.id === game.currentPlayerId);
}

export function actingPlayer(game) {
  const playerId = game.pendingPayment?.playerId
    || game.pendingChoice?.playerId
    || game.actionChain?.priorityPlayerId
    || (game.phase === "showdown" ? game.showdown?.priorityPlayerId : null)
    || game.currentPlayerId;
  return game.players.find((player) => player.id === playerId) || currentPlayer(game);
}

function controllerOfCard(game, card) {
  return game.players.find((player) => player.id === card?.controllerId)
    || game.players.find((player) => player.id === card?.ownerId)
    || null;
}

function turnOrderedPlayers(game) {
  const ids = game.turnOrder || game.players.map((player) => player.id);
  return ids.map((id) => game.players.find((player) => player.id === id)).filter(Boolean);
}

function nextPlayerId(game, playerId) {
  const ordered = turnOrderedPlayers(game);
  const index = ordered.findIndex((player) => player.id === playerId);
  return ordered[(index + 1) % ordered.length]?.id || playerId;
}

function turnOrderFrom(game, playerId) {
  const ordered = turnOrderedPlayers(game);
  const index = Math.max(0, ordered.findIndex((player) => player.id === playerId));
  return [...ordered.slice(index), ...ordered.slice(0, index)];
}

export function selectCard(game, cardId) {
  if (findCard(game, cardId)) game.selectedCardId = cardId;
}

export function getSelectedCard(game) {
  return findCard(game, game.selectedCardId) || currentPlayer(game)?.champion || game.players[0].legend;
}

function revealPrivateInfoForTurn(game, viewerId, ownerId, source) {
  game.revealedIntel ||= [];
  const existing = game.revealedIntel.find((item) =>
    item.viewerId === viewerId && item.ownerId === ownerId && item.expiresAtTurnSequence === game.turnSequence
  );
  if (!existing) {
    game.revealedIntel.push({
      viewerId,
      ownerId,
      sourceCardId: source?.instanceId || null,
      sourceName: source?.name || "Effect",
      expiresAtTurnSequence: game.turnSequence
    });
  }
}

function clearTurnIntel(game, turnSequence) {
  game.revealedIntel = (game.revealedIntel || []).filter((item) => item.expiresAtTurnSequence !== turnSequence);
}

function clearExpiredIntel(game) {
  game.revealedIntel = (game.revealedIntel || []).filter((item) => item.expiresAtTurnSequence >= game.turnSequence);
}

export function startTurn(game) {
  const player = currentPlayer(game);
  game.phase = "action";
  game.showdown = null;
  game.turnSequence = (game.turnSequence || 0) + 1;
  clearExpiredIntel(game);
  player.turnScoredBattlefields = new Set();
  player.cardsPlayedThisTurn = 0;
  player.drawCountThisTurn = 0;
  player.discardedCardsThisTurn = 0;
  player.unitsEnterReadyThisTurn = false;
  player.nextUnitEnterReady = false;
  player.nextSpellEnergyReduction = 0;
  player.killDamagedUnitsThisTurn = false;
  player.preventedDeathsThisTurn = 0;
  for (const candidate of game.players) {
    candidate.enemyUnitsDiedThisTurn = 0;
    candidate.firstOtherFriendlyUnitDeathDrawnThisTurn = false;
  }
  for (const field of game.battlefields) delete field.spellFriendlyTargetDrawnThisTurn;
  clearRunePool(player);

  // "This turn" Might modifiers are tracked separately so actual Buff objects survive.
  for (const candidate of game.players) {
    for (const card of allControlledCards(game, candidate.id)) {
      if (!card.temporaryMight) continue;
      card.mightModifier = (card.mightModifier || 0) - card.temporaryMight;
      delete card.temporaryMight;
    }
  }

  const controlledCardsAtReadyStep = [...new Map([
    ...allControlledCards(game, player.id),
    ...game.battlefields.filter((field) => field.controlledBy === player.id)
  ].map((card) => [card.instanceId, card])).values()];
  for (const card of controlledCardsAtReadyStep) {
    card.cantMoveThisTurn = false;
    delete card.temporaryKeywords;
    delete card.temporaryKeywordAmounts;
    delete card.temporaryShieldAmount;
    delete card.movesThisTurn;
    delete card.readyAnotherExhaustedMoveTurnSequence;
  }
  for (const candidate of game.players) {
    candidate.runes = candidate.runes.filter((rune) => !rune.temporaryResource);
    if (candidate.id !== player.id) clearRunePool(candidate);
  }
  recordRuleTask(game, "315.1.b", "awaken");
  log(game, `${player.name} starts turn ${game.turnNumber}.`);
  game.startTurnProcess = { playerId: player.id, step: "beginning" };
  const { triggers: readyTriggers } = readyCardsAndCollectTriggers(
    game,
    player,
    null,
    controlledCardsAtReadyStep,
    { reason: "ready-step" }
  );
  if (readyTriggers.length) {
    prepareAndQueueTriggers(
      game,
      readyTriggers,
      game.interactive ? "actionChain" : "queue",
      { kind: "continueStartTurn", playerId: player.id }
    );
    return;
  }
  continueStartTurnProcess(game, player.id);
}

function continueStartTurnProcess(game, playerId) {
  const process = game.startTurnProcess;
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!process || process.playerId !== playerId || !player) return false;
  if (game.pendingChoice || game.pendingPayment || game.actionChain || game.triggerQueue?.length) return true;
  const continuation = { kind: "continueStartTurn", playerId };

  if (process.step === "beginning") {
    process.step = "scoring";
    recordRuleTask(game, "315.2.a.1", "beginning-effects");
    const triggers = collectStartOfBeginningTriggers(game, player);
    if (triggers.length) {
      prepareAndQueueTriggers(game, triggers, game.interactive ? "actionChain" : "queue", continuation);
      return true;
    }
  }

  if (process.step === "scoring") {
    process.step = "channel";
    recordRuleTask(game, "315.2.b.2", "hold-battlefields");
    if (scoreHoldingBattlefields(game, player, continuation)) return true;
  }

  if (process.step === "channel") {
    process.step = "draw";
    recordRuleTask(game, "315.3.b", "channel-runes");
    const isLastPlayerFirstTurn = !player.hasTakenFirstTurn && player.id === turnOrderedPlayers(game).at(-1)?.id;
    channelRunes(game, player, isLastPlayerFirstTurn ? 3 : 2, {
      exhausted: false,
      responsiblePlayerId: null,
      reason: "turn-channel"
    });
  }

  if (process.step === "draw") {
    process.step = "drawCleanup";
    recordRuleTask(game, "315.4.b", "draw-card");
    if (draw(player, 1, game, {
      triggerMode: game.interactive ? "actionChain" : "queue",
      continuation
    })) return true;
    if (game.phase === "complete") {
      delete game.startTurnProcess;
      return false;
    }
  }

  if (process.step === "drawCleanup") {
    recordRuleTask(game, "315.4.d", "empty-rune-pools");
    clearAllRunePools(game);
    player.hasTakenFirstTurn = true;
    delete game.startTurnProcess;
    checkState(game);
  }
  return false;
}

export function endTurn(game) {
  if (game.pendingPayment || game.pendingChoice || game.actionChain) return fail(game, "Finish the current chain first.");
  if (game.phase !== "action") return fail(game, "The game is not in the action phase.");
  const player = currentPlayer(game);
  game.pendingEndTurnPlayerId = player.id;
  checkState(game);
  return { ok: true };
}

function beginEndingPhase(game, playerId) {
  if (game.endTurnProcess || game.pendingEndTurnPlayerId !== playerId) return false;
  game.endTurnProcess = { playerId, step: "endingTriggers" };
  for (const unit of allUnits(game)) unit.stunned = false;
  recordRuleTask(game, "423.1.a.2", "clear-stunned-at-ending-step");
  requestCleanup(game, "phase-transition", { phase: "ending" });
  checkState(game);
  return true;
}

function continueEndTurnProcess(game, playerId) {
  const process = game.endTurnProcess;
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!process || process.playerId !== playerId || !player) return false;
  if (game.pendingChoice || game.pendingPayment || game.actionChain || game.triggerQueue?.length) return true;
  if (process.step === "endingTriggers") {
    process.step = "expiration";
    recordRuleTask(game, "317.1.a", "ending-effects");
    const triggers = collectEndTurnTriggers(game, player);
    if (triggers.length) {
      prepareAndQueueTriggers(
        game,
        triggers,
        game.interactive ? "actionChain" : "queue",
        { kind: "continueEndTurn", playerId: player.id }
      );
      return true;
    }
  }
  if (process.step === "expiration") {
    process.step = "expirationCleanup";
    recordRuleTask(game, "317.2.a", "ending-special-cleanup");
    game.endingCleanupProcess = {
      playerId,
      specialApplied: false,
      itemsUnderwentFepr: false
    };
    requestCleanup(game, "ending-special-cleanup", { playerId });
    checkState(game);
    return true;
  }
  if (process.step === "expirationCleanup") {
    const repeatExpiration = Boolean(game.endingCleanupProcess?.itemsUnderwentFepr);
    recordRuleTask(game, "317.2.f", "check-expiration-fepr", { repeated: repeatExpiration });
    delete game.endingCleanupProcess;
    if (repeatExpiration) {
      process.step = "expiration";
      continueEndTurnProcess(game, playerId);
      return true;
    }
    delete game.endTurnProcess;
    finishPendingEndTurn(game);
    return true;
  }
  return false;
}

function finishPendingEndTurn(game) {
  const playerId = game.pendingEndTurnPlayerId;
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  game.currentPlayerId = playerId;
  delete game.pendingEndTurnPlayerId;
  clearTurnIntel(game, game.turnSequence);
  recordRuleTask(game, "317.3", "advance-turn-player");
  log(game, `${player.name} ends the turn. All units heal.`);

  const ordered = turnOrderedPlayers(game);
  const currentIndex = ordered.findIndex((candidate) => candidate.id === player.id);
  const nextIndex = (currentIndex + 1) % ordered.length;
  if (game.extraTurnPlayerId) {
    game.additionalTurnQueue ||= [];
    game.additionalTurnQueue.unshift(game.extraTurnPlayerId);
    delete game.extraTurnPlayerId;
  }
  const additionalPlayerId = game.additionalTurnQueue?.shift() || null;
  if (additionalPlayerId) {
    if (!game.currentTurnIsAdditional) {
      game.additionalTurnReturnPlayerId = ordered[nextIndex].id;
      game.additionalTurnReturnIncrementsTurnNumber = nextIndex === 0;
    }
    game.currentPlayerId = additionalPlayerId;
    game.currentTurnIsAdditional = true;
  } else if (game.currentTurnIsAdditional) {
    if (game.additionalTurnReturnIncrementsTurnNumber) game.turnNumber += 1;
    game.currentPlayerId = game.additionalTurnReturnPlayerId || ordered[nextIndex].id;
    delete game.currentTurnIsAdditional;
    delete game.additionalTurnReturnPlayerId;
    delete game.additionalTurnReturnIncrementsTurnNumber;
  } else {
    if (nextIndex === 0) game.turnNumber += 1;
    game.currentPlayerId = ordered[nextIndex].id;
  }
  if (!game.additionalTurnQueue?.length) delete game.additionalTurnQueue;
  startTurn(game);
  return true;
}

function expireThisTurnEffects(game) {
  delete game.preventSpellAbilityDamageUntilTurnSequence;
  game.delayedAbilities = (game.delayedAbilities || [])
    .filter((ability) => ability.expiresAfterTurnSequence > (game.turnSequence || 0));
  if (!game.delayedAbilities.length) delete game.delayedAbilities;
  for (const player of game.players) {
    player.cardsPlayedThisTurn = 0;
    player.drawCountThisTurn = 0;
    player.discardedCardsThisTurn = 0;
    player.unitsEnterReadyThisTurn = false;
    player.nextUnitEnterReady = false;
    player.nextSpellEnergyReduction = 0;
    player.nextSpellBonusDamage = 0;
    player.killDamagedUnitsThisTurn = false;
    player.preventedDeathsThisTurn = 0;
    player.enemyUnitsDiedThisTurn = 0;
    player.firstOtherFriendlyUnitDeathDrawnThisTurn = false;
    delete player.hideIgnoringCostsUntilTurnSequence;
    delete player.cannotPlayCardsUntilTurnSequence;
    player.runes = player.runes.filter((rune) => !rune.temporaryResource);
  }
  for (const field of game.battlefields) delete field.spellFriendlyTargetDrawnThisTurn;
  for (const card of [...allUnits(game), ...allGear(game)]) {
    if (card.temporaryMight) card.mightModifier = (card.mightModifier || 0) - card.temporaryMight;
    delete card.temporaryMight;
    delete card.temporaryKeywords;
    delete card.temporaryKeywordAmounts;
    delete card.temporaryShieldAmount;
    delete card.cantMoveThisTurn;
    delete card.movesThisTurn;
    delete card.readyAnotherExhaustedMoveTurnSequence;
    card.damagePreventions = (card.damagePreventions || [])
      .filter((prevention) => prevention.expiresAtTurnSequence > (game.turnSequence || 0));
    if (!card.damagePreventions.length) delete card.damagePreventions;
    clearPreparedDeathRecall(card);
  }
}

function applyEndingSpecialCleanup(game) {
  const process = game.endingCleanupProcess;
  if (!process || process.specialApplied) return false;
  recordRuleTask(game, "317.2.b", "heal-all-units");
  healUnits(game, allUnits(game), { reason: "ending-special-cleanup" });
  recordRuleTask(game, "317.2.c", "expire-this-turn-effects");
  expireThisTurnEffects(game);
  recordRuleTask(game, "317.2.d", "empty-rune-pools");
  clearAllRunePools(game);
  process.specialApplied = true;
  return true;
}

export function surrender(game, playerId) {
  if (game.phase === "complete") return fail(game, "The game is already complete.");
  const player = game.players.find((candidate) => candidate.id === playerId);
  const winner = game.players.find((candidate) => candidate.id !== playerId);
  if (!player || !winner) return fail(game, "That player is not in this game.");
  game.phase = "complete";
  game.winnerId = winner.id;
  game.surrenderedPlayerId = player.id;
  game.showdown = null;
  game.actionChain = null;
  game.pendingPayment = null;
  game.pendingChoice = null;
  log(game, `${player.name} surrenders. ${winner.name} wins the game.`);
  return { ok: true };
}

export function playChampion(game, destination = "base") {
  if (game.pendingPayment || game.pendingChoice) return fail(game, "Finish the current choice first.");
  if (game.phase !== "action" && game.phase !== "showdown") return fail(game, "You cannot play your champion during this phase.");
  const player = actingPlayer(game);
  if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
  if (!player.champion) return fail(game, "Choose a champion first.");
  if (player.championPlayed) return fail(game, "Champion has already been played.");
  if (player.champion.zone !== "champion") return fail(game, "Champion is not in the Champion Zone.");
  if (!canPlayCardAtCurrentTiming(game, player, player.champion, destination)) {
    return fail(game, "That champion cannot be played at the current timing.");
  }
  if (!hasRequiredPlayTargets(game, player, player.champion, destination)) return fail(game, `${player.champion.name} cannot enter there.`);
  return beginCardPlayProcess(game, player, player.champion, destination, "champion", true);
}

export function playCard(game, cardId, destination = "base") {
  if (game.pendingPayment || game.pendingChoice) return fail(game, "Finish the current choice first.");
  if (game.phase === "showdown") return playShowdownCard(game, cardId, destination);
  if (game.phase !== "action") return fail(game, "You must finish setup before playing cards.");
  const player = actingPlayer(game);
  if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
  const cardIndex = player.hand.findIndex((card) => card.instanceId === cardId);
  if (cardIndex < 0) return fail(game, "That card is not in hand.");
  const card = player.hand[cardIndex];
  if (!canPlayCardAtCurrentTiming(game, player, card, destination)) {
    return fail(game, "That card cannot be played at the current timing.");
  }
  if (!hasRequiredPlayTargets(game, player, card, destination)) return fail(game, `${card.name} has no legal target.`);
  return beginCardPlayProcess(game, player, card, destination, "hand", true);
}

export function beginPlayCard(game, cardId, destination = "base") {
  if (!game.interactive) return playCard(game, cardId, destination);
  if (game.pendingPayment || game.pendingChoice) return fail(game, "Finish the current choice first.");
  if (game.phase !== "action" && game.phase !== "showdown") return fail(game, "You cannot play cards during this phase.");
  const player = actingPlayer(game);
  if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
  const card = player.hand.find((candidate) => candidate.instanceId === cardId);
  if (!card) {
    const hidden = findHiddenCardLocation(game, cardId);
    if (hidden) return playHiddenCard(game, hidden, destination);
    return fail(game, "That card is not in hand.");
  }
  if (!canPlayCardAtCurrentTiming(game, player, card, destination)) {
    return fail(game, "That card cannot be played now.");
  }
  if (!hasRequiredPlayTargets(game, player, card, destination)) return fail(game, `${card.name} has no legal target.`);
  return beginCardPlayProcess(game, player, card, destination, "hand", false);
}

function beginCardPlayProcess(game, player, card, destination, source, automatic) {
  const item = placePendingCardOnChain(game, player, card, destination, source);
  if (!item) return fail(game, `${card.name} could not enter the Chain.`);

  if (automatic) {
    return beginAutomaticCardPayment(game, player, card, destination, source, { pendingItem: item });
  }
  const declaration = promptPlayTargetDeclaration(game, player, card, destination, source, item);
  if (declaration.opened) return { ok: true };
  if (declaration.required) {
    rollbackPendingCardPlay(game, { playProcess: { chainItemId: item.id } });
    return fail(game, `${card.name} can no longer complete its required declarations.`);
  }
  const payment = createPayment(game, player, card, destination, source);
  attachPendingPlayToPayment(payment, item);
  game.pendingPayment = payment;
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} is paying for ${card.name}.`);
  return { ok: true };
}

function placePendingCardOnChain(game, player, card, destination, source) {
  const inShowdown = game.phase === "showdown" && Boolean(game.showdown);
  const existingActionChain = Boolean(game.actionChain);
  const chainState = inShowdown ? game.showdown : ensureActionChain(game, player.id);
  if (!chainState) return null;
  const items = inShowdown ? normalizeChainItems(chainState) : normalizeActionChainItems(chainState);
  const chosenChampion = player.champion?.instanceId === card.instanceId;
  const process = {
    source,
    originIndex: null,
    priorZoneChangeCounter: card.zoneChangeCounter || 0,
    createdActionChain: !inShowdown && !existingActionChain,
    priorConsecutivePasses: chainState.consecutivePasses || 0,
    priorChainOpenedBy: chainState.chainOpenedBy || null,
    priorPriorityPlayerId: chainState.priorityPlayerId || null,
    priorCurrentPlayerId: game.currentPlayerId,
    timingPermission: inShowdown
      ? (items.length ? "reaction" : "actionOrReaction")
      : (existingActionChain ? "reaction" : "neutral")
  };

  if (source === "hand") {
    process.originIndex = player.hand.findIndex((candidate) => candidate.instanceId === card.instanceId);
    if (process.originIndex < 0) return null;
    player.hand.splice(process.originIndex, 1);
    markNonBoardZoneChange(card);
  } else if (source === "champion") {
    if (player.champion?.instanceId !== card.instanceId) return null;
    process.originChampionZone = card.zone || "champion";
    markNonBoardZoneChange(card);
    setChampionZoneState(player, card, "chain");
  } else if (source === "hidden") {
    const hidden = findHiddenCardLocation(game, card.instanceId);
    if (!hidden || !hiddenCardIsControlledBy(hidden, player.id)) return null;
    process.originIndex = hidden.index;
    process.originHidden = {
      battlefieldId: hidden.battlefield.instanceId,
      ownerId: hidden.ownerId,
      hiddenByPlayerId: hidden.hiddenByPlayerId,
      playableFromTurnSequence: hidden.playableFromTurnSequence
    };
    recordRevealEvent(game, player, [card], card, "facedown");
    hidden.battlefield.hidden.splice(hidden.index, 1);
    markNonBoardZoneChange(card);
    card.hidden = false;
    card.playedFromHidden = true;
    card.hiddenBattlefieldId = hidden.battlefield.instanceId;
    if (chosenChampion) setChampionZoneState(player, card, "chain");
  }

  const item = addPendingChainItem(game, chainState, card, player.id, destination, {
    declarationsComplete: false,
    isChampion: chosenChampion
  });
  item.playOptions.playProcess = process;
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} puts ${card.name} onto the Chain as Pending.`);
  return item;
}

function attachPendingPlayToPayment(payment, item) {
  payment.playProcess = {
    chainItemId: item.id,
    card: item.card
  };
  return payment;
}

function rollbackPendingCardPlay(game, payment) {
  const item = findChainItemById(game, payment?.playProcess?.chainItemId);
  if (!item) return false;
  const process = item.playOptions?.playProcess || {};
  const player = game.players.find((candidate) => candidate.id === item.playerId);
  const chainState = game.showdown?.chain?.includes(item) ? game.showdown : game.actionChain;
  if (!player || !chainState) return false;

  const index = chainState.chain.indexOf(item);
  if (index >= 0) {
    chainState.chain.splice(index, 1);
    requestCleanup(game, "chain-item-removed", { itemId: item.id, reason: "play-rollback" });
  }
  if (process.source === "hand" && !player.hand.some((candidate) => candidate.instanceId === item.card.instanceId)) {
    const originIndex = Math.max(0, Math.min(process.originIndex ?? player.hand.length, player.hand.length));
    player.hand.splice(originIndex, 0, item.card);
  } else if (process.source === "champion") {
    setChampionZoneState(player, item.card, process.originChampionZone || "champion");
  } else if (process.source === "hidden") {
    const battlefield = game.battlefields.find((field) => field.instanceId === process.originHidden?.battlefieldId);
    if (battlefield && !findHiddenCardLocation(game, item.card.instanceId)) {
      item.card.hidden = true;
      if (player.champion?.instanceId === item.card.instanceId) setChampionZoneState(player, item.card, "hidden");
      delete item.card.playedFromHidden;
      delete item.card.hiddenBattlefieldId;
      const originIndex = Math.max(0, Math.min(process.originIndex ?? battlefield.hidden.length, battlefield.hidden.length));
      battlefield.hidden.splice(originIndex, 0, {
        card: item.card,
        ownerId: process.originHidden.ownerId,
        hiddenByPlayerId: process.originHidden.hiddenByPlayerId,
        playableFromTurnSequence: process.originHidden.playableFromTurnSequence
      });
    }
  }

  if (process.createdActionChain && game.actionChain === chainState && chainState.chain.length === 0) {
    game.actionChain = null;
  } else {
    chainState.consecutivePasses = process.priorConsecutivePasses || 0;
    if (process.priorChainOpenedBy) chainState.chainOpenedBy = process.priorChainOpenedBy;
    else delete chainState.chainOpenedBy;
    if (process.priorPriorityPlayerId) chainState.priorityPlayerId = process.priorPriorityPlayerId;
  }
  if (process.priorCurrentPlayerId) game.currentPlayerId = process.priorCurrentPlayerId;
  item.card.zoneChangeCounter = process.priorZoneChangeCounter || 0;
  game.selectedCardId = null;
  return true;
}

function pendingCardPaymentLegality(game, player, card, payment) {
  const item = findChainItemById(game, payment.playProcess?.chainItemId);
  if (!item || item.card?.instanceId !== card.instanceId || item.status !== "pending") {
    return { ok: false, message: "The card is no longer a Pending Chain item." };
  }
  if (!canPlayerPlayCards(game, player)) return { ok: false, message: "That player can no longer play cards." };

  const process = item.playOptions?.playProcess || {};
  if (process.timingPermission === "neutral" && game.phase !== "action") {
    return { ok: false, message: "That card is no longer legally timed." };
  }
  if (process.timingPermission === "actionOrReaction") {
    if (game.phase !== "showdown" || (!card.tags?.includes("Action")
      && !pendingCardRetainsReactionPermission(game, player, card, payment.destination, process))) {
      return { ok: false, message: "That card is no longer legally timed." };
    }
  }
  if (process.timingPermission === "reaction"
    && !pendingCardRetainsReactionPermission(game, player, card, payment.destination, process)) {
    return { ok: false, message: "That card is no longer legally timed." };
  }
  if (card.type === "unit") {
    if (payment.destination !== "base") {
      const battlefield = game.battlefields.find((field) =>
        field.instanceId === payment.destination || field.id === payment.destination);
      if (!battlefield || !canEnterBattlefield(game, player, card, battlefield)) {
        return { ok: false, message: `${card.name} can no longer enter that location.` };
      }
    }
  }
  if (!declaredPlayTargetsRemainLegal(game, player, card, payment)) {
    return { ok: false, message: `${card.name} no longer has legal declared targets.` };
  }
  return { ok: true };
}

function pendingCardRetainsReactionPermission(game, player, card, destination, process) {
  if (process.source !== "hidden") return cardHasReactionTimingPermission(game, player, card, destination);
  if (game.phase !== "showdown" || !game.showdown || card.hiddenBattlefieldId !== game.showdown.battlefieldId) return false;
  const battlefield = game.battlefields.find((field) => field.instanceId === card.hiddenBattlefieldId);
  return Boolean(battlefield && !battlefield.units.some((unit) =>
    unit.controllerId !== player.id && hasStaticEffect(unit, "opponentsHiddenCantRevealHere")));
}

function declaredPlayTargetsRemainLegal(game, player, card, payment) {
  const costEffects = new Set([
    "killFriendlyUnitAdditionalCost",
    "killFriendlyUnitsAdditionalCost",
    "spendFriendlyBuffsAdditionalCost"
  ]);
  const targets = payment.declaredTargets || [];
  const declaration = playTargetDeclaration(game, player, card, payment.destination);
  const steps = declaration?.steps || [];
  for (const [index, target] of targets.entries()) {
    if (costEffects.has(target.effect)) continue;
    const descriptors = steps.filter((descriptor) => descriptor.declaration?.choiceEffect === target.effect);
    if (!descriptors.length) return false;
    const priorTargets = targets.slice(0, index);
    const remainsAnOption = descriptors.some(({ spec, declaration: targetDeclaration }) =>
      declarationTargetOptions(game, player, card, spec, targetDeclaration, priorTargets)
        .some((option) => option.cardId === target.targetId));
    if (!remainsAnOption) return false;
  }

  for (const choice of payment.declaredChoices || []) {
    if (!choice.unitId || !choice.destinationId || !choice.effect?.includes("Destination")) continue;
    const unit = findCard(game, choice.unitId);
    if (!unit || !spellMoveDestinationOptions(game, unit)
      .some((option) => (option.destination || option.id) === choice.destinationId)) return false;
  }

  for (const { spec, declaration: targetDeclaration } of steps) {
    if (!targetDeclaration.maxTotalMightFromSpec) continue;
    const selected = targets.filter((target) => target.effect === targetDeclaration.choiceEffect);
    const total = selected.reduce((sum, target) => {
      const unit = findCard(game, target.targetId);
      return sum + (unit ? currentMight(game, unit) : Number.POSITIVE_INFINITY);
    }, 0);
    if (total > (spec.maxMight || 4)) return false;
  }
  return true;
}

export function hideCard(game, cardId, battlefieldId) {
  if (game.pendingPayment || game.pendingChoice || game.actionChain) return fail(game, "Finish the current choice first.");
  if (game.phase !== "action") return fail(game, "Cards can only be hidden during your action phase.");
  const player = currentPlayer(game);
  const cardIndex = player.hand.findIndex((candidate) => candidate.instanceId === cardId);
  const championSource = cardIndex < 0
    && player.champion?.instanceId === cardId
    && player.champion.zone === "champion"
    && !player.championPlayed;
  if (cardIndex < 0 && !championSource) return fail(game, "That card is not in your hand or Champion Zone.");
  const card = championSource ? player.champion : player.hand[cardIndex];
  if (!hasKeyword(card, "Hidden", game)) return fail(game, "That card does not have Hidden.");
  const battlefield = game.battlefields.find((field) => field.instanceId === battlefieldId || field.id === battlefieldId);
  if (!battlefield || battlefield.controlledBy !== player.id) return fail(game, "You can only hide at a battlefield you control.");
  battlefield.hidden ||= [];
  if (hiddenCardsAtBattlefieldForPlayer(battlefield, player.id) >= hiddenSlotLimit(battlefield)) {
    return fail(game, "You already have the maximum number of hidden cards there.");
  }
  const ignoresCost = player.hideIgnoringCostsUntilTurnSequence === (game.turnSequence || 0);
  if (!ignoresCost && !payAdditionalPower(game, player, { domain: "Any", amount: 1 }, true)) return fail(game, "Not enough Power to hide that card.");
  game.pendingPayment = {
    playerId: player.id,
    cardId: card.instanceId,
    cardName: card.name,
    destination: battlefield.instanceId,
    source: "hideCard",
    hideSource: championSource ? "champion" : "hand",
    energyCost: 0,
    basePowerCost: ignoresCost ? [] : [{ domain: "Any", amount: 1 }],
    powerCost: ignoresCost ? [] : [{ domain: "Any", amount: 1 }],
    declaredTargets: [],
    declaredChoices: [],
    deflectTargetIds: [],
    optionalPowerEffects: [],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    poolPowerIds: []
  };
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} is paying to hide a card at ${battlefield.name}.`);
  return { ok: true };
}

function finishHidingCard(game, player, card, battlefield, payment = {}) {
  if (payment.hideSource === "champion") {
    if (player.champion?.instanceId !== card.instanceId || card.zone !== "champion") {
      return fail(game, "That card is no longer in the Champion Zone.");
    }
    setChampionZoneState(player, card, "hidden");
  } else {
    const cardIndex = player.hand.findIndex((candidate) => candidate.instanceId === card.instanceId);
    if (cardIndex < 0) return fail(game, "That card is not in hand.");
    player.hand.splice(cardIndex, 1);
  }
  markNonBoardZoneChange(card);
  card.hidden = true;
  battlefield.hidden.push({
    card,
    ownerId: player.id,
    hiddenByPlayerId: player.id,
    playableFromTurnSequence: (game.turnSequence || 0) + 1
  });
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} hides a card at ${battlefield.name}.`);
  markEffect(game, battlefield, [battlefield.instanceId], `${player.name} hides a card.`);
  return { ok: true };
}

export function hiddenCardsAtBattlefieldForPlayer(battlefield, playerId) {
  return (battlefield?.hidden || []).filter((item) => hiddenCardIsControlledBy(item, playerId)).length;
}

export function hiddenSlotLimit(battlefield) {
  const additional = cardEffects(battlefield, "static")
    .filter((effect) => effect.kind === "additionalHiddenSlots")
    .reduce((sum, effect) => sum + (effect.amount || 1), 0);
  return 1 + additional;
}

function canPlayerPlayCards(game, player) {
  return !player?.cannotPlayCardsUntilTurnSequence || player.cannotPlayCardsUntilTurnSequence < (game.turnSequence || 0);
}

function canPlayCardAtCurrentTiming(game, player, card, destination = "base") {
  if (!player || !card) return false;
  if (game.phase === "showdown") return canPlayInShowdown(game, player, card, game.showdown, destination);
  if (game.phase !== "action") return false;
  if (game.actionChain) return canPlayInActionChain(game, player, card, destination);
  return game.currentPlayerId === player.id;
}

export function legalCardPlayDestinations(game, cardId) {
  if (game.pendingPayment || game.pendingChoice) return [];
  const player = actingPlayer(game);
  if (!player || !canPlayerPlayCards(game, player)) return [];

  const card = player.hand.find((candidate) => candidate.instanceId === cardId);
  if (card) {
    const candidates = card.type === "unit"
      ? ["base", ...game.battlefields.map((field) => field.instanceId)]
      : ["base"];
    return [...new Set(candidates)].filter((destination) =>
      canPlayCardAtCurrentTiming(game, player, card, destination)
      && hasRequiredPlayTargets(game, player, card, destination));
  }

  const hidden = findHiddenCardLocation(game, cardId);
  if (!hidden || game.phase !== "showdown" || !game.showdown) return [];
  if (!hiddenCardIsControlledBy(hidden, player.id) || game.showdown.priorityPlayerId !== player.id) return [];
  if ((game.turnSequence || 0) < (hidden.playableFromTurnSequence || 0)) return [];
  const destination = hidden.battlefield.instanceId;
  if (destination !== game.showdown.battlefieldId) return [];
  if (hidden.battlefield.units.some((unit) =>
    unit.controllerId !== player.id && hasStaticEffect(unit, "opponentsHiddenCantRevealHere"))) return [];
  if (!canPlayInShowdown(game, player, hidden.card, game.showdown, destination)) return [];
  return hasRequiredPlayTargets(game, player, hidden.card, destination) ? [destination] : [];
}

export function legalChampionPlayDestinations(game) {
  if (game.pendingPayment || game.pendingChoice) return [];
  if (game.phase !== "action" && game.phase !== "showdown") return [];
  const player = actingPlayer(game);
  const champion = player?.champion;
  if (!player || !champion || !canPlayerPlayCards(game, player)) return [];
  if (player.championPlayed || champion.zone !== "champion") return [];
  const candidates = ["base", ...game.battlefields.map((field) => field.instanceId)];
  return [...new Set(candidates)].filter((destination) =>
    canPlayCardAtCurrentTiming(game, player, champion, destination)
    && hasRequiredPlayTargets(game, player, champion, destination));
}

export function activateCard(game, cardId) {
  const player = actingPlayer(game);
  const card = findCard(game, cardId);
  const pendingActivation = card ? pendingActivatedAbilityItem(game, card) : null;
  const continuingActivation = Boolean(pendingActivation && card.activationProcess);
  if (!card || card.controllerId !== player.id) return fail(game, "You cannot activate that card.");
  if (!allControlledCards(game, player.id).some((candidate) => candidate.instanceId === card.instanceId)) {
    return fail(game, "Activated abilities can only be used from an active board zone.");
  }
  if (game.pendingChoice) return fail(game, "Finish the current choice first.");
  const abilityGroups = continuingActivation ? [] : activatedAbilityGroupsForCard(game, card);
  const selectableGroups = continuingActivation ? [] : game.pendingPayment
    ? abilityGroups.filter((group) => canActivateAddDuringPayment(game, player, card, group.specs))
    : abilityGroups.filter((group) =>
      activatedAbilityConditionsMet(game, player, card, group.specs)
      && canActivateAbilityAtCurrentTiming(game, player, card, group.specs));
  let selectedAbility = card.selectedActivatedAbilityId
    ? selectableGroups.find((group) => group.id === card.selectedActivatedAbilityId)
    : null;
  if (!selectedAbility && selectableGroups.length > 1) {
    if (!game.interactive) {
      selectedAbility = selectableGroups[0];
    } else {
      game.pendingChoice = {
        id: `choice-${Date.now()}-${Math.random()}`,
        playerId: player.id,
        card,
        effect: "declareActivatedAbility",
        prompt: `Choose an ability to activate for ${card.name}.`,
        options: selectableGroups.map((group) => ({ id: group.id, label: group.label })),
        data: {},
        finishSpell: false,
        optional: false,
        fromShowdownChain: false
      };
      return { ok: true };
    }
  }
  const specs = continuingActivation
    ? card.activationProcess.specs
    : selectedAbility?.specs || selectableGroups[0]?.specs || [];
  const paymentAddAbility = canActivateAddDuringPayment(game, player, card, specs);
  if ((game.pendingPayment || game.pendingChoice) && !paymentAddAbility) return fail(game, "Finish the current choice first.");
  const actionChainAddAbility = canActivateAddDuringActionChain(game, player, card, specs);
  const forgeAbility = canUseForgeLegendAbility(game, player, card);
  const usingForgeAbility = forgeAbility && (game.phase === "action" || !specs.length);
  if (!specs.length && !forgeAbility) return fail(game, "That card has no activated ability.");
  if (!continuingActivation && specs.length && !activatedAbilityConditionsMet(game, player, card, specs)) {
    return fail(game, "That activated ability's use condition is not met.");
  }
  if (!continuingActivation && game.actionChain && !paymentAddAbility && !actionChainAddAbility && !canActivateInActionChain(game, player, card, specs)) {
    return fail(game, "Only Reaction abilities can be used on an existing chain.");
  }
  if (!continuingActivation && !paymentAddAbility && !canActivateAbilityAtCurrentTiming(game, player, card, specs, { usingForgeAbility })) {
    return fail(game, "That activated ability cannot be used at the current timing.");
  }
  if (!continuingActivation) beginPendingActivatedAbility(game, player, card, specs, { usingForgeAbility });
  if (game.interactive && !card.activationDeclarationReady) {
    if (specs.some((spec) => spec.kind === "udyrChooseMode")) {
      if ((card.buffs || 0) <= 0) {
        rollbackPendingActivatedAbility(game, card);
        return fail(game, `${card.name} has no buff to spend.`);
      }
      const chosen = card.udyrModesTurnSequence === (game.turnSequence || 0) ? (card.udyrModesChosen || []) : [];
      const options = [
        { id: "damage", label: "Deal 2 damage" },
        { id: "stun", label: "Stun a unit" },
        { id: "ready", label: `Ready ${card.name}` },
        { id: "ganking", label: `Give ${card.name} Ganking` }
      ]
        .filter((option) => !chosen.includes(option.id))
        .filter((option) => !["damage", "stun"].includes(option.id) || game.battlefields.some((field) => field.units.length));
      game.pendingChoice = {
        id: `choice-${Date.now()}-${Math.random()}`,
        playerId: player.id,
        card,
        effect: "declareUdyrMode",
        prompt: `Choose an unused mode for ${card.name}.`,
        options,
        data: {},
        finishSpell: false,
        optional: false,
        fromShowdownChain: false
      };
      return { ok: true };
    }
    const declaration = activatedTargetDeclaration(game, player, card, specs);
    const requiredTargetSpec = specs.find((candidate) => activatedChoiceEffect(candidate) && !candidate.optional);
    if (!declaration && requiredTargetSpec) {
      rollbackPendingActivatedAbility(game, card);
      return fail(game, `${card.name} has no legal activation target.`);
    }
    if (declaration) {
      game.pendingChoice = {
        id: `choice-${Date.now()}-${Math.random()}`,
        playerId: player.id,
        card,
        effect: "declareActivatedTarget",
        prompt: `Declare a target before activating ${card.name}.`,
        options: declaration.options,
        data: declaration,
        finishSpell: false,
        optional: Boolean(declaration.optional),
        fromShowdownChain: false
      };
      game.selectedCardId = card.instanceId;
      return { ok: true };
    }
  }
  if (!game.interactive && !card.activationDeclarationReady) {
    const declaration = activatedTargetDeclaration(game, player, card, specs);
    const requiredTargetSpec = specs.find((candidate) => activatedChoiceEffect(candidate) && !candidate.optional);
    if (!declaration && requiredTargetSpec) {
      rollbackPendingActivatedAbility(game, card);
      return fail(game, `${card.name} has no legal activation target.`);
    }
    if (declaration) {
      const option = declaration.options[0];
      const target = option ? findCard(game, option.cardId) : null;
      if (!option || !target) {
        rollbackPendingActivatedAbility(game, card);
        return fail(game, `${card.name} has no legal activation target.`);
      }
      card.declaredPlayTargets = [{ effect: declaration.targetEffect, targetId: option.cardId }];
      card.declaredTargetIdentities = [{
        effect: declaration.targetEffect,
        targetId: option.cardId,
        zoneChangeCounter: option.zoneChangeCounter || 0
      }];
      card.deflectPaidTargetIds = [];
      if (needsDeflectPayment(game, player, target)) {
        if (!payDeflectIfNeeded(game, player, card, target)) {
          rollbackPendingActivatedAbility(game, card);
          return fail(game, `${card.name} cannot pay the target's additional cost.`);
        }
        card.deflectPaidTargetIds.push(target.instanceId);
      }
      if (declaration.requiresDestination) {
        const destination = spellMoveDestinationOptions(game, target)[0];
        if (!destination) {
          rollbackPendingActivatedAbility(game, card);
          return fail(game, `${card.name} has no legal activation destination.`);
        }
        card.declaredPlayChoices = [{
          effect: declaration.destinationEffect,
          unitId: target.instanceId,
          destinationId: destination.destination || destination.id
        }];
      }
    }
    card.activationDeclarationReady = true;
  }
  const activatedCost = activatedAbilityCost(game, player, card, specs);
  if (game.interactive && (activatedCost?.recycleTrash || 0) > 0
    && (card.activationProcess?.recycleTrashCardIds?.length || 0) < activatedCost.recycleTrash) {
    const selectedIds = card.activationProcess?.recycleTrashCardIds || [];
    const options = player.trash.filter((candidate) => !selectedIds.includes(candidate.instanceId)).map(cardOption);
    if (options.length < activatedCost.recycleTrash - selectedIds.length) {
      rollbackPendingActivatedAbility(game, card);
      return fail(game, "Not enough cards in trash to activate that ability.");
    }
    game.pendingChoice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: player.id,
      card,
      effect: "declareActivatedRecycleTrash",
      prompt: `Choose a card in trash to recycle for ${card.name}.`,
      options,
      data: { remaining: activatedCost.recycleTrash - selectedIds.length, selectedIds },
      finishSpell: false,
      optional: false,
      fromShowdownChain: false
    };
    game.selectedCardId = card.instanceId;
    return { ok: true };
  }
  delete card.selectedActivatedAbilityId;
  delete card.activationDeclarationReady;
  if (card.udyrActivationCostPending) {
    if ((card.buffs || 0) <= 0) return fail(game, `${card.name} has no buff to spend.`);
    card.buffs -= 1;
    delete card.udyrActivationCostPending;
  }
  if (activatedCost && game.interactive) {
    game.pendingPayment = createActivatedPayment(player, card, specs, activatedCost, {
      recycleTrashCardIds: card.activationProcess?.recycleTrashCardIds || []
    });
    game.selectedCardId = card.instanceId;
    log(game, `${player.name} is paying to activate ${card.name}.`);
    return { ok: true };
  }
  if (activatedCost && !payActivatedCostAutomatically(game, player, activatedCost, card)) {
    rollbackPendingActivatedAbility(game, card);
    return fail(game, "Not enough ready runes to activate that ability.");
  }
  return completeActivatedAbility(game, player, card, specs, { usingForgeAbility });
}

function completeActivatedAbility(game, player, card, specs, context = {}) {
  const legality = activatedAbilityFinalizationLegality(game, player, card, specs);
  if (!legality.ok) {
    rollbackPendingActivatedAbility(game, card);
    log(game, `${card.name}'s activation is cancelled: ${legality.message}`);
    checkState(game);
    return fail(game, legality.message);
  }
  if (activatedAbilityExhausts(specs)) exhaustCards(game, player, card, [card], {
    reason: "activated-ability-cost",
    cost: true
  });
  if (specs.some((spec) => spec.killSelfCost)) {
    if (card.type !== "gear") return fail(game, "Only gear can pay this self-kill activation cost.");
    killGear(game, card, { type: "activationCost", source: card });
    log(game, `${card.name} is killed as an activation cost.`);
  }
  if (specs.some((spec) => spec.recycleSelfCost)) {
    if (!recycleActivatedRuneCost(game, player, card)) return fail(game, "That Rune can no longer be recycled.");
    log(game, `${card.name} is recycled as an activation cost.`);
  }
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} activates ${card.name}.`);
  if (isAddResourceAbility(specs)) return finalizeAndResolveAddAbility(game, player, card, specs);
  const pendingItem = pendingActivatedAbilityItem(game, card);
  if (pendingItem) {
    pendingItem.specs = structuredClone(specs);
    pendingItem.playOptions ||= {};
    pendingItem.playOptions.declarationsComplete = true;
    clearActivatedAbilityProcess(card);
    log(game, `${player.name} completes ${card.name}'s ability choices, costs, and legality check.`);
    checkState(game);
    if (game.actionChain) maybeAutoPassActionChain(game);
    return { ok: true };
  }
  clearActivatedAbilityProcess(card);
  if (context.usingForgeAbility) return chooseForgeAttachGear(game, player, card) ? { ok: true } : (checkState(game), { ok: true });
  return resolveEffectSpecs(game, player, card, specs, false) ? { ok: true } : (checkState(game), { ok: true });
}

function activatedEffectsForCard(game, card) {
  const own = cardEffects(card, "activated").map((effect, index) => ({
    ...effect,
    abilitySourceCardId: card.instanceId,
    abilitySourceCardName: card.name,
    abilityIndex: index
  }));
  if (!hasStaticEffect(card, "copyFriendlyActivatedAbilities")) return own;
  return [
    ...own,
    ...allControlledCards(game, card.controllerId)
      .filter((source) => source.instanceId !== card.instanceId)
      .flatMap((source) => cardEffects(source, "activated").map((effect, index) => ({
        ...structuredClone(effect),
        copiedFromCardId: source.instanceId,
        copiedFromCardName: source.name,
        abilitySourceCardId: source.instanceId,
        abilitySourceCardName: source.name,
        abilityIndex: index
      })))
  ];
}

function activatedAbilityGroupsForCard(game, card) {
  const groups = new Map();
  for (const spec of activatedEffectsForCard(game, card)) {
    const sourceId = spec.abilitySourceCardId || card.instanceId;
    const localId = spec.abilityId || `effect-${spec.abilityIndex || 0}`;
    const id = `${sourceId}:${localId}`;
    if (!groups.has(id)) {
      const sourceName = spec.abilitySourceCardName || spec.copiedFromCardName || card.name;
      groups.set(id, {
        id,
        label: sourceId === card.instanceId ? spec.kind : `${sourceName}: ${spec.kind}`,
        specs: []
      });
    }
    groups.get(id).specs.push(spec);
  }
  return [...groups.values()];
}

function activatedTargetDeclaration(game, player, card, specs) {
  const spec = specs.find((candidate) => activatedChoiceEffect(candidate));
  if (!spec) return null;
  const effect = activatedChoiceEffect(spec);
  let targets = [];
  if (["buffUnit", "giveKeyword", "modifyMight", "saveFriendlyUnitThisTurn", "moveUnitSpellTarget"].includes(effect)) {
    targets = allUnits(game)
      .filter((unit) => !["friendlyUnit", "exhaustedFriendlyUnit", "anotherUnit"].includes(spec.target) || unit.controllerId === player.id)
      .filter((unit) => spec.target !== "self" || unit.instanceId === card.instanceId)
      .filter((unit) => spec.target !== "anotherUnit" || unit.instanceId !== card.instanceId)
      .filter((unit) => spec.target !== "exhaustedFriendlyUnit" || unit.exhausted)
      .filter((unit) => canChooseUnit(game, player, card, unit));
  } else if (["damageUnit", "stunUnit"].includes(effect)) {
    const scope = spec.target === "battlefieldUnit"
      ? "battlefield"
      : spec.target === "unit"
        ? "any"
        : spec.target === "friendlyUnit" ? "friendly" : "enemy";
    targets = targetableUnits(game, player, card, scope);
  } else if (effect === "returnUnitToBase") {
    targets = battlefieldUnitTargets(game, player, spec.target || "battlefield")
      .filter((candidate) => canMoveUnitFromBattlefieldToBase(game, candidate.unit))
      .filter((candidate) => canChooseUnit(game, player, card, candidate.unit))
      .map((candidate) => candidate.unit);
  } else if (effect === "equipGear") {
    targets = allUnits(game).filter((unit) => unit.controllerId === player.id);
  } else if (["baitedHookSacrifice", "killFriendlyPermanentChannelRune"].includes(effect)) {
    targets = [
      ...allUnits(game).filter((unit) => unit.controllerId === player.id),
      ...allGear(game).filter((gear) => gear.controllerId === player.id)
    ];
  } else if (effect === "returnOwnedTagUnitToHand") {
    targets = allUnits(game).filter((unit) => unit.ownerId === player.id && (!spec.tag || unit.tags?.includes(spec.tag)));
  } else if (effect === "returnFriendlyPermanentOrHiddenToHand") {
    targets = [
      ...allUnits(game).filter((unit) => unit.controllerId === player.id && unit.instanceId !== card.instanceId),
      ...allGear(game).filter((gear) => gear.controllerId === player.id && gear.instanceId !== card.instanceId),
      ...game.battlefields.flatMap((field) => (field.hidden || []).filter((hidden) => hiddenCardIsControlledBy(hidden, player.id)).map((hidden) => hidden.card))
    ];
  }
  const options = targets.map(cardOption);
  if (!options.length) return null;
  return {
    targetEffect: effect,
    requiresDestination: effect === "moveUnitSpellTarget",
    destinationEffect: "moveUnitSpellDestination",
    options,
    optional: Boolean(spec.optional)
  };
}

function activatedChoiceEffect(spec) {
  return ({
    equip: "equipGear",
    buffUnit: "buffUnit",
    dealDamageUnit: "damageUnit",
    giveKeyword: "giveKeyword",
    modifyMight: "modifyMight",
    returnUnitToBase: "returnUnitToBase",
    baitedHook: "baitedHookSacrifice",
    killFriendlyPermanentChannelRune: "killFriendlyPermanentChannelRune",
    moveFriendlyUnit: "moveUnitSpellTarget",
    returnOwnedTagUnitToHand: "returnOwnedTagUnitToHand",
    returnFriendlyPermanentOrHiddenToHand: "returnFriendlyPermanentOrHiddenToHand",
    saveFriendlyUnitThisTurn: "saveFriendlyUnitThisTurn",
    stunUnit: "stunUnit"
  })[spec.kind] || null;
}

function activatedAbilityFinalizationLegality(game, player, card, specs) {
  const spec = specs.find((candidate) => activatedChoiceEffect(candidate));
  if (!spec) return { ok: true };
  const effect = activatedChoiceEffect(spec);
  const declared = (card.declaredPlayTargets || []).find((target) => target.effect === effect);
  if (!declared) return spec.optional
    ? { ok: true }
    : { ok: false, message: "The activated ability no longer has its required target." };
  const declaration = activatedTargetDeclaration(game, player, card, specs);
  const option = declaration?.options?.find((candidate) => candidate.cardId === declared.targetId);
  const identity = (card.declaredTargetIdentities || []).find((candidate) =>
    candidate.effect === effect && candidate.targetId === declared.targetId);
  if (!option || (identity && (option.zoneChangeCounter || 0) !== identity.zoneChangeCounter)) {
    return { ok: false, message: "The activated ability's declared target is no longer legal." };
  }
  if (declaration.requiresDestination) {
    const destination = (card.declaredPlayChoices || []).find((declaredChoice) =>
      declaredChoice.effect === declaration.destinationEffect && declaredChoice.unitId === declared.targetId)?.destinationId;
    const target = findCard(game, declared.targetId);
    if (!destination || !target || !spellMoveDestinationOptions(game, target)
      .some((candidate) => (candidate.destination || candidate.id) === destination)) {
      return { ok: false, message: "The activated ability's declared destination is no longer legal." };
    }
  }
  return { ok: true };
}

function activatedAbilityHasKeyword(specs, keyword) {
  return specs.some((spec) => (spec.abilityKeywords || []).some((candidate) =>
    String(candidate).toLowerCase() === String(keyword).toLowerCase()));
}

function isReactionAbility(specs) {
  return specs.length > 0 && activatedAbilityHasKeyword(specs, "Reaction");
}

function isActionAbility(specs) {
  return specs.length > 0
    && (activatedAbilityHasKeyword(specs, "Action") || isReactionAbility(specs));
}

function activatedAbilityConditionsMet(game, player, card, specs) {
  const location = findActiveCardLocation(game, card.instanceId);
  return specs.every((spec) => {
    if (spec.requiresLegion && (player.cardsPlayedThisTurn || 0) <= 0) return false;
    if (spec.sourceLocation === "battlefield" && location?.type !== "battlefield") return false;
    if (spec.sourceLocation === "base" && location?.type !== "base") return false;
    if (spec.spendBuff && (card.buffs || 0) <= 0) return false;
    return true;
  });
}

function canActivateAbilityAtCurrentTiming(game, player, card, specs, { usingForgeAbility = false } = {}) {
  if (!card || card.controllerId !== player.id || game.pendingChoice) return false;
  if (card.exhausted && activatedAbilityExhausts(specs)) return false;
  if (usingForgeAbility) {
    return game.phase === "action" && !game.actionChain && game.currentPlayerId === player.id;
  }
  if (game.actionChain) return canActivateInActionChain(game, player, card, specs);
  if (game.phase === "showdown" && game.showdown) return canActivateInShowdown(game, player, card, specs);
  return game.phase === "action" && game.currentPlayerId === player.id;
}

function canActivateInShowdown(game, player, card, specs) {
  if (game.pendingPayment || game.pendingChoice) return false;
  if (game.phase !== "showdown" || !game.showdown) return false;
  if (!showdownPlayerIds(game.showdown).includes(player.id)) return false;
  if (game.showdown.priorityPlayerId !== player.id) return false;
  if (normalizeChainItems(game.showdown).length > 0) return isReactionAbility(specs);
  if (game.showdown.focusPlayerId !== player.id) return false;
  return isActionAbility(specs);
}

function canActivateInActionChain(game, player, card, specs = activatedEffectsForCard(game, card)) {
  if (game.pendingPayment || game.pendingChoice) return false;
  if (game.phase !== "action" || !game.actionChain) return false;
  if (game.actionChain.priorityPlayerId !== player.id) return false;
  return isReactionAbility(specs);
}

function canActivateAddDuringPayment(game, player, card, specs) {
  if (!game.pendingPayment || game.pendingChoice) return false;
  if (game.pendingPayment.playerId !== player.id) return false;
  if (!card || card.controllerId !== player.id) return false;
  if (card.exhausted && activatedAbilityExhausts(specs)) return false;
  if (!isReactionAbility(specs)) return false;
  const paidCard = paymentCard(player, game.pendingPayment);
  return specs.length > 0 && specs.every((spec) =>
    ["addEnergy", "addPower"].includes(spec.kind)
    && (spec.restriction !== "spell" || paidCard?.type === "spell")
    && (!spec.requiresLegion || player.cardsPlayedThisTurn > 0)
  );
}

function canActivateAddDuringActionChain(game, player, card, specs) {
  if (game.pendingPayment || game.pendingChoice) return false;
  if (game.phase !== "action" || !game.actionChain) return false;
  if (game.actionChain.priorityPlayerId !== player.id) return false;
  if (!card || card.controllerId !== player.id) return false;
  if (card.exhausted && activatedAbilityExhausts(specs)) return false;
  if (!isReactionAbility(specs)) return false;
  return specs.length > 0 && specs.every((spec) =>
    ["addEnergy", "addPower"].includes(spec.kind)
    && (!spec.requiresLegion || player.cardsPlayedThisTurn > 0)
  );
}

function activatedAbilityCost(game, player, card, specs, { applyModifiers = true } = {}) {
  let energy = specs.reduce((sum, spec) => sum + (spec.costEnergy || 0), 0);
  let power = specs.flatMap((spec) => {
    if (spec.costPower?.length) return spec.costPower;
    if (spec.kind === "equip") return [{ domain: spec.domain || "Any", amount: spec.amount || 1 }];
    return [];
  });
  const recycleTrash = specs.reduce((sum, spec) => sum + (spec.costRecycleTrash || 0), 0);
  if (applyModifiers) {
    const modifiers = collectActivatedAbilityCostModifiers(game, player, card, specs);
    for (const modifier of modifiers.filter((candidate) => candidate.energy > 0)) energy += modifier.energy;
    const energyDiscounts = modifiers
      .filter((candidate) => candidate.energy < 0)
      .map((candidate) => ({ amount: Math.abs(candidate.energy), minimum: candidate.minEnergy ?? 0 }));
    energy = applyEnergyDiscountsInBestOrder(energy, energyDiscounts);
    for (const modifier of modifiers.filter((candidate) => candidate.power > 0)) {
      power = adjustPowerCost(power, modifier.power);
    }
    for (const modifier of modifiers.filter((candidate) => candidate.power < 0)) {
      power = adjustPowerCost(power, modifier.power);
    }
  }
  if (energy <= 0 && totalPowerAmount(power) <= 0 && recycleTrash <= 0) return null;
  return { energy: Math.max(0, energy), power, recycleTrash };
}

function collectActivatedAbilityCostModifiers(game, player, card, specs) {
  const modifiers = [];
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "static")) {
      if (effect.kind !== "costModifier" || effect.appliesTo !== "activatedAbility") continue;
      if (effect.abilityKind && !specs.some((spec) => spec.kind === effect.abilityKind)) continue;
      if (effect.sourceType && card.type !== effect.sourceType) continue;
      if (effect.sourceTag && !(card.tags || []).includes(effect.sourceTag)) continue;
      if (!costModifierApplies(game, player, card, effect, source)) continue;
      modifiers.push({
        energy: effect.energy || 0,
        power: effect.power || 0,
        minEnergy: effect.minEnergy,
        component: effect.component || "total"
      });
    }
  }
  return modifiers;
}

function payActivatedCostAutomatically(game, player, cost, source = null) {
  const readyRunes = player.runes.filter((rune) => !rune.exhausted);
  const poolEnergyIds = runePoolEnergy(player)
    .filter((resource) => poolEnergyCanPay(game, resource))
    .slice(0, cost.energy || 0)
    .map((resource) => resource.id);
  const remainingEnergy = Math.max(0, (cost.energy || 0) - poolEnergyIds.length);
  if (readyRunes.length < remainingEnergy) return false;
  const powerSources = choosePowerPaymentSources(player, cost.power || []);
  if (!powerSources) return false;
  if ((player.trash?.length || 0) < (cost.recycleTrash || 0)) return false;
  consumeSelectedPoolEnergy(player, poolEnergyIds);
  exhaustCards(game, player, source, readyRunes.slice(0, remainingEnergy), {
    reason: "activated-energy-cost",
    cost: true
  });
  consumeSelectedPoolPower(player, powerSources.poolPowerIds);
  if (!payChosenPowerRunes(game, player, powerSources.powerRuneIds, powerSources.powerRuneIds.length)) return false;
  payRecycleTrashCost(game, player, cost.recycleTrash || 0);
  return true;
}

function activatedAbilityExhausts(specs) {
  return specs.some((spec) => spec.exhaust === true || (spec.exhaust !== false && spec.kind !== "equip"));
}

function recycleActivatedRuneCost(game, controller, rune) {
  if (rune.type !== "rune") return false;
  const index = controller.runes.findIndex((candidate) => candidate.instanceId === rune.instanceId);
  if (index < 0) return false;
  controller.runes.splice(index, 1);
  markNonBoardZoneChange(rune);
  if (rune.isToken) return true;
  const owner = game.players.find((player) => player.id === rune.ownerId) || controller;
  owner.runeDeck ||= [];
  owner.runeDeck.push(rune);
  return true;
}

function payRecycleTrashCost(game, player, amount = 0) {
  if (amount <= 0) return true;
  if ((player.trash?.length || 0) < amount) return false;
  const recycled = player.trash.splice(0, amount);
  recycleMainDeckCards(game, player, recycled);
  return true;
}

function paySelectedRecycleTrashCost(game, player, cardIds, amount = 0) {
  const uniqueIds = [...new Set(cardIds || [])];
  if (uniqueIds.length !== amount) return amount === 0;
  const selectedCards = uniqueIds.map((id) => player.trash.find((card) => card.instanceId === id));
  if (selectedCards.some((card) => !card)) return false;
  const selected = new Set(uniqueIds);
  player.trash = player.trash.filter((card) => !selected.has(card.instanceId));
  recycleMainDeckCards(game, player, selectedCards);
  return true;
}

function isAddResourceAbility(specs) {
  return specs.length > 0 && specs.every((spec) => effectDefinition(spec)?.addsResources);
}

export function beginPlayChampion(game, destination = "base") {
  if (!game.interactive) return playChampion(game, destination);
  if (game.pendingPayment || game.pendingChoice) return fail(game, "Finish the current choice first.");
  if (game.phase !== "action" && game.phase !== "showdown") return fail(game, "You cannot play your champion during this phase.");
  const player = actingPlayer(game);
  if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
  if (!player.champion) return fail(game, "Choose a champion first.");
  if (player.championPlayed) return fail(game, "Champion has already been played.");
  if (player.champion.zone !== "champion") return fail(game, "Champion is not in the Champion Zone.");
  if (!canPlayCardAtCurrentTiming(game, player, player.champion, destination)) {
    return fail(game, "That champion cannot be played at the current timing.");
  }
  if (!hasRequiredPlayTargets(game, player, player.champion, destination)) return fail(game, `${player.champion.name} cannot enter there.`);
  return beginCardPlayProcess(game, player, player.champion, destination, "champion", false);
}

export function togglePaymentRune(game, runeId, mode) {
  const payment = game.pendingPayment;
  if (!payment) return fail(game, "No payment is pending.");
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  const rune = player.runes.find((candidate) => candidate.instanceId === runeId);
  if (!rune) return fail(game, "Unknown rune.");
  const card = paymentCard(player, payment);
  if (!card) return fail(game, "Card to pay for is no longer available.");

  const energy = new Set(payment.energyRuneIds);
  const power = new Set(payment.powerRuneIds);
  if (mode === "energy") {
    if (rune.exhausted) return fail(game, "That rune is already exhausted.");
    if (energy.has(runeId)) energy.delete(runeId);
    else {
      const energyCost = payment.energyCost ?? (card.energy || 0);
      if (energy.size + (payment.poolEnergyIds?.length || 0) >= energyCost) return fail(game, "That Energy cost is already fully selected.");
      energy.add(runeId);
    }
  } else if (mode === "power") {
    if (power.has(runeId)) power.delete(runeId);
    else {
      if (!runeCanPayPower(rune, payment.powerCost || card.power || [])) return fail(game, `${rune.domain} cannot pay that Power cost.`);
      if (power.size + (payment.poolPowerIds?.length || 0) >= totalPowerAmount(payment.powerCost || card.power || [])) {
        return fail(game, "That Power cost is already fully selected.");
      }
      power.add(runeId);
    }
  }
  payment.energyRuneIds = [...energy];
  payment.powerRuneIds = [...power];
  return { ok: true };
}

export function togglePaymentPoolEnergy(game, energyId) {
  const payment = game.pendingPayment;
  if (!payment) return fail(game, "No payment is pending.");
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  const resource = runePoolEnergy(player).find((candidate) => candidate.id === energyId);
  if (!resource) return fail(game, "Unknown generated Energy.");
  if (!poolEnergyCanPay(game, resource)) return fail(game, "That Energy cannot be spent now.");

  const selected = new Set(payment.poolEnergyIds || []);
  if (selected.has(energyId)) selected.delete(energyId);
  else {
    const card = paymentCard(player, payment);
    const energyCost = payment.energyCost ?? (card?.energy || 0);
    const selectedRuneCount = payment.energyRuneIds?.length || 0;
    if (selected.size + selectedRuneCount >= energyCost) return fail(game, "That Energy cost is already fully selected.");
    selected.add(energyId);
  }
  payment.poolEnergyIds = [...selected];
  return { ok: true };
}

export function togglePaymentPoolPower(game, powerId) {
  const payment = game.pendingPayment;
  if (!payment) return fail(game, "No payment is pending.");
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  const resource = runePoolPower(player).find((candidate) => candidate.id === powerId);
  if (!resource) return fail(game, "Unknown generated Power.");
  const card = paymentCard(player, payment);
  if (!card) return fail(game, "Card to pay for is no longer available.");

  const selected = new Set(payment.poolPowerIds || []);
  if (selected.has(powerId)) selected.delete(powerId);
  else {
    const powerCost = payment.powerCost || card.power || [];
    if (!powerCost.some((requirement) => powerMatches(resource, requirement))) {
      return fail(game, `${resource.domain} cannot pay that Power cost.`);
    }
    if (selected.size + (payment.powerRuneIds?.length || 0) >= totalPowerAmount(powerCost)) {
      return fail(game, "That Power cost is already fully selected.");
    }
    selected.add(powerId);
  }
  payment.poolPowerIds = [...selected];
  return { ok: true };
}

export function toggleOptionalPaymentEffect(game, effectId) {
  const payment = game.pendingPayment;
  if (!payment) return fail(game, "No payment is pending.");
  const effect = (payment.optionalPowerEffects || []).find((candidate) => candidate.id === effectId);
  if (!effect) return fail(game, "Unknown optional cost.");
  effect.selected = !effect.selected;
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  const card = paymentCard(player, payment);
  recalculatePaymentCost(game, player, card, payment);
  payment.powerRuneIds = payment.powerRuneIds.filter((runeId) => {
    const rune = player?.runes.find((candidate) => candidate.instanceId === runeId);
    return rune && runeCanPayPower(rune, payment.powerCost);
  });
  payment.poolPowerIds = (payment.poolPowerIds || []).filter((powerId) => {
    const resource = runePoolPower(player).find((candidate) => candidate.id === powerId);
    return resource && (payment.powerCost || []).some((requirement) => powerMatches(resource, requirement));
  });
  return { ok: true };
}

export function cancelPayment(game) {
  if (!game.pendingPayment) return fail(game, "No payment is pending.");
  const payment = game.pendingPayment;
  if (payment.source === "effectPlay") return fail(game, "A card play required by an effect cannot be cancelled after it starts.");
  const asyncScope = enterAsyncResolutionContext(game, payment);
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  try {
    log(game, `${player.name} cancels payment.`);
    game.pendingPayment = null;
    if (payment.playProcess) rollbackPendingCardPlay(game, payment);
    if (payment.source === "activatedAbility") {
      rollbackPendingActivatedAbility(game, paymentCard(player, payment));
      checkState(game);
      return { ok: true };
    }
    if (payment.source === "effectEnergy") resolveEffectEnergyPaymentCancel(game, payment);
    if (payment.source === "triggeredAbility") {
      const state = payment.triggeredAbility;
      declineTriggerCost(state.trigger);
      removePendingTriggerChainItem(game, state.trigger);
      prepareTriggerCosts(game, state.triggers || [], state.mode || "queue", state.continuation || null);
      return { ok: true };
    }
    if (!game.pendingChoice && (game.triggerQueue?.length || game.triggerQueueContinuation)) resolveTriggerQueue(game);
    return { ok: true };
  } finally {
    leaveAsyncResolutionContext(game, payment, asyncScope);
  }
}

export function confirmPayment(game) {
  const payment = game.pendingPayment;
  if (!payment) return fail(game, "No payment is pending.");
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  const card = paymentCard(player, payment);
  if (!card) return fail(game, "Card to pay for is no longer available.");
  if (payment.source === "activatedAbility") {
    const legality = activatedAbilityFinalizationLegality(game, player, card, payment.activatedAbility?.specs || []);
    if (!legality.ok) {
      game.pendingPayment = null;
      rollbackPendingActivatedAbility(game, card);
      return fail(game, legality.message);
    }
  }
  if (payment.playProcess) {
    const legality = pendingCardPaymentLegality(game, player, card, payment);
    if (!legality.ok) {
      game.pendingPayment = null;
      rollbackPendingCardPlay(game, payment);
      return fail(game, legality.message);
    }
  }
  if (payment.source === "weaponmaster" && !weaponmasterPaymentIsLegal(game, player, card, payment)) {
    return fail(game, "The Weaponmaster attachment is no longer legal.");
  }
  const hiddenBattlefield = payment.source === "hideCard"
    ? game.battlefields.find((field) => field.instanceId === payment.destination)
    : null;
  if (payment.source === "hideCard" && (
    game.phase !== "action"
    || game.currentPlayerId !== player.id
    || !hiddenBattlefield
    || hiddenBattlefield.controlledBy !== player.id
    || hiddenCardsAtBattlefieldForPlayer(hiddenBattlefield, player.id) >= hiddenSlotLimit(hiddenBattlefield)
  )) return fail(game, "That card can no longer be hidden there.");
  if (!manualPaymentSatisfied(game, player, card, payment)) return fail(game, "Selected runes do not pay this cost.");
  const friendlyExhaustCost = (payment.declaredChoices || []).find((declaration) => declaration.effect === "friendlyExhaustAdditionalCost");
  const additionalCostUnit = friendlyExhaustCost?.unitId ? findCard(game, friendlyExhaustCost.unitId) : null;
  if (friendlyExhaustCost?.unitId && (!additionalCostUnit || additionalCostUnit.controllerId !== player.id || additionalCostUnit.exhausted)) {
    return fail(game, "The unit chosen for the additional cost is no longer ready and friendly.");
  }
  const friendlyBuffCost = (payment.declaredChoices || []).find((declaration) => declaration.effect === "friendlyBuffAdditionalCost");
  const buffCostUnit = friendlyBuffCost?.unitId ? findCard(game, friendlyBuffCost.unitId) : null;
  if (friendlyBuffCost?.unitId && (!buffCostUnit || buffCostUnit.controllerId !== player.id || (buffCostUnit.buffs || 0) <= 0)) {
    return fail(game, "The buff chosen for the additional cost is no longer available.");
  }
  const discardCost = (payment.declaredChoices || []).find((declaration) => declaration.effect === "discardAdditionalCost");
  const discardCostIndex = discardCost?.discardCardId
    ? player.hand.findIndex((candidate) => candidate.instanceId === discardCost.discardCardId && candidate.instanceId !== card.instanceId)
    : -1;
  if (discardCost?.discardCardId && discardCostIndex < 0) return fail(game, "The card chosen for the additional discard cost is no longer in hand.");
  const killCost = (payment.declaredChoices || []).find((declaration) => declaration.effect === "killFriendlyUnitAdditionalCost");
  const killCostUnit = killCost?.unitId ? findCard(game, killCost.unitId) : null;
  if (killCost?.unitId && (!killCostUnit || killCostUnit.controllerId !== player.id || !findUnitLocation(game, killCostUnit.instanceId))) {
    return fail(game, "The unit chosen for the additional kill cost is no longer controlled by you.");
  }
  const killedUnitCosts = (payment.declaredTargets || []).filter((declaration) => declaration.effect === "killFriendlyUnitsAdditionalCost");
  const killedCostUnits = killedUnitCosts.map((declaration) => findCard(game, declaration.targetId));
  if (new Set(killedUnitCosts.map((declaration) => declaration.targetId)).size !== killedUnitCosts.length
    || killedCostUnits.some((unit) => !unit || unit.controllerId !== player.id || !findUnitLocation(game, unit.instanceId))) {
    return fail(game, "A unit chosen for the additional kill cost is no longer legal.");
  }
  const buffSpendCosts = (payment.declaredTargets || []).filter((declaration) => declaration.effect === "spendFriendlyBuffsAdditionalCost");
  const buffSpendCounts = new Map();
  for (const declaration of buffSpendCosts) buffSpendCounts.set(declaration.targetId, (buffSpendCounts.get(declaration.targetId) || 0) + 1);
  if ([...buffSpendCounts].some(([unitId, amount]) => {
    const unit = findCard(game, unitId);
    return !unit || unit.controllerId !== player.id || (unit.buffs || 0) < amount;
  })) return fail(game, "A buff chosen for the additional cost is no longer available.");

  const asyncScope = enterAsyncResolutionContext(game, payment);
  try {
    applyManualPayment(game, player, payment);
  if (additionalCostUnit) exhaustCards(game, player, card, [additionalCostUnit], {
    reason: "additional-cost",
    cost: true
  });
  if (buffCostUnit) buffCostUnit.buffs -= 1;
  if (discardCostIndex >= 0) {
    const [discarded] = discardCardsFromHand(game, player, [player.hand[discardCostIndex]], card);
    triggerDiscardEffects(game, player, [discarded], card);
    log(game, `${player.name} discards ${discarded.name} as an additional cost for ${card.name}.`);
  }
  for (const [unitId, amount] of buffSpendCounts) findCard(game, unitId).buffs -= amount;
  payment.paidFriendlyExhaustAdditionalCost = Boolean(additionalCostUnit);
  payment.confirmedKillUnitIds = [
    ...(killCostUnit ? [killCostUnit.instanceId] : []),
    ...killedCostUnits.map((unit) => unit.instanceId)
  ];
  payment.confirmedKillIndex = 0;
  game.pendingPayment = null;
  return continueConfirmedPayment(game, payment);
  } finally {
    leaveAsyncResolutionContext(game, payment, asyncScope);
  }
}

function continueConfirmedPayment(game, payment) {
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  const card = paymentCard(player, payment);
  if (!player || !card) return fail(game, "Card to pay for is no longer available.");
  while ((payment.confirmedKillIndex || 0) < (payment.confirmedKillUnitIds || []).length) {
    const unitId = payment.confirmedKillUnitIds[payment.confirmedKillIndex];
    payment.confirmedKillIndex += 1;
    const unit = findCard(game, unitId);
    const location = unit ? findUnitLocation(game, unit.instanceId) : null;
    if (!unit || !location) continue;
    killUnit(game, unit,
      location.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location,
      { kind: "resumeConfirmedPayment", payment });
    log(game, `${player.name} kills ${unit.name} as an additional cost for ${card.name}.`);
    if (game.pendingChoice || game.pendingPayment) return { ok: true };
  }
  return finishConfirmedPayment(game, payment);
}

function finishConfirmedPayment(game, payment) {
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  const card = paymentCard(player, payment);
  if (!player || !card) return fail(game, "Card to pay for is no longer available.");
  const hiddenBattlefield = payment.source === "hideCard"
    ? game.battlefields.find((field) => field.instanceId === payment.destination)
    : null;
  delete payment.confirmedKillUnitIds;
  delete payment.confirmedKillIndex;
  if (payment.source === "hideCard") {
    return finishHidingCard(game, player, card, hiddenBattlefield, payment);
  }
  if (payment.source === "effectEnergy") {
    resolveEffectEnergyPayment(game, player, card, payment);
    if (!game.pendingChoice && (game.triggerQueue?.length || game.triggerQueueContinuation)) resolveTriggerQueue(game);
    checkState(game);
    return { ok: true };
  }
  if (payment.source === "activatedAbility") {
    return completeActivatedAbility(game, player, card, payment.activatedAbility?.specs || []);
  }
  if (payment.source === "triggeredAbility") {
    const state = payment.triggeredAbility;
    if (!state?.trigger || !state.descriptor) return fail(game, "The triggered ability payment is no longer valid.");
    if (!payTriggerNonResourceCost(game, state.trigger, player, card, state.descriptor,
      state.trigger.data?.triggerCostSelectionId || null)) {
      declineTriggerCost(state.trigger);
      removePendingTriggerChainItem(game, state.trigger);
    } else {
      markTriggerCostPaid(state.trigger, state.descriptor, state.trigger.data?.triggerCostSelectionId || null);
      log(game, `${player.name} pays ${card.name}'s triggered ability cost before it finalizes.`);
    }
    prepareTriggerCosts(game, state.triggers || [], state.mode || "queue", state.continuation || null);
    return { ok: true };
  }
  if (payment.source === "weaponmaster") {
    const gear = findCard(game, payment.weaponmaster?.gearId);
    attachEquipmentToUnit(game, gear, card, `${card.name} attaches ${gear?.name || "Equipment"} with Weaponmaster.`);
    if (!game.pendingChoice && (game.triggerQueue?.length || game.triggerQueueContinuation)) resolveTriggerQueue(game);
    checkState(game);
    return { ok: true };
  }
  if (payment.playProcess) {
    const item = findChainItemById(game, payment.playProcess.chainItemId);
    if (!item || item.card?.instanceId !== card.instanceId || item.status !== "pending") {
      return fail(game, "The played card is no longer a pending Chain item.");
    }
    card.declaredPlayTargets = structuredClone(payment.declaredTargets || []);
    card.declaredTargetIdentities = structuredClone(payment.declaredTargetIdentities || []);
    card.declaredPlayChoices = structuredClone(payment.declaredChoices || []);
    card.deflectPaidTargetIds = [...(payment.deflectTargetIds || [])];
    card.paidOptionalPowerEffects = (payment.optionalPowerEffects || [])
      .filter((effect) => effect.selected)
      .map((effect) => ({
        kind: effect.kind,
        domain: effect.domain,
        draw: effect.draw,
        amount: effect.requirements?.[0]?.amount || 1,
        requirements: structuredClone(effect.requirements || [])
      }));
    card.paidFriendlyExhaustAdditionalCost = Boolean(payment.paidFriendlyExhaustAdditionalCost);
    item.playOptions ||= {};
    item.playOptions.declarationsComplete = true;
    if (card.type === "spell") player.nextSpellEnergyReduction = 0;
    log(game, `${player.name} completes ${card.name}'s choices, costs, and legality check.`);
    checkState(game);
    if (game.actionChain) maybeAutoPassActionChain(game);
    return { ok: true };
  }
  if (payment.source === "effectPlay") {
    const item = findChainItemById(game, payment.effectPlay?.chainItemId);
    if (!item || item.card?.instanceId !== card.instanceId || item.status !== "pending") {
      return fail(game, "The effect-played card is no longer a pending Chain item.");
    }
    card.declaredPlayTargets = structuredClone(payment.declaredTargets || []);
    card.declaredTargetIdentities = structuredClone(payment.declaredTargetIdentities || []);
    card.declaredPlayChoices = structuredClone(payment.declaredChoices || []);
    card.deflectPaidTargetIds = [...(payment.deflectTargetIds || [])];
    card.paidOptionalPowerEffects = (payment.optionalPowerEffects || [])
      .filter((effect) => effect.selected)
      .map((effect) => ({
        kind: effect.kind,
        domain: effect.domain,
        draw: effect.draw,
        amount: effect.requirements?.[0]?.amount || 1,
        requirements: structuredClone(effect.requirements || [])
      }));
    card.paidFriendlyExhaustAdditionalCost = Boolean(payment.paidFriendlyExhaustAdditionalCost);
    item.playOptions ||= {};
    item.playOptions.declarationsComplete = true;
    log(game, `${player.name} completes ${card.name}'s required play declarations and additional costs.`);
    if (!game.preparingAutomaticEffectPlay) checkState(game);
    return { ok: true };
  }
  card.paidOptionalPowerEffects = (payment.optionalPowerEffects || [])
    .filter((effect) => effect.selected)
    .map((effect) => ({
      kind: effect.kind,
      domain: effect.domain,
      draw: effect.draw,
      amount: effect.requirements?.[0]?.amount || 1,
      requirements: structuredClone(effect.requirements || [])
    }));
  card.paidFriendlyExhaustAdditionalCost = Boolean(payment.paidFriendlyExhaustAdditionalCost);
  delete payment.paidFriendlyExhaustAdditionalCost;

  if (payment.source === "champion") {
    if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
    if (!canPlayCardAtCurrentTiming(game, player, player.champion, payment.destination)) {
      return fail(game, "That champion is no longer legally timed.");
    }
    return finishPaidChampionPlay(game, player, player.champion, payment.destination);
  }

  const cardIndex = player.hand.findIndex((candidate) => candidate.instanceId === payment.cardId);
  if (cardIndex < 0) return fail(game, "That card is not in hand.");
  if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
  if (!canPlayCardAtCurrentTiming(game, player, card, payment.destination)) {
    return fail(game, "That card is no longer legally timed.");
  }
  card.declaredPlayTargets = structuredClone(payment.declaredTargets || []);
  card.declaredTargetIdentities = structuredClone(payment.declaredTargetIdentities || []);
  card.declaredPlayChoices = structuredClone(payment.declaredChoices || []);
  card.deflectPaidTargetIds = [...(payment.deflectTargetIds || [])];
  player.hand.splice(cardIndex, 1);
  game.selectedCardId = card.instanceId;

  if (game.phase === "showdown") {
    if (card.type === "spell") player.nextSpellEnergyReduction = 0;
    return addPaidCardToShowdown(game, player, card, payment.destination);
  }
  if (game.actionChain) {
    if (card.type === "spell") player.nextSpellEnergyReduction = 0;
    return addPaidCardToActionChain(game, player, card, payment.destination);
  }
  return resolvePaidCard(game, player, card, payment.destination);
}

function enterAsyncResolutionContext(game, pending) {
  const previous = game.resolvingGameEffect;
  const context = pending.gameEffectResolution?.context || null;
  if (context) game.resolvingGameEffect = context;
  return { previous, context };
}

function leaveAsyncResolutionContext(game, pending, scope) {
  let nextPending = game.pendingChoice || game.pendingPayment;
  if (!nextPending && pending.effectSequenceContinuation) {
    const continuation = pending.effectSequenceContinuation;
    const player = game.players.find((candidate) => candidate.id === continuation.playerId);
    const waits = player
      ? resolveEffectSpecs(game, player, continuation.card, continuation.specs, continuation.finishSpell)
      : false;
    if (!waits && continuation.finishSpell && player) finishSpell(game, player, continuation.card);
    nextPending = game.pendingChoice || game.pendingPayment;
  }
  if (nextPending) propagateAsyncResolutionState(pending, nextPending, { effectSequenceContinuation: null });
  if (scope.previous) game.resolvingGameEffect = scope.previous;
  else delete game.resolvingGameEffect;
  if (scope.context && !nextPending) flushGameEffectTriggers(game, scope.context);
  if (scope.context && !nextPending && game.cleanupOutstanding) checkState(game);
}

function putPermanentIntoPlay(game, player, card, destination, isChampion, playOptions = {}) {
  const battlefield = game.battlefields.find((field) => field.instanceId === destination || field.id === destination);
  if (card.type === "unit" && battlefield && !playOptions.allowUncontrolledBattlefield
    && !canEnterBattlefield(game, player, card, battlefield)) {
    return fail(game, "Units can only be played to your base or a battlefield you control.");
  }

  if (card.type === "unit") {
    card.exhausted = !unitEntersReady(game, player, card);
    if (player.nextUnitEnterReady) player.nextUnitEnterReady = false;
    if (battlefield) {
      battlefield.units.push(card);
      if (!battlefield.units.some((unit) => unit.controllerId !== player.id)) battlefield.controlledBy = player.id;
      log(game, `${player.name} plays ${card.name} to ${battlefield.name}.`);
      triggerOpponentPlaysUnit(game, player, card, battlefield);
      upgradeNonCombatShowdownIfOpposed(game, battlefield);
    } else {
      player.base.push(card);
      log(game, `${player.name} plays ${card.name}${isChampion ? " from the Champion Zone" : ""} to base.`);
    }
    requestCleanup(game, "board-zone-change", { objectId: card.instanceId, change: "entered-board" });
  } else if (card.type === "gear") {
    card.exhausted = false;
    player.base.push(card);
    log(game, `${player.name} plays gear ${card.name}.`);
    requestCleanup(game, "board-zone-change", { objectId: card.instanceId, change: "entered-board" });
  }
  return { ok: true };
}

function recordResolvedPlay(game, player, playedObject, { isCard, continuation = null } = {}) {
  if (isCard) player.cardsPlayedThisTurn = (player.cardsPlayedThisTurn || 0) + 1;
  const triggers = [
    ...(isCard ? collectActionSynergyTriggers(game, player, playedObject) : []),
    ...collectPlayedObjectTriggers(game, player, playedObject, { isCard })
  ];
  if (!triggers.length) return false;
  const mode = game.phase === "showdown" && game.showdown
    ? "showdownChain"
    : game.phase === "action" && game.interactive ? "actionChain" : "queue";
  return prepareAndQueueTriggers(game, triggers, mode, continuation);
}

function recordResolvedCardPlay(game, player, playedCard, continuation = null) {
  return recordResolvedPlay(game, player, playedCard, { isCard: true, continuation });
}

function recordResolvedTokenPlay(game, player, playedToken, continuation = null) {
  return recordResolvedPlay(game, player, playedToken, { isCard: false, continuation });
}

function completePermanentPlayAfterPlacement(game, player, permanent, { isCard }) {
  const hasOnPlay = cardEffects(permanent, "onPlay").length > 0 || enabledKeywordPlayEffectSpecs(permanent, game).length > 0;
  const continuation = hasOnPlay ? {
    kind: "resolvePermanentOnPlay",
    playerId: player.id,
    cardId: permanent.instanceId
  } : null;
  const playTriggers = isCard
    ? recordResolvedCardPlay(game, player, permanent, continuation)
    : recordResolvedTokenPlay(game, player, permanent, continuation);
  if (hasOnPlay && !playTriggers) resolveOnPlayEffect(game, player, permanent);
  checkState(game);
  return { ok: true };
}

function completePermanentCardPlayAfterPlacement(game, player, card) {
  return completePermanentPlayAfterPlacement(game, player, card, { isCard: true });
}

function resolvePermanentCardPlay(game, player, card, destination, isChampion = false, playOptions = {}) {
  if (isChampion) setChampionZoneState(player, card, "played");
  const result = putPermanentIntoPlay(game, player, card, destination, isChampion, playOptions);
  if (!result.ok) return result;
  return completePermanentCardPlayAfterPlacement(game, player, card);
}

function unitEntersReady(game, player, card) {
  if (hasPaidOptionalKind(card, "accelerate")) return true;
  if (hasStaticEffect(card, "entersReady")) return true;
  if (hasStaticEffect(card, "enterReadyIfOpponentControlsBattlefield") && game.battlefields.some((field) => field.controlledBy && field.controlledBy !== player.id)) {
    return true;
  }
  const nearVictory = firstCardEffect(card, "static", "enterReadyIfOpponentNearVictory");
  if (nearVictory && game.players.some((candidate) => candidate.id !== player.id
    && currentVictoryScore(game) - candidate.score <= (nearVictory.points || 0))) return true;
  if (player.unitsEnterReadyThisTurn || player.nextUnitEnterReady) return true;
  return allControlledCards(game, player.id)
    .some((source) => source.instanceId !== card.instanceId && hasStaticEffect(source, "otherFriendlyUnitsEnterReady"));
}

function hasPaidOptionalKind(card, kind) {
  return (card.paidOptionalPowerEffects || []).some((effect) => effect.kind === kind);
}

function createCardInstance(game, source, ownerId) {
  game.nextGeneratedInstanceId = (game.nextGeneratedInstanceId || 100000) + 1;
  return {
    ...structuredClone(source),
    instanceId: `g${game.nextGeneratedInstanceId}`,
    ownerId,
    controllerId: ownerId,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    mightModifier: 0,
    attachments: []
  };
}

function cardByNumber(number) {
  return Object.values(cardRegistry).find((card) => card.cardNumber === number || card.collectorNumber === number || card.id === number);
}

export function playUnitToken(game, player, source, spec = {}, destination = null) {
  const tokenSource = officialTokenDefinition(spec.tokenKind)
    || cardByNumber(spec.tokenCardNumber || "OGN-273/298");
  if (!tokenSource) {
    log(game, `${source.name} could not find token ${spec.tokenKind || spec.tokenCardNumber || "OGN-273/298"}.`);
    return false;
  }
  if (tokenSource.type !== "unit") {
    log(game, `${source.name} cannot create ${tokenSource.name} through the unit-token resolver.`);
    return false;
  }
  const count = Math.max(1, spec.count || 1);
  const played = [];
  for (let index = 0; index < count; index += 1) {
    const token = createCardInstance(game, tokenSource, player.id);
    token.exhausted = !Boolean(spec.ready);
    const targetDestination = destination || tokenDestinationFromSpec(game, player, source, spec);
    placeTokenAtDestination(game, player, source, token, targetDestination);
    completePermanentPlayAfterPlacement(game, player, token, { isCard: false });
    played.push(token);
  }
  markEffect(game, source, [source.instanceId, ...played.map((token) => token.instanceId)], `${source.name} plays ${played.length} token${played.length === 1 ? "" : "s"}.`);
  return played.length > 0;
}

export function playToken(game, player, source, spec = {}, destination = null) {
  const tokenSource = officialTokenDefinition(spec.tokenKind)
    || cardByNumber(spec.tokenCardNumber || "OGN-273/298");
  if (!tokenSource) return false;
  if (tokenSource.type === "unit") return playUnitToken(game, player, source, spec, destination);
  if (tokenSource.type !== "gear") return false;
  const count = Math.max(1, spec.count || 1);
  const played = [];
  for (let index = 0; index < count; index += 1) {
    const token = createCardInstance(game, tokenSource, player.id);
    token.exhausted = Boolean(spec.exhausted) && spec.ready !== true;
    player.base.push(token);
    requestCleanup(game, "board-zone-change", { objectId: token.instanceId, change: "entered-board" });
    completePermanentPlayAfterPlacement(game, player, token, { isCard: false });
    played.push(token);
  }
  markEffect(game, source, [source.instanceId, ...played.map((token) => token.instanceId)], `${source.name} plays ${played.length} token${played.length === 1 ? "" : "s"}.`);
  return played.length > 0;
}

export function replaceBattlefieldWithToken(game, battlefieldId, tokenKind, playerId = null) {
  const index = game.battlefields.findIndex((field) => field.instanceId === battlefieldId || field.id === battlefieldId);
  const original = game.battlefields[index];
  const definition = officialTokenDefinition(tokenKind);
  if (index < 0 || !original || definition?.type !== "battlefield") return null;
  const creator = game.players.find((player) => player.id === playerId) || currentPlayer(game);
  const originalOwner = game.players.find((player) => player.id === original.ownerId) || creator;
  if (!creator || !originalOwner) return null;

  const token = createCardInstance(game, definition, creator.id);
  inheritBattlefieldState(original, token);
  token.replacedBattlefieldId = original.instanceId;
  token.replacedBattlefieldOwnerId = original.ownerId || originalOwner.id;
  original.replacedByTokenId = token.instanceId;
  original.replacedInBanishment = true;
  delete original.units;
  delete original.hidden;
  delete original.controlledBy;
  delete original.contestedBy;
  markNonBoardZoneChange(original);
  originalOwner.banished ||= [];
  originalOwner.banished.push(original);
  game.battlefields[index] = token;
  replaceBattlefieldRuntimeReferences(game, original.instanceId, token);
  migrateScoredBattlefieldIdentity(game, original.instanceId, token.instanceId);
  requestCleanup(game, "board-zone-change", { objectId: original.instanceId, replacementId: token.instanceId, change: "battlefield-replaced" });
  return token;
}

export function swapBackBattlefieldToken(game, tokenId) {
  const index = game.battlefields.findIndex((field) => field.instanceId === tokenId && field.isToken);
  const token = game.battlefields[index];
  if (index < 0 || !token?.replacedBattlefieldId) return null;
  let owner = null;
  let original = null;
  for (const player of game.players) {
    const candidateIndex = (player.banished || []).findIndex((card) =>
      card.instanceId === token.replacedBattlefieldId && card.replacedByTokenId === token.instanceId);
    if (candidateIndex < 0) continue;
    owner = player;
    [original] = player.banished.splice(candidateIndex, 1);
    break;
  }
  if (!owner || !original) return null;
  inheritBattlefieldState(token, original);
  delete original.replacedByTokenId;
  delete original.replacedInBanishment;
  markNonBoardZoneChange(original);
  game.battlefields[index] = original;
  replaceBattlefieldRuntimeReferences(game, token.instanceId, original);
  migrateScoredBattlefieldIdentity(game, token.instanceId, original.instanceId);
  requestCleanup(game, "board-zone-change", { objectId: token.instanceId, replacementId: original.instanceId, change: "battlefield-swapped-back" });
  return original;
}

function inheritBattlefieldState(source, target) {
  target.units = source.units || [];
  target.hidden = source.hidden || [];
  target.controlledBy = source.controlledBy || null;
  if (source.contestedBy) target.contestedBy = source.contestedBy;
  else delete target.contestedBy;
  for (const key of ["lastScoredTurnSequence", "combatExcessDamageByPlayer"]) {
    if (source[key] !== undefined) target[key] = structuredClone(source[key]);
    else delete target[key];
  }
}

function replaceBattlefieldRuntimeReferences(game, previousId, replacement) {
  if (game.showdown?.battlefieldId === previousId) game.showdown.battlefieldId = replacement.instanceId;
  for (const event of game.stagedEvents || []) {
    if (event.battlefield?.instanceId === previousId || event.battlefieldId === previousId) {
      event.battlefield = replacement;
      event.battlefieldId = replacement.instanceId;
    }
  }
}

function migrateScoredBattlefieldIdentity(game, previousId, nextId) {
  for (const player of game.players) {
    if (!player.turnScoredBattlefields?.has(previousId)) continue;
    player.turnScoredBattlefields.delete(previousId);
    player.turnScoredBattlefields.add(nextId);
  }
}

function tokenDestinationFromSpec(game, player, source, spec = {}) {
  if (spec.destination === "base") return "base";
  if (spec.destination === "sourceBattlefield") {
    const location = findUnitLocation(game, source.instanceId);
    if (location?.type === "battlefield") return location.battlefield.instanceId;
  }
  if (spec.destination === "showdownBattlefield" && game.showdown?.battlefieldId) return game.showdown.battlefieldId;
  if (spec.destination === "hiddenBattlefield" && source.hiddenBattlefieldId) return source.hiddenBattlefieldId;
  if (spec.destination === "firstControlledBattlefield") {
    return game.battlefields.find((field) => field.controlledBy === player.id)?.instanceId || "base";
  }
  return "base";
}

function placeTokenAtDestination(game, player, source, token, destination) {
  const battlefield = game.battlefields.find((field) => field.instanceId === destination || field.id === destination);
  if (!battlefield) {
    player.base.push(token);
    requestCleanup(game, "board-zone-change", { objectId: token.instanceId, change: "entered-board" });
    log(game, `${source.name} plays ${token.name} into ${player.name}'s base.`);
    return;
  }
  battlefield.units.push(token);
  requestCleanup(game, "board-zone-change", { objectId: token.instanceId, change: "entered-board" });
  if (!battlefield.units.some((unit) => unit.controllerId !== player.id)) battlefield.controlledBy = player.id;
  log(game, `${source.name} plays ${token.name} at ${battlefield.name}.`);
  triggerOpponentPlaysUnit(game, player, token, battlefield);
  if (!upgradeNonCombatShowdownIfOpposed(game, battlefield)) {
    startShowdownIfOpposedAfterEffect(game, battlefield, player.id);
  }
}

export function moveUnit(game, unitId, destinationId) {
  return moveUnits(game, [unitId], destinationId);
}

export function moveUnits(game, unitIds, destinationId) {
  if (game.pendingPayment || game.pendingChoice || game.actionChain) return fail(game, "Finish the current choice first.");
  if (game.phase !== "action") return fail(game, "You must finish setup before moving units.");
  const player = currentPlayer(game);
  const uniqueUnitIds = [...new Set(unitIds || [])];
  if (!uniqueUnitIds.length) return fail(game, "Choose at least one unit to move.");

  const destination = destinationId === "base"
    ? null
    : game.battlefields.find((field) => field.instanceId === destinationId || field.id === destinationId);
  if (destinationId !== "base" && !destination) return fail(game, "Unknown destination.");

  const sources = [];
  for (const unitId of uniqueUnitIds) {
    const source = findUnitLocation(game, unitId);
    if (!source || source.unit.controllerId !== player.id) return fail(game, "That unit is not yours.");
    if (source.unit.exhausted) return fail(game, "That unit is exhausted.");
    if (source.unit.cantMoveThisTurn) return fail(game, "That unit cannot move this turn.");
    if (source.type === "battlefield" && destination
      && !hasKeyword(source.unit, "Ganking", game)
      && !hasStaticEffect(destination, "unitsCanMoveHereFromAnywhere")) {
      return fail(game, "Only Ganking units can move directly between battlefields.");
    }
    if (source.type === "battlefield" && !destination && hasStaticEffect(source.battlefield, "cantMoveFromHereToBase")) {
      return fail(game, `${source.battlefield.name} prevents units from moving to base.`);
    }
    sources.push(source);
  }

  const movedUnits = [];
  const operation = beginGameOperation(game, "move", {
    playerId: player.id,
    unitIds: [...uniqueUnitIds],
    destinationId
  });
  const destinationWasEmpty = Boolean(destination && destination.units.length === 0);
  const destinationControlledBy = destination?.controlledBy || null;
  const sourceBattlefieldIds = Object.fromEntries(sources
    .filter((source) => source.type === "battlefield")
    .map((source) => [source.unit.instanceId, source.battlefield.instanceId]));
  exhaustCards(game, player, null, sources.map((source) => source.unit), {
    reason: "standard-move-cost",
    cost: true
  });
  for (const unitId of uniqueUnitIds) {
    const source = findUnitLocation(game, unitId);
    removeUnitFromSource(source);
    movedUnits.push(source.unit);
  }
  game.selectedCardId = movedUnits[movedUnits.length - 1].instanceId;

  if (!destination) {
    player.base.push(...movedUnits);
    log(game, movedUnits.length === 1
      ? `${movedUnits[0].name} returns to base.`
      : `${player.name} moves ${movedUnits.length} units to base.`);
    continueStandardMoveEffects(game, {
      type: "standardMoveBatch",
      playerId: player.id,
      unitIds: movedUnits.map((unit) => unit.instanceId),
      destinationId: "base",
      sourceBattlefieldIds,
      operationId: operation.id,
      unitIndex: 0
    });
    return { ok: true };
  }

  destination.units.push(...movedUnits);
  log(game, movedUnits.length === 1
    ? `${player.name} moves ${movedUnits[0].name} to ${destination.name}.`
    : `${player.name} moves ${movedUnits.length} units to ${destination.name}.`);
  continueStandardMoveEffects(game, {
    type: "standardMoveBatch",
    playerId: player.id,
    unitIds: movedUnits.map((unit) => unit.instanceId),
    destinationId: destination.instanceId,
    sourceBattlefieldIds,
    destinationWasEmpty,
    destinationControlledBy,
    operationId: operation.id,
    unitIndex: 0
  });
  return { ok: true };
}

function finishMoveDestination(game, player, unit, destination, options = {}) {
  const enemyUnits = destination.units.filter((candidate) => candidate.controllerId !== player.id);
  if (enemyUnits.length > 0) {
    stageBattlefieldEvent(game, {
      type: "combat",
      battlefield: destination,
      attackerId: player.id
    });
  } else if (options.destinationWasEmpty && options.destinationControlledBy !== player.id) {
    destination.controlledBy = options.destinationControlledBy || null;
    stageBattlefieldEvent(game, {
      type: "showdown",
      battlefield: destination,
      attackerId: player.id,
      defenderId: options.destinationControlledBy || game.players.find((candidate) => candidate.id !== player.id)?.id
    });
  } else if (destination.controlledBy !== player.id) {
    destination.controlledBy = player.id;
    const scored = awardPoint(game, player, destination.instanceId, "conquer");
    triggerConquerEventEffects(game, player, destination, [unit], scored);
    log(game, `${player.name} conquers ${destination.name}.`);
  } else {
    destination.controlledBy = player.id;
  }

  updateBattlefieldControl(game);
  requestCleanup(game, "move-completed", { unitIds: [unit.instanceId], destinationId: destination.instanceId });
  checkState(game);
}

function finishMoveDestinationBatch(game, player, units, destination, options = {}) {
  const presentUnits = units.filter((unit) => {
    const location = findUnitLocation(game, unit.instanceId);
    return location?.type === "battlefield" && location.battlefield.instanceId === destination.instanceId;
  });
  const enemyUnits = destination.units.filter((candidate) => candidate.controllerId !== player.id);
  if (enemyUnits.length > 0 && presentUnits.length > 0) {
    stageBattlefieldEvent(game, {
      type: "combat",
      battlefield: destination,
      attackerId: player.id
    });
  } else if (options.destinationWasEmpty && options.destinationControlledBy !== player.id && presentUnits.length > 0) {
    destination.controlledBy = options.destinationControlledBy || null;
    stageBattlefieldEvent(game, {
      type: "showdown",
      battlefield: destination,
      attackerId: player.id,
      defenderId: options.destinationControlledBy || game.players.find((candidate) => candidate.id !== player.id)?.id
    });
  } else if (destination.controlledBy !== player.id && presentUnits.length > 0) {
    destination.controlledBy = player.id;
    const scored = awardPoint(game, player, destination.instanceId, "conquer");
    triggerConquerEventEffects(game, player, destination, presentUnits, scored);
    log(game, `${player.name} conquers ${destination.name}.`);
  } else if (presentUnits.length > 0) {
    destination.controlledBy = player.id;
  }

  updateBattlefieldControl(game);
  requestCleanup(game, "move-completed", {
    unitIds: units.map((unit) => unit.instanceId),
    destinationId: destination.instanceId
  });
  checkState(game);
}

function canEnterBattlefield(game, player, card, battlefield) {
  if (opponentForcesUnitsToBase(game, player, card)) return false;
  if (battlefield.controlledBy === player.id) return true;
  const hasFriendlyUnit = battlefield.units.some((unit) => unit.controllerId === player.id);
  if (hasFriendlyUnit && hasKeyword(card, "Ambush", game)) return true;
  const hasEnemyUnit = battlefield.units.some((unit) => unit.controllerId !== player.id);
  if (!battlefield.controlledBy && !hasEnemyUnit) return canEnterOpenBattlefield(game, player, card);
  return canEnterEnemyBattlefield(game, card);
}

function opponentForcesUnitsToBase(game, player, card) {
  if (card?.type !== "unit") return false;
  return game.battlefields.some((field) =>
    field.units.some((unit) =>
      unit.controllerId !== player.id
      && hasStaticEffect(unit, "opponentsUnitsOnlyToBase")
    )
  );
}

function canEnterOpenBattlefield(game, player, card) {
  if (hasStaticEffect(card, "canEnterOpenBattlefield")) return true;
  return allControlledCards(game, player.id)
    .some((source) => source.instanceId !== card.instanceId && hasStaticEffect(source, "friendlyUnitsCanEnterOpenBattlefields"));
}

function canEnterEnemyBattlefield(game, card) {
  return hasStaticEffect(card, "canEnterEnemyBattlefield");
}

function resetChainPassCycle(chainState) {
  chainState.consecutivePasses = 0;
}

function recordChainPass(chainState, participantIds) {
  chainState.consecutivePasses = (chainState.consecutivePasses || 0) + 1;
  return chainState.consecutivePasses >= participantIds.length;
}

export function passShowdown(game, playerId = game.currentPlayerId) {
  if (game.pendingPayment || game.pendingChoice) return fail(game, "Finish the current choice first.");
  if (game.phase === "action" && game.actionChain) return passActionChain(game, playerId);
  if (game.phase !== "showdown" || !game.showdown) return fail(game, "There is no active showdown.");
  if (game.showdown.priorityPlayerId !== playerId) return fail(game, "It is not that player's showdown priority.");
  if (normalizeChainItems(game.showdown).some((item) => item.status === "pending" && !pendingCardReadyForFinalize(item))) {
    return fail(game, "A Pending Chain item must complete its declarations before players can pass.");
  }

  const player = game.players.find((candidate) => candidate.id === playerId);
  const allPlayersPassed = recordChainPass(game.showdown, showdownPlayerIds(game.showdown));
  log(game, `${player.name} passes in the showdown.`);

  if (allPlayersPassed) {
    if (game.showdown.chain.length > 0) {
      finalizePendingChainItems(game);
      resolveShowdownTop(game);
      if (game.phase === "complete" || !game.showdown) return { ok: true };
      if (game.pendingChoice || game.pendingPayment) return { ok: true };
      continueShowdownAfterChainResolution(game);
      return { ok: true };
    }

    finishShowdown(game);
    return { ok: true };
  }

  const nextPlayerId = otherShowdownPlayerId(game.showdown, playerId);
  if (!game.showdown.chain.length) game.showdown.focusPlayerId = nextPlayerId;
  giveShowdownPriority(game, nextPlayerId);
  return { ok: true };
}

function passActionChain(game, playerId = game.currentPlayerId) {
  if (!game.actionChain) return fail(game, "There is no active chain.");
  if (game.actionChain.priorityPlayerId !== playerId) return fail(game, "It is not that player's chain priority.");
  if (normalizeActionChainItems(game.actionChain).some((item) => item.status === "pending" && !pendingCardReadyForFinalize(item))) {
    return fail(game, "A Pending Chain item must complete its declarations before players can pass.");
  }
  const player = game.players.find((candidate) => candidate.id === playerId);
  const allPlayersPassed = recordChainPass(game.actionChain, actionChainPlayerIds(game.actionChain));
  log(game, `${player?.name || "A player"} passes.`);

  if (allPlayersPassed) {
    if (game.actionChain.chain.length > 0) {
      finalizePendingActionChainItems(game);
      resolveActionChainTop(game);
      if (game.phase === "complete" || !game.actionChain) return { ok: true };
      if (game.pendingChoice || game.pendingPayment) return { ok: true };
      continueActionChainAfterResolution(game);
      return { ok: true };
    }
    finishActionChain(game);
    return { ok: true };
  }

  giveActionChainPriority(game, otherActionChainPlayerId(game.actionChain, playerId));
  return { ok: true };
}

export function chooseEffectOption(game, optionId) {
  const choice = game.pendingChoice;
  if (!choice) return fail(game, "No effect choice is pending.");
  const option = choice.options.find((candidate) => candidate.id === optionId);
  if (!option) return fail(game, "Unknown choice.");
  if (option.disabled) return fail(game, "That choice is not legal.");
  game.pendingChoice = null;
  game.resolvingChoiceContext = choice;
  const previousGameEffect = game.resolvingGameEffect;
  if (choice.gameEffectResolution?.context) game.resolvingGameEffect = choice.gameEffectResolution.context;
  try {
    applyChoiceEffect(game, choice, option);
  } finally {
    delete game.resolvingChoiceContext;
    if (previousGameEffect) game.resolvingGameEffect = previousGameEffect;
    else delete game.resolvingGameEffect;
  }
  const player = game.players.find((candidate) => candidate.id === choice.playerId);
  if (game.pendingChoice || game.pendingPayment) {
    propagateAsyncResolutionState(choice, game.pendingChoice || game.pendingPayment);
    return { ok: true };
  }
  if (choice.effectSequenceContinuation) {
    const previous = game.resolvingGameEffect;
    if (choice.gameEffectResolution?.context) game.resolvingGameEffect = choice.gameEffectResolution.context;
    try {
      const continuation = choice.effectSequenceContinuation;
      const continuationPlayer = game.players.find((candidate) => candidate.id === continuation.playerId);
      const waits = continuationPlayer
        ? resolveEffectSpecs(game, continuationPlayer, continuation.card, continuation.specs, continuation.finishSpell)
        : false;
      if (!waits && continuation.finishSpell && continuationPlayer) finishSpell(game, continuationPlayer, continuation.card);
    } finally {
      if (previous) game.resolvingGameEffect = previous;
      else delete game.resolvingGameEffect;
    }
    if (game.pendingChoice || game.pendingPayment) {
      propagateAsyncResolutionState(choice, game.pendingChoice || game.pendingPayment, { effectSequenceContinuation: null });
      return { ok: true };
    }
  } else if (choice.finishSpell) {
    const previous = game.resolvingGameEffect;
    if (choice.gameEffectResolution?.context) game.resolvingGameEffect = choice.gameEffectResolution.context;
    try {
      finishSpell(game, player, choice.card);
    } finally {
      if (previous) game.resolvingGameEffect = previous;
      else delete game.resolvingGameEffect;
    }
  }
  if (choice.gameEffectResolution?.context) flushGameEffectTriggers(game, choice.gameEffectResolution.context);
  if (continueTriggerQueueAfterChoice(game)) return { ok: true };
  checkState(game);
  if (game.phase === "showdown" && game.showdown && choice.fromShowdownChain) {
    continueShowdownAfterChainResolution(game);
  }
  if (game.phase === "action" && game.actionChain && choice.fromActionChain) {
    continueActionChainAfterResolution(game);
  }
  return { ok: true };
}

export function declineEffectChoice(game) {
  const choice = game.pendingChoice;
  if (!choice || !choice.optional) return fail(game, "That effect cannot be declined.");
  game.pendingChoice = null;
  const player = game.players.find((candidate) => candidate.id === choice.playerId);
  log(game, `${player.name} declines ${choice.card.name}.`);
  if (choice.data?.declareTrigger) {
    choice.data.trigger.declined = true;
    prepareTriggerDeclarations(game, choice.data.remainingTriggers || [], choice.data.mode || "queue", choice.data.continuation || null);
    return { ok: true };
  }
  if (choice.effectSequenceContinuation) {
    const previous = game.resolvingGameEffect;
    if (choice.gameEffectResolution?.context) game.resolvingGameEffect = choice.gameEffectResolution.context;
    try {
      const continuation = choice.effectSequenceContinuation;
      const continuationPlayer = game.players.find((candidate) => candidate.id === continuation.playerId);
      const waits = continuationPlayer
        ? resolveEffectSpecs(game, continuationPlayer, continuation.card, continuation.specs, continuation.finishSpell)
        : false;
      if (!waits && continuation.finishSpell && continuationPlayer) finishSpell(game, continuationPlayer, continuation.card);
    } finally {
      if (previous) game.resolvingGameEffect = previous;
      else delete game.resolvingGameEffect;
    }
    if (game.pendingChoice || game.pendingPayment) {
      propagateAsyncResolutionState(choice, game.pendingChoice || game.pendingPayment, { effectSequenceContinuation: null });
      return { ok: true };
    }
  } else if (choice.finishSpell) {
    const previous = game.resolvingGameEffect;
    if (choice.gameEffectResolution?.context) game.resolvingGameEffect = choice.gameEffectResolution.context;
    try {
      finishSpell(game, player, choice.card);
    } finally {
      if (previous) game.resolvingGameEffect = previous;
      else delete game.resolvingGameEffect;
    }
  }
  if (choice.gameEffectResolution?.context) flushGameEffectTriggers(game, choice.gameEffectResolution.context);
  if (continueTriggerQueueAfterChoice(game)) return { ok: true };
  checkState(game);
  if (game.phase === "showdown" && game.showdown && choice.fromShowdownChain) {
    continueShowdownAfterChainResolution(game);
  }
  if (game.phase === "action" && game.actionChain && choice.fromActionChain) {
    continueActionChainAfterResolution(game);
  }
  return { ok: true };
}

function propagateAsyncResolutionState(source, target, overrides = {}) {
  if (!target) return;
  if (source.fromActionChain) target.fromActionChain = true;
  if (source.fromShowdownChain) target.fromShowdownChain = true;
  if (source.gameEffectResolution && !target.gameEffectResolution) target.gameEffectResolution = source.gameEffectResolution;
  if (source.explicitDeathContinuation && !target.explicitDeathContinuation) {
    target.explicitDeathContinuation = source.explicitDeathContinuation;
  }
  if (source.effectSequenceContinuation && !target.effectSequenceContinuation) {
    target.effectSequenceContinuation = source.effectSequenceContinuation;
  }
  Object.assign(target, overrides);
}

function continueTriggerQueueAfterChoice(game) {
  if (game.pendingChoice) return true;
  if (game.pendingPayment) return true;
  if (game.triggerQueue?.length || game.triggerQueueContinuation) {
    resolveTriggerQueue(game);
  }
  return Boolean(game.pendingChoice);
}

function canPay(game, player, card) {
  const cost = adjustedCost(game, player, card);
  const energy = cost.energy;
  const readyRunes = player.runes.filter((rune) => !rune.exhausted);
  if (readyRunes.length + availablePoolEnergyCount(game, player, card) < energy) return false;
  return Boolean(choosePowerPaymentSources(player, cost.power));
}

function payCost(game, player, card) {
  const cost = adjustedCost(game, player, card);
  const powerSources = choosePowerPaymentSources(player, cost.power) || { powerRuneIds: [], poolPowerIds: [] };
  const autoPoolIds = runePoolEnergy(player)
    .filter((resource) => poolEnergyCanPay(game, resource))
    .slice(0, cost.energy)
    .map((resource) => resource.id);
  consumeSelectedPoolEnergy(player, autoPoolIds);
  let energy = Math.max(0, cost.energy - autoPoolIds.length);

  const energyRunes = [];
  for (const rune of player.runes) {
    if (energy <= 0) break;
    if (!rune.exhausted) {
      energyRunes.push(rune);
      energy -= 1;
    }
  }
  exhaustCards(game, player, card, energyRunes, { reason: "play-energy-cost", cost: true });

  recyclePowerRunesInChosenOrder(game, player, powerSources.powerRuneIds);
  consumeSelectedPoolPower(player, powerSources.poolPowerIds);
}

function createPayment(game, player, card, destination, source, options = {}) {
  const ignoreBaseCost = Boolean(options.ignoreBaseCost);
  const ignoreEnergyBaseCost = ignoreBaseCost || Boolean(options.ignoreEnergyBaseCost);
  const ignorePowerBaseCost = ignoreBaseCost || Boolean(options.ignorePowerBaseCost);
  const optionalPowerEffects = optionalAdditionalPowerEffects(card);
  const deflectPowerCost = options.deflectPowerCost || [];
  const repeatEnergy = (options.declaredChoices || [])
    .filter((declaration) => declaration.effect === "repeatCount")
    .reduce((sum, declaration) => sum + (declaration.amount || 0) * (declaration.repeatCostEnergy || 0), 0);
  const ignoresCost = (options.declaredChoices || []).some((declaration) => declaration.effect === "friendlyBuffAdditionalCost" && declaration.unitId);
  const discardReduction = (options.declaredChoices || []).some((declaration) => declaration.effect === "discardAdditionalCost" && declaration.discardCardId)
    ? (card.additionalCost?.energyReduction || 0)
    : 0;
  const powerReduction = (options.declaredTargets || []).filter((declaration) => [
    "killFriendlyUnitsAdditionalCost",
    "spendFriendlyBuffsAdditionalCost"
  ].includes(declaration.effect)).length;
  const costContext = {
    ignoreEnergyBaseCost: ignoreEnergyBaseCost || ignoresCost,
    ignorePowerBaseCost: ignorePowerBaseCost || ignoresCost,
    baseEnergyReduction: options.baseEnergyReduction || 0,
    ...(Number.isFinite(options.replacementEnergyCost)
      ? { replacementEnergyCost: Math.max(0, options.replacementEnergyCost) }
      : {}),
    ...(Array.isArray(options.replacementPowerCost)
      ? { replacementPowerCost: structuredClone(options.replacementPowerCost) }
      : {}),
    additionalEnergy: repeatEnergy,
    energyDiscount: discardReduction,
    additionalPower: structuredClone(deflectPowerCost),
    powerDiscount: powerReduction
  };
  const cost = adjustedCost(game, player, card, costContext);
  const payment = {
    playerId: player.id,
    cardId: card.instanceId,
    cardName: card.name,
    destination,
    source,
    energyCost: cost.energy,
    basePowerCost: structuredClone(cost.power),
    powerCost: structuredClone(cost.power),
    declaredTargets: structuredClone(options.declaredTargets || []),
    declaredTargetIdentities: captureTargetIdentities(game, options.declaredTargets || []),
    declaredChoices: structuredClone(options.declaredChoices || []),
    deflectTargetIds: [...(options.deflectTargetIds || [])],
    ignoreBaseCost,
    ignoreEnergyBaseCost,
    ignorePowerBaseCost,
    costContext,
    optionalPowerEffects,
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    poolPowerIds: []
  };
  return payment;
}

function reducePowerRequirements(requirements, amount) {
  let remaining = Math.max(0, amount || 0);
  return (requirements || []).map((requirement) => {
    const reduced = Math.min(remaining, requirement.amount || 0);
    remaining -= reduced;
    return { ...requirement, amount: (requirement.amount || 0) - reduced };
  }).filter((requirement) => requirement.amount > 0);
}

function createActivatedPayment(player, card, specs, cost, options = {}) {
  const powerCost = normalizeCardPowerRequirements(card, cost.power || []);
  return {
    playerId: player.id,
    cardId: card.instanceId,
    cardName: card.name,
    destination: null,
    source: "activatedAbility",
    energyCost: cost.energy || 0,
    recycleTrashCost: cost.recycleTrash || 0,
    recycleTrashCardIds: [...(options.recycleTrashCardIds || [])],
    basePowerCost: structuredClone(powerCost),
    powerCost: structuredClone(powerCost),
    declaredTargets: [],
    declaredChoices: [],
    deflectTargetIds: [],
    optionalPowerEffects: [],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    poolPowerIds: [],
    activatedAbility: {
      specs: structuredClone(specs || [])
    }
  };
}

function createTriggeredAbilityPayment(game, player, source, trigger, descriptor, triggers, mode, continuation) {
  const amount = descriptor.effect?.amount || trigger.data?.amount || 1;
  const domain = descriptor.effect?.domain || trigger.data?.domain || "Any";
  const powerCost = ["power", "powerAndExhaustSource"].includes(descriptor.kind)
    ? [{ domain, amount: 1 }]
    : [];
  return {
    playerId: player.id,
    cardId: source.instanceId,
    cardName: source.name,
    destination: null,
    source: "triggeredAbility",
    energyCost: descriptor.kind === "energy" ? amount : 0,
    basePowerCost: structuredClone(powerCost),
    powerCost: structuredClone(powerCost),
    declaredTargets: [],
    declaredChoices: [],
    deflectTargetIds: [],
    optionalPowerEffects: [],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    poolPowerIds: [],
    triggeredAbility: {
      sourceCard: source,
      trigger,
      triggers,
      descriptor,
      mode,
      continuation
    }
  };
}

function createEffectEnergyPayment(game, player, card, amount, effectPayment) {
  return {
    playerId: player.id,
    cardId: card.instanceId,
    cardName: card.name,
    destination: null,
    source: "effectEnergy",
    energyCost: amount,
    basePowerCost: [],
    powerCost: [],
    declaredTargets: [],
    declaredChoices: [],
    deflectTargetIds: [],
    optionalPowerEffects: [],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    poolPowerIds: [],
    effectPayment: {
      ...effectPayment,
      sourceCard: card
    }
  };
}

function beginEffectEnergyPayment(game, player, card, amount, effectPayment) {
  if (!game.interactive) return false;
  if (!payEnergyIfPossible(game, player, amount, true)) return false;
  game.pendingPayment = createEffectEnergyPayment(game, player, card, amount, effectPayment);
  game.currentPlayerId = player.id;
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} is paying Energy ${amount} for ${card.name}.`);
  return true;
}

function resolveEffectEnergyPayment(game, payer, source, payment) {
  const data = payment.effectPayment || {};
  if (data.kind === "repeatSpell") {
    const sourceController = game.players.find((candidate) => candidate.id === data.sourcePlayerId) || payer;
    log(game, `${payer.name} repeats ${source.name}.`);
    markEffect(game, source, [source.instanceId], `${source.name} repeats.`);
    resolveEffectSpec(game, sourceController, source, data.repeatSpec, data.finishSpell);
    if (!game.pendingChoice && data.finishSpell) finishSpell(game, sourceController, source);
    resumeChainPriorityAfterEffectPayment(game, data);
    return;
  }

  if (data.kind === "showdownPredictDrawSpell") {
    resolveShowdownPredictDrawSpell(game, payer, source, data.resumeShowdownStart || (data.fromShowdownChain ? { fromShowdownChain: true } : null));
    return;
  }

  if (data.kind === "counterUnlessPayDecision") {
    const item = activeSpellChain(game).find((candidate) => candidate.card.instanceId === data.targetCardId);
    log(game, `${payer.name} pays ${data.amount || 2} Energy for ${source.name}.`);
    markEffect(game, source, [data.targetCardId], `${item?.card.name || "The spell"} is not countered.`);
    const sourceController = game.players.find((candidate) => candidate.id === data.sourcePlayerId) || payer;
    if (data.finishSpell) finishSpell(game, sourceController, source);
    resumeChainPriorityAfterEffectPayment(game, data);
  }
}

function resolveEffectEnergyPaymentCancel(game, payment) {
  const data = payment.effectPayment || {};
  const source = data.sourceCard || null;
  const payer = game.players.find((candidate) => candidate.id === payment.playerId);
  const sourceController = game.players.find((candidate) => candidate.id === data.sourcePlayerId) || payer;

  if (data.kind === "repeatSpell") {
    log(game, `${payer.name} does not repeat ${source?.name || payment.cardName}.`);
    if (data.finishSpell && source) finishSpell(game, sourceController, source);
    resumeChainPriorityAfterEffectPayment(game, data);
    return;
  }

  if (data.kind === "showdownPredictDrawSpell") {
    log(game, `${payer.name} declines ${source?.name || payment.cardName}.`);
    if (data.fromShowdownChain) {
      resumeChainPriorityAfterEffectPayment(game, data);
    } else {
      continueShowdownStartEffects(game, data.resumeShowdownStart);
    }
    return;
  }

  if (data.kind === "counterUnlessPayDecision") {
    counterChainCard(game, data.targetCardId, source?.name || payment.cardName);
    markEffect(game, source || { instanceId: payment.cardId }, [], `${source?.name || payment.cardName} counters the spell.`);
    if (data.finishSpell && source) finishSpell(game, sourceController, source);
    resumeChainPriorityAfterEffectPayment(game, data);
  }
}

function resumeChainPriorityAfterEffectPayment(game, data) {
  if (game.phase === "showdown" && game.showdown && data.fromShowdownChain && !game.pendingChoice) {
    continueShowdownAfterChainResolution(game);
  }
  if (game.phase === "action" && game.actionChain && !game.pendingChoice) {
    continueActionChainAfterResolution(game);
  }
}

function promptPlayTargetDeclaration(game, player, card, destination, source, pendingItem = null) {
  if (!game.interactive || (card.type !== "spell" && !card.additionalCost)) {
    return { required: false, opened: false };
  }
  const required = playDeclarationSteps(card, destination).length > 0;
  const declaration = playTargetDeclaration(game, player, card, destination);
  if (!declaration) return { required, opened: false };
  const opened = promptNextPlayDeclaration(game, player, card, {
    destination,
    source,
    ...(pendingItem ? { completion: { type: "pendingCard", chainItemId: pendingItem.id } } : {}),
    declarationSteps: declaration.steps,
    declaredTargets: [],
    declaredChoices: [],
    deflectPowerCost: [],
    deflectTargetIds: []
  });
  return { required, opened: Boolean(opened) };
}

function promptNextPlayDeclaration(game, player, card, state) {
  const steps = [...(state.declarationSteps || [])];
  while (steps.length) {
    const descriptor = steps.shift();
    const declaration = materializePlayDeclaration(game, player, card, descriptor,
      state.declaredTargets || [], state.declaredChoices || []);
    declaration.options = declaration.options.filter((option) => {
      const target = findCard(game, option.cardId);
      if (!target || !needsDeflectPayment(game, player, target)) return true;
      const extraPower = [
        ...(state.deflectPowerCost || []),
        { domain: "Any", amount: deflectAmount(game, target) }
      ];
      return canPayWithExtraPower(game, player, card, extraPower, playCostOptions(state));
    });
    if (!declaration.options.length && (declaration.optional || (declaration.min ?? 1) === 0)) continue;
    if (!declaration.options.length) return false;
    const canFinish = (declaration.min ?? 1) === 0;
    game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card,
    effect: state.declarationChoiceEffect || "declarePlayTarget",
      prompt: declaration.prompt || `Declare a target for ${card.name}.`,
      options: [
        ...declaration.options,
        ...(canFinish ? [{ id: "declare-finish", label: "Finish target selection", cardId: null }] : [])
      ],
    data: {
        ...state,
        declarationSteps: steps,
        currentDeclaration: descriptor,
      targetEffect: declaration.effect,
      requiresDestination: Boolean(declaration.requiresDestination),
      destinationEffect: declaration.destinationEffect || null,
        min: declaration.min ?? 1,
        max: declaration.max || 1,
        selectedForCurrentStep: []
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} declares a target for ${card.name}.`);
    return true;
  }
  if (state.completion?.type === "hidden") {
    if (!payPowerRequirements(game, player, state.deflectPowerCost || [], true)) {
      log(game, `${card.name} cannot pay its declared targets' Deflect cost.`);
      return false;
    }
    return Boolean(finalizeHiddenCard(game, player, card, state.destination, state.declaredTargets, state.declaredChoices));
  }
  if (state.completion?.type === "effectPlay") {
    const item = findChainItemById(game, state.completion.chainItemId);
    if (!item || item.card?.instanceId !== card.instanceId || item.status !== "pending") return false;
    return beginEffectPlayPayment(game, player, item, {
      declaredTargets: state.declaredTargets || [],
      declaredChoices: state.declaredChoices || [],
      deflectPowerCost: state.deflectPowerCost || [],
      deflectTargetIds: state.deflectTargetIds || []
    }, false);
  }
  const payment = createPayment(game, player, card, state.destination, state.source, {
    declaredTargets: state.declaredTargets || [],
    declaredChoices: state.declaredChoices || [],
    deflectPowerCost: state.deflectPowerCost || [],
    deflectTargetIds: state.deflectTargetIds || [],
    ...playCostOptions(state)
  });
  if (state.completion?.type === "pendingCard") {
    const item = findChainItemById(game, state.completion.chainItemId);
    if (!item || item.card?.instanceId !== card.instanceId || item.status !== "pending") return false;
    attachPendingPlayToPayment(payment, item);
  }
  game.pendingPayment = payment;
  game.selectedCardId = card.instanceId;
  if (state.autoConfirmZero
    && (payment.energyCost || 0) === 0
    && totalPowerAmount(payment.powerCost || []) === 0
    && !(payment.optionalPowerEffects || []).length) {
    selectAutomaticPayment(game, player, card, payment);
    return Boolean(confirmPayment(game).ok);
  }
  return true;
}

function findChainItemById(game, itemId) {
  return [
    ...(game.showdown?.chain || []),
    ...(game.actionChain?.chain || [])
  ].find((item) => item.id === itemId) || null;
}

function beginEffectPlayPayment(game, player, item, declarations, automatic) {
  const payment = createPayment(game, player, item.card, item.destination, "effectPlay", {
    ...declarations,
    ...effectPlayCostOptions(item)
  });
  payment.effectPlay = { chainItemId: item.id, card: item.card };
  game.pendingPayment = payment;
  game.selectedCardId = item.card.instanceId;
  if (!automatic) return true;
  if (!selectAutomaticPayment(game, player, item.card, payment)) {
    game.pendingPayment = null;
    return false;
  }
  game.preparingAutomaticEffectPlay = true;
  try {
    return Boolean(confirmPayment(game).ok);
  } finally {
    delete game.preparingAutomaticEffectPlay;
  }
}

function effectPlayCostOptions(item) {
  return playCostOptions(item.playOptions || {});
}

function playCostOptions(options = {}) {
  const ignoreBaseCost = Boolean(options.ignoreBaseCost);
  return {
    ignoreBaseCost,
    ignoreEnergyBaseCost: ignoreBaseCost || Boolean(options.ignoreEnergyBaseCost),
    ignorePowerBaseCost: ignoreBaseCost || Boolean(options.ignorePowerBaseCost),
    baseEnergyReduction: options.baseEnergyReduction || 0,
    ...(Number.isFinite(options.replacementEnergyCost)
      ? { replacementEnergyCost: Math.max(0, options.replacementEnergyCost) }
      : {}),
    ...(Array.isArray(options.replacementPowerCost)
      ? { replacementPowerCost: structuredClone(options.replacementPowerCost) }
      : {})
  };
}

function adjustedPlayCostOptions(options = {}) {
  const normalized = playCostOptions(options);
  return {
    ignoreEnergyBaseCost: normalized.ignoreEnergyBaseCost,
    ignorePowerBaseCost: normalized.ignorePowerBaseCost,
    baseEnergyReduction: normalized.baseEnergyReduction,
    ...(normalized.replacementEnergyCost != null
      ? { replacementEnergyCost: normalized.replacementEnergyCost }
      : {}),
    ...(normalized.replacementPowerCost
      ? { replacementPowerCost: structuredClone(normalized.replacementPowerCost) }
      : {})
  };
}

function beginAutomaticCardPayment(game, player, card, destination, source, options = {}) {
  const declarations = buildAutomaticPlayDeclarations(game, player, card, destination, options);
  if (!declarations) {
    if (options.pendingItem) rollbackPendingCardPlay(game, { playProcess: { chainItemId: options.pendingItem.id } });
    return fail(game, `${card.name} has no legal declaration.`);
  }
  const payment = createPayment(game, player, card, destination, source, {
    ...declarations,
    ...playCostOptions(options)
  });
  if (options.pendingItem) attachPendingPlayToPayment(payment, options.pendingItem);
  game.pendingPayment = payment;
  game.selectedCardId = card.instanceId;
  if (!selectAutomaticPayment(game, player, card, payment)) {
    game.pendingPayment = null;
    if (payment.playProcess) rollbackPendingCardPlay(game, payment);
    return fail(game, "Not enough ready runes or matching Power for the complete play cost.");
  }
  return confirmPayment(game);
}

function selectAutomaticPayment(game, player, card, payment) {
  const poolEnergyIds = runePoolEnergy(player)
    .filter((resource) => poolEnergyCanPay(game, resource, card))
    .slice(0, payment.energyCost || 0)
    .map((resource) => resource.id);
  const remainingEnergy = Math.max(0, (payment.energyCost || 0) - poolEnergyIds.length);
  const energyRunes = player.runes.filter((rune) => !rune.exhausted).slice(0, remainingEnergy);
  const powerSources = choosePowerPaymentSources(player, payment.powerCost || []);
  if (energyRunes.length !== remainingEnergy || !powerSources) return false;
  payment.poolEnergyIds = poolEnergyIds;
  payment.energyRuneIds = energyRunes.map((rune) => rune.instanceId);
  payment.powerRuneIds = powerSources.powerRuneIds;
  payment.poolPowerIds = powerSources.poolPowerIds;
  return manualPaymentSatisfied(game, player, card, payment);
}

function buildAutomaticPlayDeclarations(game, player, card, destination, options = {}) {
  const declaration = playTargetDeclaration(game, player, card, destination);
  const result = {
    declaredTargets: [],
    declaredChoices: [],
    deflectPowerCost: [],
    deflectTargetIds: []
  };
  if (!declaration) return result;

  const steps = [...declaration.steps];
  const optionalCostEffects = new Set([
    "friendlyExhaustAdditionalCost",
    "friendlyBuffAdditionalCost",
    "discardAdditionalCost",
    "killFriendlyUnitsAdditionalCost",
    "spendFriendlyBuffsAdditionalCost"
  ]);

  while (steps.length) {
    const descriptor = steps.shift();
    const { declaration: descriptorDeclaration } = descriptor;
    const materialized = materializePlayDeclaration(
      game,
      player,
      card,
      descriptor,
      result.declaredTargets,
      result.declaredChoices
    );
    const affordableOptions = materialized.options.filter((option) =>
      automaticDeclarationOptionIsAffordable(game, player, card, option, result.deflectPowerCost, options)
    );
    if (!affordableOptions.length) {
      if (materialized.optional) {
        result.declaredChoices.push({ effect: materialized.effect, optionId: "skip" });
        continue;
      }
      return null;
    }

    if (optionalCostEffects.has(materialized.effect)) {
      result.declaredChoices.push({ effect: materialized.effect, optionId: "skip" });
      continue;
    }

    const nonTargetChoice = affordableOptions.find((option) => !option.cardId);
    if (nonTargetChoice) {
      const selected = descriptorDeclaration.provider === "repeatCount"
        ? affordableOptions.find((option) => (option.amount || 0) === 0) || nonTargetChoice
        : nonTargetChoice;
      result.declaredChoices.push({
        effect: materialized.effect,
        optionId: selected.id,
        amount: selected.amount ?? null,
        unitId: selected.unitId || null,
        discardCardId: selected.discardCardId || null,
        repeatCostEnergy: selected.repeatCostEnergy || 0
      });
      if (materialized.effect === "repeatCount" && (selected.amount || 0) > 0) {
        const repeated = descriptorDeclaration.repeatTargetDeclarations || [];
        steps.unshift(...Array.from({ length: selected.amount }, () => repeated.map((targetDeclaration) => ({
          spec: descriptor.spec,
          declaration: targetDeclaration,
          destination
        }))).flat());
      }
      continue;
    }

    const selectedIds = new Set();
    const minimum = Math.max(0, materialized.min ?? 1);
    const maximum = Math.max(minimum, materialized.max ?? 1);
    const desired = descriptorDeclaration.multi
      ? Math.min(maximum, affordableOptions.length)
      : 1;
    while (selectedIds.size < desired) {
      const refreshed = materializePlayDeclaration(
        game,
        player,
        card,
        descriptor,
        result.declaredTargets,
        result.declaredChoices
      );
      const selectedMight = result.declaredTargets
        .filter((target) => target.effect === materialized.effect)
        .reduce((sum, target) => sum + currentMight(game, findCard(game, target.targetId)), 0);
      const maxTotalMight = descriptorDeclaration.maxTotalMightFromSpec
        ? (descriptor.spec.maxMight || 4)
        : null;
      const candidate = refreshed.options
        .filter((option) => option.cardId && !selectedIds.has(option.cardId))
        .filter((option) => automaticDeclarationOptionIsAffordable(
          game,
          player,
          card,
          option,
          result.deflectPowerCost,
          options
        ))
        .find((option) => maxTotalMight == null
          || selectedMight + currentMight(game, findCard(game, option.cardId)) <= maxTotalMight);
      if (!candidate) break;
      selectedIds.add(candidate.cardId);
      result.declaredTargets.push({
        effect: materialized.effect,
        targetId: candidate.cardId,
        ...(candidate.amount == null ? {} : { amount: candidate.amount })
      });
      const target = findCard(game, candidate.cardId);
      if (target && needsDeflectPayment(game, player, target) && !result.deflectTargetIds.includes(target.instanceId)) {
        result.deflectPowerCost.push({ domain: "Any", amount: deflectAmount(game, target) });
        result.deflectTargetIds.push(target.instanceId);
      }
      if (materialized.requiresDestination) {
        const moveDestination = spellMoveDestinationOptions(game, target).at(0);
        if (!moveDestination) return null;
        result.declaredChoices.push({
          effect: materialized.destinationEffect || "moveUnitSpellDestination",
          unitId: target.instanceId,
          destinationId: moveDestination.destination || moveDestination.id
        });
      }
    }
    if (selectedIds.size < minimum) return null;
    if (!selectedIds.size && materialized.optional) {
      result.declaredChoices.push({ effect: materialized.effect, optionId: "skip" });
    }
  }
  return result;
}

function automaticDeclarationOptionIsAffordable(game, player, card, option, accumulatedDeflect, options = {}) {
  const target = findCard(game, option.cardId);
  if (!target || !needsDeflectPayment(game, player, target)) return true;
  const extra = [
    ...(accumulatedDeflect || []),
    { domain: "Any", amount: deflectAmount(game, target) }
  ];
  return canPayWithExtraPower(game, player, card, extra, playCostOptions(options));
}

function promptHiddenTargetDeclaration(game, player, hidden, destination) {
  if (!game.interactive || hidden.card.type !== "spell") return false;
  const declaration = playTargetDeclaration(game, player, hidden.card, destination);
  if (!declaration) return false;
  return promptNextPlayDeclaration(game, player, hidden.card, {
    destination,
    source: "hidden",
    completion: { type: "pendingCard", chainItemId: hidden.pendingItemId },
    autoConfirmZero: true,
    declarationChoiceEffect: "declareHiddenPlayTarget",
    moveDestinationChoiceEffect: "declareHiddenMoveDestination",
    declarationSteps: declaration.steps,
    declaredTargets: [],
    declaredChoices: [],
    deflectPowerCost: [],
    deflectTargetIds: [],
    ignoreBaseCost: true
  });
}

function playTargetDeclaration(game, player, card, destination) {
  const steps = playDeclarationSteps(card, destination);
  if (!steps.length) return null;
  if (!declarationSequenceCanComplete(game, player, card, steps)) return null;
  const first = materializePlayDeclaration(game, player, card, steps[0], [], []);
  if (!first.options.length && !first.optional && (first.min ?? 1) > 0) return null;
  return { steps, ...first };
}

function playDeclarationSteps(card, destination) {
  const specs = cardEffects(card, "spell");
  const steps = [];
  for (const spec of specs) {
    const declaration = spellTargetDeclaration(spec);
    const declarations = declaration ? (declaration.steps || [declaration]) : [];
    for (const step of declarations) steps.push({ spec, declaration: step, destination });
    if (spec.repeatCostEnergy) {
      steps.push({
        spec,
        declaration: {
          choiceEffect: "repeatCount",
          provider: "repeatCount",
          repeatCostEnergy: spec.repeatCostEnergy,
          repeatTargetDeclarations: declarations
        },
        destination
      });
    }
  }
  if (card.additionalCost?.kind === "optionalExhaustFriendlyUnit") {
    steps.unshift({
      spec: {},
      declaration: {
        choiceEffect: "friendlyExhaustAdditionalCost",
        provider: "optionalFriendlyExhaustCost"
      },
      destination
    });
  }
  if (card.additionalCost?.kind === "optionalSpendFriendlyBuffIgnoreCost") {
    steps.unshift({
      spec: {},
      declaration: {
        choiceEffect: "friendlyBuffAdditionalCost",
        provider: "optionalFriendlyBuffCost"
      },
      destination
    });
  }
  if (card.additionalCost?.kind === "optionalDiscardEnergyReduction") {
    steps.unshift({
      spec: {},
      declaration: { choiceEffect: "discardAdditionalCost", provider: "optionalDiscardCost" },
      destination
    });
  }
  if (card.additionalCost?.kind === "killFriendlyUnit") {
    steps.unshift({
      spec: {},
      declaration: { choiceEffect: "killFriendlyUnitAdditionalCost", provider: "requiredFriendlyUnitKillCost" },
      destination
    });
  }
  if (hasStaticEffect(card, "killFriendlyUnitsCostReduction")) {
    steps.unshift({
      spec: {},
      declaration: {
        choiceEffect: "killFriendlyUnitsAdditionalCost",
        provider: TARGET_PROVIDERS.ALL_UNITS,
        defaultScope: "friendly",
        optional: true,
        multi: true
      },
      destination
    });
  }
  if (hasStaticEffect(card, "spendBuffsCostReduction")) {
    steps.unshift({
      spec: {},
      declaration: {
        choiceEffect: "spendFriendlyBuffsAdditionalCost",
        provider: "friendlyBuffTokens",
        optional: true,
        multi: true,
        allowRepeatedTargets: true
      },
      destination
    });
  }
  return steps;
}

function materializePlayDeclaration(game, player, card, descriptor, declaredTargets = [], declaredChoices = []) {
  const { spec, declaration } = descriptor;
  const repeatCount = declaration.repeat ?? spec.repeat ?? 1;
  const selectedMightMaximum = declaration.maxTargetsFromSelectedMight
    ? Math.max(0, currentMight(game, findCard(game, declaredTargets.find((target) => target.effect === "alphaStrike")?.targetId)))
    : null;
  const max = selectedMightMaximum ?? declaration.maxTargets ?? spec.maxTargets ?? declaration.max ?? spec.max ?? repeatCount;
  const hasExplicitMaximum = selectedMightMaximum != null
    || declaration.maxTargets != null
    || spec.maxTargets != null
    || declaration.max != null
    || spec.max != null;
  const min = declaration.minTargets ?? spec.minTargets ?? ((declaration.max ?? spec.max) != null ? 0 : repeatCount);
  return {
    effect: declaration.choiceEffect,
    requiresDestination: Boolean(declaration.requiresDestination),
    destinationEffect: declaration.destinationEffect || null,
    min: (declaration.optional || spec.optional) ? 0 : min,
    max: declaration.multi && !hasExplicitMaximum ? Number.MAX_SAFE_INTEGER : max,
    optional: Boolean(declaration.optional || spec.optional),
    options: filterDeterministicallyLegalTargetOptions(
      declarationTargetOptions(game, player, card, spec, declaration, declaredTargets),
      declaration,
      declaredTargets,
      declaredChoices
    )
  };
}

function declarationSequenceCanComplete(
  game,
  player,
  card,
  steps,
  declaredTargets = [],
  declaredChoices = []
) {
  if (!steps.length) return true;
  const [descriptor, ...remainingSteps] = steps;
  const declaration = materializePlayDeclaration(
    game,
    player,
    card,
    descriptor,
    declaredTargets,
    declaredChoices
  );
  if ((declaration.min || 0) === 0
    && declarationSequenceCanComplete(game, player, card, remainingSteps, declaredTargets, declaredChoices)) {
    return true;
  }
  const requiredSelections = Math.max(1, declaration.min || 0);
  const selections = declarationOptionSelections(
    declaration.options,
    requiredSelections,
    Boolean(descriptor.declaration.allowRepeatedTargets)
  );
  return selections.some((selectedOptions) => {
    if (declaration.requiresDestination && selectedOptions.some((option) => {
      const target = option.cardId ? findCard(game, option.cardId) : null;
      return target?.type !== "unit" || !spellMoveDestinationOptions(game, target).length;
    })) return false;
    const nextTargets = [...declaredTargets];
    const nextChoices = [...declaredChoices];
    let nextSteps = remainingSteps;
    for (const option of selectedOptions) {
      if (option.cardId) {
        nextTargets.push({
          effect: declaration.effect,
          targetId: option.cardId,
          ...(option.amount == null ? {} : { amount: option.amount })
        });
      } else {
        nextChoices.push({
          effect: declaration.effect,
          optionId: option.id,
          amount: option.amount ?? null,
          unitId: option.unitId || null,
          discardCardId: option.discardCardId || null,
          repeatCostEnergy: option.repeatCostEnergy || 0
        });
        if (declaration.effect === "repeatCount") {
          const repeatDeclarations = descriptor.declaration.repeatTargetDeclarations || [];
          const repeatedSteps = Array.from({ length: option.amount || 0 }, () =>
            repeatDeclarations.map((repeatDeclaration) => ({
              spec: descriptor.spec,
              declaration: repeatDeclaration,
              destination: descriptor.destination
            }))).flat();
          nextSteps = [...repeatedSteps, ...nextSteps];
        }
      }
    }
    return declarationSequenceCanComplete(game, player, card, nextSteps, nextTargets, nextChoices);
  });
}

function declarationOptionSelections(options, count, allowRepeated, start = 0, selected = []) {
  if (selected.length >= count) return [selected];
  const groups = [];
  for (let index = allowRepeated ? 0 : start; index < options.length; index += 1) {
    groups.push(...declarationOptionSelections(
      options,
      count,
      allowRepeated,
      allowRepeated ? 0 : index + 1,
      [...selected, options[index]]
    ));
  }
  return groups;
}

function filterDeterministicallyLegalTargetOptions(options, declaration, declaredTargets, declaredChoices) {
  const costEffects = new Set([
    "killFriendlyUnitAdditionalCost",
    "killFriendlyUnitsAdditionalCost"
  ]);
  if (costEffects.has(declaration.choiceEffect)) return options;
  const deterministicallyRemovedIds = new Set([
    ...declaredTargets
      .filter((item) => item.effect === "killFriendlyUnitsAdditionalCost")
      .map((item) => item.targetId),
    ...declaredChoices
      .filter((item) => item.effect === "killFriendlyUnitAdditionalCost" && item.unitId)
      .map((item) => item.unitId)
  ]);
  if (!deterministicallyRemovedIds.size) return options;
  const alternatives = options.filter((option) => option.cardId && !deterministicallyRemovedIds.has(option.cardId));
  if (!alternatives.length) return options;
  return options.filter((option) => !option.cardId || !deterministicallyRemovedIds.has(option.cardId));
}

function declarationTargetOptions(game, player, card, spec, declaration, declaredTargets = []) {
  const scope = declarationScope(spec, declaration);
  const previouslyDeclaredIds = new Set(declaredTargets.map((target) => target.targetId));
  if (declaration.provider === TARGET_PROVIDERS.ALL_UNITS) {
    return allUnits(game)
      .filter((unit) => unitMatchesScope(unit, player, scope))
      .filter((unit) => !declaration.excludePreviouslyDeclared || !previouslyDeclaredIds.has(unit.instanceId))
      .filter((unit) => !declaration.baseOnly || findUnitLocation(game, unit.instanceId)?.type === "base")
      .filter((unit) => {
        if (!declaration.outsidePreviouslyDeclaredBattlefield) return true;
        const fieldId = declaredTargets.find((target) => target.effect === "moonfall")?.targetId;
        const field = game.battlefields.find((candidate) => candidate.instanceId === fieldId);
        return !field?.units.some((candidate) => candidate.instanceId === unit.instanceId);
      })
      .filter((unit) => declarationUnitAllowed(unit, declaration))
      .filter((unit) => hiddenTargetAllowed(game, card, unit))
      .filter((unit) => canChooseUnit(game, player, card, unit))
      .map(cardOption);
  }
  if (declaration.provider === TARGET_PROVIDERS.ALL_GEAR) {
    return allGear(game).map(cardOption);
  }
  if (declaration.provider === TARGET_PROVIDERS.TARGETABLE_UNITS) {
    return targetableUnits(game, player, card, scope).map(cardOption);
  }
  if (declaration.provider === TARGET_PROVIDERS.BATTLEFIELD_UNITS) {
    return battlefieldUnitTargets(game, player, scope)
      .filter((source) => !declaration.requiresEnemyAtSameBattlefield || source.battlefield.units.some((unit) => unit.controllerId !== player.id))
      .filter((source) => {
        if (!declaration.sameBattlefieldAsPrevious) return true;
        const previous = findCard(game, declaredTargets.at(-1)?.targetId);
        const previousField = previous?.type === "battlefield"
          ? previous
          : findUnitLocation(game, previous?.instanceId)?.battlefield;
        return source.battlefield.instanceId === previousField?.instanceId;
      })
      .filter((source) => !["returnUnitToBase", "moveFriendlyUnitsToBase"].includes(spec.kind) || canMoveUnitFromBattlefieldToBase(game, source.unit))
      .filter((source) => canChooseUnit(game, player, card, source.unit))
      .filter((source) => spec.maxMight == null || currentMight(game, source.unit) <= spec.maxMight)
      .map((source) => cardOption(source.unit));
  }
  if (declaration.provider === TARGET_PROVIDERS.CHAIN_SPELLS) {
    return activeSpellChain(game)
      .filter((item) => item.card.type === "spell" && item.playerId !== player.id)
      .filter((item) => spec.maxEnergy == null || (item.card.energy || 0) <= spec.maxEnergy)
      .filter((item) => spec.maxPower == null || totalPowerCost(item.card) <= spec.maxPower)
      .map((item) => ({
        id: item.card.instanceId,
        label: declaration.choiceEffect === "counterUnlessPay"
          ? `${item.card.name} (controller may pay ${spec.amount || 2})`
          : item.card.name,
        cardId: item.card.instanceId
      }));
  }
  if (declaration.provider === TARGET_PROVIDERS.ALPHA_STRIKE) {
    return allUnits(game)
      .filter((unit) => unit.controllerId === player.id)
      .filter((unit) => canChooseUnit(game, player, card, unit))
      .map(cardOption);
  }
  if (declaration.provider === TARGET_PROVIDERS.BATTLEFIELDS) {
    return game.battlefields
      .filter((field) => !declaration.friendlyOccupied || field.units.some((unit) => unit.controllerId === player.id))
      .map(battlefieldOption);
  }
  if (declaration.provider === TARGET_PROVIDERS.OPPONENTS) {
    return game.players
      .filter((candidate) => candidate.id !== player.id)
      .map((candidate) => ({ id: candidate.id, label: candidate.name, cardId: candidate.id }));
  }
  if (declaration.provider === "readyRunes") {
    return player.runes.filter((rune) => !rune.exhausted).map(cardOption);
  }
  if (declaration.provider === "alphaStrikeTargets") {
    return game.battlefields
      .flatMap((field) => field.units)
      .filter((unit) => unit.controllerId !== player.id)
      .filter((unit) => canChooseUnit(game, player, card, unit))
      .map(cardOption);
  }
  if (declaration.provider === "repeatCount") {
    const baseCost = adjustedCost(game, player, card).energy;
    const available = player.runes.filter((rune) => !rune.exhausted).length + availablePoolEnergyCount(game, player);
    const repeatCost = declaration.repeatCostEnergy || 1;
    const affordable = Math.max(0, Math.floor((available - baseCost) / repeatCost));
    const repeatInstances = Math.max(1, keywordListCount(card?.keywords, "Repeat"));
    const max = Math.min(affordable, repeatInstances);
    return Array.from({ length: max + 1 }, (_, amount) => ({
      id: `repeat-count-${amount}`,
      label: amount ? `Repeat ${amount} time${amount === 1 ? "" : "s"}` : "Do not repeat",
      cardId: null,
      amount,
      repeatCostEnergy: repeatCost
    }));
  }
  if (declaration.provider === "optionalFriendlyExhaustCost") {
    return [
      { id: "skip", label: "Do not exhaust a unit", cardId: null },
      ...allUnits(game)
        .filter((unit) => unit.controllerId === player.id && !unit.exhausted)
        .map((unit) => ({ id: unit.instanceId, label: `Exhaust ${unit.name}`, cardId: null, unitId: unit.instanceId }))
    ];
  }
  if (declaration.provider === "optionalFriendlyBuffCost") {
    return [
      { id: "skip", label: "Do not spend a buff", cardId: null },
      ...allUnits(game)
        .filter((unit) => unit.controllerId === player.id && (unit.buffs || 0) > 0)
        .map((unit) => ({ id: unit.instanceId, label: `Spend a buff from ${unit.name}`, cardId: null, unitId: unit.instanceId }))
    ];
  }
  if (declaration.provider === "friendlyHiddenTrash") {
    return player.trash
      .filter((candidate) => candidate.keywords?.includes("Hidden") || candidate.tags?.includes("Hidden"))
      .map(cardOption);
  }
  if (declaration.provider === "friendlyTrashUnits") {
    return player.trash.filter((candidate) => candidate.type === "unit").map(cardOption);
  }
  if (declaration.provider === "battlefieldUnitsOrGear") {
    return [
      ...game.battlefields.flatMap((field) => field.units),
      ...allGear(game)
    ].map(cardOption);
  }
  if (declaration.provider === "optionalDiscardCost") {
    return [
      { id: "skip", label: "Do not discard a card", cardId: null },
      ...player.hand
        .filter((candidate) => candidate.instanceId !== card.instanceId)
        .map((candidate) => ({ id: candidate.instanceId, label: `Discard ${candidate.name}`, cardId: null, discardCardId: candidate.instanceId }))
    ];
  }
  if (declaration.provider === "requiredFriendlyUnitKillCost") {
    return allUnits(game)
      .filter((unit) => unit.controllerId === player.id)
      .map((unit) => ({ id: unit.instanceId, label: `Kill ${unit.name}`, cardId: null, unitId: unit.instanceId }));
  }
  if (declaration.provider === "friendlyBuffTokens") {
    return allUnits(game)
      .filter((unit) => unit.controllerId === player.id && (unit.buffs || 0) > 0)
      .map(cardOption);
  }
  return [];
}

function declarationScope(spec, declaration) {
  return declaration.scopeByTarget?.[spec.target] || declaration.defaultScope || "any";
}

function unitMatchesScope(unit, player, scope) {
  if (scope === "friendly") return unit.controllerId === player.id;
  if (scope === "enemy") return unit.controllerId !== player.id;
  return true;
}

function declarationUnitAllowed(unit, declaration) {
  if (declaration.choiceEffect === "readyUnitAny") return unit.exhausted;
  return true;
}

function canPayWithExtraPower(game, player, card, extraPower = [], options = {}) {
  const cost = adjustedCost(game, player, card, {
    ...adjustedPlayCostOptions(options),
    additionalPower: extraPower
  });
  if (player.runes.filter((rune) => !rune.exhausted).length + availablePoolEnergyCount(game, player) < cost.energy) return false;
  return Boolean(choosePowerPaymentSources(player, cost.power));
}

function consumeDeclaredPlayTarget(card, effect, options) {
  const declarations = card.declaredPlayTargets || [];
  const index = declarations.findIndex((declaration) => declaration.effect === effect);
  if (index < 0) return null;
  const [declaration] = declarations.splice(index, 1);
  const identities = card.declaredTargetIdentities || [];
  const identityIndex = identities.findIndex((candidate) =>
    candidate.effect === declaration.effect && candidate.targetId === declaration.targetId);
  const [identity] = identityIndex >= 0 ? identities.splice(identityIndex, 1) : [null];
  const matchingOption = options.find((candidate) => candidate.cardId === declaration.targetId
    && (declaration.amount == null || candidate.amount === declaration.amount)) || null;
  const retainedIdentity = !identity
    || (matchingOption?.zoneChangeCounter || 0) === identity.zoneChangeCounter;
  const option = retainedIdentity ? matchingOption
    : null;
  return { declaration, option };
}

function captureTargetIdentities(game, declarations) {
  return (declarations || []).map((declaration) => {
    const target = findCard(game, declaration.targetId);
    return {
      effect: declaration.effect,
      targetId: declaration.targetId,
      zoneChangeCounter: target?.zoneChangeCounter || 0
    };
  });
}

function consumeDeclaredPlayChoice(card, effect, options, matcher = () => true) {
  const declarations = card.declaredPlayChoices || [];
  const index = declarations.findIndex((declaration) => declaration.effect === effect && matcher(declaration));
  if (index < 0) return null;
  const [declaration] = declarations.splice(index, 1);
  const option = options.find((candidate) => {
    const candidateId = candidate.destination || candidate.id;
    return candidateId === declaration.destinationId || candidateId === declaration.optionId;
  }) || null;
  return { declaration, option };
}

function paymentCard(player, payment) {
  if (payment.playProcess?.card) return payment.playProcess.card;
  if (payment.source === "champion") return player.champion;
  if (payment.source === "hideCard" && payment.hideSource === "champion") return player.champion;
  if (payment.source === "effectEnergy") return payment.effectPayment?.sourceCard || findCardByPlayers(payment.cardId, player) || null;
  if (payment.source === "activatedAbility") return findCardByPlayers(payment.cardId, player) || null;
  if (payment.source === "triggeredAbility") return payment.triggeredAbility?.sourceCard || findCardByPlayers(payment.cardId, player) || null;
  if (payment.source === "weaponmaster") return findCardByPlayers(payment.cardId, player) || null;
  if (payment.source === "effectPlay") return payment.effectPlay?.card || findCardByPlayers(payment.cardId, player) || null;
  return player.hand.find((candidate) => candidate.instanceId === payment.cardId);
}

function findCardByPlayers(cardId, fallbackPlayer) {
  if (!cardId) return null;
  const players = fallbackPlayer ? [fallbackPlayer] : [];
  return players
    .flatMap((player) => [
      player.legend,
      player.champion,
      ...player.availableChampions,
      ...player.availableBattlefields,
      ...player.hand,
      ...player.base,
      ...player.runes,
      ...player.trash,
      ...(player.banished || [])
    ])
    .find((card) => card?.instanceId === cardId) || null;
}

function ensureRunePool(player) {
  player.runePool ||= { energy: [], power: [] };
  if (typeof player.runePool.energy === "number") {
    player.runePool.energy = Array.from({ length: player.runePool.energy }, (_, index) => createPoolEnergy(player, {
      index,
      sourceName: "Generated Energy"
    }));
  }
  player.runePool.energy ||= [];
  player.runePool.power ||= [];
  player.runePool.power = player.runePool.power.map((resource, index) => {
    if (resource && typeof resource === "object") {
      const id = resource.id || resource.instanceId || `power-${player.id}-legacy-${index}`;
      return { ...resource, id, instanceId: id, domain: resource.domain || "Any", type: "power" };
    }
    return createPoolPower(player, String(resource || "Any"), { index, sourceName: "Generated Power" });
  });
  return player.runePool;
}

function clearRunePool(player) {
  player.runePool = { energy: [], power: [] };
}

function clearAllRunePools(game) {
  for (const player of game.players) clearRunePool(player);
}

function runePoolEnergy(player) {
  return ensureRunePool(player).energy;
}

function runePoolPower(player) {
  return ensureRunePool(player).power;
}

function availablePoolEnergyCount(game, player, card = null) {
  return runePoolEnergy(player).filter((resource) => poolEnergyCanPay(game, resource, card)).length;
}

function createPoolEnergy(player, options = {}) {
  const domains = Array.isArray(options.domains) && options.domains.length
    ? options.domains
    : ["Any"];
  return {
    id: `energy-${player.id}-${Date.now()}-${Math.random().toString(36).slice(2)}-${options.index || 0}`,
    type: "energy",
    domains,
    sourceCardId: options.sourceCardId || null,
    sourceName: options.sourceName || "Generated Energy",
    restriction: options.restriction || null,
    expiresAt: options.expiresAt || "endOfTurn"
  };
}

function addEnergyToPool(player, amount = 1, options = {}) {
  const pool = ensureRunePool(player);
  for (let index = 0; index < amount; index += 1) {
    pool.energy.push(createPoolEnergy(player, { ...options, index }));
  }
}

function consumeSelectedPoolEnergy(player, energyIds = []) {
  if (!energyIds.length) return 0;
  const selected = new Set(energyIds);
  const pool = ensureRunePool(player);
  const before = pool.energy.length;
  pool.energy = pool.energy.filter((resource) => !selected.has(resource.id));
  return before - pool.energy.length;
}

function poolEnergyCanPay(game, resource, card = null) {
  if (resource.restriction === "showdown") return game.phase === "showdown";
  if (resource.restriction === "spell") {
    if (card) return card.type === "spell";
    if (!game.pendingPayment) return false;
    const player = game.players.find((candidate) => candidate.id === game.pendingPayment.playerId);
    return Boolean(player && paymentCard(player, game.pendingPayment)?.type === "spell");
  }
  return true;
}

function createPoolPower(player, domain = "Any", options = {}) {
  const id = options.id || `power-${player.id}-${Date.now()}-${Math.random().toString(36).slice(2)}-${options.index || 0}`;
  return {
    id,
    instanceId: id,
    type: "power",
    domain,
    sourceCardId: options.sourceCardId || null,
    sourceName: options.sourceName || "Generated Power",
    expiresAt: options.expiresAt || "endOfTurn"
  };
}

function addPowerToPool(player, domain, options = {}) {
  const resource = createPoolPower(player, domain, options);
  ensureRunePool(player).power.push(resource);
  return resource;
}

function consumeSelectedPoolPower(player, powerIds = []) {
  if (!powerIds.length) return 0;
  const selected = new Set(powerIds);
  const pool = ensureRunePool(player);
  const before = pool.power.length;
  pool.power = pool.power.filter((resource) => !selected.has(resource.id));
  return before - pool.power.length;
}

function manualPaymentSatisfied(game, player, card, payment) {
  const energyRunes = (payment.energyRuneIds || [])
    .map((id) => player.runes.find((rune) => rune.instanceId === id))
    .filter(Boolean);
  const energyCost = payment.energyCost ?? (card.energy || 0);
  const powerCost = payment.powerCost ?? (card.power || []);
  const selectedPoolEnergy = (payment.poolEnergyIds || [])
    .map((id) => runePoolEnergy(player).find((resource) => resource.id === id))
    .filter(Boolean);
  if (new Set(payment.poolEnergyIds || []).size !== (payment.poolEnergyIds || []).length) return false;
  if (selectedPoolEnergy.length !== (payment.poolEnergyIds || []).length) return false;
  if (selectedPoolEnergy.some((resource) => !poolEnergyCanPay(game, resource))) return false;
  if (energyRunes.length + selectedPoolEnergy.length !== energyCost) return false;
  if ((player.trash?.length || 0) < (payment.recycleTrashCost || 0)) return false;
  if ((payment.recycleTrashCost || 0) > 0) {
    const recycleIds = payment.recycleTrashCardIds || [];
    if (new Set(recycleIds).size !== payment.recycleTrashCost) return false;
    if (recycleIds.some((id) => !player.trash.some((candidate) => candidate.instanceId === id))) return false;
  }
  if (energyRunes.some((rune) => rune.exhausted)) return false;
  const selectedPowerRunes = (payment.powerRuneIds || [])
    .map((id) => player.runes.find((rune) => rune.instanceId === id))
    .filter(Boolean);
  const selectedPoolPower = (payment.poolPowerIds || [])
    .map((id) => runePoolPower(player).find((resource) => resource.id === id))
    .filter(Boolean);
  if (new Set(payment.powerRuneIds || []).size !== (payment.powerRuneIds || []).length) return false;
  if (selectedPowerRunes.length !== (payment.powerRuneIds || []).length) return false;
  if (new Set(payment.poolPowerIds || []).size !== (payment.poolPowerIds || []).length) return false;
  if (selectedPoolPower.length !== (payment.poolPowerIds || []).length) return false;
  return powerSelectionSatisfies([...selectedPoolPower, ...selectedPowerRunes], powerCost, true);
}

function powerMatches(rune, requirement) {
  if (rune.temporaryResource) return false;
  if (rune.domain === "Any") return true;
  if (requirement.allowedDomains?.length) return requirement.allowedDomains.includes(rune.domain);
  return requirement.domain === "Any" || rune.domain === requirement.domain;
}

function runeCanPayPower(rune, requirements) {
  return (requirements || []).some((requirement) => powerMatches(rune, requirement));
}

function optionalAdditionalPowerEffects(card) {
  const effects = cardEffects(card, "onPlay")
    .map((effect, index) => ({ effect, index }))
    .filter(({ effect }) => effect.kind === "optionalPowerDraw" || (effect.optional && effect.additionalPower))
    .map(({ effect, index }) => ({
      id: `optional-${card.instanceId}-${index}`,
      kind: effect.kind,
      label: effect.label || (effect.kind === "optionalPowerDraw"
        ? `Pay ${effect.amount || 1} ${effect.domain || "Any"} Power to draw ${effect.draw || 1}`
        : `Pay ${effect.additionalPower?.amount || 1} ${effect.additionalPower?.domain || "Any"} Power for ${effect.kind}`),
      selected: false,
      requirements: effect.additionalPower
        ? [structuredClone(effect.additionalPower)]
        : [{ domain: effect.domain || "Any", amount: effect.amount || 1 }],
      draw: effect.draw || 1,
      domain: effect.additionalPower?.domain || effect.domain || "Any"
    }));
  const accelerate = acceleratePowerRequirement(card);
  if (accelerate) {
    effects.push({
      id: `optional-${card.instanceId}-accelerate`,
      kind: "accelerate",
      label: `Pay 1 Energy and ${accelerate.amount} ${accelerate.domain} Power to enter ready`,
      selected: false,
      energyCost: 1,
      requirements: [accelerate],
      draw: 0,
      domain: accelerate.domain
    });
  }
  return effects;
}

function acceleratePowerRequirement(card) {
  if (!hasKeyword(card, "Accelerate")) return null;
  const domains = [...new Set((card.domains || []).filter((domain) => domain && domain !== "Any"))];
  return { domain: domains.length === 1 ? domains[0] : "Any", amount: 1 };
}

function paymentPowerCost(payment) {
  return structuredClone(payment.powerCost || payment.basePowerCost || []);
}

function recalculatePaymentCost(game, player, card, payment) {
  if (!player || !card || !payment.costContext) return;
  const optionalCost = adjustedOptionalAdditionalCost(game, player, card,
    (payment.optionalPowerEffects || []).filter((effect) => effect.selected));
  const cost = adjustedCost(game, player, card, {
    ...payment.costContext,
    additionalEnergy: (payment.costContext.additionalEnergy || 0) + optionalCost.energy,
    additionalPower: [
      ...(payment.costContext.additionalPower || []),
      ...optionalCost.power
    ]
  });
  payment.energyCost = cost.energy;
  payment.powerCost = structuredClone(cost.power);
}

function adjustedOptionalAdditionalCost(game, player, card, selectedEffects) {
  const modifiers = collectCardCostModifiers(game, player, card)
    .filter((modifier) => modifier.component === "optionalAdditional");
  let totalEnergy = 0;
  const totalPower = [];
  for (const effect of selectedEffects) {
    let energy = Math.max(0, effect.energyCost || 0);
    let power = structuredClone(effect.requirements || []);
    for (const modifier of modifiers.filter((candidate) => candidate.energy > 0)) energy += modifier.energy;
    energy = applyEnergyDiscountsInBestOrder(energy, modifiers
      .filter((candidate) => candidate.energy < 0)
      .map((candidate) => ({ amount: Math.abs(candidate.energy), minimum: candidate.minEnergy ?? 0 })));
    for (const modifier of modifiers.filter((candidate) => candidate.power > 0)) {
      power = adjustPowerCost(power, modifier.power);
    }
    for (const modifier of modifiers.filter((candidate) => candidate.power < 0)) {
      power = adjustPowerCost(power, modifier.power);
    }
    totalEnergy += energy;
    totalPower.push(...power);
  }
  return { energy: totalEnergy, power: totalPower };
}

function paidOptionalEffect(card, spec) {
  const paid = card.paidOptionalPowerEffects || [];
  const index = paid.findIndex((effect) => {
    if (effect.kind !== spec.kind) return false;
    const expected = spec.additionalPower || null;
    if (!expected) return true;
    return (effect.requirements || []).some((requirement) =>
      requirement.domain === expected.domain && requirement.amount === expected.amount
    );
  });
  if (index < 0) return false;
  paid.splice(index, 1);
  return true;
}

function hasPaidOptionalEffect(card, spec) {
  const paid = card.paidOptionalPowerEffects || [];
  return paid.some((effect) => {
    if (effect.kind !== spec.kind) return false;
    const expected = spec.additionalPower || null;
    if (!expected) return true;
    return (effect.requirements || []).some((requirement) =>
      requirement.domain === expected.domain && requirement.amount === expected.amount
    );
  });
}

function adjustedCost(game, player, card, options = {}) {
  let energy = options.replacementEnergyCost != null
    ? Math.max(0, options.replacementEnergyCost)
    : (options.ignoreEnergyBaseCost ? 0 : (card.energy || 0));
  let power = options.replacementPowerCost
    ? structuredClone(options.replacementPowerCost)
    : (options.ignorePowerBaseCost ? [] : normalizeCardPowerRequirements(card, card.power || []));
  energy += Math.max(0, options.additionalEnergy || 0);
  power = [...power, ...structuredClone(options.additionalPower || [])];

  const modifiers = collectCardCostModifiers(game, player, card)
    .filter((modifier) => modifier.component !== "optionalAdditional");
  const energyIncreases = modifiers.filter((modifier) => modifier.energy > 0);
  const energyDiscounts = modifiers
    .filter((modifier) => modifier.energy < 0)
    .map((modifier) => ({ amount: Math.abs(modifier.energy), minimum: modifier.minEnergy ?? 0 }));
  for (const modifier of energyIncreases) energy += modifier.energy;
  if (options.baseEnergyReduction) energyDiscounts.push({ amount: options.baseEnergyReduction, minimum: 0 });
  if (options.energyDiscount) energyDiscounts.push({ amount: options.energyDiscount, minimum: 0 });
  energy = applyEnergyDiscountsInBestOrder(energy, energyDiscounts);

  for (const modifier of modifiers.filter((candidate) => candidate.power > 0)) {
    power = adjustPowerCost(power, modifier.power);
  }
  for (const modifier of modifiers.filter((candidate) => candidate.power < 0)) {
    power = adjustPowerCost(power, modifier.power);
  }
  if (options.powerDiscount) power = reducePowerRequirements(power, options.powerDiscount);
  return { energy: Math.max(0, energy), power };
}

function normalizeCardPowerRequirements(card, requirements) {
  const domains = [...new Set((card?.domains || []).filter((domain) => domain && domain !== "Any"))];
  return (requirements || []).map((requirement) => {
    if (requirement.domain !== "Any" || !domains.length) return structuredClone(requirement);
    if (domains.length === 1) return { ...structuredClone(requirement), domain: domains[0] };
    return { ...structuredClone(requirement), allowedDomains: domains };
  });
}

function collectCardCostModifiers(game, player, card) {
  const modifiers = [];
  for (const effect of cardEffects(card, "static")) {
    if (effect.kind !== "costModifier" || (effect.appliesTo ?? "card") !== "card") continue;
    if (!costModifierApplies(game, player, card, effect)) continue;
    let energy = effect.energy || 0;
    if (effect.energyPerTrash) energy += effect.energyPerTrash * (player.trash?.length || 0);
    if (effect.energyByHighestMight) {
      const highest = Math.max(0, ...allControlledCards(game, player.id)
        .filter((candidate) => candidate.type === "unit")
        .map((unit) => currentMight(game, unit)));
      energy -= highest;
    }
    modifiers.push({
      energy,
      power: effect.power || 0,
      minEnergy: effect.minEnergy,
      component: effect.component || "total"
    });
  }
  for (const source of allControlledCards(game, player.id)) {
    if (source.instanceId === card.instanceId) continue;
    for (const effect of cardEffects(source, "static")) {
      if (effect.kind !== "costModifier" || (effect.appliesTo ?? "card") !== "card") continue;
      if (!costModifierApplies(game, player, card, effect, source)) continue;
      modifiers.push({
        energy: effect.energy || 0,
        power: effect.power || 0,
        minEnergy: effect.minEnergy,
        component: effect.component || "total"
      });
    }
  }
  if (card.type === "spell" && player.nextSpellEnergyReduction) {
    modifiers.push({ energy: -player.nextSpellEnergyReduction, power: 0, minEnergy: 0, component: "total" });
  }
  if (game.phase === "showdown" && card.type === "spell" && game.showdown) {
    const battlefield = game.battlefields.find((field) => field.instanceId === game.showdown.battlefieldId);
    for (const unit of battlefield?.units || []) {
      for (const effect of cardEffects(unit, "combatStatic")) {
        if (effect.kind !== "spellCostModifier") continue;
        const friendly = unit.controllerId === player.id;
        modifiers.push({
          energy: friendly ? (effect.friendlyEnergy || 0) : (effect.enemyEnergy || 0),
          power: friendly ? (effect.friendlyPower || 0) : (effect.enemyPower || 0),
          minEnergy: effect.minEnergy,
          component: effect.component || "total"
        });
      }
    }
  }
  return modifiers;
}

function applyEnergyDiscountsInBestOrder(energy, discounts) {
  const ordered = [...discounts].sort((left, right) =>
    (right.minimum || 0) - (left.minimum || 0));
  return ordered.reduce((remaining, discount) => {
    const discounted = Math.max(discount.minimum || 0, remaining - Math.max(0, discount.amount || 0));
    return Math.min(remaining, discounted);
  }, Math.max(0, energy));
}

function costModifierApplies(game, player, card, effect, source = card) {
  if (effect.cardType && card.type !== effect.cardType) return false;
  if (effect.tag && !(card.tags || []).includes(effect.tag)) return false;
  if (effect.requiresLegion && (player.cardsPlayedThisTurn || 0) <= 0) return false;
  if (effect.requiresOpponentNearVictory && !game.players.some((candidate) => candidate.id !== player.id && (game.victoryScore - candidate.score) <= effect.requiresOpponentNearVictory)) return false;
  if (effect.requiresEnemyDiedThisTurn && !(player.enemyUnitsDiedThisTurn > 0)) return false;
  if (effect.sourceAtBattlefield && findUnitLocation(game, source.instanceId)?.type !== "battlefield") return false;
  return true;
}

function adjustPowerCost(requirements, delta) {
  const next = structuredClone(requirements || []);
  if (delta > 0) {
    next.push({ domain: "Any", amount: delta });
    return next;
  }
  let remove = Math.abs(delta);
  for (let i = next.length - 1; i >= 0 && remove > 0; i--) {
    const amount = Math.min(next[i].amount, remove);
    next[i].amount -= amount;
    remove -= amount;
  }
  return next.filter((requirement) => requirement.amount > 0);
}

function totalPowerAmount(requirements) {
  return requirements.reduce((sum, requirement) => sum + requirement.amount, 0);
}

function powerSelectionSatisfies(runes, requirements, exact = false) {
  if (exact && runes.length !== totalPowerAmount(requirements)) return false;
  return Boolean(choosePowerRunes(runes, requirements));
}

function choosePowerRunes(runes, requirements) {
  const slots = expandPowerRequirements(requirements);
  if (slots.length === 0) return [];
  if (runes.length < slots.length) return null;

  const used = new Set();
  const chosen = [];
  const assign = (slotIndex) => {
    if (slotIndex >= slots.length) return true;
    const requirement = slots[slotIndex];
    for (const rune of runes) {
      if (used.has(rune.instanceId) || !powerMatches(rune, requirement)) continue;
      used.add(rune.instanceId);
      chosen.push(rune);
      if (assign(slotIndex + 1)) return true;
      chosen.pop();
      used.delete(rune.instanceId);
    }
    return false;
  };

  return assign(0) ? [...chosen] : null;
}

function choosePowerPaymentSources(player, requirements = []) {
  const poolPower = runePoolPower(player);
  const chosen = choosePowerRunes([...poolPower, ...player.runes], requirements);
  if (!chosen) return null;
  const poolIds = new Set(poolPower.map((resource) => resource.id));
  return {
    poolPowerIds: chosen.filter((source) => poolIds.has(source.id)).map((source) => source.id),
    powerRuneIds: chosen.filter((source) => !poolIds.has(source.id)).map((source) => source.instanceId)
  };
}

function expandPowerRequirements(requirements) {
  return requirements
    .flatMap((requirement) => Array.from({ length: requirement.amount }, () => requirement))
    .sort((left, right) => {
      if (left.domain === "Any" && right.domain !== "Any") return 1;
      if (left.domain !== "Any" && right.domain === "Any") return -1;
      return 0;
    });
}

function applyManualPayment(game, player, payment) {
  const energyRunes = (payment.energyRuneIds || [])
    .map((runeId) => player.runes.find((candidate) => candidate.instanceId === runeId))
    .filter(Boolean);
  exhaustCards(game, player, findCard(game, payment.cardId), energyRunes, {
    reason: "play-energy-cost",
    cost: true
  });

  recyclePowerRunesInChosenOrder(game, player, payment.powerRuneIds || []);
  if (payment.recycleTrashCost) {
    paySelectedRecycleTrashCost(game, player, payment.recycleTrashCardIds || [], payment.recycleTrashCost);
  }
  consumeSelectedPoolEnergy(player, payment.poolEnergyIds || []);
  consumeSelectedPoolPower(player, payment.poolPowerIds || []);
}

function resolvePaidCard(game, player, card, destination) {
  if (game.phase === "showdown" && game.showdown) {
    return addPaidCardToShowdown(game, player, card, destination);
  }
  if (game.actionChain) {
    return addPaidCardToActionChain(game, player, card, destination);
  }
  if (card.type === "spell") {
    if (game.phase === "action" && game.interactive && !card.resolvingFromChain) {
      return addPaidCardToActionChain(game, player, card, destination);
    }
    player.nextSpellEnergyReduction = 0;
    resolveSpellAfterSynergies(game, player, card);
    return { ok: true };
  }
  return resolvePermanentCardPlay(game, player, card, destination, false);
}

function finishPaidChampionPlay(game, player, champion, destination) {
  setChampionZoneState(player, champion, "played");
  if (game.phase === "showdown" && game.showdown) {
    return addPaidCardToShowdown(game, player, champion, destination);
  }
  if (game.actionChain) {
    return addPaidCardToActionChain(game, player, champion, destination);
  }
  return resolvePermanentCardPlay(game, player, champion, destination, true);
}

function addPaidCardToShowdown(game, player, card, destination) {
  const showdown = game.showdown;
  addPendingChainItem(game, showdown, card, player.id, destination);
  log(game, `${player.name} adds ${card.name} to the showdown chain.`);
  checkState(game);
  return { ok: true };
}

function playHiddenCard(game, hidden, destination) {
  if (game.phase !== "showdown" || !game.showdown) return fail(game, "Hidden cards can only be revealed during a showdown.");
  const player = actingPlayer(game);
  if (!hiddenCardIsControlledBy(hidden, player.id)) return fail(game, "That hidden card is not controlled by you.");
  if (game.showdown.priorityPlayerId !== player.id) return fail(game, "It is not your showdown priority.");
  const card = hidden.card;
  if ((game.turnSequence || 0) < (hidden.playableFromTurnSequence || 0)) {
    return fail(game, "A hidden card can be played beginning on the next turn.");
  }
  if (!canPlayInShowdown(game, player, card, game.showdown, destination || hidden.battlefield.instanceId)) return fail(game, "That hidden card cannot be played now.");
  if (hidden.battlefield.instanceId !== game.showdown.battlefieldId) return fail(game, "Hidden cards can only be revealed for their battlefield's showdown.");
  if (hidden.battlefield.units.some((unit) => unit.controllerId !== player.id && hasStaticEffect(unit, "opponentsHiddenCantRevealHere"))) {
    return fail(game, "Hidden cards cannot be revealed at that battlefield.");
  }
  if (!hasRequiredPlayTargets(game, player, card, destination || hidden.battlefield.instanceId)) return fail(game, `${card.name} has no legal target.`);
  const targetDestination = destination || hidden.battlefield.instanceId;
  const item = placePendingCardOnChain(game, player, card, targetDestination, "hidden");
  if (!item) return fail(game, `${card.name} could not enter the Chain from Hidden.`);
  if (promptHiddenTargetDeclaration(game, player, { ...hidden, pendingItemId: item.id }, targetDestination)) return { ok: true };
  return beginAutomaticCardPayment(game, player, card, targetDestination, "hidden", {
    pendingItem: item,
    ignoreBaseCost: true
  });
}

function finalizeHiddenCard(game, player, card, destination, declaredTargets = [], declaredChoices = []) {
  const hidden = findHiddenCardLocation(game, card.instanceId);
  if (!hidden) return fail(game, "That hidden card is no longer hidden.");
  if (!hiddenCardIsControlledBy(hidden, player.id)) return fail(game, "That hidden card is not controlled by you.");
  recordRevealEvent(game, player, [card], card, "facedown");
  hidden.battlefield.hidden.splice(hidden.index, 1);
  card.hidden = false;
  card.playedFromHidden = true;
  card.hiddenBattlefieldId = hidden.battlefield.instanceId;
  card.declaredPlayTargets = structuredClone(declaredTargets);
  card.declaredPlayChoices = structuredClone(declaredChoices);
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} reveals ${card.name} from Hidden.`);
  return addPaidCardToShowdown(game, player, card, destination || hidden.battlefield.instanceId);
}

function finishSpell(game, player, card) {
  const pendingResolution = card.pendingGameEffectResolution;
  const previousGameEffect = game.resolvingGameEffect;
  if (!previousGameEffect && pendingResolution?.context) game.resolvingGameEffect = pendingResolution.context;
  const playedSnapshot = {
    ...card,
    declaredPlayTargets: structuredClone(card.playResolutionTargets || card.declaredPlayTargets || []),
    declaredPlayChoices: structuredClone(card.playResolutionChoices || card.declaredPlayChoices || []),
    playedFromHidden: Boolean(card.playedFromHidden)
  };
  clearBoardState(game, card);
  delete card.hiddenBattlefieldId;
  player.nextSpellBonusDamage = 0;
  const owner = game.players.find((candidate) => candidate.id === card.ownerId) || player;
  if (card.banishAfterResolve) {
    delete card.banishAfterResolve;
    banishCards(game, player, [card], card, { boardStateAlreadyCleared: true });
    log(game, `${card.name} is banished.`);
  } else if (card.recycleAfterResolve) {
    delete card.recycleAfterResolve;
    recycleMainDeckCards(game, player, [card], card);
    log(game, `${card.name} is recycled.`);
  } else if (!owner.trash.includes(card)) {
    owner.trash.push(card);
    log(game, `${card.name} goes to trash.`);
  }
  recordResolvedCardPlay(game, player, playedSnapshot);
  delete card.pendingGameEffectResolution;
  if (!previousGameEffect && pendingResolution?.context) {
    delete game.resolvingGameEffect;
    flushGameEffectTriggers(game, pendingResolution.context);
  }
}

function stageBattlefieldEvent(game, event) {
  if (!event.battlefield || !event.attackerId) return false;
  const staged = {
    id: `staged-${event.type}-${event.battlefield.instanceId}-${event.attackerId}`,
    type: event.type,
    battlefieldId: event.battlefield.instanceId,
    attackerId: event.attackerId,
    defenderId: event.defenderId || event.battlefield.units.find((unit) => unit.controllerId !== event.attackerId)?.controllerId
  };
  event.battlefield.contestedBy = event.attackerId;
  game.stagedEvents = (game.stagedEvents || []).filter((candidate) => candidate.id !== staged.id);
  game.stagedEvents.push(staged);
  requestCleanup(game, "object-status-change", {
    objectId: event.battlefield.instanceId,
    status: "contested"
  });
  return true;
}

function resolveStagedEvents(game) {
  if (game.phase !== "action" || game.pendingPayment || game.pendingChoice || game.showdown || game.actionChain
    || game.triggerQueue?.length || game.triggerQueueContinuation) return false;
  game.stagedEvents = validStagedEvents(game, game.stagedEvents || []);
  if (!game.stagedEvents.length) return false;
  game.stagedEvents = uniqueStagedEvents(game.stagedEvents);

  if (game.stagedEvents.length === 1 || !game.interactive) {
    startStagedEvent(game, game.stagedEvents[0].id);
    return true;
  }

  const player = currentPlayer(game);
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: { name: "Staged Events" },
    effect: "stagedEvent",
    prompt: "Choose which staged showdown or combat to resolve first.",
    options: game.stagedEvents.map((event) => {
      const field = game.battlefields.find((candidate) => candidate.instanceId === event.battlefieldId);
      return {
        id: event.id,
        label: `${event.type === "combat" ? "Combat" : "Showdown"} at ${field?.name || "Battlefield"}`,
        cardId: field?.instanceId
      };
    }),
    data: { eventIds: game.stagedEvents.map((event) => event.id) },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  log(game, `${player.name} chooses the next staged event.`);
  return true;
}

function uniqueStagedEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function validStagedEvents(game, events) {
  return events.filter((event) => {
    const battlefield = game.battlefields.find((field) => field.instanceId === event.battlefieldId);
    if (!battlefield) return false;
    const hasAttacker = battlefield.units.some((unit) => unit.controllerId === event.attackerId);
    if (!hasAttacker) return false;
    const defenderId = event.defenderId || battlefield.units.find((unit) => unit.controllerId !== event.attackerId)?.controllerId;
    if (event.type === "combat") {
      return Boolean(defenderId && battlefield.units.some((unit) => unit.controllerId === defenderId));
    }
    const controllers = new Set(battlefield.units.map((unit) => unit.controllerId));
    return controllers.size === 1 && battlefield.controlledBy !== event.attackerId;
  });
}

function refreshStagedBattlefieldEvents(game) {
  const before = JSON.stringify({
    events: game.stagedEvents || [],
    contested: game.battlefields.map((field) => [field.instanceId, field.contestedBy || null])
  });
  const refreshed = [];

  for (const battlefield of game.battlefields) {
    if (game.showdown?.battlefieldId === battlefield.instanceId
      || game.showdownExitProcess?.battlefieldId === battlefield.instanceId) continue;
    const existing = (game.stagedEvents || []).filter((event) => event.battlefieldId === battlefield.instanceId);
    const controllers = [...new Set(battlefield.units.map((unit) => unit.controllerId))];
    let attackerId = battlefield.contestedBy
      || existing.find((event) => controllers.includes(event.attackerId))?.attackerId
      || (controllers.includes(game.currentPlayerId) ? game.currentPlayerId : controllers[0]);

    if (controllers.length >= 2) {
      if (!controllers.includes(attackerId)) attackerId = controllers[0];
      const defenderId = controllers.find((controllerId) => controllerId !== attackerId);
      battlefield.contestedBy = attackerId;
      refreshed.push({
        id: `staged-combat-${battlefield.instanceId}-${attackerId}`,
        type: "combat",
        battlefieldId: battlefield.instanceId,
        attackerId,
        defenderId
      });
      continue;
    }

    const contestedPlayerPresent = Boolean(attackerId && controllers.includes(attackerId));
    if (contestedPlayerPresent && battlefield.contestedBy === attackerId && battlefield.controlledBy !== attackerId) {
      refreshed.push({
        id: `staged-showdown-${battlefield.instanceId}-${attackerId}`,
        type: "showdown",
        battlefieldId: battlefield.instanceId,
        attackerId,
        defenderId: battlefield.controlledBy || game.players.find((player) => player.id !== attackerId)?.id
      });
      continue;
    }

    if (!contestedPlayerPresent || battlefield.controlledBy === attackerId) delete battlefield.contestedBy;
  }

  game.stagedEvents = uniqueStagedEvents(refreshed);
  const after = JSON.stringify({
    events: game.stagedEvents,
    contested: game.battlefields.map((field) => [field.instanceId, field.contestedBy || null])
  });
  return before !== after;
}

function resolveChosenStagedEvent(game, eventId, choice) {
  if (choice.playerId !== game.currentPlayerId) return;
  startStagedEvent(game, eventId);
}

function startStagedEvent(game, eventId) {
  const event = (game.stagedEvents || []).find((candidate) => candidate.id === eventId);
  if (!event) return false;
  game.stagedEvents = game.stagedEvents.filter((candidate) => candidate.id !== eventId);
  const battlefield = game.battlefields.find((field) => field.instanceId === event.battlefieldId);
  if (!battlefield) return false;
  if (!validStagedEvents(game, [event]).length) {
    resolveStagedEvents(game);
    return false;
  }
  if (event.type === "combat") {
    recordRuleTask(game, "323.11", "open-staged-showdown", { battlefieldId: event.battlefieldId });
    recordRuleTask(game, "323.12", "open-as-combat-showdown", { battlefieldId: event.battlefieldId });
    startShowdown(game, battlefield, event.attackerId, {
      combat: true,
      defenderId: event.defenderId
    });
  } else {
    recordRuleTask(game, "323.11", "open-staged-showdown", { battlefieldId: event.battlefieldId });
    startShowdown(game, battlefield, event.attackerId, {
      combat: false,
      defenderId: event.defenderId || battlefield.controlledBy || game.players.find((candidate) => candidate.id !== event.attackerId)?.id
    });
  }
  return true;
}

function startShowdown(game, battlefield, attackerId, options = {}) {
  let defenderId = options.defenderId || battlefield.units.find((unit) => unit.controllerId !== attackerId)?.controllerId;
  if (!defenderId && options.combat !== false) return;
  defenderId ||= game.players.find((player) => player.id !== attackerId)?.id;
  if (!defenderId) return;

  game.phase = "showdown";
  game.currentPlayerId = attackerId;
  game.showdown = {
    battlefieldId: battlefield.instanceId,
    turnPlayerId: attackerId,
    attackerId,
    defenderId,
    combat: options.combat !== false,
    focusPlayerId: attackerId,
    priorityPlayerId: attackerId,
    consecutivePasses: 0,
    chainSequence: 0,
    chain: []
  };
  if (game.showdown.combat) {
    game.showdown.combatId = nextCombatId(game);
    battlefield.combatExcessDamageByPlayer = {};
  }
  const attacker = game.players.find((player) => player.id === attackerId);
  const defender = game.players.find((player) => player.id === defenderId);
  log(game, `${options.combat === false ? "Non-combat showdown" : "Combat showdown"} begins at ${battlefield.name}: ${attacker.name} faces ${defender.name}.`);
  const triggers = [];
  if (game.showdown.combat) triggers.push(...collectAttackOrDefendTriggers(game, battlefield, attackerId));
  triggers.push(...collectShowdownStartTriggers(game, battlefield, defender));
  if (!triggers.length) {
    log(game, `${attacker.name} has showdown priority.`);
  } else {
    prepareAndQueueTriggers(game, triggers, "showdownChain");
  }
}

function playShowdownCard(game, cardId, destination = "base") {
  const showdown = game.showdown;
  const player = actingPlayer(game);
  if (!showdownPlayerIds(showdown).includes(player.id)) return fail(game, "That player is not in this showdown.");
  if (showdown.priorityPlayerId !== player.id) return fail(game, "It is not that player's showdown priority.");

  const cardIndex = player.hand.findIndex((card) => card.instanceId === cardId);
  if (cardIndex < 0) {
    const hidden = findHiddenCardLocation(game, cardId);
    if (hidden) return playHiddenCard(game, hidden, destination);
    return fail(game, "That card is not in hand.");
  }
  const card = player.hand[cardIndex];
  if (!canPlayInShowdown(game, player, card, showdown, destination)) {
    return fail(game, showdown.chain.length > 0
      ? "Only Reactions can be played onto an existing chain."
      : "Only Actions and Reactions can be played during a showdown.");
  }
  if (!hasRequiredPlayTargets(game, player, card, destination)) return fail(game, `${card.name} has no legal target.`);
  return beginCardPlayProcess(game, player, card, destination, "hand", true);
}

function addPendingChainItem(game, showdown, card, playerId, destination, playOptions = {}) {
  if (!showdown.chain.length && !showdown.chainOpenedBy) showdown.chainOpenedBy = "card";
  showdown.chainSequence = (showdown.chainSequence || 0) + 1;
  const item = {
    id: `chain-${showdown.chainSequence}`,
    itemType: "card",
    card,
    playerId,
    destination,
    playOptions: structuredClone(playOptions),
    status: "pending"
  };
  showdown.chain.push(item);
  requestCleanup(game, "pending-item-added", { itemId: item.id, playerId, itemType: item.itemType });
  resetChainPassCycle(showdown);
  return item;
}

function addPendingActivatedChainItem(game, showdown, card, playerId, specs, playOptions = {}) {
  if (!showdown.chain.length && !showdown.chainOpenedBy) showdown.chainOpenedBy = "activated";
  showdown.chainSequence = (showdown.chainSequence || 0) + 1;
  const item = {
    id: `chain-${showdown.chainSequence}`,
    itemType: "activated",
    card,
    playerId,
    specs,
    playOptions: structuredClone(playOptions),
    status: "pending"
  };
  showdown.chain.push(item);
  requestCleanup(game, "pending-item-added", { itemId: item.id, playerId, itemType: item.itemType });
  resetChainPassCycle(showdown);
  return item;
}

function pendingActivatedAbilityItem(game, card) {
  const itemId = card?.activationProcess?.chainItemId;
  if (!itemId) return null;
  return [
    ...(game.showdown ? normalizeChainItems(game.showdown) : []),
    ...(game.actionChain ? normalizeActionChainItems(game.actionChain) : [])
  ].find((item) => item.id === itemId && item.itemType === "activated" && item.card === card) || null;
}

function beginPendingActivatedAbility(game, player, card, specs, context = {}) {
  const existing = pendingActivatedAbilityItem(game, card);
  if (existing) return existing;
  let chainState = null;
  if (game.phase === "showdown" && game.showdown) chainState = game.showdown;
  else if (game.actionChain) chainState = game.actionChain;
  else if (game.phase === "action" && game.interactive) chainState = ensureActionChain(game, player.id);
  if (!chainState) return null;
  const item = addPendingActivatedChainItem(game, chainState, card, player.id, structuredClone(specs), {
    playProcess: { kind: "activatedAbility" },
    declarationsComplete: false
  });
  card.activationProcess = {
    chainItemId: item.id,
    specs: structuredClone(specs),
    usingForgeAbility: Boolean(context.usingForgeAbility)
  };
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} puts ${card.name}'s activated ability onto the Chain as Pending.`);
  return item;
}

function clearActivatedAbilityProcess(card) {
  if (!card) return;
  delete card.activationProcess;
  delete card.selectedActivatedAbilityId;
  delete card.activationDeclarationReady;
  delete card.udyrActivationCostPending;
}

function rollbackPendingActivatedAbility(game, card) {
  const item = pendingActivatedAbilityItem(game, card);
  const chainState = item && game.showdown?.chain?.includes(item) ? game.showdown : item ? game.actionChain : null;
  if (item && chainState) {
    const index = chainState.chain.indexOf(item);
    if (index >= 0) {
      chainState.chain.splice(index, 1);
      requestCleanup(game, "chain-item-removed", { itemId: item.id, reason: "activation-rollback" });
    }
  }
  clearActivatedAbilityProcess(card);
  if (chainState === game.actionChain && chainState?.chain.length === 0) game.actionChain = null;
  if (chainState === game.showdown && chainState?.chain.length === 0 && chainState.chainOpenedBy === "activated") {
    delete chainState.chainOpenedBy;
  }
  game.selectedCardId = null;
  return Boolean(item);
}

function finalizeAndResolveAddAbility(game, player, card, specs) {
  const kind = game.phase === "showdown" && game.showdown ? "showdown" : "action";
  const chainState = kind === "showdown" ? game.showdown : ensureActionChain(game, player.id);
  const items = kind === "showdown" ? normalizeChainItems(chainState) : normalizeActionChainItems(chainState);
  const existing = pendingActivatedAbilityItem(game, card);
  const openedByAdd = existing ? items.length === 1 : items.length === 0;
  const addItem = existing || addPendingActivatedChainItem(game, chainState, card, player.id, specs, {
    playProcess: { kind: "activatedAbility" },
    declarationsComplete: true
  });
  if (kind === "showdown" && openedByAdd) {
    chainState.chainOpenedBy = "add";
    chainState.suppressFocusPassOnEmpty = true;
  }

  addItem.playOptions ||= {};
  addItem.playOptions.declarationsComplete = true;
  addItem.status = "finalized";
  requestCleanup(game, "pending-item-finalized", { itemId: addItem.id, itemType: addItem.itemType });
  clearActivatedAbilityProcess(card);
  log(game, `${card.name}'s Add ability finalizes immediately.`);
  chainState.chain.splice(chainState.chain.indexOf(addItem), 1);
  requestCleanup(game, "chain-item-removed", { itemId: addItem.id, reason: "resolved-on-finalize" });
  resolveInChainContext(game, kind, () => {
    const waits = resolveEffectSpecs(game, player, card, specs, false);
    if (!waits) recordActivatedAbilityResolution(game, player, card, specs);
    return waits;
  });

  if (chainState.chain.length === 0) {
    if (kind === "showdown") {
      delete chainState.suppressFocusPassOnEmpty;
      delete chainState.chainOpenedBy;
    } else {
      finishActionChain(game);
      return { ok: true };
    }
  }
  checkState(game);
  return { ok: true };
}

function addPendingTriggerChainItem(game, trigger) {
  const showdown = game.showdown;
  if (!showdown) return;
  if (!showdown.chain.length && !showdown.chainOpenedBy) showdown.chainOpenedBy = "trigger";
  const source = findCard(game, trigger.sourceCardId);
  showdown.chainSequence = (showdown.chainSequence || 0) + 1;
  trigger.id ||= `trigger-${Date.now()}-${Math.random()}`;
  trigger.status = "pending";
  trigger.fromShowdownChain = true;
  const item = {
    id: `chain-${showdown.chainSequence}`,
    itemType: "trigger",
    card: source || { name: trigger.kind, instanceId: trigger.id },
    playerId: trigger.playerId,
    trigger,
    playOptions: { playProcess: { kind: "triggeredAbility" }, declarationsComplete: false },
    status: "pending"
  };
  showdown.chain.push(item);
  requestCleanup(game, "pending-item-added", { itemId: item.id, playerId: trigger.playerId, itemType: item.itemType });
  trigger.pendingChainItemId = item.id;
  resetChainPassCycle(showdown);
  return item;
}

function addPendingTriggerChainItems(game, triggers) {
  if (game.showdown && normalizeChainItems(game.showdown).length === 0 && triggers.length && !game.showdown.chainOpenedBy) {
    game.showdown.suppressFocusPassOnEmpty = true;
  }
  for (const trigger of triggers) addPendingTriggerChainItem(game, trigger);
}

function ensureActionChain(game, playerId, continuation = null) {
  if (game.actionChain) {
    ownActionChainContinuation(game, continuation);
    return game.actionChain;
  }
  game.actionChain = {
    turnPlayerId: game.currentPlayerId,
    playerIds: game.players.map((player) => player.id),
    priorityPlayerId: playerId,
    consecutivePasses: 0,
    chain: [],
    chainSequence: 0,
    continuation: null
  };
  ownActionChainContinuation(game, continuation);
  giveActionChainPriority(game, playerId);
  return game.actionChain;
}

function ownActionChainContinuation(game, continuation) {
  if (!game.actionChain || !continuation || game.actionChain.continuation) return false;
  game.actionChain.continuation = continuation;
  return true;
}

function addPendingActionTriggerChainItem(game, trigger) {
  const chain = ensureActionChain(game, trigger.playerId);
  const source = findCard(game, trigger.sourceCardId);
  chain.chainSequence = (chain.chainSequence || 0) + 1;
  trigger.id ||= `trigger-${Date.now()}-${Math.random()}`;
  trigger.status = "pending";
  trigger.fromActionChain = true;
  const item = {
    id: `action-chain-${chain.chainSequence}`,
    itemType: "trigger",
    card: source || { name: trigger.kind, instanceId: trigger.id },
    playerId: trigger.playerId,
    trigger,
    playOptions: { playProcess: { kind: "triggeredAbility" }, declarationsComplete: false },
    status: "pending"
  };
  chain.chain.push(item);
  requestCleanup(game, "pending-item-added", { itemId: item.id, playerId: trigger.playerId, itemType: item.itemType });
  trigger.pendingChainItemId = item.id;
  resetChainPassCycle(chain);
  return item;
}

function addPendingActionTriggerChainItems(game, triggers, continuation = null) {
  for (const trigger of triggers) addPendingActionTriggerChainItem(game, trigger);
  if (game.actionChain) {
    ownActionChainContinuation(game, continuation);
    checkState(game);
    maybeAutoPassActionChain(game);
  }
}

function normalizeChainItems(showdown) {
  if (!showdown) return [];
  showdown.chain ||= [];
  showdown.chainSequence ||= showdown.chain.length;
  for (const [index, item] of showdown.chain.entries()) {
    item.id ||= `chain-${index + 1}`;
    item.itemType ||= "card";
    item.status ||= "finalized";
  }
  return showdown.chain;
}

function normalizeActionChainItems(actionChain) {
  if (!actionChain) return [];
  actionChain.chain ||= [];
  actionChain.chainSequence ||= actionChain.chain.length;
  for (const [index, item] of actionChain.chain.entries()) {
    item.id ||= `action-chain-${index + 1}`;
    item.itemType ||= "card";
    item.status ||= "finalized";
  }
  return actionChain.chain;
}

function finalizePendingChainItems(game) {
  const pending = normalizeChainItems(game.showdown)
    .filter((item) => item.status === "pending" && pendingCardReadyForFinalize(item));
  if (!pending.length) return;
  for (const item of pending) {
    item.status = "finalized";
    requestCleanup(game, "pending-item-finalized", { itemId: item.id, itemType: item.itemType });
  }
  log(game, `${pending.length} chain item${pending.length === 1 ? "" : "s"} finalized.`);
}

function finalizePendingActionChainItems(game) {
  const pending = normalizeActionChainItems(game.actionChain)
    .filter((item) => item.status === "pending" && pendingCardReadyForFinalize(item));
  if (!pending.length) return;
  for (const item of pending) {
    item.status = "finalized";
    requestCleanup(game, "pending-item-finalized", { itemId: item.id, itemType: item.itemType });
  }
  log(game, `${pending.length} chain item${pending.length === 1 ? "" : "s"} finalized.`);
}

function pendingCardReadyForFinalize(item) {
  return !item.playOptions?.playProcess
    || item.playOptions.declarationsComplete === true;
}

function chainItemResolvesOnFinalize(item) {
  if (item.itemType === "card") return ["unit", "gear"].includes(item.card?.type);
  const specs = item.itemType === "activated"
    ? (item.specs || cardEffects(item.card, "activated"))
    : item.itemType === "trigger" ? (item.trigger?.data?.specs || []) : [];
  return specs.length > 0 && specs.every((spec) => effectDefinition(spec)?.resolvesOnFinalize);
}

function resolveFinalizedImmediateItems(game, chainState, kind) {
  let resolvedAny = false;
  while (!game.pendingChoice && !game.pendingPayment) {
    const chain = kind === "showdown" ? normalizeChainItems(chainState) : normalizeActionChainItems(chainState);
    const index = chain.findIndex((item) => item.status === "finalized" && chainItemResolvesOnFinalize(item));
    if (index < 0) break;
    const [item] = chain.splice(index, 1);
    requestCleanup(game, "chain-item-removed", { itemId: item.id, reason: "resolved-on-finalize" });
    const player = game.players.find((candidate) => candidate.id === item.playerId);
    if (!player) continue;
    resolvedAny = true;
    resolveInChainContext(game, kind, () => {
      if (item.itemType === "card") {
        resolvePermanentCardPlay(game, player, item.card, item.destination,
          Boolean(item.playOptions?.isChampion), item.playOptions || {});
      } else if (item.itemType === "activated") {
        const specs = item.specs || cardEffects(item.card, "activated");
        const waits = resolveEffectSpecs(game, player, item.card, specs, false);
        if (!waits) recordActivatedAbilityResolution(game, player, item.card, specs);
      } else if (item.itemType === "trigger") {
        resolveQueuedTrigger(game, item.trigger);
      }
    });
  }
  return resolvedAny;
}

function preparePendingEffectPlayDeclarations(game) {
  const pendingItems = [
    ...(game.showdown ? normalizeChainItems(game.showdown) : []),
    ...(game.actionChain ? normalizeActionChainItems(game.actionChain) : [])
  ].filter((item) => item.status === "pending"
    && item.itemType === "card"
    && item.playOptions?.effectPlay
    && !item.playOptions?.declarationsComplete);

  for (const item of pendingItems) {
    const player = game.players.find((candidate) => candidate.id === item.playerId);
    if (!player) continue;
    const declaration = playTargetDeclaration(game, player, item.card, item.destination);
    if (!declaration) {
      if (!beginEffectPlayPayment(game, player, item, {
        declaredTargets: [],
        declaredChoices: [],
        deflectPowerCost: [],
        deflectTargetIds: []
      }, !game.interactive)) {
        log(game, `${item.card.name} cannot pay its complete instructed play cost.`);
      }
      const payment = game.pendingPayment;
      if (game.interactive && payment?.effectPlay
        && (payment.energyCost || 0) === 0
        && totalPowerAmount(payment.powerCost || []) === 0
        && !(payment.optionalPowerEffects || []).length) {
        selectAutomaticPayment(game, player, item.card, payment);
        confirmPayment(game);
      }
      if (game.pendingChoice || game.pendingPayment) return true;
      continue;
    }
    if (game.interactive) {
      const costOptions = effectPlayCostOptions(item);
      promptNextPlayDeclaration(game, player, item.card, {
        destination: item.destination,
        source: "effectPlay",
        completion: { type: "effectPlay", chainItemId: item.id },
        declarationSteps: declaration.steps,
        declaredTargets: [],
        declaredChoices: [],
        deflectPowerCost: [],
        deflectTargetIds: [],
        ...costOptions
      });
      return true;
    }
    const declarations = buildAutomaticPlayDeclarations(game, player, item.card, item.destination,
      effectPlayCostOptions(item));
    if (!declarations || !beginEffectPlayPayment(game, player, item, declarations, true)) {
      log(game, `${item.card.name} cannot complete its mandatory play declarations or additional costs.`);
      return true;
    }
    if (game.pendingChoice || game.pendingPayment) return true;
  }
  return false;
}

function finalizeOutstandingChainItems(game) {
  if (game.pendingChoice || game.pendingPayment || game.resolvingChainContext || game.resolvingGameEffect) return false;
  const showdownPending = game.showdown
    ? normalizeChainItems(game.showdown).some((item) => item.status === "pending")
    : false;
  const actionPending = game.actionChain
    ? normalizeActionChainItems(game.actionChain).some((item) => item.status === "pending")
    : false;
  if (!showdownPending && !actionPending) return false;

  if (preparePendingEffectPlayDeclarations(game)) return true;

  const hasReadyPending = [
    ...(game.showdown ? normalizeChainItems(game.showdown) : []),
    ...(game.actionChain ? normalizeActionChainItems(game.actionChain) : [])
  ].some((item) => item.status === "pending" && pendingCardReadyForFinalize(item));
  if (!hasReadyPending) return false;

  if (showdownPending) finalizePendingChainItems(game);
  if (actionPending) finalizePendingActionChainItems(game);
  requestCleanup(game, "pending-item-finalized");
  checkState(game);
  if (game.pendingChoice || game.pendingPayment) return true;

  if (game.showdown) resolveFinalizedImmediateItems(game, game.showdown, "showdown");
  else if (game.actionChain) resolveFinalizedImmediateItems(game, game.actionChain, "action");
  if (game.pendingChoice || game.pendingPayment) return true;

  if (game.showdown) {
    const newest = normalizeChainItems(game.showdown).at(-1);
    if (newest) giveShowdownPriority(game, newest.playerId);
    else continueShowdownAfterChainResolution(game);
  } else if (game.actionChain) {
    const newest = normalizeActionChainItems(game.actionChain).at(-1);
    if (newest) {
      giveActionChainPriority(game, newest.playerId);
      maybeAutoPassActionChain(game);
    } else {
      finishActionChain(game);
    }
  }
  return true;
}

function canPlayInShowdown(game, player, card, showdown, destination = "base") {
  normalizeChainItems(showdown);
  if (!showdown || !showdownPlayerIds(showdown).includes(player.id)) return false;
  if (showdown.priorityPlayerId !== player.id) return false;
  const isAction = card.tags?.includes("Action");
  const isReaction = cardHasReactionTimingPermission(game, player, card, destination);
  if (!isAction && !isReaction) return false;
  if (showdown.chain.length > 0 && !isReaction) return false;
  if (!showdown.chain.length && showdown.focusPlayerId !== player.id) return false;
  return true;
}

function ambushGrantsReaction(game, player, card, destination) {
  if (!hasKeyword(card, "Ambush", null)) return false;
  const battlefield = game.battlefields.find((field) => field.instanceId === destination || field.id === destination);
  return Boolean(battlefield?.units.some((unit) => unit.controllerId === player.id));
}

function cardHasReactionTimingPermission(game, player, card, destination) {
  return cardReactionPermissionSources(card, {
    fromHidden: card.hidden === true,
    ambushDestinationEligible: ambushGrantsReaction(game, player, card, destination)
  }).length > 0;
}

function canPlayInActionChain(game, player, card, destination = "base") {
  if (!game.actionChain || game.actionChain.priorityPlayerId !== player.id) return false;
  return cardHasReactionTimingPermission(game, player, card, destination);
}

function addPaidCardToActionChain(game, player, card, destination) {
  const chain = ensureActionChain(game, player.id);
  addPendingChainItem(game, chain, card, player.id, destination);
  log(game, `${player.name} adds ${card.name} to the chain.`);
  checkState(game);
  maybeAutoPassActionChain(game);
  return { ok: true };
}

function resolveActionChainTop(game) {
  const chain = normalizeActionChainItems(game.actionChain);
  let index = -1;
  for (let candidate = chain.length - 1; candidate >= 0; candidate -= 1) {
    if (chain[candidate].status === "finalized") {
      index = candidate;
      break;
    }
  }
  if (index < 0) return;
  const [item] = chain.splice(index, 1);
  requestCleanup(game, "chain-item-removed", { itemId: item.id, reason: "resolve" });
  const player = game.players.find((candidate) => candidate.id === item.playerId);
  log(game, `${item.card.name} resolves from the chain.`);
  return resolveInChainContext(game, "action", () => {
    if (item.itemType === "trigger") {
      const trigger = item.trigger;
      if (trigger) {
        trigger.status = "finalized";
        resolveQueuedTrigger(game, trigger);
      }
      checkState(game);
      return;
    }

    if (item.itemType === "activated") {
      const specs = item.specs || cardEffects(item.card, "activated");
      const waits = resolveEffectSpecs(game, player, item.card, specs, false);
      if (!waits) recordActivatedAbilityResolution(game, player, item.card, specs);
      checkState(game);
      return;
    }

    if (item.card.type === "spell") {
      beginChainCardResolution(item.card);
      resolveSpellAfterSynergies(game, player, item.card);
    } else {
      resolvePermanentCardPlay(game, player, item.card, item.destination,
        Boolean(item.playOptions?.isChampion), item.playOptions || {});
    }

    checkState(game);
  });
}

function finishActionChain(game) {
  const chain = game.actionChain;
  game.actionChain = null;
  if (chain) game.currentPlayerId = chain.turnPlayerId;
  if (chain?.continuation) runTriggerContinuation(game, chain.continuation);
  checkState(game);
}

function continueActionChainAfterResolution(game) {
  if (!game.actionChain || game.pendingChoice || game.pendingPayment) return;
  const remaining = normalizeActionChainItems(game.actionChain);
  if (!remaining.length) {
    finishActionChain(game);
    return;
  }
  game.actionChain.consecutivePasses = 0;
  giveActionChainPriority(game, remaining.at(-1).playerId);
  maybeAutoPassActionChain(game);
}

function maybeAutoPassActionChain(game) {
  if (game.settlingActionChain) return;
  game.settlingActionChain = true;
  try {
    let safety = 0;
    while (game.actionChain && !game.pendingChoice && !game.pendingPayment && safety < 20) {
      safety += 1;
      const playerId = game.actionChain.priorityPlayerId;
      if (playerHasActionChainResponse(game, playerId)) break;
      passActionChain(game, playerId);
    }
  } finally {
    delete game.settlingActionChain;
  }
}

function playerHasActionChainResponse(game, playerId) {
  if (!game.manualActionChainPriority) return false;
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player || !game.actionChain || game.actionChain.priorityPlayerId !== playerId) return false;
  return player.hand.some((card) => {
    if (!canPay(game, player, card)) return false;
    return ["base", ...game.battlefields.map((field) => field.instanceId)].some((destination) =>
      canPlayInActionChain(game, player, card, destination)
      && hasRequiredPlayTargets(game, player, card, destination));
  }) || controlledCardsForEngine(game, player.id).some((card) =>
    canActivateInActionChain(game, player, card)
    || canActivateAddDuringActionChain(game, player, card, cardEffects(card, "activated"))
  );
}

function controlledCardsForEngine(game, playerId) {
  return allControlledCards(game, playerId);
}


function resolveShowdownTop(game) {
  const chain = normalizeChainItems(game.showdown);
  let index = -1;
  for (let candidate = chain.length - 1; candidate >= 0; candidate -= 1) {
    if (chain[candidate].status === "finalized") {
      index = candidate;
      break;
    }
  }
  if (index < 0) return;
  const [item] = chain.splice(index, 1);
  requestCleanup(game, "chain-item-removed", { itemId: item.id, reason: "resolve" });
  const player = game.players.find((candidate) => candidate.id === item.playerId);
  log(game, `${item.card.name} resolves from the showdown chain.`);
  return resolveInChainContext(game, "showdown", () => {
    if (item.itemType === "trigger") {
      const trigger = item.trigger;
      if (trigger) {
        trigger.status = "finalized";
        resolveQueuedTrigger(game, trigger);
      }
      checkState(game);
      return;
    }

    if (item.itemType === "activated") {
      const specs = item.specs || cardEffects(item.card, "activated");
      const waits = resolveEffectSpecs(game, player, item.card, specs, false);
      if (!waits) recordActivatedAbilityResolution(game, player, item.card, specs);
      checkState(game);
      return;
    }

    if (item.card.type === "spell") {
      beginChainCardResolution(item.card);
      resolveSpellAfterSynergies(game, player, item.card);
    }
    else resolvePermanentCardPlay(game, player, item.card, item.destination,
      Boolean(item.playOptions?.isChampion), item.playOptions || {});

    checkState(game);
  });
}

function resolveInChainContext(game, kind, resolver) {
  const previous = game.resolvingChainContext;
  const effectScope = enterGameEffectResolution(game, kind);
  game.resolvingChainContext = kind;
  requestCleanup(game, "chain-resolution-deferred", { chainKind: kind });
  let result;
  try {
    result = resolver();
  } finally {
    if (game.pendingChoice) {
      if (kind === "action") game.pendingChoice.fromActionChain = true;
      if (kind === "showdown") game.pendingChoice.fromShowdownChain = true;
    }
    if (game.pendingPayment) {
      if (kind === "action") game.pendingPayment.fromActionChain = true;
      if (kind === "showdown") game.pendingPayment.fromShowdownChain = true;
    }
    if (previous) game.resolvingChainContext = previous;
    else delete game.resolvingChainContext;
    leaveGameEffectResolution(game, effectScope, Boolean(game.pendingChoice || game.pendingPayment));
  }
  const resolutionPaused = Boolean(game.pendingChoice || game.pendingPayment);
  if (!previous && game.cleanupOutstanding && !resolutionPaused) checkState(game);
  return result;
}

function recordActivatedAbilityResolution(game, player, card, specs) {
  const event = {
    turnSequence: game.turnSequence || 0,
    playerId: player.id,
    sourceCardId: card.instanceId,
    sourceCardName: card.name,
    abilityKinds: specs.map((spec) => spec.kind)
  };
  player.activatedAbilitiesResolved = [...(player.activatedAbilitiesResolved || []), event].slice(-100);
  game.lastResolvedActivatedAbility = event;
  log(game, `${card.name}'s activated ability is used as it resolves.`);
  return event;
}

function finishShowdown(game) {
  const showdown = game.showdown;
  game.showdown = null;
  game.phase = "action";
  game.currentPlayerId = showdown.turnPlayerId;
  game.showdownExitProcess = {
    battlefieldId: showdown.battlefieldId,
    turnPlayerId: showdown.turnPlayerId,
    attackerId: showdown.attackerId,
    defenderId: showdown.defenderId,
    combat: showdown.combat !== false
  };
  requestCleanup(game, "state-transition", { from: "showdown", to: "neutral" });
  requestCleanup(game, "phase-transition", { from: "showdown", to: "action" });
  checkState(game);
}

function completeShowdownExitTask(game) {
  const process = game.showdownExitProcess;
  if (!process) return false;
  delete game.showdownExitProcess;
  const battlefield = game.battlefields.find((field) => field.instanceId === process.battlefieldId);

  if (!battlefield) return true;
  const attackersRemain = battlefield.units.some((unit) => unit.controllerId === process.attackerId);
  const defendersRemain = battlefield.units.some((unit) => unit.controllerId === process.defenderId);

  if (attackersRemain && defendersRemain) {
    if (process.combat) {
      resolveCombat(game, battlefield, process.attackerId);
      return true;
    }
    clearCombatRoles(game);
    log(game, `${battlefield.name} remains contested. Combat is staged.`);
    stageBattlefieldEvent(game, {
      type: "combat",
      battlefield,
      attackerId: process.attackerId
    });
  } else if (attackersRemain) {
    clearCombatRoles(game);
    settleBattlefieldConquest(game, battlefield, process.attackerId, "after the showdown");
  } else if (defendersRemain) {
    clearCombatRoles(game);
    settleBattlefieldConquest(game, battlefield, process.defenderId, "after the showdown");
  } else {
    clearCombatRoles(game);
    battlefield.controlledBy = null;
    delete battlefield.contestedBy;
    log(game, "No units remain after the showdown.");
  }

  updateBattlefieldControl(game);
  checkState(game);
  return true;
}

function currentShowdownFocusId(showdown) {
  return showdown?.focusPlayerId || showdown?.priorityPlayerId || showdown?.attackerId;
}

function continueShowdownAfterChainResolution(game) {
  if (!game.showdown || game.pendingChoice || game.pendingPayment) return;
  const showdown = game.showdown;
  showdown.consecutivePasses = 0;
  const remaining = normalizeChainItems(showdown);
  if (remaining.length === 0) {
    const suppressFocusPass = showdown.suppressFocusPassOnEmpty
      || ["trigger", "add"].includes(showdown.chainOpenedBy);
    delete showdown.suppressFocusPassOnEmpty;
    delete showdown.chainOpenedBy;
    if (!suppressFocusPass) showdown.focusPlayerId = otherShowdownPlayerId(showdown, currentShowdownFocusId(showdown));
    giveShowdownPriority(game, currentShowdownFocusId(showdown));
    return;
  }
  giveShowdownPriority(game, remaining.at(-1).playerId);
}

function giveShowdownPriority(game, playerId) {
  game.showdown.priorityPlayerId = playerId;
  game.currentPlayerId = playerId;
  const player = game.players.find((candidate) => candidate.id === playerId);
  log(game, `${player.name} has showdown priority.`);
}

function giveShowdownPriorityToAttacker(game) {
  if (!game.showdown) return;
  giveShowdownPriority(game, game.showdown.attackerId);
}

function otherShowdownPlayerId(showdown, playerId) {
  return showdownPlayerIds(showdown).find((candidate) => candidate !== playerId) || playerId;
}

function showdownPlayerIds(showdown) {
  return [showdown.attackerId, showdown.defenderId];
}

function otherActionChainPlayerId(actionChain, playerId) {
  return actionChainPlayerIds(actionChain).find((candidate) => candidate !== playerId) || playerId;
}

function actionChainPlayerIds(actionChain) {
  return actionChain?.playerIds?.length
    ? actionChain.playerIds
    : [actionChain?.turnPlayerId].filter(Boolean);
}

function giveActionChainPriority(game, playerId) {
  if (!game.actionChain) return;
  game.actionChain.priorityPlayerId = playerId;
  game.currentPlayerId = playerId;
  const player = game.players.find((candidate) => candidate.id === playerId);
  log(game, `${player?.name || "A player"} has chain priority.`);
}

function giveActionChainPriorityToTurnPlayer(game) {
  if (!game.actionChain) return;
  giveActionChainPriority(game, game.actionChain.turnPlayerId);
}

function resolveSpellAfterSynergies(game, player, card) {
  resolveSpellEffectOnly(game, player, card);
}

function resolveSpellEffectOnly(game, player, card) {
  const scope = enterGameEffectResolution(game, game.resolvingChainContext || null);
  try {
    card.playResolutionTargets ??= structuredClone(card.declaredPlayTargets || []);
    card.playResolutionChoices ??= structuredClone(card.declaredPlayChoices || []);
    if (!resolveEffect(game, player, card)) finishSpell(game, player, card);
    checkState(game);
  } finally {
    leaveGameEffectResolution(game, scope, Boolean(game.pendingChoice || game.pendingPayment));
  }
}

function collectActionSynergyTriggers(game, player, card) {
  if (card.type !== "spell") return [];
  const triggers = [];
  for (const unit of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(unit, "spellPlayed")) {
      if (effect.kind === "selfBuff") {
        triggers.push({
          kind: "spellPlayedSelfBuff",
          playerId: player.id,
          sourceCardId: unit.instanceId,
          data: { amount: effect.amount || 1, temporary: isTemporaryMightEffect(unit, effect) }
        });
      }
    }
  }
  for (const field of game.battlefields) {
    for (const effect of cardEffects(field, "spellPlayed")) {
      if (effect.kind === "battlefieldBuffUnitHere") {
        const targets = field.units.filter((unit) => unit.controllerId === player.id);
        if (!targets.length) continue;
        triggers.push({
          kind: "battlefieldSpellBuff",
          playerId: player.id,
          sourceCardId: field.instanceId,
          data: {
            amount: effect.amount || 1,
            temporary: isTemporaryMightEffect(field, effect),
            optional: Boolean(effect.optional),
            targetIds: targets.map((unit) => unit.instanceId)
          }
        });
      }
      if (effect.kind === "drawIfChoosesFriendlyUnitHereFirstTime") {
        const alreadyUsed = field.spellFriendlyTargetDrawnThisTurn?.[player.id];
        const targetIds = (card.declaredPlayTargets || []).map((target) => target.targetId);
        const choseFriendlyHere = field.units.some((unit) => unit.controllerId === player.id && targetIds.includes(unit.instanceId));
        if (alreadyUsed || !choseFriendlyHere) continue;
        field.spellFriendlyTargetDrawnThisTurn ||= {};
        field.spellFriendlyTargetDrawnThisTurn[player.id] = true;
        triggers.push({
          kind: "spellPlayedDraw",
          playerId: player.id,
          sourceCardId: field.instanceId,
          data: {
            amount: effect.amount || 1,
            targetIds
          }
        });
      }
    }
  }
  return triggers;
}

function triggerPlacementIsOptional(trigger) {
  if (trigger.declined || trigger.optionalPlacementComplete) return false;
  return Boolean(effectDefinition(triggerRuleEffect(trigger))?.optionalTrigger);
}

function prepareOptionalTriggerPlacements(game, triggers, mode, continuation) {
  const optional = triggers.find((trigger) => triggerPlacementIsOptional(trigger));
  if (!optional) return false;
  if (!game.interactive) {
    for (const trigger of triggers) {
      if (triggerPlacementIsOptional(trigger)) trigger.optionalPlacementComplete = true;
    }
    return false;
  }
  const player = game.players.find((candidate) => candidate.id === optional.playerId);
  const source = findCard(game, optional.sourceCardId) || optional.sourceCardSnapshot;
  if (!player || !source) {
    optional.declined = true;
    return prepareOptionalTriggerPlacements(game, triggers, mode, continuation);
  }
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "declareOptionalTrigger",
    prompt: `Place ${source.name}'s optional triggered ability on the Chain?`,
    options: [
      { id: "use-optional-trigger", label: "Use triggered ability", cardId: source.instanceId },
      { id: "decline-optional-trigger", label: "Do not place it on the Chain", cardId: null }
    ],
    data: { trigger: optional, triggers, mode, continuation },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  game.currentPlayerId = player.id;
  log(game, `${player.name} chooses whether to place ${source.name}'s optional trigger on the Chain.`);
  return true;
}

function prepareAndQueueTriggers(game, triggers, mode = "queue", continuation = null) {
  if (!triggers.length) {
    if (continuation) runTriggerContinuation(game, continuation);
    return false;
  }
  if (game.inCleanup) {
    game.cleanupPendingTriggerBatches ||= [];
    game.cleanupPendingTriggerBatches.push({ triggers, mode, continuation });
    return true;
  }
  if (game.resolvingGameEffect) {
    const normalized = triggers.map((trigger) => {
      trigger.id ||= `trigger-${Date.now()}-${Math.random()}`;
      return trigger;
    });
    const pendingMode = game.resolvingGameEffect.chainKind === "showdown"
      ? "showdownChain"
      : game.resolvingGameEffect.chainKind === "action"
        ? "actionChain"
        : mode;
    ensurePendingTriggerChainItems(game,
      normalized.filter((trigger) => !triggerPlacementIsOptional(trigger)), pendingMode, continuation);
    game.resolvingGameEffect.pendingTriggerBatches.push({
      triggers: normalized,
      mode,
      continuation
    });
    return true;
  }
  const normalized = triggers.map((trigger) => {
    trigger.id ||= `trigger-${Date.now()}-${Math.random()}`;
    return trigger;
  });
  if (prepareOptionalTriggerPlacements(game, normalized, mode, continuation)) return true;
  const active = normalized.filter((trigger) => !trigger.declined);
  if (!active.length) {
    if (continuation) return runTriggerContinuation(game, continuation);
    return false;
  }
  const groups = triggerResolutionGroups(game, active);
  if (game.interactive && groups.some((group) => group.triggers.length > 1)) {
    return continueTriggerOrderChoice(game, {
      groups,
      groupIndex: 0,
      mode,
      continuation
    });
  }
  return prepareTriggerDeclarations(game, [...groups].reverse().flatMap((group) => group.triggers), mode, continuation);
}

function triggerResolutionGroups(game, triggers) {
  const startPlayerId = game.showdown?.turnPlayerId || game.actionChain?.turnPlayerId || game.currentPlayerId;
  const placementOrder = turnOrderFrom(game, startPlayerId).map((player) => player.id);
  const batches = new Map();
  for (const trigger of triggers) {
    const batchId = trigger.simultaneousBatchId || "single-trigger-event";
    if (!batches.has(batchId)) batches.set(batchId, new Map());
    const byPlayer = batches.get(batchId);
    if (!byPlayer.has(trigger.playerId)) byPlayer.set(trigger.playerId, []);
    byPlayer.get(trigger.playerId).push(trigger);
  }
  return [...batches.values()].flatMap((byPlayer) => {
    const playerOrder = [...placementOrder];
    for (const playerId of byPlayer.keys()) if (!playerOrder.includes(playerId)) playerOrder.push(playerId);
    return playerOrder
      .filter((playerId) => byPlayer.has(playerId))
      .map((playerId) => ({ playerId, triggers: byPlayer.get(playerId), orderedTriggers: [] }));
  });
}

function flattenTriggerBatches(batches) {
  return batches.flatMap((batch, batchIndex) => (batch.triggers || []).map((trigger) => {
    trigger.simultaneousBatchId ||= `trigger-event-${batchIndex}`;
    return trigger;
  }));
}

function combineTriggerContinuations(batches) {
  const continuations = batches.map((batch) => batch.continuation).filter(Boolean);
  if (continuations.length <= 1) return continuations[0] || null;
  return { kind: "triggerContinuationSequence", continuations };
}

function continueTriggerOrderChoice(game, state) {
  while (state.groupIndex < state.groups.length) {
    const group = state.groups[state.groupIndex];
    if (group.triggers.length === 1) {
      group.orderedTriggers.push(group.triggers.shift());
      state.groupIndex += 1;
      continue;
    }
    if (!group.triggers.length) {
      state.groupIndex += 1;
      continue;
    }
    const player = game.players.find((candidate) => candidate.id === group.playerId);
    const source = findCard(game, group.triggers[0].sourceCardId)
      || group.triggers[0].sourceCardSnapshot
      || { name: "Triggered Abilities" };
    game.currentPlayerId = group.playerId;
    game.pendingChoice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: group.playerId,
      card: source,
      effect: "triggerOrder",
      prompt: "Choose which of your simultaneous triggered abilities resolves first.",
      options: group.triggers.map((trigger) => {
        const triggerSource = findCard(game, trigger.sourceCardId) || trigger.sourceCardSnapshot;
        const effectKinds = (trigger.data?.specs || []).map((spec) => spec.kind).filter(Boolean);
        const displayKind = effectKinds.length ? effectKinds.join(", ") : trigger.kind;
        return {
          id: trigger.id,
          label: `${triggerSource?.name || displayKind}: ${displayKind}`,
          cardId: trigger.sourceCardId || null,
          effectKind: displayKind
        };
      }),
      data: { triggerOrderState: state, continuation: state.continuation || null },
      finishSpell: false,
      optional: false,
      fromShowdownChain: false
    };
    log(game, `${player?.name || "A player"} orders simultaneous triggered abilities.`);
    return true;
  }
  const resolutionOrder = [...state.groups].reverse().flatMap((group) => group.orderedTriggers);
  return prepareTriggerDeclarations(game, resolutionOrder, state.mode, state.continuation);
}

function resolveTriggerOrderChoice({ game, choice, option }) {
  const state = choice.data?.triggerOrderState;
  const group = state?.groups?.[state.groupIndex];
  if (!state || !group) return;
  const index = group.triggers.findIndex((trigger) => trigger.id === option.id);
  if (index < 0) return;
  group.orderedTriggers.push(group.triggers.splice(index, 1)[0]);
  continueTriggerOrderChoice(game, state);
}

function resolveCleanupFacedownOverflowChoice({ game, choice, option }) {
  const battlefield = game.battlefields.find((field) => field.instanceId === choice.data?.battlefieldId);
  if (!battlefield) return;
  const index = (battlefield.hidden || []).findIndex((item) => item.card?.instanceId === option.cardId);
  if (index < 0) return;
  const [removed] = battlefield.hidden.splice(index, 1);
  trashFacedownCard(game, battlefield, removed, "because the Facedown Zone is over capacity");
  const remaining = Math.max(0, (choice.data?.remaining || 1) - 1);
  if (remaining > 0) promptFacedownOverflowChoice(game, battlefield, remaining);
}

function pendingTriggerChainItem(game, trigger) {
  if (!trigger?.pendingChainItemId) return null;
  return [
    ...(game.showdown ? normalizeChainItems(game.showdown) : []),
    ...(game.actionChain ? normalizeActionChainItems(game.actionChain) : [])
  ].find((item) => item.id === trigger.pendingChainItemId && item.trigger === trigger) || null;
}

function orderPendingTriggerChainItems(game, triggers, mode) {
  const chainState = mode === "showdownChain" ? game.showdown : mode === "actionChain" ? game.actionChain : null;
  if (!chainState) return false;
  const chain = mode === "showdownChain" ? normalizeChainItems(chainState) : normalizeActionChainItems(chainState);
  const items = triggers.map((trigger) => pendingTriggerChainItem(game, trigger));
  if (items.some((item) => !item)) return false;
  const itemSet = new Set(items);
  const indices = chain.map((item, index) => itemSet.has(item) ? index : -1).filter((index) => index >= 0);
  if (!indices.length) return false;
  const insertionIndex = Math.min(...indices);
  for (const index of [...indices].sort((left, right) => right - left)) chain.splice(index, 1);
  chain.splice(insertionIndex, 0, ...[...items].reverse());
  resetChainPassCycle(chainState);
  return true;
}

function ensurePendingTriggerChainItems(game, triggers, mode, continuation = null) {
  const missing = triggers.filter((trigger) => !pendingTriggerChainItem(game, trigger));
  if (mode === "showdownChain" && game.phase === "showdown" && game.showdown) {
    if (missing.length) addPendingTriggerChainItems(game, [...missing].reverse());
    orderPendingTriggerChainItems(game, triggers, mode);
    return true;
  }
  if (mode === "actionChain" && game.phase === "action" && game.interactive) {
    for (const trigger of [...missing].reverse()) addPendingActionTriggerChainItem(game, trigger);
    ownActionChainContinuation(game, continuation);
    orderPendingTriggerChainItems(game, triggers, mode);
    return true;
  }
  return false;
}

function removePendingTriggerChainItem(game, trigger) {
  const item = pendingTriggerChainItem(game, trigger);
  if (!item) return false;
  const chainState = game.showdown?.chain?.includes(item) ? game.showdown : game.actionChain;
  const index = chainState?.chain?.indexOf(item) ?? -1;
  if (index >= 0) {
    chainState.chain.splice(index, 1);
    requestCleanup(game, "chain-item-removed", { itemId: item.id, reason: "trigger-declined" });
  }
  trigger.status = "removed";
  delete trigger.pendingChainItemId;
  return index >= 0;
}

function completePendingTriggerDeclarations(game, trigger) {
  const item = pendingTriggerChainItem(game, trigger);
  if (!item) return false;
  item.playOptions ||= {};
  item.playOptions.declarationsComplete = true;
  return true;
}

function prepareTriggerDeclarations(game, triggers, mode = "queue", continuation = null) {
  ensurePendingTriggerChainItems(game, triggers, mode, continuation);
  const remaining = triggers.filter((trigger) => {
    if (!triggerNeedsTargetDeclaration(trigger)) return true;
    if ((trigger.data?.declaredTargets || []).length) return true;
    if (triggerDeclaration(game, trigger)) return true;
    const source = findCard(game, trigger.sourceCardId);
    trigger.declined = true;
    removePendingTriggerChainItem(game, trigger);
    log(game, `${source?.name || "A triggered effect"} has no legal target and does not trigger.`);
    return false;
  });
  if (!game.interactive) {
    for (const trigger of remaining) {
      let declaration = triggerDeclaration(game, trigger);
      let guard = 0;
      while (declaration && guard < 50) {
        const option = [...(declaration.options || [])]
          .filter((candidate) => candidate.cardId)
          .sort((left, right) => (right.amount || 0) - (left.amount || 0))[0];
        if (!option) {
          trigger.declined = Boolean(declaration.optional);
          trigger.data ||= {};
          trigger.data.declarationComplete = true;
          if (trigger.declined) removePendingTriggerChainItem(game, trigger);
          break;
        }
        trigger.data ||= {};
        trigger.data.declaredTargets = [
          ...(trigger.data.declaredTargets || []),
          {
            effect: declaration.effect,
            targetId: option.cardId,
            ...(option.amount == null ? {} : { amount: option.amount })
          }
        ];
        recordTriggerTargetIdentity(trigger, declaration.effect, option);
        declaration = triggerDeclaration(game, trigger);
        guard += 1;
      }
    }
  }
  if (game.interactive) {
    const nextIndex = remaining.findIndex((trigger) => triggerDeclaration(game, trigger));
    if (nextIndex >= 0) {
      const [trigger] = remaining.splice(nextIndex, 1);
      promptTriggerDeclaration(game, trigger, remaining, mode, continuation);
      return true;
    }
  }
  return prepareTriggerCosts(game, remaining, mode, continuation);
}

const TRIGGER_RULE_EFFECTS = new Map([
  ["attackOrDefendPlayHiddenFromHand", { timing: "attackOrDefend", kind: "playHiddenFromHand" }],
  ["cardPlayedExhaustSelfChannelOnMightyUnit", { timing: "cardPlayed", kind: "exhaustSelfChannelOnMightyUnit" }],
  ["conquerDiscardReturnSelfFromTrash", { timing: "battlefieldControl", kind: "discardReturnSelfFromTrash" }],
  ["conquerHereSpendBuffDraw", { timing: "conquerHere", kind: "spendBuffDraw" }],
  ["enemyKilledStunnedDraw", { timing: "enemyKilled", kind: "drawIfStunned" }],
  ["recycleBuffFriendlyUnit", { timing: "recycle", kind: "buffFriendlyUnit" }],
  ["buffFriendlyUnitPayExhaustReady", { timing: "static", kind: "buffFriendlyUnitPayExhaustReady" }],
  ["showdownBeginsPayEnergyPredictDrawSpell", { timing: "showdownBeginsHere", kind: "payEnergyPredictDrawSpell" }],
  ["scoreSwapBackReplacedBattlefield", { timing: "score", kind: "swapBackReplacedBattlefield" }]
]);

function triggerRuleEffect(trigger) {
  const spec = trigger.data?.specs?.[0];
  if (spec) return spec;
  if (trigger.kind === "playSelfFromTrashPayPower") {
    return trigger.data?.killedUnitId
      ? { timing: "static", kind: "playSelfFromTrashWhenSpellKillsUnit", domain: trigger.data?.domain || "Any" }
      : { timing: "discarded", kind: "playSelfFromTrashPayPower", domain: trigger.data?.domain || "Any" };
  }
  const mapped = TRIGGER_RULE_EFFECTS.get(trigger.kind);
  return mapped ? { ...mapped, ...(trigger.data || {}) } : null;
}

function triggerCostDescriptor(trigger) {
  const effect = triggerRuleEffect(trigger);
  const definition = effectDefinition(effect);
  return definition?.triggerCost ? { ...definition.triggerCost, effect } : null;
}

function friendlyBuffCostOptions(game, player) {
  return allUnits(game)
    .filter((unit) => unit.controllerId === player.id && (unit.buffs || 0) > 0)
    .map(cardOption);
}

function hiddenCardTriggerCostOptions(game, player) {
  return player.hand
    .filter((card) => hasKeyword(card, "Hidden", game) || card.tags?.includes("Hidden"))
    .map(cardOption);
}

function triggerCostCanBePaid(game, trigger, player, source, descriptor) {
  const amount = descriptor.effect?.amount || trigger.data?.amount || 1;
  const domain = descriptor.effect?.domain || trigger.data?.domain || "Any";
  if (!game.interactive && ["energy"].includes(descriptor.kind)
    && !payEnergyIfPossible(game, player, amount, true)) return false;
  if (!game.interactive && ["power", "powerAndExhaustSource"].includes(descriptor.kind)
    && !payAdditionalPower(game, player, { domain, amount: 1 }, true)) return false;
  if (["exhaustSource", "powerAndExhaustSource"].includes(descriptor.kind) && source.exhausted) return false;
  if (descriptor.kind === "discardCard" && !player.hand.length) return false;
  if (descriptor.kind === "spendFriendlyBuff" && !friendlyBuffCostOptions(game, player).length) return false;
  if (descriptor.choose === "hiddenCard" && !hiddenCardTriggerCostOptions(game, player).length) return false;
  return true;
}

function markTriggerCostPaid(trigger, descriptor, selectionId = null) {
  trigger.data ||= {};
  trigger.data.triggerCostComplete = true;
  trigger.data.triggerCostPaid = true;
  if (selectionId) trigger.data.triggerCostSelectionId = selectionId;
  if (trigger.data.specs?.[0]) {
    trigger.data.specs[0] = {
      ...trigger.data.specs[0],
      triggerCostPaid: true,
      ...(selectionId ? { triggerCostSelectionId: selectionId } : {})
    };
  }
}

function declineTriggerCost(trigger) {
  trigger.declined = true;
  trigger.data ||= {};
  trigger.data.triggerCostComplete = true;
}

function payAutomaticTriggerResourceCost(game, trigger, player, descriptor) {
  const amount = descriptor.effect?.amount || trigger.data?.amount || 1;
  const domain = descriptor.effect?.domain || trigger.data?.domain || "Any";
  if (descriptor.kind === "energy") return payEnergyIfPossible(game, player, amount);
  if (["power", "powerAndExhaustSource"].includes(descriptor.kind)) {
    return payAdditionalPower(game, player, { domain, amount: 1 });
  }
  return true;
}

function payTriggerNonResourceCost(game, trigger, player, source, descriptor, selectionId = null) {
  if (["exhaustSource", "powerAndExhaustSource"].includes(descriptor.kind)) {
    if (source.exhausted) return false;
    exhaustCards(game, player, source, [source], { reason: "trigger-cost", cost: true });
  }
  if (descriptor.kind === "discardCard") {
    const discarded = player.hand.find((card) => card.instanceId === selectionId);
    if (!discarded) return false;
    discardCardsFromHand(game, player, [discarded], source);
    triggerDiscardEffects(game, player, [discarded], source);
    log(game, `${player.name} discards ${discarded.name} to finalize ${source.name}'s triggered ability.`);
  }
  if (descriptor.kind === "spendFriendlyBuff") {
    const unit = findCard(game, selectionId);
    if (!unit || unit.controllerId !== player.id || (unit.buffs || 0) <= 0) return false;
    unit.buffs -= 1;
  }
  return true;
}

function triggerCostChoice(game, trigger, player, source, descriptor, triggers, mode, continuation) {
  let options;
  let prompt;
  if (descriptor.choose === "hiddenCard" && !trigger.data?.triggerCostSelectionId) {
    options = hiddenCardTriggerCostOptions(game, player);
    prompt = `Choose the Hidden card for ${source.name} before paying its triggered ability cost.`;
  } else if (descriptor.kind === "discardCard") {
    options = player.hand.map(cardOption);
    prompt = `Choose a card to discard to finalize ${source.name}'s triggered ability.`;
  } else if (descriptor.kind === "spendFriendlyBuff") {
    options = friendlyBuffCostOptions(game, player);
    prompt = `Choose a friendly Buff to spend to finalize ${source.name}'s triggered ability.`;
  } else {
    options = [{ id: "pay-trigger-cost", label: `Pay ${source.name}'s triggered ability cost`, cardId: source.instanceId }];
    prompt = `Pay the cost to finalize ${source.name}'s triggered ability?`;
  }
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "declareTriggerCost",
    prompt,
    options: [...options, { id: "decline-trigger-cost", label: "Decline", cardId: null }],
    data: { trigger, triggers, mode, continuation, descriptor },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  game.currentPlayerId = player.id;
  return true;
}

function prepareTriggerCosts(game, triggers, mode = "queue", continuation = null) {
  const active = triggers.filter((trigger) => !trigger.declined);
  for (const trigger of active) {
    if (trigger.data?.triggerCostComplete) continue;
    const descriptor = triggerCostDescriptor(trigger);
    if (!descriptor) {
      trigger.data ||= {};
      trigger.data.triggerCostComplete = true;
      continue;
    }
    const player = game.players.find((candidate) => candidate.id === trigger.playerId);
    const source = findCard(game, trigger.sourceCardId) || trigger.sourceCardSnapshot;
    if (!player || !source || !triggerCostCanBePaid(game, trigger, player, source, descriptor)) {
      declineTriggerCost(trigger);
      removePendingTriggerChainItem(game, trigger);
      log(game, `${source?.name || "A triggered ability"} cannot pay its cost and is removed while Pending.`);
      continue;
    }
    if (game.interactive) {
      if (descriptor.choose === "hiddenCard" && !trigger.data?.triggerCostSelectionId) {
        return triggerCostChoice(game, trigger, player, source, descriptor, active, mode, continuation);
      }
      if (["energy", "power", "powerAndExhaustSource"].includes(descriptor.kind)) {
        game.pendingPayment = createTriggeredAbilityPayment(game, player, source, trigger, descriptor, active, mode, continuation);
        game.selectedCardId = source.instanceId;
        game.currentPlayerId = player.id;
        log(game, `${player.name} is paying to finalize ${source.name}'s triggered ability.`);
        return true;
      }
      return triggerCostChoice(game, trigger, player, source, descriptor, active, mode, continuation);
    }
    const selectionId = descriptor.choose === "hiddenCard"
      ? hiddenCardTriggerCostOptions(game, player)[0]?.cardId
      : descriptor.kind === "discardCard"
        ? player.hand[0]?.instanceId
        : descriptor.kind === "spendFriendlyBuff"
          ? friendlyBuffCostOptions(game, player)[0]?.cardId
          : null;
    if (!payAutomaticTriggerResourceCost(game, trigger, player, descriptor)
      || !payTriggerNonResourceCost(game, trigger, player, source, descriptor, selectionId)) {
      declineTriggerCost(trigger);
      removePendingTriggerChainItem(game, trigger);
      continue;
    }
    markTriggerCostPaid(trigger, descriptor, selectionId);
  }
  return queuePreparedTriggers(game, active.filter((trigger) => !trigger.declined), mode, continuation);
}

const TARGETED_TRIGGER_KINDS = new Set([
  "battlefieldSpellBuff",
  "secondDrawBuff",
  "defendHereGiveShield",
  "defendHereReturnFriendlyUnitToBase",
  "stunBuffFriendlyUnit",
  "recycleBuffFriendlyUnit",
  "holdBuffUnitHere",
  "attackOrDefendSplitDamageEnemyHere",
  "attackOrDefendDamageEnemyHere",
  "attackOrDefendDamageEnemyByHiddenTopDeck",
  "attackOrDefendModifyEnemyHere",
  "attackOrDefendStunEnemyHere",
  "reflexiveDragonsRageDuel",
  "reflexiveRuneGambit"
]);

const TARGETED_EFFECT_KINDS = new Set([
  "quickDrawAttach",
  "weaponmaster",
  "killGear",
  "readyUnit",
  "modifyMight",
  "buffUnit",
  "stunUnit",
  "dealDamageUnit",
  "killUnit",
  "returnUnitToBase",
  "returnBattlefieldUnitToHand",
  "stealEnemyGear",
  "swapWithControlledUnit",
  "moveEnemyToThisBattlefield",
  "playSpellFromTrashMaxEnergy"
]);

function triggerNeedsTargetDeclaration(trigger) {
  if (TARGETED_TRIGGER_KINDS.has(trigger.kind)) return true;
  const spec = trigger.data?.specs?.[0];
  return Boolean(spec && TARGETED_EFFECT_KINDS.has(spec.kind));
}

function queuePreparedTriggers(game, triggers, mode = "queue", continuation = null) {
  const active = triggers.filter((trigger) => !trigger.declined);
  if (!active.length) {
    if (mode === "actionChain" && game.actionChain && normalizeActionChainItems(game.actionChain).length === 0) {
      finishActionChain(game);
      return true;
    }
    if (mode === "showdownChain" && game.showdown && normalizeChainItems(game.showdown).length === 0) {
      delete game.showdown.suppressFocusPassOnEmpty;
      delete game.showdown.chainOpenedBy;
    }
    if (continuation) return runTriggerContinuation(game, continuation);
    return false;
  }
  if (mode === "showdownChain" && game.phase === "showdown" && game.showdown) {
    const missing = active.filter((trigger) => !pendingTriggerChainItem(game, trigger));
    if (missing.length) addPendingTriggerChainItems(game, [...missing].reverse());
    for (const trigger of active) completePendingTriggerDeclarations(game, trigger);
    checkState(game);
    return true;
  }
  if (mode === "actionChain" && game.phase === "action" && game.interactive) {
    const missing = active.filter((trigger) => !pendingTriggerChainItem(game, trigger));
    if (missing.length) {
      for (const trigger of [...missing].reverse()) addPendingActionTriggerChainItem(game, trigger);
    }
    ownActionChainContinuation(game, continuation);
    for (const trigger of active) completePendingTriggerDeclarations(game, trigger);
    checkState(game);
    maybeAutoPassActionChain(game);
    return true;
  }
  enqueueTriggers(game, active, continuation);
  resolveTriggerQueue(game);
  return true;
}

function promptTriggerDeclaration(game, trigger, remaining, mode, continuation) {
  const declaration = triggerDeclaration(game, trigger);
  const player = game.players.find((candidate) => candidate.id === trigger.playerId);
  const source = findCard(game, trigger.sourceCardId) || trigger.sourceCardSnapshot;
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: trigger.playerId,
    card: source,
    effect: declaration.effect,
    prompt: `Declare this target before ${source?.name || "this trigger"} finalizes.`,
    options: declaration.options,
    data: {
      declareTrigger: true,
      trigger,
      remainingTriggers: remaining,
      mode,
      continuation,
      targetEffect: declaration.effect
    },
    finishSpell: false,
    optional: declaration.optional,
    fromShowdownChain: false
  };
  game.selectedCardId = source?.instanceId || null;
  log(game, `${player?.name || "A player"} declares ${source?.name || "a trigger"} before it finalizes.`);
}

function triggerDeclaration(game, trigger) {
  const player = game.players.find((candidate) => candidate.id === trigger.playerId);
  const source = findCard(game, trigger.sourceCardId) || trigger.sourceCardSnapshot;
  const spec = trigger.data?.specs?.[0];
  if (!player || !source || trigger.declined) return null;
  if (trigger.data?.declarationComplete) return null;
  const declaredCount = (effect) => (trigger.data?.declaredTargets || []).filter((target) => target.effect === effect).length;
  const alreadyDeclared = (effect, count = 1) => declaredCount(effect) >= count;
  const excludeDeclared = (effect, options) => {
    const ids = new Set((trigger.data?.declaredTargets || [])
      .filter((target) => target.effect === effect)
      .map((target) => target.targetId));
    return options.filter((option) => !ids.has(option.cardId));
  };
  if (trigger.kind === "battlefieldSpellBuff") {
    if (alreadyDeclared("battlefieldSpellBuff")) return null;
    const options = (trigger.data?.targetIds || [])
      .map((id) => findCard(game, id))
      .filter((unit) => unit?.type === "unit" && findUnitLocation(game, unit.instanceId)?.type === "battlefield")
      .map(cardOption);
    const declaration = {
      effect: "battlefieldSpellBuff",
      optional: Boolean(trigger.data?.optional),
      options: [
        ...options,
        ...(trigger.data?.optional ? [{ id: "decline", label: "Do not use this effect" }] : [])
      ]
    };
    return declaration.options.length ? declaration : null;
  }
  if (trigger.kind === "secondDrawBuff") {
    if (alreadyDeclared("secondDrawBuff")) return null;
    const options = (trigger.data?.targetIds || [])
      .map((id) => findCard(game, id))
      .filter((unit) => unit?.type === "unit" && unit.controllerId === player.id && Boolean(findUnitLocation(game, unit.instanceId)))
      .map(cardOption);
    const declaration = {
      effect: "secondDrawBuff",
      optional: false,
      options
    };
    return declaration.options.length ? declaration : null;
  }
  if (trigger.kind === "defendHereGiveShield") {
    if (alreadyDeclared("giveKeyword")) return null;
    const options = (trigger.data?.targetIds || [])
      .map((id) => findCard(game, id))
      .filter((unit) => unit?.type === "unit" && findUnitLocation(game, unit.instanceId)?.type === "battlefield")
      .filter((unit) => canChooseUnit(game, player, source, unit))
      .map(cardOption);
    const declaration = {
      effect: "giveKeyword",
      optional: false,
      options
    };
    return declaration.options.length ? declaration : null;
  }
  if (trigger.kind === "defendHereReturnFriendlyUnitToBase") {
    if (alreadyDeclared("returnUnitToBase")) return null;
    const options = (trigger.data?.targetIds || [])
      .map((id) => findCard(game, id))
      .filter((unit) => unit?.type === "unit" && unit.controllerId === player.id)
      .filter((unit) => findUnitLocation(game, unit.instanceId)?.battlefield?.instanceId === source.instanceId)
      .filter((unit) => canChooseUnit(game, player, source, unit))
      .map(cardOption);
    const declaration = {
      effect: "returnUnitToBase",
      optional: Boolean(trigger.data?.optional),
      options: [
        ...options,
        ...(trigger.data?.optional ? [{ id: "decline", label: "Do not use this effect" }] : [])
      ]
    };
    return declaration.options.length ? declaration : null;
  }
  if (["stunBuffFriendlyUnit", "recycleBuffFriendlyUnit"].includes(trigger.kind)) {
    if (alreadyDeclared("buffUnit")) return null;
    const options = allUnits(game)
      .filter((unit) => unit.controllerId === player.id)
      .filter((unit) => canChooseUnit(game, player, source, unit))
      .map(cardOption);
    const declaration = {
      effect: "buffUnit",
      optional: false,
      options
    };
    return declaration.options.length ? declaration : null;
  }
  if (trigger.kind === "holdBuffUnitHere") {
    if (alreadyDeclared("buffUnit")) return null;
    const field = game.battlefields.find((battlefield) => battlefield.instanceId === trigger.data?.battlefieldId);
    const options = (field?.units || [])
      .filter((unit) => canChooseUnit(game, player, source, unit))
      .map(cardOption);
    const declaration = {
      effect: "buffUnit",
      optional: false,
      options
    };
    return declaration.options.length ? declaration : null;
  }
  if (trigger.kind === "reflexiveDragonsRageDuel") {
    if (alreadyDeclared("dragonsRageEnemy")) return null;
    const moved = findCard(game, trigger.data?.movedUnitId);
    const location = moved ? findUnitLocation(game, moved.instanceId) : null;
    const destinationUnits = location?.type === "battlefield"
      ? location.battlefield.units
      : location?.player?.base || [];
    const options = destinationUnits
      .filter((unit) => unit.type === "unit" && unit.controllerId !== player.id && unit.instanceId !== moved?.instanceId)
      .filter((unit) => canChooseUnit(game, player, source, unit))
      .map(cardOption);
    return options.length ? { effect: "dragonsRageEnemy", optional: false, options } : null;
  }
  if (trigger.kind === "reflexiveRuneGambit") {
    const effect = trigger.data?.domain === "Fury" ? "runeDeckGambitFuryDamage" : "stunUnit";
    if (alreadyDeclared(effect)) return null;
    const battlefield = game.battlefields.find((field) => field.instanceId === trigger.data?.battlefieldId);
    const candidates = trigger.data?.domain === "Fury" ? (battlefield?.units || []) : allUnits(game);
    const options = candidates
      .filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit))
      .map(cardOption);
    return options.length ? { effect, optional: false, options } : null;
  }
  const combatTargetEffects = {
    attackOrDefendDamageEnemyHere: "damageUnit",
    attackOrDefendDamageEnemyByHiddenTopDeck: "damageUnit",
    attackOrDefendModifyEnemyHere: "modifyMight",
    attackOrDefendStunEnemyHere: "stunUnit"
  };
  if (trigger.kind === "attackOrDefendSplitDamageEnemyHere") {
    const effect = "splitDamageEnemyHere";
    const declaredIds = new Set((trigger.data?.declaredTargets || [])
      .filter((target) => target.effect === effect)
      .map((target) => target.targetId));
    const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
    const candidates = (battlefield?.units || [])
      .filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit))
    const targetLimit = splitDamageAvailableAmount(game, player, source, {
      amount: trigger.data?.amount || 5,
      damageSourceUnitId: source.instanceId,
      damageOrigin: "ability",
      sourceBattlefieldId: battlefield?.instanceId || null
    }, candidates[0]);
    if (declaredIds.size >= targetLimit) return null;
    const options = candidates
      .filter((unit) => !declaredIds.has(unit.instanceId))
      .map(cardOption);
    if (declaredIds.size) options.push({ id: "finish-split-targets", label: "Finish choosing split-damage targets", cardId: null });
    return options.length ? { effect, optional: false, options } : null;
  }
  if (combatTargetEffects[trigger.kind]) {
    const effect = combatTargetEffects[trigger.kind];
    if (alreadyDeclared(effect)) return null;
    const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
    const declaration = {
      effect,
      optional: false,
      options: (battlefield?.units || [])
        .filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit))
        .map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (!spec) return null;
  if (spec.kind === "weaponmaster") {
    if (alreadyDeclared("weaponmasterEquipment")) return null;
    const declaration = {
      effect: "weaponmasterEquipment",
      optional: true,
      options: allGear(game)
        .filter((gear) => gear.controllerId === player.id && gear.tags?.includes("Equipment"))
        .map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "quickDrawAttach") {
    if (alreadyDeclared("quickDrawAttach")) return null;
    const declaration = {
      effect: "quickDrawAttach",
      optional: false,
      options: allUnits(game)
        .filter((unit) => unit.controllerId === player.id)
        .map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "killGear") {
    if (alreadyDeclared("trashGear")) return null;
    const declaration = {
      effect: "trashGear",
      optional: Boolean(spec.optional),
      options: allGear(game).map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "readyUnit") {
    if (alreadyDeclared("readyUnit", spec.repeat || 1)) return null;
    const declaration = {
      effect: "readyUnit",
      optional: Boolean(spec.optional),
      options: excludeDeclared("readyUnit", allUnits(game)
        .filter((unit) => unit.controllerId === player.id && unit.exhausted && (spec.target !== "anotherUnit" || unit.instanceId !== source.instanceId))
        .map(cardOption))
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "modifyMight") {
    if (alreadyDeclared("modifyMight", spec.repeat || 1)) return null;
    const scope = spec.target === "friendlyUnit" ? "friendly" : "any";
    const declaration = {
      effect: "modifyMight",
      optional: Boolean(spec.optional),
      options: excludeDeclared("modifyMight", allUnits(game)
        .filter((unit) => scope !== "friendly" || unit.controllerId === player.id)
        .filter((unit) => canChooseUnit(game, player, source, unit))
        .map(cardOption))
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "buffUnit") {
    if (alreadyDeclared("buffUnit", spec.repeat || 1)) return null;
    const scope = ["friendlyUnit", "anotherFriendlyUnit"].includes(spec.target) ? "friendly" : "any";
    const declaration = {
      effect: "buffUnit",
      optional: Boolean(spec.optional),
      options: excludeDeclared("buffUnit", allUnits(game)
        .filter((unit) => scope !== "friendly" || unit.controllerId === player.id)
        .filter((unit) => spec.target !== "anotherFriendlyUnit" || unit.instanceId !== source.instanceId)
        .filter((unit) => canChooseUnit(game, player, source, unit))
        .map(cardOption))
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "stunUnit") {
    if (alreadyDeclared("stunUnit")) return null;
    const scope = spec.target === "unit" ? "any" : "enemy";
    const declaration = {
      effect: "stunUnit",
      optional: Boolean(spec.optional),
      options: targetableUnits(game, player, source, scope).map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "dealDamageUnit") {
    if (alreadyDeclared("damageUnit")) return null;
    const scope = spec.target === "enemyBattlefieldUnit" ? "enemyBattlefield" : spec.target === "enemyUnit" ? "enemy" : spec.target === "friendlyUnit" ? "friendly" : spec.target === "battlefieldUnit" ? "battlefield" : "any";
    const declaration = {
      effect: "damageUnit",
      optional: Boolean(spec.optional),
      options: targetableUnits(game, player, source, scope).map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "killUnit") {
    if (alreadyDeclared("killUnit")) return null;
    const scope = spec.target === "enemyBattlefieldUnit" ? "enemyBattlefield" : spec.target === "enemyUnit" ? "enemy" : spec.target === "friendlyUnit" ? "friendly" : spec.target === "battlefieldUnit" ? "battlefield" : "any";
    const declaration = {
      effect: "killUnit",
      optional: Boolean(spec.optional),
      options: targetableUnits(game, player, source, scope).map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "returnUnitToBase") {
    if (alreadyDeclared("returnUnitToBase")) return null;
    const scope = spec.target || "battlefield";
    const declaration = {
      effect: "returnUnitToBase",
      optional: Boolean(spec.optional),
      options: battlefieldUnitTargets(game, player, scope)
        .filter((sourceInfo) => canChooseUnit(game, player, source, sourceInfo.unit))
        .map((sourceInfo) => cardOption(sourceInfo.unit))
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "returnBattlefieldUnitToHand") {
    if (alreadyDeclared("returnUnitToHand")) return null;
    const declaration = {
      effect: "returnUnitToHand",
      optional: Boolean(spec.optional),
      options: battlefieldUnitTargets(game, player, "battlefield")
        .filter((sourceInfo) => sourceInfo.unit.instanceId !== source.instanceId)
        .filter((sourceInfo) => canChooseUnit(game, player, source, sourceInfo.unit))
        .map((sourceInfo) => cardOption(sourceInfo.unit))
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "stealEnemyGear") {
    if (alreadyDeclared("stealEnemyGear")) return null;
    const declaration = {
      effect: "stealEnemyGear",
      optional: Boolean(spec.optional),
      options: allGear(game)
        .filter((gear) => gear.controllerId !== player.id)
        .map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "swapWithControlledUnit") {
    if (alreadyDeclared("tideturnerSwap")) return null;
    const declaration = {
      effect: "tideturnerSwap",
      optional: Boolean(spec.optional),
      options: allUnits(game)
        .filter((unit) => unit.controllerId === player.id && unit.instanceId !== source.instanceId)
        .map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "moveEnemyToThisBattlefield") {
    if (alreadyDeclared("moveUnitToSourceBattlefield")) return null;
    const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
    const declaration = {
      effect: "moveUnitToSourceBattlefield",
      optional: Boolean(spec.optional),
      options: allUnits(game)
        .filter((unit) => unit.controllerId !== player.id)
        .filter((unit) => !battlefield?.units.some((candidate) => candidate.instanceId === unit.instanceId))
        .filter((unit) => canChooseUnit(game, player, source, unit))
        .map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.kind === "playSpellFromTrashMaxEnergy") {
    if (alreadyDeclared("playTrashSpell")) return null;
    const maxEnergy = trashSpellMaxEnergy(player, spec);
    const declaration = {
      effect: "playTrashSpell",
      optional: Boolean(spec.optional),
      options: player.trash
        .filter((candidate) => candidate.type === "spell" && (maxEnergy == null || (candidate.energy || 0) <= maxEnergy))
        .filter((candidate) => payPowerRequirements(game, player, normalizeCardPowerRequirements(candidate, candidate.power || []), true))
        .map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  // An optional triggered ability has already made its rule 383.3.a
  // placement decision before it becomes Pending. `optional` still describes
  // resolution-time choices for mandatory triggers, but must not create a
  // second use/decline declaration for an ability that was explicitly placed.
  if (spec.optional && !effectDefinition(spec)?.optionalTrigger) {
    return {
      effect: "declareTriggerUse",
      optional: false,
      options: [
        { id: "use-trigger", label: "Use this effect" },
        { id: "decline", label: "Do not use this effect" }
      ]
    };
  }
  return null;
}

function enqueueTriggers(game, triggers, continuation = null) {
  game.triggerQueue.push(...triggers.map((trigger) => ({
    id: `trigger-${Date.now()}-${Math.random()}`,
    status: "pending",
    ...trigger
  })));
  if (continuation) game.triggerQueueContinuation = continuation;
}

function resolveTriggerQueue(game) {
  while (!game.pendingChoice && game.triggerQueue.length) {
    const trigger = game.triggerQueue[0];
    finalizePendingTrigger(game, trigger);
    game.triggerQueue.shift();
    resolveQueuedTrigger(game, trigger);
  }
  if (game.pendingChoice || game.triggerQueue.length) return true;
  const continuation = game.triggerQueueContinuation;
  game.triggerQueueContinuation = null;
  if (!continuation) return false;
  return runTriggerContinuation(game, continuation);
}

function runTriggerContinuation(game, continuation) {
  if (continuation.kind === "triggerContinuationSequence") {
    game.deferredTriggerContinuations = [
      ...(continuation.continuations || []),
      ...(game.deferredTriggerContinuations || [])
    ];
    return continueDeferredTriggerContinuations(game);
  }
  if (continuation.kind === "finishEndTurn") {
    if (game.pendingEndTurnPlayerId === continuation.playerId) finishPendingEndTurn(game);
    return true;
  }
  if (continuation.kind === "continueStartTurn") {
    continueStartTurnProcess(game, continuation.playerId);
    return true;
  }
  if (continuation.kind === "continueEndTurn") {
    continueEndTurnProcess(game, continuation.playerId);
    return true;
  }
  if (continuation.kind === "finishHweiDiscard") {
    finishHweiDiscardContinuation(game, continuation);
    return true;
  }
  if (continuation.kind === "finishAfterMove") {
    finishAfterMoveChoice(game, continuation.afterMove);
    return true;
  }
  if (continuation.kind === "resolveSpell") {
    const player = game.players.find((candidate) => candidate.id === continuation.playerId);
    const card = continuation.card;
    if (player && card) resolveSpellEffectOnly(game, player, card);
    return true;
  }
  if (continuation.kind === "resolvePermanentOnPlay") {
    const player = game.players.find((candidate) => candidate.id === continuation.playerId);
    const card = findCard(game, continuation.cardId);
    if (player && card) resolveOnPlayEffect(game, player, card);
    return true;
  }
  return false;
}

function hasPendingResolutionWork(game) {
  return Boolean(
    game.pendingChoice
    || game.pendingPayment
    || game.actionChain
    || game.showdown?.chain?.length
    || game.triggerQueue?.length
    || game.triggerQueueContinuation
  );
}

function continueDeferredTriggerContinuations(game) {
  while (game.deferredTriggerContinuations?.length && !hasPendingResolutionWork(game)) {
    const continuation = game.deferredTriggerContinuations.shift();
    runTriggerContinuation(game, continuation);
  }
  if (!game.deferredTriggerContinuations?.length) delete game.deferredTriggerContinuations;
  return hasPendingResolutionWork(game);
}

function enterGameEffectResolution(game, chainKind = null) {
  if (game.resolvingGameEffect) {
    if (chainKind && !game.resolvingGameEffect.chainKind) game.resolvingGameEffect.chainKind = chainKind;
    return { context: game.resolvingGameEffect, owner: false };
  }
  const context = {
    chainKind,
    pendingTriggerBatches: [],
    finalized: false
  };
  game.resolvingGameEffect = context;
  return { context, owner: true };
}

function leaveGameEffectResolution(game, scope, paused = false, pendingCard = null) {
  if (!scope.owner) return;
  if (game.resolvingGameEffect === scope.context) delete game.resolvingGameEffect;
  if (paused) {
    const pending = game.pendingChoice || game.pendingPayment;
    if (pending) pending.gameEffectResolution = { context: scope.context };
    return;
  }
  if (pendingCard) {
    pendingCard.pendingGameEffectResolution = { context: scope.context };
    return;
  }
  flushGameEffectTriggers(game, scope.context);
  if (!game.pendingChoice && !game.pendingPayment && game.cleanupOutstanding) checkState(game);
}

function flushGameEffectTriggers(game, context) {
  if (!context || context.finalized) return false;
  context.finalized = true;
  const batches = context.pendingTriggerBatches || [];
  if (!batches.length) return false;
  const triggers = flattenTriggerBatches(batches);
  const continuation = combineTriggerContinuations(batches);
  const mode = context.chainKind === "showdown"
    ? "showdownChain"
    : context.chainKind === "action"
      ? "actionChain"
      : batches.some((batch) => batch.mode === "showdownChain")
        ? "showdownChain"
        : batches.some((batch) => batch.mode === "actionChain")
          ? "actionChain"
      : batches.at(-1)?.mode || "queue";
  return prepareAndQueueTriggers(game, triggers, mode, continuation);
}

function finalizePendingTrigger(game, trigger) {
  if (!trigger || trigger.status === "finalized") return;
  trigger.status = "finalized";
  const source = findCard(game, trigger.sourceCardId) || trigger.sourceCardSnapshot;
  log(game, `${source?.name || "A trigger"} trigger finalized.`);
}

const TRIGGER_RESOLVERS = new Map([
  ["beginningKillTemporary", resolveBeginningKillTemporaryTrigger],
  ["onMoveEffect", resolveOnMoveEffectTrigger],
  ["effectSpecs", resolveEffectSpecsTrigger],
  ["reflexiveGameAction", resolveReflexiveGameActionTrigger],
  ["reflexiveDragonsRageDuel", resolveReflexiveDragonsRageDuelTrigger],
  ["reflexiveRuneGambit", resolveReflexiveRuneGambitTrigger],
  ["delayedKillDamagedUnit", resolveDelayedKillDamagedUnitTrigger],
  ["cardPlayedAnotherUnitBuffSelf", resolveCardPlayedAnotherUnitBuffSelfTrigger],
  ["cardPlayedHighCostSpellBuffSelf", resolveCardPlayedHighCostSpellBuffSelfTrigger],
  ["cardPlayedHighCostSpellDraw", resolveCardPlayedHighCostSpellDrawTrigger],
  ["cardPlayedGearReadySelf", resolveCardPlayedGearReadySelfTrigger],
  ["cardPlayedOpponentTurnRecruit", resolveCardPlayedOpponentTurnRecruitTrigger],
  ["cardPlayedSecondCardMightReadySelf", resolveCardPlayedSecondCardMightReadySelfTrigger],
  ["cardPlayedFromHiddenBuffSelf", resolveCardPlayedFromHiddenBuffSelfTrigger],
  ["cardPlayedExhaustSelfChannelOnMightyUnit", resolveCardPlayedExhaustSelfChannelOnMightyUnitTrigger],
  ["deathDraw", resolveDeathDrawTrigger],
  ["deathDrawIfAlone", resolveDeathDrawIfAloneTrigger],
  ["deathChannelRunes", resolveDeathChannelRunesTrigger],
  ["deathDiscardDraw", resolveDeathDiscardDrawTrigger],
  ["deathDealDamageAllHere", resolveDeathDealDamageAllHereTrigger],
  ["deathPlayUnitToken", resolveDeathPlayUnitTokenTrigger],
  ["deathGainXp", resolveDeathGainXpTrigger],
  ["deathRevealOpponentHand", resolveDeathRevealOpponentHandTrigger],
  ["deathRecycleSelfReadyRunes", resolveDeathRecycleSelfReadyRunesTrigger],
  ["deathBuffAnotherFriendlyOnBuffedUnitDeath", resolveDeathBuffAnotherFriendlyOnBuffedUnitDeathTrigger],
  ["discardedDraw", resolveDiscardedDrawTrigger],
  ["playSelfFromTrashPayPower", resolvePlaySelfFromTrashPayPowerTrigger],
  ["discardReadySelfMight", resolveDiscardReadySelfMightTrigger],
  ["scoreBuffSelf", resolveScoreBuffSelfTrigger],
  ["scoreDraw", resolveScoreDrawTrigger],
  ["scoreDrawOrChannelRunes", resolveScoreDrawOrChannelRunesTrigger],
  ["scoreKillGearThenBuffSelf", resolveScoreKillGearThenBuffSelfTrigger],
  ["scoreGainXp", resolveScoreGainXpTrigger],
  ["scoreReturnSelfToHand", resolveScoreReturnSelfToHandTrigger],
  ["scoreSwapBackReplacedBattlefield", resolveScoreSwapBackReplacedBattlefieldTrigger],
  ["holdDraw", resolveHoldDrawTrigger],
  ["holdGainPoint", resolveHoldGainPointTrigger],
  ["holdChannelRunes", resolveHoldChannelRunesTrigger],
  ["holdBuffUnitHere", resolveHoldBuffUnitHereTrigger],
  ["holdReturnChosenChampion", resolveHoldReturnChosenChampionTrigger],
  ["holdPlayUnitToken", resolveHoldPlayUnitTokenTrigger],
  ["holdWinIfFriendlyUnitsAtLeast", resolveHoldWinIfFriendlyUnitsAtLeastTrigger],
  ["holdTriggerConquerAbilitiesHere", resolveHoldTriggerConquerAbilitiesHereTrigger],
  ["conquerHereReadyRunesEndTurn", resolveConquerHereReadyRunesEndTurnTrigger],
  ["conquerHereDiscardDraw", resolveConquerHereDiscardDrawTrigger],
  ["conquerHereRecycleRunes", resolveConquerHereRecycleRunesTrigger],
  ["conquerHereSpendBuffDraw", resolveConquerHereSpendBuffDrawTrigger],
  ["conquerHereRecycleTopDeck", resolveConquerHereRecycleTopDeckTrigger],
  ["conquerDiscardReturnSelfFromTrash", resolveConquerDiscardReturnSelfFromTrashTrigger],
  ["beginningDraw", resolveBeginningDrawTrigger],
  ["beginningRecycleTrash", resolveBeginningRecycleTrashTrigger],
  ["attackOrDefendBuffXp", resolveAttackOrDefendBuffXpTrigger],
  ["attackOrDefendModifySelf", resolveAttackOrDefendModifySelfTrigger],
  ["attackOrDefendModifyUnit", resolveAttackOrDefendModifyUnitTrigger],
  ["attackOrDefendDamageAllEnemiesHere", resolveAttackOrDefendDamageAllEnemiesHereTrigger],
  ["attackOrDefendKillDamagedEnemiesHere", resolveAttackOrDefendKillDamagedEnemiesHereTrigger],
  ["attackOrDefendDamageEnemyHere", resolveAttackOrDefendDamageEnemyHereTrigger],
  ["attackOrDefendSplitDamageEnemyHere", resolveAttackOrDefendSplitDamageEnemyHereTrigger],
  ["attackOrDefendDamageEnemyByHiddenTopDeck", resolveAttackOrDefendDamageEnemyByHiddenTopDeckTrigger],
  ["attackOrDefendModifyEnemyHere", resolveAttackOrDefendModifyEnemyHereTrigger],
  ["attackOrDefendStunEnemyHere", resolveAttackOrDefendStunEnemyHereTrigger],
  ["attackOrDefendPlayHiddenFromHand", resolveAttackOrDefendPlayHiddenFromHandTrigger],
  ["attackOrDefendRuneDeckGambit", resolveAttackOrDefendRuneDeckGambitTrigger],
  ["readyFriendlyUnitMight", resolveReadyFriendlyUnitMightTrigger],
  ["buffFriendlyUnitPayExhaustReady", resolveBuffFriendlyUnitPayExhaustReadyTrigger],
  ["stunReadySelfMight", resolveStunReadySelfMightTrigger],
  ["stunBuffFriendlyUnit", resolveStunBuffFriendlyUnitTrigger],
  ["recycleBuffFriendlyUnit", resolveBuffFriendlyUnitTrigger],
  ["enemyKilledStunnedDraw", resolveEnemyKilledStunnedDrawTrigger],
  ["defendHereRevealTopSpell", resolveDefendHereRevealTopSpellTrigger],
  ["defendHereGiveShield", resolveDefendHereGiveShieldTrigger],
  ["defendHereReturnFriendlyUnitToBase", resolveDefendHereReturnFriendlyUnitToBaseTrigger],
  ["firstBeginningGainPoint", resolveFirstBeginningGainPointTrigger],
  ["firstBeginningChannelRunes", resolveFirstBeginningChannelRunesTrigger],
  ["endTurnReadyRunes", resolveEndTurnReadyRunesTrigger],
  ["endTurnPlayTopDeckUnitIgnoreCost", resolveEndTurnPlayTopDeckUnitIgnoreCostTrigger],
  ["showdownBeginsPayEnergyPredictDrawSpell", resolveShowdownBeginsPayEnergyPredictDrawSpellTrigger],
  ["spellPlayedSelfBuff", resolveSpellPlayedSelfBuffTrigger],
  ["spellPlayedDraw", resolveSpellPlayedDrawTrigger],
  ["secondDrawBuff", resolveSecondDrawBuffTrigger],
  ["battlefieldSpellBuff", resolveBattlefieldSpellBuffTrigger]
]);

function resolveQueuedTrigger(game, trigger) {
  const player = game.players.find((candidate) => candidate.id === trigger.playerId);
  const source = findCard(game, trigger.sourceCardId) || trigger.sourceCardSnapshot;
  if (!player || !source) return;
  const resolver = TRIGGER_RESOLVERS.get(trigger.kind);
  if (!resolver) {
    log(game, `${source.name} has no registered trigger resolver for ${trigger.kind}.`);
    return;
  }
  resolver(game, trigger, player, source);
}

function resolveEffectSpecsTrigger(game, trigger, player, source) {
  source.declaredPlayTargets = structuredClone(trigger.data?.declaredTargets || []);
  source.declaredPlayChoices = structuredClone(trigger.data?.declaredChoices || []);
  resolveEffectSpecs(game, player, source, structuredClone(trigger.data?.specs || []), false);
  delete source.declaredPlayTargets;
  delete source.declaredPlayChoices;
}

function resolveReflexiveGameActionTrigger(game, trigger, player, source) {
  const amount = Math.max(0, trigger.data?.amount || 0);
  if (trigger.data?.action === "draw") {
    draw(player, amount, game);
    log(game, `${source.name}'s reflexive trigger draws ${amount}.`);
    markEffect(game, source, [source.instanceId], `${source.name} draws ${amount}.`);
    return;
  }
  if (trigger.data?.action === "gainXp") {
    gainXp(player, amount, source.name);
    log(game, `${source.name}'s reflexive trigger gains ${amount} XP.`);
    markEffect(game, source, [source.instanceId], `${source.name} gains ${amount} XP.`);
  }
}

function resolveReflexiveDragonsRageDuelTrigger(game, trigger, player, source) {
  const moved = findCard(game, trigger.data?.movedUnitId);
  const location = moved ? findUnitLocation(game, moved.instanceId) : null;
  const candidates = location?.type === "battlefield"
    ? location.battlefield.units
    : location?.player?.base || [];
  const options = candidates
    .filter((unit) => unit.type === "unit" && unit.controllerId !== player.id && unit.instanceId !== moved?.instanceId)
    .filter((unit) => canChooseUnit(game, player, source, unit))
    .map(cardOption);
  const declared = declaredTriggerOption(trigger, "dragonsRageEnemy", options);
  if (!declared?.option) {
    log(game, `${source.name}'s reflexive duel target is no longer legal.`);
    return;
  }
  applyChoiceEffect(game, {
    id: trigger.id,
    playerId: player.id,
    card: source,
    effect: "dragonsRageEnemy",
    options,
    data: { movedUnitId: moved.instanceId, triggerId: trigger.id },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  }, declared.option);
}

function resolveReflexiveRuneGambitTrigger(game, trigger, player, source) {
  const battlefield = game.battlefields.find((field) => field.instanceId === trigger.data?.battlefieldId);
  const candidates = trigger.data?.domain === "Fury" ? (battlefield?.units || []) : allUnits(game);
  const options = candidates
    .filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit))
    .map(cardOption);
  const effect = trigger.data?.domain === "Fury" ? "runeDeckGambitFuryDamage" : "stunUnit";
  const declared = declaredTriggerOption(trigger, effect, options);
  if (!declared?.option) {
    log(game, `${source.name}'s reflexive rune target is no longer legal.`);
    return;
  }
  applyChoiceEffect(game, {
    id: trigger.id,
    playerId: player.id,
    card: source,
    effect,
    options,
    data: { battlefieldId: battlefield?.instanceId, triggerId: trigger.id },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  }, declared.option);
}

function resolveDelayedKillDamagedUnitTrigger(game, trigger, player, source) {
  const target = findCard(game, trigger.data?.targetId);
  const identityMatches = target
    && (target.zoneChangeCounter || 0) === (trigger.data?.targetZoneChangeCounter || 0);
  const location = identityMatches ? findUnitLocation(game, target.instanceId) : null;
  if (!target || !location || !identityMatches) {
    log(game, `${source.name}'s delayed kill no longer has the object it marked.`);
    return;
  }
  killUnit(game, target,
    location.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
  log(game, `${source.name}'s delayed triggered ability kills ${target.name}.`);
  markEffect(game, source, [target.instanceId], `${target.name} is killed by the delayed ability.`);
}

function resolveCardPlayedAnotherUnitBuffSelfTrigger(game, trigger, player, source) {
  if (!findUnitLocation(game, source.instanceId)) return;
  buffUnitWithEffects(game, player, source, source, trigger.data?.amount || 1, { maxBuffs: trigger.data?.maxBuffs });
  log(game, `${source.name} is buffed because another unit was played.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} is buffed.`);
}

function resolveCardPlayedHighCostSpellBuffSelfTrigger(game, trigger, player, source) {
  if (!findUnitLocation(game, source.instanceId)) return;
  const amount = trigger.data?.amount || 3;
  addMightModifier(source, amount, { temporary: Boolean(trigger.data?.temporary) });
  log(game, `${source.name} gets +${amount} Might because a high-cost spell was played.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} gets +${amount} Might.`);
}

function resolveCardPlayedHighCostSpellDrawTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  draw(player, amount, game);
  log(game, `${source.name} draws ${amount} because a high-cost spell was played.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} draws ${amount}.`);
}

function resolveCardPlayedGearReadySelfTrigger(game, trigger, player, source) {
  if (!findUnitLocation(game, source.instanceId)) return;
  readyUnitWithEffects(game, player, source, source);
  log(game, `${source.name} readies because a gear was played.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} readies.`);
}

function resolveCardPlayedOpponentTurnRecruitTrigger(game, trigger, player, source) {
  playUnitToken(game, player, source, {
    tokenCardNumber: trigger.data?.tokenCardNumber || "OGN-273/298",
    count: trigger.data?.count || 1,
    ready: Boolean(trigger.data?.ready),
    destination: "base"
  });
}

function resolveCardPlayedSecondCardMightReadySelfTrigger(game, trigger, player, source) {
  if (!findUnitLocation(game, source.instanceId)) return;
  readyUnitWithEffects(game, player, source, source);
  addMightModifier(source, trigger.data?.amount || 2, { temporary: Boolean(trigger.data?.temporary) });
  log(game, `${source.name} readies and gets +${trigger.data?.amount || 2} Might because ${player.name} played their second card.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} readies.`);
}

function resolveCardPlayedFromHiddenBuffSelfTrigger(game, trigger, player, source) {
  if (!findUnitLocation(game, source.instanceId)) return;
  addMightModifier(source, trigger.data?.amount || 2, { temporary: Boolean(trigger.data?.temporary) });
  log(game, `${source.name} gets +${trigger.data?.amount || 2} Might because a card was played from hidden.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} gets Might.`);
}

function resolveCardPlayedExhaustSelfChannelOnMightyUnitTrigger(game, trigger, player, source) {
  if (!trigger.data?.triggerCostPaid || !source.exhausted) return;
  channelRunes(game, player, trigger.data?.amount || 1, {
    exhausted: true,
    source,
    reason: "trigger"
  });
  log(game, `${source.name} channels a rune after paying its exhaust cost before finalization.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} channels.`);
}

function resolveCardPlayedLegendTriggerChoice({ game, choice, option, player, source }) {
  if (option.id === "decline" || source.exhausted) {
    log(game, `${player.name} declines ${source.name}.`);
    return;
  }
  exhaustCards(game, player, source, [source], { reason: "trigger-cost", cost: true });
  channelRunes(game, player, choice.data?.amount || 1, {
    exhausted: true,
    source,
    reason: "trigger"
  });
  log(game, `${source.name} exhausts to channel a rune because a Mighty unit was played.`);
  markEffect(game, source, [source.instanceId, choice.data?.playedCardId].filter(Boolean), `${source.name} channels.`);
}

function resolveDeathDrawIfAloneTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  draw(player, amount, game);
  log(game, `${source.name} died alone and draws ${amount}.`);
  markEffect(game, source, [source.instanceId], `${source.name} draws.`);
}

function resolveDeathDrawTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  draw(player, amount, game);
  log(game, `${source.name} draws ${amount} as a Deathknell.`);
  markEffect(game, source, [source.instanceId], `${source.name} draws.`);
}

function resolveDeathChannelRunesTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  channelRunes(game, player, amount, {
    exhausted: trigger.data?.exhausted !== false,
    source,
    reason: "deathknell"
  });
  log(game, `${source.name} channels ${amount} rune${amount === 1 ? "" : "s"} as a Deathknell.`);
  markEffect(game, source, [source.instanceId], `${source.name} channels runes.`);
}

function resolveDeathDiscardDrawTrigger(game, trigger, player, source) {
  const discardAmount = trigger.data?.discard || 0;
  const drawAmount = trigger.data?.draw || 0;
  chooseDiscardCards(game, player, source, { amount: discardAmount, draw: drawAmount });
}

function resolveDeathDealDamageAllHereTrigger(game, trigger, player, source) {
  const battlefield = game.battlefields.find((field) => field.instanceId === trigger.data?.battlefieldId);
  if (!battlefield) return;
  const amount = trigger.data?.amount || 0;
  for (const unit of battlefield.units) applyDamage(game, player, source, unit, amount);
  log(game, `${source.name} deals ${amount} to all units at ${battlefield.name}.`);
  markEffect(game, source, [source.instanceId, ...battlefield.units.map((unit) => unit.instanceId)], `${source.name} deals Deathknell damage.`);
}

function resolveDeathPlayUnitTokenTrigger(game, trigger, player, source) {
  playUnitToken(game, player, source, {
    tokenCardNumber: trigger.data?.tokenCardNumber,
    count: trigger.data?.count || 1,
    ready: Boolean(trigger.data?.ready),
    destination: trigger.data?.destination || "base"
  });
}

function resolveDeathGainXpTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  gainXp(player, amount);
  log(game, `${source.name} gains ${amount} XP as a Deathknell.`);
  markEffect(game, source, [source.instanceId], `${source.name} gains XP.`);
}

function resolveDeathRevealOpponentHandTrigger(game, trigger, player, source) {
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  if (!opponent) return;
  recordRevealEvent(game, opponent, opponent.hand, source, "hand");
  revealPrivateInfoForTurn(game, player.id, opponent.id, source);
  log(game, `${opponent.name} reveals ${opponent.hand.length} cards in hand.`);
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "acknowledgeReveal",
    prompt: `${opponent.name} reveals their hand.`,
    options: [{ id: "continue", label: "Continue" }],
    data: {
      revealedCards: structuredClone(opponent.hand),
      revealResolution: "opponentHand"
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  };
}

function resolveDeathRecycleSelfReadyRunesTrigger(game, trigger, player, source) {
  const index = player.trash.findIndex((card) => card.instanceId === source.instanceId);
  if (index >= 0) {
    const [card] = player.trash.splice(index, 1);
    clearBoardState(game, card);
    recycleMainDeckCards(game, player, [card], source);
  }
  const amount = trigger.data?.readyAll
    ? player.runes.filter((rune) => rune.exhausted).length
    : trigger.data?.amount || player.runes.length;
  readyRunes(player, amount);
  log(game, `${source.name} recycles itself and readies ${amount} rune${amount === 1 ? "" : "s"}.`);
  markEffect(game, source, [source.instanceId], `${source.name} readies runes.`);
}

function resolveDeathBuffAnotherFriendlyOnBuffedUnitDeathTrigger(game, trigger, player, source) {
  const targets = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => unit.instanceId !== trigger.data?.deadUnitId);
  return resolveTriggerTargetChoice(game, trigger, player, source, {
    effect: "buffUnit",
    prompt: `Choose another friendly unit to buff for ${source.name}.`,
    targets,
    amount: trigger.data?.amount || 1,
    declaredEffect: "buffUnit",
    extraData: { buff: true, maxBuffs: 1 }
  });
}

function resolveDiscardedDrawTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  draw(player, amount, game);
  log(game, `${source.name} draws ${amount} after being discarded.`);
  markEffect(game, source, [source.instanceId], `${source.name} draws.`);
}

function resolvePlaySelfFromTrashPayPowerTrigger(game, trigger, player, source) {
  const inTrash = player.trash.some((card) => card.instanceId === source.instanceId);
  if (!trigger.data?.triggerCostPaid || !inTrash || !canPlayerPlayCards(game, player)) return;
  const index = player.trash.findIndex((card) => card.instanceId === source.instanceId);
  const [played] = player.trash.splice(index, 1);
  markNonBoardZoneChange(played);
  playCardIgnoringCostFromEffect(game, player, played, source);
  log(game, `${source.name} plays itself from trash after its Power cost was paid before finalization.`);
  markEffect(game, source, [played.instanceId], `${played.name} played from trash.`);
}

function resolveAttackOrDefendPlayHiddenFromHandTrigger(game, trigger, player, source) {
  if (!trigger.data?.triggerCostPaid) return;
  const index = player.hand.findIndex((card) => card.instanceId === trigger.data?.triggerCostSelectionId);
  if (index < 0) return;
  const [played] = player.hand.splice(index, 1);
  markNonBoardZoneChange(played);
  const destination = played.type === "unit" && trigger.data?.battlefieldId ? trigger.data.battlefieldId : "base";
  playCardIgnoringCostFromEffect(game, player, played, source, destination, { allowUncontrolledBattlefield: true });
  log(game, `${source.name} plays ${played.name} after its Power cost was paid before finalization.`);
  markEffect(game, source, [played.instanceId], `${played.name} is played by ${source.name}.`);
}

function resolveAttackOrDefendRuneDeckGambitTrigger(game, trigger, player, source) {
  const rune = player.runeDeck.shift();
  if (!rune) return;
  player.runeDeck.push(rune);
  log(game, `${source.name} reveals and recycles a ${rune.domain} rune.`);
  if (rune.domain === "Mind") {
    prepareAndQueueTriggers(game, [{
      kind: "reflexiveGameAction",
      playerId: player.id,
      sourceCardId: source.instanceId,
      sourceCardSnapshot: structuredClone(source),
      data: { action: "draw", amount: 1 }
    }], game.phase === "showdown" && game.showdown ? "showdownChain" : "actionChain");
    return;
  }
  const battlefield = game.battlefields.find((field) => field.instanceId === trigger.data?.battlefieldId);
  const enemiesHere = (battlefield?.units || []).filter((unit) => unit.controllerId !== player.id);
  const hasEligibleEnemy = rune.domain === "Fury"
    ? Boolean(battlefield && enemiesHere.length)
    : allUnits(game).some((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit));
  if (!["Fury", "Order"].includes(rune.domain) || !hasEligibleEnemy) return;
  prepareAndQueueTriggers(game, [{
    kind: "reflexiveRuneGambit",
    playerId: player.id,
    sourceCardId: source.instanceId,
    sourceCardSnapshot: structuredClone(source),
    data: { domain: rune.domain, battlefieldId: battlefield.instanceId }
  }], game.phase === "showdown" && game.showdown ? "showdownChain" : "actionChain");
}

function resolveReadyFriendlyUnitMightTrigger(game, trigger, player, source) {
  const unit = findCard(game, trigger.data?.unitId);
  if (!unit || unit.controllerId !== player.id || !findUnitLocation(game, unit.instanceId)) return;
  addMightModifier(unit, trigger.data?.amount || 1, { temporary: true });
  log(game, `${source.name} gives ${unit.name} +${trigger.data?.amount || 1} Might this turn after it readies.`);
  markEffect(game, source, [unit.instanceId], `${unit.name} gets Might after readying.`);
}

function resolveBuffFriendlyUnitPayExhaustReadyTrigger(game, trigger, player, source) {
  const unit = findCard(game, trigger.data?.unitId);
  if (!trigger.data?.triggerCostPaid || !source.exhausted || !unit || unit.controllerId !== player.id || !unit.exhausted) return;
  readyUnitWithEffects(game, player, source, unit);
  log(game, `${source.name} readies ${unit.name} after paying Power and exhausting before finalization.`);
  markEffect(game, source, [source.instanceId, unit.instanceId], `${unit.name} readies.`);
}

function resolveDiscardReadySelfMightTrigger(game, trigger, player, source) {
  readyUnitWithEffects(game, player, source, source);
  addMightModifier(source, trigger.data?.amount || 1, { temporary: Boolean(trigger.data?.temporary) });
  log(game, `${source.name} readies and gets +${trigger.data?.amount || 1} Might because ${player.name} discarded.`);
  markEffect(game, source, [source.instanceId], `${source.name} reacts to discard.`);
}

function resolveScoreBuffSelfTrigger(game, trigger, player, source) {
  buffUnitWithEffects(game, player, source, source, trigger.data?.amount || 1, { maxBuffs: trigger.data?.maxBuffs });
  log(game, `${source.name} is buffed after ${trigger.data?.reason || "scoring"}.`);
  markEffect(game, source, [source.instanceId], `${source.name} is buffed.`);
}

function resolveScoreDrawTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  draw(player, amount, game);
  log(game, `${source.name} draws ${amount} after ${trigger.data?.reason || "scoring"}.`);
  markEffect(game, source, [source.instanceId], `${source.name} draws.`);
}

function resolveScoreDrawOrChannelRunesTrigger(game, trigger, player, source) {
  const drawAmount = trigger.data?.draw || 1;
  const channelAmount = trigger.data?.channel || 1;
  const options = [
    { id: "draw", label: `Draw ${drawAmount}` },
    { id: "channel", label: `Channel ${channelAmount} rune exhausted` }
  ];
  if (!game.interactive) {
    draw(player, drawAmount, game);
    return;
  }
  game.pendingChoice = {
    id: trigger.id,
    playerId: player.id,
    card: source,
    effect: "drawOrChannelRunes",
    prompt: `Choose ${source.name}'s ${trigger.data?.reason || "score"} effect.`,
    options,
    data: {
      draw: drawAmount,
      channel: channelAmount,
      channelExhausted: trigger.data?.channelExhausted !== false
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  log(game, `${player.name} chooses ${source.name}'s score effect.`);
}

function resolveScoreKillGearThenBuffSelfTrigger(game, trigger, player, source) {
  const gears = allGear(game);
  if (!gears.length) return;
  const options = [
    ...gears.map(cardOption),
    { id: "decline", label: "Do not kill gear" }
  ];
  if (!game.interactive) {
    applyChoiceEffect(game, {
      id: trigger.id,
      playerId: player.id,
      card: source,
      effect: "trashGear",
      options,
      data: { buffSourceAfterKill: source.instanceId },
      finishSpell: false,
      optional: false
    }, options[0]);
    return;
  }
  game.pendingChoice = {
    id: trigger.id,
    playerId: player.id,
    card: source,
    effect: "trashGear",
    prompt: `Choose a gear to kill for ${source.name}. If you do, buff ${source.name}.`,
    options,
    data: { buffSourceAfterKill: source.instanceId },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  log(game, `${player.name} may kill a gear for ${source.name}.`);
}

function resolveScoreGainXpTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  gainXp(player, amount);
  log(game, `${source.name} gains ${amount} XP from ${trigger.data?.reason || "scoring"}.`);
  markEffect(game, source, [source.instanceId], `${source.name} gains XP.`);
}

function resolveScoreReturnSelfToHandTrigger(game, trigger, player, source) {
  if (trigger.data?.reason && trigger.data.reason !== "hold") return;
  if (!findUnitLocation(game, source.instanceId)) return;
  returnUnitToHand(game, source, source.name);
  markEffect(game, source, [source.instanceId], `${source.name} returns to hand.`);
}

function resolveScoreSwapBackReplacedBattlefieldTrigger(game, trigger, player, source) {
  const restored = swapBackBattlefieldToken(game, source.instanceId);
  if (!restored) return;
  log(game, `${player.name} swaps ${source.name} back to ${restored.name} after scoring.`);
  markEffect(game, restored, [restored.instanceId], `${restored.name} returns.`);
}

function resolveHoldDrawTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  draw(player, amount, game);
  log(game, `${source.name} draws ${amount} for holding.`);
  markEffect(game, source, [source.instanceId], `${source.name} draws.`);
}

function resolveHoldGainPointTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  player.score += amount;
  log(game, `${source.name} gives ${player.name} ${amount} point${amount === 1 ? "" : "s"} for holding.`);
  markEffect(game, source, [source.instanceId], `${player.name} gains ${amount} point${amount === 1 ? "" : "s"}.`);
}

function resolveHoldChannelRunesTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  if (!game.interactive) {
    channelRunes(game, player, amount, {
      exhausted: trigger.data?.exhausted !== false,
      source,
      reason: "hold"
    });
    log(game, `${source.name} channels ${amount} rune${amount === 1 ? "" : "s"} exhausted.`);
    markEffect(game, source, [source.instanceId], `${source.name} channels.`);
    return;
  }
  game.pendingChoice = {
    id: trigger.id,
    playerId: player.id,
    card: source,
    effect: "optionalChannelRunes",
    prompt: `Channel ${amount} rune${amount === 1 ? "" : "s"} for ${source.name}?`,
    options: [
      { id: "channel", label: `Channel ${amount}` },
      { id: "decline", label: "Do not use this effect" }
    ],
    data: { amount, exhausted: trigger.data?.exhausted !== false },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  log(game, `${player.name} may channel runes for ${source.name}.`);
}

function resolveHoldBuffUnitHereTrigger(game, trigger, player, source) {
  const field = game.battlefields.find((battlefield) => battlefield.instanceId === trigger.data?.battlefieldId);
  const targets = (field?.units || []).filter((unit) => canChooseUnit(game, player, source, unit));
  return resolveTriggerTargetChoice(game, trigger, player, source, {
    effect: "buffUnit",
    prompt: `Choose a unit at ${source.name} to buff.`,
    targets,
    amount: trigger.data?.amount || 1,
    declaredEffect: "buffUnit",
    extraData: { buff: true, maxBuffs: trigger.data?.maxBuffs }
  });
}

function resolveHoldReturnChosenChampionTrigger(game, trigger, player, source) {
  if (player.champion?.zone === "champion") return;
  const index = player.trash.findIndex((card) => isChampionCard(card) && card.name === player.chosenChampionName);
  if (index < 0) return;
  if (game.interactive && trigger.data?.optional !== false) {
    game.pendingChoice = {
      id: trigger.id,
      playerId: player.id,
      card: source,
      effect: "returnChosenChampion",
      prompt: `Return ${player.chosenChampionName} to the Champion Zone for ${source.name}?`,
      options: [
        { id: "return", label: `Return ${player.chosenChampionName}` },
        { id: "decline", label: "Do not use this effect" }
      ],
      data: { championName: player.chosenChampionName },
      finishSpell: false,
      optional: false,
      fromShowdownChain: false
    };
    return;
  }
  returnChosenChampionFromTrash(game, player, source, player.chosenChampionName);
}

function resolveHoldPlayUnitTokenTrigger(game, trigger, player, source) {
  playUnitToken(game, player, source, {
    tokenCardNumber: trigger.data?.tokenCardNumber,
    count: trigger.data?.count || 1,
    ready: Boolean(trigger.data?.ready),
    destination: trigger.data?.destination || "base"
  });
}

function resolveHoldWinIfFriendlyUnitsAtLeastTrigger(game, trigger, player, source) {
  const count = (source.units || []).filter((unit) => unit.controllerId === player.id).length;
  const threshold = trigger.data?.amount || 7;
  if (count < threshold) return;
  game.phase = "complete";
  game.winnerId = player.id;
  log(game, `${source.name} wins the game for ${player.name}.`);
  markEffect(game, source, [source.instanceId, ...source.units.map((unit) => unit.instanceId)], `${player.name} wins the game.`);
}

function resolveHoldTriggerConquerAbilitiesHereTrigger(game, trigger, player, source) {
  const units = (source.units || []).filter((unit) => unit.controllerId === player.id);
  const triggers = [];
  for (const unit of units) triggerUnitConquerAbilities(game, player, unit, triggers);
  if (triggers.length) {
    prepareAndQueueTriggers(
      game,
      triggers,
      game.actionChain && game.interactive ? "actionChain" : "queue"
    );
  }
  if (units.length) {
    log(game, `${source.name} triggers conquer abilities for units there.`);
    markEffect(game, source, [source.instanceId, ...units.map((unit) => unit.instanceId)], `${source.name} triggers conquer abilities.`);
  }
}

function resolveConquerHereReadyRunesEndTurnTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  player.endTurnReadyRunes = (player.endTurnReadyRunes || 0) + amount;
  log(game, `${source.name} will ready ${amount} runes at end of turn.`);
  markEffect(game, source, [trigger.data?.unitId || source.instanceId], `${source.name} delays rune readying.`);
}

function resolveConquerHereDiscardDrawTrigger(game, trigger, player, source) {
  chooseDiscardCards(game, player, source, {
    amount: trigger.data?.discard || 1,
    draw: trigger.data?.draw || 1
  });
}

function resolveConquerHereRecycleRunesTrigger(game, trigger, player, source) {
  chooseRecycleRunes(game, player, source, trigger.data?.amount || 1);
}

function resolveConquerHereSpendBuffDrawTrigger(game, trigger, player, source) {
  if (!trigger.data?.triggerCostPaid) return;
  const unit = findCard(game, trigger.data?.triggerCostSelectionId);
  draw(player, trigger.data?.draw || 1, game);
  log(game, `${source.name} draws after ${unit?.name || "a friendly unit"}'s Buff was spent before finalization.`);
  markEffect(game, source, [source.instanceId, unit?.instanceId].filter(Boolean), `${source.name} draws.`);
}

function resolveConquerHereRecycleTopDeckTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 2;
  const top = player.mainDeck.slice(0, amount);
  if (!top.length) return;
  return beginObservedTopDeckSelfAbilities(game, player, top, {
    kind: "conquerHereRecycleTopDeck",
    sourceCardId: source.instanceId,
    sourceCardSnapshot: structuredClone(source),
    observedIds: top.map((card) => card.instanceId),
    amount,
    triggerId: trigger.id,
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  });
}

function presentConquerHereRecycleTopDeck(game, player, source, continuation) {
  const top = (continuation.observedIds || [])
    .map((id) => player.mainDeck.find((card) => card.instanceId === id))
    .filter(Boolean);
  if (!top.length) return false;
  const options = [
    { id: "keep", label: "Keep cards in this order" },
    ...(top.length > 1 ? [{ id: "swap", label: "Put cards back in reverse order" }] : []),
    ...top.map((card, index) => ({
      id: `recycle-${index}`,
      label: `Recycle ${card.name}`,
      cardId: card.instanceId
    })),
    ...(top.length > 1 ? [{ id: "recycle-all", label: "Recycle both cards" }] : [])
  ];
  return setPendingChoice(game, {
    id: continuation.triggerId || `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "recycleTopDeck",
    prompt: `Choose how to resolve ${source.name}.`,
    options,
    data: {
      amount: continuation.amount || top.length,
      cardIds: top.map((card) => card.instanceId)
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(continuation.fromShowdownChain)
  });
}

function resolveConquerDiscardReturnSelfFromTrashTrigger(game, trigger, player, source) {
  if (!trigger.data?.triggerCostPaid) return;
  const index = player.trash.findIndex((card) => card.instanceId === source.instanceId);
  if (index < 0) return;
  const [returned] = player.trash.splice(index, 1);
  markNonBoardZoneChange(returned);
  player.hand.push(returned);
  log(game, `${source.name} returns to hand after its discard cost was paid before finalization.`);
  markEffect(game, source, [source.instanceId], `${source.name} returns from trash.`);
}

function resolveFirstBeginningChannelRunesTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  channelRunes(game, player, amount, {
    exhausted: Boolean(trigger.data?.exhausted),
    source,
    reason: "first-beginning"
  });
  log(game, `${source.name} channels ${amount} rune${amount === 1 ? "" : "s"} exhausted.`);
  markEffect(game, source, [source.instanceId], `${source.name} channels.`);
}

function resolveBeginningDrawTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  draw(player, amount, game);
  log(game, `${source.name} draws ${amount} at the start of ${player.name}'s Beginning Phase.`);
  markEffect(game, source, [source.instanceId], `${source.name} draws.`);
}

function resolveBeginningRecycleTrashTrigger(game, trigger, player, source) {
  const amount = Math.min(trigger.data?.amount || 1, player.trash.length);
  if (!amount) return;
  chooseRecycleTrashCards(game, player, source, amount);
}

function resolveAttackOrDefendBuffXpTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 0;
  const xp = trigger.data?.xp || 0;
  addMightModifier(source, amount, { temporary: Boolean(trigger.data?.temporary) });
  gainXp(player, xp);
  log(game, `${source.name} gets +${amount} Might and gains ${xp} XP.`);
  markEffect(game, source, [source.instanceId], `${source.name} hunts an isolated enemy.`);
}

function resolveAttackOrDefendModifySelfTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 0;
  addMightModifier(source, amount, { temporary: Boolean(trigger.data?.temporary) });
  log(game, `${source.name} gets ${amount} Might while ${source.combatRole || "in combat"}.`);
  markEffect(game, source, [source.instanceId], `${source.name} gets ${amount} Might.`);
}

function resolveAttackOrDefendModifyUnitTrigger(game, trigger, player, source) {
  const target = findCard(game, trigger.data?.targetId);
  if (!target) return;
  const amount = trigger.data?.amount || 0;
  addMightModifier(target, amount, { temporary: Boolean(trigger.data?.temporary) });
  log(game, `${source.name} gives ${target.name} ${amount} Might.`);
  markEffect(game, source, [target.instanceId], `${target.name} gets ${amount} Might.`);
}

function resolveAttackOrDefendDamageAllEnemiesHereTrigger(game, trigger, player, source) {
  const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
  if (!battlefield) return;
  const targets = battlefield.units.filter((unit) => unit.controllerId !== source.controllerId);
  const amount = trigger.data?.amount || 0;
  for (const unit of targets) applyDamage(game, player, source, unit, amount);
  log(game, `${source.name} deals ${amount} damage to all enemies here.`);
  markEffect(game, source, targets.map((unit) => unit.instanceId), `${source.name} damages enemies here.`);
}

function resolveAttackOrDefendKillDamagedEnemiesHereTrigger(game, trigger, player, source) {
  const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
  if (!battlefield) return;
  const targets = battlefield.units.filter((unit) => unit.controllerId !== player.id && (unit.damage || 0) > 0);
  continueUnitKillSequence(game, {
    kind: "resumeUnitKillSequence",
    unitIds: targets.map((unit) => unit.instanceId),
    nextIndex: 0
  });
  log(game, `${source.name} kills all damaged enemy units there.`);
  markEffect(game, source, targets.map((unit) => unit.instanceId), `${source.name} kills damaged enemies.`);
}

function resolveAttackOrDefendDamageEnemyHereTrigger(game, trigger, player, source) {
  const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
  const options = (battlefield?.units || [])
    .filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit))
    .map(cardOption);
  promptChoice(game, player, source, {
    effect: "damageUnit",
    prompt: `Choose an enemy here for ${source.name}.`,
    options,
    optional: true,
    data: {
      amount: trigger.data?.amount || 0,
      amountFromSelfMight: Boolean(trigger.data?.amountFromSelfMight),
      scope: "enemyBattlefield"
    }
  });
}

function resolveAttackOrDefendSplitDamageEnemyHereTrigger(game, trigger, player, source) {
  const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
  const declarations = trigger.data?.declaredTargets || [];
  const targetIds = declarations
    .filter((target) => target.effect === "splitDamageEnemyHere")
    .map((target) => target.targetId);
  const choice = {
    playerId: player.id,
    card: source,
    data: {},
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(trigger.fromShowdownChain),
    fromActionChain: Boolean(trigger.fromActionChain)
  };
  const config = {
    amount: trigger.data?.amount || 5,
    damageSourceUnitId: source.instanceId,
    damageOrigin: "ability",
    sourceBattlefieldId: battlefield?.instanceId || null,
    markMessage: `${source.name} splits damage.`
  };
  const firstTarget = targetIds.map((id) => findCard(game, id)).find(Boolean);
  beginSplitDamageResolution({ game, choice, player, source }, targetIds,
    splitDamageAvailableAmount(game, player, source, config, firstTarget), config);
}

function resolveAttackOrDefendDamageEnemyByHiddenTopDeckTrigger(game, trigger, player, source) {
  const declaration = (trigger.data?.declaredTargets || []).find((target) => target.effect === "damageUnit");
  const target = declaration ? findCard(game, declaration.targetId) : null;
  const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
  const revealed = player.mainDeck.slice(0, Math.min(trigger.data?.look || 5, player.mainDeck.length));
  recordRevealEvent(game, player, revealed, source, "mainDeck");
  const amount = revealed.filter((card) => card.keywords?.includes("Hidden") || card.tags?.includes("Hidden")).length;
  return beginObservedTopDeckSelfAbilities(game, player, revealed, {
    kind: "damageEnemyByHiddenTopDeck",
    sourceCardId: source.instanceId,
    sourceCardSnapshot: structuredClone(source),
    observedIds: revealed.map((card) => card.instanceId),
    targetId: target?.instanceId || null,
    battlefieldId: battlefield?.instanceId || null,
    amount,
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  });
}

function presentHiddenTopDeckDamageReveal(game, player, source, continuation) {
  const revealed = (continuation.observedIds || [])
    .map((id) => player.mainDeck.find((card) => card.instanceId === id))
    .filter(Boolean);
  return setPendingChoice(game, {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "acknowledgeReveal",
    prompt: `${source.name} reveals ${revealed.length} cards.`,
    options: [{ id: "continue", label: "Continue" }],
    data: {
      revealedCards: revealed,
      revealResolution: "hiddenTopDeckDamage",
      targetId: continuation.targetId || null,
      battlefieldId: continuation.battlefieldId || null,
      amount: continuation.amount || 0
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(continuation.fromShowdownChain)
  });
}

function resolveAttackOrDefendModifyEnemyHereTrigger(game, trigger, player, source) {
  const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
  const options = (battlefield?.units || [])
    .filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit))
    .map(cardOption);
  promptChoice(game, player, source, {
    effect: "modifyMight",
    prompt: `Choose an enemy here for ${source.name}.`,
    options,
    optional: true,
    data: {
      amount: trigger.data?.amount || 0,
      minMight: trigger.data?.minMight || null,
      temporary: Boolean(trigger.data?.temporary)
    }
  });
}

function resolveAttackOrDefendStunEnemyHereTrigger(game, trigger, player, source) {
  const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
  const options = (battlefield?.units || [])
    .filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit))
    .map(cardOption);
  promptChoice(game, player, source, {
    effect: "stunUnit",
    prompt: `Choose an enemy here to stun for ${source.name}.`,
    options,
    optional: true
  });
}

function resolveStunReadySelfMightTrigger(game, trigger, player, source) {
  if (!findUnitLocation(game, source.instanceId)) return;
  readyUnitWithEffects(game, player, source, source);
  addMightModifier(source, trigger.data?.amount || 1, { temporary: Boolean(trigger.data?.temporary) });
  log(game, `${source.name} readies and gets +${trigger.data?.amount || 1} Might because ${player.name} stunned an enemy unit.`);
  markEffect(game, source, [source.instanceId, trigger.data?.stunnedUnitId].filter(Boolean), `${source.name} readies.`);
}

function resolveBuffFriendlyUnitTrigger(game, trigger, player, source) {
  const targets = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => canChooseUnit(game, player, source, unit));
  return resolveTriggerTargetChoice(game, trigger, player, source, {
    effect: "buffUnit",
    prompt: `Choose a friendly unit to buff for ${source.name}.`,
    targets,
    amount: trigger.data?.amount || 1,
    declaredEffect: "buffUnit",
    extraData: { buff: true, maxBuffs: trigger.data?.maxBuffs }
  });
}

function resolveStunBuffFriendlyUnitTrigger(game, trigger, player, source) {
  return resolveBuffFriendlyUnitTrigger(game, trigger, player, source);
}

function resolveEnemyKilledStunnedDrawTrigger(game, trigger, player, source) {
  if (!trigger.data?.triggerCostPaid || !source.exhausted) return;
  draw(player, trigger.data?.amount || 1, game);
  log(game, `${source.name} draws after its exhaust cost was paid before finalization.`);
  markEffect(game, source, [source.instanceId, trigger.data?.killedUnitId].filter(Boolean), `${source.name} draws.`);
}

function resolveDefendHereRevealTopSpellTrigger(game, trigger, player, source) {
  const top = player.mainDeck[0];
  if (!top) return;
  recordRevealEvent(game, player, [top], source, "mainDeck");
  return beginObservedTopDeckSelfAbilities(game, player, [top], {
    kind: "defendHereRevealTopSpell",
    sourceCardId: source.instanceId,
    sourceCardSnapshot: structuredClone(source),
    observedIds: [top.instanceId],
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  });
}

function presentDefendHereRevealTopSpell(game, player, source, continuation) {
  const top = player.mainDeck.find((card) => card.instanceId === continuation.observedIds?.[0]);
  if (!top) {
    markEffect(game, source, [source.instanceId], `${source.name} completes its defend trigger after the revealed card changed zones.`);
    return false;
  }
  return setPendingChoice(game, {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "acknowledgeReveal",
    prompt: `${source.name} reveals ${top.name}.`,
    options: [{ id: "continue", label: "Continue" }],
    data: {
      revealedCards: [top],
      revealResolution: "ravenbloomConservatory"
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(continuation.fromShowdownChain)
  });
}

function resolveDefendHereGiveShieldTrigger(game, trigger, player, source) {
  const targets = (trigger.data?.targetIds || [])
    .map((id) => findCard(game, id))
    .filter((candidate) => candidate?.type === "unit" && findUnitLocation(game, candidate.instanceId)?.type === "battlefield")
    .filter((unit) => canChooseUnit(game, player, source, unit));
  return resolveTriggerTargetChoice(game, trigger, player, source, {
    effect: "giveKeyword",
    prompt: `Choose a unit to gain Shield for ${source.name}.`,
    targets,
    amount: trigger.data?.amount || 2,
    declaredEffect: "giveKeyword",
    extraData: { keywords: ["Shield"], shieldAmount: trigger.data?.amount || 2 }
  });
}

function resolveDefendHereReturnFriendlyUnitToBaseTrigger(game, trigger, player, source) {
  const targets = (trigger.data?.targetIds || [])
    .map((id) => findCard(game, id))
    .filter((candidate) => candidate?.type === "unit" && candidate.controllerId === player.id)
    .filter((unit) => findUnitLocation(game, unit.instanceId)?.battlefield?.instanceId === source.instanceId)
    .filter((unit) => canChooseUnit(game, player, source, unit));
  return resolveTriggerTargetChoice(game, trigger, player, source, {
    effect: "returnUnitToBase",
    prompt: `Choose a friendly unit to recall for ${source.name}.`,
    targets,
    declaredEffect: "returnUnitToBase",
    optional: Boolean(trigger.data?.optional)
  });
}

function resolveFirstBeginningGainPointTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  player.score += amount;
  player.firstBeginningPointAwarded = true;
  log(game, `${source.name} gives ${player.name} ${amount} point${amount === 1 ? "" : "s"} at their first Beginning Phase.`);
  markEffect(game, source, [source.instanceId], `${player.name} gains ${amount} point${amount === 1 ? "" : "s"}.`);
}

function resolveEndTurnReadyRunesTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 0;
  if (!amount) return;
  player.endTurnReadyRunes = 0;
  if (offerReadyRunesChoice(game, player, source, amount)) {
    log(game, `${player.name} chooses up to ${amount} runes to ready at end of turn.`);
    return;
  }
  log(game, `${player.name} has no exhausted runes to ready at end of turn.`);
}

function resolveEndTurnPlayTopDeckUnitIgnoreCostTrigger(game, trigger, player, source) {
  const revealed = [];
  let unit = null;
  for (const card of player.mainDeck) {
    revealed.push(card);
    if (card.type === "unit") {
      unit = card;
      break;
    }
  }
  if (!revealed.length) return false;
  recordRevealEvent(game, player, revealed, source, "mainDeck");
  return beginObservedTopDeckSelfAbilities(game, player, revealed, {
    kind: "endTurnPlayTopDeckUnitIgnoreCost",
    sourceCardId: source.instanceId,
    sourceCardSnapshot: structuredClone(source),
    observedIds: revealed.map((card) => card.instanceId),
    unitId: unit?.instanceId || null,
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  });
}

function continueEndTurnPlayTopDeckUnitIgnoreCost(game, player, source, continuation) {
  const revealed = (continuation.observedIds || [])
    .map((id) => player.mainDeck.find((card) => card.instanceId === id))
    .filter(Boolean);
  const unit = revealed.find((card) => card.instanceId === continuation.unitId) || null;
  const recycled = revealed.filter((card) => card.instanceId !== unit?.instanceId);
  if (unit) {
    banishCards(game, player, [unit], source);
    playCardIgnoringCostFromEffect(game, player, unit, source);
    recycleMainDeckCards(game, player, recycled, source);
    log(game, `${source.name} reveals, banishes, and plays ${unit.name}, ignoring its cost.`);
    markEffect(game, source, [unit.instanceId, ...recycled.map((card) => card.instanceId)], `${unit.name} is played from the top of the deck.`);
  } else {
    recycleMainDeckCards(game, player, recycled, source);
    log(game, `${source.name} finds no unit and recycles the revealed cards.`);
    markEffect(game, source, recycled.map((card) => card.instanceId), `${source.name} recycles its reveal.`);
  }
  return false;
}

function resolveShowdownBeginsPayEnergyPredictDrawSpellTrigger(game, trigger, player, source) {
  if (!trigger.data?.triggerCostPaid) return;
  resolveShowdownPredictDrawSpell(game, player, source, trigger.fromShowdownChain ? { fromShowdownChain: true } : null);
}

function resolveSpellPlayedSelfBuffTrigger(game, trigger, player, source) {
  addMightModifier(source, trigger.data?.amount || 1, { temporary: Boolean(trigger.data?.temporary) });
  markEffect(game, source, [source.instanceId], `${source.name} gets +${trigger.data?.amount || 1} Might.`);
  log(game, `${source.name} gets +${trigger.data?.amount || 1} Might.`);
}

function resolveSpellPlayedDrawTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  draw(player, amount, game);
  log(game, `${source.name} draws ${amount} for ${player.name}.`);
  markEffect(game, source, [source.instanceId, ...(trigger.data?.targetIds || [])], `${source.name} draws ${amount}.`);
}

function resolveSecondDrawBuffTrigger(game, trigger, player, source) {
  const targets = (trigger.data?.targetIds || [])
    .map((id) => findCard(game, id))
    .filter((candidate) => candidate?.type === "unit" && candidate.controllerId === player.id && Boolean(findUnitLocation(game, candidate.instanceId)));
  return resolveTriggerTargetChoice(game, trigger, player, source, {
    effect: "secondDrawBuff",
    prompt: `Choose a friendly unit for ${source.name}.`,
    targets,
    amount: trigger.data?.amount || 2,
    declaredEffect: "secondDrawBuff",
    extraData: { temporary: Boolean(trigger.data?.temporary) }
  });
}

function resolveBattlefieldSpellBuffTrigger(game, trigger, player, source) {
  const targets = (trigger.data?.targetIds || [])
    .map((id) => findCard(game, id))
    .filter((candidate) => candidate?.type === "unit" && findUnitLocation(game, candidate.instanceId)?.type === "battlefield");
  return resolveTriggerTargetChoice(game, trigger, player, source, {
    effect: "battlefieldSpellBuff",
    prompt: `Choose a unit for ${source.name}.`,
    targets,
    amount: trigger.data?.amount || 1,
    declaredEffect: "battlefieldSpellBuff",
    optional: Boolean(trigger.data?.optional),
    extraData: { temporary: Boolean(trigger.data?.temporary) }
  });
}

function resolveTriggerTargetChoice(game, trigger, player, source, config) {
  if (!config.targets.length) return false;
  const choice = {
    id: trigger.id,
    playerId: player.id,
    card: source,
    effect: config.effect,
    prompt: config.prompt,
    options: [
      ...config.targets.map(cardOption),
      ...(config.optional ? [{ id: "decline", label: "Do not use this effect" }] : [])
    ],
    data: {
      amount: config.amount,
      triggerId: trigger.id,
      ...(config.extraData || {})
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  const declared = declaredTriggerOption(trigger, config.declaredEffect, choice.options);
  if (declared) {
    if (declared.option) applyChoiceEffect(game, choice, declared.option);
    else log(game, `${source.name}'s declared target is no longer legal.`);
    return true;
  }
  if (!game.interactive) {
    applyChoiceEffect(game, choice, choice.options[0]);
    return true;
  }
  game.pendingChoice = choice;
  log(game, `${player.name} chooses a unit for ${source.name}.`);
  return true;
}

function declaredTriggerOption(trigger, effect, options) {
  const declaration = (trigger.data?.declaredTargets || []).find((target) => target.effect === effect);
  if (!declaration) return null;
  const matchingOption = options.find((candidate) => candidate.cardId === declaration.targetId) || null;
  const identity = (trigger.data?.declaredTargetIdentities || []).find((candidate) =>
    candidate.effect === declaration.effect && candidate.targetId === declaration.targetId);
  const option = !identity || (matchingOption?.zoneChangeCounter || 0) === identity.zoneChangeCounter
    ? matchingOption
    : null;
  return { declaration, option };
}

function recordTriggerTargetIdentity(trigger, effect, option) {
  if (!option?.cardId) return;
  trigger.data ||= {};
  trigger.data.declaredTargetIdentities = [
    ...(trigger.data.declaredTargetIdentities || []),
    {
      effect,
      targetId: option.cardId,
      zoneChangeCounter: option.zoneChangeCounter || 0
    }
  ];
}

function resolveOnPlayEffect(game, player, card) {
  const specs = [...cardEffects(card, "onPlay"), ...enabledKeywordPlayEffectSpecs(card, game)];
  if (!specs.length) return false;
  const triggers = specs
    .filter((spec) => onPlaySpecShouldTrigger(player, card, spec))
    .map((spec) => ({
      kind: "effectSpecs",
      playerId: player.id,
      sourceCardId: card.instanceId,
      data: {
        specs: [structuredClone(spec)],
        timing: "onPlay",
        declaredTargets: [],
        declaredChoices: []
      }
    }));
  if (!triggers.length) return false;
  return prepareAndQueueTriggers(
    game,
    triggers,
    game.phase === "showdown" && game.showdown ? "showdownChain" : (game.phase === "action" && game.interactive ? "actionChain" : "queue")
  );
}

function enabledKeywordPlayEffectSpecs(card, game = null) {
  return keywordPlayEffectSpecs(card, {
    keywordCount: (keyword) => keywordListCount(card?.keywords, keyword)
      + keywordListCount(card?.temporaryKeywords, keyword)
      + dynamicKeywordInstanceCount(card, keyword, game)
  }).filter(effectIsEnabled);
}

function resolveQuickDrawAttachEffect(game, player, card) {
  const options = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .map(cardOption);
  const declared = consumeDeclaredPlayTarget(card, "quickDrawAttach", options);
  if (!declared?.option) {
    log(game, `${card.name}'s Quick-Draw target is no longer legal.`);
    return false;
  }
  const target = findCard(game, declared.option.cardId);
  attachEquipmentToUnit(game, card, target, `${card.name} attaches to ${target?.name || "a unit"} with Quick-Draw.`);
  return false;
}

function resolveWeaponmasterEffect(game, player, card) {
  const options = allGear(game)
    .filter((gear) => gear.controllerId === player.id && gear.tags?.includes("Equipment"))
    .map(cardOption);
  const declared = consumeDeclaredPlayTarget(card, "weaponmasterEquipment", options);
  if (!declared) return false;
  if (!declared.option) {
    log(game, `${card.name}'s chosen Weaponmaster Equipment is no longer legal.`);
    return false;
  }
  const gear = findCard(game, declared.option.cardId);
  const cost = weaponmasterEquipCost(gear);
  if (!cost) {
    log(game, `${gear?.name || "The chosen Equipment"} has no Equip ability, so Weaponmaster cannot attach it.`);
    return false;
  }
  if (!findUnitLocation(game, card.instanceId) || gear.controllerId !== player.id) return false;
  if (game.interactive) {
    game.pendingPayment = createWeaponmasterPayment(player, card, gear, cost);
    game.selectedCardId = card.instanceId;
    log(game, `${player.name} is paying ${gear.name}'s Equip cost for ${card.name}'s Weaponmaster.`);
    return true;
  }
  if (!payActivatedCostAutomatically(game, player, cost, card)) {
    log(game, `${player.name} cannot pay ${gear.name}'s Equip cost for Weaponmaster.`);
    return false;
  }
  attachEquipmentToUnit(game, gear, card, `${card.name} attaches ${gear.name} with Weaponmaster.`);
  return false;
}

function weaponmasterEquipCost(gear) {
  // Weaponmaster is the explicit exception in Core Rule 725.3: it may read the
  // Equip ability and the portions that modify that ability even when the
  // Equipment's Rules Text is inactive because it is already attached.
  const specs = (gear?.effects || []).filter((effect) => effect.timing === "activated" && effect.kind === "equip");
  if (!specs.length) return null;
  const equipCost = activatedAbilityCost(null, null, gear, specs, { applyModifiers: false });
  if (!equipCost) return null;
  const power = structuredClone(equipCost.power || []);
  const universalIndex = power.findIndex((requirement) => requirement.domain === "Any" && requirement.amount > 0);
  if (universalIndex >= 0) power[universalIndex].amount -= 1;
  return {
    ...equipCost,
    power: power.filter((requirement) => requirement.amount > 0)
  };
}

function createWeaponmasterPayment(player, unit, gear, cost) {
  const powerCost = normalizeCardPowerRequirements(gear, cost.power || []);
  return {
    playerId: player.id,
    cardId: unit.instanceId,
    cardName: `${unit.name} / ${gear.name}`,
    destination: null,
    source: "weaponmaster",
    energyCost: cost.energy || 0,
    basePowerCost: structuredClone(powerCost),
    powerCost: structuredClone(powerCost),
    declaredTargets: [],
    declaredChoices: [],
    deflectTargetIds: [],
    optionalPowerEffects: [],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    poolPowerIds: [],
    weaponmaster: { gearId: gear.instanceId }
  };
}

function weaponmasterPaymentIsLegal(game, player, unit, payment) {
  const gear = findCard(game, payment.weaponmaster?.gearId);
  return Boolean(
    unit?.type === "unit"
    && unit.controllerId === player.id
    && findUnitLocation(game, unit.instanceId)
    && gear?.controllerId === player.id
    && gear.tags?.includes("Equipment")
    && weaponmasterEquipCost(gear)
  );
}

function attachEquipmentToUnit(game, gear, unit, message, effectSource = unit) {
  if (!gear || !unit || unit.type !== "unit" || !gear.tags?.includes("Equipment")) return false;
  if (gear.attachedToId === unit.instanceId
    && (unit.attachments || []).some((attachment) => attachment.instanceId === gear.instanceId)) return false;
  removeGearEverywhere(game, gear.instanceId);
  gear.attachedToId = unit.instanceId;
  unit.attachments ||= [];
  unit.attachments.push(gear);
  syncTopMostAttachmentEffects(unit);
  game.attachmentEventSequence = (game.attachmentEventSequence || 0) + 1;
  game.attachmentEvents ||= [];
  game.attachmentEvents.push({
    id: `attachment-${game.attachmentEventSequence}`,
    action: "attach",
    attachedCardId: gear.instanceId,
    topMostCardId: unit.instanceId,
    destinationType: "attached",
    destinationId: unit.instanceId,
    turnSequence: game.turnSequence || 0
  });
  log(game, message);
  markEffect(game, effectSource, [gear.instanceId, unit.instanceId], `${gear.name} attached.`);
  return true;
}

function onPlaySpecShouldTrigger(player, card, spec) {
  if (spec.additionalPower && !hasPaidOptionalEffect(card, spec)) return false;
  if (spec.requiresLegion && (player?.cardsPlayedThisTurn || 0) <= 1) return false;
  return true;
}

const EFFECT_RESOLVERS = new Map([
  ["activated:equip", (game, player, card, spec) => chooseEquipGear(game, player, card, spec)],
  ["keyword:predict", (game, player, card, spec) => offerPredictChoice(game, player, card, {}, { amount: spec.amount || 1 })],
  ["keyword:quickDrawAttach", resolveQuickDrawAttachEffect],
  ["keyword:weaponmaster", resolveWeaponmasterEffect],
  ["activated:buffUnit", (game, player, card, spec, finishSpell) => chooseBuffUnit(game, player, card, spec.amount || 1, spec.target === "friendlyUnit" || spec.target === "self" || spec.target === "exhaustedFriendlyUnit" ? "friendly" : "any", finishSpell, {
    buff: true,
    maxBuffs: spec.maxBuffs,
    target: spec.target,
    exhaustedOnly: spec.target === "exhaustedFriendlyUnit"
  })],
  ["activated:dealDamageUnit", (game, player, card, spec, finishSpell) => chooseDamageUnitBySpec(game, player, card, spec, finishSpell)],
  ["activated:draw", resolveDrawEffect],
  ["activated:giveKeyword", (game, player, card, spec, finishSpell) => chooseGiveKeyword(game, player, card, spec, finishSpell)],
  ["activated:modifyMight", (game, player, card, spec, finishSpell) => chooseMightBySpec(game, player, card, spec, finishSpell)],
  ["activated:returnUnitToBase", (game, player, card, spec, finishSpell) => chooseReturnUnitToBase(game, player, card, spec.target || "battlefield", finishSpell, spec)],
  ["activated:returnFriendlyPermanentOrHiddenToHand", (game, player, card, spec, finishSpell) => chooseReturnFriendlyPermanentOrHiddenToHand(game, player, card, finishSpell)],
  ["activated:baitedHook", (game, player, card, spec, finishSpell) => chooseBaitedHookSacrifice(game, player, card, finishSpell)],
  ["activated:killFriendlyPermanentChannelRune", (game, player, card, spec, finishSpell) => chooseKillFriendlyPermanentChannelRune(game, player, card, finishSpell)],
  ["activated:killSelf", (game, player, card) => {
    if (card.type === "gear") killGear(game, card, { type: "effect", source: card });
    else if (card.type === "unit") {
      const location = findUnitLocation(game, card.instanceId);
      killUnit(game, card, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : { type: "base", player });
    }
    markEffect(game, card, [card.instanceId], `${card.name} kills itself.`);
    return false;
  }],
  ["activated:nextUnitEnterReady", (game, player, card) => {
    if ((player.cardsPlayedThisTurn || 0) <= 0) {
      log(game, `${card.name} needs Legion to ready the next unit.`);
      return false;
    }
    player.nextUnitEnterReady = true;
    markEffect(game, card, [card.instanceId], `${card.name} readies the next unit played this turn.`);
    return false;
  }],
  ["activated:nextSpellBonusDamage", (game, player, card, spec) => {
    player.nextSpellBonusDamage = (player.nextSpellBonusDamage || 0) + (spec.amount || 1);
    markEffect(game, card, [card.instanceId], `${player.name}'s next spell deals bonus damage.`);
    log(game, `${card.name} gives ${player.name}'s next spell +${spec.amount || 1} damage.`);
    return false;
  }],
  ["activated:moveFriendlyUnit", (game, player, card, spec, finishSpell) => chooseMoveUnitSpell(game, player, card, "friendly", finishSpell, spec)],
  ["activated:returnOwnedTagUnitToHand", (game, player, card, spec, finishSpell) => chooseOwnedTagUnitToHand(game, player, card, spec, finishSpell)],
  ["activated:saveFriendlyUnitThisTurn", (game, player, card, spec, finishSpell) => chooseSaveFriendlyUnitThisTurn(game, player, card, spec, finishSpell)],
  ["activated:udyrChooseMode", resolveUdyrChooseModeEffect],
  ["activated:playUnitToken", (game, player, card, spec) => {
    playUnitToken(game, player, card, { ...spec, destination: spec.destination || "base" });
    return false;
  }],
  ["activated:addEnergy", resolveAddEnergyEffect],
  ["activated:addPower", resolveAddPowerEffect],
  ["onPlay:buffUnit", (game, player, card, spec, finishSpell) => chooseBuffUnit(game, player, card, spec.amount || 1, spec.target === "friendlyUnit" || spec.target === "anotherFriendlyUnit" ? "friendly" : "any", finishSpell, {
    buff: true,
    repeat: spec.repeat || 1,
    anotherOnly: spec.target === "anotherFriendlyUnit",
    maxBuffs: spec.maxBuffs
  })],
  ["onPlay:buffSelfDrawIfControlTag", resolveBuffSelfDrawIfControlTagEffect],
  ["onPlay:channelRunes", resolveChannelRunesEffect],
  ["onPlay:discard", resolveDiscardEffect],
  ["onPlay:dealDamageUnit", (game, player, card, spec, finishSpell) => chooseDamageUnitBySpec(game, player, card, spec, finishSpell)],
  ["onPlay:discardDraw", resolveDiscardDrawEffect],
  ["onPlay:draw", resolveDrawEffect],
  ["onPlay:drawPerFriendlyMightyUnit", resolveDrawPerFriendlyMightyUnitEffect],
  ["onPlay:killUnit", (game, player, card, spec, finishSpell) => chooseKillUnitBySpec(game, player, card, spec, finishSpell)],
  ["onPlay:duelEnemy", (game, player, card, spec, finishSpell) => chooseOnPlayDuelEnemy(game, player, card, spec, finishSpell)],
  ["onPlay:killGear", (game, player, card, spec, finishSpell) => chooseGearToTrash(game, player, card, finishSpell, spec)],
  ["onPlay:modifyMight", (game, player, card, spec, finishSpell) => chooseMightBySpec(game, player, card, spec, finishSpell)],
  ["onPlay:modifyEnemyUnits", resolveModifyEnemyUnitsEffect],
  ["onPlay:dealDamageAllBattlefieldUnits", resolveDealDamageAllBattlefieldUnitsEffect],
  ["onPlay:preventOpponentsPlayCardsThisTurn", resolvePreventOpponentsPlayCardsEffect],
  ["onPlay:moveEnemyToThisBattlefield", resolveMoveEnemyToThisBattlefieldEffect],
  ["onPlay:spendFriendlyBuffBuffSelfReady", resolvePaidTriggerBuffSelfReadyEffect],
  ["onPlay:spendBuffsChannelRunes", resolveSpendBuffsChannelRunesEffect],
  ["onPlay:nextSpellEnergyReduction", (game, player, card, spec) => {
    player.nextSpellEnergyReduction = Math.max(player.nextSpellEnergyReduction || 0, spec.amount || 0);
    markEffect(game, card, [card.instanceId], `${player.name}'s next spell costs ${spec.amount || 0} less.`);
    return false;
  }],
  ["onPlay:optionalPowerDraw", resolveOptionalPowerDrawEffect],
  ["onPlay:playSpellFromTrashMaxEnergy", (game, player, card, spec) => chooseTrashSpell(game, player, card, spec)],
  ["conquer:playSpellFromTrashMaxEnergy", (game, player, card, spec) => chooseTrashSpell(game, player, card, spec)],
  ["conquer:payEnergyReturnSelfToHand", resolvePayEnergyReturnSelfToHandEffect],
  ["conquer:readySelf", (game, player, card) => {
    readyUnitWithEffects(game, player, card, card);
    markEffect(game, card, [card.instanceId], `${card.name} readies.`);
    log(game, `${card.name} readies because ${player.name} conquered.`);
    return false;
  }],
  ["conquer:drawIfUnitsAtBattlefield", (game, player, card, spec) => {
    const battlefield = game.battlefields.find((field) => field.instanceId === spec.battlefieldId);
    const count = battlefield?.units.filter((unit) => unit.controllerId === player.id).length || 0;
    if (count < (spec.minUnits || 4)) return false;
    draw(player, spec.amount || 2, game);
    markEffect(game, card, [card.instanceId, battlefield.instanceId], `${card.name} draws for the conquest.`);
    log(game, `${card.name} draws ${spec.amount || 2} because ${player.name} controls ${count} units there.`);
    return false;
  }],
  ["conquer:scoreIfExcessDamage", (game, player, card, spec) => {
    const assigned = card.lastConquerExcessDamage || 0;
    delete card.lastConquerExcessDamage;
    if (assigned < (spec.excessDamage || 5)) return false;
    player.score += spec.amount || 1;
    log(game, `${card.name} scores ${spec.amount || 1} extra point for ${assigned} excess combat damage.`);
    markEffect(game, card, [card.instanceId], `${card.name} scores for excess damage.`);
    return false;
  }],
  ["onPlay:playUnitFromTrash", (game, player, card, spec, finishSpell) => chooseTrashUnitToPlay(game, player, card, spec, finishSpell)],
  ["onPlay:playUnitToken", (game, player, card, spec) => {
    playUnitToken(game, player, card, { ...spec, destination: spec.destination || "sourceBattlefield" });
    return false;
  }],
  ["onPlay:readySelf", (game, player, card) => {
    readyUnitWithEffects(game, player, card, card);
    markEffect(game, card, [card.instanceId], `${card.name} readies.`);
    return false;
  }],
  ["onPlay:readyUnit", (game, player, card, spec, finishSpell) => chooseReadyUnit(game, player, card, spec.target === "anotherUnit", finishSpell)],
  ["onPlay:returnBattlefieldUnitToHand", (game, player, card, spec, finishSpell) => chooseReturnUnitToHand(game, player, card, "battlefield", finishSpell, spec)],
  ["onPlay:returnTrashUnitToHand", (game, player, card, spec, finishSpell) => chooseTrashUnitToHand(game, player, card, spec, finishSpell)],
  ["onPlay:discardOpponentHand", (game, player, card, spec, finishSpell) => chooseOpponentHandDiscard(game, player, card, spec, finishSpell)],
  ["onPlay:returnUnitToBase", (game, player, card, spec, finishSpell) => chooseReturnUnitToBase(game, player, card, spec.target || "battlefield", finishSpell, spec)],
  ["onPlay:stealEnemyGear", resolveStealEnemyGearEffect],
  ["onPlay:stunUnit", (game, player, card, spec, finishSpell) => chooseStunUnit(game, player, card, false, finishSpell, spec.target === "unit" ? "any" : "enemy", spec)],
  ["onPlay:stunOrKillEnemy", (game, player, card, spec, finishSpell) => chooseStunOrKillEnemy(game, player, card, spec, finishSpell)],
  ["onPlay:modifySelfMight", resolveModifySelfMightEffect],
  ["onPlay:swapWithControlledUnit", (game, player, card, spec) => chooseTideturnerSwap(game, player, card, spec)],
  ["spell:alphaStrike", (game, player, card) => chooseAlphaStrike(game, player, card)],
  ["spell:chooseTopDeck", (game, player, card, spec, finishSpell) => chooseTopDeckCard(game, player, card, finishSpell)],
  ["spell:counterSpell", (game, player, card, spec, finishSpell) => chooseCounterChain(game, player, card, finishSpell, spec)],
  ["spell:counterUnlessPayEnergy", (game, player, card, spec, finishSpell) => chooseCounterUnlessPay(game, player, card, finishSpell, spec)],
  ["spell:banishFriendlyUnitPlayToBase", (game, player, card, spec, finishSpell) => chooseBanishFriendlyUnitPlayToBase(game, player, card, finishSpell)],
  ["spell:dealDamageUnit", (game, player, card, spec, finishSpell) => chooseDamageUnitBySpec(game, player, card, spec, finishSpell)],
  ["spell:dealDamageAllBattlefieldUnits", resolveDealDamageAllBattlefieldUnitsEffect],
  ["spell:dealDamageAllEnemyUnitsAtBattlefield", (game, player, card, spec, finishSpell) => chooseBattlefieldForEnemyAreaDamage(game, player, card, spec, finishSpell)],
  ["spell:duelFriendlyEnemy", (game, player, card, spec, finishSpell) => chooseDuelFriendlyEnemy(game, player, card, spec, finishSpell)],
  ["spell:discardHandDraw", resolveDiscardHandDrawEffect],
  ["spell:discardEnergyDamageUnit", (game, player, card, spec, finishSpell) => chooseDiscardEnergyDamageUnit(game, player, card, finishSpell)],
  ["spell:extraTurn", resolveExtraTurnEffect],
  ["spell:draw", resolveDrawEffect],
  ["spell:channelRunes", resolveChannelRunesEffect],
  ["spell:channelRunesOrDraw", resolveChannelRunesOrDrawEffect],
  ["spell:enGarde", (game, player, card, spec, finishSpell) => chooseEnGarde(game, player, card, finishSpell)],
  ["spell:exhaustFriendlyUnits", resolveExhaustFriendlyUnitsEffect],
  ["spell:killDamagedUnitsThisTurn", resolveKillDamagedUnitsThisTurnEffect],
  ["spell:killOnNextDamageOrNowIfLegion", (game, player, card, spec, finishSpell) => chooseKillOnNextDamageOrNowIfLegion(game, player, card, finishSpell)],
  ["spell:preventSpellAbilityDamageThisTurn", resolvePreventSpellAbilityDamageThisTurnEffect],
  ["spell:killBattlefieldUnitsTotalMightMax", (game, player, card, spec, finishSpell) => chooseBattlefieldForLimitedKill(game, player, card, spec, finishSpell)],
  ["spell:damageEnemyUnitsAtBattlefieldByReadyRunes", (game, player, card, spec, finishSpell) => chooseBattlefieldForRuneDamage(game, player, card, spec, finishSpell)],
  ["spell:returnHiddenTrashToHand", (game, player, card, spec, finishSpell) => chooseHiddenTrashToHand(game, player, card, spec, finishSpell)],
  ["spell:playOpponentTopDeckCard", resolvePlayOpponentTopDeckCardEffect],
  ["spell:playTopDeckUnitFromLook", resolvePlayTopDeckUnitFromLookEffect],
  ["spell:gainControlOfSpell", (game, player, card, spec, finishSpell) => chooseGainControlOfSpell(game, player, card, finishSpell, spec)],
  ["spell:eachPlayerTopDeckBanishPlay", resolveEachPlayerTopDeckBanishPlayEffect],
  ["spell:dragonsRage", (game, player, card, spec, finishSpell) => chooseMoveUnitSpell(game, player, card, "enemy", finishSpell, spec)],
  ["spell:divineJudgment", resolveDivineJudgmentEffect],
  ["spell:giveTemporaryGear", (game, player, card, spec, finishSpell) => chooseTemporaryGear(game, player, card, finishSpell, spec)],
  ["spell:giveTemporaryUnitOrGear", (game, player, card, spec, finishSpell) => chooseTemporaryUnitOrGear(game, player, card, finishSpell, spec)],
  ["spell:giveKeyword", (game, player, card, spec, finishSpell) => chooseGiveKeyword(game, player, card, spec, finishSpell)],
  ["spell:doubleMightTemporary", (game, player, card, spec, finishSpell) => chooseDoubleMightTemporary(game, player, card, spec, finishSpell)],
  ["spell:killAllGear", resolveKillAllGearEffect],
  ["spell:killGear", (game, player, card, spec, finishSpell) => chooseGearToTrash(game, player, card, finishSpell, spec)],
  ["spell:eachPlayerKillGear", (game, player, card, spec, finishSpell) => chooseEachPlayerKillPermanent(game, player, card, "gear", finishSpell, spec)],
  ["spell:eachPlayerKillUnit", (game, player, card, spec, finishSpell) => chooseEachPlayerKillPermanent(game, player, card, "unit", finishSpell, spec)],
  ["spell:eachOtherPlayerKillUncontrolledUnit", (game, player, card, spec, finishSpell) => chooseEachOtherPlayerKillUncontrolledUnit(game, player, card, finishSpell)],
  ["spell:killUnit", (game, player, card, spec, finishSpell) => chooseKillUnitBySpec(game, player, card, spec, finishSpell)],
  ["spell:matchFriendlyMight", (game, player, card, spec, finishSpell) => chooseMatchFriendlyMight(game, player, card, spec, finishSpell)],
  ["spell:modifyMight", (game, player, card, spec, finishSpell) => chooseMightBySpec(game, player, card, spec, finishSpell)],
  ["spell:modifyFriendlyUnits", resolveModifyFriendlyUnitsEffect],
  ["spell:spendBuffsReadyThenBuffFriendlyUnits", resolveSpendBuffsReadyThenBuffFriendlyUnitsEffect],
  ["spell:readyUnitAny", (game, player, card, spec, finishSpell) => chooseReadyUnitAny(game, player, card, finishSpell)],
  ["spell:saveFriendlyUnitThisTurn", (game, player, card, spec, finishSpell) => chooseSaveFriendlyUnitThisTurn(game, player, card, spec, finishSpell)],
  ["spell:playUnitToken", (game, player, card, spec, finishSpell) => {
    if (spec.destination === "chooseEachBaseOrControlledBattlefield") {
      return chooseEachTokenDestination(game, player, card, spec, finishSpell);
    }
    playUnitToken(game, player, card, {
      ...spec,
      destination: spec.destination || (card.hiddenBattlefieldId ? "hiddenBattlefield" : "showdownBattlefield")
    });
    return false;
  }],
  ["spell:playUnitFromTrash", (game, player, card, spec, finishSpell) => chooseTrashUnitToPlay(game, player, card, spec, finishSpell)],
  ["spell:partyFavors", (game, player, card, spec, finishSpell) => choosePartyFavors(game, player, card, finishSpell)],
  ["spell:moonfall", (game, player, card, spec, finishSpell) => chooseMoonfall(game, player, card, finishSpell)],
  ["spell:possession", (game, player, card, spec, finishSpell) => choosePossession(game, player, card, finishSpell)],
  ["spell:lastBreath", (game, player, card, spec, finishSpell) => chooseLastBreath(game, player, card, finishSpell)],
  ["spell:zenithBlade", (game, player, card, spec, finishSpell) => chooseZenithBlade(game, player, card, finishSpell)],
  ["spell:showstopper", (game, player, card, spec, finishSpell) => chooseShowstopper(game, player, card, finishSpell)],
  ["spell:stormbringer", (game, player, card, spec, finishSpell) => chooseStormbringer(game, player, card, finishSpell)],
  ["spell:siphonPower", (game, player, card, spec, finishSpell) => chooseSiphonPower(game, player, card, finishSpell)],
  ["spell:standUnited", (game, player, card, spec, finishSpell) => chooseStandUnited(game, player, card, finishSpell)],
  ["spell:facebreaker", (game, player, card, spec, finishSpell) => chooseFacebreaker(game, player, card, finishSpell)],
  ["spell:moveFriendlyAndReady", (game, player, card) => chooseMoveFriendly(game, player, card)],
  ["spell:moveFriendlyUnitsToBase", (game, player, card, spec, finishSpell) => chooseReturnUnitToBase(game, player, card, "friendlyBattlefield", finishSpell, spec)],
  ["spell:moveUnit", (game, player, card, spec, finishSpell) => chooseMoveUnitSpell(game, player, card, "enemy", finishSpell, spec)],
  ["spell:recycleOpponentNonUnit", (game, player, card, spec, finishSpell) => chooseSabotage(game, player, card, finishSpell)],
  ["spell:returnBattlefieldUnitToHand", (game, player, card, spec, finishSpell) => chooseReturnUnitToHand(game, player, card, "battlefield", finishSpell, spec)],
  ["spell:eachPlayerReturnUnitToHand", (game, player, card, spec, finishSpell) => chooseEachPlayerReturnUnitToHand(game, player, card, finishSpell)],
  ["spell:returnTrashUnitToHand", (game, player, card, spec, finishSpell) => chooseTrashUnitToHand(game, player, card, spec, finishSpell)],
  ["spell:returnUnitToBase", (game, player, card, spec, finishSpell) => chooseReturnUnitToBase(game, player, card, spec.target || "battlefield", finishSpell, spec)],
  ["spell:returnFriendlyAndEnemyToHand", (game, player, card, spec, finishSpell) => chooseStarCrossed(game, player, card, finishSpell)],
  ["spell:stunOrReturnAttackingEnemy", (game, player, card, spec, finishSpell) => chooseStunUnit(game, player, card, false, finishSpell, "attackingEnemy", { ...spec, returnIfStunned: true })],
  ["spell:stunUnit", (game, player, card, spec, finishSpell) => chooseStunUnit(game, player, card, false, finishSpell, spec.target === "unit" ? "any" : "enemy", spec)],
  ["spell:unitsEnterReadyThisTurn", (game, player, card) => {
    player.unitsEnterReadyThisTurn = true;
    markEffect(game, card, [card.instanceId], `${player.name}'s units enter ready this turn.`);
    return false;
  }]
]);

export function resolveEffect(game, player, card) {
  const specs = cardEffects(card, "spell");
  if (specs.length) return resolveEffectSpecs(game, player, card, specs, true);
  return false;
}

function resolveEffectSpecs(game, player, card, specs, finishSpell) {
  const scope = enterGameEffectResolution(game, game.resolvingChainContext || null);
  if (chainCardLeftDuringResolution(card)) {
    stopChainCardResolution(game, card);
    leaveGameEffectResolution(game, scope, false);
    return true;
  }
  let waitsForChoice = false;
  for (let index = 0; index < specs.length; index += 1) {
    const isLast = index === specs.length - 1;
    waitsForChoice = resolveEffectSpec(game, player, card, specs[index], finishSpell && isLast);
    if (chainCardLeftDuringResolution(card)) {
      stopChainCardResolution(game, card);
      leaveGameEffectResolution(game, scope, false);
      return true;
    }
    if (!waitsForChoice) continue;
    const pending = game.pendingChoice || game.pendingPayment;
    if (pending && !isLast) {
      pending.effectSequenceContinuation = {
        playerId: player.id,
        card,
        specs: structuredClone(specs.slice(index + 1)),
        finishSpell
      };
    }
    leaveGameEffectResolution(game, scope, true);
    return true;
  }
  leaveGameEffectResolution(game, scope, false);
  return false;
}

function resolveEffectSpec(game, player, card, spec, finishSpell) {
  const resolver = EFFECT_RESOLVERS.get(effectResolverKey(card, spec));
  if (resolver) return resolver(game, player, card, spec, finishSpell);
  log(game, `${card.name} has no registered resolver for ${effectResolverKey(card, spec)}.`);
  return false;
}

function effectResolverKey(card, spec) {
  const timing = spec.timing || (card.type === "spell" ? "spell" : "onPlay");
  return `${timing}:${spec.kind}`;
}

function resolveAddEnergyEffect(game, player, card, spec) {
  if (spec.requiresLegion && player.cardsPlayedThisTurn <= 0) {
    log(game, `${card.name} needs Legion to add Energy.`);
    return false;
  }
  addEnergyToPool(player, spec.amount || 1, {
    domains: spec.domains || card.domains || ["Any"],
    sourceCardId: card.instanceId,
    sourceName: card.name,
    restriction: spec.restriction ?? null
  });
  log(game, `${card.name} adds ${spec.amount || 1} Energy.`);
  markEffect(game, card, [card.instanceId], `${card.name} adds Energy.`);
  return false;
}

function resolveAddPowerEffect(game, player, card, spec) {
  const amount = Math.max(0, spec.amount || 1);
  const domain = spec.domain || "Any";
  for (let index = 0; index < amount; index += 1) {
    addPowerToPool(player, domain, {
      index,
      sourceCardId: card.instanceId,
      sourceName: card.name
    });
  }
  log(game, `${card.name} adds ${amount} ${domain} Power.`);
  markEffect(game, card, [card.instanceId], `${card.name} adds Power.`);
  return false;
}

function resolvePayEnergyReturnSelfToHandEffect(game, player, card, spec) {
  if (!spec.triggerCostPaid || !findUnitLocation(game, card.instanceId)) return false;
  returnUnitToHand(game, card, card.name);
  markEffect(game, card, [card.instanceId], `${card.name} returns after its Energy cost was paid before finalization.`);
  return false;
}

function resolvePaidTriggerBuffSelfReadyEffect(game, player, card, spec) {
  if (!spec.triggerCostPaid) return false;
  addMightModifier(card, 1, { buff: true, maxBuffs: 1 });
  readyUnitWithEffects(game, player, card, card);
  log(game, `${card.name} buffs and readies after a Buff was spent before its trigger finalized.`);
  markEffect(game, card, [card.instanceId, spec.triggerCostSelectionId].filter(Boolean), `${card.name} buffs and readies.`);
  return false;
}

function resolvePayEnergyReturnSelfToHandChoice({ game, choice, option, player, source }) {
  if (option.id !== "pay" || !payEnergyIfPossible(game, player, choice.data.amount || 1, true)) return;
  payEnergyIfPossible(game, player, choice.data.amount || 1);
  returnUnitToHand(game, source, source.name);
  markEffect(game, source, [source.instanceId], `${source.name} returns to its owner's hand.`);
}

function resolveDiscardReturnSelfFromTrashChoice({ game, option, player, source }) {
  if (option.id === "decline" || !option.cardId) return;
  const handIndex = player.hand.findIndex((card) => card.instanceId === option.cardId);
  const trashIndex = player.trash.findIndex((card) => card.instanceId === source.instanceId);
  if (handIndex < 0 || trashIndex < 0) return;
  const [discarded] = discardCardsFromHand(game, player, [player.hand[handIndex]], source);
  triggerDiscardEffects(game, player, [discarded], source);
  const currentSourceIndex = player.trash.findIndex((card) => card.instanceId === source.instanceId);
  if (currentSourceIndex < 0) return;
  const [returned] = player.trash.splice(currentSourceIndex, 1);
  markNonBoardZoneChange(returned);
  player.hand.push(returned);
  log(game, `${player.name} discards ${discarded.name} and returns ${source.name} to hand.`);
  markEffect(game, source, [discarded.instanceId, source.instanceId], `${source.name} returns from trash.`);
}

function resolveDrawEffect(game, player, card, spec) {
  const amount = card.paidFriendlyExhaustAdditionalCost && spec.amountIfFriendlyExhaustAdditionalCost
    ? spec.amountIfFriendlyExhaustAdditionalCost
    : (spec.amount || 1);
  draw(player, amount, game);
  markEffect(game, card, [card.instanceId], `${card.name} draws ${amount}.`);
  return false;
}

function resolveExtraTurnEffect(game, player, card) {
  scheduleAdditionalTurn(game, player.id);
  card.banishAfterResolve = true;
  log(game, `${player.name} will take an extra turn after this one.`);
  markEffect(game, card, [card.instanceId], `${player.name} takes an extra turn.`);
  return false;
}

export function scheduleAdditionalTurn(game, playerId) {
  if (!game.players.some((player) => player.id === playerId)) return false;
  game.additionalTurnQueue ||= [];
  // Each new turn is inserted immediately after the current turn, ahead of
  // additional turns that were already waiting there (Core Rules 738).
  game.additionalTurnQueue.unshift(playerId);
  return true;
}

function resolveDrawPerFriendlyMightyUnitEffect(game, player, card, spec) {
  const threshold = spec.threshold || 5;
  const targets = allUnits(game).filter((unit) => unit.controllerId === player.id && currentMight(game, unit) >= threshold);
  draw(player, targets.length, game);
  markEffect(game, card, [card.instanceId, ...targets.map((unit) => unit.instanceId)], `${card.name} draws for Mighty units.`);
  log(game, `${card.name} draws ${targets.length} for friendly Mighty units.`);
  return false;
}

function resolvePreventOpponentsPlayCardsEffect(game, player, card) {
  for (const opponent of game.players.filter((candidate) => candidate.id !== player.id)) {
    opponent.cannotPlayCardsUntilTurnSequence = game.turnSequence || 0;
  }
  log(game, `${card.name} prevents opponents from playing cards this turn.`);
  markEffect(game, card, [card.instanceId], `${card.name} locks opposing plays.`);
  return false;
}

function resolveMoveEnemyToThisBattlefieldEffect(game, player, card, spec, finishSpell = false) {
  const location = findUnitLocation(game, card.instanceId);
  if (location?.type !== "battlefield") return false;
  const battlefield = location.battlefield;
  const targets = allUnits(game)
    .filter((unit) => unit.controllerId !== player.id)
    .filter((unit) => !battlefield.units.some((candidate) => candidate.instanceId === unit.instanceId))
    .filter((unit) => canChooseUnit(game, player, card, unit));
  if (!targets.length) return false;
  const options = targets.map(cardOption);
  const declared = consumeDeclaredPlayTarget(card, "moveUnitToSourceBattlefield", options);
  if (declared) {
    if (declared.option) {
      applyChoiceEffect(game, {
        id: `choice-${Date.now()}-${Math.random()}`,
        playerId: player.id,
        card,
        effect: "moveUnitToSourceBattlefield",
        options,
        data: { battlefieldId: battlefield.instanceId },
        finishSpell,
        optional: false,
        fromShowdownChain: false
      }, declared.option);
    } else {
      log(game, `${card.name}'s declared target is no longer legal.`);
    }
    return false;
  }
  return promptChoice(game, player, card, {
    effect: "moveUnitToSourceBattlefield",
    prompt: `Choose an enemy unit to move to ${battlefield.name}.`,
    options: [
      ...options,
      ...(spec.optional !== false ? [{ id: "decline", label: "Do not move a unit" }] : [])
    ],
    finishSpell,
    optional: false,
    data: { battlefieldId: battlefield.instanceId }
  });
}

function resolveChannelRunesEffect(game, player, card, spec) {
  const amount = spec.amount || 1;
  channelRunes(game, player, amount, {
    exhausted: spec.exhausted !== false,
    source: card,
    reason: "effect"
  });
  markEffect(game, card, [card.instanceId], `${card.name} channels ${amount}.`);
  log(game, `${card.name} channels ${amount} rune${amount === 1 ? "" : "s"}.`);
  return false;
}

function resolveChannelRunesOrDrawEffect(game, player, card, spec) {
  const amount = spec.amount || 1;
  const before = player.runes.length;
  channelRunes(game, player, amount, {
    exhausted: spec.exhausted !== false,
    source: card,
    reason: "effect"
  });
  const channeled = player.runes.length - before;
  if (channeled < amount) {
    draw(player, spec.draw || 1, game);
    log(game, `${card.name} could not channel ${amount}, so ${player.name} draws ${spec.draw || 1}.`);
  } else {
    log(game, `${card.name} channels ${amount} rune${amount === 1 ? "" : "s"}.`);
  }
  markEffect(game, card, [card.instanceId], `${card.name} channels or draws.`);
  return false;
}

function resolveDiscardEffect(game, player, card, spec, finishSpell) {
  return chooseDiscardCards(game, player, card, {
    amount: spec.amount || 1,
    draw: spec.draw || 0,
    finishSpell
  });
}

function resolveDiscardDrawEffect(game, player, card, spec, finishSpell) {
  return chooseDiscardCards(game, player, card, {
    amount: spec.discard || 0,
    draw: spec.draw || 0,
    finishSpell
  });
}

function resolveModifySelfMightEffect(game, player, card, spec) {
  addMightModifier(card, spec.amount || 0, { buff: Boolean(spec.buff), maxBuffs: spec.maxBuffs, temporary: isTemporaryMightEffect(card, spec) });
  markEffect(game, card, [card.instanceId], `${card.name} gets ${spec.amount || 0} Might.`);
  log(game, `${card.name} gets ${spec.amount || 0} Might.`);
  return false;
}

function resolveOptionalPowerDrawEffect(game, player, card, spec) {
  if (Array.isArray(card.paidOptionalPowerEffects)) {
    const paidIndex = card.paidOptionalPowerEffects.findIndex((effect) =>
      effect.kind === "optionalPowerDraw"
      && effect.domain === (spec.domain || "Any")
      && (effect.draw || 1) === (spec.draw || 1)
    );
    if (paidIndex < 0) return false;
    card.paidOptionalPowerEffects.splice(paidIndex, 1);
    draw(player, spec.draw || 1, game);
    log(game, `${card.name} paid additional ${spec.domain || "Any"} Power and draws ${spec.draw || 1}.`);
    markEffect(game, card, [card.instanceId], `${card.name} draws ${spec.draw || 1}.`);
    return false;
  }
  return chooseOptionalPowerDraw(game, player, card, spec);
}

function resolveBuffSelfDrawIfControlTagEffect(game, player, card, spec) {
  const tag = spec.tag;
  const controlsTag = allControlledCards(game, player.id)
    .some((candidate) => candidate.instanceId !== card.instanceId && candidate.tags?.includes(tag));
  if (!controlsTag) {
    log(game, `${card.name} does not find a friendly ${tag}.`);
    return false;
  }
  buffUnitWithEffects(game, player, card, card, spec.amount || 1, { maxBuffs: spec.maxBuffs });
  if (spec.draw) draw(player, spec.draw, game);
  log(game, `${card.name} is buffed and draws ${spec.draw || 0}.`);
  markEffect(game, card, [card.instanceId], `${card.name} is buffed.`);
  return false;
}

function resolveExhaustFriendlyUnitsEffect(game, player, card) {
  const targets = allUnits(game).filter((candidate) => candidate.controllerId === player.id);
  exhaustCards(game, player, card, targets, { reason: "effect" });
  markEffect(game, card, targets.map((unit) => unit.instanceId), `${card.name} exhausts friendly units.`);
  log(game, `${card.name} exhausts all friendly units.`);
  return false;
}

function resolveKillDamagedUnitsThisTurnEffect(game, player, card) {
  player.killDamagedUnitsThisTurn = true;
  markEffect(game, card, [card.instanceId], `${card.name} kills damaged units this turn.`);
  log(game, `${card.name} will kill units that take damage this turn.`);
  return false;
}

function resolvePreventSpellAbilityDamageThisTurnEffect(game, player, card) {
  game.preventSpellAbilityDamageUntilTurnSequence = game.turnSequence || 0;
  markEffect(game, card, [card.instanceId], `${card.name} prevents spell and ability damage this turn.`);
  log(game, `${card.name} prevents spell and ability damage this turn.`);
  return false;
}

function resolvePlayOpponentTopDeckCardEffect(game, player, card, spec, finishSpell = false) {
  const candidates = game.players
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => ({ player: candidate, card: candidate.mainDeck[0] }))
    .filter((entry) => entry.card);
  if (!candidates.length) return false;
  for (const entry of candidates) recordRevealEvent(game, entry.player, [entry.card], card, "mainDeck");
  return continuePlayOpponentTopDeckObservations(game, player, card, {
    candidates: candidates.map((entry) => ({ ownerId: entry.player.id, cardId: entry.card.instanceId })),
    nextIndex: 0,
    finishSpell: Boolean(finishSpell),
    fromShowdownChain: game.phase === "showdown"
  });
}

function continuePlayOpponentTopDeckObservations(game, actingPlayer, source, state) {
  let index = state.nextIndex || 0;
  while (index < (state.candidates || []).length) {
    const entry = state.candidates[index];
    index += 1;
    const owner = game.players.find((candidate) => candidate.id === entry.ownerId);
    const observed = owner?.mainDeck.find((candidate) => candidate.instanceId === entry.cardId);
    if (!owner || !observed) continue;
    return beginObservedTopDeckSelfAbilities(game, owner, [observed], {
      kind: "playOpponentTopDeckCardAdvance",
      sourceCardId: source.instanceId,
      sourceCardSnapshot: structuredClone(source),
      actingPlayerId: actingPlayer.id,
      candidates: structuredClone(state.candidates || []),
      nextIndex: index,
      finishSpell: Boolean(state.finishSpell),
      fromShowdownChain: Boolean(state.fromShowdownChain)
    });
  }
  return presentPlayOpponentTopDeckCard(game, actingPlayer, source, state);
}

function presentPlayOpponentTopDeckCard(game, player, card, state) {
  const candidates = (state.candidates || [])
    .map((entry) => {
      const owner = game.players.find((candidate) => candidate.id === entry.ownerId);
      const observed = owner?.mainDeck.find((candidate) => candidate.instanceId === entry.cardId);
      return owner && observed ? { player: owner, card: observed } : null;
    })
    .filter(Boolean);
  if (!candidates.length) {
    markEffect(game, card, [card.instanceId], `${card.name} finds no revealed card still in its Main Deck.`);
    if (state.finishSpell && card.type === "spell") finishSpell(game, player, card);
    return false;
  }
  return promptChoice(game, player, card, {
    effect: "playRevealedOpponentTopDeck",
    prompt: `Choose an opponent's revealed top card for ${card.name}.`,
    options: candidates.map((entry) => ({
      id: entry.card.instanceId,
      label: entry.card.name,
      cardId: entry.card.instanceId,
      card: entry.card,
      revealed: true
    })),
    finishSpell: Boolean(state.finishSpell),
    optional: false,
    data: {
      revealedCards: candidates.map((entry) => entry.card),
      ownerByCardId: Object.fromEntries(candidates.map((entry) => [entry.card.instanceId, entry.player.id]))
    }
  });
}

function resolvePlayTopDeckUnitFromLookEffect(game, player, card, spec, finishSpell = false) {
  const look = Math.min(spec.look || 5, player.mainDeck.length);
  const seen = player.mainDeck.slice(0, look);
  if (!seen.length) return false;
  return beginObservedTopDeckSelfAbilities(game, player, seen, {
    kind: "playTopDeckUnitFromLook",
    sourceCardId: card.instanceId,
    sourceCardSnapshot: structuredClone(card),
    observedIds: seen.map((candidate) => candidate.instanceId),
    energyReduction: spec.energyReduction || 0,
    finishSpell: Boolean(finishSpell),
    fromShowdownChain: game.phase === "showdown"
  });
}

function continuePlayTopDeckUnitFromLook(game, player, card, continuation) {
  const seen = (continuation.observedIds || [])
    .map((id) => player.mainDeck.find((candidate) => candidate.instanceId === id))
    .filter(Boolean);
  if (!seen.length) return false;
  const units = seen
    .filter((candidate) => candidate.type === "unit")
    .filter((candidate) => canPayReducedEnergyCard(game, player, candidate, continuation.energyReduction || 0));
  if (!units.length) {
    return setPendingChoice(game, {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: player.id,
      card,
      effect: "acknowledgeReveal",
      prompt: `${card.name} finds no unit.`,
      options: [{ id: "continue", label: "Continue" }],
      data: { revealedCards: seen, revealResolution: "recycleLookedCards" },
      finishSpell: Boolean(continuation.finishSpell),
      optional: false,
      fromShowdownChain: Boolean(continuation.fromShowdownChain)
    });
  }
  return promptChoice(game, player, card, {
    effect: "playLookedAtUnit",
    prompt: `Choose a revealed unit to play for ${card.name}, or recycle all cards.`,
    options: [
      ...units.map((unit) => ({ id: unit.instanceId, label: unit.name, cardId: unit.instanceId, card: unit, revealed: true })),
      { id: "decline", label: "Recycle all revealed cards" }
    ],
    finishSpell: Boolean(continuation.finishSpell),
    optional: false,
    data: { revealedCards: seen, energyReduction: continuation.energyReduction || 0 }
  });
}

function resolveEachPlayerTopDeckBanishPlayEffect(game, player, card, spec, finishSpell = false) {
  const playerIds = turnOrderFrom(game, nextPlayerId(game, player.id)).map((candidate) => candidate.id);
  return promptPromisingFutureChoice(game, card, playerIds, 0, spec.look || 5, [], finishSpell);
}

function promptPromisingFutureChoice(game, source, playerIds, index, look, selectedCards, finishSpell) {
  const chooser = game.players.find((candidate) => candidate.id === playerIds[index]);
  if (!chooser) {
    for (const selected of selectedCards) {
      const controller = game.players.find((candidate) => candidate.id === selected.playerId);
      const selectedCard = controller?.banished?.find((candidate) => candidate.instanceId === selected.cardId);
      if (controller && selectedCard) playCardIgnoringEnergyCostFromEffect(game, controller, selectedCard, source);
    }
    markEffect(game, source, [source.instanceId, ...selectedCards.map((entry) => entry.cardId)], `${source.name} plays chosen top deck cards.`);
    return false;
  }
  const seen = chooser.mainDeck.slice(0, Math.min(look, chooser.mainDeck.length));
  if (!seen.length) return promptPromisingFutureChoice(game, source, playerIds, index + 1, look, selectedCards, finishSpell);
  return beginObservedTopDeckSelfAbilities(game, chooser, seen, {
    kind: "promisingFutureChoose",
    sourceCardId: source.instanceId,
    sourceCardSnapshot: structuredClone(source),
    observedIds: seen.map((candidate) => candidate.instanceId),
    playerIds,
    index,
    look,
    selectedCards,
    finishSpell: Boolean(finishSpell),
    fromShowdownChain: game.phase === "showdown"
  });
}

function presentPromisingFutureChoice(game, chooser, source, continuation) {
  const seen = (continuation.observedIds || [])
    .map((id) => chooser.mainDeck.find((candidate) => candidate.instanceId === id))
    .filter(Boolean);
  if (!seen.length) {
    return promptPromisingFutureChoice(
      game,
      source,
      continuation.playerIds || [],
      (continuation.index || 0) + 1,
      continuation.look || 5,
      continuation.selectedCards || [],
      Boolean(continuation.finishSpell)
    );
  }
  return setPendingChoice(game, {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: chooser.id,
    card: source,
    effect: "promisingFutureChoose",
    prompt: `Choose one of your revealed cards for ${source.name}.`,
    options: seen.map((candidate) => ({ id: candidate.instanceId, label: candidate.name, cardId: candidate.instanceId, card: candidate, revealed: true })),
    data: {
      revealedCards: seen,
      playerIds: continuation.playerIds || [],
      index: continuation.index || 0,
      look: continuation.look || 5,
      selectedCards: continuation.selectedCards || []
    },
    finishSpell: Boolean(continuation.finishSpell),
    optional: false,
    fromShowdownChain: game.phase === "showdown"
  });
}

const DIVINE_JUDGMENT_CATEGORIES = Object.freeze(["units", "gear", "runes", "hand"]);

function divineJudgmentCandidates(game, player, category) {
  if (category === "units") return allUnits(game).filter((unit) => unit.controllerId === player.id);
  if (category === "gear") return allGear(game).filter((gear) => gear.controllerId === player.id);
  if (category === "runes") return player.runes;
  return player.hand;
}

function nextDivineJudgmentStage(state) {
  const next = { ...state, selectedIds: [] };
  next.categoryIndex += 1;
  if (next.categoryIndex >= DIVINE_JUDGMENT_CATEGORIES.length) {
    next.categoryIndex = 0;
    next.playerIndex += 1;
  }
  return next;
}

function applyDivineJudgmentRecycle(game, source, kept, runeRecycleOrder = {}) {
  const recycledIds = [];
  for (const candidate of game.players) {
    const recycledMainCards = [];
    const playerKept = kept[candidate.id] || {};
    const keptHand = new Set(playerKept.hand || []);
    const handExcess = candidate.hand.filter((card) => !keptHand.has(card.instanceId));
    candidate.hand = candidate.hand.filter((card) => keptHand.has(card.instanceId));
    recycledIds.push(...handExcess.map((card) => card.instanceId));
    recycledMainCards.push(...handExcess);

    const keptRunes = new Set(playerKept.runes || []);
    const runeExcess = candidate.runes.filter((rune) => !keptRunes.has(rune.instanceId));
    const orderedRuneIds = runeRecycleOrder[candidate.id] || runeExcess.map((rune) => rune.instanceId);
    recyclePowerRunesInChosenOrder(game, candidate, orderedRuneIds);
    recycledIds.push(...runeExcess.map((rune) => rune.instanceId));

    const keptUnits = new Set(playerKept.units || []);
    const unitExcess = allUnits(game).filter((unit) => unit.controllerId === candidate.id && !keptUnits.has(unit.instanceId));
    for (const unit of unitExcess) {
      const owner = game.players.find((entry) => entry.id === unit.ownerId) || candidate;
      const location = findUnitLocation(game, unit.instanceId);
      detachAttachmentsToBase(game, unit, location);
      removeUnitEverywhere(game, unit.instanceId);
      clearBoardState(game, unit);
      unit.controllerId = owner.id;
      recycledMainCards.push(unit);
      recycledIds.push(unit.instanceId);
    }

    const keptGear = new Set(playerKept.gear || []);
    const gearExcess = allGear(game).filter((gear) => gear.controllerId === candidate.id && !keptGear.has(gear.instanceId));
    for (const gear of gearExcess) {
      const owner = game.players.find((entry) => entry.id === gear.ownerId) || candidate;
      removeGearEverywhere(game, gear.instanceId);
      clearBoardState(game, gear);
      gear.controllerId = owner.id;
      recycledMainCards.push(gear);
      recycledIds.push(gear.instanceId);
    }
    recycleMainDeckCards(game, candidate, recycledMainCards, source);
  }
  updateBattlefieldControl(game);
  markEffect(game, source, [source.instanceId, ...recycledIds], `${source.name} recycles excess cards chosen by each player.`);
}

function continueDivineJudgmentRuneOrder(game, source, state) {
  let current = {
    ...state,
    runeOrderPlayerIndex: state.runeOrderPlayerIndex || 0,
    runeRecycleOrder: state.runeRecycleOrder || {},
    selectedRuneOrderIds: state.selectedRuneOrderIds || []
  };
  while (current.runeOrderPlayerIndex < current.playerIds.length) {
    const chooser = game.players.find((candidate) => candidate.id === current.playerIds[current.runeOrderPlayerIndex]);
    if (!chooser) {
      current = { ...current, runeOrderPlayerIndex: current.runeOrderPlayerIndex + 1, selectedRuneOrderIds: [] };
      continue;
    }
    const keptRunes = new Set(current.kept[chooser.id]?.runes || []);
    const excess = chooser.runes.filter((rune) => !keptRunes.has(rune.instanceId));
    if (excess.length <= 1 || !game.interactive) {
      current.runeRecycleOrder[chooser.id] = excess.map((rune) => rune.instanceId);
      current = { ...current, runeOrderPlayerIndex: current.runeOrderPlayerIndex + 1, selectedRuneOrderIds: [] };
      continue;
    }
    const selectedIds = current.selectedRuneOrderIds || [];
    setPendingChoice(game, {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: chooser.id,
      card: source,
      effect: "divineJudgmentRuneOrder",
      prompt: `Choose the next Rune to put on the bottom for ${source.name}.`,
      options: excess.filter((rune) => !selectedIds.includes(rune.instanceId)).map(cardOption),
      data: { ...current, selectedRuneOrderIds: selectedIds },
      finishSpell: Boolean(current.finishSpell),
      optional: false,
      fromShowdownChain: Boolean(current.fromShowdownChain)
    });
    return true;
  }
  applyDivineJudgmentRecycle(game, source, current.kept, current.runeRecycleOrder);
  return false;
}

function continueDivineJudgmentChoice(game, source, state) {
  let current = state;
  while (current.playerIndex < current.playerIds.length) {
    const chooser = game.players.find((candidate) => candidate.id === current.playerIds[current.playerIndex]);
    if (!chooser) {
      current = { ...current, playerIndex: current.playerIndex + 1, categoryIndex: 0, selectedIds: [] };
      continue;
    }
    const category = DIVINE_JUDGMENT_CATEGORIES[current.categoryIndex];
    const candidates = divineJudgmentCandidates(game, chooser, category);
    const selectedIds = current.selectedIds || [];
    if (candidates.length <= 2) {
      current.kept[chooser.id] ||= {};
      current.kept[chooser.id][category] = candidates.map((card) => card.instanceId);
      current = nextDivineJudgmentStage(current);
      continue;
    }
    if (!game.interactive) {
      current.kept[chooser.id] ||= {};
      current.kept[chooser.id][category] = candidates.slice(0, 2).map((card) => card.instanceId);
      current = nextDivineJudgmentStage(current);
      continue;
    }
    game.pendingChoice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: chooser.id,
      card: source,
      effect: "divineJudgmentKeep",
      prompt: `Choose ${2 - selectedIds.length} more ${category} to keep for ${source.name}.`,
      options: candidates.filter((candidate) => !selectedIds.includes(candidate.instanceId)).map(cardOption),
      data: { ...current, selectedIds },
      finishSpell: Boolean(current.finishSpell),
      optional: false,
      fromShowdownChain: Boolean(current.fromShowdownChain)
    };
    return true;
  }
  return continueDivineJudgmentRuneOrder(game, source, current);
}

function resolveDivineJudgmentEffect(game, player, card, spec, finishSpell = false) {
  return continueDivineJudgmentChoice(game, card, {
    playerIds: game.players.map((candidate) => candidate.id),
    playerIndex: 0,
    categoryIndex: 0,
    selectedIds: [],
    kept: {},
    finishSpell,
    fromShowdownChain: game.phase === "showdown"
  });
}

function resolveUdyrChooseModeEffect(game, player, card) {
  const mode = consumeDeclaredPlayChoice(card, "udyrMode", [
    { id: "damage" }, { id: "stun" }, { id: "ready" }, { id: "ganking" }
  ])?.declaration.optionId;
  if (mode === "ready") readyUnitWithEffects(game, player, card, card);
  if (mode === "ganking") card.temporaryKeywords = [...new Set([...(card.temporaryKeywords || []), "Ganking"])] ;
  if (["damage", "stun"].includes(mode)) {
    const declaration = consumeDeclaredPlayTarget(card, `udyr-${mode}`, game.battlefields.flatMap((field) => field.units).map(cardOption));
    const target = declaration?.option ? findCard(game, declaration.option.cardId) : null;
    if (target && mode === "damage") {
      applyDamage(game, player, card, target, 2);
    }
    if (target && mode === "stun") stunUnit(game, player, card, target);
  }
  markEffect(game, card, [card.instanceId], `${card.name} resolves ${mode || "an unavailable"} mode.`);
  return false;
}

function playCardIgnoringCostFromEffect(game, player, played, source, destination = "base", options = {}) {
  return queueEffectPlayedCard(game, player, played, source, destination, {
    ...options,
    ignoreBaseCost: true
  });
}

function queueEffectPlayedCard(game, player, played, source, destination = "base", options = {}) {
  removeMainDeckCards(game, [played]);
  removeCardFromNonBoardZones(game, played.instanceId);
  clearBoardState(game, played);
  played.controllerId = player.id;
  const chainState = game.showdown || ensureActionChain(game, player.id);
  addPendingChainItem(game, chainState, played, player.id, destination, {
    ...options,
    effectPlay: true,
    playProcess: { kind: "cardPlay" },
    declarationsComplete: false
  });
  log(game, `${source.name} starts playing ${played.name} with its instructed cost modification.`);
  if (game.resolvingGameEffect || game.resolvingChainContext || game.resolvingChoiceContext) return true;
  checkState(game);
  if (game.actionChain) maybeAutoPassActionChain(game);
  return true;
}

function canPayReducedEnergyCard(game, player, card, energyReduction = 0) {
  const cost = adjustedCost(game, player, card, { baseEnergyReduction: energyReduction });
  return payEnergyIfPossible(game, player, cost.energy, true) && payPowerRequirements(game, player, cost.power, true);
}

function playCardIgnoringEnergyCostFromEffect(game, player, played, source, energyReduction = Number.POSITIVE_INFINITY) {
  const costOptions = Number.isFinite(energyReduction)
    ? { baseEnergyReduction: energyReduction }
    : { ignoreEnergyBaseCost: true };
  const cost = adjustedCost(game, player, played, costOptions);
  if (!payEnergyIfPossible(game, player, cost.energy, true) || !payPowerRequirements(game, player, cost.power, true)) {
    const owner = game.players.find((candidate) => candidate.id === played.ownerId) || player;
    if (!owner.banished?.some((candidate) => candidate.instanceId === played.instanceId)) {
      banishCards(game, player, [played], source);
    }
    log(game, `${player.name} cannot pay ${played.name}'s remaining cost, so it stays banished.`);
    return false;
  }
  return queueEffectPlayedCard(game, player, played, source, "base", costOptions);
}

function resolveDealDamageAllBattlefieldUnitsEffect(game, player, card, spec) {
  const targets = spec.scope === "enemyCombat"
    ? (game.battlefields.find((field) => field.instanceId === game.showdown?.battlefieldId)?.units || [])
      .filter((unit) => unit.controllerId !== player.id)
    : game.battlefields.flatMap((field) => field.units);
  for (const unit of targets) applyDamage(game, player, card, unit, spec.amount || 0);
  markEffect(game, card, targets.map((unit) => unit.instanceId), `${card.name} deals ${spec.amount} to battlefield units.`);
  log(game, `${card.name} deals ${spec.amount} to all units at battlefields.`);
  return false;
}

function resolveKillAllGearEffect(game, player, card) {
  const gears = allGear(game);
  for (const gear of gears) {
    killGear(game, gear, card);
  }
  markEffect(game, card, gears.map((gear) => gear.instanceId), `${card.name} kills all gear.`);
  log(game, `${card.name} kills all gear.`);
  return false;
}

function resolveDiscardHandDrawEffect(game, player, card, spec) {
  const amount = spec.amount || 0;
  for (const candidate of game.players) {
    const discarded = discardCardsFromHand(game, candidate, [...candidate.hand], card);
    if (discarded.length) triggerDiscardEffects(game, candidate, discarded, card);
    draw(candidate, amount, game);
    log(game, `${card.name} makes ${candidate.name} discard ${discarded.length} and draw ${amount}.`);
  }
  markEffect(game, card, [card.instanceId], `${card.name} resets hands.`);
  return false;
}

function resolveModifyFriendlyUnitsEffect(game, player, card, spec) {
  const targets = allUnits(game).filter((unit) => unit.controllerId === player.id);
  for (const unit of targets) addMightModifier(unit, spec.amount || 0, { temporary: isTemporaryMightEffect(card, spec) });
  markEffect(game, card, targets.map((unit) => unit.instanceId), `${card.name} modifies friendly units.`);
  log(game, `${card.name} gives friendly units ${spec.amount || 0} Might.`);
  return false;
}

function resolveSpendBuffsReadyThenBuffFriendlyUnitsEffect(game, player, card, spec, finishSpell) {
  const options = allUnits(game)
    .filter((unit) => unit.controllerId === player.id && unit.exhausted && (unit.buffs || 0) > 0)
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "spendBuffsReadyThenBuffFriendlyUnits",
    prompt: "Choose each exhausted friendly unit whose Buff you want to spend, or finish choosing.",
    options: [...options, { id: "done", label: "Finish choosing", cardId: null }],
    data: { selectedIds: [] },
    finishSpell
  });
}

function resolveSpendBuffsChannelRunesEffect(game, player, card) {
  const targets = allUnits(game).filter((unit) => unit.controllerId === player.id && (unit.buffs || 0) > 0);
  let spent = 0;
  for (const unit of targets) {
    spent += unit.buffs || 0;
    unit.buffs = 0;
  }
  if (spent > 0) channelRunes(game, player, spent, {
    exhausted: true,
    source: card,
    reason: "effect"
  });
  markEffect(game, card, [card.instanceId, ...targets.map((unit) => unit.instanceId)], `${card.name} spends buffs and channels.`);
  log(game, `${card.name} spends ${spent} buff${spent === 1 ? "" : "s"} and channels ${spent} rune${spent === 1 ? "" : "s"} exhausted.`);
  return false;
}

function resolveModifyEnemyUnitsEffect(game, player, card, spec) {
  const targets = allUnits(game).filter((unit) => unit.controllerId !== player.id);
  for (const unit of targets) {
    const amount = spec.minMight != null && currentMight(game, unit) + (spec.amount || 0) < spec.minMight
      ? spec.minMight - currentMight(game, unit)
      : spec.amount || 0;
    addMightModifier(unit, amount, { temporary: isTemporaryMightEffect(card, spec) });
  }
  markEffect(game, card, targets.map((unit) => unit.instanceId), `${card.name} modifies enemy units.`);
  log(game, `${card.name} gives enemy units ${spec.amount || 0} Might.`);
  return false;
}

function resolveStealEnemyGearEffect(game, player, card, spec) {
  if (spec.additionalPower && !paidOptionalEffect(card, spec)) return false;
  return chooseStealEnemyGear(game, player, card, spec);
}

function resolvePredictEffect(game, player, card) {
  predict(game, player, card);
  log(game, `${card.name} predicts.`);
  markEffect(game, card, [card.instanceId], `${card.name} predicts.`);
  return false;
}

export function hasRequiredPlayTargets(game, player, card, destination = "base") {
  if (card.additionalCost?.kind === "killFriendlyUnit" && !allUnits(game).some((unit) => unit.controllerId === player.id)) return false;
  if (card.type === "unit") {
    if (destination === "base") return true;
    const battlefield = game.battlefields.find((field) => field.instanceId === destination || field.id === destination);
    return Boolean(battlefield && canEnterBattlefield(game, player, card, battlefield));
  }
  const specs = cardEffects(card, "spell");
  return specs.every((spec) => spec.optional || hasRequiredSpecTarget(game, player, card, spec, destination));
}

function hasRequiredSpecTarget(game, player, card, spec, destination = "base") {
  if (!spec || spec.optional) return true;
  const declaration = spellTargetDeclaration(spec);
  if (declaration) {
    if (spec.kind === "alphaStrike" && !game.battlefields.some((field) => field.units.some((unit) => unit.controllerId !== player.id))) {
      return false;
    }
    const steps = (declaration.steps || [declaration])
      .map((step) => ({ spec, declaration: step, destination }));
    return declarationSequenceCanComplete(game, player, card, steps);
  }
  if (spec.kind === "moveFriendlyUnitsToBase") {
    return battlefieldUnitTargets(game, player, "friendlyBattlefield").length > 0;
  }
  if (spec.kind === "enGarde") {
    return allUnits(game).some((unit) => unit.controllerId === player.id);
  }
  if (spec.kind === "readyUnit") {
    return allUnits(game).some((unit) =>
      unit.controllerId === player.id
      && unit.exhausted
      && (spec.target !== "anotherUnit" || unit.instanceId !== card.instanceId)
    );
  }
  if (spec.kind === "recycleOpponentNonUnit") {
    const opponent = game.players.find((candidate) => candidate.id !== player.id);
    return Boolean(opponent?.hand.some((candidate) => candidate.type !== "unit"));
  }
  if (spec.kind === "chooseTopDeck") {
    return player.mainDeck.length > 0;
  }
  if (spec.kind === "giveTemporaryGear") {
    return allGear(game).length > 0;
  }
  if (spec.kind === "returnFriendlyAndEnemyToHand") {
    return allUnits(game).some((unit) => unit.controllerId === player.id)
      && allUnits(game).some((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, card, unit));
  }
  if (spec.kind === "moonfall") {
    return game.battlefields.some((field) => field.units.some((unit) => unit.controllerId === player.id));
  }
  return true;
}

function targetableUnits(game, player, card, scope) {
  return allUnits(game).filter((unit) => {
    if (scope === "friendly" && unit.controllerId !== player.id) return false;
    if (scope === "enemy" && unit.controllerId === player.id) return false;
    if (scope === "battlefield" && !findUnitLocation(game, unit.instanceId)?.battlefield) return false;
    if (scope === "enemyBattlefield" && (unit.controllerId === player.id || !findUnitLocation(game, unit.instanceId)?.battlefield)) return false;
    if (scope === "attackingEnemy") {
      const field = game.showdown && game.battlefields.find((candidate) => candidate.instanceId === game.showdown.battlefieldId);
      if (!field?.units.some((candidate) => candidate.instanceId === unit.instanceId)) return false;
      if (unit.controllerId === player.id || unit.controllerId !== game.showdown?.attackerId) return false;
    }
    if (!hiddenTargetAllowed(game, card, unit)) return false;
    return canChooseUnit(game, player, card, unit);
  });
}

function chooseReadyUnit(game, player, card, anotherOnly, finishSpell = false) {
  const options = allUnits(game)
    .filter((unit) => unit.controllerId === player.id && unit.exhausted && (!anotherOnly || unit.instanceId !== card.instanceId))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "readyUnit",
    prompt: `Choose a unit to ready for ${card.name}.`,
    options,
    finishSpell,
    optional: true
  });
}

function chooseBuffUnit(game, player, card, amount, scope, finishSpell = false, extra = {}) {
  const units = allUnits(game).filter((unit) => {
    if (extra.target === "self" && unit.instanceId !== card.instanceId) return false;
    if (extra.anotherOnly && unit.instanceId === card.instanceId) return false;
    if (extra.exhaustedOnly && !unit.exhausted) return false;
    if (scope === "friendly" && unit.controllerId !== player.id) return false;
    return canChooseUnit(game, player, card, unit);
  });
  return promptChoice(game, player, card, {
    effect: "buffUnit",
    prompt: `Choose a unit to get +${amount} Might from ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    data: {
      amount,
      ...extra,
      remaining: extra.repeat || 1,
      chosenIds: [],
      scope,
      anotherOnly: Boolean(extra.anotherOnly),
      exhaustedOnly: Boolean(extra.exhaustedOnly)
    }
  });
}

function chooseMightBySpec(game, player, card, spec, finishSpell = false) {
  const scope = spec.target === "self" ? "self" : spec.target === "friendlyUnit" ? "friendly" : "any";
  if (spec.spendBuff && (card.buffs || 0) <= 0) {
    log(game, `${card.name} has no buff to spend.`);
    return false;
  }
  const units = allUnits(game).filter((unit) => {
    if (scope === "self" && unit.instanceId !== card.instanceId) return false;
    if (scope === "friendly" && unit.controllerId !== player.id) return false;
    if (!hiddenTargetAllowed(game, card, unit)) return false;
    return canChooseUnit(game, player, card, unit);
  });
  return promptChoice(game, player, card, {
    effect: "modifyMight",
    prompt: `Choose a unit for ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    data: {
      amount: spec.amount,
      draw: spec.draw || 0,
      minMight: spec.minMight || null,
      predict: Boolean(spec.predict),
      remaining: spec.repeat || 1,
      chosenIds: [],
      scope,
      spendBuff: Boolean(spec.spendBuff),
      temporary: isTemporaryMightEffect(card, spec)
    }
  });
}

function chooseGiveKeyword(game, player, card, spec, finishSpell = false) {
  const scope = spec.target === "friendlyUnit" ? "friendly" : "any";
  const units = allUnits(game).filter((unit) => {
    if (scope === "friendly" && unit.controllerId !== player.id) return false;
    return canChooseUnit(game, player, card, unit);
  });
  return promptChoice(game, player, card, {
    effect: "giveKeyword",
    prompt: `Choose a unit to gain ${(spec.keywords || []).join(", ")} from ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    data: { keywords: spec.keywords || [], might: spec.might || 0, tank: Boolean(spec.tank) }
  });
}

function chooseDoubleMightTemporary(game, player, card, spec, finishSpell = false) {
  const units = allUnits(game).filter((unit) => unit.controllerId === player.id && canChooseUnit(game, player, card, unit));
  return promptChoice(game, player, card, {
    effect: "doubleMightTemporary",
    prompt: `Choose a friendly unit for ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    data: { temporary: Boolean(spec.temporary ?? true) }
  });
}

function chooseMatchFriendlyMight(game, player, card, spec, finishSpell = false) {
  const units = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => canChooseUnit(game, player, card, unit));
  return promptChoice(game, player, card, {
    effect: "matchFriendlyMightTarget",
    prompt: `Choose a friendly unit for ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    data: { temporary: isTemporaryMightEffect(card, spec) }
  });
}

function chooseBanishFriendlyUnitPlayToBase(game, player, card, finishSpell = false) {
  const units = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => canChooseUnit(game, player, card, unit));
  return promptChoice(game, player, card, {
    effect: "banishFriendlyUnitPlayToBase",
    prompt: `Choose a friendly unit for ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    data: {}
  });
}

function chooseBaitedHookSacrifice(game, player, card, finishSpell = false) {
  const units = allUnits(game).filter((unit) => unit.controllerId === player.id);
  return promptChoice(game, player, card, {
    effect: "baitedHookSacrifice",
    prompt: `Choose a friendly unit to kill for ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    optional: false,
    data: {}
  });
}

function chooseSpendFriendlyBuffBuffSelfReady(game, player, card, finishSpell = false) {
  const units = allUnits(game)
    .filter((unit) => unit.controllerId === player.id && (unit.buffs || 0) > 0)
    .filter((unit) => canChooseUnit(game, player, card, unit));
  return promptChoice(game, player, card, {
    effect: "spendFriendlyBuffBuffSelfReady",
    prompt: `Choose a friendly buff to spend for ${card.name}, or skip.`,
    options: [
      ...units.map(cardOption),
      { id: "decline", label: "Spend no buff", cardId: null }
    ],
    finishSpell,
    optional: false,
    data: {}
  });
}

function chooseEachOtherPlayerKillUncontrolledUnit(game, player, card, finishSpell = false) {
  const ordered = turnOrderedPlayers(game);
  const currentIndex = ordered.findIndex((candidate) => candidate.id === player.id);
  const playerOrder = [
    ...ordered.slice(currentIndex + 1),
    ...ordered.slice(0, currentIndex)
  ].map((candidate) => candidate.id);
  return promptEachOtherPlayerKillUncontrolledUnit(game, player, card, playerOrder, 0, finishSpell, []);
}

function promptEachOtherPlayerKillUncontrolledUnit(game, sourcePlayer, card, playerOrder, index, finishSpell = false, chosenIds = []) {
  while (index < playerOrder.length) {
    const chooser = game.players.find((candidate) => candidate.id === playerOrder[index]);
    const options = allUnits(game)
      .filter((unit) => unit.controllerId !== sourcePlayer.id)
      .filter((unit) => !chosenIds.includes(unit.instanceId))
      .map(cardOption);
    if (!chooser || !options.length) {
      index += 1;
      continue;
    }
    const choice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: chooser.id,
      card,
      effect: "eachOtherPlayerKillUncontrolledUnit",
      prompt: `Choose a unit ${sourcePlayer.name} does not control for ${card.name}.`,
      options,
      data: { sourcePlayerId: sourcePlayer.id, playerOrder, index, chosenIds },
      finishSpell: Boolean(finishSpell),
      optional: false,
      fromShowdownChain: false
    };
    if (!game.interactive) {
      applyChoiceEffect(game, choice, options[0]);
      return true;
    }
    game.pendingChoice = choice;
    return true;
  }
  return false;
}

function chooseReturnFriendlyPermanentOrHiddenToHand(game, player, card, finishSpell = false) {
  const permanents = allControlledCards(game, player.id)
    .filter((candidate) => candidate.instanceId !== card.instanceId)
    .filter((candidate) => candidate.type === "unit" || candidate.type === "gear");
  const hidden = game.battlefields
    .flatMap((field) => (field.hidden || [])
      .filter((item) => hiddenCardIsControlledBy(item, player.id))
      .map((item) => item.card));
  return promptChoice(game, player, card, {
    effect: "returnFriendlyPermanentOrHiddenToHand",
    prompt: `Choose another friendly card to return for ${card.name}.`,
    options: [...permanents, ...hidden].map(cardOption),
    finishSpell,
    optional: true,
    data: {}
  });
}

function chooseKillFriendlyPermanentChannelRune(game, player, card, finishSpell = false) {
  const options = allControlledCards(game, player.id)
    .filter((candidate) => candidate.instanceId !== card.instanceId)
    .filter((candidate) => candidate.type === "unit" || candidate.type === "gear")
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "killFriendlyPermanentChannelRune",
    prompt: `Choose a friendly unit or gear to kill for ${card.name}.`,
    options,
    finishSpell,
    optional: false,
    data: {}
  });
}

function chooseKillOnNextDamageOrNowIfLegion(game, player, card, finishSpell = false) {
  const targets = targetableUnits(game, player, card, "any");
  return promptChoice(game, player, card, {
    effect: "killOnNextDamageOrNowIfLegion",
    prompt: `Choose a unit for ${card.name}.`,
    options: targets.map(cardOption),
    finishSpell,
    optional: false,
    data: { legion: (player.cardsPlayedThisTurn || 0) > 0 }
  });
}

function chooseDiscardEnergyDamageUnit(game, player, card, finishSpell = false) {
  return promptChoice(game, player, card, {
    effect: "discardEnergyDamage",
    prompt: `Choose a card to discard for ${card.name}.`,
    options: player.hand.map(cardOption),
    finishSpell: Boolean(finishSpell),
    optional: false,
    data: { finishSpell }
  });
}

function chooseEnGarde(game, player, card, finishSpell = false) {
  const units = allUnits(game).filter((unit) => unit.controllerId === player.id);
  return promptChoice(game, player, card, {
    effect: "enGarde",
    prompt: `Choose a friendly unit for ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    data: { amount: 1 }
  });
}

function chooseMightModifier(game, player, card, amount, finishSpell = false) {
  return promptChoice(game, player, card, {
    effect: "modifyMight",
    prompt: `Choose a unit for ${card.name}.`,
    options: allUnits(game).filter((unit) => canChooseUnit(game, player, card, unit)).map(cardOption),
    finishSpell,
    data: { amount }
  });
}

function chooseStunUnit(game, player, card, ping, finishSpell, scope = "enemy", spec = {}) {
  const targets = allUnits(game).filter((unit) => {
    if (scope === "enemy" && unit.controllerId === player.id) return false;
    if (scope === "attackingEnemy") {
      const field = game.showdown && game.battlefields.find((candidate) => candidate.instanceId === game.showdown.battlefieldId);
      if (!field?.units.some((candidate) => candidate.instanceId === unit.instanceId)) return false;
      if (unit.controllerId === player.id || unit.controllerId !== game.showdown?.attackerId) return false;
    }
    if (!hiddenTargetAllowed(game, card, unit)) return false;
    return canChooseUnit(game, player, card, unit);
  });
  return promptChoice(game, player, card, {
    effect: "stunUnit",
    prompt: `Choose a unit for ${card.name}.`,
    options: targets.map(cardOption),
    finishSpell,
    optional: true,
    data: {
      ping,
      draw: spec.draw || (spec.drawIfFromHand && !card.playedFromHidden ? spec.drawIfFromHand : 0),
      returnIfStunned: Boolean(spec.returnIfStunned),
      ...repeatChoiceData(spec)
    }
  });
}

function chooseReturnUnitToBase(game, player, card, scope, finishSpell = false, spec = {}) {
  const targets = battlefieldUnitTargets(game, player, scope)
    .filter((source) => canMoveUnitFromBattlefieldToBase(game, source.unit))
    .filter((source) => canChooseUnit(game, player, card, source.unit));
  return promptChoice(game, player, card, {
    effect: "returnUnitToBase",
    prompt: `Choose a unit to move with ${card.name}.`,
    options: targets.map((source) => cardOption(source.unit)),
    finishSpell,
    optional: Boolean(spec.max),
    data: { max: spec.max || 1, scope }
  });
}

function chooseMoveUnitSpell(game, player, card, scope, finishSpell = false, spec = {}) {
  const units = allUnits(game).filter((unit) => {
    if (scope === "enemy" && unit.controllerId === player.id) return false;
    if (scope === "friendly" && unit.controllerId !== player.id) return false;
    if (!hiddenTargetAllowed(game, card, unit)) return false;
    return canChooseUnit(game, player, card, unit);
  });
  return promptChoice(game, player, card, {
    effect: "moveUnitSpellTarget",
    prompt: `Choose a unit to move with ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    optional: Boolean(spec.optional),
    data: {
      readyAfterMove: Boolean(spec.readyAfterMove),
      duelAnotherEnemyAtDestination: spec.kind === "dragonsRage",
      ...repeatChoiceData(spec)
    }
  });
}

function chooseReturnUnitToHand(game, player, card, scope, finishSpell = false, spec = {}) {
  const targets = battlefieldUnitTargets(game, player, scope)
    .filter((source) => canChooseUnit(game, player, card, source.unit))
    .filter((source) => spec.maxMight == null || currentMight(game, source.unit) <= spec.maxMight);
  return promptChoice(game, player, card, {
    effect: "returnUnitToHand",
    prompt: `Choose a unit to return with ${card.name}.`,
    options: targets.map((source) => cardOption(source.unit)),
    finishSpell,
    data: {
      channelOwner: spec.channelOwner || 0,
      channelOwnerExhausted: spec.channelOwnerExhausted !== false
    }
  });
}

function chooseCounterChain(game, player, card, finishSpell = false, spec = {}) {
  const chain = activeSpellChain(game);
  const options = chain
    .filter((item) => item.card.type === "spell" && item.playerId !== player.id)
    .filter((item) => spec.maxEnergy == null || (item.card.energy || 0) <= spec.maxEnergy)
    .filter((item) => spec.maxPower == null || totalPowerCost(item.card) <= spec.maxPower)
    .map((item) => ({ id: item.card.instanceId, label: item.card.name, cardId: item.card.instanceId }));
  return promptChoice(game, player, card, {
    effect: "counterChainCard",
    prompt: `Choose a spell to counter with ${card.name}.`,
    options,
    finishSpell,
    optional: true
  });
}

function chooseGainControlOfSpell(game, player, card, finishSpell = false) {
  const options = activeSpellChain(game)
    .filter((item) => item.card.type === "spell" && item.playerId !== player.id)
    .map((item) => ({ id: item.card.instanceId, label: item.card.name, cardId: item.card.instanceId }));
  return promptChoice(game, player, card, {
    effect: "gainControlOfChainSpell",
    prompt: `Choose a spell to control with ${card.name}.`,
    options,
    finishSpell,
    optional: false
  });
}

function chooseCounterUnlessPay(game, player, card, finishSpell = false, spec = {}) {
  const chain = activeSpellChain(game);
  const options = chain
    .filter((item) => item.card.type === "spell" && item.playerId !== player.id)
    .map((item) => ({ id: item.card.instanceId, label: `${item.card.name} (controller may pay ${spec.amount || 2})`, cardId: item.card.instanceId }));
  return promptChoice(game, player, card, {
    effect: "counterUnlessPay",
    prompt: `Choose a spell for ${card.name}.`,
    options,
    finishSpell,
    optional: true,
    data: { amount: spec.amount || 2, ...repeatChoiceData(spec) }
  });
}

function chooseSabotage(game, player, card, finishSpell = false) {
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const options = opponent.hand
    .map((candidate) => ({
      id: candidate.instanceId,
      label: `${candidate.name}${candidate.type === "unit" ? " (unit - cannot choose)" : ""}`,
      cardId: candidate.instanceId,
      card: cloneCardForReveal(candidate),
      disabled: candidate.type === "unit",
      revealed: true
    }));
  return promptChoice(game, player, card, {
    effect: "sabotage",
    prompt: `Choose a non-unit card from ${opponent.name}'s hand to recycle.`,
    options,
    finishSpell,
    optional: true,
    data: { opponentId: opponent.id }
  });
}

function chooseTopDeckCard(game, player, card, finishSpell = false) {
  const top = player.mainDeck.slice(0, 3);
  if (!top.length) return false;
  return beginObservedTopDeckSelfAbilities(game, player, top, {
    kind: "chooseTopDeck",
    sourceCardId: card.instanceId,
    sourceCardSnapshot: structuredClone(card),
    observedIds: top.map((candidate) => candidate.instanceId),
    finishSpell: Boolean(finishSpell),
    fromShowdownChain: game.phase === "showdown"
  });
}

function presentChooseTopDeck(game, player, card, continuation) {
  const top = (continuation.observedIds || [])
    .map((id) => player.mainDeck.find((candidate) => candidate.instanceId === id))
    .filter(Boolean);
  if (!top.length) {
    if (continuation.finishSpell && card.type === "spell") finishSpell(game, player, card);
    return false;
  }
  return promptChoice(game, player, card, {
    effect: "chooseTopDeck",
    prompt: `Choose one of the top 3 cards for ${card.name}.`,
    options: top.map((candidate) => ({ id: candidate.instanceId, label: candidate.name, cardId: candidate.instanceId })),
    finishSpell: Boolean(continuation.finishSpell),
    optional: false,
    data: { topCardIds: top.map((candidate) => candidate.instanceId) }
  });
}

function chooseGearToTrash(game, player, card, shouldFinishSpell = false, spec = {}) {
  const gears = allGear(game);
  if (!gears.length && spec.draw) {
    draw(player, spec.draw, game);
    if (shouldFinishSpell) finishSpell(game, player, card);
    log(game, `${card.name} finds no gear and draws ${spec.draw}.`);
    return false;
  }
  return promptChoice(game, player, card, {
    effect: "trashGear",
    prompt: `Choose a gear for ${card.name}.`,
    options: gears.map(cardOption),
    finishSpell: shouldFinishSpell,
    optional: true,
    data: { draw: spec.draw || 0 }
  });
}

function chooseTemporaryGear(game, player, card, finishSpell = false) {
  const gears = allGear(game);
  return promptChoice(game, player, card, {
    effect: "markTemporaryGear",
    prompt: `Choose a gear to make Temporary for ${card.name}.`,
    options: gears.map(cardOption),
    finishSpell,
    optional: true
  });
}

function chooseTemporaryUnitOrGear(game, player, card, finishSpell = false) {
  const targets = [
    ...game.battlefields.flatMap((field) => field.units),
    ...allGear(game)
  ].filter((target) => target.type !== "unit" || canChooseUnit(game, player, card, target));
  return promptChoice(game, player, card, {
    effect: "markTemporaryPermanent",
    prompt: `Choose a battlefield unit or gear to make Temporary for ${card.name}.`,
    options: targets.map(cardOption),
    finishSpell,
    optional: true
  });
}

function chooseDamageEnemyUnit(game, player, card, amount, finishSpell = false) {
  const enemies = allUnits(game).filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, card, unit));
  return promptChoice(game, player, card, {
    effect: "damageUnit",
    prompt: `Choose an enemy unit for ${card.name}.`,
    options: enemies.map(cardOption),
    finishSpell,
    optional: true,
    data: { amount }
  });
}

function chooseDamageUnitBySpec(game, player, card, spec, finishSpell = false) {
  const scope = spec.target === "enemyBattlefieldUnit" ? "enemyBattlefield" : spec.target === "enemyUnit" ? "enemy" : spec.target === "friendlyUnit" ? "friendly" : spec.target === "battlefieldUnit" ? "battlefield" : "any";
  const targets = targetableUnits(game, player, card, scope);
  return promptChoice(game, player, card, {
    effect: "damageUnit",
    prompt: `Choose a unit to take ${spec.amount || 0} damage from ${card.name}.`,
    options: targets.map(cardOption),
    finishSpell,
    optional: Boolean(spec.optional),
    data: {
      amount: spec.amount || 0,
      amountFromSelfMight: Boolean(spec.amountFromSelfMight),
      draw: spec.draw || 0,
      drawIfKilled: spec.drawIfKilled || 0,
      opponentMayDrawInstead: spec.opponentMayDrawInstead || 0,
      remaining: spec.repeat || 1,
      chosenIds: [],
      scope
    }
  });
}

function chooseKillUnitBySpec(game, player, card, spec, finishSpell = false) {
  const scope = spec.target === "enemyBattlefieldUnit" ? "enemyBattlefield" : spec.target === "enemyUnit" ? "enemy" : spec.target === "friendlyUnit" ? "friendly" : spec.target === "battlefieldUnit" ? "battlefield" : "any";
  const targets = targetableUnits(game, player, card, scope);
  return promptChoice(game, player, card, {
    effect: "killUnit",
    prompt: `Choose a unit to kill with ${card.name}.`,
    options: targets.map(cardOption),
    finishSpell,
    optional: Boolean(spec.optional),
    data: {
      drawController: spec.drawController || 0,
      eventModifications: structuredClone(spec.eventModifications || {})
    }
  });
}

function chooseOnPlayDuelEnemy(game, player, card, spec, finishSpell = false) {
  const targets = targetableUnits(game, player, card, spec.target === "enemyUnit" ? "enemy" : "enemyBattlefield");
  return promptChoice(game, player, card, {
    effect: "onPlayDuelEnemy",
    prompt: `Choose an enemy unit for ${card.name}.`,
    options: targets.map(cardOption),
    finishSpell,
    optional: Boolean(spec.optional)
  });
}

function chooseStunOrKillEnemy(game, player, card, spec, finishSpell = false) {
  const targets = targetableUnits(game, player, card, "enemy");
  return promptChoice(game, player, card, {
    effect: "stunOrKillEnemy",
    prompt: `Choose an enemy unit for ${card.name}. Stunned units are killed instead.`,
    options: targets.map(cardOption),
    finishSpell,
    optional: Boolean(spec.optional)
  });
}

function chooseAlphaStrike(game, player, card) {
  const friendly = allUnits(game).filter((unit) => unit.controllerId === player.id);
  return promptChoice(game, player, card, {
    effect: "alphaStrike",
    prompt: "Choose the friendly unit that deals Alpha Strike damage.",
    options: friendly.map(cardOption),
    finishSpell: true,
    optional: true,
    data: { gainXpPerKill: 1 }
  });
}

function chooseStarCrossed(game, player, card, finishSpell = false) {
  const enemies = allUnits(game).filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, card, unit));
  if (!enemies.length) {
    log(game, `${card.name} finds no enemy unit.`);
    if (finishSpell) finishSpell(game, player, card);
    return false;
  }
  const friendly = allUnits(game).filter((unit) => unit.controllerId === player.id);
  return promptChoice(game, player, card, {
    effect: "starCrossed",
    prompt: `Choose the friendly unit for ${card.name}.`,
    options: friendly.map(cardOption),
    finishSpell,
    optional: true
  });
}

function chooseDuelFriendlyEnemy(game, player, card, spec, finishSpell = false) {
  const friendly = allUnits(game).filter((unit) => unit.controllerId === player.id && canChooseUnit(game, player, card, unit));
  return promptChoice(game, player, card, {
    effect: "duelFriendlyEnemy",
    prompt: `Choose the friendly unit for ${card.name}.`,
    options: friendly.map(cardOption),
    finishSpell,
    optional: true,
    data: { amount: spec.amount || 0, temporary: Boolean(spec.temporary) }
  });
}

function chooseEachPlayerKillPermanent(game, player, card, type, shouldFinishSpell = false, spec = {}) {
  const playerOrder = [
    player.id,
    ...game.players.filter((candidate) => candidate.id !== player.id).map((candidate) => candidate.id)
  ];
  return promptEachPlayerKillPermanent(game, card, type, playerOrder, 0, shouldFinishSpell, spec);
}

function promptEachPlayerKillPermanent(game, card, type, playerOrder, index, shouldFinishSpell = false, spec = {}) {
  while (index < playerOrder.length) {
    const chooser = game.players.find((candidate) => candidate.id === playerOrder[index]);
    const options = killPermanentOptionsForPlayer(game, chooser, type);
    if (!options.length) {
      index += 1;
      continue;
    }
    const choice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: chooser.id,
      card,
      effect: "eachPlayerKillPermanent",
      prompt: `Choose one of your ${type === "gear" ? "gear" : "units"} to kill for ${card.name}.`,
      options,
      data: {
        type,
        playerOrder,
        index,
        finishSpell: shouldFinishSpell,
        optional: Boolean(spec.optional)
      },
      finishSpell: false,
      optional: Boolean(spec.optional),
      fromShowdownChain: false
    };
    if (!game.interactive) {
      applyChoiceEffect(game, choice, options[0]);
      return true;
    }
    game.pendingChoice = choice;
    return true;
  }
  if (shouldFinishSpell) {
    const controller = controllerOfCard(game, card);
    if (controller) finishSpell(game, controller, card);
  }
  return false;
}

function chooseEachPlayerReturnUnitToHand(game, player, card, finishSpell = false) {
  const ordered = turnOrderedPlayers(game);
  const currentIndex = ordered.findIndex((candidate) => candidate.id === player.id);
  const playerOrder = [
    ...ordered.slice(currentIndex + 1),
    ...ordered.slice(0, currentIndex + 1)
  ].map((candidate) => candidate.id);
  return promptEachPlayerReturnUnitToHand(game, card, playerOrder, 0, finishSpell);
}

function promptEachPlayerReturnUnitToHand(game, card, playerOrder, index, finishSpell = false) {
  while (index < playerOrder.length) {
    const chooser = game.players.find((candidate) => candidate.id === playerOrder[index]);
    const options = allUnits(game)
      .filter((unit) => unit.controllerId === chooser.id)
      .map(cardOption);
    if (!options.length) {
      index += 1;
      continue;
    }
    const choice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: chooser.id,
      card,
      effect: "eachPlayerReturnUnitToHand",
      prompt: `Choose a unit to return for ${card.name}, or skip.`,
      options: [
        ...options,
        { id: "decline", label: "Return no unit", cardId: null }
      ],
      data: { playerOrder, index, finishSpell },
      finishSpell: Boolean(finishSpell),
      optional: false,
      fromShowdownChain: false
    };
    if (!game.interactive) {
      applyChoiceEffect(game, choice, choice.options.at(-1));
      return true;
    }
    game.pendingChoice = choice;
    return true;
  }
  return false;
}

function choosePartyFavors(game, player, card, finishSpell = false) {
  const playerOrder = game.players
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => candidate.id);
  return promptPartyFavorsChoice(game, player, card, playerOrder, 0, finishSpell);
}

function promptPartyFavorsChoice(game, sourcePlayer, card, playerOrder, index, finishSpell = false) {
  if (index >= playerOrder.length) return false;
  const chooser = game.players.find((candidate) => candidate.id === playerOrder[index]);
  if (!chooser) return promptPartyFavorsChoice(game, sourcePlayer, card, playerOrder, index + 1, finishSpell);
  const choice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: chooser.id,
    card,
    effect: "partyFavors",
    prompt: `Choose Cards or Runes for ${card.name}.`,
    options: [
      { id: "cards", label: "Cards", cardId: null },
      { id: "runes", label: "Runes", cardId: null }
    ],
    data: { sourcePlayerId: sourcePlayer.id, playerOrder, index },
    finishSpell: Boolean(finishSpell),
    optional: false,
    fromShowdownChain: false
  };
  if (!game.interactive) {
    applyChoiceEffect(game, choice, choice.options[0]);
    return true;
  }
  game.pendingChoice = choice;
  return true;
}

function killPermanentOptionsForPlayer(game, player, type) {
  if (!player) return [];
  if (type === "gear") {
    return allGear(game).filter((gear) => gear.controllerId === player.id).map(cardOption);
  }
  return allUnits(game).filter((unit) => unit.controllerId === player.id).map(cardOption);
}

function chooseMoonfall(game, player, card, finishSpell = false) {
  const fields = game.battlefields.filter((field) => field.units.some((unit) => unit.controllerId === player.id));
  return promptChoice(game, player, card, {
    effect: "moonfall",
    prompt: `Choose a battlefield for ${card.name}.`,
    options: fields.map((field) => ({ id: field.instanceId, label: field.name, cardId: field.instanceId })),
    finishSpell
  });
}

function choosePossession(game, player, card, finishSpell = false) {
  const options = battlefieldUnitTargets(game, player, "enemyBattlefield")
    .filter(({ unit }) => canChooseUnit(game, player, card, unit))
    .map(({ unit }) => cardOption(unit));
  return promptChoice(game, player, card, {
    effect: "possession",
    prompt: `Choose an enemy battlefield unit to take with ${card.name}.`,
    options,
    finishSpell
  });
}

function chooseLastBreath(game, player, card, finishSpell = false) {
  const options = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => canChooseUnit(game, player, card, unit))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "lastBreathSource",
    prompt: `Choose a friendly unit to ready for ${card.name}.`,
    options,
    finishSpell
  });
}

function chooseZenithBlade(game, player, card, finishSpell = false) {
  const options = battlefieldUnitTargets(game, player, "enemyBattlefield")
    .filter(({ unit }) => canChooseUnit(game, player, card, unit))
    .map(({ unit }) => cardOption(unit));
  return promptChoice(game, player, card, {
    effect: "zenithBladeEnemy",
    prompt: `Choose an enemy battlefield unit to stun for ${card.name}.`,
    options,
    finishSpell
  });
}

function chooseShowstopper(game, player, card, finishSpell = false) {
  const options = player.base
    .filter((unit) => unit.type === "unit")
    .filter((unit) => canChooseUnit(game, player, card, unit))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "showstopperUnit",
    prompt: `Choose a friendly unit in your base for ${card.name}.`,
    options,
    finishSpell
  });
}

function chooseStormbringer(game, player, card, finishSpell = false) {
  const options = player.base
    .filter((unit) => unit.type === "unit")
    .filter((unit) => canChooseUnit(game, player, card, unit))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "stormbringerUnit",
    prompt: `Choose a friendly unit in your base for ${card.name}.`,
    options,
    finishSpell
  });
}

function chooseSiphonPower(game, player, card, finishSpell = false) {
  return promptChoice(game, player, card, {
    effect: "siphonPowerBattlefield",
    prompt: `Choose a battlefield for ${card.name}.`,
    options: game.battlefields.map(battlefieldOption),
    finishSpell
  });
}

function chooseStandUnited(game, player, card, finishSpell = false) {
  const options = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => canChooseUnit(game, player, card, unit))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "standUnited",
    prompt: `Choose a friendly unit to buff for ${card.name}.`,
    options,
    finishSpell
  });
}

function chooseFacebreaker(game, player, card, finishSpell = false) {
  const friendlyOptions = battlefieldUnitTargets(game, player, "friendlyBattlefield")
    .filter(({ unit, battlefield }) => battlefield.units.some((candidate) => candidate.controllerId !== player.id))
    .filter(({ unit }) => canChooseUnit(game, player, card, unit))
    .map(({ unit }) => cardOption(unit));
  return promptChoice(game, player, card, {
    effect: "facebreakerFriendly",
    prompt: `Choose a friendly battlefield unit to stun for ${card.name}.`,
    options: friendlyOptions,
    finishSpell
  });
}

function chooseReadyUnitAny(game, player, card, finishSpell = false) {
  const options = allUnits(game)
    .filter((unit) => unit.exhausted)
    .filter((unit) => canChooseUnit(game, player, card, unit))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "readyUnitAny",
    prompt: `Choose an exhausted unit to ready for ${card.name}.`,
    options,
    finishSpell
  });
}

function chooseMoveFriendly(game, player, card) {
  const friendly = allUnits(game).filter((unit) => unit.controllerId === player.id);
  return promptChoice(game, player, card, {
    effect: "moveUnitSpellTarget",
    prompt: `Choose a friendly unit to move and ready with ${card.name}.`,
    options: friendly.map(cardOption),
    finishSpell: true,
    optional: true,
    data: { readyAfterMove: true }
  });
}

function chooseOptionalPowerDraw(game, player, card, spec) {
  const options = player.runes
    .filter((rune) => rune.domain === spec.domain)
    .map((rune) => ({ id: rune.instanceId, label: `${rune.domain} Rune`, cardId: rune.instanceId }));
  return promptChoice(game, player, card, {
    effect: "optionalPowerDraw",
    prompt: `Pay an additional ${spec.domain} rune for ${card.name}?`,
    options,
    optional: true,
    data: { draw: spec.draw || 1 }
  });
}

function chooseEquipGear(game, player, card, spec) {
  const units = allUnits(game).filter((unit) => unit.controllerId === player.id);
  return promptChoice(game, player, card, {
    effect: "equipGear",
    prompt: `Choose a unit to equip ${card.name}.`,
    options: units.map(cardOption),
    optional: true,
    data: { domain: spec.domain || null }
  });
}

function chooseStealEnemyGear(game, player, card, spec) {
  const gears = allGear(game)
    .filter((gear) => gear.controllerId !== player.id);
  return promptChoice(game, player, card, {
    effect: "stealEnemyGear",
    prompt: `Choose an enemy gear for ${card.name}.`,
    options: gears.map(cardOption),
    optional: true
  });
}

function chooseTrashSpell(game, player, card, spec) {
  const maxEnergy = trashSpellMaxEnergy(player, spec);
  const options = player.trash
    .filter((candidate) => candidate.type === "spell" && (maxEnergy == null || (candidate.energy || 0) <= maxEnergy))
    .filter((candidate) => payPowerRequirements(game, player, normalizeCardPowerRequirements(candidate, candidate.power || []), true))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "playTrashSpell",
    prompt: `Choose a spell from trash for ${card.name}.`,
    options,
    optional: true,
    data: { maxEnergy }
  });
}

function trashSpellMaxEnergy(player, spec) {
  return spec.maxEnergyFromPoints
    ? Math.max(0, (player.score || 0) - (spec.lessThanPoints ? 1 : 0))
    : spec.maxEnergy;
}

function chooseOwnedTagUnitToHand(game, player, card, spec = {}, finishSpell = false) {
  const tag = spec.tag;
  const options = [
    ...(player.champion && player.champion.zone === "played" && (!tag || player.champion.tags?.includes(tag)) ? [player.champion] : []),
    ...allUnits(game).filter((unit) => unit.ownerId === player.id && (!tag || unit.tags?.includes(tag)))
  ].map(cardOption);
  return promptChoice(game, player, card, {
    effect: "returnOwnedTagUnitToHand",
    prompt: `Choose a ${tag || "unit"} you own to return for ${card.name}.`,
    options,
    optional: true,
    finishSpell
  });
}

function chooseHiddenTrashToHand(game, player, card, spec = {}, finishSpell = false) {
  player.hideIgnoringCostsUntilTurnSequence = game.turnSequence || 0;
  const options = player.trash
    .filter((candidate) => candidate.keywords?.includes("Hidden") || candidate.tags?.includes("Hidden"))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "returnHiddenTrashToHand",
    prompt: `Choose a Hidden card in trash for ${card.name}.`,
    options,
    optional: true,
    finishSpell,
    data: { remaining: spec.amount || 2 }
  });
}

function chooseBattlefieldForLimitedKill(game, player, card, spec = {}, finishSpell = false) {
  return promptChoice(game, player, card, {
    effect: "killBattlefieldUnitsTotalMightMax",
    prompt: `Choose a battlefield for ${card.name}.`,
    options: game.battlefields.map(battlefieldOption),
    optional: true,
    finishSpell,
    data: { maxMight: spec.maxMight || 4 }
  });
}

function chooseBattlefieldForRuneDamage(game, player, card, spec = {}, finishSpell = false) {
  return promptChoice(game, player, card, {
    effect: "damageEnemyUnitsAtBattlefieldByReadyRunes",
    prompt: `Choose a battlefield for ${card.name}.`,
    options: game.battlefields.map(battlefieldOption),
    optional: true,
    finishSpell,
    data: { minDamage: spec.minDamage || 0 }
  });
}

function chooseBattlefieldForEnemyAreaDamage(game, player, card, spec = {}, finishSpell = false) {
  return promptChoice(game, player, card, {
    effect: "dealDamageAllEnemyUnitsAtBattlefield",
    prompt: `Choose a battlefield for ${card.name}.`,
    options: game.battlefields.map(battlefieldOption),
    optional: false,
    finishSpell,
    data: { amount: spec.amount || 0 }
  });
}

function chooseEachTokenDestination(game, player, card, spec = {}, finishSpell = false, remaining = null) {
  const tokensRemaining = remaining ?? Math.max(1, spec.count || 1);
  const options = [
    { id: "base", label: `${player.name}'s base`, cardId: "base" },
    ...game.battlefields.filter((field) => field.controlledBy === player.id).map(battlefieldOption)
  ];
  const choice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card,
    effect: "playUnitTokenDestination",
    prompt: `Choose where to play token ${Math.max(1, (spec.count || 1) - tokensRemaining + 1)} of ${spec.count || 1} for ${card.name}.`,
    options,
    data: { spec: structuredClone(spec), remaining: tokensRemaining },
    finishSpell,
    optional: false,
    fromShowdownChain: game.phase === "showdown"
  };
  if (!game.interactive) {
    applyChoiceEffect(game, choice, options[0]);
    return Boolean(game.pendingChoice);
  }
  game.pendingChoice = choice;
  return true;
}

function chooseSaveFriendlyUnitThisTurn(game, player, card, spec = {}, finishSpell = false) {
  const options = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "saveFriendlyUnitThisTurn",
    prompt: `Choose a friendly unit for ${card.name}.`,
    options,
    optional: true,
    finishSpell,
    data: { domain: spec.domain || null }
  });
}

function chooseTrashUnitToPlay(game, player, card, spec = {}, finishSpell = false) {
  const options = player.trash
    .filter((candidate) => candidate.type === "unit")
    .filter((candidate) => spec.maxEnergy == null || (candidate.energy || 0) <= spec.maxEnergy)
    .filter((candidate) => spec.maxPower == null || totalPowerAmount(candidate.power || []) <= spec.maxPower)
    .filter((candidate) => spec.ignorePowerCost || payPowerRequirements(game, player, normalizeCardPowerRequirements(candidate, candidate.power || []), true))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "playTrashUnit",
    prompt: `Choose a unit in your trash to play for ${card.name}.`,
    options,
    optional: true,
    finishSpell,
    data: {
      ignorePowerCost: Boolean(spec.ignorePowerCost),
      destination: spec.destination || "base"
    }
  });
}

function chooseTrashUnitToHand(game, player, card, spec = {}, finishSpell = false) {
  const cardType = spec.cardType || "unit";
  const options = player.trash
    .filter((candidate) => candidate.type === cardType)
    .filter((candidate) => spec.maxEnergy == null || (candidate.energy || 0) <= spec.maxEnergy)
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "returnTrashUnitToHand",
    prompt: `Choose a ${cardType} in your trash to return for ${card.name}.`,
    options,
    optional: Boolean(spec.optional),
    finishSpell,
    data: { cardType }
  });
}

function chooseOpponentHandDiscard(game, player, card, spec = {}, finishSpell = false) {
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const options = (opponent?.hand || [])
    .filter((candidate) => !spec.nonUnitOnly || candidate.type !== "unit")
    .map(cardOption);
  if (opponent) revealPrivateInfoForTurn(game, player.id, opponent.id, card);
  return promptChoice(game, player, card, {
    effect: "discardOpponentHand",
    prompt: `Choose a card from ${opponent?.name || "opponent"}'s hand for ${card.name}.`,
    options,
    optional: Boolean(spec.optional),
    finishSpell,
    data: { opponentId: opponent?.id || null }
  });
}

function chooseTideturnerSwap(game, player, card, spec) {
  const units = allUnits(game).filter((unit) => unit.controllerId === player.id && unit.instanceId !== card.instanceId);
  return promptChoice(game, player, card, {
    effect: "tideturnerSwap",
    prompt: `Choose a unit to swap with ${card.name}.`,
    options: units.map(cardOption),
    optional: Boolean(spec.optional)
  });
}

function chooseForgeAttachGear(game, player, card) {
  const gears = allGear(game).filter((gear) => gear.controllerId === player.id && gear.tags?.includes("Equipment"));
  return promptChoice(game, player, card, {
    effect: "forgeAttachGear",
    prompt: `Choose an Equipment to attach with ${card.name}.`,
    options: gears.map(cardOption),
    optional: true
  });
}

function promptChoice(game, player, card, config) {
  const choice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card,
    effect: config.effect,
    prompt: config.prompt,
    options: config.options,
    data: {
      ...(config.data || {}),
      deflectPaidTargetIds: [
        ...((config.data || {}).deflectPaidTargetIds || []),
        ...(card.deflectPaidTargetIds || [])
      ]
    },
    finishSpell: Boolean(config.finishSpell),
    optional: Boolean(config.optional),
    fromShowdownChain: game.resolvingChainContext === "showdown"
      || (game.phase === "showdown" && Boolean(config.finishSpell)),
    fromActionChain: game.resolvingChainContext === "action"
  };

  const declaredTarget = consumeDeclaredPlayTarget(card, choice.effect, choice.options);
  if (declaredTarget) {
    if (!declaredTarget.option) {
      log(game, `${card.name}'s declared target is no longer legal.`);
      applyChoiceEffect(game, choice, {
        id: "mistargeted",
        label: "Declared target is no longer legal",
        cardId: null,
        mistargeted: true
      });
      return Boolean(game.pendingChoice || game.pendingPayment);
    }
    applyChoiceEffect(game, choice, declaredTarget.option);
    return Boolean(game.pendingChoice || game.pendingPayment);
  }

  if (!choice.options.length) {
    if (choice.optional) {
      log(game, `${card.name} has no valid target.`);
      if (choice.finishSpell) finishSpell(game, player, card);
      return false;
    }
    log(game, `${card.name} finds no valid target.`);
    if (choice.finishSpell) finishSpell(game, player, card);
    return false;
  }

  const declaredChoice = consumeDeclaredPlayChoice(card, choice.effect, choice.options);
  if (declaredChoice) {
    if (declaredChoice.declaration.optionId === "skip") {
      if (choice.optional) applyChoiceEffect(game, choice, { id: "skip", label: "Skip", cardId: null });
      return Boolean(game.pendingChoice);
    }
    if (!declaredChoice.option) {
      log(game, `${card.name}'s declared choice is no longer legal.`);
      if (choice.finishSpell) finishSpell(game, player, card);
      return false;
    }
    applyChoiceEffect(game, choice, declaredChoice.option);
    return Boolean(game.pendingChoice);
  }

  if (!game.interactive) {
    applyChoiceEffect(game, choice, choice.options[0]);
    return false;
  }

  setPendingChoice(game, choice);
  log(game, `${player.name} chooses an effect target for ${card.name}.`);
  return true;
}

function setPendingChoice(game, choice) {
  game.pendingChoice = choice;
  return true;
}

function presentPreparedChoice(game, choice) {
  const declaredTarget = consumeDeclaredPlayTarget(choice.card, choice.effect, choice.options);
  if (declaredTarget) {
    if (!declaredTarget.option) return false;
    applyChoiceEffect(game, choice, declaredTarget.option);
    return true;
  }
  const declaredChoice = consumeDeclaredPlayChoice(choice.card, choice.effect, choice.options);
  if (declaredChoice) {
    if (declaredChoice.declaration.optionId === "skip") return true;
    if (!declaredChoice.option) return false;
    applyChoiceEffect(game, choice, declaredChoice.option);
    return true;
  }
  if (!game.interactive) {
    applyChoiceEffect(game, choice, choice.options[0]);
    return true;
  }
  return setPendingChoice(game, choice);
}

const CHOICE_RESOLVERS = new Map([
  ["triggerOrder", resolveTriggerOrderChoice],
  ["cleanupFacedownOverflow", resolveCleanupFacedownOverflowChoice],
  ["declareOptionalTrigger", resolveDeclareOptionalTriggerChoice],
  ["declareTriggerCost", resolveDeclareTriggerCostChoice],
  ["deathReplacementSource", resolveDeathReplacementSourceChoice],
  ["deathReplacementEvent", resolveDeathReplacementEventChoice],
  ["acknowledgeReveal", resolveAcknowledgeRevealChoice],
  ["cardPlayedLegendTrigger", resolveCardPlayedLegendTriggerChoice],
  ["payEnergyReturnSelfToHand", resolvePayEnergyReturnSelfToHandChoice],
  ["discardReturnSelfFromTrash", resolveDiscardReturnSelfFromTrashChoice],
  ["declareUdyrMode", resolveDeclareUdyrModeChoice],
  ["declareUdyrTarget", resolveDeclareUdyrTargetChoice],
  ["declareActivatedAbility", resolveDeclareActivatedAbilityChoice],
  ["declareActivatedTarget", resolveDeclareActivatedTargetChoice],
  ["declareActivatedMoveDestination", resolveDeclareActivatedMoveDestinationChoice],
  ["declareActivatedRecycleTrash", resolveDeclareActivatedRecycleTrashChoice],
  ["declarePlayTarget", resolveDeclarePlayTargetChoice],
  ["declareMoveDestination", resolveDeclareMoveDestinationChoice],
  ["declareHiddenPlayTarget", resolveDeclarePlayTargetChoice],
  ["declareHiddenMoveDestination", resolveDeclareMoveDestinationChoice],
  ["repeatSpell", resolveRepeatSpellChoice],
  ["showdownPredictDrawSpell", resolveShowdownPredictDrawSpellChoice],
  ["predictChoice", ({ game, choice, option, player, source }) => resolvePredictChoice(game, player, source, option, choice)],
  ["predictMultipleRecycle", resolvePredictMultipleRecycleChoice],
  ["predictMultipleOrder", resolvePredictMultipleOrderChoice],
  ["playTopRevealedSelf", resolvePlayTopRevealedSelfChoice],
  ["observedTopDeckSelfAbility", resolveObservedTopDeckSelfAbilityChoice],
  ["discardCard", resolveDiscardCardChoice],
  ["playDiscardedSelfFromTrash", resolvePlayDiscardedSelfFromTrashChoice],
  ["playHiddenFromHandIgnoringCost", resolvePlayHiddenFromHandIgnoringCostChoice],
  ["runeDeckGambitFuryDamage", resolveRuneDeckGambitFuryDamageChoice],
  ["payExhaustReadyBuffedUnit", resolvePayExhaustReadyBuffedUnitChoice],
  ["discardEnergyDamage", resolveDiscardEnergyDamageChoice],
  ["drawOrChannelRunes", resolveDrawOrChannelRunesChoice],
  ["optionalChannelRunes", resolveOptionalChannelRunesChoice],
  ["spendBuffDraw", resolveSpendBuffDrawChoice],
  ["returnChosenChampion", resolveReturnChosenChampionChoice],
  ["hweiDiscard", ({ game, choice, option, player, source }) => resolveHweiDiscard(game, player, source, option, choice)],
  ["readyRunes", ({ game, choice, option, player, source }) => resolveReadyRunesChoice(game, player, source, option, choice)],
  ["recycleRunes", resolveRecycleRunesChoice],
  ["recycleTrashCards", resolveRecycleTrashCardsChoice],
  ["exhaustSourceDraw", resolveExhaustSourceDrawChoice],
  ["battlefieldSpellBuff", resolveBattlefieldSpellBuffChoice],
  ["combatDamage", resolveCombatDamageChoice],
  ["stagedEvent", ({ game, choice, option }) => resolveChosenStagedEvent(game, option.id, choice)],
  ["payDeflect", resolvePayDeflectChoice],
  ["readyUnit", resolveReadyUnitChoice],
  ["readyAnotherExhausted", resolveReadyAnotherExhaustedChoice],
  ["baitedHookSacrifice", resolveBaitedHookSacrificeChoice],
  ["baitedHookTopDeck", resolveBaitedHookTopDeckChoice],
  ["spendFriendlyBuffBuffSelfReady", resolveSpendFriendlyBuffBuffSelfReadyChoice],
  ["spendBuffsReadyThenBuffFriendlyUnits", resolveSpendBuffsReadyThenBuffFriendlyUnitsChoice],
  ["killFriendlyPermanentChannelRune", resolveKillFriendlyPermanentChannelRuneChoice],
  ["buffUnit", resolveBuffUnitChoice],
  ["secondDrawBuff", resolveSecondDrawBuffChoice],
  ["enGarde", resolveEnGardeChoice],
  ["modifyMight", resolveModifyMightChoice],
  ["damageUnit", resolveDamageUnitChoice],
  ["killOnNextDamageOrNowIfLegion", resolveKillOnNextDamageOrNowIfLegionChoice],
  ["damageOrDrawInstead", resolveDamageOrDrawInsteadChoice],
  ["giveKeyword", resolveGiveKeywordChoice],
  ["doubleMightTemporary", resolveDoubleMightTemporaryChoice],
  ["matchFriendlyMightTarget", resolveMatchFriendlyMightTargetChoice],
  ["matchFriendlyMightSource", resolveMatchFriendlyMightSourceChoice],
  ["banishFriendlyUnitPlayToBase", resolveBanishFriendlyUnitPlayToBaseChoice],
  ["killUnit", resolveKillUnitChoice],
  ["onPlayDuelEnemy", resolveOnPlayDuelEnemyChoice],
  ["stunOrKillEnemy", resolveStunOrKillEnemyChoice],
  ["stunUnit", resolveStunUnitChoice],
  ["returnUnitToBase", resolveReturnUnitToBaseChoice],
  ["moveUnitSpellTarget", resolveMoveUnitSpellTargetChoice],
  ["moveUnitSpellDestination", resolveMoveUnitSpellDestinationChoice],
  ["dragonsRageEnemy", resolveDragonsRageEnemyChoice],
  ["moveUnitToSourceBattlefield", resolveMoveUnitToSourceBattlefieldChoice],
  ["moveWithFriendlyFromSameBattlefield", resolveMoveWithFriendlyFromSameBattlefieldChoice],
  ["returnUnitToHand", resolveReturnUnitToHandChoice],
  ["returnOwnedTagUnitToHand", resolveReturnOwnedTagUnitToHandChoice],
  ["returnHiddenTrashToHand", resolveReturnHiddenTrashToHandChoice],
  ["killBattlefieldUnitsTotalMightMax", resolveKillBattlefieldUnitsTotalMightMaxChoice],
  ["repairAggregateTargets", resolveRepairAggregateTargetsChoice],
  ["damageEnemyUnitsAtBattlefieldByReadyRunes", resolveDamageEnemyUnitsAtBattlefieldByReadyRunesChoice],
  ["dealDamageAllEnemyUnitsAtBattlefield", resolveDealDamageAllEnemyUnitsAtBattlefieldChoice],
  ["playUnitTokenDestination", resolvePlayUnitTokenDestinationChoice],
  ["saveFriendlyUnitThisTurn", resolveSaveFriendlyUnitThisTurnChoice],
  ["preparedDeathRecallPayment", resolvePreparedDeathRecallPaymentChoice],
  ["returnFriendlyPermanentOrHiddenToHand", resolveReturnFriendlyPermanentOrHiddenToHandChoice],
  ["eachPlayerReturnUnitToHand", resolveEachPlayerReturnUnitToHandChoice],
  ["eachOtherPlayerKillUncontrolledUnit", resolveEachOtherPlayerKillUncontrolledUnitChoice],
  ["partyFavors", resolvePartyFavorsChoice],
  ["returnTrashUnitToHand", resolveReturnTrashUnitToHandChoice],
  ["discardOpponentHand", resolveDiscardOpponentHandChoice],
  ["counterChainCard", resolveCounterChainCardChoice],
  ["gainControlOfChainSpell", resolveGainControlOfChainSpellChoice],
  ["gainControlNewChoices", resolveGainControlNewChoicesChoice],
  ["divineJudgmentKeep", resolveDivineJudgmentKeepChoice],
  ["divineJudgmentRuneOrder", resolveDivineJudgmentRuneOrderChoice],
  ["counterUnlessPay", resolveCounterUnlessPayChoice],
  ["counterUnlessPayDecision", resolveCounterUnlessPayDecisionChoice],
  ["sabotage", resolveSabotageChoice],
  ["playRevealedOpponentTopDeck", resolvePlayRevealedOpponentTopDeckChoice],
  ["playLookedAtUnit", resolvePlayLookedAtUnitChoice],
  ["promisingFutureChoose", resolvePromisingFutureChooseChoice],
  ["chooseTopDeck", resolveChooseTopDeckChoice],
  ["recycleTopDeck", resolveRecycleTopDeckChoice],
  ["trashGear", resolveTrashGearChoice],
  ["markTemporaryGear", resolveMarkTemporaryGearChoice],
  ["markTemporaryPermanent", resolveMarkTemporaryPermanentChoice],
  ["alphaStrike", resolveAlphaStrikeChoice],
  ["splitDamageChooseTarget", resolveSplitDamageChooseTargetChoice],
  ["splitDamageRemoveTarget", resolveSplitDamageRemoveTargetChoice],
  ["splitDamageAllocation", resolveSplitDamageAllocationChoice],
  ["optionalPowerDraw", resolveOptionalPowerDrawChoice],
  ["equipGear", resolveEquipGearChoice],
  ["stealEnemyGear", resolveStealEnemyGearChoice],
  ["playTrashSpell", resolvePlayTrashSpellChoice],
  ["playTrashUnit", resolvePlayTrashUnitChoice],
  ["starCrossed", resolveStarCrossedChoice],
  ["starCrossedEnemy", resolveStarCrossedEnemyChoice],
  ["duelFriendlyEnemy", resolveDuelFriendlyEnemyChoice],
  ["duelEnemy", resolveDuelEnemyChoice],
  ["eachPlayerKillPermanent", resolveEachPlayerKillPermanentChoice],
  ["moonfall", resolveMoonfallChoice],
  ["moonfallMove", resolveMoonfallMoveChoice],
  ["possession", resolvePossessionChoice],
  ["lastBreathSource", resolveLastBreathSourceChoice],
  ["lastBreathEnemy", resolveLastBreathEnemyChoice],
  ["zenithBladeEnemy", resolveZenithBladeEnemyChoice],
  ["zenithBladeFriendly", resolveZenithBladeFriendlyChoice],
  ["showstopperUnit", resolveShowstopperUnitChoice],
  ["showstopperDestination", resolveShowstopperDestinationChoice],
  ["stormbringerUnit", resolveStormbringerUnitChoice],
  ["stormbringerDestination", resolveStormbringerDestinationChoice],
  ["siphonPowerBattlefield", resolveSiphonPowerBattlefieldChoice],
  ["standUnited", resolveStandUnitedChoice],
  ["facebreakerFriendly", resolveFacebreakerFriendlyChoice],
  ["facebreakerEnemy", resolveFacebreakerEnemyChoice],
  ["readyUnitAny", resolveReadyUnitAnyChoice],
  ["tideturnerSwap", resolveTideturnerSwapChoice],
  ["forgeAttachGear", resolveForgeAttachGearChoice],
  ["forgeAttachTarget", resolveForgeAttachTargetChoice]
]);

const DEFLECTABLE_CHOICE_EFFECTS = new Set([
  "readyUnit",
  "buffUnit",
  "secondDrawBuff",
  "enGarde",
  "modifyMight",
  "damageUnit",
  "killUnit",
  "stunUnit",
  "possession",
  "lastBreathEnemy",
  "zenithBladeEnemy",
  "facebreakerEnemy",
  "readyUnitAny",
  "returnUnitToBase",
  "moveUnitSpellTarget",
  "returnUnitToHand",
  "trashGear",
  "markTemporaryGear",
  "alphaStrike",
  "equipGear",
  "stealEnemyGear",
  "starCrossed",
  "starCrossedEnemy",
  "moonfallMove",
  "tideturnerSwap",
  "forgeAttachGear",
  "forgeAttachTarget"
]);

function applyChoiceEffect(game, choice, option) {
  const player = game.players.find((candidate) => candidate.id === choice.playerId);
  const source = choice.card;
  const target = findCard(game, option.cardId);
  const context = { game, choice, option, player, source, target };
  const resolver = choice.data?.declareTrigger
    ? resolveDeclareTriggerChoice
    : CHOICE_RESOLVERS.get(choice.effect) || resolveMissingChoiceEffect;
  if (resolver !== resolveMissingChoiceEffect && maybeResolveDeflectForChoice(context)) return;
  resolver(context);
}

function choiceKillContinuation(choice, option, unitId) {
  const resumedChoice = structuredClone(choice);
  resumedChoice.data = {
    ...(resumedChoice.data || {}),
    completedUnitKillIds: [
      ...(resumedChoice.data?.completedUnitKillIds || []),
      unitId
    ]
  };
  return {
    kind: "resumeChoiceAfterUnitKill",
    choice: resumedChoice,
    option: structuredClone(option)
  };
}

function killUnitForChoice(context, target, source) {
  const { game, choice, option } = context;
  if ((choice.data?.completedUnitKillIds || []).includes(target.instanceId)) return true;
  killUnit(game, target, source, choiceKillContinuation(choice, option, target.instanceId));
  return !game.pendingChoice && !game.pendingPayment;
}

function continueExplicitDeathContinuation(game, continuation) {
  if (!continuation || game.pendingChoice || game.pendingPayment) return false;
  if (continuation.kind === "resumeConfirmedPayment") {
    continueConfirmedPayment(game, continuation.payment);
    return true;
  }
  if (continuation.kind === "resumeUnitKillSequence") {
    continueUnitKillSequence(game, continuation);
    return true;
  }
  if (continuation.kind === "completeDeathSaveReplacement") {
    completeDeathSaveReplacement(game, continuation);
    return true;
  }
  if (continuation.kind !== "resumeChoiceAfterUnitKill") return false;
  applyChoiceEffect(game, continuation.choice, continuation.option);
  if (!game.pendingChoice && !game.pendingPayment
    && continuation.choice.finishSpell && !continuation.choice.effectSequenceContinuation) {
    const player = game.players.find((candidate) => candidate.id === continuation.choice.playerId);
    if (player) finishSpell(game, player, continuation.choice.card);
  }
  return true;
}

function continueUnitKillSequence(game, continuation) {
  while ((continuation.nextIndex || 0) < (continuation.unitIds || []).length) {
    const unitId = continuation.unitIds[continuation.nextIndex];
    continuation.nextIndex += 1;
    const unit = findCard(game, unitId);
    const location = unit ? findUnitLocation(game, unit.instanceId) : null;
    if (!unit || !location) continue;
    killUnit(game, unit,
      location.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location,
      continuation);
    if (game.pendingChoice || game.pendingPayment) return false;
  }
  return true;
}

function maybeResolveDeflectForChoice({ game, choice, option, player, source, target }) {
  if (!DEFLECTABLE_CHOICE_EFFECTS.has(choice.effect)) return false;
  if (!(target?.type === "unit") || !needsDeflectPayment(game, player, target) || deflectPaidForChoice(choice, target)) return false;
  if (offerDeflectPayment(game, choice, option, player, source, target)) return true;
  if (!payDeflectIfNeeded(game, player, source, target)) {
    log(game, `${source.name} cannot pay Deflect for ${target.name}.`);
    markEffect(game, source, [target.instanceId], `${target.name} deflects ${source.name}.`);
    return true;
  }
  return false;
}

function finishChoiceResolution({ game, choice, player, source }) {
  if (!game.pendingChoice) offerRepeatChoice(game, choice, player, source);
}

function resolveDeclareTriggerChoice({ game, choice, option }) {
  const trigger = choice.data.trigger;
  if (option.id === "use-trigger") {
    trigger.data ||= {};
    trigger.data.declarationComplete = true;
    if (trigger.data.specs?.[0]) trigger.data.specs[0].optional = false;
    prepareTriggerDeclarations(game, [trigger, ...(choice.data.remainingTriggers || [])], choice.data.mode || "queue", choice.data.continuation || null);
    return;
  }
  if (!option.cardId) {
    if (!(trigger.data?.declaredTargets || []).length) {
      trigger.declined = true;
      removePendingTriggerChainItem(game, trigger);
    }
    else trigger.data.declarationComplete = true;
    prepareTriggerDeclarations(game, [trigger, ...(choice.data.remainingTriggers || [])], choice.data.mode || "queue", choice.data.continuation || null);
    return;
  }
  trigger.data ||= {};
  trigger.data.declaredTargets = [
    ...(trigger.data.declaredTargets || []),
    {
      effect: choice.data.targetEffect,
      targetId: option.cardId,
      ...(option.amount == null ? {} : { amount: option.amount })
    }
  ];
  recordTriggerTargetIdentity(trigger, choice.data.targetEffect, option);
  prepareTriggerDeclarations(game, [trigger, ...(choice.data.remainingTriggers || [])], choice.data.mode || "queue", choice.data.continuation || null);
}

function resolveDeclareOptionalTriggerChoice({ game, choice, option, player, source }) {
  const { trigger, triggers, mode, continuation } = choice.data || {};
  if (!trigger) return;
  trigger.optionalPlacementComplete = true;
  if (option.id === "decline-optional-trigger") {
    trigger.declined = true;
    removePendingTriggerChainItem(game, trigger);
    log(game, `${player.name} does not place ${source.name}'s optional trigger on the Chain.`);
  } else {
    log(game, `${player.name} chooses to place ${source.name}'s optional trigger on the Chain.`);
  }
  prepareAndQueueTriggers(game, triggers || [], mode || "queue", continuation || null);
}

function resolveDeclareTriggerCostChoice({ game, choice, option, player, source }) {
  const { trigger, triggers, descriptor, mode, continuation } = choice.data || {};
  if (!trigger || !descriptor) return;
  if (option.id === "decline-trigger-cost") {
    declineTriggerCost(trigger);
    removePendingTriggerChainItem(game, trigger);
    log(game, `${player.name} declines ${source.name}'s triggered ability.`);
    prepareTriggerCosts(game, triggers || [], mode || "queue", continuation || null);
    return;
  }
  if (descriptor.choose === "hiddenCard" && !trigger.data?.triggerCostSelectionId) {
    trigger.data ||= {};
    trigger.data.triggerCostSelectionId = option.cardId;
    prepareTriggerCosts(game, triggers || [], mode || "queue", continuation || null);
    return;
  }
  const selectionId = option.cardId || null;
  if (!payTriggerNonResourceCost(game, trigger, player, source, descriptor, selectionId)) {
    declineTriggerCost(trigger);
    removePendingTriggerChainItem(game, trigger);
    log(game, `${source.name}'s triggered ability cost is no longer legal.`);
  } else {
    markTriggerCostPaid(trigger, descriptor, selectionId);
    log(game, `${player.name} pays ${source.name}'s triggered ability cost before it finalizes.`);
  }
  prepareTriggerCosts(game, triggers || [], mode || "queue", continuation || null);
}

function resolveAcknowledgeRevealChoice({ game, choice, player, source }) {
  const revealed = choice.data?.revealedCards || [];
  if (choice.data?.revealResolution === "ravenbloomConservatory") {
    const [top] = revealed;
    if (top?.type === "spell") {
      removeMainDeckCards(game, [top]);
      player.hand.push(top);
      log(game, `${source.name} puts ${top.name} into ${player.name}'s hand.`);
    } else if (top) {
      recycleMainDeckCards(game, player, [top], source);
      log(game, `${source.name} recycles ${top.name}.`);
    }
    markEffect(game, source, [source.instanceId], `${source.name} defend trigger.`);
    return;
  }
  if (choice.data?.revealResolution === "hiddenTopDeckDamage") {
    const target = findCard(game, choice.data.targetId);
    const battlefield = game.battlefields.find((field) => field.instanceId === choice.data.battlefieldId);
    const amount = choice.data.amount || 0;
    if (target && target.controllerId !== player.id && battlefield?.units.includes(target)) {
      applyDamage(game, player, source, target, amount);
    }
    recycleMainDeckCards(game, player, revealed, source);
    markEffect(game, source, [target?.instanceId].filter(Boolean), `${source.name} reveals ${revealed.length} cards and deals ${amount} damage.`);
    return;
  }
  if (choice.data?.revealResolution === "opponentHand") {
    markEffect(game, source, [source.instanceId, ...revealed.map((card) => card.instanceId)], `${source.name} reveals a hand.`);
    return;
  }
  if (choice.data?.revealResolution === "predictTopSpell") {
    const [top] = revealed;
    if (top) {
      removeMainDeckCards(game, [top]);
      player.hand.push(top);
      log(game, `${source.name} reveals ${top.name} and puts it into hand.`);
      markEffect(game, source, [source.instanceId, top.instanceId], `${source.name} reveals a spell.`);
    }
    if (!choice.fromShowdownChain) continueShowdownStartEffects(game, choice.data?.resumeShowdownStart);
    return;
  }
  if (choice.data?.revealResolution === "recycleLookedCards") {
    recycleMainDeckCards(game, player, revealed, source);
    markEffect(game, source, [source.instanceId, ...revealed.map((card) => card.instanceId)], `${source.name} recycles revealed cards.`);
  }
}

function resolvePlayRevealedOpponentTopDeckChoice({ game, choice, option, player, source }) {
  const selected = choice.data?.revealedCards?.find((card) => card.instanceId === option.cardId);
  const recycled = (choice.data?.revealedCards || []).filter((revealed) => revealed.instanceId !== selected?.instanceId);
  if (selected) {
    banishCards(game, player, [selected], source);
    playCardIgnoringCostFromEffect(game, player, selected, source);
    markEffect(game, source, [selected.instanceId], `${source.name} plays ${selected.name}.`);
  }
  for (const owner of game.players) {
    const ownedCards = recycled.filter((card) => card.ownerId === owner.id);
    if (ownedCards.length) recycleMainDeckCards(game, owner, ownedCards, source);
  }
}

function resolvePlayLookedAtUnitChoice({ game, choice, option, player, source }) {
  const revealed = choice.data?.revealedCards || [];
  const selected = revealed.find((card) => card.instanceId === option.cardId);
  if (selected) {
    banishCards(game, player, [selected], source);
    if (playCardIgnoringEnergyCostFromEffect(game, player, selected, source, choice.data?.energyReduction || 0)) {
      markEffect(game, source, [selected.instanceId], `${source.name} plays ${selected.name}.`);
    }
  } else {
    markEffect(game, source, [source.instanceId, ...revealed.map((card) => card.instanceId)], `${source.name} recycles revealed cards.`);
  }
  recycleMainDeckCards(game, player, revealed.filter((card) => card.instanceId !== selected?.instanceId), source);
}

function resolvePromisingFutureChooseChoice({ game, choice, option, source }) {
  const chooser = game.players.find((candidate) => candidate.id === choice.playerId);
  const revealed = choice.data?.revealedCards || [];
  const selected = revealed.find((card) => card.instanceId === option.cardId);
  if (chooser && selected) banishCards(game, chooser, [selected], source);
  if (chooser) recycleMainDeckCards(game, chooser, revealed.filter((card) => card.instanceId !== selected?.instanceId), source);
  const selectedCards = [
    ...(choice.data?.selectedCards || []),
    ...(selected ? [{ playerId: choice.playerId, cardId: selected.instanceId }] : [])
  ];
  promptPromisingFutureChoice(
    game,
    source,
    choice.data?.playerIds || [],
    (choice.data?.index || 0) + 1,
    choice.data?.look || 5,
    selectedCards,
    choice.finishSpell
  );
}

function resolveDeclareActivatedAbilityChoice({ game, option, source }) {
  source.selectedActivatedAbilityId = option.id;
  const result = activateCard(game, source.instanceId);
  if (!result.ok) delete source.selectedActivatedAbilityId;
}

function resolveDeclareActivatedRecycleTrashChoice({ game, choice, option, player, source }) {
  if (!player.trash.some((card) => card.instanceId === option.cardId)) return;
  const selectedIds = [...new Set([...(choice.data?.selectedIds || []), option.cardId])];
  const remaining = Math.max(0, (choice.data?.remaining || 1) - 1);
  source.activationProcess ||= {};
  source.activationProcess.recycleTrashCardIds = selectedIds;
  if (remaining > 0) {
    const nextChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      options: player.trash.filter((card) => !selectedIds.includes(card.instanceId)).map(cardOption),
      data: { ...choice.data, remaining, selectedIds }
    };
    if (!game.interactive) {
      applyChoiceEffect(game, nextChoice, nextChoice.options[0]);
      return;
    }
    game.pendingChoice = nextChoice;
    return;
  }
  source.activationDeclarationReady = true;
  activateCard(game, source.instanceId);
}

function resolveDeclareActivatedTargetChoice({ game, choice, option, player, source }) {
  if (!option.cardId) return;
  source.declaredPlayTargets = [{ effect: choice.data.targetEffect, targetId: option.cardId }];
  source.declaredTargetIdentities = [{
    effect: choice.data.targetEffect,
    targetId: option.cardId,
    zoneChangeCounter: option.zoneChangeCounter || 0
  }];
  source.deflectPaidTargetIds = [];
  const target = findCard(game, option.cardId);
  if (target && needsDeflectPayment(game, player, target)) {
    if (!payDeflectIfNeeded(game, player, source, target)) {
      delete source.declaredPlayTargets;
      return;
    }
    source.deflectPaidTargetIds.push(target.instanceId);
  }
  if (choice.data.requiresDestination && target?.type === "unit") {
    const options = spellMoveDestinationOptions(game, target);
    if (!options.length) return;
    game.pendingChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      effect: "declareActivatedMoveDestination",
      prompt: `Declare where ${target.name} will move for ${source.name}.`,
      options,
      data: { ...choice.data, targetId: target.instanceId }
    };
    return;
  }
  source.activationDeclarationReady = true;
  activateCard(game, source.instanceId);
}

function resolveDeclareActivatedMoveDestinationChoice({ game, choice, option, source }) {
  source.declaredPlayChoices = [{
    effect: choice.data.destinationEffect || "moveUnitSpellDestination",
    unitId: choice.data.targetId,
    destinationId: option.destination || option.id
  }];
  source.activationDeclarationReady = true;
  activateCard(game, source.instanceId);
}

function resolveDeclareUdyrModeChoice({ game, option, player, source }) {
  const turnSequence = game.turnSequence || 0;
  const previous = source.udyrModesTurnSequence === turnSequence ? (source.udyrModesChosen || []) : [];
  source.udyrModesTurnSequence = turnSequence;
  source.udyrModesChosen = [...new Set([...previous, option.id])];
  source.declaredPlayChoices = [{ effect: "udyrMode", optionId: option.id }];
  if (["damage", "stun"].includes(option.id)) {
    const options = game.battlefields.flatMap((field) => field.units)
      .filter((unit) => canChooseUnit(game, player, source, unit))
      .map(cardOption);
    if (!options.length) return;
    game.pendingChoice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: player.id,
      card: source,
      effect: "declareUdyrTarget",
      prompt: `Declare a unit for ${source.name}'s ${option.id} mode.`,
      options,
      data: { mode: option.id },
      finishSpell: false,
      optional: false,
      fromShowdownChain: false
    };
    return;
  }
  source.udyrActivationCostPending = true;
  source.activationDeclarationReady = true;
  activateCard(game, source.instanceId);
}

function resolveDeclareUdyrTargetChoice({ game, choice, option, source }) {
  source.declaredPlayTargets = [{ effect: `udyr-${choice.data.mode}`, targetId: option.cardId }];
  source.udyrActivationCostPending = true;
  source.activationDeclarationReady = true;
  activateCard(game, source.instanceId);
}

function resolveDeclarePlayTargetChoice({ game, choice, option, player, source }) {
  const declaredTargets = [...(choice.data.declaredTargets || [])];
  const declaredChoices = [...(choice.data.declaredChoices || [])];
  const deflectPowerCost = [...(choice.data.deflectPowerCost || [])];
  const deflectTargetIds = [...(choice.data.deflectTargetIds || [])];
  if (option.id === "declare-finish") {
    if ((choice.data.selectedForCurrentStep?.length || 0) < (choice.data.min || 0)) return;
    if (!(choice.data.selectedForCurrentStep?.length || 0)) {
      declaredChoices.push({
        effect: choice.data.targetEffect,
        optionId: "skip"
      });
    }
    promptNextPlayDeclaration(game, player, source, {
      ...choice.data,
      declaredTargets,
      declaredChoices,
      declarationSteps: choice.data.declarationSteps || [],
      deflectPowerCost,
      deflectTargetIds,
      currentDeclaration: null,
      selectedForCurrentStep: []
    });
    log(game, `${player.name} finishes declaring targets for ${source.name}.`);
    return;
  }
  if (!option.cardId) {
    declaredChoices.push({
      effect: choice.data.targetEffect,
      optionId: option.id,
      amount: option.amount ?? null,
      unitId: option.unitId || null,
      discardCardId: option.discardCardId || null,
      repeatCostEnergy: option.repeatCostEnergy || 0
    });
    const repeatDeclarations = choice.data.currentDeclaration?.declaration?.repeatTargetDeclarations || [];
    const repeatedSteps = choice.data.targetEffect === "repeatCount"
      ? Array.from({ length: option.amount || 0 }, () => repeatDeclarations.map((declaration) => ({
        spec: choice.data.currentDeclaration.spec,
        declaration,
        destination: choice.data.destination
      }))).flat()
      : [];
    promptNextPlayDeclaration(game, player, source, {
      ...choice.data,
      declaredTargets,
      declaredChoices,
      declarationSteps: [...repeatedSteps, ...(choice.data.declarationSteps || [])],
      deflectPowerCost,
      deflectTargetIds,
      currentDeclaration: null,
      selectedForCurrentStep: []
    });
    return;
  }
  const targetId = option.cardId;
  const targetCard = findCard(game, targetId);
  const alreadyPaysDeflect = deflectTargetIds.includes(targetId);
  const targetDeflectPowerCost = targetCard && needsDeflectPayment(game, player, targetCard) && !alreadyPaysDeflect
    ? [{ domain: "Any", amount: deflectAmount(game, targetCard) }]
    : [];
  const targetDeflectIds = targetDeflectPowerCost.length ? [targetId] : [];
  if (choice.data.requiresDestination) {
    const options = targetCard?.type === "unit" ? spellMoveDestinationOptions(game, targetCard) : [];
    if (!options.length) {
      log(game, `${source.name} has no legal move destination for ${targetCard?.name || "the target"}.`);
      return;
    }
    game.pendingChoice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: player.id,
      card: source,
      effect: choice.data.moveDestinationChoiceEffect || "declareMoveDestination",
      prompt: `Declare where ${targetCard.name} will move for ${source.name}.`,
      options,
      data: {
        ...choice.data,
        destination: choice.data.destination,
        source: choice.data.source,
        targetEffect: choice.data.targetEffect,
        destinationEffect: choice.data.destinationEffect || "moveUnitSpellDestination",
        targetId,
        declaredTargets,
        declaredChoices,
        declarationSteps: choice.data.declarationSteps || [],
        deflectPowerCost: [...deflectPowerCost, ...targetDeflectPowerCost],
        deflectTargetIds: [...deflectTargetIds, ...targetDeflectIds]
      },
      finishSpell: false,
      optional: false,
      fromShowdownChain: false
    };
    game.selectedCardId = source.instanceId;
    log(game, `${player.name} declares ${targetCard.name} for ${source.name}.`);
    if (targetDeflectPowerCost.length) log(game, `${targetCard.name} adds Deflect Power to ${source.name}.`);
    return;
  }
  declaredTargets.push({
    effect: choice.data.targetEffect,
    targetId,
    ...(option.amount == null ? {} : { amount: option.amount })
  });
  const selectedForCurrentStep = [...(choice.data.selectedForCurrentStep || []), targetId];
  const nextDeflectPowerCost = [...deflectPowerCost, ...targetDeflectPowerCost];
  const nextDeflectTargetIds = [...deflectTargetIds, ...targetDeflectIds];
  if (selectedForCurrentStep.length < (choice.data.max || 1)) {
    const selectedMight = declaredTargets
      .filter((target) => target.effect === choice.data.targetEffect)
      .reduce((sum, declaration) => sum + currentMight(game, findCard(game, declaration.targetId)), 0);
    const maxMight = choice.data.currentDeclaration?.declaration?.maxTotalMightFromSpec
      ? (choice.data.currentDeclaration.spec.maxMight || 4)
      : null;
    const options = choice.options.filter((candidate) => candidate.cardId)
      .filter((candidate) => candidate.cardId)
      .filter((candidate) => choice.data.currentDeclaration?.spec?.allowRepeatedTargets
        || choice.data.currentDeclaration?.declaration?.allowRepeatedTargets
        || !selectedForCurrentStep.includes(candidate.cardId))
      .filter((candidate) => {
        if (choice.data.targetEffect !== "spendFriendlyBuffsAdditionalCost") return true;
        const selectedCount = declaredTargets.filter((declaration) => declaration.effect === choice.data.targetEffect && declaration.targetId === candidate.cardId).length;
        return selectedCount < (findCard(game, candidate.cardId)?.buffs || 0);
      })
      .filter((candidate) => maxMight == null || selectedMight + currentMight(game, findCard(game, candidate.cardId)) <= maxMight);
    if (options.length || selectedForCurrentStep.length >= (choice.data.min || 1)) {
      game.pendingChoice = {
        ...choice,
        id: `choice-${Date.now()}-${Math.random()}`,
        prompt: `Declare another target for ${source.name}, or finish target selection.`,
        options: [
          ...options,
          ...(selectedForCurrentStep.length >= (choice.data.min || 1)
            ? [{ id: "declare-finish", label: "Finish target selection", cardId: null }]
            : [])
        ],
        data: {
          ...choice.data,
          declaredTargets,
          declaredChoices,
          selectedForCurrentStep,
          deflectPowerCost: nextDeflectPowerCost,
          deflectTargetIds: nextDeflectTargetIds
        },
        optional: false
      };
      game.selectedCardId = source.instanceId;
      log(game, `${player.name} declares ${targetCard?.name || "a target"} for ${source.name}.`);
      if (targetDeflectPowerCost.length) log(game, `${targetCard.name} adds Deflect Power to ${source.name}.`);
      return;
    }
  }
  promptNextPlayDeclaration(game, player, source, {
    ...choice.data,
    declaredTargets,
    declaredChoices,
    declarationSteps: choice.data.declarationSteps || [],
    deflectPowerCost: nextDeflectPowerCost,
    deflectTargetIds: nextDeflectTargetIds,
    currentDeclaration: null,
    selectedForCurrentStep: []
  });
  game.selectedCardId = source.instanceId;
  log(game, `${player.name} declares ${targetCard?.name || "a target"} for ${source.name}.`);
  if (targetDeflectPowerCost.length) log(game, `${targetCard.name} adds Deflect Power to ${source.name}.`);
}

function resolveDeclareMoveDestinationChoice({ game, choice, option, player, source }) {
  const targetId = choice.data.targetId;
  const targetCard = findCard(game, targetId);
  const destinationId = option.destination || option.id;
  const declaredTargets = [
    ...(choice.data.declaredTargets || []),
    { effect: choice.data.targetEffect, targetId }
  ];
  const declaredChoices = [
    ...(choice.data.declaredChoices || []),
    {
      effect: choice.data.destinationEffect || "moveUnitSpellDestination",
      unitId: targetId,
      destinationId
    }
  ];
  promptNextPlayDeclaration(game, player, source, {
    ...choice.data,
    declaredTargets,
    declaredChoices,
    declarationSteps: choice.data.declarationSteps || [],
    deflectPowerCost: choice.data.deflectPowerCost || [],
    deflectTargetIds: choice.data.deflectTargetIds || [],
    currentDeclaration: null,
    selectedForCurrentStep: []
  });
  game.selectedCardId = source.instanceId;
  log(game, `${player.name} declares ${targetCard?.name || "the target"} will move to ${option.label || destinationId} for ${source.name}.`);
}

function resolveDeclareHiddenPlayTargetChoice({ game, choice, option, player, source }) {
  const targetId = option.cardId;
  const targetCard = findCard(game, targetId);
  if (choice.data.requiresDestination) {
    const options = targetCard?.type === "unit" ? spellMoveDestinationOptions(game, targetCard) : [];
    if (!options.length) {
      log(game, `${source.name} has no legal move destination for ${targetCard?.name || "the target"}.`);
      return;
    }
    game.pendingChoice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: player.id,
      card: source,
      effect: "declareHiddenMoveDestination",
      prompt: `Declare where ${targetCard.name} will move for ${source.name}.`,
      options,
      data: {
        destination: choice.data.destination,
        targetEffect: choice.data.targetEffect,
        destinationEffect: choice.data.destinationEffect || "moveUnitSpellDestination",
        targetId
      },
      finishSpell: false,
      optional: false,
      fromShowdownChain: false
    };
    log(game, `${player.name} declares ${targetCard.name} for ${source.name}.`);
    return;
  }
  finalizeHiddenCard(game, player, source, choice.data.destination, [
    { effect: choice.data.targetEffect, targetId }
  ]);
}

function resolveDeclareHiddenMoveDestinationChoice({ game, choice, option, player, source }) {
  const targetId = choice.data.targetId;
  const targetCard = findCard(game, targetId);
  const destinationId = option.destination || option.id;
  finalizeHiddenCard(game, player, source, choice.data.destination, [
    { effect: choice.data.targetEffect, targetId }
  ], [{
    effect: choice.data.destinationEffect || "moveUnitSpellDestination",
    unitId: targetId,
    destinationId
  }]);
  log(game, `${player.name} declares ${targetCard?.name || "the target"} will move to ${option.label || destinationId} for ${source.name}.`);
}

function resolveRepeatSpellChoice({ game, choice, option, player, source }) {
  if (option.id !== "repeat") {
    log(game, `${player.name} does not repeat ${source.name}.`);
    return;
  }
  if (beginEffectEnergyPayment(game, player, source, choice.data.repeatCostEnergy || 0, {
    kind: "repeatSpell",
    sourcePlayerId: choice.playerId,
    repeatCostEnergy: choice.data.repeatCostEnergy || 0,
    repeatSpec: choice.data.repeatSpec,
    finishSpell: choice.finishSpell,
    fromShowdownChain: choice.fromShowdownChain
  })) return;
  log(game, `${player.name} cannot pay to repeat ${source.name}.`);
}

function resolveShowdownPredictDrawSpellChoice({ game, choice, option, source }) {
  const controller = game.players.find((candidate) => candidate.id === choice.playerId);
  if (!controller) return;
  if (option.id !== "pay") {
    log(game, `${controller.name} declines ${source.name}.`);
    continueShowdownStartEffects(game, choice.data.resumeShowdownStart);
    return;
  }
  if (beginEffectEnergyPayment(game, controller, source, choice.data.amount || 1, {
    kind: "showdownPredictDrawSpell",
    sourcePlayerId: choice.playerId,
    amount: choice.data.amount || 1,
    resumeShowdownStart: choice.data.resumeShowdownStart,
    fromShowdownChain: choice.fromShowdownChain
  })) return;
  log(game, `${controller.name} cannot pay for ${source.name}.`);
  continueShowdownStartEffects(game, choice.data.resumeShowdownStart);
}

function resolveBattlefieldSpellBuffChoice({ game, choice, player, source, target }) {
  if (target) {
    addMightModifier(target, choice.data.amount || 1, { temporary: Boolean(choice.data.temporary) });
    log(game, `${source.name} gives ${target.name} +${choice.data.amount || 1} Might.`);
    markEffect(game, source, [target.instanceId], `${target.name} gets +${choice.data.amount || 1} Might.`);
  } else {
    log(game, `${player.name} declines ${source.name}.`);
  }
  resolveTriggerQueue(game);
}

function resolveCombatDamageChoice({ game, choice, option, player, source, target }) {
  if (target?.type === "unit") {
    const amount = Math.min(option.amount || 1, choice.data.remaining || 0);
    const assignments = [
      ...(choice.data.assignments || []),
      {
        targetId: target.instanceId,
        amount,
        assigningPlayerId: choice.data.assigningPlayerId,
        role: choice.data.role
      }
    ];
    recordExcessCombatDamage(game, { ...choice.data, assignments }, target, amount);
    markEffect(game, source, [target.instanceId], `${amount} combat damage is assigned to ${target.name}.`);
    log(game, `${player.name} assigns ${amount} combat damage to ${target.name}.`);
    const remaining = Math.max(0, (choice.data.remaining || 0) - amount);
    if (remaining > 0) {
      promptCombatDamageChoice(game, { ...choice.data, remaining, assignments });
      return;
    }
    continueCombatDamageAssignment(game, { ...choice.data, assignments });
    return;
  }
  continueCombatDamageAssignment(game, choice.data);
}

function resolvePayDeflectChoice({ game, choice, option, player, source }) {
  const amount = choice.data.amount || 1;
  const selectedRuneIds = [...(choice.data.selectedRuneIds || []), option.cardId];
  const uniqueSelected = [...new Set(selectedRuneIds)];
  if (uniqueSelected.length < amount) {
    const remaining = amount - uniqueSelected.length;
    game.pendingChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      prompt: `${source.name} must pay ${remaining} more Deflect Power.`,
      options: choice.options.filter((candidate) => !uniqueSelected.includes(candidate.cardId)),
      data: {
        ...choice.data,
        selectedRuneIds: uniqueSelected
      }
    };
    log(game, `${player.name} chooses Deflect Power ${uniqueSelected.length}/${amount}.`);
    return;
  }
  if (!payChosenPowerRunes(game, player, uniqueSelected, amount)) {
    log(game, `${source.name} cannot pay Deflect.`);
    return;
  }
  const originalChoice = {
    ...choice.data.originalChoice,
    data: {
      ...(choice.data.originalChoice.data || {}),
      deflectPaidTargetIds: [
        ...(choice.data.originalChoice.data?.deflectPaidTargetIds || []),
        choice.data.targetId
      ]
    }
  };
  log(game, `${player.name} pays ${amount} Power for Deflect.`);
  markEffect(game, source, [choice.data.targetId], `${source.name} pays Deflect.`);
  applyChoiceEffect(game, originalChoice, choice.data.originalOption);
}

function resolveReadyUnitChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    readyUnitWithEffects(game, player, source, target);
    log(game, `${source.name} readies ${target.name}.`);
    markEffect(game, source, [target.instanceId], `${source.name} readies ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveReadyAnotherExhaustedChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    readyUnitWithEffects(game, player, source, target);
    log(game, `${source.name} readies ${target.name}.`);
    markEffect(game, source, [target.instanceId], `${source.name} readies ${target.name}.`);
  }
  finishAfterMoveChoice(game, choice.data?.afterMove);
}

function resolveBaitedHookSacrificeChoice(context) {
  const { game, choice, player, source, target } = context;
  if (!target) return finishChoiceResolution(context);
  const killedMight = currentMight(game, target);
  const location = findUnitLocation(game, target.instanceId);
  if (!killUnitForChoice(context, target,
    location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location)) return;
  const topCards = player.mainDeck.slice(0, 5);
  const continuation = {
    kind: "baitedHookTopDeck",
    sourceCardId: source.instanceId,
    sourceCardSnapshot: structuredClone(source),
    observedIds: topCards.map((card) => card.instanceId),
    killedMight,
    killedUnitId: target.instanceId,
    parentChoice: structuredClone(choice),
    fromShowdownChain: Boolean(choice.fromShowdownChain)
  };
  log(game, `${source.name} kills ${target.name} and looks at the top ${topCards.length} cards.`);
  markEffect(game, source, [target.instanceId], `${target.name} is killed.`);
  if (!topCards.length) {
    finishChoiceResolution(context);
    return;
  }
  beginObservedTopDeckSelfAbilities(game, player, topCards, continuation);
}

function presentBaitedHookTopDeck(game, player, source, continuation) {
  const topCards = (continuation.observedIds || [])
    .map((id) => player.mainDeck.find((card) => card.instanceId === id))
    .filter(Boolean);
  const options = topCards
    .filter((card) => card.type === "unit" && printedMight(card) <= (continuation.killedMight ?? -Infinity) + 1)
    .map(cardOption);
  const nextChoice = {
    ...(continuation.parentChoice || {}),
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "baitedHookTopDeck",
    prompt: `Choose a unit from the top 5 cards for ${source.name}, or skip.`,
    options: [
      ...options,
      { id: "decline", label: "Play no unit", cardId: null }
    ],
    optional: false,
    data: {
      topCardIds: topCards.map((card) => card.instanceId),
      killedUnitId: continuation.killedUnitId || null
    }
  };
  presentPreparedChoice(game, nextChoice);
  return true;
}

function resolveBaitedHookTopDeckChoice(context) {
  const { game, choice, option, player, source } = context;
  const topIdSet = new Set(choice.data.topCardIds || []);
  const topCards = player.mainDeck.filter((card) => topIdSet.has(card.instanceId));
  let played = null;
  if (option.cardId) {
    played = player.mainDeck.find((card) => card.instanceId === option.cardId) || null;
    if (played) {
      banishCards(game, player, [played], source);
      playCardIgnoringCostFromEffect(game, player, played, source);
    }
  }
  const recycleIds = new Set((choice.data.topCardIds || []).filter((id) => id !== played?.instanceId));
  const recycled = [];
  player.mainDeck = player.mainDeck.filter((card) => {
    if (!recycleIds.has(card.instanceId)) return true;
    recycled.push(card);
    return false;
  });
  recycleMainDeckCards(game, player, recycled, source);
  log(game, `${source.name} ${played ? `plays ${played.name}` : "plays no unit"} and recycles the rest.`);
  markEffect(game, source, [played?.instanceId, ...recycled.map((card) => card.instanceId)].filter(Boolean), `${source.name} resolves.`);
  finishChoiceResolution(context);
}

function resolveSpendFriendlyBuffBuffSelfReadyChoice(context) {
  const { game, player, source, target } = context;
  if (target && (target.buffs || 0) > 0) {
    target.buffs -= 1;
    addMightModifier(source, 1, { buff: true, maxBuffs: 1 });
    readyUnitWithEffects(game, player, source, source);
    log(game, `${source.name} spends ${target.name}'s buff, buffs itself, and readies.`);
    markEffect(game, source, [source.instanceId, target.instanceId], `${source.name} buffs and readies.`);
  }
  finishChoiceResolution(context);
}

function resolveSpendBuffsReadyThenBuffFriendlyUnitsChoice(context) {
  const { game, choice, option, player, source } = context;
  const selectedIds = [...new Set(choice.data?.selectedIds || [])];
  if (option.cardId && !selectedIds.includes(option.cardId)) selectedIds.push(option.cardId);
  if (option.id !== "done") {
    const options = allUnits(game)
      .filter((unit) => unit.controllerId === player.id
        && unit.exhausted
        && (unit.buffs || 0) > 0
        && !selectedIds.includes(unit.instanceId))
      .map(cardOption);
    const nextChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      options: [...options, { id: "done", label: "Finish choosing", cardId: null }],
      data: { ...choice.data, selectedIds }
    };
    presentPreparedChoice(game, nextChoice);
    return;
  }

  const selected = selectedIds
    .map((id) => findCard(game, id))
    .filter((unit) => unit?.type === "unit"
      && unit.controllerId === player.id
      && unit.exhausted
      && (unit.buffs || 0) > 0
      && findUnitLocation(game, unit.instanceId));
  for (const unit of selected) unit.buffs -= 1;
  readyCardsWithEffects(game, player, source, selected, { reason: "effect" });
  const targets = allUnits(game).filter((unit) => unit.controllerId === player.id);
  for (const unit of targets) addMightModifier(unit, 1, { buff: true, maxBuffs: 1 });
  markEffect(game, source, [source.instanceId, ...targets.map((unit) => unit.instanceId)], `${source.name} readies and buffs friendly units.`);
  log(game, `${source.name} spends ${selected.length} Buff${selected.length === 1 ? "" : "s"}, readies those units, then buffs friendly units.`);
}

function resolveKillFriendlyPermanentChannelRuneChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    if (target.type === "gear") {
      killGear(game, target, source);
    } else {
      const location = findUnitLocation(game, target.instanceId);
      if (!killUnitForChoice(context, target,
        location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location)) return;
    }
    channelRunes(game, player, 1, {
      exhausted: true,
      source,
      reason: "effect"
    });
    log(game, `${source.name} kills ${target.name} and channels a rune exhausted.`);
    markEffect(game, source, [target.instanceId], `${target.name} is killed.`);
  }
  finishChoiceResolution(context);
}

function resolveBuffUnitChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    if (choice.data.buff) {
      buffUnitWithEffects(game, player, source, target, choice.data.amount, { maxBuffs: choice.data.maxBuffs });
    } else {
      addMightModifier(target, choice.data.amount, { maxBuffs: choice.data.maxBuffs });
    }
    if (choice.data.draw) draw(player, choice.data.draw, game);
    log(game, `${source.name} gives ${target.name} +${choice.data.amount} Might.`);
    markEffect(game, source, [target.instanceId], `${target.name} gets +${choice.data.amount} Might.`);
    const remaining = (choice.data.remaining || 1) - 1;
    if (remaining > 0) {
      const chosenIds = [...(choice.data.chosenIds || []), target.instanceId];
      const options = allUnits(game)
        .filter((unit) => !chosenIds.includes(unit.instanceId))
        .filter((unit) => !choice.data.anotherOnly || unit.instanceId !== source.instanceId)
        .filter((unit) => !choice.data.exhaustedOnly || unit.exhausted)
        .filter((unit) => choice.data.scope !== "friendly" || unit.controllerId === player.id)
        .filter((unit) => canChooseUnit(game, player, source, unit))
        .map(cardOption);
      if (options.length) {
        game.pendingChoice = {
          ...choice,
          id: `choice-${Date.now()}-${Math.random()}`,
          options,
          data: { ...choice.data, remaining, chosenIds, draw: 0 }
        };
        return;
      }
    }
  }
  finishChoiceResolution(context);
}

function resolveSecondDrawBuffChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    addMightModifier(target, choice.data.amount || 2, { temporary: Boolean(choice.data.temporary) });
    log(game, `${source.name} gives ${target.name} +${choice.data.amount || 2} Might.`);
    markEffect(game, source, [target.instanceId], `${target.name} gets +${choice.data.amount || 2} Might.`);
  }
  finishChoiceResolution(context);
}

function resolveEnGardeChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    const location = findUnitLocation(game, target.instanceId);
    const alliesThere = location?.type === "battlefield"
      ? location.battlefield.units.filter((unit) => unit.controllerId === player.id).length
      : player.base.filter((unit) => unit.type === "unit").length;
    const amount = alliesThere === 1 ? 2 : 1;
    addMightModifier(target, amount, { temporary: true });
    log(game, `${source.name} gives ${target.name} +${amount} Might.`);
    markEffect(game, source, [target.instanceId], `${target.name} gets +${amount} Might.`);
  }
  finishChoiceResolution(context);
}

function resolveModifyMightChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    if (choice.data.spendBuff) {
      if ((source.buffs || 0) <= 0) {
        log(game, `${source.name} has no buff to spend.`);
        return finishChoiceResolution(context);
      }
      source.buffs -= 1;
    }
    const amount = choice.data.amount;
    const minMight = choice.data.minMight;
    if (minMight != null && currentMight(game, target) + amount < minMight) {
      addMightModifier(target, minMight - currentMight(game, target), { temporary: Boolean(choice.data.temporary) });
    } else {
      addMightModifier(target, amount, { temporary: Boolean(choice.data.temporary) });
    }
    if (choice.data.draw) draw(player, choice.data.draw, game);
    log(game, `${source.name} gives ${target.name} ${amount} Might${choice.data.draw ? ` and draws ${choice.data.draw}` : ""}.`);
    markEffect(game, source, [target.instanceId], `${target.name} gets ${choice.data.amount} Might.`);
    if (choice.data.predict && offerPredictChoice(game, player, source, choice)) return;
    const remaining = (choice.data.remaining || 1) - 1;
    if (remaining > 0) {
      const chosenIds = [...(choice.data.chosenIds || []), target.instanceId];
      const options = allUnits(game)
        .filter((unit) => !chosenIds.includes(unit.instanceId))
        .filter((unit) => choice.data.scope !== "friendly" || unit.controllerId === player.id)
        .filter((unit) => choice.data.scope !== "self" || unit.instanceId === source.instanceId)
        .filter((unit) => hiddenTargetAllowed(game, source, unit))
        .filter((unit) => canChooseUnit(game, player, source, unit))
        .map(cardOption);
      if (options.length) {
        game.pendingChoice = {
          ...choice,
          id: `choice-${Date.now()}-${Math.random()}`,
          options,
          data: { ...choice.data, remaining, chosenIds, spendBuff: false }
        };
        return;
      }
    }
  }
  finishChoiceResolution(context);
}

function resolveDamageUnitChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    const sourceBattlefield = findUnitLocation(game, source.instanceId)?.battlefield;
    const baseAmount = choice.data.amountFromSelfMight
      ? currentCombatMight(game, sourceBattlefield, source, "attacker")
      : choice.data.amount || 0;
    const amount = damageAmount(game, player, source, target, baseAmount);
    if (choice.data.opponentMayDrawInstead) {
      const controller = game.players.find((candidate) => candidate.id === target.controllerId);
      if (controller && controller.id !== player.id) {
        game.pendingChoice = {
          id: `choice-${Date.now()}-${Math.random()}`,
          playerId: controller.id,
          card: source,
          effect: "damageOrDrawInstead",
          prompt: `${source.name}: take ${amount} damage or let ${player.name} draw ${choice.data.opponentMayDrawInstead}?`,
          options: [
            { id: "damage", label: `Take ${amount} damage`, cardId: target.instanceId },
            { id: "draw", label: `${player.name} draws ${choice.data.opponentMayDrawInstead}`, cardId: source.instanceId }
          ],
          data: {
            targetId: target.instanceId,
            baseAmount,
            sourcePlayerId: player.id,
            draw: choice.data.opponentMayDrawInstead,
            finishSpell: choice.finishSpell,
            fromShowdownChain: choice.fromShowdownChain
          },
          finishSpell: false,
          optional: false,
          fromShowdownChain: false
        };
        return;
      }
    }
    const dealt = applyDamage(game, player, source, target, baseAmount);
    log(game, `${source.name} deals ${dealt} damage to ${target.name}.`);
    markEffect(game, source, [target.instanceId], `${target.name} takes ${dealt} damage.`);
    if (choice.data.drawIfKilled && dealt > 0 && target.lastDamageEvent?.id) {
      game.damageKillFollowups ||= [];
      game.damageKillFollowups.push({
        unitId: target.instanceId,
        damageEventId: target.lastDamageEvent?.id || null,
        sourceCardId: source.instanceId,
        sourceCardSnapshot: structuredClone(source),
        sourcePlayerId: player.id,
        draw: choice.data.drawIfKilled
      });
    }
    const remaining = (choice.data.remaining || 1) - 1;
    if (remaining > 0) {
      const chosenIds = [...(choice.data.chosenIds || []), target.instanceId];
      const options = targetableUnits(game, player, source, choice.data.scope || "any")
        .filter((unit) => !chosenIds.includes(unit.instanceId))
        .map(cardOption);
      if (options.length) {
        game.pendingChoice = {
          ...choice,
          id: `choice-${Date.now()}-${Math.random()}`,
          options,
          optional: true,
          data: { ...choice.data, remaining, chosenIds }
        };
        return;
      }
    }
  }
  if (choice.data.draw) draw(player, choice.data.draw, game);
  finishChoiceResolution(context);
}

function baseDamageAmount(game, source, target, baseAmount, options = {}) {
  const origin = options.origin || (source?.type === "spell" ? "spell" : "ability");
  if (hasStaticEffect(target, "preventDamageAfterSecondMove") && (target.movesThisTurn || 0) >= 2) return 0;
  if (origin === "unmodified" || origin === "combat" || origin === "unit") return Math.max(0, baseAmount || 0);
  if (spellAbilityDamagePrevented(game, origin)) return 0;
  return Math.max(0, baseAmount || 0);
}

function bonusDamageAmount(game, player, source, target, options = {}) {
  if (options.bonusAlreadyApplied) return 0;
  const origin = options.origin || (source?.type === "spell" ? "spell" : "ability");
  if (origin === "unmodified" || origin === "combat" || origin === "unit") return 0;
  const spellBonus = origin === "spell" ? player?.nextSpellBonusDamage || 0 : 0;
  return Math.max(0, spellBonus + bonusDamageToUnitFromBattlefield(game, player, target));
}

function damageAmount(game, player, source, target, baseAmount, options = {}) {
  const base = baseDamageAmount(game, source, target, baseAmount, options);
  return base > 0 ? base + bonusDamageAmount(game, player, source, target, options) : 0;
}

export function preventNextDamage(game, unit, value, options = {}) {
  if (!unit || (value !== "all" && (!Number.isInteger(value) || value <= 0))) return false;
  game.damagePreventionSequence = (game.damagePreventionSequence || 0) + 1;
  unit.damagePreventions ||= [];
  unit.damagePreventions.push({
    id: `prevent-${game.damagePreventionSequence}`,
    remaining: value === "all" ? "all" : value,
    source: options.source || "any",
    expiresAtTurnSequence: options.expiresAtTurnSequence ?? (game.turnSequence || 0)
  });
  return true;
}

function damagePreventionMatches(prevention, origin) {
  if (!prevention || prevention.source === "any") return true;
  if (prevention.source === "spellOrAbility") return origin === "spell" || origin === "ability";
  return prevention.source === origin;
}

function activeDamagePreventions(game, unit, origin) {
  const currentTurn = game.turnSequence || 0;
  const active = (unit.damagePreventions || [])
    .filter((prevention) => (prevention.expiresAtTurnSequence ?? currentTurn) >= currentTurn)
    .filter((prevention) => prevention.remaining === "all" || prevention.remaining > 0);
  if (active.length) unit.damagePreventions = active;
  else delete unit.damagePreventions;
  return active.filter((prevention) => damagePreventionMatches(prevention, origin));
}

function trackedDamagePreventionValue(game, unit, origin) {
  let total = 0;
  for (const prevention of activeDamagePreventions(game, unit, origin)) {
    if (prevention.remaining === "all") return Number.POSITIVE_INFINITY;
    total += prevention.remaining;
  }
  return total;
}

function consumeDamagePrevention(game, unit, amount, origin) {
  let remainingDamage = Math.max(0, amount || 0);
  if (!remainingDamage) return 0;
  for (const prevention of activeDamagePreventions(game, unit, origin)) {
    if (!remainingDamage) break;
    if (prevention.remaining === "all") {
      remainingDamage = 0;
      break;
    }
    const prevented = Math.min(prevention.remaining, remainingDamage);
    prevention.remaining -= prevented;
    remainingDamage -= prevented;
  }
  activeDamagePreventions(game, unit, origin);
  return remainingDamage;
}

export function applyDamage(game, player, source, target, baseAmount, options = {}) {
  if (!target) return 0;
  const origin = options.origin || (source?.type === "spell" ? "spell" : "ability");
  const validBaseDamage = consumeDamagePrevention(
    game,
    target,
    baseDamageAmount(game, source, target, baseAmount, options),
    origin
  );
  const amount = validBaseDamage > 0
    ? validBaseDamage + bonusDamageAmount(game, player, source, target, options)
    : 0;
  target.damage = (target.damage || 0) + amount;
  if (amount > 0) {
    requestCleanup(game, "object-status-change", {
      objectId: target.instanceId,
      status: "damage",
      amount
    });
    game.damageEventSequence = (game.damageEventSequence || 0) + 1;
    target.lastDamageEvent = {
      id: `damage-${game.damageEventSequence}`,
      targetId: target.instanceId,
      origin,
      sourceCardId: source?.instanceId || null,
      sourceCardIds: [...new Set(options.sourceCardIds || [source?.instanceId].filter(Boolean))],
      sourcePlayerId: player?.id || source?.controllerId || null,
      turnSequence: game.turnSequence || 0
    };
    game.damageEvents ||= [];
    game.damageEvents.push(structuredClone(target.lastDamageEvent));
    queueDelayedUnitDamageTriggers(game, target, target.lastDamageEvent, options.deferredTriggerBatches || null);
  }
  return amount;
}

function createDelayedAbility(game, ability) {
  game.nextDelayedAbilitySequence = (game.nextDelayedAbilitySequence || 0) + 1;
  const record = {
    id: `delayed-${game.nextDelayedAbilitySequence}`,
    createdTurnSequence: game.turnSequence || 0,
    ...structuredClone(ability)
  };
  game.delayedAbilities ||= [];
  game.delayedAbilities.push(record);
  return record;
}

function queueDelayedUnitDamageTriggers(game, target, damageEvent, deferredTriggerBatches = null) {
  const currentTurn = game.turnSequence || 0;
  const matching = (game.delayedAbilities || []).filter((ability) =>
    ability.abilityClass === "triggered"
    && ability.condition === "unitTakesDamage"
    && ability.targetId === target.instanceId
    && ability.targetZoneChangeCounter === (target.zoneChangeCounter || 0)
    && ability.expiresAfterTurnSequence >= currentTurn);
  if (!matching.length) return false;
  const consumed = new Set(matching.map((ability) => ability.id));
  game.delayedAbilities = game.delayedAbilities.filter((ability) => !consumed.has(ability.id));
  if (!game.delayedAbilities.length) delete game.delayedAbilities;
  const triggers = matching.map((ability) => ({
    kind: "delayedKillDamagedUnit",
    playerId: ability.controllerId,
    sourceCardId: ability.sourceCardId,
    sourceCardSnapshot: ability.sourceCardSnapshot,
    linkedSetId: ability.linkedSetId,
    data: {
      delayedAbilityId: ability.id,
      damageEventId: damageEvent.id,
      targetId: ability.targetId,
      targetZoneChangeCounter: ability.targetZoneChangeCounter
    }
  }));
  const mode = game.phase === "showdown" && game.showdown
    ? "showdownChain"
    : game.phase === "action" && game.interactive ? "actionChain" : "queue";
  if (deferredTriggerBatches) {
    deferredTriggerBatches.push({ triggers, mode });
    return true;
  }
  return prepareAndQueueTriggers(game, triggers, mode);
}

function bonusDamageToUnitFromBattlefield(game, player, target) {
  const battlefield = target ? findUnitLocation(game, target.instanceId)?.battlefield : null;
  const local = battlefield ? cardEffects(battlefield, "static")
    .filter((effect) => effect.kind === "bonusDamageToUnitsHere")
    .reduce((sum, effect) => sum + (effect.amount || 1), 0) : 0;
  const global = player ? allControlledCards(game, player.id)
    .flatMap((source) => cardEffects(source, "static"))
    .filter((effect) => effect.kind === "globalBonusDamage")
    .reduce((sum, effect) => sum + (effect.amount || 1), 0) : 0;
  return local + global;
}

function spellAbilityDamagePrevented(game, origin) {
  if ((game.preventSpellAbilityDamageUntilTurnSequence ?? -1) < (game.turnSequence || 0)) return false;
  return origin === "spell" || origin === "ability";
}

function resolveKillOnNextDamageOrNowIfLegionChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    if (choice.data.legion) {
      const location = findUnitLocation(game, target.instanceId);
      if (!killUnitForChoice(context, target,
        location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location)) return;
      log(game, `${source.name} kills ${target.name} with Legion.`);
    } else {
      const delayed = createDelayedAbility(game, {
        abilityClass: "triggered",
        condition: "unitTakesDamage",
        controllerId: choice.playerId,
        sourceCardId: source.instanceId,
        sourceCardSnapshot: structuredClone(source),
        targetId: target.instanceId,
        targetZoneChangeCounter: target.zoneChangeCounter || 0,
        expiresAfterTurnSequence: game.turnSequence || 0,
        linkedSetId: `noxian-guillotine:${source.instanceId}:${source.zoneChangeCounter || 0}`
      });
      log(game, `${source.name} marks ${target.name} to die when it next takes damage this turn.`);
      log(game, `${delayed.id} captures ${target.name}'s current object identity independently of ${source.name}'s later zone.`);
    }
    markEffect(game, source, [target.instanceId], `${target.name} is marked.`);
  }
  finishChoiceResolution(context);
}

function resolveDamageOrDrawInsteadChoice({ game, choice, option, source }) {
  const player = game.players.find((candidate) => candidate.id === choice.data.sourcePlayerId);
  const target = findCard(game, choice.data.targetId);
  if (option.id === "draw") {
    if (player) draw(player, choice.data.draw || 0, game);
    log(game, `${source.name} is replaced by ${player?.name || "the player"} drawing ${choice.data.draw || 0}.`);
  } else if (target) {
    const dealt = applyDamage(game, player, source, target, choice.data.baseAmount || 0);
    log(game, `${source.name} deals ${dealt} damage to ${target.name}.`);
  }
  if (choice.data.finishSpell && player) finishSpell(game, player, source);
}

function resolveGiveKeywordChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    for (const keyword of choice.data.keywords || []) {
      const amount = keyword.toLowerCase() === "shield" && choice.data.shieldAmount
        ? choice.data.shieldAmount
        : choice.data.might || null;
      addTemporaryKeyword(target, keyword, amount);
    }
    if (choice.data.tank) addTemporaryKeyword(target, "Tank");
    if (target.temporaryKeywordAmounts?.shield != null) {
      target.temporaryShieldAmount = target.temporaryKeywordAmounts.shield;
    }
    log(game, `${source.name} gives ${target.name} ${(choice.data.keywords || []).join(", ")} this turn.`);
    markEffect(game, source, [target.instanceId], `${target.name} gains a keyword.`);
  }
  finishChoiceResolution(context);
}

function resolveDoubleMightTemporaryChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    addMightModifier(target, currentMight(game, target), { temporary: true });
    if (choice.data.temporary) target.temporary = true;
    log(game, `${source.name} doubles ${target.name}'s Might and makes it Temporary.`);
    markEffect(game, source, [target.instanceId], `${target.name}'s Might doubles.`);
  }
  finishChoiceResolution(context);
}

function resolveMatchFriendlyMightTargetChoice(context) {
  const { game, choice, player, source, target } = context;
  if (!target) return finishChoiceResolution(context);
  const units = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => unit.instanceId !== target.instanceId)
    .filter((unit) => canChooseUnit(game, player, source, unit));
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "matchFriendlyMightSource",
    prompt: `Choose another friendly unit for ${source.name}.`,
    options: units.map(cardOption),
    optional: false,
    data: { targetId: target.instanceId, temporary: Boolean(choice.data.temporary) }
  };
  if (!nextChoice.options.length) return finishChoiceResolution(context);
  presentPreparedChoice(game, nextChoice);
}

function resolveMatchFriendlyMightSourceChoice(context) {
  const { game, choice, source, target } = context;
  const chosenTarget = findCard(game, choice.data.targetId);
  if (chosenTarget && target) {
    const amount = Math.max(0, currentMight(game, target) - currentMight(game, chosenTarget));
    if (amount > 0) addMightModifier(chosenTarget, amount, { temporary: Boolean(choice.data.temporary) });
    log(game, `${source.name} increases ${chosenTarget.name}'s Might to match ${target.name}.`);
    markEffect(game, source, [chosenTarget.instanceId, target.instanceId], `${chosenTarget.name} matches ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveBanishFriendlyUnitPlayToBaseChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    const location = findUnitLocation(game, target.instanceId);
    const owner = game.players.find((player) => player.id === target.ownerId);
    if (location && owner) {
      banishCards(game, player, [target], source);
      target.controllerId = owner.id;
      playCardIgnoringCostFromEffect(game, owner, target, source);
      updateBattlefieldControl(game);
      log(game, `${source.name} banishes ${target.name}, then ${owner.name} plays it to base.`);
      markEffect(game, source, [target.instanceId], `${target.name} is replayed to base.`);
    }
  }
  finishChoiceResolution(context);
}

function resolveKillUnitChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    const controller = game.players.find((candidate) => candidate.id === target.controllerId);
    const location = findUnitLocation(game, target.instanceId);
    if (!killUnitForChoice(context, target,
      {
        ...(location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location),
        eventModifications: structuredClone(choice.data?.eventModifications || {})
      })) return;
    if (choice.data.drawController && controller) draw(controller, choice.data.drawController, game);
    log(game, `${source.name} kills ${target.name}.`);
    markEffect(game, source, [target.instanceId], `${target.name} is killed.`);
  }
  finishChoiceResolution(context);
}

function resolveOnPlayDuelEnemyChoice(context) {
  const { game, source, target } = context;
  if (target) {
    const sourceMight = currentMight(game, source);
    const targetMight = currentMight(game, target);
    const sourceController = game.players.find((candidate) => candidate.id === source.controllerId);
    const targetController = game.players.find((candidate) => candidate.id === target.controllerId);
    applyDamage(game, targetController, target, source, targetMight, { origin: "unit" });
    applyDamage(game, sourceController, source, target, sourceMight, { origin: "unit" });
    log(game, `${source.name} and ${target.name} deal damage to each other.`);
    markEffect(game, source, [source.instanceId, target.instanceId], `${source.name} duels ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveStunOrKillEnemyChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    if (target.stunned) {
      const location = findUnitLocation(game, target.instanceId);
      if (!killUnitForChoice(context, target,
        location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location)) return;
      log(game, `${source.name} kills stunned ${target.name}.`);
      markEffect(game, source, [target.instanceId], `${target.name} is killed.`);
    } else {
      stunUnit(game, player, source, target);
      log(game, `${source.name} stuns ${target.name}.`);
      markEffect(game, source, [target.instanceId], `${target.name} is stunned.`);
    }
  }
  finishChoiceResolution(context);
}

function resolveStunUnitChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    if (choice.data.returnIfStunned && target.stunned) {
      returnUnitToHand(game, target, source.name);
      markEffect(game, source, [target.instanceId], `${target.name} returns to hand.`);
    } else {
      stunUnit(game, player, source, target);
      if (choice.data.ping) applyDamage(game, player, source, target, 1);
      log(game, `${source.name} stuns ${target.name}.`);
      markEffect(game, source, [target.instanceId], `${target.name} is stunned.`);
    }
    if (choice.data.draw) draw(player, choice.data.draw, game);
  }
  finishChoiceResolution(context);
}

function resolveReturnUnitToBaseChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    const remaining = (choice.data.max || 1) - 1;
    const nextChoice = remaining > 0 ? {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      data: { ...choice.data, max: remaining },
      options: battlefieldUnitTargets(game, player, choice.data.scope)
        .filter((candidate) => candidate.unit.instanceId !== target.instanceId)
        .filter((candidate) => canMoveUnitFromBattlefieldToBase(game, candidate.unit))
        .filter((candidate) => canChooseUnit(game, player, source, candidate.unit))
        .map((candidate) => cardOption(candidate.unit)),
      optional: true
    } : null;
    if (!moveUnitBySpell(game, player, source, target, "base", {
      continuationChoice: nextChoice?.options.length ? nextChoice : null
    })) {
      finishChoiceResolution(context);
      return;
    }
    markEffect(game, source, [target.instanceId], `${target.name} moves to base.`);
  }
  finishChoiceResolution(context);
}

function resolveReturnUnitToHandChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    const owner = game.players.find((candidate) => candidate.id === target.ownerId);
    returnUnitToHand(game, target, source.name);
    if (choice.data?.channelOwner && owner) channelRunes(game, owner, choice.data.channelOwner, {
      exhausted: choice.data?.channelOwnerExhausted !== false,
      source,
      responsiblePlayerId: player?.id || choice.playerId,
      reason: "effect"
    });
    markEffect(game, source, [target.instanceId], `${target.name} returns to hand.`);
  }
  finishChoiceResolution(context);
}

function resolveReturnFriendlyPermanentOrHiddenToHandChoice(context) {
  const { game, source, target } = context;
  if (target) {
    const owner = game.players.find((player) => player.id === target.ownerId);
    const hidden = findHiddenCardLocation(game, target.instanceId);
    if (hidden && owner) {
      recordRevealEvent(game, owner, [target], source, "facedown");
      hidden.battlefield.hidden.splice(hidden.index, 1);
      target.hidden = false;
      clearBoardState(game, target);
      owner.hand.push(target);
      log(game, `${source.name} returns a hidden card to ${owner.name}'s hand.`);
      markEffect(game, source, [target.instanceId], `${target.name} returns to hand.`);
    } else if (target.type === "unit") {
      returnUnitToHand(game, target, source.name);
      markEffect(game, source, [target.instanceId], `${target.name} returns to hand.`);
    } else if (target.type === "gear" && owner) {
      removeGearEverywhere(game, target.instanceId);
      clearBoardState(game, target);
      owner.hand.push(target);
      log(game, `${source.name} returns ${target.name} to hand.`);
      markEffect(game, source, [target.instanceId], `${target.name} returns to hand.`);
    }
  }
  finishChoiceResolution(context);
}

function resolveReturnTrashUnitToHandChoice(context) {
  const { player, source, target } = context;
  const index = player.trash.findIndex((card) => card.instanceId === target?.instanceId);
  if (index >= 0) {
    const [returned] = player.trash.splice(index, 1);
    markNonBoardZoneChange(returned);
    player.hand.push(returned);
    log(context.game, `${source.name} returns ${returned.name} from trash to hand.`);
    markEffect(context.game, source, [returned.instanceId], `${returned.name} returns to hand.`);
  }
  finishChoiceResolution(context);
}

function resolveReturnOwnedTagUnitToHandChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    if (target === player.champion || target.instanceId === player.champion?.instanceId) {
      const location = findUnitLocation(game, target.instanceId);
      if (location) {
        removeUnitFromSource(location);
        detachAttachmentsToBase(game, target, location);
      }
      clearBoardState(game, target);
      setChampionZoneState(player, player.champion, "champion");
      updateBattlefieldControl(game);
      log(game, `${source.name} returns ${target.name} to the Champion Zone.`);
    } else {
      returnUnitToHand(game, target, source.name);
    }
    markEffect(game, source, [target.instanceId], `${target.name} returns.`);
  }
  finishChoiceResolution(context);
}

function resolveReturnHiddenTrashToHandChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    const index = player.trash.findIndex((card) => card.instanceId === target.instanceId);
    if (index >= 0) {
      const [returned] = player.trash.splice(index, 1);
      markNonBoardZoneChange(returned);
      player.hand.push(returned);
      log(game, `${source.name} returns ${returned.name} from trash to hand.`);
      markEffect(game, source, [returned.instanceId], `${returned.name} returns to hand.`);
    }
  }
  const remaining = Math.max(0, (choice.data?.remaining || 1) - 1);
  if (remaining > 0) {
    const options = player.trash
      .filter((candidate) => candidate.keywords?.includes("Hidden") || candidate.tags?.includes("Hidden"))
      .map(cardOption);
    if (options.length) {
      const nextChoice = {
        ...choice,
        id: `choice-${Date.now()}-${Math.random()}`,
        options,
        data: { ...choice.data, remaining }
      };
      presentPreparedChoice(game, nextChoice);
      return;
    }
  }
  finishChoiceResolution(context);
}

function resolveKillBattlefieldUnitsTotalMightMaxChoice(context) {
  const { game, choice, player, source, option } = context;
  const maxMight = choice.data?.maxMight || 4;
  const declarations = source.declaredPlayTargets || [];
  const selectedIds = [...new Set(declarations
    .filter((declaration) => declaration.effect === "killBattlefieldUnitsSelection")
    .map((declaration) => declaration.targetId))];
  source.declaredPlayTargets = declarations.filter((declaration) => declaration.effect !== "killBattlefieldUnitsSelection");
  const currentTargets = aggregateTargetGroup(game, selectedIds, maxMight);
  if (currentTargets) {
    resolveAggregateTargetKills(context, currentTargets.units, currentTargets.battlefield);
    return;
  }
  const subsets = legalAggregateTargetSubsets(game, selectedIds, maxMight);
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "repairAggregateTargets",
    prompt: `Choose a still-legal subset of ${source.name}'s original targets.`,
    options: subsets.map((subset, index) => ({
      id: `aggregate-subset-${index}`,
      label: subset.units.length ? subset.units.map((unit) => unit.name).join(", ") : "Affect no targets",
      cardIds: subset.units.map((unit) => unit.instanceId),
      battlefieldId: subset.battlefield?.instanceId || null,
      totalMight: subset.totalMight
    })),
    data: {
      ...choice.data,
      originalTargetIds: selectedIds,
      maxMight
    },
    finishSpell: false,
    optional: false
  };
  presentPreparedChoice(game, nextChoice);
}

function aggregateTargetGroup(game, targetIds, maxMight) {
  const units = targetIds.map((id) => findCard(game, id)).filter(Boolean);
  if (units.length !== targetIds.length) return null;
  if (!units.length) return { units: [], battlefield: null, totalMight: 0 };
  const locations = units.map((unit) => findUnitLocation(game, unit.instanceId));
  const battlefield = locations[0]?.type === "battlefield" ? locations[0].battlefield : null;
  if (!battlefield || locations.some((location) => location?.battlefield?.instanceId !== battlefield.instanceId)) return null;
  const totalMight = units.reduce((sum, unit) => sum + currentMight(game, unit), 0);
  return totalMight <= maxMight ? { units, battlefield, totalMight } : null;
}

function legalAggregateTargetSubsets(game, originalTargetIds, maxMight) {
  const candidates = originalTargetIds
    .map((id) => findCard(game, id))
    .filter((unit) => findUnitLocation(game, unit?.instanceId)?.type === "battlefield");
  const subsets = [{ units: [], battlefield: null, totalMight: 0 }];
  const limit = 1 << candidates.length;
  for (let mask = 1; mask < limit; mask += 1) {
    const ids = candidates.filter((unit, index) => mask & (1 << index)).map((unit) => unit.instanceId);
    const group = aggregateTargetGroup(game, ids, maxMight);
    if (group) subsets.push(group);
  }
  return subsets.sort((left, right) =>
    right.units.length - left.units.length || right.totalMight - left.totalMight);
}

function resolveAggregateTargetKills(context, units, battlefield) {
  const { game, source } = context;
  const completed = new Set(context.choice.data?.completedUnitKillIds || []);
  for (const unit of units.filter((candidate) => !completed.has(candidate.instanceId))) {
    const location = findUnitLocation(game, unit.instanceId);
    if (!killUnitForChoice(context, unit,
      location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location)) return;
  }
  markEffect(game, source, units.map((unit) => unit.instanceId),
    `${source.name} kills units${battlefield ? ` at ${battlefield.name}` : ""}.`);
  finishChoiceResolution(context);
}

function resolveRepairAggregateTargetsChoice(context) {
  const { game, option } = context;
  const group = aggregateTargetGroup(game, option.cardIds || [], context.choice.data?.maxMight || 4)
    || { units: [], battlefield: null };
  resolveAggregateTargetKills(context, group.units, group.battlefield);
}

function resolveDamageEnemyUnitsAtBattlefieldByReadyRunesChoice(context) {
  const { game, player, source, option } = context;
  const battlefield = game.battlefields.find((field) => field.instanceId === option.cardId);
  if (battlefield) {
    const declaredRuneIds = (source.declaredPlayTargets || [])
      .filter((declaration) => declaration.effect === "runeDamagePaymentRune")
      .map((declaration) => declaration.targetId);
    source.declaredPlayTargets = (source.declaredPlayTargets || [])
      .filter((declaration) => declaration.effect !== "runeDamagePaymentRune");
    const paidRuneIds = [...new Set(declaredRuneIds)]
      .filter((runeId) => player.runes.some((rune) => rune.instanceId === runeId && !rune.exhausted));
    recyclePowerRunesInChosenOrder(game, player, paidRuneIds);
    const amount = paidRuneIds.length;
    const targets = battlefield.units.filter((unit) => unit.controllerId !== player.id);
    for (const unit of [...targets]) {
      applyDamage(game, player, source, unit, amount);
    }
    log(game, `${source.name} pays ${amount} Rune and deals that much damage to enemy units at ${battlefield.name}.`);
    markEffect(game, source, targets.map((unit) => unit.instanceId), `${source.name} damages enemies.`);
  }
  finishChoiceResolution(context);
}

function resolveDealDamageAllEnemyUnitsAtBattlefieldChoice(context) {
  const { game, choice, player, source, option } = context;
  const battlefield = game.battlefields.find((field) => field.instanceId === option.cardId);
  if (battlefield) {
    const targets = battlefield.units.filter((unit) => unit.controllerId !== player.id);
    const amounts = targets.map((unit) => applyDamage(game, player, source, unit, choice.data.amount || 0));
    log(game, `${source.name} deals ${choice.data.amount || 0} damage to enemy units at ${battlefield.name}.`);
    markEffect(game, source, targets.map((unit) => unit.instanceId), `${source.name} deals ${Math.max(0, ...amounts)} damage.`);
  }
  finishChoiceResolution(context);
}

function resolvePlayUnitTokenDestinationChoice(context) {
  const { game, choice, player, source, option } = context;
  const spec = choice.data.spec || {};
  const destination = option.cardId === "base" ? "base" : option.cardId;
  playUnitToken(game, player, source, { ...spec, count: 1 }, destination);
  const remaining = Math.max(0, (choice.data.remaining || 1) - 1);
  if (remaining > 0) {
    chooseEachTokenDestination(game, player, source, spec, choice.finishSpell, remaining);
    return;
  }
  finishChoiceResolution(context);
}

function resolveSaveFriendlyUnitThisTurnChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    target.saveWithRuneUntilTurnSequence = game.turnSequence || 0;
    target.saveWithRuneDomain = choice.data?.domain || null;
    target.saveWithRuneSourceName = source.name;
    log(game, `${source.name} prepares to save ${target.name} this turn.`);
    markEffect(game, source, [target.instanceId], `${target.name} can be saved this turn.`);
  }
  finishChoiceResolution(context);
}

function resolvePreparedDeathRecallPaymentChoice({ game, choice, option, target }) {
  if (!target) return;
  const domain = choice.data?.domain;
  if (option.id === "pay-death-recall" && payAdditionalPower(game, game.players.find((player) => player.id === target.controllerId), { domain, amount: 1 }, true)) {
    target.preparedDeathRecallPaymentApproved = true;
  } else {
    clearPreparedDeathRecall(target);
  }
  if (choice.data?.resumeCleanup) return;
  const location = findUnitLocation(game, target.instanceId);
  killUnit(game, target,
    location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location,
    choice.explicitDeathContinuation || null);
  if (choice.explicitDeathContinuation) {
    continueExplicitDeathContinuation(game, choice.explicitDeathContinuation);
  }
}

function resolvePlayTrashUnitChoice(context) {
  const { game, choice, player, source, target } = context;
  const index = player.trash.findIndex((card) => card.instanceId === target?.instanceId);
  if (index >= 0) {
    const candidate = player.trash[index];
    if (choice.data?.ignorePowerCost || payPowerRequirements(game, player, normalizeCardPowerRequirements(candidate, candidate.power || []))) {
      const [played] = player.trash.splice(index, 1);
      playCardIgnoringCostFromEffect(game, player, played, source, choice.data?.destination || "base");
      log(game, `${source.name} plays ${played.name} from trash.`);
      markEffect(game, source, [played.instanceId], `${played.name} played from trash.`);
    } else {
      log(game, `${source.name} cannot pay ${candidate.name}'s Power cost.`);
    }
  }
  finishChoiceResolution(context);
}

function resolveDiscardOpponentHandChoice(context) {
  const { game, choice, option, source } = context;
  const opponent = game.players.find((candidate) => candidate.id === choice.data.opponentId);
  const index = opponent?.hand.findIndex((card) => card.instanceId === option.cardId) ?? -1;
  if (index >= 0) {
    const [discarded] = discardCardsFromHand(game, opponent, [opponent.hand[index]], source);
    triggerDiscardEffects(game, opponent, [discarded], source);
    log(game, `${source.name} makes ${opponent.name} discard ${discarded.name}.`);
    markEffect(game, source, [discarded.instanceId], `${discarded.name} discarded.`);
  }
  finishChoiceResolution(context);
}

function resolveMoveUnitSpellTargetChoice(context) {
  const { game, choice, player, source, target } = context;
  if (!target) return finishChoiceResolution(context);
  const options = spellMoveDestinationOptions(game, target);
  const declaredDestination = consumeDeclaredPlayChoice(source, "moveUnitSpellDestination", options, (declaration) => declaration.unitId === target.instanceId);
  if (declaredDestination) {
    if (!declaredDestination.option) {
      log(game, `${source.name}'s declared move destination is no longer legal.`);
      if (choice.finishSpell) finishSpell(game, player, source);
      return;
    }
    const nextChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      effect: "moveUnitSpellDestination",
      prompt: `Move ${target.name} to the declared destination.`,
      options,
      optional: false,
      data: { ...choice.data, unitId: target.instanceId }
    };
    applyChoiceEffect(game, nextChoice, declaredDestination.option);
    return;
  }
  if (options.length) {
    const nextChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      effect: "moveUnitSpellDestination",
      prompt: `Choose where to move ${target.name}.`,
      options,
      optional: false,
      data: { ...choice.data, unitId: target.instanceId }
    };
    if (!game.interactive) {
      applyChoiceEffect(game, nextChoice, nextChoice.options[0]);
      return;
    }
    game.pendingChoice = nextChoice;
    return;
  }
  finishChoiceResolution(context);
}

function resolveMoveUnitSpellDestinationChoice(context) {
  const { game, choice, option, player, source } = context;
  const unit = findCard(game, choice.data.unitId);
  if (unit?.type === "unit") {
    const destination = option.destination || option.cardId || "base";
    moveUnitBySpell(game, player, source, unit, destination, { readyAfterMove: Boolean(choice.data.readyAfterMove) });
    markEffect(game, source, [unit.instanceId, option.cardId].filter(Boolean), `${unit.name} moves.`);
    if (choice.data.duelAnotherEnemyAtDestination) {
      prepareAndQueueTriggers(game, [{
        kind: "reflexiveDragonsRageDuel",
        playerId: player.id,
        sourceCardId: source.instanceId,
        sourceCardSnapshot: structuredClone(source),
        data: { movedUnitId: unit.instanceId }
      }], game.phase === "showdown" && game.showdown ? "showdownChain" : "actionChain");
    }
  }
  finishChoiceResolution(context);
}

function resolveDragonsRageEnemyChoice(context) {
  const { game, choice, source, target } = context;
  const moved = findCard(game, choice.data?.movedUnitId);
  if (moved && target) {
    const movedController = game.players.find((candidate) => candidate.id === moved.controllerId);
    const targetController = game.players.find((candidate) => candidate.id === target.controllerId);
    const movedMight = currentMight(game, moved);
    const targetMight = currentMight(game, target);
    applyDamage(game, targetController, target, moved, targetMight, { origin: "unit" });
    applyDamage(game, movedController, moved, target, movedMight, { origin: "unit" });
    log(game, `${source.name} makes ${moved.name} and ${target.name} deal damage equal to their Mights to each other.`);
    markEffect(game, source, [moved.instanceId, target.instanceId], `${source.name} resolves its destination duel.`);
  }
  finishChoiceResolution(context);
}

function resolveMoveUnitToSourceBattlefieldChoice(context) {
  const { game, choice, option, player, source, target } = context;
  if (option.id !== "decline" && target) {
    const battlefield = game.battlefields.find((field) => field.instanceId === choice.data?.battlefieldId);
    if (battlefield && findUnitLocation(game, target.instanceId)) {
      moveUnitBySpell(game, player, source, target, battlefield.instanceId);
      markEffect(game, source, [target.instanceId], `${target.name} moves to ${battlefield.name}.`);
    }
  }
  finishChoiceResolution(context);
}

function resolveMoveWithFriendlyFromSameBattlefieldChoice(context) {
  const { game, choice, option, player, source } = context;
  const companion = findCard(game, choice.data.companionId);
  if (option.id === "move" && companion) {
    if (findUnitLocation(game, companion.instanceId)) {
      moveUnitBySpell(game, player, source, companion, choice.data.destinationId);
      log(game, `${source.name} moves with a friendly unit.`);
      markEffect(game, source, [source.instanceId], `${source.name} moves with a friendly unit.`);
    }
  }
  finishAfterMoveChoice(game, choice.data.afterMove);
}

function resolveCounterChainCardChoice(context) {
  const { game, option, source } = context;
  counterChainCard(game, option.cardId, source.name);
  markEffect(game, source, [], `${source.name} counters ${option.label}.`);
  finishChoiceResolution(context);
}

function resolveGainControlOfChainSpellChoice(context) {
  const { game, choice, player, option, source } = context;
  const item = activeSpellChain(game).find((candidate) => candidate.card.instanceId === option.cardId);
  if (item) {
    item.playerId = player.id;
    item.card.controllerId = player.id;
    log(game, `${player.name} gains control of ${item.card.name} with ${source.name}.`);
    markEffect(game, source, [item.card.instanceId], `${item.card.name} changes controller.`);
    presentPreparedChoice(game, {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: player.id,
      effect: "gainControlNewChoices",
      prompt: `Make new choices for ${item.card.name}?`,
      options: [
        { id: "new", label: "Make new choices", cardId: item.card.instanceId },
        { id: "keep", label: "Keep its existing choices", cardId: item.card.instanceId }
      ],
      data: { targetCardId: item.card.instanceId }
    });
    return;
  }
  finishChoiceResolution(context);
}

function resolveGainControlNewChoicesChoice(context) {
  const { game, option, source } = context;
  const controlledSpell = findCard(game, context.choice.data.targetCardId);
  if (controlledSpell && option.id === "new") {
    controlledSpell.declaredPlayTargets = [];
    controlledSpell.declaredPlayChoices = [];
    log(game, `${controlledSpell.name}'s controller will make new choices when it resolves.`);
    markEffect(game, source, [controlledSpell.instanceId], `${controlledSpell.name}'s choices are reset.`);
  }
  finishChoiceResolution(context);
}

function resolveDivineJudgmentKeepChoice(context) {
  const { game, choice, option, source } = context;
  const selectedIds = [...(choice.data.selectedIds || []), option.cardId].filter(Boolean);
  const category = DIVINE_JUDGMENT_CATEGORIES[choice.data.categoryIndex];
  if (selectedIds.length < 2) {
    continueDivineJudgmentChoice(game, source, { ...choice.data, selectedIds });
    return;
  }
  const kept = choice.data.kept || {};
  kept[choice.playerId] ||= {};
  kept[choice.playerId][category] = selectedIds;
  continueDivineJudgmentChoice(game, source, nextDivineJudgmentStage({ ...choice.data, kept, selectedIds }));
}

function resolveDivineJudgmentRuneOrderChoice({ game, choice, option, source }) {
  const selectedRuneOrderIds = [...(choice.data.selectedRuneOrderIds || []), option.cardId];
  const chooser = game.players.find((candidate) => candidate.id === choice.playerId);
  const keptRunes = new Set(choice.data.kept[choice.playerId]?.runes || []);
  const excessCount = chooser?.runes.filter((rune) => !keptRunes.has(rune.instanceId)).length || 0;
  if (selectedRuneOrderIds.length < excessCount) {
    continueDivineJudgmentRuneOrder(game, source, { ...choice.data, selectedRuneOrderIds });
    return;
  }
  const runeRecycleOrder = choice.data.runeRecycleOrder || {};
  runeRecycleOrder[choice.playerId] = selectedRuneOrderIds;
  continueDivineJudgmentRuneOrder(game, source, {
    ...choice.data,
    runeRecycleOrder,
    runeOrderPlayerIndex: (choice.data.runeOrderPlayerIndex || 0) + 1,
    selectedRuneOrderIds: []
  });
}

function resolveCounterUnlessPayChoice(context) {
  const { game, choice, option, source } = context;
  const item = activeSpellChain(game).find((candidate) => candidate.card.instanceId === option.cardId);
  const controller = item && game.players.find((candidate) => candidate.id === item.playerId);
  const amount = choice.data.amount || 2;
  if (controller && payEnergyIfPossible(game, controller, amount, true)) {
    const decision = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      effect: "counterUnlessPayDecision",
      prompt: `${controller.name}: pay Energy ${amount} to stop ${source.name} from countering ${item.card.name}?`,
      options: [
        { id: "pay", label: `Pay Energy ${amount}` },
        { id: "decline", label: "Do not pay" }
      ],
      data: {
        ...choice.data,
        targetCardId: item.card.instanceId,
        controllerId: controller.id,
        amount
      }
    };
    if (!game.interactive) {
      applyChoiceEffect(game, decision, decision.options[0]);
      return;
    }
    game.pendingChoice = decision;
    return;
  }
  counterChainCard(game, option.cardId, source.name);
  markEffect(game, source, [], `${source.name} counters ${option.label}.`);
  finishChoiceResolution(context);
}

function resolveCounterUnlessPayDecisionChoice(context) {
  const { game, choice, option, source } = context;
  const item = activeSpellChain(game).find((candidate) => candidate.card.instanceId === choice.data.targetCardId);
  const controller = game.players.find((candidate) => candidate.id === choice.data.controllerId);
  if (option.id === "pay" && controller && beginEffectEnergyPayment(game, controller, source, choice.data.amount || 2, {
    kind: "counterUnlessPayDecision",
    sourcePlayerId: choice.playerId,
    targetCardId: choice.data.targetCardId,
    controllerId: controller.id,
    amount: choice.data.amount || 2,
    finishSpell: choice.finishSpell,
    fromShowdownChain: choice.fromShowdownChain
  })) return;
  counterChainCard(game, choice.data.targetCardId, source.name);
  markEffect(game, source, [], `${source.name} counters ${item?.card.name || "the spell"}.`);
  finishChoiceResolution(context);
}

function resolveSabotageChoice(context) {
  const { game, choice, option, player, source } = context;
  const opponent = game.players.find((candidate) => candidate.id === choice.data.opponentId);
  const index = opponent?.hand.findIndex((card) => card.instanceId === option.cardId) ?? -1;
  if (index >= 0) {
    if (opponent.hand[index].type === "unit") {
      log(game, `${source.name} cannot choose a unit card.`);
      return;
    }
    const [recycled] = opponent.hand.splice(index, 1);
    recycleMainDeckCards(game, player, [recycled], source);
    log(game, `${source.name} recycles ${recycled.name} from ${opponent.name}'s hand.`);
    markEffect(game, source, [], `${recycled.name} recycled.`);
  }
  finishChoiceResolution(context);
}

function resolveChooseTopDeckChoice(context) {
  const { game, choice, option, player, source } = context;
  const index = player.mainDeck.findIndex((card) => card.instanceId === option.cardId);
  if (index >= 0) {
    const [chosen] = player.mainDeck.splice(index, 1);
    const recycleIds = new Set((choice.data?.topCardIds || []).filter((id) => id !== chosen.instanceId));
    const recycled = player.mainDeck.filter((candidate) => recycleIds.has(candidate.instanceId));
    player.hand.push(chosen);
    recycleMainDeckCards(game, player, recycled, source);
    log(game, `${source.name} puts ${chosen.name} into hand and recycles the rest.`);
    markEffect(game, source, [chosen.instanceId], `${chosen.name} chosen.`);
  }
  finishChoiceResolution(context);
}

function resolveRecycleTopDeckChoice(context) {
  const { game, choice, option, player, source } = context;
  const topIds = choice.data?.cardIds || [];
  const topCards = topIds
    .map((id) => player.mainDeck.find((card) => card.instanceId === id))
    .filter(Boolean);
  if (!topCards.length) {
    finishChoiceResolution(context);
    return;
  }
  const topIdSet = new Set(topIds);
  const remainder = player.mainDeck.filter((card) => !topIdSet.has(card.instanceId));
  let returned = topCards;
  let recycled = [];
  if (option.id === "swap") returned = [...topCards].reverse();
  if (option.id === "recycle-all") {
    returned = [];
    recycled = topCards;
  } else if (option.id.startsWith("recycle-")) {
    const recycleIndex = Number(option.id.split("-")[1]);
    recycled = topCards.filter((card, index) => index === recycleIndex);
    returned = topCards.filter((card, index) => index !== recycleIndex);
  }
  player.mainDeck = [...returned, ...remainder];
  recycleMainDeckCards(game, player, recycled, source);
  const recycledNames = recycled.map((card) => card.name).join(", ");
  log(game, recycled.length
    ? `${source.name} recycles ${recycledNames}.`
    : `${source.name} puts the cards back.`);
  markEffect(game, source, [source.instanceId, ...topCards.map((card) => card.instanceId)], `${source.name} resolves.`);
  finishChoiceResolution(context);
}

function resolveTrashGearChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    killGear(game, target, source);
    const buffSource = choice.data?.buffSourceAfterKill ? findCard(game, choice.data.buffSourceAfterKill) : null;
    if (buffSource) addMightModifier(buffSource, choice.data?.buffAmount || 1, { buff: true, maxBuffs: choice.data?.maxBuffs });
    log(game, `${source.name} trashes ${target.name}.`);
    markEffect(game, source, [target.instanceId, buffSource?.instanceId].filter(Boolean), `${target.name} is trashed.`);
  }
  if (choice.data?.draw) draw(player, choice.data.draw, game);
  finishChoiceResolution(context);
}

function resolveMarkTemporaryGearChoice(context) {
  const { game, source, target } = context;
  if (target) {
    target.temporary = true;
    log(game, `${source.name} gives ${target.name} Temporary.`);
    markEffect(game, source, [target.instanceId], `${target.name} becomes Temporary.`);
  }
  finishChoiceResolution(context);
}

function resolveMarkTemporaryPermanentChoice(context) {
  const { game, source, target } = context;
  if (target) {
    target.temporary = true;
    log(game, `${source.name} gives ${target.name} Temporary.`);
    markEffect(game, source, [target.instanceId], `${target.name} becomes Temporary.`);
  }
  finishChoiceResolution(context);
}

function resolveAlphaStrikeChoice(context) {
  const { game, choice, player, source, target } = context;
  if (!target) return finishChoiceResolution(context);
  const declarations = source.declaredPlayTargets || [];
  const declaredTargetIds = declarations
    .filter((declaration) => declaration.effect === "alphaStrikeDamageTarget")
    .map((declaration) => declaration.targetId);
  source.declaredPlayTargets = declarations.filter((declaration) => declaration.effect !== "alphaStrikeDamageTarget");
  const config = {
    amountSourceUnitId: target.instanceId,
    damageSourceUnitId: target.instanceId,
    damageOrigin: "unit",
    targetScope: "enemyBattlefield",
    gainXpPerKill: 1,
    markMessage: `${source.name} splits ${currentMight(game, target)} damage.`
  };
  if (declaredTargetIds.length) {
    beginSplitDamageResolution(context, declaredTargetIds,
      splitDamageAvailableAmount(game, player, source, config), config);
    return;
  }
  const initialAmount = Math.max(0, currentMight(game, target));
  const candidates = splitDamageCandidateUnits(game, player, source, config);
  if (initialAmount > 0 && candidates.length) {
    promptSplitDamageTargetSelection(context, candidates, initialAmount, config);
    return;
  }
  finishChoiceResolution(context);
}

function splitDamageAvailableAmount(game, player, source, config, bonusTarget = null) {
  let baseAmount;
  if (config.amountSourceUnitId) {
    const sourceUnit = findCard(game, config.amountSourceUnitId);
    baseAmount = sourceUnit ? Math.max(0, currentMight(game, sourceUnit)) : 0;
  } else {
    baseAmount = Math.max(0, config.amount || 0);
  }
  if (baseAmount <= 0) return 0;
  const damageSource = findCard(game, config.damageSourceUnitId) || source;
  const origin = config.damageOrigin || (config.damageSourceUnitId ? "unit" : undefined);
  if (spellAbilityDamagePrevented(game, origin || (damageSource?.type === "spell" ? "spell" : "ability"))) return 0;
  const representative = bonusTarget || splitDamageCandidateUnits(game, player, source, config)[0] || null;
  return baseAmount + bonusDamageAmount(game, player, damageSource, representative, { origin });
}

function splitDamageCandidateUnits(game, player, source, config) {
  const sourceField = config.sourceBattlefieldId
    ? game.battlefields.find((field) => field.instanceId === config.sourceBattlefieldId)
    : null;
  const candidates = sourceField ? sourceField.units : game.battlefields.flatMap((field) => field.units);
  return candidates
    .filter((unit) => unit.controllerId !== player.id)
    .filter((unit) => canChooseUnit(game, player, source, unit));
}

function promptSplitDamageTargetSelection(context, candidates, maxTargets, config, selectedTargetIds = []) {
  const { game, choice, player, source } = context;
  const selected = [...new Set(selectedTargetIds)];
  const remaining = candidates.filter((unit) => !selected.includes(unit.instanceId));
  if (selected.length >= maxTargets || (!remaining.length && selected.length)) {
    beginSplitDamageResolution(context, selected,
      splitDamageAvailableAmount(game, player, source, config, findCard(game, selected[0])), config);
    return;
  }
  const nextChoice = {
    ...(choice || {}),
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "splitDamageChooseTarget",
    prompt: `Choose targets for ${source.name}'s split damage.`,
    options: [
      ...remaining.map(cardOption),
      ...(selected.length ? [{ id: "finish-split-targets", label: "Finish choosing targets", cardId: null }] : [])
    ],
    data: {
      ...(choice?.data || {}),
      splitDamage: { config, maxTargets, selectedTargetIds: selected }
    },
    finishSpell: Boolean(choice?.finishSpell),
    optional: false
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveSplitDamageChooseTargetChoice(context) {
  const { game, choice, option, player, source } = context;
  const state = choice.data?.splitDamage || {};
  const config = state.config || {};
  const selected = [...new Set([
    ...(state.selectedTargetIds || []),
    ...(option.cardId ? [option.cardId] : [])
  ])];
  if (!option.cardId || selected.length >= (state.maxTargets || 0)) {
    beginSplitDamageResolution(context, selected,
      splitDamageAvailableAmount(game, player, source, config, findCard(game, selected[0])), config);
    return;
  }
  promptSplitDamageTargetSelection(context,
    splitDamageCandidateUnits(game, player, source, config), state.maxTargets, config, selected);
}

function beginSplitDamageResolution(context, targetIds, totalDamage, config) {
  const { game, choice, player, source } = context;
  const candidates = splitDamageCandidateUnits(game, player, source, config);
  const validIds = [...new Set(targetIds)].filter((id) => candidates.some((unit) => unit.instanceId === id));
  if (!validIds.length || totalDamage <= 0) {
    markEffect(game, source, [source.instanceId], config.markMessage || `${source.name} deals no split damage.`);
    finishChoiceResolution(context);
    return;
  }
  const state = {
    config,
    targetIds: validIds,
    remainingTargetIds: validIds,
    remainingDamage: totalDamage,
    allocations: []
  };
  if (validIds.length > totalDamage) {
    presentSplitDamageRemovalChoice(context, state);
    return;
  }
  presentSplitDamageAllocationChoice(context, state);
}

function presentSplitDamageRemovalChoice(context, state) {
  const { game, choice, player, source } = context;
  const options = state.remainingTargetIds
    .map((id) => findCard(game, id))
    .filter(Boolean)
    .map((unit) => ({ ...cardOption(unit), label: `Remove ${unit.name} from the split` }));
  const nextChoice = {
    ...(choice || {}),
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "splitDamageRemoveTarget",
    prompt: `Choose a target to remove from ${source.name}; there is not enough damage for every target.`,
    options,
    data: { ...(choice?.data || {}), splitDamage: state },
    finishSpell: Boolean(choice?.finishSpell),
    optional: false
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveSplitDamageRemoveTargetChoice(context) {
  const state = structuredClone(context.choice.data?.splitDamage || {});
  state.targetIds = (state.targetIds || []).filter((id) => id !== context.option.cardId);
  state.remainingTargetIds = [...state.targetIds];
  if (state.targetIds.length > (state.remainingDamage || 0)) {
    presentSplitDamageRemovalChoice(context, state);
    return;
  }
  presentSplitDamageAllocationChoice(context, state);
}

function splitDamageAllocationOptions(game, state) {
  const targetCount = state.remainingTargetIds?.length || 0;
  const maximum = Math.max(1, (state.remainingDamage || 0) - Math.max(0, targetCount - 1));
  return (state.remainingTargetIds || []).flatMap((id) => {
    const unit = findCard(game, id);
    if (!unit) return [];
    const amounts = targetCount === 1
      ? [state.remainingDamage || 0]
      : Array.from({ length: maximum }, (_, index) => index + 1);
    return amounts.filter((amount) => amount > 0).map((amount) => ({
      id: `${id}:${amount}`,
      label: `${unit.name}: ${amount} damage`,
      cardId: id,
      amount
    }));
  });
}

function presentSplitDamageAllocationChoice(context, state) {
  const { game, choice, player, source } = context;
  if (!(state.remainingTargetIds || []).length) {
    finishSplitDamageResolution(context, state);
    return;
  }
  const nextChoice = {
    ...(choice || {}),
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "splitDamageAllocation",
    prompt: `Divide ${state.remainingDamage} remaining damage for ${source.name}.`,
    options: splitDamageAllocationOptions(game, state),
    data: { ...(choice?.data || {}), splitDamage: state },
    finishSpell: Boolean(choice?.finishSpell),
    optional: false
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveSplitDamageAllocationChoice(context) {
  const state = structuredClone(context.choice.data?.splitDamage || {});
  const amount = Math.max(1, Math.min(context.option.amount || 1, state.remainingDamage || 0));
  state.allocations = [...(state.allocations || []), { targetId: context.option.cardId, amount }];
  state.remainingTargetIds = (state.remainingTargetIds || []).filter((id) => id !== context.option.cardId);
  state.remainingDamage = Math.max(0, (state.remainingDamage || 0) - amount);
  if (state.remainingTargetIds.length) {
    presentSplitDamageAllocationChoice(context, state);
    return;
  }
  finishSplitDamageResolution(context, state);
}

function finishSplitDamageResolution(context, state) {
  const { game, player, source } = context;
  const config = state.config || {};
  const damageSource = findCard(game, config.damageSourceUnitId) || source;
  const damaged = [];
  for (const allocation of state.allocations || []) {
    const target = findCard(game, allocation.targetId);
    if (!target) continue;
    applyDamage(game, player, damageSource, target, allocation.amount, {
      origin: config.damageOrigin || (config.damageSourceUnitId ? "unit" : undefined),
      bonusAlreadyApplied: true
    });
    damaged.push(target);
  }
  if (config.gainXpPerKill) {
    game.damageKillFollowups ||= [];
    for (const unit of damaged) {
      if (!unit.lastDamageEvent?.id) continue;
      game.damageKillFollowups.push({
        unitId: unit.instanceId,
        damageEventId: unit.lastDamageEvent.id,
        sourceCardId: source.instanceId,
        sourceCardSnapshot: structuredClone(source),
        sourcePlayerId: player.id,
        gainXp: config.gainXpPerKill
      });
    }
  }
  markEffect(game, source, [damageSource.instanceId, ...damaged.map((unit) => unit.instanceId)],
    config.markMessage || `${source.name} splits damage.`);
  finishChoiceResolution(context);
}

function resolveOptionalPowerDrawChoice(context) {
  const { game, choice, option, player, source } = context;
  const runeIndex = player.runes.findIndex((rune) => rune.instanceId === option.cardId);
  if (runeIndex >= 0) {
    recyclePowerRunesInChosenOrder(game, player, [option.cardId]);
    draw(player, choice.data.draw || 1, game);
    log(game, `${source.name} pays an additional rune and draws ${choice.data.draw || 1}.`);
    markEffect(game, source, [source.instanceId], `${source.name} draws ${choice.data.draw || 1}.`);
  }
  finishChoiceResolution(context);
}

function resolveEquipGearChoice(context) {
  const { game, source, target } = context;
  if (target) {
    attachEquipmentToUnit(game, source, target, `${source.name} attaches to ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveStealEnemyGearChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    removeGearEverywhere(game, target.instanceId);
    target.controllerBeforeTemporaryControlId = target.controllerId || target.ownerId;
    target.temporaryControlSourceId = source.instanceId;
    target.controllerId = player.id;
    if (target.tags?.includes("Equipment") && source.type === "unit") {
      attachEquipmentToUnit(game, target, source, `${source.name} steals and equips ${target.name}.`, source);
    } else {
      player.base.push(target);
      log(game, `${source.name} moves ${target.name} to ${player.name}'s base.`);
      markEffect(game, source, [target.instanceId], `${target.name} stolen.`);
    }
  }
  finishChoiceResolution(context);
}

function resolvePlayTrashSpellChoice(context) {
  const { game, player, source, target } = context;
  if (!target) return finishChoiceResolution(context);
  const index = player.trash.findIndex((candidate) => candidate.instanceId === target.instanceId);
  if (index >= 0) {
    const [playedSpell] = player.trash.splice(index, 1);
    queueEffectPlayedCard(game, player, playedSpell, source,
      game.showdown?.battlefieldId || "base", { ignoreEnergyBaseCost: true });
    playedSpell.recycleAfterResolve = true;
  }
  finishChoiceResolution(context);
}

function resolveStarCrossedChoice(context) {
  const { game, choice, player, source, target } = context;
  if (!target) return finishChoiceResolution(context);
  const enemies = allUnits(game).filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit));
  if (!enemies.length) {
    log(game, `${source.name} finds no enemy unit.`);
    return;
  }
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "starCrossedEnemy",
    prompt: `Choose the enemy unit for ${source.name}.`,
    options: enemies.map(cardOption),
    optional: false,
    data: { friendlyId: target.instanceId }
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveStarCrossedEnemyChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    const friendly = findCard(game, choice.data.friendlyId);
    if (friendly) returnUnitToHand(game, friendly, source.name);
    returnUnitToHand(game, target, source.name);
    markEffect(game, source, [friendly?.instanceId, target.instanceId].filter(Boolean), `${source.name} returns two units.`);
  }
  finishChoiceResolution(context);
}

function resolveDuelFriendlyEnemyChoice(context) {
  const { game, choice, player, source, target } = context;
  if (!target) return finishChoiceResolution(context);
  const amount = choice.data.amount || 0;
  if (amount) addMightModifier(target, amount, { temporary: Boolean(choice.data.temporary) });
  const enemies = allUnits(game).filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit));
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "duelEnemy",
    prompt: `Choose the enemy unit for ${source.name}.`,
    options: enemies.map(cardOption),
    optional: false,
    data: { ...choice.data, friendlyId: target.instanceId }
  };
  if (!nextChoice.options.length) return finishChoiceResolution(context);
  presentPreparedChoice(game, nextChoice);
}

function resolveDuelEnemyChoice(context) {
  const { game, choice, source, target } = context;
  const friendly = findCard(game, choice.data.friendlyId);
  if (friendly && target) {
    const friendlyMight = currentMight(game, friendly);
    const enemyMight = currentMight(game, target);
    const friendlyController = game.players.find((candidate) => candidate.id === friendly.controllerId);
    const enemyController = game.players.find((candidate) => candidate.id === target.controllerId);
    applyDamage(game, enemyController, target, friendly, enemyMight, { origin: "unit" });
    applyDamage(game, friendlyController, friendly, target, friendlyMight, { origin: "unit" });
    log(game, `${source.name} makes ${friendly.name} and ${target.name} strike each other.`);
    markEffect(game, source, [friendly.instanceId, target.instanceId], `${friendly.name} and ${target.name} strike each other.`);
  }
  finishChoiceResolution(context);
}

function resolveEachPlayerKillPermanentChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    if (choice.data.type === "gear") {
      killGear(game, target, source);
    } else {
      const location = findUnitLocation(game, target.instanceId);
      if (!killUnitForChoice(context, target,
        location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location)) return;
    }
    markEffect(game, source, [target.instanceId], `${target.name} is killed.`);
  }
  const nextIndex = (choice.data.index || 0) + 1;
  if (promptEachPlayerKillPermanent(game, source, choice.data.type, choice.data.playerOrder || [], nextIndex, choice.data.finishSpell, { optional: choice.data.optional })) {
    return;
  }
  finishChoiceResolution(context);
}

function resolveEachPlayerReturnUnitToHandChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    returnUnitToHand(game, target, source.name);
    markEffect(game, source, [target.instanceId], `${target.name} returns to hand.`);
  }
  const nextIndex = (choice.data.index || 0) + 1;
  if (promptEachPlayerReturnUnitToHand(game, source, choice.data.playerOrder || [], nextIndex, choice.data.finishSpell)) {
    return;
  }
  finishChoiceResolution(context);
}

function resolveEachOtherPlayerKillUncontrolledUnitChoice(context) {
  const { game, choice, source, target } = context;
  const sourcePlayer = game.players.find((candidate) => candidate.id === choice.data.sourcePlayerId);
  const chosenIds = [...(choice.data.chosenIds || [])];
  if (target) {
    chosenIds.push(target.instanceId);
    const location = findUnitLocation(game, target.instanceId);
    if (!killUnitForChoice(context, target,
      location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location)) return;
    markEffect(game, source, [target.instanceId], `${target.name} is killed.`);
  }
  const nextIndex = (choice.data.index || 0) + 1;
  if (sourcePlayer && promptEachOtherPlayerKillUncontrolledUnit(game, sourcePlayer, source, choice.data.playerOrder || [], nextIndex, choice.finishSpell, chosenIds)) {
    return;
  }
  finishChoiceResolution(context);
}

function resolvePartyFavorsChoice(context) {
  const { game, choice, option, player, source } = context;
  const sourcePlayer = game.players.find((candidate) => candidate.id === choice.data.sourcePlayerId);
  if (sourcePlayer && player) {
    if (option.id === "runes") {
      channelRunes(game, sourcePlayer, 1, { exhausted: true, source, reason: "effect" });
      channelRunes(game, player, 1, { exhausted: true, source, reason: "effect" });
      log(game, `${player.name} chooses Runes for ${source.name}.`);
    } else {
      draw(sourcePlayer, 1, game);
      draw(player, 1, game);
      log(game, `${player.name} chooses Cards for ${source.name}.`);
    }
    markEffect(game, source, [source.instanceId], `${source.name} resolves ${option.label}.`);
  }
  const nextIndex = (choice.data.index || 0) + 1;
  if (promptPartyFavorsChoice(game, sourcePlayer, source, choice.data.playerOrder || [], nextIndex, choice.finishSpell)) {
    return;
  }
  finishChoiceResolution(context);
}

function resolveMoonfallChoice(context) {
  const { game, choice, option, player, source } = context;
  const battlefield = game.battlefields.find((field) => field.instanceId === option.cardId);
  if (battlefield) {
    const movableEnemies = allUnits(game)
      .filter((unit) => unit.controllerId !== player.id)
      .filter((unit) => !battlefield.units.some((candidate) => candidate.instanceId === unit.instanceId))
      .filter((unit) => canChooseUnit(game, player, source, unit));
    if (movableEnemies.length) {
      const nextChoice = {
        ...choice,
        id: `choice-${Date.now()}-${Math.random()}`,
        effect: "moonfallMove",
        prompt: `Choose an enemy unit to move to ${battlefield.name}, or skip.`,
        options: [
          ...movableEnemies.map(cardOption),
          { id: "skip", label: "Move no enemy unit", cardId: null }
        ],
        optional: false,
        data: { battlefieldId: battlefield.instanceId }
      };
      presentPreparedChoice(game, nextChoice);
      return;
    }
    resolveMoonfallAtBattlefield(game, player, source, battlefield);
  }
  finishChoiceResolution(context);
}

function resolveMoonfallMoveChoice(context) {
  const { game, choice, player, source, target } = context;
  const battlefield = game.battlefields.find((field) => field.instanceId === choice.data.battlefieldId);
  if (battlefield && target) moveUnitBySpell(game, player, source, target, battlefield.instanceId);
  if (battlefield) resolveMoonfallAtBattlefield(game, player, source, battlefield);
  finishChoiceResolution(context);
}

function resolvePossessionChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    const location = findUnitLocation(game, target.instanceId);
    if (location?.type === "battlefield" && target.controllerId !== player.id) {
      const sourceBattlefield = location.battlefield;
      target.controllerId = player.id;
      recallUnit(game, target);
      settleBattlefieldAfterEffectMove(game, sourceBattlefield);
      markEffect(game, source, [target.instanceId], `${source.name} takes ${target.name} and recalls it.`);
      log(game, `${source.name} takes control of ${target.name} and recalls it to ${player.name}'s base.`);
    }
  }
  finishChoiceResolution(context);
}

function resolveLastBreathSourceChoice(context) {
  const { game, choice, player, source, target } = context;
  if (!target || target.controllerId !== player.id || !findUnitLocation(game, target.instanceId)) {
    finishChoiceResolution(context);
    return;
  }
  readyUnitWithEffects(game, player, source, target);
  const enemyOptions = battlefieldUnitTargets(game, player, "enemyBattlefield")
    .filter(({ unit }) => canChooseUnit(game, player, source, unit))
    .map(({ unit }) => cardOption(unit));
  if (!enemyOptions.length) {
    markEffect(game, source, [target.instanceId], `${target.name} readies.`);
    finishChoiceResolution(context);
    return;
  }
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "lastBreathEnemy",
    prompt: `Choose an enemy battlefield unit to be dealt ${currentMight(game, target)} damage by ${target.name}.`,
    options: enemyOptions,
    data: {
      ...choice.data,
      friendlyUnitId: target.instanceId,
      damage: currentMight(game, target)
    }
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveLastBreathEnemyChoice(context) {
  const { game, choice, source, target } = context;
  const friendly = findCard(game, choice.data.friendlyUnitId);
  const location = target ? findUnitLocation(game, target.instanceId) : null;
  if (friendly && target && location?.type === "battlefield") {
    const amount = Math.max(0, choice.data.damage || currentMight(game, friendly));
    const controller = game.players.find((candidate) => candidate.id === friendly.controllerId);
    applyDamage(game, controller, friendly, target, amount, { origin: "unit" });
    markEffect(game, source, [friendly.instanceId, target.instanceId], `${friendly.name} deals ${amount} damage to ${target.name}.`);
    log(game, `${friendly.name} deals ${amount} damage to ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveZenithBladeEnemyChoice(context) {
  const { game, choice, player, source, target } = context;
  const location = target ? findUnitLocation(game, target.instanceId) : null;
  if (!target || location?.type !== "battlefield" || target.controllerId === player.id) {
    finishChoiceResolution(context);
    return;
  }
  stunUnit(game, player, source, target);
  const friendlyOptions = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => canChooseUnit(game, player, source, unit))
    .filter((unit) => findUnitLocation(game, unit.instanceId)?.battlefield?.instanceId !== location.battlefield.instanceId)
    .map(cardOption);
  if (!friendlyOptions.length) {
    finishChoiceResolution(context);
    return;
  }
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "zenithBladeFriendly",
    prompt: `You may move a friendly unit to ${location.battlefield.name}.`,
    options: [
      ...friendlyOptions,
      { id: "skip", label: "Move no friendly unit", cardId: null }
    ],
    optional: false,
    data: {
      ...choice.data,
      battlefieldId: location.battlefield.instanceId
    }
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveZenithBladeFriendlyChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target && choice.data.battlefieldId) {
    moveUnitBySpell(game, player, source, target, choice.data.battlefieldId);
    markEffect(game, source, [target.instanceId], `${target.name} moves for ${source.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveShowstopperUnitChoice(context) {
  const { game, choice, player, source, target } = context;
  const location = target ? findUnitLocation(game, target.instanceId) : null;
  if (!target || target.controllerId !== player.id || location?.type !== "base") {
    finishChoiceResolution(context);
    return;
  }
  buffUnitWithEffects(game, player, source, target, 1);
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "showstopperDestination",
    prompt: `Choose a battlefield to move ${target.name} to for ${source.name}.`,
    options: game.battlefields.map(battlefieldOption),
    data: {
      ...choice.data,
      unitId: target.instanceId
    }
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveShowstopperDestinationChoice(context) {
  const { game, choice, player, source, option } = context;
  const unit = findCard(game, choice.data.unitId);
  if (unit && findUnitLocation(game, unit.instanceId)?.type === "base") {
    moveUnitBySpell(game, player, source, unit, option.cardId);
    markEffect(game, source, [unit.instanceId], `${unit.name} is buffed and moved.`);
  }
  finishChoiceResolution(context);
}

function resolveStormbringerUnitChoice(context) {
  const { game, choice, player, source, target } = context;
  const location = target ? findUnitLocation(game, target.instanceId) : null;
  if (!target || target.controllerId !== player.id || location?.type !== "base") {
    finishChoiceResolution(context);
    return;
  }
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "stormbringerDestination",
    prompt: `Choose a battlefield for ${target.name} to strike with ${source.name}.`,
    options: game.battlefields.map(battlefieldOption),
    data: {
      ...choice.data,
      unitId: target.instanceId
    }
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveStormbringerDestinationChoice(context) {
  const { game, choice, player, source, option } = context;
  const unit = findCard(game, choice.data.unitId);
  const battlefield = game.battlefields.find((field) => field.instanceId === option.cardId);
  if (unit && battlefield && findUnitLocation(game, unit.instanceId)?.type === "base") {
    const amount = currentMight(game, unit);
    for (const enemy of [...battlefield.units].filter((candidate) => candidate.controllerId !== player.id)) {
      applyDamage(game, player, unit, enemy, amount, { origin: "unit" });
      log(game, `${source.name} deals ${amount} damage to ${enemy.name}.`);
    }
    moveUnitBySpell(game, player, source, unit, battlefield.instanceId);
    markEffect(game, source, [unit.instanceId, ...battlefield.units.map((candidate) => candidate.instanceId)], `${source.name} resolves at ${battlefield.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveSiphonPowerBattlefieldChoice(context) {
  const { game, player, source, option } = context;
  const battlefield = game.battlefields.find((field) => field.instanceId === option.cardId);
  if (battlefield) {
    for (const unit of battlefield.units) {
      if (unit.controllerId === player.id) {
        addMightModifier(unit, 1, { temporary: true });
      } else {
        const current = currentMight(game, unit);
        if (current > 1) addMightModifier(unit, -1, { temporary: true });
      }
    }
    markEffect(game, source, battlefield.units.map((unit) => unit.instanceId), `${source.name} shifts Might at ${battlefield.name}.`);
    log(game, `${source.name} gives friendly units +1 Might and enemy units -1 Might at ${battlefield.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveStandUnitedChoice(context) {
  const { game, player, source, target } = context;
  if (target && target.controllerId === player.id && findUnitLocation(game, target.instanceId)) {
    buffUnitWithEffects(game, player, source, target, 1);
    const buffedFriendly = allUnits(game).filter((unit) => unit.controllerId === player.id && (unit.buffs || 0) > 0);
    for (const unit of buffedFriendly) addMightModifier(unit, 1, { temporary: true });
    markEffect(game, source, buffedFriendly.map((unit) => unit.instanceId), `${source.name} strengthens friendly buffs.`);
    log(game, `${source.name} buffs ${target.name}; friendly buffs give an additional +1 Might this turn.`);
  }
  finishChoiceResolution(context);
}

function resolveFacebreakerFriendlyChoice(context) {
  const { game, choice, player, source, target } = context;
  const location = target ? findUnitLocation(game, target.instanceId) : null;
  if (!target || target.controllerId !== player.id || location?.type !== "battlefield") {
    finishChoiceResolution(context);
    return;
  }
  const enemyOptions = location.battlefield.units
    .filter((unit) => unit.controllerId !== player.id)
    .filter((unit) => canChooseUnit(game, player, source, unit))
    .map(cardOption);
  if (!enemyOptions.length) {
    finishChoiceResolution(context);
    return;
  }
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "facebreakerEnemy",
    prompt: `Choose an enemy unit at ${location.battlefield.name} to stun for ${source.name}.`,
    options: enemyOptions,
    data: {
      ...choice.data,
      friendlyUnitId: target.instanceId,
      battlefieldId: location.battlefield.instanceId
    }
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveFacebreakerEnemyChoice(context) {
  const { game, choice, player, source, target } = context;
  const friendly = findCard(game, choice.data.friendlyUnitId);
  const friendlyLocation = friendly ? findUnitLocation(game, friendly.instanceId) : null;
  const enemyLocation = target ? findUnitLocation(game, target.instanceId) : null;
  if (
    friendly
    && target
    && friendly.controllerId === player.id
    && target.controllerId !== player.id
    && friendlyLocation?.type === "battlefield"
    && enemyLocation?.type === "battlefield"
    && friendlyLocation.battlefield.instanceId === choice.data.battlefieldId
    && enemyLocation.battlefield.instanceId === choice.data.battlefieldId
  ) {
    stunUnit(game, player, source, friendly);
    stunUnit(game, player, source, target);
    markEffect(game, source, [friendly.instanceId, target.instanceId], `${source.name} stuns both chosen units.`);
  }
  finishChoiceResolution(context);
}

function resolveReadyUnitAnyChoice(context) {
  const { game, player, source, target } = context;
  if (target && findUnitLocation(game, target.instanceId)) {
    readyUnitWithEffects(game, player, source, target);
    markEffect(game, source, [target.instanceId], `${source.name} readies ${target.name}.`);
    log(game, `${source.name} readies ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveTideturnerSwapChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    swapUnitLocations(game, player, source, target);
    markEffect(game, source, [source.instanceId, target.instanceId], `${source.name} swaps with ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveForgeAttachGearChoice(context) {
  const { game, choice, player, target } = context;
  const units = allUnits(game).filter((unit) => unit.controllerId === player.id);
  if (target && units.length) {
    presentPreparedChoice(game, {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      effect: "forgeAttachTarget",
      prompt: `Choose a unit to receive ${target.name}.`,
      options: units.map(cardOption),
      optional: true,
      data: { gearId: target.instanceId }
    });
    return;
  }
  finishChoiceResolution(context);
}

function resolveForgeAttachTargetChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    const gear = findCard(game, choice.data.gearId);
    if (gear) {
      attachEquipmentToUnit(game, gear, target, `${source.name} attaches ${gear.name} to ${target.name}.`, source);
    }
  }
  finishChoiceResolution(context);
}

function resolveMissingChoiceEffect({ game, choice, source }) {
  log(game, `${source?.name || "A choice"} has no registered resolver for ${choice.effect}.`);
}

function cardOption(card) {
  return {
    id: card.instanceId,
    label: card.name,
    cardId: card.instanceId,
    zoneChangeCounter: card.zoneChangeCounter || 0
  };
}

function cloneCardForReveal(card) {
  return JSON.parse(JSON.stringify(card));
}

function battlefieldOption(battlefield) {
  return { id: battlefield.instanceId, label: battlefield.name, cardId: battlefield.instanceId };
}

function chooseDiscardCards(game, player, source, options = {}) {
  const amount = Math.max(0, options.amount || 0);
  if (amount <= 0 || player.hand.length === 0) {
    if (options.draw) draw(player, options.draw, game);
    return false;
  }
  const choice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "discardCard",
    prompt: `Choose a card to discard for ${source.name}.`,
    options: player.hand.map(cardOption),
    data: {
      remaining: Math.min(amount, player.hand.length),
      drawAfter: options.draw || 0,
      discardedIds: [],
      afterMove: options.afterMove || null
    },
    finishSpell: Boolean(options.finishSpell),
    optional: false,
    fromShowdownChain: Boolean(options.fromShowdownChain)
  };
  if (!game.interactive) {
    applyChoiceEffect(game, choice, choice.options[0]);
    return Boolean(game.pendingChoice);
  }
  game.pendingChoice = choice;
  log(game, `${player.name} chooses a card to discard for ${source.name}.`);
  return true;
}

function resolveDiscardCardChoice({ game, choice, option, player, source }) {
  const selectedIds = [...(choice.data?.discardedIds || [])];
  const selected = player.hand.find((card) => card.instanceId === option.cardId && !selectedIds.includes(card.instanceId));
  if (!selected) {
    finishChoiceResolution({ game, choice, player, source });
    return;
  }
  const discardedIds = [...selectedIds, selected.instanceId];
  const remaining = Math.max(0, (choice.data?.remaining || 1) - 1);
  const remainingOptions = player.hand.filter((card) => !discardedIds.includes(card.instanceId)).map(cardOption);
  if (remaining > 0 && remainingOptions.length > 0) {
    const nextChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      options: remainingOptions,
      data: {
        ...choice.data,
        remaining,
        discardedIds
      }
    };
    if (!game.interactive) {
      applyChoiceEffect(game, nextChoice, nextChoice.options[0]);
      return;
    }
    game.pendingChoice = nextChoice;
    return;
  }
  const selectedCards = discardedIds.map((id) => player.hand.find((card) => card.instanceId === id)).filter(Boolean);
  const discardedCards = discardCardsFromHand(game, player, selectedCards, source);
  for (const discarded of discardedCards) log(game, `${source.name} discards ${discarded.name}.`);
  const drawAfter = choice.data?.drawAfter || 0;
  if (drawAfter) draw(player, drawAfter, game);
  const afterMove = choice.data?.afterMove || null;
  const waitsForDiscardTriggers = triggerDiscardEffects(game, player, discardedCards, source,
    afterMove ? { kind: "finishAfterMove", afterMove } : null);
  markEffect(game, source, [source.instanceId, ...discardedIds], `${source.name} discards${drawAfter ? " and draws" : ""}.`);
  finishChoiceResolution({ game, choice, player, source });
  if (afterMove && !waitsForDiscardTriggers && !game.pendingChoice && !game.pendingPayment && !game.actionChain) {
    finishAfterMoveChoice(game, afterMove);
  }
}

function resolvePlayDiscardedSelfFromTrashChoice(context) {
  const { game, choice, option, player, source } = context;
  if (option.id === "pay") {
    const requirement = { domain: choice.data?.domain || "Any", amount: 1 };
    const index = player.trash.findIndex((card) => card.instanceId === source.instanceId);
    if (index >= 0 && canPlayerPlayCards(game, player) && payAdditionalPower(game, player, requirement)) {
      const [played] = player.trash.splice(index, 1);
      playCardIgnoringCostFromEffect(game, player, played, source);
      log(game, `${source.name} pays ${requirement.domain} Power and plays itself from trash.`);
      markEffect(game, source, [played.instanceId], `${played.name} played from trash.`);
    }
  } else {
    log(game, `${player.name} declines ${source.name}.`);
  }
  finishChoiceResolution(context);
}

function resolvePlayHiddenFromHandIgnoringCostChoice(context) {
  const { game, choice, option, player, source } = context;
  if (option.id !== "decline") {
    const index = player.hand.findIndex((card) => card.instanceId === option.cardId);
    const requirement = { domain: choice.data?.domain || "Any", amount: 1 };
    if (index >= 0 && payAdditionalPower(game, player, requirement)) {
      const [played] = player.hand.splice(index, 1);
      const destination = played.type === "unit" && choice.data?.battlefieldId ? choice.data.battlefieldId : "base";
      playCardIgnoringCostFromEffect(game, player, played, source, destination, { allowUncontrolledBattlefield: true });
      log(game, `${source.name} pays ${requirement.domain} Power to play ${played.name} from hand, ignoring its cost.`);
      markEffect(game, source, [played.instanceId], `${played.name} is played by ${source.name}.`);
    }
  } else {
    log(game, `${player.name} declines ${source.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveRuneDeckGambitFuryDamageChoice(context) {
  const { game, choice, player, source, target } = context;
  const battlefield = game.battlefields.find((field) => field.instanceId === choice.data?.battlefieldId);
  if (target && battlefield?.units.some((unit) => unit.instanceId === target.instanceId)) {
    for (const enemy of battlefield.units.filter((unit) => unit.controllerId !== player.id)) {
      applyDamage(game, player, source, enemy, enemy.instanceId === target.instanceId ? 2 : 1, { origin: "ability" });
    }
    markEffect(game, source, battlefield.units.filter((unit) => unit.controllerId !== player.id).map((unit) => unit.instanceId), `${source.name} resolves its Fury rune gambit.`);
    checkState(game);
  }
  finishChoiceResolution(context);
}

function resolvePayExhaustReadyBuffedUnitChoice(context) {
  const { game, choice, option, player, source } = context;
  const unit = findCard(game, choice.data?.unitId);
  const requirement = { domain: choice.data?.domain || "Any", amount: 1 };
  if (option.id === "pay" && unit?.exhausted && !source.exhausted && payAdditionalPower(game, player, requirement)) {
    exhaustCards(game, player, source, [source], { reason: "trigger-cost", cost: true });
    readyUnitWithEffects(game, player, source, unit);
    log(game, `${source.name} pays ${requirement.domain} Power and exhausts to ready ${unit.name}.`);
    markEffect(game, source, [source.instanceId, unit.instanceId], `${unit.name} readies.`);
  } else if (option.id === "decline") {
    log(game, `${player.name} declines ${source.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveDiscardEnergyDamageChoice({ game, choice, option, player, source }) {
  const index = player.hand.findIndex((card) => card.instanceId === option.cardId);
  if (index < 0) return finishChoiceResolution({ game, choice, player, source });
  const [discarded] = discardCardsFromHand(game, player, [player.hand[index]], source);
  triggerDiscardEffects(game, player, [discarded], source);
  const targets = targetableUnits(game, player, source, "battlefield");
  const damageChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "damageUnit",
    prompt: `Choose a unit to take ${discarded.energy || 0} damage from ${source.name}.`,
    options: targets.map(cardOption),
    finishSpell: Boolean(choice.data.finishSpell),
    optional: false,
    data: {
      amount: discarded.energy || 0,
      remaining: 1,
      chosenIds: [],
      scope: "battlefield"
    }
  };
  log(game, `${source.name} discards ${discarded.name}.`);
  markEffect(game, source, [source.instanceId, discarded.instanceId], `${source.name} discards ${discarded.name}.`);
  if (!damageChoice.options.length) return finishChoiceResolution({ game, choice, player, source });
  presentPreparedChoice(game, damageChoice);
}

function resolveDrawOrChannelRunesChoice(context) {
  const { game, choice, option, player, source } = context;
  if (option.id === "channel") {
    const amount = choice.data?.channel || 1;
    channelRunes(game, player, amount, {
      exhausted: choice.data?.channelExhausted !== false,
      source,
      reason: "score"
    });
    log(game, `${source.name} channels ${amount} rune${amount === 1 ? "" : "s"} exhausted.`);
    markEffect(game, source, [source.instanceId], `${source.name} channels.`);
  } else {
    const amount = choice.data?.draw || 1;
    draw(player, amount, game);
    log(game, `${source.name} draws ${amount}.`);
    markEffect(game, source, [source.instanceId], `${source.name} draws.`);
  }
  finishChoiceResolution(context);
}

function resolveOptionalChannelRunesChoice(context) {
  const { game, choice, option, player, source } = context;
  if (option.id === "channel") {
    const amount = choice.data?.amount || 1;
    channelRunes(game, player, amount, {
      exhausted: choice.data?.exhausted !== false,
      source,
      reason: "hold"
    });
    log(game, `${source.name} channels ${amount} rune${amount === 1 ? "" : "s"} exhausted.`);
    markEffect(game, source, [source.instanceId], `${source.name} channels.`);
  } else {
    log(game, `${player.name} declines ${source.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveSpendBuffDrawChoice(context) {
  const { game, choice, option, player, source } = context;
  if (option.id === "draw") {
    const unit = findCard(game, choice.data?.unitId);
    if (unit && (unit.buffs || 0) > 0) {
      unit.buffs -= 1;
      draw(player, choice.data?.draw || 1, game);
      log(game, `${source.name} spends ${unit.name}'s buff to draw ${choice.data?.draw || 1}.`);
      markEffect(game, source, [source.instanceId, unit.instanceId], `${unit.name}'s buff is spent.`);
    }
  } else {
    log(game, `${player.name} declines ${source.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveReturnChosenChampionChoice(context) {
  const { game, choice, option, player, source } = context;
  if (option.id === "return") {
    returnChosenChampionFromTrash(game, player, source, choice.data?.championName || player.chosenChampionName);
  } else {
    log(game, `${player.name} declines ${source.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveExhaustSourceDrawChoice(context) {
  const { game, choice, option, player, source } = context;
  if (option.id === "draw") {
    if (choice.data.exhaust) exhaustCards(game, player, source, [source], { reason: "trigger-cost", cost: true });
    draw(player, choice.data.amount || 1, game);
    log(game, `${source.name} exhausts to draw ${choice.data.amount || 1}.`);
    markEffect(game, source, [source.instanceId, choice.data.killedUnitId].filter(Boolean), `${source.name} draws.`);
  } else {
    log(game, `${player.name} declines ${source.name}.`);
  }
  finishChoiceResolution(context);
}

function discardCardsFromHand(game, responsiblePlayer, cards, source = null) {
  const requestedIds = new Set((cards || []).map((card) => card?.instanceId).filter(Boolean));
  if (!responsiblePlayer || !requestedIds.size) return [];
  const discarded = responsiblePlayer.hand.filter((card) => requestedIds.has(card.instanceId));
  if (!discarded.length) return [];
  responsiblePlayer.hand = responsiblePlayer.hand.filter((card) => !requestedIds.has(card.instanceId));
  const destinations = [];
  for (const card of discarded) {
    markNonBoardZoneChange(card);
    const owner = game.players.find((player) => player.id === card.ownerId) || responsiblePlayer;
    if (!isTokenCard(card)) owner.trash.push(card);
    destinations.push({
      cardId: card.instanceId,
      ownerId: owner.id,
      ceasedToExist: isTokenCard(card)
    });
  }
  responsiblePlayer.discardedCardsThisTurn = (responsiblePlayer.discardedCardsThisTurn || 0) + discarded.length;
  game.discardEventSequence = (game.discardEventSequence || 0) + 1;
  game.discardEvents ||= [];
  game.discardEvents.push({
    id: `discard-${game.discardEventSequence}`,
    cardIds: discarded.map((card) => card.instanceId),
    sourceCardId: source?.instanceId || null,
    responsiblePlayerId: responsiblePlayer.id,
    destinations,
    turnSequence: game.turnSequence || 0
  });
  return discarded;
}

function triggerDiscardEffects(game, player, discardedCards, source, continuation = null) {
  if (!discardedCards?.length) return false;
  const triggers = [];
  for (const discarded of discardedCards) {
    for (const effect of cardEffects(discarded, "discarded")) {
      if (effect.kind === "draw") {
        triggers.push({
          kind: "discardedDraw",
          playerId: player.id,
          sourceCardId: discarded.instanceId,
          data: { amount: effect.amount || 1 }
        });
      }
      if (effect.kind === "playSelfFromTrashPayPower") {
        triggers.push({
          kind: "playSelfFromTrashPayPower",
          playerId: player.id,
          sourceCardId: discarded.instanceId,
          data: { domain: effect.domain || "Any" }
        });
      }
    }
  }
  for (const card of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(card, "discard")) {
      if (effect.kind === "readySelfMight") {
        triggers.push({
          kind: "discardReadySelfMight",
          playerId: player.id,
          sourceCardId: card.instanceId,
          data: { amount: effect.amount || 1, temporary: isTemporaryMightEffect(card, effect) }
        });
      }
    }
  }
  if (!triggers.length) return false;
  const mode = game.phase === "showdown" && game.showdown
    ? "showdownChain"
    : game.phase === "action" && game.interactive ? "actionChain" : "queue";
  return prepareAndQueueTriggers(game, triggers, mode, continuation);
}

function collectPlayedObjectTriggers(game, player, playedCard, { isCard }) {
  const triggers = [];
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "cardPlayed")) {
      const observesTokenPlay = ["anotherUnitBuffSelf", "gearReadySelf", "exhaustSelfChannelOnMightyUnit"].includes(effect.kind);
      if (!isCard && !observesTokenPlay) continue;
      if (playedCard.type === "spell" && (playedCard.energy || 0) >= (effect.minEnergy || 5)) {
        if (effect.kind === "highCostSpellBuffSelf") {
          triggers.push({
            kind: "cardPlayedHighCostSpellBuffSelf",
            playerId: player.id,
            sourceCardId: source.instanceId,
            data: {
              amount: effect.amount || 3,
              temporary: isTemporaryMightEffect(source, effect),
              playedCardId: playedCard.instanceId
            }
          });
        }
        if (effect.kind === "highCostSpellDraw") {
          triggers.push({
            kind: "cardPlayedHighCostSpellDraw",
            playerId: player.id,
            sourceCardId: source.instanceId,
            data: { amount: effect.amount || 1, playedCardId: playedCard.instanceId }
          });
        }
      }
      if (effect.kind === "anotherUnitBuffSelf") {
        if (playedCard.type !== "unit" || playedCard.instanceId === source.instanceId) continue;
        triggers.push({
          kind: "cardPlayedAnotherUnitBuffSelf",
          playerId: player.id,
          sourceCardId: source.instanceId,
          data: {
            amount: effect.amount || 1,
            maxBuffs: effect.maxBuffs,
            playedCardId: playedCard.instanceId
          }
        });
      }
      if (effect.kind === "gearReadySelf") {
        if (playedCard.type !== "gear") continue;
        triggers.push({
          kind: "cardPlayedGearReadySelf",
          playerId: player.id,
          sourceCardId: source.instanceId,
          data: { playedCardId: playedCard.instanceId }
        });
      }
      if (effect.kind === "secondCardMightReadySelf") {
        if ((player.cardsPlayedThisTurn || 0) !== (effect.cardNumber || 2)) continue;
        triggers.push({
          kind: "cardPlayedSecondCardMightReadySelf",
          playerId: player.id,
          sourceCardId: source.instanceId,
          data: {
            amount: effect.amount || 2,
            temporary: isTemporaryMightEffect(source, effect),
            playedCardId: playedCard.instanceId
          }
        });
      }
      if (effect.kind === "opponentTurnRecruit") {
        const turnPlayerId = game.showdown?.turnPlayerId || game.actionChain?.turnPlayerId || game.currentPlayerId;
        if (turnPlayerId === player.id) continue;
        triggers.push({
          kind: "cardPlayedOpponentTurnRecruit",
          playerId: player.id,
          sourceCardId: source.instanceId,
          data: {
            tokenCardNumber: effect.tokenCardNumber,
            count: effect.count || 1,
            ready: Boolean(effect.ready),
            playedCardId: playedCard.instanceId
          }
        });
      }
      if (effect.kind === "fromHiddenBuffSelf") {
        if (!playedCard.playedFromHidden) continue;
        triggers.push({
          kind: "cardPlayedFromHiddenBuffSelf",
          playerId: player.id,
          sourceCardId: source.instanceId,
          data: {
            amount: effect.amount || 2,
            temporary: isTemporaryMightEffect(source, effect),
            playedCardId: playedCard.instanceId
          }
        });
      }
      if (effect.kind === "exhaustSelfChannelOnMightyUnit") {
        if (playedCard.type !== "unit" || currentMight(game, playedCard) < (effect.minMight || 5)) continue;
        triggers.push({
          kind: "cardPlayedExhaustSelfChannelOnMightyUnit",
          playerId: player.id,
          sourceCardId: source.instanceId,
          data: {
            amount: effect.amount || 1,
            playedCardId: playedCard.instanceId
          }
        });
      }
    }
  }
  return triggers;
}

function offerPredictChoice(game, player, source, parentChoice = {}, extraData = {}) {
  const amount = Math.max(1, Math.floor(extraData.amount || 1));
  if (!extraData.observationResolved) {
    const observed = player.mainDeck.slice(0, Math.min(amount, player.mainDeck.length));
    if (!observed.length) return false;
    return beginObservedTopDeckSelfAbilities(game, player, observed, {
      kind: "predictAfterObservation",
      sourceCardId: source.instanceId,
      sourceCardSnapshot: structuredClone(source),
      observedIds: observed.map((card) => card.instanceId),
      amount,
      parentFinishSpell: Boolean(parentChoice.finishSpell),
      parentFromShowdownChain: Boolean(parentChoice.fromShowdownChain),
      predictData: structuredClone(extraData),
      fromShowdownChain: Boolean(parentChoice.fromShowdownChain || extraData.fromShowdownChain)
    });
  }
  const observedIds = extraData.observedIds || [];
  const observed = observedIds
    .map((id) => player.mainDeck.find((card) => card.instanceId === id))
    .filter(Boolean);
  const top = observed[0];
  if (!top) {
    if (extraData.revealSpellAfterPredict && revealTopSpellToHand(game, player, source, extraData)) return true;
    if (parentChoice.finishSpell && source?.type === "spell") finishSpell(game, player, source);
    continueShowdownStartEffects(game, extraData.resumeShowdownStart);
    return false;
  }
  if (amount > 1) {
    const revealed = observed;
    if (!game.interactive) {
      recycleMainDeckCards(game, player, revealed, source);
      log(game, `${source.name} predicts ${revealed.length} and recycles them.`);
      markEffect(game, source, [source.instanceId, ...revealed.map((card) => card.instanceId)], `${source.name} predicts.`);
      return false;
    }
    return promptPredictMultipleRecycle(game, player, source, revealed, parentChoice, extraData);
  }
  if (!game.interactive) {
    predict(game, player, source);
    if (extraData.revealSpellAfterPredict) revealTopSpellToHand(game, player, source, extraData);
    return false;
  }
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "predictChoice",
    prompt: `Predict: ${top.name}`,
    options: [
      { id: "keep", label: `Keep ${top.name} on top`, cardId: top.instanceId },
      { id: "recycle", label: `Recycle ${top.name}`, cardId: top.instanceId }
    ],
    data: extraData,
    finishSpell: Boolean(parentChoice.finishSpell),
    optional: false,
    fromShowdownChain: Boolean(parentChoice.fromShowdownChain || extraData.fromShowdownChain)
  };
  game.currentPlayerId = player.id;
  log(game, `${source.name} predicts ${top.name}.`);
  return true;
}

export function predictCards(game, player, source, amount = 1, context = {}) {
  return offerPredictChoice(game, player, source, context, { ...context, amount });
}

function promptPredictMultipleRecycle(game, player, source, revealed, parentChoice = {}, data = {}) {
  setPendingChoice(game, {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "predictMultipleRecycle",
    prompt: `Predict ${revealed.length}: choose any cards to recycle.`,
    options: [
      ...revealed.map((card) => ({ id: `recycle:${card.instanceId}`, label: `Recycle ${card.name}`, cardId: card.instanceId })),
      { id: "done", label: "Recycle no more cards", cardId: null }
    ],
    data: {
      ...structuredClone(data),
      revealedIds: revealed.map((card) => card.instanceId),
      recycleIds: []
    },
    finishSpell: Boolean(parentChoice.finishSpell),
    optional: false,
    fromShowdownChain: Boolean(parentChoice.fromShowdownChain || data.fromShowdownChain)
  });
  game.currentPlayerId = player.id;
  log(game, `${source.name} predicts ${revealed.length} cards.`);
  return true;
}

function resolvePredictMultipleRecycleChoice({ game, choice, option, player, source }) {
  const recycleIds = [...(choice.data?.recycleIds || [])];
  if (option.id !== "done" && option.cardId && !recycleIds.includes(option.cardId)) recycleIds.push(option.cardId);
  const keepIds = (choice.data?.revealedIds || []).filter((id) => !recycleIds.includes(id));
  if (option.id === "done" || keepIds.length === 0) {
    if (keepIds.length <= 1) {
      finalizeMultiplePredict(game, player, source, { ...choice.data, recycleIds, orderedKeepIds: keepIds });
      return;
    }
    promptPredictMultipleOrder(game, choice, player, source, recycleIds, []);
    return;
  }
  const remainingRecycleOptions = keepIds
    .map((id) => player.mainDeck.find((card) => card.instanceId === id))
    .filter(Boolean)
    .map((card) => ({ id: `recycle:${card.instanceId}`, label: `Recycle ${card.name}`, cardId: card.instanceId }));
  setPendingChoice(game, {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    options: [...remainingRecycleOptions, { id: "done", label: "Recycle no more cards", cardId: null }],
    data: { ...choice.data, recycleIds }
  });
}

function promptPredictMultipleOrder(game, choice, player, source, recycleIds, orderedKeepIds) {
  const remainingIds = (choice.data?.revealedIds || [])
    .filter((id) => !recycleIds.includes(id) && !orderedKeepIds.includes(id));
  if (remainingIds.length <= 1) {
    finalizeMultiplePredict(game, player, source, {
      ...choice.data,
      recycleIds,
      orderedKeepIds: [...orderedKeepIds, ...remainingIds]
    });
    return;
  }
  setPendingChoice(game, {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "predictMultipleOrder",
    prompt: "Choose the next card to leave on top of your Main Deck.",
    options: remainingIds
      .map((id) => player.mainDeck.find((card) => card.instanceId === id))
      .filter(Boolean)
      .map(cardOption),
    data: { ...choice.data, recycleIds, orderedKeepIds }
  });
}

function resolvePredictMultipleOrderChoice({ game, choice, option, player, source }) {
  const orderedKeepIds = [...(choice.data?.orderedKeepIds || []), option.cardId];
  promptPredictMultipleOrder(game, choice, player, source, choice.data?.recycleIds || [], orderedKeepIds);
}

function finalizeMultiplePredict(game, player, source, data) {
  const revealedIds = data.revealedIds || [];
  const current = player.mainDeck.slice(0, revealedIds.length);
  if (current.length !== revealedIds.length
    || current.some((card) => !revealedIds.includes(card.instanceId))) return false;
  player.mainDeck.splice(0, current.length);
  const byId = new Map(current.map((card) => [card.instanceId, card]));
  const recycled = (data.recycleIds || []).map((id) => byId.get(id)).filter(Boolean);
  const kept = (data.orderedKeepIds || []).map((id) => byId.get(id)).filter(Boolean);
  player.mainDeck.unshift(...kept);
  recycleMainDeckCards(game, player, recycled, source);
  log(game, `${player.name} recycles ${recycled.length} and rearranges ${kept.length} with ${source.name}.`);
  markEffect(game, source, [source.instanceId, ...current.map((card) => card.instanceId)], `${source.name} predicts.`);
  if (data.revealSpellAfterPredict && revealTopSpellToHand(game, player, source, data)) return true;
  continueShowdownStartEffects(game, data.resumeShowdownStart);
  return true;
}

function topRevealReplacementCost(effect) {
  const replacement = effect.replacementCost || {
    energy: Math.max(0, effect.costEnergy ?? 1),
    power: []
  };
  return {
    replacementEnergyCost: Math.max(0, replacement.energy || 0),
    replacementPowerCost: structuredClone(replacement.power || [])
  };
}

function replacementCostLabel(options) {
  const parts = [];
  if (options.replacementEnergyCost) parts.push(`${options.replacementEnergyCost} Energy`);
  for (const requirement of options.replacementPowerCost || []) {
    parts.push(`${requirement.amount || 0} ${requirement.domain || "Any"} Power`);
  }
  return parts.join(" and ") || "0";
}

function resolvePlayTopRevealedSelfChoice({ game, choice, option, player, source }) {
  const predictSource = findCard(game, choice.data?.predictSourceId) || source;
  const predictData = { ...(choice.data?.predictData || {}), skipTopReveal: true };
  if (option.id === "leave") {
    offerPredictChoice(game, player, predictSource, {
      finishSpell: Boolean(choice.data?.predictFinishSpell),
      fromShowdownChain: Boolean(choice.data?.predictFromShowdownChain)
    }, predictData);
    return;
  }
  const index = player.mainDeck.findIndex((card) => card.instanceId === source.instanceId);
  if (index >= 0) {
    const revealed = player.mainDeck[index];
    banishCards(game, player, [revealed], revealed);
    if (option.id === "banish-play") {
      const costOptions = playCostOptions(choice.data?.costOptions || {});
      queueEffectPlayedCard(game, player, revealed, revealed, "base", costOptions);
      log(game, `${revealed.name} is banished and played for ${replacementCostLabel(costOptions)}.`);
    } else {
      log(game, `${revealed.name} is banished.`);
    }
    markEffect(game, revealed, [revealed.instanceId], `${revealed.name} resolves its top-deck reveal ability.`);
  }
  if (predictData.revealSpellAfterPredict) {
    revealTopSpellToHand(game, player, predictSource, predictData);
  } else {
    if (choice.data?.predictFinishSpell && predictSource?.type === "spell") finishSpell(game, player, predictSource);
    continueShowdownStartEffects(game, predictData.resumeShowdownStart);
  }
}

function beginObservedTopDeckSelfAbilities(game, player, observedCards, continuation, startIndex = 0) {
  const observedIds = (observedCards || []).map((card) => card.instanceId);
  const state = {
    observedIds,
    nextIndex: Math.max(0, startIndex),
    continuation: structuredClone(continuation)
  };
  return continueObservedTopDeckSelfAbilities(game, player, state);
}

function continueObservedTopDeckSelfAbilities(game, player, state) {
  let index = state.nextIndex || 0;
  while (index < (state.observedIds || []).length) {
    const cardId = state.observedIds[index];
    index += 1;
    const card = player.mainDeck.find((candidate) => candidate.instanceId === cardId);
    const effect = card ? firstCardEffect(card, "static", "playFromTopReveal") : null;
    if (!card || !effect) continue;
    const costOptions = topRevealReplacementCost(effect);
    const canPlay = canPayWithExtraPower(game, player, card, [], costOptions);
    if (!game.interactive) {
      banishCards(game, player, [card], card);
      if (canPlay) {
        queueEffectPlayedCard(game, player, card, card, "base", costOptions);
      }
      markEffect(game, card, [card.instanceId], `${card.name} resolves its top-deck observation ability.`);
      continue;
    }
    setPendingChoice(game, {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: player.id,
      card,
      effect: "observedTopDeckSelfAbility",
      prompt: `${card.name} was observed from the top of your Main Deck.`,
      options: [
        ...(canPlay ? [{ id: "banish-play", label: `Banish and play for ${replacementCostLabel(costOptions)}`, cardId }] : []),
        { id: "banish", label: "Banish without playing", cardId },
        { id: "leave", label: "Leave it in the Main Deck", cardId }
      ],
      data: {
        observationState: { ...state, nextIndex: index },
        costOptions
      },
      finishSpell: false,
      optional: false,
      fromShowdownChain: Boolean(state.continuation?.fromShowdownChain)
    });
    game.currentPlayerId = player.id;
    return true;
  }
  return Boolean(resumeTopDeckObservation(game, player, state.continuation));
}

function resolveObservedTopDeckSelfAbilityChoice({ game, choice, option, player, source }) {
  const card = player.mainDeck.find((candidate) => candidate.instanceId === source.instanceId);
  if (card && option.id !== "leave") {
    banishCards(game, player, [card], card);
    if (option.id === "banish-play") {
      queueEffectPlayedCard(game, player, card, card, "base", playCostOptions(choice.data?.costOptions || {}));
    }
    markEffect(game, card, [card.instanceId], `${card.name} resolves its top-deck observation ability.`);
  }
  continueObservedTopDeckSelfAbilities(game, player, choice.data?.observationState || {});
}

function resumeTopDeckObservation(game, player, continuation = {}) {
  const source = findCard(game, continuation.sourceCardId) || continuation.sourceCardSnapshot;
  if (!source) return false;
  if (continuation.kind === "defendHereRevealTopSpell") {
    return presentDefendHereRevealTopSpell(game, player, source, continuation);
  }
  if (continuation.kind === "damageEnemyByHiddenTopDeck") {
    return presentHiddenTopDeckDamageReveal(game, player, source, continuation);
  }
  if (continuation.kind === "playTopDeckUnitFromLook") {
    return continuePlayTopDeckUnitFromLook(game, player, source, continuation);
  }
  if (continuation.kind === "conquerHereRecycleTopDeck") {
    return presentConquerHereRecycleTopDeck(game, player, source, continuation);
  }
  if (continuation.kind === "chooseTopDeck") {
    return presentChooseTopDeck(game, player, source, continuation);
  }
  if (continuation.kind === "promisingFutureChoose") {
    return presentPromisingFutureChoice(game, player, source, continuation);
  }
  if (continuation.kind === "baitedHookTopDeck") {
    return presentBaitedHookTopDeck(game, player, source, continuation);
  }
  if (continuation.kind === "playOpponentTopDeckCardAdvance") {
    const actingPlayer = game.players.find((candidate) => candidate.id === continuation.actingPlayerId);
    if (!actingPlayer) return false;
    return continuePlayOpponentTopDeckObservations(game, actingPlayer, source, continuation);
  }
  if (continuation.kind === "endTurnPlayTopDeckUnitIgnoreCost") {
    return continueEndTurnPlayTopDeckUnitIgnoreCost(game, player, source, continuation);
  }
  if (continuation.kind === "predictAfterObservation") {
    return offerPredictChoice(game, player, source, {
      finishSpell: Boolean(continuation.parentFinishSpell),
      fromShowdownChain: Boolean(continuation.parentFromShowdownChain)
    }, {
      ...(continuation.predictData || {}),
      amount: continuation.amount || 1,
      observedIds: continuation.observedIds || [],
      observationResolved: true
    });
  }
  return false;
}

function resolvePredictChoice(game, player, source, option, choice) {
  const top = player.mainDeck[0];
  if (!top) return;
  if (option.id === "recycle") {
    player.mainDeck.shift();
    recycleMainDeckCards(game, player, [top], source);
    log(game, `${player.name} recycles ${top.name} with ${source.name}.`);
  } else {
    log(game, `${player.name} keeps ${top.name} on top with ${source.name}.`);
  }
  markEffect(game, source, [source.instanceId, top.instanceId], `${source.name} predicts.`);
  if (choice.data?.revealSpellAfterPredict && revealTopSpellToHand(game, player, source, choice.data)) return;
  continueShowdownStartEffects(game, choice.data?.resumeShowdownStart);
}

function resolveHweiDiscard(game, player, source, option, choice) {
  const index = player.hand.findIndex((card) => card.instanceId === option.cardId);
  if (index < 0) return;
  const [discarded] = discardCardsFromHand(game, player, [player.hand[index]], source);
  const continuation = {
    kind: "finishHweiDiscard",
    playerId: player.id,
    sourceCardId: source.instanceId,
    discardedCard: discarded,
    temporary: Boolean(choice.data?.temporary),
    afterMove: choice.data?.afterMove || null
  };
  if (triggerDiscardEffects(game, player, [discarded], source, continuation)) return;
  finishHweiDiscardContinuation(game, continuation);
}

function finishHweiDiscardContinuation(game, continuation) {
  const player = game.players.find((candidate) => candidate.id === continuation.playerId);
  const source = findCard(game, continuation.sourceCardId);
  const discarded = continuation.discardedCard;
  if (!player || !source || !discarded) {
    finishAfterMoveChoice(game, continuation.afterMove);
    return;
  }
  if (discarded.type === "spell") draw(player, 1, game);
  if (discarded.type === "gear" && offerReadyRunesChoice(game, player, source, 2, continuation.afterMove)) {
    log(game, `${source.name} discards ${discarded.name} and may ready runes.`);
    markEffect(game, source, [source.instanceId, discarded.instanceId], `${source.name} discards ${discarded.name}.`);
    return;
  }
  if (discarded.type === "unit") addMightModifier(source, 3, { temporary: Boolean(continuation.temporary) });
  log(game, `${source.name} discards ${discarded.name} and applies the ${discarded.type} bonus.`);
  markEffect(game, source, [source.instanceId, discarded.instanceId], `${source.name} discards ${discarded.name}.`);
  if (!game.pendingChoice) finishAfterMoveChoice(game, continuation.afterMove);
}

function offerReadyRunesChoice(game, player, source, max, afterMove = null) {
  const options = readyRuneOptions(player);
  if (!options.length || max <= 0) return false;
  if (!game.interactive) {
    readyRunes(player, max);
    return false;
  }
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "readyRunes",
    prompt: `Ready up to ${max} runes for ${source.name}.`,
    options: [...options, { id: "done", label: "Ready no more runes" }],
    data: { remaining: max, afterMove },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  return true;
}

function readyRuneOptions(player) {
  return player.runes
    .filter((rune) => rune.exhausted)
    .map((rune) => ({ id: rune.instanceId, label: `${rune.domain} Rune`, cardId: rune.instanceId }));
}

function resolveReadyRunesChoice(game, player, source, option, choice) {
  if (option.id === "done") {
    finishAfterMoveChoice(game, choice.data?.afterMove);
    return;
  }
  const rune = player.runes.find((candidate) => candidate.instanceId === option.cardId);
  if (rune) {
    rune.exhausted = false;
    log(game, `${source.name} readies a ${rune.domain} Rune.`);
    markEffect(game, source, [rune.instanceId], `${source.name} readies a rune.`);
  }
  const remaining = Math.max(0, (choice.data?.remaining || 1) - 1);
  const options = readyRuneOptions(player);
  if (remaining > 0 && options.length) {
    game.pendingChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      prompt: `Ready up to ${remaining} more runes for ${source.name}.`,
      options: [...options, { id: "done", label: "Ready no more runes" }],
      data: { ...choice.data, remaining }
    };
    return;
  }
  finishAfterMoveChoice(game, choice.data?.afterMove);
}

function finishAfterMoveChoice(game, afterMove) {
  if (!afterMove) return;
  if (afterMove.type === "companionMove") {
    updateBattlefieldControl(game);
    requestCleanup(game, "move-completed", { unitIds: [afterMove.unitId], destinationId: afterMove.destinationId });
    finishAfterMoveChoice(game, afterMove.parentAfterMove);
    return;
  }
  if (afterMove.type === "standardMoveBatch") {
    continueStandardMoveEffects(game, afterMove);
    return;
  }
  if (afterMove.type === "effectMove") {
    finishEffectMove(game, afterMove);
    return;
  }
  if (afterMove.type === "effectMoveBatch") {
    finishEffectMoveBatch(game, afterMove);
    return;
  }
  if (afterMove.type !== "destination") return;
  const player = game.players.find((candidate) => candidate.id === afterMove.playerId);
  const unit = findCard(game, afterMove.unitId);
  const destination = game.battlefields.find((field) => field.instanceId === afterMove.destinationId);
  if (player && unit && destination) {
    finishMoveDestination(game, player, unit, destination, {
      destinationWasEmpty: Boolean(afterMove.destinationWasEmpty),
      destinationControlledBy: afterMove.destinationControlledBy
    });
  }
}

function continueStandardMoveEffects(game, afterMove) {
  const player = game.players.find((candidate) => candidate.id === afterMove.playerId);
  if (!player) return;
  const unitIds = afterMove.unitIds || [];
  const units = unitIds.map((unitId) => findCard(game, unitId)).filter(Boolean);
  if (!afterMove.moveTriggersProcessed) {
    afterMove.moveTriggersProcessed = true;
    if (triggerMoveEffectsBatch(game, player, units, afterMove)) return;
  }

  if (afterMove.destinationId === "base") {
    updateBattlefieldControl(game);
    requestCleanup(game, "move-completed", { unitIds, destinationId: "base" });
    checkState(game);
    completeGameOperation(game, afterMove.operationId, "moved-to-base");
    return;
  }

  const destination = game.battlefields.find((field) => field.instanceId === afterMove.destinationId || field.id === afterMove.destinationId);
  if (!destination) return;
  finishMoveDestinationBatch(game, player, units, destination, {
    destinationWasEmpty: Boolean(afterMove.destinationWasEmpty),
    destinationControlledBy: afterMove.destinationControlledBy
  });
  completeGameOperation(game, afterMove.operationId, "move-finished");
}

function revealTopSpellToHand(game, player, source, resume = {}) {
  const top = player.mainDeck[0];
  if (top?.type !== "spell") return false;
  recordRevealEvent(game, player, [top], source, "mainDeck");
  if (!game.interactive) {
    removeMainDeckCards(game, [top]);
    player.hand.push(top);
    log(game, `${source.name} reveals ${top.name} and puts it into hand.`);
    return false;
  }
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "acknowledgeReveal",
    prompt: `${source.name} reveals ${top.name}.`,
    options: [{ id: "continue", label: "Continue" }],
    data: {
      revealedCards: [top],
      revealResolution: "predictTopSpell",
      resumeShowdownStart: resume.resumeShowdownStart || null
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(resume.fromShowdownChain)
  };
  return true;
}

function resolveMoonfallAtBattlefield(game, player, source, battlefield) {
  const enemies = battlefield.units.filter((unit) => unit.controllerId !== player.id);
  for (const enemy of enemies) addMightModifier(enemy, -2, { temporary: true });
  markEffect(game, source, enemies.map((unit) => unit.instanceId), `${source.name} weakens enemies at ${battlefield.name}.`);
  log(game, `${source.name} gives enemy units at ${battlefield.name} -2 Might.`);
  updateBattlefieldControl(game);
  startShowdownIfOpposedAfterEffect(game, battlefield, player.id);
}

function startShowdownIfOpposedAfterEffect(game, battlefield, attackerId) {
  if (game.phase !== "action") return;
  const hasAttacker = battlefield.units.some((unit) => unit.controllerId === attackerId);
  const hasEnemy = battlefield.units.some((unit) => unit.controllerId !== attackerId);
  if (!hasAttacker || !hasEnemy) return;
  log(game, `Opposing units meet at ${battlefield.name}.`);
  stageBattlefieldEvent(game, {
    type: "combat",
    battlefield,
    attackerId
  });
}

function repeatChoiceData(spec) {
  if (!spec.repeatCostEnergy) return {};
  return {
    repeatCostEnergy: spec.repeatCostEnergy,
    repeatSpec: spec
  };
}

function offerRepeatChoice(game, choice, player, source) {
  const repeatCostEnergy = choice.data?.repeatCostEnergy || 0;
  const declaredRepeat = (source.declaredPlayChoices || []).find((declaration) => declaration.effect === "repeatCount");
  if (declaredRepeat) {
    if ((declaredRepeat.amount || 0) <= 0) return false;
    declaredRepeat.amount -= 1;
    resolveEffectSpec(game, player, source, choice.data.repeatSpec, choice.finishSpell);
    return true;
  }
  if (!game.interactive) return false;
  if (!choice.finishSpell || !repeatCostEnergy || !choice.data?.repeatSpec) return false;
  if (!payEnergyIfPossible(game, player, repeatCostEnergy, true)) return false;
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "repeatSpell",
    prompt: `Repeat ${source.name} for Energy ${repeatCostEnergy}?`,
    options: [
      { id: "repeat", label: `Pay Energy ${repeatCostEnergy} and repeat` },
      { id: "done", label: "Do not repeat" }
    ],
    data: {
      repeatCostEnergy,
      repeatSpec: choice.data.repeatSpec
    },
    finishSpell: choice.finishSpell,
    optional: false,
    fromShowdownChain: choice.fromShowdownChain
  };
  log(game, `${source.name} may be repeated for Energy ${repeatCostEnergy}.`);
  return true;
}

function battlefieldUnitTargets(game, player, scope) {
  return game.battlefields.flatMap((battlefield) => battlefield.units
    .filter((unit) => {
      if (scope === "enemyBattlefield") return unit.controllerId !== player.id;
      if (scope === "friendlyBattlefield") return unit.controllerId === player.id;
      return true;
    })
    .map((unit) => ({ type: "battlefield", battlefield, unit })));
}

function spellMoveDestinationOptions(game, unit) {
  const location = findUnitLocation(game, unit.instanceId);
  const owner = game.players.find((player) => player.id === unit.ownerId);
  return [
    ...(location?.type === "base" ? [] : [{ id: "base", label: `${owner?.name || "Owner"} Base`, destination: "base" }]),
    ...game.battlefields
      .filter((field) => location?.type !== "battlefield" || field.instanceId !== location.battlefield.instanceId)
      .map((field) => ({
        id: field.instanceId,
        label: field.name,
        cardId: field.instanceId,
        destination: field.instanceId
      }))
  ];
}

function moveUnitBySpell(game, player, source, unit, destinationId, options = {}) {
  const location = findUnitLocation(game, unit.instanceId);
  if (!location) return false;
  const sourceBattlefield = location.type === "battlefield" ? location.battlefield : null;
  const operation = beginGameOperation(game, "effectMove", {
    playerId: player.id,
    unitIds: [unit.instanceId],
    destinationId,
    sourceCardId: source.instanceId
  });
  removeUnitFromSource(location);
  if (options.readyAfterMove) readyUnitWithEffects(game, player, source, unit);

  if (destinationId === "base") {
    const movingPlayer = game.players.find((candidate) => candidate.id === unit.controllerId) || player;
    movingPlayer.base.push(unit);
    log(game, `${source.name} moves ${unit.name} to ${movingPlayer.name}'s base.`);
    const afterMove = {
      type: "effectMove",
      playerId: movingPlayer.id,
      unitId: unit.instanceId,
      sourceCardId: source.instanceId,
      sourceBattlefieldId: sourceBattlefield?.instanceId || null,
      sourceBattlefieldIds: sourceBattlefield ? { [unit.instanceId]: sourceBattlefield.instanceId } : {},
      destinationId: "base",
      operationId: operation.id,
      continuationChoice: options.continuationChoice || null
    };
    if (triggerMoveEffectsBatch(game, player, [unit], afterMove)) return true;
    finishEffectMove(game, afterMove);
    return true;
  }

  const battlefield = game.battlefields.find((field) => field.instanceId === destinationId || field.id === destinationId);
  if (!battlefield) {
    placeUnitAtLocation(unit, location);
    completeGameOperation(game, operation.id, "invalid-destination");
    return false;
  }
  battlefield.units.push(unit);
  log(game, `${source.name} moves ${unit.name} to ${battlefield.name}.`);
  const movingPlayer = game.players.find((candidate) => candidate.id === unit.controllerId) || player;
  const afterMove = {
    type: "effectMove",
    playerId: movingPlayer.id,
    unitId: unit.instanceId,
    sourceCardId: source.instanceId,
    sourceBattlefieldId: sourceBattlefield?.instanceId || null,
    sourceBattlefieldIds: sourceBattlefield ? { [unit.instanceId]: sourceBattlefield.instanceId } : {},
    destinationId: battlefield.instanceId,
    operationId: operation.id,
    continuationChoice: options.continuationChoice || null
  };
  if (triggerMoveEffectsBatch(game, player, [unit], afterMove)) return true;
  finishEffectMove(game, afterMove);
  return true;
}

function moveUnitsByEffect(game, responsiblePlayer, source, moves) {
  const prepared = (moves || []).map(({ unit, destinationId }) => ({
    unit,
    destinationId,
    location: unit ? findUnitLocation(game, unit.instanceId) : null
  })).filter(({ unit, location, destinationId }) => {
    if (!unit || !location || !destinationId) return false;
    const originId = location.type === "battlefield" ? location.battlefield.instanceId : "base";
    return originId !== destinationId;
  });
  if (!prepared.length) return false;
  if (prepared.some(({ destinationId }) => destinationId !== "base"
    && !game.battlefields.some((field) => field.instanceId === destinationId || field.id === destinationId))) return false;

  const operation = beginGameOperation(game, "effectMoveBatch", {
    playerId: responsiblePlayer.id,
    unitIds: prepared.map(({ unit }) => unit.instanceId),
    destinationIds: Object.fromEntries(prepared.map(({ unit, destinationId }) => [unit.instanceId, destinationId])),
    sourceCardId: source.instanceId
  });
  const sourceBattlefieldIds = Object.fromEntries(prepared
    .filter(({ location }) => location.type === "battlefield")
    .map(({ unit, location }) => [unit.instanceId, location.battlefield.instanceId]));
  for (const { location } of prepared) removeUnitFromSource(location);
  for (const { unit, destinationId } of prepared) {
    if (destinationId === "base") {
      const controller = game.players.find((candidate) => candidate.id === unit.controllerId) || responsiblePlayer;
      controller.base.push(unit);
    } else {
      game.battlefields.find((field) => field.instanceId === destinationId || field.id === destinationId)?.units.push(unit);
    }
  }

  const afterMove = {
    type: "effectMoveBatch",
    playerId: responsiblePlayer.id,
    unitIds: prepared.map(({ unit }) => unit.instanceId),
    sourceCardId: source.instanceId,
    sourceBattlefieldIds,
    destinationIds: Object.fromEntries(prepared.map(({ unit, destinationId }) => [unit.instanceId, destinationId])),
    operationId: operation.id
  };
  const units = prepared.map(({ unit }) => unit);
  if (triggerMoveEffectsBatch(game, responsiblePlayer, units, afterMove)) return true;
  finishEffectMoveBatch(game, afterMove);
  return true;
}

function finishEffectMove(game, afterMove) {
  const unit = findCard(game, afterMove.unitId);
  const sourceBattlefield = game.battlefields.find((field) => field.instanceId === afterMove.sourceBattlefieldId);
  if (afterMove.destinationId === "base") {
    settleBattlefieldAfterEffectMove(game, sourceBattlefield);
    requestCleanup(game, "move-completed", { unitIds: [afterMove.unitId], destinationId: "base" });
    completeGameOperation(game, afterMove.operationId, "effect-move-to-base");
    if (afterMove.continuationChoice) presentPreparedChoice(game, afterMove.continuationChoice);
    return Boolean(unit);
  }
  const battlefield = game.battlefields.find((field) => field.instanceId === afterMove.destinationId);
  if (!unit || !battlefield || !battlefield.units.some((candidate) => candidate.instanceId === unit.instanceId)) return false;
  settleBattlefieldAfterEffectMove(game, sourceBattlefield);
  settleBattlefieldAfterEffectMove(game, battlefield);
  if (!upgradeNonCombatShowdownIfOpposed(game, battlefield)) {
    startShowdownIfOpposedAfterEffect(game, battlefield, unit.controllerId);
  }
  requestCleanup(game, "move-completed", { unitIds: [afterMove.unitId], destinationId: battlefield.instanceId });
  completeGameOperation(game, afterMove.operationId, "effect-move-finished");
  if (afterMove.continuationChoice) presentPreparedChoice(game, afterMove.continuationChoice);
  return true;
}

function finishEffectMoveBatch(game, afterMove) {
  const affectedBattlefields = new Set([
    ...Object.values(afterMove.sourceBattlefieldIds || {}),
    ...Object.values(afterMove.destinationIds || {}).filter((destinationId) => destinationId !== "base")
  ]);
  for (const battlefieldId of affectedBattlefields) {
    const battlefield = game.battlefields.find((field) => field.instanceId === battlefieldId);
    settleBattlefieldAfterEffectMove(game, battlefield);
  }
  for (const destinationId of new Set(Object.values(afterMove.destinationIds || {}))) {
    if (destinationId === "base") continue;
    const battlefield = game.battlefields.find((field) => field.instanceId === destinationId);
    const movedUnit = (afterMove.unitIds || []).map((unitId) => findCard(game, unitId))
      .find((unit) => unit && battlefield?.units.includes(unit));
    if (battlefield && movedUnit && !upgradeNonCombatShowdownIfOpposed(game, battlefield)) {
      startShowdownIfOpposedAfterEffect(game, battlefield, movedUnit.controllerId);
    }
  }
  requestCleanup(game, "move-completed", {
    unitIds: [...(afterMove.unitIds || [])],
    destinationIds: { ...(afterMove.destinationIds || {}) }
  });
  completeGameOperation(game, afterMove.operationId, "effect-move-batch-finished");
  return true;
}

function beginGameOperation(game, kind, data = {}) {
  game.nextOperationSequence = (game.nextOperationSequence || 0) + 1;
  const operation = {
    id: `operation-${game.nextOperationSequence}`,
    kind,
    status: "pending",
    startedAtTurnSequence: game.turnSequence || 0,
    data: structuredClone(data)
  };
  game.operations ||= [];
  game.lifecycleEvents ||= [];
  game.operations.push(operation);
  game.lifecycleEvents.push({ operationId: operation.id, kind, event: "started" });
  return operation;
}

function completeGameOperation(game, operationId, reason = "completed") {
  if (!operationId) return;
  const operation = (game.operations || []).find((candidate) => candidate.id === operationId);
  if (!operation || operation.status !== "pending") return;
  operation.status = "completed";
  operation.reason = reason;
  game.lifecycleEvents ||= [];
  game.lifecycleEvents.push({ operationId, kind: operation.kind, event: "completed", reason });
}

function upgradeNonCombatShowdownIfOpposed(game, battlefield) {
  const showdown = game.showdown;
  if (game.phase !== "showdown" || !showdown || showdown.battlefieldId !== battlefield.instanceId) return false;
  if (showdown.combat !== false) return false;
  const attacker = battlefield.units.find((unit) => unit.controllerId === showdown.attackerId);
  const defender = battlefield.units.find((unit) => unit.controllerId !== showdown.attackerId);
  if (!attacker || !defender) return false;
  showdown.combat = true;
  showdown.combatId = nextCombatId(game);
  showdown.defenderId = defender.controllerId;
  showdown.consecutivePasses = 0;
  battlefield.combatExcessDamageByPlayer = {};
  game.stagedEvents = (game.stagedEvents || []).filter((event) => event.battlefieldId !== battlefield.instanceId);
  const triggers = collectAttackOrDefendTriggers(game, battlefield, showdown.attackerId);
  if (triggers.length) prepareAndQueueTriggers(game, triggers, "showdownChain");
  log(game, `${battlefield.name}'s non-combat showdown becomes a combat showdown.`);
  return true;
}

function settleBattlefieldAfterEffectMove(game, battlefield) {
  if (!battlefield) return;
  if (game.showdown?.battlefieldId === battlefield.instanceId) return;
  settleBattlefieldByOccupancy(game, battlefield, "after the move");
}

function settleBattlefieldByOccupancy(game, battlefield, reason) {
  const controllers = new Set(battlefield.units.map((unit) => unit.controllerId));
  if (controllers.size === 0) {
    battlefield.controlledBy = null;
    return;
  }
  if (controllers.size === 1) {
    settleBattlefieldConquest(game, battlefield, [...controllers][0], reason);
  }
}

function settleBattlefieldConquest(game, battlefield, controllerId, reason) {
  const player = game.players.find((candidate) => candidate.id === controllerId);
  if (!player) return;
  const alreadyControlled = battlefield.controlledBy === controllerId;
  battlefield.controlledBy = controllerId;
  delete battlefield.contestedBy;
  if (alreadyControlled) return;
  const excess = reason === "after combat" ? (battlefield.combatExcessDamageByPlayer?.[controllerId] || 0) : 0;
  for (const unit of battlefield.units.filter((candidate) => candidate.controllerId === controllerId)) {
    unit.lastConquerExcessDamage = excess;
  }
  const scored = awardPoint(game, player, battlefield.instanceId, "conquer");
  triggerConquerEventEffects(
    game,
    player,
    battlefield,
    battlefield.units.filter((candidate) => candidate.controllerId === controllerId),
    scored
  );
  log(game, `${player.name} conquers ${battlefield.name} ${reason}.`);
}

function allGear(game) {
  return [
    ...game.players.flatMap((player) => player.base.filter((card) => card.type === "gear")),
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.type === "gear")),
    ...allUnits(game).flatMap((unit) => unit.attachments || [])
  ];
}

function totalPowerCost(card) {
  return (card.power || []).reduce((sum, requirement) => sum + requirement.amount, 0);
}

function needsDeflectPayment(game, player, unit) {
  if (!unit || unit.type !== "unit") return false;
  if (unit.controllerId === player.id) return false;
  return hasKeyword(unit, "Deflect", game) || hasStaticEffect(unit, "deflect");
}

function deflectAmount(game, unit) {
  return Math.max(1, keywordAmount(unit, "Deflect", 1, game) + staticEffectAmountTotal(unit, "deflect", 0));
}

function deflectPaidForChoice(choice, unit) {
  return (choice.data?.deflectPaidTargetIds || []).includes(unit.instanceId);
}

function offerDeflectPayment(game, choice, option, player, source, target) {
  const amount = deflectAmount(game, target);
  const options = player.runes
    .filter((rune) => powerMatches(rune, { domain: "Any", amount: 1 }))
    .map((rune) => ({ id: rune.instanceId, label: `${rune.domain} Rune`, cardId: rune.instanceId }));
  if (options.length < amount) return false;
  if (!game.interactive) return false;
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "payDeflect",
    prompt: `${target.name} has Deflect ${amount}. Choose rune ${amount} of ${amount} to pay Power.`,
    options,
    data: {
      targetId: target.instanceId,
      amount,
      selectedRuneIds: [],
      originalChoice: choice,
      originalOption: option
    },
    finishSpell: Boolean(choice.finishSpell),
    optional: false,
    fromShowdownChain: Boolean(choice.fromShowdownChain)
  };
  log(game, `${target.name} requires Deflect Power.`);
  return true;
}

function payChosenPowerRunes(game, player, runeIds, amount) {
  const uniqueIds = [...new Set(runeIds)];
  if (uniqueIds.length < amount) return false;
  const chosenIds = uniqueIds.slice(0, amount);
  if (chosenIds.some((id) => !player.runes.some((rune) =>
    rune.instanceId === id && powerMatches(rune, { domain: "Any", amount: 1 })
  ))) return false;
  return recyclePowerRunesInChosenOrder(game, player, chosenIds);
}

function recyclePowerRunesInChosenOrder(game, controller, runeIds) {
  const orderedIds = [...new Set(runeIds)];
  const orderedRunes = orderedIds.map((id) => controller.runes.find((rune) => rune.instanceId === id));
  if (orderedRunes.some((rune) => !rune)) return false;
  const selected = new Set(orderedIds);
  controller.runes = controller.runes.filter((rune) => !selected.has(rune.instanceId));
  for (const rune of orderedRunes) {
    markNonBoardZoneChange(rune);
    rune.exhausted = false;
    if (rune.isToken) continue;
    const owner = game.players.find((player) => player.id === rune.ownerId) || controller;
    owner.runeDeck ||= [];
    owner.runeDeck.push(rune);
  }
  return true;
}

function canChooseUnit(game, player, sourceCard, unit) {
  if (unit.controllerId === player.id) return true;
  if (hasStaticEffect(unit, "cannotBeChosenByEnemy")) return false;
  if ((sourceCard?.deflectPaidTargetIds || []).includes(unit.instanceId)) return true;
  if (hasKeyword(unit, "Deflect", game) || hasStaticEffect(unit, "deflect")) {
    return payAdditionalPower(game, player, { domain: "Any", amount: deflectAmount(game, unit) }, true);
  }
  return Boolean(sourceCard);
}

function hiddenTargetAllowed(game, sourceCard, unit) {
  if (!sourceCard?.playedFromHidden || !sourceCard.hiddenBattlefieldId) return true;
  const location = findUnitLocation(game, unit.instanceId);
  return location?.type === "battlefield" && location.battlefield.instanceId === sourceCard.hiddenBattlefieldId;
}

function payDeflectIfNeeded(game, player, sourceCard, unit) {
  if (!sourceCard || unit.controllerId === player.id) return true;
  if (!hasKeyword(unit, "Deflect", game) && !hasStaticEffect(unit, "deflect")) return true;
  return payAdditionalPower(game, player, { domain: "Any", amount: deflectAmount(game, unit) });
}

function payPowerRequirements(game, player, requirements = [], dryRun = false) {
  if (!requirements.length) return true;
  const chosen = choosePowerPaymentSources(player, requirements);
  if (!chosen) return false;
  if (dryRun) return true;
  consumeSelectedPoolPower(player, chosen.poolPowerIds);
  return recyclePowerRunesInChosenOrder(game, player, chosen.powerRuneIds);
}

function canUseForgeLegendAbility(game, player, card) {
  if (card.type !== "legend" || card.controllerId !== player.id) return false;
  return game.battlefields.some((field) => field.controlledBy === player.id && hasAnyEffect(field, "battlefieldControl", "legendAttachEquipment"));
}

function gainXp(player, amount) {
  player.xp += amount;
}

function addMightModifier(unit, amount, options = {}) {
  if (options.buff === true) {
    if (amount <= 0) return;
    const current = Math.max(0, unit.buffs || 0);
    unit.buffs = Math.min(options.maxBuffs ?? 1, current + amount);
    return;
  }
  unit.mightModifier = (unit.mightModifier || 0) + amount;
  if (options.temporary) unit.temporaryMight = (unit.temporaryMight || 0) + amount;
}

function buffUnitWithEffects(game, player, source, unit, amount, options = {}) {
  const before = Math.max(0, unit.buffs || 0);
  addMightModifier(unit, amount, { ...options, buff: true });
  if ((unit.buffs || 0) <= before) return false;
  triggerFriendlyUnitBuffed(game, player, unit, source);
  return true;
}

function exhaustCards(game, player, source, cards, options = {}) {
  const exhausted = [...new Map((cards || [])
    .filter((card) => card && !card.exhausted)
    .map((card) => [card.instanceId, card])).values()];
  if (!exhausted.length) return exhausted;
  for (const card of exhausted) card.exhausted = true;
  requestCleanup(game, "object-status-change", {
    objectIds: exhausted.map((card) => card.instanceId),
    status: "exhausted"
  });
  game.exhaustEventSequence = (game.exhaustEventSequence || 0) + 1;
  game.exhaustEvents ||= [];
  game.exhaustEvents.push({
    id: `exhaust-${game.exhaustEventSequence}`,
    cardIds: exhausted.map((card) => card.instanceId),
    responsiblePlayerId: options.responsiblePlayerId === undefined ? player?.id || null : options.responsiblePlayerId,
    sourceCardId: source?.instanceId || null,
    reason: options.reason || "effect",
    cost: Boolean(options.cost),
    turnSequence: game.turnSequence || 0
  });
  return exhausted;
}

function readyCardsAndCollectTriggers(game, player, source, cards, options = {}) {
  if (!player) return { readied: [], triggers: [] };
  const readied = [...new Map((cards || [])
    .filter((card) => card && card.type !== "spell" && card.exhausted)
    .map((card) => [card.instanceId, card])).values()];
  if (!readied.length) return { readied, triggers: [] };
  for (const card of readied) card.exhausted = false;
  requestCleanup(game, "object-status-change", {
    objectIds: readied.map((card) => card.instanceId),
    status: "ready"
  });
  game.readyEventSequence = (game.readyEventSequence || 0) + 1;
  const simultaneousBatchId = options.simultaneousBatchId || `ready-${game.readyEventSequence}`;
  game.readyEvents ||= [];
  game.readyEvents.push({
    id: simultaneousBatchId,
    simultaneousBatchId,
    cardIds: readied.map((card) => card.instanceId),
    responsiblePlayerId: player.id,
    sourceCardId: source?.instanceId || null,
    reason: options.reason || "effect",
    turnSequence: game.turnSequence || 0
  });
  const triggers = [];
  for (const unit of readied.filter((card) => card.type === "unit")) {
    collectFriendlyUnitReadiedTriggers(game, player, unit, source, triggers, simultaneousBatchId);
  }
  return { readied, triggers };
}

function readyCardsWithEffects(game, player, source, cards, options = {}) {
  const { readied, triggers } = readyCardsAndCollectTriggers(game, player, source, cards, options);
  if (triggers.length) {
    prepareAndQueueTriggers(
      game,
      triggers,
      options.triggerMode || (game.phase === "showdown" && game.showdown ? "showdownChain" : "queue"),
      options.continuation || null
    );
  } else if (options.continuation) {
    runTriggerContinuation(game, options.continuation);
  }
  return readied.length > 0;
}

function readyUnitWithEffects(game, player, source, unit, options = {}) {
  return readyCardsWithEffects(game, player, source, [unit], options);
}

function collectFriendlyUnitReadiedTriggers(game, player, unit, eventSource, triggers, simultaneousBatchId = null) {
  if (!player || unit.controllerId !== player.id) return false;
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "static")) {
      if (effect.kind !== "readyFriendlyUnitMightThisTurn") continue;
      triggers.push({
        kind: "readyFriendlyUnitMight",
        playerId: player.id,
        sourceCardId: source.instanceId,
        simultaneousBatchId,
        data: { unitId: unit.instanceId, amount: effect.amount || 1, eventSourceId: eventSource?.instanceId || null }
      });
    }
  }
  return triggers.length > 0;
}

function triggerFriendlyUnitBuffed(game, player, unit, eventSource) {
  if (!player || unit.controllerId !== player.id) return false;
  const triggers = [];
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "static")) {
      if (effect.kind !== "buffFriendlyUnitPayExhaustReady") continue;
      triggers.push({
        kind: "buffFriendlyUnitPayExhaustReady",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: { unitId: unit.instanceId, domain: effect.domain || "Any", eventSourceId: eventSource?.instanceId || null }
      });
    }
  }
  if (!triggers.length) return false;
  return prepareAndQueueTriggers(game, triggers, game.phase === "showdown" && game.showdown ? "showdownChain" : "queue");
}

function isTemporaryMightEffect(card, spec = {}) {
  return Boolean(spec.temporary) || /might this turn/i.test(card?.text || "");
}

function predict(game, player, source = null) {
  const top = player.mainDeck[0];
  if (!top) return;
  player.mainDeck.shift();
  recycleMainDeckCards(game, player, [top], source);
}

function removeMainDeckCards(game, cards) {
  const ids = new Set((cards || []).map((card) => card?.instanceId).filter(Boolean));
  if (!ids.size) return false;
  let changed = false;
  for (const candidate of game.players) {
    const remaining = candidate.mainDeck.filter((card) => !ids.has(card.instanceId));
    if (remaining.length !== candidate.mainDeck.length) changed = true;
    candidate.mainDeck = remaining;
  }
  return changed;
}

function removeCardFromNonBoardZones(game, cardId) {
  let changed = false;
  for (const player of game.players) {
    for (const zone of ["hand", "mainDeck", "trash", "banished", "runeDeck", "runes"]) {
      const previous = player[zone] || [];
      const remaining = previous.filter((card) => card.instanceId !== cardId);
      if (remaining.length !== previous.length) changed = true;
      player[zone] = remaining;
    }
  }
  for (const battlefield of game.battlefields) {
    const previous = battlefield.hidden || [];
    battlefield.hidden = previous.filter((entry) => entry.card.instanceId !== cardId);
    if (battlefield.hidden.length !== previous.length) changed = true;
  }
  return changed;
}

function banishCards(game, responsiblePlayer, cards, source = null, options = {}) {
  const moved = [];
  const destinations = [];
  let leftBoard = false;
  for (const card of [...new Map((cards || []).filter(Boolean).map((candidate) => [candidate.instanceId, candidate])).values()]) {
    const hiddenLocation = findHiddenCardLocation(game, card.instanceId);
    if (hiddenLocation) {
      const hiddenOwner = game.players.find((player) => player.id === hiddenLocation.ownerId);
      recordRevealEvent(game, hiddenOwner, [card], source, "facedown");
    }
    const unitLocation = card.type === "unit" ? findUnitLocation(game, card.instanceId) : null;
    const gearWasOnBoard = card.type === "gear" && allGear(game).some((gear) => gear.instanceId === card.instanceId);
    if (unitLocation || gearWasOnBoard) leftBoard = true;
    if (unitLocation) detachAttachmentsToBase(game, card, unitLocation);
    removeCardFromNonBoardZones(game, card.instanceId);
    if (card.type === "unit") removeUnitEverywhere(game, card.instanceId);
    if (card.type === "gear") removeGearEverywhere(game, card.instanceId);
    if (!options.boardStateAlreadyCleared) clearBoardState(game, card);
    const owner = game.players.find((player) => player.id === card.ownerId) || responsiblePlayer;
    if (!isTokenCard(card) && owner) {
      owner.banished ||= [];
      owner.banished.push(card);
    }
    destinations.push({
      cardId: card.instanceId,
      ownerId: owner?.id || null,
      ceasedToExist: isTokenCard(card)
    });
    moved.push(card);
  }
  if (!moved.length) return [];
  game.banishEventSequence = (game.banishEventSequence || 0) + 1;
  game.banishEvents ||= [];
  game.banishEvents.push({
    id: `banish-${game.banishEventSequence}`,
    cardIds: moved.map((card) => card.instanceId),
    sourceCardId: source?.instanceId || null,
    responsiblePlayerId: responsiblePlayer?.id || null,
    destinations,
    turnSequence: game.turnSequence || 0
  });
  updateBattlefieldControl(game);
  if (leftBoard) requestCleanup(game, "board-zone-change", {
    cardIds: moved.map((card) => card.instanceId),
    destination: "banishment"
  });
  return moved;
}

function recordRevealEvent(game, owner, cards, source = null, zone = "mainDeck") {
  const revealed = (cards || []).filter(Boolean);
  if (!revealed.length) return null;
  game.revealEventSequence = (game.revealEventSequence || 0) + 1;
  const event = {
    id: `reveal-${game.revealEventSequence}`,
    ownerId: owner?.id || null,
    cardIds: revealed.map((card) => card.instanceId),
    sourceCardId: source?.instanceId || null,
    zone,
    turnSequence: game.turnSequence || 0
  };
  game.revealEvents ||= [];
  game.revealEvents.push(event);
  return event;
}

function recycleMainDeckCards(game, player, cards, eventSource = null, options = {}) {
  if (!cards.length) return false;
  removeMainDeckCards(game, cards);
  for (const card of cards) markNonBoardZoneChange(card);
  const cardsByOwner = new Map();
  for (const card of cards) {
    if (card.isToken) continue;
    const owner = game.players.find((candidate) => candidate.id === card.ownerId) || player;
    if (!cardsByOwner.has(owner.id)) cardsByOwner.set(owner.id, { owner, cards: [] });
    cardsByOwner.get(owner.id).cards.push(card);
  }
  for (const { owner, cards: ownedCards } of cardsByOwner.values()) {
    owner.mainDeck.push(...shuffle(ownedCards, game));
  }
  const recycledCards = cards.filter((card) => !card.isToken);
  if (!recycledCards.length) return false;
  const triggers = collectRecycleEffectTriggers(
    game,
    player,
    recycledCards,
    eventSource,
    options.simultaneousBatchId || null
  );
  if (options.triggerCollector) {
    options.triggerCollector.push(...triggers);
    return triggers.length > 0;
  }
  return queueRecycleEffectTriggers(game, triggers);
}

function collectRecycleEffectTriggers(game, player, recycledCards, eventSource = null, simultaneousBatchId = null) {
  const triggers = [];
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "recycle")) {
      if (effect.kind !== "buffFriendlyUnit") continue;
      triggers.push({
        kind: "recycleBuffFriendlyUnit",
        playerId: player.id,
        sourceCardId: source.instanceId,
        simultaneousBatchId,
        data: {
          amount: effect.amount || 1,
          maxBuffs: effect.maxBuffs ?? 1,
          recycledCardIds: recycledCards.map((card) => card.instanceId),
          eventSourceId: eventSource?.instanceId || null
        }
      });
    }
  }
  return triggers;
}

function queueRecycleEffectTriggers(game, triggers) {
  if (!triggers.length) return false;
  const mode = game.phase === "showdown" && game.showdown
    ? "showdownChain"
    : game.phase === "action" && game.interactive ? "actionChain" : "queue";
  return prepareAndQueueTriggers(game, triggers, mode);
}

function chooseRecycleRunes(game, player, source, amount = 1) {
  const remaining = Math.min(Math.max(0, amount), player.runes.length);
  if (!remaining) return false;
  const choice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "recycleRunes",
    prompt: `Choose a Rune to recycle for ${source.name}.`,
    options: player.runes.map(cardOption),
    data: { remaining, recycledIds: [] },
    finishSpell: false,
    optional: false
  };
  if (!game.interactive) {
    applyChoiceEffect(game, choice, choice.options[0]);
    return Boolean(game.pendingChoice);
  }
  game.pendingChoice = choice;
  log(game, `${player.name} chooses the Rune recycled for ${source.name}.`);
  return true;
}

function resolveRecycleRunesChoice({ game, choice, option, player, source }) {
  const index = player.runes.findIndex((rune) => rune.instanceId === option.cardId);
  if (index < 0) {
    finishChoiceResolution({ game, choice, player, source });
    return;
  }
  const [rune] = player.runes.splice(index, 1);
  markNonBoardZoneChange(rune);
  rune.exhausted = false;
  if (!rune.isToken) {
    const owner = game.players.find((candidate) => candidate.id === rune.ownerId) || player;
    owner.runeDeck ||= [];
    owner.runeDeck.push(rune);
  }
  const recycledIds = [...(choice.data?.recycledIds || []), rune.instanceId];
  const remaining = Math.max(0, (choice.data?.remaining || 1) - 1);
  if (remaining > 0 && player.runes.length > 0) {
    const nextChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      options: player.runes.map(cardOption),
      data: { ...choice.data, remaining, recycledIds }
    };
    if (!game.interactive) {
      applyChoiceEffect(game, nextChoice, nextChoice.options[0]);
      return;
    }
    game.pendingChoice = nextChoice;
    return;
  }
  log(game, `${source.name} recycles ${recycledIds.length} rune${recycledIds.length === 1 ? "" : "s"}.`);
  markEffect(game, source, [source.instanceId, ...recycledIds], `${source.name} recycles runes.`);
  finishChoiceResolution({ game, choice, player, source });
}

function chooseRecycleTrashCards(game, player, source, amount = 1) {
  const remaining = Math.min(Math.max(0, amount), player.trash.length);
  if (!remaining) return false;
  const choice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "recycleTrashCards",
    prompt: `Choose a card in trash to recycle for ${source.name}.`,
    options: player.trash.map(cardOption),
    data: { remaining, selectedIds: [] },
    finishSpell: false,
    optional: false
  };
  if (!game.interactive) {
    applyChoiceEffect(game, choice, choice.options[0]);
    return Boolean(game.pendingChoice);
  }
  game.pendingChoice = choice;
  log(game, `${player.name} chooses cards in trash to recycle for ${source.name}.`);
  return true;
}

function resolveRecycleTrashCardsChoice({ game, choice, option, player, source }) {
  if (!player.trash.some((card) => card.instanceId === option.cardId)) return;
  const selectedIds = [...new Set([...(choice.data?.selectedIds || []), option.cardId])];
  const remaining = Math.max(0, (choice.data?.remaining || 1) - 1);
  if (remaining > 0) {
    const nextChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      options: player.trash.filter((card) => !selectedIds.includes(card.instanceId)).map(cardOption),
      data: { ...choice.data, remaining, selectedIds }
    };
    if (!game.interactive) {
      applyChoiceEffect(game, nextChoice, nextChoice.options[0]);
      return;
    }
    game.pendingChoice = nextChoice;
    return;
  }
  const recycled = selectedIds.map((id) => player.trash.find((card) => card.instanceId === id)).filter(Boolean);
  const selected = new Set(recycled.map((card) => card.instanceId));
  player.trash = player.trash.filter((card) => !selected.has(card.instanceId));
  recycleMainDeckCards(game, player, recycled, source);
  log(game, `${source.name} recycles ${recycled.length} card${recycled.length === 1 ? "" : "s"} from trash.`);
  markEffect(game, source, [source.instanceId, ...selectedIds], `${source.name} recycles trash.`);
  finishChoiceResolution({ game, choice, player, source });
}

function returnChosenChampionFromTrash(game, player, source, championName) {
  if (player.champion?.zone === "champion") return false;
  const index = player.trash.findIndex((card) => isChampionCard(card) && card.name === championName);
  if (index < 0) return false;
  const [champion] = player.trash.splice(index, 1);
  markNonBoardZoneChange(champion);
  champion.exhausted = false;
  healUnits(game, [champion], { reason: "return-to-champion-zone" });
  champion.stunned = false;
  player.champion = champion;
  setChampionZoneState(player, champion, "champion");
  log(game, `${source.name} returns ${champion.name} to ${player.name}'s Champion Zone.`);
  markEffect(game, source, [source.instanceId, champion.instanceId], `${champion.name} returns to the Champion Zone.`);
  return true;
}

function setChampionZoneState(player, champion, zone) {
  champion.zone = zone;
  player.championPlayed = zone === "played";
}

function payEnergyIfPossible(game, player, amount, dryRun = false) {
  const poolIds = runePoolEnergy(player)
    .filter((resource) => poolEnergyCanPay(game, resource))
    .slice(0, amount)
    .map((resource) => resource.id);
  const ready = player.runes.filter((rune) => !rune.exhausted).slice(0, amount);
  if (ready.length + poolIds.length < amount) return false;
  if (dryRun) return true;
  consumeSelectedPoolEnergy(player, poolIds);
  const remaining = Math.max(0, amount - poolIds.length);
  exhaustCards(game, player, null, ready.slice(0, remaining), { reason: "energy-cost", cost: true });
  return true;
}

function payAdditionalPower(game, player, requirement, dryRun = false) {
  if (!requirement) return true;
  return payPowerRequirements(game, player, [requirement], dryRun);
}

function swapUnitLocations(game, responsiblePlayer, first, second) {
  const firstLocation = findUnitLocation(game, first.instanceId);
  const secondLocation = findUnitLocation(game, second.instanceId);
  if (!firstLocation || !secondLocation) return false;
  const firstDestination = secondLocation.type === "battlefield" ? secondLocation.battlefield.instanceId : "base";
  const secondDestination = firstLocation.type === "battlefield" ? firstLocation.battlefield.instanceId : "base";
  return moveUnitsByEffect(game, responsiblePlayer, first, [
    { unit: first, destinationId: firstDestination },
    { unit: second, destinationId: secondDestination }
  ]);
}

function placeUnitAtLocation(unit, location) {
  if (location.type === "base") location.player.base.splice(location.index, 0, unit);
  if (location.type === "battlefield") location.battlefield.units.splice(location.index, 0, unit);
}

function canMoveUnitFromBattlefieldToBase(game, unit, location = findUnitLocation(game, unit.instanceId)) {
  if (location?.type !== "battlefield") return true;
  return !hasStaticEffect(location.battlefield, "cantMoveFromHereToBase");
}

function returnUnitToHand(game, unit, sourceName) {
  const source = findUnitLocation(game, unit.instanceId);
  if (!source) return;
  removeUnitFromSource(source);
  detachAttachmentsToBase(game, unit, source);
  clearBoardState(game, unit);
  const owner = game.players.find((player) => player.id === unit.ownerId);
  owner.hand.push(unit);
  updateBattlefieldControl(game);
  log(game, `${sourceName} returns ${unit.name} to hand.`);
}

function counterChainCard(game, cardId, sourceName) {
  const chain = game.showdown?.chain || game.actionChain?.chain;
  const index = chain?.findIndex((item) => item.card.instanceId === cardId) ?? -1;
  if (index < 0) return;
  const [item] = chain.splice(index, 1);
  requestCleanup(game, "chain-item-removed", { itemId: item.id, reason: "countered" });
  const owner = game.players.find((player) => player.id === item.card.ownerId);
  clearBoardState(game, item.card);
  owner.trash.push(item.card);
  log(game, `${sourceName} counters ${item.card.name}.`);
}

function markEffect(game, sourceCard, targetIds, message) {
  game.effectFlash = {
    sourceId: sourceCard.instanceId,
    targetIds,
    message,
    stamp: Date.now()
  };
}

function resolveCombat(game, battlefield, attackerId) {
  const attacker = game.players.find((player) => player.id === attackerId);
  const defenderId = battlefield.units.find((unit) => unit.controllerId !== attackerId)?.controllerId;
  const defender = game.players.find((player) => player.id === defenderId);
  assignCombatDesignations(game, battlefield, attackerId);
  log(game, `Combat begins at ${battlefield.name}: ${attacker.name} attacks ${defender.name}.`);

  const attackingUnits = battlefield.units.filter((unit) => unit.controllerId === attackerId);
  const defendingUnits = battlefield.units.filter((unit) => unit.controllerId === defenderId);
  if (game.interactive && beginCombatDamageAssignment(game, battlefield, attackerId, defenderId, attackingUnits, defendingUnits)) return;
  const assignments = [
    ...assignCombatDamage(game, attackingUnits, defendingUnits, "attacker"),
    ...assignCombatDamage(game, defendingUnits, attackingUnits, "defender")
  ];
  dealAssignedCombatDamage(game, battlefield, assignments);
  finishCombatResolution(game, battlefield, attackerId, defenderId);
}

function finishCombatResolution(game, battlefield, attackerId, defenderId) {
  game.combatCleanupProcess ||= {
    battlefieldId: battlefield.instanceId,
    attackerId,
    defenderId,
    specialApplied: false
  };
  requestCleanup(game, "combat-special-cleanup", { battlefieldId: battlefield.instanceId });
  checkState(game);
}

function applyCombatSpecialCleanup(game) {
  const process = game.combatCleanupProcess;
  if (!process || process.specialApplied) return false;
  const battlefield = game.battlefields.find((field) => field.instanceId === process.battlefieldId);
  if (!battlefield) {
    process.specialApplied = true;
    return false;
  }

  healUnits(game, allUnits(game), { reason: "combat-special-cleanup" });
  const defendersRemain = battlefield.units.some((unit) => unit.controllerId === process.defenderId);
  if (defendersRemain) {
    const attackersRemain = battlefield.units.some((unit) => unit.controllerId === process.attackerId);
    const recallAllOnAttackingTie = attackersRemain && allControlledCards(game, process.attackerId)
      .some((card) => hasStaticEffect(card, "attackingTieRecallsAllUnits"));
    const recalled = recallAllOnAttackingTie
      ? [...battlefield.units]
      : battlefield.units.filter((unit) => unit.controllerId === process.attackerId);
    for (const unit of recalled) recallUnit(game, unit);
    if (recallAllOnAttackingTie && recalled.length) {
      battlefield.controlledBy = null;
      log(game, "The attacking tie recalls every unit at the battlefield.");
    } else if (recalled.length) {
      log(game, "Surviving attackers return to base.");
    }
  }
  process.specialApplied = true;
  return true;
}

function completeCombatResolutionTask(game) {
  const process = game.combatCleanupProcess;
  if (!process?.specialApplied) return false;
  const battlefield = game.battlefields.find((field) => field.instanceId === process.battlefieldId);
  if (!battlefield) {
    delete game.combatCleanupProcess;
    return false;
  }

  const attackersRemain = battlefield.units.some((unit) => unit.controllerId === process.attackerId);
  const defendersRemain = battlefield.units.some((unit) => unit.controllerId === process.defenderId);
  recordCombatResultEvent(game, battlefield, process, attackersRemain, defendersRemain);
  if (attackersRemain && !defendersRemain) {
    settleBattlefieldConquest(game, battlefield, process.attackerId, "after combat");
  } else if (defendersRemain && !attackersRemain) {
    settleBattlefieldConquest(game, battlefield, process.defenderId, "after combat");
  } else {
    battlefield.controlledBy = null;
  }

  clearCombatRoles(game);
  if (attackersRemain && defendersRemain) {
    stageBattlefieldEvent(game, {
      type: "combat",
      battlefield,
      attackerId: process.attackerId
    });
  }
  delete game.combatCleanupProcess;
  const delayedDamageBatches = game.postCombatDamageTriggerBatches || [];
  delete game.postCombatDamageTriggerBatches;
  if (delayedDamageBatches.length) {
    const mode = game.phase === "showdown" && game.showdown
      ? "showdownChain"
      : game.phase === "action" && game.interactive ? "actionChain" : "queue";
    prepareAndQueueTriggers(game, flattenTriggerBatches(delayedDamageBatches), mode);
  }
  return true;
}

function recordCombatResultEvent(game, battlefield, process, attackersRemain, defendersRemain) {
  game.combatResultEventSequence = (game.combatResultEventSequence || 0) + 1;
  const attackerResult = attackersRemain && !defendersRemain
    ? "won"
    : !attackersRemain && defendersRemain ? "lost" : "no-result";
  const defenderResult = defendersRemain && !attackersRemain
    ? "won"
    : !defendersRemain && attackersRemain ? "lost" : "no-result";
  const event = {
    id: `combat-result-${game.combatResultEventSequence}`,
    battlefieldId: battlefield.instanceId,
    attackerId: process.attackerId,
    defenderId: process.defenderId,
    playerResults: {
      [process.attackerId]: attackerResult,
      [process.defenderId]: defenderResult
    },
    unitResults: Object.fromEntries(battlefield.units
      .filter((unit) => [process.attackerId, process.defenderId].includes(unit.controllerId))
      .map((unit) => [unit.instanceId, unit.controllerId === process.attackerId ? attackerResult : defenderResult])),
    turnSequence: game.turnSequence || 0
  };
  game.combatResultEvents ||= [];
  game.combatResultEvents.push(event);
  return event;
}

function clearCombatRoles(game) {
  for (const unit of allUnits(game)) {
    delete unit.combatRole;
    delete unit.combatTriggerChecks;
  }
}

function beginCombatDamageAssignment(game, battlefield, attackerId, defenderId, attackingUnits, defendingUnits) {
  const attackerTotal = combatDamageTotal(game, attackingUnits, defendingUnits, "attacker");
  const defenderTotal = combatDamageTotal(game, defendingUnits, attackingUnits, "defender");
  const context = {
    battlefieldId: battlefield.instanceId,
    attackerId,
    defenderId,
    attackerTotal,
    defenderTotal,
    assignments: []
  };
  if (attackerTotal > 0 && defendingUnits.length > 0) {
    promptCombatDamageChoice(game, {
      ...context,
      assigningPlayerId: attackerId,
      targetPlayerId: defenderId,
      role: "attacker",
      remaining: attackerTotal
    });
    return true;
  }
  if (defenderTotal > 0 && attackingUnits.length > 0) {
    promptCombatDamageChoice(game, {
      ...context,
      assigningPlayerId: defenderId,
      targetPlayerId: attackerId,
      role: "defender",
      remaining: defenderTotal
    });
    return true;
  }
  return false;
}

function combatDamageTotal(game, sources, targets, role) {
  return sources.reduce((sum, unit) => sum + (unit.stunned ? 0 : combatMight(game, unit, role, sources, targets)), 0);
}

function promptCombatDamageChoice(game, context) {
  const battlefield = game.battlefields.find((field) => field.instanceId === context.battlefieldId);
  const assigningPlayer = game.players.find((player) => player.id === context.assigningPlayerId);
  const targetInfos = combatDamageTargetInfos(game, battlefield, context);
  const targets = targetInfos.filter((info) => info.legal).map((info) => info.unit);
  if (!battlefield || !assigningPlayer || context.remaining <= 0 || targets.length === 0) {
    continueCombatDamageAssignment(game, context);
    return false;
  }
  game.currentPlayerId = assigningPlayer.id;
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: assigningPlayer.id,
    card: battlefield,
    effect: "combatDamage",
    prompt: `Choose a unit for ${context.remaining} combat damage. Lethal damage is assigned automatically.`,
    options: combatDamageOptions(game, battlefield, targets, context),
    data: {
      ...context,
      targetInfos: targetInfos.map((info) => ({
        cardId: info.unit.instanceId,
        legal: info.legal,
        reason: info.reason,
        amount: info.amount,
        lethalNow: info.lethalNow,
        lethalRemaining: info.lethalRemaining
      }))
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  log(game, `${assigningPlayer.name} assigns combat damage at ${battlefield.name}.`);
  return true;
}

function combatDamageTargets(game, battlefield, context) {
  return combatDamageTargetInfos(game, battlefield, context)
    .filter((info) => info.legal)
    .map((info) => info.unit);
}

function combatDamageTargetInfos(game, battlefield, context) {
  const assignedByTarget = combatAssignedDamageByTarget(context.assignments || []);
  const candidates = battlefield.units
    .filter((unit) => unit.controllerId === context.targetPlayerId)
    .map((unit) => {
      const preventionValue = combatDamagePreventionValue(game, unit);
      const damagePrevented = preventionValue === Number.POSITIVE_INFINITY;
      const lethalRemaining = damagePrevented
        ? Number.POSITIVE_INFINITY
        : Math.max(0, combatLethalThreshold(game, battlefield, unit, context.role)
          - unit.damage - (assignedByTarget.get(unit.instanceId) || 0) + preventionValue);
      const lethalNow = !damagePrevented && lethalRemaining > 0 && lethalRemaining <= context.remaining;
      return {
        unit,
        legal: true,
        reason: "",
        amount: lethalNow ? lethalRemaining : context.remaining,
        lethalNow,
        lethalRemaining,
        damagePrevented,
        mustAssignFirst: !damagePrevented && hasKeyword(unit, "Tank", game),
        mustAssignLast: !damagePrevented && (
          hasKeyword(unit, "Backline", game)
          || hasStaticEffect(unit, "combatDamageAssignmentLast")
        )
      };
    });
  for (const info of candidates) {
    if (isLethalAssignedCombatDamage(game, battlefield, info.unit, context.role, assignedByTarget)) {
      info.legal = false;
      info.reason = "Lethal already assigned";
    }
  }
  const active = candidates.filter((info) => info.legal);
  const mandatoryFirst = active.filter((info) => info.mustAssignFirst && !info.mustAssignLast);
  const conflicting = active.filter((info) => info.mustAssignFirst && info.mustAssignLast);
  const ordinary = active.filter((info) => !info.mustAssignFirst && !info.mustAssignLast);
  let priorityEligible;
  if (mandatoryFirst.length) {
    priorityEligible = new Set([...mandatoryFirst, ...conflicting]);
  } else if (ordinary.length) {
    priorityEligible = new Set([...ordinary, ...conflicting]);
  } else {
    // Every remaining unit can legally occupy the final assignment tier. A
    // unit with both requirements may choose its "last" requirement.
    priorityEligible = new Set(active);
  }
  for (const info of active) {
    if (priorityEligible.has(info)) continue;
    info.legal = false;
    info.reason = info.mustAssignLast
      ? (hasKeyword(info.unit, "Backline", game) ? "Backline last" : "Assign last")
      : "Tank first";
  }
  const legalLethalTargets = candidates.filter((info) => info.legal && info.lethalNow);
  if (legalLethalTargets.length) {
    for (const info of candidates) {
      if (info.legal && !info.lethalNow) {
        info.legal = false;
        info.reason = "Assign lethal first";
      }
    }
  }
  if (context.remaining > 0 && candidates.length > 0 && !candidates.some((info) => info.legal)) {
    for (const info of candidates) {
      info.legal = true;
      info.reason = "Excess damage";
      info.amount = context.remaining;
      info.lethalNow = false;
    }
  }
  return candidates;
}

function combatDamageOptions(game, battlefield, targets, context) {
  const assignedByTarget = combatAssignedDamageByTarget(context.assignments || []);
  const candidates = targets
    .map((target) => {
      const preventionValue = combatDamagePreventionValue(game, target);
      const damagePrevented = preventionValue === Number.POSITIVE_INFINITY;
      const lethalRemaining = damagePrevented
        ? Number.POSITIVE_INFINITY
        : Math.max(0, combatLethalThreshold(game, battlefield, target, context.role)
          - target.damage - (assignedByTarget.get(target.instanceId) || 0) + preventionValue);
      return {
        target,
        lethalRemaining,
        lethalNow: !damagePrevented && lethalRemaining > 0 && lethalRemaining <= context.remaining,
        excessOnly: lethalRemaining === 0
      };
    });
  const lethalCandidates = candidates.filter((candidate) => candidate.lethalNow);
  const shown = lethalCandidates.length ? lethalCandidates : candidates;
  return shown.map(({ target, lethalRemaining, lethalNow, excessOnly }) => {
    const amount = excessOnly ? context.remaining : (lethalNow ? lethalRemaining : context.remaining);
    return {
      id: target.instanceId,
      label: `${target.name}: ${amount} damage${lethalNow ? " (lethal)" : excessOnly ? " (excess)" : ""}`,
      cardId: target.instanceId,
      amount
    };
  });
}

function isLethalAssignedCombatDamage(game, battlefield, unit, incomingRole, assignedByTarget = new Map()) {
  const assigned = assignedByTarget.get(unit.instanceId) || 0;
  const prevention = combatDamagePreventionValue(game, unit);
  if (!Number.isFinite(prevention)) return false;
  return unit.damage + assigned > 0
    && unit.damage + assigned >= combatLethalThreshold(game, battlefield, unit, incomingRole) + prevention;
}

function combatAssignedDamageByTarget(assignments) {
  const totals = new Map();
  for (const assignment of assignments || []) {
    totals.set(assignment.targetId, (totals.get(assignment.targetId) || 0) + (assignment.amount || 0));
  }
  return totals;
}

function combatDamagePreventionValue(game, unit) {
  if (hasStaticEffect(unit, "preventDamageAfterSecondMove") && (unit.movesThisTurn || 0) >= 2) {
    return Number.POSITIVE_INFINITY;
  }
  return trackedDamagePreventionValue(game, unit, "combat");
}

function combatLethalThreshold(game, battlefield, unit, incomingRole) {
  const role = incomingRole === "attacker" ? "defender" : "attacker";
  return currentCombatMight(game, battlefield, unit, role);
}

function continueCombatDamageAssignment(game, context) {
  const battlefield = game.battlefields.find((field) => field.instanceId === context.battlefieldId);
  if (!battlefield) return;
  if (context.role === "attacker" && context.defenderTotal > 0) {
    const attackingUnits = battlefield.units.filter((unit) => unit.controllerId === context.attackerId);
    if (attackingUnits.length > 0) {
      promptCombatDamageChoice(game, {
        ...context,
        assigningPlayerId: context.defenderId,
        targetPlayerId: context.attackerId,
        role: "defender",
        remaining: context.defenderTotal
      });
      return;
    }
  }
  dealAssignedCombatDamage(game, battlefield, context.assignments || []);
  finishCombatResolution(game, battlefield, context.attackerId, context.defenderId);
  updateBattlefieldControl(game);
  checkState(game);
  if (!game.pendingChoice && !game.pendingPayment && !game.actionChain) game.currentPlayerId = context.attackerId;
}

function assignCombatDamage(game, sources, targets, role, existingAssignments = []) {
  let total = combatDamageTotal(game, sources, targets, role);
  const battlefield = sources.length
    ? findUnitLocation(game, sources[0].instanceId)?.battlefield
    : findUnitLocation(game, targets[0]?.instanceId)?.battlefield;
  const assigningPlayerId = sources[0]?.controllerId;
  const targetPlayerId = targets[0]?.controllerId;
  if (!battlefield || !assigningPlayerId || !targetPlayerId) return [];
  const assignments = [...existingAssignments];

  while (total > 0) {
    const context = {
      battlefieldId: battlefield.instanceId,
      assigningPlayerId,
      targetPlayerId,
      role,
      remaining: total,
      assignments
    };
    const legalTargets = combatDamageTargets(game, battlefield, context);
    if (!legalTargets.length) break;
    const [option] = combatDamageOptions(game, battlefield, legalTargets, context);
    if (!option) break;
    const target = findCard(game, option.cardId);
    if (!target) break;
    const damage = Math.min(total, option.amount);
    assignments.push({ targetId: target.instanceId, amount: damage, assigningPlayerId, role });
    recordExcessCombatDamage(game, { ...context, assignments }, target, damage);
    total -= damage;
  }
  return assignments.slice(existingAssignments.length);
}

function dealAssignedCombatDamage(game, battlefield, assignments) {
  const deferredTriggerBatches = [];
  for (const assignment of assignments || []) {
    const target = findCard(game, assignment.targetId);
    if (!target || !battlefield.units.includes(target)) continue;
    const sources = battlefield.units.filter((unit) =>
      unit.controllerId === assignment.assigningPlayerId && unit.combatRole === assignment.role
    );
    const source = sources[0] || battlefield;
    const player = game.players.find((candidate) => candidate.id === assignment.assigningPlayerId);
    applyDamage(game, player, source, target, assignment.amount || 0, {
      origin: "combat",
      sourceCardIds: sources.map((unit) => unit.instanceId),
      deferredTriggerBatches
    });
  }
  if (deferredTriggerBatches.length) {
    game.postCombatDamageTriggerBatches ||= [];
    game.postCombatDamageTriggerBatches.push(...deferredTriggerBatches);
  }
}

function recordExcessCombatDamage(game, context, target, assigned) {
  const battlefield = game.battlefields.find((field) => field.instanceId === context.battlefieldId);
  if (!battlefield || !context.assigningPlayerId || assigned <= 0) return;
  const targetRole = context.role === "attacker" ? "defender" : "attacker";
  const assignedTotal = combatAssignedDamageByTarget(context.assignments || []).get(target.instanceId) || 0;
  const assignedBeforeThis = Math.max(0, assignedTotal - assigned);
  const preventionValue = combatDamagePreventionValue(game, target);
  const lethalNeeded = Math.max(0, currentCombatMight(game, battlefield, target, targetRole)
    - (target.damage || 0) - assignedBeforeThis + preventionValue);
  const excess = Math.max(0, assigned - lethalNeeded);
  if (!excess) return;
  battlefield.combatExcessDamageByPlayer ||= {};
  battlefield.combatExcessDamageByPlayer[context.assigningPlayerId] =
    (battlefield.combatExcessDamageByPlayer[context.assigningPlayerId] || 0) + excess;
}

function combatMight(game, unit, role, allies, enemies) {
  const battlefield = findUnitLocation(game, unit.instanceId)?.battlefield;
  const opposingRole = role === "attacker" ? "defender" : "attacker";
  if (enemies.some((enemy) => hasStaticEffect(enemy, "suppressWeakerEnemyCombatDamage")
    && currentCombatMight(game, battlefield, unit, role) < currentCombatMight(game, battlefield, enemy, opposingRole))) {
    return 0;
  }
  return currentCombatMight(game, findUnitLocation(game, unit.instanceId)?.battlefield, unit, role);
}

export function currentCombatMight(game, battlefield, unit, role) {
  return resolveLayeredNumber({
    printed: unit.might || 0,
    assignment: unit.assignedMight,
    modifiers: [
      ...intrinsicMightModifiers(unit),
      dynamicMightModifier(game, battlefield, unit, role),
      ...combatRoleMightModifiers(game, unit, role, battlefield)
    ],
    minimum: minimumMightFromStaticEffects(game, battlefield, unit)
  });
}

function combatRoleMightModifiers(game, unit, role, battlefield = findUnitLocation(game, unit.instanceId)?.battlefield) {
  const modifiers = [];
  if (role === "attacker" && hasKeyword(unit, "Assault", game)) {
    modifiers.push(keywordAmount(unit, "Assault", 1, game));
  }
  if (role === "defender" && (hasKeyword(unit, "Shield", game) || hasStaticEffect(unit, "shield"))) {
    modifiers.push(keywordAmount(unit, "Shield", 1, game)
      + staticEffectAmountTotal(unit, "shield", 0)
      + (unit.temporaryKeywordAmounts?.shield == null ? (unit.temporaryShieldAmount || 0) : 0));
  }
  const controller = game.players.find((player) => player.id === unit.controllerId);
  const allies = battlefield?.units.filter((candidate) => candidate.controllerId === unit.controllerId) || [];
  if (role === "defender" && allies.length === 1 && hasStaticEffect(controller?.legend, "defendAloneMight")) {
    modifiers.push(staticEffectAmount(controller.legend, "defendAloneMight", 2));
  }
  return modifiers;
}

function dynamicMightModifier(game, battlefield, unit, combatRole = unit.combatRole) {
  let amount = 0;
  const controller = game.players.find((player) => player.id === unit.controllerId);
  const location = findUnitLocation(game, unit.instanceId);
  const nearbyUnits = location?.type === "battlefield"
    ? location.battlefield.units
    : location?.type === "base"
      ? location.player.base.filter((card) => card.type === "unit")
      : [];
  if (hasStaticEffect(unit, "selfMightByPoints")) amount += controller?.score || 0;
  if (hasStaticEffect(unit, "selfMightByTrash")) amount += controller?.trash?.length || 0;
  for (const effect of cardEffects(unit, "static").filter((candidate) => candidate.kind === "runeThresholdMight")) {
    if ((controller?.runes?.length || 0) >= (effect.threshold || 8)) amount += effect.amount || 0;
  }
  if (hasStaticEffect(unit, "selfMightWhileBuffed") && (unit.buffs || 0) > 0) amount += staticEffectAmount(unit, "selfMightWhileBuffed", 1);
  if (hasStaticEffect(unit, "selfMightWhileAloneCombat") && combatRole && (battlefield?.units || []).filter((candidate) => candidate.controllerId === unit.controllerId).length === 1) {
    amount += staticEffectAmount(unit, "selfMightWhileAloneCombat", 1);
  }
  if (hasStaticEffect(unit, "selfMightByBuffedFriendlyHere")) {
    amount += nearbyUnits.filter((candidate) => candidate.controllerId === unit.controllerId && (candidate.buffs || 0) > 0).length
      * staticEffectAmount(unit, "selfMightByBuffedFriendlyHere", 1);
  }
  for (const source of nearbyUnits) {
    if (source.controllerId !== unit.controllerId || source.instanceId === unit.instanceId) continue;
    if (hasStaticEffect(source, "otherFriendlyHereMight")) amount += staticEffectAmount(source, "otherFriendlyHereMight", 1);
    if (hasStaticEffect(source, "otherBuffedFriendlyHereMight") && (unit.buffs || 0) > 0) {
      amount += staticEffectAmount(source, "otherBuffedFriendlyHereMight", 1);
    }
  }
  if (hasStaticEffect(battlefield, "unitsHereMight")) amount += staticEffectAmount(battlefield, "unitsHereMight", 1);
  for (const effect of cardEffects(battlefield, "static")) {
    if (effect.kind !== "taggedUnitsHereMight") continue;
    if ((effect.tags || []).some((tag) => unit.tags?.includes(tag))) amount += effect.amount || 1;
  }
  for (const source of nearbyUnits) {
    if (source.controllerId === unit.controllerId) continue;
    if (unit.stunned && hasStaticEffect(source, "stunnedEnemyHereMight")) {
      amount += staticEffectAmount(source, "stunnedEnemyHereMight", -8);
    }
  }
  return amount;
}

function stunUnit(game, player, source, unit) {
  const wasStunned = Boolean(unit.stunned);
  unit.stunned = true;
  if (!wasStunned) {
    requestCleanup(game, "object-status-change", {
      objectId: unit.instanceId,
      status: "stunned"
    });
  }
  if (!wasStunned && unit.controllerId !== player.id) {
    triggerStunEffects(game, player, unit, source);
  }
}

function triggerStunEffects(game, player, stunnedUnit, source) {
  const triggers = [];
  for (const card of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(card, "stun")) {
      if (effect.kind === "readySelfMight") {
        triggers.push({
          kind: "stunReadySelfMight",
          playerId: player.id,
          sourceCardId: card.instanceId,
          data: {
            amount: effect.amount || 1,
            temporary: isTemporaryMightEffect(card, effect),
            stunnedUnitId: stunnedUnit.instanceId,
            sourceCardId: source?.instanceId || null
          }
        });
      }
      if (effect.kind === "buffFriendlyUnit") {
        triggers.push({
          kind: "stunBuffFriendlyUnit",
          playerId: player.id,
          sourceCardId: card.instanceId,
          data: {
            amount: effect.amount || 1,
            stunnedUnitId: stunnedUnit.instanceId,
            sourceCardId: source?.instanceId || null
          }
        });
      }
    }
  }
  if (!triggers.length) return false;
  return prepareAndQueueTriggers(game, triggers, game.phase === "showdown" && game.showdown ? "showdownChain" : "queue");
}

function triggerEnemyKilledEffects(game, killedUnit) {
  const triggers = collectEnemyKilledTriggers(game, killedUnit);
  if (!triggers.length) return false;
  return prepareAndQueueTriggers(game, triggers, game.phase === "showdown" && game.showdown ? "showdownChain" : "queue");
}

function collectEnemyKilledTriggers(game, killedUnit) {
  if (!killedUnit.stunned) return [];
  const triggers = [];
  for (const player of game.players) {
    if (player.id === killedUnit.controllerId) continue;
    for (const card of allControlledCards(game, player.id)) {
      for (const effect of cardEffects(card, "enemyKilled")) {
        if (effect.kind !== "drawIfStunned") continue;
        if (effect.exhaust && card.exhausted) continue;
        triggers.push({
          kind: "enemyKilledStunnedDraw",
          playerId: player.id,
          sourceCardId: card.instanceId,
          data: {
            amount: effect.amount || 1,
            exhaust: effect.exhaust !== false,
            killedUnitId: killedUnit.instanceId
          }
        });
      }
    }
  }
  return triggers;
}

function deathReplacementCandidates(game, unit) {
  const controller = game.players.find((player) => player.id === unit.controllerId);
  const candidates = [];
  if (controller && unit.saveWithRuneUntilTurnSequence === (game.turnSequence || 0)) {
    const domain = unit.saveWithRuneDomain;
    if (!domain || payAdditionalPower(game, controller, { domain, amount: 1 }, true)) {
      candidates.push({
        key: `prepared:${unit.instanceId}`,
        type: "prepared",
        sourceCard: unit,
        optional: true,
        label: unit.saveWithRuneSourceName || "Prepared death replacement"
      });
    }
  }
  for (const sourceCard of allControlledCards(game, unit.controllerId)) {
    if (replacementEffect(sourceCard, "saveFriendlyUnitByKillingThis")) {
      candidates.push({
        key: `card:${sourceCard.instanceId}`,
        type: "card",
        sourceCard,
        optional: false,
        label: sourceCard.name
      });
    }
    if (canSettSaveBuffedUnit(game, controller, sourceCard, unit)) {
      candidates.push({
        key: `card:${sourceCard.instanceId}`,
        type: "card",
        sourceCard,
        optional: true,
        label: sourceCard.name
      });
    }
  }
  return candidates;
}

function promptDeathReplacementSource(game, unit, candidates, explicitDeathContinuation = null, replacementEvent = null) {
  const chooserId = candidates.length > 1
    ? unit.ownerId
    : candidates[0]?.sourceCard?.controllerId;
  const chooser = game.players.find((player) => player.id === chooserId)
    || game.players.find((player) => player.id === unit.ownerId);
  if (!chooser) return false;
  game.currentPlayerId = chooser.id;
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: chooser.id,
    card: unit,
    effect: "deathReplacementSource",
    prompt: `Choose which replacement effect applies first to ${unit.name}'s death.`,
    options: [
      ...candidates.map((candidate) => ({
        id: candidate.key,
        label: candidate.label,
        cardId: candidate.sourceCard?.instanceId || null
      })),
      ...(candidates.every((candidate) => candidate.optional)
        ? [{ id: "decline", label: "Do not replace this death", cardId: unit.instanceId }]
        : [])
    ],
    data: {
      unitId: unit.instanceId,
      ...(replacementEvent ? { replacementEvent: structuredClone(replacementEvent) } : {})
    },
    ...(explicitDeathContinuation ? { explicitDeathContinuation } : {}),
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  log(game, `${chooser.name} chooses a replacement effect for ${unit.name}.`);
  return true;
}

function promptSimultaneousDeathReplacementEvent(game, replacement, units) {
  const chooser = game.players.find((player) => player.id === replacement.sourceCard.controllerId);
  if (!chooser) return false;
  game.currentPlayerId = chooser.id;
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: chooser.id,
    card: replacement.sourceCard,
    effect: "deathReplacementEvent",
    prompt: `Choose which simultaneous death ${replacement.sourceCard.name} applies to first.`,
    options: [
      ...units.map((unit) => ({
        id: unit.instanceId,
        label: unit.name,
        cardId: unit.instanceId
      })),
      ...(replacement.optional
        ? [{ id: "decline", label: "Do not apply this replacement effect", cardId: null }]
        : [])
    ],
    data: { replacementKey: replacement.key },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  log(game, `${chooser.name} orders ${replacement.sourceCard.name} across simultaneous deaths.`);
  return true;
}

function maybePromptSimultaneousDeathReplacement(game, units, candidateSnapshots = null) {
  if (!game.interactive || game.pendingChoice || game.deathReplacementPreference || units.length < 2) return false;
  const byReplacement = new Map();
  for (const unit of units) {
    const candidates = candidateSnapshots?.[unit.instanceId] || deathReplacementCandidates(game, unit);
    for (const candidate of candidates.filter((entry) => entry.type === "card")) {
      if (!byReplacement.has(candidate.key)) byReplacement.set(candidate.key, { candidate, units: [] });
      byReplacement.get(candidate.key).units.push(unit);
    }
  }
  const conflict = [...byReplacement.values()].find((entry) => entry.units.length > 1);
  return conflict ? promptSimultaneousDeathReplacementEvent(game, conflict.candidate, conflict.units) : false;
}

function resolveDeathReplacementSourceChoice({ game, choice, option }) {
  game.deathReplacementPreference = option.id === "decline"
    ? { kind: "decline", unitId: choice.data?.unitId }
    : { kind: "source", unitId: choice.data?.unitId, replacementKey: option.id };
  if (!choice.explicitDeathContinuation) return;
  const unit = findCard(game, choice.data?.unitId);
  const location = unit ? findUnitLocation(game, unit.instanceId) : null;
  if (!unit || !location) return continueExplicitDeathContinuation(game, choice.explicitDeathContinuation);
  killUnit(game, unit,
    {
      ...(location.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location),
      ...(choice.data?.replacementEvent ? { replacementEvent: choice.data.replacementEvent } : {})
    },
    choice.explicitDeathContinuation);
  continueExplicitDeathContinuation(game, choice.explicitDeathContinuation);
}

function resolveDeathReplacementEventChoice({ game, choice, option }) {
  game.deathReplacementPreference = option.id === "decline"
    ? { kind: "declineEvent", replacementKey: choice.data?.replacementKey }
    : {
      kind: "event",
      unitId: option.cardId,
      replacementKey: choice.data?.replacementKey
    };
}

function createDeathReplacementEvent(game, unit, source) {
  if (source?.replacementEvent) return source.replacementEvent;
  game.nextReplacementEventSequence = (game.nextReplacementEventSequence || 0) + 1;
  return {
    rootEventId: `replacement-event-${game.nextReplacementEventSequence}`,
    eventId: `replacement-event-${game.nextReplacementEventSequence}`,
    kind: "unitDeath",
    affectedObjectId: unit.instanceId,
    appliedReplacementKeys: [],
    modifications: structuredClone(source?.eventModifications || {})
  };
}

function replacementChildEvent(game, event, replacementKey, affectedObjectId) {
  game.nextReplacementEventSequence = (game.nextReplacementEventSequence || 0) + 1;
  return {
    ...structuredClone(event),
    eventId: `replacement-event-${game.nextReplacementEventSequence}`,
    affectedObjectId,
    appliedReplacementKeys: [...new Set([...(event.appliedReplacementKeys || []), replacementKey])],
    modifications: structuredClone(event.modifications || {})
  };
}

function replacementCandidateStillActive(game, candidate) {
  if (candidate.type === "prepared") return Boolean(findUnitLocation(game, candidate.sourceCard?.instanceId));
  const location = findActiveCardLocation(game, candidate.sourceCard?.instanceId);
  return Boolean(location?.card && location.card.controllerId === candidate.sourceCard.controllerId);
}

function resolveUnitDeathReplacement(game, unit, source, explicitDeathContinuation = null, candidateSnapshot = null) {
  const owner = game.players.find((player) => player.id === unit.ownerId);
  const controller = game.players.find((player) => player.id === unit.controllerId);
  const preference = game.deathReplacementPreference;
  const replacementEvent = createDeathReplacementEvent(game, unit, source);
  const alreadyApplied = new Set(replacementEvent.appliedReplacementKeys || []);
  let replacements = (candidateSnapshot || deathReplacementCandidates(game, unit))
    .filter((candidate) => !alreadyApplied.has(candidate.key) && replacementCandidateStillActive(game, candidate));
  if (preference?.kind === "event" && preference.unitId !== unit.instanceId) {
    replacements = replacements.filter((candidate) => candidate.key !== preference.replacementKey);
  }
  if (preference?.kind === "declineEvent") {
    replacements = replacements.filter((candidate) => candidate.key !== preference.replacementKey);
  }
  if (preference?.kind === "source" && preference.unitId === unit.instanceId) {
    replacements = replacements.filter((candidate) => candidate.key === preference.replacementKey);
  }
  if (preference?.kind === "decline" && preference.unitId === unit.instanceId) {
    replacements = replacements.filter((candidate) => !candidate.optional);
  }
  const selectedByPreference = (preference?.kind === "source" || preference?.kind === "event")
    && preference.unitId === unit.instanceId
    && replacements.some((candidate) => candidate.key === preference.replacementKey);
  const needsChoice = replacements.length > 1
    || (replacements.length === 1 && replacements[0].optional && replacements[0].type === "card");
  if (game.interactive && needsChoice && !selectedByPreference) {
    promptDeathReplacementSource(game, unit, replacements, explicitDeathContinuation, replacementEvent);
    return { proceed: false, pending: true };
  }
  const replacement = replacements[0];
  if (preference?.unitId === unit.instanceId && !replacement) delete game.deathReplacementPreference;
  if (replacement?.type === "prepared") {
    const replaced = replacePreparedDeathWithRecall(game, controller, unit, source, explicitDeathContinuation);
    if (!game.pendingChoice || !findUnitLocation(game, unit.instanceId)) delete game.deathReplacementPreference;
    if (replaced) return { proceed: false, pending: Boolean(game.pendingChoice), replaced: !game.pendingChoice };
  }
  if (replacement?.type === "card") {
    delete game.deathReplacementPreference;
    const result = resolveReplacementEffect(game, replacement, unit, source, replacementEvent, explicitDeathContinuation);
    return { proceed: false, pending: Boolean(result?.pending), replaced: !result?.pending };
  }

  return { proceed: true, owner, controller };
}

function captureUnitDeath(game, unit, source, owner, controller) {
  if (!owner || !controller) return null;

  const diedAlone = typeof source?.diedAloneOverride === "boolean"
    ? source.diedAloneOverride
    : source?.type === "battlefield"
      ? source.battlefield.units.filter((candidate) => candidate.controllerId === unit.controllerId && candidate.instanceId !== unit.instanceId).length === 0
      : controller.base.filter((candidate) => candidate.type === "unit" && candidate.instanceId !== unit.instanceId).length === 0;
  unit.lastKnownBattlefieldId = source?.type === "battlefield" ? source.battlefield.instanceId : null;
  const deathSnapshot = structuredClone(unit);
  return { unit, source, owner, controller, diedAlone, deathSnapshot };
}

function moveKilledUnitToTrash(game, record) {
  const { unit, source, owner, controller, deathSnapshot } = record;
  removeUnitEverywhere(game, unit.instanceId);
  requestCleanup(game, "board-zone-change", { objectId: unit.instanceId, change: "left-board" });
  detachAttachmentsToBase(game, unit, source);
  delete unit.combatRole;
  if (!isTokenCard(unit)) owner.trash.push(unit);
  for (const candidate of game.players) {
    if (candidate.id !== unit.controllerId) candidate.enemyUnitsDiedThisTurn = (candidate.enemyUnitsDiedThisTurn || 0) + 1;
  }
  log(game, `${unit.name} is killed.`);
  clearBoardState(game, unit);
  unit.controllerId = owner.id;
  return deathSnapshot;
}

function killUnit(game, unit, source, explicitDeathContinuation = null) {
  const replacement = resolveUnitDeathReplacement(game, unit, source, explicitDeathContinuation);
  if (!replacement.proceed) return false;
  const record = captureUnitDeath(game, unit, source, replacement.owner, replacement.controller);
  if (!record) return false;
  const deathknellTriggers = collectDeathknellTriggers(game, record.owner, record.deathSnapshot, record.diedAlone);
  moveKilledUnitToTrash(game, record);
  const postDeathTriggers = collectPostDeathTriggers(game, record.owner, record.deathSnapshot);
  queueDeathTriggers(game, [...deathknellTriggers, ...postDeathTriggers]);
  return true;
}

function collectSpellKillPlayFromTrashTriggers(game, killedUnit) {
  const event = killedUnit.lastDamageEvent;
  if (event?.origin !== "spell" || !event.sourcePlayerId) return [];
  const player = game.players.find((candidate) => candidate.id === event.sourcePlayerId);
  if (!player) return [];
  return player.trash.flatMap((source) => cardEffects(source, "static")
    .filter((effect) => effect.kind === "playSelfFromTrashWhenSpellKillsUnit")
    .map((effect) => ({
      kind: "playSelfFromTrashPayPower",
      playerId: player.id,
      sourceCardId: source.instanceId,
      data: { domain: effect.domain || "Any", killedUnitId: killedUnit.instanceId, sourceCardId: event.sourceCardId }
    })));
}

function replacePreparedDeathWithRecall(game, controller, unit, source, explicitDeathContinuation = null) {
  if (!controller || unit.saveWithRuneUntilTurnSequence !== (game.turnSequence || 0)) return false;
  const domain = unit.saveWithRuneDomain;
  if (domain && !payAdditionalPower(game, controller, { domain, amount: 1 }, true)) {
    clearPreparedDeathRecall(unit);
    return false;
  }
  if (domain && !unit.preparedDeathRecallPaymentApproved && game.interactive) {
    const resolvingChoice = game.resolvingChoiceContext;
    game.pendingChoice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: controller.id,
      card: resolvingChoice?.card || unit,
      effect: "preparedDeathRecallPayment",
      prompt: `${unit.saveWithRuneSourceName || "Prepared effect"}: pay ${domain} Power to recall ${unit.name} instead of letting it die?`,
      options: [
        { id: "pay-death-recall", label: `Pay 1 ${domain} Power`, cardId: unit.instanceId },
        { id: "decline-death-recall", label: "Let the unit die", cardId: unit.instanceId }
      ],
      optional: false,
      finishSpell: explicitDeathContinuation ? false : Boolean(resolvingChoice?.finishSpell),
      fromShowdownChain: Boolean(resolvingChoice?.fromShowdownChain),
      data: {
        domain,
        resumeCleanup: Boolean(game.inCleanup)
      },
      ...(explicitDeathContinuation ? { explicitDeathContinuation } : {})
    };
    return true;
  }
  if (domain) payAdditionalPower(game, controller, { domain, amount: 1 });
  const sourceName = unit.saveWithRuneSourceName || "A prepared effect";
  recallUnit(game, unit, { heal: true, exhausted: true });
  clearPreparedDeathRecall(unit);
  log(game, `${sourceName} replaces ${unit.name}'s death and recalls it exhausted.`);
  return true;
}

function clearPreparedDeathRecall(unit) {
  delete unit.saveWithRuneUntilTurnSequence;
  delete unit.saveWithRuneDomain;
  delete unit.saveWithRuneSourceName;
  delete unit.preparedDeathRecallPaymentApproved;
}

function killGear(game, gear, source = null) {
  const owner = game.players.find((player) => player.id === gear.ownerId);
  if (!owner) return;
  const deathSnapshot = structuredClone(gear);
  const deathknellTriggers = collectDeathknellTriggers(game, owner, deathSnapshot, false);
  removeGearEverywhere(game, gear.instanceId);
  if (!isTokenCard(gear)) owner.trash.push(gear);
  log(game, `${gear.name} is killed.`);
  clearBoardState(game, gear);
  gear.controllerId = owner.id;
  queueDeathTriggers(game, [
    ...deathknellTriggers,
    ...collectPostDeathTriggers(game, owner, deathSnapshot)
  ]);
}

function resolveReplacementEffect(game, replacement, unit, source, replacementEvent, explicitDeathContinuation = null) {
  const sourceCard = replacement.sourceCard;
  const controller = game.players.find((player) => player.id === unit.controllerId);
  if (!controller) return { pending: false };
  if (replacementEffect(sourceCard, "saveFriendlyUnitByKillingThis")) {
    const childEvent = replacementChildEvent(game, replacementEvent, replacement.key, sourceCard.instanceId);
    const continuation = {
      kind: "completeDeathSaveReplacement",
      savedUnitId: unit.instanceId,
      replacementSourceCardId: sourceCard.instanceId,
      replacementSourceSnapshot: structuredClone(sourceCard),
      replacementEvent: childEvent,
      afterSaveContinuation: null,
      completed: false
    };
    const sourceLocation = sourceCard.type === "unit" ? findUnitLocation(game, sourceCard.instanceId) : null;
    if (sourceLocation) {
      killUnit(game, sourceCard, {
        ...(sourceLocation.type === "battlefield"
          ? { type: "battlefield", battlefield: sourceLocation.battlefield }
          : sourceLocation),
        replacementEvent: childEvent
      }, continuation);
      if (game.pendingChoice || game.pendingPayment) {
        continuation.afterSaveContinuation = explicitDeathContinuation;
        return { pending: true };
      }
    } else {
      killGear(game, sourceCard, source);
    }
    completeDeathSaveReplacement(game, continuation);
    return { pending: false };
  }
  if (replacementEffect(sourceCard, "saveBuffedFriendlyUnitBySett") && canSettSaveBuffedUnit(game, controller, sourceCard, unit)) {
    payAdditionalPower(game, controller, { domain: "Any", amount: 1 });
    unit.buffs = Math.max(0, (unit.buffs || 0) - 1);
    exhaustCards(game, controller, sourceCard, [sourceCard], { reason: "replacement-cost", cost: true });
    recallUnit(game, unit, { heal: true, exhausted: true });
    log(game, `${sourceCard.name} spends ${unit.name}'s buff and recalls it instead of letting it die.`);
    markEffect(game, sourceCard, [sourceCard.instanceId, unit.instanceId], `${sourceCard.name} saves ${unit.name}.`);
  }
  return { pending: false };
}

function completeDeathSaveReplacement(game, continuation) {
  if (!continuation || continuation.completed) return false;
  continuation.completed = true;
  const unit = findCard(game, continuation.savedUnitId);
  const location = unit ? findUnitLocation(game, unit.instanceId) : null;
  const sourceCard = findCard(game, continuation.replacementSourceCardId)
    || continuation.replacementSourceSnapshot;
  if (unit && location) {
    recallUnit(game, unit, { heal: true, exhausted: true });
    applyInheritedReplacementModifications(unit, continuation.replacementEvent?.modifications);
    unit.lastReplacementEvent = structuredClone(continuation.replacementEvent);
    log(game, `${sourceCard.name} replaces ${unit.name}'s death and recalls it exhausted.`);
    markEffect(game, sourceCard, [sourceCard.instanceId, unit.instanceId], `${sourceCard.name} saves ${unit.name}.`);
  }
  if (continuation.afterSaveContinuation) {
    const next = continuation.afterSaveContinuation;
    continuation.afterSaveContinuation = null;
    continueExplicitDeathContinuation(game, next);
  }
  return Boolean(unit && location);
}

function applyInheritedReplacementModifications(unit, modifications = {}) {
  if (!unit || !modifications || typeof modifications !== "object") return;
  if (modifications.ready === true) unit.exhausted = false;
  if (modifications.exhausted === true) unit.exhausted = true;
  if (modifications.temporary === true) unit.temporary = true;
}

function canSettSaveBuffedUnit(game, controller, sourceCard, unit) {
  if (!controller || !sourceCard || !unit) return false;
  if (!replacementEffect(sourceCard, "saveBuffedFriendlyUnitBySett")) return false;
  if (sourceCard.exhausted) return false;
  if (unit.controllerId !== controller.id) return false;
  if ((unit.buffs || 0) <= 0) return false;
  return payAdditionalPower(game, controller, { domain: "Any", amount: 1 }, true);
}

function collectDeathknellTriggers(game, owner, unit, diedAlone) {
  const triggers = [];
  const controller = game.players.find((player) => player.id === unit.controllerId) || owner;
  for (const effect of cardEffects(unit, "death")) {
    if (effect.kind === "draw") {
      triggers.push({
        kind: "deathDraw",
        playerId: controller.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.amount || 1, exhausted: effect.exhausted !== false }
      });
    }
    if (effect.kind === "drawIfAlone" && diedAlone) {
      triggers.push({
        kind: "deathDrawIfAlone",
        playerId: controller.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.draw || 1 }
      });
    }
    if (effect.kind === "channelRunes") {
      triggers.push({
        kind: "deathChannelRunes",
        playerId: controller.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.amount || 1 }
      });
    }
    if (effect.kind === "discardDraw") {
      triggers.push({
        kind: "deathDiscardDraw",
        playerId: controller.id,
        sourceCardId: unit.instanceId,
        data: { discard: effect.discard || 0, draw: effect.draw || 0 }
      });
    }
    if (effect.kind === "dealDamageAllHere") {
      triggers.push({
        kind: "deathDealDamageAllHere",
        playerId: controller.id,
        sourceCardId: unit.instanceId,
        data: {
          amount: effect.amount || 0,
          battlefieldId: unit.lastKnownBattlefieldId || null
        }
      });
    }
    if (effect.kind === "playUnitToken") {
      triggers.push({
        kind: "deathPlayUnitToken",
        playerId: controller.id,
        sourceCardId: unit.instanceId,
        data: {
          tokenCardNumber: effect.tokenCardNumber,
          count: effect.count || 1,
          ready: Boolean(effect.ready),
          destination: effect.destination || "base"
        }
      });
    }
    if (effect.kind === "gainXp") {
      triggers.push({
        kind: "deathGainXp",
        playerId: controller.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.amount || 1 }
      });
    }
    if (effect.kind === "revealOpponentHand") {
      triggers.push({
        kind: "deathRevealOpponentHand",
        playerId: controller.id,
        sourceCardId: unit.instanceId
      });
    }
    if (effect.kind === "recycleSelfReadyRunes") {
      triggers.push({
        kind: "deathRecycleSelfReadyRunes",
        playerId: controller.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.amount || 999, readyAll: Boolean(effect.readyAll) }
      });
    }
  }
  for (const trigger of triggers) {
    trigger.sourceCardSnapshot = structuredClone(unit);
  }
  if (triggers.length && controller && allControlledCards(game, controller.id)
    .some((source) => source.instanceId !== unit.instanceId && hasStaticEffect(source, "deathTriggersAdditionalTime"))) {
    triggers.push(...triggers.map((trigger) => structuredClone(trigger)));
    log(game, `${controller.name}'s deathknell triggers an additional time.`);
  }
  return triggers;
}

function collectPostDeathTriggers(game, owner, unit) {
  const triggers = [
    ...collectSpellKillPlayFromTrashTriggers(game, unit),
    ...collectEnemyKilledTriggers(game, unit)
  ];
  const controller = game.players.find((player) => player.id === unit.controllerId) || owner;
  if (unit.type === "unit" && controller && !controller.firstOtherFriendlyUnitDeathDrawnThisTurn) {
    for (const source of allControlledCards(game, controller.id)) {
      if (source.instanceId === unit.instanceId) continue;
      for (const effect of cardEffects(source, "death")) {
        if (effect.kind !== "drawOnFirstOtherFriendlyUnitDeath") continue;
        controller.firstOtherFriendlyUnitDeathDrawnThisTurn = true;
        triggers.push({
          kind: "deathDraw",
          playerId: controller.id,
          sourceCardId: source.instanceId,
          data: { amount: effect.amount || 1 }
        });
        break;
      }
      if (controller.firstOtherFriendlyUnitDeathDrawnThisTurn) break;
    }
  }
  if (unit.type === "unit" && controller && !(unit.tags || []).includes("Recruit")) {
    for (const source of allControlledCards(game, controller.id)) {
      if (source.instanceId === unit.instanceId) continue;
      for (const effect of cardEffects(source, "death")) {
        if (effect.kind !== "playRecruitOnOtherFriendlyNonRecruitDeath") continue;
        triggers.push({
          kind: "deathPlayUnitToken",
          playerId: controller.id,
          sourceCardId: source.instanceId,
          data: {
            tokenCardNumber: effect.tokenCardNumber || "OGN-273/298",
            count: effect.count || 1,
            ready: Boolean(effect.ready),
            destination: effect.destination || "base"
          }
        });
      }
    }
  }
  if (unit.type === "unit" && controller && (unit.buffs || 0) > 0) {
    for (const source of allControlledCards(game, controller.id)) {
      if (source.instanceId === unit.instanceId) continue;
      for (const effect of cardEffects(source, "death")) {
        if (effect.kind !== "buffAnotherFriendlyOnBuffedUnitDeath") continue;
        triggers.push({
          kind: "deathBuffAnotherFriendlyOnBuffedUnitDeath",
          playerId: controller.id,
          sourceCardId: source.instanceId,
          data: {
            amount: effect.amount || 1,
            deadUnitId: unit.instanceId
          }
        });
      }
    }
  }
  return triggers;
}

function queueDeathTriggers(game, triggers) {
  if (!triggers.length) return false;
  const mode = game.phase === "showdown" && game.showdown
    ? "showdownChain"
    : game.phase === "action" && game.interactive ? "actionChain" : "queue";
  return prepareAndQueueTriggers(game, triggers, mode);
}

function detachAttachmentsToBase(game, unit, source) {
  if (!unit.attachments?.length) return false;
  let changed = false;
  for (const gear of [...unit.attachments]) {
    changed = detachAttachmentFromTopMost(game, unit, gear, { placeAtLocation: true, sourceLocation: source }) || changed;
  }
  return changed;
}

function detachAttachmentFromTopMost(game, topMost, attached, options = {}) {
  if (!topMost || !attached || !(topMost.attachments || []).some((card) => card.instanceId === attached.instanceId)) return false;
  const location = options.sourceLocation || findUnitLocation(game, topMost.instanceId);
  const controller = game.players.find((player) => player.id === attached.controllerId)
    || game.players.find((player) => player.id === attached.ownerId);
  topMost.attachments = topMost.attachments.filter((card) => card.instanceId !== attached.instanceId);
  delete attached.attachedToId;
  syncTopMostAttachmentEffects(topMost);

  let destinationType = location?.type || null;
  let destinationId = location?.type === "battlefield" ? location.battlefield.instanceId : location?.player?.id || controller?.id || null;
  if (options.placeAtLocation && controller) {
    const destination = location?.type === "battlefield"
      ? location.battlefield.units
      : location?.type === "base" ? location.player.base : controller.base;
    if (!destination.some((card) => card.instanceId === attached.instanceId)) destination.push(attached);
    destinationType = location?.type === "battlefield" ? "battlefield" : "base";
    destinationId = location?.type === "battlefield" ? location.battlefield.instanceId : location?.player?.id || controller.id;
  }

  game.attachmentEventSequence = (game.attachmentEventSequence || 0) + 1;
  game.attachmentEvents ||= [];
  game.attachmentEvents.push({
    id: `attachment-${game.attachmentEventSequence}`,
    action: "detach",
    attachedCardId: attached.instanceId,
    topMostCardId: topMost.instanceId,
    destinationType,
    destinationId,
    turnSequence: game.turnSequence || 0
  });
  const locationName = location?.type === "battlefield" ? location.battlefield?.name : "base";
  log(game, `${attached.name} detaches from ${topMost.name} at ${locationName}.`);
  return true;
}

function recallUnit(game, unit, options = {}) {
  const source = findUnitLocation(game, unit.instanceId);
  const controller = game.players.find((player) => player.id === unit.controllerId);
  if (!source || !controller) return false;
  if (options.heal) healUnits(game, [unit], { reason: "death-replacement" });
  if (options.exhausted === true) exhaustCards(game, controller, options.source || null, [unit], {
    responsiblePlayerId: options.responsiblePlayerId,
    reason: "death-replacement"
  });
  removeUnitFromSource(source);
  controller.base.push(unit);
  updateBattlefieldControl(game);
  return true;
}

function healUnits(game, units, { reason = "effect" } = {}) {
  const records = [...new Map((units || [])
    .filter((unit) => unit && (unit.damage || 0) > 0)
    .map((unit) => [unit.instanceId, { unit, amount: unit.damage || 0 }])).values()];
  if (!records.length) return 0;
  game.healEventSequence = (game.healEventSequence || 0) + 1;
  const event = {
    id: `heal-${game.healEventSequence}`,
    unitIds: records.map(({ unit }) => unit.instanceId),
    amounts: Object.fromEntries(records.map(({ unit, amount }) => [unit.instanceId, amount])),
    reason,
    turnSequence: game.turnSequence || 0
  };
  for (const { unit } of records) unit.damage = 0;
  game.healEvents ||= [];
  game.healEvents.push(event);
  return records.length;
}

function clearBoardState(game, card) {
  markNonBoardZoneChange(card);
  card.exhausted = false;
  healUnits(game, [card], { reason: "left-board" });
  card.stunned = false;
  card.buffs = 0;
  card.mightModifier = 0;
  delete card.cantMoveThisTurn;
  delete card.temporary;
  delete card.playedFromHidden;
  delete card.hiddenBattlefieldId;
  delete card.declaredPlayTargets;
  delete card.declaredTargetIdentities;
  delete card.declaredPlayChoices;
  delete card.playResolutionTargets;
  delete card.playResolutionChoices;
  delete card.deflectPaidTargetIds;
  delete card.paidOptionalPowerEffects;
  delete card.paidFriendlyExhaustAdditionalCost;
  delete card.temporaryKeywords;
  delete card.temporaryKeywordAmounts;
  delete card.temporaryShieldAmount;
  delete card.combatRole;
  delete card.combatTriggerChecks;
  delete card.lastKnownBattlefieldId;
  delete card.lastDamageEvent;
  delete card.damagePreventions;
  delete card.lastReplacementEvent;
  delete card.saveWithRuneUntilTurnSequence;
  delete card.saveWithRuneDomain;
  delete card.saveWithRuneSourceName;
  delete card.preparedDeathRecallPaymentApproved;
  delete card.resolvingFromChain;
  delete card.chainResolutionZoneChangeCounter;
}

function markNonBoardZoneChange(card) {
  if (!card) return;
  card.zoneChangeCounter = (card.zoneChangeCounter || 0) + 1;
}

function beginChainCardResolution(card) {
  card.resolvingFromChain = true;
  card.chainResolutionZoneChangeCounter = card.zoneChangeCounter || 0;
}

function chainCardLeftDuringResolution(card) {
  return Boolean(card?.resolvingFromChain
    && (card.zoneChangeCounter || 0) !== (card.chainResolutionZoneChangeCounter || 0));
}

function stopChainCardResolution(game, card) {
  delete card.resolvingFromChain;
  delete card.chainResolutionZoneChangeCounter;
  log(game, `${card.name} left the Chain, so its remaining instructions do not resolve.`);
}

function isTokenCard(card) {
  return Boolean(card?.isToken || (card?.tags || []).some((tag) => String(tag).toLowerCase() === "token"));
}

function removeUnitEverywhere(game, unitId) {
  restoreGearControlledBySource(game, unitId);
  for (const player of game.players) {
    player.base = player.base.filter((unit) => unit.instanceId !== unitId);
  }
  for (const field of game.battlefields) {
    field.units = field.units.filter((unit) => unit.instanceId !== unitId);
  }
}

function restoreGearControlledBySource(game, sourceUnitId) {
  const controlledGear = [
    ...game.players.flatMap((player) => player.base),
    ...allUnits(game).flatMap((unit) => unit.attachments || [])
  ].filter((gear) => gear.temporaryControlSourceId === sourceUnitId);
  for (const gear of controlledGear) {
    const restoredControllerId = gear.controllerBeforeTemporaryControlId || gear.ownerId;
    const restoredController = game.players.find((player) => player.id === restoredControllerId)
      || game.players.find((player) => player.id === gear.ownerId);
    removeGearEverywhere(game, gear.instanceId);
    delete gear.temporaryControlSourceId;
    delete gear.controllerBeforeTemporaryControlId;
    gear.controllerId = restoredController?.id || gear.ownerId;
    restoredController?.base.push(gear);
    log(game, `${gear.name} returns to ${restoredController?.name || "its owner"}'s base.`);
  }
}

function removeGearEverywhere(game, gearId) {
  for (const player of game.players) {
    player.base = player.base.filter((card) => card.instanceId !== gearId);
  }
  for (const unit of allUnits(game)) {
    const removed = (unit.attachments || []).find((card) => card.instanceId === gearId);
    if (removed) detachAttachmentFromTopMost(game, unit, removed);
  }
  for (const battlefield of game.battlefields) {
    battlefield.units = battlefield.units.filter((card) => card.instanceId !== gearId);
  }
}

function syncTopMostAttachmentEffects(card) {
  if (!card) return;
  const appended = (card.attachments || []).flatMap((attachment) =>
    (attachment.effects || [])
      .filter((effect) => effect.textSection === "effect")
      .map((effect) => ({
        ...structuredClone(effect),
        textSection: "appended",
        appendedFromCardId: attachment.instanceId,
        appendedFromCardName: attachment.name
      })));
  if (appended.length) card.appendedEffects = appended;
  else delete card.appendedEffects;
}

export function effectiveMight(unit) {
  return resolveLayeredNumber({
    printed: unit.might || 0,
    assignment: unit.assignedMight,
    modifiers: intrinsicMightModifiers(unit),
    minimum: 0
  });
}

function printedMight(card) {
  return card?.might || 0;
}

function intrinsicMightModifiers(unit) {
  return [
    unit.buffs || 0,
    unit.mightModifier || 0,
    ...(unit.attachments || []).map((gear) => (gear.effects || [])
      .filter((effect) => effect.timing === "static"
        && effect.kind === "attachedMight"
        && effect.textSection === "mightBonus"
        && effectIsEnabledByMutation(effect))
      .reduce((total, effect) => total + (Number(effect.amount) || 0), 0))
  ];
}

function activeSpellChain(game) {
  return game.showdown?.chain || game.actionChain?.chain || [];
}

function isLethalDamage(game, unit) {
  return unit.damage > 0 && unit.damage >= currentMight(game, unit);
}

export function currentMight(game, unit) {
  if (!unit) return 0;
  const battlefield = findUnitLocation(game, unit.instanceId)?.battlefield;
  return resolveLayeredNumber({
    printed: unit.might || 0,
    assignment: unit.assignedMight,
    modifiers: [
      ...intrinsicMightModifiers(unit),
      dynamicMightModifier(game, battlefield, unit),
      ...combatRoleMightModifiers(game, unit, unit.combatRole)
    ],
    minimum: minimumMightFromStaticEffects(game, battlefield, unit)
  });
}

function currentMightForMightyCondition(game, unit) {
  if (!unit) return 0;
  const battlefield = findUnitLocation(game, unit.instanceId)?.battlefield;
  const role = unit.combatRole;
  const roleModifiers = [];
  if (role === "attacker") {
    const assault = keywordAmountBeforeSelfMighty(game, unit, "Assault", 1);
    if (assault > 0) roleModifiers.push(assault);
  }
  if (role === "defender") {
    const shield = keywordAmountBeforeSelfMighty(game, unit, "Shield", 1)
      + staticEffectAmountTotal(unit, "shield", 0)
      + (unit.temporaryKeywordAmounts?.shield == null ? (unit.temporaryShieldAmount || 0) : 0);
    if (shield > 0) roleModifiers.push(shield);
    const controller = game.players.find((player) => player.id === unit.controllerId);
    const allies = battlefield?.units.filter((candidate) => candidate.controllerId === unit.controllerId) || [];
    if (allies.length === 1 && hasStaticEffect(controller?.legend, "defendAloneMight")) {
      roleModifiers.push(staticEffectAmount(controller.legend, "defendAloneMight", 2));
    }
  }
  return resolveLayeredNumber({
    printed: effectiveMight(unit),
    modifiers: [
      dynamicMightModifier(game, battlefield, unit),
      ...roleModifiers
    ],
    minimum: minimumMightFromStaticEffects(game, battlefield, unit)
  });
}

function keywordAmountBeforeSelfMighty(game, card, keyword, fallback = 1) {
  return printedKeywordValue(card, keyword, fallback)
    + temporaryKeywordValue(card, keyword, fallback)
    + dynamicKeywordInstanceCount(card, keyword, game, { excludeSelfMighty: true }) * fallback;
}

function minimumMightFromStaticEffects(game, battlefield, unit) {
  if (!unit?.stunned || !battlefield) return 0;
  return battlefield.units
    .filter((source) => source.controllerId !== unit.controllerId)
    .map((source) => firstCardEffect(source, "static", "stunnedEnemyHereMight")?.minMight)
    .filter((amount) => Number.isFinite(amount))
    .reduce((minimum, amount) => Math.max(minimum, amount), 0);
}

function shouldKillDamagedUnit(game, unit) {
  return unit.type === "unit"
    && unit.damage > 0
    && (
      game.players.some((player) => player.killDamagedUnitsThisTurn)
    );
}

function scoreHoldingBattlefields(game, player, continuation = null) {
  const triggers = [];
  for (const field of game.battlefields) {
    if (field.controlledBy === player.id) {
      const scored = awardPoint(game, player, field.instanceId, "hold");
      log(game, `${player.name} holds ${field.name}.`);
      if (scored) {
        triggerHoldEffects(game, player, field, triggers);
        collectBattlefieldScoreTriggers(field, player, "hold", triggers);
        for (const unit of field.units.filter((candidate) => candidate.controllerId === player.id)) {
          triggerScoreEffects(game, player, unit, "hold", triggers);
        }
      }
    }
  }
  if (!triggers.length) return false;
  prepareAndQueueTriggers(game, triggers, game.interactive ? "actionChain" : "queue", continuation);
  return true;
}

function triggerHoldEffects(game, player, source, triggerSink = null) {
  const triggers = [];
  for (const effect of cardEffects(source, "hold")) {
    if (effect.kind === "draw") {
      triggers.push({
        kind: "holdDraw",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: { amount: effect.amount || 1 }
      });
    }
    if (effect.kind === "gainPoint") {
      triggers.push({
        kind: "holdGainPoint",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: { amount: effect.amount || 1 }
      });
    }
    if (effect.kind === "channelRunes") {
      triggers.push({
        kind: "holdChannelRunes",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: {
          amount: effect.amount || 1,
          optional: effect.optional !== false,
          exhausted: effect.exhausted !== false
        }
      });
    }
    if (effect.kind === "buffUnitHere") {
      triggers.push({
        kind: "holdBuffUnitHere",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: {
          amount: effect.amount || 1,
          battlefieldId: source.instanceId
        }
      });
    }
    if (effect.kind === "returnChosenChampionToZone") {
      triggers.push({
        kind: "holdReturnChosenChampion",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: { optional: effect.optional !== false }
      });
    }
    if (effect.kind === "playUnitToken") {
      triggers.push({
        kind: "holdPlayUnitToken",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: {
          tokenCardNumber: effect.tokenCardNumber,
          count: effect.count || 1,
          ready: Boolean(effect.ready),
          destination: effect.destination || "base"
        }
      });
    }
    if (effect.kind === "winIfFriendlyUnitsAtLeast") {
      triggers.push({
        kind: "holdWinIfFriendlyUnitsAtLeast",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: { amount: effect.amount || 7 }
      });
    }
    if (effect.kind === "triggerConquerAbilitiesHere") {
      triggers.push({
        kind: "holdTriggerConquerAbilitiesHere",
        playerId: player.id,
        sourceCardId: source.instanceId
      });
    }
  }
  if (triggers.length) {
    if (triggerSink) {
      triggerSink.push(...triggers);
      return true;
    }
    prepareAndQueueTriggers(game, triggers, game.interactive ? "actionChain" : "queue");
  }
  return triggers.length > 0;
}

function awardPoint(game, player, battlefieldId, reason) {
  if (player.turnScoredBattlefields.has(battlefieldId)) {
    log(game, `${player.name} has already scored that battlefield this turn.`);
    return false;
  }
  player.turnScoredBattlefields.add(battlefieldId);
  const wouldWin = player.score + 1 >= currentVictoryScore(game);
  const scoredAllBattlefields = player.turnScoredBattlefields.size >= game.battlefields.length;
  if (wouldWin && reason === "conquer" && !scoredAllBattlefields) {
    draw(player, 1, game);
    log(game, `${player.name} would score the winning conquest point, so they draw 1 instead.`);
    return true;
  }
  player.score += 1;
  return true;
}

function triggerUnitConquerAbilities(game, player, unit, triggerSink = null) {
  triggerScoreEffects(game, player, unit, "conquer", triggerSink);
  const unitConquerSpecs = cardEffects(unit, "conquer")
    .filter((effect) => effect.kind !== "readySelf");
  if (unitConquerSpecs.length) {
    const triggers = unitConquerSpecs.map((effect) => ({
      kind: "effectSpecs",
      playerId: player.id,
      sourceCardId: unit.instanceId,
      data: {
        specs: [structuredClone(effect)],
        timing: "conquer",
        declaredTargets: [],
        declaredChoices: []
      }
    }));
    if (triggerSink) triggerSink.push(...triggers);
    else prepareAndQueueTriggers(game, triggers, game.interactive ? "actionChain" : "queue");
  }
}

function triggerConquerEventEffects(game, player, field, units, scored = true) {
  if (!scored) return false;
  const triggers = [];
  collectBattlefieldScoreTriggers(field, player, "conquer", triggers);
  for (const unit of units) triggerUnitConquerAbilities(game, player, unit, triggers);
  const representative = units[0];
  for (const source of player.trash) {
    for (const effect of cardEffects(source, "battlefieldControl")) {
      if (effect.kind !== "discardReturnSelfFromTrash" || (effect.event && effect.event !== "conquer")) continue;
      triggers.push({
        kind: "conquerDiscardReturnSelfFromTrash",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: { amount: effect.amount || 1 }
      });
    }
  }
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "conquer")) {
      if (!["drawIfUnitsAtBattlefield", "readySelf"].includes(effect.kind)) continue;
      triggers.push({
        kind: "effectSpecs",
        playerId: player.id,
        sourceCardId: source.instanceId,
        data: {
          specs: [{ ...structuredClone(effect), battlefieldId: field?.instanceId || null }],
          timing: "conquer",
          declaredTargets: [],
          declaredChoices: []
        }
      });
    }
  }
  for (const effect of cardEffects(field, "conquerHere")) {
    if (effect.kind === "readyRunesEndTurn") {
      triggers.push({
        kind: "conquerHereReadyRunesEndTurn",
        playerId: player.id,
        sourceCardId: field.instanceId,
        data: {
          amount: effect.amount || 1,
          unitId: representative?.instanceId
        }
      });
    }
    if (effect.kind === "discardDraw") {
      triggers.push({
        kind: "conquerHereDiscardDraw",
        playerId: player.id,
        sourceCardId: field.instanceId,
        data: {
          discard: effect.discard || 1,
          draw: effect.draw || 1,
          unitId: representative?.instanceId
        }
      });
    }
    if (effect.kind === "recycleRunes") {
      triggers.push({
        kind: "conquerHereRecycleRunes",
        playerId: player.id,
        sourceCardId: field.instanceId,
        data: {
          amount: effect.amount || 1,
          unitId: representative?.instanceId
        }
      });
    }
    if (effect.kind === "spendBuffDraw") {
      triggers.push({
        kind: "conquerHereSpendBuffDraw",
        playerId: player.id,
        sourceCardId: field.instanceId,
        data: {
          unitId: representative?.instanceId,
          draw: effect.draw || 1,
          optional: effect.optional !== false
        }
      });
    }
    if (effect.kind === "recycleTopDeck") {
      triggers.push({
        kind: "conquerHereRecycleTopDeck",
        playerId: player.id,
        sourceCardId: field.instanceId,
        data: {
          amount: effect.amount || 2,
          unitId: representative?.instanceId
        }
      });
    }
  }
  if (triggers.length) {
    prepareAndQueueTriggers(game, triggers, game.interactive ? "actionChain" : "queue");
  }
  return triggers.length > 0;
}

function collectEndTurnTriggers(game, player) {
  const triggers = [];
  for (const effect of cardEffects(player.legend, "endTurn")) {
    if (effect.kind === "readyRunes") triggers.push({ kind: "endTurnReadyRunes", playerId: player.id, sourceCardId: player.legend.instanceId, data: { amount: effect.amount || 1 } });
  }
  const amount = player.endTurnReadyRunes || 0;
  if (amount) {
    const source = game.battlefields.find((field) => hasAnyEffect(field, "conquerHere", "readyRunesEndTurn")) || player.legend;
    triggers.push({
      kind: "endTurnReadyRunes",
      playerId: player.id,
      sourceCardId: source.instanceId,
      data: { amount }
    });
  }
  for (const unit of allUnits(game).filter((candidate) => candidate.controllerId === player.id)) {
    if (!findUnitLocation(game, unit.instanceId)?.battlefield) continue;
    for (const effect of cardEffects(unit, "endTurn")) {
      if (effect.kind !== "readyRunesIfAtBattlefield") continue;
      triggers.push({
        kind: "endTurnReadyRunes",
        playerId: player.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.amount || 1 }
      });
    }
  }
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "endTurn")) {
      if (effect.kind !== "playTopDeckUnitIgnoreCost") continue;
      triggers.push({
        kind: "endTurnPlayTopDeckUnitIgnoreCost",
        playerId: player.id,
        sourceCardId: source.instanceId
      });
    }
  }
  return triggers;
}

const KEYWORD_SCORE_TRIGGER_RESOLVERS = new Map([
  ["huntGainXp", (game, player, unit, reason, triggers) => {
    if (!effectIsEnabled({ timing: "keyword", kind: "huntGainXp" })) return;
    if (!["conquer", "hold"].includes(reason) || !hasKeyword(unit, "Hunt", game)) return;
    triggers.push({
      kind: "scoreGainXp",
      playerId: player.id,
      sourceCardId: unit.instanceId,
      data: { amount: keywordAmount(unit, "Hunt", 1, game), reason }
    });
  }]
]);

function collectBattlefieldScoreTriggers(field, player, reason, triggers) {
  for (const effect of cardEffects(field, "score")) {
    if (effect.kind !== "swapBackReplacedBattlefield" || !field.replacedBattlefieldId) continue;
    triggers.push({
      kind: "scoreSwapBackReplacedBattlefield",
      playerId: player.id,
      sourceCardId: field.instanceId,
      data: { reason, optional: effect.optional !== false }
    });
  }
}

function triggerScoreEffects(game, player, unit, reason, triggerSink = null) {
  const triggers = [];
  for (const resolver of KEYWORD_SCORE_TRIGGER_RESOLVERS.values()) {
    resolver(game, player, unit, reason, triggers);
  }
  for (const effect of cardEffects(unit, "score")) {
    if (effect.reason && effect.reason !== reason) continue;
    if (effect.kind === "buffSelf") {
      triggers.push({
        kind: "scoreBuffSelf",
        playerId: player.id,
        sourceCardId: unit.instanceId,
        data: {
          amount: effect.amount || 1,
          maxBuffs: effect.maxBuffs,
          reason
        }
      });
    }
    if (effect.kind === "draw") {
      triggers.push({
        kind: "scoreDraw",
        playerId: player.id,
        sourceCardId: unit.instanceId,
        data: {
          amount: effect.amount || 1,
          reason
        }
      });
    }
    if (effect.kind === "drawOrChannelRunes") {
      triggers.push({
        kind: "scoreDrawOrChannelRunes",
        playerId: player.id,
        sourceCardId: unit.instanceId,
          data: {
            draw: effect.draw || 1,
            channel: effect.channel || 1,
            channelExhausted: effect.channelExhausted !== false,
            reason
          }
      });
    }
    if (effect.kind === "gainXp") {
      triggers.push({
        kind: "scoreGainXp",
        playerId: player.id,
        sourceCardId: unit.instanceId,
        data: {
          amount: effect.amount || 1,
          reason
        }
      });
    }
    if (effect.kind === "killGearThenBuffSelf") {
      triggers.push({
        kind: "scoreKillGearThenBuffSelf",
        playerId: player.id,
        sourceCardId: unit.instanceId,
        data: {
          amount: effect.amount || 1,
          reason
        }
      });
    }
    if (effect.kind === "returnSelfToHand") {
      triggers.push({
        kind: "scoreReturnSelfToHand",
        playerId: player.id,
        sourceCardId: unit.instanceId,
        data: { reason }
      });
    }
  }
  if (reason === "hold") {
    for (const effect of cardEffects(unit, "hold")) {
      if (effect.kind === "draw") {
        triggers.push({
          kind: "holdDraw",
          playerId: player.id,
          sourceCardId: unit.instanceId,
          data: { amount: effect.amount || 1 }
        });
      }
      if (effect.kind === "gainPoint") {
        triggers.push({
          kind: "holdGainPoint",
          playerId: player.id,
          sourceCardId: unit.instanceId,
          data: { amount: effect.amount || 1 }
        });
      }
    }
  }
  if (triggers.length) {
    if (triggerSink) {
      triggerSink.push(...triggers);
      return true;
    }
    prepareAndQueueTriggers(game, triggers, game.interactive ? "actionChain" : "queue");
  }
  return triggers.length > 0;
}

function collectStartOfBeginningTriggers(game, player) {
  const triggers = [];
  for (const permanent of [...allUnits(game), ...allGear(game)]) {
    if (permanent.controllerId !== player.id || !(permanent.temporary || hasKeyword(permanent, "Temporary", game))) continue;
    triggers.push({
      kind: "beginningKillTemporary",
      playerId: player.id,
      sourceCardId: permanent.instanceId,
      sourceCardSnapshot: structuredClone(permanent)
    });
  }
  if (!player.hasTakenFirstTurn && !player.firstBeginningEffectsResolved) {
    for (const field of game.battlefields) {
      for (const effect of cardEffects(field, "firstBeginning")) {
        if (effect.kind === "gainPoint") {
          triggers.push({
            kind: "firstBeginningGainPoint",
            playerId: player.id,
            sourceCardId: field.instanceId,
            data: { amount: effect.amount || 1, exhausted: Boolean(effect.exhausted) }
          });
        }
        if (effect.kind === "channelRunes") {
          triggers.push({
            kind: "firstBeginningChannelRunes",
            playerId: player.id,
            sourceCardId: field.instanceId,
            data: { amount: effect.amount || 1 }
          });
        }
      }
    }
    if (triggers.length) player.firstBeginningEffectsResolved = true;
  }
  const controlsHidden = game.battlefields.some((field) =>
    (field.hidden || []).some((item) => hiddenCardIsControlledBy(item, player.id))
  );
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "beginning")) {
      if (effect.kind === "drawIfHandSizeAtMost") {
        if (player.hand.length > (effect.maxHandSize ?? 1)) continue;
        triggers.push({
          kind: "beginningDraw",
          playerId: player.id,
          sourceCardId: source.instanceId,
          data: { amount: effect.amount || 1 }
        });
      }
      if (effect.kind === "drawIfControlsHidden") {
        if (!controlsHidden) continue;
        triggers.push({
          kind: "beginningDraw",
          playerId: player.id,
          sourceCardId: source.instanceId,
          data: { amount: effect.amount || 1 }
        });
      }
      if (effect.kind === "recycleTrash") {
        if (!player.trash.length) continue;
        triggers.push({
          kind: "beginningRecycleTrash",
          playerId: player.id,
          sourceCardId: source.instanceId,
          data: { amount: effect.amount || 1 }
        });
      }
    }
  }
  return triggers;
}

function resolveBeginningKillTemporaryTrigger(game, trigger, player, source) {
  if (!source || source.controllerId !== player.id || !(source.temporary || hasKeyword(source, "Temporary", game))) return;
  if (source.type === "gear") killGear(game, source);
  if (source.type === "unit") {
    const location = findUnitLocation(game, source.instanceId);
    if (location) {
      killUnit(game, source, location.type === "battlefield"
        ? { type: "battlefield", battlefield: location.battlefield }
        : { type: "base", player: location.player });
    }
  }
  log(game, `${source.name} is killed because it is Temporary.`);
}

function destroyTemporaryGear(game, player) {
  const temporary = allGear(game).filter((gear) => (gear.temporary || hasKeyword(gear, "Temporary", game)) && gear.controllerId === player.id);
  for (const gear of temporary) {
    killGear(game, gear, { type: "base", player });
    log(game, `${gear.name} is killed because it is Temporary.`);
  }
  const temporaryUnits = allUnits(game).filter((unit) => (unit.temporary || hasKeyword(unit, "Temporary", game)) && unit.controllerId === player.id);
  for (const unit of temporaryUnits) {
    const location = findUnitLocation(game, unit.instanceId);
    killUnit(game, unit, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : { type: "base", player });
    log(game, `${unit.name} is killed because it is Temporary.`);
  }
}

const ON_MOVE_EFFECT_RESOLVERS = new Map([
  ["buffMovedUnit", resolveOnMoveBuffMovedUnit],
  ["discardDraw", resolveOnMoveDiscardDraw],
  ["drawDiscardTypeBonus", resolveOnMoveDrawDiscardTypeBonus],
  ["drawWhenOpponentMovesToOtherBattlefield", resolveOnMoveOpponentObserverDraw],
  ["moveWithFriendlyFromSameBattlefield", resolveOnMoveCompanion],
  ["playUnitToken", resolveOnMovePlayUnitToken],
  ["readyAnotherExhaustedFirstTimeEachTurn", resolveOnMoveReadyAnother],
  ["scoreOnNthMoveEachTurn", resolveOnMoveScoreNth]
]);

function recordMoveAction(game, player, unit, afterMove = null) {
  unit.movesThisTurn = (unit.movesThisTurn || 0) + 1;
  const sourceBattlefieldId = afterMove?.sourceBattlefieldIds?.[unit.instanceId];
  const sourceBattlefield = game.battlefields.find((field) => field.instanceId === sourceBattlefieldId);
  const destination = findUnitLocation(game, unit.instanceId);
  game.moveEventSequence = (game.moveEventSequence || 0) + 1;
  game.moveEvents ||= [];
  game.moveEvents.push({
    id: `move-${game.moveEventSequence}`,
    cardId: unit.instanceId,
    responsiblePlayerId: player.id,
    sourceType: sourceBattlefield ? "battlefield" : "base",
    sourceId: sourceBattlefield?.instanceId || player.id,
    destinationType: destination?.type || null,
    destinationId: destination?.type === "battlefield" ? destination.battlefield.instanceId : destination?.player?.id || null,
    simultaneousBatchId: afterMove?.simultaneousBatchId || null,
    turnSequence: game.turnSequence || 0
  });
  return sourceBattlefield;
}

function createOnMoveTrigger(game, player, source, movedUnit, effect, role, afterMove, sourceBattlefield = null) {
  return {
    kind: "onMoveEffect",
    playerId: player.id,
    sourceCardId: source.instanceId,
    sourceCardSnapshot: structuredClone(source),
    data: {
      specs: [structuredClone(effect)],
      movedUnitId: movedUnit.instanceId,
      movedUnitSnapshot: structuredClone(movedUnit),
      role,
      sourceBattlefieldId: sourceBattlefield?.instanceId || null,
      destinationId: afterMove?.destinationIds?.[movedUnit.instanceId] || afterMove?.destinationId || null
    }
  };
}

function collectMoveEffectTriggers(game, responsiblePlayer, unit, afterMove, sourceBattlefield) {
  const triggers = [];
  triggers.push(...collectOpponentMoveObserverTriggers(game, responsiblePlayer, unit, afterMove));
  const unitController = game.players.find((candidate) => candidate.id === unit.controllerId)
    || responsiblePlayer;
  if (sourceBattlefield) {
    const companions = sourceBattlefield.units.filter((candidate) =>
      candidate.controllerId === unit.controllerId
      && candidate.instanceId !== unit.instanceId
      && cardEffects(candidate, "onMove").some((effect) => effect.kind === "moveWithFriendlyFromSameBattlefield")
      && !candidate.exhausted
    );
    for (const companion of companions) {
      const effect = cardEffects(companion, "onMove").find((candidate) => candidate.kind === "moveWithFriendlyFromSameBattlefield");
      const companionController = game.players.find((candidate) => candidate.id === companion.controllerId)
        || unitController;
      triggers.push(createOnMoveTrigger(game, companionController, companion, unit, effect, "companion", afterMove, sourceBattlefield));
    }
    const battlefieldController = game.players.find((candidate) => candidate.id === sourceBattlefield.controlledBy)
      || currentPlayer(game);
    for (const effect of cardEffects(sourceBattlefield, "onMove")) {
      if (battlefieldController) {
        triggers.push(createOnMoveTrigger(game, battlefieldController, sourceBattlefield, unit, effect, "battlefield", afterMove, sourceBattlefield));
      }
    }
  }
  for (const effect of cardEffects(unit, "onMove")) {
    triggers.push(createOnMoveTrigger(game, unitController, unit, unit, effect, "moved", afterMove, sourceBattlefield));
  }
  return triggers;
}

function triggerMoveEffectsBatch(game, responsiblePlayer, units, afterMove = null) {
  game.moveActionBatchSequence = (game.moveActionBatchSequence || 0) + 1;
  const batchId = `move-event-${game.moveActionBatchSequence}`;
  if (afterMove) afterMove.simultaneousBatchId = batchId;
  const triggers = [];
  for (const unit of units) {
    const sourceBattlefield = recordMoveAction(game, responsiblePlayer, unit, afterMove);
    triggers.push(...collectMoveEffectTriggers(game, responsiblePlayer, unit, afterMove, sourceBattlefield));
  }
  if (!triggers.length) return false;
  for (const trigger of triggers) trigger.simultaneousBatchId = batchId;
  const mode = game.phase === "showdown" && game.showdown ? "showdownChain" : game.interactive ? "actionChain" : "queue";
  const continuation = game.resolvingGameEffect ? null : { kind: "finishAfterMove", afterMove };
  const queued = prepareAndQueueTriggers(game, triggers, mode, continuation);
  return game.resolvingGameEffect ? false : queued;
}

function resolveOnMoveEffect(game, context) {
  const resolver = ON_MOVE_EFFECT_RESOLVERS.get(context.effect?.kind);
  if (!resolver) throw new Error(`Missing onMove resolver for ${context.effect?.kind || "unknown"}.`);
  return Boolean(resolver(game, context));
}

function resolveOnMoveEffectTrigger(game, trigger, player, source) {
  const effect = trigger.data?.specs?.[0];
  const movedUnit = findCard(game, trigger.data?.movedUnitId) || trigger.data?.movedUnitSnapshot;
  if (!effect || !movedUnit) return;
  const sourceBattlefield = game.battlefields.find((field) => field.instanceId === trigger.data?.sourceBattlefieldId);
  const destination = game.battlefields.find((field) => field.instanceId === trigger.data?.destinationId);
  const scope = enterGameEffectResolution(game, game.resolvingChainContext || null);
  const waits = resolveOnMoveEffect(game, {
    player,
    source,
    movedUnit,
    sourceBattlefield,
    destination,
    destinationId: trigger.data?.destinationId || null,
    effect,
    afterMove: null,
    role: trigger.data?.role,
    queuedTrigger: true
  });
  leaveGameEffectResolution(game, scope, waits);
}

function resolveOnMoveCompanion(game, { player, source, movedUnit, sourceBattlefield, afterMove, destinationId, role, queuedTrigger }) {
  if (role !== "companion") return false;
  if (queuedTrigger) {
    const location = findUnitLocation(game, source.instanceId);
    if (location?.type !== "battlefield" || location.battlefield.instanceId !== sourceBattlefield?.instanceId) return false;
    const targetDestination = destinationId || afterMove?.destinationId;
    if (!targetDestination || (targetDestination === "base" && !canMoveUnitFromBattlefieldToBase(game, source, location))) return false;
    moveUnitBySpell(game, player, source, source, targetDestination);
    return Boolean(game.pendingChoice || game.pendingPayment);
  }
  return promptChoice(game, player, source, {
    effect: "moveWithFriendlyFromSameBattlefield",
    prompt: `Move ${source.name} with ${movedUnit.name}?`,
    options: [
      { id: "move", label: `Move ${source.name}`, cardId: source.instanceId },
      { id: "decline", label: "Do not move", cardId: null }
    ],
    finishSpell: false,
    optional: false,
    data: { companionId: source.instanceId, destinationId: afterMove?.destinationId, afterMove }
  });
}

function resolveOnMoveBuffMovedUnit(game, { source, movedUnit, effect, role }) {
  if (role !== "battlefield") return false;
  addMightModifier(movedUnit, effect.amount || 1, { temporary: isTemporaryMightEffect(source, effect) });
  log(game, `${source.name} gives ${movedUnit.name} +${effect.amount || 1} Might this turn for moving from there.`);
  markEffect(game, source, [source.instanceId, movedUnit.instanceId], `${movedUnit.name} gets Might this turn.`);
  return false;
}

function resolveOnMoveScoreNth(game, { player, movedUnit, effect, role }) {
  if (role !== "moved") return false;
  if (movedUnit.movesThisTurn === (effect.moveNumber || 3)) {
    const amount = effect.amount || 1;
    player.score += amount;
    log(game, `${movedUnit.name} scores ${amount} point${amount === 1 ? "" : "s"} for moving ${movedUnit.movesThisTurn} times this turn.`);
    markEffect(game, movedUnit, [movedUnit.instanceId], `${player.name} gains ${amount} point${amount === 1 ? "" : "s"}.`);
  }
  return false;
}

function resolveOnMoveReadyAnother(game, { player, movedUnit, afterMove, role }) {
  if (role !== "moved" || movedUnit.readyAnotherExhaustedMoveTurnSequence === game.turnSequence) return false;
  const targets = allControlledCards(game, player.id)
    .filter((card) => card.instanceId !== movedUnit.instanceId)
    .filter((card) => (card.type === "unit" || card.type === "gear") && card.exhausted);
  if (!targets.length) return false;
  movedUnit.readyAnotherExhaustedMoveTurnSequence = game.turnSequence;
  return promptChoice(game, player, movedUnit, {
    effect: "readyAnotherExhausted",
    prompt: `Choose another exhausted friendly card for ${movedUnit.name}, or skip.`,
    options: [...targets.map(cardOption), { id: "decline", label: "Do not ready a card", cardId: null }],
    finishSpell: false,
    optional: false,
    data: { afterMove }
  });
}

function resolveOnMovePlayUnitToken(game, { player, movedUnit, effect, afterMove, destinationId, role }) {
  if (role !== "moved") return false;
  const destination = effect.destination === "movedBattlefield"
    ? destinationId || afterMove?.destinationId
    : tokenDestinationFromSpec(game, player, movedUnit, effect);
  if (destination) playUnitToken(game, player, movedUnit, effect, destination);
  return false;
}

function resolveOnMoveDiscardDraw(game, { player, movedUnit, effect, afterMove, role }) {
  if (role !== "moved") return false;
  return chooseDiscardCards(game, player, movedUnit, {
    amount: effect.discard || 1,
    draw: effect.draw || 1,
    afterMove
  });
}

function resolveOnMoveDrawDiscardTypeBonus(game, { player, movedUnit, effect, afterMove, role }) {
  if (role !== "moved") return false;
  draw(player, 1, game);
  if (!player.hand.length) {
    log(game, `${movedUnit.name} has no card to discard.`);
    return false;
  }
  const choice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: movedUnit,
    effect: "hweiDiscard",
    prompt: `Choose a card to discard for ${movedUnit.name}.`,
    options: player.hand.map(cardOption),
    data: { afterMove, temporary: isTemporaryMightEffect(movedUnit, effect) },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  if (!game.interactive) {
    applyChoiceEffect(game, choice, choice.options[0]);
    return Boolean(afterMove);
  }
  game.pendingChoice = choice;
  log(game, `${player.name} chooses a discard for ${movedUnit.name}.`);
  return true;
}

function collectOpponentMoveObserverTriggers(game, movingPlayer, movedUnit, afterMove = null) {
  const triggers = [];
  const destinationId = afterMove?.destinationId;
  if (!destinationId || destinationId === "base") return triggers;
  const destination = game.battlefields.find((field) => field.instanceId === destinationId);
  if (!destination) return triggers;
  for (const observer of allUnits(game)) {
    if (observer.controllerId === movingPlayer.id || observer.instanceId === movedUnit.instanceId) continue;
    const observerLocation = findUnitLocation(game, observer.instanceId);
    if (observerLocation?.type !== "battlefield") continue;
    if (observerLocation.battlefield.instanceId === destination.instanceId) continue;
    for (const effect of cardEffects(observer, "onMove").filter((candidate) => candidate.kind === "drawWhenOpponentMovesToOtherBattlefield")) {
      const controller = game.players.find((player) => player.id === observer.controllerId);
      if (controller) triggers.push(createOnMoveTrigger(game, controller, observer, movedUnit, effect, "observer", afterMove));
    }
  }
  return triggers;
}

function resolveOnMoveOpponentObserverDraw(game, { player, source, movedUnit, effect, role }) {
  if (role !== "observer") return false;
  draw(player, effect.amount || 1, game);
  log(game, `${source.name} draws because ${movedUnit.name} moved to another battlefield.`);
  markEffect(game, source, [source.instanceId, movedUnit.instanceId], `${source.name} draws.`);
  return false;
}

function collectShowdownStartTriggers(game, battlefield, defender) {
  const triggers = [];
  for (const unit of battlefield.units) {
    const controller = game.players.find((player) => player.id === unit.controllerId);
    for (const effect of cardEffects(unit, "showdownBeginsHere")) {
      if (effect.kind !== "payEnergyPredictDrawSpell") continue;
      const amount = effect.amount || 1;
      triggers.push({
        kind: "showdownBeginsPayEnergyPredictDrawSpell",
        playerId: controller.id,
        sourceCardId: unit.instanceId,
        data: { amount }
      });
    }
  }

  triggers.push(...showdownDefendHereTriggers(game, battlefield, defender));
  return triggers;
}

function continueShowdownStartEffects(game, resume) {
  // Showdown-start abilities are now finalized together on the showdown chain.
  // Legacy continuations can therefore only resume chain priority.
  if (resume?.fromShowdownChain && game.phase === "showdown" && game.showdown) {
    giveShowdownPriority(game, currentShowdownFocusId(game.showdown));
  }
}

function showdownDefendHereTriggers(game, battlefield, defender) {
  const triggers = [];
  if (!game.showdown?.combat) return triggers;
  const attackerId = game.showdown.attackerId;
  if (!attackerId || attackerId === defender.id) return triggers;
  if (!battlefield.units.some((unit) => unit.controllerId === attackerId)
    || !battlefield.units.some((unit) => unit.controllerId === defender.id)) return triggers;
  for (const effect of cardEffects(battlefield, "defendHere")) {
    if (effect.kind === "revealTopSpellToHandElseRecycle") {
      triggers.push({
        kind: "defendHereRevealTopSpell",
        playerId: defender.id,
        sourceCardId: battlefield.instanceId
      });
    }
    if (effect.kind === "giveShieldHere") {
      triggers.push({
        kind: "defendHereGiveShield",
        playerId: defender.id,
        sourceCardId: battlefield.instanceId,
        data: {
          amount: effect.amount || 2,
          targetIds: battlefield.units.map((unit) => unit.instanceId)
        }
      });
    }
    if (effect.kind === "returnFriendlyUnitHereToBase") {
      triggers.push({
        kind: "defendHereReturnFriendlyUnitToBase",
        playerId: defender.id,
        sourceCardId: battlefield.instanceId,
        data: {
          targetIds: battlefield.units
            .filter((unit) => unit.controllerId === defender.id)
            .map((unit) => unit.instanceId),
          optional: effect.optional !== false
        }
      });
    }
  }
  return triggers;
}

function resolveShowdownPredictDrawSpell(game, controller, unit, resumeShowdownStart = null) {
  if (offerPredictChoice(game, controller, unit, {}, {
    revealSpellAfterPredict: true,
    resumeShowdownStart,
    fromShowdownChain: Boolean(resumeShowdownStart?.fromShowdownChain)
  })) return;
  log(game, `${unit.name} predicts and reveals the top card.`);
  markEffect(game, unit, [unit.instanceId], `${unit.name} showdown trigger.`);
  continueShowdownStartEffects(game, resumeShowdownStart);
}

function collectAttackOrDefendTriggers(game, battlefield, attackerId, newlyDesignatedUnits = null) {
  const combatId = ensureCombatId(game);
  const designatedUnits = (newlyDesignatedUnits || assignCombatDesignations(game, battlefield, attackerId))
    .filter((unit) => {
      const role = unit.combatRole;
      unit.combatTriggerChecks ||= {};
      unit.combatTriggerChecks[combatId] ||= {};
      if (unit.combatTriggerChecks[combatId][role]) return false;
      unit.combatTriggerChecks[combatId][role] = true;
      return true;
    });
  const defender = game.players.find((player) => player.id === battlefield.controlledBy && player.id !== attackerId);
  const attackReduction = firstCardEffect(defender?.legend, "static", "enemyAttacksControlledBattlefieldMightReduction");
  if (attackReduction) {
    for (const unit of designatedUnits.filter((candidate) => candidate.controllerId === attackerId)) {
      const amount = attackReduction.minMight != null && currentMight(game, unit) + (attackReduction.amount || 0) < attackReduction.minMight
        ? attackReduction.minMight - currentMight(game, unit)
        : attackReduction.amount || 0;
      addMightModifier(unit, amount, { temporary: true });
      markEffect(game, defender.legend, [unit.instanceId], `${unit.name} gets ${amount} Might while attacking.`);
    }
  }
  const triggers = [];
  for (const unit of designatedUnits) {
    for (const effect of cardEffects(unit, "attackOrDefend")) {
      const controller = game.players.find((player) => player.id === unit.controllerId);
      if (!controller) continue;
      const enemies = battlefield.units.filter((candidate) => candidate.controllerId !== unit.controllerId);
      if (effect.kind === "ifEnemyAloneBuffAndXp") {
        if (enemies.length !== 1) continue;
        triggers.push({
          kind: "attackOrDefendBuffXp",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: {
            amount: effect.amount || 0,
            temporary: isTemporaryMightEffect(unit, effect),
            xp: effect.xp || 0,
            attackerId
          }
        });
      }
      if (effect.kind === "dealDamageEnemyHere" && effect.role === unit.combatRole) {
        triggers.push({
          kind: "attackOrDefendDamageEnemyHere",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: { amount: effect.amount || 0, amountFromSelfMight: Boolean(effect.amountFromSelfMight) }
        });
      }
      if (effect.kind === "splitDamageEnemyHere" && effect.role === unit.combatRole) {
        triggers.push({
          kind: "attackOrDefendSplitDamageEnemyHere",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: { amount: effect.amount || 5, declaredTargets: [] }
        });
      }
      if (effect.kind === "damageEnemyByHiddenTopDeck" && effect.role === unit.combatRole) {
        triggers.push({
          kind: "attackOrDefendDamageEnemyByHiddenTopDeck",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: { look: effect.look || 5 }
        });
      }
      if (effect.kind === "dealDamageAllEnemiesHere" && effect.role === unit.combatRole) {
        triggers.push({
          kind: "attackOrDefendDamageAllEnemiesHere",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: { amount: effect.amount || 0, temporary: isTemporaryMightEffect(unit, effect) }
        });
      }
      if (effect.kind === "killDamagedEnemiesHere" && effect.role === unit.combatRole) {
        triggers.push({
          kind: "attackOrDefendKillDamagedEnemiesHere",
          playerId: controller.id,
          sourceCardId: unit.instanceId
        });
      }
      if (effect.kind === "modifySelfIfReadyEnemyHere" && effect.role === unit.combatRole) {
        if (!enemies.some((enemy) => !enemy.exhausted)) continue;
        triggers.push({
          kind: "attackOrDefendModifySelf",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: { amount: effect.amount || 0, temporary: isTemporaryMightEffect(unit, effect) }
        });
      }
      if (effect.kind === "modifyEnemyHere" && (!effect.role || effect.role === unit.combatRole)) {
        triggers.push({
          kind: "attackOrDefendModifyEnemyHere",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: {
            amount: effect.amount || 0,
            minMight: effect.minMight || null,
            temporary: isTemporaryMightEffect(unit, effect)
          }
        });
      }
      if (effect.kind === "stunEnemyHere" && effect.role === unit.combatRole) {
        triggers.push({
          kind: "attackOrDefendStunEnemyHere",
          playerId: controller.id,
          sourceCardId: unit.instanceId
        });
      }
      if (effect.kind === "playHiddenFromHand" && (!effect.role || effect.role === unit.combatRole)) {
        triggers.push({
          kind: "attackOrDefendPlayHiddenFromHand",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: { domain: effect.domain || "Any", battlefieldId: battlefield.instanceId }
        });
      }
      if (effect.kind === "runeDeckGambit" && (!effect.role || effect.role === unit.combatRole)) {
        triggers.push({
          kind: "attackOrDefendRuneDeckGambit",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: { battlefieldId: battlefield.instanceId }
        });
      }
    }
    const allies = battlefield.units.filter((candidate) => candidate.controllerId === unit.controllerId);
    if (allies.length === 1) {
      for (const source of allControlledCards(game, unit.controllerId)) {
        if (source.instanceId === unit.instanceId) continue;
        for (const effect of cardEffects(source, "attackOrDefend")) {
          if (effect.kind !== "modifyFriendlyAlone") continue;
          if (effect.role && effect.role !== unit.combatRole) continue;
          triggers.push({
            kind: "attackOrDefendModifyUnit",
            playerId: unit.controllerId,
            sourceCardId: source.instanceId,
            data: {
              targetId: unit.instanceId,
              amount: effect.amount || 0,
              temporary: isTemporaryMightEffect(source, effect)
            }
          });
        }
      }
    }
  }
  return triggers;
}

function nextCombatId(game) {
  game.nextCombatSequence = (game.nextCombatSequence || 0) + 1;
  return `combat-${game.nextCombatSequence}`;
}

function ensureCombatId(game) {
  if (!game.showdown) return nextCombatId(game);
  game.showdown.combatId ||= nextCombatId(game);
  return game.showdown.combatId;
}

function assignCombatDesignations(game, battlefield, attackerId) {
  const defenderId = game.showdown?.battlefieldId === battlefield.instanceId
    ? game.showdown.defenderId
    : battlefield.units.find((unit) => unit.controllerId !== attackerId)?.controllerId;
  const newlyDesignated = [];
  for (const field of game.battlefields) {
    if (field.instanceId !== battlefield.instanceId) {
      for (const unit of field.units) delete unit.combatRole;
    }
  }
  for (const player of game.players) {
    for (const unit of player.base) delete unit.combatRole;
  }
  for (const unit of battlefield.units) {
    const role = unit.controllerId === attackerId
      ? "attacker"
      : unit.controllerId === defenderId
        ? "defender"
        : null;
    if (!role) {
      delete unit.combatRole;
      continue;
    }
    if (unit.combatRole !== role) newlyDesignated.push(unit);
    unit.combatRole = role;
  }
  return newlyDesignated;
}

function triggerOpponentPlaysUnit(game, player, playedUnit, battlefield) {
  for (const unit of battlefield.units.filter((candidate) => candidate.controllerId !== player.id)) {
    if (!hasAnyEffect(unit, "opponentPlaysUnit", "stunAndCantMove")) continue;
    const controller = game.players.find((candidate) => candidate.id === unit.controllerId);
    if (controller) stunUnit(game, controller, unit, playedUnit);
    playedUnit.cantMoveThisTurn = true;
    log(game, `${unit.name} stuns ${playedUnit.name}.`);
    markEffect(game, unit, [playedUnit.instanceId], `${playedUnit.name} is stunned.`);
  }
}

function readyRunes(player, amount) {
  let left = amount;
  for (const rune of player.runes) {
    if (!rune.exhausted) continue;
    rune.exhausted = false;
    left -= 1;
    if (left <= 0) return;
  }
}

function channelRunes(game, player, amount, options = {}) {
  const channeled = [];
  for (let i = 0; i < amount; i++) {
    const rune = player.runeDeck.shift();
    if (!rune) break;
    markNonBoardZoneChange(rune);
    rune.controllerId = player.id;
    rune.exhausted = Boolean(options.exhausted);
    player.runes.push(rune);
    channeled.push(rune);
  }
  if (!channeled.length) return channeled;
  game.channelEventSequence = (game.channelEventSequence || 0) + 1;
  game.channelEvents ||= [];
  game.channelEvents.push({
    id: `channel-${game.channelEventSequence}`,
    runeIds: channeled.map((rune) => rune.instanceId),
    playerId: player.id,
    responsiblePlayerId: options.responsiblePlayerId === undefined ? player.id : options.responsiblePlayerId,
    sourceCardId: options.source?.instanceId || null,
    exhausted: Boolean(options.exhausted),
    reason: options.reason || "effect",
    turnSequence: game.turnSequence || 0
  });
  requestCleanup(game, "board-zone-change", {
    objectIds: channeled.map((rune) => rune.instanceId),
    zone: "base"
  });
  return channeled;
}

export function draw(player, amount, game = null, options = {}) {
  const requested = Math.max(0, amount || 0);
  const drawnCards = [];
  const triggers = [];
  const burnOutsBefore = player.burnOuts || 0;
  for (let i = 0; i < requested; i++) {
    let burnOutSafety = 0;
    while (!player.mainDeck.length && game && game.phase !== "complete" && burnOutSafety < 100) {
      performBurnOut(game, player, triggers);
      burnOutSafety += 1;
    }
    if (game?.phase === "complete") break;
    const card = player.mainDeck.shift();
    if (!card) break;
    markNonBoardZoneChange(card);
    player.hand.push(card);
    drawnCards.push(card);
    player.drawCountThisTurn = (player.drawCountThisTurn || 0) + 1;
    if (game) collectDrawEffectTriggers(game, player, triggers, `draw-${game.turnSequence || 0}-${player.drawCountThisTurn}`);
  }
  if (game) {
    game.drawEventSequence = (game.drawEventSequence || 0) + 1;
    game.drawEvents ||= [];
    game.drawEvents.push({
      id: `draw-action-${game.drawEventSequence}`,
      playerId: player.id,
      responsiblePlayerId: player.id,
      requested,
      cardIds: drawnCards.map((card) => card.instanceId),
      burnOutCount: (player.burnOuts || 0) - burnOutsBefore,
      turnSequence: game.turnSequence || 0
    });
  }
  if (game?.phase === "complete" || !triggers.length) return false;
  const waitsForTrigger = prepareAndQueueTriggers(
    game,
    triggers,
    options.triggerMode || "queue",
    options.continuation || null
  );
  if (waitsForTrigger && !game.resolvingGameEffect) return true;
  return false;
}

function performBurnOut(game, player, triggerCollector = null) {
  const recycled = player.trash.splice(0, player.trash.length);
  if (recycled.length) {
    recycleMainDeckCards(game, player, recycled, null, {
      triggerCollector,
      simultaneousBatchId: `burn-out-recycle-${(player.burnOuts || 0) + 1}`
    });
  }
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  if (!opponent) return false;
  opponent.score += 1;
  player.burnOuts = (player.burnOuts || 0) + 1;
  log(game, `${player.name} burns out, recycles ${recycled.length} card${recycled.length === 1 ? "" : "s"}, and ${opponent.name} gains 1 point.`);
  checkVictory(game);
  return true;
}

function collectDrawEffectTriggers(game, player, triggers, simultaneousBatchId = null) {
  if (player.drawCountThisTurn !== 2) return false;
  const targets = allUnits(game).filter((unit) => unit.controllerId === player.id);
  if (!targets.length) return false;
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "secondDrawEachTurn")) {
      if (effect.kind !== "modifyMight") continue;
      triggers.push({
        kind: "secondDrawBuff",
        playerId: player.id,
        sourceCardId: source.instanceId,
        simultaneousBatchId,
        data: {
          amount: effect.amount || 2,
          temporary: isTemporaryMightEffect(source, effect),
          targetIds: targets.map((unit) => unit.instanceId)
        }
      });
    }
  }
  return triggers.length > 0;
}

function allUnits(game) {
  return [
    ...game.players.flatMap((player) => player.base.filter((card) => card.type === "unit")),
    ...game.battlefields.flatMap((field) => field.units.filter((card) => card.type === "unit"))
  ];
}

function allControlledCards(game, playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const cards = [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...player.base,
    ...player.runes.filter((rune) => rune.controllerId === playerId),
    ...game.battlefields.flatMap((field) => field.units.filter((unit) => unit.controllerId === playerId)),
    ...allUnits(game).flatMap((unit) => unit.attachments || []).filter((attachment) => attachment.controllerId === playerId)
  ].filter(Boolean);
  return [...new Map(cards.map((card) => [card.instanceId, card])).values()];
}

function findCard(game, cardId) {
  if (!cardId) return null;
  const pools = [
    ...game.players.flatMap((player) => [
      player.legend,
      player.champion,
      ...player.availableChampions,
      ...player.availableBattlefields,
      ...player.hand,
      ...player.base,
      ...player.runes,
      ...player.trash,
      ...(player.banished || [])
    ]),
    ...(game.showdown?.chain.map((item) => item.card) || []),
    ...(game.actionChain?.chain.map((item) => item.card) || []),
    ...game.battlefields,
    ...game.battlefields.flatMap((field) => field.units),
    ...game.battlefields.flatMap((field) => (field.hidden || []).map((item) => item.card)),
    ...allUnits(game).flatMap((unit) => unit.attachments || [])
  ];
  return pools.find((card) => card?.instanceId === cardId || card?.id === cardId) || null;
}

function findHiddenCardLocation(game, cardId) {
  for (const battlefield of game.battlefields) {
    const index = (battlefield.hidden || []).findIndex((item) => item.card.instanceId === cardId);
    if (index >= 0) return { battlefield, index, ...battlefield.hidden[index] };
  }
  return null;
}

function findUnitLocation(game, unitId) {
  for (const player of game.players) {
    const index = player.base.findIndex((unit) => unit.instanceId === unitId && unit.type === "unit");
    if (index >= 0) return { type: "base", player, unit: player.base[index], index };
  }
  for (const battlefield of game.battlefields) {
    const index = battlefield.units.findIndex((unit) => unit.type === "unit" && unit.instanceId === unitId);
    if (index >= 0) return { type: "battlefield", battlefield, unit: battlefield.units[index], index };
  }
  return null;
}

function findAnyUnitLocation(game, predicate) {
  for (const player of game.players) {
    const index = player.base.findIndex((unit) => unit.type === "unit" && predicate(unit));
    if (index >= 0) return { type: "base", player, unit: player.base[index], index };
  }
  for (const battlefield of game.battlefields) {
    const index = battlefield.units.findIndex((unit) => predicate(unit));
    if (index >= 0) return { type: "battlefield", battlefield, unit: battlefield.units[index], index };
  }
  return null;
}

function removeUnitFromSource(source) {
  if (source.type === "base") source.player.base.splice(source.index, 1);
  if (source.type === "battlefield") source.battlefield.units.splice(source.index, 1);
}

function updateBattlefieldControl(game) {
  if (!turnIsOpenState(game)) return false;
  let changed = false;
  for (const field of game.battlefields) {
    if (game.showdown?.battlefieldId === field.instanceId) continue;
    if (field.contestedBy || (game.stagedEvents || []).some((event) => event.battlefieldId === field.instanceId)) continue;
    const controllerStillPresent = field.controlledBy == null
      || field.units.some((unit) => unit.controllerId === field.controlledBy);
    if (!controllerStillPresent) {
      field.controlledBy = null;
      changed = true;
    }
  }
  return changed;
}

function turnIsOpenState(game) {
  if (game.actionChain && normalizeActionChainItems(game.actionChain).length > 0) return false;
  if (game.showdown && normalizeChainItems(game.showdown).length > 0) return false;
  if (game.triggerQueue?.length) return false;
  return true;
}

function cleanupLethalEntries(game) {
  const entries = [];
  for (const battlefield of game.battlefields) {
    const friendlyCounts = new Map();
    for (const unit of battlefield.units) {
      friendlyCounts.set(unit.controllerId, (friendlyCounts.get(unit.controllerId) || 0) + 1);
    }
    for (const unit of battlefield.units) {
      if (!isLethalDamage(game, unit) && !shouldKillDamagedUnit(game, unit)) continue;
      entries.push({
        unit,
        source: {
          type: "battlefield",
          battlefield,
          diedAloneOverride: friendlyCounts.get(unit.controllerId) === 1
        }
      });
    }
  }
  for (const player of game.players) {
    const baseUnits = player.base.filter((unit) => unit.type === "unit");
    const friendlyCounts = new Map();
    for (const unit of baseUnits) {
      friendlyCounts.set(unit.controllerId, (friendlyCounts.get(unit.controllerId) || 0) + 1);
    }
    for (const unit of baseUnits) {
      if (!isLethalDamage(game, unit) && !shouldKillDamagedUnit(game, unit)) continue;
      entries.push({
        unit,
        source: {
          type: "base",
          player,
          diedAloneOverride: friendlyCounts.get(unit.controllerId) === 1
        }
      });
    }
  }
  return entries;
}

function resolveCleanupLethalUnits(game, entries) {
  if (!entries.length) return false;
  const unitIds = entries.map((entry) => entry.unit.instanceId).sort();
  const signature = unitIds.join("|");
  if (game.cleanupDeathReplacementBatch?.signature !== signature) {
    game.cleanupDeathReplacementBatch = {
      signature,
      unitIds,
      candidatesByUnit: Object.fromEntries(entries.map((entry) => [
        entry.unit.instanceId,
        deathReplacementCandidates(game, entry.unit)
      ]))
    };
  }
  const candidateSnapshots = game.cleanupDeathReplacementBatch.candidatesByUnit;
  if (maybePromptSimultaneousDeathReplacement(game, entries.map((entry) => entry.unit), candidateSnapshots)) return true;

  const records = [];
  let changed = false;
  for (const entry of entries) {
    if (!findUnitLocation(game, entry.unit.instanceId)) continue;
    const replacement = resolveUnitDeathReplacement(game, entry.unit, entry.source, null, candidateSnapshots[entry.unit.instanceId] || []);
    if (replacement.pending) return true;
    if (replacement.replaced) {
      changed = true;
      continue;
    }
    if (!replacement.proceed) continue;
    const record = captureUnitDeath(game, entry.unit, entry.source, replacement.owner, replacement.controller);
    if (record) records.push(record);
  }
  if (game.deathReplacementPreference?.kind === "declineEvent") {
    delete game.deathReplacementPreference;
  }
  delete game.cleanupDeathReplacementBatch;

  const deathknellTriggers = records.flatMap((record) =>
    collectDeathknellTriggers(game, record.owner, record.deathSnapshot, record.diedAlone));
  queueDeathTriggers(game, deathknellTriggers);

  for (const record of records) moveKilledUnitToTrash(game, record);

  const postDeathTriggers = records.flatMap((record) =>
    collectPostDeathTriggers(game, record.owner, record.deathSnapshot));
  queueDeathTriggers(game, postDeathTriggers);
  resolveDamageKillFollowups(game, records);
  return changed || records.length > 0;
}

function resolveDamageKillFollowups(game, records) {
  if (!game.damageKillFollowups?.length || !records.length) return false;
  const killedEvents = new Set(records
    .map((record) => record.deathSnapshot.lastDamageEvent?.id)
    .filter(Boolean));
  const resolved = game.damageKillFollowups.filter((followup) => killedEvents.has(followup.damageEventId));
  game.damageKillFollowups = game.damageKillFollowups.filter((followup) => !killedEvents.has(followup.damageEventId));
  if (!game.damageKillFollowups.length) delete game.damageKillFollowups;
  const triggers = resolved.flatMap((followup, index) => {
    const actions = [];
    if (followup.draw) actions.push({ action: "draw", amount: followup.draw });
    if (followup.gainXp) actions.push({ action: "gainXp", amount: followup.gainXp });
    return actions.map((action, actionIndex) => ({
      kind: "reflexiveGameAction",
      playerId: followup.sourcePlayerId,
      sourceCardId: followup.sourceCardId,
      sourceCardSnapshot: followup.sourceCardSnapshot,
      simultaneousBatchId: `reflexive-${followup.damageEventId}-${index}-${actionIndex}`,
      data: action
    }));
  });
  if (triggers.length) {
    const mode = game.phase === "showdown" && game.showdown
      ? "showdownChain"
      : game.phase === "action" && game.interactive ? "actionChain" : "queue";
    prepareAndQueueTriggers(game, triggers, mode);
  }
  return resolved.length > 0;
}

function findActiveCardLocation(game, cardId) {
  for (const player of game.players) {
    if (player.legend?.instanceId === cardId) return { type: "legend", player, card: player.legend };
    const baseIndex = player.base.findIndex((card) => card.instanceId === cardId);
    if (baseIndex >= 0) return { type: "base", player, card: player.base[baseIndex], index: baseIndex };
    const runeIndex = player.runes.findIndex((card) => card.instanceId === cardId);
    if (runeIndex >= 0) return { type: "rune", player, card: player.runes[runeIndex], index: runeIndex };
  }
  for (const battlefield of game.battlefields) {
    const index = battlefield.units.findIndex((card) => card.instanceId === cardId);
    if (index >= 0) return { type: "battlefield", battlefield, card: battlefield.units[index], index };
    for (const unit of battlefield.units) {
      const attachmentIndex = (unit.attachments || []).findIndex((card) => card.instanceId === cardId);
      if (attachmentIndex >= 0) {
        return { type: "battlefield", battlefield, unit, card: unit.attachments[attachmentIndex], index: attachmentIndex };
      }
    }
  }
  return null;
}

function checkState(game) {
  if (game.resolvingChainContext || game.resolvingGameEffect) {
    requestCleanup(game, "chain-resolution-deferred");
    return;
  }
  if (["deathReplacementSource", "deathReplacementEvent", "preparedDeathRecallPayment"].includes(game.pendingChoice?.effect)) {
    return;
  }
  if (game.inCleanup) {
    requestCleanup(game, "cleanup-repeat");
    return;
  }
  game.cleanupOutstanding = false;
  let loops = 0;
  let changed = false;
  game.inCleanup = true;
  try {
    do {
      game.cleanupRequested = false;
      changed = false;
      recordRuleTask(game, "323.1", "check-victory", {
        resolvingChainContext: game.resolvingChainContext || null,
        resolvingGameEffect: Boolean(game.resolvingGameEffect)
      });
      if (checkVictory(game)) break;
      recordRuleTask(game, "323.2", "assign-combat-designations");
      if (cleanupCombatDesignations(game)) changed = true;
      if (applyEndingSpecialCleanup(game)) changed = true;
      recordRuleTask(game, "323.4", "capture-lethal-deathknells");
      recordRuleTask(game, "323.5", "kill-lethal-units");
      if (resolveCleanupLethalUnits(game, cleanupLethalEntries(game))) changed = true;
      if (game.pendingChoice) break;
      if (applyCombatSpecialCleanup(game)) changed = true;
      recordRuleTask(game, "323.6", "clear-empty-battlefield-control");
      if (updateBattlefieldControl(game)) changed = true;
      recordRuleTask(game, "323.7", "repair-board-locations-and-hidden");
      if (cleanupMislocatedBoardObjects(game)) changed = true;
      if (cleanupInvalidHiddenCards(game)) changed = true;
      if (game.pendingChoice) break;
      recordRuleTask(game, "323.8", "stage-contested-showdowns");
      recordRuleTask(game, "323.9", "stage-opposed-combats");
      recordRuleTask(game, "323.10", "remove-invalid-staged-combats");
      if (refreshStagedBattlefieldEvents(game)) changed = true;
      const showdownField = game.battlefields.find((field) => field.instanceId === game.showdown?.battlefieldId);
      recordRuleTask(game, "323.14", "upgrade-noncombat-showdown");
      if (showdownField && upgradeNonCombatShowdownIfOpposed(game, showdownField)) changed = true;
      if (changed || game.cleanupRequested) {
        requestCleanup(game, "cleanup-repeat", { completedPass: loops + 1 });
      }
      loops += 1;
    } while ((changed || game.cleanupRequested) && loops < 20 && game.phase !== "complete");
    if (!game.pendingChoice && !game.pendingPayment) completeCombatResolutionTask(game);
    if (!game.pendingChoice && !game.pendingPayment) delete game.damageKillFollowups;
  } finally {
    game.inCleanup = false;
    game.cleanupRequested = false;
    if (!game.pendingChoice && !game.pendingPayment) game.cleanupOutstanding = false;
  }

  if (loops >= 20) log(game, "Cleanup stopped after reaching the safety limit.");

  if (!game.pendingChoice && !game.pendingPayment && game.cleanupPendingTriggerBatches?.length) {
    const batches = game.cleanupPendingTriggerBatches.splice(0);
    if (game.endingCleanupProcess) game.endingCleanupProcess.itemsUnderwentFepr = true;
    const triggers = flattenTriggerBatches(batches);
    const continuation = combineTriggerContinuations(batches);
    const mode = game.phase === "showdown" && game.showdown
      ? "showdownChain"
      : game.phase === "action" && game.interactive
        ? "actionChain"
        : batches.at(-1)?.mode || "queue";
    prepareAndQueueTriggers(game, triggers, mode, continuation);
    if (game.pendingChoice || game.pendingPayment) return;
    if (finalizeOutstandingChainItems(game)) return;
    if (game.actionChain
      || (game.phase === "showdown" && game.showdown?.chain?.length)) return;
  }

  if (!game.pendingChoice && !game.pendingPayment && game.triggerQueue?.length) {
    resolveTriggerQueue(game);
  }

  if (!game.pendingChoice && !game.pendingPayment && !game.actionChain
    && !game.showdown?.chain?.length && !game.triggerQueue?.length
    && game.deferredTriggerContinuations?.length) {
    if (continueDeferredTriggerContinuations(game)) return;
  }

  if (!game.pendingChoice && !game.pendingPayment && finalizeOutstandingChainItems(game)) return;

  if (game.phase !== "complete" && !game.pendingChoice && !game.pendingPayment && !game.actionChain
    && !game.showdown && !game.triggerQueue?.length && !game.triggerQueueContinuation
    && game.showdownExitProcess) {
    completeShowdownExitTask(game);
    return;
  }

  if (game.phase === "action" && !game.pendingChoice && !game.pendingPayment && !game.actionChain) {
    if (resolveStagedEvents(game)) return;
  }

  if (game.phase === "action" && !game.showdown && game.endTurnProcess && !game.pendingChoice && !game.pendingPayment
    && !game.triggerQueue?.length && !game.triggerQueueContinuation && !game.actionChain) {
    continueEndTurnProcess(game, game.endTurnProcess.playerId);
    return;
  }

  if (game.phase === "action" && !game.showdown && game.pendingEndTurnPlayerId && !game.endTurnProcess && !game.pendingChoice && !game.pendingPayment
    && !game.triggerQueue?.length && !game.triggerQueueContinuation && !game.actionChain) {
    beginEndingPhase(game, game.pendingEndTurnPlayerId);
    return;
  }

  checkVictory(game);
}

function checkVictory(game) {
  if (game.phase === "complete") return true;
  const victoryScore = currentVictoryScore(game);
  for (const player of game.players) {
    const leadsEveryOpponent = game.players.every((opponent) => opponent.id === player.id || player.score > opponent.score);
    if (player.score >= victoryScore && leadsEveryOpponent) {
      game.phase = "complete";
      game.winnerId = player.id;
      log(game, `${player.name} wins at ${player.score} points.`);
      return true;
    }
  }
  return false;
}

function currentVictoryScore(game) {
  const modifier = game.battlefields.reduce((sum, battlefield) =>
    sum + staticEffectAmount(battlefield, "victoryScoreModifier", 0), 0);
  return game.victoryScore + modifier;
}

function cleanupCombatDesignations(game) {
  if (game.phase !== "showdown" || !game.showdown?.combat) return false;
  const battlefield = game.battlefields.find((field) => field.instanceId === game.showdown.battlefieldId);
  if (!battlefield) return false;
  let changed = false;
  const newlyDesignated = [];
  for (const field of game.battlefields) {
    if (field.instanceId === battlefield.instanceId) continue;
    for (const unit of field.units) {
      if (!unit.combatRole) continue;
      delete unit.combatRole;
      changed = true;
    }
  }
  for (const player of game.players) {
    for (const unit of player.base) {
      if (!unit.combatRole) continue;
      delete unit.combatRole;
      changed = true;
    }
  }
  for (const unit of battlefield.units) {
    const nextRole = unit.controllerId === game.showdown.attackerId
      ? "attacker"
      : unit.controllerId === game.showdown.defenderId
        ? "defender"
        : null;
    if (unit.combatRole === nextRole) continue;
    if (nextRole) {
      unit.combatRole = nextRole;
      newlyDesignated.push(unit);
    }
    else delete unit.combatRole;
    changed = true;
  }
  if (newlyDesignated.length) {
    const triggers = collectAttackOrDefendTriggers(game, battlefield, game.showdown.attackerId, newlyDesignated);
    if (triggers.length) prepareAndQueueTriggers(game, triggers, "showdownChain");
  }
  return changed;
}

function cleanupMislocatedBoardObjects(game) {
  let changed = false;
  for (const battlefield of game.battlefields) {
    for (let index = battlefield.units.length - 1; index >= 0; index -= 1) {
      const permanent = battlefield.units[index];
      if (permanent.type !== "gear") continue;
      const controller = game.players.find((player) => player.id === permanent.controllerId);
      if (!controller) continue;
      battlefield.units.splice(index, 1);
      controller.base.push(permanent);
      log(game, `${permanent.name} is unattached at a battlefield and recalls to ${controller.name}'s base.`);
      changed = true;
    }
  }
  for (const host of game.players) {
    for (let index = host.base.length - 1; index >= 0; index -= 1) {
      const permanent = host.base[index];
      const controller = game.players.find((player) => player.id === permanent.controllerId);
      if (!controller || controller.id === host.id) continue;
      host.base.splice(index, 1);
      controller.base.push(permanent);
      log(game, `${permanent.name} recalls from ${host.name}'s base to ${controller.name}'s base.`);
      changed = true;
    }
    for (let index = host.runes.length - 1; index >= 0; index -= 1) {
      const rune = host.runes[index];
      const controller = game.players.find((player) => player.id === rune.controllerId);
      if (!controller || controller.id === host.id) continue;
      host.runes.splice(index, 1);
      controller.runes.push(rune);
      log(game, `${rune.name || "Rune"} recalls from ${host.name}'s base to ${controller.name}'s base.`);
      changed = true;
    }
  }
  return changed;
}

function cleanupInvalidHiddenCards(game) {
  let changed = false;
  for (const field of game.battlefields) {
    const hidden = field.hidden || [];
    for (let index = hidden.length - 1; index >= 0; index -= 1) {
      const item = hidden[index];
      if (field.controlledBy === hiddenCardControllerId(item)) continue;
      const [removed] = hidden.splice(index, 1);
      trashFacedownCard(game, field, removed, "because its owner no longer controls the Battlefield");
      changed = true;
    }
    const overflow = Math.max(0, hidden.length - hiddenSlotLimit(field));
    if (!overflow) continue;
    if (game.interactive && hidden.length > overflow) {
      promptFacedownOverflowChoice(game, field, overflow);
      return true;
    }
    for (let count = 0; count < overflow; count += 1) {
      const removed = hidden.pop();
      if (removed) trashFacedownCard(game, field, removed, "because the Facedown Zone is over capacity");
    }
    changed = true;
  }
  return changed;
}

function promptFacedownOverflowChoice(game, battlefield, remaining) {
  const controller = game.players.find((player) => player.id === battlefield.controlledBy);
  if (!controller || remaining <= 0) return false;
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: controller.id,
    card: battlefield,
    effect: "cleanupFacedownOverflow",
    prompt: `Choose a Hidden card to put in trash from ${battlefield.name}.`,
    options: (battlefield.hidden || []).map((item) => ({
      id: item.card.instanceId,
      label: item.card.name,
      cardId: item.card.instanceId,
      card: item.card
    })),
    data: { battlefieldId: battlefield.instanceId, remaining },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
  requestCleanup(game, "board-zone-change", {
    battlefieldId: battlefield.instanceId,
    reason: "facedown-overflow-choice"
  });
  return true;
}

function trashFacedownCard(game, battlefield, item, reason) {
  if (!item?.card) return false;
  const owner = game.players.find((player) => player.id === item.card.ownerId);
  recordRevealEvent(game, owner, [item.card], battlefield, "facedown");
  item.card.hidden = false;
  markNonBoardZoneChange(item.card);
  owner?.trash.push(item.card);
  requestCleanup(game, "board-zone-change", {
    battlefieldId: battlefield.instanceId,
    cardId: item.card.instanceId,
    destination: "trash"
  });
  log(game, `${item.card.name} leaves Hidden ${reason}.`);
  return true;
}

function hasKeyword(card, keyword, game = null) {
  if (keywordListHas(card?.keywords, keyword)) return true;
  if (keywordListHas(card?.temporaryKeywords, keyword)) return true;
  if (!game) return false;
  const controller = controllerOfCard(game, card);
  for (const effect of cardEffects(card, "levelStatic")) {
    if (effect.kind !== "gainKeywords") continue;
    if ((controller?.xp || 0) < (effect.level || 0)) continue;
    if ((effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  }
  for (const effect of cardEffects(card, "static")) {
    if (effect.kind === "gainKeywordsWhileBuffed" && (card.buffs || 0) > 0
      && (effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
    if (effect.kind === "gainKeywordsIfDiscardedThisTurn" && (controller?.discardedCardsThisTurn || 0) > 0
      && (effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
    if (effect.kind === "gainKeywordsWhileMighty" && currentMightForMightyCondition(game, card) >= (effect.threshold || 5)
      && (effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  }
  if ((card.buffs || 0) > 0) {
    for (const source of allControlledCards(game, card.controllerId)) {
      if (source.instanceId === card.instanceId) continue;
      for (const effect of cardEffects(source, "static")) {
        if (effect.kind === "friendlyBuffedUnitsGainKeywords"
          && (effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
      }
    }
  }
  if (card.type === "unit") {
    for (const source of allControlledCards(game, card.controllerId)) {
      if (source.instanceId === card.instanceId) continue;
      for (const effect of cardEffects(source, "static")) {
        if (effect.kind === "otherFriendlyUnitsGainKeywords"
          && (effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
      }
    }
  }
  const location = findUnitLocation(game, card.instanceId);
  const battlefield = location?.type === "battlefield" ? location.battlefield : null;
  if (battlefield) {
    for (const effect of cardEffects(battlefield, "static")) {
      if (effect.kind === "unitsHereGainKeywords"
        && (effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
    }
    for (const source of battlefield.units) {
      if (source.controllerId !== card.controllerId || source.instanceId === card.instanceId) continue;
      for (const effect of cardEffects(source, "static")) {
        if (effect.kind === "otherFriendlyHereGainKeywords"
          && (effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
      }
    }
  }
  return false;
}

function keywordAmount(card, keyword, fallback = 1, game = null) {
  const printed = printedKeywordValue(card, keyword, fallback);
  const temporary = temporaryKeywordValue(card, keyword, fallback);
  const dynamic = dynamicKeywordInstanceCount(card, keyword, game);
  const total = printed + temporary + dynamic * fallback;
  return total;
}

function dynamicKeywordInstanceCount(card, keyword, game = null, options = {}) {
  if (!game) return 0;
  let count = 0;
  const controller = controllerOfCard(game, card);
  for (const effect of cardEffects(card, "levelStatic")) {
    if (effect.kind === "gainKeywords" && (controller?.xp || 0) >= (effect.level || 0)) {
      count += keywordListCount(effect.keywords, keyword);
    }
  }
  for (const effect of cardEffects(card, "static")) {
    if (effect.kind === "gainKeywordsWhileBuffed" && (card.buffs || 0) > 0) count += keywordListCount(effect.keywords, keyword);
    if (effect.kind === "gainKeywordsIfDiscardedThisTurn" && (controller?.discardedCardsThisTurn || 0) > 0) count += keywordListCount(effect.keywords, keyword);
    if (!options.excludeSelfMighty && effect.kind === "gainKeywordsWhileMighty"
      && currentMightForMightyCondition(game, card) >= (effect.threshold || 5)) count += keywordListCount(effect.keywords, keyword);
  }
  if ((card.buffs || 0) > 0) {
    for (const source of allControlledCards(game, card.controllerId)) {
      if (source.instanceId === card.instanceId) continue;
      for (const effect of cardEffects(source, "static")) {
        if (effect.kind === "friendlyBuffedUnitsGainKeywords") count += keywordListCount(effect.keywords, keyword);
      }
    }
  }
  if (card.type === "unit") {
    for (const source of allControlledCards(game, card.controllerId)) {
      if (source.instanceId === card.instanceId) continue;
      for (const effect of cardEffects(source, "static")) {
        if (effect.kind === "otherFriendlyUnitsGainKeywords") count += keywordListCount(effect.keywords, keyword);
      }
    }
  }
  const location = findUnitLocation(game, card.instanceId);
  const battlefield = location?.type === "battlefield" ? location.battlefield : null;
  if (battlefield) {
    for (const effect of cardEffects(battlefield, "static")) {
      if (effect.kind === "unitsHereGainKeywords") count += keywordListCount(effect.keywords, keyword);
    }
    for (const source of battlefield.units) {
      if (source.controllerId !== card.controllerId || source.instanceId === card.instanceId) continue;
      for (const effect of cardEffects(source, "static")) {
        if (effect.kind === "otherFriendlyHereGainKeywords") count += keywordListCount(effect.keywords, keyword);
      }
    }
  }
  return count;
}

function fail(game, message) {
  log(game, message);
  return { ok: false, message };
}

function log(game, message) {
  game.log.unshift(message);
  game.log = game.log.slice(0, 18);
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

function requestCleanup(game, cause, data = {}) {
  const ruleId = CLEANUP_REQUEST_RULES[cause];
  if (!ruleId) throw new Error(`Unknown cleanup request cause: ${cause}`);
  game.cleanupOutstanding = true;
  if (game.inCleanup) game.cleanupRequested = true;
  game.cleanupRequestTrace ||= [];
  game.nextCleanupRequestSequence = (game.nextCleanupRequestSequence || 0) + 1;
  game.cleanupRequestTrace.push({
    sequence: game.nextCleanupRequestSequence,
    ruleId,
    cause,
    duringCleanup: Boolean(game.inCleanup),
    duringResolution: Boolean(game.resolvingChainContext || game.resolvingGameEffect),
    ...structuredClone(data)
  });
  if (game.cleanupRequestTrace.length > 512) {
    game.cleanupRequestTrace.splice(0, game.cleanupRequestTrace.length - 512);
  }
  return true;
}

function recordRuleTask(game, ruleId, task, data = {}) {
  game.ruleTaskTrace ||= [];
  game.nextRuleTaskSequence = (game.nextRuleTaskSequence || 0) + 1;
  game.ruleTaskTrace.push({
    sequence: game.nextRuleTaskSequence,
    ruleId,
    task,
    ...data
  });
  if (game.ruleTaskTrace.length > 512) game.ruleTaskTrace.splice(0, game.ruleTaskTrace.length - 512);
}
