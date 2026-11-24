import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/crash-guard.js", import.meta.url), "utf8");
const LOG_KEY = "riftbound.gameDiagnostic.v1";
const ONLINE_KEY = "riftbound.onlineSeat.v1";
const AUTH_KEY = "riftbound.accountSession.v1";
const SUBMITTED_AT = "2026-09-02T01:02:03.000Z";

class FakeElement {
  constructor() {
    this.disabled = false;
    this.hidden = false;
    this.style = {};
    this.textContent = "";
    this.value = "";
    this.listeners = new Map();
    this.queries = new Map();
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute() {}

  querySelector(selector) {
    if (!this.queries.has(selector)) {
      const element = new FakeElement();
      if (selector === "[data-crash-stop-actions]") element.hidden = true;
      this.queries.set(selector, element);
    }
    return this.queries.get(selector);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, { force = true } = {}) {
    if (!force && this.disabled) return;
    for (const listener of this.listeners.get(type) || []) {
      await listener({ target: this });
    }
  }
}

class FakeStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
    this.throwOnSet = false;
    this.throwOnRemove = false;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.throwOnSet) throw new Error("storage set failed");
    this.values.set(key, String(value));
  }

  removeItem(key) {
    if (this.throwOnRemove) throw new Error("storage remove failed");
    this.values.delete(key);
  }
}

function createTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    delays() {
      return [...pending.values()].map((entry) => entry.delay);
    },
    fire(delay) {
      const match = [...pending.entries()].find(([, entry]) => entry.delay === delay);
      assert.ok(match, `expected an active ${delay}ms timer`);
      pending.delete(match[0]);
      match[1].callback();
    }
  };
}

function jsonResponse(result, { status = 200, jsonError = null, jsonPending = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json() {
      if (jsonPending) return new Promise(() => {});
      if (jsonError) return Promise.reject(jsonError);
      return Promise.resolve(result);
    }
  };
}

function gameLog(metadata = { mode: "local" }) {
  return {
    schemaVersion: 1,
    logId: "crash-log-1",
    metadata,
    initialState: { digest: "js-v1:initial", state: { turn: 1 } },
    latestState: { digest: "js-v1:latest", state: { turn: 2 } },
    commands: [],
    lastCommandSequence: 0,
    ui: { errors: [] },
    finalization: null
  };
}

function installGuard({ fetch, storage = new FakeStorage() }) {
  const timers = createTimers();
  const body = {
    children: [],
    appendChild(element) {
      this.children.push(element);
    }
  };
  const document = {
    body,
    createElement() {
      return new FakeElement();
    }
  };
  const windowListeners = new Map();
  const window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    }
  };
  const location = { reloadCalls: 0, reload() { this.reloadCalls += 1; } };
  const context = vm.createContext({
    AbortController,
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    String,
    WeakSet,
    console,
    document,
    encodeURIComponent,
    fetch,
    localStorage: storage,
    location,
    navigator: { userAgent: "crash-guard-node-test" },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    window
  });
  vm.runInContext(source, context, { filename: "src/crash-guard.js" });
  return {
    guard: window.__riftboundEarlyCrashGuard,
    overlay() { return body.children.at(-1); },
    storage,
    timers,
    location
  };
}

async function settle(turns = 12) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

async function prepareDescription(overlay, value = "재현 가능한 부트스트랩 오류 설명입니다.") {
  const description = overlay.querySelector("#early-crash-description");
  description.value = value;
  await description.dispatch("input");
  return description;
}

