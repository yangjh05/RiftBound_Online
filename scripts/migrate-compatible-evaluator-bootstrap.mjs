import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readTrajectoryArchive,
  writeTrajectoryArchive
} from "../src/ai/neural/archive.mjs";
import {
  inspectTrainingPreflight,
  migrateCompatibleTrainingTrajectory
} from "./training-safety.mjs";
import {
  createEvaluatorBootstrapResultIndex
} from "./evaluator-bootstrap-index.mjs";
import {
  reclassifyTrajectoryAuditStrata
} from "../src/ai/neural/audit-strata.mjs";
import { renameWithRetry } from "./file-replace.mjs";
import {
  commitEvaluatorBootstrapSummary
} from "./evaluator-bootstrap-transaction.mjs";

const STATE_FILENAME = "bootstrap-state.json";
export const EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES = Object.freeze({
  preserve: "preserve-v1",
  observedHoldouts:
    "observed-holdouts-to-training-development-v1"
});

export function migratedEvaluatorBootstrapAllocationState(
  sourceState,
  options = {}
) {
  const targetDatasetKey = String(options.targetDatasetKey || "");
  const migratedAt = String(options.migratedAt || new Date().toISOString());
  if (!targetDatasetKey) {
    throw new Error("Target evaluator-bootstrap key is required.");
  }
  return {
    ...sourceState,
    version: 1,
    datasetKey: targetDatasetKey,
    status: "collecting",
    deckSeatSchedule: {
      version: "deck-seat-schedule-v2",
      boundaryGameIndex: Number(options.migratedGames) || 0,
      activatedAt: migratedAt
    },
    compatibilityMigration: structuredClone(options.compatibilityMigration),
    updatedAt: migratedAt
  };
}

