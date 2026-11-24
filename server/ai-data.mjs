import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gzip, gunzip } from "node:zlib";
import { spectatorReplaySummary } from "../src/ai/spectator-replay.mjs";
import { FOCUSED_TRAINING_DECK_IDS } from "../src/ai/training-decks.mjs";
import { renameWithRetry } from "../scripts/file-replace.mjs";

const root = path.resolve(process.env.RIFTBOUND_AI_DATA_DIR || "data/ai");
const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const replayRoot = path.join(root, "replays");
const spectatorReplayRoot = path.join(root, "selfplay-replays");
const statusFile = path.join(root, "status.json");
export const MAX_AI_REPLAY_BYTES = 8 * 1024 * 1024;
// The HTTP body wraps the replay in { replay: ... }; storage measures only
// the replay itself. Keep the two limits aligned without relaxing other APIs.
export const MAX_AI_REPLAY_REQUEST_BYTES = MAX_AI_REPLAY_BYTES + 1024;
// Spectator replays contain a board frame per action and are stored gzip
// compressed. The old 64 MiB limit was applied to the repetitive source JSON,
// so otherwise healthy long games were rejected even when their archive was
// small. Keep a generous in-memory guard and enforce the tighter limit on the
// bytes that are actually written to disk.
const MAX_SPECTATOR_REPLAY_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_SPECTATOR_REPLAY_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_AI_CHECKPOINT_BYTES = 64 * 1024 * 1024;
const MAX_SPECTATOR_REPLAYS = 24;
const MAX_GENERATION_DISCOVERY_CACHE_ENTRIES = 16;
export const AI_SPECTATOR_REPLAY_TOO_LARGE =
  "AI_SPECTATOR_REPLAY_TOO_LARGE";
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const generationDiscoveryCache = new Map();

