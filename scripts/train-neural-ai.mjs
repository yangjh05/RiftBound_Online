import { mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import {
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { fork, spawn } from "node:child_process";
import { freemem, totalmem } from "node:os";
import path from "node:path";
import { decklists } from "../src/cards.mjs";
import { mutateDeck } from "../src/ai/deckbuilding.mjs";
import { createNeuralModel, deserializeNeuralModel, estimateEncodedNeuralValue, estimateEvidenceNeuralValue, serializeNeuralModel } from "../src/ai/neural/model.mjs";
import { tf } from "../src/ai/neural/tf-runtime.mjs";
import { MAX_SEQUENCE, STATE_DIM } from "../src/ai/neural/encoding.mjs";
import {
  attachEvaluatorArchitecture,
  createStructuredV2TensorInput,
  disposeStructuredV2TensorInput,
  EVALUATOR_ARCHITECTURE_CONTRACT,
  EVALUATOR_ARCHITECTURE_SPECS,
  EVALUATOR_TARGET_HEADS,
  evaluatorArchitecture,
  evaluatorLayerNames,
  evaluatorPathId,
  evaluatorRequiresStructuredV2,
  forwardEvaluatorValue
} from "../src/ai/neural/evaluator-architecture.mjs";
import {
  EVALUATOR_AUDIT_CORE_ACTION_CLASSES,
  EVALUATOR_AUDIT_PHASE_BANDS,
  normalizeEvaluatorAuditStratum
} from "../src/ai/neural/audit-strata.mjs";
import {
  validActionRankingAuditReference,
  validActionRankingReference,
  validIndependentLeafValueReference,
  validLeafValueReference
} from "../src/ai/neural/action-ranking-reference.mjs";
import { auditEvaluationScheduleSymmetry, evaluateNeuralAgainstHeuristic, evaluateNeuralLeague, evaluateNeuralModels, mergeNeuralEvaluations, NEURAL_LEARNING_TARGET_VERSION, seededRandom, selectUnderperformingDeckCurriculum, TRAINING_SCHEDULE_CYCLE_BLOCKS } from "../src/ai/neural/selfplay.mjs";
import { collectProcessPoolSelfPlay } from "./ai-selfplay-process-pool.mjs";
import {
  migrateCompatibleCollection,
  requireCompatibleCollectionResume
} from "./migrate-compatible-ai-collection.mjs";
import {
  accumulateActionRankingAudit,
  accumulateLeafValueRankingAudit,
  calibrateValueSamples,
  createActionRankingAuditAccumulator,
  createEvaluatorTrainingBalanceProfile,
  createLeafValueRankingAuditAccumulator,
  evaluateBehaviorCloning,
  evaluatorValueTrainingSamples,
  evaluateCalibratedValueSamples,
  evaluateValueCalibration,
  finalizeActionRankingAudit,
  finalizeLeafValueRankingAudit,
  policyConditionedActionCorrectionTrajectories,
  restoreAdamOptimizer,
  serializeOptimizer,
  stratifiedChunkOrder,
  summarizeTrainingStrata,
  trainBehaviorCloning,
  trainEvaluatorFromAuditEvidence,
  trainRecurrentPpo
} from "../src/ai/neural/trainer.mjs";
import {
  isAiSpectatorReplayTooLargeError,
  storeAiSpectatorReplay,
  writeAiStatus as writeAiStatusFile
} from "../server/ai-data.mjs";
import { applyMetaSnapshot } from "../src/ai/meta.mjs";
import { hydrateHumanReplayTrajectories } from "../src/ai/human-data.mjs";
import { buildMetaPreset } from "../src/ai/meta-presets.mjs";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { extractTurningPointReplays, sampleTurningPointReplays } from "../src/ai/neural/turning-point-replay.mjs";
import {
  createCollectionDescriptor,
  createEvaluationDescriptor,
  loadEvaluationGames,
  loadCompletedCollection,
  loadAvailablePersistedCollection,
  loadGenerationResume,
  loadPersistedCollection,
  saveCompletedCollection,
  saveCollectedGame,
  saveEvaluationGame,
  saveGenerationResume,
  writeTrainingFailure
} from "../src/ai/neural/training-resume.mjs";
import { assertTrainingPreflight, assertTrainingTrajectories, migrateCompatibleTrainingTrajectory } from "./training-safety.mjs";
import { FOCUSED_TRAINING_DECK_IDS, resolveTrainingDecks, sameLegendIdentity } from "../src/ai/training-decks.mjs";
import {
  compareRetentionByDeck,
  evaluateDeckSafety,
  evaluateLearnerAdvance,
  retentionCompositeScore,
  robustEpochSelection,
  summarizePracticalEvaluation
} from "./training-retention.mjs";
import { balanceTrainingTrajectories, splitIndependentTrainingPartitions } from "./training-sampling.mjs";
import {
  appendFileWithRetrySync,
  isRetryableFileReplaceError,
  renameWithRetry,
  renameWithRetrySync
} from "./file-replace.mjs";
import { withFileLock } from "./file-lock.mjs";
import {
  createEvaluatorCertificate,
  EVALUATOR_CERTIFICATE_KINDS,
  EVALUATOR_CERTIFICATE_VERSION,
  evaluatorCertificateStatus,
  neuralArtifactHash,
  neuralBehaviorHash,
  neuralEvaluatorLeafHash,
  selectEvaluatorOnlyArtifact
} from "../src/ai/neural/evaluator-certification.mjs";
import {
  certifiedContinuationStrength,
  createContinuationDiversityCertificates,
  createContinuationStrengthCertificate,
  createFixedContinuationBehaviorProbe,
  selectCertifiedIndependentContinuationPool,
  validFixedContinuationBehaviorProbe
} from "../src/ai/neural/continuation-certification.mjs";
import {
  collectionContractForRun,
  compareAbExperimentManifest,
  compareAbTrainingContract,
  createAbExperimentClaim,
  diagnosticArtifactRole,
  normalizeExperimentId,
  officialCandidateCheckpointEligible,
  protectedFinalAuditGamesForRun,
  teacherDoseStatusForRun,
  teacherConsumptionPolicyForRun
} from "./training-experiment-contract.mjs";
import {
  currentHoldoutProvenanceEntries,
  filterTrainingEligibleReplayEntries,
  mergeHoldoutProvenance
} from "./training-holdout-provenance.mjs";
import {
  deterministicTrainingTrajectoryDigest,
  deterministicValueDigest,
  TRAINING_INPUT_DIGEST_VERSION
} from "./training-input-digest.mjs";
import {
  loadFrozenEvaluatorRegistry,
  registerFrozenEvaluator
} from "./evaluator-registry.mjs";
import {
  EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS,
  EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS,
  EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS,
  EVALUATOR_EVIDENCE_PARTITIONS,
  EVALUATOR_TRAINING_PARTITION,
  evaluatorBootstrapActionAuditProcesses,
  evaluatorBootstrapMaximumActionAuditProcesses,
  evaluatorBootstrapDatasetKey,
  iterateEvaluatorBootstrapRecords,
  loadEvaluatorBootstrap,
  partitionEvaluatorBootstrapRecords,
  selectBalancedEvaluatorBootstrapRecords,
  selectEvaluatorCertificationGames,
  summarizeEvaluatorBootstrap
} from "./evaluator-bootstrap.mjs";
import { migrateCompatibleEvaluatorBootstrap } from "./migrate-compatible-evaluator-bootstrap.mjs";
import {
  serializeEvaluatorBootstrapStageRequest
} from "./evaluator-bootstrap-stage-handoff.mjs";
import {
  EVALUATOR_EARLY_DIAGNOSTIC_CHECKPOINTS,
  bootstrapStratifiedGameAccuracyInterval,
  expandEvaluatorEarlyDiagnosticRequirement,
  evaluatorEarlyDiagnosticStatus,
  evaluatorEarlyDiagnosticSplitEvidenceRequirement,
  evaluatorEarlyDiagnosticTrainingRequirement,
  splitEvaluatorEarlyDiagnosticRecords,
  summarizeEvaluatorEarlyDiagnosticEvidence
} from "./evaluator-early-diagnostic.mjs";
import {
  classifyPolicyQShadowReadiness,
  expandPolicyQShadowReadinessRequirement,
  POLICY_Q_SHADOW_READINESS_CONTRACT,
  POLICY_Q_SHADOW_READINESS_GRID,
  POLICY_Q_SHADOW_MODEL_TRAINING_NAMESPACE_HASH,
  POLICY_Q_FORMAL_AUDIT_CONTRACT,
  policyQFormalAuditStatus,
  policyQShadowActionEffectGateStatus,
  policyQShadowSelectionSignal,
  policyQShadowCollectionRoles,
  policyQShadowConfigurationGrid,
  policyQShadowLegacyReadinessGridHash,
  policyQShadowReadinessDemand,
  policyQShadowReadinessGridHash,
  selectPolicyQShadowArchitectures,
  selectPolicyQShadowConfiguration
} from "./evaluator-policy-q-readiness.mjs";
import { TEACHER_LABEL_VERSION } from "../src/ai/neural/teacher-contract.mjs";
import {
  ACTION_EVIDENCE_PROTOCOL_CONTRACT,
  assessActionEvidence,
  createActionEvidenceProtocolManifest
} from "../src/ai/neural/evidence-protocol.mjs";
import {
  ACTION_RANKING_AUDIT_REFERENCE_VERSION,
  ACTION_RANKING_REFERENCE_VERSION,
  LEAF_VALUE_REFERENCE_VERSION
} from "../src/ai/neural/action-ranking-reference.mjs";

// The main training pipeline executes before the helper declarations later in
// this module are reached. Keep shared helper state above that top-level entry
// point so a resumed Policy-Q shadow stage cannot observe it in the TDZ.
const evaluatorTrainingBalanceProfileCache = new Map();

const trainingPreflight = assertTrainingPreflight();
const engineFingerprint = trainingPreflight.engineFingerprint;

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
if (args["evaluator-development-candidate-worker"]) {
  await runEvaluatorDevelopmentCandidateWorker(
    path.resolve(args["evaluator-development-candidate-worker"])
  );
  process.exit(process.exitCode || 0);
}
const requestedRunContract = String(args["run-contract"]
  || (args["diagnostic-run"] === "true" ? "A" : "C")).toUpperCase();
if (!["A", "B", "C"].includes(requestedRunContract)) {
  throw new Error("--run-contract must be A, B, or C.");
}
const runContract = requestedRunContract;
const officialPromotionRun = runContract === "C";
const diagnosticRun = !officialPromotionRun;
const experimentId = officialPromotionRun
  ? null
  : normalizeExperimentId(args["experiment-id"]);
const teacherConsumptionPolicy = teacherConsumptionPolicyForRun(runContract);
const collectionRunContract = collectionContractForRun(runContract);
if (!officialPromotionRun && args["force-promote"] === "true") {
  throw new Error(`Run ${runContract} cannot force-promote a candidate.`);
}
const compatibleCollectionFingerprint = args["compatible-collection-fingerprint"] || null;
const compatibleCollectionKey = args["compatible-collection-key"] || null;
const verifiedCompatibleCollectionMigration = args["verified-compatible-collection-migration"] === "true";
if (Boolean(compatibleCollectionFingerprint) !== Boolean(compatibleCollectionKey)) {
  throw new Error(
    "Compatible collection migration requires both "
    + "--compatible-collection-fingerprint and --compatible-collection-key."
  );
}
if ((compatibleCollectionFingerprint || compatibleCollectionKey)
  && !verifiedCompatibleCollectionMigration) {
  throw new Error(
    "--compatible-collection-fingerprint may only be used with "
    + "--verified-compatible-collection-migration true after semantic replay validation. "
    + "Matching neural tensor dimensions alone does not make old trajectories compatible."
  );
}
const compatibleRuntimeFingerprint =
  args["compatible-runtime-fingerprint"] || null;
const compatibleEvaluatorBootstrapKey =
  args["compatible-evaluator-bootstrap-key"] || null;
const compatibleEvaluatorRuntimeFingerprint =
  args["compatible-evaluator-runtime-fingerprint"]
  || compatibleRuntimeFingerprint;
const verifiedCompatibleRuntimeMigration =
  args["verified-compatible-runtime-migration"] === "true";
if ((compatibleRuntimeFingerprint
    || compatibleEvaluatorRuntimeFingerprint
    || compatibleEvaluatorBootstrapKey)
  && !verifiedCompatibleRuntimeMigration) {
  throw new Error(
    "Runtime or evaluator-bootstrap compatibility migration requires "
    + "--verified-compatible-runtime-migration true."
  );
}
if (compatibleEvaluatorBootstrapKey
  && !compatibleEvaluatorRuntimeFingerprint) {
  throw new Error(
    "Evaluator-bootstrap migration requires "
    + "--compatible-evaluator-runtime-fingerprint (or the shared "
    + "--compatible-runtime-fingerprint)."
  );
}
const checkpointPath = path.resolve(args.output || "src/ai/checkpoints/neural-champion.json");
const dataRoot = path.resolve(args["data-dir"] || "data/ai");
const stopRequestPath = path.resolve(
  args["stop-request-path"]
    || path.join(dataRoot, "stop-after-current-games.request.json")
);
const learnerCheckpointPath = path.resolve(args["learner-output"] || path.join(dataRoot, "learner", "neural-learner.json"));
const optimizerStatePath = path.join(dataRoot, "learner", "optimizer-state.json");
const explicitWarmStartPath = args["warm-start-checkpoint"]
  ? path.resolve(args["warm-start-checkpoint"])
  : null;
const writeAiStatus = (status) => writeAiStatusFile(status, dataRoot);
const generations = args.continuous === "true" ? Infinity : Math.max(1, Number(args.generations) || 1);
if (!officialPromotionRun && generations !== 1) {
  throw new Error("Controlled Run A/B experiments must use exactly one generation.");
}
const requestedGames = Math.max(1, Number(args.games) || 32);
const evaluationGames = Math.max(4, Math.ceil((Number(args["evaluation-games"]) || 40) / 4) * 4);
const maxActions = Math.max(80, Number(args["max-actions"]) || 600);
const evaluationMaxActions = Math.max(maxActions, Number(args["evaluation-max-actions"]) || 1200);
const evaluationCompletionRate = Math.max(0.8, Math.min(1, Number(args["evaluation-completion-rate"]) || 0.9));
const teacherFraction = Math.max(0, Math.min(1, Number(args["teacher-fraction"]) || 0.12));
const teacherBudget = Math.max(0, Number(args["teacher-budget"]) || 16);
const teacherCriticalBudget = Math.max(0, Number(args["teacher-critical-budget"]) || 8);
const teacherUrgentBudgetValue = Number(args["teacher-urgent-budget"]);
const teacherUrgentBudget = Number.isFinite(teacherUrgentBudgetValue) ? Math.max(0, teacherUrgentBudgetValue) : 4;
const teacherScreenSimulations = Math.max(2, Math.min(4,
  Number(args["teacher-screen-simulations"] ?? args["teacher-simulations"]) || 4));
const teacherConfirmationSimulations = Math.max(8, Math.min(32,
  Number(args["teacher-confirmation-simulations"]) || 16));
const teacherConfirmationMaxSimulations = Math.max(
  teacherConfirmationSimulations,
  Math.min(32, Number(args["teacher-confirmation-max-simulations"]) || 32)
);
const teacherDepth = Math.max(2, Number(args["teacher-depth"]) || 10);
const teacherCandidates = Math.max(2, Number(args["teacher-candidates"]) || 6);
const teacherLeafAuditSimulations = Math.max(
  4,
  Math.min(16, Number(args["teacher-leaf-audit-simulations"]) || 8)
);
const teacherLeafAuditSchedule = [128];
const teacherActionAuditBudget = Math.max(
  0,
  Math.min(4, Number(args["teacher-action-audit-budget"]) || 4)
);
const teacherActionAuditMaximumSteps = Math.max(
  192,
  Math.min(
    1200,
    Number(args["teacher-action-audit-maximum-steps"]) || 1200
  )
);
const configuredPostmortemReviews = Number(args["postmortem-reviews"]);
const postmortemReviews = Math.max(0, Math.min(4,
  Number.isFinite(configuredPostmortemReviews) ? configuredPostmortemReviews : 2));
const postmortemCaptureLimit = Math.max(2, Math.min(12, Number(args["postmortem-capture-limit"]) || 8));
const postmortemAuditInterval = Math.max(6, Math.min(32,
  Number(args["postmortem-audit-interval"]) || 12));
const configuredPostmortemWinnerReviewFraction = Number(args["postmortem-winner-review-fraction"]);
const postmortemWinnerReviewFraction = Math.max(0, Math.min(1,
  Number.isFinite(configuredPostmortemWinnerReviewFraction)
    ? configuredPostmortemWinnerReviewFraction
    : 0.15));
const postmortemSimulations = Math.max(8, Math.min(32, Number(args["postmortem-simulations"]) || 16));
const postmortemDepth = Math.max(10, Math.min(96, Number(args["postmortem-depth"]) || Math.max(16, teacherDepth)));
const postmortemCandidates = Math.max(2, Math.min(12, Number(args["postmortem-candidates"]) || teacherCandidates));
const replayEvery = Math.max(1, Number(args["replay-every"]) || 8);
const teacherCoefficientValue = Number(args["teacher-coefficient"]);
const teacherCoefficient = Number.isFinite(teacherCoefficientValue) ? Math.max(0, teacherCoefficientValue) : 0.2;
const teacherPolicyPreferenceCoefficientValue = Number(args["teacher-policy-preference-coefficient"]);
const teacherPolicyPreferenceCoefficient = Number.isFinite(teacherPolicyPreferenceCoefficientValue)
  ? Math.max(0, teacherPolicyPreferenceCoefficientValue)
  : 0.5;
const teacherRankingCoefficientValue = Number(args["teacher-ranking-coefficient"]);
const teacherRankingCoefficient = Number.isFinite(teacherRankingCoefficientValue) ? Math.max(0, teacherRankingCoefficientValue) : 0.3;
const teacherActionValueCoefficientValue = Number(args["teacher-action-value-coefficient"]);
const teacherActionValueCoefficient = Number.isFinite(teacherActionValueCoefficientValue)
  ? Math.max(0, teacherActionValueCoefficientValue)
  : 0.25;
const teacherCorrectionFractionValue = Number(args["teacher-correction-fraction"]);
const teacherCorrectionFraction = Number.isFinite(teacherCorrectionFractionValue)
  ? Math.max(0, Math.min(0.5, teacherCorrectionFractionValue))
  : 0.35;
const policyConditionedActorCorrectionEnabled = runContract === "C"
  && args["policy-conditioned-actor-correction"] !== "false";
const policyConditionedActorCorrectionMaximum = Math.max(
  0,
  Math.floor(Number(args["policy-conditioned-actor-correction-maximum"]) || 256)
);
const policyConditionedActorCorrectionFraction = Math.max(
  0,
  Math.min(
    0.2,
    Number(args["policy-conditioned-actor-correction-fraction"]) || 0.15
  )
);
const diagnosticWeightValue = Number(args["diagnostic-weight"]);
const diagnosticWeight = Number.isFinite(diagnosticWeightValue) ? Math.max(0, diagnosticWeightValue) : 0;
const gamma = Math.max(0.9, Math.min(1, Number(args.gamma) || 0.997));
const gaeLambda = Math.max(0.8, Math.min(1, Number(args["gae-lambda"]) || 0.95));
const longHorizonLambda = Math.max(gaeLambda, Math.min(1, Number(args["long-horizon-lambda"]) || 0.985));
const longHorizonWeightValue = Number(args["long-horizon-weight"]);
const longHorizonWeight = Number.isFinite(longHorizonWeightValue)
  ? Math.max(0, Math.min(1, longHorizonWeightValue))
  : 0.6;
const retentionFraction = Math.max(0, Math.min(0.25,
  Number(args["retention-fraction"] ?? args["calibration-fraction"]) || 0.1));
const calibrationFitFraction = Math.max(0, Math.min(0.25,
  Number(args["calibration-fit-fraction"]) || 0.05));
const calibrationTestFraction = Math.max(0, Math.min(0.25,
  Number(args["calibration-test-fraction"]) || 0.05));
const evaluatorAuditFraction = Math.max(0, Math.min(0.25,
  Number(args["evaluator-audit-fraction"]) || 0.05));
const configuredMinimumRetentionTrajectories = Number(args["retention-trajectories-per-deck"]);
const minimumRetentionTrajectoriesPerDeck = Math.max(
  1,
  Number.isFinite(configuredMinimumRetentionTrajectories)
    ? Math.floor(configuredMinimumRetentionTrajectories)
    : 4
);
const configuredMinimumTrainingTrajectories = Number(args["training-trajectories-per-deck"]);
const minimumTrainingTrajectoriesPerDeck = Math.max(
  2,
  Number.isFinite(configuredMinimumTrainingTrajectories)
    ? Math.floor(configuredMinimumTrainingTrajectories)
    : 6
);
const turningPointReplayFraction = Math.max(0, Math.min(0.35, Number(args["turning-point-replay-fraction"]) || 0.3));
const turningPointReplayLimit = Math.max(0, Number(args["turning-point-replay-limit"]) || 256);
const evaluationMode = args["evaluation-mode"] || "cross-deck-matrix-v1";
const leagueSamplingMode = args["league-sampling"] || "pfsp";
const evaluationGreedy = args["evaluation-greedy"] !== "false";
const evaluationTemperature = Math.max(0.05, Number(args["evaluation-temperature"]) || 0.05);
const anchorCoefficient = Math.max(0, Number(args["anchor-coefficient"]) || 0.03);
const warmStartAnchorCoefficient = Math.max(
  0,
  Number.isFinite(Number(args["warm-start-anchor-coefficient"]))
    ? Number(args["warm-start-anchor-coefficient"])
    : 0.005
);
const warmStartAnchorEpochs = Math.max(0, Math.floor(
  Number.isFinite(Number(args["warm-start-anchor-epochs"]))
    ? Number(args["warm-start-anchor-epochs"])
    : 2
));
const learnerAnchorWeight = Math.max(0, Number(args["learner-anchor-weight"]) || 0.75);
const championAnchorWeight = Math.max(0, Number(args["champion-anchor-weight"]) || 0.25);
const configuredLearningRate = Math.max(0.000001, Number(args["learning-rate"]) || 0.00015);
const runStatePath = path.join(dataRoot, "resume", "run.json");
const persistedRunState = await readCheckpoint(runStatePath);
const savedRunState = args.fresh === "true" ? null : persistedRunState;
const seed = (Number(args.seed) || savedRunState?.seed || Date.now()) >>> 0;
const retryIteration = args["retry-iteration"] == null ? null : Number(args["retry-iteration"]);
const latestRetryableIteration = (Number(persistedRunState?.trainingIteration) || 0) + 1;
if (retryIteration != null && (!Number.isInteger(retryIteration) || retryIteration < 1 || retryIteration > latestRetryableIteration)) {
  throw new Error(`retry-iteration must reference an existing iteration (requested ${args["retry-iteration"]}).`);
}
let trainingIteration = retryIteration == null
  ? Math.max(0, Number(persistedRunState?.trainingIteration) || 0)
  : retryIteration - 1;
await writeCheckpoint(runStatePath, {
  version: 4,
  runContract,
  experimentId,
  teacherConsumptionPolicy,
  seed,
  trainingIteration,
  retryIteration,
  updatedAt: new Date().toISOString()
});
const cardPoolId = args["card-pool"] || "origins-era";
const trainingDecks = resolveTrainingDecks(decklists, cardPoolId, args["deck-ids"] || FOCUSED_TRAINING_DECK_IDS);
const trainingDeckIds = trainingDecks.map((deck) => deck.id);
// Every A/B/C run uses the same complete balanced collection contract. A/B
// differ only in whether recorded teacher signals are consumed by training.
const minimumBalancedGames = trainingDeckIds.length > 1 ? TRAINING_SCHEDULE_CYCLE_BLOCKS * 4 : 4;
const games = Math.max(requestedGames, minimumBalancedGames);
const workers = Math.max(1, Number(args.workers) || Math.min(4, games));
const collectionProcesses = Math.max(1, Math.min(games, Number(args.processes) || workers));
const perfProfile = args["perf-profile"] === "true";
const evaluationScheduleAudit = auditEvaluationScheduleSymmetry(evaluationGames, {
  evaluationMode
});
if (!evaluationScheduleAudit.passed) throw new Error(`Evaluation schedule symmetry audit failed: ${JSON.stringify(evaluationScheduleAudit)}`);
// Canonical deck training is the safe default. Deck evolution must be opted in
// explicitly because it changes both matchup strength and the learning target.
const evolveDecks = args["evolve-decks"] === "true";
const storedChampionCheckpoint = await readCheckpoint(checkpointPath);
const explicitWarmStartCheckpoint = explicitWarmStartPath
  ? await readCheckpoint(explicitWarmStartPath)
  : null;
if (explicitWarmStartPath && !explicitWarmStartCheckpoint) {
  throw new Error(`Warm-start checkpoint could not be read: ${explicitWarmStartPath}`);
}
let championCheckpoint = isCurrentEngineValidatedCheckpoint(
  storedChampionCheckpoint,
  engineFingerprint
)
  ? storedChampionCheckpoint
  : migrateVerifiedCompatibleCheckpoint(
    storedChampionCheckpoint,
    compatibleRuntimeFingerprint,
    engineFingerprint,
    verifiedCompatibleRuntimeMigration
  );
if (storedChampionCheckpoint && !championCheckpoint) {
  console.warn(
    `Keeping checkpoint ${checkpointPath} as an unvalidated old-engine artifact; `
    + "its fingerprint will not be overwritten and it will not enter the current-engine league."
  );
}
let population = trainingDecks.map((deck) => structuredClone(deck));
const leagueRoot = path.join(dataRoot, "league");
let league = (await loadLeague(leagueRoot, Math.max(1, Number(args["league-size"]) || 8)))
  .map((model) => migrateVerifiedCompatibleModel(
    model,
    compatibleRuntimeFingerprint,
    engineFingerprint,
    verifiedCompatibleRuntimeMigration
  ))
  .filter((model) => isCurrentEngineValidatedModel(model, engineFingerprint));
const importedMeta = await readCheckpoint(path.resolve(args.meta || path.join(dataRoot, "meta", "current.json")));
const storedLearnerCheckpoint = args["reset-learner"] === "true"
  ? null
  : await readCheckpoint(learnerCheckpointPath);
let learnerCheckpoint = explicitWarmStartCheckpoint || storedLearnerCheckpoint;
if (!explicitWarmStartCheckpoint && learnerCheckpoint && championCheckpoint
  && args["learner-selection"] !== "latest"
  && !isTrustedLearnerCheckpoint(learnerCheckpoint, championCheckpoint)) {
  console.warn(`Discarding unvalidated learner generation ${learnerCheckpoint.generation ?? "unknown"}; resuming from the validated champion.`);
  learnerCheckpoint = championCheckpoint;
}
if (!learnerCheckpoint && args["reset-learner"] !== "true") learnerCheckpoint = championCheckpoint;
if (!learnerCheckpoint && !championCheckpoint && storedChampionCheckpoint) {
  learnerCheckpoint = storedChampionCheckpoint;
}
let learner = learnerCheckpoint
  ? deserializeNeuralModel(learnerCheckpoint)
  : createNeuralModel();
if (learner.metadata?.trainingDeckIds
  && JSON.stringify(learner.metadata.trainingDeckIds) !== JSON.stringify(trainingDeckIds)) {
  throw new Error(`Learner training deck scope does not match the requested scope: ${trainingDeckIds.join(", ")}`);
}
const learnerSourceFingerprint = learner.metadata?.warmStart?.fromEngineFingerprint
  || learner.metadata?.engineFingerprint
  || null;
let crossEngineWarmStart = learner.metadata?.engineValidationStatus === "warm-start-unvalidated"
  || learner.metadata?.warmStart?.requiresCurrentEngineRevalidation === true
  || learner.metadata?.engineFingerprint !== engineFingerprint;
if (crossEngineWarmStart) {
  learner = migrateVerifiedCompatibleModel(
    learner,
    compatibleRuntimeFingerprint,
    engineFingerprint,
    verifiedCompatibleRuntimeMigration
  );
  crossEngineWarmStart = learner.metadata?.engineFingerprint
    !== engineFingerprint;
}
if (crossEngineWarmStart) {
  const previousFingerprint = learnerSourceFingerprint;
  const sourceMetadata = learner.metadata || {};
  learner.metadata = {
    algorithm: sourceMetadata.algorithm,
    cardRepresentation: sourceMetadata.cardRepresentation,
    actionRepresentation: sourceMetadata.actionRepresentation,
    engineFingerprint,
    engineValidationStatus: "warm-start-unvalidated",
    promoted: false,
    learnerAdvanced: false,
    warmStart: {
      version: 1,
      importedAt: sourceMetadata.warmStart?.importedAt || new Date().toISOString(),
      sourcePath: explicitWarmStartPath || sourceMetadata.warmStart?.sourcePath || learnerCheckpointPath,
      fromEngineFingerprint: previousFingerprint,
      sourceGeneration: learner.generation,
      sourceGamesTrained: learner.gamesTrained,
      requiresCurrentEngineRevalidation: true
    },
    checkpointMigration: {
      migratedAt: sourceMetadata.checkpointMigration?.migratedAt || new Date().toISOString(),
      fromEngineFingerprint: previousFingerprint,
      reason: "Weights-only warm start. Old trajectories, optimizer, calibration, teacher trust, and champion status are not reused."
    }
  };
  learner.calibration = { temperature: 1, bias: 0, bins: [] };
  learner.knowledge = {};
  console.warn(
    `Warm-starting from generation ${learner.generation} weights trained under `
    + `${previousFingerprint || "an unversioned engine"}; current-engine data and evaluation are required.`
  );
}
applyMetaSnapshot(learner.knowledge, importedMeta || buildMetaPreset("origins-houston-2025"));
learner.knowledge.cardPoolId = cardPoolId;
learner.knowledge.trainingDeckIds = trainingDeckIds;
let champion = championCheckpoint
  ? deserializeNeuralModel(championCheckpoint)
  : deserializeNeuralModel(serializeNeuralModel(learner));
applyMetaSnapshot(champion.knowledge, importedMeta || buildMetaPreset("origins-houston-2025"));
champion.knowledge.cardPoolId = cardPoolId;
champion.knowledge.trainingDeckIds = trainingDeckIds;
trainingIteration = Math.max(trainingIteration, Number(learner.metadata?.trainingIteration) || learner.generation || 0);
await writeCheckpoint(learnerCheckpointPath, serializeNeuralModel(learner));
const challengerLeagueSize = Math.max(0, Number(args["challenger-league-size"]) || 3);
let challengers = (await loadRecentCandidateModels(dataRoot, trainingDeckIds, challengerLeagueSize, learner))
  .map((model) => migrateVerifiedCompatibleModel(
    model,
    compatibleRuntimeFingerprint,
    engineFingerprint,
    verifiedCompatibleRuntimeMigration
  ))
  .filter((model) => isCurrentEngineValidatedModel(model, engineFingerprint));
await writeCheckpoint(runStatePath, {
  version: 4,
  runContract,
  experimentId,
  teacherConsumptionPolicy,
  seed,
  trainingIteration,
  championGeneration: champion.generation,
  learnerGeneration: learner.generation,
  updatedAt: new Date().toISOString()
});
const savedOptimizerState = await readCheckpoint(optimizerStatePath);
const optimizerIsCompatible = !crossEngineWarmStart;
let optimizer = await restoreAdamOptimizer(optimizerIsCompatible && savedOptimizerState?.modelGeneration === learner.generation ? savedOptimizerState : null, configuredLearningRate);
const sourceOptimizerState = await serializeOptimizer(optimizer, learner.generation);
const experimentManifestPath = experimentId
  ? path.join(dataRoot, "diagnostics", "experiments", experimentId, "manifest.json")
  : null;
const existingExperimentManifest = experimentManifestPath
  ? await readCheckpoint(experimentManifestPath)
  : null;
if (existingExperimentManifest && args.seed != null
  && Number(existingExperimentManifest.sourceSeed) !== seed) {
  throw new Error(
    `Run ${runContract} seed does not match experiment ${experimentId}: `
    + `${seed} != ${existingExperimentManifest.sourceSeed}.`
  );
}
const experimentCurriculumIteration = existingExperimentManifest?.curriculumIteration
  || trainingIteration + 1;
const experimentSourceSeed = existingExperimentManifest?.sourceSeed ?? seed;
const experimentGenerationSeed = existingExperimentManifest?.generationSeed
  ?? ((experimentSourceSeed + (experimentCurriculumIteration - 1) * 1000003) >>> 0);
const experimentSourceConfigurationHash = checkpointHash({
  version: 1,
  engineFingerprint,
  learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
  games,
  maxActions,
  trainingDeckIds,
  evolveDecks,
  leagueSamplingMode,
  leagueModels: uniqueNeuralModels([champion, ...league, ...challengers])
    .map((model) => checkpointHash(serializeNeuralModel(model))),
  teacherProduction: {
    teacherFraction,
    teacherBudget,
    teacherCriticalBudget,
    teacherUrgentBudget,
    teacherScreenSimulations,
    teacherConfirmationSimulations,
    teacherConfirmationMaxSimulations,
    teacherDepth,
    teacherCandidates,
    teacherLeafAuditSimulations,
    teacherLeafAuditSchedule,
    postmortemReviews,
    postmortemCaptureLimit,
    postmortemAuditInterval,
    postmortemWinnerReviewFraction,
    postmortemSimulations,
    postmortemDepth,
    postmortemCandidates
  }
});
const experimentManifest = experimentManifestPath
  ? await claimAbExperimentManifest(
    experimentManifestPath,
    createAbExperimentClaim({
      experimentId,
      engineFingerprint,
      learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
      sourceModelHash: checkpointHash(serializeNeuralModel(learner)),
      sourceChampionHash: checkpointHash(serializeNeuralModel(champion)),
      sourceOptimizerHash: checkpointHash(sourceOptimizerState),
      sourceConfigurationHash: experimentSourceConfigurationHash,
      sourceSeed: experimentSourceSeed,
      generationSeed: experimentGenerationSeed,
      curriculumIteration: experimentCurriculumIteration,
      games,
      trainingDeckIds
    })
  )
  : null;

for (let generationIndex = 0; generationIndex < generations; generationIndex += 1) {
  trainingIteration += 1;
  const generation = learner.generation + 1;
  const learnerAtGenerationStart = deserializeNeuralModel(serializeNeuralModel(learner));
  const learnerCheckpointAtGenerationStart = serializeNeuralModel(learnerAtGenerationStart);
  const generationUsesCrossEngineWarmStart =
    learnerAtGenerationStart.metadata?.engineValidationStatus === "warm-start-unvalidated"
    || learnerAtGenerationStart.metadata?.warmStart?.requiresCurrentEngineRevalidation === true;
  const teacherEvaluatorMode = generationUsesCrossEngineWarmStart
    ? "heuristic-only"
    : (args["teacher-evaluator-mode"] || "certified-neural-ensemble");
  const optimizerStateAtGenerationStart = await serializeOptimizer(optimizer, learner.generation);
  const curriculumIteration = experimentManifest?.curriculumIteration || trainingIteration;
  const curriculum = curriculumStage(curriculumIteration, maxActions);
  const generationSeed = experimentManifest?.generationSeed
    ?? ((seed + (trainingIteration - 1) * 1000003) >>> 0);
  const evolutionRandom = seededRandom(generationSeed ^ 0x9e3779b9);
  const trainingRandom = seededRandom(generationSeed ^ 0x85ebca6b);
  const trainingRandomInitialState = trainingRandom.getState?.() ?? null;
  const collectionWorkers = Math.max(1, Math.min(workers, games));
  const temperature = Number(args.temperature) || curriculum.temperature;
  const bestOfThreeFraction = Math.max(0, Math.min(1, Number(args["best-of-three-fraction"] ?? args["match-fraction"] ?? 0.25)));
  const mirrorFraction = Math.max(0, Math.min(0.75, Number(args["mirror-fraction"] ?? 0.25)));
  const focusWinRate = Number(args["focus-win-rate"]);
  const focusDeckFraction = Number(args["focus-deck-fraction"]);
  const focusMirrorFraction = Number(args["focus-mirror-fraction"]);
  const deckCurriculum = evolveDecks ? null : selectUnderperformingDeckCurriculum(learner, trainingDeckIds, {
    threshold: Number.isFinite(focusWinRate) ? focusWinRate : undefined,
    focusFraction: Number.isFinite(focusDeckFraction) ? focusDeckFraction : 0.15,
    mirrorFraction: Number.isFinite(focusMirrorFraction) ? focusMirrorFraction : undefined,
    alwaysFocus: true
  });
  const collectionLeague = uniqueNeuralModels([champion, ...league, ...challengers]);
  const frozenEvaluatorRegistry = await loadFrozenEvaluatorRegistry(dataRoot, {
    engineFingerprint,
    primaryModel: learner,
    limit: 3
  });
  const collectionEvaluatorPool = uniqueNeuralModels([
    ...frozenEvaluatorRegistry.accepted,
    ...collectionLeague
  ]);
  const collectionEvaluatorCertification = collectionEvaluatorPool.map((model) => ({
    model,
    generation: model.generation ?? null,
    ...evaluatorCertificateStatus(model, {
      engineFingerprint,
      primaryModel: learner
    })
  }));
  const certifiedCollectionEvaluators = collectionEvaluatorCertification
    .filter((item) => item.eligible
      && item.model?.metadata?.evaluatorCertificate?.permissions
        ?.leafEvaluation === true);
  const certifiedCollectionEvaluatorModels = certifiedCollectionEvaluators
    .map((item) => item.model);
  const collectionLeagueSampling = leagueSamplingMode === "uniform"
    ? null
    : prioritizedLeagueSampling(learner, collectionLeague);
  const descriptor = createCollectionDescriptor({
    runContract: collectionRunContract,
    experimentId,
    generation,
    modelGeneration: learner.generation,
    learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
    engineFingerprint,
    cardPoolId,
    games,
    workers: collectionWorkers,
    seed: generationSeed,
    maxActions: curriculum.maxActions,
    temperature,
    shapingWeight: curriculum.shapingWeight,
    diagnosticWeight,
    gamma,
    gaeLambda,
    longHorizonLambda,
    longHorizonWeight,
    bestOfThreeFraction,
    mirrorFraction,
    evolveDecks,
    balancedPairings: !evolveDecks,
    deckCurriculum,
    leagueSamplingMode,
    leagueSamplingWeights: collectionLeagueSampling?.weights || null,
    teacherFraction,
    teacherBudget,
    teacherCriticalBudget,
    teacherUrgentBudget,
    teacherScreenSimulations,
    teacherConfirmationSimulations,
    teacherConfirmationMaxSimulations,
    teacherDepth,
    teacherCandidates,
    teacherLeafAuditSimulations,
    teacherEvaluatorMode,
    postmortemReviews,
    postmortemCaptureLimit,
    postmortemAuditInterval,
    postmortemWinnerReviewFraction,
    postmortemSimulations,
    postmortemDepth,
    postmortemCandidates,
    teacherEvaluatorEnsembleVersion: teacherEvaluatorMode === "heuristic-only" ? 0 : 2,
    // Main PPO collection does not contain evaluator-bootstrap audit labels.
    // Preserve the pre-bootstrap descriptor while no certified evaluator is
    // actually consumed so an existing 160-game PPO archive stays reusable.
    evaluatorCertificateVersion: certifiedCollectionEvaluators.length
      ? EVALUATOR_CERTIFICATE_VERSION
      : 11,
    actionRankingReferenceVersion: ACTION_RANKING_REFERENCE_VERSION,
    actionRankingAuditReferenceVersion: 2,
    leafValueReferenceVersion: LEAF_VALUE_REFERENCE_VERSION,
    // Expensive independent terminal audits are collected only by the
    // dedicated evaluator bootstrap below. Main PPO collection never pays for
    // the same audit twice.
    captureProductionLeafAudit: false,
    captureIndependentActionAudit: false,
    teacherActionAuditBudget,
    teacherActionAuditMaximumSteps,
    certifiedEvaluatorHashes: certifiedCollectionEvaluators.map((item) => item.modelHash),
    certifiedEvaluatorCount: certifiedCollectionEvaluators.length,
    trainingDeckIds
  });
  if (experimentManifestPath) {
    await bindAbExperimentCollection(
      experimentManifestPath,
      experimentManifest,
      descriptor.collectionKey
    );
  }
  const progress = createTrainingProgressReporter(dataRoot, generation, trainingIteration);
  let phase = "preparing";
  try {
  progress.write({ state: "preparing", stage: "generation", trainingIteration, championGeneration: champion.generation, learnerGeneration: learner.generation, games, workers: collectionWorkers, seed: generationSeed, curriculum, deckCurriculum });
  let resume = await loadGenerationResume(dataRoot, descriptor);
  if (!resume && compatibleCollectionFingerprint) {
    const migration = await migrateCompatibleCollection(
      dataRoot,
      descriptor,
      compatibleCollectionFingerprint,
      { sourceCollectionKey: compatibleCollectionKey }
    );
    console.warn(
      `Compatible collection resume: migrated ${migration.migratedGames} game(s), `
      + `skipped ${migration.skippedGames}, alreadyCurrent=${migration.alreadyCurrent === true}.`
    );
    resume = requireCompatibleCollectionResume(
      await loadGenerationResume(dataRoot, descriptor),
      migration
    );
  }
  if (resume) {
    population = resume.population;
  } else {
    if (evolveDecks) population = evolvePopulation(population, learner.knowledge, evolutionRandom, Math.max(population.length * 2, Number(args.population) || 32), trainingDecks);
    resume = await saveGenerationResume(dataRoot, descriptor, population);
  }
  let collected = await loadCompletedCollection(dataRoot, descriptor);
  let shouldArchiveCollection = false;
  if (!collected) {
    const collectionProgress = await inspectReusableGames(dataRoot, descriptor);
    const completedGameIndexes = collectionProgress.completedGameIndexes;
    const resumedGames = [...completedGameIndexes.values()].reduce((sum, indexes) => sum + indexes.size, 0);
    const collectionMaxActions = collectionProgress.incompleteGames > 0 ? curriculum.maxActions * 2 : curriculum.maxActions;
    let persistedGames = resumedGames;
    let lastCompletedGame = null;
    let progressStatusWrite = Promise.resolve();
    phase = "collecting";
    progress.write({ state: "collecting", stage: "selfplay", completedGames: persistedGames, targetGames: games, resumedGames, retriedGames: collectionProgress.incompleteGames, acceptedIncompleteGames: collectionProgress.acceptedIncompleteGames, qualityCompletedGames: collectionProgress.qualityCompletedGames, collectionMaxActions, deckCurriculum });
    await writeAiStatus({ state: "collecting", generation, games, workers: collectionWorkers, seed: generationSeed, curriculum, deckCurriculum, collectionMaxActions, resumedGames, retriedGames: collectionProgress.incompleteGames, acceptedIncompleteGames: collectionProgress.acceptedIncompleteGames, qualityCompletedGames: collectionProgress.qualityCompletedGames, completedGames: persistedGames, progressPath: progress.latestPath, eventLogPath: progress.eventLogPath });
    collected = await collectProcessPoolSelfPlay({
      games,
      workers: collectionWorkers,
      processes: collectionProcesses,
      decks: population,
      model: learner,
      league: collectionLeague,
      teacherEvaluatorModels: certifiedCollectionEvaluatorModels,
      leagueSamplingWeights: collectionLeagueSampling?.weights || null,
      meta: learner.knowledge,
      bestOfThreeFraction,
      mirrorFraction,
      maxActions: collectionMaxActions,
      temperature,
      shapingWeight: curriculum.shapingWeight,
      diagnosticWeight,
      gamma,
      gaeLambda,
      longHorizonLambda,
      longHorizonWeight,
      seed: generationSeed,
      engineFingerprint,
      balancedPairings: !evolveDecks,
      deckCurriculum,
      teacherFraction,
      teacherBudget,
      teacherCriticalBudget,
      teacherUrgentBudget,
      teacherScreenSimulations,
      teacherConfirmationSimulations,
      teacherConfirmationMaxSimulations,
      teacherDepth,
      teacherCandidates,
      teacherLeafAuditSimulations,
      teacherEvaluatorMode,
      captureProductionLeafAudit: false,
      captureIndependentActionAudit: false,
      teacherActionAuditBudget,
      teacherActionAuditMaximumSteps,
      postmortemReviews,
      postmortemCaptureLimit,
      postmortemAuditInterval,
      postmortemWinnerReviewFraction,
      postmortemSimulations,
      postmortemDepth,
      postmortemCandidates,
      captureReplays: args["capture-replays"] !== "false",
      replayEvery,
      perfProfile,
      stopRequestPath,
      onStopRequested: (stop) => progress.write({
        state: "collecting",
        stage: "draining-at-game-boundary",
        completedGames: persistedGames,
        targetGames: games,
        resumedGames,
        stop
      }),
      completedGameIndexes,
      onWorkerHeartbeat: (workerPool) => progress.write({
        state: "collecting",
        stage: "selfplay",
        completedGames: persistedGames,
        targetGames: games,
        resumedGames,
        retriedGames: collectionProgress.incompleteGames,
        workerPool,
        lastGame: lastCompletedGame
      }),
      onGameComplete: async (game) => {
        await saveCollectedGame(dataRoot, descriptor, game);
        for (const replay of game.result?.spectatorReplays || []) {
          try {
            await storeAiSpectatorReplay(replay, dataRoot);
          } catch (error) {
            if (!isAiSpectatorReplayTooLargeError(error)) throw error;
            console.warn(
              `Skipped oversized optional spectator replay ${replay?.id || "unknown"}`
              + ` (${Number(error.actualBytes) || 0}/${Number(error.maximumBytes) || 0} bytes).`
            );
          }
        }
        persistedGames += 1;
        const summaries = game.result?.summaries || [];
        lastCompletedGame = {
          workerIndex: game.workerIndex,
          gameIndex: game.gameIndex,
          completed: summaries.length > 0 && summaries.every((summary) => summary.completed === true),
          summaries,
          performance: game.result?.performance || null
        };
        progress.write({
          state: "collecting",
          stage: "selfplay",
          completedGames: persistedGames,
          targetGames: games,
          resumedGames,
          retriedGames: collectionProgress.incompleteGames,
          acceptedIncompleteGames: collectionProgress.acceptedIncompleteGames,
          qualityCompletedGames: collectionProgress.qualityCompletedGames,
          lastGame: lastCompletedGame
        });
        progressStatusWrite = progressStatusWrite.then(() => writeAiStatus({
          state: "collecting",
          generation,
          games,
          workers: collectionWorkers,
          seed: generationSeed,
          curriculum,
          deckCurriculum,
          collectionMaxActions,
          resumedGames,
          retriedGames: collectionProgress.incompleteGames,
          acceptedIncompleteGames: collectionProgress.acceptedIncompleteGames,
          completedGames: persistedGames,
          progressPath: progress.latestPath,
          eventLogPath: progress.eventLogPath
        }));
        await progressStatusWrite;
      },
      loadCollectedResults: ({ allowPartial } = {}) => allowPartial
        ? loadAvailablePersistedCollection(dataRoot, descriptor)
        : loadPersistedCollection(dataRoot, descriptor)
    });
    if (collected.workerStats?.stoppedAtGameBoundary === true) {
      const stoppedStatus = {
        state: "interrupted",
        phase: "collecting",
        stage: "game-boundary-stop",
        generation,
        trainingIteration,
        games,
        workers: collectionWorkers,
        seed: generationSeed,
        curriculum,
        completedGames: collected.summaries.filter((summary) => summary.completed).length,
        resumedGames,
        pendingGames: collected.workerStats.pendingTasks,
        stopRequestedAt: collected.workerStats.stopRequestedAt,
        stopHandoffId: collected.workerStats.stopHandoffId || null,
        resumable: true,
        collectionKey: descriptor.collectionKey,
        progressPath: progress.latestPath,
        eventLogPath: progress.eventLogPath
      };
      progress.write(stoppedStatus);
      await writeAiStatus(stoppedStatus);
      await unlink(stopRequestPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      console.log(JSON.stringify(stoppedStatus));
      break;
    }
    shouldArchiveCollection = true;
  } else {
    progress.write({ state: "collecting", stage: "selfplay", completedGames: games, targetGames: games, resumedArchive: true });
    await writeAiStatus({ state: "collecting", generation, games, workers: collectionWorkers, seed: generationSeed, curriculum, resumedArchive: true, progressPath: progress.latestPath, eventLogPath: progress.eventLogPath });
  }
  let distributed = await loadTrajectoryShards(args["trajectory-shards"], learner.generation, cardPoolId);
  collected.trajectories.push(...distributed.flatMap((shard) => shard.trajectories || []));
  collected.summaries.push(...distributed.flatMap((shard) => shard.summaries || []));
  const completedGames = collected.summaries.filter((summary) => summary.completed).length;
  if (completedGames < Math.ceil(games * 0.8)) {
    throw new Error(`Self-play completion gate failed: ${completedGames}/${games} requested games completed.`);
  }
  collected.trajectories = collected.trajectories.filter((trajectory) => trajectory.completed === true);
  const collectionDeckStats = summarizeDeckOutcomes(collected.summaries);
  const handOpportunityTraining = summarizeHandOpportunities(collected.summaries);
  progress.write({ state: "collecting", stage: "collection-complete", completedGames, targetGames: games, deckStats: collectionDeckStats });
  assertTrainingTrajectories(collected.trajectories, engineFingerprint);
  const turningPointReplayPath = path.join(dataRoot, "replay", "turning-points");
  if (shouldArchiveCollection) await saveCompletedCollection(dataRoot, descriptor);
  phase = "training";
  const ppoEpochs = Math.max(1, Number(args.epochs) || 8);
  const ppoBatchSize = Math.max(1, Number(args["batch-size"]) || 4);
  const earlyStoppingPatience = Math.max(0, Number(args["early-stopping-patience"]) || 2);
  const configuredMinimumEpochsBeforeEarlyStopping = Number(args["minimum-epochs-before-early-stopping"]);
  const minimumEpochsBeforeEarlyStopping = Math.max(0, Math.min(
    ppoEpochs,
    Number.isFinite(configuredMinimumEpochsBeforeEarlyStopping)
      ? Math.floor(configuredMinimumEpochsBeforeEarlyStopping)
      : Math.min(6, ppoEpochs)
  ));
  const minimumScoreImprovement = Math.max(0, Number(args["minimum-score-improvement"]) || 0.001);
  const defaultEpochEvaluationGames = trainingDeckIds.length * 16;
  const epochEvaluationGames = args["epoch-evaluation-games"] === "0"
    ? 0
    : Math.max(
      trainingDeckIds.length * 8,
      Math.ceil((Number(args["epoch-evaluation-games"]) || defaultEpochEvaluationGames) / 8) * 8
    );
  const epochEvaluationMode = args["epoch-evaluation-mode"] || "same-deck-mirror-v3";
  const epochEvaluationMaxActions = Math.max(400, Number(args["epoch-evaluation-max-actions"]) || Math.min(evaluationMaxActions, 800));
  const epochPracticalWeight = Math.max(0, Number(args["epoch-practical-weight"]) || 0.35);
  const epochMaximumRetentionDrop = Math.max(0, Number(args["epoch-maximum-retention-drop"]) || 0.005);
  const epochMinimumPracticalScore = Math.max(0, Math.min(1, Number(args["epoch-minimum-practical-score"]) || 0.47));
  const epochMinimumPracticalWinRate = Math.max(0, Math.min(1, Number(args["epoch-minimum-practical-win-rate"]) || 0.5));
  let humanTrajectories = await loadHumanReplayData(path.join(dataRoot, "replays"), Math.max(0, Number(args["human-replays"]) || 32), engineFingerprint);
  let safeHumanTrajectories = humanTrajectories.slice(0, Math.max(1, Math.ceil(collected.trajectories.length * 0.25)));
  assertTrainingTrajectories(safeHumanTrajectories, engineFingerprint);
  const coverageDeckIds = trainingDeckIds;
  let trajectoryPartitions = splitIndependentTrainingPartitions(collected.trajectories, {
    seed: generationSeed ^ 0x51f15e,
    deckIds: coverageDeckIds,
    retentionFraction,
    calibrationFitFraction,
    calibrationTestFraction,
    evaluatorAuditFraction,
    minimumRetentionPerDeck: minimumRetentionTrajectoriesPerDeck,
    minimumCalibrationFitPerDeck: 1,
    minimumCalibrationTestPerDeck: 1,
    minimumEvaluatorAuditPerDeck: 1,
    minimumTrainingPerDeck: minimumTrainingTrajectoriesPerDeck
  });
  progress.write({
    state: "training",
    stage: "trajectory-coverage",
    trajectories: collected.trajectories.length,
    trainingTrajectories: trajectoryPartitions.training.length,
    retentionTrajectories: trajectoryPartitions.retention.length,
    calibrationFitTrajectories: trajectoryPartitions.calibrationFit.length,
    calibrationTestTrajectories: trajectoryPartitions.calibrationTest.length,
    evaluatorAuditTrajectories: trajectoryPartitions.evaluatorAudit.length,
    coverage: trajectoryPartitions.manifest
  });
  if (!trajectoryPartitions.manifest.passed) {
    throw new Error(`Independent training partition coverage failed: ${JSON.stringify(trajectoryPartitions.manifest.failures)}`);
  }
  const holdoutProvenance = await registerGlobalHoldoutProvenance(
    dataRoot,
    engineFingerprint,
    descriptor.collectionKey,
    trajectoryPartitions
  );
  const storedTurningPointReplayEntries = await loadTurningPointReplayIndex(
    turningPointReplayPath,
    engineFingerprint
  );
  const replayEligibility = filterTrainingEligibleReplayEntries(
    storedTurningPointReplayEntries,
    holdoutProvenance,
    { engineFingerprint }
  );
  // Turning points are now extracted only after the five-way game partition,
  // and only from the PPO training partition.
  let freshTurningPointReplays = extractTurningPointReplays(
    trajectoryPartitions.training,
    { sourceCollectionKey: descriptor.collectionKey }
  );
  const mergedTurningPointReplayEntries = await updateTurningPointReplayBuffer(
    turningPointReplayPath,
    replayEligibility.eligible,
    freshTurningPointReplays,
    turningPointReplayLimit,
    engineFingerprint,
    { purgeEntries: replayEligibility.rejected }
  );
  let balancedTraining = balanceTrainingTrajectories(trajectoryPartitions.training, {
    deckIds: coverageDeckIds,
    seed: generationSeed ^ 0x39a701d
  });
  progress.write({
    state: "training",
    stage: "trajectory-balancing",
    ...balancedTraining.report
  });
  const eligibleTurningPointReplayEntries = filterTrainingEligibleReplayEntries(
    mergedTurningPointReplayEntries,
    holdoutProvenance,
    { engineFingerprint }
  ).eligible;
  const replayEntries = sampleTurningPointReplays(
    eligibleTurningPointReplayEntries,
    Math.ceil(balancedTraining.trajectories.length * turningPointReplayFraction),
    seededRandom(generationSeed ^ 0x7f4a7c15)
  );
  let replayTrajectories = await loadTurningPointReplayTrajectories(turningPointReplayPath, replayEntries, engineFingerprint);
  assertTrainingTrajectories(replayTrajectories, engineFingerprint);
  let trainingTrajectories = balancedTraining.trajectories;
  let auxiliaryReplayTrajectories = replayTrajectories;
  let retentionTrajectories = trajectoryPartitions.retention;
  const continuationBehaviorProbePath = path.join(
    dataRoot,
    "evaluator",
    "continuation-behavior-probe-v1.json"
  );
  let continuationBehaviorProbe = await readCheckpoint(
    continuationBehaviorProbePath
  );
  if (!validFixedContinuationBehaviorProbe(continuationBehaviorProbe, {
    engineFingerprint
  })) {
    continuationBehaviorProbe = createFixedContinuationBehaviorProbe(
      [...trainingTrajectories, ...retentionTrajectories],
      {
        engineFingerprint,
        namespace: `${runContract}:fixed-policy-probe-v1`,
        maximumStates: 32
      }
    );
    if (validFixedContinuationBehaviorProbe(continuationBehaviorProbe, {
      engineFingerprint
    })) {
      await writeCheckpoint(
        continuationBehaviorProbePath,
        continuationBehaviorProbe
      );
    }
  }
  const heldoutNamespace = officialPromotionRun ? "official" : `diagnostic-${experimentId}`;
  const calibrationFitMaximumGames = Math.max(
    100,
    Number(args["calibration-fit-max-games"]) || 1000
  );
  const calibrationTestMaximumGames = Math.max(
    100,
    Number(args["calibration-test-max-games"]) || 1000
  );
  const evaluatorAuditMaximumGames = Math.max(
    100,
    Number(args["evaluator-audit-max-games"]) || 1000
  );
  const calibrationBatchSize = Math.max(
    1,
    Number(args["calibration-batch-size"]) || 8
  );
  const calibrationFitDatasetDescriptor = {
    namespace: heldoutNamespace,
    role: "calibration-fit",
    collectionKey: descriptor.collectionKey,
    engineFingerprint,
    learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
    trainingDeckIds
  };
  const calibrationTestDatasetDescriptor = {
    namespace: heldoutNamespace,
    role: "calibration-test",
    collectionKey: descriptor.collectionKey,
    engineFingerprint,
    learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
    trainingDeckIds
  };
  const evaluatorAuditDatasetDescriptor = {
    namespace: heldoutNamespace,
    role: "evaluator-certification-audit",
    collectionKey: descriptor.collectionKey,
    engineFingerprint,
    learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
    trainingDeckIds
  };
  let calibrationFitDataset = await updateIndependentTrajectoryDataset(
    dataRoot,
    calibrationFitDatasetDescriptor,
    trajectoryPartitions.calibrationFit,
    {
      maximumGames: calibrationFitMaximumGames
    }
  );
  let calibrationTestDataset = await updateIndependentTrajectoryDataset(
    dataRoot,
    calibrationTestDatasetDescriptor,
    trajectoryPartitions.calibrationTest,
    {
      maximumGames: calibrationTestMaximumGames
    }
  );
  let evaluatorAuditDataset = await updateIndependentTrajectoryDataset(
    dataRoot,
    evaluatorAuditDatasetDescriptor,
    trajectoryPartitions.evaluatorAudit,
    {
      maximumGames: evaluatorAuditMaximumGames
    }
  );
  let evaluatorTrainingDataset = {
    trajectories: [],
    manifest: {
      version: 1,
      role: "evaluator-train",
      games: 0,
      datasetFingerprint: null
    }
  };
  let evaluatorDevelopmentDataset = evaluatorAuditDataset;
  let evaluatorConfirmationDataset = {
    trajectories: [],
    manifest: {
      version: 1,
      role: "evaluator-confirmation",
      games: 0,
      datasetFingerprint: null
    }
  };
  let evaluatorFinalAuditDataset = {
    trajectories: [],
    manifest: {
      version: 1,
      role: "evaluator-final-audit",
      games: 0,
      datasetFingerprint: null
    }
  };
  let evaluatorCertificationCalibrationDataset = calibrationTestDataset;
  let evaluatorCertificationCalibrationFromBootstrap = false;
  const bootstrapCalibrationFitManifest = trajectorySequenceManifest(
    calibrationFitDataset.trajectories
  );
  const bootstrapCalibrationTestManifest = trajectorySequenceManifest(
    calibrationTestDataset.trajectories
  );
  const preparedTrajectoryPartitionFingerprint = deterministicValueDigest(
    trajectoryPartitions.manifest
  );
  const freshTurningPointReplayCount = freshTurningPointReplays.length;
  let trainingWorkingSetSuspended = false;
  const requestedEvaluatorBootstrapProcesses =
    evaluatorBootstrapMaximumActionAuditProcesses(
      collectionProcesses,
      args["evaluator-action-audit-processes"]
    );
  let evaluatorBootstrapProcessBudget = requestedEvaluatorBootstrapProcesses;
  let evaluatorBootstrapMemoryReserveBytes = 4 * 1024 ** 3;
  const suspendTrainingWorkingSet = async () => {
    if (trainingWorkingSetSuspended) return;
    const before = trainingMemorySnapshot();
    for (const shard of distributed || []) {
      if (Array.isArray(shard?.trajectories)) shard.trajectories.length = 0;
      if (Array.isArray(shard?.summaries)) shard.summaries.length = 0;
    }
    distributed = [];
    if (Array.isArray(collected?.trajectories)) collected.trajectories.length = 0;
    if (Array.isArray(collected?.summaries)) collected.summaries.length = 0;
    for (const role of [
      "training",
      "retention",
      "calibrationFit",
      "calibrationTest",
      "evaluatorAudit"
    ]) {
      if (Array.isArray(trajectoryPartitions?.[role])) {
        trajectoryPartitions[role].length = 0;
      }
    }
    if (Array.isArray(balancedTraining?.trajectories)) {
      balancedTraining.trajectories.length = 0;
    }
    if (Array.isArray(freshTurningPointReplays)) {
      freshTurningPointReplays.length = 0;
    }
    if (Array.isArray(replayTrajectories)) replayTrajectories.length = 0;
    if (Array.isArray(humanTrajectories)) humanTrajectories.length = 0;
    if (Array.isArray(safeHumanTrajectories)) safeHumanTrajectories.length = 0;
    if (Array.isArray(calibrationFitDataset?.trajectories)) {
      calibrationFitDataset.trajectories.length = 0;
    }
    if (Array.isArray(calibrationTestDataset?.trajectories)) {
      calibrationTestDataset.trajectories.length = 0;
    }
    if (Array.isArray(evaluatorAuditDataset?.trajectories)) {
      evaluatorAuditDataset.trajectories.length = 0;
    }
    trainingTrajectories = [];
    auxiliaryReplayTrajectories = [];
    retentionTrajectories = [];
    trainingWorkingSetSuspended = true;
    await compactTrainingHeap();
    const after = trainingMemorySnapshot();
    evaluatorBootstrapMemoryReserveBytes = Math.max(
      2 * 1024 ** 3,
      Math.min(4 * 1024 ** 3, Math.round(after.systemTotalBytes * 0.125))
    );
    const estimatedCoordinatorBytes = 1024 ** 3;
    // The 1.2 GiB worker RSS limit is a recycle threshold, not the steady-state
    // allocation. Budget workers at 1 GiB while retaining the shared free-memory
    // backpressure and per-worker RSS recycling safeguards.
    const estimatedWorkerBytes = 1024 ** 3;
    const workerMemoryBudget = Math.max(
      0,
      after.systemFreeBytes
        - evaluatorBootstrapMemoryReserveBytes
        - estimatedCoordinatorBytes
    );
    evaluatorBootstrapProcessBudget = Math.max(
      1,
      Math.min(
        requestedEvaluatorBootstrapProcesses,
        Math.floor(workerMemoryBudget / estimatedWorkerBytes)
      )
    );
    progress.write({
      state: "training",
      stage: "evaluator-bootstrap-memory-isolated",
      memory: {
        before,
        after,
        releasedRssBytes: Math.max(0, before.rssBytes - after.rssBytes),
        releasedHeapBytes: Math.max(0, before.heapUsedBytes - after.heapUsedBytes),
        reserveBytes: evaluatorBootstrapMemoryReserveBytes,
        estimatedCoordinatorBytes,
        estimatedWorkerBytes
      },
      evaluatorBootstrapProcessesRequested: requestedEvaluatorBootstrapProcesses,
      evaluatorBootstrapProcesses: evaluatorBootstrapProcessBudget
    });
  };
  const restoreTrainingWorkingSet = async () => {
    if (!trainingWorkingSetSuspended) return;
    progress.write({
      state: "training",
      stage: "policy-training-data-reload",
      memory: trainingMemorySnapshot()
    });
    collected = await loadCompletedCollection(dataRoot, descriptor);
    if (!collected) {
      throw new Error("Completed PPO collection disappeared during evaluator bootstrap.");
    }
    distributed = await loadTrajectoryShards(
      args["trajectory-shards"],
      learner.generation,
      cardPoolId
    );
    collected.trajectories.push(...distributed.flatMap(
      (shard) => shard.trajectories || []
    ));
    collected.summaries.push(...distributed.flatMap(
      (shard) => shard.summaries || []
    ));
    collected.trajectories = collected.trajectories.filter(
      (trajectory) => trajectory.completed === true
    );
    assertTrainingTrajectories(collected.trajectories, engineFingerprint);
    humanTrajectories = await loadHumanReplayData(
      path.join(dataRoot, "replays"),
      Math.max(0, Number(args["human-replays"]) || 32),
      engineFingerprint
    );
    safeHumanTrajectories = humanTrajectories.slice(
      0,
      Math.max(1, Math.ceil(collected.trajectories.length * 0.25))
    );
    assertTrainingTrajectories(safeHumanTrajectories, engineFingerprint);
    trajectoryPartitions = splitIndependentTrainingPartitions(
      collected.trajectories,
      {
        seed: generationSeed ^ 0x51f15e,
        deckIds: coverageDeckIds,
        retentionFraction,
        calibrationFitFraction,
        calibrationTestFraction,
        evaluatorAuditFraction,
        minimumRetentionPerDeck: minimumRetentionTrajectoriesPerDeck,
        minimumCalibrationFitPerDeck: 1,
        minimumCalibrationTestPerDeck: 1,
        minimumEvaluatorAuditPerDeck: 1,
        minimumTrainingPerDeck: minimumTrainingTrajectoriesPerDeck
      }
    );
    if (deterministicValueDigest(trajectoryPartitions.manifest)
      !== preparedTrajectoryPartitionFingerprint) {
      throw new Error(
        "Policy training partition changed across evaluator-bootstrap stage boundary."
      );
    }
    balancedTraining = balanceTrainingTrajectories(
      trajectoryPartitions.training,
      { deckIds: coverageDeckIds, seed: generationSeed ^ 0x39a701d }
    );
    replayTrajectories = await loadTurningPointReplayTrajectories(
      turningPointReplayPath,
      replayEntries,
      engineFingerprint
    );
    assertTrainingTrajectories(replayTrajectories, engineFingerprint);
    trainingTrajectories = balancedTraining.trajectories;
    auxiliaryReplayTrajectories = replayTrajectories;
    retentionTrajectories = trajectoryPartitions.retention;
    calibrationFitDataset = await updateIndependentTrajectoryDataset(
      dataRoot,
      calibrationFitDatasetDescriptor,
      [],
      { maximumGames: calibrationFitMaximumGames }
    );
    calibrationTestDataset = await updateIndependentTrajectoryDataset(
      dataRoot,
      calibrationTestDatasetDescriptor,
      [],
      { maximumGames: calibrationTestMaximumGames }
    );
    if (!evaluatorCertificationCalibrationFromBootstrap) {
      evaluatorCertificationCalibrationDataset = calibrationTestDataset;
    }
    trainingWorkingSetSuspended = false;
    progress.write({
      state: "training",
      stage: "policy-training-data-reloaded",
      trajectories: trainingTrajectories.length,
      memory: trainingMemorySnapshot()
    });
  };
  let evaluatorBootstrap = null;
  let evaluatorDevelopmentGate = null;
  let evaluatorConfirmationGate = null;
  const acceptedPolicyQEvaluators = frozenEvaluatorRegistry.accepted.filter(
    (model) => model?.metadata?.evaluatorCertificate?.certificateKind
      === EVALUATOR_CERTIFICATE_KINDS.policyQ
  );
  const strongContinuationSelection =
    selectCertifiedIndependentContinuationPool(
      [learner, ...collectionLeague],
      { engineFingerprint, minimumModels: 2, maximumModels: 3 }
    );
  const strongContinuationCandidates = strongContinuationSelection.models;
  const actionEvidenceDiversityProbeDigest =
    strongContinuationSelection.probeDigest;
  const strongContinuationPoolReady = strongContinuationSelection.ready;
  const explicitlyRequestedEvaluatorCertificateKind =
    args["evaluator-certificate-kind"] == null
      ? null
      : String(args["evaluator-certificate-kind"]);
  const evaluatorCertificateKind = String(
    explicitlyRequestedEvaluatorCertificateKind
      || (acceptedPolicyQEvaluators.length > 0 && strongContinuationPoolReady
        ? EVALUATOR_CERTIFICATE_KINDS.robustAction
        : EVALUATOR_CERTIFICATE_KINDS.policyQ)
  );
  if (!Object.values(EVALUATOR_CERTIFICATE_KINDS).includes(
    evaluatorCertificateKind
  )) {
    throw new Error("Unknown evaluator certificate kind.");
  }
  const policyQBootstrap = evaluatorCertificateKind
    === EVALUATOR_CERTIFICATE_KINDS.policyQ;
  const activeEvaluatorEvidenceRequirements = policyQBootstrap
    ? EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS
    : EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS;
  const evaluatorBootstrapRefreshInterval = Math.max(
    1,
    Number(args["evaluator-bootstrap-refresh-generations"]) || 4
  );
  const frozenEvaluatorsForRequestedCertificate = frozenEvaluatorRegistry.accepted
    .filter((model) => model?.metadata?.evaluatorCertificate?.certificateKind
      === evaluatorCertificateKind);
  const newestFrozenEvaluatorGeneration = frozenEvaluatorsForRequestedCertificate
    .reduce((maximum, model) =>
      Math.max(maximum, Number(model?.generation) || 0), 0);
  const evaluatorBootstrapRefreshDue =
    frozenEvaluatorsForRequestedCertificate.length === 0
    || generation - newestFrozenEvaluatorGeneration
      >= evaluatorBootstrapRefreshInterval;
  if (officialPromotionRun
    && evaluatorBootstrapRefreshDue
    && args["evaluator-bootstrap"] !== "false") {
    await suspendTrainingWorkingSet();
    progress.write({
      state: "training",
      stage: "evaluator-bootstrap",
      evaluatorCertificateKind,
      evaluatorCertificateKindSelection:
        explicitlyRequestedEvaluatorCertificateKind
          ? "explicit"
          : "automatic-policy-q-then-robust-action",
      policyQEvaluatorMissing: acceptedPolicyQEvaluators.length === 0,
      robustActionEvaluatorMissing:
        frozenEvaluatorRegistry.accepted.every((model) =>
          model?.metadata?.evaluatorCertificate?.certificateKind
            !== EVALUATOR_CERTIFICATE_KINDS.robustAction),
      strongContinuationPoolReady,
      strongContinuationCandidates: strongContinuationCandidates.length,
      // Calibration uses 200 representative games in the high-confidence
      // evidence profile. With persistent alternating
      // batches, reaching that floor also produces independent training,
      // development, confirmation, and final-audit evidence partitions.
      targetGames: 200,
      targetActionReferences: Object.values(
        activeEvaluatorEvidenceRequirements
      ).reduce((sum, item) => sum + item.minimumActionReferences, 0),
      targetLeafValuePairs: Object.values(
        activeEvaluatorEvidenceRequirements
      ).reduce((sum, item) => sum + item.minimumLeafValuePairs, 0),
      targetActionReferenceGames: Object.values(
        activeEvaluatorEvidenceRequirements
      ).reduce((sum, item) => sum + item.minimumActionReferenceGames, 0),
      targetLeafValueReferenceGames: Object.values(
        activeEvaluatorEvidenceRequirements
      ).reduce((sum, item) => sum + item.minimumLeafValueReferenceGames, 0),
      evidencePartitions: [...EVALUATOR_EVIDENCE_PARTITIONS]
    });
    const evaluatorBootstrapMinimumActionReferences = Math.max(50,
      Number(args["evaluator-bootstrap-min-action-references"]
        ?? args["evaluator-bootstrap-min-references"]) || 50);
    const evaluatorBootstrapMinimumLeafValuePairs = Math.max(50,
      Number(args["evaluator-bootstrap-min-leaf-value-pairs"]
        ?? args["evaluator-bootstrap-min-references"]) || 50);
    const evaluatorBootstrapMinimumActionReferenceGames = Math.max(20,
      Number(args["evaluator-bootstrap-min-action-reference-games"]
        ?? args["evaluator-bootstrap-min-reference-games"]) || 20);
    const evaluatorBootstrapMinimumLeafValueReferenceGames = Math.max(20,
      Number(args["evaluator-bootstrap-min-leaf-value-reference-games"]
        ?? args["evaluator-bootstrap-min-reference-games"]) || 20);
    const evaluatorBootstrapMinimumActionReferencesPerDeckSeat = Math.max(1,
      Number(args["evaluator-bootstrap-min-action-references-per-deck-seat"]
        ?? args["evaluator-bootstrap-min-references-per-deck-seat"]) || 1);
    const evaluatorBootstrapMinimumLeafValuePairsPerDeckSeat = Math.max(1,
      Number(args["evaluator-bootstrap-min-leaf-value-pairs-per-deck-seat"]
        ?? args["evaluator-bootstrap-min-references-per-deck-seat"]) || 1);
    const evaluatorBootstrapMaximumTotalGames = Math.max(320,
      Number(args["evaluator-bootstrap-maximum-total-games"]) || 4096);
    // A training evidence partition is now a hard part of the evaluator
    // contract. Keep extending in fixed deterministic windows unless an
    // operator explicitly opts out; never silently run a zero-dose evaluator
    // training pass merely because the historical 1,280-game ceiling was met.
    const evaluatorBootstrapContinueUntilComplete =
      args["evaluator-bootstrap-continue-until-complete"] !== "false";
    const evaluatorBootstrapContinuationLineage = {
      version: 1,
      continuationPolicyHash: deterministicValueDigest(
        neuralContinuationLineage(learner)
      ),
      opponentPoolHash: deterministicValueDigest(
        collectionLeague.map(neuralContinuationLineage)
      ),
      teacherEvaluatorPoolHash: deterministicValueDigest(
        certifiedCollectionEvaluatorModels.map(neuralContinuationLineage)
      ),
      deckConfigurationHash: deterministicValueDigest(
        population.map(trainingDeckConfigurationLineage)
      )
    };
    const actionEvidenceProtocolMode = String(
      args["evaluator-action-evidence-protocol"]
        || (runContract === "C"
          ? ACTION_EVIDENCE_PROTOCOL_CONTRACT
          : "legacy-compatible")
    );
    if (!["legacy-compatible", ACTION_EVIDENCE_PROTOCOL_CONTRACT]
      .includes(actionEvidenceProtocolMode)) {
      throw new Error(
        "--evaluator-action-evidence-protocol must be legacy-compatible or "
        + `${ACTION_EVIDENCE_PROTOCOL_CONTRACT}.`
      );
    }
    const actionEvidencePolicyModels = [...new Map(
      [learner, ...collectionLeague].filter(Boolean).map((model) => [
        `${neuralArtifactHash(model)}::${neuralBehaviorHash(model)}`,
        model
      ])
    ).values()];
    // Readiness and the executed pool are deliberately the same array. A
    // separately reconstructed learner/league slice could otherwise pass the
    // robust readiness gate while omitting one of the certified continuations.
    const continuationModels = policyQBootstrap
      ? actionEvidencePolicyModels.slice(0, 1)
      : strongContinuationCandidates.slice(0, 3);
    if (!policyQBootstrap
      && (!strongContinuationPoolReady || continuationModels.length < 2)) {
      throw new Error(
        "Robust-action bootstrap requires the exact certified, pairwise-"
        + "independent continuation pool used by its readiness gate."
      );
    }
    const opponentModels = actionEvidencePolicyModels.slice(0, 3);
    const actionEvidenceHashToken = (value) => String(value || "")
      .replace(/^sha256:/, "")
      .slice(0, 16);
    const actionEvidencePoolMember = (model, prefix) => ({
      id: `${prefix}-${actionEvidenceHashToken(neuralBehaviorHash(model))}`
        + `-${actionEvidenceHashToken(neuralArtifactHash(model))}`,
      modelHash: neuralArtifactHash(model),
      behaviorHash: neuralBehaviorHash(model),
      weight: 1,
      generation: Number(model?.generation) || 0,
      strength: certifiedContinuationStrength(
        model,
        engineFingerprint
      ),
      // A different hash alone is not evidence of behavioral independence.
      // Robust status remains unavailable until an offline diversity probe
      // explicitly certifies the member.
      behaviorallyIndependent:
        prefix === "continuation"
          && !policyQBootstrap
          && strongContinuationPoolReady,
      searchEnabled: false
    });
    const actionEvidenceProtocolManifest = actionEvidenceProtocolMode
      === ACTION_EVIDENCE_PROTOCOL_CONTRACT
      ? createActionEvidenceProtocolManifest({
        continuationContractVersion: "run-c-continuation-v1",
        continuationPool: continuationModels.map((model) =>
          actionEvidencePoolMember(model, "continuation")),
        diversityProbeDigest: actionEvidenceDiversityProbeDigest,
        opponentPool: opponentModels.map((model) =>
          actionEvidencePoolMember(model, "opponent")),
        searchContractHash: deterministicValueDigest({
          depth: Number(args["teacher-depth"]) || 10,
          maximumSteps: Number(
            args["evaluator-action-audit-maximum-steps"]
          ) || 1200,
          symmetricBranches: true
        }),
        searchTriggerRuleHash: deterministicValueDigest({
          rule: "same-trigger-and-budget-for-both-branches-v1"
        }),
        chanceScheduleVersion: "paired-determinization-crn-v2",
        seedDerivationVersion: "action-audit-seed-v2",
        evaluatorGuidedFraction: 0.8,
        evaluatorBlindFraction: 0.2,
        minimumStrongEffect: Number(
          args["evaluator-action-evidence-strong-delta"]
        ) || 0.02,
        minimumTrainingEffect: Number(
          args["evaluator-action-evidence-training-delta"]
        ) || 0.01,
        sensitivityEpsilon: Number(
          args["evaluator-action-evidence-sensitivity-epsilon"]
        ) || 0.02
      })
      : null;
    const expectedActionEvidenceProtocolHash = String(
      args["expected-evaluator-action-evidence-protocol-hash"] || ""
    );
    if (expectedActionEvidenceProtocolHash
      && actionEvidenceProtocolManifest?.protocolHash
        !== expectedActionEvidenceProtocolHash) {
      throw new Error(
        "Action-evidence protocol hash changed across the Run C handoff."
      );
    }
    progress.setPersistentFields({
      actionEvidenceProtocol: actionEvidenceProtocolManifest
    });
    const evaluatorBootstrapOptions = {
      dataRoot,
      engineFingerprint,
      learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      continuationLineage: evaluatorBootstrapContinuationLineage,
      evidenceProtocolManifest: actionEvidenceProtocolManifest,
      deckIds: trainingDeckIds,
      workers: collectionWorkers,
      processes: evaluatorBootstrapProcessBudget,
      // General evaluator self-play (not only detached action audit) may use
      // the remaining requested capacity after the isolated stage proves that
      // enough physical memory is available. This is especially important for
      // Policy-Q leaf audits, which otherwise remain fixed at the conservative
      // initial budget for the entire batch.
      maximumSelfPlayProcesses: requestedEvaluatorBootstrapProcesses,
      dynamicSelfPlayScaling: true,
      maximumDetachedActionAuditProcesses:
        requestedEvaluatorBootstrapProcesses,
      minimumFreeMemoryBytes: evaluatorBootstrapMemoryReserveBytes,
      minimumGames: Math.max(100,
        Number(args["evaluator-bootstrap-min-games"]) || 100),
      minimumActionReferences: evaluatorBootstrapMinimumActionReferences,
      minimumLeafValuePairs: evaluatorBootstrapMinimumLeafValuePairs,
      minimumActionReferenceGames: evaluatorBootstrapMinimumActionReferenceGames,
      minimumLeafValueReferenceGames: evaluatorBootstrapMinimumLeafValueReferenceGames,
      minimumRepresentativeCalibrationGames: Math.max(
        100,
        Number(args["evaluator-bootstrap-min-calibration-games"]) || 200
      ),
      minimumActionReferencesPerDeckSeat:
        evaluatorBootstrapMinimumActionReferencesPerDeckSeat,
      minimumLeafValuePairsPerDeckSeat:
        evaluatorBootstrapMinimumLeafValuePairsPerDeckSeat,
      evidencePartitionRequirements:
        EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS,
      completionPartitionRequirements: policyQBootstrap
        ? EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS
        : null,
      ignoreActionEvidenceProtocolRequirements: policyQBootstrap,
      collectionScope: policyQBootstrap ? "policy-q" : "robust-action",
      invalidRetryLimit: Math.max(1,
        Number(args["evaluator-bootstrap-invalid-retry-limit"]) || 3),
      maximumGames: Math.max(100,
        Number(args["evaluator-bootstrap-max-games"]) || 320),
      extensionGames: Math.max(40,
        Number(args["evaluator-bootstrap-extension-games"]) || 160),
      maximumTotalGames: evaluatorBootstrapMaximumTotalGames,
      continueUntilComplete: evaluatorBootstrapContinueUntilComplete,
      batchGames: Math.max(4,
        Number(args["evaluator-bootstrap-batch-games"]) || 8),
      detachedActionAuditBoundaryGames: Math.max(
        320,
        Number(args["evaluator-action-audit-detach-after-games"]) || 320
      ),
      detachedActionAuditProcesses: requestedEvaluatorBootstrapProcesses,
      detachedActionAuditInitialProcesses: evaluatorBootstrapProcessBudget,
      onAuditProgress: (audit) => progress.write({
        state: "training",
        stage: "evaluator-bootstrap",
        evaluatorBootstrapDatasetKey: audit.datasetKey || null,
        acceptedGames: audit.acceptedGames,
        allocatedGames: audit.allocatedGames,
        actionReferenceCount: audit.actionReferenceCount,
        actionReferenceGameCount: audit.actionReferenceGameCount,
        actionEvidenceGradeCounts:
          audit.actionEvidenceGradeCounts || {},
        actionEvidenceStatisticalStrengthCounts:
          audit.actionEvidenceStatisticalStrengthCounts || {},
        actionEvidenceContinuationScopeCounts:
          audit.actionEvidenceContinuationScopeCounts || {},
        actionEvidenceDispositionCounts:
          audit.actionEvidenceDispositionCounts || {},
        actionEvidenceProvenanceStatusCounts:
          audit.actionEvidenceProvenanceStatusCounts || {},
        actionEvidencePairwiseRegret:
          audit.actionEvidencePairwiseRegret || null,
        actionEvidenceObservedPairGap:
          audit.actionEvidenceObservedPairGap || null,
        evaluatorCertificateKind,
        policyQEvaluatorMissing: acceptedPolicyQEvaluators.length === 0,
        robustActionEvaluatorMissing:
          frozenEvaluatorRegistry.accepted.every((model) =>
            model?.metadata?.evaluatorCertificate?.certificateKind
              !== EVALUATOR_CERTIFICATE_KINDS.robustAction),
        strongContinuationPoolReady,
        strongContinuationCandidates: strongContinuationCandidates.length,
        actionEvidenceIndependentOpeningStateCount:
          audit.actionEvidenceIndependentOpeningStateCount || 0,
        naturalDistributionActionAudit:
          audit.naturalDistributionActionAudit || null,
        leafActionEffectAudit: audit.leafActionEffectAudit || null,
        actionEvidenceComputeEfficiency:
          audit.actionEvidenceComputeEfficiency || null,
        actionEvidenceProtocol: audit.evidenceProtocol || null,
        stratumVersion: audit.stratumVersion,
        actionReferencePhaseCoverage:
          audit.actionReferencePhaseCoverage,
        actionReferencePhaseGameCount:
          audit.actionReferencePhaseGameCount,
        actionReferenceActionClassCoverage:
          audit.actionReferenceActionClassCoverage,
        actionReferenceActionClassGameCount:
          audit.actionReferenceActionClassGameCount,
        actionReferenceDeckPhaseCoverage:
          audit.actionReferenceDeckPhaseCoverage,
        actionReferenceDeckPhaseGameCount:
          audit.actionReferenceDeckPhaseGameCount,
        missingActionReferencePhaseCoverage:
          audit.missingActionReferencePhaseCoverage,
        missingActionReferenceActionClassCoverage:
          audit.missingActionReferenceActionClassCoverage,
        missingActionReferenceDeckPhaseCoverage:
          audit.missingActionReferenceDeckPhaseCoverage,
        actionAuditRacing: audit.actionAuditRacing || null,
        logicalAuditGames: audit.logicalGames,
        physicalAuditGames: audit.physicalGames,
        leafValuePairCount: audit.leafValuePairCount,
        leafValueReferenceGameCount: audit.leafValueReferenceGameCount,
        leafValuePhaseCoverage: audit.leafValuePhaseCoverage,
        leafValuePhaseReferenceGameCount:
          audit.leafValuePhaseReferenceGameCount,
        leafValueDeckPhaseCoverage:
          audit.leafValueDeckPhaseCoverage,
        leafValueDeckPhaseReferenceGameCount:
          audit.leafValueDeckPhaseReferenceGameCount,
        missingLeafValuePhaseCoverage:
          audit.missingLeafValuePhaseCoverage,
        missingLeafValueDeckPhaseCoverage:
          audit.missingLeafValueDeckPhaseCoverage,
        representativeCalibrationGames:
          audit.representativeCalibrationGames,
        representativeCalibrationRequirement: Math.max(
          100,
          Number(args["evaluator-bootstrap-min-calibration-games"])
            || 200
        ),
        missingActionReferenceCoverage:
          audit.missingActionReferenceCoverage,
        missingLeafValueCoverage: audit.missingLeafValueCoverage,
        certificationPartitions: audit.certificationPartitions,
        samplingMode: audit.samplingMode || null,
        certificationRole: audit.certificationRole || null,
        certificationRolePlan: audit.certificationRolePlan || null,
        actionCollectionStrategy:
          audit.actionCollectionStrategy || null,
        detachedActionAudit: audit.detachedActionAudit || null,
        workerPool: audit.workerPool || null,
        allocationStatus: audit.allocationStatus || null,
        activeEvidenceRoles: audit.activeEvidenceRoles || null,
        evidenceCheckpointId: audit.evidenceCheckpointId || null,
        evidenceStageRoles: audit.evidenceStageRoles || null,
        complete: audit.complete
      }),
      collection: {
        decks: population,
        model: learner,
        league: collectionLeague,
        teacherEvaluatorModels: certifiedCollectionEvaluatorModels,
        meta: learner.knowledge,
        bestOfThreeFraction,
        mirrorFraction,
        maxActions: evaluationMaxActions,
        temperature,
        shapingWeight: 0,
        diagnosticWeight: 0,
        gamma,
        gaeLambda,
        longHorizonLambda,
        longHorizonWeight,
        seed: (seed ^ 0xe7a11d17) >>> 0,
        engineFingerprint,
        balancedPairings: !evolveDecks,
        deckCurriculum: null,
        teacherFraction,
        teacherBudget: Math.max(teacherBudget, 32),
        teacherCriticalBudget: Math.max(teacherCriticalBudget, 16),
        teacherUrgentBudget: Math.max(teacherUrgentBudget, 8),
        teacherScreenSimulations,
        teacherConfirmationSimulations,
        teacherConfirmationMaxSimulations,
        teacherDepth,
        teacherCandidates,
        teacherLeafAuditSimulations,
        teacherLeafAuditSchedule,
        captureIndependentActionAudit: true,
        evidenceProtocolManifest: actionEvidenceProtocolManifest,
        evidenceSamplingFrame: actionEvidenceProtocolManifest
          ? {
            distribution: "prespecified-stratified",
            scope: actionEvidenceProtocolManifest.scope,
            candidateSelection: "mixed-priority-and-evaluator-blind"
          }
          : null,
        teacherActionAuditBudget,
        teacherActionAuditMaximumSteps,
        teacherEvaluatorMode,
        captureProductionLeafAudit: true,
        captureIndependentLeafAudit: true,
        stopRequestPath,
        onStopRequested: (stop) => progress.write({
          state: "training",
          stage: "evaluator-bootstrap-draining",
          stop
        }),
        postmortemReviews: 0,
        postmortemCaptureLimit,
        postmortemAuditInterval,
        postmortemWinnerReviewFraction: 0,
        postmortemSimulations,
        postmortemDepth,
        postmortemCandidates,
        perfProfile
      }
    };
    const targetEvaluatorBootstrapKey =
      evaluatorBootstrapDatasetKey(evaluatorBootstrapOptions);
    if (compatibleEvaluatorBootstrapKey
      && compatibleEvaluatorBootstrapKey !== targetEvaluatorBootstrapKey) {
      const targetBootstrapState = await readCheckpoint(path.join(
        dataRoot,
        "evaluator-bootstrap",
        targetEvaluatorBootstrapKey,
        "bootstrap-state.json"
      ));
      if (!targetBootstrapState) {
        progress.write({
          state: "training",
          stage: "evaluator-bootstrap-compatible-migration",
          sourceEvaluatorBootstrapDatasetKey:
            compatibleEvaluatorBootstrapKey,
          evaluatorBootstrapDatasetKey: targetEvaluatorBootstrapKey
        });
        await migrateCompatibleEvaluatorBootstrap({
          dataRoot,
          sourceDatasetKey: compatibleEvaluatorBootstrapKey,
          targetDatasetKey: targetEvaluatorBootstrapKey,
          sourceEngineFingerprint:
            compatibleEvaluatorRuntimeFingerprint,
          targetEngineFingerprint: engineFingerprint,
          concurrency: 8,
          holdoutRolePolicy:
            args["evaluator-bootstrap-migration-role-policy"]
              || "preserve-v1"
        });
      }
    }
    const persistEvaluatorBootstrapPause = async (bootstrap) => {
      if (bootstrap?.audit?.paused !== true) return false;
      const stoppedStatus = {
        state: "interrupted",
        phase: "training",
        stage: "evaluator-bootstrap-game-boundary-stop",
        generation,
        trainingIteration,
        games,
        workers: collectionWorkers,
        completedGames,
        acceptedBootstrapGames:
          bootstrap.audit.acceptedGames,
        pendingBootstrapGames:
          bootstrap.audit.pendingGames,
        stopRequestedAt:
          bootstrap.audit.stopRequestedAt,
        stopHandoffId:
          bootstrap.audit.stopHandoffId || null,
        resumable: true,
        evaluatorBootstrapDatasetKey: bootstrap.datasetKey,
        progressPath: progress.latestPath,
        eventLogPath: progress.eventLogPath
      };
      progress.write(stoppedStatus);
      await writeAiStatus(stoppedStatus);
      await unlink(stopRequestPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      console.log(JSON.stringify(stoppedStatus));
      return true;
    };
    const materializeEvaluatorBootstrapRoles = async (
      bootstrap,
      roles
    ) => {
      const recordPartitions = partitionEvaluatorBootstrapRecords(
        bootstrap.records,
        {
          deckIds: trainingDeckIds,
          seed: `bootstrap-${bootstrap.datasetKey}`,
          minimumRepresentativeCalibrationGames: Math.max(
            100,
            Number(args["evaluator-bootstrap-min-calibration-games"])
              || 200
          )
        }
      );
      const datasets = {};
      for (const role of roles) {
        const roleRequirement =
          bootstrap.audit?.certificationPartitions?.[role]?.requirement
          || EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS[role];
        datasets[role] =
        await updateIndependentTrajectoryDatasetFromBootstrapRecords(
          dataRoot,
          {
            namespace: heldoutNamespace,
            role: `evaluator-${role}`,
            collectionKey:
              `bootstrap-${role}-${bootstrap.datasetKey}`,
            lineageKey: bootstrap.datasetKey,
            engineFingerprint,
            learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
            trainingDeckIds
          },
          recordPartitions[role],
          {
            maximumGames: evaluatorBootstrapMaximumTotalGames,
            selectionPolicy: "reference-priority-balanced-v2",
            evidenceRequirement: roleRequirement,
            deckIds: trainingDeckIds
          }
        );
      }
      return { recordPartitions, datasets };
    };

    // Use only the mutable training role for early diagnostics. These checks
    // can stop an obviously broken architecture sweep, but can never select or
    // certify an evaluator and never expose confirmation/final-audit data.
    let evaluatorEarlyDiagnosticStopped = false;
    let previousEvaluatorEarlyDiagnosticReport = null;
    let evaluatorEarlyDiagnosticDemand = null;
    if (!policyQBootstrap
      && args["evaluator-legacy-v1-smoke"] === "true") {
      const legacyBootstrap = await loadEvaluatorBootstrap(
        path.join(
          dataRoot,
          "evaluator-bootstrap",
          targetEvaluatorBootstrapKey
        ),
        targetEvaluatorBootstrapKey
      );
      const legacyBootstrapAudit = summarizeEvaluatorBootstrap(
        legacyBootstrap,
        {
        deckIds: trainingDeckIds,
        evidencePartitionRequirements:
          EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS,
        activeEvidenceRoles: [EVALUATOR_TRAINING_PARTITION],
        minimumRepresentativeCalibrationGames: 0,
        minimumGamesFloor: 0,
        minimumReferenceFloor: 0,
        minimumReferenceGamesFloor: 0,
        minimumCalibrationFloor: 0,
        partitionSeed: `bootstrap-${targetEvaluatorBootstrapKey}`
        }
      );
      const legacyTrainingAudit =
        legacyBootstrapAudit.certificationPartitions?.[
          EVALUATOR_TRAINING_PARTITION
        ];
      if (Number(legacyTrainingAudit?.actionReferenceCount) >= 100
        && Number(legacyTrainingAudit?.leafValuePairCount) >= 300) {
        await runEvaluatorEarlyDiagnosticCheckpoint({
        sourceModel: learner,
        bootstrap: {
          ...legacyBootstrap,
          datasetKey: targetEvaluatorBootstrapKey
        },
        checkpointId: "legacy-v1-smoke",
        checkpointOrdinal: -1,
        collectionRequirement: {
          minimumActionReferences: 100,
          minimumLeafValuePairs: 300
        },
        trainingEvidenceRequirement: {
          minimumActionReferences: 40,
          minimumLeafValuePairs: 120,
          minimumStructuredV2ActionReferences: 0,
          minimumStructuredV2LeafValuePairs: 0
        },
        architectureSpecs: EVALUATOR_ARCHITECTURE_SPECS.filter(
          (item) => item.inputSchema === "legacy-v1"
        ),
        requireStructuredV2: false,
        replicas: 1,
        epochs: 3,
        trainingBatchSize: Math.max(4,
          Math.floor(Number(args["evaluator-training-batch-size"]) || 32)),
        learningRate: Math.max(1e-6,
          Number(args["evaluator-training-learning-rate"]) || 0.0001),
        calibrationBatchSize,
        maximumGames: evaluatorBootstrapMaximumTotalGames,
        dataRoot,
        heldoutNamespace,
        engineFingerprint,
        learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
        trainingDeckIds,
        runContract,
        progress,
        previousReport: null
        });
      }
      legacyBootstrap.records = [];
      legacyBootstrap.invalidRecords = [];
      await compactTrainingHeap();
    }
    diagnosticCheckpoints:
    for (const [checkpointOrdinal, checkpoint] of
      (policyQBootstrap
        ? []
        : EVALUATOR_EARLY_DIAGNOSTIC_CHECKPOINTS).entries()) {
      let collectionRequirement = checkpoint.requirement;
      let diagnostic = null;
      let retrySplit = previousEvaluatorEarlyDiagnosticReport?.split || null;
      for (let diagnosticAttempt = 0; diagnosticAttempt < 3;
        diagnosticAttempt += 1) {
        const shadowActionEffectWaveGames = Math.max(
          0,
          Number(
            shadowRequirement.shadowActionEffectDemand?.requestedGames
          ) || 0
        );
        evaluatorBootstrap = await collectEvaluatorBootstrapIsolated({
          ...evaluatorBootstrapOptions,
          ...(shadowActionEffectWaveGames > 0
            ? {
              extensionGames: shadowActionEffectWaveGames,
              rollingWindowGames: shadowActionEffectWaveGames
            }
            : {}),
          activeEvidenceRoles: [EVALUATOR_TRAINING_PARTITION],
          diagnosticDemand: evaluatorEarlyDiagnosticDemand,
          stopWhenEvidenceCheckpoint: {
            id: diagnosticAttempt === 0
              ? checkpoint.id
              : `${checkpoint.id}-balance-retry-${diagnosticAttempt}`,
            role: EVALUATOR_TRAINING_PARTITION,
            requirement: collectionRequirement,
            deckIds: trainingDeckIds
          }
        });
        if (await persistEvaluatorBootstrapPause(evaluatorBootstrap)) {
          evaluatorEarlyDiagnosticStopped = true;
          break diagnosticCheckpoints;
        }
        if (evaluatorBootstrap.audit?.evidenceCheckpointComplete !== true) {
          throw new Error(
            `evaluator-early-diagnostic-evidence-incomplete: ${checkpoint.id}`
          );
        }
        const trainingEvidenceRequirement =
          evaluatorEarlyDiagnosticTrainingRequirement(collectionRequirement);
        diagnostic = await runEvaluatorEarlyDiagnosticCheckpoint({
          sourceModel: learner,
          bootstrap: evaluatorBootstrap,
          checkpointId: checkpoint.id,
          checkpointOrdinal,
          diagnosticAttempt,
          validationFraction: checkpoint.validationFraction,
          collectionRequirement,
          trainingEvidenceRequirement,
          architectureSpecs: EVALUATOR_ARCHITECTURE_SPECS,
          requireStructuredV2: true,
          replicas: checkpoint.replicas,
          epochs: checkpoint.epochs,
          trainingBatchSize: Math.max(4,
            Math.floor(Number(args["evaluator-training-batch-size"]) || 32)),
          learningRate: Math.max(1e-6,
            Number(args["evaluator-training-learning-rate"]) || 0.0001),
          calibrationBatchSize,
          maximumGames: evaluatorBootstrapMaximumTotalGames,
          dataRoot,
          heldoutNamespace,
          engineFingerprint,
          learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
          trainingDeckIds,
          runContract,
          progress,
          previousReport: previousEvaluatorEarlyDiagnosticReport,
          previousSplit: retrySplit
        });
        evaluatorEarlyDiagnosticDemand =
          diagnostic.status?.shadowDevelopment?.diagnosticDemand || null;
        retrySplit = diagnostic.split;
        evaluatorBootstrap.records = [];
        evaluatorBootstrap.invalidRecords = [];
        await compactTrainingHeap();
        if (diagnostic.status.failed === true
          || diagnostic.status.diagnosticInvalid !== true) {
          break;
        }
        collectionRequirement = expandEvaluatorEarlyDiagnosticRequirement(
          checkpoint.requirement,
          diagnosticAttempt + 1
        );
      }
      previousEvaluatorEarlyDiagnosticReport = diagnostic;
      if (diagnostic?.status.diagnosticInvalid === true) {
        const stoppedStatus = {
          state: "interrupted",
          phase: "training",
          stage: "evaluator-early-diagnostic-evidence-balance-unresolved",
          generation,
          trainingIteration,
          resumable: true,
          requiresEvidenceBalance: true,
          failureOnlyDiagnostic: true,
          evaluatorBootstrapDatasetKey: evaluatorBootstrap.datasetKey,
          evaluatorEarlyDiagnostic: diagnostic.status
        };
        progress.write(stoppedStatus);
        await writeAiStatus(stoppedStatus);
        console.log(JSON.stringify(stoppedStatus));
        evaluatorEarlyDiagnosticStopped = true;
        break;
      }
      if (diagnostic?.status.failed === true) {
        const stoppedStatus = {
          state: "interrupted",
          phase: "training",
          stage: "evaluator-early-diagnostic-failed",
          generation,
          trainingIteration,
          resumable: false,
          requiresModelReview: true,
          failureOnlyDiagnostic: true,
          evaluatorBootstrapDatasetKey: evaluatorBootstrap.datasetKey,
          evaluatorEarlyDiagnostic: diagnostic.status
        };
        progress.write(stoppedStatus);
        await writeAiStatus(stoppedStatus);
        console.log(JSON.stringify(stoppedStatus));
        evaluatorEarlyDiagnosticStopped = true;
        break;
      }
    }
    if (evaluatorEarlyDiagnosticStopped) break;

    // Policy-Q gets a sealed, training-only shadow readiness pass before the
    // protected Development partition is materialized or evaluated.  The
    // architecture, learning rate, epoch count and replica contract selected
    // here are frozen before Development is opened.
    let policyQShadowReadiness = null;
    let policyQShadowInterrupted = false;
    if (policyQBootstrap) {
      const continuePolicyQShadowUntilReady =
        args["policy-q-shadow-continue-until-ready"] === "true";
      const policyQShadowMaximumCollectionAttempts = Math.max(
        POLICY_Q_SHADOW_READINESS_GRID.maximumCollectionAttempts,
        Math.floor(Number(
          args["policy-q-shadow-maximum-collection-attempts"]
        ) || (continuePolicyQShadowUntilReady ? 32 : 0))
      );
      let policyQShadowAcceptedGames = Math.max(
        0,
        Math.floor(Number(evaluatorBootstrap?.audit?.acceptedGames) || 0)
      );
      for (let shadowAttempt = 0;
        shadowAttempt < policyQShadowMaximumCollectionAttempts;
        shadowAttempt += 1) {
        const shadowRequirement = shadowAttempt === 0
          ? EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.training
          : expandPolicyQShadowReadinessRequirement(
            EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.training,
            shadowAttempt,
            policyQShadowReadiness,
            POLICY_Q_SHADOW_READINESS_GRID,
            { currentAcceptedGames: policyQShadowAcceptedGames }
          );
        evaluatorBootstrap = await collectEvaluatorBootstrapIsolated({
          ...evaluatorBootstrapOptions,
          activeEvidenceRoles: policyQShadowCollectionRoles(),
          diagnosticDemand:
            policyQShadowReadiness?.diagnosticDemand || null,
          stopWhenEvidenceCheckpoint: {
            id: `policy-q-shadow-readiness-${shadowAttempt + 1}`,
            role: EVALUATOR_TRAINING_PARTITION,
            requirement: shadowRequirement,
            deckIds: trainingDeckIds
          }
        });
        if (await persistEvaluatorBootstrapPause(evaluatorBootstrap)) {
          policyQShadowInterrupted = true;
          break;
        }
        policyQShadowAcceptedGames = Math.max(
          policyQShadowAcceptedGames,
          Math.floor(Number(evaluatorBootstrap?.audit?.acceptedGames) || 0)
        );
        policyQShadowReadiness = await runPolicyQShadowReadinessStage({
          sourceModel: learner,
          bootstrap: evaluatorBootstrap,
          collectionRequirement: shadowRequirement,
          calibrationBatchSize,
          trainingBatchSize: Math.max(4,
            Math.floor(Number(args["evaluator-training-batch-size"]) || 32)),
          candidateProcessesMaximum: Math.max(1, Math.min(4,
            Math.floor(Number(args["evaluator-candidate-processes"]) || 4))),
          candidateProcessReserveBytes: Math.max(
            2 * 1024 ** 3,
            Number(args["evaluator-candidate-memory-reserve-bytes"])
              || 4 * 1024 ** 3
          ),
          candidateProcessEstimatedBytes: Math.max(
            1024 ** 3,
            Number(args["evaluator-candidate-estimated-memory-bytes"])
              || Math.floor(1.75 * 1024 ** 3)
          ),
          maximumGames: evaluatorBootstrapMaximumTotalGames,
          dataRoot,
          heldoutNamespace,
          engineFingerprint,
          learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
          trainingDeckIds,
          continuationLineage: evaluatorBootstrapContinuationLineage,
          runContract,
          progress
        });
        evaluatorBootstrap.records = [];
        evaluatorBootstrap.invalidRecords = [];
        await compactTrainingHeap();
        if (policyQShadowReadiness.passed === true) break;
        if (policyQShadowReadiness.outcome === "structural-failure") break;
      }
      if (policyQShadowInterrupted) break;
      if (policyQShadowReadiness?.passed !== true) {
        const shadowOutcome = policyQShadowReadiness?.outcome
          || "inconclusive";
        const stoppedStatus = {
          state: "interrupted",
          phase: "training",
          stage: shadowOutcome === "structural-failure"
            ? "evaluator-policy-q-shadow-structural-failure"
            : "evaluator-policy-q-shadow-inconclusive",
          generation,
          trainingIteration,
          resumable: true,
          protectedDevelopmentOpened: false,
          shadowOutcome,
          requiresTrainingEvidenceOrModelReview: true,
          requiresModelReview: shadowOutcome === "structural-failure",
          requiresAdditionalBalancedEvidence:
            shadowOutcome !== "structural-failure",
          evaluatorBootstrapDatasetKey: evaluatorBootstrap.datasetKey,
          policyQShadowReadiness
        };
        progress.write(stoppedStatus);
        await writeAiStatus(stoppedStatus);
        console.log(JSON.stringify(stoppedStatus));
        break;
      }
    }

    // Protected evidence is collected only after the preceding gate passes.
    // The stop option is orchestration-only and intentionally does not change
    // the bootstrap dataset key, so one lineage is resumed across all stages.
    evaluatorBootstrap = await collectEvaluatorBootstrapIsolated({
      ...evaluatorBootstrapOptions,
      diagnosticDemand: evaluatorEarlyDiagnosticDemand,
      stopWhenEvidenceRolesComplete: policyQBootstrap
        ? ["development"]
        : [EVALUATOR_TRAINING_PARTITION, "development"],
      activeEvidenceRoles: policyQBootstrap
        ? ["development"]
        : [EVALUATOR_TRAINING_PARTITION, "development"]
    });
    if (await persistEvaluatorBootstrapPause(evaluatorBootstrap)) break;
    let materializedBootstrap = await materializeEvaluatorBootstrapRoles(
      evaluatorBootstrap,
      [EVALUATOR_TRAINING_PARTITION, "development"]
    );
    evaluatorTrainingDataset =
      materializedBootstrap.datasets[EVALUATOR_TRAINING_PARTITION];
    evaluatorDevelopmentDataset =
      materializedBootstrap.datasets.development;

    evaluatorDevelopmentGate = await trainEvaluatorDevelopmentStage({
      certificateKind: evaluatorCertificateKind,
      sourceModel: learner,
      trainingDataset: evaluatorTrainingDataset,
      developmentDataset: evaluatorDevelopmentDataset,
      calibrationFit: [],
      calibrationTest: [],
      calibrationFitManifest: bootstrapCalibrationFitManifest,
      calibrationTestManifest: bootstrapCalibrationTestManifest,
      calibrationBatchSize,
      replicas: policyQBootstrap
        ? policyQShadowReadiness.schedule.replicas
        : Math.max(1, Math.min(5,
          Math.floor(Number(args["evaluator-training-replicas"]) || 3))),
      epochs: policyQBootstrap
        ? policyQShadowReadiness.schedule.epochs
        : Math.max(1,
          Math.floor(Number(args["evaluator-training-epochs"]) || 8)),
      trainingBatchSize: Math.max(4,
        Math.floor(Number(args["evaluator-training-batch-size"]) || 32)),
      candidateProcessesMaximum: Math.max(1, Math.min(4,
        Math.floor(Number(args["evaluator-candidate-processes"]) || 4))),
      candidateProcessReserveBytes: Math.max(
        2 * 1024 ** 3,
        Number(args["evaluator-candidate-memory-reserve-bytes"])
          || 4 * 1024 ** 3
      ),
      candidateProcessEstimatedBytes: Math.max(
        1024 ** 3,
        Number(args["evaluator-candidate-estimated-memory-bytes"])
          || Math.floor(1.75 * 1024 ** 3)
      ),
      learningRate: policyQBootstrap
        ? policyQShadowReadiness.schedule.learningRate
        : Math.max(1e-6,
          Number(args["evaluator-training-learning-rate"]) || 0.0001),
      architectureSpecs: policyQBootstrap
        ? [policyQShadowReadiness.schedule.architecture]
        : EVALUATOR_ARCHITECTURE_SPECS,
      seedNamespace: policyQBootstrap
        ? `policy-q-official:${policyQShadowReadiness.gridHash}`
        : "",
      balanceTrainingStrata: policyQBootstrap,
      progressContext: policyQBootstrap ? {
        policyQReadinessProgress: {
          version: 2,
          contract: POLICY_Q_SHADOW_READINESS_CONTRACT,
          gridHash: policyQShadowReadiness.gridHash,
          phase: "official-development",
          protectedDevelopmentOpened: true,
          schedule: policyQShadowReadiness.schedule
        }
      } : null,
      precommittedTrainingSchedule: policyQBootstrap
        ? policyQShadowReadiness.schedule
        : null,
      trainingEvidenceRequirement: policyQBootstrap
        ? EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.training
        : EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS.training,
      continuationLineage: evaluatorBootstrapContinuationLineage,
      dataRoot,
      trainingIteration,
      bootstrapDatasetKey: evaluatorBootstrap.datasetKey,
      engineFingerprint,
      runContract,
      progress
    });
    if (evaluatorDevelopmentGate.passed !== true) {
      const stoppedStatus = {
        state: "interrupted",
        phase: "training",
        stage: "evaluator-development-gate-failed",
        generation,
        trainingIteration,
        resumable: false,
        requiresEvidenceReview: true,
        evaluatorBootstrapDatasetKey: evaluatorBootstrap.datasetKey,
        evaluatorDevelopmentGate
      };
      progress.write(stoppedStatus);
      await writeAiStatus(stoppedStatus);
      console.log(JSON.stringify(stoppedStatus));
      break;
    }
    releaseTrajectoryDatasets(
      evaluatorTrainingDataset,
      evaluatorDevelopmentDataset
    );
    releaseMaterializedBootstrap(materializedBootstrap, {
      releaseDatasets: true
    });
    materializedBootstrap = null;
    evaluatorBootstrap.records = [];
    evaluatorBootstrap.invalidRecords = [];
    await compactTrainingHeap();

    evaluatorBootstrap = await collectEvaluatorBootstrapIsolated({
      ...evaluatorBootstrapOptions,
      stopWhenEvidenceRolesComplete: ["confirmation"],
      activeEvidenceRoles: ["confirmation"]
    });
    if (await persistEvaluatorBootstrapPause(evaluatorBootstrap)) break;
    materializedBootstrap = await materializeEvaluatorBootstrapRoles(
      evaluatorBootstrap,
      ["confirmation"]
    );
    evaluatorConfirmationDataset =
      materializedBootstrap.datasets.confirmation;
    evaluatorConfirmationGate = await evaluateEvaluatorConfirmationStage({
      certificateKind: evaluatorCertificateKind,
      developmentGate: evaluatorDevelopmentGate,
      confirmationDataset: evaluatorConfirmationDataset,
      calibrationBatchSize,
      dataRoot,
      trainingIteration,
      bootstrapDatasetKey: evaluatorBootstrap.datasetKey,
      engineFingerprint,
      progress
    });
    if (evaluatorConfirmationGate.passed !== true) {
      const stoppedStatus = {
        state: "interrupted",
        phase: "training",
        stage: "evaluator-confirmation-gate-failed",
        generation,
        trainingIteration,
        resumable: false,
        requiresNewDevelopmentCycle: true,
        evaluatorBootstrapDatasetKey: evaluatorBootstrap.datasetKey,
        evaluatorConfirmationGate: evaluatorGateWithoutCheckpoint(
          evaluatorConfirmationGate
        )
      };
      progress.write(stoppedStatus);
      await writeAiStatus(stoppedStatus);
      console.log(JSON.stringify(stoppedStatus));
      break;
    }
    releaseTrajectoryDatasets(evaluatorConfirmationDataset);
    releaseMaterializedBootstrap(materializedBootstrap, {
      releaseDatasets: true
    });
    materializedBootstrap = null;
    evaluatorBootstrap.records = [];
    evaluatorBootstrap.invalidRecords = [];
    await compactTrainingHeap();

    evaluatorBootstrap = await collectEvaluatorBootstrapIsolated({
      ...evaluatorBootstrapOptions,
      activeEvidenceRoles: ["final-audit"]
    });
    if (await persistEvaluatorBootstrapPause(evaluatorBootstrap)) break;
    materializedBootstrap = await materializeEvaluatorBootstrapRoles(
      evaluatorBootstrap,
      EVALUATOR_EVIDENCE_PARTITIONS
    );
    const bootstrapRecordPartitions = materializedBootstrap.recordPartitions;
    const bootstrapPartitionDatasets = materializedBootstrap.datasets;
    evaluatorTrainingDataset =
      bootstrapPartitionDatasets[EVALUATOR_TRAINING_PARTITION];
    evaluatorDevelopmentDataset = bootstrapPartitionDatasets.development;
    evaluatorConfirmationDataset = bootstrapPartitionDatasets.confirmation;
    evaluatorFinalAuditDataset =
      bootstrapPartitionDatasets["final-audit"];
    evaluatorCertificationCalibrationDataset =
      await updateIndependentTrajectoryDatasetFromBootstrapRecords(
        dataRoot,
        {
          namespace: heldoutNamespace,
          role: "evaluator-bootstrap-calibration-test",
          collectionKey: `bootstrap-calibration-${evaluatorBootstrap.datasetKey}`,
          lineageKey: evaluatorBootstrap.datasetKey,
          engineFingerprint,
          learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
          trainingDeckIds
        },
        bootstrapRecordPartitions.calibration,
        {
          maximumGames: evaluatorBootstrapMaximumTotalGames,
          selectionPolicy: "representative-uniform-balanced-v1",
          deckIds: trainingDeckIds
        }
      );
    evaluatorCertificationCalibrationFromBootstrap = true;
    releaseMaterializedBootstrap(materializedBootstrap, {
      releaseDatasets: false
    });
    materializedBootstrap = null;
    const collectionAudit = evaluatorBootstrap.audit;
    const collectionCertificationPartitionAudits = Object.fromEntries(
      EVALUATOR_EVIDENCE_PARTITIONS.map((role) => [
        role,
        collectionAudit?.certificationPartitions?.[role] || {
          complete: false,
          reason: "missing-compact-certification-partition-audit"
        }
      ])
    );
    const certificationPartitionAudits = Object.fromEntries(
      EVALUATOR_EVIDENCE_PARTITIONS.map((role) => [
        role,
        bootstrapPartitionDatasets[role]?.manifest?.evidenceAudit || {
          complete: false,
          reason: "missing-materialized-evidence-audit"
        }
      ])
    );
    const collectionComplete = collectionAudit?.complete === true;
    const certificationPartitionsComplete =
      Object.values(certificationPartitionAudits)
        .every((audit) => audit.complete);
    const certificationAudit = {
      ...collectionAudit,
      version: 6,
      complete: collectionComplete && certificationPartitionsComplete,
      collectionComplete,
      certificationPartitionsComplete,
      partitions: Object.fromEntries(Object.entries(
        certificationPartitionAudits
      ).map(([role, audit]) => [role, {
        ...audit,
        sourceCollectionAudit:
          collectionCertificationPartitionAudits[role] || null,
        datasetFingerprint:
          bootstrapPartitionDatasets[role].manifest.datasetFingerprint,
        datasetManifest: bootstrapPartitionDatasets[role].manifest
      }]))
    };
    evaluatorBootstrap = {
      ...evaluatorBootstrap,
      collectionAudit,
      audit: {
        ...certificationAudit,
        allocation: collectionAudit?.allocation || null,
        certificationDatasetFingerprint:
          evaluatorFinalAuditDataset.manifest.datasetFingerprint,
        certificationDatasetManifest:
          evaluatorFinalAuditDataset.manifest
      }
    };
    evaluatorAuditDataset = evaluatorDevelopmentDataset;
  }
  if (evaluatorBootstrap) {
    evaluatorBootstrap.records = [];
    evaluatorBootstrap.invalidRecords = [];
  }
  await compactTrainingHeap();
  await restoreTrainingWorkingSet();
  const evaluatorTrainingEvidenceAudit =
    evaluatorBootstrap?.audit?.certificationPartitions
      ?.[EVALUATOR_TRAINING_PARTITION] || null;
  const evaluatorTrainingEvidenceStatus = {
    version: 1,
    status: evaluatorTrainingEvidenceAudit?.complete === true
      ? "ready"
      : "evaluator-training-evidence-insufficient",
    passed: evaluatorTrainingEvidenceAudit?.complete === true,
    actionReferences:
      Number(evaluatorTrainingEvidenceAudit?.actionReferenceCount) || 0,
    actionReferenceGames:
      Number(evaluatorTrainingEvidenceAudit?.actionReferenceGameCount) || 0,
    leafValuePairs:
      Number(evaluatorTrainingEvidenceAudit?.leafValuePairCount) || 0,
    leafValueReferenceGames:
      Number(evaluatorTrainingEvidenceAudit?.leafValueReferenceGameCount) || 0,
    missingActionPhases:
      evaluatorTrainingEvidenceAudit?.missingActionReferencePhaseCoverage || [],
    missingLeafPhases:
      evaluatorTrainingEvidenceAudit?.missingLeafValuePhaseCoverage || [],
    missingActionClasses:
      evaluatorTrainingEvidenceAudit
        ?.missingActionReferenceActionClassCoverage || [],
    missingActionDeckPhases:
      evaluatorTrainingEvidenceAudit
        ?.missingActionReferenceDeckPhaseCoverage || [],
    missingLeafDeckPhases:
      evaluatorTrainingEvidenceAudit
        ?.missingLeafValueDeckPhaseCoverage || []
  };
  if (officialPromotionRun && !evaluatorTrainingEvidenceStatus.passed) {
    progress.write({
      state: "training",
      stage: "evaluator-training-evidence-insufficient",
      evaluatorTrainingEvidenceStatus
    });
  }
  assertTrainingTrajectories(calibrationFitDataset.trajectories, engineFingerprint);
  assertTrainingTrajectories(calibrationTestDataset.trajectories, engineFingerprint);
  for (const dataset of [
    evaluatorTrainingDataset,
    evaluatorAuditDataset,
    evaluatorConfirmationDataset,
    evaluatorFinalAuditDataset,
    evaluatorCertificationCalibrationDataset
  ]) {
    if (Array.isArray(dataset.trajectories)) {
      assertTrainingTrajectories(dataset.trajectories, engineFingerprint);
    }
  }
  const calibrationSplit = {
    version: 2,
    fit: calibrationFitDataset.trajectories,
    test: calibrationTestDataset.trajectories,
    manifest: {
      splitUnit: "game",
      fitGames: calibrationFitDataset.manifest.games,
      testGames: calibrationTestDataset.manifest.games,
      overlapGames: 0,
      sourcePartitionManifestVersion: trajectoryPartitions.manifest.version,
      cumulativeFitDataset: calibrationFitDataset.manifest,
      cumulativeTestDataset: calibrationTestDataset.manifest
    }
  };
  const calibrationTrajectories = [...calibrationSplit.fit, ...calibrationSplit.test];
  const retentionBaseline = evaluateRetentionByDeck(learner, retentionTrajectories);
  const retentionHistory = [];
  const learningRate = configuredLearningRate;
  const practicalEvaluationSeed = generationSeed + 37;
  // Epoch candidates now play the unchanged parent learner directly. Its
  // expected self-play score is exactly neutral, so running a separate
  // 20-game baseline was both noisy and redundant.
  const practicalBaseline = epochEvaluationGames > 0
    ? { version: 3, opponent: "parent-learner", neutral: true, score: 0.5, winRate: 0.5 }
    : null;
  // Keep half of the small epoch screen fixed for comparable learning curves
  // and rotate the other half every epoch for a genuine generalization check.
  // Five decks × four games gives the intended 20 + 20 contract at the
  // standard 40-game setting.
  const commonDevelopmentGames = epochEvaluationGames > 0
    ? Math.min(
      epochEvaluationGames,
      Math.max(
        trainingDeckIds.length * 4,
        Math.floor(epochEvaluationGames / 2)
      )
    )
    : 0;
  const rotatingValidationGames = Math.max(0, epochEvaluationGames - commonDevelopmentGames);
  const finalEpochConfirmationGames = epochEvaluationGames > 0
    ? Math.max(trainingDeckIds.length * 8, Math.ceil(
      (Number(args["final-epoch-confirmation-games"]) || trainingDeckIds.length * 8) / 8
    ) * 8)
    : 0;
  const finalEpochAuditGames = protectedFinalAuditGamesForRun(
    runContract,
    Number(args["final-epoch-audit-games"]) || 104,
    epochEvaluationGames > 0
  );
  const finalEpochConfirmationSeed = (generationSeed + 0x4f1bbcdc) >>> 0;
  const finalEpochAuditSeed = (generationSeed + 0x6d2b79f5) >>> 0;
  const practicalHistory = [];
  const humanEpochs = Math.max(1, Number(args["human-epochs"]) || 1);
  const humanBatchSize = Math.max(1, Number(args["human-batch-size"]) || 4);
  const correctionLifecycleTtl = Math.max(
    1,
    Number(args["teacher-correction-lifecycle-ttl"]) || 8
  );
  const benchmarkGames = Math.max(
    evaluationGames,
    Math.ceil((Number(args["benchmark-games"]) || 40) / 4) * 4
  );
  const minimumLeagueGames = diagnosticRun ? 4 : 20;
  const configuredLeagueGamesPerOpponent = Math.max(
    minimumLeagueGames,
    Math.ceil((Number(args["league-games-per-opponent"]) || evaluationGames) / 4) * 4
  );
  const intrinsicEvaluationMode = "same-deck-mirror-v3";
  const intrinsicEvaluationGames = Math.max(
    trainingDeckIds.length * 8,
    Math.ceil(
      (Number(args["intrinsic-evaluation-games"]) || trainingDeckIds.length * 8) / 8
    ) * 8
  );
  const maxSeatGap = Number(args["max-seat-gap"]) || 0.2;
  const maxConditionGap = Number(args["max-condition-gap"]) || 0.4;
  const minimumDeckWinRate = Math.max(
    0,
    Math.min(0.5, Number(args["minimum-deck-win-rate"]) || 0.35)
  );
  const minimumDeckScoreMargin = Math.max(
    -8,
    Math.min(0, Number(args["minimum-deck-score-margin"]) || -2.5)
  );
  const learnerMinimumDeckWinRate = Number(args["learner-minimum-deck-win-rate"]) || 0.25;
  const learnerMinimumDeckScoreMargin = Number(args["learner-minimum-deck-score-margin"]) || -3.5;
  const intrinsicMinimumDeckGames = Math.max(8, Math.floor(
    Number(args["intrinsic-minimum-deck-games"])
      || intrinsicEvaluationGames / Math.max(1, trainingDeckIds.length)
  ));
  const intrinsicConfirmationDeckGames = Math.max(
    intrinsicMinimumDeckGames,
    Math.floor(Number(args["intrinsic-confirmation-deck-games"]) || 24)
  );
  const gradientConflictDiagnosticsEnabled =
    args["gradient-conflict-diagnostics"] !== "false";
  const policyConditionedContinuationHash =
    evaluatorBootstrap?.audit?.continuationLineage?.continuationPolicyHash
      || null;
  const currentContinuationPolicyHash = deterministicValueDigest(
    neuralContinuationLineage(learner)
  );
  const currentContinuationPolicyArtifactHash = neuralArtifactHash(learner);
  const policyConditionedActionCorrections =
    policyConditionedActorCorrectionEnabled
      && policyConditionedContinuationHash
      && policyConditionedContinuationHash === currentContinuationPolicyHash
      ? await collectPolicyConditionedActionCorrections(
        evaluatorTrainingDataset,
        {
          engineFingerprint,
          continuationLineage:
            evaluatorBootstrap.audit.continuationLineage,
          currentPolicyHash: currentContinuationPolicyHash,
          currentPolicyArtifactHash: currentContinuationPolicyArtifactHash,
          maximumCorrections: policyConditionedActorCorrectionMaximum
        }
      )
      : [];
  if (policyConditionedActorCorrectionEnabled) {
    progress.write({
      state: "training",
      stage: "policy-conditioned-q-correction-ready",
      corrections: policyConditionedActionCorrections.length,
      maximumCorrections: policyConditionedActorCorrectionMaximum,
      fraction: policyConditionedActorCorrectionFraction,
      continuationLineageMatched: Boolean(
        policyConditionedContinuationHash
          && policyConditionedContinuationHash === currentContinuationPolicyHash
      ),
      sourceRole: evaluatorTrainingDataset?.manifest?.role || null
    });
  }
  const trainingControls = {
    version: 1,
    engineFingerprint,
    collectionKey: descriptor.collectionKey,
    learnerGeneration: learner.generation,
    ppo: {
      epochs: ppoEpochs,
      batchSize: ppoBatchSize,
      sequenceLength: MAX_SEQUENCE,
      learningRate,
      gamma,
      gaeLambda,
      longHorizonLambda,
      longHorizonWeight,
      stratified: true,
      earlyStoppingPatience,
      minimumEpochsBeforeEarlyStopping,
      minimumScoreImprovement,
      selectBestEpoch: true
    },
    losses: {
      mainPpo: {
        clipRatio: 0.2,
        policyCoefficient: 1,
        valueCoefficient: 0.5,
        actionValueCoefficient: 0.25,
        diagnosticCoefficient: 0.05,
        beliefCoefficient: 0.15,
        entropyCoefficient: 0.01
      },
      teacherCoefficient,
      teacherPolicyPreferenceCoefficient,
      teacherRankingCoefficient,
      teacherActionValueCoefficient,
      teacherCorrectionFraction,
      policyConditionedActorCorrection: {
        enabled: policyConditionedActorCorrectionEnabled,
        corrections: policyConditionedActionCorrections.length,
        maximum: policyConditionedActorCorrectionMaximum,
        fraction: policyConditionedActorCorrectionFraction,
        continuationPolicyHash: policyConditionedContinuationHash,
        currentPolicyHash: currentContinuationPolicyHash,
        lineageMatched: policyConditionedContinuationHash
          === currentContinuationPolicyHash,
        maximumActorWeight: 0.35,
        minimumAnchorCoefficient: 0.05
      },
      correctionLifecycleTtl,
      proof: {
        teacherCoefficient: 0.7,
        distillationCoefficient: 0.25,
        rankingCoefficient: 0.75,
        actionValueCoefficient: 0.55
      },
      verifiedCorrection: {
        teacherCoefficient: Math.max(0.25, teacherCoefficient),
        distillationCoefficient: 0.15,
        rankingCoefficient: Math.max(0.4, teacherRankingCoefficient),
        actionValueCoefficient: Math.max(0.35, teacherActionValueCoefficient)
      },
      provisionalActionValue: {
        coefficient: 0.08,
        maximumVerifiedMassRatio: 0.15,
        maximumFraction: 0.15
      },
      postmortem: {
        teacherCoefficient: Math.min(0.45, Math.max(0.25, teacherCoefficient)),
        distillationCoefficient: 0.15,
        rankingCoefficient: Math.min(0.55, Math.max(0.4, teacherRankingCoefficient)),
        actionValueCoefficient: Math.min(0.5, Math.max(0.35, teacherActionValueCoefficient))
      },
      diagnosticWeight,
      anchorCoefficient,
      warmStartAnchorCoefficient,
      warmStartAnchorEpochs,
      generationUsesCrossEngineWarmStart,
      learnerAnchorWeight,
      championAnchorWeight
    },
    partitions: {
      retentionFraction,
      calibrationFitFraction,
      calibrationTestFraction,
      evaluatorAuditFraction,
      minimumRetentionTrajectoriesPerDeck,
      minimumTrainingTrajectoriesPerDeck,
      manifest: trajectoryPartitions.manifest,
      calibrationFitMaximumGames,
      calibrationTestMaximumGames,
      evaluatorAuditMaximumGames,
      calibrationBatchSize
    },
    epochSelection: {
      protocol: "hard-gates-paired-screen-top-two-v8",
      baselineSelectionScore: practicalBaseline?.score ?? 0.5,
      baselineTieBreakerScore: retentionCompositeScore(retentionBaseline),
      epochEvaluationGames,
      epochEvaluationMode,
      commonDevelopmentGames,
      rotatingValidationGames,
      finalEpochConfirmationGames,
      finalEpochConfirmationSeed,
      // A/B must never consume the one-time protected audit.
      finalEpochAuditGames,
      finalEpochAuditSeed: finalEpochAuditGames > 0 ? finalEpochAuditSeed : null,
      epochEvaluationMaxActions,
      epochPracticalWeight,
      epochMaximumRetentionDrop,
      epochMinimumPracticalScore,
      epochMinimumPracticalWinRate,
      evaluationGreedy,
      evaluationTemperature
    },
    finalEvaluation: {
      evaluationGames,
      evaluationMode,
      evaluationMaxActions,
      evaluationCompletionRate,
      evaluationGreedy,
      evaluationTemperature,
      benchmarkGames,
      configuredLeagueGamesPerOpponent,
      intrinsicEvaluationMode,
      intrinsicEvaluationGames,
      maxSeatGap,
      maxConditionGap,
      minimumDeckWinRate,
      minimumDeckScoreMargin,
      learnerMinimumDeckWinRate,
      learnerMinimumDeckScoreMargin,
      intrinsicMinimumDeckGames,
      intrinsicConfirmationDeckGames
    },
    humanTraining: {
      epochs: humanEpochs,
      batchSize: humanBatchSize,
      valueCoefficient: 0.1,
      beliefCoefficient: 0.05
    },
    auxiliaryReplay: {
      fraction: turningPointReplayFraction,
      limit: turningPointReplayLimit
    },
    gradientConflictDiagnostics: gradientConflictDiagnosticsEnabled
  };
  const ppoBatchOrder = createPpoBatchOrderManifest(trainingTrajectories, {
    epochs: ppoEpochs,
    batchSize: ppoBatchSize,
    sequenceLength: MAX_SEQUENCE,
    randomState: trainingRandomInitialState
  });
  const inputDataManifest = {
    version: 2,
    training: trajectorySequenceManifest(trainingTrajectories),
    auxiliaryReplay: trajectorySequenceManifest(auxiliaryReplayTrajectories),
    auxiliaryReplayIds: replayEntries.map((entry) => entry.replayId),
    humanReplay: trajectorySequenceManifest(safeHumanTrajectories),
    retention: trajectorySequenceManifest(retentionTrajectories),
    calibrationFit: independentDatasetInputManifest(calibrationFitDataset),
    calibrationTest: independentDatasetInputManifest(calibrationTestDataset),
    evaluatorTraining:
      independentDatasetInputManifest(evaluatorTrainingDataset),
    policyConditionedActionCorrections:
      trajectorySequenceManifest(policyConditionedActionCorrections),
    evaluatorDevelopment:
      independentDatasetInputManifest(evaluatorDevelopmentDataset),
    evaluatorConfirmation:
      independentDatasetInputManifest(evaluatorConfirmationDataset),
    evaluatorFinalAudit:
      independentDatasetInputManifest(evaluatorFinalAuditDataset),
    balancing: balancedTraining.report
  };
  const abTrainingBinding = {
    trainingControlHash: checkpointHash(trainingControls),
    inputDataHash: deterministicValueDigest(inputDataManifest),
    ppoBatchOrderFingerprint: ppoBatchOrder.fingerprint,
    trainingControls,
    inputDataManifest,
    ppoBatchOrder
  };
  if (experimentManifestPath) {
    await bindAbExperimentTrainingContract(
      experimentManifestPath,
      abTrainingBinding,
      runContract,
      teacherConsumptionPolicy
    );
  }
  const trainingKey = checkpointHash({
    runContract,
    experimentId,
    teacherConsumptionPolicy,
    ...abTrainingBinding
  });
  const pendingTrainingPath = path.join(dataRoot, "resume", `iteration-${String(trainingIteration).padStart(5, "0")}`, "trained-candidate.json");
  const pendingTraining = await readCheckpoint(pendingTrainingPath);
  const epochCheckpointDirectory = path.join(
    dataRoot,
    "resume",
    `iteration-${String(trainingIteration).padStart(5, "0")}`,
    "epochs"
  );
  const epochTrainingResume = pendingTraining?.trainingKey === trainingKey
    ? null
    : await loadLatestEpochTrainingCheckpoint(epochCheckpointDirectory, trainingKey);
  let candidate;
  let trained;
  let humanTrainingSteps = 0;
  if (pendingTraining?.trainingKey === trainingKey && pendingTraining.candidateCheckpoint && pendingTraining.optimizerState) {
    candidate = deserializeNeuralModel(pendingTraining.candidateCheckpoint);
    optimizer = await restoreAdamOptimizer(pendingTraining.optimizerState, learningRate);
    trained = { calibration: pendingTraining.calibration || candidate.calibration };
    humanTrainingSteps = pendingTraining.humanTrainingSteps || 0;
    progress.write({ state: "training", stage: "training-resumed", trajectories: trainingTrajectories.length, calibrationTrajectories: calibrationTrajectories.length, pendingTrainingPath });
  } else {
    if (epochTrainingResume?.candidateCheckpoint && epochTrainingResume.optimizerState) {
      candidate = deserializeNeuralModel(epochTrainingResume.candidateCheckpoint);
      optimizer = await restoreAdamOptimizer(epochTrainingResume.optimizerState, learningRate);
      if (epochTrainingResume.randomState != null) {
        trainingRandom.setState(epochTrainingResume.randomState);
      }
      progress.write({
        state: "training",
        stage: "epoch-training-resumed",
        epoch: epochTrainingResume.epoch,
        epochs: ppoEpochs,
        trajectories: trainingTrajectories.length,
        epochCheckpointPath: epochTrainingResume.path
      });
    } else {
      candidate = deserializeNeuralModel(serializeNeuralModel(learner));
      mergeKnowledge(candidate.knowledge, collected.deckLearning);
      normalizeKnowledge(candidate.knowledge);
    }
    progress.write({ state: "training", stage: "ppo", trajectories: collected.trajectories.length, epoch: 0, epochs: ppoEpochs, batch: 0 });
    await writeAiStatus({ state: "training", generation, trainingIteration, games, trajectories: collected.trajectories.length, resumedArchive: Boolean(collected.resumedFromArchive), progressPath: progress.latestPath, eventLogPath: progress.eventLogPath });
    await writeCheckpoint(optimizerStatePath, await serializeOptimizer(optimizer, learner.generation));
    trained = await trainRecurrentPpo(candidate, trainingTrajectories, {
      epochs: ppoEpochs,
      batchSize: ppoBatchSize,
      learningRate,
      optimizer,
      teacherCoefficient,
      teacherPolicyPreferenceCoefficient,
      teacherRankingCoefficient,
      teacherActionValueCoefficient,
      teacherCorrectionFraction,
      enablePolicyConditionedActorCorrection:
        policyConditionedActionCorrections.length > 0,
      policyConditionedCorrectionTrajectories:
        policyConditionedActionCorrections,
      policyConditionedCorrectionFraction:
        policyConditionedActorCorrectionFraction,
      policyConditionedCorrectionCoefficient: 0.3,
      policyConditionedCorrectionRankingCoefficient: 0.3,
      policyConditionedCorrectionAnchorCoefficient: Math.max(
        0.05,
        anchorCoefficient
      ),
      teacherConsumptionPolicy,
      correctionLifecycleStep: curriculumIteration,
      correctionLifecycleTtl,
      anchorModels: mixedAnchorModels(learnerAtGenerationStart, champion, {
        learnerWeight: learnerAnchorWeight,
        championWeight: championAnchorWeight
      }),
      anchorCoefficient,
      anchorCoefficientForEpoch: generationUsesCrossEngineWarmStart
        ? ({ epoch }) => epoch <= warmStartAnchorEpochs
          ? warmStartAnchorCoefficient
          : anchorCoefficient
        : null,
      stratified: true,
      selectBestEpoch: true,
      baselineSelectionScore: practicalBaseline?.score ?? 0.5,
      baselineTieBreakerScore: retentionCompositeScore(retentionBaseline),
      earlyStoppingPatience,
      minimumEpochsBeforeEarlyStopping,
      minimumScoreImprovement,
      calibrationFitTrajectories: calibrationSplit.fit,
      calibrationTestTrajectories: calibrationSplit.test,
      calibrationTrajectories,
      gamesObserved: completedGames,
      auxiliaryTrajectories: auxiliaryReplayTrajectories,
      random: trainingRandom,
      teacherRandom: seededRandom(generationSeed ^ 0xc2b2ae35),
      startEpoch: epochTrainingResume?.epoch || 0,
      resumeState: epochTrainingResume?.selectionState || null,
      finalSelectionBaselineModel: learnerAtGenerationStart,
      finalSelectionBaselineOptimizerState: optimizerStateAtGenerationStart,
      finalSelectionBaselineRandomState: trainingRandomInitialState,
      gradientConflictDiagnostics: gradientConflictDiagnosticsEnabled,
      epochGuard: ({ epoch, model }) => {
        const current = evaluateRetentionByDeck(model, retentionTrajectories);
        const guard = compareRetentionByDeck(retentionBaseline, current);
        let practical = null;
        if (epochEvaluationGames > 0) {
          progress.write({ state: "training", stage: "epoch-practical-evaluation", epoch, game: 0, games: epochEvaluationGames });
          const commonSeed = practicalEvaluationSeed >>> 0;
          const rotatingSeed = (practicalEvaluationSeed + epoch * 104729) >>> 0;
          const suites = [];
          if (commonDevelopmentGames > 0) {
            suites.push(evaluateNeuralModels(model, learnerAtGenerationStart, trainingDecks, {
              games: commonDevelopmentGames,
              maxActions: epochEvaluationMaxActions,
              seed: commonSeed,
              engineFingerprint,
              evaluationMode: epochEvaluationMode,
              greedy: evaluationGreedy,
              temperature: evaluationTemperature,
              onGameComplete: (item) => progress.write({
                state: "training", stage: "epoch-practical-evaluation", suite: "common-development",
                epoch, ...item, games: epochEvaluationGames
              })
            }));
          }
          if (rotatingValidationGames > 0) {
            suites.push(evaluateNeuralModels(model, learnerAtGenerationStart, trainingDecks, {
              games: rotatingValidationGames,
              maxActions: epochEvaluationMaxActions,
              seed: rotatingSeed,
              engineFingerprint,
              evaluationMode: epochEvaluationMode,
              greedy: evaluationGreedy,
              temperature: evaluationTemperature,
              onGameComplete: (item) => progress.write({
                state: "training", stage: "epoch-practical-evaluation", suite: "rotating-validation",
                epoch, ...item, game: commonDevelopmentGames + item.game, games: epochEvaluationGames
              })
            }));
          }
          practical = summarizePracticalEvaluation(
            mergeNeuralEvaluations(suites, trainingDecks),
            {
              requiredDeckIds: trainingDeckIds,
              minimumDeckGames: Math.max(1, Math.floor(epochEvaluationGames / trainingDeckIds.length))
            }
          );
          practical.seedManifest = {
            version: 1,
            commonDevelopment: { seed: commonSeed, games: commonDevelopmentGames },
            rotatingValidation: { seed: rotatingSeed, games: rotatingValidationGames }
          };
          practicalHistory.push({ epoch, ...practical });
        }
        const selection = robustEpochSelection(guard, practical, {
          baselineRetentionScore: retentionCompositeScore(retentionBaseline),
          practicalWeight: epochPracticalWeight,
          maximumRetentionDrop: epochMaximumRetentionDrop,
          minimumPracticalScore: epochMinimumPracticalScore,
          minimumPracticalWinRate: epochMinimumPracticalWinRate
        });
        retentionHistory.push({ epoch, ...guard, ...selection, selectionScore: selection.score, decks: current });
        return { ...guard, ...selection, retentionScore: guard.score, practical };
      },
      finalEpochSelector: finalEpochConfirmationGames > 0
        ? async ({ epoch, model, guard }) => {
          const epochModelHash = checkpointHash(serializeNeuralModel(model));
          const stage = `epoch-final-confirmation-${String(epoch).padStart(3, "0")}`;
          const confirmationDescriptor = createEvaluationDescriptor({
            runContract,
            auditRole: "top-two-screening",
            trainingIteration,
            stage,
            candidateHash: epochModelHash,
            opponentHashes: [checkpointHash(learnerCheckpointAtGenerationStart)],
            engineFingerprint,
            games: finalEpochConfirmationGames,
            seed: finalEpochConfirmationSeed,
            maxActions: epochEvaluationMaxActions,
            evaluationMode: epochEvaluationMode,
            trainingDeckIds,
            greedy: evaluationGreedy,
            temperature: evaluationTemperature
          });
          const resumed = loadEvaluationGames(dataRoot, confirmationDescriptor);
          progress.write({
            state: "training",
            stage: "epoch-final-confirmation",
            epoch,
            game: 0,
            games: finalEpochConfirmationGames,
            resumedGames: resumed.size
          });
          const evaluation = evaluateNeuralModels(model, learnerAtGenerationStart, trainingDecks, {
            games: finalEpochConfirmationGames,
            maxActions: epochEvaluationMaxActions,
            seed: finalEpochConfirmationSeed,
            engineFingerprint,
            evaluationMode: epochEvaluationMode,
            greedy: evaluationGreedy,
            temperature: evaluationTemperature,
            opponentRole: "parent-learner",
            resumedSummaries: mapToArray(resumed, finalEpochConfirmationGames),
            onGameComplete: (item) => {
              saveEvaluationGame(dataRoot, confirmationDescriptor, item.game - 1, item.summary);
              progress.write({
                state: "training",
                stage: "epoch-final-confirmation",
                epoch,
                ...item
              });
            }
          });
          const practical = summarizePracticalEvaluation(evaluation, {
            requiredDeckIds: trainingDeckIds,
            minimumDeckGames: Math.max(1,
              Math.floor(finalEpochConfirmationGames / trainingDeckIds.length))
          });
          practical.seedManifest = {
            version: 1,
            role: "final-confirmation",
            seed: finalEpochConfirmationSeed,
            games: finalEpochConfirmationGames,
            disjointFromDevelopmentAndRotating: true
          };
          const selection = robustEpochSelection({
            passed: guard?.passed !== false,
            baselineScore: retentionCompositeScore(retentionBaseline),
            score: Number(guard?.retentionScore)
          }, practical, {
            baselineRetentionScore: retentionCompositeScore(retentionBaseline),
            maximumRetentionDrop: epochMaximumRetentionDrop,
            minimumPracticalScore: epochMinimumPracticalScore,
            minimumPracticalWinRate: epochMinimumPracticalWinRate
          });
          return {
            selectionEligible: selection.selectionEligible,
            score: selection.score,
            tieBreakerScore: selection.tieBreakerScore,
            reasons: selection.reasons,
            practical
          };
        }
        : null,
      finalEpochAuditor: finalEpochAuditGames > 0
        ? async ({ epoch, model, guard, confirmation }) => {
          const epochModelCheckpoint = serializeNeuralModel(model);
          const epochModelHash = checkpointHash(epochModelCheckpoint);
          const protectedSeedManifestPath = path.join(
            epochCheckpointDirectory,
            "final-audit-seed.json"
          );
          const protectedSeedManifest = await claimProtectedEvaluationSeed(
            protectedSeedManifestPath,
            {
              version: 1,
              trainingKey,
              candidateHash: epochModelHash,
              opponentHash: checkpointHash(learnerCheckpointAtGenerationStart),
              seed: finalEpochAuditSeed,
              games: finalEpochAuditGames,
              evaluationMode: epochEvaluationMode,
              purpose: "one-time-final-epoch-audit"
            }
          );
          const stage = `epoch-protected-final-audit-${epochModelHash.slice(0, 12)}`;
          const auditDescriptor = createEvaluationDescriptor({
            runContract,
            auditRole: "protected-final-audit",
            trainingIteration,
            stage,
            candidateHash: epochModelHash,
            opponentHashes: [checkpointHash(learnerCheckpointAtGenerationStart)],
            engineFingerprint,
            games: finalEpochAuditGames,
            seed: finalEpochAuditSeed,
            maxActions: epochEvaluationMaxActions,
            evaluationMode: epochEvaluationMode,
            trainingDeckIds,
            greedy: evaluationGreedy,
            temperature: evaluationTemperature
          });
          const resumed = loadEvaluationGames(dataRoot, auditDescriptor);
          progress.write({
            state: "training",
            stage: "epoch-protected-final-audit",
            epoch,
            game: 0,
            games: finalEpochAuditGames,
            resumedGames: resumed.size
          });
          const evaluation = evaluateNeuralModels(model, learnerAtGenerationStart, trainingDecks, {
            games: finalEpochAuditGames,
            maxActions: epochEvaluationMaxActions,
            seed: finalEpochAuditSeed,
            engineFingerprint,
            evaluationMode: epochEvaluationMode,
            greedy: evaluationGreedy,
            temperature: evaluationTemperature,
            opponentRole: "parent-learner",
            resumedSummaries: mapToArray(resumed, finalEpochAuditGames),
            onGameComplete: (item) => {
              saveEvaluationGame(dataRoot, auditDescriptor, item.game - 1, item.summary);
              progress.write({
                state: "training",
                stage: "epoch-protected-final-audit",
                epoch,
                ...item
              });
            }
          });
          const practical = summarizePracticalEvaluation(evaluation, {
            requiredDeckIds: trainingDeckIds,
            minimumDeckGames: Math.max(8,
              Math.floor(
                (finalEpochAuditGames / 8) / trainingDeckIds.length
              ) * 8)
          });
          practical.seedManifest = {
            version: 2,
            role: "protected-final-audit",
            seed: finalEpochAuditSeed,
            games: finalEpochAuditGames,
            candidateHash: epochModelHash,
            protectedSeedClaim: protectedSeedManifest,
            disjointFromDevelopmentScreeningAndTopTwoConfirmation: true
          };
          const selection = robustEpochSelection({
            passed: guard?.passed !== false,
            baselineScore: retentionCompositeScore(retentionBaseline),
            score: Number(guard?.retentionScore)
          }, practical, {
            baselineRetentionScore: retentionCompositeScore(retentionBaseline),
            maximumRetentionDrop: epochMaximumRetentionDrop,
            minimumPracticalScore: epochMinimumPracticalScore,
            minimumPracticalWinRate: epochMinimumPracticalWinRate,
            requireBootstrapEvidence: true,
            minimumBootstrapSupport: Number(args["final-audit-minimum-bootstrap-support"]) || 0.75,
            minimumDeckCvar: Number(args["final-audit-minimum-deck-cvar"]) || 0.35
          });
          return {
            selectionEligible: selection.selectionEligible,
            score: selection.score,
            tieBreakerScore: selection.tieBreakerScore,
            reasons: selection.reasons,
            practical,
            preliminaryConfirmation: {
              epoch: confirmation?.epoch ?? epoch,
              score: confirmation?.score ?? null
            }
          };
        }
        : null,
      onBatch: (item) => progress.write({ state: "training", stage: "ppo", trajectories: trainingTrajectories.length, ...item, metrics: numericMetrics(item.metrics) }),
      onEpoch: (item) => progress.write({ state: "training", stage: "ppo-epoch", trajectories: trainingTrajectories.length, ...item, metrics: numericMetrics(item.metrics) }),
      onEpochCheckpoint: async (item) => {
        const candidateCheckpoint = serializeNeuralModel(candidate);
        await writeCheckpoint(path.join(epochCheckpointDirectory, `epoch-${String(item.epoch).padStart(3, "0")}.json`), {
          version: 1,
          trainingKey,
          collectionKey: descriptor.collectionKey,
          epoch: item.epoch,
          accepted: item.accepted,
          selectedAtEpoch: item.selected,
          guard: item.guard,
          metrics: numericMetrics(item.metrics),
          candidateCheckpoint,
          optimizerState: item.optimizerState,
          randomState: item.randomState,
          selectionState: item.selectionState,
          evaluationSeedManifest: item.guard?.practical?.seedManifest || null,
          modelHash: checkpointHash(candidateCheckpoint),
          createdAt: new Date().toISOString()
        });
      },
      onFinalSelectionCheckpoint: async (item) => {
        const candidateCheckpoint = serializeNeuralModel(candidate);
        await writeCheckpoint(path.join(epochCheckpointDirectory, "final-selection.json"), {
          version: 2,
          trainingKey,
          collectionKey: descriptor.collectionKey,
          epoch: ppoEpochs,
          accepted: true,
          selectionStage: item.stage,
          selectedCandidateEpoch: item.epoch,
          finalEpochAudit: item.finalEpochAudit || null,
          candidateCheckpoint,
          optimizerState: item.optimizerState,
          randomState: item.randomState,
          selectionState: item.selectionState,
          modelHash: checkpointHash(candidateCheckpoint),
          createdAt: new Date().toISOString()
        });
      }
    });
    optimizer = trained.optimizer;
    if (safeHumanTrajectories.length && candidate.metadata.selectedEpoch !== 0) {
      const humanTraining = trainBehaviorCloning(candidate, safeHumanTrajectories, {
        epochs: humanEpochs,
        batchSize: humanBatchSize,
        optimizer,
        random: trainingRandom,
        auxiliary: true,
        valueCoefficient: 0.1,
        beliefCoefficient: 0.05,
        onEpoch: (item) => progress.write({ state: "training", stage: "human-behavior-cloning", trajectories: safeHumanTrajectories.length, ...item, metrics: numericMetrics(item.metrics) })
      });
      optimizer = humanTraining.optimizer;
      humanTrainingSteps = humanTraining.history.reduce((sum, item) => sum + item.steps, 0);
    }
    if (calibrationTrajectories.length) {
      candidate.calibration = calibrationSplit.test.length
        ? evaluateValueCalibration(candidate, calibrationSplit.fit, calibrationSplit.test, {
          batchSize: calibrationBatchSize
        })
        : evaluateBehaviorCloning(candidate, calibrationTrajectories, {
          batchSize: calibrationBatchSize
        }).calibration;
      trained.calibration = candidate.calibration;
    }
    candidate.metadata.engineFingerprint = engineFingerprint;
    candidate.metadata.engineValidationStatus = "current-engine-candidate";
    candidate.metadata.trainingDeckIds = trainingDeckIds;
    candidate.metadata.deckEvolution = evolveDecks;
    candidate.metadata.decisionSafetyVersion = trainingPreflight.version;
    candidate.metadata.trainingIteration = trainingIteration;
    candidate.metadata.runContract = runContract;
    candidate.metadata.experimentId = experimentId;
    candidate.metadata.artifactRole = diagnosticArtifactRole(runContract);
    candidate.metadata.teacherConsumptionPolicy = teacherConsumptionPolicy;
    candidate.metadata.championGenerationAtTraining = champion.generation;
    candidate.metadata.calibrationHoldoutTrajectories = calibrationTrajectories.length;
    candidate.metadata.calibrationProtocol = {
      version: 3,
      splitUnit: "game",
      ...calibrationSplit.manifest,
      independentFromRetention: true,
      independentFromEvaluatorAudit: true,
      evaluatorPromotionMinimumGames: 100,
      evaluatorPromotionEligible: candidate.calibration?.teacherPromotionEligible === true
    };
    candidate.metadata.turningPointReplayTrajectories = replayTrajectories.length;
    candidate.metadata.turningPointReplayPolicyUse = "auxiliary-supervision-only";
    candidate.metadata.teacherSupervision = {
      policyCoefficient: teacherCoefficient,
      rankingCoefficient: teacherRankingCoefficient,
      actionValueCoefficient: teacherActionValueCoefficient,
      correctionFraction: teacherCorrectionFraction,
      evaluatorMode: teacherEvaluatorMode,
      oldEngineNeuralEvaluatorExcluded: generationUsesCrossEngineWarmStart,
      evaluatorCertificateVersion: EVALUATOR_CERTIFICATE_VERSION,
      certifiedEvaluatorCount: certifiedCollectionEvaluators.length,
      certifiedEvaluatorHashes: certifiedCollectionEvaluators.map((item) => item.modelHash),
      frozenRegistryEvaluatorCount: frozenEvaluatorRegistry.accepted.length,
      frozenRegistryRejected: frozenEvaluatorRegistry.rejected.map((item) => ({
        modelHash: item.entry?.modelHash || null,
        reasons: item.reasons || []
      })),
      rejectedEvaluatorReasons: collectionEvaluatorCertification
        .filter((item) => !item.eligible)
        .map((item) => ({
          generation: item.generation,
          modelHash: item.modelHash,
          reasons: item.reasons
        }))
    };
    candidate.metadata.anchorLineage = {
      parentLearner: summarizeAiModelReference(learnerAtGenerationStart),
      champion: summarizeAiModelReference(champion),
      learnerWeight: learnerAnchorWeight,
      championWeight: championAnchorWeight,
      warmStartSchedule: generationUsesCrossEngineWarmStart
        ? {
          initialCoefficient: warmStartAnchorCoefficient,
          initialEpochs: warmStartAnchorEpochs,
          laterCoefficient: anchorCoefficient
        }
        : null
    };
    candidate.metadata.valueHorizon = { gamma, gaeLambda, longHorizonLambda, longHorizonWeight };
    candidate.metadata.trainingStrata = summarizeTrainingStrata(trainingTrajectories);
    candidate.metadata.independentTrainingPartitions = trajectoryPartitions.manifest;
    candidate.metadata.trajectoryCoverage = trajectoryPartitions.manifest;
    candidate.metadata.trajectoryBalancing = balancedTraining.report;
    candidate.metadata.retentionBaseline = retentionBaseline;
    candidate.metadata.retentionHistory = retentionHistory;
    candidate.metadata.practicalEpochBaseline = practicalBaseline;
    candidate.metadata.practicalEpochHistory = practicalHistory;
    candidate.metadata.epochSelectionProtocol = {
      version: 6,
      order: [
        "hard-safety-gates",
        "observed-paired-screen",
        "top-two-disjoint-confirmation",
        ...(officialPromotionRun
          ? ["single-candidate-protected-104-game-bootstrap-cvar-audit"]
          : []),
        "retention-tie-breaker"
      ],
      evaluationMode: epochEvaluationMode,
      requiredDeckCoverage: trainingDeckIds,
      minimumEpochsBeforeEarlyStopping,
      commonDevelopmentGames,
      rotatingValidationGames,
      finalEpochConfirmationGames,
      finalEpochAuditGames,
      finalConfirmationReuse: false,
      finalAuditSeedProtected: officialPromotionRun,
      resumeSchemaVersion: 2
    };
    candidate.metadata.evaluatorAuditDataset = {
      development: evaluatorDevelopmentDataset.manifest,
      confirmation: evaluatorConfirmationDataset.manifest,
      finalAudit: evaluatorFinalAuditDataset.manifest
    };
    candidate.metadata.evaluatorBootstrap = evaluatorBootstrap ? {
      version: 2,
      datasetKey: evaluatorBootstrap.datasetKey,
      audit: evaluatorBootstrap.audit,
      excludedFrom: [
        "ppo",
        "epoch-selection-retention",
        "calibration-fit"
      ],
      usedFor: [
        "evaluator-certification-audit",
        "independent-calibration-test"
      ]
    } : null;
    candidate.metadata.evaluationSeedManifest = {
      epochCommonDevelopment: practicalEvaluationSeed >>> 0,
      epochRotatingFormula: "(epochCommonDevelopment + epoch * 104729) >>> 0",
      epochFinalConfirmation: finalEpochConfirmationSeed,
      epochProtectedFinalAudit: officialPromotionRun ? finalEpochAuditSeed : null,
      finalCandidateVsChampion: (generationSeed + 77) >>> 0,
      finalCandidateVsHeuristic: (generationSeed + 127) >>> 0,
      finalLeague: (generationSeed + 177) >>> 0,
      finalCandidateVsParentIntrinsic: (generationSeed + 227) >>> 0,
      targetedDeckConfirmationFormula: "(finalCandidateVsParentIntrinsic + 1000003 + deckIndex * 65537) >>> 0"
    };
    candidate.metadata.resourceReservationTraining = summarizeResourceReservations(collected.summaries);
    candidate.metadata.handOpportunityTraining = handOpportunityTraining;
    await writeCheckpoint(pendingTrainingPath, {
      version: 1,
      trainingKey,
      collectionKey: descriptor.collectionKey,
      candidateCheckpoint: serializeNeuralModel(candidate),
      optimizerState: await serializeOptimizer(optimizer, candidate.generation),
      calibration: trained.calibration,
      humanTrainingSteps,
      createdAt: new Date().toISOString()
    });
  }
  const evaluatorEpochCheckpoints = await loadAcceptedEvaluatorEpochCheckpoints(
    epochCheckpointDirectory,
    trainingKey
  );
  const policySelectedEpoch = Number(candidate.metadata?.selectedEpoch) || 0;
  const evaluatorTrainingReplicas = Math.max(
    1,
    Math.min(
      5,
      Math.floor(Number(args["evaluator-training-replicas"]) || 3)
    )
  );
  const evaluatorBaseEpochInputs = evaluatorDevelopmentGate?.passed === true
    ? [{
      epoch: evaluatorDevelopmentGate.selected.epoch ?? 0,
      candidateCheckpoint: evaluatorDevelopmentGate.selected.checkpoint,
      source: "staged-development-gate",
      replica: evaluatorDevelopmentGate.selected.replica,
      orderSeed: evaluatorDevelopmentGate.selected.orderSeed,
      evaluatorTraining:
        evaluatorDevelopmentGate.selected.evaluatorTraining || null,
      calibration: evaluatorDevelopmentGate.selected.calibration || null,
      preTrained: true
    }]
    : [
      {
        epoch: policySelectedEpoch,
        candidateCheckpoint: serializeNeuralModel(candidate),
        source: "policy-selected"
      },
      ...evaluatorEpochCheckpoints.map((item) => ({
        ...item,
        source: "accepted-epoch"
      }))
    ];
  const evaluatorEpochInputs = evaluatorDevelopmentGate?.passed === true
    ? evaluatorBaseEpochInputs
    : evaluatorBaseEpochInputs.flatMap((input) =>
      Array.from({ length: evaluatorTrainingReplicas }, (_, replica) => ({
        ...input,
        replica,
        orderSeed: deterministicValueDigest({
          trainingKey,
          epoch: input.epoch,
          source: input.source,
          replica
        })
      }))
    );
  const evaluatorEpochAudits = [];
  const seenEvaluatorArtifacts = new Set();
  const evaluatorTrainingEpochs = Math.max(
    1,
    Math.floor(Number(args["evaluator-training-epochs"]) || 8)
  );
  const evaluatorTrainingBatchSize = Math.max(
    4,
    Math.floor(Number(args["evaluator-training-batch-size"]) || 32)
  );
  const evaluatorTrainingLearningRate = Math.max(
    1e-6,
    Number(args["evaluator-training-learning-rate"]) || 0.0001
  );
  const evaluatorTrainingEnabled = officialPromotionRun
    && evaluatorBootstrap?.audit?.complete === true
    && evaluatorTrainingEvidenceStatus.passed === true
    && Number(evaluatorTrainingDataset?.manifest?.games) > 0;
  const evaluatorHoldoutGames = Number(
    evaluatorCertificationCalibrationDataset.manifest.games
  ) || 0;
  const evaluatorDevelopmentEnabled = officialPromotionRun
    && evaluatorBootstrap?.audit?.complete === true;
  for (const evaluatorInput of evaluatorDevelopmentEnabled
    ? evaluatorEpochInputs
    : []) {
    const inputHash = checkpointHash(evaluatorInput.candidateCheckpoint);
    const replicaInputKey = `${inputHash}:${evaluatorInput.replica}`;
    if (seenEvaluatorArtifacts.has(replicaInputKey)) continue;
    seenEvaluatorArtifacts.add(replicaInputKey);
    let evaluatorModel = deserializeNeuralModel(
      evaluatorInput.candidateCheckpoint
    );
    evaluatorModel.metadata = {
      ...evaluatorModel.metadata,
      engineFingerprint,
      engineValidationStatus: "current-engine-validated",
      validationScope: "evaluator-only-audit",
      runContract,
      artifactRole: "frozen-evaluator-candidate",
      evaluatorSourceEpoch: evaluatorInput.epoch,
      evaluatorTrainingReplica: evaluatorInput.replica,
      evaluatorTrainingOrderSeed: evaluatorInput.orderSeed
    };
    let evaluatorTraining = evaluatorInput.evaluatorTraining || null;
    if (evaluatorTrainingEnabled && evaluatorInput.preTrained !== true) {
      const evaluatorTrainingCacheKey = checkpointHash({
        version: 3,
        inputHash,
        replica: evaluatorInput.replica,
        orderSeed: evaluatorInput.orderSeed,
        datasetFingerprint:
          evaluatorTrainingDataset.manifest.datasetFingerprint,
        epochs: evaluatorTrainingEpochs,
        batchSize: evaluatorTrainingBatchSize,
        learningRate: evaluatorTrainingLearningRate,
        contract: "independent-evaluator-train-ranking-value-multistart-v3"
      });
      const evaluatorTrainingCachePath = path.join(
        dataRoot,
        "resume",
        `iteration-${String(trainingIteration).padStart(5, "0")}`,
        "evaluator-training",
        `${evaluatorTrainingCacheKey}.json`
      );
      const cachedEvaluatorTraining = await readCheckpoint(
        evaluatorTrainingCachePath
      );
      if (cachedEvaluatorTraining?.version === 3
        && cachedEvaluatorTraining.cacheKey === evaluatorTrainingCacheKey
        && cachedEvaluatorTraining.modelCheckpoint) {
        evaluatorModel = deserializeNeuralModel(
          cachedEvaluatorTraining.modelCheckpoint
        );
        evaluatorTraining = cachedEvaluatorTraining.training;
      } else {
        progress.write({
          state: "training",
          stage: "evaluator-training",
          evaluatorSourceEpoch: evaluatorInput.epoch,
          evaluatorTrainingReplica: evaluatorInput.replica,
          epoch: 0,
          epochs: evaluatorTrainingEpochs,
          games: evaluatorTrainingDataset.manifest.games
        });
        evaluatorModel.calibration = {
          ...evaluatorModel.calibration,
          temperature: 1,
          bias: 0
        };
        evaluatorTraining = await trainEvaluatorFromAuditEvidence(
          evaluatorModel,
          async function* evaluatorTrainingBatchFactory() {
            for await (const trajectories of iterateIndependentTrajectoryDataset(
              evaluatorTrainingDataset,
              { orderSeed: evaluatorInput.orderSeed }
            )) {
              assertTrainingTrajectories(trajectories, engineFingerprint);
              yield trajectories;
            }
          },
          {
            epochs: evaluatorTrainingEpochs,
            batchSize: evaluatorTrainingBatchSize,
            learningRate: evaluatorTrainingLearningRate,
            engineFingerprint,
            onEpoch: (item) => progress.write({
              state: "training",
              stage: "evaluator-training",
              evaluatorSourceEpoch: evaluatorInput.epoch,
              evaluatorTrainingReplica: evaluatorInput.replica,
              epochs: evaluatorTrainingEpochs,
              ...item
            })
          }
        );
        await writeCheckpoint(evaluatorTrainingCachePath, {
          version: 3,
          cacheKey: evaluatorTrainingCacheKey,
          inputHash,
          replica: evaluatorInput.replica,
          orderSeed: evaluatorInput.orderSeed,
          dataset: evaluatorTrainingDataset.manifest,
          training: evaluatorTraining,
          modelCheckpoint: serializeNeuralModel(evaluatorModel),
          trainedAt: new Date().toISOString()
        });
      }
      const actualActionTrainingSamples = Number(
        evaluatorTraining?.sourceSamples?.["terminal-action-ranking"]
      ) || 0;
      const actualLeafTrainingSamples = Number(
        evaluatorTraining?.sourceSamples?.["terminal-leaf-ranking"]
      ) || 0;
      const minimumActionTrainingSamples = Math.min(
        EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS
          .training.minimumActionReferences,
        evaluatorTrainingEvidenceStatus.actionReferences
      );
      const minimumLeafTrainingSamples = Math.min(
        EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS
          .training.minimumLeafValuePairs,
        evaluatorTrainingEvidenceStatus.leafValuePairs
      );
      if (actualActionTrainingSamples < minimumActionTrainingSamples
        || actualLeafTrainingSamples < minimumLeafTrainingSamples) {
        const insufficient = {
          status: "evaluator-training-evidence-insufficient",
          expected: {
            actionSamples: minimumActionTrainingSamples,
            leafSamples: minimumLeafTrainingSamples
          },
          actual: {
            actionSamples: actualActionTrainingSamples,
            leafSamples: actualLeafTrainingSamples
          },
          dataset: evaluatorTrainingDataset.manifest
        };
        progress.write({
          state: "error",
          stage: "evaluator-training-evidence-insufficient",
          evaluatorTrainingEvidenceStatus: insufficient
        });
        await unlink(evaluatorTrainingCachePath).catch(() => {});
        throw new Error(
          `evaluator-training-evidence-insufficient: ${JSON.stringify(insufficient)}`
        );
      }
      evaluatorModel.metadata = {
        ...evaluatorModel.metadata,
        artifactRole: "frozen-evaluator-candidate",
        policyPromotionEligible: false,
        evaluatorTrainingDataset: evaluatorTrainingDataset.manifest,
        evaluatorEvidenceTraining: evaluatorTraining
      };
    }
    // Epoch selection may only observe the development calibration split.
    // The representative certification calibration test remains unopened
    // until one evaluator epoch has been selected.
    const calibration = evaluatorInput.preTrained === true
      ? evaluatorInput.calibration || evaluatorModel.calibration || {}
      : calibrationSplit.fit.length
      && calibrationSplit.test.length
      ? evaluateValueCalibration(
        evaluatorModel,
        calibrationSplit.fit,
        calibrationSplit.test,
        { batchSize: calibrationBatchSize }
      )
      : {
        testGames: 0,
        brier: null,
        expectedCalibrationError: null,
        rankingAuc: null
      };
    if (Number.isFinite(Number(calibration.temperature))
      && Number.isFinite(Number(calibration.bias))) {
      evaluatorModel.calibration = {
        ...evaluatorModel.calibration,
        ...calibration
      };
    }
    const rankingAudits = await evaluateIndependentRankingAudits(
      evaluatorModel,
      evaluatorDevelopmentDataset,
      {
        batchSize: calibrationBatchSize,
        engineFingerprint,
        requireStructuredV2: true,
        certificationRole: "development",
        datasetKey: evaluatorDevelopmentDataset?.manifest?.datasetKey
          || evaluatorBootstrap?.datasetKey
      }
    );
    const actionRanking = rankingAudits.actionRanking;
    const leafValueRanking = rankingAudits.leafValueRanking;
    const developmentStatus = evaluatorDevelopmentAuditStatus(
      actionRanking,
      leafValueRanking,
      {
        certificateKind: evaluatorCertificateKind,
        requirePerformance: true,
        minimumActionAccuracy: 0.6,
        minimumLeafAccuracy: 0.6,
        minimumPhaseAccuracy: 0.6,
        minimumPhaseAccuracyLowerBound: 0.45
      }
    );
    evaluatorEpochAudits.push({
      epoch: evaluatorInput.epoch,
      source: evaluatorInput.source,
      baseInputHash: inputHash,
      checkpoint: serializeNeuralModel(evaluatorModel),
      artifactHash: neuralArtifactHash(evaluatorModel),
      evaluatorLeafHash: neuralEvaluatorLeafHash(evaluatorModel),
      calibration,
      evaluatorTraining,
      replica: evaluatorInput.replica,
      orderSeed: evaluatorInput.orderSeed,
      actionRanking,
      leafValueRanking,
      certificate: null,
      status: developmentStatus,
      selectionScore:
        (developmentStatus.eligible ? 100 : 0)
        + (policyQBootstrap
          ? 0
          : Number(actionRanking.pairedImprovementLowerBound) || -1)
        + (Number(leafValueRanking.accuracyLowerBound) || 0)
        - (Number(calibration.brier) || 1)
    });
  }
  evaluatorEpochAudits.sort((left, right) =>
    Number(right.status.eligible) - Number(left.status.eligible)
      || right.selectionScore - left.selectionScore
      || Number(left.epoch) - Number(right.epoch));
  candidate.metadata.evaluatorAudit = {
    version: 4,
    protocol:
      "train-ranking-value_then-development-select-one_then-confirmation_then-single-final-audit-v2",
    trainingDataset: evaluatorTrainingDataset.manifest,
    trainingEvidenceStatus: evaluatorTrainingEvidenceStatus,
    developmentDataset: evaluatorDevelopmentDataset.manifest,
    confirmationDataset: evaluatorConfirmationDataset.manifest,
    finalAuditDataset: evaluatorFinalAuditDataset.manifest,
    calibrationDataset:
      evaluatorCertificationCalibrationDataset.manifest,
    policySelectedEpoch,
    evaluatorTrainingReplicas,
    replicaSelectionContract:
      "two-thirds-eligible_then-median-development-score-v1",
    evaluatorEpochCandidates: evaluatorEpochAudits.map((item) => ({
      epoch: item.epoch,
      source: item.source,
      replica: item.replica,
      orderSeed: item.orderSeed,
      eligible: item.status.eligible,
      reasons: item.status.reasons,
      selectionScore: item.selectionScore,
      evaluatorTraining: item.evaluatorTraining,
      artifactHash: item.artifactHash,
      evaluatorLeafHash: item.evaluatorLeafHash
    })),
    stableReplicaCandidates: (evaluatorDevelopmentGate?.passed === true
      ? [evaluatorDevelopmentGate.selected]
      : stableEvaluatorReplicaCandidates(
        evaluatorEpochAudits,
        evaluatorTrainingReplicas
      )).map((item) => ({
      epoch: item.epoch,
      source: item.source,
      replica: item.replica,
      artifactHash: item.artifactHash,
      selectionScore: item.selectionScore
    })),
    excludedFrom: ["ppo", "epoch-selection-retention", "calibration-fit"],
    usedFor: [
      "evaluator-ranking-value-training",
      "evaluator-development-selection",
      "single-candidate-confirmation",
      "single-candidate-final-audit"
    ]
  };
  const candidateDirectory = officialPromotionRun
    ? path.join(dataRoot, "candidates")
    : path.join(dataRoot, "diagnostics", "experiments", experimentId, `run-${runContract}`, "candidates");
  const candidatePath = path.join(candidateDirectory,
    `iteration-${String(trainingIteration).padStart(5, "0")}-generation-${String(candidate.generation).padStart(5, "0")}.json`);
  const candidateCheckpointBeforeEvaluation = serializeNeuralModel(candidate);
  await writeCheckpoint(candidatePath, candidateCheckpointBeforeEvaluation);
  const candidateHash = checkpointHash(candidateCheckpointBeforeEvaluation);
  const championHash = checkpointHash(championCheckpoint || serializeNeuralModel(champion));
  phase = "evaluating";
  await writeAiStatus({ state: "evaluating", generation, trainingIteration, evaluationGames, evaluationMaxActions, candidatePath, progressPath: progress.latestPath, eventLogPath: progress.eventLogPath });
  const evaluationDecks = trainingDecks;
  const championEvaluationSeed = generationSeed + 77;
  const championEvaluationDescriptor = createEvaluationDescriptor({ runContract, trainingIteration, stage: "candidate-vs-champion", candidateHash, opponentHashes: [championHash], engineFingerprint, games: evaluationGames, seed: championEvaluationSeed, maxActions: evaluationMaxActions, evaluationMode, trainingDeckIds, greedy: evaluationGreedy, temperature: evaluationTemperature });
  const resumedChampionEvaluation = loadEvaluationGames(dataRoot, championEvaluationDescriptor);
  progress.write({ state: "evaluating", stage: "candidate-vs-champion", game: 0, games: evaluationGames, completed: 0, candidateWins: 0, resumedGames: resumedChampionEvaluation.size });
  const evaluation = evaluateNeuralModels(candidate, champion, evaluationDecks, {
    games: evaluationGames,
    maxActions: evaluationMaxActions,
    seed: championEvaluationSeed,
    engineFingerprint,
    evaluationMode,
    greedy: evaluationGreedy,
    temperature: evaluationTemperature,
    resumedSummaries: mapToArray(resumedChampionEvaluation, evaluationGames),
    onGameComplete: (item) => {
      saveEvaluationGame(dataRoot, championEvaluationDescriptor, item.game - 1, item.summary);
      progress.write({ state: "evaluating", stage: "candidate-vs-champion", ...item });
    }
  });
  const heuristicEvaluationSeed = generationSeed + 127;
  const heuristicEvaluationDescriptor = createEvaluationDescriptor({ runContract, trainingIteration, stage: "candidate-vs-heuristic", candidateHash, opponentHashes: ["heuristic-v1"], engineFingerprint, games: benchmarkGames, seed: heuristicEvaluationSeed, maxActions: evaluationMaxActions, evaluationMode, trainingDeckIds, greedy: evaluationGreedy, temperature: evaluationTemperature });
  const resumedHeuristicEvaluation = loadEvaluationGames(dataRoot, heuristicEvaluationDescriptor);
  progress.write({ state: "evaluating", stage: "candidate-vs-heuristic", game: 0, games: benchmarkGames, completed: 0, candidateWins: 0, resumedGames: resumedHeuristicEvaluation.size });
  const absoluteEvaluation = evaluateNeuralAgainstHeuristic(candidate, evaluationDecks, {
    games: benchmarkGames,
    maxActions: evaluationMaxActions,
    seed: heuristicEvaluationSeed,
    engineFingerprint,
    evaluationMode,
    greedy: evaluationGreedy,
    temperature: evaluationTemperature,
    wilsonThreshold: Number(args["benchmark-wilson-threshold"]) || 0.4,
    maxSeatGap: Number(args["max-seat-gap"]) || 0.2,
    resumedSummaries: mapToArray(resumedHeuristicEvaluation, benchmarkGames),
    onGameComplete: (item) => {
      saveEvaluationGame(dataRoot, heuristicEvaluationDescriptor, item.game - 1, item.summary);
      progress.write({ state: "evaluating", stage: "candidate-vs-heuristic", ...item });
    }
  });
  const leagueGamesPerOpponent = configuredLeagueGamesPerOpponent;
  // Champion remains first so its already-computed evaluation can be reused.
  // The parent learner is nevertheless always an explicit league opponent;
  // this direct comparison decides whether the candidate may become the next
  // learner even when it is not yet strong enough for champion promotion.
  const leagueModels = diagnosticRun
    ? [champion]
    : uniqueNeuralModels([champion, learnerAtGenerationStart, ...league, ...challengers]);
  const parentLearnerOpponentIndex = leagueModels.findIndex((model) =>
    neuralModelIdentity(model) === neuralModelIdentity(learnerAtGenerationStart));
  const leagueOpponents = leagueModels.length;
  const leagueEvaluationSeed = generationSeed + 177;
  const leagueOpponentSeeds = leagueModels.map((_, index) => index === 0 ? championEvaluationSeed : (leagueEvaluationSeed + index * 7919) >>> 0);
  const leagueEvaluationDescriptor = createEvaluationDescriptor({ runContract, trainingIteration, stage: "candidate-vs-league", candidateHash, opponentHashes: leagueModels.map((model) => checkpointHash(serializeNeuralModel(model))), opponentSeeds: leagueOpponentSeeds, engineFingerprint, games: leagueOpponents * leagueGamesPerOpponent, gamesPerOpponent: leagueGamesPerOpponent, seed: leagueEvaluationSeed, maxActions: evaluationMaxActions, evaluationMode, trainingDeckIds, greedy: evaluationGreedy, temperature: evaluationTemperature });
  const resumedLeagueEvaluation = loadEvaluationGames(dataRoot, leagueEvaluationDescriptor);
  const resumedLeagueByOpponent = Array.from({ length: leagueOpponents }, (_, opponentIndex) => Array.from({ length: leagueGamesPerOpponent }, (_, gameIndex) => opponentIndex === 0
    ? evaluation.summaries[gameIndex]
    : resumedLeagueEvaluation.get(opponentIndex * leagueGamesPerOpponent + gameIndex)));
  progress.write({ state: "evaluating", stage: "candidate-vs-league", game: 0, games: leagueOpponents * leagueGamesPerOpponent, opponent: 0, opponents: leagueOpponents, resumedGames: resumedLeagueEvaluation.size });
  const leagueEvaluation = evaluateNeuralLeague(candidate, leagueModels, evaluationDecks, {
    gamesPerOpponent: leagueGamesPerOpponent,
    maxActions: evaluationMaxActions,
    seed: leagueEvaluationSeed,
    engineFingerprint,
    evaluationMode,
    greedy: evaluationGreedy,
    temperature: evaluationTemperature,
    opponentSeeds: leagueOpponentSeeds,
    resumedSummariesByOpponent: resumedLeagueByOpponent,
    onGameComplete: (item) => {
      saveEvaluationGame(dataRoot, leagueEvaluationDescriptor, item.game - 1, item.progress.summary);
      progress.write({ state: "evaluating", stage: "candidate-vs-league", ...item });
    }
  });
  // Deck safety is measured separately from the cross-deck ecosystem screen.
  // Same-deck mirrors isolate policy regression from matchup strength. Every
  // deck first receives eight paired games; only an observed boundary/collapse
  // receives fresh, disjoint confirmation games.
  const intrinsicEvaluationSeed = generationSeed + 227;
  const parentLearnerHash = checkpointHash(learnerCheckpointAtGenerationStart || serializeNeuralModel(learnerAtGenerationStart));
  const intrinsicEvaluationDescriptor = createEvaluationDescriptor({
    runContract,
    trainingIteration,
    stage: "candidate-vs-parent-intrinsic",
    candidateHash,
    opponentHashes: [parentLearnerHash],
    engineFingerprint,
    games: intrinsicEvaluationGames,
    seed: intrinsicEvaluationSeed,
    maxActions: evaluationMaxActions,
    evaluationMode: intrinsicEvaluationMode,
    trainingDeckIds,
    greedy: evaluationGreedy,
    temperature: evaluationTemperature
  });
  const resumedIntrinsicEvaluation = loadEvaluationGames(dataRoot, intrinsicEvaluationDescriptor);
  progress.write({
    state: "evaluating",
    stage: "candidate-vs-parent-intrinsic",
    game: 0,
    games: intrinsicEvaluationGames,
    completed: 0,
    candidateWins: 0,
    resumedGames: resumedIntrinsicEvaluation.size
  });
  const intrinsicEvaluation = evaluateNeuralModels(candidate, learnerAtGenerationStart, evaluationDecks, {
    games: intrinsicEvaluationGames,
    maxActions: evaluationMaxActions,
    seed: intrinsicEvaluationSeed,
    engineFingerprint,
    evaluationMode: intrinsicEvaluationMode,
    greedy: evaluationGreedy,
    temperature: evaluationTemperature,
    opponentRole: "parent-learner",
    resumedSummaries: mapToArray(resumedIntrinsicEvaluation, intrinsicEvaluationGames),
    onGameComplete: (item) => {
      saveEvaluationGame(dataRoot, intrinsicEvaluationDescriptor, item.game - 1, item.summary);
      progress.write({ state: "evaluating", stage: "candidate-vs-parent-intrinsic", ...item });
    }
  });
  const parentSeatBaselineDescriptor = createEvaluationDescriptor({
    runContract,
    trainingIteration,
    stage: "parent-vs-parent-intrinsic-baseline",
    candidateHash: parentLearnerHash,
    opponentHashes: [parentLearnerHash],
    engineFingerprint,
    games: intrinsicEvaluationGames,
    seed: intrinsicEvaluationSeed,
    maxActions: evaluationMaxActions,
    evaluationMode: intrinsicEvaluationMode,
    trainingDeckIds,
    greedy: evaluationGreedy,
    temperature: evaluationTemperature
  });
  const resumedParentSeatBaseline = loadEvaluationGames(
    dataRoot,
    parentSeatBaselineDescriptor
  );
  const parentSeatBaselineEvaluation = candidateHash === parentLearnerHash
    ? intrinsicEvaluation
    : evaluateNeuralModels(
      learnerAtGenerationStart,
      learnerAtGenerationStart,
      evaluationDecks,
      {
        games: intrinsicEvaluationGames,
        maxActions: evaluationMaxActions,
        seed: intrinsicEvaluationSeed,
        engineFingerprint,
        evaluationMode: intrinsicEvaluationMode,
        greedy: evaluationGreedy,
        temperature: evaluationTemperature,
        opponentRole: "parent-learner-baseline",
        resumedSummaries: mapToArray(
          resumedParentSeatBaseline,
          intrinsicEvaluationGames
        ),
        onGameComplete: (item) => {
          saveEvaluationGame(
            dataRoot,
            parentSeatBaselineDescriptor,
            item.game - 1,
            item.summary
          );
          progress.write({
            state: "evaluating",
            stage: "parent-vs-parent-intrinsic-baseline",
            ...item
          });
        }
      }
    );
  const initialIntrinsicDeckSafety = evaluateDeckSafety(intrinsicEvaluation, trainingDeckIds, {
    minimumDeckWinRate: learnerMinimumDeckWinRate,
    minimumDeckScoreMargin: learnerMinimumDeckScoreMargin,
    minimumDeckGames: intrinsicMinimumDeckGames,
    confirmationDeckGames: intrinsicConfirmationDeckGames
  });
  const targetedIntrinsicEvaluations = [];
  const targetedIntrinsicEvaluationDescriptors = [];
  for (const deckResult of initialIntrinsicDeckSafety.decks.filter((item) => item.status === "needs-confirmation")) {
    const deckIndex = trainingDeckIds.indexOf(deckResult.deckId);
    const deck = evaluationDecks.find((item) => item.id === deckResult.deckId);
    if (!deck) continue;
    const remainingGames = Math.max(8, Math.ceil(
      Math.max(0, intrinsicConfirmationDeckGames - deckResult.completed) / 8
    ) * 8);
    const confirmationSeed = (intrinsicEvaluationSeed + 1000003 + Math.max(0, deckIndex) * 65537) >>> 0;
    const stage = `candidate-vs-parent-intrinsic-confirm-${deckResult.deckId.replace(/[^a-z0-9-]/gi, "_")}`;
    const descriptor = createEvaluationDescriptor({
      runContract,
      trainingIteration,
      stage,
      candidateHash,
      opponentHashes: [parentLearnerHash],
      engineFingerprint,
      games: remainingGames,
      seed: confirmationSeed,
      maxActions: evaluationMaxActions,
      evaluationMode: intrinsicEvaluationMode,
      trainingDeckIds: [deck.id],
      greedy: evaluationGreedy,
      temperature: evaluationTemperature
    });
    const resumed = loadEvaluationGames(dataRoot, descriptor);
    targetedIntrinsicEvaluationDescriptors.push(descriptor);
    progress.write({
      state: "evaluating",
      stage,
      deckId: deck.id,
      game: 0,
      games: remainingGames,
      completed: 0,
      candidateWins: 0,
      resumedGames: resumed.size
    });
    const confirmation = evaluateNeuralModels(candidate, learnerAtGenerationStart, [deck], {
      games: remainingGames,
      maxActions: evaluationMaxActions,
      seed: confirmationSeed,
      engineFingerprint,
      evaluationMode: intrinsicEvaluationMode,
      greedy: evaluationGreedy,
      temperature: evaluationTemperature,
      opponentRole: "parent-learner",
      resumedSummaries: mapToArray(resumed, remainingGames),
      onGameComplete: (item) => {
        saveEvaluationGame(dataRoot, descriptor, item.game - 1, item.summary);
        progress.write({ state: "evaluating", stage, deckId: deck.id, ...item });
      }
    });
    targetedIntrinsicEvaluations.push(confirmation);
  }
  const confirmedIntrinsicEvaluation = targetedIntrinsicEvaluations.length
    ? mergeNeuralEvaluations([intrinsicEvaluation, ...targetedIntrinsicEvaluations], evaluationDecks)
    : intrinsicEvaluation;
  const intrinsicDeckSafety = evaluateDeckSafety(confirmedIntrinsicEvaluation, trainingDeckIds, {
    minimumDeckWinRate: learnerMinimumDeckWinRate,
    minimumDeckScoreMargin: learnerMinimumDeckScoreMargin,
    minimumDeckGames: intrinsicMinimumDeckGames,
    confirmationDeckGames: intrinsicConfirmationDeckGames
  });
  const candidateDeckGate = evaluateDeckCoverage(evaluation, trainingDeckIds, minimumDeckWinRate, minimumDeckScoreMargin);
  const absoluteDeckGate = evaluateDeckCoverage(absoluteEvaluation, trainingDeckIds, minimumDeckWinRate, minimumDeckScoreMargin);
  const candidateGate = evaluation.completed >= Math.ceil(evaluation.games * evaluationCompletionRate)
    && evaluation.invalidGames === 0
    && evaluation.wilsonLowerBound > (Number(args["candidate-wilson-threshold"]) || 0.5)
    && intrinsicDeckSafety.passed;
  const leagueGate = leagueEvaluation.results.every((result) => result.completed >= Math.ceil(result.games * evaluationCompletionRate))
    && leagueEvaluation.invalidGames === 0
    && leagueEvaluation.worstOpponentWilsonLowerBound >= (Number(args["league-wilson-threshold"]) || 0.45);
  const absoluteGate = absoluteEvaluation.completed >= Math.ceil(absoluteEvaluation.games * evaluationCompletionRate)
    && absoluteEvaluation.invalidGames === 0
    && absoluteEvaluation.wilsonLowerBound >= (Number(args["benchmark-wilson-threshold"]) || 0.4);
  const parentLearnerEvaluation = intrinsicEvaluation;
  const learnerAdvanceGate = evaluateLearnerAdvance(parentLearnerEvaluation, trainingDeckIds, {
    minimumCompletionRate: evaluationCompletionRate,
    minimumWinRate: Number(args["learner-minimum-win-rate"]) || 0.525,
    minimumWilsonLowerBound: Number(args["learner-wilson-threshold"]) || 0.35,
    baselineEvaluation: parentSeatBaselineEvaluation,
    maximumSeatGapIncrease:
      Number(args["learner-max-seat-gap-increase"]) || 0.1,
    maximumConditionGapIncrease:
      Number(args["learner-max-condition-gap-increase"]) || 0.1,
    maximumSeatWinRateDrop:
      Number(args["learner-max-seat-win-rate-drop"]) || 0.1,
    maximumConditionWinRateDrop:
      Number(args["learner-max-condition-win-rate-drop"]) || 0.15,
    minimumDeckWinRate: learnerMinimumDeckWinRate,
    minimumDeckScoreMargin: learnerMinimumDeckScoreMargin,
    minimumDeckGames: intrinsicMinimumDeckGames,
    confirmationDeckGames: intrinsicConfirmationDeckGames,
    deckSafety: intrinsicDeckSafety
  });
  const promotionConditionSafety = {
    version: 1,
    passed: !learnerAdvanceGate.failures.some((failure) => [
      "seat-win-rate-regression",
      "condition-win-rate-regression",
      "seat-gap-regression",
      "condition-gap-regression"
    ].includes(failure.reason)),
    failures: learnerAdvanceGate.failures.filter((failure) => [
      "seat-win-rate-regression",
      "condition-win-rate-regression",
      "seat-gap-regression",
      "condition-gap-regression"
    ].includes(failure.reason))
  };
  candidate.metadata.payoffMatrix = updateLeaguePayoffMatrix(
    learner.metadata?.payoffMatrix,
    leagueModels,
    leagueEvaluation
  );
  candidate.metadata.leagueSampling = collectionLeagueSampling || {
    version: 1,
    mode: "uniform",
    opponents: collectionLeague.map((model) => ({
      identity: neuralModelIdentity(model),
      generation: model.generation ?? null
    }))
  };
  const promoted = officialPromotionRun
    && (args["force-promote"] === "true" || (
      candidateGate
      && leagueGate
      && absoluteGate
      && promotionConditionSafety.passed
    ));
  const learnerAdvanced = officialPromotionRun && (promoted || learnerAdvanceGate.passed);
  const continuationStrengthCertificate = createContinuationStrengthCertificate(
    candidate,
    confirmedIntrinsicEvaluation,
    {
      engineFingerprint,
      independentHoldout: officialPromotionRun,
      evaluationMode: intrinsicEvaluationMode,
      leagueEvaluation,
      seedManifestDigest: deterministicValueDigest({
        intrinsic: intrinsicEvaluationDescriptor,
        intrinsicConfirmations: targetedIntrinsicEvaluationDescriptors,
        league: leagueEvaluationDescriptor
      })
    }
  );
  // Strength comes from the paired candidate-vs-parent same-deck holdout. The
  // league and absolute gates separately prevent a narrow or weak policy from
  // entering the continuation pool.
  continuationStrengthCertificate.eligible = Boolean(
    continuationStrengthCertificate.eligible
      && intrinsicDeckSafety.passed
      && leagueGate
      && absoluteGate
      && promotionConditionSafety.passed
  );
  continuationStrengthCertificate.strength =
    continuationStrengthCertificate.eligible
      ? continuationStrengthCertificate.strength
      : 0;
  candidate.metadata.actionEvidenceStrengthCertificate =
    continuationStrengthCertificate;
  const previouslyCertifiedStrongContinuations = uniqueNeuralModels(
    [champion, learnerAtGenerationStart, ...leagueModels, ...challengers]
  ).filter((model) =>
    certifiedContinuationStrength(model, engineFingerprint) > 0
  );
  candidate.metadata.actionEvidenceDiversityCertificates =
    continuationStrengthCertificate.eligible
      && validFixedContinuationBehaviorProbe(continuationBehaviorProbe, {
        engineFingerprint
      })
      ? createContinuationDiversityCertificates(
        [candidate, ...previouslyCertifiedStrongContinuations],
        continuationBehaviorProbe,
        { engineFingerprint }
      ).filter((certificate) =>
        certificate.artifactHashes.includes(neuralArtifactHash(candidate))
      )
      : [];
  candidate.metadata.actionEvidenceBehaviorallyIndependent =
    candidate.metadata.actionEvidenceDiversityCertificates.some(
      (certificate) => certificate.behaviorallyIndependent === true
    );
  const evaluatedModelHash = neuralCheckpointModelHash(serializeNeuralModel(candidate));
  candidate.metadata.evaluation = evaluation;
  candidate.metadata.candidateGate = candidateGate;
  candidate.metadata.promotionConditionSafety = promotionConditionSafety;
  candidate.metadata.candidateDeckGate = candidateDeckGate;
  candidate.metadata.candidateDeckGateRole = "cross-deck-ecosystem-screen-only";
  candidate.metadata.leagueEvaluation = leagueEvaluation;
  candidate.metadata.leagueGate = leagueGate;
  candidate.metadata.absoluteEvaluation = absoluteEvaluation;
  candidate.metadata.absoluteGate = absoluteGate;
  candidate.metadata.absoluteDeckGate = absoluteDeckGate;
  candidate.metadata.absoluteDeckGateRole = "cross-deck-benchmark-screen-only";
  candidate.metadata.intrinsicEvaluation = compactEvaluation(intrinsicEvaluation);
  candidate.metadata.intrinsicConfirmationEvaluations = targetedIntrinsicEvaluations.map(compactEvaluation);
  candidate.metadata.intrinsicDeckSafety = intrinsicDeckSafety;
  candidate.metadata.evaluationMode = evaluationMode;
  candidate.metadata.promoted = promoted;
  candidate.metadata.parentLearnerEvaluation = {
    opponentIndex: parentLearnerOpponentIndex,
    ...compactEvaluation(parentLearnerEvaluation)
  };
  candidate.metadata.parentSeatBaselineEvaluation =
    compactEvaluation(parentSeatBaselineEvaluation);
  candidate.metadata.learnerAdvanceGate = learnerAdvanceGate;
  candidate.metadata.learnerAdvanced = learnerAdvanced;
  candidate.metadata.evaluatedModelHash = evaluatedModelHash;
  const policyConnectedMass = candidate.metadata?.correctionBalance
    ?.policyConnectedMass || {
      version: 1,
      proofPolicyMass: 0,
      verifiedTeacherPolicyMass: 0,
      postmortemPolicyMass: 0,
      provisionalAuxiliaryMass: 0,
      totalPolicyConnectedMass: 0
    };
  const totalPolicyConnectedMass =
    Number(policyConnectedMass.totalPolicyConnectedMass) || 0;
  const proofPolicyMass = Number(policyConnectedMass.proofPolicyMass) || 0;
  const terminalConfirmedPolicyMass =
    Number(policyConnectedMass.terminalConfirmedPolicyMass) || 0;
  const certifiedEvaluatorPolicyMass =
    Number(policyConnectedMass.certifiedEvaluatorPolicyMass) || 0;
  const experimentDoseStatus = teacherDoseStatusForRun(
    runContract,
    policyConnectedMass
  );
  candidate.metadata.teacherDose = {
    version: 3,
    status: experimentDoseStatus,
    proofPolicyMass,
    verifiedTeacherPolicyMass:
      Number(policyConnectedMass.verifiedTeacherPolicyMass) || 0,
    postmortemPolicyMass: Number(policyConnectedMass.postmortemPolicyMass) || 0,
    terminalConfirmedPolicyMass,
    certifiedEvaluatorPolicyMass,
    otherVerifiedPolicyMass:
      Number(policyConnectedMass.otherVerifiedPolicyMass) || 0,
    provisionalAuxiliaryMass:
      Number(policyConnectedMass.provisionalAuxiliaryMass) || 0,
    totalPolicyConnectedMass,
    zeroDoseIsNotFailure: ["B", "C"].includes(runContract),
    recommendedNextRun: experimentDoseStatus === "inconclusive-zero-dose"
      ? "C-evaluator-bootstrap"
      : null
  };
  candidate.metadata.engineValidationStatus = officialPromotionRun
    ? learnerAdvanced
      ? "current-engine-validated"
      : "current-engine-candidate"
    : "diagnostic-only";
  if (candidate.metadata.warmStart) {
    candidate.metadata.warmStart = {
      ...candidate.metadata.warmStart,
      requiresCurrentEngineRevalidation: !learnerAdvanced,
      validatedAt: learnerAdvanced ? new Date().toISOString() : null,
      validationResult: learnerAdvanced ? "learner-advance-gate-passed" : "learner-advance-gate-failed"
    };
  }
  const primaryPolicyModel = learnerAdvanced
    ? candidate
    : learnerAtGenerationStart;
  const stableEvaluatorReplicas = evaluatorDevelopmentGate?.passed === true
    ? evaluatorEpochAudits.filter((item) => item.status?.eligible === true)
    : stableEvaluatorReplicaCandidates(
      evaluatorEpochAudits,
      evaluatorTrainingReplicas
    );
  const evaluatorDevelopmentSelection = officialPromotionRun
    ? evaluatorDevelopmentGate?.passed === true
      ? evaluatorDevelopmentGate.selected
      : selectEvaluatorOnlyArtifact(
        stableEvaluatorReplicas,
        primaryPolicyModel
      )
    : null;
  let evaluatorConfirmationAudit = null;
  let evaluatorFinalAudit = null;
  let evaluatorEpochSelection = null;
  if (evaluatorDevelopmentSelection) {
    const selectedEvaluatorModel = deserializeNeuralModel(
      evaluatorDevelopmentSelection.checkpoint
    );
    selectedEvaluatorModel.metadata = {
      ...selectedEvaluatorModel.metadata,
      engineFingerprint,
      engineValidationStatus: "current-engine-validated",
      validationScope: "evaluator-only",
      runContract,
      artifactRole: "frozen-evaluator-candidate",
      evaluatorSourceEpoch: evaluatorDevelopmentSelection.epoch,
      evaluatorTrainingReplica: evaluatorDevelopmentSelection.replica,
      evaluatorTrainingOrderSeed: evaluatorDevelopmentSelection.orderSeed
    };
    // Architecture and calibration parameters are frozen at development.
    // Confirmation and final audit may measure them, but may not refit them.
    let certificationCalibration = {
      ...selectedEvaluatorModel.calibration,
      testGames: 0,
      brier: null,
      expectedCalibrationError: null,
      rankingAuc: null,
      evaluationScope: "awaiting-protected-final-audit"
    };
    const confirmationRankingAudits = evaluatorConfirmationGate?.passed === true
      ? {
        actionRanking: evaluatorConfirmationGate.actionRanking,
        leafValueRanking: evaluatorConfirmationGate.leafValueRanking
      }
      : await evaluateIndependentRankingAudits(
        selectedEvaluatorModel,
        evaluatorConfirmationDataset,
        {
          batchSize: calibrationBatchSize,
          engineFingerprint,
          requireStructuredV2: true,
          requireFormalActionEvidence: evaluatorCertificateKind
            === EVALUATOR_CERTIFICATE_KINDS.robustAction,
          certificationRole: "confirmation",
          datasetKey: evaluatorConfirmationDataset?.manifest?.datasetKey
            || evaluatorBootstrap?.datasetKey
        }
      );
    const confirmationActionRanking =
      confirmationRankingAudits.actionRanking;
    const confirmationLeafValueRanking =
      confirmationRankingAudits.leafValueRanking;
    const confirmationStatus = evaluatorConfirmationGate?.passed === true
      ? evaluatorConfirmationGate.status
      : evaluatorDevelopmentAuditStatus(
        confirmationActionRanking,
        confirmationLeafValueRanking,
        { certificateKind: evaluatorCertificateKind }
      );
    evaluatorConfirmationAudit = {
      dataset: evaluatorConfirmationDataset.manifest,
      actionRanking: confirmationActionRanking,
      leafValueRanking: confirmationLeafValueRanking,
      status: confirmationStatus
    };
    if (confirmationStatus.eligible) {
      const finalAuditCachePath = path.join(
        dataRoot,
        "resume",
        `iteration-${String(trainingIteration).padStart(5, "0")}`,
        "evaluator-final-audit.json"
      );
      const finalAuditCacheKey = checkpointHash({
        version: 10,
        policyQFormalAuditContract: evaluatorCertificateKind
          === EVALUATOR_CERTIFICATE_KINDS.policyQ
          ? POLICY_Q_FORMAL_AUDIT_CONTRACT
          : null,
        certificateKind: evaluatorCertificateKind,
        trainingKey,
        evaluatorCertificateVersion: EVALUATOR_CERTIFICATE_VERSION,
        epoch: evaluatorDevelopmentSelection.epoch,
        replica: evaluatorDevelopmentSelection.replica,
        orderSeed: evaluatorDevelopmentSelection.orderSeed,
        artifactHash: neuralArtifactHash(selectedEvaluatorModel),
        finalAuditDataset: evaluatorFinalAuditDataset.manifest
      });
      const cachedFinalAudit = await readCheckpoint(finalAuditCachePath);
      let finalActionRanking;
      let finalLeafValueRanking;
      let certification;
      let finalModelCheckpoint;
      if (cachedFinalAudit?.version === 10
        && cachedFinalAudit.cacheKey === finalAuditCacheKey) {
        finalActionRanking = cachedFinalAudit.actionRanking;
        finalLeafValueRanking = cachedFinalAudit.leafValueRanking;
        certification = {
          certificate: cachedFinalAudit.certificate,
          status: cachedFinalAudit.status
        };
        certificationCalibration = cachedFinalAudit.calibration;
        finalModelCheckpoint = cachedFinalAudit.modelCheckpoint;
      } else {
        // This is the only place where the protected final-audit partition is
        // opened, and it is evaluated for exactly one preselected epoch.
        const finalRankingAudits =
          await evaluateIndependentRankingAudits(
            selectedEvaluatorModel,
            evaluatorFinalAuditDataset,
            {
              batchSize: calibrationBatchSize,
              engineFingerprint,
              requireStructuredV2: true,
              requireFormalActionEvidence: evaluatorCertificateKind
                === EVALUATOR_CERTIFICATE_KINDS.robustAction,
              certificationRole: "final-audit",
              datasetKey: evaluatorFinalAuditDataset?.manifest?.datasetKey
                || evaluatorBootstrap?.datasetKey
            }
          );
        finalActionRanking = finalRankingAudits.actionRanking;
        finalLeafValueRanking = finalRankingAudits.leafValueRanking;
        if (evaluatorCertificateKind === EVALUATOR_CERTIFICATE_KINDS.policyQ) {
          finalLeafValueRanking.formalPolicyQAudit = policyQFormalAuditStatus(
            finalLeafValueRanking,
            undefined,
            {
              expectedDeckSeats: policyQExpectedDeckSeats(),
              expectedDeckSeatPhases: policyQExpectedDeckSeatPhases(),
              deckSeatPhaseOpportunityContract:
                "training-deck-seat-cartesian-v1"
            }
          );
        }
        certificationCalibration =
          await evaluateFrozenEvaluatorEvidenceCalibration(
            selectedEvaluatorModel,
            evaluatorFinalAuditDataset,
            {
              engineFingerprint,
              requireStructuredV2: true,
              fitSamples:
                selectedEvaluatorModel.metadata?.evaluatorEvidenceTraining
                  ?.samples || null,
              fitGames: evaluatorTrainingDataset?.manifest?.games || null
            }
          );
        const finalPartitionAudit =
          evaluatorBootstrap?.audit?.partitions?.["final-audit"] || {};
        const certificateBootstrapAudit = {
          ...finalPartitionAudit,
          complete: evaluatorBootstrap?.audit?.complete === true
            && finalPartitionAudit.complete === true,
          allocation: evaluatorBootstrap?.audit?.allocation || null,
          certificationDatasetFingerprint:
            evaluatorFinalAuditDataset.manifest.datasetFingerprint,
          certificationDatasetManifest:
            evaluatorFinalAuditDataset.manifest
        };
        certification = createEvaluatorCertificate(
          selectedEvaluatorModel,
          {
            certificateKind: evaluatorCertificateKind,
            engineFingerprint,
            frozen: true,
            calibration: certificationCalibration,
            actionRanking: finalActionRanking,
            leafValueRanking: finalLeafValueRanking,
            bootstrapRequired: evaluatorBootstrap !== null,
            bootstrapAudit: certificateBootstrapAudit,
            holdout: {
              games: certificationCalibration.testGames,
              completed: certificationCalibration.testGames,
              completionRate: certificationCalibration.testGames ? 1 : 0,
              invalidGames: 0,
              independent: true,
              seedProtected: true,
              seedManifestHash: checkpointHash({
                finalAudit: evaluatorFinalAuditDataset.manifest
              })
            }
          }
        );
        finalModelCheckpoint = serializeNeuralModel(selectedEvaluatorModel);
        await writeCheckpoint(finalAuditCachePath, {
          version: 10,
          cacheKey: finalAuditCacheKey,
          epoch: evaluatorDevelopmentSelection.epoch,
          actionRanking: finalActionRanking,
          leafValueRanking: finalLeafValueRanking,
          calibration: certificationCalibration,
          certificate: certification.certificate,
          status: certification.status,
          modelCheckpoint: finalModelCheckpoint,
          evaluatedAt: new Date().toISOString()
        });
      }
      evaluatorFinalAudit = {
        dataset: evaluatorFinalAuditDataset.manifest,
        actionRanking: finalActionRanking,
        leafValueRanking: finalLeafValueRanking,
        calibration: certificationCalibration,
        certificate: certification.certificate,
        status: certification.status
      };
      if (certification.status.eligible) {
        evaluatorEpochSelection = {
          ...evaluatorDevelopmentSelection,
          checkpoint: finalModelCheckpoint,
          artifactHash: certification.status.artifactHash,
          evaluatorLeafHash: certification.status.evaluatorLeafHash,
          calibration: certificationCalibration,
          actionRanking: finalActionRanking,
          leafValueRanking: finalLeafValueRanking,
          certificate: certification.certificate,
          status: certification.status
        };
      }
    }
  }
  const evaluatorOnlyModel = evaluatorEpochSelection
    ? deserializeNeuralModel(evaluatorEpochSelection.checkpoint)
    : null;
  if (evaluatorOnlyModel) {
    evaluatorOnlyModel.metadata = {
      ...evaluatorOnlyModel.metadata,
      engineFingerprint,
      engineValidationStatus: "current-engine-validated",
      validationScope: "evaluator-only",
      artifactRole: "frozen-evaluator-only",
      policyPromotionEligible: false,
      policyPromotionStatus: "not-applicable-evaluator-only",
      evaluatorSourceEpoch: evaluatorEpochSelection.epoch,
      evaluatorTrainingReplica: evaluatorEpochSelection.replica,
      evaluatorTrainingOrderSeed: evaluatorEpochSelection.orderSeed,
      evaluatorCertificate: evaluatorEpochSelection.certificate
    };
  }
  const evaluatorCertificationStatus = evaluatorOnlyModel
    ? evaluatorCertificateStatus(evaluatorOnlyModel, {
      engineFingerprint,
      certificateKind: evaluatorCertificateKind,
      primaryModel: primaryPolicyModel
    })
    : evaluatorFinalAudit?.status || {
      eligible: false,
      reasons: evaluatorConfirmationAudit
        ? [
          "evaluator-confirmation-failed",
          ...(evaluatorConfirmationAudit.status?.reasons || [])
        ]
        : evaluatorEpochAudits.length
          ? ["no-independent-evaluator-development-epoch-passed"]
          : ["no-evaluator-epoch-candidates"]
    };
  candidate.metadata.evaluatorCertificationAttempt = {
    version: 3,
    officialRunRequired: true,
    runContract,
    policyPromotionIndependent: true,
    policySelectedEpoch,
    evaluatorSelectedEpoch: evaluatorEpochSelection?.epoch ?? null,
    evaluatorSelectedArtifactHash:
      evaluatorEpochSelection?.artifactHash || null,
    eligible: evaluatorCertificationStatus.eligible,
    reasons: evaluatorCertificationStatus.reasons,
    evaluatorBootstrap:
      evaluatorEpochSelection?.certificate?.evaluatorBootstrap || null,
    developmentSelection: evaluatorDevelopmentSelection
      ? {
        epoch: evaluatorDevelopmentSelection.epoch,
        selectionScore: evaluatorDevelopmentSelection.selectionScore,
        status: evaluatorDevelopmentSelection.status
      }
      : null,
    confirmation: evaluatorConfirmationAudit,
    finalAudit: evaluatorFinalAudit,
    candidates: evaluatorEpochAudits.map((item) => ({
      epoch: item.epoch,
      eligible: item.status.eligible,
      reasons: item.status.reasons,
      selectionScore: item.selectionScore,
      evaluatorLeafHash: item.evaluatorLeafHash
    })),
    attemptedAt: new Date().toISOString()
  };
  // A policy candidate never inherits an evaluator-only certificate. The
  // independently selected frozen artifact is registered in its own lineage
  // and can never become champion through this path.
  delete candidate.metadata.evaluatorCertificate;
  const evaluatorRegistryRegistration =
    evaluatorOnlyModel && evaluatorCertificationStatus.eligible
    ? await registerFrozenEvaluator(dataRoot, evaluatorOnlyModel, {
      engineFingerprint,
      maximumActive: 3
    })
    : {
      registered: false,
      status: evaluatorCertificationStatus
    };
  candidate.metadata.evaluatorRegistry = {
    version: 3,
    registered: evaluatorRegistryRegistration.registered === true,
    evaluatorOnly: true,
    policyPromotionEligible: false,
    sourceEpoch: evaluatorEpochSelection?.epoch ?? null,
    modelHash: evaluatorRegistryRegistration.modelHash || null,
    behaviorHash: evaluatorRegistryRegistration.behaviorHash || null,
    evaluatorCoreHash: evaluatorRegistryRegistration.evaluatorCoreHash || null,
    evaluatorLeafHash: evaluatorRegistryRegistration.evaluatorLeafHash || null,
    checkpoint: evaluatorRegistryRegistration.checkpoint || null,
    reasons: evaluatorRegistryRegistration.status?.reasons || []
  };
  await writeCheckpoint(candidatePath, serializeNeuralModel(candidate));
  if (promoted) {
    if (championCheckpoint) await writeCheckpoint(path.join(leagueRoot, `generation-${String(champion.generation).padStart(5, "0")}.json`), championCheckpoint);
    champion = candidate;
    championCheckpoint = serializeNeuralModel(candidate);
    await writeCheckpoint(checkpointPath, championCheckpoint);
    await writeCheckpoint(path.join(leagueRoot, `generation-${String(candidate.generation).padStart(5, "0")}.json`), championCheckpoint);
    league = (await loadLeague(leagueRoot, Math.max(1, Number(args["league-size"]) || 8)))
      .filter((model) => isCurrentEngineValidatedModel(model, engineFingerprint));
  }
  if (learnerAdvanced) {
    learner = candidate;
    learnerCheckpoint = serializeNeuralModel(learner);
    await writeCheckpoint(learnerCheckpointPath, learnerCheckpoint);
    await writeCheckpoint(optimizerStatePath, await serializeOptimizer(optimizer, learner.generation));
  } else {
    learner = learnerAtGenerationStart;
    learnerCheckpoint = learnerCheckpointAtGenerationStart;
    optimizer.dispose?.();
    optimizer = await restoreAdamOptimizer(optimizerStateAtGenerationStart, configuredLearningRate);
  }
  challengers = (await loadRecentCandidateModels(dataRoot, trainingDeckIds, challengerLeagueSize, learner))
    .filter((model) => isCurrentEngineValidatedModel(model, engineFingerprint));
  await writeCheckpoint(runStatePath, {
    version: 4,
    runContract,
    experimentId,
    teacherConsumptionPolicy,
    seed,
    trainingIteration,
    championGeneration: champion.generation,
    learnerGeneration: learner.generation,
    updatedAt: new Date().toISOString()
  });
  const summary = {
    state: "idle",
    generation,
    trainingIteration,
    championGeneration: champion.generation,
    learnerGeneration: learner.generation,
    runContract,
    diagnosticRun,
    promoted,
    learnerAdvanced,
    learnerAdvanceGate,
    teacherDose: candidate.metadata.teacherDose,
    games,
    humanTrajectories: humanTrajectories.length,
    humanTrainingSteps,
    turningPointReplays: {
      used: replayTrajectories.length,
      fresh: freshTurningPointReplayCount,
      buffered: mergedTurningPointReplayEntries.length,
      rejectedByGlobalHoldoutProvenance: replayEligibility.rejected.length,
      rejectionReasons: countBy(
        replayEligibility.rejected,
        (entry) => entry.rejectionReason || "unknown"
      ),
      holdoutProvenanceFingerprint: checkpointHash({
        version: holdoutProvenance.version,
        engineFingerprint: holdoutProvenance.engineFingerprint,
        entries: holdoutProvenance.entries,
        completeCollections: holdoutProvenance.completeCollections
      }),
      path: turningPointReplayPath
    },
    trainingStrata: candidate.metadata.trainingStrata,
    trajectoryCoverage: candidate.metadata.trajectoryCoverage,
    retentionGuard: candidate.metadata.retentionHistory,
    resourceReservationTraining: candidate.metadata.resourceReservationTraining,
    handOpportunityTraining,
    tacticalTraining: summarizeTacticalDiagnostics(collected.summaries),
    proofTraining: summarizeProofDiagnostics(collected.summaries),
    postmortemTraining: summarizePostmortemDiagnostics(collected.summaries),
    evaluationScheduleAudit,
    completedGames: collected.summaries.filter((item) => item.completed).length,
    collectionDeckStats,
    collectionMix: summarizeCollectionMix(collected.summaries),
    turningPoints: summarizeTurningPoints(collected.summaries),
    candidatePath,
    learnerCheckpointPath,
    evaluation: { completed: evaluation.completed, naturallyCompleted: evaluation.naturallyCompleted, adjudicatedGames: evaluation.adjudicatedGames, invalidGames: evaluation.invalidGames, wins: evaluation.candidateWins, winRate: evaluation.winRate, wilsonLowerBound: evaluation.wilsonLowerBound, seatStats: evaluation.seatStats, conditionStats: evaluation.conditionStats, conditionGap: evaluation.conditionGap, stability: evaluation.stability, deckStats: evaluation.deckStats, deckGate: candidateDeckGate, seatGap: evaluation.seatGap, passed: candidateGate },
    intrinsicEvaluation: {
      completed: intrinsicEvaluation.completed,
      games: intrinsicEvaluation.games,
      wins: intrinsicEvaluation.candidateWins,
      winRate: intrinsicEvaluation.winRate,
      wilsonLowerBound: intrinsicEvaluation.wilsonLowerBound,
      targetedConfirmationGames: targetedIntrinsicEvaluations.reduce((sum, item) => sum + item.games, 0),
      deckSafety: intrinsicDeckSafety
    },
    absoluteEvaluation: { completed: absoluteEvaluation.completed, naturallyCompleted: absoluteEvaluation.naturallyCompleted, adjudicatedGames: absoluteEvaluation.adjudicatedGames, invalidGames: absoluteEvaluation.invalidGames, wins: absoluteEvaluation.candidateWins, winRate: absoluteEvaluation.winRate, wilsonLowerBound: absoluteEvaluation.wilsonLowerBound, seatStats: absoluteEvaluation.seatStats, conditionStats: absoluteEvaluation.conditionStats, conditionGap: absoluteEvaluation.conditionGap, stability: absoluteEvaluation.stability, deckStats: absoluteEvaluation.deckStats, deckGate: absoluteDeckGate, seatGap: absoluteEvaluation.seatGap, passed: absoluteGate },
    leagueEvaluation: { opponents: leagueEvaluation.opponents, completed: leagueEvaluation.completed, naturallyCompleted: leagueEvaluation.naturallyCompleted, adjudicatedGames: leagueEvaluation.adjudicatedGames, invalidGames: leagueEvaluation.invalidGames, winRate: leagueEvaluation.winRate, wilsonLowerBound: leagueEvaluation.wilsonLowerBound, worstOpponentWilsonLowerBound: leagueEvaluation.worstOpponentWilsonLowerBound, maxSeatGap: leagueEvaluation.maxSeatGap, maxConditionGap: leagueEvaluation.maxConditionGap, blowoutRate: leagueEvaluation.blowoutRate, passed: leagueGate },
    calibration: trained.calibration,
    meanLoss: candidate.metadata.meanLoss
  };
  progress.write({ ...summary, stage: "complete" });
  await writeAiStatus({ ...summary, progressPath: progress.latestPath, eventLogPath: progress.eventLogPath });
  console.log(JSON.stringify(summary));
  if (generations === Infinity) await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Number(args["generation-delay-ms"]) || 5000)));
  } catch (error) {
    const failurePath = await writeTrainingFailure(dataRoot, {
      generation,
      trainingIteration,
      phase,
      descriptor,
      checkpointPath,
      learnerCheckpointPath,
      optimizerStatePath
    }, error);
    await writeAiStatus({
      state: "error",
      generation,
      phase,
      games,
      workers: collectionWorkers,
      seed: generationSeed,
      failurePath,
      error: { message: error?.message || String(error), code: error?.code || null },
      progressPath: progress.latestPath,
      eventLogPath: progress.eventLogPath
    });
    progress.write({ state: "error", stage: phase, failurePath, error: { message: error?.message || String(error), code: error?.code || null } });
    throw error;
  }
}

function evolvePopulation(current, knowledge, random, limit, seedDecks) {
  const seeds = seedDecks.map((deck) => structuredClone(deck));
  const allowedLegends = new Set(seeds.map((deck) => deck.legend.cardNumber));
  const parents = [...current].sort((left, right) => deckFitness(knowledge, right) - deckFitness(knowledge, left)).slice(0, Math.max(4, Math.floor(limit / 2)));
  const variants = [];
  while (seeds.length + parents.length + variants.length < limit && parents.length) {
    const parent = parents[Math.floor(random() * parents.length)];
    const variant = mutateDeck(parent, knowledge || {}, random);
    if (!sameLegendIdentity(parent, variant) || !allowedLegends.has(variant.legend.cardNumber)) {
      throw new Error(`Deck evolution changed the Legend identity of ${parent.id}.`);
    }
    variants.push(variant);
  }
  const population = [...new Map([...seeds, ...parents, ...variants].map((deck) => [deck.id, deck])).values()].slice(0, limit);
  if (population.some((deck) => !allowedLegends.has(deck.legend?.cardNumber))) throw new Error("Deck evolution escaped the focused Legend pool.");
  return population;
}

function deckFitness(knowledge, deck) {
  const stat = knowledge?.deckStats?.[deck.id];
  return stat?.games ? stat.wins / stat.games : 0.5;
}

function summarizeDeckOutcomes(summaries) {
  const stats = {};
  for (const summary of summaries || []) {
    if (!summary?.completed || !Array.isArray(summary.deckIds)) continue;
    for (let seat = 0; seat < summary.deckIds.length; seat += 1) {
      const deckId = summary.deckIds[seat];
      const stat = stats[deckId] ||= { games: 0, wins: 0, scoreFor: 0, scoreAgainst: 0 };
      stat.games += 1;
      stat.wins += summary.winnerId === `p${seat + 1}` ? 1 : 0;
      stat.scoreFor += Number(summary.scores?.[seat]) || 0;
      stat.scoreAgainst += Number(summary.scores?.[1 - seat]) || 0;
    }
  }
  for (const stat of Object.values(stats)) {
    stat.winRate = stat.games ? stat.wins / stat.games : 0;
    stat.meanScoreFor = stat.games ? stat.scoreFor / stat.games : 0;
    stat.meanScoreAgainst = stat.games ? stat.scoreAgainst / stat.games : 0;
  }
  return stats;
}

function evaluateDeckCoverage(evaluation, deckIds, minimumWinRate, minimumScoreMargin = -2.5) {
  const minimumGames = Math.max(2, Math.floor((evaluation.games || 0) / Math.max(1, deckIds.length * 2)));
  const failures = [];
  for (const deckId of deckIds) {
    const stat = evaluation.deckStats?.[deckId];
    if (!stat || stat.completed < minimumGames) failures.push({ deckId, reason: "insufficient-games", completed: stat?.completed || 0, minimumGames });
    else if (stat.winRate < minimumWinRate) failures.push({ deckId, reason: "low-win-rate", winRate: stat.winRate, minimumWinRate, completed: stat.completed });
    else if ((stat.meanScoreFor - stat.meanScoreAgainst) < minimumScoreMargin) failures.push({
      deckId,
      reason: "low-score-margin",
      meanScoreMargin: stat.meanScoreFor - stat.meanScoreAgainst,
      minimumScoreMargin,
      completed: stat.completed
    });
  }
  return { passed: failures.length === 0, minimumGames, minimumWinRate, minimumScoreMargin, failures };
}

function summarizeTacticalDiagnostics(summaries) {
  const fields = [
    "tacticalDecisions", "misalignedTargetChoices", "lowImpactTradeoffChoices",
    "hopelessReinforcements", "reversedRemovals", "singleUnitMoves", "multiUnitMoves",
    "directBreakthroughMoves", "tacticalSetupMoves", "noOpponentImpactMoves",
    "criticalDecisionSteps", "urgentDecisionSteps", "teacherUrgentQueries", "diagnosticRewardSteps"
  ];
  const result = Object.fromEntries(fields.map((field) => [field,
    (summaries || []).reduce((sum, summary) => sum + (Number(summary?.[field]) || 0), 0)]));
  const weighted = (summaries || []).reduce((sum, summary) => sum
    + (Number(summary?.averageTacticalPrior) || 0) * (Number(summary?.tacticalDecisions) || 0), 0);
  result.averageTacticalPrior = result.tacticalDecisions ? weighted / result.tacticalDecisions : 0;
  const movementDecisions = result.singleUnitMoves + result.multiUnitMoves;
  const weightedMoveGroupSize = (summaries || []).reduce((sum, summary) => sum
    + (Number(summary?.averageMoveGroupSize) || 0)
      * ((Number(summary?.singleUnitMoves) || 0) + (Number(summary?.multiUnitMoves) || 0)), 0);
  result.averageMoveGroupSize = movementDecisions ? weightedMoveGroupSize / movementDecisions : 0;
  result.totalDiagnosticReward = (summaries || []).reduce((sum, summary) =>
    sum + (Number(summary?.totalDiagnosticReward) || 0), 0);
  return result;
}

function summarizePostmortemDiagnostics(summaries) {
  const causes = {};
  let capturedCandidates = 0;
  let reviewed = 0;
  let verifiedCorrections = 0;
  let unproven = 0;
  let regretTotal = 0;
  for (const summary of summaries || []) {
    capturedCandidates += Number(summary?.postmortemCapturedCandidates) || 0;
    reviewed += Number(summary?.postmortemReviews) || 0;
    verifiedCorrections += Number(summary?.postmortemVerifiedCorrections) || 0;
    unproven += Number(summary?.postmortemUnprovenReviews) || 0;
    regretTotal += (Number(summary?.postmortemAverageRegret) || 0)
      * (Number(summary?.postmortemReviews) || 0);
    for (const [cause, count] of Object.entries(summary?.postmortemCauses || {})) {
      causes[cause] = (causes[cause] || 0) + Number(count || 0);
    }
  }
  return {
    version: 1,
    capturedCandidates,
    reviewed,
    verifiedCorrections,
    unproven,
    averageRegret: reviewed ? regretTotal / reviewed : 0,
    causes
  };
}

function summarizeProofDiagnostics(summaries) {
  const kinds = {};
  let checks = 0;
  let labels = 0;
  let agreements = 0;
  let corrections = 0;
  for (const summary of summaries || []) {
    checks += Number(summary?.proofChecks) || 0;
    labels += Number(summary?.proofLabels) || 0;
    agreements += Number(summary?.proofAgreements) || 0;
    corrections += Number(summary?.proofCorrections) || 0;
    for (const [kind, count] of Object.entries(summary?.proofKinds || {})) {
      kinds[kind] = (kinds[kind] || 0) + Number(count || 0);
    }
  }
  return {
    version: 1,
    checks,
    labels,
    agreements,
    corrections,
    kinds
  };
}

function trainingMemorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external,
    systemFreeBytes: freemem(),
    systemTotalBytes: totalmem()
  };
}

function releaseTrajectoryDatasets(...datasets) {
  for (const dataset of datasets) {
    if (Array.isArray(dataset?.trajectories)) dataset.trajectories.length = 0;
  }
}

function disposeNeuralModelLayers(model) {
  const layers = new Set(Object.values(model?.layers || {}));
  for (const layer of layers) {
    try {
      layer?.dispose?.();
    } catch {}
  }
}

function releaseMaterializedBootstrap(materialized, options = {}) {
  for (const records of Object.values(materialized?.recordPartitions || {})) {
    if (Array.isArray(records)) records.length = 0;
  }
  if (options.releaseDatasets === true) {
    releaseTrajectoryDatasets(...Object.values(materialized?.datasets || {}));
  }
  if (materialized && typeof materialized === "object") {
    materialized.recordPartitions = null;
    materialized.datasets = null;
  }
}

async function compactTrainingHeap() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    if (typeof globalThis.gc === "function") globalThis.gc();
  }
}

async function collectEvaluatorBootstrapIsolated(options) {
  const stageId = [
    "bootstrap",
    process.pid,
    Date.now(),
    Math.random().toString(16).slice(2)
  ].join("-");
  const directory = path.join(
    options.dataRoot,
    "resume",
    "evaluator-bootstrap-stage"
  );
  const requestPath = path.join(directory, `${stageId}.request.json`);
  const resultPath = path.join(directory, `${stageId}.result.json`);
  const ownerPath = path.join(directory, `${stageId}.owner.json`);
  await writeCheckpoint(
    requestPath,
    serializeEvaluatorBootstrapStageRequest(options, {
      stageId,
      parentProcessId: process.pid,
      memoryBeforeSpawn: trainingMemorySnapshot()
    })
  );
  // The serialized checkpoint and its JSON string are both temporary. Reclaim
  // them before the coordinator and its worker pool begin allocating memory.
  await compactTrainingHeap();
  const childScript = path.resolve(
    "scripts",
    "evaluator-bootstrap-stage-process.mjs"
  );
  const childExecArgv = process.execArgv
    .filter((value) => !value.startsWith("--max-old-space-size"));
  childExecArgv.push("--max-old-space-size=4096");
  const child = fork(childScript, [requestPath, resultPath], {
    cwd: process.cwd(),
    execArgv: childExecArgv,
    serialization: "json",
    stdio: ["ignore", "inherit", "inherit", "ipc"]
  });
  await writeCheckpoint(ownerPath, {
    version: 1,
    stageId,
    parentProcessId: process.pid,
    childProcessId: child.pid,
    stopRequestPath: options.collection?.stopRequestPath || null,
    startedAt: new Date().toISOString()
  });
  let childExited = false;
  let forcedTerminationTimer = null;
  let shutdownRequest = null;
  const requestGracefulStageStop = (signal) => {
    if (shutdownRequest) return shutdownRequest;
    shutdownRequest = writeStopRequestIfAbsent(
      options.collection?.stopRequestPath,
      {
        version: 1,
        requestedAt: new Date().toISOString(),
        reason: "evaluator-bootstrap-parent-terminating",
        handoffId: stageId,
        parentProcessId: process.pid,
        childProcessId: child.pid,
        signal
      }
    ).catch(() => false);
    forcedTerminationTimer = setTimeout(() => {
      if (!childExited) void terminateProcessTree(child.pid);
    }, 15 * 60 * 1000);
    return shutdownRequest;
  };
  const onSigint = () => { void requestGracefulStageStop("SIGINT"); };
  const onSigterm = () => { void requestGracefulStageStop("SIGTERM"); };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  const exit = await new Promise((resolve) => {
    child.on("message", (message) => {
      if (message?.type === "audit-progress") {
        options.onAuditProgress?.(message.audit);
      } else if (message?.type === "stop-requested") {
        options.collection?.onStopRequested?.(message.stop);
      } else if (message?.type === "complete" && child.connected) {
        // The result is already atomically committed before this notification.
        // Closing the IPC channel also lets older stage children terminate if
        // they would otherwise remain alive solely because of the channel.
        child.disconnect();
      }
    });
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
    child.once("exit", (code, signal) => {
      childExited = true;
      resolve({ code, signal, error: null });
    });
  }).finally(async () => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    if (forcedTerminationTimer) clearTimeout(forcedTerminationTimer);
    await unlink(ownerPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  });
  const result = await readCheckpoint(resultPath);
  if (exit.code !== 0 || result?.ok !== true) {
    const detail = result?.error?.message
      || exit.error?.message
      || `exit=${exit.code ?? "null"}, signal=${exit.signal || "none"}`;
    throw new Error(`Isolated evaluator-bootstrap stage failed: ${detail}`);
  }
  const loaded = await loadEvaluatorBootstrap(
    result.directory,
    result.datasetKey
  );
  await unlink(requestPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await unlink(resultPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return {
    ...loaded,
    directory: result.directory,
    datasetKey: result.datasetKey,
    audit: result.audit
  };
}

async function writeStopRequestIfAbsent(filename, value) {
  if (!filename) return false;
  await mkdir(path.dirname(filename), { recursive: true });
  let handle;
  try {
    handle = await open(filename, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(value), "utf8");
    return true;
  } finally {
    await handle.close();
  }
}

async function terminateProcessTree(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return;
  if (process.platform !== "win32") {
    try { process.kill(processId, "SIGKILL"); } catch {}
    return;
  }
  const taskkill = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "taskkill.exe"
  );
  await new Promise((resolve) => {
    const killer = spawn(taskkill, ["/PID", String(processId), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.once("error", () => resolve());
    killer.once("exit", () => resolve());
  });
}

async function readCheckpoint(filename) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch { return null; }
}

async function loadAcceptedEvaluatorEpochCheckpoints(
  directory,
  trainingKey
) {
  try {
    const output = [];
    const names = (await readdir(directory))
      .filter((name) => /^epoch-\d+\.json$/.test(name))
      .sort();
    for (const name of names) {
      const checkpoint = await readCheckpoint(path.join(directory, name));
      if (checkpoint?.trainingKey !== trainingKey
        || checkpoint?.accepted !== true
        || !checkpoint?.candidateCheckpoint
        || !Number.isInteger(Number(checkpoint.epoch))) continue;
      output.push({
        epoch: Number(checkpoint.epoch),
        candidateCheckpoint: checkpoint.candidateCheckpoint,
        modelHash: checkpoint.modelHash
          || checkpointHash(checkpoint.candidateCheckpoint)
      });
    }
    return output;
  } catch {
    return [];
  }
}

async function writeCheckpoint(filename, checkpoint) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, "utf8");
  await renameWithRetry(temporary, filename);
}

async function claimProtectedEvaluationSeed(filename, claim) {
  const existing = await readCheckpoint(filename);
  if (existing) {
    const sameClaim = existing.trainingKey === claim.trainingKey
      && existing.candidateHash === claim.candidateHash
      && existing.opponentHash === claim.opponentHash
      && Number(existing.seed) === Number(claim.seed)
      && Number(existing.games) === Number(claim.games)
      && existing.evaluationMode === claim.evaluationMode
      && existing.purpose === claim.purpose;
    if (!sameClaim) {
      throw new Error(
        "Protected final-audit seed was already claimed by a different candidate or protocol."
      );
    }
    return existing;
  }
  const manifest = {
    ...claim,
    seedProtected: true,
    claimedAt: new Date().toISOString()
  };
  await writeCheckpoint(filename, manifest);
  return manifest;
}

async function claimAbExperimentManifest(filename, claim) {
  const existing = await readCheckpoint(filename);
  if (existing) {
    const comparison = compareAbExperimentManifest(existing, claim);
    if (!comparison.compatible) {
      throw new Error(
        `Run A/B experiment manifest mismatch for ${claim.experimentId}: `
        + comparison.mismatches.join(", ")
      );
    }
    return existing;
  }
  await writeCheckpoint(filename, claim);
  return claim;
}

async function bindAbExperimentCollection(filename, manifest, collectionKey) {
  const existing = await readCheckpoint(filename) || manifest;
  if (existing.collectionKey && existing.collectionKey !== collectionKey) {
    throw new Error(
      `Run A/B experiment ${existing.experimentId} attempted to use two source collections.`
    );
  }
  if (!existing.collectionKey) {
    await writeCheckpoint(filename, {
      ...existing,
      collectionKey,
      collectionBoundAt: new Date().toISOString()
    });
  }
}

async function bindAbExperimentTrainingContract(
  filename,
  claim,
  runContract,
  teacherConsumptionPolicy
) {
  const existing = await readCheckpoint(filename);
  if (!existing) throw new Error("A/B source experiment manifest is missing.");
  const comparison = compareAbTrainingContract(existing, claim);
  if (!comparison.compatible) {
    throw new Error(
      `Run A/B controlled training contract mismatch for ${existing.experimentId}: `
      + comparison.mismatches.join(", ")
    );
  }
  const alreadyBound = existing.trainingControlHash != null
    || existing.inputDataHash != null
    || existing.ppoBatchOrderFingerprint != null;
  const next = {
    ...existing,
    ...claim,
    trainingRuns: {
      ...(existing.trainingRuns || {}),
      [runContract]: {
        teacherConsumptionPolicy,
        boundAt: new Date().toISOString()
      }
    },
    trainingContractBoundAt: existing.trainingContractBoundAt
      || new Date().toISOString()
  };
  if (!alreadyBound || JSON.stringify(next.trainingRuns) !== JSON.stringify(existing.trainingRuns)) {
    await writeCheckpoint(filename, next);
  }
  return next;
}

async function registerGlobalHoldoutProvenance(
  root,
  expectedEngineFingerprint,
  collectionKey,
  partitions
) {
  const provenancePath = path.join(root, "independent-holdouts", "provenance.json");
  return withFileLock(`${provenancePath}.lock`, () =>
    registerGlobalHoldoutProvenanceUnlocked(
      root,
      expectedEngineFingerprint,
      collectionKey,
      partitions,
      provenancePath
    ));
}

async function registerGlobalHoldoutProvenanceUnlocked(
  root,
  expectedEngineFingerprint,
  collectionKey,
  partitions,
  provenancePath
) {
  const stored = await readCheckpoint(provenancePath);
  const existing = stored?.version === 1
    && stored.engineFingerprint === expectedEngineFingerprint
    ? stored
    : null;
  const discovered = [];
  const observedCollections = new Set(existing?.observedCollections || []);
  const holdoutRoot = path.join(root, "independent-holdouts");
  for (const role of [
    "calibration-fit",
    "calibration-test",
    "evaluator-certification-audit"
  ]) {
    const roleDirectory = path.join(holdoutRoot, role);
    let namespaceEntries = [];
    try {
      namespaceEntries = await readdir(roleDirectory, { withFileTypes: true });
    } catch {}
    for (const namespaceEntry of namespaceEntries) {
      if (!namespaceEntry.isDirectory()) continue;
      const namespaceDirectory = path.join(roleDirectory, namespaceEntry.name);
      let archiveNames = [];
      try {
        archiveNames = (await readdir(namespaceDirectory))
          .filter((name) => name.endsWith(".json.gz"))
          .sort();
      } catch {}
      for (const archiveName of archiveNames) {
        try {
          const archive = await readTrajectoryArchive(
            path.join(namespaceDirectory, archiveName)
          );
          if (archive?.version !== 1
            || archive.engineFingerprint !== expectedEngineFingerprint
            || !archive.collectionKey
            || !Array.isArray(archive.trajectories)) continue;
          observedCollections.add(archive.collectionKey);
          for (const trajectory of archive.trajectories) {
            if (!trajectory?.gameId) continue;
            discovered.push({
              collectionKey: archive.collectionKey,
              gameId: trajectory.gameId,
              roles: [role]
            });
          }
        } catch {}
      }
    }
  }
  const currentEntries = currentHoldoutProvenanceEntries(collectionKey, partitions);
  observedCollections.add(collectionKey);
  const manifest = mergeHoldoutProvenance(
    existing,
    [...discovered, ...currentEntries],
    {
      engineFingerprint: expectedEngineFingerprint,
      completeCollections: [collectionKey],
      observedCollections: [...observedCollections]
    }
  );
  const persisted = {
    ...manifest,
    updatedAt: new Date().toISOString()
  };
  await writeCheckpoint(provenancePath, persisted);
  return persisted;
}

async function updateIndependentTrajectoryDataset(root, descriptor, trajectories, options = {}) {
  const namespace = String(descriptor.namespace || "official").replace(/[^a-z0-9_-]/gi, "_");
  const role = String(descriptor.role || "audit").replace(/[^a-z0-9_-]/gi, "_");
  const directory = path.join(root, "independent-holdouts", role, namespace);
  const filename = path.join(directory, `${descriptor.collectionKey}.json.gz`);
  if ((trajectories || []).length) {
    await writeTrajectoryArchive(filename, {
      version: 1,
      role,
      collectionKey: descriptor.collectionKey,
      engineFingerprint: descriptor.engineFingerprint,
      learningTargetVersion: descriptor.learningTargetVersion,
      lineageKey: descriptor.lineageKey || null,
      trainingDeckIds: descriptor.trainingDeckIds,
      trajectories
    });
  }
  const maximumGames = Math.max(100, Number(options.maximumGames) || 1000);
  const archives = [];
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json.gz")).sort();
    for (const name of names) {
      const archive = await readTrajectoryArchive(path.join(directory, name));
      if (archive?.version !== 1
        || archive.role !== role
        || archive.engineFingerprint !== descriptor.engineFingerprint
        || archive.learningTargetVersion !== descriptor.learningTargetVersion
        || (descriptor.lineageKey
          && archive.lineageKey !== descriptor.lineageKey)
        || JSON.stringify(archive.trainingDeckIds || []) !== JSON.stringify(descriptor.trainingDeckIds || [])
        || !Array.isArray(archive.trajectories)) continue;
      archives.push(archive);
    }
  } catch {
    // The first collection creates the directory and archive above. An empty
    // independent partition is allowed to remain safely ineligible.
  }
  const grouped = [];
  for (const archive of archives) {
    const games = new Map();
    archive.trajectories.forEach((trajectory, index) => {
      const sourceGameId = trajectory.gameId || `trajectory-${index}`;
      const auditGameId = `audit:${archive.collectionKey}:${sourceGameId}`;
      if (!games.has(auditGameId)) games.set(auditGameId, []);
      games.get(auditGameId).push({ ...trajectory, gameId: auditGameId });
    });
    grouped.push(...games.entries());
  }
  grouped.sort(([left], [right]) => left.localeCompare(right));
  const selected = options.selectionPolicy === "reference-priority-balanced-v1"
    ? selectEvaluatorCertificationGames(grouped, {
      maximumGames,
      deckIds: options.deckIds || descriptor.trainingDeckIds
    })
    : grouped.slice(Math.max(0, grouped.length - maximumGames));
  const selectedCollectionKeys = [...new Set(selected.map(([gameId]) => gameId.split(":")[1]))];
  const selectedTrajectories = selected.flatMap(([, items]) => items);
  return {
    trajectories: selectedTrajectories,
    manifest: {
      version: 2,
      role,
      namespace,
      engineFingerprint: descriptor.engineFingerprint,
      learningTargetVersion: descriptor.learningTargetVersion,
      lineageKey: descriptor.lineageKey || null,
      games: selected.length,
      trajectories: selected.reduce((sum, [, items]) => sum + items.length, 0),
      collectionKeys: selectedCollectionKeys,
      maximumGames,
      selectionPolicy: options.selectionPolicy || "latest-game-id-v1",
      datasetFingerprint: deterministicValueDigest({
        gameIds: selected.map(([gameId]) => gameId),
        trajectoryDigests: selectedTrajectories.map(
          deterministicTrainingTrajectoryDigest
        )
      })
    }
  };
}

async function updateIndependentTrajectoryDatasetFromBootstrapRecords(
  root,
  descriptor,
  records,
  options = {}
) {
  const namespace = String(descriptor.namespace || "official")
    .replace(/[^a-z0-9_-]/gi, "_");
  const role = String(descriptor.role || "audit")
    .replace(/[^a-z0-9_-]/gi, "_");
  const directory = path.join(
    root,
    "independent-holdouts",
    role,
    namespace,
    descriptor.collectionKey
  );
  await mkdir(directory, { recursive: true });
  const maximumGames = Math.max(100, Number(options.maximumGames) || 1000);
  const evidenceRequirement = options.evidenceRequirement || null;
  const selectedRecords = options.selectionPolicy
      === "reference-priority-balanced-v2"
    ? selectBalancedEvaluatorBootstrapRecords(records, {
      maximumRecords: maximumGames,
      evidenceRequirement: options.evidenceRequirement || null,
      deckIds: options.deckIds || descriptor.trainingDeckIds,
      seed: `${descriptor.collectionKey}:balanced-action-records-v1`
    })
    : [...(records || [])]
      .sort((left, right) =>
        Number(left.workerIndex) - Number(right.workerIndex)
        || Number(left.gameIndex) - Number(right.gameIndex))
      .slice(0, maximumGames);
  const manifestPath = path.join(directory, "manifest.json");
  const sourceRecordEntries = selectedRecords.map((record) => {
    let archive = null;
    try {
      const stats = statSync(record.archivePath);
      archive = {
        bytes: stats.size,
        modifiedMs: Math.floor(stats.mtimeMs)
      };
    } catch {}
    return {
      workerIndex: Number(record.workerIndex),
      gameIndex: Number(record.gameIndex),
      file: path.basename(record.archivePath || ""),
      archive,
      resultIndex: record.resultIndex || null
    };
  });
  const sourceRecordsFingerprint = deterministicValueDigest({
    version: 1,
    records: sourceRecordEntries
  });
  const existingManifest = await readCheckpoint(manifestPath);
  const expectedRecordIdentities = sourceRecordEntries.map((entry) =>
    `${entry.workerIndex}:${entry.gameIndex}`
  );
  const existingRecordIdentities = (existingManifest?.entries || []).map(
    (entry) => `${Number(entry.workerIndex)}:${Number(entry.gameIndex)}`
  );
  const commonManifestMatches = existingManifest?.version >= 3
    && existingManifest.role === role
    && existingManifest.namespace === namespace
    && existingManifest.engineFingerprint === descriptor.engineFingerprint
    && existingManifest.learningTargetVersion
      === descriptor.learningTargetVersion
    && existingManifest.lineageKey === (descriptor.lineageKey || null)
    && existingManifest.maximumGames === maximumGames
    && existingManifest.selectionPolicy
      === (options.selectionPolicy || "bootstrap-record-stream-v1")
    && JSON.stringify(existingRecordIdentities)
      === JSON.stringify(expectedRecordIdentities)
    && (existingManifest.entries || []).every((entry) =>
      entry.file && existsSync(path.join(directory, entry.file))
    );
  const exactSourceMatches = existingManifest?.sourceRecordsFingerprint
    ? existingManifest.sourceRecordsFingerprint === sourceRecordsFingerprint
    : commonManifestMatches;
  if (commonManifestMatches && exactSourceMatches) {
    const reusableManifest = {
      ...existingManifest,
      version: Math.max(4, Number(existingManifest.version) || 0),
      sourceRecordCount: selectedRecords.length,
      sourceRecordsFingerprint,
      materializationReuseContract:
        "immutable-bootstrap-record-selection-v1"
    };
    if (existingManifest.version !== reusableManifest.version
      || existingManifest.sourceRecordsFingerprint
        !== sourceRecordsFingerprint) {
      await writeCheckpoint(manifestPath, reusableManifest);
    }
    return {
      trajectories: null,
      archiveDirectory: directory,
      manifest: reusableManifest,
      reusedMaterialization: true
    };
  }
  const entries = [];
  const trajectoryDigests = [];
  const gameIds = [];
  let streamedRecords = 0;

  for await (const record of iterateEvaluatorBootstrapRecords(
    selectedRecords
  )) {
    const trajectories = (record.result?.trajectories || []).map(
      (trajectory, index) => {
        const sourceGameId =
          trajectory.gameId
          || `${record.workerIndex}:${record.gameIndex}:${index}`;
        const auditGameId =
          `audit:${descriptor.collectionKey}:${sourceGameId}`;
        return { ...trajectory, gameId: auditGameId };
      }
    );
    if (!trajectories.length) continue;
    const identity =
      `worker-${String(record.workerIndex).padStart(3, "0")}`
      + `-game-${String(record.gameIndex).padStart(5, "0")}`;
    const filename = path.join(directory, `${identity}.json.gz`);
    await writeTrajectoryArchive(filename, {
      version: 2,
      role,
      collectionKey: descriptor.collectionKey,
      engineFingerprint: descriptor.engineFingerprint,
      learningTargetVersion: descriptor.learningTargetVersion,
      lineageKey: descriptor.lineageKey || null,
      trainingDeckIds: descriptor.trainingDeckIds,
      workerIndex: record.workerIndex,
      gameIndex: record.gameIndex,
      trajectories
    });
    const recordGameIds = [...new Set(
      trajectories.map((trajectory) => trajectory.gameId)
    )];
    const recordDigests = trajectories.map(
      deterministicTrainingTrajectoryDigest
    );
    gameIds.push(...recordGameIds);
    trajectoryDigests.push(...recordDigests);
    entries.push({
      file: path.basename(filename),
      workerIndex: record.workerIndex,
      gameIndex: record.gameIndex,
      games: recordGameIds.length,
      trajectories: trajectories.length,
      trajectoryDigests: recordDigests
    });
    streamedRecords += 1;
    // Bootstrap archives can contain very large structured states.  The
    // compact selectedRecords already contain the result indexes needed for
    // the coverage audit, so do not retain each inflated archive until the
    // whole partition finishes.  Yield periodically so external ArrayBuffers
    // from completed records can be reclaimed while streaming continues.
    if (streamedRecords % 32 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
      if (typeof globalThis.gc === "function") globalThis.gc();
    }
  }

  const evidenceAudit = evidenceRequirement
    ? summarizeEvaluatorBootstrap(
      { records: selectedRecords },
      {
        ...evidenceRequirement,
        deckIds: options.deckIds || descriptor.trainingDeckIds,
        includeCertificationPartitions: false,
        minimumGamesFloor: 0,
        minimumReferenceFloor: 0,
        minimumReferenceGamesFloor: 0,
        minimumCalibrationFloor: 0,
        minimumRepresentativeCalibrationGames: 0
      }
    )
    : null;
  if (evidenceRequirement && evidenceAudit?.complete !== true) {
    throw new Error(
      `Materialized evaluator evidence coverage failed for ${role}: `
      + JSON.stringify({
        actionReferences: evidenceAudit?.actionReferenceCount || 0,
        actionReferenceGames: evidenceAudit?.actionReferenceGameCount || 0,
        leafValuePairs: evidenceAudit?.leafValuePairCount || 0,
        leafValueReferenceGames:
          evidenceAudit?.leafValueReferenceGameCount || 0,
        missingActionDeckSeats:
          evidenceAudit?.missingActionReferenceCoverage || [],
        missingLeafDeckSeats: evidenceAudit?.missingLeafValueCoverage || [],
        missingActionPhases:
          evidenceAudit?.missingActionReferencePhaseCoverage || [],
        missingLeafPhases:
          evidenceAudit?.missingLeafValuePhaseCoverage || [],
        missingActionClasses:
          evidenceAudit?.missingActionReferenceActionClassCoverage || [],
        missingActionDeckPhases:
          evidenceAudit?.missingActionReferenceDeckPhaseCoverage || [],
        missingLeafDeckPhases:
          evidenceAudit?.missingLeafValueDeckPhaseCoverage || []
      })
    );
  }

  const manifest = {
    version: 4,
    role,
    namespace,
    engineFingerprint: descriptor.engineFingerprint,
    learningTargetVersion: descriptor.learningTargetVersion,
    lineageKey: descriptor.lineageKey || null,
    games: new Set(gameIds).size,
    trajectories: trajectoryDigests.length,
    collectionKeys: [descriptor.collectionKey],
    maximumGames,
    selectionPolicy:
      options.selectionPolicy || "bootstrap-record-stream-v1",
    evidenceRequirement,
    evidenceAudit,
    storage: "record-archive-stream-v1",
    sourceRecordCount: selectedRecords.length,
    sourceRecordsFingerprint,
    materializationReuseContract:
      "immutable-bootstrap-record-selection-v1",
    entries,
    datasetFingerprint: deterministicValueDigest({
      gameIds,
      trajectoryDigests
    })
  };
  await writeCheckpoint(manifestPath, manifest);
  return {
    trajectories: null,
    archiveDirectory: directory,
    manifest
  };
}

async function* iterateIndependentTrajectoryDataset(dataset, options = {}) {
  if (Array.isArray(dataset?.trajectories)) {
    yield dataset.trajectories;
    return;
  }
  const entries = [...(dataset?.manifest?.entries || [])];
  if (options.orderSeed != null) {
    entries.sort((left, right) => deterministicValueDigest({
      seed: options.orderSeed,
      file: left.file
    }).localeCompare(deterministicValueDigest({
      seed: options.orderSeed,
      file: right.file
    })) || String(left.file).localeCompare(String(right.file)));
  }
  for (const entry of entries) {
    const archive = await readTrajectoryArchive(
      path.join(dataset.archiveDirectory, entry.file)
    );
    if (archive?.version !== 2
      || archive.role !== dataset.manifest.role
      || archive.engineFingerprint !== dataset.manifest.engineFingerprint
      || archive.learningTargetVersion
        !== dataset.manifest.learningTargetVersion
      || archive.lineageKey !== dataset.manifest.lineageKey
      || !Array.isArray(archive.trajectories)) {
      throw new Error(
        `Invalid streamed independent dataset record: ${entry.file}`
      );
    }
    try {
      yield archive.trajectories;
    } finally {
      archive.trajectories.length = 0;
    }
  }
}

async function collectPolicyConditionedActionCorrections(dataset, options = {}) {
  if (!dataset?.manifest || !(Number(dataset.manifest.games) > 0)) return [];
  const selectionState = {
    total: 0,
    byPhase: new Map(),
    byDeckSeat: new Map()
  };
  const corrections = [];
  for await (const trajectories of iterateIndependentTrajectoryDataset(dataset)) {
    assertTrainingTrajectories(trajectories, options.engineFingerprint);
    corrections.push(...policyConditionedActionCorrectionTrajectories(
      trajectories,
      {
        enabled: true,
        role: "training",
        continuationLineage: options.continuationLineage,
        datasetContinuationPolicyHash:
          options.continuationLineage?.continuationPolicyHash,
        currentPolicyHash: options.currentPolicyHash,
        currentPolicyArtifactHash: options.currentPolicyArtifactHash,
        maximumCorrections: options.maximumCorrections,
        selectionState
      }
    ));
    if (selectionState.total >= options.maximumCorrections) break;
  }
  return corrections;
}

async function splitEvaluatorTrainingDevelopmentDataset(dataset, options = {}) {
  const entries = dataset?.manifest?.entries || [];
  if (!dataset?.archiveDirectory || !entries.length) {
    return {
      version: 1,
      training: {
        trajectories: [],
        manifest: evaluatorDatasetViewManifest(
          dataset,
          "evaluator-train",
          [],
          options.seed
        )
      },
      development: dataset,
      overlapGames: 0
    };
  }
  const units = [];
  for (const entry of entries) {
    const archive = await readTrajectoryArchive(
      path.join(dataset.archiveDirectory, entry.file)
    );
    const trajectories = Array.isArray(archive?.trajectories)
      ? archive.trajectories
      : [];
    const evidence = summarizeEvaluatorTrainingEvidence(trajectories);
    if (evidence.actionReferences <= 0 && evidence.leafPairs <= 0) continue;
    units.push({
      entry,
      evidence,
      order: deterministicValueDigest({ seed: options.seed, file: entry.file })
    });
    archive.trajectories.length = 0;
  }
  units.sort((left, right) =>
    left.order.localeCompare(right.order)
      || left.entry.file.localeCompare(right.entry.file));
  const development = new Set();
  const selectUntil = (target, valueForUnit, selectedValue) => {
    while (selectedValue() < target) {
      const candidate = units
        .filter((unit) => !development.has(unit.entry.file))
        .sort((left, right) =>
          valueForUnit(right) - valueForUnit(left)
            || left.order.localeCompare(right.order))[0];
      if (!candidate || valueForUnit(candidate) <= 0) break;
      development.add(candidate.entry.file);
    }
  };
  const selectedUnits = () => units.filter((unit) =>
    development.has(unit.entry.file));
  for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
    selectUntil(
      Math.max(1, Number(options.minimumActionReferencesPerPhase) || 5),
      (unit) => Number(unit.evidence.actionPhases[phase]) || 0,
      () => selectedUnits().reduce((sum, unit) =>
        sum + (Number(unit.evidence.actionPhases[phase]) || 0), 0)
    );
    selectUntil(
      Math.max(1, Number(options.minimumLeafPairsPerPhase) || 12),
      (unit) => Number(unit.evidence.leafPhases[phase]) || 0,
      () => selectedUnits().reduce((sum, unit) =>
        sum + (Number(unit.evidence.leafPhases[phase]) || 0), 0)
    );
    selectUntil(
      Math.max(1, Number(options.minimumLeafGamesPerPhase) || 4),
      (unit) => unit.evidence.leafPhases[phase] > 0 ? 1 : 0,
      () => selectedUnits().filter((unit) =>
        unit.evidence.leafPhases[phase] > 0).length
    );
    selectUntil(
      Math.max(1, Number(options.minimumActionGamesPerPhase) || 5),
      (unit) => unit.evidence.actionPhases[phase] > 0 ? 1 : 0,
      () => selectedUnits().filter((unit) =>
        unit.evidence.actionPhases[phase] > 0).length
    );
  }
  for (const actionClass of EVALUATOR_AUDIT_CORE_ACTION_CLASSES) {
    selectUntil(
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .actionReferencesPerCoreClass,
      (unit) => Number(unit.evidence.actionClasses[actionClass]) || 0,
      () => selectedUnits().reduce((sum, unit) => sum
        + (Number(unit.evidence.actionClasses[actionClass]) || 0), 0)
    );
    selectUntil(
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .actionReferenceGamesPerCoreClass,
      (unit) => unit.evidence.actionClasses[actionClass] > 0 ? 1 : 0,
      () => selectedUnits().filter((unit) =>
        unit.evidence.actionClasses[actionClass] > 0).length
    );
  }
  const deckSeatKeys = new Set(units.flatMap((unit) => [
    ...unit.evidence.actionDeckSeats,
    ...unit.evidence.leafDeckSeats
  ]));
  for (const key of deckSeatKeys) {
    selectUntil(
      1,
      (unit) => unit.evidence.actionDeckSeats.includes(key) ? 1 : 0,
      () => selectedUnits().some((unit) =>
        unit.evidence.actionDeckSeats.includes(key)) ? 1 : 0
    );
    selectUntil(
      1,
      (unit) => unit.evidence.leafDeckSeats.includes(key) ? 1 : 0,
      () => selectedUnits().some((unit) =>
        unit.evidence.leafDeckSeats.includes(key)) ? 1 : 0
    );
  }
  const evidenceDeckIds = [...new Set([...deckSeatKeys].map((key) =>
    String(key).replace(/:(?:p1|p2)$/, "")))];
  const requiredDeckPhases = evidenceDeckIds
    .flatMap((deckId) =>
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS.requiredDeckPhases
        .map((phase) => `${deckId}::${phase}`));
  for (const key of requiredDeckPhases) {
    selectUntil(
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .actionReferencesPerDeckPhase,
      (unit) => Number(unit.evidence.actionDeckPhases[key]) || 0,
      () => selectedUnits().reduce((sum, unit) => sum
        + (Number(unit.evidence.actionDeckPhases[key]) || 0), 0)
    );
    selectUntil(
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .actionReferenceGamesPerDeckPhase,
      (unit) => unit.evidence.actionDeckPhases[key] > 0 ? 1 : 0,
      () => selectedUnits().filter((unit) =>
        unit.evidence.actionDeckPhases[key] > 0).length
    );
    selectUntil(
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .leafValuePairsPerDeckPhase,
      (unit) => Number(unit.evidence.leafDeckPhases[key]) || 0,
      () => selectedUnits().reduce((sum, unit) => sum
        + (Number(unit.evidence.leafDeckPhases[key]) || 0), 0)
    );
    selectUntil(
      EVALUATOR_BOOTSTRAP_CROSS_STRATUM_REQUIREMENTS
        .leafValueReferenceGamesPerDeckPhase,
      (unit) => unit.evidence.leafDeckPhases[key] > 0 ? 1 : 0,
      () => selectedUnits().filter((unit) =>
        unit.evidence.leafDeckPhases[key] > 0).length
    );
  }
  selectUntil(
    Math.max(1, Number(options.minimumDevelopmentActionReferences) || 50),
    (unit) => unit.evidence.actionReferences,
    () => selectedUnits().reduce((sum, unit) =>
      sum + unit.evidence.actionReferences, 0)
  );
  selectUntil(
    Math.max(1, Number(options.minimumDevelopmentActionReferenceGames) || 20),
    (unit) => unit.evidence.actionReferences > 0 ? 1 : 0,
    () => selectedUnits().filter((unit) =>
      unit.evidence.actionReferences > 0).length
  );
  selectUntil(
    Math.max(1, Number(options.minimumDevelopmentLeafPairs) || 50),
    (unit) => unit.evidence.leafPairs,
    () => selectedUnits().reduce((sum, unit) =>
      sum + unit.evidence.leafPairs, 0)
  );
  selectUntil(
    Math.max(1, Number(options.minimumDevelopmentLeafGames) || 20),
    (unit) => unit.evidence.leafPairs > 0 ? 1 : 0,
    () => selectedUnits().filter((unit) =>
      unit.evidence.leafPairs > 0).length
  );
  const developmentEntries = entries.filter((entry) =>
    development.has(entry.file));
  const trainingEntries = entries.filter((entry) =>
    units.some((unit) => unit.entry.file === entry.file)
      && !development.has(entry.file));
  const developmentFiles = new Set(
    developmentEntries.map((entry) => entry.file)
  );
  const overlapGames = trainingEntries.reduce((sum, entry) => sum
    + (developmentFiles.has(entry.file) ? Number(entry.games) || 0 : 0), 0);
  if (overlapGames > 0) {
    throw new Error(
      `Evaluator train/development split overlaps by ${overlapGames} games.`
    );
  }
  const trainingManifest = evaluatorDatasetViewManifest(
    dataset,
    "evaluator-train",
    trainingEntries,
    options.seed
  );
  const developmentManifest = evaluatorDatasetViewManifest(
    dataset,
    "evaluator-development",
    developmentEntries,
    options.seed
  );
  return {
    version: 1,
    contract: "game-disjoint-evaluator-train-development-v1",
    training: {
      trajectories: null,
      archiveDirectory: dataset.archiveDirectory,
      manifest: trainingManifest
    },
    development: {
      trajectories: null,
      archiveDirectory: dataset.archiveDirectory,
      manifest: developmentManifest
    },
    overlapGames
  };
}

function evaluatorDatasetViewManifest(dataset, role, entries, seed) {
  return {
    ...(dataset?.manifest || {}),
    version: 4,
    // The underlying archives remain immutable and retain their original
    // storage role. `viewRole` describes how this disjoint subset is consumed.
    role: dataset?.manifest?.role || role,
    viewRole: role,
    sourceRole: dataset?.manifest?.role || null,
    splitContract: "game-disjoint-evaluator-train-development-v1",
    splitSeedFingerprint: deterministicValueDigest(String(seed || "")),
    games: entries.reduce((sum, entry) => sum + (Number(entry.games) || 0), 0),
    trajectories: entries.reduce(
      (sum, entry) => sum + (Number(entry.trajectories) || 0),
      0
    ),
    entries,
    excludedFrom: role === "evaluator-train"
      ? ["ppo", "policy-epoch-selection", "evaluator-confirmation", "evaluator-final-audit"]
      : ["ppo", "policy-epoch-selection", "evaluator-training", "evaluator-confirmation", "evaluator-final-audit"],
    usedFor: role === "evaluator-train"
      ? ["evaluator-ranking-value-training"]
      : ["evaluator-development-selection"],
    datasetFingerprint: deterministicValueDigest({
      source: dataset?.manifest?.datasetFingerprint || null,
      role,
      entries: entries.map((entry) => ({
        file: entry.file,
        trajectoryDigests: entry.trajectoryDigests
      }))
    })
  };
}

function summarizeEvaluatorTrainingEvidence(trajectories) {
  const result = {
    actionReferences: 0,
    leafPairs: 0,
    actionPhases: Object.fromEntries(
      EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [phase, 0])
    ),
    leafPhases: Object.fromEntries(
      EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [phase, 0])
    ),
    actionClasses: Object.fromEntries(
      EVALUATOR_AUDIT_CORE_ACTION_CLASSES.map(
        (actionClass) => [actionClass, 0]
      )
    ),
    actionDeckPhases: {},
    leafDeckPhases: {},
    actionDeckSeats: [],
    leafDeckSeats: []
  };
  const actionDeckSeats = new Set();
  const leafDeckSeats = new Set();
  for (const trajectory of trajectories || []) {
    const seat = trajectory.playerId === "p1" || trajectory.playerId === "p2"
      ? trajectory.playerId
      : Number(trajectory.playerSeat) === 0
        ? "p1"
        : Number(trajectory.playerSeat) === 1
          ? "p2"
          : "unknown";
    const deckSeat = `${trajectory.deckId || "unknown"}:${seat}`;
    for (const step of trajectory.steps || []) {
      const auditReference = step.actionRankingAuditReference;
      const validAudit = validActionRankingAuditReference(auditReference, {
        informationSetHash: step.informationSetHash,
        legalActionKeys: step.legalActionKeys
      });
      const actionReference = step.actionRankingReference;
      const validAction = validActionRankingReference(actionReference, {
        informationSetHash: step.informationSetHash,
        legalActionKeys: step.legalActionKeys
      });
      const stratum = normalizeEvaluatorAuditStratum({
        stored: auditReference?.auditStratum
          || step.leafValueAuditReference?.auditStratum,
        state: step.state,
        recommendedAction: auditReference?.correctActionKey
          || actionReference?.correctActionKey
          || step.recommendedActionKey,
        selectedAction: auditReference?.comparedActionKey
          || actionReference?.comparedActionKey
          || step.selectedActionKey,
        legalActions: step.legalActionKeys,
        deckId: trajectory.deckId,
        seat
      });
      if (validAudit) {
        result.actionReferences += 1;
        result.actionPhases[stratum.phaseBand] += 1;
        if (Object.hasOwn(result.actionClasses, stratum.actionClass)) {
          result.actionClasses[stratum.actionClass] += 1;
        }
        const deckPhase = `${trajectory.deckId || "unknown"}::${stratum.phaseBand}`;
        result.actionDeckPhases[deckPhase] =
          (result.actionDeckPhases[deckPhase] || 0) + 1;
        actionDeckSeats.add(deckSeat);
      }
      const leafReferences = [
        validIndependentLeafValueReference(step.leafValueAuditReference)
          ? step.leafValueAuditReference
          : null,
        validAction ? actionReference?.leafValueReference : null
      ].filter(validLeafValueReference);
      const leafPairs = leafReferences.reduce(
        (sum, reference) => sum + (reference.pairs?.length || 0),
        0
      );
      if (leafPairs > 0) {
        result.leafPairs += leafPairs;
        result.leafPhases[stratum.phaseBand] += leafPairs;
        const deckPhase = `${trajectory.deckId || "unknown"}::${stratum.phaseBand}`;
        result.leafDeckPhases[deckPhase] =
          (result.leafDeckPhases[deckPhase] || 0) + leafPairs;
        leafDeckSeats.add(deckSeat);
      }
    }
  }
  result.actionDeckSeats = [...actionDeckSeats];
  result.leafDeckSeats = [...leafDeckSeats];
  return result;
}

async function evaluateIndependentRankingAudits(
  model,
  dataset,
  options = {}
) {
  const actionAccumulator = createActionRankingAuditAccumulator();
  const leafAccumulator = createLeafValueRankingAuditAccumulator();
  const actionEvidenceFilter = options.requireFormalActionEvidence === true
    ? (reference) => assessActionEvidence(reference, {
      role: options.certificationRole || "final-audit"
    }).authorizedUses.formalActionCertification === true
    : options.actionEvidenceFilter;
  const totalEntries = Array.isArray(dataset?.trajectories)
    ? 1
    : Math.max(0, Number(dataset?.manifest?.entries?.length) || 0);
  const progressInterval = Math.max(1, Math.ceil(totalEntries / 10));
  let completedEntries = 0;
  for await (const trajectories of iterateIndependentTrajectoryDataset(
    dataset
  )) {
    assertTrainingTrajectories(trajectories, engineFingerprint);
    accumulateActionRankingAudit(
      model,
      trajectories,
      actionAccumulator,
      { ...options, actionEvidenceFilter }
    );
    accumulateLeafValueRankingAudit(
      model,
      trajectories,
      leafAccumulator,
      options
    );
    completedEntries += 1;
    if (completedEntries === totalEntries
      || completedEntries % progressInterval === 0) {
      await options.onProgress?.({
        completedEntries,
        totalEntries,
        actionDecisions: actionAccumulator.decisions,
        actionAccuracy: actionAccumulator.decisions > 0
          ? actionAccumulator.neuralCorrect / actionAccumulator.decisions
          : null,
        leafDecisions: leafAccumulator.decisions,
        leafAccuracy: leafAccumulator.decisions > 0
          ? leafAccumulator.correct / leafAccumulator.decisions
          : null,
        preliminary: true
      });
    }
  }
  const actionRanking = finalizeActionRankingAudit(actionAccumulator, options);
  const neuralAccuracyInterval = bootstrapStratifiedGameAccuracyInterval(
    [...actionAccumulator.byGame.values()]
      .filter((game) => Number(game.decisions) > 0)
      .map((game) => ({
        gameId: game.gameId,
        stratum: [...game.coverageKeys].sort().join("&") || "unknown",
        correct: game.neuralCorrect,
        decisions: game.decisions
      })),
    { samples: options.bootstrapSamples }
  );
  const leafValueRanking = finalizeLeafValueRankingAudit(
    leafAccumulator,
    options
  );
  const leafAccuracyInterval = bootstrapStratifiedGameAccuracyInterval(
    [...leafAccumulator.byGame.values()]
      .filter((game) => Number(game.decisions) > 0)
      .map((game) => ({
        gameId: game.gameId,
        stratum: [...game.coverageKeys].sort().join("&") || "unknown",
        correct: game.correct,
        decisions: game.decisions
      })),
    { samples: options.bootstrapSamples }
  );
  return {
    actionRanking: {
      ...actionRanking,
      neuralAccuracyLowerBound: neuralAccuracyInterval.lowerBound,
      neuralAccuracyUpperBound: neuralAccuracyInterval.upperBound,
      neuralAccuracyInterval
    },
    leafValueRanking: {
      ...leafValueRanking,
      accuracyLowerBound: leafAccuracyInterval.lowerBound,
      accuracyUpperBound: leafAccuracyInterval.upperBound,
      accuracyInterval: leafAccuracyInterval
    }
  };
}

async function evaluateEvaluatorEvidenceCalibration(
  model,
  fitDataset,
  testDataset,
  options = {}
) {
  const fit = await collectEvaluatorEvidenceCalibrationValues(
    model,
    fitDataset,
    options
  );
  const test = await collectEvaluatorEvidenceCalibrationValues(
    model,
    testDataset,
    options
  );
  return calibrateValueSamples(fit.values, {
    testSamples: test.values,
    fitGames: fit.games,
    testGames: test.games
  });
}

async function evaluateFrozenEvaluatorEvidenceCalibration(
  model,
  dataset,
  options = {}
) {
  const test = await collectEvaluatorEvidenceCalibrationValues(
    model,
    dataset,
    options
  );
  return evaluateCalibratedValueSamples(
    test.values,
    model.calibration,
    {
      fitSamples: options.fitSamples,
      fitGames: options.fitGames,
      testGames: test.games
    }
  );
}

async function collectEvaluatorEvidenceCalibrationValues(
  model,
  dataset,
  options = {}
) {
  const values = [];
  const games = new Set();
  for await (const trajectories of iterateIndependentTrajectoryDataset(
    dataset
  )) {
    assertTrainingTrajectories(trajectories, options.engineFingerprint);
    const samples = evaluatorValueTrainingSamples(trajectories, options);
    for (const sample of samples) {
      // Calibration belongs to V(s), not to either conditional Q head. Mixing
      // action-Q targets here would fit the value sigmoid to another output
      // layer and silently distort the Policy-Value certificate.
      if ((sample.targetHead || EVALUATOR_TARGET_HEADS.stateValue)
        !== EVALUATOR_TARGET_HEADS.stateValue) continue;
      if (options.requireStructuredV2 === true
        && sample.structuredV2Eligible !== true) continue;
      for (const branch of ["preferred", "compared"]) {
        const target = sample[`${branch}Target`];
        if (!Number.isFinite(Number(target))) continue;
        const encodedState = sample[`${branch}State`];
        const structuredState = sample[`${branch}StructuredState`];
        const value = evaluatorRequiresStructuredV2(model)
          ? estimateEvidenceNeuralValue(
            model,
            encodedState,
            structuredState,
            {
              engineFingerprint: options.engineFingerprint,
              informationSetHash: sample.informationSetHash
            }
          )
          : estimateEncodedNeuralValue(model, encodedState);
        values.push({
          value,
          outcome: Number(target) > 0 ? 1 : 0,
          gameId: sample.gameId || null
        });
        if (sample.gameId) games.add(sample.gameId);
      }
    }
  }
  return { values, games: games.size };
}

async function evaluateValueCalibrationFromIndependentDataset(
  model,
  fitTrajectories,
  testDataset,
  options = {}
) {
  const fit = evaluateBehaviorCloning(model, fitTrajectories, {
    ...options,
    skipCalibration: true
  });
  const testSamples = [];
  const testGames = new Set();
  for await (const trajectories of iterateIndependentTrajectoryDataset(
    testDataset
  )) {
    assertTrainingTrajectories(trajectories, engineFingerprint);
    const evaluated = evaluateBehaviorCloning(model, trajectories, {
      ...options,
      skipCalibration: true
    });
    testSamples.push(...evaluated.valueSamples);
    for (const trajectory of trajectories) {
      if (trajectory.gameId) testGames.add(trajectory.gameId);
    }
  }
  return calibrateValueSamples(fit.valueSamples, {
    testSamples,
    fitGames: fit.games,
    testGames: testGames.size
  });
}

async function loadLatestEpochTrainingCheckpoint(directory, trainingKey) {
  try {
    const names = (await readdir(directory))
      .filter((name) => /^epoch-\d+\.json$/.test(name) || name === "final-selection.json")
      .sort()
      .reverse();
    for (const name of names) {
      const filename = path.join(directory, name);
      const checkpoint = await readCheckpoint(filename);
      if (checkpoint?.trainingKey !== trainingKey
        || checkpoint.accepted !== true
        || !checkpoint.candidateCheckpoint
        || !checkpoint.optimizerState
        || !checkpoint.selectionState) continue;
      return { ...checkpoint, path: filename };
    }
  } catch {
    return null;
  }
  return null;
}

async function loadLeague(directory, limit) {
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort().slice(-limit);
    const loaded = [];
    for (const name of names) {
      const checkpoint = await readCheckpoint(path.join(directory, name));
      if (checkpoint) loaded.push(deserializeNeuralModel(checkpoint));
    }
    return loaded;
  } catch { return []; }
}

async function loadRecentCandidateModels(root, expectedTrainingDeckIds, limit, excludedModel = null) {
  if (!limit) return [];
  try {
    const directory = path.join(root, "candidates");
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort().reverse();
    const loaded = [];
    for (const name of names) {
      const checkpoint = await readCheckpoint(path.join(directory, name));
      if (!checkpoint) continue;
      if (!officialCandidateCheckpointEligible(checkpoint)) continue;
      const ids = checkpoint.metadata?.trainingDeckIds;
      if (ids && JSON.stringify(ids) !== JSON.stringify(expectedTrainingDeckIds)) continue;
      const model = deserializeNeuralModel(checkpoint);
      if (excludedModel && neuralModelIdentity(model) === neuralModelIdentity(excludedModel)) continue;
      loaded.push(model);
      if (loaded.length >= limit) break;
    }
    return loaded;
  } catch { return []; }
}

async function loadHumanReplayData(directory, limit, engineFingerprint) {
  if (!limit) return [];
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort().slice(-limit);
    const replays = [];
    for (const name of names) {
      const replay = await readCheckpoint(path.join(directory, name));
      if (replay) replays.push(replay);
    }
    return hydrateHumanReplayTrajectories(replays, { engineFingerprint });
  } catch { return []; }
}

async function loadTrajectoryShards(directory, modelGeneration, poolId) {
  if (!directory) return [];
  const root = path.resolve(directory);
  const names = (await readdir(root)).filter((name) => name.endsWith(".json.gz")).sort();
  const shards = [];
  for (const name of names) {
    const shard = await readTrajectoryArchive(path.join(root, name));
    if (shard.modelGeneration !== modelGeneration || shard.cardPoolId !== poolId) continue;
    shards.push(shard);
  }
  return shards;
}

async function loadTurningPointReplayIndex(directory, expectedEngineFingerprint) {
  const manifest = await readCheckpoint(path.join(directory, "manifest.json"));
  if (manifest?.version !== 3 || manifest.learningTargetVersion !== NEURAL_LEARNING_TARGET_VERSION) return [];
  return (manifest.entries || []).filter((entry) => entry?.replayId && entry?.file).map((entry) => ({
    ...entry,
    sourceEngineFingerprint: manifest.engineFingerprint || expectedEngineFingerprint
  }));
}

async function loadTurningPointReplayTrajectories(directory, entries, expectedEngineFingerprint) {
  const trajectories = [];
  for (const entry of entries) {
    try {
      const archive = await readTrajectoryArchive(resolveReplayEntryPath(directory, entry.file));
      let trajectory = archive?.trajectory;
      if (trajectory?.engineFingerprint !== expectedEngineFingerprint) {
        trajectory = migrateCompatibleTrainingTrajectory(trajectory, expectedEngineFingerprint);
      }
      if (trajectory?.replayId === entry.replayId
        && trajectory.completed === true
        && trajectory.learningTargetVersion === NEURAL_LEARNING_TARGET_VERSION
        && trajectory.steps?.length) trajectories.push(trajectory);
    } catch {}
  }
  return trajectories;
}

async function updateTurningPointReplayBuffer(
  directory,
  existingEntries,
  freshTrajectories,
  limit,
  expectedEngineFingerprint,
  options = {}
) {
  await mkdir(directory, { recursive: true });
  const ordered = new Map();
  for (const entry of existingEntries) ordered.set(entry.replayId, entry);
  const freshById = new Map();
  for (const trajectory of freshTrajectories) {
    const file = `replay-${checkpointHash(trajectory.replayId)}.json.gz`;
    const entry = {
      replayId: trajectory.replayId,
      file,
      sourceCollectionKey: trajectory.sourceCollectionKey || null,
      sourceGameId: trajectory.sourceGameId || null,
      turningPoint: trajectory.turningPoint || null,
      learningTargetVersion: trajectory.learningTargetVersion || null,
      steps: trajectory.steps.length
    };
    ordered.delete(entry.replayId);
    ordered.set(entry.replayId, entry);
    freshById.set(entry.replayId, trajectory);
  }
  const retained = [...ordered.values()].slice(-Math.max(0, limit));
  const retainedIds = new Set(retained.map((entry) => entry.replayId));
  for (const entry of retained) {
    const trajectory = freshById.get(entry.replayId);
    if (trajectory) await writeTrajectoryArchive(resolveReplayEntryPath(directory, entry.file), { version: 1, trajectory });
  }
  await writeCheckpoint(path.join(directory, "manifest.json"), {
    version: 3,
    engineFingerprint: expectedEngineFingerprint,
    learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
    updatedAt: new Date().toISOString(),
    entries: retained
  });
  for (const entry of [...existingEntries, ...(options.purgeEntries || [])]) {
    if (retainedIds.has(entry.replayId)) continue;
    try { await unlink(resolveReplayEntryPath(directory, entry.file)); } catch {}
  }
  return retained;
}

function resolveReplayEntryPath(directory, filename) {
  const root = path.resolve(directory);
  const resolved = path.resolve(root, path.basename(filename));
  if (path.dirname(resolved) !== root) throw new Error("Turning-point replay path escaped its data directory.");
  return resolved;
}

async function inspectReusableGames(root, descriptor) {
  const completedIndexes = new Map();
  const storedIndexes = new Map();
  const workerCount = Math.max(1, Math.min(descriptor.workers || 1, descriptor.games));
  let incompleteGames = 0;
  let qualityCompletedGames = 0;
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const assignedGames = Math.floor(descriptor.games / workerCount) + (workerIndex < descriptor.games % workerCount ? 1 : 0);
    const completed = new Set();
    const stored = new Set();
    for (let gameIndex = 0; gameIndex < assignedGames; gameIndex += 1) {
      const manifestPath = path.join(root, "resume", `generation-${String(descriptor.generation).padStart(5, "0")}`, "games", `worker-${String(workerIndex).padStart(2, "0")}`, `game-${String(gameIndex).padStart(3, "0")}`, "manifest.json");
      const manifest = await readCheckpoint(manifestPath);
      if (manifest?.collectionKey !== descriptor.collectionKey || manifest.workerIndex !== workerIndex || manifest.gameIndex !== gameIndex) continue;
      stored.add(gameIndex);
      if (manifest.summaries?.length && manifest.summaries.every((summary) => summary.completed === true)) {
        completed.add(gameIndex);
        qualityCompletedGames += 1;
      } else incompleteGames += 1;
    }
    completedIndexes.set(workerIndex, completed);
    storedIndexes.set(workerIndex, stored);
  }
  const completionGatePassed = qualityCompletedGames >= Math.ceil(descriptor.games * 0.8);
  return {
    completedGameIndexes: completionGatePassed ? storedIndexes : completedIndexes,
    incompleteGames: completionGatePassed ? 0 : incompleteGames,
    acceptedIncompleteGames: completionGatePassed ? incompleteGames : 0,
    qualityCompletedGames
  };
}

function curriculumStage(generation, configuredMaxActions) {
  // Outcome learning and counterfactual teacher comparisons are authoritative.
  // Hand-written strategic shaping remains available for diagnostics only.
  if (generation <= 3) return { name: "bootstrap", maxActions: configuredMaxActions, temperature: 1, shapingWeight: 0 };
  if (generation <= 10) return { name: "guided", maxActions: configuredMaxActions, temperature: 0.85, shapingWeight: 0 };
  return { name: "competitive", maxActions: configuredMaxActions, temperature: 0.72, shapingWeight: 0 };
}

function mergeKnowledge(target, source, path = []) {
  for (const [key, value] of Object.entries(source || {})) {
    if (path[0] === "deckProfiles") {
      target[key] = structuredClone(value);
      continue;
    }
    if (typeof value === "number") target[key] = (target[key] || 0) + value;
    else if (value && typeof value === "object" && !Array.isArray(value)) mergeKnowledge(target[key] ||= {}, value, [...path, key]);
    else if (target[key] == null) target[key] = structuredClone(value);
  }
}

function normalizeKnowledge(knowledge) {
  for (const stat of Object.values(knowledge.archetypeStats || {})) {
    stat.unitRatio = stat.cardTotal ? stat.unitTotal / stat.cardTotal : 0;
    stat.spellRatio = stat.cardTotal ? stat.spellTotal / stat.cardTotal : 0;
    stat.gearRatio = stat.cardTotal ? stat.gearTotal / stat.cardTotal : 0;
    stat.averageEnergy = stat.cardTotal ? stat.energyTotal / stat.cardTotal : 0;
  }
}

function createTrainingProgressReporter(root, generation, trainingIteration) {
  const progressRoot = path.join(root, "progress");
  mkdirSync(progressRoot, { recursive: true });
  const runId = `iteration-${String(trainingIteration).padStart(5, "0")}-generation-${String(generation).padStart(5, "0")}-${Date.now()}`;
  const latestPath = path.join(progressRoot, "latest.json");
  const eventLogPath = path.join(progressRoot, `${runId}.jsonl`);
  const maximumEventLogBytes = 16 * 1024 * 1024;
  const retainedEventLogSegments = 4;
  let sequence = 0;
  let eventLogSegment = 0;
  let eventLogBytes = existsSync(eventLogPath)
    ? statSync(eventLogPath).size
    : 0;
  let persistentFields = {};
  return {
    latestPath,
    eventLogPath,
    setPersistentFields(fields = {}) {
      persistentFields = {
        ...persistentFields,
        ...structuredClone(fields)
      };
    },
    write(event) {
      const entry = {
        version: 1,
        runId,
        sequence: ++sequence,
        generation,
        trainingIteration,
        ...persistentFields,
        ...event,
        eventLogPath,
        updatedAt: new Date().toISOString()
      };
      const eventLogLine = `${JSON.stringify(compactProgressLogEntry(entry))}\n`;
      const eventLogLineBytes = Buffer.byteLength(eventLogLine, "utf8");
      if (eventLogBytes > 0
        && eventLogBytes + eventLogLineBytes > maximumEventLogBytes) {
        eventLogSegment += 1;
        const archivePath = `${eventLogPath}.part-${String(eventLogSegment).padStart(3, "0")}`;
        renameWithRetrySync(eventLogPath, archivePath);
        eventLogBytes = 0;
        const expiredSegment = eventLogSegment - retainedEventLogSegments;
        if (expiredSegment > 0) {
          try {
            unlinkSync(`${eventLogPath}.part-${String(expiredSegment).padStart(3, "0")}`);
          } catch {}
        }
      }
      try {
        appendFileWithRetrySync(eventLogPath, eventLogLine, {
          encoding: "utf8"
        });
        eventLogBytes += eventLogLineBytes;
      } catch (error) {
        if (!isRetryableFileReplaceError(error)) throw error;
        // Progress history is diagnostic-only. Windows scanners, backup tools,
        // or a live progress viewer can briefly deny write sharing; losing one
        // redundant event is safer than terminating a multi-hour audit. The
        // authoritative latest snapshot is still updated below.
        console.warn(
          "[training-progress] event log append skipped after Windows "
          + `file-lock retries: ${error.message}`
        );
      }
      const temporary = `${latestPath}.tmp-${process.pid}-${sequence}`;
      writeFileSync(temporary, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
      try {
        renameWithRetrySync(temporary, latestPath);
      } catch (error) {
        try { unlinkSync(temporary); } catch {}
        if (!isRetryableFileReplaceError(error)) throw error;
        console.warn(`[training-progress] latest snapshot update skipped after Windows file-lock retries: ${error.message}`);
      }
    }
  };
}

function compactProgressLogEntry(entry) {
  const omit = new Set([
    "gameKeys",
    "checkpoint",
    "candidateCheckpoint",
    "weights",
    "optimizerState"
  ]);
  const compact = (value, key = "", depth = 0) => {
    if (omit.has(key)) return { omitted: true };
    if (value == null || typeof value !== "object") return value;
    if (depth >= 10) return { omitted: true, reason: "maximum-depth" };
    if (ArrayBuffer.isView(value)) return {
      omittedNumericValues: value.length
    };
    if (Array.isArray(value)) {
      if (value.length > 128) return {
        omittedItems: value.length,
        sample: value.slice(0, 8).map((item) => compact(item, "", depth + 1))
      };
      return value.map((item) => compact(item, "", depth + 1));
    }
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      compact(child, childKey, depth + 1)
    ]));
  };
  return compact(entry);
}

function numericMetrics(metrics) {
  return Object.fromEntries(Object.entries(metrics || {}).filter(([, value]) => typeof value === "number" && Number.isFinite(value)));
}

function countBy(items, keyForItem) {
  const counts = {};
  for (const item of items || []) {
    const key = keyForItem(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function trajectorySequenceManifest(trajectories) {
  const entries = (trajectories || []).map((trajectory, order) => ({
    order,
    gameId: trajectory.gameId || null,
    replayId: trajectory.replayId || null,
    sourceCollectionKey: trajectory.sourceCollectionKey || null,
    sourceGameId: trajectory.sourceGameId || null,
    playerId: trajectory.playerId || null,
    deckId: trajectory.deckId || null,
    condition: trajectory.condition || null,
    steps: trajectory.steps?.length || 0,
    contentDigest: deterministicTrainingTrajectoryDigest(trajectory)
  }));
  return {
    version: 2,
    digestVersion: TRAINING_INPUT_DIGEST_VERSION,
    digestAlgorithm: "sha256-canonical-binary-valid-action-prefix-v1",
    count: entries.length,
    entries,
    fingerprint: deterministicValueDigest(entries)
  };
}

function independentDatasetInputManifest(dataset) {
  return {
    dataset: dataset?.manifest || null,
    trajectories: Array.isArray(dataset?.trajectories)
      ? trajectorySequenceManifest(dataset.trajectories)
      : {
        version: 2,
        storage: dataset?.manifest?.storage || null,
        trajectories: Number(dataset?.manifest?.trajectories) || 0,
        trajectoryDigests: (dataset?.manifest?.entries || [])
          .flatMap((entry) => entry.trajectoryDigests || [])
      }
  };
}

function createPpoBatchOrderManifest(trajectories, options = {}) {
  const sequenceLength = Math.max(1, Number(options.sequenceLength) || MAX_SEQUENCE);
  const chunks = [];
  for (const trajectory of trajectories || []) {
    for (let start = 0; start < (trajectory.steps || []).length; start += sequenceLength) {
      chunks.push({
        ...trajectory,
        chunkOrderId: [
          trajectory.gameId || "unknown-game",
          trajectory.playerId || "unknown-player",
          start
        ].join(":"),
        steps: trajectory.steps.slice(start, start + sequenceLength)
      });
    }
  }
  const random = seededRandom(1);
  if (options.randomState != null) random.setState?.(options.randomState);
  const epochs = [];
  for (let epoch = 1; epoch <= Math.max(1, Number(options.epochs) || 1); epoch += 1) {
    const ordered = stratifiedChunkOrder([...chunks], random);
    const order = ordered.map((chunk) => chunk.chunkOrderId);
    const batchSize = Math.max(1, Number(options.batchSize) || 1);
    epochs.push({
      epoch,
      chunks: order,
      batches: Array.from(
        { length: Math.ceil(order.length / batchSize) },
        (_, index) => order.slice(index * batchSize, (index + 1) * batchSize)
      )
    });
  }
  return {
    version: 1,
    policy: "stratified-chunk-order",
    randomInitialState: options.randomState ?? null,
    sequenceLength,
    batchSize: Math.max(1, Number(options.batchSize) || 1),
    epochs,
    fingerprint: checkpointHash(epochs)
  };
}

async function materializeEvaluatorEarlyDiagnosticDatasets(options) {
  const partitions = partitionEvaluatorBootstrapRecords(
    options.bootstrap.records,
    {
      deckIds: options.trainingDeckIds,
      seed: `bootstrap-${options.bootstrap.datasetKey}`,
      minimumRepresentativeCalibrationGames: 0
    }
  );
  const split = splitEvaluatorEarlyDiagnosticRecords(
    partitions[EVALUATOR_TRAINING_PARTITION],
    {
      seed: `${options.bootstrap.datasetKey}:fixed-training-validation-v3`,
      validationFraction: Number(options.validationFraction) || 0.2,
      previousSplit: options.previousSplit || null,
      requireStructuredV2: options.requireStructuredV2 === true
    }
  );
  if (split.training.length === 0 || split.validation.length === 0) {
    throw new Error(
      `evaluator-early-diagnostic-split-insufficient: ${JSON.stringify({
        checkpointId: options.checkpointId,
        trainingRecords: split.training.length,
        validationRecords: split.validation.length
      })}`
    );
  }
  const baseDescriptor = {
    namespace: options.heldoutNamespace,
    lineageKey: options.bootstrap.datasetKey,
    engineFingerprint: options.engineFingerprint,
    learningTargetVersion: options.learningTargetVersion,
    trainingDeckIds: options.trainingDeckIds
  };
  const materialize = async (role, records) => {
    const dataset = await updateIndependentTrajectoryDatasetFromBootstrapRecords(
      options.dataRoot,
      {
        ...baseDescriptor,
        role: `evaluator-early-${options.checkpointId}-${role}`,
        collectionKey:
          `bootstrap-early-${options.checkpointId}-${role}`
          + `-${options.bootstrap.datasetKey}`
      },
      records,
      {
        maximumGames: options.maximumGames,
        selectionPolicy: "all-training-records-deterministic-v1",
        deckIds: options.trainingDeckIds
      }
    );
    // Training, validation and the fixed anchor are materialized serially.
    // Force the just-finished archive's transient buffers out before opening
    // the next partition so their memory peaks do not stack.
    await compactTrainingHeap();
    return dataset;
  };
  const training = await materialize("training", split.training);
  const validation = await materialize("validation", split.validation);
  const anchorValidation = await materialize(
    "validation-anchor",
    split.anchorValidation
  );
  const validationEvidence = summarizeEvaluatorEarlyDiagnosticEvidence(
    split.validation,
    {
      deckIds: options.trainingDeckIds,
      requireStructuredV2: options.requireStructuredV2,
      requireActionEvidence: options.requireActionEvidence !== false,
      requirement: evaluatorEarlyDiagnosticSplitEvidenceRequirement(
        options.collectionRequirement,
        {
          role: "validation",
          validationFraction: options.validationFraction,
          requireActionEvidence: options.requireActionEvidence !== false
        }
      )
    }
  );
  const trainingEvidence = summarizeEvaluatorEarlyDiagnosticEvidence(
    split.training,
    {
      deckIds: options.trainingDeckIds,
      requireStructuredV2: options.requireStructuredV2,
      requireActionEvidence: options.requireActionEvidence !== false,
      requirement: evaluatorEarlyDiagnosticSplitEvidenceRequirement(
        options.collectionRequirement,
        {
          role: "training",
          validationFraction: options.validationFraction,
          requireActionEvidence: options.requireActionEvidence !== false
        }
      )
    }
  );
  return {
    training,
    validation,
    anchorValidation,
    split: {
      version: 3,
      contract: "game-disjoint-fixed-anchor-training-only-adaptive-v3",
      validationFraction: Number(options.validationFraction) || 0.2,
      trainingRecords: split.training.length,
      validationRecords: split.validation.length,
      anchorValidationRecords: split.anchorValidation.length,
      overlap: 0,
      fixedAnchorReused: split.fixedAnchorReused,
      trainingRecordKeys: split.trainingRecordKeys,
      validationRecordKeys: split.validationRecordKeys,
      anchorValidationRecordKeys: split.anchorValidationRecordKeys,
      trainingEvidence,
      validationEvidence
    }
  };
}

async function runEvaluatorEarlyDiagnosticCheckpoint(options) {
  const datasets = await materializeEvaluatorEarlyDiagnosticDatasets({
    ...options,
    previousSplit: options.previousSplit
      || options.previousReport?.split
      || null
  });
  const trainingRequirement = options.trainingEvidenceRequirement || {};
  const requireStructuredV2 = options.requireStructuredV2 !== false;
  const trainingSplitSufficient =
    datasets.split.trainingEvidence.sufficient === true
    && datasets.split.trainingEvidence.eligibleActionReferences
      >= Number(trainingRequirement.minimumActionReferences || 0)
    && datasets.split.trainingEvidence.eligibleLeafValuePairs
      >= Number(trainingRequirement.minimumLeafValuePairs || 0)
    && (!requireStructuredV2
      || datasets.split.trainingEvidence.structuredV2ActionReferences
        >= Number(trainingRequirement.minimumStructuredV2ActionReferences || 0))
    && (!requireStructuredV2
      || datasets.split.trainingEvidence.structuredV2LeafValuePairs
        >= Number(trainingRequirement.minimumStructuredV2LeafValuePairs || 0));
  const gate = trainingSplitSufficient
    ? await trainEvaluatorDevelopmentStage({
    sourceModel: options.sourceModel,
    trainingDataset: datasets.training,
    developmentDataset: datasets.validation,
    comparisonDevelopmentDataset: options.previousReport
      ? datasets.anchorValidation
      : datasets.validation,
    calibrationFit: [],
    calibrationTest: [],
    calibrationBatchSize: options.calibrationBatchSize,
    replicas: options.replicas,
    epochs: options.epochs,
    trainingBatchSize: options.trainingBatchSize,
    learningRate: options.learningRate,
    dataRoot: options.dataRoot,
    bootstrapDatasetKey: options.bootstrap.datasetKey,
    engineFingerprint: options.engineFingerprint,
    runContract: options.runContract,
    progress: options.progress,
    purpose: `early-diagnostic-${options.checkpointId}`,
    seedNamespace:
      `evaluator-early-diagnostic:${options.bootstrap.datasetKey}:v4`,
    architectureSpecs: options.architectureSpecs,
    requireStructuredV2: options.requireStructuredV2,
    trainingEvidenceRequirement: options.trainingEvidenceRequirement,
    allowInsufficientTrainingEvidence: true,
    // Pilot status is never a pass or certification decision. These relaxed
    // values merely keep the candidate summaries comparable; only the
    // conservative failure-only rule below can stop collection.
    performanceRequirements: {
      requirePerformance: true,
      minimumActionAccuracy: 0.5,
      minimumLeafAccuracy: 0.5,
      minimumPhaseAccuracy: 0.45,
      minimumPhaseAccuracyLowerBound: 0.2
    }
  })
    : {
      version: 5,
      passed: false,
      selected: null,
      candidates: [],
      skipped: true,
      skipReason: "evaluator-early-training-split-evidence-insufficient",
      trainingEvidence: datasets.split.trainingEvidence,
      trainingEvidenceRequirement: trainingRequirement
    };
  const status = evaluatorEarlyDiagnosticStatus(gate.candidates, {
    checkpointId: options.checkpointId,
    checkpointOrdinal: options.checkpointOrdinal,
    diagnosticAttempt: Math.max(0, Number(options.diagnosticAttempt) || 0),
    previous: options.previousReport?.status || null,
    validationEvidenceSufficient:
      trainingSplitSufficient
      && datasets.split.validationEvidence.sufficient === true
  });
  const report = {
    version: 3,
    checkpointId: options.checkpointId,
    checkpointOrdinal: options.checkpointOrdinal,
    diagnosticAttempt: Math.max(0, Number(options.diagnosticAttempt) || 0),
    bootstrapDatasetKey: options.bootstrap.datasetKey,
    requirement: options.collectionRequirement || null,
    trainingEvidenceRequirement: options.trainingEvidenceRequirement,
    split: datasets.split,
    gate: evaluatorGateWithoutCheckpoint(gate),
    status,
    completedAt: new Date().toISOString()
  };
  const reportPath = path.join(
    options.dataRoot,
    "evaluator-bootstrap",
    options.bootstrap.datasetKey,
    "stage-gates",
    `early-diagnostic-${options.checkpointId}.json`
  );
  await writeCheckpoint(reportPath, report);
  options.progress.write({
    state: "training",
    stage: "evaluator-early-diagnostic-checkpoint",
    evaluatorBootstrapDatasetKey: options.bootstrap.datasetKey,
    evaluatorEarlyDiagnostic: {
      checkpointId: options.checkpointId,
      checkpointOrdinal: options.checkpointOrdinal,
      split: datasets.split,
      status
    }
  });
  return report;
}

async function evaluatorTrainingBalanceProfile(dataset, options = {}) {
  const cacheKey = checkpointHash({
    version: 1,
    contract: "evaluator-training-balance-profile-v1",
    datasetFingerprint: dataset?.manifest?.datasetFingerprint,
    engineFingerprint: options.engineFingerprint,
    structuredV2Only: options.structuredV2Only === true,
    datasetContinuationPolicyHash:
      options.datasetContinuationPolicyHash || null
  });
  if (evaluatorTrainingBalanceProfileCache.has(cacheKey)) {
    return evaluatorTrainingBalanceProfileCache.get(cacheKey);
  }
  const persistentCachePath = dataset?.archiveDirectory
    ? path.join(
      dataset.archiveDirectory,
      `training-balance-profile-${cacheKey}.json`
    )
    : null;
  if (persistentCachePath) {
    const persisted = await readCheckpoint(persistentCachePath);
    if (persisted?.fingerprint === cacheKey
      && persisted.contract
        === "phase-deck-seat-inverse-frequency-gradient-balance-v1") {
      evaluatorTrainingBalanceProfileCache.set(cacheKey, persisted);
      return persisted;
    }
  }
  const metadata = [];
  for await (const trajectories of iterateIndependentTrajectoryDataset(
    dataset,
    { orderSeed: `balance-profile:${cacheKey}` }
  )) {
    assertTrainingTrajectories(trajectories, options.engineFingerprint);
    const samples = evaluatorValueTrainingSamples(trajectories, options);
    metadata.push(...samples.map((sample) => ({
      targetHead: sample.targetHead,
      phaseBand: sample.phaseBand,
      deckSeat: sample.deckSeat,
      structuredV2Eligible: sample.structuredV2Eligible
    })));
  }
  const profile = {
    ...createEvaluatorTrainingBalanceProfile(metadata, {
      structuredV2Only: options.structuredV2Only === true
    }),
    fingerprint: cacheKey
  };
  evaluatorTrainingBalanceProfileCache.set(cacheKey, profile);
  if (persistentCachePath) {
    await writeCheckpoint(persistentCachePath, profile);
  }
  return profile;
}

async function trainPolicyQShadowConfigurationGrid(options) {
  const configurations = [...(options.configurations || [])];
  if (!configurations.length) return [];
  const results = new Array(configurations.length);
  const pending = [...configurations];
  const active = new Set();
  let completedConfigurations = 0;
  let failed = null;
  const maximumProcesses = Math.max(1, Math.min(
    configurations.length,
    Number(options.shared.candidateProcessesMaximum) || 1
  ));
  const reserveBytes = Math.max(
    2 * 1024 ** 3,
    Number(options.shared.candidateProcessReserveBytes) || 4 * 1024 ** 3
  );
  const estimatedBytes = Math.max(
    1024 ** 3,
    Number(options.shared.candidateProcessEstimatedBytes)
      || Math.floor(1.75 * 1024 ** 3)
  );
  const allowedProcesses = () => {
    const freeBytes = freemem();
    if (freeBytes < reserveBytes) {
      return Math.max(1, Math.min(
        maximumProcesses,
        active.size - 1
      ));
    }
    return Math.max(1, Math.min(
      maximumProcesses,
      active.size + Math.floor(
        (freeBytes - reserveBytes) / estimatedBytes
      )
    ));
  };
  const writeGridProgress = (configuration, payload = {}) => {
    const globalReadiness = options.readinessProgress(
      "configuration-grid",
      {
        completedConfigurations,
        currentConfiguration: configuration.ordinal,
        totalConfigurations: configurations.length,
        architecture: configuration.architecture.id,
        learningRate: configuration.learningRate,
        epochs: configuration.epochs,
        parallelConfigurationProcesses: active.size,
        parallelConfigurationProcessLimit: maximumProcesses,
        systemFreeMemoryBytes: freemem(),
        reserveBytes,
        estimatedCandidateBytes: estimatedBytes
      }
    ).policyQReadinessProgress;
    options.shared.progress.write({
      ...payload,
      policyQReadinessProgress: {
        ...(payload.policyQReadinessProgress || {}),
        ...globalReadiness
      }
    });
  };
  while ((pending.length || active.size) && !failed) {
    const allowed = allowedProcesses();
    while (pending.length && active.size < allowed && !failed) {
      const configuration = pending.shift();
      let entry;
      const progress = {
        write: (payload) => writeGridProgress(configuration, payload)
      };
      const promise = trainEvaluatorDevelopmentStage({
        ...options.shared,
        progress,
        purpose:
          `policy-q-shadow-grid-${configuration.configurationId}`,
        progressContext: options.readinessProgress(
          "configuration-grid",
          {
            completedConfigurations,
            currentConfiguration: configuration.ordinal,
            totalConfigurations: configurations.length,
            architecture: configuration.architecture.id,
            learningRate: configuration.learningRate,
            epochs: configuration.epochs,
            parallelConfigurationProcesses: active.size + 1,
            parallelConfigurationProcessLimit: maximumProcesses
          }
        ),
        architectureSpecs: [configuration.architecture],
        replicas: 1,
        epochs: configuration.epochs,
        learningRate: configuration.learningRate,
        performanceRequirements: options.performanceRequirements,
        forceCandidateProcess: maximumProcesses > 1
      }).then((gate) => {
        results[configuration.ordinal - 1] = {
          architecture: configuration.architecture,
          learningRate: configuration.learningRate,
          epochs: configuration.epochs,
          gate
        };
        completedConfigurations += 1;
        writeGridProgress(configuration, {
          state: "training",
          stage: "evaluator-policy-q-shadow-grid-configuration-complete",
          evaluatorTrainingPurpose:
            `policy-q-shadow-grid-${configuration.configurationId}`
        });
      }).catch((error) => {
        failed = error;
      }).finally(() => {
        active.delete(entry);
      });
      entry = { configuration, promise };
      active.add(entry);
      writeGridProgress(configuration, {
        state: "training",
        stage: "evaluator-policy-q-shadow-grid-configuration-start"
      });
    }
    if (active.size) {
      await Promise.race([
        ...[...active].map((entry) => entry.promise),
        new Promise((resolve) => setTimeout(resolve, 10000))
      ]);
    } else if (pending.length) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  if (failed) {
    await Promise.allSettled(
      [...active].map((entry) => entry.promise)
    );
    throw failed;
  }
  return results;
}

async function runPolicyQShadowReadinessStage(options) {
  const grid = POLICY_Q_SHADOW_READINESS_GRID;
  const gridHash = policyQShadowReadinessGridHash(grid);
  const readinessProgress = (phase, detail = {}) => ({
    policyQReadinessProgress: {
      version: 2,
      contract: POLICY_Q_SHADOW_READINESS_CONTRACT,
      gridHash,
      phase,
      protectedDevelopmentOpened: false,
      ...detail
    }
  });
  options.progress.write({
    state: "training",
    stage: "evaluator-policy-q-shadow-readiness",
    evaluatorBootstrapDatasetKey: options.bootstrap.datasetKey,
    ...readinessProgress("split-preparation", {
      validationFraction: grid.validationFraction
    })
  });
  const splitPath = path.join(
    options.dataRoot,
    "evaluator-bootstrap",
    options.bootstrap.datasetKey,
    "stage-gates",
    "policy-q-shadow-split-v1.json"
  );
  const previousSplitCheckpoint = await readCheckpoint(splitPath);
  const datasets = await materializeEvaluatorEarlyDiagnosticDatasets({
    ...options,
    checkpointId: "policy-q-readiness",
    validationFraction: grid.validationFraction,
    requireStructuredV2: true,
    requireActionEvidence: false,
    collectionRequirement: options.collectionRequirement,
    previousSplit: previousSplitCheckpoint?.split || null
  });
  await writeCheckpoint(splitPath, {
    version: 2,
    contract: POLICY_Q_SHADOW_READINESS_CONTRACT,
    gridHash,
    split: datasets.split,
    updatedAt: new Date().toISOString()
  });
  const splitSufficient =
    datasets.split.trainingEvidence.sufficient === true
    && datasets.split.validationEvidence.sufficient === true;
  if (!splitSufficient) {
    releaseTrajectoryDatasets(
      datasets.training,
      datasets.validation,
      datasets.anchorValidation
    );
    return {
      version: 2,
      contract: POLICY_Q_SHADOW_READINESS_CONTRACT,
      gridHash,
      passed: false,
      outcome: "inconclusive",
      structuralFailure: false,
      diagnosticInvalid: true,
      reasons: ["policy-q-shadow-split-evidence-insufficient"],
      split: datasets.split,
      diagnosticDemand: {
        version: 1,
        contract: "policy-q-shadow-targeted-training-demand-v1",
        role: EVALUATOR_TRAINING_PARTITION,
        priority: "warning-only",
        officialEvidenceRuleChanged: false,
        items: [{
          evidenceKind: "leaf",
          reason: "policy-q-shadow-split-evidence-insufficient"
        }]
      }
    };
  }
  const shared = {
    certificateKind: EVALUATOR_CERTIFICATE_KINDS.policyQ,
    sourceModel: options.sourceModel,
    trainingDataset: datasets.training,
    developmentDataset: datasets.validation,
    comparisonDevelopmentDataset: datasets.anchorValidation,
    calibrationFit: [],
    calibrationTest: [],
    calibrationBatchSize: options.calibrationBatchSize,
    trainingBatchSize: options.trainingBatchSize,
    candidateProcessesMaximum: options.candidateProcessesMaximum,
    candidateProcessReserveBytes: options.candidateProcessReserveBytes,
    candidateProcessEstimatedBytes: options.candidateProcessEstimatedBytes,
    trainingEvidenceRequirement: evaluatorEarlyDiagnosticTrainingRequirement(
      options.collectionRequirement,
      { minimumFraction: 0.6 }
    ),
    continuationLineage: options.continuationLineage,
    dataRoot: options.dataRoot,
    bootstrapDatasetKey: options.bootstrap.datasetKey,
    engineFingerprint: options.engineFingerprint,
    runContract: options.runContract,
    progress: options.progress,
    requireStructuredV2: true,
    allowInsufficientTrainingEvidence: true,
    balanceTrainingStrata: true,
    seedNamespace:
      `policy-q-shadow:${options.bootstrap.datasetKey}:` +
        POLICY_Q_SHADOW_MODEL_TRAINING_NAMESPACE_HASH
  };
  let screenGate;
  let gridResults = [];
  let finalGate = null;
  let selectedConfiguration = null;
  try {
    const screenOptions = {
      ...shared,
      purpose: "policy-q-shadow-architecture-screen-v1",
      progressContext: readinessProgress("architecture-screen", {
        completedConfigurations: 0,
        totalConfigurations:
          EVALUATOR_ARCHITECTURE_SPECS.length
            * grid.architectureScreen.replicas
      }),
      architectureSpecs: EVALUATOR_ARCHITECTURE_SPECS,
      replicas: grid.architectureScreen.replicas,
      epochs: grid.architectureScreen.epochs,
      learningRate: grid.architectureScreen.learningRate,
      performanceRequirements: {
        requirePerformance: false,
        confidenceBoundSource: "bootstrap-shadow"
      }
    };
    const legacyScreenGridHash = policyQShadowLegacyReadinessGridHash();
    const cachedLegacyScreenGate = await trainEvaluatorDevelopmentStage({
      ...screenOptions,
      seedNamespace:
        `policy-q-shadow:${options.bootstrap.datasetKey}:${legacyScreenGridHash}`,
      // Reconstruct the exact v1 screen gate key. Cache-only guarantees that
      // a missing legacy result never launches obsolete training.
      performanceRequirements: { requirePerformance: false },
      cacheOnly: true
    });
    if (cachedLegacyScreenGate) {
      screenGate = rescorePolicyQShadowScreenGate(cachedLegacyScreenGate);
      options.progress.write({
        state: "training",
        stage: "evaluator-development-gate-candidate-restored",
        ...readinessProgress("architecture-screen", {
          completedConfigurations:
            EVALUATOR_ARCHITECTURE_SPECS.length
              * grid.architectureScreen.replicas,
          totalConfigurations:
            EVALUATOR_ARCHITECTURE_SPECS.length
              * grid.architectureScreen.replicas,
          legacyScreenTrainingReused: true,
          rescoredUnderCurrentShadowContract: true
        }),
        evaluatorBootstrapDatasetKey: options.bootstrap.datasetKey
      });
    } else {
      screenGate = await trainEvaluatorDevelopmentStage(screenOptions);
    }
    const shortlisted = selectPolicyQShadowArchitectures(
      screenGate.candidates,
      EVALUATOR_ARCHITECTURE_SPECS,
      grid.architectureScreen.shortlist
    );
    if (!shortlisted.length) {
      return {
        version: 2,
        contract: POLICY_Q_SHADOW_READINESS_CONTRACT,
        gridHash,
        passed: false,
        outcome: "inconclusive",
        structuralFailure: false,
        diagnosticInvalid: true,
        reasons: ["policy-q-shadow-no-trainable-architecture"],
        split: datasets.split,
        screenGate: evaluatorGateWithoutCheckpoint(screenGate),
        diagnosticDemand: policyQShadowReadinessDemand(screenGate)
      };
    }
    const gridConfigurations = policyQShadowConfigurationGrid(
      shortlisted,
      grid
    );
    gridResults = await trainPolicyQShadowConfigurationGrid({
      shared,
      configurations: gridConfigurations,
      performanceRequirements: grid.performanceRequirements,
      readinessProgress
    });
    selectedConfiguration = selectPolicyQShadowConfiguration(gridResults);
    if (selectedConfiguration) {
      finalGate = await trainEvaluatorDevelopmentStage({
        ...shared,
        purpose: "policy-q-shadow-final-stability-v1",
        seedNamespace: [
          shared.seedNamespace,
          "final-stability",
          selectedConfiguration.architecture.id,
          selectedConfiguration.learningRate,
          selectedConfiguration.epochs
        ].join(":"),
        progressContext: readinessProgress("replica-stability", {
          completedConfigurations: 0,
          totalConfigurations: grid.finalReplicas,
          architecture: selectedConfiguration.architecture.id,
          learningRate: selectedConfiguration.learningRate,
          epochs: selectedConfiguration.epochs
        }),
        architectureSpecs: [selectedConfiguration.architecture],
        replicas: grid.finalReplicas,
        epochs: selectedConfiguration.epochs,
        learningRate: selectedConfiguration.learningRate,
        performanceRequirements: grid.performanceRequirements
      });
    }
    const diagnosticSource = finalGate || screenGate || {
      candidates: gridResults.flatMap((item) => item.gate?.candidates || [])
    };
    const classificationSource = finalGate || {
      ...screenGate,
      // The architecture screen deliberately disables performance checks;
      // its `passed` flag means only that training/evaluation completed.
      passed: false
    };
    const readinessClassification = classifyPolicyQShadowReadiness(
      classificationSource,
      {
        performanceRequirements: grid.performanceRequirements,
        minimumStructuralFailureReplicas:
          grid.minimumStructuralFailureReplicas
      }
    );
    const passed = finalGate?.passed === true;
    const outcome = passed ? "passed" : readinessClassification.outcome;
    const schedule = passed ? {
      version: 2,
      contract: "policy-q-development-training-schedule-v2",
      gridHash,
      architecture: { ...selectedConfiguration.architecture },
      learningRate: selectedConfiguration.learningRate,
      epochs: selectedConfiguration.epochs,
      replicas: grid.finalReplicas,
      trainingBalanceProfile:
        "phase-deck-seat-inverse-frequency-gradient-balance-v1",
      selectedOn: "training-only-shadow-validation",
      protectedDevelopmentOpened: false
    } : null;
    const report = {
      version: 2,
      contract: POLICY_Q_SHADOW_READINESS_CONTRACT,
      gridHash,
      passed,
      outcome,
      structuralFailure: outcome === "structural-failure",
      diagnosticInvalid: false,
      reasons: passed
        ? []
        : readinessClassification.reasons,
      readinessClassification,
      split: datasets.split,
      schedule,
      screenGate: evaluatorGateWithoutCheckpoint(screenGate),
      gridResults: gridResults.map((item) => ({
        architecture: item.architecture,
        learningRate: item.learningRate,
        epochs: item.epochs,
        gate: evaluatorGateWithoutCheckpoint(item.gate)
      })),
      finalGate: finalGate
        ? evaluatorGateWithoutCheckpoint(finalGate)
        : null,
      diagnosticDemand: passed
        ? null
        : policyQShadowReadinessDemand(diagnosticSource),
      completedAt: new Date().toISOString()
    };
    const reportPath = path.join(
      options.dataRoot,
      "evaluator-bootstrap",
      options.bootstrap.datasetKey,
      "stage-gates",
      `policy-q-shadow-readiness-${gridHash}.json`
    );
    await writeCheckpoint(reportPath, report);
    options.progress.write({
      state: "training",
      stage: passed
        ? "evaluator-policy-q-shadow-readiness-complete"
        : "evaluator-policy-q-shadow-readiness-review",
      evaluatorBootstrapDatasetKey: options.bootstrap.datasetKey,
      ...readinessProgress(
        passed
          ? "passed"
          : outcome === "structural-failure"
            ? "structural-failure"
            : "inconclusive",
        {
        passed,
        outcome,
        schedule,
        reasons: report.reasons
        }
      )
    });
    return report;
  } finally {
    releaseTrajectoryDatasets(
      datasets.training,
      datasets.validation,
      datasets.anchorValidation
    );
  }
}

async function trainEvaluatorDevelopmentStage(options) {
  const sourceCheckpoint = serializeNeuralModel(options.sourceModel);
  const architectureSpecs = (
    options.architectureSpecs || EVALUATOR_ARCHITECTURE_SPECS
  ).map((item) => ({ ...item }));
  const purpose = String(options.purpose || "official-development");
  const certificateKind = options.certificateKind
    || EVALUATOR_CERTIFICATE_KINDS.robustAction;
  const policyQOnly = certificateKind === EVALUATOR_CERTIFICATE_KINDS.policyQ;
  const requireStructuredV2 = options.requireStructuredV2 !== false;
  const trainingBalanceProfile = options.trainingBalanceProfile
    || (options.balanceTrainingStrata === true
      ? await evaluatorTrainingBalanceProfile(options.trainingDataset, {
      engineFingerprint: options.engineFingerprint,
      certificationRole: "training",
      datasetContinuationPolicyHash:
        options.continuationLineage?.continuationPolicyHash,
      continuationLineage: options.continuationLineage,
      currentPolicyHash:
        options.continuationLineage?.continuationPolicyHash,
      structuredV2Only: requireStructuredV2
    })
      : null);
  const performanceRequirements = {
    requirePerformance: true,
    minimumActionAccuracy: 0.6,
    minimumLeafAccuracy: 0.6,
    minimumPhaseAccuracy: 0.6,
    minimumPhaseAccuracyLowerBound: 0.45,
    ...(options.performanceRequirements || {})
  };
  const seedNamespace = String(options.seedNamespace || "");
  const gateKey = checkpointHash({
    version: 13,
    protocol: "evaluator-architecture-sweep-development-gate-v13-phase-action-effect",
    policyQFormalAuditContract: certificateKind
      === EVALUATOR_CERTIFICATE_KINDS.policyQ
        ? POLICY_Q_FORMAL_AUDIT_CONTRACT
        : null,
    certificateKind,
    purpose,
    seedNamespace,
    requireStructuredV2,
    allowInsufficientTrainingEvidence:
      options.allowInsufficientTrainingEvidence === true,
    performanceRequirements,
    trainingEvidenceRequirement:
      options.trainingEvidenceRequirement || null,
    evaluatorArchitectureContract: EVALUATOR_ARCHITECTURE_CONTRACT,
    architectureSpecs,
    bootstrapDatasetKey: options.bootstrapDatasetKey,
    sourceCheckpointHash: checkpointHash(sourceCheckpoint),
    trainingDataset: options.trainingDataset.manifest,
    developmentDataset: options.developmentDataset.manifest,
    comparisonDevelopmentDataset:
      options.comparisonDevelopmentDataset?.manifest || null,
    calibrationFit: options.calibrationFitManifest
      || trajectorySequenceManifest(options.calibrationFit || []),
    calibrationTest: options.calibrationTestManifest
      || trajectorySequenceManifest(options.calibrationTest || []),
    replicas: options.replicas,
    ...(Number(options.replicaOffset) > 0
      ? { replicaOffset: Number(options.replicaOffset) }
      : {}),
    ...(options.orderSeedOverride
      ? { orderSeedOverride: options.orderSeedOverride }
      : {}),
    ...(options.initializationSeedOverride
      ? { initializationSeedOverride: options.initializationSeedOverride }
      : {}),
    epochs: options.epochs,
    batchSize: options.trainingBatchSize,
    learningRate: options.learningRate,
    trainingBalanceProfile,
    precommittedTrainingSchedule:
      options.precommittedTrainingSchedule || null
  });
  const gatePath = path.join(
    options.dataRoot,
    "evaluator-bootstrap",
    options.bootstrapDatasetKey,
    "stage-gates",
    `${purpose.replace(/[^a-z0-9_-]/gi, "_")}-${gateKey}.json`
  );
  const cached = await readCheckpoint(gatePath);
  if (cached?.version === 12 && cached.gateKey === gateKey
    && validEvaluatorGateRankingAssessment(cached, certificateKind)) {
    return hydrateEvaluatorDevelopmentGate(cached);
  }
  if (options.cacheOnly === true) return null;
  const candidateRoot = options.candidateRootOverride || path.join(
    path.dirname(gatePath),
    `development-${gateKey}-candidates`
  );
  await mkdir(candidateRoot, { recursive: true });

  const candidateProcessesMaximum = Math.max(1, Math.min(
    4,
    Number(options.candidateProcessesMaximum) || 1
  ));
  if (options.candidateWorkerMode !== true
    && candidateProcessesMaximum > 1
    && (architectureSpecs.length * options.replicas > 1
      || options.forceCandidateProcess === true)) {
    return trainEvaluatorDevelopmentStageParallel({
      ...options,
      sourceCheckpoint,
      architectureSpecs,
      certificateKind,
      purpose,
      requireStructuredV2,
      trainingBalanceProfile,
      performanceRequirements,
      seedNamespace,
      gateKey,
      gatePath,
      candidateRoot,
      candidateProcessesMaximum
    });
  }

  const audits = [];
  const totalCandidates = Math.max(
    architectureSpecs.length * options.replicas,
    Number(options.totalCandidatesOverride) || 0
  );
  const replicaOffset = Math.max(0, Number(options.replicaOffset) || 0);
  const reportedReplicas = Math.max(
    options.replicas,
    Number(options.totalReplicasOverride) || 0
  );
  let candidateOrdinal = Math.max(0,
    Number(options.candidateOrdinalOffset) || 0);
  for (const architecture of architectureSpecs) {
   for (let replicaIndex = 0;
    replicaIndex < options.replicas;
    replicaIndex += 1) {
    const replica = replicaOffset + replicaIndex;
    candidateOrdinal += 1;
    const orderSeed = options.orderSeedOverride
      || deterministicValueDigest(seedNamespace
        ? { seedNamespace, replica, purpose: "evaluator-training-order" }
        : { gateKey, replica });
    const initializationSeed = options.initializationSeedOverride
      || deterministicValueDigest({
        ...(seedNamespace ? { seedNamespace } : { gateKey }),
        architecture: architecture.id,
        replica,
        purpose: "evaluator-initialization"
      });
    const checkpointPath = path.join(
      candidateRoot,
      `${architecture.id}-replica-${String(replica).padStart(2, "0")}.json.gz`
    );
    const candidateKey = evaluatorDevelopmentCandidateKey({
      sourceCheckpoint,
      architecture,
      replica,
      orderSeed,
      initializationSeed,
      purpose,
      certificateKind,
      requireStructuredV2,
      trainingDataset: options.trainingDataset,
      developmentDataset: options.developmentDataset,
      comparisonDevelopmentDataset: options.comparisonDevelopmentDataset,
      epochs: options.epochs,
      trainingBatchSize: options.trainingBatchSize,
      calibrationBatchSize: options.calibrationBatchSize,
      learningRate: options.learningRate,
      trainingBalanceProfile,
      continuationLineage: options.continuationLineage,
      precommittedTrainingSchedule:
        options.precommittedTrainingSchedule || null
    });
    let existingArchive = await readEvaluatorCandidateArchive(
      checkpointPath
    );
    if (!existingArchive) {
      existingArchive = await findReusableEvaluatorCandidateArchive(
        checkpointPath,
        { candidateKey, architecture, replica }
      );
    }
    if (validCompletedEvaluatorCandidateArchive(existingArchive, {
      candidateKey,
      architecture,
      replica
    })) {
      const restoredAudit = {
        ...existingArchive.audit,
        checkpointPath
      };
      restoredAudit.selectionScore = evaluatorArchitectureSelectionScore({
        certificateKind,
        confidenceBoundSource: performanceRequirements.confidenceBoundSource,
        status: restoredAudit.status,
        ranking: {
          actionRanking: restoredAudit.actionRanking || {},
          leafValueRanking: restoredAudit.leafValueRanking || {}
        },
        trainingRanking: {
          actionRanking: restoredAudit.trainingActionRanking || {},
          leafValueRanking: restoredAudit.trainingLeafValueRanking || {}
        },
        calibration: restoredAudit.calibration || {},
        parameterCount: restoredAudit.parameterCount,
        inferenceMilliseconds:
          restoredAudit.inferenceBenchmark?.meanMilliseconds
      });
      audits.push(restoredAudit);
      options.progress.write({
        state: "training",
        stage: "evaluator-development-gate-candidate-restored",
        ...(options.progressContext || {}),
        evaluatorTrainingPurpose: purpose,
        evaluatorArchitecture: architecture.id,
        evaluatorCandidate: candidateOrdinal,
        evaluatorCandidates: totalCandidates,
        evaluatorTrainingReplica: replica,
        evaluatorTrainingReplicas: reportedReplicas,
        candidateKey,
        trainingReused: true,
        evaluationReused: true
      });
      continue;
    }
    let model;
    let training;
    const reusableTrainingCheckpoint = validReusableEvaluatorCandidateCheckpoint(
      existingArchive,
      {
        candidateKey,
        architecture,
        replica,
        orderSeed,
        initializationSeed,
        epochs: options.epochs,
        trainingBatchSize: options.trainingBatchSize,
        learningRate: options.learningRate
      }
    );
    if (reusableTrainingCheckpoint) {
      model = deserializeNeuralModel(existingArchive.checkpoint);
      training = model.metadata?.evaluatorEvidenceTraining;
      options.progress.write({
        state: "training",
        stage: "evaluator-development-gate-candidate-restored",
        ...(options.progressContext || {}),
        evaluatorTrainingPurpose: purpose,
        evaluatorArchitecture: architecture.id,
        evaluatorCandidate: candidateOrdinal,
        evaluatorCandidates: totalCandidates,
        evaluatorTrainingReplica: replica,
        evaluatorTrainingReplicas: reportedReplicas,
        candidateKey,
        trainingReused: true,
        evaluationReused: false
      });
    } else {
      model = deserializeNeuralModel(sourceCheckpoint);
      attachEvaluatorArchitecture(model, architecture, {
        seed: initializationSeed,
        // Every family starts from an independent initialization and receives
        // the same evidence stream. Flat candidates no longer inherit a hidden
        // advantage from the policy GRU.
        warmStart: false,
        initializationJitter: replica === 0 ? 0 : 0.0001
      });
      model.metadata = {
        ...model.metadata,
        engineFingerprint: options.engineFingerprint,
        engineValidationStatus: "current-engine-validated",
        validationScope: "evaluator-only-development-gate",
        runContract: options.runContract,
        artifactRole: "frozen-evaluator-candidate",
        policyPromotionEligible: false,
        evaluatorArchitecture: evaluatorArchitecture(model),
        evaluatorTrainingReplica: replica,
        evaluatorInitializationSeed: initializationSeed,
        evaluatorTrainingOrderSeed: orderSeed,
        evaluatorPrecommittedTrainingSchedule:
          options.precommittedTrainingSchedule || null,
        evaluatorTrainingBalanceProfile:
          trainingBalanceProfile || null
      };
      model.calibration = {
        ...model.calibration,
        temperature: 1,
        bias: 0
      };
      options.progress.write({
        state: "training",
        stage: "evaluator-development-gate-training",
        ...(options.progressContext || {}),
        evaluatorTrainingPurpose: purpose,
        evaluatorArchitecture: architecture.id,
        evaluatorCandidate: candidateOrdinal,
        evaluatorCandidates: totalCandidates,
        evaluatorTrainingReplica: replica,
        evaluatorTrainingReplicas: reportedReplicas,
        games: options.trainingDataset.manifest.games
      });
      training = await trainEvaluatorFromAuditEvidence(
        model,
        async function* evaluatorDevelopmentGateBatchFactory() {
          for await (const trajectories of iterateIndependentTrajectoryDataset(
            options.trainingDataset,
            { orderSeed }
          )) {
            assertTrainingTrajectories(trajectories, options.engineFingerprint);
            yield trajectories;
          }
        },
        {
          epochs: options.epochs,
          batchSize: options.trainingBatchSize,
          learningRate: options.learningRate,
          engineFingerprint: options.engineFingerprint,
          certificationRole: "training",
          datasetContinuationPolicyHash:
            options.continuationLineage?.continuationPolicyHash,
          continuationLineage: options.continuationLineage,
          currentPolicyHash:
            options.continuationLineage?.continuationPolicyHash,
          trainingBalanceProfile,
          onEpoch: (item) => options.progress.write({
            state: "training",
            stage: "evaluator-development-gate-training",
            ...(options.progressContext || {}),
            evaluatorTrainingPurpose: purpose,
            evaluatorArchitecture: architecture.id,
            evaluatorCandidate: candidateOrdinal,
            evaluatorCandidates: totalCandidates,
            evaluatorTrainingReplica: replica,
            evaluatorTrainingReplicas: reportedReplicas,
            ...item
          })
        }
      );
    }
    const required = options.trainingEvidenceRequirement
      || EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS.training;
    const actionSamples = Number(
      training?.sourceSamples?.["terminal-action-ranking"]
    ) || 0;
    const leafSamples = Number(
      training?.sourceSamples?.["terminal-leaf-ranking"]
    ) || 0;
    const structuredV2ActionSamples = Number(
      training?.sourceSamples?.["structured-v2-terminal-action-ranking"]
    ) || 0;
    const structuredV2LeafSamples = Number(
      training?.sourceSamples?.["structured-v2-terminal-leaf-ranking"]
    ) || 0;
    const trainingEvidenceInsufficient = (!policyQOnly && actionSamples
      < required.minimumActionReferences)
      || leafSamples < required.minimumLeafValuePairs
      || (!policyQOnly && requireStructuredV2
        && structuredV2ActionSamples
          < Number(required.minimumStructuredV2ActionReferences || 0))
      || (requireStructuredV2
        && structuredV2LeafSamples
          < Number(required.minimumStructuredV2LeafValuePairs || 0));
    if (trainingEvidenceInsufficient) {
      const evidenceDiagnostic = {
        replica,
        actionSamples,
        leafSamples,
        structuredV2ActionSamples,
        structuredV2LeafSamples,
        required
      };
      if (options.allowInsufficientTrainingEvidence === true) {
        audits.push({
          epoch: 0,
          source: "staged-evaluator-training",
          baseInputHash: checkpointHash({
            sourceCheckpoint,
            evaluatorArchitecture: architecture
          }),
          architecture,
          replica,
          orderSeed,
          initializationSeed,
          evaluatorTraining: training,
          diagnosticInvalidReason:
            "evaluator-early-training-split-evidence-insufficient",
          trainingEvidenceDiagnostic: evidenceDiagnostic,
          status: {
            eligible: false,
            reasons: ["training-split-evidence-insufficient"]
          }
        });
        continue;
      }
      throw new Error(
        "evaluator-development-gate-training-evidence-insufficient: "
        + JSON.stringify(evidenceDiagnostic)
      );
    }
    // Commit trained weights before the comparatively long calibration and
    // ranking passes. A crash or intentional handoff during evaluation can
    // then resume from these exact weights without repeating any epoch.
    await writeTrajectoryArchive(checkpointPath, {
      version: 2,
      kind: "isolated-evaluator-development-candidate",
      state: "trained",
      candidateKey,
      architecture,
      replica,
      checkpoint: serializeNeuralModel(model)
    });
    // A legacy v1 checkpoint may already contain calibration fitted during a
    // completed pre-parallel evaluation.  Reset it before deterministically
    // rebuilding the audit; trained evaluator weights remain untouched.
    model.calibration = {
      ...model.calibration,
      temperature: 1,
      bias: 0
    };
    const writeEvaluationProgress = (section, item = {}) =>
      options.progress.write({
        state: "training",
        stage: "evaluator-development-gate-evaluation",
        ...(options.progressContext || {}),
        evaluatorTrainingPurpose: purpose,
        evaluatorArchitecture: architecture.id,
        evaluatorCandidate: candidateOrdinal,
        evaluatorCandidates: totalCandidates,
        evaluatorTrainingReplica: replica,
        evaluatorTrainingReplicas: reportedReplicas,
        evaluatorEvaluationProgress: {
          section,
          ...item
        }
      });
    writeEvaluationProgress("calibration", {
      completedEntries: 0,
      totalEntries: 0,
      preliminary: true
    });
    const calibration = await evaluateEvaluatorEvidenceCalibration(
      model,
      options.trainingDataset,
      options.developmentDataset,
      {
        engineFingerprint: options.engineFingerprint,
        requireStructuredV2
      }
    );
    if (Number.isFinite(Number(calibration.temperature))
      && Number.isFinite(Number(calibration.bias))) {
      model.calibration = { ...model.calibration, ...calibration };
    }
    writeEvaluationProgress("shadow-validation", {
      completedEntries: 0,
      totalEntries: options.developmentDataset?.manifest?.entries?.length || 0,
      preliminary: true
    });
    const ranking = await evaluateIndependentRankingAudits(
      model,
      options.developmentDataset,
      {
        batchSize: options.calibrationBatchSize,
        engineFingerprint: options.engineFingerprint,
        requireStructuredV2,
        onProgress: (item) => writeEvaluationProgress(
          "shadow-validation",
          item
        )
      }
    );
    writeEvaluationProgress("training-recheck", {
      completedEntries: 0,
      totalEntries: options.trainingDataset?.manifest?.entries?.length || 0,
      preliminary: true
    });
    const trainingRanking = await evaluateIndependentRankingAudits(
      model,
      options.trainingDataset,
      {
        batchSize: options.calibrationBatchSize,
        engineFingerprint: options.engineFingerprint,
        requireStructuredV2,
        onProgress: (item) => writeEvaluationProgress(
          "training-recheck",
          item
        )
      }
    );
    writeEvaluationProgress("fixed-anchor", {
      completedEntries: 0,
      totalEntries:
        options.comparisonDevelopmentDataset?.manifest?.entries?.length
        || options.developmentDataset?.manifest?.entries?.length
        || 0,
      preliminary: true
    });
    const anchorRanking = options.comparisonDevelopmentDataset
      && options.comparisonDevelopmentDataset.manifest.datasetFingerprint
        !== options.developmentDataset.manifest.datasetFingerprint
      ? await evaluateIndependentRankingAudits(
        model,
        options.comparisonDevelopmentDataset,
        {
          batchSize: options.calibrationBatchSize,
          engineFingerprint: options.engineFingerprint,
          requireStructuredV2,
          onProgress: (item) => writeEvaluationProgress(
            "fixed-anchor",
            item
          )
        }
      )
      : ranking;
    if (anchorRanking === ranking) {
      writeEvaluationProgress("fixed-anchor", {
        completedEntries:
          options.developmentDataset?.manifest?.entries?.length || 0,
        totalEntries:
          options.developmentDataset?.manifest?.entries?.length || 0,
        actionDecisions: ranking.actionRanking?.decisions || 0,
        actionAccuracy: ranking.actionRanking?.neuralAccuracy ?? null,
        leafDecisions: ranking.leafValueRanking?.decisions || 0,
        leafAccuracy: ranking.leafValueRanking?.accuracy ?? null,
        preliminary: true
      });
    }
    const generalizationGap = evaluatorGeneralizationGap(
      trainingRanking,
      ranking,
      certificateKind
    );
    const status = evaluatorDevelopmentAuditStatus(
      ranking.actionRanking,
      ranking.leafValueRanking,
      { ...performanceRequirements, certificateKind }
    );
    const maximumGeneralizationGap = Number(
      performanceRequirements.maximumGeneralizationGap
    );
    if (Number.isFinite(maximumGeneralizationGap)
      && generalizationGap > maximumGeneralizationGap) {
      status.eligible = false;
      status.reasons = [
        ...status.reasons,
        "evaluator-development-generalization-gap"
      ];
    }
    const serializedCandidate = serializeNeuralModel(model);
    const inferenceBenchmark = evaluatorInferenceBenchmark(model);
    const audit = {
      epoch: 0,
      source: "staged-evaluator-training",
      baseInputHash: checkpointHash({
        sourceCheckpoint,
        evaluatorArchitecture: architecture
      }),
      architecture,
      checkpointPath,
      artifactHash: neuralArtifactHash(model),
      evaluatorLeafHash: neuralEvaluatorLeafHash(model),
      calibration,
      evaluatorTraining: training,
      replica,
      orderSeed,
      initializationSeed,
      actionRanking: ranking.actionRanking,
      leafValueRanking: ranking.leafValueRanking,
      anchorActionRanking: anchorRanking.actionRanking,
      anchorLeafValueRanking: anchorRanking.leafValueRanking,
      trainingActionRanking: trainingRanking.actionRanking,
      trainingLeafValueRanking: trainingRanking.leafValueRanking,
      status,
      parameterCount: evaluatorParameterCount(model),
      inferenceBenchmark,
      generalizationGap,
      selectionScore: evaluatorArchitectureSelectionScore({
        certificateKind,
        confidenceBoundSource:
          performanceRequirements.confidenceBoundSource,
        status,
        ranking,
        trainingRanking,
        calibration,
        parameterCount: evaluatorParameterCount(model),
        inferenceMilliseconds: inferenceBenchmark.meanMilliseconds
      })
    };
    await writeTrajectoryArchive(checkpointPath, {
      version: 2,
      kind: "isolated-evaluator-development-candidate",
      state: "complete",
      candidateKey,
      architecture,
      replica,
      checkpoint: serializedCandidate,
      audit
    });
    audits.push(audit);
    // The candidate is reloaded from its checkpoint if it wins. Keeping its
    // TensorFlow layers alive here only stacks native allocations across the
    // 42-model Policy-Q shadow grid.
    disposeNeuralModelLayers(model);
    model = null;
    await compactTrainingHeap();
   }
  }
  const stable = stableEvaluatorReplicaCandidates(audits, options.replicas);
  const selectedMetadata = selectEvaluatorOnlyArtifact(stable, options.sourceModel);
  const selected = selectedMetadata
    ? await hydrateEvaluatorCandidate(selectedMetadata)
    : null;
  const result = {
    version: 12,
    gateKey,
    protocol: "multi-architecture-development_then-freeze-one-v12-stream-batches",
    certificateKind,
    purpose,
    requireStructuredV2,
    evaluatorArchitectureContract: EVALUATOR_ARCHITECTURE_CONTRACT,
    architectureSpecs,
    precommittedTrainingSchedule:
      options.precommittedTrainingSchedule || null,
    candidatesPerArchitecture: options.replicas,
    totalCandidates,
    bootstrapDatasetKey: options.bootstrapDatasetKey,
    passed: Boolean(selected),
    requiredStableReplicas: Math.ceil(options.replicas * 2 / 3),
    selected: selected ? evaluatorCandidateWithoutCheckpoint(selected) : null,
    candidates: audits,
    completedAt: new Date().toISOString()
  };
  await writeCheckpoint(gatePath, result);
  return {
    ...result,
    selected
  };
}

function validEvaluatorGateRankingAssessment(gate, certificateKind) {
  if (certificateKind !== EVALUATOR_CERTIFICATE_KINDS.policyQ) return true;
  const requiredContract = POLICY_Q_SHADOW_READINESS_GRID
    .performanceRequirements.regretAlternative.contract;
  return Array.isArray(gate?.candidates)
    && gate.candidates.length > 0
    && gate.candidates.every((candidate) =>
      candidate?.leafValueRanking?.actionEffectRanking?.contract
        === requiredContract);
}

function evaluatorDevelopmentCandidateKey(options) {
  return checkpointHash({
    version: 1,
    contract: "evaluator-development-candidate-semantic-input-v1",
    sourceCheckpointHash: checkpointHash(options.sourceCheckpoint),
    architecture: options.architecture,
    replica: options.replica,
    orderSeed: options.orderSeed,
    initializationSeed: options.initializationSeed,
    purpose: options.purpose,
    certificateKind: options.certificateKind,
    requireStructuredV2: options.requireStructuredV2,
    trainingDataset: options.trainingDataset?.manifest,
    developmentDataset: options.developmentDataset?.manifest,
    comparisonDevelopmentDataset:
      options.comparisonDevelopmentDataset?.manifest || null,
    epochs: options.epochs,
    trainingBatchSize: options.trainingBatchSize,
    calibrationBatchSize: options.calibrationBatchSize,
    learningRate: options.learningRate,
    trainingBalanceProfile: options.trainingBalanceProfile || null,
    continuationLineage: options.continuationLineage || null,
    precommittedTrainingSchedule:
      options.precommittedTrainingSchedule || null
  });
}

async function readEvaluatorCandidateArchive(filename) {
  try {
    return await readTrajectoryArchive(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

async function findReusableEvaluatorCandidateArchive(filename, expected) {
  const stageGateRoot = path.dirname(path.dirname(filename));
  const candidateFilename = path.basename(filename);
  let entries = [];
  try {
    entries = await readdir(stageGateRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()
      || !entry.name.startsWith("development-")
      || !entry.name.endsWith("-candidates")) continue;
    const candidatePath = path.join(
      stageGateRoot,
      entry.name,
      candidateFilename
    );
    if (path.resolve(candidatePath) === path.resolve(filename)) continue;
    const archive = await readEvaluatorCandidateArchive(candidatePath);
    if (archive?.version === 2
      && archive.kind === "isolated-evaluator-development-candidate"
      && archive.candidateKey === expected.candidateKey
      && archive.architecture?.id === expected.architecture.id
      && Number(archive.replica) === Number(expected.replica)
      && archive.checkpoint) {
      return archive;
    }
  }
  return null;
}

function validCompletedEvaluatorCandidateArchive(archive, expected) {
  return archive?.version === 2
    && archive.kind === "isolated-evaluator-development-candidate"
    && archive.state === "complete"
    && archive.candidateKey === expected.candidateKey
    && archive.architecture?.id === expected.architecture.id
    && Number(archive.replica) === Number(expected.replica)
    && archive.checkpoint
    && archive.audit?.architecture?.id === expected.architecture.id
    && Number(archive.audit?.replica) === Number(expected.replica)
    && archive.audit?.evaluatorTraining
    && archive.audit?.actionRanking
    && archive.audit?.leafValueRanking
    && archive.audit.leafValueRanking.actionEffectRanking?.contract
      === POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements
        .regretAlternative.contract;
}

function validReusableEvaluatorCandidateCheckpoint(archive, expected) {
  const legacy = archive?.version === 1;
  const partialV2 = archive?.version === 2
    && ["trained", "complete"].includes(archive.state)
    && archive.candidateKey === expected.candidateKey;
  if ((!legacy && !partialV2)
    || archive.kind !== "isolated-evaluator-development-candidate"
    || archive.architecture?.id !== expected.architecture.id
    || Number(archive.replica) !== Number(expected.replica)
    || !archive.checkpoint) return false;
  const metadata = archive.checkpoint.metadata || {};
  const training = metadata.evaluatorEvidenceTraining;
  return metadata.evaluatorArchitecture?.id === expected.architecture.id
    && Number(metadata.evaluatorTrainingReplica) === Number(expected.replica)
    && metadata.evaluatorTrainingOrderSeed === expected.orderSeed
    && metadata.evaluatorInitializationSeed === expected.initializationSeed
    && Number(training?.epochs) === Number(expected.epochs)
    && Number(training?.batchSize) === Number(expected.trainingBatchSize)
    && Math.abs(Number(training?.learningRate)
      - Number(expected.learningRate)) < 1e-12;
}

async function trainEvaluatorDevelopmentStageParallel(options) {
  const totalCandidates = options.architectureSpecs.length * options.replicas;
  const tasks = [];
  let ordinal = 0;
  for (const architecture of options.architectureSpecs) {
    for (let replica = 0; replica < options.replicas; replica += 1) {
      ordinal += 1;
      const orderSeed = deterministicValueDigest(options.seedNamespace
        ? {
          seedNamespace: options.seedNamespace,
          replica,
          purpose: "evaluator-training-order"
        }
        : { gateKey: options.gateKey, replica });
      const initializationSeed = deterministicValueDigest({
        ...(options.seedNamespace
          ? { seedNamespace: options.seedNamespace }
          : { gateKey: options.gateKey }),
        architecture: architecture.id,
        replica,
        purpose: "evaluator-initialization"
      });
      tasks.push({
        architecture,
        replica,
        ordinal,
        totalCandidates,
        orderSeed,
        initializationSeed
      });
    }
  }
  const requestKey = checkpointHash({
    version: 1,
    contract: "parallel-evaluator-candidate-request-v1",
    gateKey: options.gateKey,
    sourceCheckpointHash: checkpointHash(options.sourceCheckpoint),
    candidateRoot: options.candidateRoot,
    tasks: tasks.map((task) => ({
      architecture: task.architecture,
      replica: task.replica,
      orderSeed: task.orderSeed,
      initializationSeed: task.initializationSeed
    }))
  });
  const parallelRoot = path.join(options.candidateRoot, ".parallel");
  const commonRequestPath = path.join(
    parallelRoot,
    `request-${requestKey}.json.gz`
  );
  await mkdir(parallelRoot, { recursive: true });
  const existingCommon = await readEvaluatorCandidateArchive(
    commonRequestPath
  );
  if (existingCommon?.version !== 1
    || existingCommon.kind !== "parallel-evaluator-candidate-request"
    || existingCommon.requestKey !== requestKey) {
    await writeTrajectoryArchive(commonRequestPath, {
      version: 1,
      kind: "parallel-evaluator-candidate-request",
      requestKey,
      gateKey: options.gateKey,
      sourceCheckpoint: options.sourceCheckpoint,
      options: evaluatorCandidateSerializableOptions(options)
    });
  }

  const audits = [];
  const pending = [...tasks];
  const active = new Set();
  const activeChildren = new Set();
  let completedConfigurations = 0;
  let failed = null;
  let lastReportedProcesses = null;
  const reserveBytes = Math.max(
    2 * 1024 ** 3,
    Number(options.candidateProcessReserveBytes) || 4 * 1024 ** 3
  );
  const estimatedBytes = Math.max(
    1024 ** 3,
    Number(options.candidateProcessEstimatedBytes)
      || Math.floor(1.75 * 1024 ** 3)
  );
  const maximumProcesses = options.candidateProcessesMaximum;
  const allowedProcesses = () => {
    const freeBytes = freemem();
    if (freeBytes < reserveBytes) {
      return Math.max(1, Math.min(maximumProcesses, active.size - 1));
    }
    return Math.max(1, Math.min(
      maximumProcesses,
      active.size + Math.floor(
        (freeBytes - reserveBytes) / estimatedBytes
      )
    ));
  };
  const progressContext = (payload = {}) => ({
    ...(payload || {}),
    policyQReadinessProgress: payload?.policyQReadinessProgress
      ? {
        ...payload.policyQReadinessProgress,
        completedConfigurations,
        totalConfigurations: totalCandidates,
        parallelCandidateProcesses: active.size,
        parallelCandidateProcessLimit: maximumProcesses
      }
      : undefined
  });
  const reportPool = () => {
    const allowed = allowedProcesses();
    if (lastReportedProcesses === `${active.size}:${allowed}`) return;
    lastReportedProcesses = `${active.size}:${allowed}`;
    options.progress.write({
      state: "training",
      stage: "evaluator-development-candidate-pool",
      ...(options.progressContext || {}),
      evaluatorTrainingPurpose: options.purpose,
      evaluatorCandidates: totalCandidates,
      evaluatorCandidatesCompleted: completedConfigurations,
      evaluatorCandidateProcesses: active.size,
      evaluatorCandidateProcessesAllowed: allowed,
      evaluatorCandidateProcessesMaximum: maximumProcesses,
      systemFreeMemoryBytes: freemem(),
      reserveBytes,
      estimatedCandidateBytes: estimatedBytes
    });
  };
  const onSignal = () => {
    for (const child of activeChildren) {
      void terminateProcessTree(child.pid);
    }
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    while ((pending.length || active.size) && !failed) {
      const allowed = allowedProcesses();
      while (pending.length && active.size < allowed && !failed) {
        const task = pending.shift();
        let entry;
        const promise = runEvaluatorDevelopmentCandidateProcess({
          task,
          commonRequestPath,
          parallelRoot,
          requestKey,
          activeChildren,
          onProgress: (payload) => options.progress.write(
            progressContext(payload)
          )
        }).then((audit) => {
          audits.push(audit);
          completedConfigurations += 1;
          options.progress.write({
            state: "training",
            stage: "evaluator-development-gate-candidate-complete",
            ...(options.progressContext || {}),
            evaluatorTrainingPurpose: options.purpose,
            evaluatorArchitecture: task.architecture.id,
            evaluatorCandidate: task.ordinal,
            evaluatorCandidates: totalCandidates,
            evaluatorTrainingReplica: task.replica,
            evaluatorCandidatesCompleted: completedConfigurations,
            candidateProcessesMaximum: maximumProcesses
          });
        }).catch((error) => {
          failed = error;
        }).finally(() => {
          active.delete(entry);
        });
        entry = { task, promise };
        active.add(entry);
      }
      reportPool();
      if (active.size) {
        await Promise.race([
          ...[...active].map((entry) => entry.promise),
          new Promise((resolve) => setTimeout(resolve, 10000))
        ]);
      } else if (pending.length) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    if (failed) {
      await Promise.all([...activeChildren].map((child) =>
        terminateProcessTree(child.pid)));
      throw failed;
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
  audits.sort((left, right) => {
    const leftArchitecture = options.architectureSpecs.findIndex(
      (item) => item.id === left.architecture?.id
    );
    const rightArchitecture = options.architectureSpecs.findIndex(
      (item) => item.id === right.architecture?.id
    );
    return leftArchitecture - rightArchitecture
      || Number(left.replica) - Number(right.replica);
  });
  const stable = stableEvaluatorReplicaCandidates(audits, options.replicas);
  const selectedMetadata = selectEvaluatorOnlyArtifact(
    stable,
    options.sourceModel
  );
  const selected = selectedMetadata
    ? await hydrateEvaluatorCandidate(selectedMetadata)
    : null;
  const result = {
    version: 12,
    gateKey: options.gateKey,
    protocol: "multi-architecture-development_then-freeze-one-v12-stream-batches",
    certificateKind: options.certificateKind,
    purpose: options.purpose,
    requireStructuredV2: options.requireStructuredV2,
    evaluatorArchitectureContract: EVALUATOR_ARCHITECTURE_CONTRACT,
    architectureSpecs: options.architectureSpecs,
    precommittedTrainingSchedule:
      options.precommittedTrainingSchedule || null,
    candidatesPerArchitecture: options.replicas,
    totalCandidates,
    bootstrapDatasetKey: options.bootstrapDatasetKey,
    passed: Boolean(selected),
    requiredStableReplicas: Math.ceil(options.replicas * 2 / 3),
    selected: selected ? evaluatorCandidateWithoutCheckpoint(selected) : null,
    candidates: audits,
    candidateExecution: {
      version: 1,
      contract: "semantic-preserving-process-parallel-candidates-v1",
      maximumProcesses,
      reserveBytes,
      estimatedCandidateBytes: estimatedBytes
    },
    completedAt: new Date().toISOString()
  };
  await writeCheckpoint(options.gatePath, result);
  await unlink(commonRequestPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  return { ...result, selected };
}

function evaluatorCandidateSerializableOptions(options) {
  return {
    certificateKind: options.certificateKind,
    purpose: options.purpose,
    trainingDataset: options.trainingDataset,
    developmentDataset: options.developmentDataset,
    comparisonDevelopmentDataset: options.comparisonDevelopmentDataset,
    calibrationFit: options.calibrationFit || [],
    calibrationTest: options.calibrationTest || [],
    calibrationFitManifest: options.calibrationFitManifest || null,
    calibrationTestManifest: options.calibrationTestManifest || null,
    calibrationBatchSize: options.calibrationBatchSize,
    trainingBatchSize: options.trainingBatchSize,
    trainingEvidenceRequirement: options.trainingEvidenceRequirement || null,
    continuationLineage: options.continuationLineage || null,
    dataRoot: options.dataRoot,
    bootstrapDatasetKey: options.bootstrapDatasetKey,
    engineFingerprint: options.engineFingerprint,
    runContract: options.runContract,
    requireStructuredV2: options.requireStructuredV2,
    allowInsufficientTrainingEvidence:
      options.allowInsufficientTrainingEvidence === true,
    trainingBalanceProfile: options.trainingBalanceProfile || null,
    seedNamespace: options.seedNamespace,
    epochs: options.epochs,
    learningRate: options.learningRate,
    performanceRequirements: options.performanceRequirements,
    precommittedTrainingSchedule:
      options.precommittedTrainingSchedule || null,
    progressContext: options.progressContext || null,
    candidateRootOverride: options.candidateRoot,
    totalReplicasOverride: options.replicas,
    totalCandidatesOverride:
      options.architectureSpecs.length * options.replicas
  };
}

async function runEvaluatorDevelopmentCandidateProcess(options) {
  const taskKey = checkpointHash({
    version: 1,
    requestKey: options.requestKey,
    architecture: options.task.architecture,
    replica: options.task.replica,
    orderSeed: options.task.orderSeed,
    initializationSeed: options.task.initializationSeed
  });
  const taskPath = path.join(
    options.parallelRoot,
    `task-${taskKey}.json`
  );
  const resultPath = path.join(
    options.parallelRoot,
    `result-${taskKey}.json`
  );
  await writeCheckpoint(taskPath, {
    version: 1,
    contract: "parallel-evaluator-candidate-task-v1",
    taskKey,
    requestKey: options.requestKey,
    commonRequestPath: options.commonRequestPath,
    resultPath,
    task: options.task
  });
  const childExecArgv = process.execArgv.filter(
    (value) => !value.startsWith("--max-old-space-size")
  );
  childExecArgv.push("--max-old-space-size=4096", "--expose-gc");
  const child = fork(
    path.resolve(process.argv[1]),
    ["--evaluator-development-candidate-worker", taskPath],
    {
      cwd: process.cwd(),
      execArgv: [...new Set(childExecArgv)],
      serialization: "json",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      windowsHide: true
    }
  );
  options.activeChildren.add(child);
  const exit = await new Promise((resolve) => {
    child.on("message", (message) => {
      if (message?.type === "candidate-progress") {
        options.onProgress(message.progress);
      } else if (message?.type === "candidate-complete" && child.connected) {
        child.disconnect();
      }
    });
    child.once("error", (error) => resolve({ code: null, error }));
    child.once("exit", (code, signal) => resolve({
      code,
      signal,
      error: null
    }));
  }).finally(() => {
    options.activeChildren.delete(child);
  });
  const result = await readCheckpoint(resultPath);
  await unlink(taskPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await unlink(resultPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  if (exit.code !== 0 || result?.ok !== true
    || result.taskKey !== taskKey) {
    const detail = result?.error?.message
      || exit.error?.message
      || `exit=${exit.code ?? "null"}, signal=${exit.signal || "none"}`;
    throw new Error(
      `Parallel evaluator candidate failed (${options.task.architecture.id}`
      + ` replica ${options.task.replica}): ${detail}`
    );
  }
  const audit = result.audit;
  if (audit?.architecture?.id !== options.task.architecture.id
    || Number(audit?.replica) !== Number(options.task.replica)) {
    throw new Error("Parallel evaluator candidate returned the wrong identity.");
  }
  return audit;
}

async function runEvaluatorDevelopmentCandidateWorker(taskPath) {
  const taskRequest = await readCheckpoint(taskPath);
  const resultPath = taskRequest?.resultPath
    ? path.resolve(taskRequest.resultPath)
    : `${taskPath}.result.json`;
  const send = (message) => {
    if (typeof process.send === "function" && process.connected) {
      process.send(message);
    }
  };
  try {
    if (taskRequest?.version !== 1
      || taskRequest.contract !== "parallel-evaluator-candidate-task-v1"
      || !taskRequest.task?.architecture?.id
      || !Number.isInteger(Number(taskRequest.task?.replica))) {
      throw new Error("Invalid parallel evaluator candidate task.");
    }
    const common = await readTrajectoryArchive(
      path.resolve(taskRequest.commonRequestPath)
    );
    if (common?.version !== 1
      || common.kind !== "parallel-evaluator-candidate-request"
      || common.requestKey !== taskRequest.requestKey) {
      throw new Error("Parallel evaluator candidate request mismatch.");
    }
    const task = taskRequest.task;
    const sourceModel = deserializeNeuralModel(common.sourceCheckpoint);
    const workerOptions = {
      ...common.options,
      sourceModel,
      architectureSpecs: [task.architecture],
      replicas: 1,
      replicaOffset: task.replica,
      candidateOrdinalOffset: task.ordinal - 1,
      orderSeedOverride: task.orderSeed,
      initializationSeedOverride: task.initializationSeed,
      candidateWorkerMode: true,
      candidateProcessesMaximum: 1,
      balanceTrainingStrata: false,
      progress: {
        write: (progress) => send({
          type: "candidate-progress",
          progress
        })
      }
    };
    const checkpointPath = path.join(
      common.options.candidateRootOverride,
      `${task.architecture.id}-replica-${String(task.replica).padStart(2, "0")}.json.gz`
    );
    const result = await withFileLock(
      `${checkpointPath}.lock`,
      () => trainEvaluatorDevelopmentStage(workerOptions),
      {
        timeoutMs: 12 * 60 * 60 * 1000,
        staleMs: 2 * 60 * 1000,
        heartbeatMs: 30 * 1000
      }
    );
    const audit = result.candidates?.find((candidate) =>
      candidate.architecture?.id === task.architecture.id
      && Number(candidate.replica) === Number(task.replica));
    if (!audit) {
      throw new Error("Parallel evaluator candidate audit is missing.");
    }
    await writeCheckpoint(resultPath, {
      version: 1,
      ok: true,
      taskKey: taskRequest.taskKey,
      audit
    });
    send({ type: "candidate-complete", taskKey: taskRequest.taskKey });
    if (process.connected) process.disconnect();
  } catch (error) {
    await writeCheckpoint(resultPath, {
      version: 1,
      ok: false,
      taskKey: taskRequest?.taskKey || null,
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error),
        stack: error?.stack || null
      }
    }).catch(() => {});
    send({
      type: "candidate-error",
      error: error?.message || String(error)
    });
    if (process.connected) process.disconnect();
    process.exitCode = 1;
  }
}

async function hydrateEvaluatorDevelopmentGate(gate) {
  return {
    ...gate,
    selected: gate.selected
      ? await hydrateEvaluatorCandidate(gate.selected)
      : null
  };
}

async function hydrateEvaluatorCandidate(candidate) {
  if (candidate?.checkpoint) return candidate;
  if (!candidate?.checkpointPath) {
    throw new Error("Evaluator candidate checkpoint path is missing.");
  }
  const archive = await readTrajectoryArchive(candidate.checkpointPath);
  if (!archive?.checkpoint) {
    throw new Error(`Evaluator candidate checkpoint is unreadable: ${candidate.checkpointPath}`);
  }
  return {
    ...candidate,
    checkpoint: archive.checkpoint
  };
}

function evaluatorCandidateWithoutCheckpoint(candidate) {
  const { checkpoint: _checkpoint, ...metadata } = candidate || {};
  return metadata;
}

function evaluatorGateWithoutCheckpoint(gate) {
  return {
    ...gate,
    selected: gate?.selected
      ? evaluatorCandidateWithoutCheckpoint(gate.selected)
      : null
  };
}

function evaluatorParameterCount(model) {
  return evaluatorLayerNames(model).reduce((sum, name) => sum
    + (Number(model.layers[name]?.countParams?.()) || 0), 0);
}

function evaluatorInferenceBenchmark(model) {
  const state = new Float32Array(STATE_DIM);
  const infer = () => {
    if (!evaluatorRequiresStructuredV2(model)) {
      return estimateEncodedNeuralValue(model, state);
    }
    const input = createStructuredV2TensorInput([null], {
      legacyStates: [state]
    });
    try {
      return tf.tidy(() =>
        forwardEvaluatorValue(model, input).dataSync()[0]);
    } finally {
      disposeStructuredV2TensorInput(input);
    }
  };
  for (let index = 0; index < 4; index += 1) infer();
  const iterations = 32;
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    infer();
  }
  const elapsed = performance.now() - startedAt;
  return {
    version: 1,
    iterations,
    meanMilliseconds: elapsed / iterations
  };
}

function evaluatorGeneralizationGap(
  trainingRanking,
  developmentRanking,
  certificateKind = EVALUATOR_CERTIFICATE_KINDS.robustAction
) {
  const leafGap = (Number(trainingRanking?.leafValueRanking?.accuracy) || 0)
    - (Number(developmentRanking?.leafValueRanking?.accuracy) || 0);
  if (certificateKind === EVALUATOR_CERTIFICATE_KINDS.policyQ) {
    return Math.max(0, leafGap);
  }
  return Math.max(0,
    (Number(trainingRanking?.actionRanking?.neuralAccuracy) || 0)
      - (Number(developmentRanking?.actionRanking?.neuralAccuracy) || 0),
    leafGap
  );
}

function evaluatorArchitectureSelectionScore(input) {
  const action = input.ranking?.actionRanking || {};
  const leaf = input.ranking?.leafValueRanking || {};
  const phaseLowerBounds = [
    ...(input.certificateKind === EVALUATOR_CERTIFICATE_KINDS.policyQ
      ? []
      : Object.values(action.phaseBands || {}).map((item) =>
        Number(item.accuracyLowerBound))),
    ...Object.values(leaf.phaseBands || {}).map((item) =>
      evaluatorAuditAccuracyBound(
        item,
        input.confidenceBoundSource,
        "lower"
      ))
  ].filter(Number.isFinite);
  const worstStratumLowerBound = phaseLowerBounds.length
    ? Math.min(...phaseLowerBounds)
    : -1;
  const minimumAccuracy = input.certificateKind
    === EVALUATOR_CERTIFICATE_KINDS.policyQ
    ? Number(leaf.accuracy) || 0
    : Math.min(
      Number(action.neuralAccuracy) || 0,
      Number(leaf.accuracy) || 0
    );
  const gap = evaluatorGeneralizationGap(
    input.trainingRanking,
    input.ranking,
    input.certificateKind
  );
  const complexityPenalty = Math.log10(Math.max(10, Number(input.parameterCount) || 10)) * 0.001;
  const policyQSelection = input.certificateKind
    === EVALUATOR_CERTIFICATE_KINDS.policyQ
    ? policyQShadowSelectionSignal(leaf)
    : null;
  // Hard development eligibility dominates. Within eligible architectures,
  // Policy-Q follows the action-effect contract; binary leaf accuracy is only
  // a small reference signal for noisy opening phases. Robust-Action keeps the
  // original weakest-phase-first ranking.
  return (input.status?.eligible ? 1_000_000 : 0)
    + (policyQSelection
      ? policyQSelection.score
      : worstStratumLowerBound * 10_000 + minimumAccuracy * 1_000)
    + (Number(action.pairedImprovementLowerBound) || -1) * 100
    + (policyQSelection ? 0 : (
      Number(evaluatorAuditAccuracyBound(
        leaf,
        input.confidenceBoundSource,
        "lower"
      )) || 0
    ) * 100)
    - gap * 100
    - (Number(input.calibration?.brier) || 1) * 10
    - complexityPenalty
    - Math.log1p(Math.max(0, Number(input.inferenceMilliseconds) || 0)) * 0.001;
}

function rescorePolicyQShadowScreenGate(gate = {}) {
  const candidates = (gate.candidates || []).map((candidate) => {
    const ranking = {
      actionRanking: candidate.actionRanking || {},
      leafValueRanking: candidate.leafValueRanking || {}
    };
    const status = evaluatorDevelopmentAuditStatus(
      ranking.actionRanking,
      ranking.leafValueRanking,
      {
        certificateKind: EVALUATOR_CERTIFICATE_KINDS.policyQ,
        requirePerformance: false,
        confidenceBoundSource: "bootstrap-shadow"
      }
    );
    return {
      ...candidate,
      status,
      selectionScore: evaluatorArchitectureSelectionScore({
        certificateKind: EVALUATOR_CERTIFICATE_KINDS.policyQ,
        confidenceBoundSource: "bootstrap-shadow",
        status,
        ranking,
        trainingRanking: {
          actionRanking: candidate.trainingActionRanking || {},
          leafValueRanking: candidate.trainingLeafValueRanking || {}
        },
        calibration: candidate.calibration || {},
        parameterCount: candidate.parameterCount,
        inferenceMilliseconds:
          candidate.inferenceBenchmark?.meanMilliseconds
      })
    };
  });
  return {
    ...gate,
    passed: candidates.some((candidate) => candidate.status?.eligible === true),
    selected: null,
    candidates,
    compatibilityReuse: {
      version: 1,
      scope: "architecture-screen-training-and-audit-only",
      sourceContract: "policy-q-training-only-shadow-readiness-v1",
      targetContract: POLICY_Q_SHADOW_READINESS_CONTRACT,
      weightsRetrained: false,
      rankingRecomputed: false,
      statusAndSelectionScoreRecomputed: true,
      protectedDevelopmentOpened: false
    }
  };
}

async function evaluateEvaluatorConfirmationStage(options) {
  const selected = options.developmentGate?.selected;
  if (!selected?.checkpoint) {
    return {
      version: 2,
      passed: false,
      reasons: ["missing-frozen-development-evaluator"]
    };
  }
  const gateKey = checkpointHash({
    version: 10,
    protocol: "frozen-evaluator-confirmation-gate-v10",
    policyQFormalAuditContract: (options.certificateKind
      || EVALUATOR_CERTIFICATE_KINDS.robustAction)
      === EVALUATOR_CERTIFICATE_KINDS.policyQ
      ? POLICY_Q_FORMAL_AUDIT_CONTRACT
      : null,
    certificateKind: options.certificateKind
      || EVALUATOR_CERTIFICATE_KINDS.robustAction,
    bootstrapDatasetKey: options.bootstrapDatasetKey,
    evaluatorCheckpointHash: checkpointHash(selected.checkpoint),
    confirmationDataset: options.confirmationDataset.manifest
  });
  const gatePath = path.join(
    options.dataRoot,
    "evaluator-bootstrap",
    options.bootstrapDatasetKey,
    "stage-gates",
    `confirmation-${gateKey}.json`
  );
  const cached = await readCheckpoint(gatePath);
  if (cached?.version === 9 && cached.gateKey === gateKey) {
    return {
      ...cached,
      selected: await hydrateEvaluatorCandidate(cached.selected)
    };
  }
  options.progress.write({
    state: "training",
    stage: "evaluator-confirmation-gate",
    evaluatorTrainingReplica: selected.replica
  });
  const model = deserializeNeuralModel(selected.checkpoint);
  const beforeHash = neuralArtifactHash(model);
  const ranking = await evaluateIndependentRankingAudits(
    model,
    options.confirmationDataset,
    {
      batchSize: options.calibrationBatchSize,
      engineFingerprint: options.engineFingerprint,
      requireStructuredV2: true,
      requireFormalActionEvidence: options.certificateKind
        === EVALUATOR_CERTIFICATE_KINDS.robustAction,
      certificationRole: "confirmation",
      datasetKey: options.confirmationDataset?.manifest?.datasetKey
        || options.bootstrapDatasetKey
    }
  );
  const status = evaluatorDevelopmentAuditStatus(
    ranking.actionRanking,
    ranking.leafValueRanking,
    {
      requirePerformance: true,
      certificateKind: options.certificateKind
        || EVALUATOR_CERTIFICATE_KINDS.robustAction,
      minimumActionAccuracy: 0.6,
      minimumLeafAccuracy: 0.6,
      minimumPhaseAccuracy: 0.6,
      minimumPhaseAccuracyLowerBound: 0.45
    }
  );
  const afterHash = neuralArtifactHash(model);
  if (beforeHash !== afterHash) {
    throw new Error("Frozen evaluator changed during confirmation.");
  }
  const result = {
    version: 9,
    gateKey,
    protocol: "frozen-one_then-independent-confirmation-v3",
    certificateKind: options.certificateKind
      || EVALUATOR_CERTIFICATE_KINDS.robustAction,
    bootstrapDatasetKey: options.bootstrapDatasetKey,
    passed: status.eligible === true,
    selected: evaluatorCandidateWithoutCheckpoint(selected),
    dataset: options.confirmationDataset.manifest,
    actionRanking: ranking.actionRanking,
    leafValueRanking: ranking.leafValueRanking,
    status,
    evaluatedArtifactHash: beforeHash,
    completedAt: new Date().toISOString()
  };
  await writeCheckpoint(gatePath, result);
  return {
    ...result,
    selected
  };
}

function stableEvaluatorReplicaCandidates(audits, configuredReplicas) {
  const groups = new Map();
  for (const audit of audits || []) {
    const key = audit.baseInputHash
      || `${audit.epoch}:${audit.source || "unknown"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(audit);
  }
  const requiredEligible = Math.max(
    1,
    Math.ceil(Math.max(1, Number(configuredReplicas) || 1) * 2 / 3)
  );
  const representatives = [];
  for (const items of groups.values()) {
    const eligible = items.filter((item) => item.status?.eligible === true)
      .sort((left, right) =>
        Number(left.selectionScore) - Number(right.selectionScore)
          || Number(left.replica) - Number(right.replica));
    if (eligible.length < requiredEligible) continue;
    // Select the median successful replica, not the best development score.
    // This prevents a lucky initialization from winning merely because the
    // same development set was compared several times.
    representatives.push(eligible[Math.floor((eligible.length - 1) / 2)]);
  }
  return representatives;
}

function evaluatorDevelopmentAuditStatus(
  actionRanking = {},
  leafValueRanking = {},
  options = {}
) {
  const reasons = [];
  const policyQOnly = options.certificateKind
    === EVALUATOR_CERTIFICATE_KINDS.policyQ;
  const minimumActionAccuracy = Math.max(
    0.5,
    Number(options.minimumActionAccuracy) || 0.5
  );
  const minimumLeafAccuracy = Math.max(
    0.5,
    Number(options.minimumLeafAccuracy) || 0.5
  );
  const minimumPhaseAccuracy = Math.max(
    0.5,
    Number(options.minimumPhaseAccuracy) || 0.5
  );
  const minimumPhaseAccuracyLowerBound = Math.max(
    0.35,
    Number(options.minimumPhaseAccuracyLowerBound) || 0.35
  );
  const confidenceBoundSource = String(
    options.confidenceBoundSource || "conservative"
  );
  if (!policyQOnly && (!actionRanking.evaluatorPath
    || actionRanking.evaluatorPath !== leafValueRanking.evaluatorPath
    || JSON.stringify(actionRanking.evaluatorArchitecture || null)
      !== JSON.stringify(leafValueRanking.evaluatorArchitecture || null))) {
    reasons.push("action-ranking-evaluator-path");
  }
  if (!policyQOnly && actionRanking.comparator
      !== "default-ai-post-action-state-evaluator-v1") {
    reasons.push("action-ranking-comparator");
  }
  if (!policyQOnly && Number(actionRanking.decisions) < 50) {
    reasons.push("insufficient-action-ranking-decisions");
  }
  if (!policyQOnly && Number(actionRanking.contributingGames) < 20) {
    reasons.push("insufficient-action-ranking-games");
  }
  if (!policyQOnly && (actionRanking.weighting !== "deck-seat-macro"
    || actionRanking.bootstrap?.stratification !== "deck-seat-macro")) {
    reasons.push("action-ranking-not-deck-seat-macro");
  }
  if (!leafValueRanking.evaluatorPath
    || (!policyQOnly
      && leafValueRanking.evaluatorPath !== actionRanking.evaluatorPath)) {
    reasons.push("leaf-value-evaluator-path");
  }
  if (Number(leafValueRanking.decisions) < 50) {
    reasons.push("insufficient-leaf-ranking-decisions");
  }
  if (Number(leafValueRanking.contributingGames) < 20) {
    reasons.push("insufficient-leaf-ranking-games");
  }
  if (leafValueRanking.weighting !== "deck-seat-macro"
    || leafValueRanking.bootstrap?.stratification !== "deck-seat-macro") {
    reasons.push("leaf-ranking-not-deck-seat-macro");
  }
  for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
    const actionPhase = actionRanking.phaseBands?.[phase] || {};
    if (!policyQOnly && (Number(actionPhase.decisions) < 5
      || Number(actionPhase.contributingGames) < 5)) {
      reasons.push(`insufficient-action-ranking-phase-${phase}`);
    }
    const leafPhase = leafValueRanking.phaseBands?.[phase] || {};
    if (Number(leafPhase.decisions) < 12
      || Number(leafPhase.contributingGames) < 4) {
      reasons.push(`insufficient-leaf-ranking-phase-${phase}`);
    }
  }
  if (options.requirePerformance !== false) {
    const shadowRegretContract = policyQOnly
      && confidenceBoundSource === "bootstrap-shadow";
    const formalPolicyQContract = policyQOnly && !shadowRegretContract;
    if (!policyQOnly
      && !(Number(actionRanking.neuralAccuracy) >= minimumActionAccuracy)) {
      reasons.push("action-ranking-development-margin");
    }
    if (!policyQOnly && !(Number(actionRanking.neuralAccuracy)
        > Number(actionRanking.comparatorAccuracy))) {
      reasons.push("action-ranking-not-better-than-comparator");
    }
    if (!policyQOnly
      && !(Number(actionRanking.pairedImprovementLowerBound) > 0)) {
      reasons.push("action-ranking-improvement-unconfirmed");
    }
    const formalPolicyQStatus = formalPolicyQContract
      ? policyQFormalAuditStatus(
        leafValueRanking,
        undefined,
        {
          expectedDeckSeats: policyQExpectedDeckSeats(),
          expectedDeckSeatPhases: policyQExpectedDeckSeatPhases(),
          deckSeatPhaseOpportunityContract:
            "training-deck-seat-cartesian-v1"
        }
      )
      : null;
    if (formalPolicyQStatus) {
      leafValueRanking.formalPolicyQAudit = structuredClone(
        formalPolicyQStatus
      );
    }
    if (formalPolicyQStatus && !formalPolicyQStatus.eligible) {
      reasons.push(...formalPolicyQStatus.reasons);
    }
    const shadowActionEffectStatus = shadowRegretContract
      ? policyQShadowActionEffectGateStatus(leafValueRanking, options)
      : null;
    if (shadowActionEffectStatus && !shadowActionEffectStatus.eligible) {
      reasons.push(...shadowActionEffectStatus.reasons);
    } else if (!formalPolicyQContract && !shadowRegretContract
      && !(Number(leafValueRanking.accuracy) >= minimumLeafAccuracy)) {
      reasons.push("leaf-ranking-development-margin");
    }
    const leafAccuracyLowerBound = evaluatorAuditAccuracyBound(
      leafValueRanking,
      confidenceBoundSource,
      "lower"
    );
    if (!formalPolicyQContract && !shadowRegretContract
      && !(Number(leafAccuracyLowerBound) > 0.5)) {
      reasons.push("leaf-ranking-unconfirmed");
    }
    for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
      if (!policyQOnly && (
        !(Number(actionRanking.phaseBands?.[phase]
          ?.neuralAccuracy) >= minimumPhaseAccuracy)
        || !(Number(actionRanking.phaseBands?.[phase]
          ?.neuralAccuracyLowerBound) > minimumPhaseAccuracyLowerBound)
      )) {
        reasons.push(`action-ranking-phase-unconfirmed-${phase}`);
      }
      const leafPhase = leafValueRanking.phaseBands?.[phase] || {};
      const leafPhaseLowerBound = evaluatorAuditAccuracyBound(
        leafPhase,
        confidenceBoundSource,
        "lower"
      );
      if (!formalPolicyQContract && !shadowRegretContract
        && (!(Number(leafPhase.accuracy) >= minimumPhaseAccuracy)
        || !(Number(leafPhaseLowerBound)
          > minimumPhaseAccuracyLowerBound))) {
        reasons.push(`leaf-ranking-phase-unconfirmed-${phase}`);
      }
    }
  }
  return {
    version: 4,
    eligible: reasons.length === 0,
    reasons,
    confidenceBoundSource
  };
}

function policyQExpectedDeckSeats() {
  return trainingDeckIds.flatMap((deckId) => [
    `${deckId}:p1`,
    `${deckId}:p2`
  ]);
}

function policyQExpectedDeckSeatPhases() {
  return policyQExpectedDeckSeats().flatMap((deckSeat) =>
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => `${deckSeat}::${phase}`));
}

function evaluatorAuditAccuracyBound(
  summary = {},
  source = "conservative",
  side = "lower"
) {
  if (source === "bootstrap-shadow") {
    const intervalKey = side === "upper"
      ? "bootstrapUpperBound"
      : "bootstrapLowerBound";
    const directValue = summary?.accuracyInterval?.[intervalKey];
    const direct = directValue == null ? Number.NaN : Number(directValue);
    if (Number.isFinite(direct)) return direct;
    const advantageValue = summary?.bootstrap?.[
      side === "upper" ? "upperBound" : "lowerBound"
    ];
    const advantage = advantageValue == null
      ? Number.NaN
      : Number(advantageValue);
    if (Number.isFinite(advantage)) return 0.5 + advantage;
    return null;
  }
  const directValue = summary?.[
    side === "upper" ? "accuracyUpperBound" : "accuracyLowerBound"
  ];
  const direct = directValue == null ? Number.NaN : Number(directValue);
  return Number.isFinite(direct) ? direct : null;
}

function checkpointHash(checkpoint) {
  return createHash("sha256").update(JSON.stringify(checkpoint)).digest("hex");
}

function neuralContinuationLineage(model) {
  return {
    artifactHash: neuralArtifactHash(model),
    behaviorHash: neuralBehaviorHash(model),
    generation: Number(model?.generation) || 0,
    knowledgeHash: deterministicValueDigest(model?.knowledge || null)
  };
}

function trainingDeckConfigurationLineage(deck) {
  const cardIdentity = (card) =>
    card?.id || card?.cardId || card?.instanceId || String(card || "");
  const cardSequence = (primary, fallback) =>
    (Array.isArray(primary) ? primary : Array.isArray(fallback) ? fallback : [])
      .map(cardIdentity);
  return {
    id: deck?.id || null,
    legend: cardIdentity(deck?.legend),
    battlefields: cardSequence(
      deck?.battlefields,
      deck?.availableBattlefields
    ),
    runes: cardSequence(deck?.runes),
    main: cardSequence(deck?.main, deck?.mainDeck),
    sideboard: cardSequence(deck?.sideboard)
  };
}

function neuralCheckpointModelHash(checkpoint) {
  if (!checkpoint) return null;
  return checkpointHash({
    version: checkpoint.version,
    generation: checkpoint.generation,
    gamesTrained: checkpoint.gamesTrained,
    architecture: checkpoint.architecture,
    weights: checkpoint.weights
  });
}

function isCurrentEngineValidatedCheckpoint(checkpoint, expectedEngineFingerprint) {
  if (!checkpoint || checkpoint.metadata?.engineFingerprint !== expectedEngineFingerprint) return false;
  if (checkpoint.metadata?.engineValidationStatus === "warm-start-unvalidated"
    || checkpoint.metadata?.engineValidationStatus === "current-engine-candidate"
    || checkpoint.metadata?.engineValidationStatus === "diagnostic-only"
    || checkpoint.metadata?.warmStart?.requiresCurrentEngineRevalidation === true) return false;
  return true;
}

function migrateVerifiedCompatibleCheckpoint(
  checkpoint,
  sourceFingerprint,
  targetFingerprint,
  verified
) {
  if (!verified || !checkpoint
    || !sourceFingerprint
    || sourceFingerprint === targetFingerprint
    || checkpoint.metadata?.engineFingerprint !== sourceFingerprint
    || checkpoint.metadata?.engineValidationStatus === "diagnostic-only") {
    return null;
  }
  checkpoint.metadata = compatibleRuntimeMetadata(
    checkpoint.metadata,
    sourceFingerprint,
    targetFingerprint
  );
  return checkpoint;
}

function migrateVerifiedCompatibleModel(
  model,
  sourceFingerprint,
  targetFingerprint,
  verified
) {
  if (!model || model.metadata?.engineFingerprint === targetFingerprint) {
    return model;
  }
  if (!verified || !sourceFingerprint
    || sourceFingerprint === targetFingerprint
    || model.metadata?.engineFingerprint !== sourceFingerprint
    || model.metadata?.engineValidationStatus === "diagnostic-only") {
    return model;
  }
  model.metadata = compatibleRuntimeMetadata(
    model.metadata,
    sourceFingerprint,
    targetFingerprint
  );
  return model;
}

function compatibleRuntimeMetadata(
  metadata,
  sourceFingerprint,
  targetFingerprint
) {
  const prior = metadata || {};
  return {
    ...prior,
    engineFingerprint: targetFingerprint,
    engineValidationStatus:
      prior.engineValidationStatus === "warm-start-unvalidated"
        || prior.engineValidationStatus === "current-engine-candidate"
        ? prior.engineValidationStatus
        : "current-engine-validated",
    runtimeCompatibilityMigration: {
      version: 1,
      migratedAt: new Date().toISOString(),
      fromEngineFingerprint: sourceFingerprint,
      toEngineFingerprint: targetFingerprint,
      scope: "audit-stratum-and-evaluator-certification-only",
      preserved: [
        "weights",
        "calibration",
        "knowledge",
        "optimizer-lineage"
      ]
    }
  };
}

function isCurrentEngineValidatedModel(model, expectedEngineFingerprint) {
  if (!model || model.metadata?.engineFingerprint !== expectedEngineFingerprint) return false;
  if (model.metadata?.engineValidationStatus === "warm-start-unvalidated"
    || model.metadata?.engineValidationStatus === "current-engine-candidate"
    || model.metadata?.engineValidationStatus === "diagnostic-only"
    || model.metadata?.warmStart?.requiresCurrentEngineRevalidation === true) return false;
  return true;
}

function isTrustedLearnerCheckpoint(checkpoint, trustedChampionCheckpoint) {
  if (!checkpoint) return false;
  if (trustedChampionCheckpoint
    && neuralCheckpointModelHash(checkpoint) === neuralCheckpointModelHash(trustedChampionCheckpoint)) return true;
  if (checkpoint.metadata?.promoted === true) return true;
  return checkpoint.metadata?.learnerAdvanced === true
    && checkpoint.metadata?.learnerAdvanceGate?.passed === true
    && checkpoint.metadata?.evaluatedModelHash === neuralCheckpointModelHash(checkpoint);
}

function mixedAnchorModels(parentLearner, stableChampion, weights) {
  const entries = [
    { model: parentLearner, weight: Math.max(0, Number(weights?.learnerWeight) || 0) },
    { model: stableChampion, weight: Math.max(0, Number(weights?.championWeight) || 0) }
  ];
  const unique = new Map();
  for (const entry of entries) {
    if (!entry.model || !(entry.weight > 0)) continue;
    const identity = neuralModelIdentity(entry.model);
    const existing = unique.get(identity);
    if (existing) existing.weight += entry.weight;
    else unique.set(identity, { ...entry });
  }
  return [...unique.values()];
}

function summarizeAiModelReference(model) {
  return {
    generation: model?.generation ?? null,
    trainingIteration: model?.metadata?.trainingIteration ?? null,
    gamesTrained: model?.gamesTrained ?? 0,
    trainedAt: model?.metadata?.trainedAt || null
  };
}

function compactEvaluation(evaluation) {
  return {
    games: Number(evaluation?.games) || 0,
    completed: Number(evaluation?.completed) || 0,
    invalidGames: Number(evaluation?.invalidGames) || 0,
    candidateWins: Number(evaluation?.candidateWins) || 0,
    winRate: Number(evaluation?.winRate) || 0,
    wilsonLowerBound: Number(evaluation?.wilsonLowerBound) || 0,
    seatGap: Number(evaluation?.seatGap) || 0,
    conditionGap: Number(evaluation?.conditionGap) || 0,
    stability: evaluation?.stability || null,
    deckStats: evaluation?.deckStats || {}
  };
}

function mapToArray(map, length) {
  return Array.from({ length }, (_, index) => map.get(index));
}

function evaluateRetentionByDeck(model, trajectories) {
  const grouped = new Map();
  for (const trajectory of trajectories) {
    const key = trajectory.deckId || "unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(trajectory);
  }
  return Object.fromEntries([...grouped].map(([deckId, items]) => {
    const metrics = evaluateBehaviorCloning(model, items, { batchSize: 8 });
    const correctionTrajectories = items.map((trajectory) => ({
      ...trajectory,
      steps: (trajectory.steps || [])
        .filter((step) => step.teacherLabelVersion != null
          && step.teacherCorrectionEligible === true
          && step.teacherVerificationStatus === "verified"
          && step.teacherPolicyEligible === true
          && Number(step.teacherIndex) !== Number(step.selectedIndex))
        .map((step) => ({
          ...step,
          selectedIndex: step.teacherIndex,
          selectedActionKey: step.legalActionKeys?.[step.teacherIndex] || step.selectedActionKey,
          imitation: true
        }))
    })).filter((trajectory) => trajectory.steps.length);
    const correctionMetrics = correctionTrajectories.length
      ? evaluateBehaviorCloning(model, correctionTrajectories, { batchSize: 8 })
      : null;
    return [deckId, {
      ...metrics,
      verifiedCorrectionSteps: correctionMetrics?.decisionSteps || 0,
      verifiedCorrectionAccuracy: correctionMetrics?.decisionAccuracy ?? null,
      verifiedCorrectionPolicyLoss: correctionMetrics?.policyLoss ?? null
    }];
  }));
}

function summarizeResourceReservations(summaries) {
  const outcomes = summaries.flatMap((summary) => summary.resourceReservationOutcomes || []);
  const decisions = summaries.reduce((sum, summary) => sum + (summary.resourceReservationDecisions || 0), 0);
  const targetsUsed = summaries.reduce((sum, summary) => sum + (summary.resourceReservationTargetsUsed || 0), 0);
  const beneficial = summaries.reduce((sum, summary) => sum + (summary.beneficialResourceReservations || 0), 0);
  const harmful = summaries.reduce((sum, summary) => sum + (summary.harmfulResourceReservations || 0), 0);
  return {
    version: 1,
    decisions,
    targetsUsed,
    beneficial,
    harmful,
    targetUseRate: decisions ? targetsUsed / decisions : 0,
    beneficialRate: decisions ? beneficial / decisions : 0,
    harmfulRate: decisions ? harmful / decisions : 0,
    averageDiagnosticReward: outcomes.length ? outcomes.reduce((sum, outcome) => sum + (Number(outcome?.result?.learningReward) || 0), 0) / outcomes.length : 0,
    counterfactualCoverage: outcomes.length
      ? outcomes.filter((outcome) => outcome.counterfactual).length / outcomes.length
      : 0
  };
}

function summarizeHandOpportunities(summaries) {
  const outcomes = summaries.flatMap((summary) => summary.handOpportunityOutcomes || []);
  const byCard = {};
  for (const outcome of outcomes) {
    const key = outcome.cardNumber || outcome.cardName || "unknown";
    const card = byCard[key] ||= {
      cardNumber: outcome.cardNumber || null,
      cardName: outcome.cardName || null,
      observations: 0,
      stale: 0,
      harmful: 0,
      used: 0,
      regretTotal: 0
    };
    card.observations += 1;
    card.stale += outcome.result?.stale ? 1 : 0;
    card.harmful += outcome.result?.harmful ? 1 : 0;
    card.used += outcome.used ? 1 : 0;
    card.regretTotal += Number(outcome.result?.reservationRegret) || 0;
  }
  const cards = Object.values(byCard).map((card) => ({
    ...card,
    useRate: card.observations ? card.used / card.observations : 0,
    harmfulRate: card.observations ? card.harmful / card.observations : 0,
    averageReservationRegret: card.observations ? card.regretTotal / card.observations : 0
  })).sort((left, right) => right.harmful - left.harmful
    || right.averageReservationRegret - left.averageReservationRegret
    || String(left.cardNumber).localeCompare(String(right.cardNumber)));
  const stale = outcomes.filter((outcome) => outcome.result?.stale).length;
  const harmful = outcomes.filter((outcome) => outcome.result?.harmful).length;
  const unplayableDormant = outcomes.filter((outcome) => outcome.result?.unplayableDormancy).length;
  return {
    version: 1,
    observations: outcomes.length,
    stale,
    harmful,
    unplayableDormant,
    staleRate: outcomes.length ? stale / outcomes.length : 0,
    harmfulRate: outcomes.length ? harmful / outcomes.length : 0,
    averageReservationRegret: outcomes.length
      ? outcomes.reduce((sum, outcome) => sum + (Number(outcome.result?.reservationRegret) || 0), 0) / outcomes.length
      : 0,
    worstCards: cards.slice(0, 12)
  };
}

function summarizeCollectionMix(summaries) {
  const modes = {};
  let mirrors = 0;
  let crossDeck = 0;
  for (const summary of summaries) {
    const mode = summary.deckCurriculum?.mode || "unknown";
    modes[mode] = (modes[mode] || 0) + 1;
    if (summary.deckIds?.[0] === summary.deckIds?.[1]) mirrors += 1;
    else crossDeck += 1;
  }
  return {
    version: 1,
    games: summaries.length,
    mirrors,
    crossDeck,
    mirrorRate: summaries.length ? mirrors / summaries.length : 0,
    modes
  };
}

function summarizeTurningPoints(summaries) {
  const counts = {};
  for (const summary of summaries) {
    for (const [kind, count] of Object.entries(summary.turningPoints || {})) counts[kind] = (counts[kind] || 0) + count;
  }
  return { version: 1, counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}

function uniqueNeuralModels(models) {
  const seen = new Set();
  return models.filter((model) => {
    const identity = neuralModelIdentity(model);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function neuralModelIdentity(model) {
  return `${model?.generation ?? "none"}:${model?.metadata?.trainedAt || "untrained"}:${model?.gamesTrained || 0}`;
}

function prioritizedLeagueSampling(learnerModel, opponents) {
  const prior = learnerModel?.metadata?.payoffMatrix?.opponents || {};
  const records = opponents.map((opponent) => {
    const identity = neuralModelIdentity(opponent);
    const evidence = prior[identity] || null;
    const games = Number(evidence?.games) || 0;
    const winRate = games ? Math.max(0, Math.min(1, Number(evidence.winRate) || 0)) : 0.5;
    // Prefer opponents near the current decision boundary, add pressure from
    // opponents that beat the learner, and deliberately explore unknown rows.
    const closeness = 4 * winRate * (1 - winRate);
    const weakness = Math.max(0, 0.5 - winRate) * 2;
    const exploration = games ? 0 : 0.75;
    return {
      identity,
      generation: opponent?.generation ?? null,
      games,
      winRate,
      rawWeight: 0.25 + closeness + weakness + exploration
    };
  });
  const total = records.reduce((sum, item) => sum + item.rawWeight, 0) || 1;
  const weights = records.map((item) => item.rawWeight / total);
  return {
    version: 1,
    mode: "pfsp-boundary-and-weakness",
    weights,
    opponents: records.map((item, index) => ({ ...item, weight: weights[index] }))
  };
}

function updateLeaguePayoffMatrix(previous, opponents, evaluation) {
  const entries = { ...(previous?.opponents || {}) };
  for (let index = 0; index < opponents.length; index += 1) {
    const opponent = opponents[index];
    const result = evaluation?.results?.[index];
    if (!result) continue;
    const identity = neuralModelIdentity(opponent);
    entries[identity] = {
      identity,
      generation: opponent?.generation ?? null,
      trainingIteration: opponent?.metadata?.trainingIteration ?? null,
      games: Number(result.naturallyCompleted ?? result.completed) || 0,
      wins: Number(result.candidateWins) || 0,
      winRate: Number(result.winRate) || 0,
      wilsonLowerBound: Number(result.wilsonLowerBound) || 0,
      adjudicatedGames: Number(result.adjudicatedGames) || 0,
      measuredAt: new Date().toISOString()
    };
  }
  return {
    version: 1,
    method: "natural-completion-payoff-matrix",
    opponents: entries
  };
}
