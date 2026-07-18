import test from "node:test";
import assert from "node:assert/strict";

import { handleMultiplayerRequest } from "../server/http-multiplayer.mjs";
import { configureOnlineServer, configuredMultiplayerServer, fetchRooms, openRoomEvents } from "../src/net/client.mjs";
import { createRoom, getRoom, joinRoom, runCommand, setReady, submitDeck, subscribe } from "../server/rooms.mjs";
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
  assert.equal(headers["access-control-allow-headers"], "content-type");
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