export async function migrateCompatibleEvaluatorBootstrap(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || "data/ai");
  const sourceDatasetKey = String(options.sourceDatasetKey || "");
  const targetDatasetKey = String(options.targetDatasetKey || "");
  const sourceEngineFingerprint =
    String(options.sourceEngineFingerprint || "");
  const targetEngineFingerprint =
    String(options.targetEngineFingerprint
      || inspectTrainingPreflight().engineFingerprint);
  const migrationConcurrency = Math.max(
    1,
    Math.min(16, Number(options.concurrency) || 8)
  );
  const holdoutRolePolicy = String(
    options.holdoutRolePolicy
      || EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES.preserve
  );
  if (!Object.values(EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES)
    .includes(holdoutRolePolicy)) {
    throw new Error(
      `Unsupported evaluator-bootstrap holdout migration policy: ${holdoutRolePolicy}`
    );
  }
  if (!sourceDatasetKey || !targetDatasetKey) {
    throw new Error("Both source and target evaluator-bootstrap keys are required.");
  }
  if (!sourceEngineFingerprint || !targetEngineFingerprint) {
    throw new Error("Both source and target engine fingerprints are required.");
  }
  if (sourceDatasetKey === targetDatasetKey) {
    throw new Error("Source and target evaluator-bootstrap keys must differ.");
  }

  const root = path.join(dataRoot, "evaluator-bootstrap");
  const sourceDirectory = options.sourceDirectory
    ? path.resolve(options.sourceDirectory)
    : path.join(root, sourceDatasetKey);
  const targetDirectory = path.join(root, targetDatasetKey);
  const stagingDirectory = path.join(
    root,
    `.migration-${targetDatasetKey}-${process.pid}-${Date.now()}`
  );
  const sourceState = await readJson(path.join(
    sourceDirectory,
    STATE_FILENAME
  ));
  if (!sourceState) {
    throw new Error(`Missing source evaluator-bootstrap state: ${sourceDirectory}`);
  }
  const summaryNames = (await readdir(sourceDirectory))
    .filter((name) => /^worker-\d+-game-\d+\.summary\.json$/.test(name))
    .sort();
  if (!summaryNames.length) {
    throw new Error("Source evaluator-bootstrap dataset has no completed records.");
  }
  await mkdir(stagingDirectory, { recursive: true });

  let migratedGames = 0;
  let migratedTrajectories = 0;
  const roleReassignments = {};
  for (let offset = 0; offset < summaryNames.length; offset += migrationConcurrency) {
    await Promise.all(summaryNames
      .slice(offset, offset + migrationConcurrency)
      .map(async (summaryName) => {
        const summaryPath = path.join(sourceDirectory, summaryName);
        const archiveName = summaryName.replace(/\.summary\.json$/, ".json.gz");
        const archivePath = path.join(sourceDirectory, archiveName);
        const summary = await readJson(summaryPath);
        if (summary?.datasetKey !== sourceDatasetKey
          || !Number.isInteger(Number(summary.workerIndex))
          || !Number.isInteger(Number(summary.gameIndex))) {
          throw new Error(`Invalid evaluator-bootstrap summary: ${summaryName}`);
        }
        const sourceCertificationRole = summary.certificationRole || null;
        const targetCertificationRole = migratedCertificationRole(
          sourceCertificationRole,
          summary.samplingMode,
          holdoutRolePolicy
        );
        const roleTransition =
          `${sourceCertificationRole || "unassigned"}`
          + `->${targetCertificationRole || "unassigned"}`;
        roleReassignments[roleTransition] =
          (Number(roleReassignments[roleTransition]) || 0) + 1;
        const archive = await readTrajectoryArchive(archivePath);
        const recordArchive = archive?.result ? archive : null;
        const result = recordArchive?.result || archive;
        if (recordArchive
          && (recordArchive.datasetKey !== sourceDatasetKey
            || Number(recordArchive.workerIndex) !== Number(summary.workerIndex)
            || Number(recordArchive.gameIndex) !== Number(summary.gameIndex))) {
          throw new Error(`Evaluator-bootstrap archive identity mismatch: ${archiveName}`);
        }
        const trajectories = [];
        for (const trajectory of result?.trajectories || []) {
          if (trajectory.engineFingerprint !== sourceEngineFingerprint) {
            throw new Error(
              `Evaluator-bootstrap source fingerprint mismatch in ${archiveName}: `
              + `${trajectory.engineFingerprint || "missing"}`
            );
          }
          const migrated = migrateCompatibleTrainingTrajectory(
            trajectory,
            targetEngineFingerprint,
            {
              behaviorTemperature:
                Number(trajectory.steps?.[0]?.behaviorTemperature) || 0.85,
              learningTargetVersion: trajectory.learningTargetVersion,
              gamma: 0.997,
              gaeLambda: 0.95,
              longHorizonLambda: 0.985,
              longHorizonWeight: 0.6
            }
          );
          if (!migrated) {
            throw new Error(`Unsafe evaluator-bootstrap trajectory: ${archiveName}`);
          }
          migrateEvaluatorBootstrapStructuredEvidenceFingerprints(
            migrated,
            sourceEngineFingerprint,
            targetEngineFingerprint
          );
          migrated.evaluatorBootstrapCompatibilityMigration = {
            version: 2,
            fromDatasetKey: sourceDatasetKey,
            toDatasetKey: targetDatasetKey,
            fromEngineFingerprint: sourceEngineFingerprint,
            toEngineFingerprint: targetEngineFingerprint,
            holdoutRolePolicy,
            sourceCertificationRole,
            targetCertificationRole,
            sourceHoldoutObserved:
              sourceCertificationRole != null
          };
          reclassifyTrajectoryAuditStrata(migrated);
          trajectories.push(migrated);
          migratedTrajectories += 1;
        }
        const migratedArchivePath = path.join(
          stagingDirectory,
          archiveName
        );
        const migratedSummaryPath = path.join(
          stagingDirectory,
          summaryName
        );
        await writeTrajectoryArchive(
          migratedArchivePath,
          {
            version: 1,
            datasetKey: targetDatasetKey,
            workerIndex: Number(summary.workerIndex),
            gameIndex: Number(summary.gameIndex),
            samplingMode: summary.samplingMode,
            certificationRole: targetCertificationRole,
            result: {
              ...result,
              trajectories,
              pendingActionAudit: migratePendingActionAuditFingerprint(
                result?.pendingActionAudit,
                sourceEngineFingerprint,
                targetEngineFingerprint
              )
            },
            compatibilityMigration: {
              version: 2,
              fromDatasetKey: sourceDatasetKey,
              toDatasetKey: targetDatasetKey,
              fromEngineFingerprint: sourceEngineFingerprint,
              toEngineFingerprint: targetEngineFingerprint,
              holdoutRolePolicy,
              sourceCertificationRole,
              targetCertificationRole,
              sourceHoldoutObserved:
                sourceCertificationRole != null
            }
          }
        );
        const {
          archiveTransaction: _staleArchiveTransaction,
          ...summaryWithoutTransaction
        } = summary;
        await commitEvaluatorBootstrapSummary({
          archivePath: migratedArchivePath,
          summaryPath: migratedSummaryPath,
          summary: {
            ...summaryWithoutTransaction,
            datasetKey: targetDatasetKey,
            certificationRole: targetCertificationRole,
            resultIndex: createEvaluatorBootstrapResultIndex({
              ...result,
              trajectories
            }),
            compatibilityMigration: {
              version: 2,
              fromDatasetKey: sourceDatasetKey,
              toDatasetKey: targetDatasetKey,
              fromEngineFingerprint: sourceEngineFingerprint,
              toEngineFingerprint: targetEngineFingerprint,
              holdoutRolePolicy,
              sourceCertificationRole,
              targetCertificationRole,
              sourceHoldoutObserved:
                sourceCertificationRole != null
            }
          }
        });
        migratedGames += 1;
      }));
  }

  const migratedAt = new Date().toISOString();
  const compatibilityMigration = {
    version: 2,
    migratedAt,
    fromDatasetKey: sourceDatasetKey,
    toDatasetKey: targetDatasetKey,
    fromEngineFingerprint: sourceEngineFingerprint,
    toEngineFingerprint: targetEngineFingerprint,
    migratedGames,
    migratedTrajectories,
    holdoutRolePolicy,
    roleReassignments,
    holdoutIndependence: holdoutRolePolicy
      === EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES.observedHoldouts
      ? {
        trainingMayReuseObservedEvidence: true,
        developmentMayReuseObservedEvidence: true,
        confirmationRequiresFreshSeeds: true,
        finalAuditRequiresFreshSeeds: true
      }
      : null
  };
  await writeJson(
    path.join(stagingDirectory, STATE_FILENAME),
    migratedEvaluatorBootstrapAllocationState(sourceState, {
      targetDatasetKey,
      migratedAt,
      migratedGames,
      compatibilityMigration
    })
  );

  const backupDirectory = `${targetDirectory}-pre-migration-${Date.now()}`;
  let targetBackedUp = false;
  try {
    await renameWithRetry(targetDirectory, backupDirectory);
    targetBackedUp = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await renameWithRetry(stagingDirectory, targetDirectory);
  } catch (error) {
    if (targetBackedUp) {
      await rename(backupDirectory, targetDirectory).catch(() => {});
    }
    throw error;
  }
  return {
    sourceDatasetKey,
    targetDatasetKey,
    sourceEngineFingerprint,
    targetEngineFingerprint,
    migratedGames,
    migratedTrajectories,
    holdoutRolePolicy,
    roleReassignments,
    targetBackedUp,
    backupDirectory: targetBackedUp ? backupDirectory : null,
    deckSeatScheduleBoundaryGameIndex: migratedGames
  };
}

