import assert from "node:assert/strict";
import test from "node:test";

import {
  GAME_REPRODUCTION_DESCRIPTION_PLACEHOLDER,
  GAME_REPRODUCTION_LOG_SCHEMA_VERSION,
  GameReproductionLogError,
  createGameLogSubmissionPayload,
  createGameReproductionLog,
  deserializeGameReproductionLog,
  digestGameState,
  restoreGameReproductionLog,
  restoreGameReproductionLogFromStorage,
  sanitizeDiagnosticValue,
  saveGameReproductionLogToStorage,
  serializeGameReproductionLog,
  validateGameReportDescription
} from "../src/diagnostics/game-reproduction-log.mjs";

function clock() {
  let tick = Date.parse("2026-09-02T00:00:00.000Z");
  return () => tick++;
}

test("creates deterministic initial/latest checkpoints and recursively removes credentials", () => {
  const circular = {
    turn: 1,
    auth: {
      password: "do-not-log",
      accessToken: "also-do-not-log",
      authorization: "Bearer hidden"
    },
    tokenId: "game-piece-token-7",
    tokenKind: "might",
    playerToken: "must-not-leak",
    count: 12n,
    failure: new Error("diagnostic failure")
  };
  circular.self = circular;

  const recorder = createGameReproductionLog(circular, {
    logId: "log-1",
    now: clock(),
    metadata: { refresh_token: "hidden", clientVersion: "1.2.3" }
  });
  const log = recorder.snapshot();
  const serialized = recorder.serialize();

  assert.equal(log.schemaVersion, GAME_REPRODUCTION_LOG_SCHEMA_VERSION);
  assert.equal(log.initialState.digest, log.latestState.digest);
  assert.equal(log.initialState.state.auth.password, undefined);
  assert.equal(log.initialState.state.auth.accessToken, undefined);
  assert.equal(log.initialState.state.auth.authorization, undefined);
  assert.equal(log.initialState.state.tokenId, "game-piece-token-7");
  assert.equal(log.initialState.state.tokenKind, "might");
  assert.equal("playerToken" in log.initialState.state, false);
  assert.deepEqual(log.initialState.state.count, {
    __riftboundDiagnosticType: "bigint",
    value: "12"
  });
  assert.equal(log.initialState.state.failure.message, "diagnostic failure");
  assert.equal(log.initialState.state.self.__riftboundDiagnosticType, "circular");
  assert.equal(log.metadata.refresh_token, undefined);
  assert.equal(serialized.includes("do-not-log"), false);
  assert.doesNotThrow(() => JSON.parse(serialized));
});

test("shares sanitized checkpoint state internally while snapshots remain detached", () => {
  const recorder = createGameReproductionLog({
    turn: 1,
    nested: { value: "original" }
  }, {
    logId: "shared-state-log",
    now: clock(),
    metadata: { clientVersion: "1.2.3" }
  });

  assert.strictEqual(recorder._data.initialState.state, recorder._data.latestState.state);
  assert.strictEqual(recorder._data.latestState.state, recorder._data.frames[0].state);

  const snapshot = recorder.snapshot();
  snapshot.initialState.state.nested.value = "changed-in-initial";
  snapshot.latestState.state.nested.value = "changed-in-latest";
  snapshot.frames[0].state.nested.value = "changed-in-frame";
  snapshot.metadata.clientVersion = "changed-in-metadata";

  const unchanged = recorder.snapshot();
  assert.equal(unchanged.initialState.state.nested.value, "original");
  assert.equal(unchanged.latestState.state.nested.value, "original");
  assert.equal(unchanged.frames[0].state.nested.value, "original");
  assert.equal(unchanged.metadata.clientVersion, "1.2.3");

  recorder.recordCommand({ kind: "pass" }, {
    status: "success",
    state: { turn: 2, nested: { value: "next" } }
  });
  assert.strictEqual(recorder._data.latestState.state, recorder._data.frames.at(-1).state);
  assert.notStrictEqual(recorder._data.initialState.state, recorder._data.latestState.state);
});

