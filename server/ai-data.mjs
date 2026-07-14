import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.env.RIFTBOUND_AI_DATA_DIR || "data/ai");
const replayRoot = path.join(root, "replays");
const statusFile = path.join(root, "status.json");
const MAX_REPLAY_BYTES = 8 * 1024 * 1024;

export async function storeAiReplay(payload) {
  const serialized = JSON.stringify(payload || {});
  if (Buffer.byteLength(serialized) > MAX_REPLAY_BYTES) throw new Error("AI replay is too large.");
  const id = safeId(payload?.id || `replay-${Date.now()}`);
  if (!id) throw new Error("Invalid AI replay id.");
  await mkdir(replayRoot, { recursive: true });
  const destination = path.join(replayRoot, `${id}.json`);
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${serialized}\n`, "utf8");
  await rename(temporary, destination);
  return { id };
}

export async function readAiStatus() {
  try { return JSON.parse(await readFile(statusFile, "utf8")); }
  catch { return { state: "idle", generation: 0, games: 0, updatedAt: null }; }
}

export async function writeAiStatus(status) {
  await mkdir(root, { recursive: true });
  await writeFile(statusFile, `${JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

function safeId(value) {
  const normalized = String(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  return normalized || null;
}
