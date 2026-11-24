import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { readTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { confinedStorageStat, removeUnchangedStorageFile, sameStorageFile } from "./training-storage-files.mjs";

async function regularFile(filename) {
  try { const info = await lstat(filename); return info.isFile() && !info.isSymbolicLink() ? info : null; }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Only a durably committed candidate supersedes its PPO restart checkpoint.
// Never touch games, candidate models, plans, evidence, or unfinished iterations.
export async function obsoleteAdaptiveEpochs(runDirectory) {
  await confinedStorageStat(runDirectory, runDirectory);
  const root = await realpath(runDirectory);
  const statePath = path.join(root, "state.json.gz");
  const stateInfo = await confinedStorageStat(root, statePath);
  if (!stateInfo?.isFile()) throw new Error("Missing regular committed adaptive state.");
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
    const epochPath = path.join(directory, "epoch.json.gz"), info = await regularFile(epochPath);
    if (!info) continue;
    if (await realpath(directory) !== directory) throw new Error("Refusing redirected iteration directory.");
    const candidatePath = path.join(directory, "candidate.json.gz");
    const candidateInfo = await confinedStorageStat(root, candidatePath);
    if (!candidateInfo?.isFile()) continue;
    // Validate the retained final archive before offering its intermediate copy.
    const candidate = await readTrajectoryArchive(candidatePath);
    if (!Number.isSafeInteger(candidate.checkpoint?.generation) || !candidate.checkpoint?.weights) {
      throw new Error(`Invalid final candidate: ${candidatePath}`);
    }
    if (!sameStorageFile(await confinedStorageStat(root, candidatePath), candidateInfo)) continue;
    result.push({ path: epochPath, bytes: info.size, mtimeMs: info.mtimeMs, candidatePath,
      info, candidateInfo, statePath, stateInfo });
  }
  return result;
}

export async function pruneCommittedAdaptiveEpochs(runDirectory, { dryRun = false } = {}) {
  const entries = await obsoleteAdaptiveEpochs(runDirectory);
  let removedFiles = 0, freedBytes = 0;
  for (const entry of entries) {
    if (!sameStorageFile(await confinedStorageStat(runDirectory, entry.statePath), entry.stateInfo)
      || !sameStorageFile(await confinedStorageStat(runDirectory, entry.candidatePath), entry.candidateInfo)) continue;
    if (!sameStorageFile(await confinedStorageStat(runDirectory, entry.path), entry.info)) continue;
    if (!dryRun && !await removeUnchangedStorageFile(runDirectory, entry.path, entry.info)) continue;
    removedFiles += 1;
    freedBytes += entry.bytes;
  }
  return { removedFiles, freedBytes };
}