export function migrateEvaluatorBootstrapStructuredEvidenceFingerprints(
  trajectory,
  sourceEngineFingerprint,
  targetEngineFingerprint
) {
  if (!trajectory) return trajectory;
  const approvedSourceFingerprints = new Set([
    sourceEngineFingerprint,
    trajectory.evaluatorBootstrapCompatibilityMigration
      ?.fromEngineFingerprint,
    trajectory.replayCompatibility?.fromEngineFingerprint
  ].filter(Boolean));
  const migrateSnapshot = (snapshot) => {
    if (snapshot == null) return null;
    const snapshotSourceFingerprint = snapshot.engineFingerprint;
    if (!approvedSourceFingerprints.has(snapshotSourceFingerprint)) {
      throw new Error(
        "Structured evaluator evidence source fingerprint mismatch: "
        + `${snapshot.engineFingerprint || "missing"}.`
      );
    }
    if (snapshot.source === "viewer-public-transition") {
      migrateSnapshot(snapshot.preAction);
      migrateSnapshot(snapshot.postAction);
    }
    snapshot.engineFingerprint = targetEngineFingerprint;
    snapshot.compatibilityMigration = {
      version: 1,
      fromEngineFingerprint: snapshotSourceFingerprint,
      viaEngineFingerprint: sourceEngineFingerprint,
      toEngineFingerprint: targetEngineFingerprint
    };
    return snapshot;
  };
  const migrateLeafReference = (reference) => {
    for (const pair of reference?.pairs || []) {
      if (pair.correctStructuredState != null) {
        migrateSnapshot(pair.correctStructuredState);
      }
      if (pair.comparedStructuredState != null) {
        migrateSnapshot(pair.comparedStructuredState);
      }
    }
  };
  for (const step of trajectory.steps || []) {
    for (const pair of
      step.actionRankingAuditReference?.evaluatorStatePairs || []) {
      if (pair.recommendedStructuredState != null) {
        migrateSnapshot(pair.recommendedStructuredState);
      }
      if (pair.selectedStructuredState != null) {
        migrateSnapshot(pair.selectedStructuredState);
      }
    }
    migrateLeafReference(step.leafValueAuditReference);
    migrateLeafReference(
      step.actionRankingReference?.leafValueReference
    );
  }
  return trajectory;
}

