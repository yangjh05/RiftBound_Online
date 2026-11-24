import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolvePublicStaticPath } from "../server/public-static.mjs";

const root = path.resolve("C:/workspace/riftbound");

test("public static resolver allows only browser application assets", () => {
  assert.equal(resolvePublicStaticPath(root, "/"), path.join(root, "index.html"));
  assert.equal(resolvePublicStaticPath(root, "/index.html"), path.join(root, "index.html"));
  assert.equal(resolvePublicStaticPath(root, "/build-info.json?cache=1"), path.join(root, "build-info.json"));
  assert.equal(resolvePublicStaticPath(root, "/src/app.mjs"), path.join(root, "src", "app.mjs"));
  assert.equal(resolvePublicStaticPath(root, "/assets/board.svg"), path.join(root, "assets", "board.svg"));
});

test("public static resolver blocks private project and report files", () => {
  for (const requestUrl of [
    "/.env",
    "/package.json",
    "/data/bug-reports/report.json",
    "/server/bug-reports.mjs",
    "/scripts/dev-server.mjs",
    "/docs/private.md",
    "/tests/public-static.test.mjs"
  ]) {
    assert.equal(resolvePublicStaticPath(root, requestUrl), null, requestUrl);
  }
});

test("public static resolver rejects traversal and malformed paths", () => {
  for (const requestUrl of [
    "/src/../.env",
    "/src/%2e%2e/.env",
    "/src/%5c..%5c.env",
    "/assets//board.svg",
    "/%E0%A4%A"
  ]) {
    assert.equal(resolvePublicStaticPath(root, requestUrl), null, requestUrl);
  }
});