test("redacts credentials embedded in diagnostic strings, errors, and restored logs", () => {
  const jwt = "eyJabcdefghijk.abcdefghij.abcdefghij";
  const pemSecret = "PEM-PRIVATE-MATERIAL";
  const recorder = createGameReproductionLog({
    note: "Authorization: Bearer header-secret",
    url: "https://example.invalid/path?token=query-secret&safe=1",
    key: `-----BEGIN PRIVATE KEY-----\n${pemSecret}\n-----END PRIVATE KEY-----`,
    "Authorization: Bearer property-key-secret": true
  }, { now: clock() });
  recorder.recordEvent("credential-check", {
    message: `password=hunter2 Basic basic-secret ${jwt}`
  });
  recorder.recordUiError({
    name: "RemoteError",
    message: "access_token=message-secret",
    stack: "Error: failed Bearer stack-secret"
  }, { source: "test" });

  const serialized = recorder.serialize();
  for (const secret of [
    "header-secret", "query-secret", pemSecret, "hunter2", "basic-secret",
    jwt, "message-secret", "stack-secret", "property-key-secret"
  ]) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
  assert.match(serialized, /\[REDACTED\]/u);

  const restored = restoreGameReproductionLog(serialized).serialize();
  assert.equal(restored.includes("header-secret"), false);
  assert.equal(restored.includes("message-secret"), false);
});

test("state digests are stable across object key order and change with state", () => {
  assert.equal(digestGameState({ b: 2, a: 1 }), digestGameState({ a: 1, b: 2 }));
  assert.notEqual(digestGameState({ a: 1 }), digestGameState({ a: 2 }));
});

test("keeps capped full-state frames for operations that receive state", () => {
  const recorder = createGameReproductionLog({ turn: 0 }, {
    now: clock(),
    maxFrames: 3
  });
  recorder.recordCommand({ kind: "pass" }, { state: { turn: 1, generatedId: "time-1" } });
  recorder.markOnlineSnapshot({ revision: 2 }, { turn: 2, generatedId: "time-2" });
  recorder.checkpoint({ turn: 3, generatedId: "time-3" }, "manual-recovery");
  recorder.recordUiError(new Error("render failed"), {}, { turn: 4, generatedId: "time-4" });

  const log = recorder.snapshot();
  assert.equal(log.frames.length, 3);
  assert.equal(log.droppedFrames, 2);
  assert.deepEqual(log.frames.map((frame) => frame.sequence), [2, 3, 4]);
  assert.deepEqual(log.frames.map((frame) => frame.label), [
    "online-snapshot",
    "manual-recovery",
    "ui-error"
  ]);
  assert.equal(log.frames[2].state.generatedId, "time-4");
  assert.equal(log.frames[2].digest, digestGameState(log.frames[2].state));
  assert.equal(log.frames[2].commandSequence, 1);
});

test("checkpoint can skip cloning an unused return value without changing the recorded state", () => {
  const recorder = createGameReproductionLog({ turn: 0 }, { now: clock() });

  assert.equal(recorder.checkpoint({ turn: 1 }, "idle-command", { cloneResult: false }), null);
  const log = recorder.snapshot();
  assert.equal(log.latestState.label, "idle-command");
  assert.equal(log.latestState.state.turn, 1);
  assert.equal(log.latestState.digest, digestGameState({ turn: 1 }));
});

test("records success, rejection, and exception commands with one increasing sequence", () => {
  const recorder = createGameReproductionLog({ turn: 1 }, { now: clock() });
  recorder.recordCommand({ kind: "pass" }, {
    status: "success",
    result: { ok: true },
    state: { turn: 2 }
  });
  recorder.recordCommand({ kind: "play", cardId: "c1" }, {
    status: "rejected",
    reason: "not enough runes",
    state: { turn: 2 }
  });
  recorder.recordCommand({ kind: "attack" }, {
    status: "exception",
    error: new TypeError("UI bridge failed"),
    context: { phase: "combat" },
    state: { turn: 2, phase: "combat" }
  });

  const log = recorder.snapshot();
  assert.deepEqual(log.commands.map((entry) => entry.sequence), [1, 2, 3]);
  assert.deepEqual(log.commands.map((entry) => entry.status), ["success", "rejected", "exception"]);
  assert.equal(log.commands[1].reason, "not enough runes");
  assert.equal(log.commands[2].error.name, "TypeError");
  assert.equal(log.commands[2].error.message, "UI bridge failed");
  assert.equal(log.latestState.state.phase, "combat");
  assert.equal(log.commands[2].afterStateDigest, log.latestState.digest);
});

