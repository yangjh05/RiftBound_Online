import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { cards, rawDecklists } from "../src/cards.mjs";
import { CARD_POOL_FORMATS } from "../src/card-pools.mjs";
import {
  STANDARD_BAN_LIST, deckRoomRestrictions, isCardBanned,
  isUnmodifiedDefaultDeck, normalizeRoomDeckOptions, validateRoomDeck
} from "../src/decks/legality.mjs";
import { validateDeckRecord } from "../src/decks/rules.mjs";
import { cardByNumber, normalizeSubmittedDeck, validateSubmittedDeck } from "../server/decks.mjs";
import { createRoom, getRoom, joinRoom, listRooms, runCommand, setReady, submitDeck } from "../server/rooms.mjs";
import { snapshotForPlayer } from "../server/snapshots.mjs";
import { handleMultiplayerRequest } from "../server/http-multiplayer.mjs";
import { configureOnlineServer, createOnlineRoom } from "../src/net/client.mjs";
import { beginInitialSideboarding } from "../src/match.mjs";
import { localizeKoreanNetworkError } from "../src/ui/korean-text.mjs";

const strict = { poolId: "vendetta-era", banlistEnabled: true };
const personalDeck = (key = "provingGroundsAnnie") => normalizeSubmittedDeck({ ...structuredClone(rawDecklists[key]), id: "personal-deck" });
const defaultDeck = (key = "provingGroundsAnnie") => normalizeSubmittedDeck({ ...structuredClone(rawDecklists[key]), id: `default-${rawDecklists[key].id}` });

test("Standard ban list matches the twelve official names and excludes the 2v2-only legend", () => {
  const banned = Object.values(cards).filter(isCardBanned);
  assert.equal(STANDARD_BAN_LIST.effectiveDate, "2026-09-18");
  assert.equal(banned.length, 12);
  assert.deepEqual(banned.map((card) => card.name).sort(), [...STANDARD_BAN_LIST.names].sort());
  assert.equal(isCardBanned(cardByNumber("OGS-019/024")), false);
  assert.equal(isCardBanned({ ...cardByNumber("OGN-183/298"), id: "alternate", cardNumber: "ALT-001" }), true);
});

test("room settings preserve legacy defaults and accept all supported environments", () => {
  assert.deepEqual(normalizeRoomDeckOptions(), { poolId: "vendetta-era", banlistEnabled: false });
  assert.deepEqual(normalizeRoomDeckOptions({ poolId: "unknown", banlistEnabled: "false" }), normalizeRoomDeckOptions());
  for (const pool of CARD_POOL_FORMATS) assert.equal(normalizeRoomDeckOptions({ poolId: pool.id }).poolId, pool.id);
});

test("bans check main, sideboard and battlefields without changing ordinary deck validation", () => {
  const deck = personalDeck();
  assert.equal(validateDeckRecord(deck, cardByNumber).playable, true);
  assert.equal(validateSubmittedDeck(deck).playable, true);
  assert.equal(validateRoomDeck(deck, cardByNumber, { banlistEnabled: false }).playable, true);
  const restricted = validateRoomDeck(deck, cardByNumber, strict);
  assert.equal(restricted.playable, false);
  assert.ok(restricted.bannedCards.some((card) => card.cardNumber === "OGN-168/298"));
  assert.ok(restricted.bannedCards.some((card) => card.cardNumber === "OGN-292/298"));
  const sideOnly = personalDeck("originsKaisa");
  sideOnly.sideboard = [["OGN-110/298", 1]];
  assert.equal(validateDeckRecord(sideOnly, cardByNumber).playable, true);
  assert.match(validateRoomDeck(sideOnly, cardByNumber, strict).messages.join(" "), /Ekko, Recurrent/);
});

