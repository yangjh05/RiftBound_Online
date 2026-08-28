const REPLAY_TRACE_FIELDS = [
  "operations",
  "lifecycleEvents",
  "ruleTaskTrace",
  "cleanupRequestTrace",
  "stagedEvents"
];

export function createSpectatorReplay(game, metadata = {}) {
  const replay = {
    version: 1,
    id: metadata.id || null,
    createdAt: metadata.createdAt || new Date().toISOString(),
    generation: metadata.generation ?? null,
    gameId: metadata.gameId || null,
    matchGameNumber: metadata.matchGameNumber || null,
    models: structuredClone(metadata.models || []),
    decks: structuredClone(metadata.decks || []),
    winnerId: null,
    scores: [0, 0],
    turns: 0,
    actionCount: 0,
    frames: []
  };
  appendSpectatorReplayFrame(replay, game, null, null);
  return replay;
}

export function appendSpectatorReplayFrame(replay, game, actorId, action) {
  if (!replay || !game) return null;
  const frame = {
    sequence: replay.frames.length,
    actorId: actorId || null,
    action: action ? structuredClone(action) : null,
    turnNumber: game.turnNumber || 1,
    phase: game.phase || "first-player",
    game: compactReplayGame(game)
  };
  replay.frames.push(frame);
  replay.actionCount = Math.max(0, replay.frames.length - 1);
  return frame;
}

export function finalizeSpectatorReplay(replay, game, metadata = {}) {
  if (!replay || !game) return replay;
  Object.assign(replay, {
    id: metadata.id || replay.id,
    generation: metadata.generation ?? replay.generation,
    gameId: metadata.gameId || replay.gameId,
    matchGameNumber: metadata.matchGameNumber || replay.matchGameNumber,
    models: structuredClone(metadata.models || replay.models || []),
    decks: structuredClone(metadata.decks || replay.decks || []),
    winnerId: game.winnerId || null,
    scores: game.players.map((player) => player.score || 0),
    turns: game.turnNumber || 1,
    completedAt: metadata.completedAt || new Date().toISOString()
  });
  const last = replay.frames.at(-1);
  if (!last || last.game?.phase !== game.phase || last.game?.winnerId !== game.winnerId) {
    appendSpectatorReplayFrame(replay, game, null, { kind: "gameComplete" });
  }
  replay.actionCount = Math.max(0, replay.frames.length - 1);
  return replay;
}

export function spectatorReplaySummary(replay) {
  return {
    id: replay.id,
    version: replay.version,
    createdAt: replay.createdAt,
    completedAt: replay.completedAt || replay.createdAt,
    generation: replay.generation ?? null,
    gameId: replay.gameId || null,
    matchGameNumber: replay.matchGameNumber || null,
    models: structuredClone(replay.models || []),
    decks: structuredClone(replay.decks || []),
    winnerId: replay.winnerId || null,
    scores: [...(replay.scores || [0, 0])],
    turns: replay.turns || 0,
    actionCount: replay.actionCount || Math.max(0, (replay.frames?.length || 1) - 1)
  };
}

export function compactReplayGame(source) {
  const game = structuredClone(source);
  for (const field of REPLAY_TRACE_FIELDS) delete game[field];
  delete game.aiSideboardContext;
  delete game.setupRandomValues;
  game.log = (game.log || []).slice(0, 30);
  for (const player of game.players || []) {
    player.mainDeck = (player.mainDeck || []).map(compactHiddenDeckCard);
    player.runeDeck = (player.runeDeck || []).map(compactHiddenDeckCard);
  }
  return game;
}

function compactHiddenDeckCard(card) {
  return {
    id: card.id,
    cardNumber: card.cardNumber,
    collectorNumber: card.collectorNumber,
    instanceId: card.instanceId,
    name: card.name,
    type: card.type,
    image: card.image,
    ownerId: card.ownerId,
    controllerId: card.controllerId,
    exhausted: Boolean(card.exhausted),
    damage: Number(card.damage) || 0
  };
}