test("recordCommand checkpoints state once without enumerating the whole outcome", () => {
  let outcomeEnumerations = 0;
  let stateEnumerations = 0;
  let getterCalls = 0;
  const stateTarget = {
    turn: 2,
    authToken: "state-secret",
    nested: { value: "kept" }
  };
  Object.defineProperty(stateTarget, "throwingGetter", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("must not be invoked");
    }
  });
  const state = new Proxy(stateTarget, {
    ownKeys(target) {
      stateEnumerations += 1;
      return Reflect.ownKeys(target);
    }
  });
  const outcomeTarget = {
    status: "success",
    state,
    result: {
      ok: true,
      authToken: "result-secret",
      note: "Bearer result-bearer-secret"
    },
    context: {
      phase: "main",
      password: "context-secret"
    }
  };
  Object.defineProperty(outcomeTarget, "message", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("must not be invoked");
    }
  });
  Object.defineProperty(outcomeTarget, "unrelated", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "unrelated-secret";
    }
  });
  const outcome = new Proxy(outcomeTarget, {
    ownKeys(target) {
      outcomeEnumerations += 1;
      return Reflect.ownKeys(target);
    }
  });
  const recorder = createGameReproductionLog({ turn: 1 }, { now: clock() });

  recorder.recordCommand({ kind: "pass" }, outcome);

  const log = recorder.snapshot();
  const serialized = recorder.serialize();
  assert.equal(outcomeEnumerations, 0);
  assert.equal(stateEnumerations, 1);
  assert.equal(getterCalls, 0);
  assert.equal(log.latestState.state.nested.value, "kept");
  assert.equal(log.latestState.state.authToken, undefined);
  assert.equal(log.latestState.state.throwingGetter.__riftboundDiagnosticType, "accessor");
  assert.equal(log.commands[0].context.password, undefined);
  assert.equal(log.commands[0].result.authToken, undefined);
  assert.equal(serialized.includes("state-secret"), false);
  assert.equal(serialized.includes("result-secret"), false);
  assert.equal(serialized.includes("result-bearer-secret"), false);
  assert.equal(serialized.includes("context-secret"), false);
  assert.equal(serialized.includes("unrelated-secret"), false);
});

