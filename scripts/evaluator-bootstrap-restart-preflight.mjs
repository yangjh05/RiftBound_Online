import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import {
  evaluatorBootstrapDatasetKey
} from "./evaluator-bootstrap.mjs";

export async function inspectEvaluatorBootstrapRestart(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || "data/ai");
  const sourceDatasetKey = String(options.sourceDatasetKey || "");
  const targetEngineFingerprint = String(
    options.targetEngineFingerprint || ""
  );
  const parentProcessId = Number(options.parentProcessId) || null;
  if (!sourceDatasetKey || !targetEngineFingerprint) {
    throw new Error(
      "Evaluator restart preflight requires source dataset key and target fingerprint."
    );
  }
  const requestDirectory = path.join(
    dataRoot,
    "resume",
    "evaluator-bootstrap-stage"
  );
  const requests = [];
  for (const name of await readdir(requestDirectory).catch(() => [])) {
    if (!name.endsWith(".request.json")) continue;
    const filename = path.join(requestDirectory, name);
    const request = await readJson(filename);
    if (!request?.options?.engineFingerprint) continue;
    if (path.resolve(request.options.dataRoot || "") !== dataRoot) continue;
    requests.push({
      filename,
      request,
      parentMatched: parentProcessId == null
        || Number(request.metadata?.parentProcessId) === parentProcessId
    });
  }
  requests.sort((left, right) => String(
    right.request.createdAt || right.request.metadata?.stageId || ""
  ).localeCompare(String(
    left.request.createdAt || left.request.metadata?.stageId || ""
  )));
  // The memory-isolated evaluator stage can finish under an earlier parent
  // process and hand its committed dataset to a resumed trainer. Prefer an
  // exact current-parent request, but do not reject the same data root and
  // exact dataset key solely because the trainer PID changed. The committed
  // archive fingerprint is validated below before this request is trusted.
  const exact = requests.filter(({ request }) =>
    evaluatorBootstrapDatasetKey(request.options) === sourceDatasetKey
  );
  let selected = exact.find((item) => item.parentMatched) || exact[0];
  const sourceDirectory = path.join(
    dataRoot,
    "evaluator-bootstrap",
    sourceDatasetKey
  );
  const sourceState = await readJson(path.join(
    sourceDirectory,
    "bootstrap-state.json"
  ));
  let requestResolvedViaMigration = false;
  let sourceEngineFingerprint = selected
    ? String(selected.request.options.engineFingerprint)
    : "";
  if (!selected) {
    const migration = sourceState?.compatibilityMigration;
    const migrationSourceKey = String(migration?.fromDatasetKey || "");
    const migrationTargetKey = String(migration?.toDatasetKey || "");
    const migrationTargetFingerprint = String(
      migration?.toEngineFingerprint || ""
    );
    const migratedRequestCandidates = requests.filter(({ request }) =>
      evaluatorBootstrapDatasetKey(request.options) === migrationSourceKey
    );
    const migratedRequest = migratedRequestCandidates.find(
      (item) => item.parentMatched
    ) || migratedRequestCandidates[0];
    const reproducedMigratedKey = migratedRequest
      ? evaluatorBootstrapDatasetKey({
        ...migratedRequest.request.options,
        engineFingerprint: migrationTargetFingerprint
      })
      : null;
    if (migration?.version >= 2
      && migrationSourceKey
      && migrationTargetKey === sourceDatasetKey
      && migrationTargetFingerprint
      && migratedRequest
      && reproducedMigratedKey === sourceDatasetKey) {
      selected = migratedRequest;
      sourceEngineFingerprint = migrationTargetFingerprint;
      requestResolvedViaMigration = true;
    }
  }
  if (!selected) {
    throw new Error(
      "No evaluator stage request exactly reproduces the source dataset key."
    );
  }
  const names = await readdir(sourceDirectory);
  const summaryNames = names.filter((name) =>
    /^worker-\d+-game-\d+\.summary\.json$/.test(name)
  ).sort();
  const archiveNames = names.filter((name) =>
    /^worker-\d+-game-\d+\.json\.gz$/.test(name)
  ).sort();
  if (!summaryNames.length || !archiveNames.length) {
    throw new Error("Source evaluator dataset has no committed games.");
  }
  const sampleArchive = await readTrajectoryArchive(
    path.join(sourceDirectory, archiveNames[0])
  );
  const sampleResult = sampleArchive?.result || sampleArchive;
  const sampleTrajectory = sampleResult?.trajectories?.[0];
  if (sampleTrajectory?.engineFingerprint !== sourceEngineFingerprint) {
    throw new Error(
      "Source evaluator request and committed trajectory fingerprints differ."
    );
  }
  const targetDatasetKey = evaluatorBootstrapDatasetKey({
    ...selected.request.options,
    engineFingerprint: targetEngineFingerprint
  });
  const targetState = await readJson(path.join(
    dataRoot,
    "evaluator-bootstrap",
    targetDatasetKey,
    "bootstrap-state.json"
  ));
  return {
    version: 1,
    sourceDatasetKey,
    sourceEngineFingerprint,
    targetDatasetKey,
    targetEngineFingerprint,
    migrationRequired: targetDatasetKey !== sourceDatasetKey,
    sourceCommittedGames: summaryNames.length,
    sourceAcceptedGames: Number(sourceState?.acceptedGames)
      || summaryNames.length,
    sourceAllocationStatus: sourceState?.status || null,
    requestPath: selected.filename,
    requestStageId: selected.request.metadata?.stageId || null,
    requestParentMatched: selected.parentMatched,
    requestResolvedViaMigration,
    targetStateExists: targetState != null,
    targetCompatibilityMigration: targetState?.compatibilityMigration || null,
    targetAcceptedGames: Number(targetState?.acceptedGames) || 0
  };
}

async function readJson(filename) {
  try {
    return JSON.parse(
      (await readFile(filename, "utf8")).replace(/^\uFEFF/, "")
    );
  } catch {
    return null;
  }
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2)
    .map((value, index, all) =>
      value.startsWith("--") ? [value.slice(2), all[index + 1]] : null)
    .filter(Boolean));
  const result = await inspectEvaluatorBootstrapRestart({
    dataRoot: args["data-dir"],
    sourceDatasetKey: args["source-dataset-key"],
    targetEngineFingerprint: args["target-engine-fingerprint"],
    parentProcessId: args["parent-process-id"]
  });
  console.log(JSON.stringify(result));
}
