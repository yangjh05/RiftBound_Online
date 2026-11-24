import { randomBytes } from "node:crypto";
import { createGame } from "../src/engine.mjs";
import { applyResolvedGameCommand, resolveAuthorizedGameCommand } from "./commands.mjs";
import { cardByNumber, normalizeSubmittedDeck, resolveDeckRecord, validateSubmittedDeck } from "./decks.mjs";
import { publicRoom, snapshotForPlayer } from "./snapshots.mjs";
import { normalizeRoomDeckOptions } from "../src/decks/legality.mjs";
import {
  beginInitialSideboarding,
  beginNextMatchGame,
  createMatchState,
  recordMatchGame,
  submitSideboardConfiguration
} from "../src/match.mjs";
import {
  GAME_REPRODUCTION_END_REASONS,
  createGameReproductionLog
} from "../src/diagnostics/game-reproduction-log.mjs";

const rooms = new Map();
const subscribers = new Map();
const ROOM_TTL_MS = 1000 * 60 * 60 * 4;
const SERVER_MAINTENANCE_INTERVAL_MS = 15000;
const ROOM_CLEANUP_INTERVAL_MS = 60_000;
let serverMaintenanceTimer = null;
let lastRoomCleanupAt = 0;

export function listRooms() {
  cleanupRooms();
  return [...rooms.values()]
    .filter((room) => room.status !== "complete")
    .map(publicRoom)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function createRoom(options = {}) {
  cleanupRooms();
  const room = {
    roomId: createRoomId(),
    status: "lobby",
    hostPlayerId: "p1",
    sideboardingEnabled: options.sideboardingEnabled === true,
    ...normalizeRoomDeckOptions(options),
    match: null,
    seats: { p1: null, p2: null },
    game: null,
    diagnosticGames: [],
    activeDiagnostic: null,
    diagnosticGameSeq: 0,
    diagnosticGameId: null,
    commandSeq: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const seat = createSeat("p1");
  room.seats.p1 = seat;
  rooms.set(room.roomId, room);
  ensureServerMaintenance();
  publish(room);
  return { room: publicRoom(room), playerId: "p1", playerToken: seat.playerToken };
}

export function joinRoom(roomId, playerToken = "") {
  const room = getRoom(roomId);
  if (!room) return fail("Room not found.");
  const existing = seatByToken(room, playerToken);
  if (existing) {
    room.updatedAt = Date.now();
    return { ok: true, room: publicRoom(room), playerId: existing.playerId, playerToken: existing.playerToken };
  }
  const openId = ["p1", "p2"].find((playerId) => !room.seats[playerId]);
  if (!openId) return fail("Room is full.");
  if (room.status !== "lobby") return fail("Game has already started.");
  const seat = createSeat(openId);
  room.seats[openId] = seat;
  room.updatedAt = Date.now();
  publish(room);
  return { ok: true, room: publicRoom(room), playerId: openId, playerToken: seat.playerToken };
}

export function submitDeck(roomId, playerToken, rawDeck) {
  const seated = requireSeat(roomId, playerToken);
  if (!seated.ok) return seated;
  const deck = normalizeSubmittedDeck(rawDeck);
  const validation = validateSubmittedDeck(deck, seated.room);
  if (!validation.playable) return fail(validation.messages.join(" "));
  seated.seat.deckRecord = deck;
  seated.seat.ready = false;
  seated.room.updatedAt = Date.now();
  publish(seated.room);
  return { ok: true, room: publicRoom(seated.room) };
}

export function setReady(roomId, playerToken, ready = true) {
  const seated = requireSeat(roomId, playerToken);
  if (!seated.ok) return seated;
  if (!seated.seat.deckRecord) return fail("Submit a playable deck first.");
  if (ready) {
    const validation = validateSubmittedDeck(seated.seat.deckRecord, seated.room);
    if (!validation.playable) return fail(validation.messages.join(" "));
  }
  seated.seat.ready = Boolean(ready);
  seated.room.updatedAt = Date.now();
  maybeStartGame(seated.room);
  publish(seated.room);
  return { ok: true, room: publicRoom(seated.room) };
}

export function leaveRoom(roomId, playerToken) {
  const seated = requireSeat(roomId, playerToken);
  if (!seated.ok) return seated;
  if (seated.room.status === "playing") {
    seated.seat.ready = false;
  } else {
    seated.room.seats[seated.playerId] = null;
  }
  seated.room.updatedAt = Date.now();
  if (!Object.values(seated.room.seats).some(Boolean)) {
    removeRoom(seated.room.roomId);
  } else {
    publish(seated.room);
  }
  return { ok: true };
}

export function runCommand(roomId, playerToken, command) {
  const seated = requireSeat(roomId, playerToken);
  if (!seated.ok) return seated;
  const gamePrecondition = validateCommandGamePrecondition(seated.room, command);
  if (!gamePrecondition.ok) return gamePrecondition;
  const commandDiagnostic = seated.room.activeDiagnostic;
  let resolvedGameCommand = null;
  if (!["restartGame", "submitSideboard"].includes(command?.kind)) {
    try {
      const authorization = resolveAuthorizedGameCommand(seated.room, seated.playerId, command);
      if (!authorization.ok) {
        recordRoomDiagnostic(commandDiagnostic, "rejected", command, seated.room.game, {
          actorId: seated.playerId,
          reason: authorization.message || "Command rejected."
        });
        return fail(authorization.message || "Command rejected.");
      }
      resolvedGameCommand = authorization.command;
    } catch (error) {
      recordRoomDiagnostic(commandDiagnostic, "exception", command, seated.room.game, {
        actorId: seated.playerId,
        error,
        rolledBack: false
      });
      throw error;
    }
  }
  const checkpoint = roomCommandCheckpoint(seated.room);
  try {
    const result = command?.kind === "submitSideboard"
      ? submitMatchSideboard(seated.room, seated.playerId, command)
      : command?.kind === "restartGame"
      ? restartCompletedGame(seated.room)
      : applyResolvedGameCommand(seated.room, seated.playerId, resolvedGameCommand);
    if (!result.ok) {
      restoreRoomCommandCheckpoint(seated.room, checkpoint);
      recordRoomDiagnostic(commandDiagnostic, "rejected", command, seated.room.game, {
        actorId: seated.playerId,
        reason: result.message || "Command rejected."
      });
      return fail(result.message || "Command rejected.");
    }
    seated.room.commandSeq += 1;
    seated.room.updatedAt = Date.now();
    if (seated.room.game?.phase === "sideboarding" && seated.room.match?.phase === "playing") {
      const initial = beginRoomInitialSideboarding(seated.room);
      if (!initial.ok) {
        restoreRoomCommandCheckpoint(seated.room, checkpoint);
        return initial;
      }
    }
    if (seated.room.game?.phase === "complete" && seated.room.match?.phase === "playing") finishMatchGame(seated.room);
    publish(seated.room);
    if (!["restartGame", "submitSideboard"].includes(command?.kind)) {
      recordRoomDiagnostic(commandDiagnostic, "success", command, seated.room.game, {
        actorId: seated.playerId,
        result
      });
      finalizeRoomDiagnostic(commandDiagnostic, seated.room.game);
    }
    return { ok: true, room: publicRoom(seated.room) };
  } catch (error) {
    // Never retain a half-applied authoritative state after an engine or
    // snapshot exception. The HTTP layer still reports the programming error.
    restoreRoomCommandCheckpoint(seated.room, checkpoint);
    recordRoomDiagnostic(commandDiagnostic, "exception", command, seated.room.game, {
      actorId: seated.playerId,
      error,
      rolledBack: true
    });
    throw error;
  }
}

function validateCommandGamePrecondition(room, command) {
  const isCommandObject = Boolean(command) && typeof command === "object" && !Array.isArray(command);
  const hasExpectedDiagnosticGameId = isCommandObject
    && Object.hasOwn(command, "expectedDiagnosticGameId");
  const hasExpectedGameNumber = isCommandObject
    && Object.hasOwn(command, "expectedGameNumber");
  const requiresGameIdentity = isCommandObject && command.kind === "surrender";

  if (!requiresGameIdentity && !hasExpectedDiagnosticGameId && !hasExpectedGameNumber) {
    return { ok: true };
  }

  const expectedDiagnosticGameId = command.expectedDiagnosticGameId;
  const expectedGameNumber = command.expectedGameNumber;
  if (!hasExpectedDiagnosticGameId
    || !hasExpectedGameNumber
    || typeof expectedDiagnosticGameId !== "string"
    || !expectedDiagnosticGameId
    || !Number.isSafeInteger(expectedGameNumber)
    || expectedGameNumber < 1) {
    return fail("This command requires a valid current game identity.");
  }

  if (expectedDiagnosticGameId !== room.diagnosticGameId
    || expectedGameNumber !== room.match?.gameNumber) {
    return fail("This command targets a different game.");
  }
  return { ok: true };
}

function roomCommandCheckpoint(room) {
  return {
    game: structuredClone(room.game),
    match: structuredClone(room.match),
    status: room.status,
    commandSeq: room.commandSeq,
    updatedAt: room.updatedAt,
    diagnosticGames: [...(room.diagnosticGames || [])],
    activeDiagnostic: room.activeDiagnostic || null,
    diagnosticGameSeq: room.diagnosticGameSeq || 0,
    diagnosticGameId: room.diagnosticGameId || null
  };
}

function restoreRoomCommandCheckpoint(room, checkpoint) {
  room.game = checkpoint.game;
  room.match = checkpoint.match;
  room.status = checkpoint.status;
  room.commandSeq = checkpoint.commandSeq;
  room.updatedAt = checkpoint.updatedAt;
  room.diagnosticGames = checkpoint.diagnosticGames;
  room.activeDiagnostic = checkpoint.activeDiagnostic;
  room.diagnosticGameSeq = checkpoint.diagnosticGameSeq;
  room.diagnosticGameId = checkpoint.diagnosticGameId;
}

function restartCompletedGame(room) {
  if (room.status !== "complete" || room.match?.phase !== "complete") return fail("The match has not ended.");
  const seats = [room.seats.p1, room.seats.p2];
  if (seats.some((seat) => !seat?.deckRecord)) return fail("Both players need a submitted deck.");
  room.match = createMatchState({
    decks: seats.map((seat) => seat.deckRecord),
    sideboardingEnabled: room.sideboardingEnabled,
    setupProcedure: room.sideboardingEnabled ? "match" : "single-game-sideboard"
  });
  room.game = createRoomGame(room, room.match.currentDecks);
  room.game.hostPlayerId = room.hostPlayerId || "p1";
  room.status = "playing";
  startRoomDiagnostic(room);
  return { ok: true };
}

export function subscribe(roomId, playerToken, response) {
  const seated = requireSeat(roomId, playerToken);
  if (!seated.ok) return seated;
  const key = roomId.toUpperCase();
  const initialEvent = serializeEvent("snapshot", snapshotForPlayer(seated.room, seated.playerId));
  const list = subscribers.get(key) || new Set();
  const subscription = {
    response,
    playerId: seated.playerId,
    roomId: key,
    blocked: false,
    pendingEvent: null,
    closed: false,
    onDrain: null,
    onClose: null,
    onError: null
  };
  subscription.onDrain = () => flushSubscription(subscription);
  subscription.onClose = () => removeSubscription(subscription);
  subscription.onError = () => removeSubscription(subscription);
  list.add(subscription);
  subscribers.set(key, list);
  response.on?.("drain", subscription.onDrain);
  response.on?.("close", subscription.onClose);
  response.on?.("error", subscription.onError);
  ensureServerMaintenance();
  try {
    queueSerializedEvent(subscription, initialEvent);
  } catch (error) {
    removeSubscription(subscription, { end: true });
    throw error;
  }
  return { ok: true };
}

export function getRoom(roomId) {
  if (!roomId) return null;
  return rooms.get(String(roomId).toUpperCase()) || null;
}

export function diagnosticLogForSeat(
  roomId,
  playerToken,
  gameNumber = null,
  diagnosticGameId = null
) {
  const seated = requireSeat(roomId, playerToken);
  if (!seated.ok) return null;
  const requestedGameNumber = Number(gameNumber);
  const requestedDiagnosticGameId = String(diagnosticGameId || "");
  const entry = requestedDiagnosticGameId
    ? seated.room.diagnosticGames.find((candidate) =>
      candidate.diagnosticGameId === requestedDiagnosticGameId)
    : Number.isInteger(requestedGameNumber) && requestedGameNumber > 0
    ? latestDiagnosticForGameNumber(seated.room.diagnosticGames, requestedGameNumber)
    : seated.room.diagnosticGames.at(-1);
  if (!entry?.recorder) return null;
  return {
    roomId: seated.room.roomId,
    gameNumber: entry.gameNumber,
    diagnosticGameId: entry.diagnosticGameId,
    playerId: seated.playerId,
    log: entry.recorder.snapshot()
  };
}

function maybeStartGame(room) {
  if (room.status !== "lobby") return;
  const seats = [room.seats.p1, room.seats.p2];
  if (seats.some((seat) => !seat?.ready || !seat.deckRecord)) return;
  room.match = createMatchState({
    decks: seats.map((seat) => seat.deckRecord),
    sideboardingEnabled: room.sideboardingEnabled,
    setupProcedure: room.sideboardingEnabled ? "match" : "single-game-sideboard"
  });
  room.game = createRoomGame(room, room.match.currentDecks);
  room.game.hostPlayerId = room.hostPlayerId || "p1";
  room.status = "playing";
  startRoomDiagnostic(room);
}

function finishMatchGame(room) {
  const battlefields = Object.fromEntries(room.game.players.map((player) => {
    const selected = room.game.battlefields.find((field) => field.ownerId === player.id || field.instanceId === player.selectedBattlefieldId);
    return [player.id, selected?.cardNumber || selected?.collectorNumber || null];
  }));
  const result = recordMatchGame(room.match, {
    winnerId: room.game.winnerId || null,
    firstPlayerId: room.game.firstPlayerId,
    battlefields
  });
  if (!result.ok || result.complete) room.status = "complete";
  else room.status = "sideboarding";
}

function beginRoomInitialSideboarding(room) {
  const battlefields = Object.fromEntries((room.game?.players || []).map((player) => {
    const selected = room.game.battlefields.find((field) =>
      field.ownerId === player.id || field.instanceId === player.selectedBattlefieldId);
    return [player.id, selected?.cardNumber || selected?.collectorNumber || null];
  }));
  const result = beginInitialSideboarding(room.match, {
    firstPlayerId: room.game?.firstPlayerId || null,
    battlefields
  });
  if (result.ok) room.status = "sideboarding";
  return result;
}

function submitMatchSideboard(room, playerId, command) {
  if (!room.match) return fail("The match has not started.");
  const deck = normalizeSubmittedDeck(command.deckRecord);
  const result = submitSideboardConfiguration(room.match, playerId, deck, cardByNumber);
  if (!result.ok) return result;
  if (result.ready) {
    const next = beginNextMatchGame(room.match);
    if (!next.ok) return next;
    room.game = createRoomGame(
      room,
      next.decks,
      next.firstPlayerId,
      next.firstPlayerChooserId,
      next.lockedBattlefields,
      next.unavailableBattlefields,
      next.initialSideboardingComplete
    );
    room.game.hostPlayerId = room.hostPlayerId || "p1";
    room.status = "playing";
    if (!next.initialSideboardingComplete) startRoomDiagnostic(room);
  }
  return { ok: true };
}

function createRoomGame(
  room,
  deckRecords,
  firstPlayerId = null,
  firstPlayerChooserId = null,
  lockedBattlefields = null,
  unavailableBattlefields = null,
  initialSideboardingComplete = false
) {
  const game = createGame({
    interactive: true,
    randomFirstPlayer: !firstPlayerId && !firstPlayerChooserId,
    firstPlayerId,
    firstPlayerChooserId,
    lockedBattlefields,
    unavailableBattlefields,
    format: room.sideboardingEnabled ? "match" : "duel",
    setupProcedure: room.sideboardingEnabled ? "match" : "single-game-sideboard",
    initialSideboardingComplete,
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    ...reproductionRandomSeeds(),
    decks: deckRecords.map(resolveDeckRecord)
  });
  game.hostPlayerId = room.hostPlayerId || "p1";
  return game;
}

function reproductionRandomSeeds() {
  const bytes = randomBytes(12);
  const seed = (offset) => bytes.readUInt32LE(offset) || 1;
  return {
    randomSeed: seed(0),
    playerRandomSeeds: { p1: seed(4), p2: seed(8) }
  };
}

function startRoomDiagnostic(room) {
  const gameNumber = Number(room.match?.gameNumber) || 1;
  room.diagnosticGameSeq = Number(room.diagnosticGameSeq) || 0;
  room.diagnosticGameSeq += 1;
  const diagnosticGameId = `${room.roomId}:${room.diagnosticGameSeq}`;
  room.diagnosticGameId = diagnosticGameId;
  const recorder = createGameReproductionLog(room.game, {
    maxEvents: 1000,
    maxFrames: 10,
    maxCommands: 2000,
    maxCommandPartBytes: 8 * 1024,
    metadata: {
      mode: "online-authoritative",
      roomId: room.roomId,
      gameNumber,
      diagnosticGameId,
      sideboardingEnabled: room.sideboardingEnabled === true
    }
  });
  const entry = { gameNumber, diagnosticGameId, recorder };
  room.diagnosticGames ||= [];
  room.diagnosticGames.push(entry);
  if (room.diagnosticGames.length > 3) room.diagnosticGames.splice(0, room.diagnosticGames.length - 3);
  room.activeDiagnostic = recorder;
}

function latestDiagnosticForGameNumber(entries, gameNumber) {
  for (let index = (entries || []).length - 1; index >= 0; index -= 1) {
    if (entries[index]?.gameNumber === gameNumber) return entries[index];
  }
  return null;
}

function recordRoomDiagnostic(recorder, status, command, state, detail) {
  if (!recorder || !command || ["restartGame", "submitSideboard"].includes(command.kind)) return;
  try {
    recorder.recordCommand(command, {
      status,
      // A rejected command cannot have changed the authoritative state. The
      // recorder already owns that same latest checkpoint, so sanitizing the
      // whole game again would only add latency to an invalid request.
      ...(status === "rejected" ? {} : { state }),
      ...(status === "success" ? { result: detail.result } : {}),
      ...(status === "rejected" ? { reason: detail.reason } : {}),
      ...(status === "exception" ? { error: detail.error } : {}),
      context: {
        actorId: detail.actorId,
        authoritative: true,
        rolledBack: detail.rolledBack === true
      }
    });
  } catch {
    // Diagnostics must never change the authoritative command outcome.
  }
}

function finalizeRoomDiagnostic(recorder, state) {
  if (!recorder || state?.phase !== "complete") return;
  try {
    recorder.finalize(
      state.surrenderedPlayerId
        ? GAME_REPRODUCTION_END_REASONS.SURRENDER
        : GAME_REPRODUCTION_END_REASONS.NORMAL,
      state,
      {
        winnerId: state.winnerId || null,
        surrenderedPlayerId: state.surrenderedPlayerId || null
      }
    );
  } catch {
    // The completed game remains authoritative even if diagnostic capture fails.
  }
}

function publish(room) {
  const list = subscribers.get(room.roomId);
  if (!list) return;
  // Prepare every private payload before any socket is written. If snapshot
  // construction fails, runCommand can roll the room back without giving only
  // one player the new state.
  // Multiple tabs may watch the same seat. Redact and serialize once per
  // player, then share the immutable SSE string across those connections.
  const eventsByPlayerId = new Map();
  for (const subscription of list) {
    if (subscription.closed || eventsByPlayerId.has(subscription.playerId)) continue;
    eventsByPlayerId.set(
      subscription.playerId,
      serializeEvent("snapshot", snapshotForPlayer(room, subscription.playerId))
    );
  }
  for (const subscription of [...list]) {
    if (subscription.closed) continue;
    try {
      queueSerializedEvent(subscription, eventsByPlayerId.get(subscription.playerId));
    } catch {
      removeSubscription(subscription, { end: true });
    }
  }
  if (!list.size) subscribers.delete(room.roomId);
}

function serializeEvent(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function writeSerializedEvent(response, event) {
  return response.write(event);
}

function queueSerializedEvent(subscription, event) {
  if (subscription.closed || !event) return;
  if (subscription.response.writableEnded || subscription.response.destroyed) {
    removeSubscription(subscription);
    return;
  }
  // A snapshot supersedes every older unsent snapshot. Retaining one latest
  // event bounds memory even when a browser or proxy stops reading its socket.
  if (subscription.blocked) {
    subscription.pendingEvent = event;
    return;
  }
  subscription.pendingEvent = null;
  if (writeSerializedEvent(subscription.response, event) === false) {
    subscription.blocked = true;
  }
}

function flushSubscription(subscription) {
  if (subscription.closed) return;
  subscription.blocked = false;
  const pendingEvent = subscription.pendingEvent;
  subscription.pendingEvent = null;
  if (!pendingEvent) return;
  try {
    queueSerializedEvent(subscription, pendingEvent);
  } catch {
    removeSubscription(subscription, { end: true });
  }
}

function removeSubscription(subscription, options = {}) {
  if (!subscription || subscription.closed) return;
  subscription.closed = true;
  subscription.pendingEvent = null;
  const { response, roomId } = subscription;
  removeResponseListener(response, "drain", subscription.onDrain);
  removeResponseListener(response, "close", subscription.onClose);
  removeResponseListener(response, "error", subscription.onError);
  const list = subscribers.get(roomId);
  list?.delete(subscription);
  if (list && !list.size) subscribers.delete(roomId);
  if (options.end === true) {
    try { response.end(); } catch {}
  }
}

function removeResponseListener(response, eventName, listener) {
  if (!listener) return;
  if (typeof response.off === "function") response.off(eventName, listener);
  else response.removeListener?.(eventName, listener);
}

function requireSeat(roomId, playerToken) {
  const room = getRoom(roomId);
  if (!room) return fail("Room not found.");
  const seat = seatByToken(room, playerToken);
  if (!seat) return fail("Seat token is invalid.");
  return { ok: true, room, seat, playerId: seat.playerId };
}

function seatByToken(room, playerToken) {
  if (!playerToken) return null;
  return Object.values(room.seats).find((seat) => seat?.playerToken === playerToken) || null;
}

function createSeat(playerId) {
  return {
    playerId,
    playerToken: randomToken(18),
    deckRecord: null,
    ready: false,
    connectedAt: Date.now()
  };
}

function createRoomId() {
  let id = "";
  do {
    id = randomToken(4).toUpperCase();
  } while (rooms.has(id));
  return id;
}

function randomToken(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function cleanupRooms() {
  const now = Date.now();
  lastRoomCleanupAt = now;
  for (const [roomId, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) removeRoom(roomId);
  }
}

function ensureServerMaintenance() {
  if (serverMaintenanceTimer || !rooms.size) return;
  serverMaintenanceTimer = setInterval(() => {
    const now = Date.now();
    if (now - lastRoomCleanupAt >= ROOM_CLEANUP_INTERVAL_MS) cleanupRooms();
    const keepalive = `: keepalive ${now}\n\n`;
    for (const list of subscribers.values()) {
      for (const subscription of [...list]) {
        if (subscription.closed || subscription.response.writableEnded || subscription.response.destroyed) {
          removeSubscription(subscription);
          continue;
        }
        // Never add keepalives behind a blocked snapshot. The drain listener
        // resumes delivery after the socket buffer has made room.
        if (subscription.blocked) continue;
        try {
          if (writeSerializedEvent(subscription.response, keepalive) === false) {
            subscription.blocked = true;
          }
        } catch {
          removeSubscription(subscription, { end: true });
        }
      }
    }
    stopServerMaintenanceIfIdle();
  }, SERVER_MAINTENANCE_INTERVAL_MS);
  serverMaintenanceTimer.unref?.();
}

function stopServerMaintenanceIfIdle() {
  if (rooms.size || !serverMaintenanceTimer) return;
  clearInterval(serverMaintenanceTimer);
  serverMaintenanceTimer = null;
}

function removeRoom(roomId) {
  rooms.delete(roomId);
  const list = subscribers.get(roomId);
  if (list) {
    for (const subscription of [...list]) {
      removeSubscription(subscription, { end: true });
    }
  }
  stopServerMaintenanceIfIdle();
}

function fail(message) {
  return { ok: false, message };
}
