import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  DEFER_DURATION_MS,
  downloadUpdate,
  fetchLatestManifest,
  isDeferredBuild,
  isNewerBuild,
  launchUpdateHelper,
  manifestSignaturePayload,
  powershellBootstrap,
  powershellHelper,
  recoverPendingUpdate,
  resolvePortableTarget,
  validateRemoteManifest,
  verifyFile,
  verifyManifestSignature,
  waitForFile,
  writeUpdateState
} = require("../electron/updater.cjs");

const signingKeys = generateKeyPairSync("ed25519");
const publicKeyPem = signingKeys.publicKey.export({ type: "spki", format: "pem" });

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
  assert.equal(verifyManifestSignature(valid, publicKeyPem), true);
  assert.throws(() => validateManifest({ ...valid, buildId: "../escape" }), /build ID/u);
  assert.throws(() => validateRemoteManifest({ ...valid, sha256: "bad" }), /checksum/u);
  assert.throws(() => validateRemoteManifest({ ...valid, signature: "bad" }), /signature/u);
  assert.throws(() => verifyManifestSignature({ ...valid, size: valid.size + 1 }, publicKeyPem), /signature verification failed/u);
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
    const remote = await fetchLatestManifest(`${baseUrl}/api/update/latest`, publicKeyPem);
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

test("an interrupted update download never writes a second set of response headers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-update-interrupted-"));
  const bytes = Buffer.alloc(1024 * 1024, 7);
  const manifest = manifestFor(bytes);
  const updateDir = path.join(root, "dist", "updates", manifest.buildId);
  try {
    await mkdir(updateDir, { recursive: true });
    await writeFile(path.join(root, "dist", "update.json"), JSON.stringify(manifest));
    await writeFile(path.join(updateDir, "Riftbound Online.exe"), bytes);
    const response = new InterruptedResponse();

    assert.equal(await handleUpdateRequest({
      url: manifest.downloadUrl,
      method: "GET"
    }, response, { root }), true);
    assert.equal(response.writeHeadCalls, 1);
    assert.equal(response.statusCode, 200);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop packaging excludes transient mutation-test modules", async () => {
  const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.ok(packageJson.build.files.includes("!src/.mutant-*.mjs"));
  assert.ok(packageJson.build.files.includes("!src/**/.mutant-*.mjs"));
});

test("desktop package includes a visible staged update launcher", async () => {
  const html = await readFile(path.resolve("electron", "updater.html"), "utf8");
  const preload = await readFile(path.resolve("electron", "updater-preload.cjs"), "utf8");
  assert.match(html, /확인/u);
  assert.match(html, /다운로드/u);
  assert.match(html, /검증/u);
  assert.match(html, /교체 및 재실행/u);
  assert.match(preload, /update-status/u);
});

test("update helper retains the previous executable until the new build confirms startup", () => {
  const helper = powershellHelper();
  assert.match(helper, /Start-Process -FilePath \$Target/u);
  assert.match(helper, /Write-Result "success"/u);
  assert.ok(helper.indexOf("Start-Process -FilePath $Target") < helper.indexOf('Write-Result "success"'));
  assert.doesNotMatch(helper, /Start-Sleep -Seconds 2/u);
});

