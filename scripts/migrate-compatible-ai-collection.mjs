import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { createCollectionDescriptor } from "../src/ai/neural/training-resume.mjs";
import { inspectTrainingPreflight, migrateCompatibleTrainingTrajectory } from "./training-safety.mjs";
import { migrateEvaluatorBootstrapStructuredEvidenceFingerprints } from "./migrate-compatible-evaluator-bootstrap.mjs";

export async function migrateCompatibleCollection(dataRoot, targetDescriptor, fromEngineFingerprint, options = {}) {
  if (!fromEngineFingerprint) throw new Error("A source engine fingerprint is required for collection migration.");
  const generationRoot = path.join(dataRoot, "resume", `generation-${String(targetDescriptor.generation).padStart(5, "0")}`);
  const resumePath = path.join(generationRoot, "manifest.json");
  let sourceResume = await readJson(resumePath);
  if (!sourceResume) return { migratedGames: 0, skippedGames: 0, missing: true };
  if (sourceResume.collectionKey === targetDescriptor.collectionKey && options.sourceCollectionKey) {
    sourceResume = {
      ...sourceResume,
      collectionKey: options.sourceCollectionKey,
      engineFingerprint: fromEngineFingerprint
    };
  } else if (sourceResume.collectionKey === targetDescriptor.collectionKey) {
    return { migratedGames: 0, skippedGames: 0, alreadyCurrent: true };
  }
  if (sourceResume.engineFingerprint !== fromEngineFingerprint) {
    throw new Error(`Collection migration source fingerprint mismatch: ${sourceResume.engineFingerprint || "missing"}.`);
  }
  const configurationDifferences = collectionConfigurationDifferences(
    sourceResume,
    targetDescriptor
  );
  if (configurationDifferences.length > 0) {
    throw new Error(
      "Collection migration refused because settings other than the engine "
      + `fingerprint changed: ${configurationDifferences.join(", ")}.`
    );
  }

  const sourceCollectionKey = sourceResume.collectionKey;
  const workerCount = Math.max(1, Math.min(targetDescriptor.workers || 1, targetDescriptor.games));
  let migratedGames = 0;
  let skippedGames = 0;
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const assignedGames = Math.floor(targetDescriptor.games / workerCount)
      + (workerIndex < targetDescriptor.games % workerCount ? 1 : 0);
    for (let gameIndex = 0; gameIndex < assignedGames; gameIndex += 1) {
      const directory = path.join(generationRoot, "games", `worker-${String(workerIndex).padStart(2, "0")}`, `game-${String(gameIndex).padStart(3, "0")}`);
      const manifestPath = path.join(directory, "manifest.json");
      const manifest = await readJson(manifestPath);
      if (!manifest) continue;
      if (manifest.collectionKey === targetDescriptor.collectionKey) continue;
      if (manifest.collectionKey !== sourceCollectionKey || manifest.workerIndex !== workerIndex || manifest.gameIndex !== gameIndex) {
        skippedGames += 1;
        continue;
      }

      const prepared = await prepareGameMigration(directory, manifest, sourceCollectionKey, targetDescriptor, workerIndex, gameIndex, options);
      if (!prepared) {
        skippedGames += 1;
        continue;
      }
      for (const archive of prepared.archives) await writeTrajectoryArchive(archive.filename, archive.payload);
      await writeJsonAtomic(manifestPath, {
        ...manifest,
        collectionKey: targetDescriptor.collectionKey,
        trajectories: prepared.trajectories,
        compatibilityMigration: {
          version: 1,
          migratedAt: new Date().toISOString(),
          fromCollectionKey: sourceCollectionKey,
          toCollectionKey: targetDescriptor.collectionKey,
          fromEngineFingerprint,
          toEngineFingerprint: targetDescriptor.engineFingerprint
        }
      });
      migratedGames += 1;
    }
  }

  await writeJsonAtomic(resumePath, {
    ...targetDescriptor,
    state: sourceResume.state || "collecting",
    createdAt: sourceResume.createdAt || new Date().toISOString(),
    population: sourceResume.population,
    compatibilityMigration: {
      version: 1,
      migratedAt: new Date().toISOString(),
      fromCollectionKey: sourceCollectionKey,
      toCollectionKey: targetDescriptor.collectionKey,
      fromEngineFingerprint,
      toEngineFingerprint: targetDescriptor.engineFingerprint,
      migratedGames,
      skippedGames
    }
  });
  return {
    migratedGames,
    skippedGames,
    alreadyCurrent: false,
    sourceCollectionKey,
    targetCollectionKey: targetDescriptor.collectionKey
  };
}

