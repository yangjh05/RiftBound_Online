import { hiddenCardControllerId } from "../src/rules/zones.mjs";
import { normalizeRoomDeckOptions } from "../src/decks/legality.mjs";
import {
  chainItemVisibleToViewer,
  gameLogVisibleToViewer,
  pendingHandChainItems
} from "../src/rules/visibility.mjs";
import { firstPlayerDecisionActorId } from "../src/engine.mjs";

// These fields are authoritative engine bookkeeping. Building a client
// snapshot used to JSON-clone them and immediately delete them, which made
// every multiplayer command copy large event ledgers that no client can use.
const CLIENT_OMITTED_GAME_KEYS = new Set([
  "setupBattlefieldSelections", "setupChampionSelections", "publicTurnEvents",
  "drawEvents", "deferredTriggerContinuations", "setupRandomValues", "operations",
  "lifecycleEvents", "ruleTaskTrace", "cleanupRequestTrace",
  "revealEvents", "revealEventSequence", "drawEventSequence", "publicTurnEventSequence",
  "attachmentEvents", "attachmentEventSequence",
  "empowerEvents", "empowerEventSequence", "damageEvents", "damageEventSequence",
  "discardEvents", "discardEventSequence", "exhaustEvents", "exhaustEventSequence",
  "readyEvents", "readyEventSequence", "banishEvents", "banishEventSequence",
  "combatResultEvents", "combatResultEventSequence", "killEvents", "killEventSequence",
  "healEvents", "healEventSequence", "moveEvents", "moveEventSequence",
  "channelEvents", "channelEventSequence", "burnEvents", "burnEventSequence",
  "responseObservations", "responseObservationSequence", "damagePreventionSequence",
  "nextCombatSequence", "nextDelayedAbilitySequence", "nextGeneratedInstanceId",
  "nextReplacementEventSequence", "moveActionBatchSequence", "nextOperationSequence", "nextRuleTaskSequence",
  "nextCleanupRequestSequence", "nextScoreEventSequence", "deterministicRandomState",
  "deterministicPlayerRandomStates", "cleanupPendingTriggerBatches", "postCombatDamageTriggerBatches",
  "delayedAbilities", "damageKillFollowups",
  "cleanupDeathReplacementBatch", "cleanupOutstanding", "cleanupRequested", "combatCleanupProcess",
  "deathReplacementPreference", "decisionSafety", "endingCleanupProcess", "endTurnProcess",
  "lastResolvedActivatedAbility", "preparingAutomaticEffectPlay",
  "preventSpellAbilityDamageUntilTurnSequence", "resolvingChainContext", "resolvingChoiceContext",
  "resolvingChosenTargetContext", "resolvingDeathBatchKey", "resolvingDeclaredTargetContext",
  "resolvingGameEffect", "settlingActionChain", "showdownExitProcess", "startTurnProcess",
  "additionalTurnQueue", "additionalTurnReturnIncrementsTurnNumber", "additionalTurnReturnPlayerId",
  "currentTurnIsAdditional", "extraTurnPlayerId", "pendingEndTurnPlayerId", "unitsDiedThisTurn",
  "forcedBattlefieldSelections"
]);