export async function storeAiReplay(payload) {
  const serialized = JSON.stringify(payload || {});
  if (Buffer.byteLength(serialized) > MAX_AI_REPLAY_BYTES) {
    const error = new Error("AI replay is too large.");
    error.status = 413;
    error.code = "ai_replay_too_large";
    throw error;
  }
  const id = safeId(payload?.id || `replay-${Date.now()}`);
  if (!id) throw new Error("Invalid AI replay id.");
  await mkdir(replayRoot, { recursive: true });
  const destination = path.join(replayRoot, `${id}.json`);
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${serialized}\n`, "utf8");
    await renameWithRetry(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { id };
}

export async function readAiStatus() {
  try { return JSON.parse(await readFile(statusFile, "utf8")); }
  catch { return { state: "idle", generation: 0, games: 0, updatedAt: null }; }
}

export async function listAiGenerations(options = {}) {
  const discovered = await cachedAiGenerationFiles(options);
  return discovered.map(({ filename, ...entry }) => entry);
}

export async function readAiGenerationCheckpoint(generation, options = {}) {
  const requested = Number(generation);
  if (!Number.isInteger(requested) || requested < 0) return null;
  const entry = (await cachedAiGenerationFiles(options)).find((candidate) => candidate.generation === requested);
  if (!entry) return null;
  const info = await stat(entry.filename);
  if (info.size > MAX_AI_CHECKPOINT_BYTES) throw new Error("AI checkpoint is too large.");
  return {
    generation: entry.generation,
    contents: await readFile(entry.filename)
  };
}

export async function storeAiSpectatorReplay(payload, targetRoot = root) {
  const serialized = JSON.stringify(payload || {});
  assertAiSpectatorReplaySize(
    serialized,
    MAX_SPECTATOR_REPLAY_SOURCE_BYTES,
    "source"
  );
  const id = safeId(payload?.id || `selfplay-${Date.now()}`);
  if (!id) throw new Error("Invalid AI spectator replay id.");
  const directory = path.join(path.resolve(targetRoot), "selfplay-replays");
  await mkdir(directory, { recursive: true });
  const archivePath = path.join(directory, `${id}.json.gz`);
  const metadataPath = path.join(directory, `${id}.meta.json`);
  const archive = await gzipAsync(Buffer.from(serialized), { level: 6 });
  assertAiSpectatorReplaySize(
    archive,
    MAX_SPECTATOR_REPLAY_ARCHIVE_BYTES,
    "archive"
  );
  await writeAtomic(archivePath, archive);
  await writeAtomic(metadataPath, Buffer.from(`${JSON.stringify(spectatorReplaySummary({ ...payload, id }), null, 2)}\n`, "utf8"));
  await pruneSpectatorReplays(directory, MAX_SPECTATOR_REPLAYS);
  return { id };
}

export function assertAiSpectatorReplaySize(
  serialized,
  maximumBytes = MAX_SPECTATOR_REPLAY_SOURCE_BYTES,
  measurement = "source"
) {
  const actualBytes = Buffer.isBuffer(serialized)
    ? serialized.byteLength
    : Buffer.byteLength(String(serialized || ""));
  const allowedBytes = Math.max(1, Number(maximumBytes) || 1);
  if (actualBytes <= allowedBytes) return actualBytes;
  const error = new Error("AI spectator replay is too large.");
  error.code = AI_SPECTATOR_REPLAY_TOO_LARGE;
  error.actualBytes = actualBytes;
  error.maximumBytes = allowedBytes;
  error.measurement = measurement;
  throw error;
}

export function isAiSpectatorReplayTooLargeError(error) {
  return error?.code === AI_SPECTATOR_REPLAY_TOO_LARGE;
}

export async function listAiSpectatorReplays(options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 40));
  const summaries = [];
  const seen = new Set();
  for (const directory of await spectatorReplayDirectories(options.root)) {
    for (const name of await safeReaddir(directory)) {
      if (!name.endsWith(".meta.json")) continue;
      try {
        const summary = JSON.parse(await readFile(path.join(directory, name), "utf8"));
        if (!summary?.id || seen.has(summary.id)) continue;
        seen.add(summary.id);
        summaries.push(summary);
      } catch {}
    }
  }
  return summaries
    .sort((left, right) => String(right.completedAt || right.createdAt || "").localeCompare(String(left.completedAt || left.createdAt || "")))
    .slice(0, limit);
}

export async function readAiSpectatorReplay(id, options = {}) {
  const normalized = safeId(id);
  if (!normalized || normalized !== id) throw new Error("Invalid AI spectator replay id.");
  for (const directory of await spectatorReplayDirectories(options.root)) {
    try {
      const compressed = await readFile(path.join(directory, `${normalized}.json.gz`));
      return JSON.parse((await gunzipAsync(compressed)).toString("utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return null;
}

export async function writeAiStatus(status, targetRoot = root) {
  const targetStatusFile = targetRoot === root ? statusFile : path.join(path.resolve(targetRoot), "status.json");
  await mkdir(path.dirname(targetStatusFile), { recursive: true });
  const temporary = `${targetStatusFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    await renameWithRetry(temporary, targetStatusFile);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function safeId(value) {
  const normalized = String(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  return normalized || null;
}

async function spectatorReplayDirectories(overrideRoot = null) {
  if (overrideRoot) return [path.join(path.resolve(overrideRoot), "selfplay-replays")];
  const directories = new Set([spectatorReplayRoot]);
  const status = await readAiStatus();
  for (const filename of [status?.learnerCheckpointPath, status?.candidatePath, status?.progressPath]) {
    if (!filename) continue;
    const aiRoot = path.dirname(path.dirname(path.resolve(filename)));
    directories.add(path.join(aiRoot, "selfplay-replays"));
  }
  return [...directories];
}

async function discoverAiGenerationFiles(options = {}) {
  const dataRoot = path.resolve(options.root || root);
  const projectRoot = path.resolve(options.projectRoot || applicationRoot);
  const status = await readJsonFile(path.join(dataRoot, "status.json"), {});
  const run = await readJsonFile(path.join(dataRoot, "resume", "run.json"), {});
  const currentFingerprint = options.engineFingerprint
    || (await import("../scripts/training-safety.mjs")).computeEngineFingerprint(options.engineRoot);
  const files = [];
  await addGenerationFile(files, path.join(projectRoot, "src", "ai", "checkpoints", "neural-champion.json"), "bundled");
  await addGenerationFile(files, path.join(dataRoot, "learner", "neural-learner.json"), "learner");
  for (const [directory, kind] of [["candidates", "candidate"], ["league", "league"]]) {
    for (const name of await safeReaddir(path.join(dataRoot, directory))) {
      if (!name.endsWith(".json") || name.includes("pre-balanced")) continue;
      await addGenerationFile(files, path.join(dataRoot, directory, name), kind);
    }
  }

  const selected = new Map();
  for (const file of files) {
    const current = selected.get(file.generation);
    if (!current || generationFileRank(file) > generationFileRank(current)
      || (generationFileRank(file) === generationFileRank(current) && file.modifiedAt > current.modifiedAt)) {
      selected.set(file.generation, file);
    }
  }

  return [...selected.values()]
    .sort((left, right) => left.generation - right.generation)
    .map((entry) => ({
      ...entry,
      trainingDeckIds: entry.trainingDeckIds.length ? entry.trainingDeckIds : [...FOCUSED_TRAINING_DECK_IDS],
      engineCompatible: !entry.engineFingerprint || entry.engineFingerprint === currentFingerprint,
      inProgress: Number(status.generation) === entry.generation && !["complete", "failed", "idle"].includes(status.state),
      activeLearner: Number(run.learnerGeneration) === entry.generation,
      activeChampion: Number(run.championGeneration) === entry.generation
    }));
}

async function cachedAiGenerationFiles(options) {
  const key = JSON.stringify({
    root: path.resolve(options.root || root),
    projectRoot: options.projectRoot ? path.resolve(options.projectRoot) : null,
    engineFingerprint: options.engineFingerprint || null,
    engineRoot: options.engineRoot ? path.resolve(options.engineRoot) : null
  });
  const cached = generationDiscoveryCache.get(key);
  if (cached?.expiresAt > Date.now()) {
    rememberGenerationDiscovery(key, cached);
    return cached.entries;
  }
  if (cached?.promise) return cached.promise;
  const promise = discoverAiGenerationFiles(options);
  rememberGenerationDiscovery(key, { promise, expiresAt: 0, entries: [] });
  try {
    const entries = await promise;
    rememberGenerationDiscovery(key, { entries, expiresAt: Date.now() + 15_000, promise: null });
    return entries;
  } catch (error) {
    generationDiscoveryCache.delete(key);
    throw error;
  }
}

async function addGenerationFile(output, filename, kind) {
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > MAX_AI_CHECKPOINT_BYTES) return;
    const checkpoint = JSON.parse(await readFile(filename, "utf8"));
    const generation = Number(checkpoint.generation);
    if (!Number.isInteger(generation) || generation < 0) return;
    output.push({
      filename,
      generation,
      kind,
      gamesTrained: Number(checkpoint.gamesTrained) || 0,
      trainingIteration: Number(checkpoint.metadata?.trainingIteration) || null,
      promoted: checkpoint.metadata?.promoted === true,
      trainingDeckIds: [...(checkpoint.metadata?.trainingDeckIds || checkpoint.knowledge?.trainingDeckIds || [])],
      engineFingerprint: checkpoint.metadata?.engineFingerprint || null,
      modifiedAt: info.mtimeMs
    });
  } catch {}
}

function generationFileRank(entry) {
  if (entry.kind === "learner") return 500;
  if (entry.kind === "candidate" && entry.promoted) return 450;
  if (entry.kind === "candidate") return 400;
  if (entry.kind === "bundled") return 300;
  return 200;
}

async function readJsonFile(filename, fallback) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch { return fallback; }
}

