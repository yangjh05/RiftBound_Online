import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BugReportError,
  BugReportStore,
  getBugReport,
  requireBugReportAdminToken,
  submitBugReport,
  verifyBugReportAdminToken
} from "../server/bug-reports.mjs";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ID = "33333333-3333-4333-8333-333333333333";

test("bug reports trim and validate descriptions by Unicode character count", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-description-"));
  try {
    const store = new BugReportStore({ rootDir: directory });
    await assert.rejects(
      store.submit({ description: "  123456789  ", capture: {} }),
      (error) => error instanceof BugReportError
        && error.status === 400
        && error.code === "description_too_short"
    );
    await assert.rejects(
      store.submit({ description: "가".repeat(2001), capture: {} }),
      (error) => error instanceof BugReportError && error.code === "description_too_long"
    );

    const accepted = await new BugReportStore({
      rootDir: directory,
      createId: () => FIRST_ID,
      now: () => new Date("2026-09-02T01:02:03.000Z")
    }).submit({ description: "  오류가 발생했습니다!  ", capture: {} });
    assert.equal(accepted.description, "오류가 발생했습니다!");
    assert.equal(accepted.id, FIRST_ID);
    assert.equal(accepted.submittedAt, "2026-09-02T01:02:03.000Z");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bug reports accept only structured JSON objects and enforce the complete byte limit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-json-"));
  try {
    const store = new BugReportStore({ rootDir: directory, maxJsonBytes: 300 });
    await assert.rejects(
      store.submit("not an object"),
      (error) => error instanceof BugReportError && error.code === "invalid_description"
    );
    await assert.rejects(
      store.submit({ description: "충분히 자세한 버그 설명입니다.", capture: { value: Number.NaN } }),
      (error) => error instanceof BugReportError && error.code === "invalid_report_payload"
    );
    const circular = { description: "충분히 자세한 버그 설명입니다." };
    circular.capture = circular;
    await assert.rejects(
      store.submit(circular),
      (error) => error instanceof BugReportError && error.code === "invalid_report_payload"
    );
    await assert.rejects(
      store.submit({ description: "충분히 자세한 버그 설명입니다.", capture: { log: "x".repeat(400) } }),
      (error) => error instanceof BugReportError && error.status === 413 && error.code === "report_too_large"
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bug reports recursively remove credential-like keys before atomic 0600 storage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-redaction-"));
  try {
    const report = await new BugReportStore({
      rootDir: directory,
      createId: () => FIRST_ID
    }).submit({
      id: "client-controlled-id",
      submittedAt: "1999-01-01T00:00:00.000Z",
      description: "  UI 오류 뒤 진행이 멈췄습니다.  ",
      accessToken: "top-secret-token",
      refreshToken: "top-secret-refresh-token",
      clientSecret: "top-secret-client-secret",
      signingSecret: "top-secret-signing-secret",
      privateKey: "top-secret-private-key",
      adminToken: "top-secret-admin-token",
      jwt: "top-secret-jwt",
      capture: {
        events: [{
          type: "click",
          password: "top-secret-password",
          passphraseHint: "top-secret-passphrase-hint",
          playerToken: "top-secret-player-token",
          tokenKind: "might",
          tokenId: "game-token-42",
          tokenOwnerId: "p1",
          safe: true
        }],
        request: {
          authorizationHeader: "Bearer top-secret-header",
          sessionCookie: "top-secret-cookie",
          headers: { Authorization: "Bearer top-secret-token", locale: "ko-KR" }
        }
      }
    });

    assert.equal(report.id, FIRST_ID);
    assert.notEqual(report.submittedAt, "1999-01-01T00:00:00.000Z");
    assert.equal("accessToken" in report, false);
    assert.equal("refreshToken" in report, false);
    assert.equal("clientSecret" in report, false);
    assert.equal("signingSecret" in report, false);
    assert.equal("privateKey" in report, false);
    assert.equal("adminToken" in report, false);
    assert.equal("jwt" in report, false);
    assert.equal("password" in report.capture.events[0], false);
    assert.equal("passphraseHint" in report.capture.events[0], false);
    assert.equal("playerToken" in report.capture.events[0], false);
    assert.equal("Authorization" in report.capture.request.headers, false);
    assert.equal("authorizationHeader" in report.capture.request, false);
    assert.equal("sessionCookie" in report.capture.request, false);
    assert.equal(report.capture.events[0].tokenKind, "might");
    assert.equal(report.capture.events[0].tokenId, "game-token-42");
    assert.equal(report.capture.events[0].tokenOwnerId, "p1");
    assert.equal(report.capture.events[0].safe, true);
    assert.equal(report.capture.request.headers.locale, "ko-KR");

    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.match(files[0], new RegExp(`^\\d{8}T\\d{9}Z-${FIRST_ID}\\.json$`, "u"));
    const filePath = path.join(directory, files[0]);
    const serialized = await readFile(filePath, "utf8");
    assert.equal(serialized.includes("top-secret"), false);
    if (process.platform !== "win32") {
      assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bug reports redact credentials embedded in descriptions, error messages, stacks, URLs, and PEM blocks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-text-redaction-"));
  const jwt = "eyJabcdefghijk.abcdefghij.abcdefghij";
  const secrets = [
    "description-bearer-secret",
    "authorization-secret",
    "basic-user-password",
    "query-token-secret",
    "assignment-secret",
    "password-secret",
    "pem-private-material",
    "abcdefghijk"
  ];
  try {
    const report = await new BugReportStore({
      rootDir: directory,
      createId: () => FIRST_ID
    }).submit({
      description: "화면 오류 Bearer description-bearer-secret 재현 설명입니다.",
      log: {
        ui: {
          errors: [{
            error: {
              message: "Authorization: Bearer authorization-secret credentials=assignment-secret password=password-secret",
              stack: [
                "Error: Basic basic-user-password",
                "at request (https://example.invalid/play?token=query-token-secret&safe=1)",
                "-----BEGIN RSA PRIVATE KEY-----",
                "pem-private-material",
                "-----END RSA PRIVATE KEY-----"
              ].join("\n"),
              safeMessage: "render failed while opening the result screen"
            }
          }]
        },
        jwtText: `standalone JWT ${jwt}`
      }
    });

    const serializedReport = JSON.stringify(report);
    for (const secret of secrets) assert.equal(serializedReport.includes(secret), false, secret);
    assert.equal(report.log.ui.errors[0].error.safeMessage, "render failed while opening the result screen");
    assert.equal((serializedReport.match(/\[REDACTED\]/gu) || []).length >= 7, true);

    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const storedText = await readFile(path.join(directory, files[0]), "utf8");
    for (const secret of secrets) assert.equal(storedText.includes(secret), false, secret);
    assert.match(storedText, /\[REDACTED\]/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bug reports redact, bound, and safely de-duplicate attacker-controlled object key names", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-key-redaction-"));
  const longKey = `url?token=long-key-token ${"x".repeat(2000)}`;
  const secrets = [
    "first-key-credential",
    "second-key-credential",
    "query-key-token",
    "long-key-token",
    "key-secret"
  ];
  try {
    const report = await new BugReportStore({
      rootDir: directory,
      createId: () => FIRST_ID
    }).submit({
      description: "객체 키에 자격증명이 포함된 오류입니다.",
      capture: {
        "trace Bearer first-key-credential": { winner: "first" },
        "trace Bearer second-key-credential": { winner: "second" },
        "request https://example.invalid/?token=query-key-token": true,
        [longKey]: "bounded",
        "Authorization: Bearer key-secret": true,
        safeKey: "safe-value"
      }
    });

    const keys = Object.keys(report.capture);
    const serializedReport = JSON.stringify(report);
    for (const secret of secrets) assert.equal(serializedReport.includes(secret), false, secret);
    assert.equal(keys.every((key) => key.length <= 512), true);
    assert.deepEqual(report.capture["trace Bearer [REDACTED]"], { winner: "first" });
    assert.equal(keys.filter((key) => key === "trace Bearer [REDACTED]").length, 1);
    assert.equal(report.capture["request https://example.invalid/?token=[REDACTED]"], true);
    const boundedKey = keys.find((key) => key.endsWith("…[truncated]"));
    assert.ok(boundedKey);
    assert.match(boundedKey, /^url\?token=\[REDACTED\] /u);
    assert.equal(report.capture.safeKey, "safe-value");

    const files = await readdir(directory);
    const storedText = await readFile(path.join(directory, files[0]), "utf8");
    for (const secret of secrets) assert.equal(storedText.includes(secret), false, secret);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bug report listing returns newest summaries and detail lookup rejects unsafe IDs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-list-"));
  try {
    let nextId = FIRST_ID;
    let nextTime = "2026-09-01T01:00:00.000Z";
    const store = new BugReportStore({
      rootDir: directory,
      createId: () => nextId,
      now: () => new Date(nextTime)
    });
    await store.submit({ description: "첫 번째 재현 가능한 오류입니다.", capture: { events: [1] } });
    nextId = SECOND_ID;
    nextTime = "2026-09-02T01:00:00.000Z";
    await store.submit({ description: "두 번째 재현 가능한 오류입니다.", capture: { events: [2] } });
    await writeFile(path.join(directory, ".unfinished.tmp"), "partial", "utf8");
    await writeFile(path.join(directory, "not-a-report.json"), "{}", "utf8");
    await writeFile(path.join(directory, `20260903T010000000Z-${THIRD_ID}.json`), "{broken", "utf8");

    assert.deepEqual(await store.list(), [
      {
        id: SECOND_ID,
        submittedAt: "2026-09-02T01:00:00.000Z",
        description: "두 번째 재현 가능한 오류입니다."
      },
      {
        id: FIRST_ID,
        submittedAt: "2026-09-01T01:00:00.000Z",
        description: "첫 번째 재현 가능한 오류입니다."
      }
    ]);
    let readCount = 0;
    const originalRead = store.readStoredReport.bind(store);
    store.readStoredReport = async (...args) => {
      readCount += 1;
      return originalRead(...args);
    };
    assert.deepEqual((await store.list({ limit: 1 })).map(({ id }) => id), [SECOND_ID]);
    assert.equal(readCount, 2, "listing should read only the corrupt newest entry and one valid entry");
    assert.deepEqual((await store.get(FIRST_ID)).capture.events, [1]);
    await assert.rejects(
      store.get("../accounts"),
      (error) => error instanceof BugReportError && error.status === 400 && error.code === "invalid_report_id"
    );
    await assert.rejects(
      store.get("44444444-4444-4444-8444-444444444444"),
      (error) => error instanceof BugReportError && error.status === 404 && error.code === "report_not_found"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("follow-up reports may retain one game log ID while storing immutable report copies", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-follow-up-"));
  const ids = [FIRST_ID, SECOND_ID];
  try {
    const store = new BugReportStore({
      rootDir: directory,
      createId: () => ids.shift()
    });
    const logId = "shared-game-log-id";
    const first = await store.submit({
      description: "기존 항복 결과에 대한 첫 번째 보고입니다.",
      log: { logId, finalization: { reason: "surrender" }, ui: { errors: [] } }
    });
    const firstStoredBeforeFollowUp = await store.get(first.id);
    const second = await store.submit({
      description: "이후 화면 오류에 대한 별도 후속 보고입니다.",
      log: {
        logId,
        finalization: { reason: "ui-error" },
        ui: { errors: [{ error: { message: "follow-up UI failure" } }] }
      }
    });

    assert.notEqual(first.id, second.id);
    assert.equal(first.log.logId, second.log.logId);
    assert.deepEqual(await store.get(first.id), firstStoredBeforeFollowUp);
    assert.equal((await store.get(first.id)).log.finalization.reason, "surrender");
    assert.equal((await store.get(second.id)).log.finalization.reason, "ui-error");
    assert.equal((await readdir(directory)).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("functional helpers can use an isolated root and issue server IDs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-functions-"));
  try {
    const created = await submitBugReport({
      description: "함수 방식으로 제출한 오류입니다.",
      capture: { phase: "action" }
    }, {
      rootDir: directory,
      createId: () => FIRST_ID,
      now: () => "2026-09-02T02:00:00.000Z"
    });
    const loaded = await getBugReport(created.id, { rootDir: directory });
    assert.equal(loaded.id, FIRST_ID);
    assert.deepEqual(loaded.capture, { phase: "action" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent submissions create distinct complete files without visible temporary entries", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-concurrent-"));
  try {
    const store = new BugReportStore({ rootDir: directory });
    const created = await Promise.all(Array.from({ length: 12 }, (_, index) => store.submit({
      description: `동시 제출 오류를 재현한 설명 ${String(index).padStart(2, "0")}입니다.`,
      capture: { index }
    })));
    assert.equal(new Set(created.map(({ id }) => id)).size, created.length);
    const files = await readdir(directory);
    assert.equal(files.length, created.length);
    assert.equal(files.every((name) => name.endsWith(".json")), true);
    assert.equal((await store.list()).length, created.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("quota rejection preserves existing reports and serializes concurrent submissions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-quota-"));
  try {
    const ids = [FIRST_ID, SECOND_ID, THIRD_ID];
    const store = new BugReportStore({
      rootDir: directory,
      maxReportCount: 2,
      createId: () => ids.shift()
    });
    await store.submit({ description: "보존해야 하는 첫 번째 오류입니다.", capture: { index: 1 } });
    await store.submit({ description: "보존해야 하는 두 번째 오류입니다.", capture: { index: 2 } });
    await assert.rejects(
      store.submit({ description: "용량 제한을 넘는 세 번째 오류입니다.", capture: { index: 3 } }),
      (error) => error instanceof BugReportError
        && error.status === 507
        && error.code === "bug_report_storage_full"
    );
    assert.equal((await store.get(FIRST_ID)).capture.index, 1);
    assert.equal((await store.get(SECOND_ID)).capture.index, 2);
    assert.equal((await store.list()).length, 2);

    const raceDirectory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-quota-race-"));
    try {
      const raceIds = [FIRST_ID, SECOND_ID];
      const raceStore = new BugReportStore({
        rootDir: raceDirectory,
        maxReportCount: 1,
        createId: () => raceIds.shift()
      });
      const results = await Promise.allSettled([
        raceStore.submit({ description: "동시 저장 첫 번째 오류입니다.", capture: {} }),
        raceStore.submit({ description: "동시 저장 두 번째 오류입니다.", capture: {} })
      ]);
      assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
      assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
      assert.equal((await readdir(raceDirectory)).filter((name) => name.endsWith(".json")).length, 1);
    } finally {
      await rm(raceDirectory, { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("total-byte quota rejects new reports and optional pruning removes only the oldest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-byte-quota-"));
  try {
    const ids = [FIRST_ID, SECOND_ID];
    const store = new BugReportStore({
      rootDir: directory,
      maxTotalBytes: 500,
      createId: () => ids.shift(),
      now: () => new Date("2026-09-01T00:00:00.000Z")
    });
    const payload = (index) => ({
      description: `바이트 제한을 확인하는 오류 ${index}입니다.`,
      capture: { data: "x".repeat(220), index }
    });
    await store.submit(payload(1));
    await assert.rejects(
      store.submit(payload(2)),
      (error) => error instanceof BugReportError && error.code === "bug_report_storage_full"
    );
    assert.equal((await store.get(FIRST_ID)).capture.index, 1);

    const pruneDirectory = await mkdtemp(path.join(os.tmpdir(), "riftbound-bug-prune-"));
    try {
      const pruneIds = [FIRST_ID, SECOND_ID];
      let now = "2026-09-01T00:00:00.000Z";
      const pruneStore = new BugReportStore({
        rootDir: pruneDirectory,
        maxReportCount: 1,
        pruneOnQuota: true,
        createId: () => pruneIds.shift(),
        now: () => new Date(now)
      });
      await pruneStore.submit(payload(1));
      now = "2026-09-02T00:00:00.000Z";
      await pruneStore.submit(payload(2));
      await assert.rejects(
        pruneStore.get(FIRST_ID),
        (error) => error instanceof BugReportError && error.code === "report_not_found"
      );
      assert.equal((await pruneStore.get(SECOND_ID)).capture.index, 2);
    } finally {
      await rm(pruneDirectory, { recursive: true, force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("administrator token helpers use timing-safe comparison semantics and explicit errors", () => {
  assert.equal(verifyBugReportAdminToken("admin-secret", { adminToken: "admin-secret" }), true);
  assert.equal(verifyBugReportAdminToken("wrong", { adminToken: "admin-secret" }), false);
  assert.equal(verifyBugReportAdminToken("", { adminToken: "admin-secret" }), false);
  assert.equal(requireBugReportAdminToken("admin-secret", { adminToken: "admin-secret" }), true);
  assert.throws(
    () => requireBugReportAdminToken("wrong", { adminToken: "admin-secret" }),
    (error) => error instanceof BugReportError && error.status === 401 && error.code === "invalid_admin_token"
  );
  assert.throws(
    () => requireBugReportAdminToken("anything", { adminToken: "" }),
    (error) => error instanceof BugReportError && error.status === 503 && error.code === "admin_token_not_configured"
  );
});

test("stores read the administrator token from the environment unless explicitly overridden", () => {
  const previous = process.env.RIFTBOUND_BUG_REPORT_ADMIN_TOKEN;
  process.env.RIFTBOUND_BUG_REPORT_ADMIN_TOKEN = "environment-secret";
  try {
    const environmentStore = new BugReportStore();
    assert.equal(environmentStore.requireAdmin("environment-secret"), true);
    const overriddenStore = new BugReportStore({ adminToken: "option-secret" });
    assert.equal(overriddenStore.requireAdmin("option-secret"), true);
    assert.throws(
      () => overriddenStore.requireAdmin("environment-secret"),
      (error) => error instanceof BugReportError && error.code === "invalid_admin_token"
    );
  } finally {
    if (previous === undefined) delete process.env.RIFTBOUND_BUG_REPORT_ADMIN_TOKEN;
    else process.env.RIFTBOUND_BUG_REPORT_ADMIN_TOKEN = previous;
  }
});

test("stores use the configured data directory environment variable by default", () => {
  const previous = process.env.RIFTBOUND_BUG_REPORT_DATA_DIR;
  const configured = path.join(os.tmpdir(), "riftbound-configured-bug-reports");
  process.env.RIFTBOUND_BUG_REPORT_DATA_DIR = configured;
  try {
    assert.equal(new BugReportStore().rootDir, path.resolve(configured));
  } finally {
    if (previous === undefined) delete process.env.RIFTBOUND_BUG_REPORT_DATA_DIR;
    else process.env.RIFTBOUND_BUG_REPORT_DATA_DIR = previous;
  }
});
