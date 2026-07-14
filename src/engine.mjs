import { decklists } from "./cards.mjs";

import { cards as cardRegistry } from "./cards.mjs";
import { TARGET_PROVIDERS, spellTargetDeclaration } from "./effects/registry.mjs";
import {
  cardEffects,
  firstCardEffect,
  hasAnyEffect,
  hasStaticEffect,
  replacementEffect,
  staticEffectAmount
} from "./effects/runtime.mjs";
import { championMatchesLegend, createPlayers, isChampionCard } from "./engine/setup.mjs";

export function createGame(options = {}) {
  const sourceDecks = Array.isArray(options.decks) && options.decks.length >= 2
    ? options.decks
    : [decklists.keenanXiong, decklists.drowsy];
  const players = createPlayers(sourceDecks);
  const firstPlayerId = options.firstPlayerId
    || (options.randomFirstPlayer ? players[Math.floor(Math.random() * players.length)].id : players[0].id);
  const firstPlayer = players.find((player) => player.id === firstPlayerId) || players[0];
  const turnOrder = [
    firstPlayer.id,
    ...players.filter((player) => player.id !== firstPlayer.id).map((player) => player.id)
  ];
  const game = {
    mode: "duel",
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
    enforceChampionLegendMatch: Boolean(options.enforceChampionLegendMatch),
    battlefields: [],
    mulligan: null,
    showdown: null,
    actionChain: null,
    pendingPayment: null,
    pendingChoice: null,
    triggerQueue: [],
    triggerQueueContinuation: null,
    stagedEvents: [],
    operations: [],
    lifecycleEvents: [],
    nextOperationSequence: 0,
    revealedIntel: [],
    effectFlash: null,
    selectedCardId: players[0].legend.instanceId,
    log: []
  };
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

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function selectBattlefield(game, playerId, battlefieldId) {
  if (game.phase !== "battlefield-select") return fail(game, "Battlefield selection is already complete.");
  if (game.setupPlayerId !== playerId) return fail(game, "It is not that player's battlefield selection.");
  const player = game.players.find((candidate) => candidate.id === playerId);
  const chosen = player.availableBattlefields.find((field) => field.instanceId === battlefieldId || field.id === battlefieldId);
  if (!chosen) return fail(game, "Unknown battlefield.");

  player.selectedBattlefieldId = chosen.instanceId;
  game.battlefields.push({
    ...chosen,
    controlledBy: null,
    units: [],
    hidden: []
  });
  game.selectedCardId = chosen.instanceId;
  log(game, `${player.name} chooses ${chosen.name}.`);

  const next = turnOrderedPlayers(game).find((candidate) => !candidate.selectedBattlefieldId);
  if (next) {
    game.setupPlayerId = next.id;
    return { ok: true };
  }

  game.setupPlayerId = null;
  log(game, "Battlefields are set. Each player may mulligan up to 2 cards.");
  beginMulligans(game);
  return { ok: true };
}

export function selectChampion(game, playerId, championId) {
  if (game.phase !== "champion-select") return fail(game, "Champion selection is already complete.");
  if (game.championSelectPlayerId !== playerId) return fail(game, "It is not that player's champion selection.");
  const player = game.players.find((candidate) => candidate.id === playerId);
  const index = player.availableChampions.findIndex((card) => card.instanceId === championId || card.id === championId);
  if (index < 0) return fail(game, "Unknown champion.");
  if (game.enforceChampionLegendMatch && !championMatchesLegend(player.availableChampions[index], player.legend)) return fail(game, "Chosen Champion must share a Champion tag with the current Legend.");

  const [chosen] = player.availableChampions.splice(index, 1);
  chosen.zone = "champion";
  player.champion = chosen;
  player.chosenChampionName = chosen.name;
  player.mainDeck.push(...player.availableChampions);
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
    candidate.mainDeck = shuffle(candidate.mainDeck);
    candidate.runeDeck = shuffle(candidate.runeDeck);
    draw(candidate, 4);
  }
  game.phase = "battlefield-select";
  log(game, "Each player chooses one starting battlefield.");
  if (game.forcedBattlefieldSelections) {
    for (const candidate of turnOrderedPlayers(game)) {
      const cardNumber = game.forcedBattlefieldSelections[candidate.id];
      const battlefield = candidate.availableBattlefields.find((field) => field.cardNumber === cardNumber || field.collectorNumber === cardNumber);
      if (!battlefield) return fail(game, "The Battlefield locked after a draw is not registered.");
      const result = selectBattlefield(game, candidate.id, battlefield.instanceId);
      if (!result.ok) return result;
    }
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
  recycleMainDeckCards(player, bottomed);
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

  // "This turn" Might modifiers are tracked separately so permanent buffs survive.
  for (const candidate of game.players) {
    for (const card of allControlledCards(game, candidate.id)) {
      if (!card.temporaryMight) continue;
      card.buffs = (card.buffs || 0) - card.temporaryMight;
      delete card.temporaryMight;
    }
  }

  for (const card of allControlledCards(game, player.id)) {
    card.exhausted = false;
    card.stunned = false;
    card.cantMoveThisTurn = false;
    delete card.temporaryKeywords;
    delete card.temporaryShieldAmount;
    delete card.movesThisTurn;
    delete card.readyAnotherExhaustedMoveTurnSequence;
  }
  player.legend.exhausted = false;
  if (player.champion) player.champion.exhausted = false;
  for (const candidate of game.players) {
    candidate.runes = candidate.runes.filter((rune) => !rune.temporaryResource);
    if (candidate.id !== player.id) clearRunePool(candidate);
  }
  for (const rune of player.runes) rune.exhausted = false;

  log(game, `${player.name} starts turn ${game.turnNumber}.`);
  triggerFirstBeginningEffects(game, player);
  triggerBeginningEffects(game, player);
  destroyTemporaryGear(game, player);
  scoreHoldingBattlefields(game, player);

  const isLastPlayerFirstTurn = !player.hasTakenFirstTurn && player.id === turnOrderedPlayers(game).at(-1)?.id;
  channel(player, isLastPlayerFirstTurn ? 3 : 2);
  draw(player, 1, game);
  player.hasTakenFirstTurn = true;
  checkState(game);
}

export function endTurn(game) {
  if (game.pendingPayment || game.pendingChoice || game.actionChain) return fail(game, "Finish the current chain first.");
  if (game.phase !== "action") return fail(game, "The game is not in the action phase.");
  const player = currentPlayer(game);
  game.pendingEndTurnPlayerId = player.id;
  triggerEndTurnEffects(game, player);
  if (game.pendingChoice || game.pendingPayment || game.triggerQueue?.length || game.triggerQueueContinuation || game.actionChain) {
    return { ok: true };
  }
  finishPendingEndTurn(game);
  return { ok: true };
}

function finishPendingEndTurn(game) {
  const playerId = game.pendingEndTurnPlayerId;
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  game.currentPlayerId = playerId;
  delete game.pendingEndTurnPlayerId;
  clearTurnIntel(game, game.turnSequence);
  clearRunePool(player);
  for (const unit of allUnits(game)) {
    unit.damage = 0;
    unit.stunned = false;
  }
  log(game, `${player.name} ends the turn. All units heal.`);

  const ordered = turnOrderedPlayers(game);
  const currentIndex = ordered.findIndex((candidate) => candidate.id === player.id);
  if (game.extraTurnPlayerId) {
    game.currentPlayerId = game.extraTurnPlayerId;
    delete game.extraTurnPlayerId;
  } else {
    const nextIndex = (currentIndex + 1) % ordered.length;
    if (nextIndex === 0) game.turnNumber += 1;
    game.currentPlayerId = ordered[nextIndex].id;
  }
  startTurn(game);
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
  if (game.pendingPayment || game.pendingChoice || game.actionChain) return fail(game, "Finish the current choice first.");
  const player = currentPlayer(game);
  if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
  if (!player.champion) return fail(game, "Choose a champion first.");
  if (player.championPlayed || player.champion.zone === "played") return fail(game, "Champion has already been played.");
  if (!canPay(game, player, player.champion)) return fail(game, "Not enough ready runes or matching Power.");
  payCost(game, player, player.champion);
  player.championPlayed = true;
  player.champion.zone = "played";
  return putPermanentIntoPlay(game, player, player.champion, destination, true);
}

export function playCard(game, cardId, destination = "base") {
  if (game.pendingPayment || game.pendingChoice) return fail(game, "Finish the current choice first.");
  if (game.phase === "showdown") return playShowdownCard(game, cardId, destination);
  if (game.phase !== "action") return fail(game, "You must finish setup before playing cards.");
  const player = currentPlayer(game);
  if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
  const cardIndex = player.hand.findIndex((card) => card.instanceId === cardId);
  if (cardIndex < 0) return fail(game, "That card is not in hand.");
  const card = player.hand[cardIndex];
  if (!hasRequiredPlayTargets(game, player, card, destination)) return fail(game, `${card.name} has no legal target.`);
  if (!canPay(game, player, card)) return fail(game, "Not enough ready runes or matching Power.");

  payCost(game, player, card);
  player.hand.splice(cardIndex, 1);
  player.cardsPlayedThisTurn += 1;
  game.selectedCardId = card.instanceId;
  return resolvePaidCard(game, player, card, destination);
}

export function beginPlayCard(game, cardId, destination = "base") {
  if (!game.interactive) return playCard(game, cardId, destination);
  if (game.pendingPayment || game.pendingChoice) return fail(game, "Finish the current choice first.");
  if (game.phase !== "action" && game.phase !== "showdown") return fail(game, "You cannot play cards during this phase.");
  const player = currentPlayer(game);
  if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
  const card = player.hand.find((candidate) => candidate.instanceId === cardId);
  if (!card) {
    const hidden = findHiddenCardLocation(game, cardId);
    if (hidden) return playHiddenCard(game, hidden, destination);
    return fail(game, "That card is not in hand.");
  }
  if (game.phase === "showdown" && !canPlayInShowdown(game, player, card, game.showdown, destination)) {
    return fail(game, "That card cannot be played now.");
  }
  if (game.phase === "action" && game.actionChain && !canPlayInActionChain(game, player, card)) {
    return fail(game, "Only Reactions can be played onto an existing chain.");
  }
  if (!hasRequiredPlayTargets(game, player, card, destination)) return fail(game, `${card.name} has no legal target.`);
  if (promptPlayTargetDeclaration(game, player, card, destination, "hand")) return { ok: true };
  game.pendingPayment = createPayment(game, player, card, destination, "hand");
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} is paying for ${card.name}.`);
  return { ok: true };
}

export function hideCard(game, cardId, battlefieldId) {
  if (game.pendingPayment || game.pendingChoice || game.actionChain) return fail(game, "Finish the current choice first.");
  if (game.phase !== "action") return fail(game, "Cards can only be hidden during your action phase.");
  const player = currentPlayer(game);
  const cardIndex = player.hand.findIndex((candidate) => candidate.instanceId === cardId);
  if (cardIndex < 0) return fail(game, "That card is not in hand.");
  const card = player.hand[cardIndex];
  if (!hasKeyword(card, "Hidden", game)) return fail(game, "That card does not have Hidden.");
  const battlefield = game.battlefields.find((field) => field.instanceId === battlefieldId || field.id === battlefieldId);
  if (!battlefield || battlefield.controlledBy !== player.id) return fail(game, "You can only hide at a battlefield you control.");
  battlefield.hidden ||= [];
  if (hiddenCardsAtBattlefieldForPlayer(battlefield, player.id) >= hiddenSlotLimit(battlefield)) {
    return fail(game, "You already have the maximum number of hidden cards there.");
  }
  if (!payAdditionalPower(player, { domain: "Any", amount: 1 }, true)) return fail(game, "Not enough Power to hide that card.");
  game.pendingPayment = {
    playerId: player.id,
    cardId: card.instanceId,
    cardName: card.name,
    destination: battlefield.instanceId,
    source: "hideCard",
    energyCost: 0,
    basePowerCost: [{ domain: "Any", amount: 1 }],
    powerCost: [{ domain: "Any", amount: 1 }],
    declaredTargets: [],
    declaredChoices: [],
    deflectTargetIds: [],
    optionalPowerEffects: [],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: []
  };
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} is paying to hide a card at ${battlefield.name}.`);
  return { ok: true };
}

