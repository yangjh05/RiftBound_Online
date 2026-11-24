import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { recordExecutedReplayAction } from '../src/ai/replay.mjs';

const appSource = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");

function appFunction(name) {
  const start = appSource.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.notEqual(start, -1, `missing app function ${name}`);
  const end = appSource.indexOf("\n}", start);
  assert.notEqual(end, -1, `missing end of ${name}`);
  return appSource.slice(start, end + 2);
}

function runtime() {
  const timers = [];
  const records = [];
  const mutations = [];
  let context;
  context = {
    online: { mode: "offline", roomId: "", playerToken: "", commandPending: null },
    onlineSessionGeneration: 1,
    onlineEventGeneration: 1,
    appView: "game",
    game: { phase: "first-player", currentPlayerId: "p2" },
    gameDiagnostic: { retainedReport: true },
    aiMode: true,
    aiPlayerId: "p2",
    aiHumanPlayerId: "p1",
    aiThinking: false,
    aiTurnTimer: null,
    aiTurnGeneration: 1,
    aiTurnWorkerBusyRequestId: "",
    aiTurnWorkerUnavailable: false,
    pendingAiTurnRequest: null,
    aiModel: {},
    aiReplay: { oldReplay: true },
    replayMode: false,
    replayBrowser: { current: { oldReplay: true } },
    localMatch: { phase: "playing" },
    sideboardDrafts: [{}],
    sideboardBaselines: [{}],
    neuralAiCheckpointMetadata: null,
    EFFECT_ANIMATION_DURATION_MS: 100,
    window: {
      setTimeout(callback) { timers.push(callback); return timers.length; },
      clearTimeout() {}
    },
    matchIsBetweenGames: () => false,
    aiActiveActorId: game => game.currentPlayerId,
    activePlayerId: () => context.game.currentPlayerId,
    viewerPlayerId: () => context.online.playerId,
    render() {},
    pauseReplayPlayback() { context.playbackPaused = true; },
    resetGameUiState() { context.cancelScheduledAiTurn(); },
    resetAiTurnWorkerSession() {},
    invalidateOnlineSession() { context.onlineSessionGeneration++; },
    closeOnlineEvents() { context.onlineEventGeneration++; },
    openRoomEvents: () => ({}),
    saveOnlineSeat() {},
    applyAiAction(_game, action) { mutations.push(action); return { ok: true }; },
    applyAiPaymentActions(actions) { mutations.push(...actions); return { ok: true }; },
    markGameStateChanged() {},
    recordDiagnosticCommandAttempt: () => "attempt",
    recordDiagnosticCommand(...args) { records.push(args); },
    reportUiException(...args) { records.push(args); },
    enterInitialLocalSideboardingIfNeeded() {},
    recordLocalGameIfComplete() {},
    completeAiReplay() {}
  };
  context.recordExecutedReplayAction = recordExecutedReplayAction;
  runInNewContext([
    "isOnlineGame", "viewerCanAct", "scheduleAiTurn", "aiTurnSessionIsCurrent",
    "cancelScheduledAiTurn", "prepareOnlineGameMode", "applyOnlineSeatResult", "connectOnlineEvents",
    "startAiGameFromMenu"
  ].map(appFunction).join("\n"), context);
  return { context, timers, records, mutations };
}

function setOnline(context) {
  Object.assign(context.online, { mode: "online", roomId: "TEST", playerId: "p2", playerToken: "test-token" });
}

function deferredDecision(context) {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  context.requestAiTurnDecision = () => {
    context.pendingAiTurnRequest = { resolve, reject };
    return promise;
  };
  return { resolve, reject };
}

test("online turns never schedule AI even if old AI flags survive", () => {
  const { context, timers } = runtime();
  setOnline(context);
  context.scheduleAiTurn();
  assert.equal(timers.length, 0);
  assert.equal(context.aiTurnSessionIsCurrent(context.game, 1, "p2"), false);
});

test("online seat authority wins over old AI identity and thinking state", () => {
  const { context } = runtime();
  setOnline(context);
  context.aiThinking = true;
  assert.equal(context.viewerCanAct(), true);
  context.game.currentPlayerId = "p1";
  assert.equal(context.viewerCanAct(), false);
  context.game.currentPlayerId = "p2";
  context.online.commandPending = {};
  assert.equal(context.viewerCanAct(), false);
});