export function requireCompatibleCollectionResume(resume, migration) {
  if (resume) return resume;
  const detail = migration?.missing
    ? "the source generation manifest is missing"
    : migration?.skippedGames
      ? `${migration.skippedGames} source game(s) failed compatibility validation`
      : "the migrated generation manifest could not be loaded";
  throw new Error(
    "Verified compatible PPO collection migration did not produce a reusable "
    + `resume (${detail}). Refusing to start a fresh collection.`
  );
}

async function prepareGameMigration(directory, manifest, sourceCollectionKey, targetDescriptor, workerIndex, gameIndex, options = {}) {
  const trajectories = [];
  const archives = [];
  for (let trajectoryIndex = 0; trajectoryIndex < manifest.trajectories.length; trajectoryIndex += 1) {
    const entry = manifest.trajectories[trajectoryIndex];
    const steps = [];
    const trajectoryArchives = [];
    for (let chunkIndex = 0; chunkIndex < entry.chunks.length; chunkIndex += 1) {
      const filename = path.join(directory, entry.chunks[chunkIndex]);
      const chunk = await readTrajectoryArchive(filename);
      if (chunk.collectionKey !== sourceCollectionKey || chunk.workerIndex !== workerIndex || chunk.gameIndex !== gameIndex
        || chunk.trajectoryIndex !== trajectoryIndex || chunk.chunkIndex !== chunkIndex || !Array.isArray(chunk.steps)) return null;
      steps.push(...chunk.steps);
      trajectoryArchives.push({ filename, payload: { ...chunk, collectionKey: targetDescriptor.collectionKey } });
    }
    if (steps.length !== entry.stepCount) return null;
    const migrated = migrateCompatibleTrainingTrajectory(
      { ...entry.metadata, steps },
      targetDescriptor.engineFingerprint,
      {
        preserveEquivalentTargets: options.preserveEquivalentTargets === true,
        verifiedEquivalentSemantics: options.verifiedEquivalentSemantics === true,
        behaviorTemperature: targetDescriptor.temperature,
        learningTargetVersion: targetDescriptor.learningTargetVersion,
        gamma: targetDescriptor.gamma,
        gaeLambda: targetDescriptor.gaeLambda,
        longHorizonLambda: targetDescriptor.longHorizonLambda,
        longHorizonWeight: targetDescriptor.longHorizonWeight
      }
    );
    if (!migrated) return null;
    if (options.preserveEquivalentTargets === true) {
      migrateEvaluatorBootstrapStructuredEvidenceFingerprints(
        migrated, entry.metadata.engineFingerprint, targetDescriptor.engineFingerprint
      );
    }
    const { steps: migratedSteps, ...metadata } = migrated;
    trajectories.push({ ...entry, metadata });
    archives.push(...trajectoryArchives.map((archive, chunkIndex) => ({
      ...archive,
      payload: { ...archive.payload, steps: migratedSteps.slice(chunkIndex * 128, chunkIndex * 128 + 128) }
    })));
  }
  return { trajectories, archives };
}

function sameCollectionConfiguration(source, target) {
  return collectionConfigurationDifferences(source, target).length === 0;
}

function collectionConfigurationDifferences(source, target) {
  const ignored = new Set([
    "version", "engineFingerprint", "collectionKey", "state", "createdAt", "population",
    "compatibilityMigration", "learningTargetVersion", "diagnosticWeight",
    "leagueSamplingMode", "leagueSamplingWeights",
    "postmortemReviews", "postmortemCaptureLimit",
    "postmortemAuditInterval", "postmortemWinnerReviewFraction", "postmortemSimulations",
    "postmortemDepth", "postmortemCandidates"
  ]);
  const clean = (value) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !ignored.has(key)));
  const left = clean(source);
  const right = clean(target);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
    .sort();
}

async function readJson(filename) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch { return null; }
}

async function writeJsonAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filename);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--")
    ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
  const dataRoot = path.resolve(args["data-dir"] || "data/ai");
  const generation = Math.max(1, Number(args.generation) || 1);
  const sourcePath = path.join(dataRoot, "resume", `generation-${String(generation).padStart(5, "0")}`, "manifest.json");
  const source = await readJson(sourcePath);
  if (!source) throw new Error(`No generation resume manifest exists at ${sourcePath}.`);
  const currentFingerprint = inspectTrainingPreflight().engineFingerprint;
  const target = createCollectionDescriptor({ ...source, engineFingerprint: currentFingerprint });
  const result = await migrateCompatibleCollection(dataRoot, target, args["from-fingerprint"], {
    sourceCollectionKey: args["source-collection-key"] || null
  });
  console.log(JSON.stringify({ targetCollectionKey: target.collectionKey, currentFingerprint, ...result }, null, 2));
}
