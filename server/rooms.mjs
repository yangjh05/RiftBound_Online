import { createGame } from "../src/engine.mjs";
import { applyGameCommand } from "./commands.mjs";
import { cardByNumber, normalizeSubmittedDeck, resolveDeckRecord, validateSubmittedDeck } from "./decks.mjs";
import { publicRoom, snapshotForPlayer } from "./snapshots.mjs";
import { beginNextMatchGame, createMatchState, recordMatchGame, submitSideboardConfiguration } from "../src/match.mjs";

const rooms = new Map();
const subscribers = new Map();
const ROOM_TTL_MS = 1000 * 60 * 60 * 4;

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
    match: null,
    seats: { p1: null, p2: null },
    game: null,
    commandSeq: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const seat = createSeat("p1");
  room.seats.p1 = seat;
  rooms.set(room.roomId, room);
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
  const validation = validateSubmittedDeck(deck);
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
    rooms.delete(seated.room.roomId);
  } else {
    publish(seated.room);
  }
  return { ok: true };
}

export function runCommand(roomId, playerToken, command) {
  const seated = requireSeat(roomId, playerToken);
  if (!seated.ok) return seated;
  const result = command?.kind === "submitSideboard"
    ? submitMatchSideboard(seated.room, seated.playerId, command)
    : command?.kind === "restartGame"
    ? restartCompletedGame(seated.room)
    : applyGameCommand(seated.room, seated.playerId, command);
  if (!result.ok) return fail(result.message || "Command rejected.");
  seated.room.commandSeq += 1;
  seated.room.updatedAt = Date.now();
  if (seated.room.game?.phase === "complete" && seated.room.match?.phase === "playing") finishMatchGame(seated.room);
  publish(seated.room);
  return { ok: true, room: publicRoom(seated.room) };
}

function restartCompletedGame(room) {
  if (room.status !== "complete" || room.match?.phase !== "complete") return fail("The match has not ended.");
  const seats = [room.seats.p1, room.seats.p2];
  if (seats.some((seat) => !seat?.deckRecord)) return fail("Both players need a submitted deck.");
  room.match = createMatchState({ decks: seats.map((seat) => seat.deckRecord), sideboardingEnabled: room.sideboardingEnabled });
  room.game = createRoomGame(room, room.match.currentDecks);
  room.game.hostPlayerId = room.hostPlayerId || "p1";
  room.status = "playing";
  return { ok: true };
}

export function subscribe(roomId, playerToken, response) {
  const seated = requireSeat(roomId, playerToken);
  if (!seated.ok) return seated;
  const key = roomId.toUpperCase();
  const list = subscribers.get(key) || new Set();
  const keepAlive = setInterval(() => {
    response.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);
  const subscription = { response, playerId: seated.playerId, keepAlive };
  list.add(subscription);
  subscribers.set(key, list);
  writeEvent(response, "snapshot", snapshotForPlayer(seated.room, seated.playerId));
  response.on("close", () => {
    clearInterval(keepAlive);
    list.delete(subscription);
    if (!list.size) subscribers.delete(key);
  });
  return { ok: true };
}

export function getRoom(roomId) {
  if (!roomId) return null;
  return rooms.get(String(roomId).toUpperCase()) || null;
}

function maybeStartGame(room) {
  if (room.status !== "lobby") return;
  const seats = [room.seats.p1, room.seats.p2];
  if (seats.some((seat) => !seat?.ready || !seat.deckRecord)) return;
  room.match = createMatchState({ decks: seats.map((seat) => seat.deckRecord), sideboardingEnabled: room.sideboardingEnabled });
  room.game = createRoomGame(room, room.match.currentDecks);
  room.game.hostPlayerId = room.hostPlayerId || "p1";
  room.status = "playing";
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

function submitMatchSideboard(room, playerId, command) {
  if (!room.match) return fail("The match has not started.");
  const deck = normalizeSubmittedDeck(command.deckRecord);
  const result = submitSideboardConfiguration(room.match, playerId, deck, cardByNumber, command.firstPlayerId || null);
  if (!result.ok) return result;
  if (result.ready) {
    const next = beginNextMatchGame(room.match);
    if (!next.ok) return next;
    room.game = createRoomGame(room, next.decks, next.firstPlayerId, next.lockedBattlefields);
    room.game.hostPlayerId = room.hostPlayerId || "p1";
    room.status = "playing";
  }
  return { ok: true };
}

function createRoomGame(room, deckRecords, firstPlayerId = null, lockedBattlefields = null) {
  const game = createGame({
    interactive: true,
    randomFirstPlayer: !firstPlayerId,
    firstPlayerId,
    lockedBattlefields,
    manualActionChainPriority: true,
    enforceChampionLegendMatch: true,
    decks: deckRecords.map(resolveDeckRecord)
  });
  game.hostPlayerId = room.hostPlayerId || "p1";
  return game;
}

function publish(room) {
  const list = subscribers.get(room.roomId);
  if (!list) return;
  for (const subscription of [...list]) {
    writeEvent(subscription.response, "snapshot", snapshotForPlayer(room, subscription.playerId));
  }
}

function writeEvent(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
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
  for (const [roomId, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) rooms.delete(roomId);
  }
}

function fail(message) {
  return { ok: false, message };
}