test("environment limits check every zone even when bans are disabled", () => {
  for (const zone of ["legend", "main", "sideboard", "battlefields", "runes"]) {
    // Current runes are all Origins; include a later-printing fixture to guard
    // the Rune Deck path when another set's runes are added.
    const card = zone === "runes"
      ? { ...cardByNumber("OGN-089/298"), cardNumber: "SFD-test-rune", set: "Spiritforged" }
      : Object.values(cards).find((candidate) => candidate.set === "Spiritforged"
        && candidate.type === ({ legend: "legend", main: "unit", sideboard: "spell", battlefields: "battlefield" }[zone]));
    const lookup = (number) => number === card?.cardNumber ? card : cardByNumber(number);
    assert.ok(card, zone);
    const deck = personalDeck("originsKaisa");
    deck[zone] = zone === "legend" ? card.cardNumber : zone === "battlefields" ? [card.cardNumber] : [[card.cardNumber, 1]];
    const restricted = deckRoomRestrictions(deck, lookup, { poolId: "origins-era" });
    assert.equal(restricted.playable, false, zone);
    assert.ok(restricted.outOfPoolCards.some((candidate) => candidate.cardNumber === card.cardNumber), zone);
    assert.equal(deckRoomRestrictions(deck, lookup, { poolId: "spiritforged-era" }).playable, true, zone);
  }
});

test("every unmodified default remains playable with bans enabled, including normalized runes and aliases", () => {
  for (const key of Object.keys(rawDecklists)) {
    const deck = defaultDeck(key);
    assert.equal(isUnmodifiedDefaultDeck(deck, cardByNumber), true, key);
    const validation = validateRoomDeck(deck, cardByNumber, strict);
    assert.equal(validation.playable, true, `${key}: ${validation.messages.join(" ")}`);
    assert.equal(validateDeckRecord(rawDecklists[key], cardByNumber).playable, true, key);
    deck.main.reverse();
    deck.battlefields.reverse();
    deck.main = deck.main.map(([number, count]) => [cardByNumber(number).id, count]);
    assert.equal(isUnmodifiedDefaultDeck(deck, cardByNumber), true, key);
  }
  const outside = validateRoomDeck(defaultDeck("drowsy"), cardByNumber, { poolId: "origins-era", banlistEnabled: true });
  assert.equal(outside.banExempt, true);
  assert.equal(outside.playable, false);
  assert.ok(outside.outOfPoolCards.length > 0);
});

test("default ids, flags and claimed AI sources cannot exempt modified or personal decks", () => {
  const deck = defaultDeck();
  deck.sideboard.pop();
  deck.isDefault = true;
  deck.source = "AI generated default deck";
  assert.equal(validateDeckRecord(deck, cardByNumber).playable, true);
  assert.equal(validateRoomDeck(deck, cardByNumber, strict).playable, false);
  assert.equal(isUnmodifiedDefaultDeck(deck, cardByNumber), false);
  const copy = { ...defaultDeck(), id: "personal-copy", isDefault: true };
  assert.equal(validateRoomDeck(copy, cardByNumber, strict).playable, false);
});

test("room submission enforces bans on both seats and preserves an accepted deck after rejection", () => {
  const host = createRoom(strict);
  const guest = joinRoom(host.room.roomId);
  const roomId = host.room.roomId;
  assert.equal(submitDeck(roomId, host.playerToken, defaultDeck()).ok, true);
  assert.equal(submitDeck(roomId, guest.playerToken, personalDeck()).ok, false);
  assert.equal(setReady(roomId, guest.playerToken).ok, false);
  assert.equal(submitDeck(roomId, host.playerToken, personalDeck()).ok, false);
  assert.equal(getRoom(roomId).seats.p1.deckRecord.id, defaultDeck().id);
  assert.equal(submitDeck(roomId, guest.playerToken, defaultDeck("provingGroundsMasterYi")).ok, true);
  assert.equal(setReady(roomId, host.playerToken).ok, true);
  assert.equal(setReady(roomId, guest.playerToken).ok, true);
  assert.equal(getRoom(roomId).status, "playing");
  assert.equal(submitDeck(roomId, host.playerToken, personalDeck()).ok, false);
});

test("room options survive list, join and private snapshots without client overrides", () => {
  const host = createRoom({ poolId: "origins-era", banlistEnabled: true });
  const guest = joinRoom(host.room.roomId);
  for (const room of [host.room, guest.room, listRooms().find((room) => room.roomId === host.room.roomId), snapshotForPlayer(getRoom(host.room.roomId), "p2").room]) {
    assert.equal(room.poolId, "origins-era");
    assert.equal(room.banlistEnabled, true);
  }
  const deck = { ...personalDeck("drowsy"), poolId: "vendetta-era", banlistEnabled: false };
  assert.match(submitDeck(host.room.roomId, guest.playerToken, deck).message, /outside the room card pool/);
  const legacy = createRoom();
  assert.equal(submitDeck(legacy.room.roomId, legacy.playerToken, personalDeck()).ok, true);
});

