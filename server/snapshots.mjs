import { hiddenCardControllerId } from "../src/rules/zones.mjs";

export function publicRoom(room) {
  return {
    roomId: room.roomId,
    status: room.status,
    hostPlayerId: room.hostPlayerId || "p1",
    sideboardingEnabled: Boolean(room.sideboardingEnabled),
    match: room.match ? {
      gameNumber: room.match.gameNumber,
      wins: clonePlain(room.match.wins),
      winsRequired: room.match.winsRequired,
      phase: room.match.phase,
      winnerId: room.match.winnerId,
      submissions: clonePlain(room.match.submissions),
      firstPlayerChooserId: room.match.firstPlayerChooserId,
      lastGameWasDraw: room.match.lastGameWasDraw
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
  return {
    room: publicRoom(room),
    playerId,
    game: room.game ? redactGame(room.game, playerId) : null,
    match: room.match ? {
      ...clonePlain(publicRoom(room).match),
      currentDeck: clonePlain(room.match.currentDecks[playerId === "p1" ? 0 : 1])
    } : null
  };
}

function redactGame(game, viewerId) {
  const snapshot = clonePlain(game);
  delete snapshot.setupBattlefieldSelections;
  snapshot.players = game.players.map((player) => redactPlayer(game, player, viewerId));
  snapshot.battlefields = game.battlefields.map((field) => redactBattlefield(game, field, viewerId));
  snapshot.pendingChoice = game.pendingChoice?.playerId === viewerId ? clonePlain(game.pendingChoice) : null;
  snapshot.pendingPayment = game.pendingPayment?.playerId === viewerId ? clonePlain(game.pendingPayment) : null;
  snapshot.triggerQueue = clonePlain(game.triggerQueue || []);
  snapshot.triggerQueueContinuation = clonePlain(game.triggerQueueContinuation || null);
  snapshot.stagedEvents = clonePlain(game.stagedEvents || []);
  snapshot.revealedIntel = clonePlain(game.revealedIntel || []);
  if (!findVisibleCardInSnapshot(snapshot, snapshot.selectedCardId)) {
    const viewer = snapshot.players.find((player) => player.id === viewerId) || snapshot.players[0];
    snapshot.selectedCardId = viewer?.champion?.instanceId || viewer?.legend?.instanceId || null;
  }
  return snapshot;
}

function redactPlayer(game, player, viewerId) {
  const ownsSeat = player.id === viewerId;
  const intel = canViewPrivateInfo(game, viewerId, player.id);
  const showPrivate = ownsSeat || intel;
  const copy = clonePlain(player);
  if (!showPrivate && player.champion?.zone === "hidden") {
    copy.champion = {
      ...redactedCard(player.champion, `hidden-champion-${player.id}`),
      zone: "hidden"
    };
  }
  copy.hand = showPrivate
    ? clonePlain(player.hand)
    : player.hand.map((card, index) => redactedCard(card, `hand-${player.id}-${index}`));
  copy.mainDeck = showPrivate
    ? clonePlain(player.mainDeck)
    : player.mainDeck.map((card, index) => redactedCard(card, `main-${player.id}-${index}`));
  copy.runeDeck = showPrivate
    ? clonePlain(player.runeDeck)
    : player.runeDeck.map((card, index) => redactedCard(card, `rune-${player.id}-${index}`));
  copy.availableChampions = showPrivate || player.champion
    ? clonePlain(player.availableChampions)
    : player.availableChampions.map((card, index) => redactedCard(card, `champion-${player.id}-${index}`));
  const battlefieldChoicesPublic = !["first-player", "champion-select", "battlefield-select"].includes(game.phase);
  copy.availableBattlefields = ownsSeat || battlefieldChoicesPublic
    ? clonePlain(player.availableBattlefields)
    : player.availableBattlefields.map((card, index) => redactedCard(card, `battlefield-${player.id}-${index}`));
  if (!ownsSeat && !battlefieldChoicesPublic && player.selectedBattlefieldId) {
    copy.selectedBattlefieldId = "hidden-battlefield-selection";
  }
  copy.turnScoredBattlefields = Array.from(player.turnScoredBattlefields || []);
  return copy;
}

function redactBattlefield(game, field, viewerId) {
  const copy = clonePlain(field);
  copy.hidden = (field.hidden || []).map((item, index) => {
    const controllerId = hiddenCardControllerId(item);
    const visible = controllerId === viewerId || canViewPrivateInfo(game, viewerId, controllerId);
    if (visible) return clonePlain(item);
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
    instanceId: card?.instanceId || `redacted-${fallbackId}`,
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

function findVisibleCardInSnapshot(game, cardId) {
  if (!cardId) return null;
  for (const player of game.players) {
    const pools = [
      player.legend,
      player.champion,
      ...player.availableChampions,
      ...player.availableBattlefields,
      ...player.hand,
      ...player.base,
      ...player.runes,
      ...player.trash,
      ...(player.banished || [])
    ].filter(Boolean);
    const found = pools.find((card) => card.instanceId === cardId && !card.redacted);
    if (found) return found;
  }
  for (const field of game.battlefields) {
    if (field.instanceId === cardId) return field;
    const pools = [
      ...field.units,
      ...(field.hidden || []).map((item) => item.card)
    ];
    const found = pools.find((card) => card?.instanceId === cardId && !card.redacted);
    if (found) return found;
  }
  return null;
}

function seatedPlayers(room) {
  return Object.values(room.seats).filter(Boolean);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}
