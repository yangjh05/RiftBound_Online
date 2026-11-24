import test from "node:test";
import assert from "node:assert/strict";

import { handleMultiplayerRequest } from "../server/http-multiplayer.mjs";
import {
  configureBugReportServer,
  configureOnlineServer,
  configuredBugReportServer,
  configuredMultiplayerServer,
  fetchAiGenerationCheckpoint,
  fetchAiGenerationCheckpointBuffer,
  fetchAiGenerations,
  fetchRooms,
  MAX_REMOTE_ROOM_EVENT_BUFFER_LENGTH,
  openRoomEvents,
  submitBugReport
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
    const rawCheckpoint = await fetchAiGenerationCheckpointBuffer(6);
    assert.equal(JSON.parse(new TextDecoder().decode(rawCheckpoint)).generation, 6);
    assert.deepEqual(requests, [
      "https://play.example.com/api/ai/generations",
      "https://play.example.com/api/ai/generations/6/model",
      "https://play.example.com/api/ai/generations/6/model"
    ]);
  } finally {
    configureOnlineServer("");
    globalThis.fetch = originalFetch;
  }
});

test("AI checkpoints retain the catalog server when account restoration changes multiplayer servers", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let releaseCatalog;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith("/api/ai/generations")) {
      await new Promise((resolve) => { releaseCatalog = resolve; });
      return new Response(JSON.stringify({ ok: true, generations: [{ generation: 138 }] }));
    }
    return new Response(JSON.stringify({ generation: 138 }));
  };
  try {
    for (const catalogServer of ["", "https://models.example.com"]) {
      requests.length = 0;
      configureOnlineServer(catalogServer);
      const pendingCatalog = fetchAiGenerations();
      configureOnlineServer("https://play.example.com");
      releaseCatalog();
      const catalog = await pendingCatalog;
      assert.equal(catalog.checkpointBaseUrl, catalogServer);
      const options = { baseUrl: catalog.checkpointBaseUrl };
      assert.equal((await fetchAiGenerationCheckpoint(138, options)).generation, 138);
      const buffer = await fetchAiGenerationCheckpointBuffer(138, options);
      assert.equal(JSON.parse(new TextDecoder().decode(buffer)).generation, 138);
      assert.deepEqual(requests, [
        `${catalogServer}/api/ai/generations`,
        `${catalogServer}/api/ai/generations/138/model`,
        `${catalogServer}/api/ai/generations/138/model`
      ]);
    }
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

test("closing native room events clears delayed errors and listener references", () => {
  const originalEventSource = globalThis.EventSource;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduledCallback = null;
  let clearedTimer = null;

  class FakeEventSource {
    static CLOSED = 2;
    static instance = null;

    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.closeCalls = 0;
      this.listeners = new Map();
      FakeEventSource.instance = this;
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    close() {
      this.closeCalls += 1;
      this.readyState = FakeEventSource.CLOSED;
    }

    emit(type, event = {}) {
      for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    }
  }

  globalThis.EventSource = FakeEventSource;
  globalThis.setTimeout = (callback, milliseconds) => {
    assert.equal(milliseconds, 3000);
    scheduledCallback = callback;
    return 91;
  };
  globalThis.clearTimeout = (timer) => {
    clearedTimer = timer;
  };

  let errorCalls = 0;
  try {
    configureOnlineServer("");
    const connection = openRoomEvents("ROOM", "TOKEN", {
      error() {
        errorCalls += 1;
      }
    });
    const source = FakeEventSource.instance;
    assert.notStrictEqual(connection, source);

    source.emit("error");
    const delayedError = scheduledCallback;
    assert.equal(typeof delayedError, "function");
    connection.close();
    connection.close();

    assert.equal(clearedTimer, 91);
    assert.equal(source.closeCalls, 1);
    assert.equal([...source.listeners.values()].every((listeners) => listeners.size === 0), true);
    delayedError();
    source.emit("error");
    assert.equal(errorCalls, 0);
  } finally {
    configureOnlineServer("");
    if (originalEventSource === undefined) delete globalThis.EventSource;
    else globalThis.EventSource = originalEventSource;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("closing remote room events cancels and releases the active reader", async () => {
  const originalFetch = globalThis.fetch;
  let observedSignal = null;
  let resolveRead = null;
  let cancelCalls = 0;
  let releaseCalls = 0;
  let errorCalls = 0;
  let events = null;
  const reader = {
    read() {
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
    async cancel() {
      cancelCalls += 1;
      resolveRead?.({ value: undefined, done: true });
    },
    releaseLock() {
      releaseCalls += 1;
    }
  };
  globalThis.fetch = async (_url, options) => {
    observedSignal = options.signal;
    return {
      ok: true,
      status: 200,
      body: { getReader: () => reader }
    };
  };

  try {
    configureOnlineServer("https://example.invalid");
    await new Promise((resolve) => {
      events = openRoomEvents("ROOM", "TOKEN", {
        open: resolve,
        error() {
          errorCalls += 1;
        }
      });
    });
    events.close();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(observedSignal.aborted, true);
    assert.equal(cancelCalls, 1);
    assert.equal(releaseCalls, 1);
    assert.equal(errorCalls, 0);
  } finally {
    events?.close();
    configureOnlineServer("");
    globalThis.fetch = originalFetch;
  }
});

test("remote multiplayer snapshots reconnect after a dropped event stream", async () => {
  const originalFetch = globalThis.fetch;
  let connections = 0;
  let events = null;
  const cancelledReaders = [];
  const releasedReaders = [];
  globalThis.fetch = async () => {
    connections += 1;
    const sequence = connections;
    let readCount = 0;
    const reader = {
      async read() {
        readCount += 1;
        if (readCount === 1) {
          return {
            value: new TextEncoder().encode(`event: snapshot\ndata: {"sequence":${sequence}}\n\n`),
            done: false
          };
        }
        return { value: undefined, done: true };
      },
      async cancel() {
        cancelledReaders.push(sequence);
      },
      releaseLock() {
        releasedReaders.push(sequence);
      }
    };
    return {
      ok: true,
      status: 200,
      body: { getReader: () => reader }
    };
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
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connections >= 2, true);
    assert.deepEqual(cancelledReaders, [1, 2]);
    assert.deepEqual(releasedReaders, [1, 2]);
  } finally {
    events?.close();
    configureOnlineServer("");
    globalThis.fetch = originalFetch;
  }
});

test("remote room events cap an unterminated SSE buffer and dispose its reader", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode("x".repeat(MAX_REMOTE_ROOM_EVENT_BUFFER_LENGTH)),
    encoder.encode("x")
  ];
  let reads = 0;
  let cancelCalls = 0;
  let releaseCalls = 0;
  let connections = 0;
  let events = null;
  const reader = {
    async read() {
      reads += 1;
      if (chunks.length) return { value: chunks.shift(), done: false };
      return { value: undefined, done: true };
    },
    async cancel() {
      cancelCalls += 1;
    },
    releaseLock() {
      releaseCalls += 1;
    }
  };
  globalThis.fetch = async () => {
    connections += 1;
    return {
      ok: true,
      status: 200,
      body: { getReader: () => reader }
    };
  };

  try {
    configureOnlineServer("https://example.invalid");
    const errorMessage = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("unterminated SSE buffer was not rejected")), 2000);
      events = openRoomEvents("ROOM", "TOKEN", {
        error(message) {
          clearTimeout(timeout);
          events.close();
          resolve(message);
        }
      });
    });

    assert.match(errorMessage, /buffer exceeded/u);
    assert.equal(reads, 2, "a buffer exactly at the limit remains valid until another character arrives");
    assert.equal(connections, 1);
    assert.equal(cancelCalls, 1);
    assert.equal(releaseCalls, 1);
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
  assert.equal(room.game.phase, "sideboarding");
  assert.equal(room.status, "sideboarding");
  assert.equal(room.match.phase, "initial-sideboarding");
  assert.equal(room.game.battlefields.length, 2);
  assert.deepEqual(room.game.players.map((player) => player.champion), [null, null]);
  const p1View = snapshotForPlayer(room, "p1");
  const opponent = p1View.game.players.find((player) => player.id === "p2");
  assert.equal(p1View.game.battlefields.length, 2);
  assert.ok(opponent.legend && !opponent.legend.redacted);
  assert.equal(opponent.source, undefined, "an opponent snapshot does not disclose the registered deck source URL");
  assert.equal(opponent.availableBattlefields.every((card) => card.redacted), true);
  assert.equal(p1View.match.currentDeck.legend, rawDecklists.provingGroundsAnnie.legend);
  assert.notEqual(p1View.match.currentDeck.legend, rawDecklists.provingGroundsMasterYi.legend);
  assert.equal(runCommand(created.room.roomId, created.playerToken, {
    kind: "submitSideboard",
    deckRecord: rawDecklists.provingGroundsAnnie
  }).ok, true);
  assert.equal(runCommand(created.room.roomId, created.playerToken, {
    kind: "submitSideboard",
    deckRecord: rawDecklists.provingGroundsAnnie
  }).ok, false, "a locked sideboard cannot be resubmitted");
  assert.equal(room.status, "sideboarding");
  assert.equal(runCommand(created.room.roomId, joined.playerToken, {
    kind: "submitSideboard",
    deckRecord: rawDecklists.provingGroundsMasterYi
  }).ok, true);
  assert.equal(room.status, "playing");
  assert.equal(room.match.gameNumber, 1);
  assert.equal(room.game.phase, "champion-select");
  assert.equal(room.game.firstPlayerId, "p1");
  const revealedFields = Object.fromEntries(room.game.battlefields.map((field) => [field.ownerId, field.cardNumber]));
  assert.deepEqual(revealedFields, room.match.initialSetup.battlefields);
  const firstChampionPlayer = room.game.players.find((player) => player.id === room.game.championSelectPlayerId);
  assert.equal(runCommand(created.room.roomId, created.playerToken, {
    kind: "selectChampion",
    cardId: firstChampionPlayer.availableChampions[0].instanceId
  }).ok, true);
  assert.deepEqual(room.game.players.map((player) => player.champion), [null, null]);
  const opponentChampionView = snapshotForPlayer(room, "p2").game.players.find((player) => player.id === firstChampionPlayer.id);
  assert.equal(opponentChampionView.chosenChampionName, null, "the first locked Champion name stays private");
  assert.deepEqual(opponentChampionView.availableChampions, [], "the opponent cannot infer the locked Champion from candidate counts");
});

