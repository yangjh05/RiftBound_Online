import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { AccountStore } from "../server/accounts.mjs";
import {
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  runCommand,
  subscribe
} from "../server/rooms.mjs";
import { snapshotForPlayer } from "../server/snapshots.mjs";

class TestResponse extends EventEmitter {
  constructor(acceptWrites = true) {
    super();
    this.acceptWrites = acceptWrites;
    this.writes = [];
    this.writableEnded = false;
    this.destroyed = false;
  }

  write(value) {
    this.writes.push(String(value));
    return this.acceptWrites;
  }

  end() {
    this.writableEnded = true;
  }
}

test("a slow multiplayer subscriber retains only the newest pending snapshot", () => {
  const created = createRoom();
  const response = new TestResponse(false);
  assert.equal(subscribe(created.room.roomId, created.playerToken, response).ok, true);
  assert.equal(response.writes.length, 1, "the initial snapshot enters the socket buffer");

  const firstJoin = joinRoom(created.room.roomId);
  assert.equal(firstJoin.ok, true);
  assert.equal(leaveRoom(created.room.roomId, firstJoin.playerToken).ok, true);
  const latestJoin = joinRoom(created.room.roomId);
  assert.equal(latestJoin.ok, true);
  assert.equal(response.writes.length, 1, "blocked sockets are not written repeatedly");

  response.acceptWrites = true;
  response.emit("drain");
  assert.equal(response.writes.length, 2, "one coalesced snapshot resumes after drain");
  const data = JSON.parse(response.writes.at(-1).match(/data: (.*)\n\n$/u)[1]);
  assert.equal(data.room.playerCount, 2, "the resumed event is the newest room state");
  response.emit("drain");
  assert.equal(response.writes.length, 2, "drain without a pending snapshot is a no-op");

  response.emit("close");
  assert.equal(response.listenerCount("drain"), 0);
  assert.equal(response.listenerCount("close"), 0);
  assert.equal(response.listenerCount("error"), 0);
  leaveRoom(created.room.roomId, latestJoin.playerToken);
  leaveRoom(created.room.roomId, created.playerToken);
});

test("client snapshots do not traverse omitted authoritative ledgers", () => {
  let omittedReads = 0;
  const game = {
    phase: "complete",
    players: [],
    battlefields: [],
    log: [],
    triggerQueue: [],
    stagedEvents: [],
    revealedIntel: []
  };
  Object.defineProperty(game, "operations", {
    enumerable: true,
    get() {
      omittedReads += 1;
      throw new Error("the omitted ledger must not be read");
    }
  });
  const room = {
    roomId: "SNAP",
    diagnosticGameId: null,
    status: "complete",
    hostPlayerId: "p1",
    sideboardingEnabled: false,
    match: null,
    seats: { p1: null, p2: null },
    game,
    createdAt: 1,
    updatedAt: 1
  };

  const snapshot = snapshotForPlayer(room, "p1");
  assert.equal(omittedReads, 0);
  assert.equal("operations" in snapshot.game, false);
});

test("rejected multiplayer commands do not clone an unchanged authoritative game", () => {
  const created = createRoom();
  const room = getRoom(created.room.roomId);
  room.game = {
    phase: "action",
    players: [{ id: "p1" }, { id: "p2" }],
    currentPlayerId: "p2",
    cannotBeCloned() {}
  };

  const result = runCommand(created.room.roomId, created.playerToken, { kind: "endTurn" });
  assert.equal(result.ok, false);
  assert.match(result.message, /not your turn/u);
  leaveRoom(created.room.roomId, created.playerToken);
});

test("multiple connections for one seat share one redacted snapshot build", () => {
  const created = createRoom();
  const first = new TestResponse();
  const second = new TestResponse();
  assert.equal(subscribe(created.room.roomId, created.playerToken, first).ok, true);
  assert.equal(subscribe(created.room.roomId, created.playerToken, second).ok, true);

  const room = getRoom(created.room.roomId);
  let diagnosticGameId = room.diagnosticGameId;
  let reads = 0;
  Object.defineProperty(room, "diagnosticGameId", {
    configurable: true,
    get() {
      reads += 1;
      return diagnosticGameId;
    },
    set(value) {
      diagnosticGameId = value;
    }
  });

  const joined = joinRoom(created.room.roomId);
  assert.equal(joined.ok, true);
  assert.equal(reads, 2,
    "publish builds once for the shared player id, plus once for the join response");
  assert.equal(first.writes.length, 2);
  assert.equal(second.writes.length, 2);

  first.emit("close");
  second.emit("close");
  leaveRoom(created.room.roomId, joined.playerToken);
  leaveRoom(created.room.roomId, created.playerToken);
});

test("creating a new account session prunes expired sessions without evicting valid ones", async () => {
  const store = new AccountStore({ filePath: "unused-account-store.json" });
  const now = Date.now();
  store.sessions.set("expired", { accountKey: "old", expiresAt: now - 1 });
  store.sessions.set("valid", { accountKey: "active", expiresAt: now + 60_000 });

  const result = await store.createAuthenticatedResult({
    id: "new-user",
    accountId: "new.user",
    accountKey: "new.user",
    decks: [],
    activeDeckIds: [],
    createdAt: now
  });

  assert.equal(typeof result.token, "string");
  assert.equal(store.sessions.has("expired"), false);
  assert.equal(store.sessions.has("valid"), true);
  assert.equal(store.sessions.size, 2, "one valid and one newly-created session remain");
});