export function publicRoom(room) {
  return {
    roomId: room.roomId,
    diagnosticGameId: room.diagnosticGameId || null,
    status: room.status,
    hostPlayerId: room.hostPlayerId || "p1",
    sideboardingEnabled: Boolean(room.sideboardingEnabled),
    ...normalizeRoomDeckOptions(room),
    match: room.match ? {
      gameNumber: room.match.gameNumber,
      wins: clonePlain(room.match.wins),
      winsRequired: room.match.winsRequired,
      phase: room.match.phase,
      winnerId: room.match.winnerId,
      submissions: clonePlain(room.match.submissions),
      firstPlayerChooserId: room.match.firstPlayerChooserId,
      lastGameWasDraw: room.match.lastGameWasDraw,
      setupProcedure: room.match.setupProcedure,
      initialSideboarding: Boolean(room.match.initialSideboarding)
    } : null,
    playerCount: seatedPlayers(room).length,
    seats: Object.fromEntries(Object.entries(room.seats).map(([id, seat]) => [id, {
      playerId: id,
      occupied: Boolean(seat),
      ready: Boolean(seat?.ready),
      deckName: seat?.deckRecord?.name || ""
    }])),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}

export function snapshotForPlayer(room, playerId) {
  const roomSnapshot = publicRoom(room);
  return {
    room: roomSnapshot,
    playerId,
    game: room.game ? redactGame(room.game, playerId) : null,
    match: room.match ? {
      ...clonePlain(roomSnapshot.match),
      currentDeck: clonePlain(room.match.currentDecks[playerId === "p1" ? 0 : 1])
    } : null
  };
}

function redactGame(game, viewerId) {
  const clientGame = {};
  for (const key of Object.keys(game)) {
    if (!CLIENT_OMITTED_GAME_KEYS.has(key)) clientGame[key] = game[key];
  }
  const snapshot = clonePlain(clientGame);
  snapshot.authoritativeActorId = activeActorId(game);
  snapshot.players = game.players.map((player, index) =>
    redactPlayer(game, player, viewerId, snapshot.players[index]));
  snapshot.battlefields = game.battlefields.map((field, index) =>
    redactBattlefield(game, field, viewerId, snapshot.battlefields[index]));
  const privateAliases = privateCardAliasMap(game, snapshot, viewerId);
  snapshot.actionChain = redactChainState(game.actionChain, viewerId, privateAliases);
  snapshot.showdown = redactChainState(game.showdown, viewerId, privateAliases);
  snapshot.log = clonePlain(gameLogVisibleToViewer(game, viewerId));
  snapshot.pendingChoice = game.pendingChoice?.playerId === viewerId ? clonePlain(game.pendingChoice) : null;
  snapshot.pendingPayment = game.pendingPayment?.playerId === viewerId ? clonePlain(game.pendingPayment) : null;
  snapshot.triggerQueue = redactPrivateReferences(
    clonePlain(game.triggerQueue || []),
    privateAliases
  );
  delete snapshot.triggerQueueContinuation;
  snapshot.stagedEvents = clonePlain(game.stagedEvents || []);
  snapshot.revealedIntel = clonePlain(game.revealedIntel || []);
  if (game.mulligan && game.mulligan.playerId !== viewerId) {
    snapshot.mulligan = {
      playerId: game.mulligan.playerId,
      selectedCount: Array.isArray(game.mulligan.selectedCardIds) ? game.mulligan.selectedCardIds.length : 0
    };
  }
  const visibleCardIds = visibleCardIdSet(snapshot);
  snapshot.effectFlash = redactEffectFlash(game.effectFlash, visibleCardIds);
  if (!visibleCardIds.has(snapshot.selectedCardId)) {
    const viewer = snapshot.players.find((player) => player.id === viewerId) || snapshot.players[0];
    snapshot.selectedCardId = viewer?.champion?.instanceId || viewer?.legend?.instanceId || null;
  }
  const safeSnapshot = redactPrivateReferencesInPlace(snapshot, privateAliases);
  // An authorized decision can intentionally reveal otherwise hidden cards
  // (for example Sabotage choosing from an opponent's hand). Preserve that
  // decision's authoritative ids for its owner so the submitted option still
  // matches the engine. Other viewers receive null above.
  safeSnapshot.pendingChoice = game.pendingChoice?.playerId === viewerId
    ? clonePlain(game.pendingChoice)
    : null;
  safeSnapshot.pendingPayment = game.pendingPayment?.playerId === viewerId
    ? clonePlain(game.pendingPayment)
    : null;
  stripEngineOnlyCardState(safeSnapshot);
  return safeSnapshot;
}

function activeActorId(game) {
  if (game.phase === "first-player") return firstPlayerDecisionActorId(game);
  if (game.pendingChoice?.playerId) return game.pendingChoice.playerId;
  if (game.pendingPayment?.playerId) return game.pendingPayment.playerId;
  if (game.phase === "champion-select") return game.championSelectPlayerId || null;
  if (game.phase === "battlefield-select") return game.setupPlayerId || null;
  if (game.phase === "mulligan") return game.mulligan?.playerId || null;
  if (game.actionChain?.priorityPlayerId) return game.actionChain.priorityPlayerId;
  if (game.phase === "showdown") return game.showdown?.priorityPlayerId || null;
  if (game.phase === "action") return game.currentPlayerId || null;
  return null;
}

function redactPlayer(game, player, viewerId, copy = clonePlain(player)) {
  const ownsSeat = player.id === viewerId;
  const intel = canViewPrivateInfo(game, viewerId, player.id);
  // Revealed Intel exposes the opponent's hand and hidden battlefield cards,
  // never the identities or ordering of either private deck.
  const showHandAndHidden = ownsSeat || intel;
  if (!ownsSeat) delete copy.source;
  if (!showHandAndHidden && player.champion?.zone === "hidden") {
    copy.champion = {
      ...redactedCard(player.champion, `hidden-champion-${player.id}`),
      zone: "hidden"
    };
  }
  copy.hand = showHandAndHidden
    ? copy.hand
    : player.hand.map((card, index) => redactedCard(card, `hand-${player.id}-${index}`));
  if (!ownsSeat) {
    for (const [index] of pendingHandChainItems(game, player.id).entries()) {
      copy.hand.push(redactedCard(
        { ownerId: player.id, controllerId: player.id },
        `pending-hand-${player.id}-${index}`
      ));
    }
  }
  copy.mainDeck = ownsSeat
    ? copy.mainDeck
    : player.mainDeck.map((card, index) => redactedCard(card, `main-${player.id}-${index}`));
  copy.mulliganBottomKnowledge = ownsSeat ? copy.mulliganBottomKnowledge || [] : [];
  if (!ownsSeat) delete copy.bottomDeckKnowledgeSequence;
  copy.runeDeck = ownsSeat
    ? copy.runeDeck
    : player.runeDeck.map((card, index) => redactedCard(card, `rune-${player.id}-${index}`));
  const privateChampionLock = game.singleGameSideboardSetup
    && game.initialSideboardingComplete
    && game.phase === "champion-select"
    && !player.champion;
  if (!ownsSeat && privateChampionLock) {
    copy.chosenChampionName = null;
    copy.availableChampions = [];
  } else {
    copy.availableChampions = showHandAndHidden || player.champion
      ? copy.availableChampions
      : player.availableChampions.map((card, index) => redactedCard(card, `champion-${player.id}-${index}`));
  }
  const battlefieldChoicesPublic = !["first-player", "champion-select", "battlefield-select", "sideboarding"].includes(game.phase);
  copy.availableBattlefields = ownsSeat || battlefieldChoicesPublic
    ? copy.availableBattlefields
    : player.availableBattlefields.map((card, index) => redactedCard(card, `battlefield-${player.id}-${index}`));
  if (!ownsSeat && !battlefieldChoicesPublic && player.selectedBattlefieldId) {
    copy.selectedBattlefieldId = "hidden-battlefield-selection";
  }
  copy.turnScoredBattlefields = plainScoredBattlefieldIds(player.turnScoredBattlefields);
  return copy;
}

function redactChainState(chainState, viewerId, aliases = new Map()) {
  if (!chainState) return null;
  const copy = clonePlain(chainState);
  copy.chain = (chainState.chain || [])
    .filter((item) => chainItemVisibleToViewer(item, viewerId))
    .map((item) => redactPrivateReferences(item, aliases));
  delete copy.continuation;
  delete copy.deferredTriggerPreparations;
  return redactPrivateReferences(copy, aliases);
}

function plainScoredBattlefieldIds(value) {
  if (Array.isArray(value)) return [...value];
  if (value instanceof Set) return [...value];
  return [];
}

function redactBattlefield(game, field, viewerId, copy = clonePlain(field)) {
  copy.hidden = (field.hidden || []).map((item, index) => {
    const controllerId = hiddenCardControllerId(item);
    const visible = controllerId === viewerId || canViewPrivateInfo(game, viewerId, controllerId);
    if (visible) return copy.hidden[index];
    return {
      ownerId: item.ownerId,
      hiddenByPlayerId: item.hiddenByPlayerId,
      playableFromTurnSequence: item.playableFromTurnSequence,
      card: redactedCard(item.card, `hidden-${item.ownerId}-${field.instanceId}-${index}`)
    };
  });
  return copy;
}

function canViewPrivateInfo(game, viewerId, ownerId) {
  if (!viewerId || !ownerId || viewerId === ownerId) return false;
  return Boolean((game.revealedIntel || []).some((item) =>
    item.viewerId === viewerId
    && item.ownerId === ownerId
    && item.expiresAtTurnSequence === game.turnSequence
  ));
}

function redactedCard(card, fallbackId) {
  return {
    instanceId: `redacted-${fallbackId}`,
    ownerId: card?.ownerId || null,
    controllerId: card?.controllerId || card?.ownerId || null,
    id: "redacted-card",
    name: "Hidden Card",
    type: "hidden",
    tags: [],
    keywords: [],
    text: "",
    image: "",
    redacted: true,
    exhausted: Boolean(card?.exhausted)
  };
}

function redactEffectFlash(effectFlash, visibleCardIds) {
  if (!effectFlash || typeof effectFlash !== "object") return null;
  if (!visibleCardIds.has(effectFlash.sourceId)) return null;
  const targetIds = Array.isArray(effectFlash.targetIds)
    ? effectFlash.targetIds.filter((cardId) => visibleCardIds.has(cardId))
    : [];
  const allTargetsVisible = targetIds.length === (effectFlash.targetIds || []).length;
  return {
    ...clonePlain(effectFlash),
    sourceId: effectFlash.sourceId,
    targetIds,
    message: allTargetsVisible ? effectFlash.message : ""
  };
}

function privateCardAliasMap(game, snapshot, viewerId) {
  const aliases = new Map();
  for (const originalPlayer of game.players || []) {
    if (originalPlayer.id === viewerId) continue;
    const copiedPlayer = snapshot.players.find((player) => player.id === originalPlayer.id);
    if (!copiedPlayer) continue;
    for (const zone of ["hand", "mainDeck", "runeDeck", "availableChampions", "availableBattlefields"]) {
      const originals = originalPlayer[zone] || [];
      const copies = copiedPlayer[zone] || [];
      for (let index = 0; index < originals.length; index += 1) {
        if (copies[index]?.redacted && originals[index]?.instanceId) aliases.set(originals[index].instanceId, copies[index]);
      }
    }
    if (copiedPlayer.champion?.redacted && originalPlayer.champion?.instanceId) {
      aliases.set(originalPlayer.champion.instanceId, copiedPlayer.champion);
    }
    for (const [index, item] of pendingHandChainItems(game, originalPlayer.id).entries()) {
      const alias = copiedPlayer.hand[(originalPlayer.hand || []).length + index];
      if (alias?.redacted && item?.card?.instanceId) aliases.set(item.card.instanceId, alias);
    }
  }
  for (const [fieldIndex, field] of (game.battlefields || []).entries()) {
    const copiedField = snapshot.battlefields[fieldIndex];
    for (const [hiddenIndex, item] of (field.hidden || []).entries()) {
      const alias = copiedField?.hidden?.[hiddenIndex]?.card;
      if (alias?.redacted && item?.card?.instanceId) aliases.set(item.card.instanceId, alias);
    }
  }
  return aliases;
}

function redactPrivateReferences(value, aliases) {
  if (typeof value === "string") return aliases.get(value)?.instanceId || value;
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactPrivateReferences(item, aliases));
  const privateCard = aliases.get(value.instanceId);
  if (privateCard) return clonePlain(privateCard);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPrivateReferences(item, aliases)]));
}

