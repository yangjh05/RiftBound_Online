import test from "node:test";
import assert from "node:assert/strict";

import { handleMultiplayerRequest } from "../server/http-multiplayer.mjs";
import {
  configureOnlineServer,
  configuredMultiplayerServer,
  fetchAiGenerationCheckpoint,
  fetchAiGenerations,
  fetchRooms,
  openRoomEvents
} from "../src/net/client.mjs";
import { createRoom, getRoom, joinRoom, runCommand, setReady, submitDeck, subscribe } from "../server/rooms.mjs";
import { snapshotForPlayer } from "../server/snapshots.mjs";
import { rawDecklists } from "../src/cards.mjs";

test("remote multiplayer room checks use the configured public server", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true, rooms: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    configureOnlineServer("https://play.example.com/");
    const result = await fetchRooms();
    assert.deepEqual(result.rooms, []);
    assert.equal(request.url, "https://play.example.com/api/rooms");
    assert.equal(request.options.headers, undefined);
  } finally {
    configureOnlineServer("");
    globalThis.fetch = originalFetch;
  }
});

test("desktop build metadata prefers its dedicated multiplayer server", () => {
  assert.equal(configuredMultiplayerServer({
    updateBaseUrl: "https://updates.example.com/",
    multiplayerBaseUrl: "https://play.example.com/"
  }), "https://play.example.com");
  assert.equal(configuredMultiplayerServer({
    updateBaseUrl: "https://legacy-combined.example.com/"
  }), "https://legacy-combined.example.com");
});

test("AI generation client reads the catalog and selected checkpoint from the configured server", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith("/api/ai/generations")) {
      return new Response(JSON.stringify({ ok: true, generations: [{ generation: 6 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ generation: 6, gamesTrained: 643 }), { status: 200 });
  };
  try {
    configureOnlineServer("https://play.example.com");
    assert.deepEqual((await fetchAiGenerations()).generations, [{ generation: 6 }]);
    assert.equal((await fetchAiGenerationCheckpoint(6)).generation, 6);
    assert.deepEqual(requests, [
      "https://play.example.com/api/ai/generations",
      "https://play.example.com/api/ai/generations/6/model"
    ]);
  } finally {
    configureOnlineServer("");
    globalThis.fetch = originalFetch;
  }
});

test("multiplayer API preflight enables cross-origin app clients", async () => {
  let status = null;
  let headers = null;
  let ended = false;
  const response = {
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end() {
      ended = true;
    }
  };

  assert.equal(await handleMultiplayerRequest({ method: "OPTIONS", url: "/api/rooms" }, response), true);
  assert.equal(status, 204);
  assert.equal(headers["access-control-allow-origin"], "*");
  assert.equal(headers["access-control-allow-headers"], "authorization, content-type");
  assert.match(headers["access-control-allow-methods"], /PUT/u);
  assert.equal(ended, true);
});