test("bug reports use their dedicated server and optional account authorization", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ ok: true, reportId: "report-1", submittedAt: "2026-09-02T00:00:00.000Z" }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    assert.equal(configuredBugReportServer({
      updateBaseUrl: "https://updates.example.com/",
      multiplayerBaseUrl: "https://play.example.com/",
      bugReportBaseUrl: "https://reports.example.com/"
    }), "https://reports.example.com");
    configureBugReportServer("https://reports.example.com/");
    const result = await submitBugReport({ description: "열 글자 이상 버그 설명입니다" }, { accountToken: "account-secret" });
    assert.equal(result.reportId, "report-1");
    assert.equal(request.url, "https://reports.example.com/api/bug-reports");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.authorization, "Bearer account-secret");
    assert.deepEqual(JSON.parse(request.options.body), { description: "열 글자 이상 버그 설명입니다" });
  } finally {
    configureBugReportServer("");
    globalThis.fetch = originalFetch;
  }
});

test("bug report submissions abort after a bounded timeout", async () => {
  const originalFetch = globalThis.fetch;
  let observedSignal = null;
  globalThis.fetch = async (_url, options) => {
    observedSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    });
  };
  try {
    await assert.rejects(
      submitBugReport(
        { description: "열 글자 이상 버그 설명입니다" },
        { timeoutMs: 20 }
      ),
      /Bug report submission timed out/u
    );
    assert.equal(observedSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

  assert.equal(runCommand(roomId, tokens.p1, {
    kind: "surrender",
    expectedDiagnosticGameId: room.diagnosticGameId,
    expectedGameNumber: room.match.gameNumber
  }).ok, true);
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