test("caps commands and bounds every untrusted command part while retaining sequence", () => {
  const recorder = createGameReproductionLog({ turn: 0 }, {
    now: clock(),
    maxCommands: 2,
    maxCommandPartBytes: 1024
  });
  const huge = "x".repeat(1024 * 1024);
  recorder.recordCommand({ kind: "invalid-one", padding: huge }, {
    status: "rejected",
    reason: huge,
    context: { padding: huge },
    state: { turn: 0 }
  });
  recorder.recordCommand({ kind: "invalid-two", padding: huge }, {
    status: "success",
    result: { padding: huge },
    state: { turn: 1 }
  });
  recorder.recordCommand({ kind: "invalid-three", padding: huge }, {
    status: "exception",
    error: { name: "Error", message: huge, stack: huge },
    state: { turn: 1 }
  });

  const log = recorder.snapshot();
  assert.deepEqual(log.commands.map((entry) => entry.sequence), [2, 3]);
  assert.equal(log.droppedCommands, 1);
  assert.equal(log.commands[0].command.kind, "invalid-two");
  assert.equal(log.commands[0].command.__riftboundDiagnosticType, "truncated-command-part");
  assert.equal(log.commands[0].result.__riftboundDiagnosticType, "truncated-command-part");
  assert.equal(log.commands[1].error.__riftboundDiagnosticType, "truncated-command-part");
  assert.equal(Buffer.byteLength(recorder.serialize()) < 100_000, true);

  const restored = restoreGameReproductionLog(recorder.serialize(), {
    now: clock(),
    maxCommands: 1,
    maxCommandPartBytes: 1024
  });
  assert.equal(restored.snapshot().droppedCommands, 2);
  restored.recordCommand({ kind: "after-restore" }, { state: { turn: 2 } });
  assert.deepEqual(restored.snapshot().commands.map((entry) => entry.sequence), [4]);
  assert.equal(restored.snapshot().droppedCommands, 3);

  const zeroCap = createGameReproductionLog({}, { now: clock(), maxCommands: 0 });
  zeroCap.recordCommand({ kind: "one" }, { state: {} });
  const zeroCapRestored = restoreGameReproductionLog(zeroCap.serialize(), {
    now: clock(),
    maxCommands: 0
  });
  const continued = zeroCapRestored.recordCommand({ kind: "two" }, { state: {} });
  assert.equal(continued.sequence, 2);
  assert.equal(zeroCapRestored.snapshot().lastCommandSequence, 2);
  assert.equal(zeroCapRestored.snapshot().droppedCommands, 2);
});

test("default event and Error budgets leave digest markers while state uses a larger budget", () => {
  const largeState = {
    cards: Array.from({ length: 3000 }, (_, index) => ({ id: `card-${index}` }))
  };
  const recorder = createGameReproductionLog(largeState, { now: clock() });
  const hugeStack = "stack-line\n".repeat(20_000);
  const error = new Error("render failed");
  error.stack = hugeStack;
  const hostile = {};
  Object.defineProperty(hostile, "throwingGetter", {
    enumerable: true,
    get() {
      throw new Error("must not be invoked");
    }
  });
  recorder.recordEvent("hostile-event", {
    values: Array.from({ length: 5000 }, (_, index) => index),
    message: "m".repeat(100_000),
    hostile
  });
  recorder.recordUiError(error, { component: "Battlefield" }, largeState);
  recorder.recordUiError({
    name: "PlainObjectError",
    message: "p".repeat(10 * 1024 * 1024),
    stack: "plain-stack\n".repeat(100_000)
  }, { component: "PlainObjectBoundary" }, largeState);

  const log = recorder.snapshot();
  assert.equal(log.initialState.state.cards.length, 3000, "normal game state must use the larger state budget");
  assert.equal(log.events[0].detail.values.length, 1001);
  const arrayMarker = log.events[0].detail.values.at(-1);
  assert.equal(arrayMarker.__riftboundDiagnosticType, "truncated-items");
  assert.equal(arrayMarker.originalLength, 5000);
  assert.match(arrayMarker.digest, /^js-v1:/u);
  assert.match(log.events[0].detail.message, /originalLength=100000 digest=js-v1:/u);
  assert.equal(
    log.events[0].detail.hostile.throwingGetter.__riftboundDiagnosticType,
    "accessor"
  );
  assert.match(log.ui.errors[0].error.stack, /originalLength=/u);
  assert.equal(log.ui.errors[1].error.name, "PlainObjectError");
  assert.match(log.ui.errors[1].error.message, /originalLength=10485760 digest=js-v1:/u);
  assert.match(log.ui.errors[1].error.stack, /originalLength=/u);
  assert.equal(Buffer.byteLength(recorder.serialize()) < 2 * 1024 * 1024, true);
});

test("default sanitizer bounds BigInt and RegExp string representations", () => {
  const hugeBigInt = BigInt("9".repeat(100_000));
  const hugeRegExp = new RegExp("x".repeat(100_000), "u");
  const sanitized = sanitizeDiagnosticValue({ hugeBigInt, hugeRegExp });

  assert.equal(sanitized.hugeBigInt.__riftboundDiagnosticType, "bigint");
  assert.match(sanitized.hugeBigInt.value, /originalLength=100000 digest=js-v1:/u);
  assert.equal(sanitized.hugeRegExp.__riftboundDiagnosticType, "regexp");
  assert.match(sanitized.hugeRegExp.value, /originalLength=100003 digest=js-v1:/u);
  assert.equal(Buffer.byteLength(JSON.stringify(sanitized)) < 100_000, true);
});

