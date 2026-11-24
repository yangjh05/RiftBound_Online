import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Import after assigning an isolated store: these tests must not write into
// the user's training data, even when the complete test suite is running.
const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-replay-http-"));
const previousDataDirectory = process.env.RIFTBOUND_AI_DATA_DIR;
process.env.RIFTBOUND_AI_DATA_DIR = directory;
const { handleMultiplayerRequest } = await import("../server/http-multiplayer.mjs");
const { MAX_AI_REPLAY_BYTES, MAX_AI_REPLAY_REQUEST_BYTES } = await import("../server/ai-data.mjs");
const server = createServer((req, res) => {
  handleMultiplayerRequest(req, res).catch(error => res.destroy(error));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await closed;
  if (previousDataDirectory === undefined) delete process.env.RIFTBOUND_AI_DATA_DIR;
  else process.env.RIFTBOUND_AI_DATA_DIR = previousDataDirectory;
  await rm(directory, { recursive: true, force: true });
});

async function post(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
  return { status: response.status, payload: await response.json() };
}

function replayWithBytes(id, bytes) {
  const replay = { id, decisions: [], notes: "" };
  replay.notes = "x".repeat(bytes - Buffer.byteLength(JSON.stringify(replay)));
  assert.equal(Buffer.byteLength(JSON.stringify(replay)), bytes);
  return replay;
}

test("AI replay HTTP accepts and stores training samples above the generic 1 MiB limit", async () => {
  const replay = {
    id: "replay-large-training-samples",
    winnerId: "p1",
    decisions: Array.from({ length: 180 }, (_, index) => ({
      sequence: index + 1,
      actorId: "p1",
      command: { kind: "passShowdown" },
      trainingSample: { state: Array.from({ length: 800 }, (_, i) => [i, 0.125]) }
    })),
    report: { overview: "긴 경기에서도 학습용 표본이 빠짐없이 저장되어야 합니다." }
  };
  assert.ok(Buffer.byteLength(JSON.stringify({ replay })) > 1024 * 1024);
  const result = await post("/api/ai/replays", { replay });
  assert.equal(result.status, 200);
  assert.equal(result.payload.id, replay.id);
  const stored = JSON.parse(await readFile(path.join(directory, "replays", `${replay.id}.json`), "utf8"));
  assert.deepEqual(stored, replay);
});

test("AI replay HTTP accepts the exact storage boundary including its JSON envelope", async () => {
  const replay = replayWithBytes("replay-exact-limit", MAX_AI_REPLAY_BYTES);
  const result = await post("/api/ai/replays", { replay });
  assert.equal(result.status, 200);
  const saved = await readFile(path.join(directory, "replays", `${replay.id}.json`), "utf8");
  assert.equal(Buffer.byteLength(saved.trimEnd()), MAX_AI_REPLAY_BYTES);
});

test("AI replay storage rejects one byte over its limit with HTTP 413, not 500", async () => {
  const replay = replayWithBytes("replay-over-storage-limit", MAX_AI_REPLAY_BYTES + 1);
  const result = await post("/api/ai/replays", { replay });
  assert.equal(result.status, 413);
  assert.equal(result.payload.code, "ai_replay_too_large");
  assert.equal((await readdir(path.join(directory, "replays"))).some(name => name.startsWith(replay.id)), false);
});

test("oversized streamed HTTP replay requests receive a readable 413 response", async () => {
  const body = JSON.stringify({ replay: replayWithBytes("replay-over-http-limit", MAX_AI_REPLAY_REQUEST_BYTES + 256 * 1024) });
  // No Content-Length: ensure the streaming reader enforces the limit too.
  let offset = 0;
  const requestBody = new ReadableStream({
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (offset >= body.length) return controller.close();
      controller.enqueue(new TextEncoder().encode(body.slice(offset, offset + 65536)));
      offset += 65536;
    }
  });
  const response = await fetch(`${baseUrl}/api/ai/replays`, {
    method: "POST", headers: { "content-type": "application/json" }, body: requestBody, duplex: "half"
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "request_too_large");
});

test("ordinary multiplayer requests retain the smaller 1 MiB safety limit", async () => {
  const result = await post("/api/rooms", { padding: "x".repeat(1024 * 1024) });
  assert.equal(result.status, 413);
  assert.equal(result.payload.code, "request_too_large");
});