function redactPrivateReferencesInPlace(value, aliases) {
  if (typeof value === "string") return aliases.get(value)?.instanceId || value;
  if (value == null || typeof value !== "object") return value;
  const privateCard = aliases.get(value.instanceId);
  if (privateCard) return clonePlain(privateCard);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = redactPrivateReferencesInPlace(value[index], aliases);
    }
    return value;
  }
  for (const [key, item] of Object.entries(value)) {
    value[key] = redactPrivateReferencesInPlace(item, aliases);
  }
  return value;
}

function stripEngineOnlyCardState(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (!Array.isArray(value)) {
    delete value.activationProcess;
    delete value.pendingGameEffectResolution;
  }
  for (const nested of Array.isArray(value) ? value : Object.values(value)) stripEngineOnlyCardState(nested, seen);
}

function visibleCardIdSet(game) {
  const visibleIds = new Set();
  const stack = [];
  for (const player of game.players || []) {
    stack.push(
      player.legend,
      player.champion,
      ...(player.availableChampions || []),
      ...(player.availableBattlefields || []),
      ...(player.mainDeck || []),
      ...(player.runeDeck || []),
      ...(player.hand || []),
      ...(player.base || []),
      ...(player.runes || []),
      ...(player.trash || []),
      ...(player.banished || [])
    );
  }
  for (const field of game.battlefields || []) {
    if (field?.instanceId) visibleIds.add(field.instanceId);
    stack.push(...(field?.units || []), ...(field?.hidden || []).map((item) => item.card));
  }
  const seen = new Set();
  while (stack.length) {
    const card = stack.pop();
    if (!card || typeof card !== "object" || seen.has(card)) continue;
    seen.add(card);
    if (card.instanceId && !card.redacted) visibleIds.add(card.instanceId);
    if (Array.isArray(card.attachments)) stack.push(...card.attachments);
  }
  return visibleIds;
}

function seatedPlayers(room) {
  return Object.values(room.seats).filter(Boolean);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