function finishHidingCard(game, player, card, battlefield) {
  const cardIndex = player.hand.findIndex((candidate) => candidate.instanceId === card.instanceId);
  if (cardIndex < 0) return fail(game, "That card is not in hand.");
  player.hand.splice(cardIndex, 1);
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
  return (battlefield?.hidden || []).filter((item) => item.ownerId === playerId).length;
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

export function activateCard(game, cardId) {
  const player = currentPlayer(game);
  const card = findCard(game, cardId);
  if (!card || card.controllerId !== player.id) return fail(game, "You cannot activate that card.");
  const specs = cardEffects(card, "activated");
  const paymentAddAbility = canActivateAddDuringPayment(game, player, card, specs);
  if ((game.pendingPayment || game.pendingChoice) && !paymentAddAbility) return fail(game, "Finish the current choice first.");
  const actionChainAddAbility = canActivateAddDuringActionChain(game, player, card, specs);
  const reactionAbility = canActivateReactionAbility(game, player, card, specs);
  const forgeAbility = canUseForgeLegendAbility(game, player, card);
  const usingForgeAbility = forgeAbility && (game.phase === "action" || !specs.length);
  if (!specs.length && !forgeAbility) return fail(game, "That card has no activated ability.");
  if (card.exhausted) return fail(game, "That card is exhausted.");
  if (game.actionChain && !actionChainAddAbility && !canActivateInActionChain(game, player, card)) {
    return fail(game, "Only Reaction abilities can be used on an existing chain.");
  }
  if (!paymentAddAbility && !reactionAbility && usingForgeAbility && game.phase !== "action") return fail(game, "That ability can only be used during your action phase.");
  if (!paymentAddAbility && !reactionAbility && !usingForgeAbility && card.type === "legend" && game.phase !== "showdown") return fail(game, "That ability can only be used during a showdown.");
  if (!paymentAddAbility && !reactionAbility && card.type !== "legend" && game.phase !== "action") return fail(game, "That ability cannot be used now.");
  if (!paymentAddAbility && !reactionAbility && game.phase === "showdown" && !canActivateInShowdownChain(game, player, card)) {
    return fail(game, "That activated ability cannot be used with the current showdown priority.");
  }
  if (game.interactive && !card.activationDeclarationReady) {
    if (specs.some((spec) => spec.kind === "udyrChooseMode")) {
      if ((card.buffs || 0) <= 0) return fail(game, `${card.name} has no buff to spend.`);
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
    if (!declaration && requiredTargetSpec) return fail(game, `${card.name} has no legal activation target.`);
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
  delete card.activationDeclarationReady;
  if (card.udyrActivationCostPending) {
    if ((card.buffs || 0) <= 0) return fail(game, `${card.name} has no buff to spend.`);
    card.buffs -= 1;
    delete card.udyrActivationCostPending;
  }
  const activatedCost = activatedAbilityCost(specs);
  if (activatedCost && game.interactive) {
    game.pendingPayment = createActivatedPayment(player, card, specs, activatedCost);
    game.selectedCardId = card.instanceId;
    log(game, `${player.name} is paying to activate ${card.name}.`);
    return { ok: true };
  }
  if (activatedCost && !payActivatedCostAutomatically(game, player, activatedCost)) {
    return fail(game, "Not enough ready runes to activate that ability.");
  }
  if (activatedAbilityExhausts(specs)) card.exhausted = true;
  game.selectedCardId = card.instanceId;
  log(game, `${player.name} activates ${card.name}.`);
  if ((reactionAbility || paymentAddAbility) && isNonReactiveAddAbility(specs)) {
    resolveEffectSpecs(game, player, card, specs, false);
    if (game.actionChain) game.actionChain.consecutivePasses = 0;
    if (game.showdown) game.showdown.consecutivePasses = 0;
    checkState(game);
    return { ok: true };
  }
  if (!paymentAddAbility && game.phase === "showdown" && game.showdown && isNonReactiveAddAbility(specs)) {
    resolveEffectSpecs(game, player, card, specs, false);
    game.showdown.consecutivePasses = 0;
    checkState(game);
    return { ok: true };
  }
  if (!paymentAddAbility && game.actionChain) {
    addPendingActivatedChainItem(game.actionChain, card, player.id, specs);
    game.actionChain.consecutivePasses = 0;
    log(game, `${player.name} adds ${card.name}'s ability to the chain.`);
    giveActionChainPriority(game, otherActionChainPlayerId(game.actionChain, player.id));
    return { ok: true };
  }
  if (!paymentAddAbility && game.phase === "showdown" && game.showdown) {
    addPendingActivatedChainItem(game.showdown, card, player.id, specs);
    game.showdown.consecutivePasses = 0;
    log(game, `${player.name} adds ${card.name}'s ability to the showdown chain.`);
    giveShowdownPriority(game, otherShowdownPlayerId(game.showdown, player.id));
    return { ok: true };
  }
  if (!paymentAddAbility && reactionAbility && game.phase === "action") {
    const chain = ensureActionChain(game, player.id);
    addPendingActivatedChainItem(chain, card, player.id, specs);
    chain.consecutivePasses = 0;
    log(game, `${player.name} adds ${card.name}'s ability to the chain.`);
    giveActionChainPriority(game, otherActionChainPlayerId(chain, player.id));
    maybeAutoPassActionChain(game);
    return { ok: true };
  }
  if (usingForgeAbility) return chooseForgeAttachGear(game, player, card) ? { ok: true } : (checkState(game), { ok: true });
  return resolveEffectSpecs(game, player, card, specs, false) ? { ok: true } : (checkState(game), { ok: true });
}

function activatedTargetDeclaration(game, player, card, specs) {
  const spec = specs.find((candidate) => activatedChoiceEffect(candidate));
  if (!spec) return null;
  const effect = activatedChoiceEffect(spec);
  let targets = [];
  if (["buffUnit", "giveKeyword", "modifyMight", "saveFriendlyUnitThisTurn", "moveUnitSpellTarget"].includes(effect)) {
    targets = allUnits(game)
      .filter((unit) => !["friendlyUnit", "exhaustedFriendlyUnit", "anotherUnit"].includes(spec.target) || unit.controllerId === player.id)
      .filter((unit) => spec.target !== "anotherUnit" || unit.instanceId !== card.instanceId)
      .filter((unit) => spec.target !== "exhaustedFriendlyUnit" || unit.exhausted)
      .filter((unit) => canChooseUnit(game, player, card, unit));
  } else if (["damageUnit", "stunUnit"].includes(effect)) {
    const scope = spec.target === "unit" ? "any" : spec.target === "friendlyUnit" ? "friendly" : "enemy";
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
      ...game.battlefields.flatMap((field) => (field.hidden || []).filter((hidden) => hidden.ownerId === player.id).map((hidden) => hidden.card))
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

function canActivateReactionAbility(game, player, card, specs) {
  if (!card || card.controllerId !== player.id || card.exhausted) return false;
  if (!isReactionAbility(card, specs)) return false;
  if (game.pendingPayment) return canActivateAddDuringPayment(game, player, card, specs);
  if (game.pendingChoice) return false;
  if (game.actionChain) return canActivateInActionChain(game, player, card);
  if (game.phase === "showdown" && game.showdown) return canActivateInShowdownChain(game, player, card);
  return game.phase === "action" && game.currentPlayerId === player.id;
}

function isReactionAbility(card, specs) {
  if (!card.tags?.includes("Reaction") && !card.keywords?.includes("Reaction")) return false;
  return specs.length > 0;
}

function canActivateInShowdownChain(game, player, card) {
  if (game.pendingPayment || game.pendingChoice) return false;
  if (game.phase !== "showdown" || !game.showdown) return false;
  if (game.showdown.priorityPlayerId !== player.id) return false;
  if (!card.tags?.includes("Reaction") && !card.keywords?.includes("Reaction")) return false;
  return cardEffects(card, "activated").length > 0;
}

function canActivateInActionChain(game, player, card) {
  if (game.pendingPayment || game.pendingChoice) return false;
  if (game.phase !== "action" || !game.actionChain) return false;
  if (game.actionChain.priorityPlayerId !== player.id) return false;
  if (!card.tags?.includes("Reaction") && !card.keywords?.includes("Reaction")) return false;
  return cardEffects(card, "activated").length > 0;
}

function canActivateAddDuringPayment(game, player, card, specs) {
  if (!game.pendingPayment || game.pendingChoice) return false;
  if (game.pendingPayment.playerId !== player.id) return false;
  if (!card || card.controllerId !== player.id || card.exhausted) return false;
  if (!card.tags?.includes("Reaction") && !card.keywords?.includes("Reaction")) return false;
  const paidCard = paymentCard(player, game.pendingPayment);
  return specs.length > 0 && specs.every((spec) =>
    spec.kind === "addEnergy"
    && (spec.restriction !== "spell" || paidCard?.type === "spell")
    && (!spec.requiresLegion || player.cardsPlayedThisTurn > 0)
  );
}

function canActivateAddDuringActionChain(game, player, card, specs) {
  if (game.pendingPayment || game.pendingChoice) return false;
  if (game.phase !== "action" || !game.actionChain) return false;
  if (game.actionChain.priorityPlayerId !== player.id) return false;
  if (!card || card.controllerId !== player.id || card.exhausted) return false;
  if (!card.tags?.includes("Reaction") && !card.keywords?.includes("Reaction")) return false;
  return specs.length > 0 && specs.every((spec) =>
    spec.kind === "addEnergy"
    && (!spec.requiresLegion || player.cardsPlayedThisTurn > 0)
  );
}

function activatedAbilityCost(specs) {
  const energy = specs.reduce((sum, spec) => sum + (spec.costEnergy || 0), 0);
  const power = specs.flatMap((spec) => spec.costPower || []);
  const recycleTrash = specs.reduce((sum, spec) => sum + (spec.costRecycleTrash || 0), 0);
  if (energy <= 0 && totalPowerAmount(power) <= 0 && recycleTrash <= 0) return null;
  return { energy, power, recycleTrash };
}

function payActivatedCostAutomatically(game, player, cost) {
  const readyRunes = player.runes.filter((rune) => !rune.exhausted);
  if (readyRunes.length < (cost.energy || 0)) return false;
  if (!choosePowerRunes(player.runes, cost.power || [])) return false;
  if ((player.trash?.length || 0) < (cost.recycleTrash || 0)) return false;
  for (const rune of readyRunes.slice(0, cost.energy || 0)) rune.exhausted = true;
  const powerRunes = choosePowerRunes(player.runes, cost.power || []) || [];
  payChosenPowerRunes(player, powerRunes);
  payRecycleTrashCost(player, cost.recycleTrash || 0);
  return true;
}

function activatedAbilityExhausts(specs) {
  return specs.some((spec) => spec.exhaust !== false);
}

function payRecycleTrashCost(player, amount = 0) {
  if (amount <= 0) return true;
  if ((player.trash?.length || 0) < amount) return false;
  const recycled = player.trash.splice(0, amount);
  recycleMainDeckCards(player, recycled);
  return true;
}

function isNonReactiveAddAbility(specs) {
  return specs.length > 0 && specs.every((spec) => spec.kind === "addEnergy");
}

export function beginPlayChampion(game, destination = "base") {
  if (!game.interactive) return playChampion(game, destination);
  if (game.pendingPayment || game.pendingChoice || game.actionChain) return fail(game, "Finish the current choice first.");
  if (game.phase !== "action") return fail(game, "You cannot play your champion during this phase.");
  const player = currentPlayer(game);
  if (!player.champion) return fail(game, "Choose a champion first.");
  if (player.championPlayed || player.champion.zone === "played") return fail(game, "Champion has already been played.");
  game.pendingPayment = createPayment(game, player, player.champion, destination, "champion");
  game.selectedCardId = player.champion.instanceId;
  log(game, `${player.name} is paying for ${player.champion.name}.`);
  return { ok: true };
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
      if (power.size >= totalPowerAmount(payment.powerCost || card.power || [])) return fail(game, "That Power cost is already fully selected.");
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

export function toggleOptionalPaymentEffect(game, effectId) {
  const payment = game.pendingPayment;
  if (!payment) return fail(game, "No payment is pending.");
  const effect = (payment.optionalPowerEffects || []).find((candidate) => candidate.id === effectId);
  if (!effect) return fail(game, "Unknown optional cost.");
  effect.selected = !effect.selected;
  payment.powerCost = paymentPowerCost(payment);
  payment.powerRuneIds = payment.powerRuneIds.filter((runeId) => {
    const player = game.players.find((candidate) => candidate.id === payment.playerId);
    const rune = player?.runes.find((candidate) => candidate.instanceId === runeId);
    return rune && runeCanPayPower(rune, payment.powerCost);
  });
  return { ok: true };
}

export function cancelPayment(game) {
  if (!game.pendingPayment) return fail(game, "No payment is pending.");
  const payment = game.pendingPayment;
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  log(game, `${player.name} cancels payment.`);
  game.pendingPayment = null;
  if (payment.source === "effectEnergy") resolveEffectEnergyPaymentCancel(game, payment);
  if (!game.pendingChoice && (game.triggerQueue?.length || game.triggerQueueContinuation)) resolveTriggerQueue(game);
  return { ok: true };
}

export function confirmPayment(game) {
  const payment = game.pendingPayment;
  if (!payment) return fail(game, "No payment is pending.");
  const player = game.players.find((candidate) => candidate.id === payment.playerId);
  const card = paymentCard(player, payment);
  if (!card) return fail(game, "Card to pay for is no longer available.");
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

  applyManualPayment(player, payment);
  if (additionalCostUnit) additionalCostUnit.exhausted = true;
  if (buffCostUnit) buffCostUnit.buffs -= 1;
  if (discardCostIndex >= 0) {
    const [discarded] = player.hand.splice(discardCostIndex, 1);
    player.trash.push(discarded);
    player.discardedCardsThisTurn = (player.discardedCardsThisTurn || 0) + 1;
    triggerDiscardEffects(game, player, [discarded], card);
    log(game, `${player.name} discards ${discarded.name} as an additional cost for ${card.name}.`);
  }
  if (killCostUnit) {
    killUnit(game, killCostUnit, findUnitLocation(game, killCostUnit.instanceId));
    log(game, `${player.name} kills ${killCostUnit.name} as an additional cost for ${card.name}.`);
  }
  for (const unit of killedCostUnits) killUnit(game, unit, findUnitLocation(game, unit.instanceId));
  for (const [unitId, amount] of buffSpendCounts) findCard(game, unitId).buffs -= amount;
  if (payment.source === "hideCard") {
    game.pendingPayment = null;
    return finishHidingCard(game, player, card, hiddenBattlefield);
  }
  if (payment.source === "effectEnergy") {
    game.pendingPayment = null;
    resolveEffectEnergyPayment(game, player, card, payment);
    if (!game.pendingChoice && (game.triggerQueue?.length || game.triggerQueueContinuation)) resolveTriggerQueue(game);
    checkState(game);
    return { ok: true };
  }
  if (payment.source === "activatedAbility") {
    game.pendingPayment = null;
    if (!payRecycleTrashCost(player, payment.recycleTrashCost || 0)) return fail(game, "Not enough cards in trash to activate that ability.");
    if (activatedAbilityExhausts(payment.activatedAbility?.specs || [])) card.exhausted = true;
    game.selectedCardId = card.instanceId;
    log(game, `${player.name} activates ${card.name}.`);
    resolveEffectSpecs(game, player, card, payment.activatedAbility?.specs || [], false);
    if (!game.pendingChoice && (game.triggerQueue?.length || game.triggerQueueContinuation)) resolveTriggerQueue(game);
    checkState(game);
    return { ok: true };
  }
  if (payment.source === "trashSpell") {
    game.pendingPayment = null;
    resolvePaidTrashSpell(game, player, card, payment);
    if (!game.pendingChoice && (game.triggerQueue?.length || game.triggerQueueContinuation)) resolveTriggerQueue(game);
    checkState(game);
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
  card.paidFriendlyExhaustAdditionalCost = Boolean(additionalCostUnit);
  game.pendingPayment = null;

  if (payment.source === "champion") {
    if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
    player.championPlayed = true;
    player.champion.zone = "played";
    return putPermanentIntoPlay(game, player, player.champion, payment.destination, true);
  }

  const cardIndex = player.hand.findIndex((candidate) => candidate.instanceId === payment.cardId);
  if (cardIndex < 0) return fail(game, "That card is not in hand.");
  if (!canPlayerPlayCards(game, player)) return fail(game, "That player cannot play cards this turn.");
  card.declaredPlayTargets = structuredClone(payment.declaredTargets || []);
  card.declaredPlayChoices = structuredClone(payment.declaredChoices || []);
  card.deflectPaidTargetIds = [...(payment.deflectTargetIds || [])];
  player.hand.splice(cardIndex, 1);
  player.cardsPlayedThisTurn += 1;
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

function putPermanentIntoPlay(game, player, card, destination, isChampion) {
  const battlefield = game.battlefields.find((field) => field.instanceId === destination || field.id === destination);
  if (card.type === "unit" && battlefield && !canEnterBattlefield(game, player, card, battlefield)) {
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
  } else if (card.type === "gear") {
    card.exhausted = false;
    player.base.push(card);
    log(game, `${player.name} plays gear ${card.name}.`);
  }
  return { ok: true };
}

function unitEntersReady(game, player, card) {
  if (hasPaidOptionalKind(card, "accelerate")) return true;
  if (hasStaticEffect(card, "entersReady")) return true;
  if (hasStaticEffect(card, "enterReadyIfOpponentControlsBattlefield") && game.battlefields.some((field) => field.controlledBy && field.controlledBy !== player.id)) {
    return true;
  }
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
    attachments: []
  };
}

function cardByNumber(number) {
  return Object.values(cardRegistry).find((card) => card.cardNumber === number || card.collectorNumber === number || card.id === number);
}

export function playUnitToken(game, player, source, spec = {}, destination = null) {
  const tokenSource = cardByNumber(spec.tokenCardNumber || "OGN-273/298");
  if (!tokenSource) {
    log(game, `${source.name} could not find token ${spec.tokenCardNumber || "OGN-273/298"}.`);
    return false;
  }
  const count = Math.max(1, spec.count || 1);
  const played = [];
  for (let index = 0; index < count; index += 1) {
    const token = createCardInstance(game, tokenSource, player.id);
    token.exhausted = !Boolean(spec.ready);
    const targetDestination = destination || tokenDestinationFromSpec(game, player, source, spec);
    placeTokenAtDestination(game, player, source, token, targetDestination);
    played.push(token);
  }
  markEffect(game, source, [source.instanceId, ...played.map((token) => token.instanceId)], `${source.name} plays ${played.length} token${played.length === 1 ? "" : "s"}.`);
  return played.length > 0;
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
    log(game, `${source.name} plays ${token.name} into ${player.name}'s base.`);
    return;
  }
  battlefield.units.push(token);
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
    if (source.type === "battlefield" && destination && !hasKeyword(source.unit, "Ganking", game)) {
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
  for (const unitId of uniqueUnitIds) {
    const source = findUnitLocation(game, unitId);
    removeUnitFromSource(source);
    source.unit.exhausted = true;
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
    awardPoint(game, player, destination.instanceId, "conquer");
    triggerConquerEffects(game, player, unit);
    log(game, `${player.name} conquers ${destination.name}.`);
  } else {
    destination.controlledBy = player.id;
  }

  updateBattlefieldControl(game);
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
    awardPoint(game, player, destination.instanceId, "conquer");
    for (const unit of presentUnits) triggerConquerEffects(game, player, unit);
    log(game, `${player.name} conquers ${destination.name}.`);
  } else if (presentUnits.length > 0) {
    destination.controlledBy = player.id;
  }

  updateBattlefieldControl(game);
  checkState(game);
}

function canEnterBattlefield(game, player, card, battlefield) {
  if (opponentForcesUnitsToBase(game, player, card)) return false;
  if (battlefield.controlledBy === player.id) return true;
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
  return hasKeyword(card, "Ambush", game) || hasStaticEffect(card, "canEnterEnemyBattlefield");
}

export function passShowdown(game, playerId = game.currentPlayerId) {
  if (game.pendingPayment || game.pendingChoice) return fail(game, "Finish the current choice first.");
  if (game.phase === "action" && game.actionChain) return passActionChain(game, playerId);
  if (game.phase !== "showdown" || !game.showdown) return fail(game, "There is no active showdown.");
  if (game.showdown.priorityPlayerId !== playerId) return fail(game, "It is not that player's showdown priority.");

  const player = game.players.find((candidate) => candidate.id === playerId);
  game.showdown.consecutivePasses += 1;
  log(game, `${player.name} passes in the showdown.`);

  if (game.showdown.consecutivePasses >= showdownPlayerIds(game.showdown).length) {
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
  const player = game.players.find((candidate) => candidate.id === playerId);
  game.actionChain.consecutivePasses += 1;
  log(game, `${player?.name || "A player"} passes.`);

  if (game.actionChain.consecutivePasses >= actionChainPlayerIds(game.actionChain).length) {
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
  applyChoiceEffect(game, choice, option);
  const player = game.players.find((candidate) => candidate.id === choice.playerId);
  if (game.pendingChoice) return { ok: true };
  if (continueTriggerQueueAfterChoice(game)) return { ok: true };
  if (choice.finishSpell) finishSpell(game, player, choice.card);
  checkState(game);
  if (game.phase === "showdown" && game.showdown && choice.fromShowdownChain) {
    continueShowdownAfterChainResolution(game);
  }
  if (game.phase === "action" && game.actionChain) {
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
    prepareAndQueueTriggers(game, choice.data.remainingTriggers || [], choice.data.mode || "queue", choice.data.continuation || null);
    return { ok: true };
  }
  if (continueTriggerQueueAfterChoice(game)) return { ok: true };
  if (choice.finishSpell) finishSpell(game, player, choice.card);
  checkState(game);
  if (game.phase === "showdown" && game.showdown && choice.fromShowdownChain) {
    continueShowdownAfterChainResolution(game);
  }
  if (game.phase === "action" && game.actionChain) {
    continueActionChainAfterResolution(game);
  }
  return { ok: true };
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
  const totalPower = totalPowerAmount(cost.power);
  if (readyRunes.length + availablePoolEnergyCount(game, player, card) < energy) return false;
  if (player.runes.length < totalPower) return false;
  return Boolean(choosePowerRunes(player.runes, cost.power));
}

function payCost(game, player, card) {
  const cost = adjustedCost(game, player, card);
  const powerRunes = choosePowerRunes(player.runes, cost.power) || [];
  const powerRuneIds = new Set(powerRunes.map((rune) => rune.instanceId));
  const autoPoolIds = runePoolEnergy(player)
    .filter((resource) => poolEnergyCanPay(game, resource))
    .slice(0, cost.energy)
    .map((resource) => resource.id);
  consumeSelectedPoolEnergy(player, autoPoolIds);
  let energy = Math.max(0, cost.energy - autoPoolIds.length);

  for (const rune of player.runes) {
    if (energy <= 0) break;
    if (!rune.exhausted) {
      rune.exhausted = true;
      energy -= 1;
    }
  }

  for (let i = player.runes.length - 1; i >= 0; i--) {
    const rune = player.runes[i];
    if (!powerRuneIds.has(rune.instanceId)) continue;
    player.runes.splice(i, 1);
    rune.exhausted = false;
    addPowerToPool(player, rune.domain);
    player.runeDeck.push(rune);
  }
  consumePowerPool(player, cost.power);
}

function createPayment(game, player, card, destination, source, options = {}) {
  const cost = adjustedCost(game, player, card);
  const optionalPowerEffects = optionalAdditionalPowerEffects(card);
  const deflectPowerCost = options.deflectPowerCost || [];
  const basePowerCost = [...cost.power, ...deflectPowerCost];
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
  const reducedCardPowerCost = reducePowerRequirements(cost.power, powerReduction);
  const payablePowerCost = [...(ignoresCost ? [] : reducedCardPowerCost), ...deflectPowerCost];
  return {
    playerId: player.id,
    cardId: card.instanceId,
    cardName: card.name,
    destination,
    source,
    energyCost: (ignoresCost ? 0 : Math.max(0, cost.energy - discardReduction)) + repeatEnergy,
    basePowerCost: payablePowerCost,
    powerCost: payablePowerCost,
    declaredTargets: structuredClone(options.declaredTargets || []),
    declaredChoices: structuredClone(options.declaredChoices || []),
    deflectTargetIds: [...(options.deflectTargetIds || [])],
    optionalPowerEffects,
  energyRuneIds: [],
  poolEnergyIds: [],
  powerRuneIds: []
  };
}

function reducePowerRequirements(requirements, amount) {
  let remaining = Math.max(0, amount || 0);
  return (requirements || []).map((requirement) => {
    const reduced = Math.min(remaining, requirement.amount || 0);
    remaining -= reduced;
    return { ...requirement, amount: (requirement.amount || 0) - reduced };
  }).filter((requirement) => requirement.amount > 0);
}

function createTrashSpellPayment(player, sourceCard, spell, declaredTargets = [], declaredChoices = [], extraPower = [], deflectTargetIds = []) {
  const basePowerCost = [...normalizeCardPowerRequirements(spell, spell.power || []), ...(extraPower || [])];
  return {
    playerId: player.id,
    cardId: spell.instanceId,
    cardName: spell.name,
    destination: null,
    source: "trashSpell",
    energyCost: 0,
    basePowerCost: structuredClone(basePowerCost),
    powerCost: structuredClone(basePowerCost),
    declaredTargets: structuredClone(declaredTargets || []),
    declaredChoices: structuredClone(declaredChoices || []),
    deflectTargetIds: [...(deflectTargetIds || [])],
    optionalPowerEffects: [],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    trashSpell: {
      sourceCardId: sourceCard.instanceId
    }
  };
}

function createActivatedPayment(player, card, specs, cost) {
  const powerCost = normalizeCardPowerRequirements(card, cost.power || []);
  return {
    playerId: player.id,
    cardId: card.instanceId,
    cardName: card.name,
    destination: null,
    source: "activatedAbility",
    energyCost: cost.energy || 0,
    recycleTrashCost: cost.recycleTrash || 0,
    basePowerCost: structuredClone(powerCost),
    powerCost: structuredClone(powerCost),
    declaredTargets: [],
    declaredChoices: [],
    deflectTargetIds: [],
    optionalPowerEffects: [],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    activatedAbility: {
      specs: structuredClone(specs || [])
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

function resolvePaidTrashSpell(game, player, spell, payment) {
  const source = findCard(game, payment.trashSpell?.sourceCardId);
  const index = player.trash.findIndex((candidate) => candidate.instanceId === spell.instanceId);
  if (index < 0) {
    log(game, `${spell.name} is no longer in trash.`);
    return;
  }
  const [playedSpell] = player.trash.splice(index, 1);
  playedSpell.declaredPlayTargets = structuredClone(payment.declaredTargets || []);
  playedSpell.declaredPlayChoices = structuredClone(payment.declaredChoices || []);
  playedSpell.deflectPaidTargetIds = [...(payment.deflectTargetIds || [])];
  playedSpell.recycleAfterResolve = true;
  const paidPower = totalPowerAmount(payment.powerCost || []) > 0;
  log(game, `${source?.name || "An effect"} plays ${playedSpell.name} from trash${paidPower ? " after paying Power" : " with no Power cost"}.`);
  if (!resolveEffect(game, player, playedSpell)) finishSpell(game, player, playedSpell);
  markEffect(game, source || playedSpell, [playedSpell.instanceId], `${playedSpell.name} played from trash.`);
}

function beginTrashSpellPayment(game, player, source, spell, declaredTargets = [], declaredChoices = [], extraPower = [], deflectTargetIds = []) {
  const powerCost = [...normalizeCardPowerRequirements(spell, spell.power || []), ...(extraPower || [])];
  if (!payPowerRequirements(player, powerCost, true)) {
    log(game, `${source.name} cannot pay ${spell.name}'s Power cost.`);
    return false;
  }
  const payment = createTrashSpellPayment(player, source, spell, declaredTargets, declaredChoices, extraPower, deflectTargetIds);
  if (totalPowerAmount(powerCost) === 0) {
    resolvePaidTrashSpell(game, player, spell, payment);
    return true;
  }
  game.pendingPayment = payment;
  game.selectedCardId = spell.instanceId;
  log(game, `${player.name} is paying ${spell.name}'s Power cost for ${source.name}.`);
  return true;
}

function resumeChainPriorityAfterEffectPayment(game, data) {
  if (game.phase === "showdown" && game.showdown && data.fromShowdownChain && !game.pendingChoice) {
    continueShowdownAfterChainResolution(game);
  }
  if (game.phase === "action" && game.actionChain && !game.pendingChoice) {
    continueActionChainAfterResolution(game);
  }
}

function promptPlayTargetDeclaration(game, player, card, destination, source) {
  if (!game.interactive || (card.type !== "spell" && !card.additionalCost)) return false;
  const declaration = playTargetDeclaration(game, player, card, destination);
  if (!declaration) return false;
  promptNextPlayDeclaration(game, player, card, {
    destination,
    source,
    declarationSteps: declaration.steps,
    declaredTargets: [],
    declaredChoices: [],
    deflectPowerCost: [],
    deflectTargetIds: []
  });
  return true;
}

function promptNextPlayDeclaration(game, player, card, state) {
  const steps = [...(state.declarationSteps || [])];
  while (steps.length) {
    const descriptor = steps.shift();
    const declaration = materializePlayDeclaration(game, player, card, descriptor, state.declaredTargets || []);
    declaration.options = declaration.options.filter((option) => {
      const target = findCard(game, option.cardId);
      if (!target || !needsDeflectPayment(player, target)) return true;
      return canPayWithExtraPower(game, player, card, [{ domain: "Any", amount: deflectAmount(target) }]);
    });
    if (!declaration.options.length && declaration.optional) continue;
    if (!declaration.options.length) return false;
    const canFinish = (declaration.min || 1) === 0;
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
        allocationRemaining: declaration.allocationRemaining,
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
    if (!payPowerRequirements(player, state.deflectPowerCost || [], true)) {
      log(game, `${card.name} cannot pay its declared targets' Deflect cost.`);
      return false;
    }
    return Boolean(finalizeHiddenCard(game, player, card, state.destination, state.declaredTargets, state.declaredChoices));
  }
  if (state.completion?.type === "trashSpell") {
    return beginTrashSpellPayment(
      game,
      player,
      state.completion.sourceCard,
      card,
      state.declaredTargets,
      state.declaredChoices,
      state.deflectPowerCost,
      state.deflectTargetIds
    );
  }
  game.pendingPayment = createPayment(game, player, card, state.destination, state.source, {
    declaredTargets: state.declaredTargets || [],
    declaredChoices: state.declaredChoices || [],
    deflectPowerCost: state.deflectPowerCost || [],
    deflectTargetIds: state.deflectTargetIds || []
  });
  game.selectedCardId = card.instanceId;
  return true;
}

function promptHiddenTargetDeclaration(game, player, hidden, destination) {
  if (!game.interactive || hidden.card.type !== "spell") return false;
  const declaration = playTargetDeclaration(game, player, hidden.card, destination);
  if (!declaration) return false;
  return promptNextPlayDeclaration(game, player, hidden.card, {
    destination,
    source: "hidden",
    completion: { type: "hidden" },
    declarationChoiceEffect: "declareHiddenPlayTarget",
    moveDestinationChoiceEffect: "declareHiddenMoveDestination",
    declarationSteps: declaration.steps,
    declaredTargets: [],
    declaredChoices: [],
    deflectPowerCost: [],
    deflectTargetIds: []
  });
}

function playTargetDeclaration(game, player, card, destination) {
  const specs = cardEffects(card, "spell");
  const steps = [];
  for (const spec of specs) {
    const declaration = spellTargetDeclaration(spec);
    if (!declaration) continue;
    const declarations = declaration.steps || [declaration];
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
  if (card.additionalCost?.kind === "killFriendlyUnitsReducePower") {
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
  if (card.additionalCost?.kind === "spendFriendlyBuffsReducePower") {
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
  if (!steps.length) return null;
  const first = materializePlayDeclaration(game, player, card, steps[0], []);
  if (!first.options.length && !first.optional) return null;
  return { steps, ...first };
}

function materializePlayDeclaration(game, player, card, descriptor, declaredTargets = []) {
  const { spec, declaration } = descriptor;
  const repeatCount = declaration.repeat ?? spec.repeat ?? 1;
  const max = declaration.maxTargets ?? spec.maxTargets ?? declaration.max ?? spec.max ?? repeatCount;
  const min = declaration.minTargets ?? spec.minTargets ?? ((declaration.max ?? spec.max) != null ? 0 : repeatCount);
  const allocationRemaining = declaration.allocation
    ? Math.max(0, effectiveMight(findCard(game, declaredTargets.find((target) => target.effect === "alphaStrike")?.targetId))
      - declaredTargets.filter((target) => target.effect === declaration.choiceEffect).reduce((sum, target) => sum + (target.amount || 0), 0))
    : null;
  return {
    effect: declaration.choiceEffect,
    requiresDestination: Boolean(declaration.requiresDestination),
    destinationEffect: declaration.destinationEffect || null,
    min: declaration.allocation ? allocationRemaining : ((declaration.optional || spec.optional) ? 0 : min),
    max: declaration.multi ? (declaration.maxTargets ?? spec.maxTargets ?? Number.MAX_SAFE_INTEGER) : max,
    optional: Boolean(declaration.optional || spec.optional),
    allocationRemaining,
    options: declarationTargetOptions(game, player, card, spec, declaration, declaredTargets)
  };
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
      .filter((source) => spec.maxMight == null || effectiveMight(source.unit) <= spec.maxMight)
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
  if (declaration.provider === "alphaStrikeAllocation") {
    const attacker = findCard(game, declaredTargets.find((target) => target.effect === "alphaStrike")?.targetId);
    const assigned = declaredTargets
      .filter((target) => target.effect === declaration.choiceEffect)
      .reduce((sum, target) => sum + (target.amount || 0), 0);
    return alphaStrikeDamageOptions(game, player, card, Math.max(0, effectiveMight(attacker) - assigned));
  }
  if (declaration.provider === "repeatCount") {
    const baseCost = adjustedCost(game, player, card).energy;
    const available = player.runes.filter((rune) => !rune.exhausted).length + availablePoolEnergyCount(game, player);
    const repeatCost = declaration.repeatCostEnergy || 1;
    const max = Math.max(0, Math.floor((available - baseCost) / repeatCost));
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

function canPayWithExtraPower(game, player, card, extraPower = []) {
  const cost = adjustedCost(game, player, card);
  if (player.runes.filter((rune) => !rune.exhausted).length + availablePoolEnergyCount(game, player) < cost.energy) return false;
  const powerCost = [...cost.power, ...extraPower];
  if (player.runes.length < totalPowerAmount(powerCost)) return false;
  return Boolean(choosePowerRunes(player.runes, powerCost));
}

function consumeDeclaredPlayTarget(card, effect, options) {
  const declarations = card.declaredPlayTargets || [];
  const index = declarations.findIndex((declaration) => declaration.effect === effect);
  if (index < 0) return null;
  const [declaration] = declarations.splice(index, 1);
  const option = options.find((candidate) => candidate.cardId === declaration.targetId
    && (declaration.amount == null || candidate.amount === declaration.amount)) || null;
  return { declaration, option };
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
  if (payment.source === "champion") return player.champion;
  if (payment.source === "effectEnergy") return payment.effectPayment?.sourceCard || findCardByPlayers(payment.cardId, player) || null;
  if (payment.source === "activatedAbility") return findCardByPlayers(payment.cardId, player) || null;
  if (payment.source === "trashSpell") return player.trash.find((candidate) => candidate.instanceId === payment.cardId) || null;
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
      ...player.trash
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
  return player.runePool;
}

function clearRunePool(player) {
  player.runePool = { energy: [], power: [] };
}

function runePoolEnergy(player) {
  return ensureRunePool(player).energy;
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

function addPowerToPool(player, domain) {
  ensureRunePool(player).power.push(domain);
}

function consumePowerPool(player, requirements = []) {
  const pool = ensureRunePool(player);
  for (const requirement of expandPowerRequirements(requirements)) {
    const index = pool.power.findIndex((domain) => requirement.allowedDomains?.includes(domain) || requirement.domain === "Any" || domain === requirement.domain);
    if (index >= 0) pool.power.splice(index, 1);
  }
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
  if (energyRunes.some((rune) => rune.exhausted)) return false;
  const selectedPowerRunes = (payment.powerRuneIds || [])
    .map((id) => player.runes.find((rune) => rune.instanceId === id))
    .filter(Boolean);
  if (new Set(payment.powerRuneIds || []).size !== (payment.powerRuneIds || []).length) return false;
  if (selectedPowerRunes.length !== (payment.powerRuneIds || []).length) return false;
  return powerSelectionSatisfies(selectedPowerRunes, powerCost, true);
}

function powerMatches(rune, requirement) {
  if (rune.temporaryResource) return false;
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
      label: `Pay ${accelerate.amount} ${accelerate.domain} Power to enter ready`,
      selected: false,
      requirements: [accelerate],
      draw: 0,
      domain: accelerate.domain
    });
  }
  return effects;
}

function acceleratePowerRequirement(card) {
  if (!hasKeyword(card, "Accelerate")) return null;
  const text = card.text || "";
  const domain = Object.values({ Body: "Body", Calm: "Calm", Chaos: "Chaos", Fury: "Fury", Mind: "Mind", Order: "Order" })
    .find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(text))
    || card.domains?.[0]
    || "Any";
  const amount = Number(/\bpay\s+(\d+)/i.exec(text)?.[1] || 1);
  return { domain, amount };
}

function paymentPowerCost(payment) {
  return [
    ...(payment.basePowerCost || []),
    ...(payment.optionalPowerEffects || [])
      .filter((effect) => effect.selected)
      .flatMap((effect) => effect.requirements || [])
  ];
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

function adjustedCost(game, player, card) {
  const cost = {
    energy: card.energy || 0,
    power: normalizeCardPowerRequirements(card, card.power || [])
  };
  applySelfCostModifiers(game, player, card, cost);
  applyControlledCostModifiers(game, player, card, cost);
  if (card.type === "spell" && player.nextSpellEnergyReduction) {
    cost.energy -= player.nextSpellEnergyReduction;
    cost.minEnergy = Math.max(cost.minEnergy ?? 0, 0);
  }
  cost.energy = Math.max(0, cost.energy);
  if (game.phase !== "showdown" || card.type !== "spell" || !game.showdown) return cost;
  const battlefield = game.battlefields.find((field) => field.instanceId === game.showdown.battlefieldId);
  if (!battlefield) return cost;
  for (const unit of battlefield.units) {
    for (const effect of cardEffects(unit, "combatStatic")) {
      if (effect.kind !== "spellCostModifier") continue;
      const friendly = unit.controllerId === player.id;
      cost.energy += friendly ? (effect.friendlyEnergy || 0) : (effect.enemyEnergy || 0);
      cost.power = adjustPowerCost(cost.power, friendly ? (effect.friendlyPower || 0) : (effect.enemyPower || 0));
      if (effect.minEnergy != null) cost.energy = Math.max(effect.minEnergy, cost.energy);
    }
  }
  cost.energy = Math.max(0, cost.energy);
  return cost;
}

function normalizeCardPowerRequirements(card, requirements) {
  const domains = [...new Set((card?.domains || []).filter((domain) => domain && domain !== "Any"))];
  return (requirements || []).map((requirement) => {
    if (requirement.domain !== "Any" || !domains.length) return structuredClone(requirement);
    if (domains.length === 1) return { ...structuredClone(requirement), domain: domains[0] };
    return { ...structuredClone(requirement), allowedDomains: domains };
  });
}

function applySelfCostModifiers(game, player, card, cost) {
  for (const effect of cardEffects(card, "static")) {
    if (effect.kind !== "costModifier") continue;
    if (!costModifierApplies(game, player, card, effect)) continue;
    cost.energy += effect.energy || 0;
    if (effect.energyPerTrash) cost.energy += effect.energyPerTrash * (player.trash?.length || 0);
    if (effect.energyByHighestMight) {
      const highest = Math.max(0, ...allControlledCards(game, player.id)
        .filter((candidate) => candidate.type === "unit")
        .map((unit) => effectiveMight(unit)));
      cost.energy -= highest;
    }
    if (effect.minEnergy != null) cost.energy = Math.max(effect.minEnergy, cost.energy);
  }
  cost.energy = Math.max(0, cost.energy);
}

function applyControlledCostModifiers(game, player, card, cost) {
  for (const source of allControlledCards(game, player.id)) {
    if (source.instanceId === card.instanceId) continue;
    for (const effect of cardEffects(source, "static")) {
      if (effect.kind !== "costModifier") continue;
      if (!costModifierApplies(game, player, card, effect, source)) continue;
      cost.energy += effect.energy || 0;
      if (effect.power) cost.power = adjustPowerCost(cost.power, effect.power);
      if (effect.minEnergy != null) cost.energy = Math.max(effect.minEnergy, cost.energy);
    }
  }
  cost.energy = Math.max(0, cost.energy);
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

function expandPowerRequirements(requirements) {
  return requirements
    .flatMap((requirement) => Array.from({ length: requirement.amount }, () => requirement))
    .sort((left, right) => {
      if (left.domain === "Any" && right.domain !== "Any") return 1;
      if (left.domain !== "Any" && right.domain === "Any") return -1;
      return 0;
    });
}

function applyManualPayment(player, payment) {
  for (const runeId of payment.energyRuneIds || []) {
    const rune = player.runes.find((candidate) => candidate.instanceId === runeId);
    if (rune) {
      rune.exhausted = true;
    }
  }

  for (const runeId of payment.powerRuneIds || []) {
    const index = player.runes.findIndex((candidate) => candidate.instanceId === runeId);
    if (index >= 0) {
      const [rune] = player.runes.splice(index, 1);
      rune.exhausted = false;
      addPowerToPool(player, rune.domain);
      player.runeDeck.push(rune);
    }
  }
  consumeSelectedPoolEnergy(player, payment.poolEnergyIds || []);
  consumePowerPool(player, payment.powerCost || []);
}

function resolvePaidCard(game, player, card, destination) {
  if (card.type === "spell") {
    if (game.phase === "action" && game.interactive && !card.resolvingFromChain) {
      return addPaidCardToActionChain(game, player, card, destination);
    }
    if (triggerCardPlayedEffects(game, player, card, {
      kind: "resolveSpell",
      playerId: player.id,
      card
    })) return { ok: true };
    player.nextSpellEnergyReduction = 0;
    resolveSpellAfterSynergies(game, player, card);
    return { ok: true };
  }

  const result = putPermanentIntoPlay(game, player, card, destination, false);
  const hasOnPlay = result.ok && cardEffects(card, "onPlay").length > 0;
  const cardPlayedTriggers = result.ok && triggerCardPlayedEffects(game, player, card, hasOnPlay ? {
    kind: "resolvePermanentOnPlay",
    playerId: player.id,
    cardId: card.instanceId
  } : null);
  if (hasOnPlay && !cardPlayedTriggers) resolveOnPlayEffect(game, player, card);
  checkState(game);
  return result;
}

function addPaidCardToShowdown(game, player, card, destination) {
  const showdown = game.showdown;
  addPendingChainItem(showdown, card, player.id, destination);
  showdown.consecutivePasses = 0;
  log(game, `${player.name} adds ${card.name} to the showdown chain.`);
  triggerCardPlayedEffects(game, player, card);
  giveShowdownPriority(game, otherShowdownPlayerId(showdown, player.id));
  return { ok: true };
}

function playHiddenCard(game, hidden, destination) {
  if (game.phase !== "showdown" || !game.showdown) return fail(game, "Hidden cards can only be revealed during a showdown.");
  const player = currentPlayer(game);
  if (hidden.ownerId !== player.id) return fail(game, "That hidden card is not yours.");
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
  if (promptHiddenTargetDeclaration(game, player, hidden, destination || hidden.battlefield.instanceId)) return { ok: true };
  return finalizeHiddenCard(game, player, card, destination || hidden.battlefield.instanceId);
}

function finalizeHiddenCard(game, player, card, destination, declaredTargets = [], declaredChoices = []) {
  const hidden = findHiddenCardLocation(game, card.instanceId);
  if (!hidden) return fail(game, "That hidden card is no longer hidden.");
  if (hidden.ownerId !== player.id) return fail(game, "That hidden card is not yours.");
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
  delete card.declaredPlayTargets;
  delete card.declaredPlayChoices;
  delete card.deflectPaidTargetIds;
  delete card.paidFriendlyExhaustAdditionalCost;
  delete card.hiddenBattlefieldId;
  player.nextSpellBonusDamage = 0;
  if (card.banishAfterResolve) {
    delete card.banishAfterResolve;
    const owner = game.players.find((candidate) => candidate.id === card.ownerId) || player;
    owner.banished ||= [];
    if (!owner.banished.includes(card)) owner.banished.push(card);
    log(game, `${card.name} is banished.`);
    return;
  }
  if (card.recycleAfterResolve) {
    delete card.recycleAfterResolve;
    player.mainDeck.push(card);
    log(game, `${card.name} is recycled.`);
    return;
  }
  if (player.trash.includes(card)) return;
  player.trash.push(card);
  log(game, `${card.name} goes to trash.`);
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
  return resolveStagedEvents(game);
}

function resolveStagedEvents(game) {
  if (game.phase !== "action" || game.pendingPayment || game.pendingChoice || game.showdown || game.actionChain
    || game.triggerQueue?.length || game.triggerQueueContinuation || game.pendingEndTurnPlayerId) return false;
  game.stagedEvents = validStagedEvents(game, [
    ...(game.stagedEvents || []),
    ...autoStagedCombatEvents(game)
  ]);
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

function autoStagedCombatEvents(game) {
  if (game.phase !== "action" || game.showdown) return [];
  return game.battlefields.flatMap((battlefield) => {
    const controllers = [...new Set(battlefield.units.map((unit) => unit.controllerId))];
    if (controllers.length < 2) return [];
    const attackerId = battlefield.contestedBy && controllers.includes(battlefield.contestedBy)
      ? battlefield.contestedBy
      : game.currentPlayerId;
    const defenderId = controllers.find((controllerId) => controllerId !== attackerId);
    return [{
      id: `staged-combat-${battlefield.instanceId}-${attackerId}`,
      type: "combat",
      battlefieldId: battlefield.instanceId,
      attackerId,
      defenderId
    }];
  });
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
    startShowdown(game, battlefield, event.attackerId, {
      combat: true,
      defenderId: event.defenderId
    });
  } else {
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
  const attacker = game.players.find((player) => player.id === attackerId);
  const defender = game.players.find((player) => player.id === defenderId);
  log(game, `${options.combat === false ? "Non-combat showdown" : "Combat showdown"} begins at ${battlefield.name}: ${attacker.name} faces ${defender.name}.`);
  if (game.showdown.combat) triggerAttackOrDefendEffects(game, battlefield, attackerId);
  triggerShowdownStartEffects(game, battlefield, attacker, defender);
  log(game, `${attacker.name} has showdown priority.`);
}

function playShowdownCard(game, cardId, destination = "base") {
  const showdown = game.showdown;
  const player = currentPlayer(game);
  if (!showdownPlayerIds(showdown).includes(player.id)) return fail(game, "That player is not in this showdown.");
  if (showdown.priorityPlayerId !== player.id) return fail(game, "It is not that player's showdown priority.");

  const cardIndex = player.hand.findIndex((card) => card.instanceId === cardId);
  if (cardIndex < 0) return fail(game, "That card is not in hand.");
  const card = player.hand[cardIndex];
  if (!canPlayInShowdown(game, player, card, showdown, destination)) {
    return fail(game, showdown.chain.length > 0
      ? "Only Reactions can be played onto an existing chain."
      : "Only Actions and Reactions can be played during a showdown.");
  }
  if (!hasRequiredPlayTargets(game, player, card, destination)) return fail(game, `${card.name} has no legal target.`);
  if (!canPay(game, player, card)) return fail(game, "Not enough ready runes or matching Power.");

  payCost(game, player, card);
  player.hand.splice(cardIndex, 1);
  player.cardsPlayedThisTurn += 1;
  game.selectedCardId = card.instanceId;
  addPendingChainItem(showdown, card, player.id, destination);
  showdown.consecutivePasses = 0;
  log(game, `${player.name} adds ${card.name} to the showdown chain.`);
  giveShowdownPriority(game, otherShowdownPlayerId(showdown, player.id));
  return { ok: true };
}

function addPendingChainItem(showdown, card, playerId, destination) {
  showdown.chainSequence = (showdown.chainSequence || 0) + 1;
  showdown.chain.push({
    id: `chain-${showdown.chainSequence}`,
    itemType: "card",
    card,
    playerId,
    destination,
    status: "pending"
  });
}

function addPendingActivatedChainItem(showdown, card, playerId, specs) {
  showdown.chainSequence = (showdown.chainSequence || 0) + 1;
  showdown.chain.push({
    id: `chain-${showdown.chainSequence}`,
    itemType: "activated",
    card,
    playerId,
    specs,
    status: "pending"
  });
}

function addPendingTriggerChainItem(game, trigger) {
  const showdown = game.showdown;
  if (!showdown) return;
  const source = findCard(game, trigger.sourceCardId);
  showdown.chainSequence = (showdown.chainSequence || 0) + 1;
  showdown.chain.push({
    id: `chain-${showdown.chainSequence}`,
    itemType: "trigger",
    card: source || { name: trigger.kind, instanceId: trigger.id },
    playerId: trigger.playerId,
    trigger: {
      id: `trigger-${Date.now()}-${Math.random()}`,
      status: "pending",
      fromShowdownChain: true,
      ...trigger
    },
    status: "pending"
  });
}

function addPendingTriggerChainItems(game, triggers) {
  for (const trigger of triggers) addPendingTriggerChainItem(game, trigger);
}

function ensureActionChain(game, playerId, continuation = null) {
  if (game.actionChain) {
    if (continuation && !game.actionChain.continuation) game.actionChain.continuation = continuation;
    return game.actionChain;
  }
  game.actionChain = {
    turnPlayerId: game.currentPlayerId,
    playerIds: game.players.map((player) => player.id),
    priorityPlayerId: playerId,
    consecutivePasses: 0,
    chain: [],
    chainSequence: 0,
    continuation
  };
  giveActionChainPriority(game, otherActionChainPlayerId(game.actionChain, playerId));
  return game.actionChain;
}

function addPendingActionTriggerChainItem(game, trigger) {
  const chain = ensureActionChain(game, trigger.playerId);
  const source = findCard(game, trigger.sourceCardId);
  chain.chainSequence = (chain.chainSequence || 0) + 1;
  chain.chain.push({
    id: `action-chain-${chain.chainSequence}`,
    itemType: "trigger",
    card: source || { name: trigger.kind, instanceId: trigger.id },
    playerId: trigger.playerId,
    trigger: {
      id: `trigger-${Date.now()}-${Math.random()}`,
      status: "pending",
      fromActionChain: true,
      ...trigger
    },
    status: "pending"
  });
}

function addPendingActionTriggerChainItems(game, triggers, continuation = null) {
  for (const trigger of triggers) addPendingActionTriggerChainItem(game, trigger);
  if (game.actionChain) {
    if (continuation) game.actionChain.continuation = continuation;
    game.actionChain.consecutivePasses = 0;
    giveActionChainPriority(game, game.actionChain.priorityPlayerId || otherActionChainPlayerId(game.actionChain, triggers[0]?.playerId));
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
  const pending = normalizeChainItems(game.showdown).filter((item) => item.status === "pending");
  if (!pending.length) return;
  for (const item of pending) item.status = "finalized";
  log(game, `${pending.length} chain item${pending.length === 1 ? "" : "s"} finalized.`);
}

function finalizePendingActionChainItems(game) {
  const pending = normalizeActionChainItems(game.actionChain).filter((item) => item.status === "pending");
  if (!pending.length) return;
  for (const item of pending) item.status = "finalized";
  log(game, `${pending.length} chain item${pending.length === 1 ? "" : "s"} finalized.`);
}

function canPlayInShowdown(game, player, card, showdown, destination = "base") {
  normalizeChainItems(showdown);
  const isAction = card.tags?.includes("Action");
  const isReaction = card.tags?.includes("Reaction");
  const isAmbush = hasKeyword(card, "Ambush", null);
  if (!isAction && !isReaction && !isAmbush) return false;
  if (showdown.chain.length > 0 && !isReaction && !isAmbush) return false;
  if (isAmbush) {
    const battlefield = game.battlefields.find((field) => field.instanceId === showdown.battlefieldId);
    if (destination !== showdown.battlefieldId) return false;
    if (hasStaticEffect(card, "canEnterEnemyBattlefield")) return true;
    return Boolean(battlefield?.units.some((unit) => unit.controllerId === player.id));
  }
  return true;
}

function canPlayInActionChain(game, player, card) {
  if (!game.actionChain || game.actionChain.priorityPlayerId !== player.id) return false;
  return card.tags?.includes("Reaction") || card.keywords?.includes("Reaction");
}

function addPaidCardToActionChain(game, player, card, destination) {
  const chain = ensureActionChain(game, player.id);
  addPendingChainItem(chain, card, player.id, destination);
  chain.consecutivePasses = 0;
  log(game, `${player.name} adds ${card.name} to the chain.`);
  triggerCardPlayedEffects(game, player, card);
  giveActionChainPriority(game, otherActionChainPlayerId(chain, player.id));
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
  const player = game.players.find((candidate) => candidate.id === item.playerId);
  log(game, `${item.card.name} resolves from the chain.`);

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
    resolveEffectSpecs(game, player, item.card, item.specs || cardEffects(item.card, "activated"), false);
    checkState(game);
    return;
  }

  if (item.card.type === "spell") {
    item.card.resolvingFromChain = true;
    try {
      resolveSpellAfterSynergies(game, player, item.card);
    } finally {
      delete item.card.resolvingFromChain;
    }
  } else {
    putPermanentIntoPlay(game, player, item.card, item.destination, false);
    if (cardEffects(item.card, "onPlay").length) resolveOnPlayEffect(game, player, item.card);
  }

  checkState(game);
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
  if (!normalizeActionChainItems(game.actionChain).length) {
    finishActionChain(game);
    return;
  }
  game.actionChain.consecutivePasses = 0;
  giveActionChainPriorityToTurnPlayer(game);
  maybeAutoPassActionChain(game);
}

function maybeAutoPassActionChain(game) {
  if (!game.interactive || game.settlingActionChain) return;
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
  return player.hand.some((card) =>
    canPlayInActionChain(game, player, card)
    && canPay(game, player, card)
    && hasRequiredPlayTargets(game, player, card, "base")
  ) || controlledCardsForEngine(game, player.id).some((card) =>
    canActivateInActionChain(game, player, card)
    || canActivateAddDuringActionChain(game, player, card, cardEffects(card, "activated"))
  );
}

function controlledCardsForEngine(game, playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return [];
  return [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...player.base,
    ...game.battlefields.flatMap((field) => field.units.filter((unit) => unit.controllerId === playerId))
  ].filter(Boolean);
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
  const player = game.players.find((candidate) => candidate.id === item.playerId);
  log(game, `${item.card.name} resolves from the showdown chain.`);

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
    resolveEffectSpecs(game, player, item.card, item.specs || cardEffects(item.card, "activated"), false);
    checkState(game);
    return;
  }

  if (item.card.type === "spell") {
    resolveSpellAfterSynergies(game, player, item.card);
  } else {
    putPermanentIntoPlay(game, player, item.card, item.destination, false);
    if (cardEffects(item.card, "onPlay").length) resolveOnPlayEffect(game, player, item.card);
  }

  checkState(game);
}

function finishShowdown(game) {
  const showdown = game.showdown;
  const battlefield = game.battlefields.find((field) => field.instanceId === showdown.battlefieldId);
  game.showdown = null;
  game.phase = "action";
  game.currentPlayerId = showdown.turnPlayerId;
  for (const player of game.players) {
    player.runes = player.runes.filter((rune) => !rune.temporaryResource);
    clearRunePool(player);
  }

  if (!battlefield) return;
  const attackersRemain = battlefield.units.some((unit) => unit.controllerId === showdown.attackerId);
  const defendersRemain = battlefield.units.some((unit) => unit.controllerId === showdown.defenderId);

  if (attackersRemain && defendersRemain) {
    if (showdown.combat !== false) {
      resolveCombat(game, battlefield, showdown.attackerId);
    } else {
      log(game, `${battlefield.name} remains contested. Combat is staged.`);
      stageBattlefieldEvent(game, {
        type: "combat",
        battlefield,
        attackerId: showdown.attackerId
      });
      return;
    }
  } else if (attackersRemain) {
    settleBattlefieldConquest(game, battlefield, showdown.attackerId, "after the showdown");
  } else if (defendersRemain) {
    settleBattlefieldConquest(game, battlefield, showdown.defenderId, "after the showdown");
  } else {
    battlefield.controlledBy = null;
    delete battlefield.contestedBy;
    log(game, "No units remain after the showdown.");
  }

  updateBattlefieldControl(game);
  checkState(game);
}

function currentShowdownFocusId(showdown) {
  return showdown?.focusPlayerId || showdown?.priorityPlayerId || showdown?.attackerId;
}

function continueShowdownAfterChainResolution(game) {
  if (!game.showdown || game.pendingChoice || game.pendingPayment) return;
  const showdown = game.showdown;
  showdown.consecutivePasses = 0;
  if (normalizeChainItems(showdown).length === 0) {
    showdown.focusPlayerId = otherShowdownPlayerId(showdown, currentShowdownFocusId(showdown));
  }
  giveShowdownPriority(game, currentShowdownFocusId(showdown));
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
  if (triggerActionSynergies(game, player, card)) return;
  resolveSpellEffectOnly(game, player, card);
}

function resolveSpellEffectOnly(game, player, card) {
  if (!resolveEffect(game, player, card)) finishSpell(game, player, card);
  checkState(game);
}

function triggerActionSynergies(game, player, card) {
  if (card.type !== "spell") return false;
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
  if (!triggers.length) return false;
  prepareAndQueueTriggers(game, triggers, game.phase === "action" && game.interactive ? "actionChain" : "queue", {
    kind: "resolveSpell",
    playerId: player.id,
    card
  });
  return true;
}

function prepareAndQueueTriggers(game, triggers, mode = "queue", continuation = null) {
  const remaining = triggers.filter((trigger) => {
    if (!triggerNeedsTargetDeclaration(trigger)) return true;
    if ((trigger.data?.declaredTargets || []).length) return true;
    if (triggerDeclaration(game, trigger)) return true;
    const source = findCard(game, trigger.sourceCardId);
    log(game, `${source?.name || "A triggered effect"} has no legal target and does not trigger.`);
    return false;
  });
  if (game.interactive) {
    const nextIndex = remaining.findIndex((trigger) => triggerDeclaration(game, trigger));
    if (nextIndex >= 0) {
      const [trigger] = remaining.splice(nextIndex, 1);
      promptTriggerDeclaration(game, trigger, remaining, mode, continuation);
      return true;
    }
  }
  queuePreparedTriggers(game, remaining, mode, continuation);
  return true;
}

const TARGETED_TRIGGER_KINDS = new Set([
  "battlefieldSpellBuff",
  "secondDrawBuff",
  "defendHereGiveShield",
  "defendHereReturnFriendlyUnitToBase",
  "stunBuffFriendlyUnit",
  "holdBuffUnitHere",
  "attackOrDefendSplitDamageEnemyHere",
  "attackOrDefendDamageEnemyHere",
  "attackOrDefendDamageEnemyByHiddenTopDeck",
  "attackOrDefendModifyEnemyHere",
  "attackOrDefendStunEnemyHere"
]);

const TARGETED_EFFECT_KINDS = new Set([
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
    if (continuation) return runTriggerContinuation(game, continuation);
    return false;
  }
  if (mode === "showdownChain" && game.phase === "showdown" && game.showdown) {
    addPendingTriggerChainItems(game, active);
    game.showdown.consecutivePasses = 0;
    giveShowdownPriority(game, currentShowdownFocusId(game.showdown));
    return true;
  }
  if (mode === "actionChain" && game.phase === "action" && game.interactive) {
    addPendingActionTriggerChainItems(game, active, continuation);
    return true;
  }
  enqueueTriggers(game, active, continuation);
  resolveTriggerQueue(game);
  return true;
}

function promptTriggerDeclaration(game, trigger, remaining, mode, continuation) {
  const declaration = triggerDeclaration(game, trigger);
  const player = game.players.find((candidate) => candidate.id === trigger.playerId);
  const source = findCard(game, trigger.sourceCardId);
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
  const source = findCard(game, trigger.sourceCardId);
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
  if (trigger.kind === "stunBuffFriendlyUnit") {
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
  const combatTargetEffects = {
    attackOrDefendDamageEnemyHere: "damageUnit",
    attackOrDefendDamageEnemyByHiddenTopDeck: "damageUnit",
    attackOrDefendModifyEnemyHere: "modifyMight",
    attackOrDefendStunEnemyHere: "stunUnit"
  };
  if (trigger.kind === "attackOrDefendSplitDamageEnemyHere") {
    const effect = "splitDamageEnemyHere";
    const assigned = (trigger.data?.declaredTargets || [])
      .filter((target) => target.effect === effect)
      .reduce((sum, target) => sum + (target.amount || 0), 0);
    const remaining = Math.max(0, (trigger.data?.amount || 5) - assigned);
    if (!remaining) return null;
    const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
    const options = (battlefield?.units || [])
      .filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit))
      .flatMap((unit) => Array.from({ length: remaining }, (_, index) => ({
        id: `${unit.instanceId}:${index + 1}`,
        label: `${unit.name}: ${index + 1} damage`,
        cardId: unit.instanceId,
        amount: index + 1
      })));
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
    const declaration = {
      effect: "playTrashSpell",
      optional: Boolean(spec.optional),
      options: player.trash
        .filter((candidate) => candidate.type === "spell" && (candidate.energy || 0) <= spec.maxEnergy)
        .filter((candidate) => payPowerRequirements(player, normalizeCardPowerRequirements(candidate, candidate.power || []), true))
        .map(cardOption)
    };
    return declaration.options.length ? declaration : null;
  }
  if (spec.optional) {
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

function finalizePendingTrigger(game, trigger) {
  if (!trigger || trigger.status === "finalized") return;
  trigger.status = "finalized";
  const source = findCard(game, trigger.sourceCardId);
  log(game, `${source?.name || "A trigger"} trigger finalized.`);
}

const TRIGGER_RESOLVERS = new Map([
  ["effectSpecs", resolveEffectSpecsTrigger],
  ["cardPlayedAnotherUnitBuffSelf", resolveCardPlayedAnotherUnitBuffSelfTrigger],
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
  ["discardReadySelfMight", resolveDiscardReadySelfMightTrigger],
  ["scoreBuffSelf", resolveScoreBuffSelfTrigger],
  ["scoreDraw", resolveScoreDrawTrigger],
  ["scoreDrawOrChannelRunes", resolveScoreDrawOrChannelRunesTrigger],
  ["scoreKillGearThenBuffSelf", resolveScoreKillGearThenBuffSelfTrigger],
  ["scoreGainXp", resolveScoreGainXpTrigger],
  ["scoreReturnSelfToHand", resolveScoreReturnSelfToHandTrigger],
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
  ["beginningDraw", resolveBeginningDrawTrigger],
  ["beginningRecycleTrash", resolveBeginningRecycleTrashTrigger],
  ["attackOrDefendBuffXp", resolveAttackOrDefendBuffXpTrigger],
  ["attackOrDefendModifySelf", resolveAttackOrDefendModifySelfTrigger],
  ["attackOrDefendModifyUnit", resolveAttackOrDefendModifyUnitTrigger],
  ["attackOrDefendDamageAllEnemiesHere", resolveAttackOrDefendDamageAllEnemiesHereTrigger],
  ["attackOrDefendDamageEnemyHere", resolveAttackOrDefendDamageEnemyHereTrigger],
  ["attackOrDefendSplitDamageEnemyHere", resolveAttackOrDefendSplitDamageEnemyHereTrigger],
  ["attackOrDefendDamageEnemyByHiddenTopDeck", resolveAttackOrDefendDamageEnemyByHiddenTopDeckTrigger],
  ["attackOrDefendModifyEnemyHere", resolveAttackOrDefendModifyEnemyHereTrigger],
  ["attackOrDefendStunEnemyHere", resolveAttackOrDefendStunEnemyHereTrigger],
  ["stunReadySelfMight", resolveStunReadySelfMightTrigger],
  ["stunBuffFriendlyUnit", resolveStunBuffFriendlyUnitTrigger],
  ["enemyKilledStunnedDraw", resolveEnemyKilledStunnedDrawTrigger],
  ["defendHereRevealTopSpell", resolveDefendHereRevealTopSpellTrigger],
  ["defendHereGiveShield", resolveDefendHereGiveShieldTrigger],
  ["defendHereReturnFriendlyUnitToBase", resolveDefendHereReturnFriendlyUnitToBaseTrigger],
  ["firstBeginningGainPoint", resolveFirstBeginningGainPointTrigger],
  ["firstBeginningChannelRunes", resolveFirstBeginningChannelRunesTrigger],
  ["endTurnReadyRunes", resolveEndTurnReadyRunesTrigger],
  ["showdownBeginsPayEnergyPredictDrawSpell", resolveShowdownBeginsPayEnergyPredictDrawSpellTrigger],
  ["spellPlayedSelfBuff", resolveSpellPlayedSelfBuffTrigger],
  ["spellPlayedDraw", resolveSpellPlayedDrawTrigger],
  ["secondDrawBuff", resolveSecondDrawBuffTrigger],
  ["battlefieldSpellBuff", resolveBattlefieldSpellBuffTrigger]
]);

function resolveQueuedTrigger(game, trigger) {
  const player = game.players.find((candidate) => candidate.id === trigger.playerId);
  const source = findCard(game, trigger.sourceCardId);
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

function resolveCardPlayedAnotherUnitBuffSelfTrigger(game, trigger, player, source) {
  if (!findUnitLocation(game, source.instanceId)) return;
  addMightModifier(source, trigger.data?.amount || 1, { buff: true, maxBuffs: trigger.data?.maxBuffs });
  log(game, `${source.name} is buffed because another unit was played.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} is buffed.`);
}

function resolveCardPlayedGearReadySelfTrigger(game, trigger, player, source) {
  if (!findUnitLocation(game, source.instanceId)) return;
  source.exhausted = false;
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
  source.exhausted = false;
  addMightModifier(source, trigger.data?.amount || 2);
  log(game, `${source.name} readies and gets +${trigger.data?.amount || 2} Might because ${player.name} played their second card.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} readies.`);
}

function resolveCardPlayedFromHiddenBuffSelfTrigger(game, trigger, player, source) {
  if (!findUnitLocation(game, source.instanceId)) return;
  addMightModifier(source, trigger.data?.amount || 2);
  log(game, `${source.name} gets +${trigger.data?.amount || 2} Might because a card was played from hidden.`);
  markEffect(game, source, [source.instanceId, trigger.data?.playedCardId].filter(Boolean), `${source.name} gets Might.`);
}

function resolveCardPlayedExhaustSelfChannelOnMightyUnitTrigger(game, trigger, player, source) {
  if (source.exhausted) return;
  game.pendingChoice = {
    id: trigger.id,
    playerId: player.id,
    card: source,
    effect: "cardPlayedLegendTrigger",
    prompt: `Exhaust ${source.name} to channel a rune exhausted?`,
    options: [
      { id: "use-trigger", label: "Use this effect" },
      { id: "decline", label: "Decline" }
    ],
    data: {
      amount: trigger.data?.amount || 1,
      playedCardId: trigger.data?.playedCardId
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  };
}

function resolveCardPlayedLegendTriggerChoice({ game, choice, option, player, source }) {
  if (option.id === "decline" || source.exhausted) {
    log(game, `${player.name} declines ${source.name}.`);
    return;
  }
  source.exhausted = true;
  channel(player, choice.data?.amount || 1, true);
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
  channel(player, amount);
  log(game, `${source.name} channels ${amount} rune${amount === 1 ? "" : "s"} as a Deathknell.`);
  markEffect(game, source, [source.instanceId], `${source.name} channels runes.`);
}

function resolveDeathDiscardDrawTrigger(game, trigger, player, source) {
  const discardAmount = trigger.data?.discard || 0;
  const drawAmount = trigger.data?.draw || 0;
  const discarded = player.hand.splice(0, Math.min(discardAmount, player.hand.length));
  player.trash.push(...discarded);
  if (discarded.length) triggerDiscardEffects(game, player, discarded, source);
  draw(player, drawAmount, game);
  log(game, `${source.name} discards ${discarded.length}, then draws ${drawAmount}.`);
  markEffect(game, source, [source.instanceId, ...discarded.map((card) => card.instanceId)], `${source.name} discards and draws.`);
}

function resolveDeathDealDamageAllHereTrigger(game, trigger, player, source) {
  const battlefield = game.battlefields.find((field) => field.instanceId === trigger.data?.battlefieldId);
  if (!battlefield) return;
  const amount = trigger.data?.amount || 0;
  for (const unit of battlefield.units) unit.damage += amount;
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
    clearBoardState(card);
    player.mainDeck.push(card);
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

function resolveDiscardReadySelfMightTrigger(game, trigger, player, source) {
  source.exhausted = false;
  addMightModifier(source, trigger.data?.amount || 1);
  log(game, `${source.name} readies and gets +${trigger.data?.amount || 1} Might because ${player.name} discarded.`);
  markEffect(game, source, [source.instanceId], `${source.name} reacts to discard.`);
}

function resolveScoreBuffSelfTrigger(game, trigger, player, source) {
  addMightModifier(source, trigger.data?.amount || 1, { buff: true, maxBuffs: trigger.data?.maxBuffs });
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
    data: { draw: drawAmount, channel: channelAmount },
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
    channel(player, amount);
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
    data: { amount },
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
    declaredEffect: "buffUnit"
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
  for (const unit of units) triggerConquerEffects(game, player, unit);
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
  const amount = recycleRunes(player, trigger.data?.amount || 1);
  if (!amount) return;
  log(game, `${source.name} recycles ${amount} rune${amount === 1 ? "" : "s"}.`);
  markEffect(game, source, [source.instanceId], `${source.name} recycles runes.`);
}

function resolveConquerHereSpendBuffDrawTrigger(game, trigger, player, source) {
  const unit = findCard(game, trigger.data?.unitId);
  if (!unit || (unit.buffs || 0) <= 0) return;
  if (game.interactive && trigger.data?.optional !== false) {
    game.pendingChoice = {
      id: trigger.id,
      playerId: player.id,
      card: source,
      effect: "spendBuffDraw",
      prompt: `Spend ${unit.name}'s buff to draw ${trigger.data?.draw || 1} for ${source.name}?`,
      options: [
        { id: "draw", label: `Spend buff and draw ${trigger.data?.draw || 1}` },
        { id: "decline", label: "Do not use this effect" }
      ],
      data: { unitId: unit.instanceId, draw: trigger.data?.draw || 1 },
      finishSpell: false,
      optional: false,
      fromShowdownChain: false
    };
    return;
  }
  unit.buffs -= 1;
  draw(player, trigger.data?.draw || 1, game);
  log(game, `${source.name} spends ${unit.name}'s buff to draw ${trigger.data?.draw || 1}.`);
  markEffect(game, source, [source.instanceId, unit.instanceId], `${unit.name}'s buff is spent.`);
}

function resolveConquerHereRecycleTopDeckTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 2;
  const top = player.mainDeck.slice(0, amount);
  if (!top.length) return;
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
  game.pendingChoice = {
    id: trigger.id,
    playerId: player.id,
    card: source,
    effect: "recycleTopDeck",
    prompt: `Choose how to resolve ${source.name}.`,
    options,
    data: {
      amount,
      cardIds: top.map((card) => card.instanceId)
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: false
  };
}

function resolveFirstBeginningChannelRunesTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  channel(player, amount);
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
  const recycled = player.trash.splice(0, amount);
  recycleMainDeckCards(player, recycled);
  log(game, `${source.name} recycles ${amount} card${amount === 1 ? "" : "s"} from trash.`);
  markEffect(game, source, [source.instanceId, ...recycled.map((card) => card.instanceId)], `${source.name} recycles trash.`);
}

function resolveAttackOrDefendBuffXpTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 0;
  const xp = trigger.data?.xp || 0;
  addMightModifier(source, amount);
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
  addMightModifier(target, amount);
  log(game, `${source.name} gives ${target.name} ${amount} Might.`);
  markEffect(game, source, [target.instanceId], `${target.name} gets ${amount} Might.`);
}

function resolveAttackOrDefendDamageAllEnemiesHereTrigger(game, trigger, player, source) {
  const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
  if (!battlefield) return;
  const targets = battlefield.units.filter((unit) => unit.controllerId !== source.controllerId);
  const amount = trigger.data?.amount || 0;
  for (const unit of targets) unit.damage += amount;
  log(game, `${source.name} deals ${amount} damage to all enemies here.`);
  markEffect(game, source, targets.map((unit) => unit.instanceId), `${source.name} damages enemies here.`);
  for (const unit of [...targets]) {
    if (!isLethalDamage(unit)) continue;
    const location = findUnitLocation(game, unit.instanceId);
    killUnit(game, unit, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
  }
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
  const damaged = [];
  for (const declaration of declarations.filter((target) => target.effect === "splitDamageEnemyHere")) {
    const target = findCard(game, declaration.targetId);
    if (!target || target.controllerId === player.id || !battlefield?.units.includes(target)) continue;
    target.damage = (target.damage || 0) + (declaration.amount || 0);
    damaged.push(target);
  }
  for (const target of [...new Set(damaged)]) {
    if (isLethalDamage(target)) killUnit(game, target, { type: "battlefield", battlefield });
  }
  markEffect(game, source, damaged.map((unit) => unit.instanceId), `${source.name} splits ${trigger.data?.amount || 5} damage.`);
}

function resolveAttackOrDefendDamageEnemyByHiddenTopDeckTrigger(game, trigger, player, source) {
  const declaration = (trigger.data?.declaredTargets || []).find((target) => target.effect === "damageUnit");
  const target = declaration ? findCard(game, declaration.targetId) : null;
  const battlefield = findUnitLocation(game, source.instanceId)?.battlefield;
  const revealed = player.mainDeck.splice(0, Math.min(trigger.data?.look || 5, player.mainDeck.length));
  const amount = revealed.filter((card) => card.keywords?.includes("Hidden") || card.tags?.includes("Hidden")).length;
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: player.id,
    card: source,
    effect: "acknowledgeReveal",
    prompt: `${source.name} reveals ${revealed.length} cards.`,
    options: [{ id: "continue", label: "Continue" }],
    data: {
      revealedCards: revealed,
      revealResolution: "hiddenTopDeckDamage",
      targetId: target?.instanceId || null,
      battlefieldId: battlefield?.instanceId || null,
      amount
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  };
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
  source.exhausted = false;
  addMightModifier(source, trigger.data?.amount || 1);
  log(game, `${source.name} readies and gets +${trigger.data?.amount || 1} Might because ${player.name} stunned an enemy unit.`);
  markEffect(game, source, [source.instanceId, trigger.data?.stunnedUnitId].filter(Boolean), `${source.name} readies.`);
}

function resolveStunBuffFriendlyUnitTrigger(game, trigger, player, source) {
  const targets = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => canChooseUnit(game, player, source, unit));
  return resolveTriggerTargetChoice(game, trigger, player, source, {
    effect: "buffUnit",
    prompt: `Choose a friendly unit to buff for ${source.name}.`,
    targets,
    amount: trigger.data?.amount || 1,
    declaredEffect: "buffUnit"
  });
}

function resolveEnemyKilledStunnedDrawTrigger(game, trigger, player, source) {
  if (trigger.data?.exhaust && source.exhausted) return;
  if (!game.interactive) {
    if (trigger.data?.exhaust) source.exhausted = true;
    draw(player, trigger.data?.amount || 1, game);
    log(game, `${source.name} draws ${trigger.data?.amount || 1} because a stunned enemy unit was killed.`);
    markEffect(game, source, [source.instanceId, trigger.data?.killedUnitId].filter(Boolean), `${source.name} draws.`);
    return;
  }
  game.pendingChoice = {
    id: trigger.id,
    playerId: player.id,
    card: source,
    effect: "exhaustSourceDraw",
    prompt: `Exhaust ${source.name} to draw ${trigger.data?.amount || 1}?`,
    options: [
      { id: "draw", label: `Exhaust ${source.name} and draw ${trigger.data?.amount || 1}` },
      { id: "decline", label: "Do not use this effect" }
    ],
    data: {
      amount: trigger.data?.amount || 1,
      exhaust: Boolean(trigger.data?.exhaust),
      killedUnitId: trigger.data?.killedUnitId,
      triggerId: trigger.id
    },
    finishSpell: false,
    optional: false,
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  };
  log(game, `${player.name} may use ${source.name}.`);
}

function resolveDefendHereRevealTopSpellTrigger(game, trigger, player, source) {
  const top = player.mainDeck.shift();
  if (!top) return;
  game.pendingChoice = {
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
    fromShowdownChain: Boolean(trigger.fromShowdownChain)
  };
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

function resolveShowdownBeginsPayEnergyPredictDrawSpellTrigger(game, trigger, player, source) {
  const amount = trigger.data?.amount || 1;
  if (!payEnergyIfPossible(game, player, amount, true)) return;
  if (game.interactive) {
    game.pendingChoice = {
      id: trigger.id,
      playerId: player.id,
      card: source,
      effect: "showdownPredictDrawSpell",
      prompt: `Pay Energy ${amount} for ${source.name}?`,
      options: [
        { id: "pay", label: `Pay Energy ${amount}` },
        { id: "decline", label: "Decline" }
      ],
      data: {
        amount,
        triggerId: trigger.id,
        fromShowdownChain: Boolean(trigger.fromShowdownChain)
      },
      finishSpell: false,
      optional: false,
      fromShowdownChain: Boolean(trigger.fromShowdownChain)
    };
    game.currentPlayerId = player.id;
    log(game, `${source.name} may pay Energy ${amount}.`);
    return;
  }
  payEnergyIfPossible(game, player, amount);
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
    declaredEffect: "secondDrawBuff"
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
    optional: Boolean(trigger.data?.optional)
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
  const option = options.find((candidate) => candidate.cardId === declaration.targetId) || null;
  return { declaration, option };
}

function resolveOnPlayEffect(game, player, card) {
  const specs = cardEffects(card, "onPlay");
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

function onPlaySpecShouldTrigger(player, card, spec) {
  if (spec.additionalPower && !hasPaidOptionalEffect(card, spec)) return false;
  if (spec.requiresLegion && (player?.cardsPlayedThisTurn || 0) <= 1) return false;
  return true;
}

const EFFECT_RESOLVERS = new Map([
  ["activated:equip", (game, player, card, spec) => chooseEquipGear(game, player, card, spec)],
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
    player.nextSpellBonusDamage = Math.max(player.nextSpellBonusDamage || 0, spec.amount || 1);
    card.exhausted = true;
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
    if (spec.exhaust !== false) card.exhausted = true;
    return false;
  }],
  ["activated:addEnergy", resolveAddEnergyEffect],
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
  ["onPlay:spendFriendlyBuffBuffSelfReady", (game, player, card, spec, finishSpell) => chooseSpendFriendlyBuffBuffSelfReady(game, player, card, finishSpell)],
  ["onPlay:spendBuffsChannelRunes", resolveSpendBuffsChannelRunesEffect],
  ["onPlay:nextSpellEnergyReduction", (game, player, card, spec) => {
    player.nextSpellEnergyReduction = Math.max(player.nextSpellEnergyReduction || 0, spec.amount || 0);
    markEffect(game, card, [card.instanceId], `${player.name}'s next spell costs ${spec.amount || 0} less.`);
    return false;
  }],
  ["onPlay:optionalPowerDraw", resolveOptionalPowerDrawEffect],
  ["onPlay:playSpellFromTrashMaxEnergy", (game, player, card, spec) => chooseTrashSpell(game, player, card, spec)],
  ["conquer:playSpellFromTrashMaxEnergy", (game, player, card, spec) => chooseTrashSpell(game, player, card, spec)],
  ["onPlay:playUnitFromTrash", (game, player, card, spec, finishSpell) => chooseTrashUnitToPlay(game, player, card, spec, finishSpell)],
  ["onPlay:playUnitToken", (game, player, card, spec) => {
    playUnitToken(game, player, card, { ...spec, destination: spec.destination || "sourceBattlefield" });
    return false;
  }],
  ["onPlay:predict", (game, player, card) => offerPredictChoice(game, player, card)],
  ["onPlay:readySelf", (game, player, card) => {
    card.exhausted = false;
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
  ["spell:duelFriendlyEnemy", (game, player, card, spec, finishSpell) => chooseDuelFriendlyEnemy(game, player, card, spec, finishSpell)],
  ["spell:discardHandDraw", resolveDiscardHandDrawEffect],
  ["spell:discard", resolveDiscardEffect],
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
  ["spell:gainControlOfSpell", (game, player, card, spec, finishSpell) => chooseCounterChain(game, player, card, finishSpell, spec)],
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
  ["spell:matchFriendlyMight", (game, player, card, spec, finishSpell) => chooseMatchFriendlyMight(game, player, card, finishSpell)],
  ["spell:modifyMight", (game, player, card, spec, finishSpell) => chooseMightBySpec(game, player, card, spec, finishSpell)],
  ["spell:modifyFriendlyUnits", resolveModifyFriendlyUnitsEffect],
  ["spell:spendBuffsReadyThenBuffFriendlyUnits", resolveSpendBuffsReadyThenBuffFriendlyUnitsEffect],
  ["spell:readyUnitAny", (game, player, card, spec, finishSpell) => chooseReadyUnitAny(game, player, card, finishSpell)],
  ["spell:saveFriendlyUnitThisTurn", (game, player, card, spec, finishSpell) => chooseSaveFriendlyUnitThisTurn(game, player, card, spec, finishSpell)],
  ["spell:playUnitToken", (game, player, card, spec) => {
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
  ["spell:predict", resolvePredictEffect],
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
  for (const spec of specs) {
    const waitsForChoice = resolveEffectSpec(game, player, card, spec, finishSpell);
    if (waitsForChoice) return true;
  }
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

function resolveDrawEffect(game, player, card, spec) {
  const amount = card.paidFriendlyExhaustAdditionalCost && spec.amountIfFriendlyExhaustAdditionalCost
    ? spec.amountIfFriendlyExhaustAdditionalCost
    : (spec.amount || 1);
  draw(player, amount, game);
  markEffect(game, card, [card.instanceId], `${card.name} draws ${amount}.`);
  return false;
}

function resolveExtraTurnEffect(game, player, card) {
  game.extraTurnPlayerId = player.id;
  card.banishAfterResolve = true;
  log(game, `${player.name} will take an extra turn after this one.`);
  markEffect(game, card, [card.instanceId], `${player.name} takes an extra turn.`);
  return false;
}

function resolveDrawPerFriendlyMightyUnitEffect(game, player, card, spec) {
  const threshold = spec.threshold || 5;
  const targets = allUnits(game).filter((unit) => unit.controllerId === player.id && effectiveMight(unit) >= threshold);
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
  channel(player, amount);
  markEffect(game, card, [card.instanceId], `${card.name} channels ${amount}.`);
  log(game, `${card.name} channels ${amount} rune${amount === 1 ? "" : "s"}.`);
  return false;
}

function resolveChannelRunesOrDrawEffect(game, player, card, spec) {
  const amount = spec.amount || 1;
  const before = player.runes.length;
  channel(player, amount);
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
  addMightModifier(card, spec.amount || 1, { buff: true, maxBuffs: spec.maxBuffs });
  if (spec.draw) draw(player, spec.draw, game);
  log(game, `${card.name} is buffed and draws ${spec.draw || 0}.`);
  markEffect(game, card, [card.instanceId], `${card.name} is buffed.`);
  return false;
}

function resolveExhaustFriendlyUnitsEffect(game, player, card) {
  const targets = allUnits(game).filter((candidate) => candidate.controllerId === player.id);
  for (const unit of targets) unit.exhausted = true;
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
  for (const entry of candidates) entry.player.mainDeck.shift();
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
    finishSpell,
    optional: false,
    data: {
      revealedCards: candidates.map((entry) => entry.card),
      ownerByCardId: Object.fromEntries(candidates.map((entry) => [entry.card.instanceId, entry.player.id]))
    }
  });
}

function resolvePlayTopDeckUnitFromLookEffect(game, player, card, spec, finishSpell = false) {
  const look = Math.min(spec.look || 5, player.mainDeck.length);
  const seen = player.mainDeck.splice(0, look);
  if (!seen.length) return false;
  const units = seen
    .filter((candidate) => candidate.type === "unit")
    .filter((candidate) => canPayReducedEnergyCard(game, player, candidate, spec.energyReduction || 0));
  if (!units.length) {
    game.pendingChoice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: player.id,
      card,
      effect: "acknowledgeReveal",
      prompt: `${card.name} finds no unit.`,
      options: [{ id: "continue", label: "Continue" }],
      data: { revealedCards: seen, revealResolution: "recycleLookedCards" },
      finishSpell,
      optional: false,
      fromShowdownChain: game.phase === "showdown"
    };
    return true;
  }
  return promptChoice(game, player, card, {
    effect: "playLookedAtUnit",
    prompt: `Choose a revealed unit to play for ${card.name}, or recycle all cards.`,
    options: [
      ...units.map((unit) => ({ id: unit.instanceId, label: unit.name, cardId: unit.instanceId, card: unit, revealed: true })),
      { id: "decline", label: "Recycle all revealed cards" }
    ],
    finishSpell,
    optional: false,
    data: { revealedCards: seen, energyReduction: spec.energyReduction || 0 }
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
      if (controller) playCardIgnoringEnergyCostFromEffect(game, controller, selected.card, source);
    }
    markEffect(game, source, [source.instanceId, ...selectedCards.map((entry) => entry.card.instanceId)], `${source.name} plays chosen top deck cards.`);
    return false;
  }
  const seen = chooser.mainDeck.splice(0, Math.min(look, chooser.mainDeck.length));
  if (!seen.length) return promptPromisingFutureChoice(game, source, playerIds, index + 1, look, selectedCards, finishSpell);
  game.pendingChoice = {
    id: `choice-${Date.now()}-${Math.random()}`,
    playerId: chooser.id,
    card: source,
    effect: "promisingFutureChoose",
    prompt: `Choose one of your revealed cards for ${source.name}.`,
    options: seen.map((candidate) => ({ id: candidate.instanceId, label: candidate.name, cardId: candidate.instanceId, card: candidate, revealed: true })),
    data: { revealedCards: seen, playerIds, index, look, selectedCards },
    finishSpell,
    optional: false,
    fromShowdownChain: game.phase === "showdown"
  };
  return true;
}

function resolveDivineJudgmentEffect(game, player, card) {
  for (const candidate of game.players) {
    candidate.hand = candidate.hand.slice(0, 2);
    candidate.runes = candidate.runes.slice(0, 2);
    candidate.base = [
      ...candidate.base.filter((item) => item.type === "unit").slice(0, 2),
      ...candidate.base.filter((item) => item.type === "gear").slice(0, 2)
    ];
  }
  markEffect(game, card, [card.instanceId], `${card.name} recycles excess cards.`);
  return false;
}

function resolveUdyrChooseModeEffect(game, player, card) {
  const mode = consumeDeclaredPlayChoice(card, "udyrMode", [
    { id: "damage" }, { id: "stun" }, { id: "ready" }, { id: "ganking" }
  ])?.declaration.optionId;
  if (mode === "ready") card.exhausted = false;
  if (mode === "ganking") card.temporaryKeywords = [...new Set([...(card.temporaryKeywords || []), "Ganking"])] ;
  if (["damage", "stun"].includes(mode)) {
    const declaration = consumeDeclaredPlayTarget(card, `udyr-${mode}`, game.battlefields.flatMap((field) => field.units).map(cardOption));
    const target = declaration?.option ? findCard(game, declaration.option.cardId) : null;
    if (target && mode === "damage") {
      target.damage = (target.damage || 0) + 2;
      if (isLethalDamage(target)) killUnit(game, target, findUnitLocation(game, target.instanceId));
    }
    if (target && mode === "stun") stunUnit(game, player, card, target);
  }
  markEffect(game, card, [card.instanceId], `${card.name} resolves ${mode || "an unavailable"} mode.`);
  return false;
}

function playCardIgnoringCostFromEffect(game, player, played, source) {
  clearBoardState(played);
  played.controllerId = player.id;
  if (played.type === "spell") {
    if (!resolveEffect(game, player, played)) finishSpell(game, player, played);
    return;
  }
  putPermanentIntoPlay(game, player, played, "base", false);
  triggerCardPlayedEffects(game, player, played);
  if (cardEffects(played, "onPlay").length) resolveOnPlayEffect(game, player, played);
  log(game, `${source.name} plays ${played.name}, ignoring its cost.`);
}

function canPayReducedEnergyCard(game, player, card, energyReduction = 0) {
  const energy = Math.max(0, (card.energy || 0) - energyReduction);
  const power = normalizeCardPowerRequirements(card, card.power || []);
  return payEnergyIfPossible(game, player, energy, true) && payPowerRequirements(player, power, true);
}

function playCardIgnoringEnergyCostFromEffect(game, player, played, source, energyReduction = Number.POSITIVE_INFINITY) {
  const energy = Number.isFinite(energyReduction) ? Math.max(0, (played.energy || 0) - energyReduction) : 0;
  const power = normalizeCardPowerRequirements(played, played.power || []);
  if (!payEnergyIfPossible(game, player, energy, true) || !payPowerRequirements(player, power, true)) {
    player.banished ||= [];
    player.banished.push(played);
    log(game, `${player.name} cannot pay ${played.name}'s remaining cost, so it stays banished.`);
    return false;
  }
  payEnergyIfPossible(game, player, energy, false);
  payPowerRequirements(player, power, false);
  playCardIgnoringCostFromEffect(game, player, played, source);
  return true;
}

function resolveDealDamageAllBattlefieldUnitsEffect(game, player, card, spec) {
  const targets = spec.scope === "enemyCombat"
    ? (game.battlefields.find((field) => field.instanceId === game.showdown?.battlefieldId)?.units || [])
      .filter((unit) => unit.controllerId !== player.id)
    : game.battlefields.flatMap((field) => field.units);
  for (const unit of targets) unit.damage += spec.amount || 0;
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
    const discarded = candidate.hand.splice(0, candidate.hand.length);
    candidate.trash.push(...discarded);
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

function resolveSpendBuffsReadyThenBuffFriendlyUnitsEffect(game, player, card) {
  const targets = allUnits(game).filter((unit) => unit.controllerId === player.id);
  for (const unit of targets) {
    if ((unit.buffs || 0) > 0) {
      unit.buffs -= 1;
      unit.exhausted = false;
    }
  }
  for (const unit of targets) addMightModifier(unit, 1, { buff: true, maxBuffs: 1 });
  markEffect(game, card, [card.instanceId, ...targets.map((unit) => unit.instanceId)], `${card.name} readies and buffs friendly units.`);
  log(game, `${card.name} spends buffs, readies, then buffs friendly units.`);
  return false;
}

function resolveSpendBuffsChannelRunesEffect(game, player, card) {
  const targets = allUnits(game).filter((unit) => unit.controllerId === player.id && (unit.buffs || 0) > 0);
  let spent = 0;
  for (const unit of targets) {
    spent += unit.buffs || 0;
    unit.buffs = 0;
  }
  if (spent > 0) channel(player, spent, true);
  markEffect(game, card, [card.instanceId, ...targets.map((unit) => unit.instanceId)], `${card.name} spends buffs and channels.`);
  log(game, `${card.name} spends ${spent} buff${spent === 1 ? "" : "s"} and channels ${spent} rune${spent === 1 ? "" : "s"} exhausted.`);
  return false;
}

function resolveModifyEnemyUnitsEffect(game, player, card, spec) {
  const targets = allUnits(game).filter((unit) => unit.controllerId !== player.id);
  for (const unit of targets) {
    const amount = spec.minMight != null && effectiveMight(unit) + (spec.amount || 0) < spec.minMight
      ? spec.minMight - effectiveMight(unit)
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
  predict(player);
  log(game, `${card.name} predicts.`);
  markEffect(game, card, [card.instanceId], `${card.name} predicts.`);
  return false;
}

export function hasRequiredPlayTargets(game, player, card, destination = "base") {
  if (card.additionalCost?.kind === "killFriendlyUnit" && !allUnits(game).some((unit) => unit.controllerId === player.id)) return false;
  if (card.type === "unit") return true;
  const specs = cardEffects(card, "spell");
  return specs.every((spec) => spec.optional || hasRequiredSpecTarget(game, player, card, spec, destination));
}

function hasRequiredSpecTarget(game, player, card, spec, destination = "base") {
  if (!spec || spec.optional) return true;
  const declaration = spellTargetDeclaration(spec);
  if (declaration) {
    const firstDeclaration = declaration.steps?.[0] || declaration;
    if (spec.kind === "alphaStrike" && !game.battlefields.some((field) => field.units.some((unit) => unit.controllerId !== player.id))) {
      return false;
    }
    const minimum = firstDeclaration.optional ? 0 : (spec.minTargets ?? (spec.max != null ? 0 : 1));
    return minimum === 0 || declarationTargetOptions(game, player, card, spec, firstDeclaration).length > 0;
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

function chooseMatchFriendlyMight(game, player, card, finishSpell = false) {
  const units = allUnits(game)
    .filter((unit) => unit.controllerId === player.id)
    .filter((unit) => canChooseUnit(game, player, card, unit));
  return promptChoice(game, player, card, {
    effect: "matchFriendlyMightTarget",
    prompt: `Choose a friendly unit for ${card.name}.`,
    options: units.map(cardOption),
    finishSpell,
    data: {}
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
      .filter((item) => item.ownerId === player.id)
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
    data: { legion: (player.cardsPlayedThisTurn || 0) > 1 }
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
    data: { readyAfterMove: Boolean(spec.readyAfterMove), ...repeatChoiceData(spec) }
  });
}

function chooseReturnUnitToHand(game, player, card, scope, finishSpell = false, spec = {}) {
  const targets = battlefieldUnitTargets(game, player, scope)
    .filter((source) => canChooseUnit(game, player, card, source.unit))
    .filter((source) => spec.maxMight == null || effectiveMight(source.unit) <= spec.maxMight);
  return promptChoice(game, player, card, {
    effect: "returnUnitToHand",
    prompt: `Choose a unit to return with ${card.name}.`,
    options: targets.map((source) => cardOption(source.unit)),
    finishSpell,
    data: { channelOwner: spec.channelOwner || 0 }
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
  return promptChoice(game, player, card, {
    effect: "chooseTopDeck",
    prompt: `Choose one of the top 3 cards for ${card.name}.`,
    options: top.map((candidate) => ({ id: candidate.instanceId, label: candidate.name, cardId: candidate.instanceId })),
    finishSpell,
    optional: top.length === 0
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
    data: { drawController: spec.drawController || 0 }
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
    optional: true
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
    const controller = game.players.find((candidate) => candidate.id === card.controllerId || candidate.id === card.ownerId);
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
  const maxEnergy = spec.maxEnergyFromPoints
    ? Math.max(0, (player.score || 0) - (spec.lessThanPoints ? 1 : 0))
    : spec.maxEnergy;
  const options = player.trash
    .filter((candidate) => candidate.type === "spell" && (maxEnergy == null || (candidate.energy || 0) <= maxEnergy))
    .filter((candidate) => payPowerRequirements(player, normalizeCardPowerRequirements(candidate, candidate.power || []), true))
    .map(cardOption);
  return promptChoice(game, player, card, {
    effect: "playTrashSpell",
    prompt: `Choose a spell from trash for ${card.name}.`,
    options,
    optional: true,
    data: { maxEnergy }
  });
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
    data: { domain: spec.domain || "Any" }
  });
}

function chooseTrashUnitToPlay(game, player, card, spec = {}, finishSpell = false) {
  const options = player.trash
    .filter((candidate) => candidate.type === "unit")
    .filter((candidate) => spec.maxEnergy == null || (candidate.energy || 0) <= spec.maxEnergy)
    .filter((candidate) => spec.maxPower == null || totalPowerAmount(candidate.power || []) <= spec.maxPower)
    .filter((candidate) => spec.ignorePowerCost || payPowerRequirements(player, normalizeCardPowerRequirements(candidate, candidate.power || []), true))
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
    fromShowdownChain: game.phase === "showdown" && Boolean(config.finishSpell)
  };

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

  const declaredTarget = consumeDeclaredPlayTarget(card, choice.effect, choice.options);
  if (declaredTarget) {
    if (!declaredTarget.option) {
      log(game, `${card.name}'s declared target is no longer legal.`);
      if (choice.finishSpell) finishSpell(game, player, card);
      return false;
    }
    applyChoiceEffect(game, choice, declaredTarget.option);
    return Boolean(game.pendingChoice);
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

  game.pendingChoice = choice;
  log(game, `${player.name} chooses an effect target for ${card.name}.`);
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
  game.pendingChoice = choice;
  return true;
}

const CHOICE_RESOLVERS = new Map([
  ["acknowledgeReveal", resolveAcknowledgeRevealChoice],
  ["cardPlayedLegendTrigger", resolveCardPlayedLegendTriggerChoice],
  ["declareUdyrMode", resolveDeclareUdyrModeChoice],
  ["declareUdyrTarget", resolveDeclareUdyrTargetChoice],
  ["declareActivatedTarget", resolveDeclareActivatedTargetChoice],
  ["declareActivatedMoveDestination", resolveDeclareActivatedMoveDestinationChoice],
  ["declarePlayTarget", resolveDeclarePlayTargetChoice],
  ["declareMoveDestination", resolveDeclareMoveDestinationChoice],
  ["declareHiddenPlayTarget", resolveDeclarePlayTargetChoice],
  ["declareHiddenMoveDestination", resolveDeclareMoveDestinationChoice],
  ["declareTrashSpellTarget", resolveDeclarePlayTargetChoice],
  ["declareTrashSpellMoveDestination", resolveDeclareMoveDestinationChoice],
  ["repeatSpell", resolveRepeatSpellChoice],
  ["showdownPredictDrawSpell", resolveShowdownPredictDrawSpellChoice],
  ["predictChoice", ({ game, choice, option, player, source }) => resolvePredictChoice(game, player, source, option, choice)],
  ["discardCard", resolveDiscardCardChoice],
  ["discardEnergyDamage", resolveDiscardEnergyDamageChoice],
  ["drawOrChannelRunes", resolveDrawOrChannelRunesChoice],
  ["optionalChannelRunes", resolveOptionalChannelRunesChoice],
  ["spendBuffDraw", resolveSpendBuffDrawChoice],
  ["returnChosenChampion", resolveReturnChosenChampionChoice],
  ["hweiDiscard", ({ game, choice, option, player, source }) => resolveHweiDiscard(game, player, source, option, choice)],
  ["readyRunes", ({ game, choice, option, player, source }) => resolveReadyRunesChoice(game, player, source, option, choice)],
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
  ["moveUnitToSourceBattlefield", resolveMoveUnitToSourceBattlefieldChoice],
  ["moveWithFriendlyFromSameBattlefield", resolveMoveWithFriendlyFromSameBattlefieldChoice],
  ["returnUnitToHand", resolveReturnUnitToHandChoice],
  ["returnOwnedTagUnitToHand", resolveReturnOwnedTagUnitToHandChoice],
  ["returnHiddenTrashToHand", resolveReturnHiddenTrashToHandChoice],
  ["killBattlefieldUnitsTotalMightMax", resolveKillBattlefieldUnitsTotalMightMaxChoice],
  ["damageEnemyUnitsAtBattlefieldByReadyRunes", resolveDamageEnemyUnitsAtBattlefieldByReadyRunesChoice],
  ["saveFriendlyUnitThisTurn", resolveSaveFriendlyUnitThisTurnChoice],
  ["returnFriendlyPermanentOrHiddenToHand", resolveReturnFriendlyPermanentOrHiddenToHandChoice],
  ["eachPlayerReturnUnitToHand", resolveEachPlayerReturnUnitToHandChoice],
  ["eachOtherPlayerKillUncontrolledUnit", resolveEachOtherPlayerKillUncontrolledUnitChoice],
  ["partyFavors", resolvePartyFavorsChoice],
  ["returnTrashUnitToHand", resolveReturnTrashUnitToHandChoice],
  ["discardOpponentHand", resolveDiscardOpponentHandChoice],
  ["counterChainCard", resolveCounterChainCardChoice],
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
  ["alphaStrikeDamage", resolveAlphaStrikeDamageChoice],
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
  "alphaStrikeDamage",
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

function maybeResolveDeflectForChoice({ game, choice, option, player, source, target }) {
  if (!DEFLECTABLE_CHOICE_EFFECTS.has(choice.effect)) return false;
  if (!(target?.type === "unit") || !needsDeflectPayment(player, target) || deflectPaidForChoice(choice, target)) return false;
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
    prepareAndQueueTriggers(game, [trigger, ...(choice.data.remainingTriggers || [])], choice.data.mode || "queue", choice.data.continuation || null);
    return;
  }
  if (!option.cardId) {
    if (!(trigger.data?.declaredTargets || []).length) trigger.declined = true;
    else trigger.data.declarationComplete = true;
    prepareAndQueueTriggers(game, [trigger, ...(choice.data.remainingTriggers || [])], choice.data.mode || "queue", choice.data.continuation || null);
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
  prepareAndQueueTriggers(game, [trigger, ...(choice.data.remainingTriggers || [])], choice.data.mode || "queue", choice.data.continuation || null);
}

function resolveAcknowledgeRevealChoice({ game, choice, player, source }) {
  const revealed = choice.data?.revealedCards || [];
  if (choice.data?.revealResolution === "ravenbloomConservatory") {
    const [top] = revealed;
    if (top?.type === "spell") {
      player.hand.push(top);
      log(game, `${source.name} puts ${top.name} into ${player.name}'s hand.`);
    } else if (top) {
      player.mainDeck.push(top);
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
      target.damage = (target.damage || 0) + amount;
      if (isLethalDamage(target)) killUnit(game, target, { type: "battlefield", battlefield });
    }
    recycleMainDeckCards(player, revealed);
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
      player.hand.push(top);
      log(game, `${source.name} reveals ${top.name} and puts it into hand.`);
      markEffect(game, source, [source.instanceId, top.instanceId], `${source.name} reveals a spell.`);
    }
    if (!choice.fromShowdownChain) continueShowdownStartEffects(game, choice.data?.resumeShowdownStart);
    return;
  }
  if (choice.data?.revealResolution === "recycleLookedCards") {
    recycleMainDeckCards(player, revealed);
    markEffect(game, source, [source.instanceId, ...revealed.map((card) => card.instanceId)], `${source.name} recycles revealed cards.`);
  }
}

function resolvePlayRevealedOpponentTopDeckChoice({ game, choice, option, player, source }) {
  const selected = choice.data?.revealedCards?.find((card) => card.instanceId === option.cardId);
  for (const revealed of choice.data?.revealedCards || []) {
    if (revealed.instanceId === selected?.instanceId) continue;
    const owner = game.players.find((candidate) => candidate.id === choice.data?.ownerByCardId?.[revealed.instanceId]);
    if (owner) owner.mainDeck.push(revealed);
  }
  if (selected) {
    playCardIgnoringCostFromEffect(game, player, selected, source);
    markEffect(game, source, [selected.instanceId], `${source.name} plays ${selected.name}.`);
  }
}

function resolvePlayLookedAtUnitChoice({ game, choice, option, player, source }) {
  const revealed = choice.data?.revealedCards || [];
  const selected = revealed.find((card) => card.instanceId === option.cardId);
  recycleMainDeckCards(player, revealed.filter((card) => card.instanceId !== selected?.instanceId));
  if (selected) {
    if (playCardIgnoringEnergyCostFromEffect(game, player, selected, source, choice.data?.energyReduction || 0)) {
      markEffect(game, source, [selected.instanceId], `${source.name} plays ${selected.name}.`);
    }
  } else {
    markEffect(game, source, [source.instanceId, ...revealed.map((card) => card.instanceId)], `${source.name} recycles revealed cards.`);
  }
}

function resolvePromisingFutureChooseChoice({ game, choice, option, source }) {
  const chooser = game.players.find((candidate) => candidate.id === choice.playerId);
  const revealed = choice.data?.revealedCards || [];
  const selected = revealed.find((card) => card.instanceId === option.cardId);
  if (chooser) recycleMainDeckCards(chooser, revealed.filter((card) => card.instanceId !== selected?.instanceId));
  const selectedCards = [
    ...(choice.data?.selectedCards || []),
    ...(selected ? [{ playerId: choice.playerId, card: selected }] : [])
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

function resolveDeclareActivatedTargetChoice({ game, choice, option, player, source }) {
  if (!option.cardId) return;
  source.declaredPlayTargets = [{ effect: choice.data.targetEffect, targetId: option.cardId }];
  source.deflectPaidTargetIds = [];
  const target = findCard(game, option.cardId);
  if (target && needsDeflectPayment(player, target)) {
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
  const targetDeflectPowerCost = targetCard && needsDeflectPayment(player, targetCard) && !alreadyPaysDeflect
    ? [{ domain: "Any", amount: deflectAmount(targetCard) }]
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
  const allocationRemaining = choice.data.currentDeclaration?.declaration?.allocation
    ? Math.max(0, (choice.data.allocationRemaining || 0) - (option.amount || 0))
    : null;
  if (allocationRemaining === 0 && choice.data.currentDeclaration?.declaration?.allocation) {
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
    return;
  }
  if (selectedForCurrentStep.length < (choice.data.max || 1)) {
    const selectedMight = declaredTargets
      .filter((target) => target.effect === choice.data.targetEffect)
      .reduce((sum, declaration) => sum + effectiveMight(findCard(game, declaration.targetId)), 0);
    const maxMight = choice.data.currentDeclaration?.declaration?.maxTotalMightFromSpec
      ? (choice.data.currentDeclaration.spec.maxMight || 4)
      : null;
    const options = (choice.data.currentDeclaration?.declaration?.allocation
      ? alphaStrikeDamageOptions(game, player, source, allocationRemaining)
      : choice.options.filter((candidate) => candidate.cardId))
      .filter((candidate) => candidate.cardId)
      .filter((candidate) => choice.data.currentDeclaration?.spec?.allowRepeatedTargets
        || choice.data.currentDeclaration?.declaration?.allowRepeatedTargets
        || choice.data.currentDeclaration?.declaration?.allocation
        || !selectedForCurrentStep.includes(candidate.cardId))
      .filter((candidate) => {
        if (choice.data.targetEffect !== "spendFriendlyBuffsAdditionalCost") return true;
        const selectedCount = declaredTargets.filter((declaration) => declaration.effect === choice.data.targetEffect && declaration.targetId === candidate.cardId).length;
        return selectedCount < (findCard(game, candidate.cardId)?.buffs || 0);
      })
      .filter((candidate) => maxMight == null || selectedMight + effectiveMight(findCard(game, candidate.cardId)) <= maxMight);
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
          allocationRemaining,
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

function resolveDeclareTrashSpellTargetChoice({ game, choice, option, player, source }) {
  const spell = findCard(game, choice.data.spellId);
  const fizzSource = findCard(game, choice.data.sourceId) || source;
  const targetId = option.cardId;
  const targetCard = findCard(game, targetId);
  const deflectPowerCost = targetCard && needsDeflectPayment(player, targetCard)
    ? [{ domain: "Any", amount: deflectAmount(targetCard) }]
    : [];
  const deflectTargetIds = deflectPowerCost.length ? [targetId] : [];
  if (!spell || !fizzSource) return;
  if (choice.data.requiresDestination) {
    const options = targetCard?.type === "unit" ? spellMoveDestinationOptions(game, targetCard) : [];
    if (!options.length) {
      log(game, `${spell.name} has no legal move destination for ${targetCard?.name || "the target"}.`);
      return;
    }
    game.pendingChoice = {
      id: `choice-${Date.now()}-${Math.random()}`,
      playerId: player.id,
      card: spell,
      effect: "declareTrashSpellMoveDestination",
      prompt: `Declare where ${targetCard.name} will move for ${spell.name}.`,
      options,
      data: {
        sourceId: fizzSource.instanceId,
        spellId: spell.instanceId,
        targetEffect: choice.data.targetEffect,
        destinationEffect: choice.data.destinationEffect || "moveUnitSpellDestination",
        targetId,
        deflectPowerCost,
        deflectTargetIds
      },
      finishSpell: false,
      optional: false,
      fromShowdownChain: false
    };
    log(game, `${player.name} declares ${targetCard.name} for ${spell.name}.`);
    return;
  }
  beginTrashSpellPayment(game, player, fizzSource, spell, [
    { effect: choice.data.targetEffect, targetId }
  ], [], deflectPowerCost, deflectTargetIds);
  if (deflectPowerCost.length) log(game, `${targetCard.name} adds Deflect Power to ${spell.name}.`);
}

function resolveDeclareTrashSpellMoveDestinationChoice({ game, choice, option, player, source }) {
  const spell = findCard(game, choice.data.spellId);
  const fizzSource = findCard(game, choice.data.sourceId) || source;
  const targetId = choice.data.targetId;
  const targetCard = findCard(game, targetId);
  const destinationId = option.destination || option.id;
  if (!spell || !fizzSource) return;
  beginTrashSpellPayment(game, player, fizzSource, spell, [
    { effect: choice.data.targetEffect, targetId }
  ], [{
    effect: choice.data.destinationEffect || "moveUnitSpellDestination",
    unitId: targetId,
    destinationId
  }], choice.data.deflectPowerCost || [], choice.data.deflectTargetIds || []);
  log(game, `${player.name} declares ${targetCard?.name || "the target"} will move to ${option.label || destinationId} for ${spell.name}.`);
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
    addMightModifier(target, choice.data.amount || 1, { temporary: true });
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
    target.damage += amount;
    markEffect(game, source, [target.instanceId], `${target.name} takes ${amount} combat damage.`);
    log(game, `${player.name} assigns ${amount} combat damage to ${target.name}.`);
    const remaining = Math.max(0, (choice.data.remaining || 0) - amount);
    if (remaining > 0) {
      promptCombatDamageChoice(game, { ...choice.data, remaining });
      return;
    }
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
  if (!payChosenPowerRunes(player, uniqueSelected, amount)) {
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
  const { game, source, target } = context;
  if (target) {
    target.exhausted = false;
    log(game, `${source.name} readies ${target.name}.`);
    markEffect(game, source, [target.instanceId], `${source.name} readies ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveReadyAnotherExhaustedChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    target.exhausted = false;
    log(game, `${source.name} readies ${target.name}.`);
    markEffect(game, source, [target.instanceId], `${source.name} readies ${target.name}.`);
  }
  finishAfterMoveChoice(game, choice.data?.afterMove);
}

function resolveBaitedHookSacrificeChoice(context) {
  const { game, choice, player, source, target } = context;
  if (!target) return finishChoiceResolution(context);
  const killedMight = effectiveMight(target);
  const location = findUnitLocation(game, target.instanceId);
  killUnit(game, target, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
  const topCards = player.mainDeck.slice(0, 5);
  const options = topCards
    .filter((card) => card.type === "unit" && effectiveMight(card) <= killedMight + 1)
    .map(cardOption);
  const nextChoice = {
    ...choice,
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
      killedUnitId: target.instanceId
    }
  };
  log(game, `${source.name} kills ${target.name} and looks at the top ${topCards.length} cards.`);
  markEffect(game, source, [target.instanceId], `${target.name} is killed.`);
  presentPreparedChoice(game, nextChoice);
}

function resolveBaitedHookTopDeckChoice(context) {
  const { game, choice, option, player, source } = context;
  const topIdSet = new Set(choice.data.topCardIds || []);
  const topCards = player.mainDeck.filter((card) => topIdSet.has(card.instanceId));
  let played = null;
  if (option.cardId) {
    const index = player.mainDeck.findIndex((card) => card.instanceId === option.cardId);
    if (index >= 0) {
      [played] = player.mainDeck.splice(index, 1);
      clearBoardState(played);
      putPermanentIntoPlay(game, player, played, "base", false);
      triggerCardPlayedEffects(game, player, played);
      resolveOnPlayEffect(game, player, played);
    }
  }
  const recycleIds = new Set((choice.data.topCardIds || []).filter((id) => id !== played?.instanceId));
  const recycled = [];
  player.mainDeck = player.mainDeck.filter((card) => {
    if (!recycleIds.has(card.instanceId)) return true;
    recycled.push(card);
    return false;
  });
  recycleMainDeckCards(player, recycled);
  log(game, `${source.name} ${played ? `plays ${played.name}` : "plays no unit"} and recycles the rest.`);
  markEffect(game, source, [played?.instanceId, ...recycled.map((card) => card.instanceId)].filter(Boolean), `${source.name} resolves.`);
  finishChoiceResolution(context);
}

function resolveSpendFriendlyBuffBuffSelfReadyChoice(context) {
  const { game, source, target } = context;
  if (target && (target.buffs || 0) > 0) {
    target.buffs -= 1;
    addMightModifier(source, 1, { buff: true, maxBuffs: 1 });
    source.exhausted = false;
    log(game, `${source.name} spends ${target.name}'s buff, buffs itself, and readies.`);
    markEffect(game, source, [source.instanceId, target.instanceId], `${source.name} buffs and readies.`);
  }
  finishChoiceResolution(context);
}

function resolveKillFriendlyPermanentChannelRuneChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    if (target.type === "gear") {
      killGear(game, target, source);
    } else {
      const location = findUnitLocation(game, target.instanceId);
      killUnit(game, target, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
    }
    channel(player, 1, true);
    log(game, `${source.name} kills ${target.name} and channels a rune exhausted.`);
    markEffect(game, source, [target.instanceId], `${target.name} is killed.`);
  }
  finishChoiceResolution(context);
}

function resolveBuffUnitChoice(context) {
  const { game, choice, player, source, target } = context;
  if (target) {
    addMightModifier(target, choice.data.amount, { buff: Boolean(choice.data.buff), maxBuffs: choice.data.maxBuffs });
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
    addMightModifier(target, choice.data.amount || 2);
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
    if (minMight != null && effectiveMight(target) + amount < minMight) {
      addMightModifier(target, minMight - effectiveMight(target), { temporary: Boolean(choice.data.temporary) });
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
    let amount = choice.data.amountFromSelfMight
      ? currentCombatMight(game, sourceBattlefield, source, "attacker")
      : choice.data.amount || 0;
    if (source.type === "spell" && (player.nextSpellBonusDamage || 0) > 0) {
      amount += player.nextSpellBonusDamage || 0;
    }
    amount += bonusDamageToUnitFromBattlefield(game, target);
    if (spellAbilityDamagePrevented(game, source)) amount = 0;
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
            amount,
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
    target.damage += amount;
    log(game, `${source.name} deals ${amount} damage to ${target.name}.`);
    markEffect(game, source, [target.instanceId], `${target.name} takes ${amount} damage.`);
    const killed = isLethalDamage(target);
    if (killed) {
      const location = findUnitLocation(game, target.instanceId);
      killUnit(game, target, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
    }
    if (choice.data.draw) draw(player, choice.data.draw, game);
    if (killed && choice.data.drawIfKilled) draw(player, choice.data.drawIfKilled, game);
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
  finishChoiceResolution(context);
}

function bonusDamageToUnitFromBattlefield(game, target) {
  const battlefield = findUnitLocation(game, target.instanceId)?.battlefield;
  if (!battlefield) return 0;
  const local = cardEffects(battlefield, "static")
    .filter((effect) => effect.kind === "bonusDamageToUnitsHere")
    .reduce((sum, effect) => sum + (effect.amount || 1), 0);
  const player = game.players.find((candidate) => candidate.id === game.currentPlayerId);
  const global = player ? allControlledCards(game, player.id)
    .flatMap((source) => cardEffects(source, "static"))
    .filter((effect) => effect.kind === "globalBonusDamage")
    .reduce((sum, effect) => sum + (effect.amount || 1), 0) : 0;
  return local + global;
}

function spellAbilityDamagePrevented(game, source) {
  if ((game.preventSpellAbilityDamageUntilTurnSequence ?? -1) < (game.turnSequence || 0)) return false;
  return source.type === "spell" || cardEffects(source, "activated").length > 0;
}

function resolveKillOnNextDamageOrNowIfLegionChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    if (choice.data.legion) {
      const location = findUnitLocation(game, target.instanceId);
      killUnit(game, target, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
      log(game, `${source.name} kills ${target.name} with Legion.`);
    } else {
      target.killOnDamageUntilTurnSequence = game.turnSequence || 0;
      log(game, `${source.name} marks ${target.name} to die when it next takes damage this turn.`);
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
    target.damage += choice.data.amount || 0;
    log(game, `${source.name} deals ${choice.data.amount || 0} damage to ${target.name}.`);
    if (isLethalDamage(target)) {
      const location = findUnitLocation(game, target.instanceId);
      killUnit(game, target, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
    }
  }
  if (choice.data.finishSpell && player) finishSpell(game, player, source);
}

function resolveGiveKeywordChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    target.temporaryKeywords = [...new Set([...(target.temporaryKeywords || []), ...(choice.data.keywords || [])])];
    if (choice.data.tank) target.temporaryKeywords = [...new Set([...(target.temporaryKeywords || []), "Tank"])];
    if (choice.data.shieldAmount) target.temporaryShieldAmount = Math.max(target.temporaryShieldAmount || 0, choice.data.shieldAmount);
    if (choice.data.might) addMightModifier(target, choice.data.might);
    log(game, `${source.name} gives ${target.name} ${(choice.data.keywords || []).join(", ")} this turn.`);
    markEffect(game, source, [target.instanceId], `${target.name} gains a keyword.`);
  }
  finishChoiceResolution(context);
}

function resolveDoubleMightTemporaryChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    addMightModifier(target, effectiveMight(target));
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
    data: { targetId: target.instanceId }
  };
  if (!nextChoice.options.length) return finishChoiceResolution(context);
  presentPreparedChoice(game, nextChoice);
}

function resolveMatchFriendlyMightSourceChoice(context) {
  const { game, choice, source, target } = context;
  const chosenTarget = findCard(game, choice.data.targetId);
  if (chosenTarget && target) {
    const amount = Math.max(0, effectiveMight(target) - effectiveMight(chosenTarget));
    if (amount > 0) addMightModifier(chosenTarget, amount);
    log(game, `${source.name} increases ${chosenTarget.name}'s Might to match ${target.name}.`);
    markEffect(game, source, [chosenTarget.instanceId, target.instanceId], `${chosenTarget.name} matches ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveBanishFriendlyUnitPlayToBaseChoice(context) {
  const { game, source, target } = context;
  if (target) {
    const location = findUnitLocation(game, target.instanceId);
    const owner = game.players.find((player) => player.id === target.ownerId);
    if (location && owner) {
      removeUnitFromSource(location);
      detachAttachmentsToBase(game, target, location);
      clearBoardState(target);
      target.controllerId = owner.id;
      putPermanentIntoPlay(game, owner, target, "base", false);
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
    killUnit(game, target, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
    if (choice.data.drawController && controller) draw(controller, choice.data.drawController, game);
    log(game, `${source.name} kills ${target.name}.`);
    markEffect(game, source, [target.instanceId], `${target.name} is killed.`);
  }
  finishChoiceResolution(context);
}

function resolveOnPlayDuelEnemyChoice(context) {
  const { game, source, target } = context;
  if (target) {
    const sourceMight = effectiveMight(source);
    const targetMight = effectiveMight(target);
    source.damage += targetMight;
    target.damage += sourceMight;
    log(game, `${source.name} and ${target.name} deal damage to each other.`);
    markEffect(game, source, [source.instanceId, target.instanceId], `${source.name} duels ${target.name}.`);
    for (const unit of [source, target]) {
      if (!isLethalDamage(unit)) continue;
      const location = findUnitLocation(game, unit.instanceId);
      killUnit(game, unit, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
    }
  }
  finishChoiceResolution(context);
}

function resolveStunOrKillEnemyChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    if (target.stunned) {
      const location = findUnitLocation(game, target.instanceId);
      killUnit(game, target, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
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
      if (choice.data.ping) target.damage += 1;
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
    if (!returnUnitToBase(game, target, source.name)) {
      finishChoiceResolution(context);
      return;
    }
    markEffect(game, source, [target.instanceId], `${target.name} moves to base.`);
    const remaining = (choice.data.max || 1) - 1;
    if (remaining > 0) {
      const next = {
        ...choice,
        id: `choice-${Date.now()}-${Math.random()}`,
        data: { ...choice.data, max: remaining },
        options: battlefieldUnitTargets(game, player, choice.data.scope)
          .filter((candidate) => canMoveUnitFromBattlefieldToBase(game, candidate.unit))
          .filter((candidate) => canChooseUnit(game, player, source, candidate.unit))
          .map((candidate) => cardOption(candidate.unit)),
        optional: true
      };
      if (next.options.length) {
        presentPreparedChoice(game, next);
        return;
      }
    }
  }
  finishChoiceResolution(context);
}

function resolveReturnUnitToHandChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    const owner = game.players.find((candidate) => candidate.id === target.ownerId);
    returnUnitToHand(game, target, source.name);
    if (choice.data?.channelOwner && owner) channel(owner, choice.data.channelOwner);
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
      hidden.battlefield.hidden.splice(hidden.index, 1);
      target.hidden = false;
      clearBoardState(target);
      owner.hand.push(target);
      log(game, `${source.name} returns a hidden card to ${owner.name}'s hand.`);
      markEffect(game, source, [target.instanceId], `${target.name} returns to hand.`);
    } else if (target.type === "unit") {
      returnUnitToHand(game, target, source.name);
      markEffect(game, source, [target.instanceId], `${target.name} returns to hand.`);
    } else if (target.type === "gear" && owner) {
      removeGearEverywhere(game, target.instanceId);
      clearBoardState(target);
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
      player.champion.zone = "champion";
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
  const { game, choice, source, option } = context;
  const battlefield = game.battlefields.find((field) => field.instanceId === option.cardId);
  const maxMight = choice.data?.maxMight || 4;
  if (battlefield) {
    const declarations = source.declaredPlayTargets || [];
    const selectedIds = declarations
      .filter((declaration) => declaration.effect === "killBattlefieldUnitsSelection")
      .map((declaration) => declaration.targetId);
    source.declaredPlayTargets = declarations.filter((declaration) => declaration.effect !== "killBattlefieldUnitsSelection");
    const killed = battlefield.units.filter((unit) => selectedIds.includes(unit.instanceId));
    const total = killed.reduce((sum, unit) => sum + effectiveMight(unit), 0);
    if (total <= maxMight) {
      for (const unit of [...killed]) killUnit(game, unit, { type: "battlefield", battlefield });
    }
    markEffect(game, source, killed.map((unit) => unit.instanceId), `${source.name} kills units at ${battlefield.name}.`);
  }
  finishChoiceResolution(context);
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
    const paidRuneIds = [];
    for (const runeId of [...new Set(declaredRuneIds)]) {
      const index = player.runes.findIndex((rune) => rune.instanceId === runeId && !rune.exhausted);
      if (index < 0) continue;
      const [rune] = player.runes.splice(index, 1);
      rune.exhausted = false;
      player.runeDeck.push(rune);
      paidRuneIds.push(runeId);
    }
    const amount = paidRuneIds.length;
    const targets = battlefield.units.filter((unit) => unit.controllerId !== player.id);
    for (const unit of [...targets]) {
      unit.damage = (unit.damage || 0) + amount;
      if (isLethalDamage(unit)) killUnit(game, unit, { type: "battlefield", battlefield });
    }
    log(game, `${source.name} pays ${amount} Rune and deals that much damage to enemy units at ${battlefield.name}.`);
    markEffect(game, source, targets.map((unit) => unit.instanceId), `${source.name} damages enemies.`);
  }
  finishChoiceResolution(context);
}

function resolveSaveFriendlyUnitThisTurnChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    target.saveWithRuneUntilTurnSequence = game.turnSequence || 0;
    target.saveWithRuneDomain = choice.data?.domain || "Any";
    log(game, `${source.name} prepares to save ${target.name} this turn.`);
    markEffect(game, source, [target.instanceId], `${target.name} can be saved this turn.`);
  }
  finishChoiceResolution(context);
}

function resolvePlayTrashUnitChoice(context) {
  const { game, choice, player, source, target } = context;
  const index = player.trash.findIndex((card) => card.instanceId === target?.instanceId);
  if (index >= 0) {
    const candidate = player.trash[index];
    if (choice.data?.ignorePowerCost || payPowerRequirements(player, normalizeCardPowerRequirements(candidate, candidate.power || []))) {
      const [played] = player.trash.splice(index, 1);
      clearBoardState(played);
      putPermanentIntoPlay(game, player, played, choice.data?.destination || "base", false);
      triggerCardPlayedEffects(game, player, played);
      resolveOnPlayEffect(game, player, played);
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
    const [discarded] = opponent.hand.splice(index, 1);
    opponent.trash.push(discarded);
    opponent.discardedCardsThisTurn = (opponent.discardedCardsThisTurn || 0) + 1;
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
  }
  finishChoiceResolution(context);
}

function resolveMoveUnitToSourceBattlefieldChoice(context) {
  const { game, choice, option, source, target } = context;
  if (option.id !== "decline" && target) {
    const battlefield = game.battlefields.find((field) => field.instanceId === choice.data?.battlefieldId);
    const location = findUnitLocation(game, target.instanceId);
    if (battlefield && location) {
      const oldBattlefield = location.type === "battlefield" ? location.battlefield : null;
      removeUnitFromSource(location);
      battlefield.units.push(target);
      if (oldBattlefield) settleBattlefieldAfterEffectMove(game, oldBattlefield);
      updateBattlefieldControl(game);
      upgradeNonCombatShowdownIfOpposed(game, battlefield);
      markEffect(game, source, [target.instanceId], `${target.name} moves to ${battlefield.name}.`);
      log(game, `${source.name} moves ${target.name} to ${battlefield.name}.`);
    }
  }
  finishChoiceResolution(context);
}

function resolveMoveWithFriendlyFromSameBattlefieldChoice(context) {
  const { game, choice, option, player, source } = context;
  const companion = findCard(game, choice.data.companionId);
  if (option.id === "move" && companion) {
    const location = findUnitLocation(game, companion.instanceId);
    if (location) {
      removeUnitFromSource(location);
      companion.exhausted = true;
      if (choice.data.destinationId === "base") {
        player.base.push(companion);
      } else {
        const destination = game.battlefields.find((field) => field.instanceId === choice.data.destinationId);
        if (destination) destination.units.push(companion);
      }
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
  const { game, choice, option, source } = context;
  const opponent = game.players.find((candidate) => candidate.id === choice.data.opponentId);
  const index = opponent?.hand.findIndex((card) => card.instanceId === option.cardId) ?? -1;
  if (index >= 0) {
    if (opponent.hand[index].type === "unit") {
      log(game, `${source.name} cannot choose a unit card.`);
      return;
    }
    const [recycled] = opponent.hand.splice(index, 1);
    opponent.mainDeck.push(recycled);
    log(game, `${source.name} recycles ${recycled.name} from ${opponent.name}'s hand.`);
    markEffect(game, source, [], `${recycled.name} recycled.`);
  }
  finishChoiceResolution(context);
}

function resolveChooseTopDeckChoice(context) {
  const { game, option, player, source } = context;
  const index = player.mainDeck.findIndex((card) => card.instanceId === option.cardId);
  if (index >= 0) {
    const [chosen] = player.mainDeck.splice(index, 1);
    const recycled = player.mainDeck.splice(0, Math.min(2, player.mainDeck.length));
    player.hand.push(chosen);
    player.mainDeck.push(...recycled);
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
  player.mainDeck = [...returned, ...remainder, ...recycled];
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
  const allocations = declarations.filter((declaration) => declaration.effect === "alphaStrikeDamage");
  source.declaredPlayTargets = declarations.filter((declaration) => declaration.effect !== "alphaStrikeDamage");
  if (!allocations.length) {
    const remainingDamage = Math.max(0, effectiveMight(target));
    const options = alphaStrikeDamageOptions(game, player, source, remainingDamage);
    if (remainingDamage > 0 && options.length) {
      const nextChoice = {
        ...choice,
        id: `choice-${Date.now()}-${Math.random()}`,
        effect: "alphaStrikeDamage",
        prompt: `Assign ${remainingDamage} damage from ${target.name}.`,
        options,
        data: {
          ...choice.data,
          attackerId: target.instanceId,
          remainingDamage,
          killedIds: []
        }
      };
      if (!game.interactive) applyChoiceEffect(game, nextChoice, nextChoice.options[0]);
      else game.pendingChoice = nextChoice;
      return;
    }
  }
  const damaged = [];
  for (const allocation of allocations) {
    const enemy = findCard(game, allocation.targetId);
    if (!enemy || enemy.controllerId === player.id || findUnitLocation(game, enemy.instanceId)?.type !== "battlefield") continue;
    enemy.damage = (enemy.damage || 0) + (allocation.amount || 0);
    damaged.push(enemy);
  }
  const killed = [...new Set(damaged)].filter((unit) => isLethalDamage(unit));
  if (killed.length) gainXp(player, killed.length, source.name);
  markEffect(game, source, [target.instanceId, ...damaged.map((unit) => unit.instanceId)], `${source.name} assigns ${allocations.reduce((sum, allocation) => sum + (allocation.amount || 0), 0)} damage.`);
  finishChoiceResolution(context);
}

function resolveAlphaStrikeDamageChoice(context) {
  const { game, choice, option, player, source, target } = context;
  if (!target) return finishChoiceResolution(context);
  const amount = Math.min(option.amount || 1, choice.data.remainingDamage || 0);
  target.damage += amount;
  const killedIds = new Set(choice.data.killedIds || []);
  if (!killedIds.has(target.instanceId) && isLethalDamage(target)) {
    killedIds.add(target.instanceId);
    gainXp(player, choice.data.gainXpPerKill || 1, source.name);
  }
  const remainingDamage = Math.max(0, (choice.data.remainingDamage || 0) - amount);
  log(game, `${source.name} assigns ${amount} damage to ${target.name}.`);
  markEffect(game, source, [choice.data.attackerId, target.instanceId].filter(Boolean), `${amount} damage assigned.`);
  const options = alphaStrikeDamageOptions(game, player, source, remainingDamage);
  if (remainingDamage > 0 && options.length) {
    const nextChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      prompt: `Assign ${remainingDamage} remaining damage from ${source.name}.`,
      options,
      data: {
        ...choice.data,
        remainingDamage,
        killedIds: [...killedIds]
      }
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

function resolveOptionalPowerDrawChoice(context) {
  const { game, choice, option, player, source } = context;
  const runeIndex = player.runes.findIndex((rune) => rune.instanceId === option.cardId);
  if (runeIndex >= 0) {
    const [rune] = player.runes.splice(runeIndex, 1);
    player.runeDeck.push(rune);
    draw(player, choice.data.draw || 1, game);
    log(game, `${source.name} pays an additional rune and draws ${choice.data.draw || 1}.`);
    markEffect(game, source, [source.instanceId], `${source.name} draws ${choice.data.draw || 1}.`);
  }
  finishChoiceResolution(context);
}

function resolveEquipGearChoice(context) {
  const { game, choice, source, target } = context;
  const player = context.player;
  if (target) {
    if (!payAdditionalPower(player, { domain: choice.data.domain || "Any", amount: 1 })) {
      log(game, `${source.name} cannot pay the equip cost.`);
    } else {
      removeGearEverywhere(game, source.instanceId);
      target.attachments = target.attachments || [];
      target.attachments.push(source);
      log(game, `${source.name} attaches to ${target.name}.`);
      markEffect(game, source, [target.instanceId], `${target.name} equips ${source.name}.`);
    }
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
      source.attachments ||= [];
      source.attachments.push(target);
      log(game, `${source.name} steals and equips ${target.name}.`);
      markEffect(game, source, [source.instanceId, target.instanceId], `${target.name} equipped.`);
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
    const declaration = playTargetDeclaration(game, player, target, game.showdown?.battlefieldId || "base");
    if (game.interactive && declaration) {
      promptNextPlayDeclaration(game, player, target, {
        destination: game.showdown?.battlefieldId || "base",
        source: "trashSpell",
        completion: { type: "trashSpell", sourceCard: source },
        declarationChoiceEffect: "declareTrashSpellTarget",
        moveDestinationChoiceEffect: "declareTrashSpellMoveDestination",
        declarationSteps: declaration.steps,
        declaredTargets: [],
        declaredChoices: [],
        deflectPowerCost: [],
        deflectTargetIds: []
      });
      return;
    }
    beginTrashSpellPayment(game, player, source, target);
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
  const enemies = allUnits(game).filter((unit) => unit.controllerId !== player.id && canChooseUnit(game, player, source, unit));
  const nextChoice = {
    ...choice,
    id: `choice-${Date.now()}-${Math.random()}`,
    effect: "duelEnemy",
    prompt: `Choose the enemy unit for ${source.name}.`,
    options: enemies.map(cardOption),
    optional: false,
    data: { friendlyId: target.instanceId }
  };
  if (!nextChoice.options.length) return finishChoiceResolution(context);
  presentPreparedChoice(game, nextChoice);
}

function resolveDuelEnemyChoice(context) {
  const { game, choice, source, target } = context;
  const friendly = findCard(game, choice.data.friendlyId);
  if (friendly && target) {
    const friendlyMight = effectiveMight(friendly);
    const enemyMight = effectiveMight(target);
    friendly.damage += enemyMight;
    target.damage += friendlyMight;
    log(game, `${source.name} makes ${friendly.name} and ${target.name} strike each other.`);
    markEffect(game, source, [friendly.instanceId, target.instanceId], `${friendly.name} and ${target.name} strike each other.`);
    for (const unit of [friendly, target]) {
      if (!isLethalDamage(unit)) continue;
      const location = findUnitLocation(game, unit.instanceId);
      killUnit(game, unit, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
    }
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
      killUnit(game, target, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
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
    killUnit(game, target, location?.type === "battlefield" ? { type: "battlefield", battlefield: location.battlefield } : location);
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
      channel(sourcePlayer, 1, true);
      channel(player, 1, true);
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
  if (battlefield && target) {
    const location = findUnitLocation(game, target.instanceId);
    if (location) {
      removeUnitFromSource(location);
      battlefield.units.push(target);
    }
  }
  if (battlefield) resolveMoonfallAtBattlefield(game, player, source, battlefield);
  finishChoiceResolution(context);
}

function resolvePossessionChoice(context) {
  const { game, player, source, target } = context;
  if (target) {
    const location = findUnitLocation(game, target.instanceId);
    if (location?.type === "battlefield" && target.controllerId !== player.id) {
      const sourceBattlefield = location.battlefield;
      removeUnitFromSource(location);
      target.controllerId = player.id;
      player.base.push(target);
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
  target.exhausted = false;
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
    prompt: `Choose an enemy battlefield unit to be dealt ${effectiveMight(target)} damage by ${target.name}.`,
    options: enemyOptions,
    data: {
      ...choice.data,
      friendlyUnitId: target.instanceId,
      damage: effectiveMight(target)
    }
  };
  presentPreparedChoice(game, nextChoice);
}

function resolveLastBreathEnemyChoice(context) {
  const { game, choice, source, target } = context;
  const friendly = findCard(game, choice.data.friendlyUnitId);
  const location = target ? findUnitLocation(game, target.instanceId) : null;
  if (friendly && target && location?.type === "battlefield") {
    const amount = Math.max(0, choice.data.damage || effectiveMight(friendly));
    target.damage = (target.damage || 0) + amount;
    markEffect(game, source, [friendly.instanceId, target.instanceId], `${friendly.name} deals ${amount} damage to ${target.name}.`);
    log(game, `${friendly.name} deals ${amount} damage to ${target.name}.`);
    if (isLethalDamage(target)) killUnit(game, target, { type: "effect", source });
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
  addMightModifier(target, 1, { buff: true });
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
    const amount = effectiveMight(unit);
    for (const enemy of [...battlefield.units].filter((candidate) => candidate.controllerId !== player.id)) {
      enemy.damage = (enemy.damage || 0) + amount;
      log(game, `${source.name} deals ${amount} damage to ${enemy.name}.`);
      if (isLethalDamage(enemy)) killUnit(game, enemy, { type: "effect", source });
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
        const current = effectiveMight(unit);
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
    addMightModifier(target, 1, { buff: true });
    const buffedFriendly = allUnits(game).filter((unit) => unit.controllerId === player.id && (unit.buffs || 0) > 0);
    for (const unit of buffedFriendly) addMightModifier(unit, 1);
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
  const { game, source, target } = context;
  if (target && findUnitLocation(game, target.instanceId)) {
    target.exhausted = false;
    markEffect(game, source, [target.instanceId], `${source.name} readies ${target.name}.`);
    log(game, `${source.name} readies ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveTideturnerSwapChoice(context) {
  const { game, source, target } = context;
  if (target) {
    swapUnitLocations(game, source, target);
    markEffect(game, source, [source.instanceId, target.instanceId], `${source.name} swaps with ${target.name}.`);
  }
  finishChoiceResolution(context);
}

function resolveForgeAttachGearChoice(context) {
  const { game, choice, player, target } = context;
  const units = allUnits(game).filter((unit) => unit.controllerId === player.id);
  if (target && units.length) {
    game.pendingChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      effect: "forgeAttachTarget",
      prompt: `Choose a unit to receive ${target.name}.`,
      options: units.map(cardOption),
      optional: true,
      data: { gearId: target.instanceId }
    };
    return;
  }
  finishChoiceResolution(context);
}

function resolveForgeAttachTargetChoice(context) {
  const { game, choice, source, target } = context;
  if (target) {
    const gear = findCard(game, choice.data.gearId);
    if (gear) {
      removeGearEverywhere(game, gear.instanceId);
      target.attachments = target.attachments || [];
      target.attachments.push(gear);
      log(game, `${source.name} attaches ${gear.name} to ${target.name}.`);
      markEffect(game, source, [gear.instanceId, target.instanceId], `${gear.name} attached.`);
    }
  }
  finishChoiceResolution(context);
}

function resolveMissingChoiceEffect({ game, choice, source }) {
  log(game, `${source?.name || "A choice"} has no registered resolver for ${choice.effect}.`);
}

function cardOption(card) {
  return { id: card.instanceId, label: card.name, cardId: card.instanceId };
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
  const index = player.hand.findIndex((card) => card.instanceId === option.cardId);
  if (index < 0) {
    finishChoiceResolution({ game, choice, player, source });
    return;
  }
  const [discarded] = player.hand.splice(index, 1);
  player.trash.push(discarded);
  player.discardedCardsThisTurn = (player.discardedCardsThisTurn || 0) + 1;
  const discardedIds = [...(choice.data?.discardedIds || []), discarded.instanceId];
  const remaining = Math.max(0, (choice.data?.remaining || 1) - 1);
  log(game, `${source.name} discards ${discarded.name}.`);
  if (remaining > 0 && player.hand.length > 0) {
    game.pendingChoice = {
      ...choice,
      id: `choice-${Date.now()}-${Math.random()}`,
      options: player.hand.map(cardOption),
      data: {
        ...choice.data,
        remaining,
        discardedIds
      }
    };
    return;
  }
  const drawAfter = choice.data?.drawAfter || 0;
  if (drawAfter) draw(player, drawAfter, game);
  const discardedCards = discardedIds.map((id) => player.trash.find((card) => card.instanceId === id)).filter(Boolean);
  const afterMove = choice.data?.afterMove || null;
  const waitsForDiscardTriggers = triggerDiscardEffects(game, player, discardedCards, source,
    afterMove ? { kind: "finishAfterMove", afterMove } : null);
  markEffect(game, source, [source.instanceId, ...discardedIds], `${source.name} discards${drawAfter ? " and draws" : ""}.`);
  finishChoiceResolution({ game, choice, player, source });
  if (afterMove && !waitsForDiscardTriggers && !game.pendingChoice && !game.pendingPayment && !game.actionChain) {
    finishAfterMoveChoice(game, afterMove);
  }
}

function resolveDiscardEnergyDamageChoice({ game, choice, option, player, source }) {
  const index = player.hand.findIndex((card) => card.instanceId === option.cardId);
  if (index < 0) return finishChoiceResolution({ game, choice, player, source });
  const [discarded] = player.hand.splice(index, 1);
  player.trash.push(discarded);
  player.discardedCardsThisTurn = (player.discardedCardsThisTurn || 0) + 1;
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
    channel(player, amount);
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
    channel(player, amount);
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
    if (choice.data.exhaust) source.exhausted = true;
    draw(player, choice.data.amount || 1, game);
    log(game, `${source.name} exhausts to draw ${choice.data.amount || 1}.`);
    markEffect(game, source, [source.instanceId, choice.data.killedUnitId].filter(Boolean), `${source.name} draws.`);
  } else {
    log(game, `${player.name} declines ${source.name}.`);
  }
  finishChoiceResolution(context);
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
    }
  }
  for (const card of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(card, "discard")) {
      if (effect.kind === "readySelfMight") {
        triggers.push({
          kind: "discardReadySelfMight",
          playerId: player.id,
          sourceCardId: card.instanceId,
          data: { amount: effect.amount || 1 }
        });
      }
    }
  }
  if (!triggers.length) return false;
  if (game.phase === "action" && game.interactive) {
    addPendingActionTriggerChainItems(game, triggers, continuation);
    return true;
  }
  enqueueTriggers(game, triggers, continuation);
  resolveTriggerQueue(game);
  return true;
}

function triggerCardPlayedEffects(game, player, playedCard, continuation = null) {
  const triggers = [];
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "cardPlayed")) {
      if (playedCard.type === "spell" && (playedCard.energy || 0) >= (effect.minEnergy || 5)) {
        if (effect.kind === "highCostSpellBuffSelf") addMightModifier(source, effect.amount || 3, { temporary: true });
        if (effect.kind === "highCostSpellDraw") draw(player, effect.amount || 1, game);
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
            playedCardId: playedCard.instanceId
          }
        });
      }
      if (effect.kind === "opponentTurnRecruit") {
        if (game.currentPlayerId === player.id) continue;
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
            playedCardId: playedCard.instanceId
          }
        });
      }
      if (effect.kind === "exhaustSelfChannelOnMightyUnit") {
        if (playedCard.type !== "unit" || effectiveMight(playedCard) < (effect.minMight || 5)) continue;
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
  if (!triggers.length) return false;
  const mode = game.phase === "showdown" && game.showdown
    ? "showdownChain"
    : game.phase === "action" && game.interactive ? "actionChain" : "queue";
  return prepareAndQueueTriggers(game, triggers, mode, continuation);
}

function offerPredictChoice(game, player, source, parentChoice = {}, extraData = {}) {
  const top = player.mainDeck[0];
  if (!top) return false;
  if (!game.interactive) {
    predict(player);
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

function resolvePredictChoice(game, player, source, option, choice) {
  const top = player.mainDeck[0];
  if (!top) return;
  if (option.id === "recycle") {
    player.mainDeck.push(player.mainDeck.shift());
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
  const [discarded] = player.hand.splice(index, 1);
  player.trash.push(discarded);
  const continuation = {
    kind: "finishHweiDiscard",
    playerId: player.id,
    sourceCardId: source.instanceId,
    discardedCard: discarded,
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
  if (discarded.type === "unit") addMightModifier(source, 3);
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
  if (afterMove.type === "standardMoveBatch") {
    continueStandardMoveEffects(game, afterMove);
    return;
  }
  if (afterMove.type === "effectMove") {
    finishEffectMove(game, afterMove);
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
  for (let index = afterMove.unitIndex || 0; index < unitIds.length; index += 1) {
    const unit = findCard(game, unitIds[index]);
    if (!unit) continue;
    if (triggerMoveEffects(game, player, unit, { ...afterMove, unitIndex: index + 1 })) return;
  }

  if (afterMove.destinationId === "base") {
    updateBattlefieldControl(game);
    checkState(game);
    completeGameOperation(game, afterMove.operationId, "moved-to-base");
    return;
  }

  const destination = game.battlefields.find((field) => field.instanceId === afterMove.destinationId || field.id === afterMove.destinationId);
  if (!destination) return;
  const units = unitIds.map((unitId) => findCard(game, unitId)).filter(Boolean);
  finishMoveDestinationBatch(game, player, units, destination, {
    destinationWasEmpty: Boolean(afterMove.destinationWasEmpty),
    destinationControlledBy: afterMove.destinationControlledBy
  });
  completeGameOperation(game, afterMove.operationId, "move-finished");
}

function revealTopSpellToHand(game, player, source, resume = {}) {
  const top = player.mainDeck[0];
  if (top?.type !== "spell") return false;
  if (!game.interactive) {
    player.hand.push(player.mainDeck.shift());
    log(game, `${source.name} reveals ${top.name} and puts it into hand.`);
    return false;
  }
  player.mainDeck.shift();
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

function alphaStrikeDamageOptions(game, player, source, remainingDamage) {
  if (remainingDamage <= 0) return [];
  return game.battlefields
    .flatMap((field) => field.units.filter((unit) => unit.controllerId !== player.id))
    .filter((unit) => canChooseUnit(game, player, source, unit))
    .flatMap((unit) => Array.from({ length: remainingDamage }, (_, index) => {
      const amount = index + 1;
      return {
        id: `${unit.instanceId}:${amount}`,
        label: `${unit.name}: ${amount} damage`,
        cardId: unit.instanceId,
        amount
      };
    }));
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
    playerId: unit.controllerId || player.id,
    unitIds: [unit.instanceId],
    destinationId,
    sourceCardId: source.instanceId
  });
  removeUnitFromSource(location);
  if (options.readyAfterMove) unit.exhausted = false;

  if (destinationId === "base") {
    const owner = game.players.find((candidate) => candidate.id === unit.ownerId);
    owner.base.push(unit);
    log(game, `${source.name} moves ${unit.name} to ${owner.name}'s base.`);
    const movingPlayer = game.players.find((candidate) => candidate.id === unit.controllerId) || player;
    const afterMove = {
      type: "effectMove",
      playerId: movingPlayer.id,
      unitId: unit.instanceId,
      sourceCardId: source.instanceId,
      sourceBattlefieldId: sourceBattlefield?.instanceId || null,
      sourceBattlefieldIds: sourceBattlefield ? { [unit.instanceId]: sourceBattlefield.instanceId } : {},
      destinationId: "base",
      operationId: operation.id
    };
    if (triggerMoveEffects(game, movingPlayer, unit, afterMove)) return true;
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
    operationId: operation.id
  };
  if (triggerMoveEffects(game, movingPlayer, unit, afterMove)) return true;
  finishEffectMove(game, afterMove);
  return true;
}

function finishEffectMove(game, afterMove) {
  const unit = findCard(game, afterMove.unitId);
  const sourceBattlefield = game.battlefields.find((field) => field.instanceId === afterMove.sourceBattlefieldId);
  if (afterMove.destinationId === "base") {
    settleBattlefieldAfterEffectMove(game, sourceBattlefield);
    completeGameOperation(game, afterMove.operationId, "effect-move-to-base");
    return Boolean(unit);
  }
  const battlefield = game.battlefields.find((field) => field.instanceId === afterMove.destinationId);
  if (!unit || !battlefield || !battlefield.units.some((candidate) => candidate.instanceId === unit.instanceId)) return false;
  settleBattlefieldAfterEffectMove(game, sourceBattlefield);
  settleBattlefieldAfterEffectMove(game, battlefield);
  if (!upgradeNonCombatShowdownIfOpposed(game, battlefield)) {
    startShowdownIfOpposedAfterEffect(game, battlefield, unit.controllerId);
  }
  completeGameOperation(game, afterMove.operationId, "effect-move-finished");
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
  const defender = battlefield.units.find((unit) => unit.controllerId !== showdown.attackerId);
  if (!defender) return false;
  showdown.combat = true;
  showdown.defenderId = defender.controllerId;
  showdown.consecutivePasses = 0;
  triggerAttackOrDefendEffects(game, battlefield, showdown.attackerId);
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
  awardPoint(game, player, battlefield.instanceId, "conquer");
  for (const unit of battlefield.units.filter((candidate) => candidate.controllerId === controllerId)) {
    triggerConquerEffects(game, player, unit);
  }
  log(game, `${player.name} conquers ${battlefield.name} ${reason}.`);
}

function allGear(game) {
  return [
    ...game.players.flatMap((player) => player.base.filter((card) => card.type === "gear")),
    ...allUnits(game).flatMap((unit) => unit.attachments || [])
  ];
}

function totalPowerCost(card) {
  return (card.power || []).reduce((sum, requirement) => sum + requirement.amount, 0);
}

function needsDeflectPayment(player, unit) {
  if (!unit || unit.type !== "unit") return false;
  if (unit.controllerId === player.id) return false;
  return hasKeyword(unit, "Deflect") || hasStaticEffect(unit, "deflect");
}

function deflectAmount(unit) {
  return Math.max(keywordAmount(unit, "Deflect", 1), staticEffectAmount(unit, "deflect", 0), 1);
}

function deflectPaidForChoice(choice, unit) {
  return (choice.data?.deflectPaidTargetIds || []).includes(unit.instanceId);
}

function offerDeflectPayment(game, choice, option, player, source, target) {
  const amount = deflectAmount(target);
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

function payChosenPowerRune(player, runeId) {
  const index = player.runes.findIndex((rune) =>
    rune.instanceId === runeId && powerMatches(rune, { domain: "Any", amount: 1 })
  );
  if (index < 0) return false;
  const [rune] = player.runes.splice(index, 1);
  rune.exhausted = false;
  player.runeDeck.push(rune);
  return true;
}

function payChosenPowerRunes(player, runeIds, amount) {
  const uniqueIds = [...new Set(runeIds)];
  if (uniqueIds.length < amount) return false;
  const chosen = [];
  for (const id of uniqueIds) {
    const index = player.runes.findIndex((rune) =>
      rune.instanceId === id && powerMatches(rune, { domain: "Any", amount: 1 })
    );
    if (index < 0) return false;
    chosen.push({ index, rune: player.runes[index] });
  }
  if (chosen.length < amount) return false;
  for (const { index } of [...chosen].slice(0, amount).sort((left, right) => right.index - left.index)) {
    const [rune] = player.runes.splice(index, 1);
    rune.exhausted = false;
    player.runeDeck.push(rune);
  }
  return true;
}

function canChooseUnit(game, player, sourceCard, unit) {
  if (unit.controllerId === player.id) return true;
  if (hasStaticEffect(unit, "cannotBeChosenByEnemy")) return false;
  if ((sourceCard?.deflectPaidTargetIds || []).includes(unit.instanceId)) return true;
  if (hasKeyword(unit, "Deflect", game) || hasStaticEffect(unit, "deflect")) {
    return payAdditionalPower(player, { domain: "Any", amount: deflectAmount(unit) }, true);
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
  return payAdditionalPower(player, { domain: "Any", amount: deflectAmount(unit) });
}

function payPowerRequirements(player, requirements = [], dryRun = false) {
  if (!requirements.length) return true;
  const chosen = choosePowerRunes(player.runes, requirements);
  if (!chosen) return false;
  if (dryRun) return true;
  const chosenIds = new Set(chosen.map((rune) => rune.instanceId));
  for (let index = player.runes.length - 1; index >= 0; index--) {
    const rune = player.runes[index];
    if (!chosenIds.has(rune.instanceId)) continue;
    player.runes.splice(index, 1);
    rune.exhausted = false;
    player.runeDeck.push(rune);
  }
  return true;
}

function canUseForgeLegendAbility(game, player, card) {
  if (card.type !== "legend" || card.controllerId !== player.id) return false;
  return game.battlefields.some((field) => field.controlledBy === player.id && hasAnyEffect(field, "battlefieldControl", "legendAttachEquipment"));
}

function gainXp(player, amount) {
  player.xp += amount;
}

function addMightModifier(unit, amount, options = {}) {
  if (amount > 0 && options.buff === true) {
    const current = Math.max(0, unit.buffs || 0);
    unit.buffs = Math.min(options.maxBuffs ?? 1, current + amount);
    return;
  }
  unit.buffs = (unit.buffs || 0) + amount;
  if (options.temporary) unit.temporaryMight = (unit.temporaryMight || 0) + amount;
}

function isTemporaryMightEffect(card, spec = {}) {
  return Boolean(spec.temporary) || /might this turn/i.test(card?.text || "");
}

function predict(player) {
  const top = player.mainDeck[0];
  if (!top) return;
  player.mainDeck.push(player.mainDeck.shift());
}

function recycleMainDeckCards(player, cards) {
  if (!cards.length) return;
  player.mainDeck.push(...shuffle(cards));
}

function recycleRunes(player, amount = 1) {
  let recycled = 0;
  for (let index = player.runes.length - 1; index >= 0 && recycled < amount; index -= 1) {
    const [rune] = player.runes.splice(index, 1);
    rune.exhausted = false;
    player.runeDeck.push(rune);
    recycled += 1;
  }
  return recycled;
}

function returnChosenChampionFromTrash(game, player, source, championName) {
  if (player.champion?.zone === "champion") return false;
  const index = player.trash.findIndex((card) => isChampionCard(card) && card.name === championName);
  if (index < 0) return false;
  const [champion] = player.trash.splice(index, 1);
  champion.zone = "champion";
  champion.exhausted = false;
  champion.damage = 0;
  champion.stunned = false;
  player.champion = champion;
  player.championPlayed = false;
  log(game, `${source.name} returns ${champion.name} to ${player.name}'s Champion Zone.`);
  markEffect(game, source, [source.instanceId, champion.instanceId], `${champion.name} returns to the Champion Zone.`);
  return true;
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
  for (const rune of ready.slice(0, remaining)) {
    rune.exhausted = true;
  }
  return true;
}

function payAdditionalPower(player, requirement, dryRun = false) {
  if (!requirement) return true;
  const matches = player.runes
    .map((rune, index) => ({ rune, index }))
    .filter(({ rune }) => powerMatches(rune, requirement))
    .slice(0, requirement.amount);
  if (matches.length < requirement.amount) return false;
  if (dryRun) return true;
  for (const { index } of [...matches].sort((a, b) => b.index - a.index)) {
    const [rune] = player.runes.splice(index, 1);
    rune.exhausted = false;
    player.runeDeck.push(rune);
  }
  return true;
}

function swapUnitLocations(game, first, second) {
  const firstLocation = findUnitLocation(game, first.instanceId);
  const secondLocation = findUnitLocation(game, second.instanceId);
  if (!firstLocation || !secondLocation) return;
  removeUnitFromSource(firstLocation);
  removeUnitFromSource(secondLocation);
  placeUnitAtLocation(first, secondLocation);
  placeUnitAtLocation(second, firstLocation);
  updateBattlefieldControl(game);
}

function placeUnitAtLocation(unit, location) {
  if (location.type === "base") location.player.base.splice(location.index, 0, unit);
  if (location.type === "battlefield") location.battlefield.units.splice(location.index, 0, unit);
}

function returnUnitToBase(game, unit, sourceName) {
  const source = findUnitLocation(game, unit.instanceId);
  if (!source || !canMoveUnitFromBattlefieldToBase(game, unit, source)) return false;
  removeUnitFromSource(source);
  const owner = game.players.find((player) => player.id === unit.ownerId);
  unit.exhausted = true;
  owner.base.push(unit);
  updateBattlefieldControl(game);
  log(game, `${sourceName} moves ${unit.name} to base.`);
  return true;
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
  clearBoardState(unit);
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
  const owner = game.players.find((player) => player.id === item.card.ownerId);
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

function dealDamageToAllEnemies(game, playerId, amount, sourceName) {
  const targets = allUnits(game).filter((unit) => unit.controllerId !== playerId);
  if (!targets.length) return log(game, `${sourceName} finds no enemy units.`);
  for (const target of targets) target.damage += amount;
  log(game, `${sourceName} deals ${amount} damage to each enemy unit.`);
}

function resolveCombat(game, battlefield, attackerId) {
  const attacker = game.players.find((player) => player.id === attackerId);
  const defenderId = battlefield.units.find((unit) => unit.controllerId !== attackerId)?.controllerId;
  const defender = game.players.find((player) => player.id === defenderId);
  log(game, `Combat begins at ${battlefield.name}: ${attacker.name} attacks ${defender.name}.`);

  const attackingUnits = battlefield.units.filter((unit) => unit.controllerId === attackerId);
  const defendingUnits = battlefield.units.filter((unit) => unit.controllerId === defenderId);
  if (game.interactive && beginCombatDamageAssignment(game, battlefield, attackerId, defenderId, attackingUnits, defendingUnits)) return;
  assignCombatDamage(game, attackingUnits, defendingUnits, "attacker");
  assignCombatDamage(game, defendingUnits, attackingUnits, "defender");
  finishCombatResolution(game, battlefield, attackerId, defenderId);
}

function finishCombatResolution(game, battlefield, attackerId, defenderId) {
  const attacker = game.players.find((player) => player.id === attackerId);
  const killed = battlefield.units.filter((unit) => {
    const role = unit.controllerId === attackerId ? "attacker" : "defender";
    return unit.damage > 0 && unit.damage >= currentCombatMight(game, battlefield, unit, role);
  });
  const killedIds = new Set(killed.map((unit) => unit.instanceId));
  for (const unit of killed) {
    killUnit(game, unit, { type: "battlefield", battlefield });
  }
  battlefield.units = battlefield.units.filter((unit) => !killedIds.has(unit.instanceId));

  const attackersRemain = battlefield.units.some((unit) => unit.controllerId === attackerId);
  const defendersRemain = battlefield.units.some((unit) => unit.controllerId === defenderId);
  if (attackersRemain && !defendersRemain) {
    settleBattlefieldConquest(game, battlefield, attackerId, "after combat");
  } else if (defendersRemain) {
    const survivors = battlefield.units.filter((unit) => unit.controllerId === attackerId);
    battlefield.units = battlefield.units.filter((unit) => unit.controllerId !== attackerId);
    attacker.base.push(...survivors);
    settleBattlefieldConquest(game, battlefield, defenderId, "after combat");
    if (survivors.length) log(game, "Surviving attackers return to base.");
  } else {
    battlefield.controlledBy = null;
  }

  for (const unit of allUnits(game)) {
    unit.damage = 0;
    delete unit.combatRole;
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
    defenderTotal
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
  const candidates = battlefield.units
    .filter((unit) => unit.controllerId === context.targetPlayerId)
    .map((unit) => {
      const lethalRemaining = Math.max(1, combatLethalThreshold(game, battlefield, unit, context.role) - unit.damage);
      const lethalNow = lethalRemaining <= context.remaining;
      return {
        unit,
        legal: true,
        reason: "",
        amount: lethalNow ? lethalRemaining : context.remaining,
        lethalNow,
        lethalRemaining
      };
    });
  for (const info of candidates) {
    if (isLethalAssignedCombatDamage(game, battlefield, info.unit, context.role)) {
      info.legal = false;
      info.reason = "Lethal already assigned";
    }
  }
  const hasLegalTank = candidates.some((info) => info.legal && hasKeyword(info.unit, "Tank", game));
  if (hasLegalTank) {
    for (const info of candidates) {
      if (info.legal && !hasKeyword(info.unit, "Tank", game)) {
        info.legal = false;
        info.reason = "Tank first";
      }
    }
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
  return candidates;
}

function combatDamageOptions(game, battlefield, targets, context) {
  const candidates = targets
    .map((target) => {
      const lethalRemaining = Math.max(1, combatLethalThreshold(game, battlefield, target, context.role) - target.damage);
      return {
        target,
        lethalRemaining,
        lethalNow: lethalRemaining <= context.remaining
      };
    });
  const lethalCandidates = candidates.filter((candidate) => candidate.lethalNow);
  const shown = lethalCandidates.length ? lethalCandidates : candidates;
  return shown.map(({ target, lethalRemaining, lethalNow }) => {
    const amount = lethalNow ? lethalRemaining : context.remaining;
    return {
      id: target.instanceId,
      label: `${target.name}: ${amount} damage${lethalNow ? " (lethal)" : ""}`,
      cardId: target.instanceId,
      amount
    };
  });
}

function isLethalAssignedCombatDamage(game, battlefield, unit, incomingRole) {
  return unit.damage > 0 && unit.damage >= combatLethalThreshold(game, battlefield, unit, incomingRole);
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
  finishCombatResolution(game, battlefield, context.attackerId, context.defenderId);
  updateBattlefieldControl(game);
  checkState(game);
  game.currentPlayerId = context.attackerId;
}

function assignCombatDamage(game, sources, targets, role) {
  let total = combatDamageTotal(game, sources, targets, role);
  const battlefield = sources.length
    ? findUnitLocation(game, sources[0].instanceId)?.battlefield
    : findUnitLocation(game, targets[0]?.instanceId)?.battlefield;
  const assigningPlayerId = sources[0]?.controllerId;
  const targetPlayerId = targets[0]?.controllerId;
  if (!battlefield || !assigningPlayerId || !targetPlayerId) return;

  while (total > 0) {
    const context = {
      battlefieldId: battlefield.instanceId,
      assigningPlayerId,
      targetPlayerId,
      role,
      remaining: total
    };
    const legalTargets = combatDamageTargets(game, battlefield, context);
    if (!legalTargets.length) break;
    const [option] = combatDamageOptions(game, battlefield, legalTargets, context);
    if (!option) break;
    const target = findCard(game, option.cardId);
    if (!target) break;
    const damage = Math.min(total, option.amount);
    target.damage += damage;
    total -= damage;
  }
}

function combatMight(game, unit, role, allies, enemies) {
  if (enemies.some((enemy) => hasStaticEffect(enemy, "suppressWeakerEnemyCombatDamage") && effectiveMight(unit) < effectiveMight(enemy))) {
    return 0;
  }
  return currentCombatMight(game, findUnitLocation(game, unit.instanceId)?.battlefield, unit, role);
}

export function currentCombatMight(game, battlefield, unit, role) {
  let amount = effectiveMight(unit) + dynamicMightModifier(game, battlefield, unit);
  if (role === "attacker" && hasKeyword(unit, "Assault", game)) {
    amount += keywordAmount(unit, "Assault", 1);
  }
  if (role === "defender" && (hasKeyword(unit, "Shield", game) || hasStaticEffect(unit, "shield"))) {
    amount += Math.max(keywordAmount(unit, "Shield", 1), staticEffectAmount(unit, "shield", 0), unit.temporaryShieldAmount || 0);
  }
  const controller = game.players.find((player) => player.id === unit.controllerId);
  const allies = battlefield?.units.filter((candidate) => candidate.controllerId === unit.controllerId) || [];
  if (role === "defender" && allies.length === 1 && hasStaticEffect(controller?.legend, "defendAloneMight")) {
    amount += staticEffectAmount(controller.legend, "defendAloneMight", 2);
  }
  return amount;
}

function dynamicMightModifier(game, battlefield, unit) {
  let amount = 0;
  const controller = game.players.find((player) => player.id === unit.controllerId);
  if (hasStaticEffect(unit, "selfMightByPoints")) amount += controller?.score || 0;
  if (hasStaticEffect(unit, "selfMightByTrash")) amount += controller?.trash?.length || 0;
  for (const effect of cardEffects(unit, "static").filter((candidate) => candidate.kind === "runeThresholdMight")) {
    if ((controller?.runes?.length || 0) >= (effect.threshold || 8)) amount += effect.amount || 0;
  }
  if (hasStaticEffect(unit, "selfMightWhileBuffed") && (unit.buffs || 0) > 0) amount += staticEffectAmount(unit, "selfMightWhileBuffed", 1);
  if (hasStaticEffect(unit, "selfMightWhileAloneCombat") && unit.combatRole && (battlefield?.units || []).filter((candidate) => candidate.controllerId === unit.controllerId).length === 1) {
    amount += staticEffectAmount(unit, "selfMightWhileAloneCombat", 1);
  }
  if (hasStaticEffect(unit, "selfMightByBuffedFriendlyHere")) {
    amount += (battlefield?.units || []).filter((candidate) => candidate.controllerId === unit.controllerId && (candidate.buffs || 0) > 0).length
      * staticEffectAmount(unit, "selfMightByBuffedFriendlyHere", 1);
  }
  for (const source of battlefield?.units || []) {
    if (source.controllerId !== unit.controllerId || source.instanceId === unit.instanceId) continue;
    if (hasStaticEffect(source, "otherFriendlyHereMight")) amount += staticEffectAmount(source, "otherFriendlyHereMight", 1);
    if (hasStaticEffect(source, "otherBuffedFriendlyHereMight") && (unit.buffs || 0) > 0) {
      amount += staticEffectAmount(source, "otherBuffedFriendlyHereMight", 1);
    }
  }
  if (hasStaticEffect(battlefield, "unitsHereMight")) amount += staticEffectAmount(battlefield, "unitsHereMight", 1);
  for (const source of battlefield?.units || []) {
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
  if (!killedUnit.stunned) return false;
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
  if (!triggers.length) return false;
  return prepareAndQueueTriggers(game, triggers, game.phase === "showdown" && game.showdown ? "showdownChain" : "queue");
}

function killUnit(game, unit, source) {
  const owner = game.players.find((player) => player.id === unit.ownerId);
  const controller = game.players.find((player) => player.id === unit.controllerId);
  const saver = allControlledCards(game, unit.controllerId)
    .find((card) =>
      replacementEffect(card, "saveFriendlyUnitByKillingThis")
      || canSettSaveBuffedUnit(controller, card, unit));
  if (saver) {
    resolveReplacementEffect(game, saver, unit, source);
    return;
  }

  const diedAlone = source?.type === "battlefield"
    ? source.battlefield.units.filter((candidate) => candidate.controllerId === unit.controllerId && candidate.instanceId !== unit.instanceId).length === 0
    : controller.base.filter((candidate) => candidate.type === "unit" && candidate.instanceId !== unit.instanceId).length === 0;
  unit.lastKnownBattlefieldId = source?.type === "battlefield" ? source.battlefield.instanceId : null;
  removeUnitEverywhere(game, unit.instanceId);
  detachAttachmentsToBase(game, unit, source);
  delete unit.combatRole;
  owner.trash.push(unit);
  for (const candidate of game.players) {
    if (candidate.id !== unit.controllerId) candidate.enemyUnitsDiedThisTurn = (candidate.enemyUnitsDiedThisTurn || 0) + 1;
  }
  log(game, `${unit.name} is killed.`);
  triggerEnemyKilledEffects(game, unit);
  enqueueDeathTriggers(game, owner, unit, diedAlone);
}

function killGear(game, gear, source = null) {
  const owner = game.players.find((player) => player.id === gear.ownerId);
  if (!owner) return;
  removeGearEverywhere(game, gear.instanceId);
  owner.trash.push(gear);
  log(game, `${gear.name} is killed.`);
  enqueueDeathTriggers(game, owner, gear, false);
}

function resolveReplacementEffect(game, sourceCard, unit, source) {
  const controller = game.players.find((player) => player.id === unit.controllerId);
  if (!controller) return;
  if (replacementEffect(sourceCard, "saveFriendlyUnitByKillingThis")) {
    unit.damage = 0;
    unit.exhausted = true;
    removeGearEverywhere(game, sourceCard.instanceId);
    controller.trash.push(sourceCard);
    if (source?.type === "battlefield") {
      source.battlefield.units = source.battlefield.units.filter((candidate) => candidate.instanceId !== unit.instanceId);
      controller.base.push(unit);
    }
    log(game, `${sourceCard.name} replaces ${unit.name}'s death and recalls it exhausted.`);
    markEffect(game, sourceCard, [sourceCard.instanceId, unit.instanceId], `${sourceCard.name} saves ${unit.name}.`);
  }
  if (replacementEffect(sourceCard, "saveBuffedFriendlyUnitBySett") && canSettSaveBuffedUnit(controller, sourceCard, unit)) {
    payAdditionalPower(controller, { domain: "Any", amount: 1 });
    unit.buffs = Math.max(0, (unit.buffs || 0) - 1);
    unit.damage = 0;
    unit.exhausted = true;
    sourceCard.exhausted = true;
    removeUnitEverywhere(game, unit.instanceId);
    controller.base.push(unit);
    updateBattlefieldControl(game);
    log(game, `${sourceCard.name} spends ${unit.name}'s buff and recalls it instead of letting it die.`);
    markEffect(game, sourceCard, [sourceCard.instanceId, unit.instanceId], `${sourceCard.name} saves ${unit.name}.`);
  }
}

function canSettSaveBuffedUnit(controller, sourceCard, unit) {
  if (!controller || !sourceCard || !unit) return false;
  if (!replacementEffect(sourceCard, "saveBuffedFriendlyUnitBySett")) return false;
  if (sourceCard.exhausted) return false;
  if (unit.controllerId !== controller.id) return false;
  if ((unit.buffs || 0) <= 0) return false;
  return payAdditionalPower(controller, { domain: "Any", amount: 1 }, true);
}

function enqueueDeathTriggers(game, owner, unit, diedAlone) {
  const triggers = [];
  const controller = game.players.find((player) => player.id === unit.controllerId) || owner;
  for (const effect of cardEffects(unit, "death")) {
    if (effect.kind === "draw") {
      triggers.push({
        kind: "deathDraw",
        playerId: owner.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.amount || 1 }
      });
    }
    if (effect.kind === "drawIfAlone" && diedAlone) {
      triggers.push({
        kind: "deathDrawIfAlone",
        playerId: owner.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.draw || 1 }
      });
    }
    if (effect.kind === "channelRunes") {
      triggers.push({
        kind: "deathChannelRunes",
        playerId: owner.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.amount || 1 }
      });
    }
    if (effect.kind === "discardDraw") {
      triggers.push({
        kind: "deathDiscardDraw",
        playerId: owner.id,
        sourceCardId: unit.instanceId,
        data: { discard: effect.discard || 0, draw: effect.draw || 0 }
      });
    }
    if (effect.kind === "dealDamageAllHere") {
      triggers.push({
        kind: "deathDealDamageAllHere",
        playerId: owner.id,
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
        playerId: owner.id,
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
        playerId: owner.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.amount || 1 }
      });
    }
    if (effect.kind === "revealOpponentHand") {
      triggers.push({
        kind: "deathRevealOpponentHand",
        playerId: owner.id,
        sourceCardId: unit.instanceId
      });
    }
    if (effect.kind === "recycleSelfReadyRunes") {
      triggers.push({
        kind: "deathRecycleSelfReadyRunes",
        playerId: owner.id,
        sourceCardId: unit.instanceId,
        data: { amount: effect.amount || 999, readyAll: Boolean(effect.readyAll) }
      });
    }
  }
  const deathknellTriggerCount = triggers.length;
  if (deathknellTriggerCount && controller && allControlledCards(game, controller.id)
    .some((source) => source.instanceId !== unit.instanceId && hasStaticEffect(source, "deathTriggersAdditionalTime"))) {
    triggers.push(...triggers.slice(0, deathknellTriggerCount).map((trigger) => structuredClone(trigger)));
    log(game, `${controller.name}'s deathknell triggers an additional time.`);
  }
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
  if (!triggers.length) return false;
  enqueueTriggers(game, triggers);
  if (game.inCleanup) return true;
  resolveTriggerQueue(game);
  return true;
}

function detachAttachmentsToBase(game, unit, source) {
  if (!unit.attachments?.length) return false;
  let changed = false;
  for (const gear of unit.attachments) {
    const controller = game.players.find((player) => player.id === gear.controllerId) || game.players.find((player) => player.id === gear.ownerId);
    if (!controller) continue;
    if (!controller.base.some((card) => card.instanceId === gear.instanceId)) {
      controller.base.push(gear);
      changed = true;
    }
    const locationName = source?.type === "battlefield" ? source.battlefield?.name : "base";
    log(game, `${gear.name} detaches from ${unit.name} and recalls to ${controller.name}'s base from ${locationName}.`);
  }
  unit.attachments = [];
  return changed;
}

function clearBoardState(card) {
  card.exhausted = false;
  card.damage = 0;
  card.stunned = false;
  card.buffs = 0;
  delete card.cantMoveThisTurn;
  delete card.temporary;
  delete card.playedFromHidden;
  delete card.hiddenBattlefieldId;
  delete card.declaredPlayTargets;
  delete card.declaredPlayChoices;
  delete card.deflectPaidTargetIds;
  delete card.paidOptionalPowerEffects;
  delete card.paidFriendlyExhaustAdditionalCost;
  delete card.temporaryKeywords;
  delete card.temporaryShieldAmount;
  delete card.combatRole;
  delete card.lastKnownBattlefieldId;
  delete card.killOnDamageUntilTurnSequence;
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
    unit.attachments = (unit.attachments || []).filter((card) => card.instanceId !== gearId);
  }
}

export function effectiveMight(unit) {
  const attachedMight = (unit.attachments || []).reduce((sum, gear) => {
    const staticBonus = firstCardEffect(gear, "static", "attachedMight")?.amount;
    return sum + (staticBonus ?? gear.might ?? 0);
  }, 0);
  return Math.max(0, (unit.might || 0) + (unit.buffs || 0) + attachedMight);
}

function activeSpellChain(game) {
  return game.showdown?.chain || game.actionChain?.chain || [];
}

function isLethalDamage(unit) {
  return unit.damage > 0 && unit.damage >= effectiveMight(unit);
}

function shouldKillDamagedUnit(game, unit) {
  return unit.type === "unit"
    && unit.damage > 0
    && (
      game.players.some((player) => player.killDamagedUnitsThisTurn)
      || (unit.killOnDamageUntilTurnSequence != null && unit.killOnDamageUntilTurnSequence >= (game.turnSequence || 0))
    );
}

function scoreHoldingBattlefields(game, player) {
  for (const field of game.battlefields) {
    if (field.controlledBy === player.id) {
      awardPoint(game, player, field.instanceId, "hold");
      log(game, `${player.name} holds ${field.name}.`);
      triggerHoldEffects(game, player, field);
      for (const unit of field.units.filter((candidate) => candidate.controllerId === player.id)) {
        triggerScoreEffects(game, player, unit, "hold");
      }
    }
  }
}

function triggerHoldEffects(game, player, source) {
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
        data: { amount: effect.amount || 1, optional: effect.optional !== false }
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
    enqueueTriggers(game, triggers);
    resolveTriggerQueue(game);
  }
}

function awardPoint(game, player, battlefieldId, reason) {
  if (player.turnScoredBattlefields.has(battlefieldId)) {
    log(game, `${player.name} has already scored that battlefield this turn.`);
    return false;
  }
  player.turnScoredBattlefields.add(battlefieldId);
  const wouldWin = player.score + 1 >= game.victoryScore;
  const scoredAllBattlefields = player.turnScoredBattlefields.size >= game.battlefields.length;
  if (wouldWin && reason === "conquer" && !scoredAllBattlefields) {
    draw(player, 1, game);
    log(game, `${player.name} would score the winning conquest point, so they draw 1 instead.`);
    return false;
  }
  player.score += 1;
  return true;
}

function triggerConquerEffects(game, player, unit) {
  triggerScoreEffects(game, player, unit, "conquer");
  const unitConquerSpecs = cardEffects(unit, "conquer")
    .filter((effect) => effect.kind !== "readySelf");
  if (unitConquerSpecs.length) {
    enqueueTriggers(game, unitConquerSpecs.map((effect) => ({
      kind: "effectSpecs",
      playerId: player.id,
      sourceCardId: unit.instanceId,
      data: {
        specs: [structuredClone(effect)],
        timing: "conquer",
        declaredTargets: [],
        declaredChoices: []
      }
    })));
  }
  for (const source of allControlledCards(game, player.id)) {
    for (const effect of cardEffects(source, "conquer")) {
      if (effect.kind === "drawIfUnitsAtBattlefield") {
        const battlefield = findUnitLocation(game, unit.instanceId)?.battlefield;
        const count = battlefield?.units.filter((candidate) => candidate.controllerId === player.id).length || 0;
        if (count >= (effect.minUnits || 4)) draw(player, effect.amount || 2, game);
        continue;
      }
      if (effect.kind !== "readySelf") continue;
      source.exhausted = false;
      log(game, `${source.name} readies because ${player.name} conquered.`);
      markEffect(game, source, [source.instanceId, unit.instanceId], `${source.name} readies.`);
    }
  }
  const field = findUnitLocation(game, unit.instanceId)?.battlefield;
  const triggers = [];
  for (const effect of cardEffects(field, "conquerHere")) {
    if (effect.kind === "readyRunesEndTurn") {
      triggers.push({
        kind: "conquerHereReadyRunesEndTurn",
        playerId: player.id,
        sourceCardId: field.instanceId,
        data: {
          amount: effect.amount || 1,
          unitId: unit.instanceId
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
          unitId: unit.instanceId
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
          unitId: unit.instanceId
        }
      });
    }
    if (effect.kind === "spendBuffDraw") {
      triggers.push({
        kind: "conquerHereSpendBuffDraw",
        playerId: player.id,
        sourceCardId: field.instanceId,
        data: {
          unitId: unit.instanceId,
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
          unitId: unit.instanceId
        }
      });
    }
  }
  if (triggers.length) {
    enqueueTriggers(game, triggers);
    resolveTriggerQueue(game);
  }
}

function triggerEndTurnEffects(game, player) {
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
  if (!triggers.length) return;
  enqueueTriggers(game, triggers);
  resolveTriggerQueue(game);
}

function triggerScoreEffects(game, player, unit, reason) {
  const triggers = [];
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
    enqueueTriggers(game, triggers);
    resolveTriggerQueue(game);
  }
}

function triggerFirstBeginningEffects(game, player) {
  if (player.hasTakenFirstTurn || player.firstBeginningEffectsResolved) return;
  const triggers = [];
  for (const field of game.battlefields) {
    for (const effect of cardEffects(field, "firstBeginning")) {
      if (effect.kind === "gainPoint") {
        triggers.push({
          kind: "firstBeginningGainPoint",
          playerId: player.id,
          sourceCardId: field.instanceId,
          data: { amount: effect.amount || 1 }
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
  if (!triggers.length) return;
  player.firstBeginningEffectsResolved = true;
  enqueueTriggers(game, triggers);
  resolveTriggerQueue(game);
}

function triggerBeginningEffects(game, player) {
  const triggers = [];
  const controlsHidden = game.battlefields.some((field) =>
    (field.hidden || []).some((item) => item.ownerId === player.id)
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
  if (!triggers.length) return false;
  enqueueTriggers(game, triggers);
  resolveTriggerQueue(game);
  return true;
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

function triggerMoveEffects(game, player, unit, afterMove = null) {
  const sourceBattlefieldId = afterMove?.sourceBattlefieldIds?.[unit.instanceId];
  const sourceBattlefield = game.battlefields.find((field) => field.instanceId === sourceBattlefieldId);
  triggerOpponentMoveObserverEffects(game, player, unit, afterMove);
  if (sourceBattlefield) {
    const companions = sourceBattlefield.units.filter((candidate) =>
      candidate.controllerId === player.id
      && candidate.instanceId !== unit.instanceId
      && cardEffects(candidate, "onMove").some((effect) => effect.kind === "moveWithFriendlyFromSameBattlefield")
      && !candidate.exhausted
    );
    if (companions.length) {
      const companion = companions[0];
      const effect = cardEffects(companion, "onMove").find((candidate) => candidate.kind === "moveWithFriendlyFromSameBattlefield");
      if (resolveOnMoveEffect(game, { player, source: companion, movedUnit: unit, sourceBattlefield, effect, afterMove, role: "companion" })) return true;
    }
  }
  if (sourceBattlefield) {
    for (const effect of cardEffects(sourceBattlefield, "onMove")) {
      if (resolveOnMoveEffect(game, { player, source: sourceBattlefield, movedUnit: unit, sourceBattlefield, effect, afterMove, role: "battlefield" })) return true;
    }
  }
  for (const effect of cardEffects(unit, "onMove")) {
    if (resolveOnMoveEffect(game, { player, source: unit, movedUnit: unit, sourceBattlefield, effect, afterMove, role: "moved" })) return true;
  }
  return false;
}

function resolveOnMoveEffect(game, context) {
  const resolver = ON_MOVE_EFFECT_RESOLVERS.get(context.effect?.kind);
  if (!resolver) throw new Error(`Missing onMove resolver for ${context.effect?.kind || "unknown"}.`);
  return Boolean(resolver(game, context));
}

function resolveOnMoveCompanion(game, { player, source, movedUnit, afterMove, role }) {
  if (role !== "companion") return false;
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
  addMightModifier(movedUnit, effect.amount || 1);
  log(game, `${source.name} gives ${movedUnit.name} +${effect.amount || 1} Might for moving from there.`);
  markEffect(game, source, [source.instanceId, movedUnit.instanceId], `${movedUnit.name} gets Might.`);
  return false;
}

function resolveOnMoveScoreNth(game, { player, movedUnit, effect, role }) {
  if (role !== "moved") return false;
  movedUnit.movesThisTurn = (movedUnit.movesThisTurn || 0) + 1;
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

function resolveOnMovePlayUnitToken(game, { player, movedUnit, effect, afterMove, role }) {
  if (role !== "moved") return false;
  const destination = effect.destination === "movedBattlefield"
    ? afterMove?.destinationId
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

function resolveOnMoveDrawDiscardTypeBonus(game, { player, movedUnit, afterMove, role }) {
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
    data: { afterMove },
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

function triggerOpponentMoveObserverEffects(game, movingPlayer, movedUnit, afterMove = null) {
  const destinationId = afterMove?.destinationId;
  if (!destinationId || destinationId === "base") return;
  const destination = game.battlefields.find((field) => field.instanceId === destinationId);
  if (!destination) return;
  for (const observer of allUnits(game)) {
    if (observer.controllerId === movingPlayer.id || observer.instanceId === movedUnit.instanceId) continue;
    const observerLocation = findUnitLocation(game, observer.instanceId);
    if (observerLocation?.type !== "battlefield") continue;
    if (observerLocation.battlefield.instanceId === destination.instanceId) continue;
    for (const effect of cardEffects(observer, "onMove")) {
      const controller = game.players.find((player) => player.id === observer.controllerId);
      resolveOnMoveEffect(game, { player: controller, source: observer, movedUnit, destination, effect, afterMove, role: "observer" });
    }
  }
}

function resolveOnMoveOpponentObserverDraw(game, { player, source, movedUnit, effect, role }) {
  if (role !== "observer") return false;
  draw(player, effect.amount || 1, game);
  log(game, `${source.name} draws because ${movedUnit.name} moved to another battlefield.`);
  markEffect(game, source, [source.instanceId, movedUnit.instanceId], `${source.name} draws.`);
  return false;
}

function triggerShowdownStartEffects(game, battlefield, attacker, defender, resume = {}) {
  const triggers = [];
  const startUnitIndex = resume.unitIndex || 0;
  for (let unitIndex = startUnitIndex; unitIndex < battlefield.units.length; unitIndex += 1) {
    const unit = battlefield.units[unitIndex];
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
  if (triggers.length) {
    if (game.phase === "showdown" && game.showdown?.battlefieldId === battlefield.instanceId) {
      addPendingTriggerChainItems(game, triggers);
    } else {
      enqueueTriggers(game, triggers);
      resolveTriggerQueue(game);
    }
  }
}

function continueShowdownStartEffects(game, resume) {
  if (!resume || game.phase !== "showdown") return;
  const battlefield = game.battlefields.find((field) => field.instanceId === resume.battlefieldId);
  const attacker = game.players.find((player) => player.id === resume.attackerId);
  const defender = game.players.find((player) => player.id === resume.defenderId);
  if (!battlefield || !attacker || !defender) return;
  triggerShowdownStartEffects(game, battlefield, attacker, defender, resume);
}

function triggerShowdownDefendHereEffects(game, battlefield, defender) {
  const triggers = showdownDefendHereTriggers(game, battlefield, defender);
  if (triggers.length) {
    if (game.phase === "showdown" && game.showdown?.battlefieldId === battlefield.instanceId) {
      addPendingTriggerChainItems(game, triggers);
    } else {
      enqueueTriggers(game, triggers);
      resolveTriggerQueue(game);
    }
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

function triggerAttackOrDefendEffects(game, battlefield, attackerId) {
  const designatedUnits = assignCombatDesignations(game, battlefield, attackerId);
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
      if (effect.kind === "modifySelfIfReadyEnemyHere" && effect.role === unit.combatRole) {
        if (!enemies.some((enemy) => !enemy.exhausted)) continue;
        triggers.push({
          kind: "attackOrDefendModifySelf",
          playerId: controller.id,
          sourceCardId: unit.instanceId,
          data: { amount: effect.amount || 0 }
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
            playerId: controller.id,
            sourceCardId: source.instanceId,
            data: { targetId: unit.instanceId, amount: effect.amount || 0 }
          });
        }
      }
    }
  }
  if (triggers.length) {
    if (game.phase === "showdown" && game.showdown?.battlefieldId === battlefield.instanceId) {
      addPendingTriggerChainItems(game, triggers);
    } else {
      enqueueTriggers(game, triggers);
      resolveTriggerQueue(game);
    }
  }
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

function channel(player, amount, exhausted = false) {
  for (let i = 0; i < amount; i++) {
    const rune = player.runeDeck.shift();
    if (!rune) return;
    rune.exhausted = Boolean(exhausted);
    player.runes.push(rune);
  }
}

export function draw(player, amount, game = null) {
  for (let i = 0; i < amount; i++) {
    const card = player.mainDeck.shift();
    if (!card) return;
    player.hand.push(card);
    player.drawCountThisTurn = (player.drawCountThisTurn || 0) + 1;
    if (game) triggerDrawEffects(game, player);
  }
}

function triggerDrawEffects(game, player) {
  if (player.drawCountThisTurn !== 2) return;
  const jewel = allControlledCards(game, player.id).find((card) => firstCardEffect(card, "secondDrawEachTurn", "modifyMight"));
  if (!jewel) return;
  const effect = firstCardEffect(jewel, "secondDrawEachTurn", "modifyMight");
  if (!effect) return;
  const targets = allUnits(game).filter((unit) => unit.controllerId === player.id);
  if (!targets.length) return;
  prepareAndQueueTriggers(game, [{
    kind: "secondDrawBuff",
    playerId: player.id,
    sourceCardId: jewel.instanceId,
    data: {
      amount: effect.amount || 2,
      targetIds: targets.map((unit) => unit.instanceId)
    }
  }]);
}

function allUnits(game) {
  return [
    ...game.players.flatMap((player) => player.base.filter((card) => card.type === "unit")),
    ...game.battlefields.flatMap((field) => field.units)
  ];
}

function allControlledCards(game, playerId) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  return [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...player.base,
    ...game.battlefields.flatMap((field) => field.units.filter((unit) => unit.controllerId === playerId)),
    ...allUnits(game).filter((unit) => unit.controllerId === playerId).flatMap((unit) => unit.attachments || [])
  ].filter(Boolean);
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
      ...player.trash
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
    const index = battlefield.units.findIndex((unit) => unit.instanceId === unitId);
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
  let changed = false;
  for (const field of game.battlefields) {
    if (game.showdown?.battlefieldId === field.instanceId) continue;
    if (field.contestedBy || (game.stagedEvents || []).some((event) => event.battlefieldId === field.instanceId)) continue;
    const controllers = new Set(field.units.map((unit) => unit.controllerId));
    const nextController = controllers.size === 0
      ? null
      : controllers.size === 1
        ? [...controllers][0]
        : field.controlledBy;
    if (field.controlledBy !== nextController) {
      field.controlledBy = nextController;
      changed = true;
    }
  }
  return changed;
}

function checkState(game) {
  if (game.inCleanup) {
    game.cleanupRequested = true;
    return;
  }
  let loops = 0;
  let changed = false;
  game.inCleanup = true;
  try {
    do {
      game.cleanupRequested = false;
      changed = false;
      if (checkVictory(game)) break;
      for (const field of game.battlefields) {
        const killed = field.units.filter((unit) => isLethalDamage(unit) || shouldKillDamagedUnit(game, unit));
        for (const unit of killed) {
          killUnit(game, unit, { type: "battlefield", battlefield: field });
          changed = true;
        }
      }
      for (const player of game.players) {
        for (const unit of [...player.base]) {
          if (unit.type !== "unit" || (!isLethalDamage(unit) && !shouldKillDamagedUnit(game, unit))) continue;
          killUnit(game, unit, { type: "base", player });
          changed = true;
        }
      }
      if (cleanupCombatDesignations(game)) changed = true;
      if (updateBattlefieldControl(game)) changed = true;
      if (cleanupInvalidHiddenCards(game)) changed = true;
      loops += 1;
    } while ((changed || game.cleanupRequested) && loops < 20 && game.phase !== "complete");
  } finally {
    game.inCleanup = false;
    game.cleanupRequested = false;
  }

  if (loops >= 20) log(game, "Cleanup stopped after reaching the safety limit.");

  if (!game.pendingChoice && !game.pendingPayment && game.triggerQueue?.length) {
    resolveTriggerQueue(game);
  }

  if (game.pendingEndTurnPlayerId && !game.pendingChoice && !game.pendingPayment
    && !game.triggerQueue?.length && !game.triggerQueueContinuation && !game.actionChain) {
    finishPendingEndTurn(game);
    return;
  }

  if (game.phase === "action" && !game.pendingChoice && !game.pendingPayment && !game.actionChain) {
    resolveStagedEvents(game);
  }

  checkVictory(game);
}

function checkVictory(game) {
  if (game.phase === "complete") return true;
  const victoryScore = currentVictoryScore(game);
  for (const player of game.players) {
    if (player.score >= victoryScore) {
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
    if (nextRole) unit.combatRole = nextRole;
    else delete unit.combatRole;
    changed = true;
  }
  return changed;
}

function cleanupInvalidHiddenCards(game) {
  let changed = false;
  for (const field of game.battlefields) {
    const hidden = field.hidden || [];
    for (let index = hidden.length - 1; index >= 0; index -= 1) {
      const item = hidden[index];
      if (field.controlledBy === item.ownerId) continue;
      const [removed] = hidden.splice(index, 1);
      removed.card.hidden = false;
      const owner = game.players.find((player) => player.id === removed.card.ownerId);
      owner?.trash.push(removed.card);
      log(game, `${removed.card.name} leaves Hidden because ${field.name} is no longer controlled by its owner.`);
      changed = true;
    }
  }
  return changed;
}

function hasKeyword(card, keyword, game = null) {
  if ((card.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  if ((card.temporaryKeywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  if (!game) return false;
  const owner = game.players.find((player) => player.id === card.controllerId || player.id === card.ownerId);
  for (const effect of cardEffects(card, "levelStatic")) {
    if (effect.kind !== "gainKeywords") continue;
    if ((owner?.xp || 0) < (effect.level || 0)) continue;
    if ((effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
  }
  for (const effect of cardEffects(card, "static")) {
    if (effect.kind === "gainKeywordsWhileBuffed" && (card.buffs || 0) > 0
      && (effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
    if (effect.kind === "gainKeywordsIfDiscardedThisTurn" && (owner?.discardedCardsThisTurn || 0) > 0
      && (effect.keywords || []).some((item) => item.toLowerCase() === keyword.toLowerCase())) return true;
    if (effect.kind === "gainKeywordsWhileMighty" && effectiveMight(card) >= (effect.threshold || 5)
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

function keywordAmount(card, keyword, fallback = 1) {
  const text = card?.text || "";
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bracketed = new RegExp(`\\[\\s*${escaped}\\s+(\\d+)\\s*\\]`, "i").exec(text);
  if (bracketed) return Number(bracketed[1]);
  const plain = new RegExp(`\\b${escaped}\\s+(\\d+)\\b`, "i").exec(text);
  if (plain) return Number(plain[1]);
  return fallback;
}

function fail(game, message) {
  log(game, message);
  return { ok: false, message };
}

function log(game, message) {
  game.log.unshift(message);
  game.log = game.log.slice(0, 18);
}