async function safeReaddir(directory) {
  try { return await readdir(directory); }
  catch { return []; }
}

async function writeAtomic(filename, contents) {
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, contents);
    await renameWithRetry(temporary, filename);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function rememberGenerationDiscovery(key, entry) {
  generationDiscoveryCache.delete(key);
  generationDiscoveryCache.set(key, entry);
  if (generationDiscoveryCache.size <= MAX_GENERATION_DISCOVERY_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [candidateKey, candidate] of generationDiscoveryCache) {
    if (candidateKey === key || candidate.promise || candidate.expiresAt > now) continue;
    generationDiscoveryCache.delete(candidateKey);
    if (generationDiscoveryCache.size <= MAX_GENERATION_DISCOVERY_CACHE_ENTRIES) return;
  }
  for (const [candidateKey, candidate] of generationDiscoveryCache) {
    if (candidateKey === key || candidate.promise) continue;
    generationDiscoveryCache.delete(candidateKey);
    if (generationDiscoveryCache.size <= MAX_GENERATION_DISCOVERY_CACHE_ENTRIES) return;
  }
}

async function pruneSpectatorReplays(directory, limit) {
  const records = [];
  for (const name of await safeReaddir(directory)) {
    if (!name.endsWith(".meta.json")) continue;
    try {
      const metadata = JSON.parse(await readFile(path.join(directory, name), "utf8"));
      records.push({ id: safeId(metadata.id), completedAt: metadata.completedAt || metadata.createdAt || "" });
    } catch {}
  }
  records.sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)));
  for (const record of records.slice(limit)) {
    if (!record.id) continue;
    await Promise.all([
      unlink(path.join(directory, `${record.id}.meta.json`)).catch(() => {}),
      unlink(path.join(directory, `${record.id}.json.gz`)).catch(() => {})
    ]);
  }
}
