import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import test from "node:test";
import { handleUpdateRequest, readPublishedUpdate, validateManifest } from "../server/updates.mjs";

const require = createRequire(import.meta.url);
const {
  downloadUpdate,
  fetchLatestManifest,
  isNewerBuild,
  resolvePortableTarget,
  validateRemoteManifest,
  verifyFile
} = require("../electron/updater.cjs");

test("desktop updater accepts only a genuinely newer published build", () => {
  const current = { buildId: "0.1.0-old", publishedAt: "2026-07-14T01:00:00.000Z" };
  assert.equal(isNewerBuild(current, { buildId: current.buildId, publishedAt: "2026-07-14T02:00:00.000Z" }), false);
  assert.equal(isNewerBuild(current, { buildId: "0.1.0-new", publishedAt: "2026-07-14T00:59:59.000Z" }), false);
  assert.equal(isNewerBuild(current, { buildId: "0.1.0-new", publishedAt: "2026-07-14T02:00:00.000Z" }), true);
});

test("update manifests require a safe build ID, size, checksum, and download route", () => {
  const valid = manifestFor(Buffer.from("portable update"));
  assert.equal(validateManifest(valid), valid);
  assert.equal(validateRemoteManifest(valid), valid);
  assert.throws(() => validateManifest({ ...valid, buildId: "../escape" }), /build ID/u);
  assert.throws(() => validateRemoteManifest({ ...valid, sha256: "bad" }), /checksum/u);
});

test("downloaded update verification rejects changed executable bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-update-verify-"));
  try {
    const exe = path.join(root, "Riftbound Online.exe");
    const bytes = Buffer.from("verified executable bytes");
    const manifest = manifestFor(bytes);
    await writeFile(exe, bytes);
    assert.equal(await verifyFile(exe, manifest), true);
    await writeFile(exe, Buffer.from("tampered executable bytes"));
    await assert.rejects(() => verifyFile(exe, manifest), /(size|checksum) verification failed/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop updater downloads a server artifact and reports verified progress", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-update-download-"));
  const bytes = Buffer.from("remote executable payload");
  const manifest = manifestFor(bytes);
  const server = http.createServer((req, res) => {
    if (req.url === "/api/update/latest") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(manifest));
      return;
    }
    res.writeHead(200, { "content-length": String(bytes.length), "content-type": "application/octet-stream" });
    res.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const remote = await fetchLatestManifest(`${baseUrl}/api/update/latest`);
    assert.equal(remote.buildId, manifest.buildId);
    const destination = path.join(root, "Riftbound Online.exe");
    const progress = [];
    await downloadUpdate(`${baseUrl}${manifest.downloadUrl}`, destination, manifest, (received, total) => {
      progress.push([received, total]);
    });
    assert.equal(await verifyFile(destination, manifest), true);
    assert.deepEqual(progress.at(-1), [bytes.length, bytes.length]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("update server returns the atomic latest manifest and matching executable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-update-server-"));
  const bytes = Buffer.from("published portable executable");
  const manifest = manifestFor(bytes);
  const updateDir = path.join(root, "dist", "updates", manifest.buildId);
  try {
    await mkdir(updateDir, { recursive: true });
    await writeFile(path.join(root, "dist", "update.json"), JSON.stringify(manifest));
    await writeFile(path.join(updateDir, "Riftbound Online.exe"), bytes);

    const published = await readPublishedUpdate(root);
    assert.equal(published.file.size, bytes.length);

    const latest = await requestUpdate(root, "/api/update/latest");
    assert.equal(latest.statusCode, 200);
    assert.equal(JSON.parse(latest.body.toString()).buildId, manifest.buildId);

    const download = await requestUpdate(root, manifest.downloadUrl);
    assert.equal(download.statusCode, 200);
    assert.equal(download.headers["content-length"], String(bytes.length));
    assert.deepEqual(download.body, bytes);

    const stale = await requestUpdate(root, "/api/update/download/old-build");
    assert.equal(stale.statusCode, 404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("portable updater only replaces the original absolute executable", () => {
  const previous = process.env.PORTABLE_EXECUTABLE_FILE;
  try {
    process.env.PORTABLE_EXECUTABLE_FILE = "relative.exe";
    assert.equal(resolvePortableTarget(), null);
    const absolute = path.resolve("Riftbound Online.exe");
    process.env.PORTABLE_EXECUTABLE_FILE = absolute;
    assert.equal(resolvePortableTarget(), absolute);
  } finally {
    if (previous === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE;
    else process.env.PORTABLE_EXECUTABLE_FILE = previous;
  }
});

function manifestFor(bytes) {
  const buildId = "0.1.0-20260714020000000";
  return {
    ok: true,
    buildId,
    version: "0.1.0",
    publishedAt: "2026-07-14T02:00:00.000Z",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    downloadUrl: `/api/update/download/${buildId}`
  };
}

async function requestUpdate(root, url, method = "GET") {
  const res = new MemoryResponse();
  const completion = finished(res);
  const handled = await handleUpdateRequest({ url, method }, res, { root });
  await completion;
  assert.equal(handled, true);
  return { statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(res.chunks) };
}

class MemoryResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 0;
    this.headers = {};
    this.chunks = [];
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}