test("caps UI breadcrumbs and generic events while excluding entered text and values", () => {
  const recorder = createGameReproductionLog({}, {
    now: clock(),
    maxUiBreadcrumbs: 2,
    maxEvents: 2
  });
  recorder.recordUiBreadcrumb({ action: "input", target: { id: "report", value: "private" }, text: "private" });
  recorder.recordUiBreadcrumb({ action: "click", target: { id: "one", textContent: "private" } });
  recorder.recordUiBreadcrumb({ action: "click", target: { id: "two" } });
  recorder.recordEvent("network", { ordinal: 1 });
  recorder.recordEvent("network", { ordinal: 2 });
  recorder.recordEvent("network", { ordinal: 3 });

  const log = recorder.snapshot();
  assert.deepEqual(log.ui.breadcrumbs.map((entry) => entry.sequence), [2, 3]);
  assert.equal(log.ui.droppedBreadcrumbs, 1);
  assert.equal(JSON.stringify(log.ui.breadcrumbs).includes("private"), false);
  assert.deepEqual(log.events.map((entry) => entry.detail.ordinal), [2, 3]);
  assert.equal(log.droppedEvents, 1);
});

test("UI exceptions include context and an exact state checkpoint and can terminate a game", () => {
  const recorder = createGameReproductionLog({ screen: "match", turn: 3 }, { now: clock() });
  recorder.markOnlineSnapshot({ revision: 18, serverSequence: 44 }, { screen: "match", turn: 4 });
  recorder.recordUiError(
    new RangeError("render recursion"),
    { component: "Battlefield", value: "must not leak" },
    { screen: "broken", turn: 4 }
  );
  recorder.finalize("ui-error", { screen: "broken", turn: 4 }, { interrupted: true });

  const log = recorder.snapshot();
  assert.equal(log.onlineSnapshots[0].marker.revision, 18);
  assert.equal(log.ui.errors[0].error.name, "RangeError");
  assert.equal(log.ui.errors[0].context.component, "Battlefield");
  assert.equal(log.ui.errors[0].context.value, undefined);
  assert.equal(log.ui.errors[0].stateCheckpoint.state.screen, "broken");
  assert.equal(log.ui.errors[0].stateCheckpoint.digest, digestGameState({ screen: "broken", turn: 4 }));
  assert.equal(log.finalization.reason, "ui-error");
  assert.equal(log.finalization.stateDigest, log.latestState.digest);
});

test("isFinalized and summary avoid copying gameplay history and return detached data", () => {
  const recorder = createGameReproductionLog({ turn: 1 }, {
    logId: "summary-log",
    now: clock(),
    metadata: { clientVersion: "1.2.3" }
  });
  recorder.recordEvent("large-history-entry", {
    values: Array.from({ length: 500 }, (_, index) => index)
  });

  assert.equal(recorder.isFinalized(), false);
  const openSummary = recorder.summary();
  assert.deepEqual(Object.keys(openSummary).sort(), ["finalization", "logId", "metadata"]);
  assert.equal(openSummary.logId, "summary-log");
  assert.equal(openSummary.finalization, null);
  assert.equal("events" in openSummary, false);
  openSummary.metadata.clientVersion = "mutated";
  assert.equal(recorder.summary().metadata.clientVersion, "1.2.3");

  recorder.finalize("normal", { turn: 2 }, { winner: "player-one" });
  assert.equal(recorder.isFinalized(), true);
  const finalizedSummary = recorder.summary();
  finalizedSummary.finalization.details.winner = "mutated";
  assert.equal(recorder.summary().finalization.details.winner, "player-one");
});