test("default ban exemptions survive legitimate sideboarding and restart but cannot add cards", () => {
  const host = createRoom(strict);
  const guest = joinRoom(host.room.roomId);
  const roomId = host.room.roomId;
  submitDeck(roomId, host.playerToken, defaultDeck());
  submitDeck(roomId, guest.playerToken, defaultDeck("provingGroundsMasterYi"));
  setReady(roomId, host.playerToken);
  setReady(roomId, guest.playerToken);
  const room = getRoom(roomId);
  const fields = { p1: room.match.registeredDecks[0].battlefields[0], p2: room.match.registeredDecks[1].battlefields[0] };
  assert.equal(beginInitialSideboarding(room.match, { firstPlayerId: "p1", battlefields: fields }).ok, true);
  room.status = "sideboarding";
  const changed = structuredClone(room.match.registeredDecks[0]);
  const main = changed.main.find(([number]) => number === "OGN-168/298");
  const side = changed.sideboard.find(([number]) => number === "OGN-168/298");
  const replacement = changed.sideboard.find(([number]) => number === "OGN-169/298");
  main[1] -= 1;
  side[1] += 1;
  replacement[1] -= 1;
  changed.main.push([replacement[0], 1]);
  assert.equal(isUnmodifiedDefaultDeck(changed, cardByNumber), false);
  assert.equal(runCommand(roomId, host.playerToken, { kind: "submitSideboard", deckRecord: changed }).ok, true);
  const injected = structuredClone(room.match.registeredDecks[1]);
  injected.sideboard.push(["OGN-183/298", 1]);
  assert.equal(runCommand(roomId, guest.playerToken, { kind: "submitSideboard", deckRecord: injected }).ok, false);
  assert.equal(runCommand(roomId, guest.playerToken, { kind: "submitSideboard", deckRecord: room.match.registeredDecks[1] }).ok, true);
  assert.equal(room.status, "playing");
  assert.equal(runCommand(roomId, host.playerToken, { kind: "surrender", expectedDiagnosticGameId: room.diagnosticGameId, expectedGameNumber: 1 }).ok, true);
  assert.equal(submitDeck(roomId, host.playerToken, defaultDeck()).ok, true, "completed rooms still accept a deck for the rematch");
  assert.equal(submitDeck(roomId, host.playerToken, personalDeck()).ok, false, "rematch submissions still enforce bans");
  assert.equal(runCommand(roomId, host.playerToken, { kind: "restartGame" }).ok, true);
  assert.equal(room.banlistEnabled, true);
  assert.equal(room.status, "playing");
});

test("HTTP room creation and network client carry selected settings end to end", async () => {
  const originalFetch = globalThis.fetch;
  configureOnlineServer("");
  globalThis.fetch = async (url, options) => {
    const req = Readable.from([Buffer.from(options.body)]);
    req.method = options.method;
    req.url = url;
    let status;
    let body;
    await handleMultiplayerRequest(req, { writeHead(value) { status = value; }, end(value) { body = value; } });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await createOnlineRoom({ poolId: "spiritforged-era", banlistEnabled: true, sideboardingEnabled: true });
    assert.equal(result.room.poolId, "spiritforged-era");
    assert.equal(result.room.banlistEnabled, true);
    assert.equal(result.room.sideboardingEnabled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("room restriction errors have actionable Korean messages", () => {
  assert.match(localizeKoreanNetworkError("Banned cards are not allowed in this room: Stacked Deck."), /금지 카드/);
  assert.match(localizeKoreanNetworkError("Cards outside the room card pool (Origins 출시 환경): Called Shot."), /선택 환경/);
  assert.match(localizeKoreanNetworkError("Cards outside the room card pool: Called Shot. Banned cards are not allowed in this room: Called Shot."), /선택 환경.*금지 카드/);
});
