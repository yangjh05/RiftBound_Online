import assert from "node:assert/strict";
import test from "node:test";
import { healthPayload, securityHeaders } from "../server/http-security.mjs";

test("production HTTP responses include baseline browser security headers", () => {
  const headers = securityHeaders({ "content-type": "text/plain" });

  assert.match(headers["content-security-policy"], /default-src 'self'/u);
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/u);
  assert.equal(headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["content-type"], "text/plain");
});

test("health payload exposes readiness without secrets or host details", () => {
  const payload = healthPayload();

  assert.equal(payload.ok, true);
  assert.equal(payload.status, "ready");
  assert.equal(typeof payload.version, "string");
  assert.ok(Number.isFinite(Date.parse(payload.startedAt)));
  assert.deepEqual(Object.keys(payload).sort(), ["ok", "startedAt", "status", "version"]);
});