test("instance serialization performs one JSON stringify and preserves the public format", () => {
  const recorder = createGameReproductionLog({
    turn: 1,
    cards: Array.from({ length: 100 }, (_, index) => ({ id: `card-${index}` }))
  }, { now: clock() });
  recorder.recordCommand({ kind: "pass" }, { state: { turn: 2 } });

  const originalStringify = JSON.stringify;
  for (const serialize of [
    () => recorder.serialize(),
    () => serializeGameReproductionLog(recorder)
  ]) {
    let stringifyCalls = 0;
    let serialized;
    JSON.stringify = function countedStringify(...args) {
      stringifyCalls += 1;
      return originalStringify.apply(this, args);
    };
    try {
      serialized = serialize();
    } finally {
      JSON.stringify = originalStringify;
    }
    assert.equal(stringifyCalls, 1);
    assert.deepEqual(JSON.parse(serialized), recorder.snapshot());
  }
});

test("description validation trims and counts Unicode code points", () => {
  const exactTenEmoji = "  😀😀😀😀😀😀😀😀😀😀  ";
  const valid = validateGameReportDescription(exactTenEmoji);
  assert.equal(valid.valid, true);
  assert.equal(valid.codePointLength, 10);
  assert.equal(valid.value, "😀😀😀😀😀😀😀😀😀😀");
  assert.equal(validateGameReportDescription("아홉글자미만").valid, false);
  assert.equal(validateGameReportDescription("가".repeat(2001)).code, "description_too_long");
  assert.match(GAME_REPRODUCTION_DESCRIPTION_PLACEHOLDER, /10자 이상/u);
});

test("submission payload requires a finalized game and a valid mandatory description", () => {
  const recorder = createGameReproductionLog({ turn: 1 }, { now: clock() });
  assert.throws(
    () => createGameLogSubmissionPayload(recorder, "충분히 자세하게 작성한 오류 설명입니다"),
    (error) => error instanceof GameReproductionLogError && error.code === "game_not_finalized"
  );
  recorder.finalize("surrender", { turn: 1 });
  assert.throws(
    () => createGameLogSubmissionPayload(recorder, "짧음"),
    (error) => error.code === "description_too_short"
  );

  const payload = createGameLogSubmissionPayload(
    recorder,
    "  항복 직전에 카드 선택 창이 닫히지 않았습니다.  ",
    { platform: "desktop", authToken: "hidden" }
  );
  assert.equal(payload.description, "항복 직전에 카드 선택 창이 닫히지 않았습니다.");
  assert.equal(payload.log.finalization.reason, "surrender");
  assert.equal(payload.metadata.platform, "desktop");
  assert.equal(payload.metadata.authToken, undefined);
});

test("localStorage-compatible helpers restore a recorder that continues command sequencing", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
  const recorder = createGameReproductionLog({ turn: 1 }, { now: clock() });
  recorder.recordCommand({ kind: "pass" }, { state: { turn: 2 } });
  const stored = saveGameReproductionLogToStorage(storage, "active-game", recorder);
  assert.deepEqual(deserializeGameReproductionLog(stored), JSON.parse(stored));
  const parsedInput = JSON.parse(stored);
  const detached = deserializeGameReproductionLog(parsedInput);
  detached.latestState.state.turn = 999;
  assert.equal(parsedInput.latestState.state.turn, 2);

  const restored = restoreGameReproductionLogFromStorage(storage, "active-game", { now: clock() });
  restored.recordCommand({ kind: "pass" }, { state: { turn: 3 } });
  assert.deepEqual(restored.snapshot().commands.map((entry) => entry.sequence), [1, 2]);
  assert.equal(restored.snapshot().latestState.state.turn, 3);
  assert.deepEqual(restored.snapshot().frames.map((frame) => frame.sequence), [0, 1, 2]);
  assert.equal(restoreGameReproductionLog(serializeGameReproductionLog(restored)).snapshot().commands.length, 2);
  assert.equal(restoreGameReproductionLogFromStorage(storage, "missing"), null);
});