test("bootstrap report aborts after 15 seconds, locks duplicate decisions, and remains retryable", async () => {
  const storage = new FakeStorage({ [LOG_KEY]: JSON.stringify(gameLog()) });
  let reportCalls = 0;
  let pendingSignal = null;
  const harness = installGuard({
    storage,
    fetch(url, options = {}) {
      if (url === "/build-info.json") {
        return Promise.resolve(jsonResponse({ bugReportBaseUrl: "https://reports.example" }));
      }
      assert.equal(url, "https://reports.example/api/bug-reports");
      reportCalls += 1;
      if (reportCalls === 1) {
        pendingSignal = options.signal;
        return new Promise(() => {});
      }
      return Promise.resolve(jsonResponse({
        ok: true,
        reportId: "11111111-1111-4111-8111-111111111111",
        submittedAt: SUBMITTED_AT
      }, { status: 201 }));
    }
  });

  harness.guard.show(new Error("bootstrap failed"), true);
  const overlay = harness.overlay();
  const description = await prepareDescription(overlay);
  const submit = overlay.querySelector("[data-crash-submit]");
  const decline = overlay.querySelector("[data-crash-decline]");
  const reload = overlay.querySelector("[data-crash-reload]");
  const status = overlay.querySelector("[data-crash-status]");
  assert.equal(submit.disabled, false);

  const firstSubmission = submit.dispatch("click");
  await settle(50);
  assert.equal(reportCalls, 1);
  assert.equal(submit.disabled, true);
  assert.equal(description.disabled, true);
  assert.equal(decline.disabled, true);
  assert.equal(reload.disabled, true);
  await submit.dispatch("click");
  await decline.dispatch("click");
  assert.equal(reportCalls, 1, "duplicate clicks must not create another POST");
  assert.ok(storage.getItem(LOG_KEY), "the log must remain while the request is pending");

  assert.deepEqual(harness.timers.delays(), [15000]);
  harness.timers.fire(15000);
  await firstSubmission;
  assert.equal(pendingSignal.aborted, true);
  assert.match(status.textContent, /15초/u);
  assert.match(status.textContent, /다시 시도/u);
  assert.equal(description.value, "재현 가능한 부트스트랩 오류 설명입니다.");
  assert.equal(description.disabled, false);
  assert.equal(submit.disabled, false);
  assert.equal(decline.disabled, false);
  assert.ok(storage.getItem(LOG_KEY));

  await submit.dispatch("click");
  assert.equal(reportCalls, 2);
  assert.match(status.textContent, /로그를 전송했습니다/u);
  assert.equal(storage.getItem(LOG_KEY), null);
});

test("invalid and incomplete JSON success responses never delete the preserved log", async () => {
  const storage = new FakeStorage({ [LOG_KEY]: JSON.stringify(gameLog()) });
  const responses = [
    jsonResponse(null, { status: 201, jsonError: new SyntaxError("invalid JSON") }),
    jsonResponse({}, { status: 201 }),
    jsonResponse([], { status: 201 }),
    jsonResponse({ ok: true, reportId: "22222222-2222-4222-8222-222222222222" }, { status: 201 }),
    jsonResponse({ ok: true, reportId: "not-a-uuid", submittedAt: SUBMITTED_AT }, { status: 201 }),
    jsonResponse({ ok: true, reportId: "22222222-2222-4222-8222-222222222222", submittedAt: "2026-09-02" }, { status: 201 }),
    jsonResponse({
      ok: true,
      reportId: "22222222-2222-4222-8222-222222222222",
      submittedAt: SUBMITTED_AT
    }, { status: 201 })
  ];
  const invalidResponseCount = responses.length - 1;
  const harness = installGuard({
    storage,
    fetch(url) {
      if (url === "/build-info.json") return Promise.resolve(jsonResponse({}));
      return Promise.resolve(responses.shift());
    }
  });

  harness.guard.show(new Error("bootstrap failed"), true);
  const overlay = harness.overlay();
  await prepareDescription(overlay);
  const submit = overlay.querySelector("[data-crash-submit]");
  const status = overlay.querySelector("[data-crash-status]");

  for (let attempt = 0; attempt < invalidResponseCount; attempt += 1) {
    await submit.dispatch("click");
    assert.match(status.textContent, /전송하지 못했습니다/u);
    assert.equal(submit.disabled, false);
    assert.ok(storage.getItem(LOG_KEY));
  }
  await submit.dispatch("click");
  assert.match(status.textContent, /로그를 전송했습니다/u);
  assert.equal(storage.getItem(LOG_KEY), null);
});