test("update bootstrap starts an independent worker before reporting readiness", () => {
  const bootstrap = powershellBootstrap();
  assert.match(bootstrap, /Start-Process -FilePath \$PowerShell/u);
  assert.match(bootstrap, /"-File", \$Worker/u);
  assert.match(bootstrap, /Move-Item -LiteralPath \$Ready -Destination \$BootstrapReady/u);
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

test("deferred updates stay quiet until their deadline but newer builds remain eligible", () => {
  const now = Date.parse("2026-07-16T12:00:00.000Z");
  const state = {
    deferred: { buildId: "build-a", until: new Date(now + DEFER_DURATION_MS).toISOString() }
  };
  assert.equal(isDeferredBuild(state, "build-a", now), true);
  assert.equal(isDeferredBuild(state, "build-b", now), false);
  assert.equal(isDeferredBuild(state, "build-a", now + DEFER_DURATION_MS), false);
});

test("a newly launched expected build clears pending updater state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-update-state-"));
  try {
    const statePath = path.join(root, "updater-state.json");
    const resultPath = path.join(root, "result.json");
    const targetExe = path.join(root, "Riftbound Online.exe");
    const backupExe = `${targetExe}.previous`;
    await writeFile(resultPath, JSON.stringify({ status: "success" }));
    await writeFile(backupExe, "previous build");
    const state = {
      schemaVersion: 1,
      pending: { buildId: "build-new", resultPath, targetExe, startedAt: "2026-07-16T11:00:00.000Z" },
      deferred: { buildId: "build-new", until: "2026-07-17T11:00:00.000Z" },
      lastFailure: { buildId: "build-old" }
    };
    await writeUpdateState(statePath, state);
    const recovered = await recoverPendingUpdate({
      current: { buildId: "build-new" },
      state,
      statePath,
      dialog: { showMessageBox: () => assert.fail("success must not show an error") }
    });
    assert.equal(recovered.status, "applied");
    assert.equal(recovered.state.pending, null);
    assert.equal(recovered.state.deferred, null);
    await assert.rejects(() => import("node:fs/promises").then(({ stat }) => stat(resultPath)), /ENOENT/u);
    await assert.rejects(() => import("node:fs/promises").then(({ stat }) => stat(backupExe)), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed helper is reported once and defers the same build", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-update-failure-"));
  try {
    const statePath = path.join(root, "updater-state.json");
    const resultPath = path.join(root, "result.json");
    await writeFile(resultPath, JSON.stringify({ status: "failure", message: "target is locked" }));
    const state = {
      schemaVersion: 1,
      pending: {
        buildId: "build-new",
        resultPath,
        logPath: path.join(root, "apply.log"),
        startedAt: "2026-07-16T11:00:00.000Z"
      },
      deferred: null,
      lastFailure: null
    };
    const messages = [];
    const now = Date.parse("2026-07-16T12:00:00.000Z");
    const recovered = await recoverPendingUpdate({
      current: { buildId: "build-old" },
      state,
      statePath,
      dialog: { showMessageBox: async (_win, options) => messages.push(options) },
      win: null,
      logger: { warn() {} },
      now
    });
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.state.pending, null);
    assert.equal(isDeferredBuild(recovered.state, "build-new", now), true);
    assert.equal(messages.length, 1);
    assert.match(messages[0].detail, /target is locked/u);

    const second = await recoverPendingUpdate({
      current: { buildId: "build-old" },
      state: recovered.state,
      statePath,
      dialog: { showMessageBox: () => assert.fail("cleared failure must not be shown twice") }
    });
    assert.equal(second.status, "none");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("helper launch rejects asynchronous spawn failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-update-spawn-"));
  try {
    const child = new EventEmitter();
    child.unref = () => {};
    const spawnImpl = () => {
      queueMicrotask(() => child.emit("error", new Error("PowerShell unavailable")));
      return child;
    };
    await assert.rejects(() => launchUpdateHelper({
      sourceExe: path.join(root, "source.exe"),
      targetExe: path.join(root, "target.exe"),
      processId: process.pid,
      readyPath: path.join(root, "ready"),
      resultPath: path.join(root, "result.json"),
      logPath: path.join(root, "apply.log"),
      spawnImpl
    }), /PowerShell unavailable/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("helper launch waits for the child readiness handshake", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-update-ready-"));
  try {
    const readyPath = path.join(root, "ready");
    const child = new EventEmitter();
    child.unref = () => {};
    child.kill = () => assert.fail("ready helper must not be killed");
    const spawnImpl = () => {
      queueMicrotask(async () => {
        child.emit("spawn");
        await writeFile(readyPath, "ready");
      });
      return child;
    };
    await launchUpdateHelper({
      sourceExe: path.join(root, "source.exe"),
      targetExe: path.join(root, "target.exe"),
      processId: process.pid,
      readyPath,
      resultPath: path.join(root, "result.json"),
      logPath: path.join(root, "apply.log"),
      spawnImpl
    });
    assert.equal(await waitForFile(readyPath, 100), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("helper starts a hidden bootstrap process and unrefs it after the worker is ready", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-update-launch-options-"));
  try {
    const readyPath = path.join(root, "ready");
    const child = new EventEmitter();
    let unrefCount = 0;
    let invocation;
    child.unref = () => { unrefCount += 1; };
    const spawnImpl = (command, args, options) => {
      invocation = { command, args, options };
      queueMicrotask(async () => {
        child.emit("spawn");
        await writeFile(readyPath, "ready");
      });
      return child;
    };
    await launchUpdateHelper({
      sourceExe: path.join(root, "source.exe"),
      targetExe: path.join(root, "target.exe"),
      processId: process.pid,
      readyPath,
      resultPath: path.join(root, "result.json"),
      logPath: path.join(root, "apply.log"),
      spawnImpl
    });
    assert.match(path.basename(invocation.command), /^powershell\.exe$/iu);
    assert.equal(invocation.options.windowsHide, true);
    assert.equal(invocation.options.stdio, "ignore");
    assert.equal(invocation.options.detached, undefined);
    assert.ok(invocation.args.includes("-Worker"));
    assert.ok(invocation.args.includes("-BootstrapReady"));
    assert.equal(unrefCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function manifestFor(bytes) {
  const buildId = "0.1.0-20260714020000000";
  const manifest = {
    ok: true,
    buildId,
    version: "0.1.0",
    publishedAt: "2026-07-14T02:00:00.000Z",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    downloadUrl: `/api/update/download/${buildId}`
  };
  return {
    ...manifest,
    signature: sign(null, manifestSignaturePayload(manifest), signingKeys.privateKey).toString("base64")
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

class InterruptedResponse extends Writable {
  constructor() {
    super();
    this.headersSent = false;
    this.statusCode = 0;
    this.writeHeadCalls = 0;
  }

  writeHead(statusCode) {
    this.writeHeadCalls += 1;
    if (this.headersSent) throw new Error("Cannot write headers after they are sent to the client");
    this.headersSent = true;
    this.statusCode = statusCode;
    return this;
  }

  _write(_chunk, _encoding, callback) {
    const error = new Error("client disconnected");
    error.code = "ECONNRESET";
    callback(error);
  }
}
