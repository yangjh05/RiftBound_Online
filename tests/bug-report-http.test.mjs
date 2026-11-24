import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BugReportStore } from "../server/bug-reports.mjs";
import { createBugReportRequestHandler } from "../server/http-bug-reports.mjs";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_TOKEN = "test-bug-report-admin-token";

test("anonymous bug report POST accepts exactly 10 characters and rejects 9", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-http-length-"));
  try {
    const store = new BugReportStore({
      rootDir: directory,
      adminToken: ADMIN_TOKEN,
      createId: () => REPORT_ID,
      now: () => new Date("2026-09-02T03:04:05.000Z")
    });
    const handler = createBugReportRequestHandler({
      store,
      accounts: unusedAccounts(),
      authoritativeLookup: () => null
    });

    const accepted = await invoke(handler, {
      method: "POST",
      url: "/api/bug-reports",
      body: validReportBody("가".repeat(10))
    });
    assert.equal(accepted.handled, true);
    assert.equal(accepted.status, 201);
    assert.deepEqual(accepted.payload, {
      ok: true,
      reportId: REPORT_ID,
      submittedAt: "2026-09-02T03:04:05.000Z"
    });
    assert.equal((await store.get(REPORT_ID)).description, "가".repeat(10));

    const rejected = await invoke(handler, {
      method: "POST",
      url: "/api/bug-reports",
      remoteAddress: "198.51.100.9",
      body: validReportBody("가".repeat(9))
    });
    assert.equal(rejected.handled, true);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.payload.ok, false);
    assert.equal(rejected.payload.code, "description_too_short");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("online submissions attach the authoritative trace without persisting the player token", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-http-authoritative-"));
  try {
    const store = new BugReportStore({
      rootDir: directory,
      adminToken: ADMIN_TOKEN,
      createId: () => REPORT_ID
    });
    const lookupCalls = [];
    const authoritativeLookup = (roomId, playerToken, gameNumber, diagnosticGameId) => {
      lookupCalls.push({ roomId, playerToken, gameNumber, diagnosticGameId });
      return {
        roomId,
        gameNumber,
        diagnosticGameId,
        playerId: "p2",
        log: {
          metadata: { mode: "online-authoritative" },
          commands: [{ command: { kind: "pass" }, status: "success" }],
          ui: {
            errors: [{
              error: {
                message: "authoritative failure Bearer authoritative-message-secret",
                stack: "at request (https://example.invalid/?api_key=authoritative-query-secret)"
              }
            }]
          }
        }
      };
    };
    const handler = createBugReportRequestHandler({
      store,
      accounts: unusedAccounts(),
      authoritativeLookup
    });
    const playerToken = "PRIVATE-SEAT-TOKEN";

    const response = await invoke(handler, {
      method: "POST",
      url: "/api/bug-reports",
      body: validReportBody("온라인 진행 중 화면이 멈췄습니다.", {
        onlineContext: {
          roomId: "ROOM42",
          playerToken,
          gameNumber: 2,
          diagnosticGameId: "ROOM42:7"
        },
        serverContext: { authoritative: "client-controlled-value" },
        log: {
          ui: { errors: [{ message: "render failed" }] },
          playerToken
        }
      })
    });

    assert.equal(response.status, 201);
    assert.deepEqual(lookupCalls, [{
      roomId: "ROOM42",
      playerToken,
      gameNumber: 2,
      diagnosticGameId: "ROOM42:7"
    }]);
    const stored = await store.get(REPORT_ID);
    assert.equal(stored.serverContext.authoritative.roomId, "ROOM42");
    assert.equal(stored.serverContext.authoritative.gameNumber, 2);
    assert.equal(stored.serverContext.authoritative.diagnosticGameId, "ROOM42:7");
    assert.equal(stored.serverContext.authoritative.log.commands[0].command.kind, "pass");
    assert.equal("onlineContext" in stored, false);
    assert.notEqual(stored.serverContext.authoritative, "client-controlled-value");
    assert.equal(JSON.stringify(stored).includes(playerToken), false);
    assert.equal(JSON.stringify(stored).includes("authoritative-message-secret"), false);
    assert.equal(JSON.stringify(stored).includes("authoritative-query-secret"), false);
    assert.match(JSON.stringify(stored.serverContext.authoritative), /\[REDACTED\]/u);
    assert.equal(JSON.stringify(response.payload).includes(playerToken), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("anonymous submissions reject JSON that is not a finalized reproduction log", async () => {
  const handler = createBugReportRequestHandler({
    store: acceptingStore(),
    accounts: unusedAccounts(),
    authoritativeLookup: () => null
  });
  const invalidBodies = [
    { description: "설명만 있고 재현 로그가 없습니다." },
    { schemaVersion: 1, description: "완료 정보가 없는 재현 로그입니다.", log: { schemaVersion: 1, initialState: {}, latestState: {} } },
    validReportBody("지원하지 않는 종료 사유가 있습니다.", { log: { finalization: { reason: "aborted" } } })
  ];
  for (const [index, body] of invalidBodies.entries()) {
    const response = await invoke(handler, {
      method: "POST",
      url: "/api/bug-reports",
      remoteAddress: `198.51.100.${20 + index}`,
      body
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, "invalid_game_log");
  }
});

test("rate limiting ignores forwarded addresses unless a loopback proxy is explicitly trusted", async () => {
  const directHandler = createBugReportRequestHandler({
    store: acceptingStore(),
    accounts: unusedAccounts(),
    authoritativeLookup: () => null
  });
  for (let index = 0; index < 10; index += 1) {
    const response = await invoke(directHandler, {
      method: "POST",
      url: "/api/bug-reports",
      remoteAddress: "198.51.100.50",
      headers: { "x-forwarded-for": `203.0.113.${index}` },
      body: validReportBody(`전달 주소 무시 여부를 확인하는 오류 ${index}입니다.`)
    });
    assert.equal(response.status, 201);
  }
  const limited = await invoke(directHandler, {
    method: "POST",
    url: "/api/bug-reports",
    remoteAddress: "198.51.100.50",
    headers: { "x-forwarded-for": "203.0.113.250" },
    body: validReportBody("전달 주소를 바꿔도 제한되는 오류입니다.")
  });
  assert.equal(limited.status, 429);

  const proxiedHandler = createBugReportRequestHandler({
    store: acceptingStore(),
    accounts: unusedAccounts(),
    authoritativeLookup: () => null,
    trustProxy: true,
    rateLimitMaxEntries: 3
  });
  for (let index = 0; index < 12; index += 1) {
    const response = await invoke(proxiedHandler, {
      method: "POST",
      url: "/api/bug-reports",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": `198.51.100.${index}` },
      body: validReportBody(`제한 맵 상한을 확인하는 오류 ${index}입니다.`)
    });
    assert.equal(response.status, 201);
  }
  const overflowLimited = await invoke(proxiedHandler, {
    method: "POST",
    url: "/api/bug-reports",
    remoteAddress: "127.0.0.1",
    headers: { "x-forwarded-for": "198.51.100.250" },
    body: validReportBody("제한 맵이 더 커지지 않는 오류입니다.")
  });
  assert.equal(overflowLimited.status, 429);
});

test("administrator list and detail routes require the configured bearer token", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-http-admin-"));
  try {
    const store = new BugReportStore({
      rootDir: directory,
      adminToken: ADMIN_TOKEN,
      createId: () => REPORT_ID,
      now: () => new Date("2026-09-02T06:07:08.000Z")
    });
    await store.submit({
      description: "관리자가 확인할 수 있는 오류입니다.",
      log: { commands: [{ kind: "pass" }] }
    });
    const handler = createBugReportRequestHandler({
      store,
      accounts: unusedAccounts(),
      authoritativeLookup: () => null
    });

    const unauthorized = await invoke(handler, {
      method: "GET",
      url: "/api/admin/bug-reports"
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.payload.code, "invalid_admin_token");

    const list = await invoke(handler, {
      method: "GET",
      url: "/api/admin/bug-reports?limit=1",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    assert.equal(list.status, 200);
    assert.deepEqual(list.payload.reports, [{
      id: REPORT_ID,
      submittedAt: "2026-09-02T06:07:08.000Z",
      description: "관리자가 확인할 수 있는 오류입니다."
    }]);

    const detail = await invoke(handler, {
      method: "GET",
      url: `/api/admin/bug-reports/${REPORT_ID}`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.payload.report.id, REPORT_ID);
    assert.deepEqual(detail.payload.report.log.commands, [{ kind: "pass" }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function invoke(handler, options) {
  const response = {};
  const request = {
    method: options.method,
    url: options.url,
    headers: options.headers || {},
    socket: { remoteAddress: options.remoteAddress || "198.51.100.1" },
    body: options.body
  };
  const helpers = {
    async readJson(req, maximumBytes) {
      assert.equal(maximumBytes, 12 * 1024 * 1024);
      return structuredClone(req.body || {});
    },
    json(res, status, payload) {
      res.status = status;
      res.payload = payload;
      return true;
    }
  };
  const handled = await handler(request, response, helpers);
  return { handled, status: response.status, payload: response.payload };
}

function unusedAccounts() {
  return {
    async account() {
      throw new Error("anonymous submissions must not resolve an account");
    }
  };
}

function validReportBody(description, overrides = {}) {
  const { log: logOverrides = {}, ...rest } = overrides;
  return {
    schemaVersion: 1,
    description,
    ...rest,
    log: {
      schemaVersion: 1,
      initialState: { state: {} },
      latestState: { state: {} },
      finalization: { reason: "normal" },
      ...logOverrides
    }
  };
}

function acceptingStore() {
  return {
    async submit() {
      return { id: REPORT_ID, submittedAt: "2026-09-02T00:00:00.000Z" };
    },
    requireAdmin() {
      return true;
    }
  };
}
