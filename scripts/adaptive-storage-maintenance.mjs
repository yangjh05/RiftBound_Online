import { lstat, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { readTrajectoryArchive } from "../src/ai/neural/archive.mjs";

async function regularFile(filename) {
  try { const info = await lstat(filename); return info.isFile() && !info.isSymbolicLink() ? info : null; }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Only a durably committed candidate supersedes its PPO restart checkpoint.
// Never touch games, candidate models, plans, evidence, or unfinished iterations.
export async function obsoleteAdaptiveEpochs(runDirectory) {
  const root = await realpath(runDirectory);
  const state = await readTrajectoryArchive(path.join(root, "state.json.gz"));
  if (state.contract !== "continuous-policy-q-experiments-v1" || !Number.isSafeInteger(state.iteration) || state.iteration < 0) {
    throw new Error("Invalid committed adaptive state for storage maintenance.");
  }
  const iterations = path.join(root, "iterations");
  let entries;
  try {
    if (await realpath(iterations) !== iterations) throw new Error("Refusing redirected iterations directory.");
    entries = await readdir(iterations, { withFileTypes: true });
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^\d{6}$/.test(entry.name)
      || Number(entry.name) < 1 || Number(entry.name) > state.iteration) continue;
    const directory = path.join(iterations, entry.name);
    if (await realpath(directory) !== directory) throw new Error("Refusing redirected iteration directory.");
    const epochPath = path.join(directory, "epoch.json.gz"), info = await regularFile(epochPath);
    if (!info) continue;
    const candidatePath = path.join(directory, "candidate.json.gz");
    if (!await regularFile(candidatePath)) continue;
    // Validate the retained final archive before offering its intermediate copy.
    const candidate = await readTrajectoryArchive(candidatePath);
    if (!Number.isSafeInteger(candidate.checkpoint?.generation) || !candidate.checkpoint?.weights) {
      throw new Error(`Invalid final candidate: ${candidatePath}`);
    }
    result.push({ path: epochPath, bytes: info.size, mtimeMs: info.mtimeMs, candidatePath });
  }
  return result;
}

export async function pruneCommittedAdaptiveEpochs(runDirectory) {
  const entries = await obsoleteAdaptiveEpochs(runDirectory);
  let removedFiles = 0, freedBytes = 0;
  for (const entry of entries) {
    const current = await regularFile(entry.path);
    if (!current || current.size !== entry.bytes || current.mtimeMs !== entry.mtimeMs) continue;
    await rm(entry.path); // Exact verified file only; never recurse.
    removedFiles += 1;
    freedBytes += entry.bytes;
  }
  return { removedFiles, freedBytes };
}
