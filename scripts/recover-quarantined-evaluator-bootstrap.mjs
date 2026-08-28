import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES,
  migrateCompatibleEvaluatorBootstrap
} from "./migrate-compatible-evaluator-bootstrap.mjs";

export async function recoverQuarantinedEvaluatorBootstrap(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || "data/ai");
  const sourceDatasetKey = String(options.sourceDatasetKey || "");
  const targetDatasetKey = String(options.targetDatasetKey || "");
  if (!sourceDatasetKey || !targetDatasetKey) {
    throw new Error("Source and target evaluator-bootstrap keys are required.");
  }
  const root = path.join(dataRoot, "evaluator-bootstrap");
  const sourceDirectory = path.join(root, sourceDatasetKey);
  const invalidDirectory = path.join(sourceDirectory, "invalid");
  const recoveryDirectory = path.join(
    root,
    `.quarantine-recovery-${sourceDatasetKey}-${process.pid}-${Date.now()}`
  );
  await mkdir(recoveryDirectory, { recursive: true });
  try {
    const sourceNames = await readdir(sourceDirectory);
    const canonicalSummaries = sourceNames
      .filter((name) => /^worker-\d+-game-\d+\.summary\.json$/.test(name))
      .sort();
    const invalidNames = await readdir(invalidDirectory);
    const selected = new Map();
    for (const name of invalidNames.filter((item) => item.endsWith(".summary.json"))) {
      const summaryPath = path.join(invalidDirectory, name);
      const summary = JSON.parse((await readFile(summaryPath, "utf8")).replace(/^\uFEFF/, ""));
      if (summary?.datasetKey !== sourceDatasetKey
        || summary?.resultIndex?.valid !== true
        || !Number.isInteger(Number(summary.workerIndex))
        || !Number.isInteger(Number(summary.gameIndex))) continue;
      const identity = `${Number(summary.workerIndex)}:${Number(summary.gameIndex)}`;
      const timestamp = Number(name.match(/-(\d+)\.summary\.json$/)?.[1]) || 0;
      const previous = selected.get(identity);
      if (!previous || timestamp > previous.timestamp) {
        selected.set(identity, { name, summary, timestamp });
      }
    }
    if (!selected.size) throw new Error("No valid quarantined records were found.");

    await copyFile(
      path.join(sourceDirectory, "bootstrap-state.json"),
      path.join(recoveryDirectory, "bootstrap-state.json")
    );
    const canonicalIdentities = new Set();
    for (const canonicalSummaryName of canonicalSummaries) {
      const canonicalSummary = JSON.parse(await readFile(
        path.join(sourceDirectory, canonicalSummaryName),
        "utf8"
      ));
      const identity = `${Number(canonicalSummary.workerIndex)}:${Number(canonicalSummary.gameIndex)}`;
      canonicalIdentities.add(identity);
      if (selected.has(identity)) {
        throw new Error(`Quarantined record collides with committed record: ${identity}.`);
      }
      const sourceSummaryPath = path.join(sourceDirectory, canonicalSummaryName);
      const sourceArchivePath = path.join(
        sourceDirectory,
        canonicalSummaryName.replace(/\.summary\.json$/, ".json.gz")
      );
      const targetSummaryPath = path.join(recoveryDirectory, canonicalSummaryName);
      const targetArchivePath = targetSummaryPath.replace(/\.summary\.json$/, ".json.gz");
      await Promise.all([
        copyFile(sourceSummaryPath, targetSummaryPath),
        copyFile(sourceArchivePath, targetArchivePath)
      ]);
    }
    let recovered = 0;
    for (const { name, summary } of selected.values()) {
      const identity = `${Number(summary.workerIndex)}:${Number(summary.gameIndex)}`;
      if (canonicalIdentities.has(identity)) {
        throw new Error(`Duplicate recovery identity: ${identity}.`);
      }
      const canonicalName =
        `worker-${String(Number(summary.workerIndex)).padStart(3, "0")}`
        + `-game-${String(Number(summary.gameIndex)).padStart(5, "0")}`;
      const sourceSummaryPath = path.join(invalidDirectory, name);
      await Promise.all([
        copyFile(
          sourceSummaryPath,
          path.join(recoveryDirectory, `${canonicalName}.summary.json`)
        ),
        copyFile(
          sourceSummaryPath.replace(/\.summary\.json$/, ".json.gz"),
          path.join(recoveryDirectory, `${canonicalName}.json.gz`)
        )
      ]);
      recovered += 1;
    }
    const migration = await migrateCompatibleEvaluatorBootstrap({
      dataRoot,
      sourceDatasetKey,
      targetDatasetKey,
      sourceEngineFingerprint: options.sourceEngineFingerprint,
      targetEngineFingerprint: options.targetEngineFingerprint,
      holdoutRolePolicy:
        EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES.preserve,
      sourceDirectory: recoveryDirectory,
      concurrency: options.concurrency || 8
    });
    return { ...migration, recoveredQuarantinedRecords: recovered };
  } finally {
    await rm(recoveryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((item) => {
    const [key, ...value] = item.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }));
  const result = await recoverQuarantinedEvaluatorBootstrap({
    dataRoot: args["data-root"],
    sourceDatasetKey: args["source-key"],
    targetDatasetKey: args["target-key"],
    sourceEngineFingerprint: args["source-fingerprint"],
    targetEngineFingerprint: args["target-fingerprint"],
    concurrency: Number(args.concurrency) || 8
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