test("remote multiplayer snapshots reconnect after a dropped event stream", async () => {
  const originalFetch = globalThis.fetch;
  let connections = 0;
  let events = null;
  globalThis.fetch = async () => {
    connections += 1;
    const sequence = connections;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: {"sequence":${sequence}}\n\n`));
        controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  try {
    configureOnlineServer("https://example.invalid");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("remote event stream did not reconnect")), 3000);
      events = openRoomEvents("ROOM", "TOKEN", {
        snapshot(payload) {
          if (payload.sequence < 2) return;
          clearTimeout(timeout);
          events.close();
          resolve();
        }
      });
    });
    assert.equal(connections >= 2, true);
  } finally {
    events?.close();
    configureOnlineServer("");
    globalThis.fetch = originalFetch;
  }
});

test("a multiplayer snapshot exception rolls back the authoritative command", () => {
  const created = createRoom();
  const roomId = created.room.roomId;
  const joined = joinRoom(roomId);
  const firstDeck = rawDecklists.provingGroundsAnnie;
  const secondDeck = rawDecklists.provingGroundsMasterYi;
  assert.equal(submitDeck(roomId, created.playerToken, firstDeck).ok, true);
  assert.equal(submitDeck(roomId, joined.playerToken, secondDeck).ok, true);
  assert.equal(setReady(roomId, created.playerToken, true).ok, true);
  assert.equal(setReady(roomId, joined.playerToken, true).ok, true);

  const closeHandlers = [];
  const response = {
    write() { return true; },
    end() {},
    on(event, handler) {
      if (event === "close") closeHandlers.push(handler);
    }
  };
  assert.equal(subscribe(roomId, created.playerToken, response).ok, true);
  const room = getRoom(roomId);
  const phaseBefore = room.game.phase;
  room.game.serializationBomb = 1n;

  try {
    assert.throws(() => runCommand(roomId, created.playerToken, { kind: "rollFirstPlayer" }), /BigInt/);
    assert.equal(room.game.phase, phaseBefore);
    assert.equal(room.commandSeq, 0);
    assert.equal(room.game.serializationBomb, 1n);
  } finally {
    for (const close of closeHandlers) close();
  }
});

test("multiplayer players roll in their own seats and the winner chooses the first player", () => {
  const created = createRoom();
  const joined = joinRoom(created.room.roomId);
  assert.equal(submitDeck(created.room.roomId, created.playerToken, rawDecklists.provingGroundsAnnie).ok, true);
  assert.equal(submitDeck(created.room.roomId, joined.playerToken, rawDecklists.provingGroundsMasterYi).ok, true);
  assert.equal(setReady(created.room.roomId, created.playerToken, true).ok, true);
  assert.equal(setReady(created.room.roomId, joined.playerToken, true).ok, true);

  const room = getRoom(created.room.roomId);
  room.game.deterministicRandomState = 123;
  assert.equal(room.game.authoritativeActorId, undefined);
  assert.equal(runCommand(created.room.roomId, joined.playerToken, { kind: "rollFirstPlayer" }).ok, false);
  assert.equal(runCommand(created.room.roomId, created.playerToken, { kind: "rollFirstPlayer" }).ok, true);
  assert.equal(room.game.firstPlayerDecision.rolls.p1, 1);
  assert.equal(room.game.firstPlayerDecision.rollerId, "p2");
  assert.equal(runCommand(created.room.roomId, created.playerToken, { kind: "rollFirstPlayer" }).ok, false);
  assert.equal(runCommand(created.room.roomId, joined.playerToken, { kind: "rollFirstPlayer" }).ok, true);
  assert.equal(room.game.firstPlayerDecision.rolls.p2, 6);
  assert.equal(room.game.firstPlayerDecision.chooserId, "p2");
  assert.equal(runCommand(created.room.roomId, created.playerToken, { kind: "chooseFirstPlayer", playerId: "p1" }).ok, false);
  assert.equal(runCommand(created.room.roomId, joined.playerToken, { kind: "chooseFirstPlayer", playerId: "p1" }).ok, true);
  assert.equal(room.game.firstPlayerId, "p1");
  assert.equal(room.game.phase, "champion-select");
});

test("official online matches reveal Battlefields before the designated loser chooses play order", () => {
  const created = createRoom({ sideboardingEnabled: true });
  const roomId = created.room.roomId;
  const joined = joinRoom(roomId);
  const tokens = { p1: created.playerToken, p2: joined.playerToken };
  const submittedDecks = {
    p1: rawDecklists.originsKaisa,
    p2: rawDecklists.provingGroundsMasterYi
  };
  assert.equal(submitDeck(roomId, tokens.p1, submittedDecks.p1).ok, true);
  assert.equal(submitDeck(roomId, tokens.p2, submittedDecks.p2).ok, true);
  assert.equal(setReady(roomId, tokens.p1, true).ok, true);
  assert.equal(setReady(roomId, tokens.p2, true).ok, true);

  const room = getRoom(roomId);
  assert.equal(room.game.phase, "champion-select");
  assert.equal(room.game.firstPlayerId, null);
  assert.deepEqual(room.game.players.map((player) => player.hand.length), [0, 0]);

  const chooseChampions = () => {
    for (const playerId of ["p1", "p2"]) {
      const player = room.game.players.find((candidate) => candidate.id === playerId);
      const legendTags = new Set(player.legend.tags || []);
      const champion = player.availableChampions.find((card) => (card.tags || []).some((tag) => legendTags.has(tag)));
      assert.ok(champion, `${playerId} has a legal selected Champion`);
      assert.equal(runCommand(roomId, tokens[playerId], { kind: "selectChampion", cardId: champion.instanceId }).ok, true);
    }
  };
  chooseChampions();
  assert.equal(room.game.phase, "battlefield-select");

  const firstSelection = room.game.players[0].availableBattlefields[0];
  assert.equal(runCommand(roomId, tokens.p1, { kind: "selectBattlefield", battlefieldId: firstSelection.instanceId }).ok, true);
  assert.equal(room.game.battlefields.length, 0);
  const waitingSnapshot = snapshotForPlayer(room, "p2").game;
  const hiddenOpponent = waitingSnapshot.players.find((player) => player.id === "p1");
  assert.equal(hiddenOpponent.selectedBattlefieldId, "hidden-battlefield-selection");
  assert.equal(hiddenOpponent.availableBattlefields.every((card) => card.redacted === true), true);
  assert.equal(waitingSnapshot.setupBattlefieldSelections, undefined);
  assert.equal(JSON.stringify(waitingSnapshot).includes(JSON.stringify(firstSelection.instanceId)), false);

  const secondSelection = room.game.players[1].availableBattlefields[0];
  assert.equal(runCommand(roomId, tokens.p2, { kind: "selectBattlefield", battlefieldId: secondSelection.instanceId }).ok, true);
  assert.equal(room.game.phase, "first-player");
  assert.equal(room.game.battlefields.length, 2);
  assert.deepEqual(room.game.players.map((player) => player.hand.length), [0, 0]);
  assert.equal(snapshotForPlayer(room, "p1").game.battlefields.some((field) => field.instanceId === secondSelection.instanceId), true);

  room.game.deterministicRandomState = 123;
  assert.equal(runCommand(roomId, tokens.p2, { kind: "rollFirstPlayer" }).ok, false);
  assert.equal(runCommand(roomId, tokens.p1, { kind: "rollFirstPlayer" }).ok, true);
  assert.equal(runCommand(roomId, tokens.p2, { kind: "rollFirstPlayer" }).ok, true);
  assert.equal(room.game.firstPlayerDecision.chooserId, "p2");
  assert.equal(runCommand(roomId, tokens.p2, { kind: "chooseFirstPlayer", playerId: "p1" }).ok, true);
  assert.equal(room.game.phase, "mulligan");
  assert.equal(room.game.mulligan.playerId, "p1");
  assert.deepEqual(room.game.players.map((player) => player.hand.length), [4, 4]);
  assert.equal(runCommand(roomId, tokens.p2, { kind: "skipMulligan" }).ok, false);
  assert.equal(runCommand(roomId, tokens.p1, { kind: "skipMulligan" }).ok, true);
  assert.equal(room.game.mulligan.playerId, "p2");
  assert.equal(runCommand(roomId, tokens.p2, { kind: "skipMulligan" }).ok, true);
  assert.equal(room.game.phase, "action");
  assert.equal(room.game.currentPlayerId, "p1");
  assert.equal(room.game.players.find((player) => player.id === "p1").runes.length, 2);
  assert.equal(runCommand(roomId, tokens.p1, { kind: "endTurn" }).ok, true);
  assert.equal(room.game.currentPlayerId, "p2");
  assert.equal(room.game.players.find((player) => player.id === "p2").runes.length, 3,
    "the second player channels one additional Rune on their first Channel step");

  assert.equal(runCommand(roomId, tokens.p1, { kind: "surrender" }).ok, true);
  assert.equal(room.status, "sideboarding");
  assert.equal(room.match.firstPlayerChooserId, "p1");

  assert.equal(runCommand(roomId, tokens.p1, {
    kind: "submitSideboard",
    deckRecord: submittedDecks.p1,
    firstPlayerId: "p2"
  }).ok, true);
  assert.equal(runCommand(roomId, tokens.p2, {
    kind: "submitSideboard",
    deckRecord: submittedDecks.p2,
    firstPlayerId: "p2"
  }).ok, true);

  assert.equal(room.status, "playing");
  assert.equal(room.game.phase, "champion-select");
  assert.equal(room.game.firstPlayerId, null, "a sideboard command cannot choose the next first player early");
  assert.equal(room.game.firstPlayerDecision.method, "designated");
  assert.equal(room.game.firstPlayerDecision.chooserId, "p1");
  assert.equal(runCommand(roomId, tokens.p1, { kind: "chooseFirstPlayer", playerId: "p2" }).ok, false);
  assert.equal(room.game.players[0].availableBattlefields.some((field) => field.cardNumber === firstSelection.cardNumber), false);
  assert.equal(room.game.players[1].availableBattlefields.some((field) => field.cardNumber === secondSelection.cardNumber), false);

  chooseChampions();
  for (const playerId of ["p1", "p2"]) {
    const player = room.game.players.find((candidate) => candidate.id === playerId);
    const battlefield = player.availableBattlefields[0];
    assert.equal(runCommand(roomId, tokens[playerId], { kind: "selectBattlefield", battlefieldId: battlefield.instanceId }).ok, true);
  }
  assert.equal(room.game.phase, "first-player");
  assert.equal(room.game.firstPlayerDecision.chooserId, "p1");
  assert.equal(snapshotForPlayer(room, "p2").game.authoritativeActorId, "p1");
  assert.equal(runCommand(roomId, tokens.p2, { kind: "chooseFirstPlayer", playerId: "p2" }).ok, false);
  assert.equal(runCommand(roomId, tokens.p1, { kind: "chooseFirstPlayer", playerId: "p2" }).ok, true);
  assert.equal(room.game.phase, "mulligan");
  assert.equal(room.game.firstPlayerId, "p2");
  assert.equal(room.game.mulligan.playerId, "p2");
  assert.deepEqual(room.game.players.map((player) => player.hand.length), [4, 4]);
});