test("online bootstrap stop timeout exposes retry controls and permits one retry", async () => {
  const metadata = {
    mode: "online",
    roomId: "ROOM42",
    gameNumber: 1,
    diagnosticGameId: "ROOM42:7"
  };
  const storage = new FakeStorage({
    [LOG_KEY]: JSON.stringify(gameLog(metadata)),
    [ONLINE_KEY]: JSON.stringify({
      roomId: "ROOM42",
      playerToken: "seat-secret",
      gameNumber: 1,
      diagnosticGameId: "ROOM42:7"
    })
  });
  let stopCalls = 0;
  let pendingSignal = null;
  const stopBodies = [];
  const harness = installGuard({
    storage,
    fetch(url, options = {}) {
      if (url === "/build-info.json") {
        return Promise.resolve(jsonResponse({ multiplayerBaseUrl: "https://game.example" }));
      }
      assert.equal(url, "https://game.example/api/rooms/ROOM42/commands");
      stopCalls += 1;
      stopBodies.push(JSON.parse(options.body));
      if (stopCalls === 1) {
        pendingSignal = options.signal;
        return Promise.resolve(jsonResponse(null, { jsonPending: true }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    }
  });

  harness.guard.show(new Error("online bootstrap failed"), true);
  const overlay = harness.overlay();
  await settle();
  const retry = overlay.querySelector("[data-crash-stop-retry]");
  const preserve = overlay.querySelector("[data-crash-preserve-local]");
  const stopActions = overlay.querySelector("[data-crash-stop-actions]");
  const title = overlay.querySelector("[data-crash-title]");
  await retry.dispatch("click");
  assert.equal(stopCalls, 1, "a forced duplicate retry must be ignored while stopping");

  assert.deepEqual(harness.timers.delays(), [15000]);
  harness.timers.fire(15000);
  await settle();
  assert.equal(pendingSignal.aborted, true);
  assert.match(title.textContent, /중단을 확인하지 못했습니다/u);
  assert.equal(stopActions.hidden, false);
  assert.equal(retry.disabled, false);
  assert.equal(preserve.disabled, false);

  storage.setItem(ONLINE_KEY, JSON.stringify({
    roomId: "NEWROOM",
    playerToken: "replacement-secret",
    gameNumber: 2,
    diagnosticGameId: "NEWROOM:9"
  }));
  await retry.dispatch("click");
  await settle();
  assert.equal(stopCalls, 2);
  assert.deepEqual(stopBodies, [0, 1].map(() => ({
    playerToken: "seat-secret",
    command: {
      kind: "surrender",
      expectedDiagnosticGameId: "ROOM42:7",
      expectedGameNumber: 1
    }
  })));
  assert.match(title.textContent, /서버 경기를 중단했습니다/u);
  assert.equal(overlay.querySelector("[data-crash-reload]").disabled, false);
});

test("automatic online stop requires an exact trusted diagnostic identity", async (context) => {
  const cases = [
    {
      name: "exact diagnosticGameId",
      logIdentity: { gameNumber: 1, diagnosticGameId: "ROOM42:7" },
      seatIdentity: { gameNumber: 1, diagnosticGameId: "ROOM42:7" },
      stops: true
    },
    {
      name: "different diagnosticGameId in the same room",
      logIdentity: { gameNumber: 1, diagnosticGameId: "ROOM42:7" },
      seatIdentity: { gameNumber: 1, diagnosticGameId: "ROOM42:8" },
      stops: false
    },
    {
      name: "same diagnosticGameId with a different gameNumber",
      logIdentity: { gameNumber: 1, diagnosticGameId: "ROOM42:7" },
      seatIdentity: { gameNumber: 2, diagnosticGameId: "ROOM42:7" },
      stops: false
    },
    {
      name: "seat diagnosticGameId cannot fall back to gameNumber",
      logIdentity: { gameNumber: 1 },
      seatIdentity: { gameNumber: 1, diagnosticGameId: "ROOM42:8" },
      stops: false
    },
    {
      name: "legacy seat with an exact positive gameNumber",
      logIdentity: { gameNumber: 3 },
      seatIdentity: { gameNumber: 3 },
      stops: false
    },
    {
      name: "legacy seat with a different gameNumber",
      logIdentity: { gameNumber: 2 },
      seatIdentity: { gameNumber: 3 },
      stops: false
    },
    {
      name: "legacy seat without a gameNumber",
      logIdentity: { gameNumber: 2 },
      seatIdentity: {},
      stops: false
    },
    {
      name: "recovered log without a gameNumber",
      logIdentity: {},
      seatIdentity: { gameNumber: 1 },
      stops: false
    }
  ];

  for (const item of cases) {
    await context.test(item.name, async () => {
      const metadata = { mode: "online", roomId: "ROOM42", ...item.logIdentity };
      const storage = new FakeStorage({
        [LOG_KEY]: JSON.stringify(gameLog(metadata)),
        [ONLINE_KEY]: JSON.stringify({
          roomId: "ROOM42",
          playerToken: "seat-secret",
          ...item.seatIdentity
        })
      });
      let stopCalls = 0;
      const harness = installGuard({
        storage,
        fetch(url) {
          if (url === "/build-info.json") {
            return Promise.resolve(jsonResponse({ multiplayerBaseUrl: "https://game.example" }));
          }
          assert.equal(url, "https://game.example/api/rooms/ROOM42/commands");
          stopCalls += 1;
          return Promise.resolve(jsonResponse({ ok: true }));
        }
      });

      harness.guard.show(new Error("online bootstrap failed"), true);
      await settle(50);
      assert.equal(stopCalls, item.stops ? 1 : 0);
      if (!item.stops) {
        assert.match(harness.overlay().innerHTML, /자동 항복을 요청하지 않았습니다/u);
        await prepareDescription(harness.overlay());
        assert.equal(
          harness.overlay().querySelector("[data-crash-submit]").disabled,
          false,
          "identity mismatch must not block the report decision"
        );
      }
    });
  }
});

test("a stale recovered log can be reported without surrendering the newer same-room game", async () => {
  const metadata = {
    mode: "online",
    roomId: "ROOM42",
    gameNumber: 1,
    diagnosticGameId: "ROOM42:7"
  };
  const storage = new FakeStorage({
    [LOG_KEY]: JSON.stringify(gameLog(metadata)),
    [ONLINE_KEY]: JSON.stringify({
      roomId: "ROOM42",
      playerToken: "seat-secret",
      gameNumber: 2,
      diagnosticGameId: "ROOM42:8"
    })
  });
  let stopCalls = 0;
  let reportPayload = null;
  const harness = installGuard({
    storage,
    fetch(url, options = {}) {
      if (url === "/build-info.json") {
        return Promise.resolve(jsonResponse({
          multiplayerBaseUrl: "https://game.example",
          bugReportBaseUrl: "https://reports.example"
        }));
      }
      if (url.includes("/commands")) {
        stopCalls += 1;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      assert.equal(url, "https://reports.example/api/bug-reports");
      reportPayload = JSON.parse(options.body);
      return Promise.resolve(jsonResponse({
        ok: true,
        reportId: "55555555-5555-4555-8555-555555555555",
        submittedAt: SUBMITTED_AT
      }, { status: 201 }));
    }
  });

  harness.guard.show(new Error("stale bootstrap failure"), true);
  await settle(30);
  assert.equal(stopCalls, 0);
  await prepareDescription(harness.overlay());
  await harness.overlay().querySelector("[data-crash-submit]").dispatch("click");
  assert.equal(stopCalls, 0);
  assert.equal(reportPayload.onlineContext.diagnosticGameId, "ROOM42:7");
  assert.equal(reportPayload.onlineContext.gameNumber, 1);
});

test("an identity-less legacy log remains reportable without unsafe authoritative lookup", async () => {
  const storage = new FakeStorage({
    [LOG_KEY]: JSON.stringify(gameLog({ mode: "online", roomId: "ROOM42" })),
    [ONLINE_KEY]: JSON.stringify({ roomId: "ROOM42", playerToken: "seat-secret" })
  });
  let stopCalls = 0;
  let reportPayload = null;
  const harness = installGuard({
    storage,
    fetch(url, options = {}) {
      if (url === "/build-info.json") return Promise.resolve(jsonResponse({}));
      if (url.includes("/commands")) {
        stopCalls += 1;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      reportPayload = JSON.parse(options.body);
      return Promise.resolve(jsonResponse({
        ok: true,
        reportId: "66666666-6666-4666-8666-666666666666",
        submittedAt: SUBMITTED_AT
      }, { status: 201 }));
    }
  });

  harness.guard.show(new Error("legacy bootstrap failure"), true);
  await settle(30);
  assert.equal(stopCalls, 0);
  assert.match(harness.overlay().innerHTML, /자동 항복을 요청하지 않았습니다/u);
  await prepareDescription(harness.overlay());
  await harness.overlay().querySelector("[data-crash-submit]").dispatch("click");
  assert.equal("onlineContext" in reportPayload, false);
});

test("bootstrap errors and recovered logs redact credentials outside required request auth", async () => {
  const log = gameLog();
  log.metadata.sessionCookie = "cookie-secret";
  log.metadata.authorizationHeader = "Bearer header-secret";
  log.metadata.jwt = "eyJabcdefghijk.abcdefghij.abcdefghij";
  log.ui.errors.push({
    error: { message: "password=hunter2 token=old-token Bearer loose-secret" }
  });
  const storage = new FakeStorage({
    [LOG_KEY]: JSON.stringify(log),
    [AUTH_KEY]: JSON.stringify({ token: "account-secret" })
  });
  let reportRequest = null;
  const harness = installGuard({
    storage,
    fetch(url, options = {}) {
      if (url === "/build-info.json") return Promise.resolve(jsonResponse({}));
      reportRequest = { options, payload: JSON.parse(options.body) };
      return Promise.resolve(jsonResponse({
        ok: true,
        reportId: "33333333-3333-4333-8333-333333333333",
        submittedAt: SUBMITTED_AT
      }, { status: 201 }));
    }
  });

  harness.guard.show({
    name: "BootstrapError",
    message: "authorization=Bearer bootstrap-secret playerToken=seat-secret",
    stack: "password=stack-secret"
  }, true);
  const overlay = harness.overlay();
  const detail = overlay.querySelector("[data-crash-detail]").textContent;
  const stored = storage.getItem(LOG_KEY);
  for (const secret of [
    "cookie-secret", "header-secret", "abcdefghijk.abcdefghij",
    "hunter2", "old-token", "loose-secret", "bootstrap-secret",
    "seat-secret", "stack-secret"
  ]) {
    assert.equal(detail.includes(secret), false);
    assert.equal(stored.includes(secret), false);
  }
  assert.match(stored, /\[REDACTED\]/u);

  await prepareDescription(overlay);
  await overlay.querySelector("[data-crash-submit]").dispatch("click");
  assert.equal(reportRequest.options.headers.authorization, "Bearer account-secret");
  const outboundBody = JSON.stringify(reportRequest.payload);
  assert.equal(outboundBody.includes("account-secret"), false);
  assert.equal(outboundBody.includes("bootstrap-secret"), false);
  assert.equal(outboundBody.includes("stack-secret"), false);
});

test("storage failures never become false report failures or false preservation claims", async () => {
  const storage = new FakeStorage({ [LOG_KEY]: JSON.stringify(gameLog()) });
  storage.throwOnSet = true;
  let reportCalls = 0;
  const harness = installGuard({
    storage,
    fetch(url) {
      if (url === "/build-info.json") return Promise.resolve(jsonResponse({}));
      reportCalls += 1;
      return Promise.resolve(jsonResponse({
        ok: true,
        reportId: "44444444-4444-4444-8444-444444444444",
        submittedAt: SUBMITTED_AT
      }, { status: 201 }));
    }
  });

  harness.guard.show(new Error("bootstrap failed"), true);
  const overlay = harness.overlay();
  assert.match(overlay.innerHTML, /로컬 저장소에 갱신하지 못했습니다/u);
  storage.throwOnSet = false;
  storage.throwOnRemove = true;
  await prepareDescription(overlay);
  const submit = overlay.querySelector("[data-crash-submit]");
  const status = overlay.querySelector("[data-crash-status]");
  await submit.dispatch("click");
  assert.equal(reportCalls, 1);
  assert.match(status.textContent, /접수는 완료되었지만 로컬 사본을 삭제하지 못했습니다/u);
  assert.equal(submit.disabled, true);
  await submit.dispatch("click");
  assert.equal(reportCalls, 1, "an accepted report must not be retried after local cleanup fails");
});

test("a failed decline cleanup stays retryable without crashing the guard", async () => {
  const storage = new FakeStorage({ [LOG_KEY]: JSON.stringify(gameLog()) });
  const harness = installGuard({
    storage,
    fetch(url) {
      if (url === "/build-info.json") return Promise.resolve(jsonResponse({}));
      throw new Error(`unexpected request: ${url}`);
    }
  });
  harness.guard.show(new Error("bootstrap failed"), true);
  const overlay = harness.overlay();
  await prepareDescription(overlay);
  storage.throwOnRemove = true;
  const decline = overlay.querySelector("[data-crash-decline]");
  await decline.dispatch("click");
  assert.match(overlay.querySelector("[data-crash-status]").textContent, /삭제하지 못했습니다/u);
  assert.equal(decline.disabled, false);
  assert.ok(storage.getItem(LOG_KEY));
});