function migratePendingActionAuditFingerprint(
  pendingActionAudit,
  sourceEngineFingerprint,
  targetEngineFingerprint
) {
  if (pendingActionAudit == null) return null;
  if (pendingActionAudit.executionContract
      !== "global-seed-batch-queue-v1"
    || !Array.isArray(pendingActionAudit.candidates)) {
    throw new Error(
      "Evaluator-bootstrap migration encountered an unsupported pending "
      + "action-audit contract."
    );
  }
  return {
    ...structuredClone(pendingActionAudit),
    candidates: pendingActionAudit.candidates.map((candidate) => {
      if (candidate?.engineFingerprint !== sourceEngineFingerprint) {
        throw new Error(
          "Pending action-audit source fingerprint mismatch: "
          + `${candidate?.engineFingerprint || "missing"}.`
        );
      }
      return {
        ...structuredClone(candidate),
        engineFingerprint: targetEngineFingerprint,
        compatibilityMigration: {
          version: 1,
          fromEngineFingerprint: sourceEngineFingerprint,
          toEngineFingerprint: targetEngineFingerprint
        }
      };
    })
  };
}

export function migratedCertificationRole(
  sourceRole,
  samplingMode,
  policy = EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES.preserve
) {
  const normalizedRole = sourceRole == null ? null : String(sourceRole);
  if (policy !== EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES
    .observedHoldouts) return normalizedRole;
  if (["calibration-only", "uniform-balanced"].includes(samplingMode)) {
    return null;
  }
  // Every old holdout has been observable through the completed Run C report.
  // It may teach or guide model selection, but it can no longer certify a
  // future artifact. Only newly collected seed namespaces may populate
  // confirmation and final-audit after this migration.
  if (normalizedRole === "confirmation") return "development";
  if (normalizedRole === "development"
    || normalizedRole === "final-audit"
    || normalizedRole == null) return "training";
  if (normalizedRole === "training") return "training";
  return "training";
}

async function readJson(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2)
    .map((value, index, all) =>
      value.startsWith("--") ? [value.slice(2), all[index + 1]] : null)
    .filter(Boolean));
  const result = await migrateCompatibleEvaluatorBootstrap({
    dataRoot: args["data-dir"],
    sourceDatasetKey: args["from-dataset-key"],
    targetDatasetKey: args["to-dataset-key"],
    sourceEngineFingerprint: args["from-fingerprint"],
    targetEngineFingerprint: args["to-fingerprint"],
    concurrency: args.concurrency,
    holdoutRolePolicy: args["holdout-role-policy"]
  });
  console.log(JSON.stringify(result, null, 2));
}