for (const resultKind of ["action", "payment", "error"]) {
  test(`late AI ${resultKind} cannot mutate or log into an online game`, async () => {
    const { context, timers, records, mutations } = runtime();
    const decision = deferredDecision(context);
    context.scheduleAiTurn();
    const running = timers[0]();
    // Keep the same game object and generation to exercise the online guard
    // independently of the usual snapshot replacement/session cancellation.
    setOnline(context);
    if (resultKind === "error") decision.reject(new Error("late worker failure"));
    else decision.resolve(resultKind === "payment"
      ? { kind: "payment", actions: [{ kind: "confirmPayment" }] }
      : { selected: { action: { kind: "rollFirstPlayer" } } });
    await running;
    assert.equal(mutations.length, 0);
    assert.equal(records.length, 0);
  });
}

for (const entry of ["applyOnlineSeatResult", "connectOnlineEvents"]) {
  test(`${entry} retires local AI/replay and pending work without discarding the report`, async () => {
    const { context, timers, records, mutations } = runtime();
    const report = context.gameDiagnostic;
    const decision = deferredDecision(context);
    context.scheduleAiTurn();
    const running = timers[0]();
    context.replayMode = true;
    if (entry === "connectOnlineEvents") setOnline(context);
    context[entry]({ room: { roomId: "TEST" }, playerId: "p2", playerToken: "test-token" });
    await running; // cancellation rejects the old decision promise
    decision.resolve({ selected: { action: { kind: "rollFirstPlayer" } } });
    assert.equal(context.aiMode, false);
    assert.equal(context.aiThinking, false);
    assert.equal(context.aiPlayerId, null);
    assert.equal(context.aiHumanPlayerId, null);
    assert.equal(context.aiReplay, null);
    assert.equal(context.replayMode, false);
    assert.equal(context.replayBrowser.current, null);
    assert.equal(context.playbackPaused, true);
    assert.equal(context.localMatch, null);
    assert.equal(context.sideboardDrafts.length, 0);
    assert.equal(context.sideboardBaselines.length, 0);
    assert.equal(context.pendingAiTurnRequest, null);
    assert.equal(context.gameDiagnostic, report);
    assert.equal(mutations.length, 0);
    assert.equal(records.length, 0);
  });
}

test("normal offline AI still applies its decision", async () => {
  const { context, timers, records, mutations } = runtime();
  context.requestAiTurnDecision = async () => ({ selected: { action: { kind: "rollFirstPlayer" } } });
  context.scheduleAiTurn();
  await timers[0]();
  assert.equal(mutations.length, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0][1].status, "success");
});

test("an error in the current offline AI action is still logged after the actor changes", async () => {
  const { context, timers, records } = runtime();
  context.requestAiTurnDecision = async () => ({ selected: { action: { kind: "rollFirstPlayer" } } });
  context.applyAiAction = () => {
    context.game.currentPlayerId = "p1";
    throw new Error("current action failed after advancing the actor");
  };
  context.scheduleAiTurn();
  await timers[0]();
  assert.equal(records.length, 1);
  assert.equal(records[0][1].status, "exception");
});

test("a late AI model load cannot start a local game after joining multiplayer", async () => {
  const { context } = runtime();
  context.appView = "menu";
  context.aiMode = false;
  context.diagnosticNavigationBlocked = () => false;
  context.clearOnlineSeat = () => { context.onlineSessionGeneration++; };
  context.activeDeckRecords = () => [{}, {}];
  context.validateDeckRecord = () => ({ playable: true });
  context.selectedAiGenerationDescriptor = () => ({});
  context.trainingDeckIdForGeneration = () => "test-deck";
  let finishLoad;
  context.ensureNeuralAiLoaded = () => new Promise(resolve => { finishLoad = resolve; });
  context.createMatchState = () => { assert.fail("late load created a local match"); };
  const starting = context.startAiGameFromMenu();
  context.applyOnlineSeatResult({ room: { roomId: "TEST" }, playerId: "p2", playerToken: "test-token" });
  context.appView = "multiplayer";
  finishLoad(true);
  await starting;
  assert.equal(context.aiMode, false);
  assert.equal(context.appView, "multiplayer");
  assert.equal(context.isOnlineGame(), true);
});
