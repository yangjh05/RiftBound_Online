import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cards, decklists, DOMAINS, makeRune } from "../src/cards.mjs";
import { confirmFirstPlayer, createGame, draw, invalidateBottomDeckKnowledge, recordPublicTurnEvent, recycleMainDeckCards, selectChampion } from "../src/engine.mjs";
import { DECK_RULES } from "../src/decks/rules.mjs";
import { actionKey, activeActorId, applyAiAction, enumerateAiPolicyActions, enumerateLegalActions } from "../src/ai/actions.mjs";
import { inferOpponentDeckBelief } from "../src/ai/belief.mjs";
import { mutateBattlefieldSuite, mutateCardPackage, mutateDeck, mutateRuneDistribution, mutateSideboardPackage } from "../src/ai/deckbuilding.mjs";
import { ACTION_DIM, LEGACY_ACTION_DIM, CARD_VOCABULARY, MAX_ACTIONS, encodeAction, encodeActionSet, encodeState, STATE_DIM, actionStage, cardIndex, selectHierarchicalActions } from "../src/ai/neural/encoding.mjs";
import {
  EVALUATOR_AUDIT_CORE_ACTION_CLASSES,
  EVALUATOR_AUDIT_PHASE_BANDS,
  EVALUATOR_AUDIT_STRATUM_VERSION,
  evaluatorAuditActionClass,
  evaluatorAuditOpportunityActionClasses,
  evaluatorAuditPhaseBand,
  normalizeEvaluatorAuditStratum,
  reclassifyTrajectoryAuditStrata
} from "../src/ai/neural/audit-strata.mjs";
import { actionFeatures, DEFAULT_AI_MODEL, scoreActions } from "../src/ai/policy.mjs";
import { createNeuralModel, createNeuralSession, deserializeNeuralModel, estimateEncodedNeuralValue, estimateEvidenceNeuralValue, evaluatePpoBatchPolicyRatios, forwardNeural, NEURAL_MODEL_VERSION, serializeNeuralModel, trainPpoBatch, trainTeacherProposalValueBatch } from "../src/ai/neural/model.mjs";
import {
  attachEvaluatorArchitecture,
  EVALUATOR_ARCHITECTURE_SPECS,
  EVALUATOR_TARGET_HEADS,
  evaluatorLayerNames,
  evaluatorPathId,
  evaluatorRequiresStructuredV2,
  structuredStateTokens
} from "../src/ai/neural/evaluator-architecture.mjs";
import {
  createPublicStructuredEvidenceTransition,
  createPublicStructuredEvidenceSnapshot,
  encodePublicStructuredEvidence,
  STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT,
  STRUCTURED_EVIDENCE_SCHEMA_VERSION,
  validPublicStructuredEvidenceSnapshot
} from "../src/ai/neural/structured-evidence.mjs";
import { tf } from "../src/ai/neural/tf-runtime.mjs";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { createCollectionDescriptor, createEvaluationDescriptor, inspectCollectedGames, loadAvailablePersistedCollection, loadCompletedCollection, loadEvaluationGames, loadGenerationResume, loadPersistedCollection, saveCollectedGame, saveCompletedCollection, saveEvaluationGame, saveGenerationResume } from "../src/ai/neural/training-resume.mjs";
import { determinizationStatus, determinizeGame, hydrateActionAuditRolloutResults, mergeActionAuditRolloutResults, pairedIndependentTerminalActionAudit, pairedTerminalLeafValuePairs, rolloutAlternatives, serializeActionAuditRolloutResults } from "../src/ai/rollout.mjs";
import { pairedBinaryDifferenceInterval } from "../src/ai/neural/paired-action-effect-statistics.mjs";
import { actionAuditTeacherQuerySchedule, adjudicateEvaluationGame, applyGeneralizedAdvantageEstimation, applyResolvedSideboardSwap, auditEvaluationScheduleSymmetry, classifyTeacherCorrectionPoint, criticalTacticalDecisionProfile, enumerateSideboardActions, evaluateNeuralModels, evaluationConditionSchedule, fullHeuristicScoresForActions, independentActionAuditQueryActionClass, leagueGamesPerOpponent, pairedEvaluationPlayerSeeds, playNeuralBestOfThree, scheduledCurriculumDeckPair, scheduledDeckPair, scheduledEvaluationDeckPair, scheduledEvaluationMatrixPair, scheduledTrainingDeckPair, seededRandom, selectIndependentActionAuditCandidatePool, selectUnderperformingDeckCurriculum, selfPlayComparisonSchedule, sideboardSwapPreservesStartingChampion, teacherAlternativeValueSupervision, teacherAuditCollectionBudgetExhausted, teacherAuditPhaseFocusAllowsQuery, teacherLeafValueAuditReference, terminalRewards, trainingShapingPotential } from "../src/ai/neural/selfplay.mjs";
import {
  TEACHER_LABEL_VERSION,
  finalizeTeacherVerification,
  independentActionAuditSeedBank,
  independentActionAuditStructuredV2CompanionFailure,
  independentActionAuditFutilityReasons,
  independentActionAuditPreselectionFutilityReasons,
  independentLeafAuditSeed,
  runIndependentActionAuditSeedBatch,
  simulationTeacherDecision,
  strategicActionResourceDemand,
  teacherActionVerification,
  teacherDecisionConfidence,
  teacherEvaluatorComparison,
  teacherPlanningProfile
} from "../src/ai/neural/teacher.mjs";
import {
  independentActionAuditNearMissRescueEligible
} from "../scripts/action-audit-rescue.mjs";
import { opponentResponseProfile, strategicResourceCommitment } from "../src/ai/resource-strategy.mjs";
import { completeResourceReservation, createResourceReservationIntent, observeResourceReservationAction, resourceReservationResolutionReason } from "../src/ai/resource-reservation.mjs";
import { completeHandOpportunityTracking, createHandOpportunityTracker, observeHandOpportunityWindow, recordHandOpportunityDecision, resolveHandOpportunityCards } from "../src/ai/hand-opportunity.mjs";
import { championMatchesLegend } from "../src/engine/setup.mjs";
import { normalizeMetaSnapshot } from "../src/ai/meta.mjs";
import { encodeHumanDecisionSample, hydrateHumanReplayTrajectories } from "../src/ai/human-data.mjs";
import { CARD_POOL_FORMATS, cardAllowedInPool, cardNumbersForPool } from "../src/card-pools.mjs";
import { buildMetaPreset, ORIGINS_HOUSTON_2025 } from "../src/ai/meta-presets.mjs";
import { weightedDeckPick } from "../src/ai/neural/imitation.mjs";
import { buildSelfPlayTaskQueue, collectProcessPoolSelfPlay, resolveSelfPlayTaskOptions, selfPlayChildExecArgv, selfPlayDynamicScaleDecision, selfPlayProcessEnvironment, selfPlayProcessLimits, selfPlayTaskRetryAllowed, selfPlayWorkerRetryDelayMs, shouldRecycleSelfPlayWorker } from "../scripts/ai-selfplay-process-pool.mjs";
import {
  createActionAuditOptionsHandoff,
  discardActionAuditOptionsHandoff,
  readActionAuditOptionsHandoff
} from "../scripts/ai-action-audit-options-handoff.mjs";
import {
  EVALUATOR_BOOTSTRAP_STAGE_MAX_ATTEMPTS,
  evaluatorBootstrapStageAttemptDecision,
  hydrateEvaluatorBootstrapStageRequest,
  serializeEvaluatorBootstrapStageRequest
} from "../scripts/evaluator-bootstrap-stage-handoff.mjs";
import {
  actionAuditAdaptiveSeedChunkSize,
  actionAuditPoolShouldScaleUp,
  actionAuditSlotRetirementRequested,
  actionAuditSeedTaskChunks,
  actionAuditWorkerOptions,
  createAuditPool,
  detachedActionAuditFineRoleChunkGames,
  detachedActionAuditPipelineChunks,
  detachedActionAuditProcessCount,
  markActionAuditGameSkippedTargetSatisfied,
  persistFinalizedEvaluatorBootstrapGame,
  restoreExistingActionAuditSeedBatches,
  seedBatchTaskId,
  takePreferredActionAuditTask
} from "../scripts/detached-action-audit-coordinator.mjs";
import {
  adoptSelfPlayResultHandoff,
  consumeSelfPlayResultHandoff,
  createSelfPlayResultHandoff,
  readSelfPlayResultHandoffSummary
} from "../scripts/ai-selfplay-result-handoff.mjs";
import {
  createEvaluatorBootstrapResultIndex,
  EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION
} from "../scripts/evaluator-bootstrap-index.mjs";
import { migrateCompatibleCollection } from "../scripts/migrate-compatible-ai-collection.mjs";
import {
  EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES,
  migrateEvaluatorBootstrapStructuredEvidenceFingerprints,
  migratedEvaluatorBootstrapAllocationState,
  migratedCertificationRole
} from "../scripts/migrate-compatible-evaluator-bootstrap.mjs";
import { accumulateActionRankingAudit, accumulateLeafValueRankingAudit, advanceCorrectionLifecycleRecord, applyEvaluatorTrainingBalanceProfile, bootstrapGamePairedImprovements, bootstrapLeafActionEffectPopulationRisk, bootstrapStratifiedGamePairedImprovements, calibratedProbability, calibrateValueHead, calibrateValueSamples, createActionRankingAuditAccumulator, createEvaluatorTrainingBalanceProfile, createLeafValueRankingAuditAccumulator, evaluateActionRankingAudit, evaluateBehaviorCloning, evaluateCalibratedValueSamples, evaluatorConservativeRegretUpperBound, evaluatorValueTrainingSamples, evaluateLeafValueRankingAudit, finalizeActionRankingAudit, finalizeLeafValueRankingAudit, packPpoBatch, policyConditionedActionCorrectionTrajectories, restoreAdamOptimizer, serializeOptimizer, splitCalibrationTrajectoriesByGame, stratifiedChunkOrder, summarizeTrainingStrata, trainBehaviorCloning, trainEvaluatorFromAuditEvidence, trainEvaluatorValuePairBatch, trainRecurrentPpo } from "../src/ai/neural/trainer.mjs";
import { assessBehaviorCloningQuality, auditImitationDataset } from "../src/ai/neural/quality.mjs";
import {
  createEvaluatorCertificate,
  certifiedIndependentEvaluators,
  EVALUATOR_CERTIFICATE_KINDS,
  evaluatorCertificateStatus,
  neuralArtifactHash,
  neuralBehaviorHash,
  neuralEvaluatorCoreHash,
  neuralEvaluatorLeafHash,
  neuralEvaluatorModelHash,
  selectEvaluatorOnlyArtifact
} from "../src/ai/neural/evaluator-certification.mjs";
import {
  completedGameIndexMap,
  detachedActionAuditIsEnabled,
  evaluatorBootstrapActionAuditProcesses,
  evaluatorBootstrapMaximumActionAuditProcesses,
  evaluatorBootstrapActionCollectionStrategy,
  evaluatorBootstrapActionCertificationRole,
  evaluatorBootstrapActionCertificationRolePlan,
  evaluatorBootstrapActionRoleGameDemand,
  evaluatorBootstrapCollectionOptions,
  evaluatorBootstrapDatasetDescriptor,
  evaluatorBootstrapDiagnosticFocus,
  evaluatorBootstrapDiagnosticTaskFocus,
  evaluatorBootstrapDatasetKey,
  evaluatorBootstrapEvidenceCheckpointComplete,
  evaluatorBootstrapEvidenceRolesComplete,
  evaluatorBootstrapEvidenceRequirement,
  evaluatorBootstrapRuntimeAuditOptions,
  evaluatorBootstrapFocusDeckSeats,
  evaluatorBootstrapLeafCertificationRole,
  evaluatorBootstrapLeafCertificationRolePlan,
  evaluatorBootstrapLeafRoleGameDemand,
  evaluatorBootstrapResumeTaskLimit,
  evaluatorBootstrapSamplingMode,
  evaluatorBootstrapSamplingNeeds,
  evaluatorBootstrapSamplingModeNeedsWork,
  EVALUATOR_BOOTSTRAP_SAMPLING_MODES,
  EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES,
  EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS,
  EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS,
  loadEvaluatorBootstrap,
  materializeEvaluatorBootstrapRecords,
  nextEvaluatorBootstrapAllocation,
  pendingDetachedActionAuditRecords,
  partitionEvaluatorBootstrapRecords,
  selectBalancedEvaluatorBootstrapRecords,
  selectEvaluatorCertificationGames,
  summarizeEvaluatorCertificationTrajectories,
  summarizeEvaluatorBootstrap
} from "../scripts/evaluator-bootstrap.mjs";
import {
  EVALUATOR_EARLY_DIAGNOSTIC_CHECKPOINTS,
  bootstrapStratifiedGameAccuracyInterval,
  conservativeGameClusterAccuracyInterval,
  evaluatorEarlyDiagnosticSplitEvidenceRequirement,
  expandEvaluatorEarlyDiagnosticRequirement,
  evaluatorEarlyDiagnosticStatus,
  evaluatorEarlyDiagnosticTrainingRequirement,
  splitEvaluatorEarlyDiagnosticRecords,
  summarizeEvaluatorEarlyDiagnosticEvidence
} from "../scripts/evaluator-early-diagnostic.mjs";
import {
  classifyPolicyQShadowReadiness,
  expandPolicyQShadowReadinessRequirement,
  POLICY_Q_SHADOW_READINESS_GRID,
  POLICY_Q_FORMAL_AUDIT_CONTRACT,
  POLICY_Q_FORMAL_AUDIT_REQUIREMENTS,
  policyQFormalAuditStatus,
  policyQShadowActionEffectGateStatus,
  policyQShadowCollectionRoles,
  policyQShadowConfigurationGrid,
  policyQShadowEpochsForArchitecture,
  policyQShadowLegacyReadinessGridHash,
  policyQShadowPhaseAuditStatus,
  policyQShadowPhasePasses,
  policyQShadowRegretAlternativePasses,
  policyQShadowSelectionSignal,
  policyQShadowReadinessDemand,
  policyQShadowReadinessGridHash,
  selectPolicyQShadowArchitectures,
  selectPolicyQShadowConfiguration
} from "../scripts/evaluator-policy-q-readiness.mjs";
import {
  ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
  ACTION_RANKING_AUDIT_REFERENCE_VERSION,
  ACTION_RANKING_REFERENCE_CONTRACT,
  ACTION_RANKING_REFERENCE_VERSION,
  createActionRankingAuditReference,
  createActionRankingReference,
  createLeafValueReference,
  LEAF_VALUE_REFERENCE_CONTRACT,
  LEAF_VALUE_REFERENCE_VERSION,
  validActionRankingAuditReference,
  validActionRankingReference,
  validLeafAuditSamplingFrame,
  validLeafValueReference
} from "../src/ai/neural/action-ranking-reference.mjs";
import {
  createInformationSetHash,
  stableTeacherCorrectionId
} from "../src/ai/neural/teacher-contract.mjs";
import { FOCUSED_TRAINING_DECK_IDS, resolveTrainingDecks, sameLegendIdentity } from "../src/ai/training-decks.mjs";
import { enumerateMulliganPlans, mulliganPlanProfile } from "../src/ai/mulligan.mjs";
import { observeGame } from "../src/ai/observation.mjs";
import { remainingDeckProfile } from "../src/ai/deck-memory.mjs";
import { extractTurningPointReplays, mergeTurningPointReplays, sampleTurningPointReplays } from "../src/ai/neural/turning-point-replay.mjs";
import { tacticalActionProfile } from "../src/ai/action-tactics.mjs";
import {
  POSTMORTEM_REVIEW_VERSION,
  buildPostmortemReview,
  reviewDefeatPostmortems,
  selectSeparatedPostmortemCandidates
} from "../src/ai/neural/postmortem.mjs";
import { PROOF_LABEL_VERSION, proofTeacherDecision } from "../src/ai/neural/proof-teacher.mjs";

const decks = Object.values(decklists);

function policyQTestRiskInterval(
  pointEstimate,
  percentileUpperBound,
  concentrationUpperBound,
  clusterClopperPearsonUpperBound = null,
  lowerBound = Math.max(0, Number(pointEstimate) - 0.03)
) {
  return {
    pointEstimate,
    lowerBound,
    percentileUpperBound,
    concentrationUpperBound,
    clusterClopperPearsonUpperBound,
    upperBound: Math.max(
      percentileUpperBound,
      concentrationUpperBound,
      clusterClopperPearsonUpperBound || 0
    )
  };
}

function policyQTestNaturalRiskGroup({
  comparisons = 40,
  contributingGames = 24,
  regret = 0.12,
  regretUpper = 0.2,
  aboveThree = 0.1,
  aboveThreeUpper = 0.15,
  aboveFive = 0.05,
  aboveFiveUpper = 0.1,
  cvar = 0.12,
  cvarUpper = 0.2,
  riskAssessedComparisons = null,
  riskAssessedGames = null,
  riskAssessmentCoverage = null
} = {}) {
  const assessedComparisons = Math.min(
    comparisons,
    riskAssessedComparisons == null
      ? comparisons
      : Math.max(0, Number(riskAssessedComparisons) || 0)
  );
  const assessedGames = Math.min(
    contributingGames,
    riskAssessedGames == null
      ? contributingGames
      : Math.max(0, Number(riskAssessedGames) || 0)
  );
  const assessedCoverage = riskAssessmentCoverage == null
    ? comparisons > 0 ? assessedComparisons / comparisons : 0
    : Math.max(0, Math.min(1, Number(riskAssessmentCoverage) || 0));
  const meanRegret = policyQTestRiskInterval(
    regret,
    Math.min(regretUpper, regret + 0.03),
    regretUpper
  );
  const aboveThreePercentRate = policyQTestRiskInterval(
    aboveThree,
    Math.min(aboveThreeUpper, aboveThree + 0.02),
    aboveThreeUpper,
    Math.min(aboveThreeUpper, aboveThree + 0.04)
  );
  const aboveFivePercentRate = policyQTestRiskInterval(
    aboveFive,
    Math.min(aboveFiveUpper, aboveFive + 0.03),
    aboveFiveUpper,
    Math.min(aboveFiveUpper, aboveFive + 0.04)
  );
  const worstTenPercentCvar = policyQTestRiskInterval(
    cvar,
    Math.min(cvarUpper, cvar + 0.03),
    cvarUpper
  );
  return {
    comparisons,
    contributingGames,
    auditedComparisons: assessedComparisons,
    knownZeroComparisons: 0,
    riskAssessedComparisons: assessedComparisons,
    riskAssessedContributingGames: assessedGames,
    riskAssessmentCoverage: assessedCoverage,
    unavailableComparisons: Math.max(0, comparisons - assessedComparisons),
    populationRegretUpperBound: regret,
    populationRegretConfidenceUpperBound: regretUpper,
    populationEstimand: "ipw-per-decision-natural-policy-decision-pairs-v2",
    populationRiskBootstrap: {
      version: 2,
      method: "game-cluster-percentile-bootstrap-ipw-per-decision-v2",
      estimand: "per-decision",
      weighting: "inverse-propensity-per-decision-v1",
      samples: 500,
      contributingGames,
      decisions: comparisons,
      totalPopulationWeight: comparisons,
      maximumSampleWeight: 1,
      meanRegret,
      aboveThreePercentRate,
      aboveFivePercentRate,
      worstTenPercentCvar,
      cvarConcentration: {
        method: "game-cluster-bonferroni-cvar-excess-bernstein-v1",
        tailFraction: 0.1,
        familywiseAlpha: 0.05,
        thresholdAlpha: 0.05,
        upperBound: cvarUpper,
        selectedThreshold: 0.1,
        thresholds: [{
          threshold: 0.1,
          excessMean: 0.005,
          excessUpperBound: 0.01,
          cvarUpperBound: cvarUpper
        }]
      }
    },
    populationRegretTailRiskConfidence: {
      aboveThreePercentRate,
      aboveFivePercentRate,
      worstTenPercentCvar
    }
  };
}

function policyQTestSplitActionEffect({
  targetedAccuracy = 0.75,
  targetedLower = 0.5,
  targetedUpper = 0.9,
  targetedComparisons = 40,
  targetedGames = 24,
  natural = {}
} = {}) {
  const targetedGroup = {
    comparisons: targetedComparisons,
    contributingGames: targetedGames,
    decisive: Math.max(2, Math.floor(targetedComparisons * 0.3)),
    decisiveCoverage: 0.3,
    decisiveAccuracy: targetedAccuracy,
    decisiveAccuracyInterval: {
      lowerBound: targetedLower,
      upperBound: targetedUpper,
      contributingGames: Math.max(2, Math.floor(targetedGames / 2))
    }
  };
  const naturalGroup = policyQTestNaturalRiskGroup(natural);
  const phaseTargeted = {
    ...targetedGroup,
    comparisons: 8,
    contributingGames: 5,
    decisive: 3,
    decisiveAccuracyInterval: {
      ...targetedGroup.decisiveAccuracyInterval,
      contributingGames: 3
    }
  };
  const phaseNatural = policyQTestNaturalRiskGroup({
    ...natural,
    comparisons: 8,
    contributingGames: 5
  });
  const phases = Object.fromEntries(
    ["mulligan", "early", "mid", "late"].map((phase) => [
      phase,
      structuredClone(phaseTargeted)
    ])
  );
  const naturalPhases = Object.fromEntries(
    ["mulligan", "early", "mid", "late"].map((phase) => [
      phase,
      structuredClone(phaseNatural)
    ])
  );
  return {
    contract: "paired-action-effect-evaluator-regret-v15",
    targetedDecisiveAudit: {
      ...targetedGroup,
      evidenceSource: "paired-terminal-outcome-pairs-v1",
      auditDistribution: "teacher-selected-targeted",
      samplingContract: "teacher-selected-policy-decision-pair-v1",
      provenanceValidated: true,
      phaseBands: phases
    },
    naturalDistributionAudit: {
      ...naturalGroup,
      evidenceSource: "paired-terminal-outcome-pairs-v1",
      auditDistribution: "natural-policy-decision-pairs",
      samplingContract: "hash-priority-reservoir-policy-decision-v1",
      provenanceValidated: true,
      phaseBands: naturalPhases,
      deckSeats: {},
      deckSeatPhases: {}
    }
  };
}

test("Policy-Q shadow readiness seals protected roles and precommits its grid", () => {
  assert.deepEqual(policyQShadowCollectionRoles(), ["training"]);
  assert.equal(POLICY_Q_SHADOW_READINESS_GRID.finalReplicas, 3);
  assert.deepEqual(
    POLICY_Q_SHADOW_READINESS_GRID.learningRates,
    [0.00005, 0.0001, 0.0002]
  );
  assert.deepEqual(POLICY_Q_SHADOW_READINESS_GRID.epochs, [8, 12, 16]);
  assert.equal(policyQShadowReadinessGridHash().length, 64);
  assert.equal(policyQShadowLegacyReadinessGridHash().length, 64);
  assert.notEqual(
    policyQShadowLegacyReadinessGridHash(),
    policyQShadowReadinessGridHash()
  );
  assert.equal(
    EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.training
      .minimumStructuredV2LeafValuePairs,
    1500
  );
  assert.deepEqual(
    EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.training
      .minimumLeafValueReferenceGamesByPhase,
    { mulligan: 80, early: 80, mid: 80, late: 80 }
  );
  assert.equal(
    EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.development.minimumGames,
    200
  );
  assert.equal(
    EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.confirmation.minimumGames,
    220
  );
  assert.equal(
    EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS["final-audit"].minimumGames,
    300
  );
  assert.equal(
    POLICY_Q_FORMAL_AUDIT_REQUIREMENTS.targeted.minimumContributingGames,
    60
  );
  assert.equal(
    POLICY_Q_FORMAL_AUDIT_REQUIREMENTS.natural.minimumContributingGames,
    80
  );
});

test("Policy-Q shadow split is value-only and does not request action strata", () => {
  const requirement = evaluatorEarlyDiagnosticSplitEvidenceRequirement(
    EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.training,
    {
      role: "validation",
      validationFraction: 0.2,
      requireActionEvidence: false
    }
  );
  assert.equal(requirement.minimumActionReferences, 0);
  assert.deepEqual(requirement.minimumActionReferencesByPhase, {});
  assert.equal(requirement.minimumActionReferencesPerCoreClass, 0);
  assert.equal(requirement.minimumActionReferencesPerDeckSeat, 0);
  assert.equal(requirement.minimumActionReferencesPerDeckPhase, 0);

  const records = Array.from({ length: 8 }, () => ({
    resultIndex: {
      structuredV2ActionReferenceCount: 0,
      structuredV2ActionReferenceIdentities: [],
      actionReferenceIdentities: [],
      structuredV2LeafValuePairCount: 40,
      structuredV2LeafValuePhaseCoverage: {
        mulligan: 10,
        early: 10,
        mid: 10,
        late: 10
      },
      structuredV2LeafValueCoverage: {
        "deck-a:p1": 20,
        "deck-a:p2": 20
      },
      structuredV2LeafValueDeckPhaseCoverage: {
        "deck-a::mulligan": 10,
        "deck-a::early": 10,
        "deck-a::mid": 10,
        "deck-a::late": 10
      }
    }
  }));
  const summary = summarizeEvaluatorEarlyDiagnosticEvidence(records, {
    deckIds: ["deck-a"],
    requireStructuredV2: true,
    requireActionEvidence: false,
    requirement
  });
  assert.equal(summary.sufficient, true);
  assert.equal(summary.eligibleActionReferences, 0);
  assert.deepEqual(summary.missing.actionPhases, []);
  assert.deepEqual(summary.missing.actionClasses, []);
  assert.deepEqual(summary.missing.actionDeckSeats, []);
  assert.deepEqual(summary.missing.actionDeckPhases, []);
});

test("Policy-Q shadow readiness shortlists architectures and freezes an eligible configuration", () => {
  const specs = EVALUATOR_ARCHITECTURE_SPECS.slice(0, 3);
  const shortlisted = selectPolicyQShadowArchitectures([
    { architecture: specs[0], selectionScore: 10 },
    { architecture: specs[1], selectionScore: 30 },
    { architecture: specs[2], selectionScore: 20 }
  ], specs, 2);
  assert.deepEqual(shortlisted.map((item) => item.id), [specs[1].id, specs[2].id]);
  const selected = selectPolicyQShadowConfiguration([
    {
      architecture: specs[1],
      learningRate: 0.0001,
      epochs: 8,
      gate: { passed: true, selected: { selectionScore: 40 } }
    },
    {
      architecture: specs[2],
      learningRate: 0.00005,
      epochs: 12,
      gate: { passed: true, selected: { selectionScore: 60 } }
    },
    {
      architecture: specs[0],
      learningRate: 0.0002,
      epochs: 16,
      gate: { passed: false, selected: { selectionScore: 100 } }
    }
  ]);
  assert.equal(selected.architecture.id, specs[2].id);
  assert.equal(selected.epochs, 12);
});

test("Policy-Q shadow configuration grid preserves family-specific exposure", () => {
  const architectures = [
    { id: "structured-set-v1-128", family: "structured-set-v1" },
    { id: "structured-set-v2-128", family: "structured-set-v2" },
    { id: "structured-attention-v2-128", family: "structured-attention-v2" }
  ];
  const configurations = policyQShadowConfigurationGrid(architectures);
  assert.equal(configurations.length, 9);
  assert.deepEqual(
    configurations.map((item) => item.ordinal),
    [1, 2, 3, 4, 5, 6, 7, 8, 9]
  );
  assert.deepEqual(
    configurations.filter((item) => item.architecture.id
      === "structured-set-v1-128").map((item) => item.epochs),
    [8, 8, 8]
  );
  assert.deepEqual(
    configurations.filter((item) => item.architecture.id
      === "structured-set-v2-128").map((item) => item.epochs),
    [16, 16, 16]
  );
  assert.deepEqual(
    configurations.filter((item) => item.architecture.id
      === "structured-attention-v2-128").map((item) => item.epochs),
    [16, 16, 16]
  );
  assert.equal(new Set(configurations.map((item) =>
    item.configurationId)).size, configurations.length);
});

test("Policy-Q shadow shortlist preserves legacy, set-v2, and attention-v2 families", () => {
  const shortlisted = selectPolicyQShadowArchitectures(
    EVALUATOR_ARCHITECTURE_SPECS.map((architecture, index) => ({
      architecture,
      selectionScore: 100 - index
    })),
    EVALUATOR_ARCHITECTURE_SPECS,
    3
  );
  assert.deepEqual(
    shortlisted.map((item) => item.family),
    ["flat-v1", "structured-set-v2", "structured-attention-v2"]
  );
  assert.deepEqual(
    policyQShadowEpochsForArchitecture(shortlisted[0]),
    [8]
  );
  assert.deepEqual(
    policyQShadowEpochsForArchitecture(shortlisted[1]),
    [16]
  );
  assert.deepEqual(
    policyQShadowEpochsForArchitecture(shortlisted[2]),
    [16]
  );
});

test("Policy-Q shadow outcome preserves uncertainty unless replicas repeat an optimistic failure", () => {
  const candidate = (replica, upperBound, options = {}) => ({
    architecture: {
      id: options.architecture || "structured-set-v1-128"
    },
    replica,
    leafValueRanking: {
      accuracyUpperBound: upperBound,
      phaseBands: {
        mulligan: { accuracyUpperBound: 0.8 },
        early: { accuracyUpperBound: options.earlyUpperBound ?? 0.8 },
        mid: { accuracyUpperBound: 0.8 },
        late: { accuracyUpperBound: 0.8 }
      },
      actionEffectRanking: options.actionEffect || null
    }
  });
  const failedEffect = policyQTestSplitActionEffect({
    targetedAccuracy: 0.2,
    targetedLower: 0.05,
    targetedUpper: 0.3
  });
  const safeEffect = policyQTestSplitActionEffect();
  const underAssessedNaturalEffect = policyQTestSplitActionEffect({
    natural: {
      regret: 0.65,
      regretUpper: 1,
      aboveThree: 0.9,
      aboveThreeUpper: 1,
      aboveFive: 0.9,
      aboveFiveUpper: 1,
      cvar: 1,
      cvarUpper: 1,
      riskAssessedComparisons: 2,
      riskAssessedGames: 2,
      riskAssessmentCoverage: 0.125
    }
  });
  assert.equal(classifyPolicyQShadowReadiness({
    candidates: [candidate(0, 0.61), candidate(1, 0.62)]
  }).outcome, "inconclusive");
  assert.equal(classifyPolicyQShadowReadiness({
    candidates: [
      candidate(0, 0.61, { actionEffect: failedEffect }),
      candidate(1, 0.62, { actionEffect: failedEffect })
    ]
  }).outcome, "structural-failure");
  assert.equal(classifyPolicyQShadowReadiness({
    candidates: [
      candidate(0, 0.61, { actionEffect: underAssessedNaturalEffect }),
      candidate(1, 0.62, { actionEffect: underAssessedNaturalEffect })
    ]
  }).outcome, "inconclusive");
  assert.equal(classifyPolicyQShadowReadiness({
    candidates: [
      candidate(0, 0.61, {
        architecture: "architecture-a",
        actionEffect: failedEffect
      }),
      candidate(1, 0.61, {
        architecture: "architecture-a",
        actionEffect: failedEffect
      }),
      candidate(0, 0.8, {
        architecture: "architecture-b",
        earlyUpperBound: 0.64,
        actionEffect: safeEffect
      }),
      candidate(1, 0.8, {
        architecture: "architecture-b",
        earlyUpperBound: 0.64,
        actionEffect: safeEffect
      })
    ]
  }).outcome, "inconclusive");
  assert.equal(classifyPolicyQShadowReadiness({ passed: true }).outcome, "passed");
});

test("Policy-Q shadow requires targeted decisive accuracy and natural regret by phase", () => {
  const regret = {
    contract: "paired-action-effect-evaluator-regret-v15",
    regretGateEligible: true,
    comparisons: 40,
    decisiveCoverage: 0.4,
    classifiedCoverage: 0.5,
    decisiveAccuracy: 0.7,
    decisiveAccuracyInterval: { lowerBound: 0.5, upperBound: 0.85 },
    expectedRegret: 0.02,
    expectedRegretInterval: { lowerBound: 0, upperBound: 0.12 },
    observedClassificationRegret: 0.02,
    observedClassificationRegretInterval: {
      lowerBound: 0,
      upperBound: 0.12
    },
    populationRegretUpperBound: 0.18,
    populationRegretTailRisk: {
      aboveThreePercentRate: 0.1,
      aboveFivePercentRate: 0.05,
      worstTenPercentCvar: 0.15
    },
    regretTailRisk: {
      aboveThreePercentRate: 0.1,
      aboveFivePercentRate: 0.05,
      worstTenPercentCvar: 0.15
    }
  };
  assert.equal(policyQShadowRegretAlternativePasses(regret), true);
  const split = policyQTestSplitActionEffect();
  assert.equal(policyQShadowPhasePasses({
    accuracy: 0.57,
    accuracyInterval: { bootstrapLowerBound: 0.4 }
  }, split, undefined, "early"), true);
  assert.equal(policyQShadowPhasePasses({
    accuracy: 0.7,
    accuracyInterval: { bootstrapLowerBound: 0.6 }
  }, {
    ...split,
    naturalDistributionAudit: {
      ...split.naturalDistributionAudit,
      phaseBands: {
        ...split.naturalDistributionAudit.phaseBands,
        early: policyQTestNaturalRiskGroup({
          comparisons: 8,
          contributingGames: 5,
          regret: 0.5,
          regretUpper: 0.6,
          aboveThree: 0.5,
          aboveThreeUpper: 0.6,
          aboveFive: 0.4,
          aboveFiveUpper: 0.5,
          cvar: 0.7,
          cvarUpper: 0.8
        })
      }
    }
  }, undefined, "early"), false);
  const missing = policyQShadowPhaseAuditStatus({}, "early");
  assert.equal(missing.passes, false);
  assert.equal(missing.targetedSufficient, false);
  assert.equal(missing.naturalSufficient, false);
  const highBinaryOnly = policyQShadowActionEffectGateStatus({
    accuracy: 0.9,
    phaseBands: Object.fromEntries([
      "mulligan", "early", "mid", "late"
    ].map((phase) => [phase, { accuracy: 0.9 }]))
  });
  assert.equal(highBinaryOnly.eligible, false);
  assert.ok(highBinaryOnly.reasons.some((reason) =>
    reason.includes("action-effect")));
  assert.equal(policyQShadowActionEffectGateStatus({
    accuracy: 0.57,
    actionEffectRanking: split
  }).eligible, true);
  const mislabeled = structuredClone(split);
  mislabeled.naturalDistributionAudit.samplingContract =
    "teacher-selected-policy-decision-pair-v1";
  assert.equal(policyQShadowPhasePasses(
    { accuracy: 0.9 },
    mislabeled,
    undefined,
    "early"
  ), false);
  const lateWeak = structuredClone(split);
  lateWeak.targetedDecisiveAudit.phaseBands.late.decisiveAccuracy = 0.4;
  lateWeak.targetedDecisiveAudit.phaseBands.late
    .decisiveAccuracyInterval.upperBound = 0.5;
  assert.equal(policyQShadowPhasePasses(
    { accuracy: 0.9 },
    lateWeak,
    undefined,
    "late"
  ), false);
  const lateWithoutTerminalEvidence = structuredClone(split);
  delete lateWithoutTerminalEvidence.targetedDecisiveAudit.evidenceSource;
  delete lateWithoutTerminalEvidence.naturalDistributionAudit.evidenceSource;
  assert.equal(policyQShadowPhasePasses(
    { accuracy: 0.9 },
    lateWithoutTerminalEvidence,
    undefined,
    "late"
  ), false);
  const wideButStillPlausible = policyQTestSplitActionEffect({
    natural: {
      regret: 0,
      regretUpper: 0.8,
      aboveThree: 0,
      aboveThreeUpper: 0.8,
      aboveFive: 0,
      aboveFiveUpper: 0.8,
      cvar: 0,
      cvarUpper: 0.8
    }
  });
  const wideStatus = policyQShadowPhaseAuditStatus(
    wideButStillPlausible,
    "early"
  );
  assert.equal(wideStatus.naturalSufficient, true);
  assert.equal(wideStatus.naturalPass, false);
  assert.equal(wideStatus.couldPass, true);
  const underAssessedNatural = policyQTestSplitActionEffect({
    natural: {
      regret: 0.65,
      regretUpper: 1,
      aboveThree: 0.9,
      aboveThreeUpper: 1,
      aboveFive: 0.9,
      aboveFiveUpper: 1,
      cvar: 1,
      cvarUpper: 1,
      riskAssessedComparisons: 2,
      riskAssessedGames: 2,
      riskAssessmentCoverage: 0.125
    }
  });
  const underAssessedStatus = policyQShadowPhaseAuditStatus(
    underAssessedNatural,
    "early"
  );
  assert.equal(underAssessedStatus.naturalSufficient, false);
  assert.equal(underAssessedStatus.naturalCouldPass, true);
  assert.equal(underAssessedStatus.couldPass, true);
  assert.equal(underAssessedStatus.naturalRiskAssessedComparisons, 2);
  assert.equal(underAssessedStatus.naturalRiskAssessedContributingGames, 2);
  assert.equal(underAssessedStatus.naturalRiskAssessmentCoverage, 0.125);
  const optimisticallyUnsafe = structuredClone(wideButStillPlausible);
  optimisticallyUnsafe.naturalDistributionAudit.phaseBands.early
    .populationRiskBootstrap.meanRegret.lowerBound = 0.4;
  optimisticallyUnsafe.naturalDistributionAudit.phaseBands.early
    .populationRiskBootstrap.meanRegret.pointEstimate = 0.5;
  assert.equal(policyQShadowPhaseAuditStatus(
    optimisticallyUnsafe,
    "early"
  ).couldPass, false);
  const safeSelection = policyQShadowSelectionSignal({
    accuracyInterval: { bootstrapLowerBound: 0.45 },
    phaseBands: Object.fromEntries(
      ["mulligan", "early", "mid", "late"].map((phase) => [phase, {
        accuracyInterval: { bootstrapLowerBound: 0.45 }
      }])
    ),
    actionEffectRanking: split
  });
  const unsafeSelection = policyQShadowSelectionSignal({
    accuracyInterval: { bootstrapLowerBound: 0.99 },
    phaseBands: Object.fromEntries(
      ["mulligan", "early", "mid", "late"].map((phase) => [phase, {
        accuracyInterval: { bootstrapLowerBound: 0.99 }
      }])
    ),
    actionEffectRanking: wideButStillPlausible
  });
  assert.equal(safeSelection.actionEffectComplete, true);
  assert.ok(safeSelection.score > unsafeSelection.score);
  assert.ok(safeSelection.primaryScore > safeSelection.binaryReferenceScore);
  assert.equal(policyQShadowRegretAlternativePasses({
    ...regret,
    regretGateEligible: false
  }), false);
  assert.equal(policyQShadowRegretAlternativePasses({
    ...regret,
    observedClassificationRegret: null
  }), false);
  assert.equal(policyQShadowRegretAlternativePasses({
    ...regret,
    comparisons: 100,
    decisiveCoverage: 0.2,
    classifiedCoverage: 0.2,
    observedClassificationRegret: 0,
    populationRegretUpperBound: 0.8
  }), false);
  assert.equal(policyQShadowRegretAlternativePasses({
    ...regret,
    populationRegretTailRisk: {
      aboveThreePercentRate: 0.25,
      aboveFivePercentRate: 0.25,
      worstTenPercentCvar: 1
    }
  }), false);
});

test("formal Policy-Q audit requires targeted accuracy and natural regret safety", () => {
  const riskInterval = (
    pointEstimate,
    percentileUpperBound,
    concentrationUpperBound,
    clusterClopperPearsonUpperBound = null
  ) => ({
    pointEstimate,
    lowerBound: Math.max(0, Number(pointEstimate) - 0.03),
    percentileUpperBound,
    concentrationUpperBound,
    clusterClopperPearsonUpperBound,
    upperBound: Math.max(
      percentileUpperBound,
      concentrationUpperBound,
      clusterClopperPearsonUpperBound || 0
    )
  });
  const group = {
    comparisons: 160,
    contributingGames: 120,
    auditedComparisons: 160,
    knownZeroComparisons: 0,
    riskAssessedComparisons: 160,
    riskAssessedContributingGames: 120,
    riskAssessmentCoverage: 1,
    unavailableComparisons: 0,
    decisive: 48,
    decisiveCoverage: 0.3,
    decisiveAccuracy: 0.75,
    decisiveAccuracyInterval: {
      lowerBound: 0.5,
      upperBound: 0.65,
      contributingGames: 60
    },
    populationRegretUpperBound: 0.12,
    populationRegretConfidenceUpperBound: 0.17,
    populationRegretTailRisk: {
      aboveThreePercentRate: 0.1,
      aboveFivePercentRate: 0.05,
      worstTenPercentCvar: 0.2
    },
    populationRegretTailRiskConfidence: {
      aboveThreePercentRate: { upperBound: 0.15 },
      aboveFivePercentRate: { upperBound: 0.1 },
      worstTenPercentCvar: { upperBound: 0.2 }
    }
  };
  const phases = Object.fromEntries(
    ["mulligan", "early", "mid", "late"].map((phase) => [phase, {
      ...group,
      ...policyQTestNaturalRiskGroup({
        comparisons: 30,
        contributingGames: 24
      }),
      decisive: 12,
      decisiveAccuracy: 0.7,
      decisiveAccuracyInterval: {
        lowerBound: 0.45,
        upperBound: 0.68,
        contributingGames: 12
      }
    }])
  );
  const deckSeats = Object.fromEntries(
    ["deck-a:p1", "deck-a:p2"].map((key) => [key, {
      ...group,
      ...policyQTestNaturalRiskGroup({
        comparisons: 20,
        contributingGames: 16
      })
    }])
  );
  const expectedDeckSeats = ["deck-a:p1", "deck-a:p2"];
  const expectedDeckSeatPhases = expectedDeckSeats.flatMap((deckSeat) =>
    ["mulligan", "early", "mid", "late"].map((phase) =>
      `${deckSeat}::${phase}`));
  const deckSeatPhases = Object.fromEntries(
    expectedDeckSeatPhases.map((key) => [key,
      policyQTestNaturalRiskGroup({
        comparisons: 12,
        contributingGames: 10
      })])
  );
  const formalContext = {
    expectedDeckSeats,
    expectedDeckSeatPhases,
    deckSeatPhaseOpportunityContract: "training-deck-seat-cartesian-v1"
  };
  const ranking = {
    deckSeats: { "deck-a:p1": {}, "deck-a:p2": {} },
    actionEffectRanking: {
      contract: "paired-action-effect-evaluator-regret-v15",
      targetedDecisiveAudit: {
        ...group,
        evidenceSource: "paired-terminal-outcome-pairs-v1",
        auditDistribution: "teacher-selected-targeted",
        samplingContract: "teacher-selected-policy-decision-pair-v1",
        provenanceValidated: true,
        phaseBands: phases
      },
      naturalDistributionAudit: {
        ...group,
        evidenceSource: "paired-terminal-outcome-pairs-v1",
        auditDistribution: "natural-policy-decision-pairs",
        samplingContract: "hash-priority-reservoir-policy-decision-v1",
        provenanceValidated: true,
        populationEstimand:
          "ipw-per-decision-natural-policy-decision-pairs-v2",
        populationRiskBootstrap: {
          version: 2,
          method: "game-cluster-percentile-bootstrap-ipw-per-decision-v2",
          estimand: "per-decision",
          weighting: "inverse-propensity-per-decision-v1",
          samples: 500,
          contributingGames: 120,
          decisions: 160,
          totalPopulationWeight: 160,
          maximumSampleWeight: 1,
          meanRegret: riskInterval(0.12, 0.15, 0.17),
          aboveThreePercentRate: riskInterval(0.1, 0.12, 0.15, 0.14),
          aboveFivePercentRate: riskInterval(0.05, 0.08, 0.1, 0.09),
          worstTenPercentCvar: riskInterval(0.12, 0.15, 0.2),
          cvarConcentration: {
            method: "game-cluster-bonferroni-cvar-excess-bernstein-v1",
            tailFraction: 0.1,
            familywiseAlpha: 0.05,
            thresholdAlpha: 0.05,
            upperBound: 0.2,
            selectedThreshold: 0.1,
            thresholds: [{
              threshold: 0.1,
              excessMean: 0.005,
              excessUpperBound: 0.01,
              cvarUpperBound: 0.2
            }]
          }
        },
        phaseBands: phases,
        deckSeats,
        deckSeatPhases
      }
    }
  };
  const passed = policyQFormalAuditStatus(
    ranking,
    undefined,
    formalContext
  );
  assert.equal(passed.contract, POLICY_Q_FORMAL_AUDIT_CONTRACT);
  assert.equal(passed.eligible, true, JSON.stringify(passed.reasons));
  const underAssessedNatural = structuredClone(ranking);
  Object.assign(
    underAssessedNatural.actionEffectRanking.naturalDistributionAudit,
    {
      riskAssessedComparisons: 20,
      riskAssessedContributingGames: 18,
      riskAssessmentCoverage: 0.125,
      unavailableComparisons: 140
    }
  );
  const underAssessedFormalStatus = policyQFormalAuditStatus(
    underAssessedNatural,
    undefined,
    formalContext
  );
  assert.equal(underAssessedFormalStatus.eligible, false);
  assert.ok(underAssessedFormalStatus.reasons.includes(
    "policy-q-natural-audit-insufficient"
  ));
  const tooFewIndependentGames = structuredClone(ranking);
  tooFewIndependentGames.actionEffectRanking.targetedDecisiveAudit
    .contributingGames = 59;
  assert.equal(policyQFormalAuditStatus(
    tooFewIndependentGames,
    undefined,
    formalContext
  ).eligible, false);
  const impreciseTargeted = structuredClone(ranking);
  impreciseTargeted.actionEffectRanking.targetedDecisiveAudit
    .decisiveAccuracyInterval.upperBound = 0.9;
  assert.equal(policyQFormalAuditStatus(
    impreciseTargeted,
    undefined,
    formalContext
  ).eligible, false);
  const impreciseNatural = structuredClone(ranking);
  impreciseNatural.actionEffectRanking.naturalDistributionAudit
    .populationRiskBootstrap.meanRegret.lowerBound = 0;
  assert.equal(policyQFormalAuditStatus(
    impreciseNatural,
    undefined,
    formalContext
  ).eligible, false);
  const zeroLossRanking = structuredClone(ranking);
  const zeroLossRisk = zeroLossRanking.actionEffectRanking
    .naturalDistributionAudit.populationRiskBootstrap;
  zeroLossRisk.worstTenPercentCvar = riskInterval(0, 0, 0.1, 0.01);
  zeroLossRisk.cvarConcentration = {
    method: "zero-loss-cluster-clopper-pearson-v1",
    positiveClusterUpperBound: 0.01,
    upperBound: 0.1,
    thresholds: []
  };
  zeroLossRanking.actionEffectRanking.naturalDistributionAudit
    .populationRegretTailRiskConfidence.worstTenPercentCvar.upperBound = 0.1;
  assert.equal(policyQFormalAuditStatus(
    zeroLossRanking,
    undefined,
    formalContext
  ).eligible, true);
  assert.equal(policyQFormalAuditStatus({
    ...ranking,
    actionEffectRanking: {
      ...ranking.actionEffectRanking,
      naturalDistributionAudit: {
        ...ranking.actionEffectRanking.naturalDistributionAudit,
        populationRegretUpperBound: 0.5,
        populationRegretConfidenceUpperBound: 0.5
      }
    }
  }, undefined, formalContext).eligible, false);
  assert.equal(policyQFormalAuditStatus({
    ...ranking,
    actionEffectRanking: {
      ...ranking.actionEffectRanking,
      targetedDecisiveAudit: {
        ...ranking.actionEffectRanking.targetedDecisiveAudit,
        decisiveAccuracy: 0.4
      }
    }
  }, undefined, formalContext).eligible, false);
  const zeroDecisiveMid = structuredClone(ranking);
  zeroDecisiveMid.actionEffectRanking.targetedDecisiveAudit
    .phaseBands.mid.decisive = 0;
  assert.equal(policyQFormalAuditStatus(
    zeroDecisiveMid,
    undefined,
    formalContext
  ).eligible, false);
  const unsafeEarlyTail = structuredClone(ranking);
  unsafeEarlyTail.actionEffectRanking.naturalDistributionAudit
    .phaseBands.early = policyQTestNaturalRiskGroup({
      comparisons: 30,
      contributingGames: 24,
      regret: 0.2,
      regretUpper: 0.3,
      aboveThree: 0.3,
      aboveThreeUpper: 0.4,
      aboveFive: 0.2,
      aboveFiveUpper: 0.3,
      cvar: 0.5,
      cvarUpper: 0.7
    });
  assert.equal(policyQFormalAuditStatus(
    unsafeEarlyTail,
    undefined,
    formalContext
  ).eligible, false);
  assert.equal(policyQFormalAuditStatus(
    ranking,
    undefined,
    {
      expectedDeckSeats: [...expectedDeckSeats, "deck-b:p1"],
      expectedDeckSeatPhases,
      deckSeatPhaseOpportunityContract: "training-deck-seat-cartesian-v1"
    }
  ).eligible, false);
  const missingDeckSeatPhase = structuredClone(ranking);
  delete missingDeckSeatPhase.actionEffectRanking.naturalDistributionAudit
    .deckSeatPhases["deck-a:p2::late"];
  assert.equal(policyQFormalAuditStatus(
    missingDeckSeatPhase,
    undefined,
    formalContext
  ).eligible, false);
  const mislabeledNatural = structuredClone(ranking);
  mislabeledNatural.actionEffectRanking.naturalDistributionAudit
    .samplingContract = "teacher-selected-policy-decision-pair-v1";
  assert.equal(policyQFormalAuditStatus(
    mislabeledNatural,
    undefined,
    formalContext
  ).eligible, false);
});

test("natural regret bootstrap preserves the per-decision estimand and global CVaR", () => {
  const result = bootstrapLeafActionEffectPopulationRisk([{
    gameId: "one-large-loss",
    comparisons: 1,
    conservativeRegretUpperBounds: [1]
  }, {
    gameId: "nine-safe-decisions",
    comparisons: 9,
    conservativeRegretUpperBounds: Array(9).fill(0)
  }], { populationRiskBootstrapSamples: 500 });
  assert.equal(result.estimand, "per-decision");
  assert.equal(result.method,
    "game-cluster-percentile-bootstrap-ipw-per-decision-v2");
  assert.equal(result.meanRegret.pointEstimate, 0.1);
  assert.equal(result.worstTenPercentCvar.pointEstimate, 1);
  assert.equal(result.meanRegret.upperBound >= result.meanRegret.pointEstimate,
    true);
  assert.equal(result.worstTenPercentCvar.upperBound, 1);
});

test("natural regret applies reservoir inverse-propensity weights", () => {
  const result = bootstrapLeafActionEffectPopulationRisk([{
    gameId: "five-decision-game",
    conservativeRegretUpperBounds: [1],
    conservativeRegretWeights: [5]
  }, {
    gameId: "fifty-decision-game",
    conservativeRegretUpperBounds: [0],
    conservativeRegretWeights: [50]
  }], { populationRiskBootstrapSamples: 500 });
  assert.equal(result.estimand, "per-decision");
  assert.ok(Math.abs(result.meanRegret.pointEstimate - 5 / 55) < 1e-12);
  assert.ok(Math.abs(
    result.aboveThreePercentRate.pointEstimate - 5 / 55
  ) < 1e-12);
  assert.ok(Math.abs(result.worstTenPercentCvar.pointEstimate - 10 / 11)
    < 1e-12);
});

test("natural regret bounds retain unseen-loss uncertainty after all-zero games", () => {
  const result = bootstrapLeafActionEffectPopulationRisk(
    Array.from({ length: 20 }, (_, index) => ({
      gameId: `zero-${index}`,
      comparisons: 1,
      conservativeRegretUpperBounds: [0]
    })),
    { populationRiskBootstrapSamples: 500 }
  );
  assert.equal(result.meanRegret.pointEstimate, 0);
  assert.equal(result.meanRegret.percentileUpperBound, 0);
  assert.equal(result.meanRegret.upperBound > 0, true);
  assert.equal(result.aboveThreePercentRate.upperBound > 0, true);
  assert.equal(result.aboveFivePercentRate.upperBound > 0, true);
  assert.equal(result.worstTenPercentCvar.upperBound > 0, true);
  assert.equal(result.cvarConcentration.method,
    "zero-loss-cluster-clopper-pearson-v1");
  assert.equal(
    result.cvarConcentration.positiveClusterUpperBound,
    result.worstTenPercentCvar.clusterClopperPearsonUpperBound
  );
  assert.equal(
    result.cvarConcentration.upperBound,
    Math.min(
      1,
      result.cvarConcentration.positiveClusterUpperBound / 0.1
    )
  );
  assert.equal(
    result.aboveFivePercentRate.clusterClopperPearsonUpperBound > 0,
    true
  );
});

test("CVaR concentration preserves observed loss magnitude", () => {
  const tiny = bootstrapLeafActionEffectPopulationRisk(
    Array.from({ length: 500 }, (_, index) => ({
      gameId: `tiny-${index}`,
      comparisons: 1,
      conservativeRegretUpperBounds: [0.001]
    })),
    { populationRiskBootstrapSamples: 500 }
  );
  const severe = bootstrapLeafActionEffectPopulationRisk(
    Array.from({ length: 500 }, (_, index) => ({
      gameId: `severe-${index}`,
      comparisons: 1,
      conservativeRegretUpperBounds: [0.5]
    })),
    { populationRiskBootstrapSamples: 500 }
  );
  assert.equal(tiny.cvarConcentration.method,
    "game-cluster-bonferroni-cvar-excess-bernstein-v1");
  assert.equal(tiny.worstTenPercentCvar.clusterClopperPearsonUpperBound, null);
  assert.equal(tiny.worstTenPercentCvar.upperBound < 1, true);
  assert.equal(severe.worstTenPercentCvar.upperBound
    > tiny.worstTenPercentCvar.upperBound, true);
});

test("conservative regret uses the adverse confidence edge for decisive mistakes", () => {
  assert.equal(evaluatorConservativeRegretUpperBound({
    disposition: "decisive",
    expectedDirection: 1,
    predictedDirection: -1,
    correct: false,
    lower: 0.05,
    upper: 0.7
  }), 0.7);
  assert.equal(evaluatorConservativeRegretUpperBound({
    disposition: "decisive",
    expectedDirection: -1,
    predictedDirection: 1,
    correct: false,
    lower: -0.65,
    upper: -0.05
  }), 0.65);
  assert.equal(evaluatorConservativeRegretUpperBound({
    disposition: "decisive",
    expectedDirection: 1,
    predictedDirection: 1,
    correct: true,
    lower: 0.05,
    upper: 0.7
  }), 0);
});

test("Policy-Q shadow demand aggregates weak phases across final replicas", () => {
  const phase = (accuracy, lowerBound, effectiveGames) => ({
    accuracy,
    decisions: 10,
    contributingGames: Math.ceil(effectiveGames),
    accuracyInterval: {
      effectiveGames,
      bootstrapLowerBound: lowerBound
    }
  });
  const makeCandidate = (replica, score, early, deckSeatPhase) => ({
    architecture: { id: "structured-set-v1-128" },
    replica,
    selectionScore: score,
    leafValueRanking: {
      phaseBands: {
        mulligan: phase(0.7, 0.55, 20),
        early,
        mid: phase(0.7, 0.55, 20),
        late: phase(0.7, 0.55, 20)
      },
      deckSeatPhases: {
        "origins-leona:p2::mid": deckSeatPhase
      }
    }
  });
  const demand = policyQShadowReadinessDemand({
    requiredStableReplicas: 2,
    candidates: [
      makeCandidate(
        0,
        100,
        phase(0.72, 0.52, 18),
        phase(0.75, 0.5, 10)
      ),
      makeCandidate(
        1,
        80,
        phase(0.55, 0.39, 15),
        phase(0.5, 0.35, 9)
      ),
      makeCandidate(
        2,
        70,
        phase(0.52, 0.35, 12),
        phase(0.45, 0.3, 8)
      )
    ]
  });
  const early = demand.items.find((item) => item.phaseBand === "early");
  assert.equal(early.observedAccuracy, 0.55);
  assert.equal(early.observedLowerBound, 0.35);
  assert.equal(early.observedEffectiveGames, 12);
  assert.equal(early.passingReplicas, 0);
  assert.equal(early.requiredStableReplicas, 2);
  assert.equal(early.evidenceKind, "action-effect");
  assert.equal(early.auditDistribution, "targeted-decisive");
  assert.ok(demand.items.some((item) => item.phaseBand === "early"
    && item.auditDistribution === "natural-distribution"));
  const deckSeatPhase = demand.items.find((item) =>
    item.deckSeat === "origins-leona:p2" && item.phaseBand === "mid");
  assert.equal(deckSeatPhase.observedAccuracy, 0.5);
  assert.equal(deckSeatPhase.observedLowerBound, 0.3);
  assert.equal(deckSeatPhase.observedEffectiveGames, 8);
  assert.equal(deckSeatPhase.weakReplicas, 2);
  assert.equal(deckSeatPhase.supportedReplicas, 3);
});

test("Policy-Q shadow demand collects uncertain action effects before model tuning", () => {
  const phaseBands = Object.fromEntries(
    ["mulligan", "early", "mid", "late"].map((phase) => [phase, {
      accuracy: 0.7,
      decisions: 40,
      contributingGames: 20,
      accuracyInterval: {
        effectiveGames: 20,
        bootstrapLowerBound: 0.5
      }
    }])
  );
  const demandFor = (actionEffectRanking) => policyQShadowReadinessDemand({
    requiredStableReplicas: 1,
    candidates: [{
      architecture: { id: "structured-set-v1-128" },
      replica: 0,
      selectionScore: 1,
      leafValueRanking: { phaseBands, actionEffectRanking }
    }]
  });
  const uncertainNatural = policyQTestSplitActionEffect({
    natural: {
      regret: 0,
      regretUpper: 0.8,
      aboveThree: 0,
      aboveThreeUpper: 0.8,
      aboveFive: 0,
      aboveFiveUpper: 0.8,
      cvar: 0,
      cvarUpper: 0.8
    }
  });
  for (const item of Object.values(
    uncertainNatural.naturalDistributionAudit.phaseBands
  )) {
    item.comparisons = 40;
    item.contributingGames = 20;
    item.auditedComparisons = 40;
    item.riskAssessedComparisons = 40;
    item.riskAssessedContributingGames = 20;
    item.riskAssessmentCoverage = 1;
    item.unavailableComparisons = 0;
    item.populationRiskBootstrap.decisions = 40;
    item.populationRiskBootstrap.contributingGames = 20;
  }
  const naturalDemand = demandFor(uncertainNatural);
  const naturalItems = naturalDemand.items.filter((item) =>
    item.auditDistribution === "natural-distribution");
  assert.equal(naturalItems.length, 4);
  assert.ok(naturalItems.every((item) =>
    item.missingMetric === "population-regret-confidence-precision"
      && item.targetValidationGames >= 85
      && item.additionalValidationGames >= 65
      && item.requiredAdditionalGamesUnit === "collection-games"));
  assert.equal(naturalDemand.items.some((item) =>
    item.evidenceKind === "model-tuning"), false);

  const underAssessedNatural = policyQTestSplitActionEffect({
    natural: {
      regret: 0.65,
      regretUpper: 1,
      aboveThree: 0.9,
      aboveThreeUpper: 1,
      aboveFive: 0.9,
      aboveFiveUpper: 1,
      cvar: 1,
      cvarUpper: 1,
      riskAssessedComparisons: 2,
      riskAssessedGames: 2,
      riskAssessmentCoverage: 0.125
    }
  });
  const underAssessedDemand = demandFor(underAssessedNatural);
  const assessmentItems = underAssessedDemand.items.filter((item) =>
    item.auditDistribution === "natural-distribution");
  assert.equal(assessmentItems.length, 4);
  assert.ok(assessmentItems.every((item) =>
    item.missingMetric === "natural-risk-assessment-coverage"
      && item.requiredAdditionalGames > 0));
  assert.equal(underAssessedDemand.items.some((item) =>
    item.evidenceKind === "model-tuning"), false);

  const uncertainTargeted = policyQTestSplitActionEffect({
    targetedAccuracy: 0.5,
    targetedLower: 0.2,
    targetedUpper: 0.9
  });
  const targetedDemand = demandFor(uncertainTargeted);
  assert.ok(targetedDemand.items.some((item) =>
    item.auditDistribution === "targeted-decisive"
      && item.missingMetric === "decisive-accuracy-confidence-precision"
      && item.requiredAdditionalGames > 0));
  assert.equal(targetedDemand.items.some((item) =>
    item.evidenceKind === "model-tuning"), false);

  const optimisticallyFailed = structuredClone(uncertainTargeted);
  for (const item of Object.values(
    optimisticallyFailed.targetedDecisiveAudit.phaseBands
  )) {
    item.decisiveAccuracyInterval.upperBound = 0.4;
  }
  const failedDemand = demandFor(optimisticallyFailed);
  assert.ok(failedDemand.items.some((item) =>
    item.evidenceKind === "model-tuning"));
  assert.equal(failedDemand.items.some((item) =>
    item.missingMetric?.endsWith("confidence-precision")), false);
});

test("Policy-Q shadow retry expands only Training evidence and targets weak strata", () => {
  const base = EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS.training;
  const expanded = expandPolicyQShadowReadinessRequirement(base, 1);
  assert.ok(expanded.minimumStructuredV2LeafValuePairs > 1500);
  assert.ok(expanded.minimumLeafValuePairsByPhase.mulligan > 250);
  assert.ok(expanded.minimumLeafValueReferenceGamesByPhase.late > 80);
  const demand = policyQShadowReadinessDemand({
    candidates: [{
      selectionScore: 1,
      leafValueRanking: {
        phaseBands: {
          mulligan: { accuracy: 0.55, accuracyLowerBound: 0.4 },
          early: { accuracy: 0.7, accuracyLowerBound: 0.55 }
        },
        deckSeatPhases: {
          "origins-leona:p2::mid": {
            decisions: 10,
            contributingGames: 6,
            accuracy: 0.45
          }
        }
      }
    }]
  });
  assert.ok(demand.items.some((item) => item.phaseBand === "mulligan"));
  assert.ok(demand.items.some((item) =>
    item.deckSeat === "origins-leona:p2" && item.phaseBand === "mid"));
  const collectorFocus = evaluatorBootstrapDiagnosticFocus(
    demand,
    "training",
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
  );
  assert.ok(collectorFocus.phaseBands.includes("mulligan"));
  assert.ok(collectorFocus.deckSeats.includes("origins-leona:p2"));
  const adaptive = expandPolicyQShadowReadinessRequirement(base, 1, {
    diagnosticDemand: {
      items: [{
        evidenceKind: "leaf",
        phaseBand: "early",
        observedEffectiveGames: 15,
        targetEffectiveGames: 42
      }]
    }
  });
  assert.ok(
    adaptive.minimumLeafValueReferenceGamesByPhase.early
      >= Math.ceil(base.minimumLeafValueReferenceGamesByPhase.early * 42 / 15)
  );
  assert.equal(
    adaptive.minimumLeafValueReferenceGamesByPhase.mid,
    expanded.minimumLeafValueReferenceGamesByPhase.mid
  );
  const actionEffectExpanded = expandPolicyQShadowReadinessRequirement(
    base,
    1,
    {
      diagnosticDemand: {
        version: 2,
        items: [{
          evidenceKind: "action-effect",
          auditDistribution: "natural-distribution",
          phaseBand: "early",
          missingMetric: "population-regret-confidence",
          requiredAdditionalGames: 12
        }]
      }
    },
    POLICY_Q_SHADOW_READINESS_GRID,
    { trainingAudit: { acceptedGames: base.minimumGames } }
  );
  assert.equal(
    actionEffectExpanded.minimumLeafValuePairs,
    base.minimumLeafValuePairs
  );
  assert.equal(
    actionEffectExpanded.minimumStructuredV2LeafValuePairs,
    base.minimumStructuredV2LeafValuePairs
  );
  assert.ok(actionEffectExpanded.minimumGames >= base.minimumGames + 16);
  assert.ok(actionEffectExpanded.minimumGames <= base.minimumGames + 32);
  assert.equal(
    actionEffectExpanded.shadowActionEffectDemand.items[0].missingMetric,
    "population-regret-confidence"
  );
  const resumedActionEffectExpanded = expandPolicyQShadowReadinessRequirement(
    base,
    1,
    {
      diagnosticDemand: {
        version: 2,
        items: [{
          evidenceKind: "action-effect",
          auditDistribution: "natural-distribution",
          phaseBand: "early",
          missingMetric: "population-regret-confidence",
          requiredAdditionalGames: 12
        }]
      }
    },
    POLICY_Q_SHADOW_READINESS_GRID,
    { trainingAudit: { acceptedGames: 640 } }
  );
  assert.equal(resumedActionEffectExpanded.minimumGames, 656);
  assert.equal(
    resumedActionEffectExpanded.shadowActionEffectDemand.collectionFloorGames,
    640
  );
  assert.equal(
    resumedActionEffectExpanded.shadowActionEffectDemand.contract,
    "policy-q-shadow-training-action-effect-collection-v3"
  );
  const naturalActionEffectFocus = evaluatorBootstrapDiagnosticFocus({
    version: 2,
    role: "training",
    priority: "warning-only",
    officialEvidenceRuleChanged: false,
    items: actionEffectExpanded.shadowActionEffectDemand.items
  }, "training", EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf);
  assert.equal(naturalActionEffectFocus.items[0].evidenceKind, "action-effect");
  assert.equal(
    naturalActionEffectFocus.items[0].auditDistribution,
    "natural-distribution"
  );
});

test("evaluator gradient balance downweights frequent phase and deck-seat samples", () => {
  const samples = [
    ...Array.from({ length: 4 }, () => ({
      targetHead: "state-value",
      phaseBand: "mid",
      deckSeat: "deck-a:p1",
      structuredV2Eligible: true,
      sampleWeight: 1
    })),
    {
      targetHead: "state-value",
      phaseBand: "mulligan",
      deckSeat: "deck-b:p2",
      structuredV2Eligible: true,
      sampleWeight: 1
    }
  ];
  const profile = createEvaluatorTrainingBalanceProfile(samples, {
    structuredV2Only: true
  });
  const weighted = applyEvaluatorTrainingBalanceProfile(samples, profile);
  assert.ok(weighted[0].sampleWeight < weighted.at(-1).sampleWeight);
  assert.equal(weighted.at(-1).sampleWeight, 1);
  assert.equal(profile.samples, 5);
});

function terminalLeafValuePair(seed = 1) {
  const correctState = new Float32Array(STATE_DIM);
  const comparedState = new Float32Array(STATE_DIM);
  correctState[0] = 1;
  comparedState[0] = -1;
  return {
    simulationSeed: seed,
    correctState,
    comparedState,
    correctOutcome: 1,
    comparedOutcome: 0,
    correctHeuristicValue: 0.7,
    comparedHeuristicValue: 0.3,
    correctCaptureStep: 4,
    comparedCaptureStep: 4,
    correctDepthBin: "0-7",
    comparedDepthBin: "0-7",
    auditContinuationSteps: { correct: 12, compared: 12 }
  };
}

function terminalEvaluatorStatePair(seed = 1, options = {}) {
  const recommendedState = new Float32Array(STATE_DIM);
  const selectedState = new Float32Array(STATE_DIM);
  recommendedState[0] = Number(options.recommendedFeature ?? 1);
  selectedState[0] = Number(options.selectedFeature ?? -1);
  return {
    simulationSeed: seed,
    recommendedState,
    selectedState,
    recommendedOutcome: Number(options.recommendedOutcome ?? 1),
    selectedOutcome: Number(options.selectedOutcome ?? 0),
    recommendedHeuristicValue:
      Number(options.recommendedHeuristicValue ?? 0.7),
    selectedHeuristicValue:
      Number(options.selectedHeuristicValue ?? 0.3),
    recommendedCaptureStep: 4,
    selectedCaptureStep: 4,
    recommendedDepthBin: "0-7",
    selectedDepthBin: "0-7",
    auditContinuationSteps: { recommended: 12, selected: 12 }
  };
}

function terminalLeafActionEffectComparison() {
  const samples = 64;
  const seeds = Array.from({ length: samples }, (_, index) => 800 + index);
  return {
    version: 1,
    contract: "paired-action-effect-leaf-audit-v1",
    recommendedActionKey: "endTurn",
    comparedActionKey: "passShowdown",
    decisiveEffectThreshold: 0.01,
    nearEquivalentMargin: 0.01,
    minimumNearEquivalentSamples: 32,
    provenance: {
      version: 1,
      informationSetHash: "test-information-set",
      engineFingerprint: "test-engine",
      independentSeedContract: true,
      determinizationRequired: true,
      sequentialAuditContract: {
        version: 1,
        stages: [16, 32, 64],
        completedStage: 64,
        confidenceSpending: "bonferroni-three-look-v1",
        perStageConfidence: 1 - 0.05 / 3
      }
    },
    pairedAudit: {
      attemptedPairs: samples,
      validPairs: samples,
      terminalPairs: samples,
      samples,
      mean: 1,
      standardError: 0,
      lowerBound: 0.61,
      upperBound: 1,
      positiveRate: 1,
      confidenceMethod: "bounded-hoeffding-mean-v1",
      confidence: 1 - 0.05 / 3,
      terminalSeeds: seeds,
      outcomePairs: seeds.map((simulationSeed) => ({
        simulationSeed,
        leftOutcome: 1,
        rightOutcome: 0
      })),
      pairingContract: {
        version: 1,
        exactSeedPairing: true,
        duplicateSeeds: [],
        uniqueSeeds: true,
        terminalSeedsMatchOutcomePairs: true
      },
      determinizationAudit: {
        recommendedComplete: true,
        selectedComplete: true,
        complete: true
      },
      rates: completeAuditRates(samples)
    },
    evaluatorStatePairs: Array.from({ length: 16 }, (_, index) =>
      terminalEvaluatorStatePair(800 + index))
  };
}

function completeAuditRates(samples) {
  const value = {
    successes: samples,
    attempts: samples,
    rate: 1,
    lowerBound: 0.9
  };
  return {
    valid: {
      recommended: { ...value },
      selected: { ...value },
      paired: { ...value }
    },
    terminal: {
      recommended: { ...value },
      selected: { ...value },
      paired: { ...value }
    }
  };
}

test("identical eight-pair terminal audits retain bounded uncertainty", () => {
  const samples = Array.from({ length: 8 }, (_, index) => ({
    simulationSeed: index + 1,
    invalid: false,
    terminal: true,
    terminalOutcome: 1,
    value: 1
  }));
  const [left] = hydrateActionAuditRolloutResults([{
    action: { type: "endTurn" },
    samples
  }]);
  const [right] = hydrateActionAuditRolloutResults([{
    action: { type: "passShowdown" },
    samples: structuredClone(samples)
  }]);
  const audit = pairedIndependentTerminalActionAudit(left, right);
  assert.equal(audit.samples, 8);
  assert.equal(audit.mean, 0);
  assert.equal(audit.lowerBound < 0, true);
  assert.equal(audit.upperBound > 0, true);
  assert.equal(
    audit.confidenceMethod,
    "paired-multinomial-exact-projection-v1"
  );
});

test("paired terminal interval uses ties and identifies a 28-6 advantage", () => {
  const outcomePairs = [
    ...Array.from({ length: 28 }, (_, index) => ({
      simulationSeed: index + 1,
      leftOutcome: 1,
      rightOutcome: 0
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      simulationSeed: index + 29,
      leftOutcome: 0,
      rightOutcome: 1
    })),
    ...Array.from({ length: 30 }, (_, index) => ({
      simulationSeed: index + 35,
      leftOutcome: 1,
      rightOutcome: 1
    }))
  ];
  const interval = pairedBinaryDifferenceInterval(outcomePairs, 0.99);
  assert.equal(interval.samples, 64);
  assert.equal(interval.wins, 28);
  assert.equal(interval.losses, 6);
  assert.equal(interval.ties, 30);
  assert.equal(interval.lowerBound > 0.01, true);
  assert.equal(interval.upperBound < 1, true);
});

test("leaf references preserve complete paired action effects without requiring a discordant pair", () => {
  const samplingFrame = {
    version: 1,
    contract: "leaf-audit-sampling-frame-v1",
    datasetKey: "test-dataset",
    taskIndex: 3,
    certificationRole: "development",
    distribution: "natural-distribution",
    scope: null,
    candidateSelection: "precommitted-bernoulli-policy-decision-v1",
    selectionProbability: 0.02,
    targeted: false
  };
  samplingFrame.taskManifestHash = createHash("sha256")
    .update(JSON.stringify(samplingFrame))
    .digest("hex");
  assert.equal(validLeafAuditSamplingFrame(samplingFrame), true);
  assert.equal(validLeafAuditSamplingFrame({
    ...samplingFrame,
    certificationRole: "confirmation"
  }), false);
  const reservoirFrame = {
    version: 2,
    contract: "natural-leaf-audit-sampling-frame-v2",
    datasetKey: "test-dataset",
    taskIndex: 4,
    certificationRole: "development",
    scope: null,
    distribution: "natural-distribution",
    candidateSelection: "hash-priority-reservoir-policy-decision-v1",
    parentTaskManifestHash: samplingFrame.taskManifestHash,
    eligibleDecisions: 5,
    selectionProbability: 0.2,
    weighting: "inverse-propensity-per-decision-v1"
  };
  reservoirFrame.taskManifestHash = createHash("sha256")
    .update(JSON.stringify(reservoirFrame))
    .digest("hex");
  assert.equal(validLeafAuditSamplingFrame(reservoirFrame), true);
  assert.equal(validLeafAuditSamplingFrame({
    ...reservoirFrame,
    selectionProbability: 0.25
  }), false);
  const reference = createLeafValueReference([], {
    actionEffectComparison: {
      version: 1,
      contract: "paired-action-effect-leaf-audit-v1",
      recommendedActionKey: "keep",
      comparedActionKey: "replace",
      decisiveEffectThreshold: 0.01,
      nearEquivalentMargin: 0.01,
      minimumNearEquivalentSamples: 32,
      samplingFrame,
      provenance: {
        version: 1,
        informationSetHash: "test-information-set",
        engineFingerprint: "test-engine",
        independentSeedContract: true,
        determinizationRequired: true,
        sequentialAuditContract: {
          version: 1,
          stages: [16, 32, 64],
          completedStage: 32,
          confidenceSpending: "bonferroni-three-look-v1",
          perStageConfidence: 1 - 0.05 / 3
        }
      },
      pairedAudit: {
        attemptedPairs: 32,
        validPairs: 32,
        terminalPairs: 32,
        samples: 32,
        mean: 0,
        standardError: 0,
        lowerBound: -0.55,
        upperBound: 0.55,
        positiveRate: 0,
        confidenceMethod: "bounded-hoeffding-mean-v1",
        confidence: 1 - 0.05 / 3,
        terminalSeeds: Array.from({ length: 32 }, (_, index) => index + 1),
        outcomePairs: Array.from({ length: 32 }, (_, index) => ({
          simulationSeed: index + 1,
          leftOutcome: 1,
          rightOutcome: 1
        })),
        pairingContract: {
          version: 1,
          exactSeedPairing: true,
          duplicateSeeds: [],
          uniqueSeeds: true,
          terminalSeedsMatchOutcomePairs: true
        },
        determinizationAudit: {
          recommendedComplete: true,
          selectedComplete: true,
          complete: true
        },
        rates: completeAuditRates(32)
      },
      evaluatorStatePairs: [terminalEvaluatorStatePair(1, {
        recommendedOutcome: 1,
        selectedOutcome: 1
      })]
    }
  });
  assert.equal(validLeafValueReference(reference), true);
  assert.equal(reference.pairs.length, 0);
  assert.equal(
    reference.actionEffectComparison.pairedAudit.mean,
    0
  );
  assert.equal(
    reference.actionEffectComparison.samplingFrame.distribution,
    "natural-distribution"
  );
});

test("leaf action-effect evidence rejects collapsed intervals and broken seed provenance", () => {
  const collapsed = terminalLeafActionEffectComparison();
  collapsed.pairedAudit.lowerBound = 1;
  collapsed.pairedAudit.upperBound = 1;
  assert.equal(createLeafValueReference([], {
    actionEffectComparison: collapsed
  }), null);

  const duplicateSeed = terminalLeafActionEffectComparison();
  duplicateSeed.pairedAudit.outcomePairs[1].simulationSeed =
    duplicateSeed.pairedAudit.outcomePairs[0].simulationSeed;
  assert.equal(createLeafValueReference([], {
    actionEffectComparison: duplicateSeed
  }), null);

  const mismatchedOutcome = terminalLeafActionEffectComparison();
  mismatchedOutcome.evaluatorStatePairs[0].selectedOutcome = 1;
  assert.equal(createLeafValueReference([], {
    actionEffectComparison: mismatchedOutcome
  }), null);
});

function syntheticStructuredEvidence(informationSetHash) {
  return {
    evidenceSchemaVersion: STRUCTURED_EVIDENCE_SCHEMA_VERSION,
    encoderFingerprint: STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT,
    engineFingerprint: "sha256:synthetic-structured-v2-engine",
    informationSetHash,
    source: "viewer-public-observation",
    featureAvailableMask: {
      hiddenOpponentCards: false,
      cardZoneTokens: true,
      battlefieldUnitRelations: true,
      actionObjectRelations: false,
      turnEventHistory: true
    },
    global: { turnNumber: 1, turnSequence: 1 },
    players: [
      { side: "self", hand: [] },
      { side: "opponent", hand: [] }
    ],
    battlefields: [],
    chainCards: [],
    turnEvents: [],
    action: null
  };
}

function independentTerminalActionAuditReference(suffix, options = {}) {
  const informationSetHash = `information-set:${suffix}`;
  const base = Math.abs([...String(suffix)].reduce(
    (sum, character) => (sum * 33 + character.charCodeAt(0)) >>> 0,
    5381
  )) % 1000000;
  const seeds = (offset, count) => Array.from(
    { length: count },
    (_, index) => base * 100 + offset + index
  );
  const terminalOutcomePairs = (offset, count, recommendedWins) =>
    seeds(offset, count).map((simulationSeed, index) => ({
      simulationSeed,
      recommendedOutcome: index < recommendedWins ? 1 : 0,
      selectedOutcome: index < recommendedWins ? 0 : 1
    }));
  const finalOutcomePairs = terminalOutcomePairs(70, 32, 20);
  const defaultEvaluatorStatePairs = finalOutcomePairs.map((pair) =>
    terminalEvaluatorStatePair(pair.simulationSeed, pair));
  return createActionRankingAuditReference({
    informationSetHash,
    informationSetHashVersion: 1,
    correctIndex: 1,
    comparedIndex: 0,
    correctActionKey: "endTurn",
    comparedActionKey: "passShowdown",
    audit: {
      version: 3,
      contract: "independent-terminal-action-audit-v3",
      source: "independent-terminal-action-audit",
      policyCorrectionIndependent: true,
      auditKey: `audit:${suffix}`,
      informationSetHash,
      recommendedActionKey: "endTurn",
      selectedActionKey: "passShowdown",
      selection: {
        attemptedPairs: 32,
        samples: 16,
        terminalPairs: 16,
        mean: 0.25,
        lowerBound: 0.05,
        upperBound: 0.45,
        terminalOutcomePairs: terminalOutcomePairs(30, 16, 10),
        rates: auditRateEvidence(16, 32)
      },
      final: {
        attemptedPairs: 64,
        terminalPairs: 32,
        samples: 32,
        mean: 0.25,
        lowerBound: 0.04,
        upperBound: 0.36,
        positiveRate: 0.625,
        terminalOutcomePairs: finalOutcomePairs,
        rates: auditRateEvidence(32, 64)
      },
      evaluatorStatePairs: options.evaluatorStatePairs
        || defaultEvaluatorStatePairs,
      seedBanks: {
        screening: seeds(0, 4),
        confirmation: seeds(10, 16),
        selection: seeds(30, 32),
        final: seeds(70, 64),
        disjoint: true
      },
      determinizationAudit: { version: 1, complete: true },
      usedForTeacherDecision: false,
      usedForPolicyTraining: false,
      usedForActionValueTraining: false,
      usedForProposalValueTraining: false,
      usedForEpochSelection: false
    },
    ...options
  });
}

function evaluatorBootstrapResultWithActionReferences(references) {
  return {
    summaries: [{
      completed: true,
      naturallyCompleted: true,
      invalid: false
    }],
    trajectories: [{
      gameId: "transactional-bootstrap-game",
      deckId: "origins-kaisa",
      playerId: "p1",
      evaluatorBootstrapSamplingMode: "action-ranking-audit",
      evaluatorBootstrapCertificationRole: "development",
      steps: references.map((actionRankingAuditReference) => ({
        actionRankingAuditReference
      }))
    }]
  };
}

function auditRateEvidence(successes, attempts) {
  const lowerBound = successes / attempts === 0.5 ? 0.336 : 0.5;
  const value = {
    successes,
    attempts,
    rate: successes / attempts,
    lowerBound
  };
  return {
    valid: {
      recommended: { ...value },
      selected: { ...value },
      paired: { ...value }
    },
    terminal: {
      recommended: { ...value },
      selected: { ...value },
      paired: { ...value }
    }
  };
}

function eligibleLeafValueRankingEvidence() {
  return {
    version: 1,
    referenceVersion: LEAF_VALUE_REFERENCE_VERSION,
    referenceContract: LEAF_VALUE_REFERENCE_CONTRACT,
    evaluatorPath: "gru-value-head-calibrated-probability-v1",
    splitUnit: "game-cluster-bootstrap",
    weighting: "deck-seat-macro",
    games: 120,
    contributingGames: 40,
    decisions: 80,
    correct: 60,
    accuracy: 0.75,
    accuracyLowerBound: 0.61,
    accuracyUpperBound: 0.84,
    pairedAdvantage: 0.25,
    pairedAdvantageLowerBound: 0.11,
    pairedAdvantageUpperBound: 0.34,
    bootstrap: {
      version: 1,
      unit: "game",
      stratification: "deck-seat-macro",
      samples: 2000,
      contributingGames: 40,
      mean: 0.25,
      lowerBound: 0.11,
      upperBound: 0.34,
      seedFingerprint: "stable:leaf"
    },
    formalPolicyQAudit: {
      contract: POLICY_Q_FORMAL_AUDIT_CONTRACT,
      version: 1,
      eligible: true,
      reasons: [],
      deckSeatPhaseOpportunityContract:
        "training-deck-seat-cartesian-v1",
      expectedDeckSeatPhases: ["deck-a:p1::early"]
    },
    phaseBands: eligibleLeafPhaseBands()
  };
}

function eligibleActionPhaseBands() {
  return Object.fromEntries(EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
    phase,
    {
      phase,
      decisions: 8,
      contributingGames: 8,
      neuralAccuracy: 0.75,
      comparatorAccuracy: 0.5,
      neuralAccuracyLowerBound: 0.41,
      neuralAccuracyUpperBound: 0.93,
      pairedImprovement: 0.25,
      pairedImprovementLowerBound: 0.02,
      pairedImprovementUpperBound: 0.4,
      bootstrap: {
        unit: "game",
        stratification: "deck-seat-macro",
        lowerBound: 0.02
      }
    }
  ]));
}

function eligibleLeafPhaseBands() {
  return Object.fromEntries(EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
    phase,
    {
      phase,
      decisions: 16,
      contributingGames: 8,
      accuracy: 0.75,
      accuracyLowerBound: 0.51,
      accuracyUpperBound: 0.9,
      pairedAdvantage: 0.25,
      pairedAdvantageLowerBound: 0.02,
      pairedAdvantageUpperBound: 0.4,
      bootstrap: {
        unit: "game",
        stratification: "deck-seat-macro",
        lowerBound: 0.02
      }
    }
  ]));
}

function eligibleActionClasses() {
  return Object.fromEntries(EVALUATOR_AUDIT_CORE_ACTION_CLASSES.map(
    (actionClass) => [
      actionClass,
      {
        actionClass,
        decisions: 8,
        contributingGames: 8,
        neuralAccuracy: 0.75,
        comparatorAccuracy: 0.5,
        neuralAccuracyLowerBound: 0.41,
        neuralAccuracyUpperBound: 0.93,
        pairedImprovement: 0.25,
        pairedImprovementLowerBound: 0.02,
        pairedImprovementUpperBound: 0.4,
        bootstrap: {
          unit: "game",
          stratification: "deck-seat-macro",
          lowerBound: 0.02
        }
      }
    ]
  ));
}

function mulliganTestCard(template, playerId, instanceId) {
  return {
    ...structuredClone(template),
    instanceId,
    ownerId: playerId,
    controllerId: playerId,
    zone: "hand",
    damage: 0,
    buffs: 0,
    mightModifier: 0,
    exhausted: false,
    attachments: []
  };
}

function createMulliganTestGame() {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  player.hand = [
    mulliganTestCard(cards.tibbers, player.id, "mulligan-high-1"),
    mulliganTestCard(cards.tibbers, player.id, "mulligan-high-2"),
    mulliganTestCard(cards.charm, player.id, "mulligan-low-1"),
    mulliganTestCard(cards.charm, player.id, "mulligan-low-2")
  ];
  player.mainDeck = [
    mulliganTestCard(cards.discipline, player.id, "mulligan-draw-1"),
    mulliganTestCard(cards.clockworkKeeper, player.id, "mulligan-draw-2"),
    mulliganTestCard(cards.lonelyPoro, player.id, "mulligan-draw-3"),
    mulliganTestCard(cards.scuttleCrab, player.id, "mulligan-draw-4")
  ].map((card) => ({ ...card, zone: "deck" }));
  game.phase = "mulligan";
  game.currentPlayerId = player.id;
  game.mulligan = { playerId: player.id, selectedCardIds: [] };
  return game;
}

test("focused training uses only Sett, Annie, Kai'Sa, canonical Master Yi, and Leona", () => {
  const selected = resolveTrainingDecks(decklists, "origins-era");
  assert.deepEqual(selected.map((deck) => deck.id), FOCUSED_TRAINING_DECK_IDS);
  assert.equal(selected.some((deck) => deck.id === "keenan-xiong"), false);
  assert.throws(() => resolveTrainingDecks(decklists, "origins-era", ["origins-sett", "unknown-deck"]), /unknown-deck/);
  for (const deck of selected) {
    for (const roll of [0.05, 0.2, 0.35, 0.55, 0.9]) {
      assert.equal(sameLegendIdentity(deck, mutateDeck(deck, {}, () => roll)), true);
    }
  }
  const changedLegend = { ...structuredClone(selected[0]), legend: structuredClone(selected[1].legend) };
  assert.equal(sameLegendIdentity(selected[0], changedLegend), false);
});

test("training random seeds reproduce deck and Rune shuffles", () => {
  const create = () => createGame({
    decks: decks.slice(0, 2),
    firstPlayerId: "p1",
    interactive: true,
    manualActionChainPriority: true,
    random: () => 0.25,
    randomSeed: 20260716
  });
  const first = create();
  const second = create();
  for (const game of [first, second]) {
    assert.equal(confirmFirstPlayer(game).ok, true);
    while (game.phase === "champion-select") {
      const player = game.players.find((candidate) => candidate.id === game.championSelectPlayerId);
      assert.equal(selectChampion(game, player.id, player.availableChampions[0].instanceId).ok, true);
    }
  }
  const sequence = (game) => game.players.map((player) => ({
    hand: player.hand.map((card) => card.cardNumber),
    main: player.mainDeck.map((card) => card.cardNumber),
    runes: player.runeDeck.map((card) => card.cardNumber)
  }));
  assert.deepEqual(sequence(first), sequence(second));
});

test("training random state can be checkpointed and restored exactly", () => {
  const random = seededRandom(20260725);
  random();
  const checkpoint = random.getState();
  const expected = [random(), random(), random()];
  random.setState(checkpoint);
  assert.deepEqual([random(), random(), random()], expected);
});

test("paired evaluation swaps model-role draw streams instead of changing each role's draw", () => {
  const create = (candidateSeat) => createGame({
    decks: [decks[0], decks[0]],
    firstPlayerId: "p1",
    interactive: true,
    manualActionChainPriority: true,
    randomSeed: 731,
    playerRandomSeeds: pairedEvaluationPlayerSeeds(731, candidateSeat)
  });
  const games = [create(0), create(1)];
  for (const game of games) {
    assert.equal(confirmFirstPlayer(game).ok, true);
    while (game.phase === "champion-select") {
      const player = game.players.find((candidate) => candidate.id === game.championSelectPlayerId);
      assert.equal(selectChampion(game, player.id, player.availableChampions[0].instanceId).ok, true);
    }
  }
  const cardNumbers = (cards) => cards.map((card) => card.cardNumber);
  assert.deepEqual(cardNumbers(games[0].players[0].hand), cardNumbers(games[1].players[1].hand));
  assert.deepEqual(cardNumbers(games[0].players[1].hand), cardNumbers(games[1].players[0].hand));
  assert.deepEqual(cardNumbers(games[0].players[0].runeDeck), cardNumbers(games[1].players[1].runeDeck));
});

test("v3 paired evaluation crosses both random streams over the same four conditions", () => {
  const firstAssignment = [
    pairedEvaluationPlayerSeeds(991, 0, 0),
    pairedEvaluationPlayerSeeds(991, 1, 0)
  ];
  const crossedAssignment = [
    pairedEvaluationPlayerSeeds(991, 0, 1),
    pairedEvaluationPlayerSeeds(991, 1, 1)
  ];
  assert.equal(firstAssignment[0].p1, firstAssignment[1].p2);
  assert.equal(firstAssignment[0].p2, firstAssignment[1].p1);
  assert.equal(crossedAssignment[0].p1, firstAssignment[0].p2);
  assert.equal(crossedAssignment[0].p2, firstAssignment[0].p1);
  const audit = auditEvaluationScheduleSymmetry(80, {
    evaluationMode: "same-deck-mirror-v3"
  });
  assert.equal(audit.passed, true);
  assert.equal(audit.blockSize, 8);
  assert.deepEqual(audit.streamAssignments, {
    "candidate-stream-0": 40,
    "candidate-stream-1": 40
  });
});

test("teacher correction identities are stable across replay order and ignore hidden engine fields", () => {
  const publicStep = {
    actorId: "p1",
    state: Float32Array.from([0.25, -0.5, 1]),
    initialMemory: Float32Array.from([0.1, 0.2]),
    legalActionKeys: ["endTurn", "moveUnits:a+b"],
    selectedIndex: 0,
    teacherIndex: 1,
    behaviorActionKey: "endTurn",
    recommendedActionKey: "moveUnits:a+b"
  };
  const informationSetHash = createInformationSetHash(publicStep);
  const first = stableTeacherCorrectionId(
    { gameId: "game-1", playerId: "p1" },
    { ...publicStep, informationSetHash, hiddenDeckOrder: ["secret-a"] },
    "postmortem"
  );
  const second = stableTeacherCorrectionId(
    { gameId: "reordered-replay-900", playerId: "p1" },
    { ...publicStep, informationSetHash, hiddenDeckOrder: ["secret-b"] },
    "postmortem"
  );
  assert.equal(first, second);
});

test("teacher correction lifecycle requires two distinct margin passes before dormancy", () => {
  const first = advanceCorrectionLifecycleRecord(null, {
    achievedMargin: 0.9,
    targetMargin: 0.65,
    dormantThreshold: 0.85,
    lifecycleStep: 7
  });
  assert.equal(first.state, "decayed");
  assert.equal(first.consecutiveMarginPasses, 1);
  const duplicateSameRun = advanceCorrectionLifecycleRecord(first, {
    achievedMargin: 0.91,
    targetMargin: 0.65,
    dormantThreshold: 0.85,
    lifecycleStep: 7
  });
  assert.equal(duplicateSameRun.state, "decayed");
  assert.equal(duplicateSameRun.consecutiveMarginPasses, 1);
  const secondRun = advanceCorrectionLifecycleRecord(duplicateSameRun, {
    achievedMargin: 0.9,
    targetMargin: 0.65,
    dormantThreshold: 0.85,
    lifecycleStep: 8
  });
  assert.equal(secondRun.state, "dormant");
  assert.equal(secondRun.consecutiveMarginPasses, 2);
});

test("generic tactical semantics prefer aligned targets and reject hopeless reinforcement", () => {
  const actor = { id: "p1", base: [], hand: [], runes: [], trash: [], banished: [] };
  const opponent = { id: "p2", base: [], hand: [], runes: [], trash: [], banished: [] };
  const friendly = { ...structuredClone(cards.lonelyPoro), instanceId: "friendly", ownerId: "p1", controllerId: "p1", might: 1, damage: 0 };
  const enemy = { ...structuredClone(cards.deadbloomPredator), instanceId: "enemy", ownerId: "p2", controllerId: "p2", might: 5, damage: 0 };
  actor.base = [friendly];
  const game = {
    players: [actor, opponent],
    battlefields: [{ instanceId: "field", units: [enemy], hidden: [] }],
    pendingChoice: {
      playerId: "p1",
      card: { ...structuredClone(cards.primalStrength), instanceId: "strength", ownerId: "p1", controllerId: "p1" },
      options: [{ id: "friendly", cardId: "friendly" }, { id: "enemy", cardId: "enemy" }],
      data: { currentDeclaration: { spec: cards.primalStrength.effects[0] } }
    }
  };
  const buffFriend = tacticalActionProfile(game, "p1", { kind: "chooseEffectOption", optionId: "friendly" });
  const buffEnemy = tacticalActionProfile(game, "p1", { kind: "chooseEffectOption", optionId: "enemy" });
  assert.equal(buffFriend.targetAlignment, 1);
  assert.equal(buffEnemy.targetAlignment, -1);
  assert.equal(buffFriend.tacticalPrior > buffEnemy.tacticalPrior, true);

  const friendlyAtShowdown = { ...friendly, instanceId: "showdown-friendly" };
  game.battlefields[0].units = [friendlyAtShowdown, enemy];
  game.phase = "showdown";
  game.showdown = { battlefieldId: "field" };
  game.pendingChoice = {
    playerId: "p1",
    card: { ...structuredClone(cards.discipline), instanceId: "discipline", ownerId: "p1", controllerId: "p1" },
    options: [{ id: "enemy", cardId: "enemy" }],
    data: { currentDeclaration: { spec: cards.discipline.effects[0] } }
  };
  const drawThroughLostCombat = tacticalActionProfile(game, "p1", { kind: "chooseEffectOption", optionId: "enemy" });
  assert.equal(drawThroughLostCombat.casterSideBenefit > 0, true);
  assert.equal(drawThroughLostCombat.targetImpact < 0.5, true);
  assert.equal(drawThroughLostCombat.tacticalPrior > -0.2, true,
    "an irrelevant temporary enemy buff does not erase the independent Draw value");

  game.pendingChoice.options = [{ id: "showdown-friendly", cardId: "showdown-friendly" }];
  game.actionChain = { chain: [{
    card: {
      instanceId: "incoming-damage",
      effects: [{ timing: "spell", kind: "damage", amount: 2 }],
      declaredPlayTargets: [{ targetId: "showdown-friendly" }]
    }
  }] };
  const saveFromDamage = tacticalActionProfile(game, "p1", { kind: "chooseEffectOption", optionId: "showdown-friendly" });
  assert.equal(saveFromDamage.savesFromLethal, true);
  assert.equal(saveFromDamage.tacticalPrior > drawThroughLostCombat.tacticalPrior, true,
    "surviving pending lethal damage outweighs the draw-only enemy-target line");

  game.pendingChoice = null;
  game.phase = "action";
  game.showdown = null;
  game.actionChain = null;
  game.battlefields[0].units = [enemy];
  actor.base = [friendly];
  game.battlefields[0].units.push({ ...enemy, instanceId: "enemy-2", might: 8 });
  const reinforce = tacticalActionProfile(game, "p1", { kind: "moveUnit", unitId: "friendly", destinationId: "field" });
  assert.equal(reinforce.hopelessReinforcement, true);
  assert.equal(reinforce.tacticalPrior < 0, true);
});

test("tactical heuristics are learned features and never bypass the neural policy logits", () => {
  const model = createNeuralModel();
  for (const layer of Object.values(model.layers)) {
    const weights = layer.getWeights();
    if (!weights.length) continue;
    const zeros = weights.map((weight) => tf.zeros(weight.shape));
    layer.setWeights(zeros);
    zeros.forEach((weight) => weight.dispose());
  }
  const states = tf.zeros([1, 1, STATE_DIM]);
  const actionData = new Float32Array(MAX_ACTIONS * ACTION_DIM);
  actionData[LEGACY_ACTION_DIM + 15] = 1;
  actionData[ACTION_DIM + LEGACY_ACTION_DIM + 15] = -1;
  const actions = tf.tensor4d(actionData, [1, 1, MAX_ACTIONS, ACTION_DIM]);
  const output = forwardNeural(model, states, actions);
  const logits = Array.from(output.logits.slice([0, 0, 0], [1, 1, 2]).dataSync());
  assert.deepEqual(logits, [0, 0]);
  Object.values(output).forEach((tensor) => tensor?.dispose?.());
  states.dispose();
  actions.dispose();
});

test("AI mulligan policy compares atomic keep, single-card, and two-card plans", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const plans = enumerateAiPolicyActions(game, player.id);

  assert.equal(plans.every((action) => action.kind === "submitMulligan"), true);
  assert.equal(plans.some((action) => action.cardIds.length === 0), true);
  assert.equal(plans.some((action) => action.cardIds.length === 1), true);
  assert.equal(plans.some((action) => action.cardIds.length === 2), true);
  assert.equal(plans.length, 6);
  assert.equal(enumerateLegalActions(game, player.id).some((action) => action.kind === "toggleMulliganCard"), true);
});

test("atomic mulligan execution returns the chosen cards without intermediate policy states", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const selectedIds = player.hand.filter((card) => card.energy >= 7).map((card) => card.instanceId);

  assert.equal(applyAiAction(game, { kind: "submitMulligan", cardIds: selectedIds }, player.id).ok, true);
  assert.equal(game.mulligan.playerId, game.players[1].id);
  assert.deepEqual(player.hand.map((card) => card.instanceId), [
    "mulligan-low-1", "mulligan-low-2", "mulligan-draw-1", "mulligan-draw-2"
  ]);
  assert.deepEqual(player.mainDeck.slice(-2).map((card) => card.instanceId).sort(), selectedIds.sort());
});

test("AI privately remembers mulliganed bottom cards until their deck incarnation leaves", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const selectedIds = player.hand.filter((card) => card.energy >= 7).map((card) => card.instanceId);
  assert.equal(applyAiAction(game, { kind: "submitMulligan", cardIds: selectedIds }, player.id).ok, true);

  const ownObservation = observeGame(game, player.id);
  const opponentObservation = observeGame(game, game.players[1].id);
  assert.deepEqual(ownObservation.self.mulliganBottomCards.map((card) => card.instanceId).sort(), [...selectedIds].sort());
  assert.equal(ownObservation.self.mulliganBottomCardsAhead, 2);
  assert.deepEqual(opponentObservation.opponent.mulliganBottomCards, []);

  const withKnowledge = encodeState(game, player.id);
  const withoutKnowledgeGame = structuredClone(game);
  withoutKnowledgeGame.players[0].mulliganBottomKnowledge = [];
  assert.notDeepEqual([...withKnowledge], [...encodeState(withoutKnowledgeGame, player.id)]);

  const bottomed = player.mainDeck.find((card) => selectedIds.includes(card.instanceId));
  player.mainDeck = [bottomed, ...player.mainDeck.filter((card) => card.instanceId !== bottomed.instanceId)];
  draw(player, 1, game);
  assert.equal(observeGame(game, player.id).self.mulliganBottomCards.some((card) => card.instanceId === bottomed.instanceId), false);
});

test("remaining-deck memory estimates draws without treating known bottom cards as immediately drawable", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const selectedIds = player.hand.filter((card) => card.energy >= 7).map((card) => card.instanceId);
  assert.equal(applyAiAction(game, { kind: "submitMulligan", cardIds: selectedIds }, player.id).ok, true);

  const before = remainingDeckProfile(game, player.id);
  assert.equal(before.deckCount, 4);
  assert.equal(before.immediatePoolCount, 2);
  assert.equal(before.knownBottomCount, 2);
  assert.equal(before.topCards.some((card) => card.cardNumber === cards.tibbers.cardNumber), false);
  assert.ok(before.topCards.every((card) => Math.abs(card.nextDrawProbability - 0.5) < 1e-9));

  draw(player, 2, game);
  const reachedBottom = remainingDeckProfile(game, player.id);
  assert.equal(reachedBottom.immediatePoolCount, 2);
  assert.equal(reachedBottom.topCards.length, 1);
  assert.equal(reachedBottom.topCards[0].cardNumber, cards.tibbers.cardNumber);
  assert.equal(reachedBottom.topCards[0].nextDrawProbability, 1);
});

test("a full main-deck shuffle clears remembered bottom placement", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const selectedIds = player.hand.filter((card) => card.energy >= 7).map((card) => card.instanceId);
  assert.equal(applyAiAction(game, { kind: "submitMulligan", cardIds: selectedIds }, player.id).ok, true);
  assert.equal(remainingDeckProfile(game, player.id).knownBottomCount, 2);

  player.mainDeck.reverse();
  invalidateBottomDeckKnowledge(player);
  assert.equal(remainingDeckProfile(game, player.id).knownBottomCount, 0);
  assert.deepEqual(observeGame(game, player.id).self.knownBottomCards, []);
});

test("recycled cards form a later known-bottom batch and stay unlikely until earlier cards are drawn", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const selectedIds = player.hand.filter((card) => card.energy >= 7).map((card) => card.instanceId);
  assert.equal(applyAiAction(game, { kind: "submitMulligan", cardIds: selectedIds }, player.id).ok, true);

  const recycled = player.hand.pop();
  recycleMainDeckCards(game, player, [recycled]);
  const profile = remainingDeckProfile(game, player.id);
  assert.equal(profile.knownBottomCount, 3);
  assert.equal(profile.knownBottomBatchCount, 2);
  assert.equal(profile.topCards.some((card) => card.cardNumber === recycled.cardNumber), false);

  draw(player, 2, game);
  const firstKnownBatch = remainingDeckProfile(game, player.id);
  assert.equal(firstKnownBatch.topCards.length, 1);
  assert.equal(firstKnownBatch.topCards[0].cardNumber, cards.tibbers.cardNumber);
  draw(player, 2, game);
  const recycledReachedTop = remainingDeckProfile(game, player.id);
  assert.equal(recycledReachedTop.topCards[0].cardNumber, recycled.cardNumber);
  assert.equal(recycledReachedTop.topCards[0].nextDrawProbability, 1);
});

test("value calibration learns an intercept when raw values have a systematic bias", () => {
  const samples = Array.from({ length: 50 }, (_, index) => ({ value: 0.8, outcome: index < 10 ? 1 : 0 }));
  const calibration = calibrateValueSamples(samples);
  const predicted = calibratedProbability(0.8, calibration.temperature, calibration.bias);
  assert.ok(calibration.bias < 0);
  assert.ok(Math.abs(predicted - 0.2) < 0.01);
  assert.ok(calibration.expectedCalibrationError < 0.01);
});

test("value calibration labels use terminal wins instead of shaped returns", () => {
  const calibration = calibrateValueHead(Array.from({ length: 10 }, (_, index) => ({
    gameId: `terminal-label-${index}`,
    terminalOutcome: -1,
    steps: [{ value: 0.8, return: 1, terminalOutcome: -1 }]
  })));
  assert.ok(calibration.bias < 0);
  assert.equal(calibration.bins.every((bin) => bin.observed === 0), true);
});

test("calibration splits whole games and reports ranking only on the independent side", () => {
  const trajectories = Array.from({ length: 12 }, (_, game) => [0, 1].map((seat) => ({
    gameId: `calibration-game-${game}`,
    playerId: `p${seat + 1}`,
    deckId: game % 2 ? "a" : "b",
    steps: []
  }))).flat();
  const split = splitCalibrationTrajectoriesByGame(trajectories, {
    testFraction: 0.4,
    seed: 917
  });
  const fitGames = new Set(split.fit.map((item) => item.gameId));
  assert.equal(split.test.some((item) => fitGames.has(item.gameId)), false);
  assert.equal(split.manifest.overlapGames, 0);

  const fitSamples = Array.from({ length: 20 }, (_, index) => ({
    gameId: `fit-${Math.floor(index / 2)}`,
    value: index < 10 ? -0.5 : 0.5,
    outcome: index < 10 ? 0 : 1
  }));
  const testSamples = Array.from({ length: 20 }, (_, index) => ({
    gameId: `test-${Math.floor(index / 2)}`,
    value: index < 10 ? -0.4 : 0.4,
    outcome: index < 10 ? 0 : 1
  }));
  const calibration = calibrateValueSamples(fitSamples, {
    testSamples,
    fitGames: 10,
    testGames: 10
  });
  assert.equal(calibration.evaluationScope, "independent-game-holdout");
  assert.equal(calibration.rankingAuc, 1);
  assert.equal(Number.isFinite(calibration.logLoss), true);
  assert.equal(Number.isFinite(calibration.calibrationSlope), true);
  assert.equal(calibration.teacherPromotionEligible, false);
  assert.equal(calibration.bootstrap.unit, "game");
});

test("protected evaluator calibration is measured without refitting", () => {
  const frozen = { temperature: 2.35, bias: -0.42 };
  const samples = Array.from({ length: 120 }, (_, index) => ({
    gameId: `frozen-calibration-${index}`,
    value: index % 2 ? 0.6 : -0.6,
    outcome: index % 2 ? 1 : 0
  }));
  const measured = evaluateCalibratedValueSamples(samples, frozen, {
    testGames: 120
  });
  assert.equal(measured.temperature, frozen.temperature);
  assert.equal(measured.bias, frozen.bias);
  assert.equal(
    measured.evaluationScope,
    "frozen-independent-game-holdout"
  );
  assert.equal(measured.rankingAuc, 1);
  assert.equal(Number.isFinite(measured.logLoss), true);
  assert.equal(Number.isFinite(measured.calibrationSlope), true);
});

test("turning-point replay keeps compact prioritized windows and deduplicates persistent samples", () => {
  const steps = Array.from({ length: 40 }, (_, index) => ({ index, turningPoint: null }));
  steps[5].turningPoint = "lead-breakaway";
  steps[11].turningPoint = "lead-flip";
  steps[35].turningPoint = "near-victory";
  const extracted = extractTurningPointReplays([{
    gameId: "worker-0-game-3",
    playerId: "p1",
    completed: true,
    engineFingerprint: "fingerprint",
    steps
  }], { before: 3, after: 2, maxPerTrajectory: 2, sourceCollectionKey: "collection-a" });

  assert.equal(extracted.length, 2);
  assert.deepEqual(extracted.map((trajectory) => trajectory.turningPoint), ["lead-flip", "near-victory"]);
  assert.ok(extracted.every((trajectory) => trajectory.steps.length <= 6));
  assert.ok(extracted.every((trajectory) => trajectory.sourceCollectionKey === "collection-a"));
  const merged = mergeTurningPointReplays(extracted, [structuredClone(extracted[0])], 8);
  assert.equal(merged.length, 2);
  assert.equal(sampleTurningPointReplays(merged, 1, () => 0).length, 1);
});

test("turning-point replay prioritizes high-regret teacher corrections", () => {
  const trajectories = [
    { replayId: "ordinary", turningPoint: "lead-breakaway", steps: [{}] },
    { replayId: "stale", turningPoint: "stale-hand", steps: [{}] },
    { replayId: "teacher", turningPoint: "teacher-critical", steps: [{}] }
  ];
  assert.equal(sampleTurningPointReplays(trajectories, 1, () => 0.5)[0].replayId, "teacher");
  assert.equal(classifyTeacherCorrectionPoint({
    teacherLabelVersion: TEACHER_LABEL_VERSION,
    teacherCorrectionEligible: true,
    teacherConfidence: 0.8,
    teacherIndex: 1,
    selectedIndex: 0,
    teacherSelectedRegret: 0.14
  }), "teacher-critical");
});

test("teacher confidence uses rollout precision and candidate value targets preserve every searched alternative", () => {
  const shallow = [
    { decisionScore: 0.7, expectedWinRate: 0.7, confidenceInterval: [0.25, 1], simulations: 2 },
    { decisionScore: 0.55, expectedWinRate: 0.55, confidenceInterval: [0.1, 1], simulations: 2 }
  ];
  const deep = [
    { decisionScore: 0.7, expectedWinRate: 0.7, confidenceInterval: [0.66, 0.74], simulations: 12 },
    { decisionScore: 0.55, expectedWinRate: 0.55, confidenceInterval: [0.51, 0.59], simulations: 12 }
  ];
  assert.ok(teacherDecisionConfidence(deep) > teacherDecisionConfidence(shallow));
  assert.ok(teacherDecisionConfidence(shallow) <= Math.sqrt(2 / 16),
    "two model rollouts must never become a high-confidence teacher label");

  const legal = [{ kind: "endTurn" }, { kind: "moveUnit", unitIds: ["u1"], destination: "base" }];
  const supervision = teacherAlternativeValueSupervision({
    confidence: 0.8,
    alternatives: [
      { action: legal[0], expectedWinRate: 0.25, confidenceInterval: [0.2, 0.3] },
      { action: legal[1], expectedWinRate: 0.75, confidenceInterval: [0.7, 0.8] }
    ]
  }, legal, 0.8);
  assert.deepEqual(supervision.targets, [-0.5, 0.5]);
  assert.ok(supervision.weights.every((weight) => weight > 0.7 && weight < 0.8));
});

test("teacher final verification records the confidence gate instead of leaving a false verified status", () => {
  const preliminary = {
    status: "verified",
    correctionEligible: true,
    confidenceCap: 1,
    confidenceMultiplier: 1,
    reasons: []
  };
  const blocked = finalizeTeacherVerification(preliminary, 0.305, 0.35);
  assert.equal(blocked.status, "provisional");
  assert.equal(blocked.correctionEligible, false);
  assert.ok(blocked.reasons.includes("below-correction-confidence-threshold"));

  const terminalProof = finalizeTeacherVerification(preliminary, 1, 0);
  assert.equal(terminalProof.status, "verified");
  assert.equal(terminalProof.correctionEligible, true);
  assert.deepEqual(terminalProof.reasons, []);
});

test("teacher evaluator comparison trusts shared ranking direction and blocks material ranking conflicts", () => {
  const aligned = teacherEvaluatorComparison({
    expectedWinRate: 0.8,
    neuralLeafWinRate: 0.8,
    heuristicLeafWinRate: 0.7,
    independentEvaluatorLeafWinRate: 0.75,
    independentEvaluatorAvailable: true
  }, {
    expectedWinRate: 0.4,
    neuralLeafWinRate: 0.4,
    heuristicLeafWinRate: 0.3,
    independentEvaluatorLeafWinRate: 0.35,
    independentEvaluatorAvailable: true
  });
  assert.equal(aligned.available, true);
  assert.equal(aligned.conflict, false);
  assert.equal(aligned.agreesOnDirection, true);

  const conflicted = teacherEvaluatorComparison({
    expectedWinRate: 0.8,
    neuralLeafWinRate: 0.8,
    heuristicLeafWinRate: 0.2,
    independentEvaluatorLeafWinRate: 0.2,
    independentEvaluatorAvailable: true
  }, {
    expectedWinRate: 0.4,
    neuralLeafWinRate: 0.4,
    heuristicLeafWinRate: 0.6,
    independentEvaluatorLeafWinRate: 0.6,
    independentEvaluatorAvailable: true
  });
  assert.equal(conflicted.conflict, true);
  assert.equal(conflicted.materialConflict, true);

  const actionQRoute = teacherEvaluatorComparison({
    expectedWinRate: 0.8,
    neuralLeafWinRate: 0.8,
    heuristicLeafWinRate: 0.7,
    independentEvaluatorLeafWinRate: 0.1,
    independentEvaluatorAvailable: true,
    independentEvaluatorActionQWinRate: 0.9,
    independentEvaluatorActionQWinRatesByModel: [0.9],
    independentEvaluatorActionQAvailable: true
  }, {
    expectedWinRate: 0.4,
    neuralLeafWinRate: 0.4,
    heuristicLeafWinRate: 0.3,
    independentEvaluatorLeafWinRate: 0.9,
    independentEvaluatorAvailable: true,
    independentEvaluatorActionQWinRate: 0.2,
    independentEvaluatorActionQWinRatesByModel: [0.2],
    independentEvaluatorActionQAvailable: true
  });
  assert.equal(actionQRoute.available, true);
  assert.equal(actionQRoute.independentDelta > 0, true);
  assert.equal(actionQRoute.conflict, false);
});

test("teacher verification keeps nonterminal regrouping and over-retreats out of focused correction", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actor = game.players[0];
  const unit = (id, might) => ({
    ...structuredClone(cards.lonelyPoro),
    instanceId: id,
    ownerId: actor.id,
    controllerId: actor.id,
    zone: "battlefield",
    type: "unit",
    might,
    damage: 0,
    buffs: 0,
    mightModifier: 0,
    exhausted: false,
    cantMoveThisTurn: false,
    attachments: [],
    effects: [],
    keywords: []
  });
  const field = {
    ...structuredClone(actor.availableBattlefields[0]),
    instanceId: "teacher-retreat-field",
    controlledBy: actor.id,
    units: [unit("retreat-one", 3), unit("retreat-two", 3)],
    hidden: [],
    effects: []
  };
  game.battlefields = [field];
  game.phase = "action";
  game.currentPlayerId = actor.id;
  game.turnPlayerId = actor.id;
  game.pendingChoice = null;
  game.pendingPayment = null;
  game.actionChain = null;
  game.showdown = null;
  const all = { kind: "moveUnits", unitIds: field.units.map((card) => card.instanceId), destinationId: "base" };
  const one = { kind: "moveUnit", unitId: field.units[0].instanceId, destinationId: "base" };
  const verification = teacherActionVerification(game, actor.id, {
    action: all,
    simulations: 8,
    terminalRate: 0,
    saturatedLeafRate: 0,
    neuralHeuristicDisagreement: 0
  }, [{ action: all }, { action: one }], {
    simulations: 8,
    pairedEvidence: { samples: 8, mean: 0.15, lowerBound: 0.08, positiveRate: 1 }
  });
  assert.equal(verification.correctionEligible, false);
  assert.ok(verification.confidenceCap <= 0.2);
  assert.ok(verification.reasons.includes("movement-overcommitment-has-safer-subset"));
  assert.ok(verification.reasons.includes("nonterminal-regrouping-requires-long-horizon-proof"));
});

test("teacher verification rejects rollout evidence with an incomplete determinization audit", () => {
  const game = createMulliganTestGame();
  const actorId = activeActorId(game);
  const best = {
    action: { kind: "endTurn" },
    simulations: 16,
    initialChoiceRate: 0,
    rolloutEvidenceEligible: true,
    validRate: 1,
    terminalRate: 1,
    saturatedLeafRate: 0,
    neuralHeuristicDisagreement: 0
  };
  const selected = {
    ...best,
    action: { kind: "passShowdown" }
  };
  const verification = teacherActionVerification(game, actorId, best, [best, selected], {
    selectedAlternative: selected,
    pairedEvidence: {
      samples: 16,
      mean: 0.2,
      lowerBound: 0.1,
      upperBound: 0.3
    },
    simulations: 16,
    determinizationAudit: {
      version: 1,
      complete: false,
      recommended: {
        failures: 1,
        invalidReasons: { "missing-belief-posterior": 1 }
      }
    }
  });
  assert.equal(verification.correctionEligible, false);
  assert.equal(
    verification.reasons.includes("determinization-audit-incomplete"),
    true
  );
});

test("terminal proofs and complete declaration macros bypass only the gates they actually prove", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = game.players[0].id;
  const terminal = teacherActionVerification(game, actorId, {
    action: { kind: "endTurn" },
    simulations: 8,
    terminalRate: 1,
    saturatedLeafRate: 0,
    neuralHeuristicDisagreement: 0
  }, [], {
    simulations: 8,
    terminalDominance: true,
    terminalProofKind: "unanimous-terminal-win",
    determinizationAudit: { version: 1, complete: true },
    pairedEvidence: null
  });
  assert.equal(terminal.correctionEligible, true);
  assert.equal(terminal.proofKind, "unanimous-terminal-win");
  assert.equal(terminal.reasons.includes("paired-improvement-not-proven"), false);

  const macro = teacherActionVerification(game, actorId, {
    action: { kind: "endTurn" },
    simulations: 8,
    initialChoiceRate: 1,
    macroContinuation: { verified: true },
    terminalRate: 0,
    saturatedLeafRate: 0,
    neuralHeuristicDisagreement: 0,
    neuralLeafWinRate: 0.7,
    heuristicLeafWinRate: 0.68,
    independentEvaluatorLeafWinRate: 0.66,
    independentEvaluatorAvailable: true,
    independentEvaluatorPolicyCorrectionEligible: true
  }, [], {
    simulations: 8,
    determinizationAudit: { version: 1, complete: true },
    macroDemonstration: { verified: true, steps: [{}] },
    pairedEvidence: { samples: 8, mean: 0.12, lowerBound: 0.04, positiveRate: 0.875 },
    selectedAlternative: {
      terminalRate: 0,
      neuralLeafWinRate: 0.5,
      heuristicLeafWinRate: 0.48,
      independentEvaluatorLeafWinRate: 0.47,
      independentEvaluatorAvailable: true,
    independentEvaluatorPolicyCorrectionEligible: true
    }
  });
  assert.equal(macro.correctionEligible, true);
  assert.equal(macro.proofKind, "verified-declaration-macro");
  assert.equal(macro.reasons.includes("unresolved-declaration-continuation"), false);
});

test("defeat postmortem reviews only separated decisive points and requires deep paired proof", () => {
  const selected = selectSeparatedPostmortemCandidates([
    { actionCount: 10, priority: 8 },
    { actionCount: 12, priority: 10 },
    { actionCount: 30, priority: 7 }
  ], 2, 6);
  assert.deepEqual(selected.map((candidate) => candidate.actionCount), [12, 30]);

  const candidate = {
    actorId: "p2",
    actionCount: 30,
    reasons: ["lead-flip", "movement-group-comparison"],
    selectedAction: { kind: "moveUnit", unitId: "u1", destinationId: "field" },
    legalActions: [
      { kind: "moveUnit", unitId: "u1", destinationId: "field" },
      { kind: "moveUnits", unitIds: ["u1", "u2"], destinationId: "field" }
    ],
    game: { phase: "action", turn: 4, turnSequence: 8, players: [], battlefields: [] }
  };
  const teacher = {
    labelVersion: TEACHER_LABEL_VERSION,
    action: candidate.legalActions[1],
    selectedIndex: 1,
    expectedWinRate: 0.72,
    correctionConfidence: 0.8,
    correctionEligible: true,
    correctionAlternativeKeys: [actionKey(candidate.legalActions[1])],
    verification: { status: "verified", proofKind: "paired-rollout-improvement", reasons: [] },
    confirmation: {
      independent: true,
      validPairedSamples: 16,
      validRates: { recommended: 1, selected: 1 },
      determinizationAudit: { version: 1, complete: true },
      seedBanks: { screening: ["screen-a"], confirmation: ["confirm-a"], disjoint: true }
    },
    policyComparison: {
      regret: 0.22,
      selectedExpectedWinRate: 0.5,
      pairedEvidence: { samples: 16, mean: 0.22, lowerBound: 0.08, positiveRate: 0.875 }
    },
    alternatives: [
      { action: candidate.legalActions[1], expectedWinRate: 0.72, simulations: 16 },
      { action: candidate.legalActions[0], expectedWinRate: 0.5, simulations: 16 }
    ]
  };
  const verified = buildPostmortemReview(candidate, teacher, {
    minimumSimulations: 16,
    minimumConfidence: 0.45,
    minimumRegret: 0.05
  });
  assert.equal(verified.avoidableLoss, true);
  assert.equal(verified.verifiedLocalRegret, true);
  assert.equal(verified.status, "verified-local-regret");
  assert.equal(verified.cause, "fragmented-attack");

  const shallow = buildPostmortemReview(candidate, {
    ...teacher,
    policyComparison: {
      ...teacher.policyComparison,
      pairedEvidence: { samples: 8, mean: 0.22, lowerBound: 0.08, positiveRate: 0.875 }
    }
  }, {
    minimumSimulations: 16,
    minimumConfidence: 0.45,
    minimumRegret: 0.05
  });
  assert.equal(shallow.avoidableLoss, false);
  assert.equal(shallow.status, "unproven");
});

test("postmortem audits a matched winner sample only when configured and uses local-regret corrections", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const loser = game.players[1].id;
  const winner = game.players[0].id;
  const legalActions = [{ kind: "endTurn" }, { kind: "moveUnits", unitIds: ["u1", "u2"], destinationId: "field" }];
  const parentStep = { actionCount: 20 };
  const winnerStep = { actionCount: 21 };
  const candidate = {
    version: POSTMORTEM_REVIEW_VERSION,
    actorId: loser,
    actionCount: 20,
    priority: 10,
    reasons: ["lead-flip"],
    game,
    legalActions,
    selectedAction: legalActions[0],
    policyProbabilities: [0.8, 0.2],
    initialMemories: {},
    requiredActions: [],
    uncertainty: 0.5,
    reviewSeed: 7,
    step: parentStep
  };
  const summary = reviewDefeatPostmortems(new Map([
    [loser, [candidate]],
    [winner, [{ ...candidate, actorId: winner, step: winnerStep }]]
  ]), {
    winnerId: winner,
    maximumReviews: 2,
    winnerReviewFraction: 1,
    minimumSimulations: 16,
    neuralModels: {},
    teacherDecision: () => ({
      labelVersion: TEACHER_LABEL_VERSION,
      action: legalActions[1],
      selectedIndex: 1,
      expectedWinRate: 0.75,
      searchConfidence: 0.8,
      correctionConfidence: 0.8,
      correctionEligible: true,
      correctionAlternativeKeys: [actionKey(legalActions[1])],
      verification: { status: "verified", proofKind: "paired-rollout-improvement", reasons: [] },
      confirmation: {
        independent: true,
        validPairedSamples: 16,
        validRates: { recommended: 1, selected: 1 },
        determinizationAudit: { version: 1, complete: true },
        seedBanks: { screening: ["screen-b"], confirmation: ["confirm-b"], disjoint: true }
      },
      policyComparison: {
        regret: 0.25,
        selectedExpectedWinRate: 0.5,
        pairedEvidence: { samples: 16, mean: 0.25, lowerBound: 0.1, positiveRate: 0.875 }
      },
      alternatives: [
        { action: legalActions[1], decisionScore: 0.75, expectedWinRate: 0.75, confidenceInterval: [0.68, 0.82], simulations: 16 },
        { action: legalActions[0], decisionScore: 0.5, expectedWinRate: 0.5, confidenceInterval: [0.42, 0.58], simulations: 16 }
      ]
    })
  });
  assert.equal(summary.reviewed, 2);
  assert.equal(summary.winnerAudits, 1);
  assert.equal(summary.loserAudits, 1);
  assert.equal(summary.verifiedCorrections, 2);
  assert.equal(parentStep.postmortemReview.avoidableLoss, true);
  assert.equal(parentStep.postmortemReview.verifiedLocalRegret, true);
  assert.equal(parentStep.postmortemCorrectionSteps.length, 1);
  assert.equal(parentStep.postmortemCorrectionSteps[0].source, "postmortem-local-regret");
  assert.equal(winnerStep.postmortemReview.outcomeRole, "winner");
  assert.equal(winnerStep.postmortemCorrectionSteps.length, 1);
});

test("proof teacher corrects a locally dominated target without spending a simulation budget", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actor = game.players[0];
  const opponent = game.players[1];
  const unit = (template, owner, instanceId, zone) => ({
    ...structuredClone(template),
    instanceId,
    ownerId: owner.id,
    controllerId: owner.id,
    zone,
    damage: 0,
    buffs: 0,
    mightModifier: 0,
    exhausted: false,
    attachments: [],
    effects: []
  });
  const friendly = unit(cards.lonelyPoro, actor, "proof-friendly", "base");
  const enemy = unit(cards.lonelyPoro, opponent, "proof-enemy", "battlefield");
  actor.base = [friendly];
  game.battlefields = [{
    ...structuredClone(actor.availableBattlefields[0]),
    instanceId: "proof-field",
    ownerId: null,
    controllerId: null,
    controlledBy: opponent.id,
    effects: [],
    hidden: [],
    units: []
  }];
  game.battlefields[0].units = [enemy];
  const source = {
    ...structuredClone(cards.primalStrength),
    instanceId: "proof-source",
    ownerId: actor.id,
    controllerId: actor.id,
    effects: [{ timing: "spell", kind: "modifyMight", target: "unit", amount: 2 }]
  };
  game.phase = "action";
  game.currentPlayerId = actor.id;
  game.turnPlayerId = actor.id;
  game.pendingChoice = {
    playerId: actor.id,
    card: source,
    options: [friendly, enemy].map((card) => ({ id: card.instanceId, cardId: card.instanceId })),
    data: { currentDeclaration: { spec: source.effects[0] } },
    optional: false
  };
  const friendlyAction = { kind: "chooseEffectOption", optionId: friendly.instanceId };
  const enemyAction = { kind: "chooseEffectOption", optionId: enemy.instanceId };
  const proof = proofTeacherDecision(game, actor.id, [enemyAction, friendlyAction], enemyAction);

  assert.equal(proof.labelVersion, PROOF_LABEL_VERSION);
  assert.equal(proof.proofKind, "dominated-effect-target");
  assert.equal(proof.evidenceKind, "rule-guard");
  assert.ok(proof.confidence < 1);
  assert.equal(proof.correctionEligible, true);
  assert.equal(proof.selectedIndex, 1);
  assert.deepEqual(proof.targets, [0, 1]);

  const ambiguous = proofTeacherDecision({
    ...game,
    pendingChoice: null
  }, actor.id, [
    { kind: "endTurn" },
    { kind: "beginPlayCard", cardId: "strategic-resource-commitment" }
  ], { kind: "endTurn" });
  assert.equal(ambiguous, null, "resource timing remains with the simulation teacher instead of becoming a fixed rule");
});

test("mulligan profile and neural encoding distinguish efficient high-cost replacements", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const keep = { kind: "submitMulligan", cardIds: [] };
  const returnHigh = {
    kind: "submitMulligan",
    cardIds: player.hand.filter((card) => card.energy >= 7).map((card) => card.instanceId)
  };
  const returnLow = {
    kind: "submitMulligan",
    cardIds: player.hand.filter((card) => card.energy <= 1).map((card) => card.instanceId)
  };
  const highProfile = mulliganPlanProfile(game, player.id, returnHigh);
  const lowProfile = mulliganPlanProfile(game, player.id, returnLow);

  assert.ok(highProfile.expectedDelta > mulliganPlanProfile(game, player.id, keep).expectedDelta);
  assert.ok(highProfile.expectedDelta > lowProfile.expectedDelta);
  assert.equal(highProfile.selectedHighCostRatio, 1);
  assert.notDeepEqual([...encodeAction(game, player.id, keep)], [...encodeAction(game, player.id, returnHigh)]);
  assert.equal(actionStage(returnHigh), "mulligan");
});

test("mulligan rollouts sample the player's hidden replacement order", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const before = player.mainDeck.map((card) => card.instanceId);
  const sampled = determinizeGame(game, player.id, { posterior: [] }, () => 0);
  const after = sampled.players[0].mainDeck.map((card) => card.instanceId);

  assert.notDeepEqual(after, before);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.deepEqual(game.players[0].mainDeck.map((card) => card.instanceId), before);
});

test("incomplete hidden-state determinization is explicitly invalid instead of retaining real private cards", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const sampled = determinizeGame(game, player.id, {
    posterior: [{
      deckId: "insufficient-private-pool",
      probability: 1,
      profile: { cardCounts: {} }
    }],
    observedCards: {}
  }, () => 0.25);
  const status = determinizationStatus(sampled);
  assert.equal(status.complete, false);
  assert.equal(status.reason, "insufficient-belief-cards");
  assert.ok(status.requiredPrivateCards > status.availablePrivateCards);
});

test("rollout hold comparison is independent of candidate ordering", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const model = createNeuralModel();
  const results = rolloutAlternatives(game, player.id, [
    { kind: "endTurn" },
    { kind: "unsupported-regression-candidate" }
  ], model.knowledge, { simulations: 1, depth: 1, random: () => 0.25 });

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((result) => result.pairedGainOverHold), [0, 0]);
  assert.equal(results[1].simulations, 0);
  assert.equal(results[1].invalidSimulations, 1);
  assert.equal(results[1].expectedWinRate, 0.5);
  assert.equal(results[1].rolloutEvidenceEligible, false);
  assert.deepEqual(results[1].invalidReasons, { "action-application-failed": 1 });
  assert.equal(results.some((result) => Object.hasOwn(result, "_pairedOutcomes")), false);
});

test("expanded teacher rollouts reuse earlier paired samples instead of rerunning them", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const model = createNeuralModel();
  const actions = [
    { kind: "endTurn" },
    { kind: "unsupported-regression-candidate" }
  ];
  const screen = rolloutAlternatives(game, player.id, actions, model.knowledge, {
    simulations: 2,
    depth: 1,
    random: () => 0.25
  });
  const expanded = rolloutAlternatives(game, player.id, actions, model.knowledge, {
    simulations: 4,
    depth: 1,
    priorResults: screen,
    random: () => 0.5
  });

  assert.ok(expanded.every((result) => result.attemptedSimulations === 4));
  assert.ok(expanded.every((result) => result.reusedSimulations === 2));
  assert.ok(expanded.every((result) => result.additionalSimulations === 2));
});

test("detached action-audit seed batches reuse one determinization without changing raw outcomes", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const model = createNeuralModel();
  const actions = [
    { kind: "endTurn" },
    { kind: "unsupported-regression-candidate" }
  ];
  const explicitSimulationSeeds = [101, 202, 303, 404];
  const baseline = rolloutAlternatives(
    game,
    player.id,
    actions,
    model.knowledge,
    {
      explicitSimulationSeeds,
      depth: 1,
      captureProductionLeafAudit: true,
      productionLeafAuditMaximumSteps: 8
    }
  );
  const shared = rolloutAlternatives(
    game,
    player.id,
    actions,
    model.knowledge,
    {
      explicitSimulationSeeds,
      depth: 1,
      captureProductionLeafAudit: true,
      productionLeafAuditMaximumSteps: 8,
      reusePairedDeterminization: true
    }
  );

  assert.deepEqual(
    serializeActionAuditRolloutResults(shared),
    serializeActionAuditRolloutResults(baseline)
  );
  const chunked = explicitSimulationSeeds.map((seed) =>
    serializeActionAuditRolloutResults(rolloutAlternatives(
      game,
      player.id,
      actions,
      model.knowledge,
      {
        explicitSimulationSeeds: [seed],
        depth: 1,
        captureProductionLeafAudit: true,
        productionLeafAuditMaximumSteps: 8,
        reusePairedDeterminization: true
      }
    )));
  assert.deepEqual(
    mergeActionAuditRolloutResults(...chunked),
    serializeActionAuditRolloutResults(shared)
  );
  const candidate = {
    game,
    actorId: player.id,
    descriptor: {
      informationSetHash: "detached-audit-seed-bank",
      occupiedAuditSeeds: [11, 22],
      recommendedAction: actions[0],
      selectedAction: actions[1]
    }
  };
  const selection = independentActionAuditSeedBank(
    candidate,
    "selection",
    32
  );
  const final = independentActionAuditSeedBank(
    candidate,
    "final-v2",
    64,
    selection
  );
  const rescue = independentActionAuditSeedBank(
    candidate,
    "near-miss-final-v1",
    64,
    [...selection, ...final]
  );
  assert.equal(new Set(selection).size, 32);
  assert.equal(new Set(final).size, 64);
  assert.equal(new Set(rescue).size, 64);
  assert.equal(selection.some((seed) => final.includes(seed)), false);
  assert.equal(selection.some((seed) => rescue.includes(seed)), false);
  assert.equal(final.some((seed) => rescue.includes(seed)), false);
  assert.equal(selection.includes(11) || selection.includes(22), false);
  assert.equal(rescue.includes(11) || rescue.includes(22), false);
});

test("detached action-audit seed batches preserve exact structured-v2 provenance", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const actions = enumerateMulliganPlans(game, player.id).slice(0, 2);
  const informationSetHash = "detached-v2-information-set";
  const engineFingerprint = "sha256:detached-v2-engine";
  const candidate = {
    game,
    actorId: player.id,
    engineFingerprint,
    descriptor: {
      auditKey: "detached-v2-audit",
      informationSetHash,
      recommendedAction: actions[0],
      selectedAction: actions[1],
      search: { depth: 1, minimumTurnTransitions: 0 }
    }
  };
  const selectionBatch = runIndependentActionAuditSeedBatch(candidate, {
    bank: "selection",
    seeds: [101],
    maximumSteps: 192
  });
  for (const result of selectionBatch.results) {
    assert.equal(result.samples[0].postActionAuditState, null);
    assert.equal(result.samples[0].productionLeafAudit?.state, null);
    assert.equal(result.samples[0].productionLeafAudit?.structuredState, null);
  }
  const multiPolicyBatch = runIndependentActionAuditSeedBatch({
    ...candidate,
    auditPolicyPairs: [
      {
        continuationId: "continuation-a",
        opponentId: "opponent-a",
        neuralModel: null,
        neuralModels: {}
      },
      {
        continuationId: "continuation-b",
        opponentId: "opponent-a",
        neuralModel: null,
        neuralModels: {}
      }
    ]
  }, {
    bank: "selection",
    seeds: [303],
    maximumSteps: 192
  });
  assert.deepEqual(
    multiPolicyBatch.protocolResults.map((item) => item.continuationId),
    ["continuation-a", "continuation-b"]
  );
  assert.equal(
    multiPolicyBatch.protocolResults.every((item) =>
      item.results.every((result) =>
        result.simulationSeeds[0] === 303)),
    true
  );
  const onePolicyPairBatch = runIndependentActionAuditSeedBatch({
    ...candidate,
    auditPolicyPairs: [
      {
        continuationId: "continuation-a",
        opponentId: "opponent-a",
        neuralModel: null,
        neuralModels: {}
      },
      {
        continuationId: "continuation-b",
        opponentId: "opponent-a",
        neuralModel: null,
        neuralModels: {}
      }
    ]
  }, {
    bank: "selection",
    seeds: [404],
    maximumSteps: 192,
    protocolPairIds: ["continuation-b::opponent-a"]
  });
  assert.deepEqual(
    onePolicyPairBatch.protocolResults.map((item) =>
      `${item.continuationId}::${item.opponentId}`),
    ["continuation-b::opponent-a"]
  );
  const batch = runIndependentActionAuditSeedBatch(candidate, {
    bank: "final-v2",
    seeds: [202],
    maximumSteps: 192
  });

  assert.equal(batch.results.length, 2);
  for (const result of batch.results) {
    assert.equal(result.samples.length, 1);
    const structuredState =
      result.samples[0].postActionAuditState?.structuredState;
    assert.equal(
      validPublicStructuredEvidenceSnapshot(structuredState, {
        engineFingerprint,
        informationSetHash
      }),
      true
    );
    assert.equal(
      structuredState.evidenceSchemaVersion,
      STRUCTURED_EVIDENCE_SCHEMA_VERSION
    );
  }
  const missing = structuredClone(batch.results);
  missing[0].samples[0].postActionAuditState.structuredState = null;
  assert.equal(
    independentActionAuditStructuredV2CompanionFailure(missing, {
      engineFingerprint,
      informationSetHash
    }),
    "structured-v2-companion-missing"
  );
});

test("new action-audit references require v2 companions and index both forms", () => {
  const suffix = "strict-structured-v2";
  const informationSetHash = `information-set:${suffix}`;
  const engineFingerprint = "sha256:synthetic-structured-v2-engine";
  assert.equal(independentTerminalActionAuditReference(suffix, {
    requireStructuredV2: true,
    engineFingerprint
  }), null);

  const legacy = independentTerminalActionAuditReference(suffix);
  const evaluatorStatePairs = legacy.evaluatorStatePairs.map((pair) => ({
    ...pair,
    recommendedStructuredState:
      syntheticStructuredEvidence(informationSetHash),
    selectedStructuredState:
      syntheticStructuredEvidence(informationSetHash)
  }));
  const reference = independentTerminalActionAuditReference(suffix, {
    evaluatorStatePairs,
    requireStructuredV2: true,
    engineFingerprint
  });
  assert.ok(reference);
  assert.equal(validActionRankingAuditReference(reference, {
    informationSetHash,
    legalActionKeys: ["passShowdown", "endTurn"],
    requireStructuredV2: true,
    engineFingerprint
  }), true);

  const index = createEvaluatorBootstrapResultIndex({
    summaries: [{ completed: true, naturallyCompleted: true, invalid: false }],
    trajectories: [{
      gameId: "strict-structured-v2-game",
      deckId: "origins-kaisa",
      playerId: "p1",
      engineFingerprint,
      steps: [{
        informationSetHash,
        legalActionKeys: ["passShowdown", "endTurn"],
        actionRankingAuditReference: reference
      }]
    }]
  });
  assert.equal(index.actionReferenceCount, 1);
  assert.equal(index.structuredV2ActionReferenceCount, 1);
  assert.deepEqual(index.structuredV2ActionReferenceCoverage, {
    "origins-kaisa:p1": 1
  });
  assert.equal(Object.values(
    index.structuredV2ActionReferencePhaseCoverage
  ).reduce((sum, count) => sum + count, 0), 1);
  assert.equal(Object.values(
    index.structuredV2ActionReferenceActionClassCoverage
  ).reduce((sum, count) => sum + count, 0), 1);
  assert.equal(Object.values(
    index.structuredV2ActionReferenceDeckPhaseCoverage
  ).reduce((sum, count) => sum + count, 0), 1);
});

test("confirmation rollout banks exclude every screening seed even with a degenerate random source", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const model = createNeuralModel();
  const actions = [
    { kind: "endTurn" },
    { kind: "unsupported-regression-candidate" }
  ];
  const screen = rolloutAlternatives(game, player.id, actions, model.knowledge, {
    simulations: 4,
    depth: 1,
    random: () => 0.25
  });
  const screeningSeeds = [...new Set(screen.flatMap((result) => result.simulationSeeds))];
  const confirmation = rolloutAlternatives(game, player.id, actions, model.knowledge, {
    simulations: 8,
    depth: 1,
    excludedSimulationSeeds: screeningSeeds,
    random: () => 0.25
  });
  const confirmationSeeds = [...new Set(confirmation.flatMap((result) => result.simulationSeeds))];
  assert.equal(screeningSeeds.length, 4);
  assert.equal(confirmationSeeds.length, 8);
  assert.equal(confirmationSeeds.some((seed) => screeningSeeds.includes(seed)), false);
  assert.notEqual(screen[0].simulationSeedFingerprint, confirmation[0].simulationSeedFingerprint);
});

test("mulligan teacher evaluates every legal card combination", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const plans = enumerateMulliganPlans(game, player.id);
  const teacher = simulationTeacherDecision(game, player.id, plans, {
    simulations: 1,
    depth: 1,
    random: () => 0.25
  });

  assert.equal(teacher.alternatives.length, plans.length);
  assert.equal(plans.includes(teacher.action), true);
  assert.equal(teacher.search.minimumTurnTransitions, 2);
  assert.equal(teacher.search.simulations >= 4, true);
});

test("teacher leaf audit runs only in its dedicated stage and reaches bootstrap accounting", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const plans = enumerateMulliganPlans(game, player.id);
  const informationSetHash = "information-set:teacher-leaf-pipeline";
  assert.notEqual(
    independentLeafAuditSeed(game, player.id, plans, informationSetHash),
    independentLeafAuditSeed(game, player.id, plans, `${informationSetHash}:other-game`)
  );
  const teacher = simulationTeacherDecision(game, player.id, plans, {
    simulations: 1,
    depth: 1,
    captureProductionLeafAudit: true,
    leafAuditSimulations: 4,
    actionAuditMaximumSteps: 32,
    informationSetHash,
    random: seededRandom(0x5eed)
  });

  assert.ok(teacher);
  const dedicatedAuditStages = teacher.search.stages.filter((stage) =>
    stage.stage === "independent-leaf-value-audit-final");
  assert.equal(dedicatedAuditStages.length, 1);
  assert.equal(dedicatedAuditStages.every(
    (stage) => stage.productionLeafAuditEnabled === true
  ), true);
  assert.equal(teacher.search.stages
    .filter((stage) => stage.stage !== "independent-leaf-value-audit-final")
    .every((stage) => stage.productionLeafAuditEnabled === false), true);

  // A tiny deterministic test game does not guarantee a naturally divergent
  // terminal pair. Inject one at the teacher-output boundary, then exercise
  // the same self-play recording helper and bootstrap audit used in Run C.
  const leafValueAuditReference = teacherLeafValueAuditReference({
    ...teacher,
    independentLeafValuePairs: [terminalLeafValuePair(909)]
  });
  assert.ok(leafValueAuditReference);
  const audit = summarizeEvaluatorCertificationTrajectories([{
    gameId: "teacher-leaf-pipeline",
    deckId: "deck",
    playerSeat: 0,
    steps: [{
      informationSetHash,
      legalActionKeys: plans.map(actionKey),
      actionRankingReference: null,
      leafValueAuditReference
    }]
  }], {
    deckIds: ["deck"],
    minimumGames: 100,
    minimumActionReferences: 50,
    minimumLeafValuePairs: 50
  });
  assert.equal(audit.actionReferenceCount, 0);
  assert.equal(audit.leafValuePairCount, 1);
  assert.equal(audit.leafValueReferenceGameCount, 1);
  assert.equal(audit.leafValueCoverage["deck:p1"], 1);
});

test("action-only audit mode suppresses the separate leaf audit stage", () => {
  const game = createMulliganTestGame();
  const player = game.players[0];
  const plans = enumerateMulliganPlans(game, player.id);
  const teacher = simulationTeacherDecision(game, player.id, plans, {
    simulations: 1,
    depth: 1,
    captureProductionLeafAudit: true,
    captureIndependentLeafAudit: false,
    captureIndependentActionAudit: false,
    informationSetHash: "information-set:action-only-no-leaf",
    random: seededRandom(0x1ea7)
  });

  assert.ok(teacher);
  assert.equal(
    teacher.search.stages.some((stage) =>
      stage.stage === "independent-leaf-value-audit-final"),
    false
  );
});

test("critical decision routing preserves a paired multi-unit alternative for teacher search", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actor = game.players[0];
  const opponent = game.players[1];
  const unit = (id, controllerId, might, zone = "base") => ({
    ...structuredClone(cards.lonelyPoro), instanceId: id, ownerId: controllerId, controllerId,
    zone, type: "unit", might, damage: 0, buffs: 0, mightModifier: 0, exhausted: false,
    cantMoveThisTurn: false, attachments: [], effects: [], keywords: []
  });
  actor.base = [unit("critical-one", actor.id, 2), unit("critical-two", actor.id, 2)];
  const field = {
    ...structuredClone(actor.availableBattlefields[0]), instanceId: "critical-field", ownerId: null,
    controllerId: null, controlledBy: opponent.id, effects: [], hidden: [],
    units: [unit("critical-enemy", opponent.id, 2, "battlefield")]
  };
  game.battlefields = [field];
  game.phase = "action";
  game.currentPlayerId = actor.id;
  game.turnPlayerId = actor.id;
  game.pendingChoice = null;
  game.pendingPayment = null;
  game.actionChain = null;
  game.showdown = null;
  const single = { kind: "moveUnit", unitId: actor.base[0].instanceId, destinationId: field.instanceId };
  const group = { kind: "moveUnits", unitIds: actor.base.map((card) => card.instanceId), destinationId: field.instanceId };
  const decision = { action: single, legalActions: [single, group, { kind: "endTurn" }], legalCount: 3 };
  const profile = criticalTacticalDecisionProfile(game, actor.id, decision);
  assert.equal(profile.critical, true);
  assert.equal(profile.types.includes("movement-group-comparison"), true);
  assert.deepEqual(profile.requiredActions, [{ kind: "endTurn" }, group]);
  const postmortemTeacher = simulationTeacherDecision(game, actor.id, decision.legalActions, {
    requiredAction: single,
    requiredActions: profile.requiredActions,
    minimumVerificationSimulations: 16,
    simulations: 2,
    depth: 1,
    maxCandidates: 3,
    critical: true,
    random: () => 0.25
  });
  assert.ok(postmortemTeacher.alternatives.some((alternative) =>
    actionKey(alternative.action) === actionKey(group)));
  assert.ok(postmortemTeacher.alternatives.some((alternative) =>
    alternative.action.kind === "endTurn"));
  assert.ok(postmortemTeacher.search.stages[0].simulations <= 4);
  assert.equal(postmortemTeacher.correctionEligible !== true
    || (postmortemTeacher.confirmation?.independent === true
      && postmortemTeacher.confirmation.pairedEvidence.lowerBound > 0), true);
  if (postmortemTeacher.confirmation) {
    assert.ok(postmortemTeacher.search.stages.some((stage) => stage.simulations >= 16));
    assert.equal(postmortemTeacher.confirmation.seedBanks.disjoint, true);
    assert.ok(postmortemTeacher.confirmation.validPairedSamples >= 8);
    assert.equal(postmortemTeacher.confirmation.seedBanks.screening.some((fingerprint) =>
      postmortemTeacher.confirmation.seedBanks.confirmation.includes(fingerprint)), false);
  }
});

test("self-play comparison blocks cross learner seat and first player without changing the deck-pair block", () => {
  const schedules = Array.from({ length: 4 }, (_, index) => selfPlayComparisonSchedule(index));
  assert.deepEqual(schedules.map((item) => item.comparisonBlock), [0, 0, 0, 0]);
  assert.deepEqual(schedules.map((item) => `${item.learnerSeat}:${item.firstPlayerId}`), ["0:p1", "1:p1", "0:p2", "1:p2"]);
  const learnerStarts = schedules.map((item) => item.firstPlayerId === `p${item.learnerSeat + 1}`);
  assert.deepEqual(learnerStarts, [true, false, false, true]);
  assert.equal(selfPlayComparisonSchedule(4).comparisonBlock, 1);
});

test("balanced deck scheduling covers every focused matchup before repeating", () => {
  const focused = resolveTrainingDecks(decklists, "origins-era");
  const pairCount = focused.length * (focused.length - 1) / 2;
  const pairs = Array.from({ length: pairCount }, (_, block) => scheduledDeckPair(focused, block, 20260720).map((deck) => deck.id).sort().join("|"));
  assert.equal(new Set(pairs).size, pairCount);
  const appearances = Object.fromEntries(focused.map((deck) => [deck.id, 0]));
  for (const pair of pairs) for (const id of pair.split("|")) appearances[id] += 1;
  assert.deepEqual(Object.values(appearances), Array(focused.length).fill(focused.length - 1));
});

test("model evaluation schedules same-deck mirrors with equal deck coverage", () => {
  const focused = resolveTrainingDecks(decklists, "origins-era");
  const pairs = Array.from({ length: focused.length * 2 }, (_, block) => scheduledEvaluationDeckPair(focused, block, 20260720));
  assert.equal(pairs.every(([first, second]) => first.id === second.id), true);
  const appearances = Object.fromEntries(focused.map((deck) => [deck.id, 0]));
  for (const [deck] of pairs) appearances[deck.id] += 1;
  assert.deepEqual(Object.values(appearances), Array(focused.length).fill(2));
});

test("cross-deck matrix scheduling covers every ordered matchup before repeating", () => {
  const focused = decks.slice(0, 5).sort((left, right) => left.id.localeCompare(right.id));
  const pairs = Array.from({ length: focused.length ** 2 }, (_, index) =>
    scheduledEvaluationMatrixPair(focused, index, 7).map((deck) => deck.id).join("::"));
  assert.equal(new Set(pairs).size, focused.length ** 2);
});

test("teacher expands planning for expensive underdeveloped curves without a deck-name rule", () => {
  const profile = (energy, runes) => teacherPlanningProfile({
    players: [{ id: "p1", mainDeck: Array.from({ length: 8 }, () => ({ energy })), hand: [], base: [], trash: [], banished: [], runes: Array.from({ length: runes }, () => ({})) }]
  }, "p1", { depth: 8, simulations: 2, maxCandidates: 4 });
  const cheap = profile(2, 4);
  const expensive = profile(5, 1);
  assert.equal(expensive.depth > cheap.depth, true);
  assert.equal(expensive.simulations > cheap.simulations, true);
  assert.equal(expensive.maxCandidates > cheap.maxCandidates, true);
});

test("opponent response belief uses only public hand size and currently payable Reaction resources", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const viewer = game.players[0];
  const opponent = game.players[1];
  opponent.legend.effects = [];
  opponent.champion = null;
  opponent.base = [];
  game.battlefields = [];
  opponent.hand = Array.from({ length: 5 }, (_, index) => ({ instanceId: `hidden-${index}`, ownerId: opponent.id }));
  opponent.runes = [{ ...makeRune(DOMAINS.MIND), instanceId: "response-rune", ownerId: opponent.id, controllerId: opponent.id, exhausted: false }];
  const model = {
    deckProfiles: {
      responseDeck: {
        id: "response-deck",
        legendCardNumber: opponent.legend.cardNumber,
        mainSize: 40,
        cardCounts: { [cards.retreat.cardNumber]: 3 }
      }
    }
  };

  const payable = opponentResponseProfile(game, viewer.id, model);
  assert.equal(payable.affordableResponses, 1);
  assert.equal(payable.responseProbability > 0, true);
  game.responseObservations = [{
    id: "observed-response-pass",
    outcome: "pass",
    sourcePlayerId: viewer.id,
    responderId: opponent.id,
    sourceCardNumber: cards.firestorm.cardNumber,
    sourceType: "spell",
    probeStrength: 0.9,
    responderHandCount: opponent.hand.length,
    responderRunes: [{ domain: DOMAINS.MIND, exhausted: false }],
    responderPoolEnergy: 0,
    responderPoolPowerDomains: [],
    turnSequence: game.turnSequence || 0
  }];
  const afterInformativePass = opponentResponseProfile(game, viewer.id, model);
  assert.equal(afterInformativePass.responseProbability < payable.responseProbability, true,
    "passing on a threatening card with enough public resources lowers the inferred Reaction probability");
  assert.equal(afterInformativePass.observedPasses, 1);
  opponent.hand.reverse();
  assert.equal(opponentResponseProfile(game, viewer.id, model).responseProbability, afterInformativePass.responseProbability,
    "changing unknown hidden-hand order cannot change the response estimate");
  const revealedResponse = { ...structuredClone(cards.retreat), instanceId: "revealed-chain-response", ownerId: opponent.id, controllerId: opponent.id };
  game.actionChain = {
    priorityPlayerId: viewer.id,
    chain: [{ id: "revealed-response-item", itemType: "card", playerId: opponent.id, card: revealedResponse, status: "finalized" }]
  };
  assert.equal(inferOpponentDeckBelief(game, viewer.id, model).observedCards[cards.retreat.cardNumber], 1,
    "a Reaction on the public Chain is observed immediately instead of being treated as hidden hand information");
  game.actionChain = null;
  opponent.runes[0].exhausted = true;
  const unavailable = opponentResponseProfile(game, viewer.id, model);
  assert.equal(unavailable.affordableResponses, 0);
  assert.equal(unavailable.responseProbability, 0);
});

test("resource commitment distinguishes an all-in line from keeping a payable response", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  player.hand = [{ ...structuredClone(cards.retreat), instanceId: "own-response", ownerId: player.id, controllerId: player.id }];
  player.runes = [
    { ...makeRune(DOMAINS.MIND), instanceId: "ready-one", ownerId: player.id, controllerId: player.id, exhausted: false },
    { ...makeRune(DOMAINS.MIND), instanceId: "ready-two", ownerId: player.id, controllerId: player.id, exhausted: false }
  ];
  const after = structuredClone(game);
  after.players[0].runes.forEach((rune) => { rune.exhausted = true; });
  const commitment = strategicResourceCommitment(game, after, player.id);
  assert.equal(commitment.allIn, true);
  assert.equal(commitment.posture, "commit");
  assert.equal(commitment.reserveValueBefore > commitment.reserveValueAfter, true);
  assert.equal(strategicActionResourceDemand(game, player.id, { kind: "endTurn" }), 0);
  assert.equal(strategicActionResourceDemand(game, player.id, { kind: "beginPlayCard", cardId: player.hand[0].instanceId }), 1);
});

test("resource reservation records its intended card, actual board, and delayed result", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const reservedCard = {
    ...structuredClone(cards.retreat),
    instanceId: "reserved-response",
    ownerId: player.id,
    controllerId: player.id,
    energy: 1,
    power: [],
    tags: ["Reaction"],
    keywords: ["Reaction"]
  };
  player.hand = [reservedCard];
  player.runes = [
    { ...makeRune(DOMAINS.MIND), instanceId: "reservation-rune", ownerId: player.id, controllerId: player.id, exhausted: false }
  ];
  game.phase = "showdown";
  game.turnSequence = 3;
  const intent = createResourceReservationIntent(game, player.id, { kind: "passShowdown" }, 10);
  assert.equal(intent.inferredTarget.cardNumber, reservedCard.cardNumber);
  assert.equal(intent.inferredTarget.purpose, "reaction-window");
  assert.equal(intent.boardBefore.opponentHandSize, opponent.hand.length);
  assert.equal(Array.isArray(intent.boardBefore.battlefields), true);

  observeResourceReservationAction(intent, game, { kind: "beginPlayCard", cardId: reservedCard.instanceId }, 12);
  assert.equal(intent.targetUsed, true);
  game.phase = "action";
  game.showdown = null;
  const neutralOutcome = completeResourceReservation(intent, game, 14, "target-used");
  assert.equal(neutralOutcome.result.learningReward, 0, "using the intended card is not itself evidence that reserving was beneficial");
  game.players[0].score += 1;
  assert.equal(resourceReservationResolutionReason(intent, game, 14), "target-used");
  const outcome = completeResourceReservation(intent, game, 14, "target-used");
  assert.equal(outcome.targetUsed, true);
  assert.equal(outcome.resourceUses[0].cardNumber, reservedCard.cardNumber);
  assert.equal(outcome.result.selfScoreGain, 1);
  assert.equal(outcome.result.learningReward > 0, true);
  assert.equal(outcome.boardAfter.selfScore, outcome.boardBefore.selfScore + 1);
});

test("resource and hand diagnostics contribute a capped auxiliary learning reward", () => {
  const steps = [
    { value: 0, shapedReward: 0, resourceReservationDiagnosticReward: 0.5, handOpportunityDiagnosticReward: -0.1 },
    { value: 0, shapedReward: 0 }
  ];
  applyGeneralizedAdvantageEstimation(steps, 0, 1, 1, 0, 0.5);
  assert.equal(Math.abs(steps[0].return - 0.2) < 1e-9, true);
  assert.equal(steps[1].return, 0);
});

test("mixed long-horizon GAE carries terminal outcomes back through long setup sequences", () => {
  const steps = Array.from({ length: 51 }, () => ({ value: 0, shapedReward: 0 }));
  applyGeneralizedAdvantageEstimation(steps, 1, 0.997, 0.95, 0, 0, {
    longLambda: 0.985,
    longWeight: 0.6
  });
  assert.ok(steps[0].longHorizonReturn > steps[0].shortHorizonReturn * 5);
  assert.ok(steps[0].return > steps[0].shortHorizonReturn);
  assert.ok(steps[0].return < steps[0].longHorizonReturn);
});

test("unused resource reservation records its opportunity cost", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  player.hand = [{
    ...structuredClone(cards.retreat),
    instanceId: "unused-reservation-target",
    ownerId: player.id,
    controllerId: player.id,
    energy: 1,
    power: []
  }];
  player.runes = [{ ...makeRune(DOMAINS.MIND), instanceId: "unused-rune", ownerId: player.id, controllerId: player.id, exhausted: false }];
  game.players[1].score = (game.victoryScore || 8) - 1;
  const intent = createResourceReservationIntent(game, player.id, { kind: "endTurn" }, 4);
  const outcome = completeResourceReservation(intent, game, 12, "action-window-expired");
  assert.equal(outcome.targetUsed, false);
  assert.equal(outcome.result.unusedOpportunityCost > 0, true);
  assert.equal(outcome.result.learningReward < 0, true);
});

test("repeated unused Reaction reservations are suppressed within the same game", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const card = { ...structuredClone(cards.enGarde), instanceId: "repeated-reserve", ownerId: player.id, controllerId: player.id };
  player.hand = [card];
  player.runes = [{ ...makeRune(DOMAINS.CALM), instanceId: "repeat-rune", ownerId: player.id, controllerId: player.id, exhausted: false }];
  game.players[1].score = (game.victoryScore || 8) - 1;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const intent = createResourceReservationIntent(game, player.id, { kind: "endTurn" }, attempt * 10);
    assert.ok(intent);
    completeResourceReservation(intent, game, attempt * 10 + 8, "action-window-expired");
  }
  assert.equal(createResourceReservationIntent(game, player.id, { kind: "endTurn" }, 30), null);
});

test("a playable card repeatedly held through terminal passes becomes a stale-hand learning point", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const opponent = game.players[1];
  const heldCard = {
    ...structuredClone(cards.retreat),
    instanceId: "stale-playable-card",
    ownerId: player.id,
    controllerId: player.id,
    energy: 1,
    power: []
  };
  player.hand = [heldCard];
  const tracker = createHandOpportunityTracker(player.id);
  const steps = [];
  for (let turn = 1; turn <= 3; turn += 1) {
    game.turnSequence = turn;
    const step = { actionCount: turn, turningPoint: null };
    steps.push(step);
    observeHandOpportunityWindow(tracker, game, [
      { kind: "beginPlayCard", cardId: heldCard.instanceId },
      { kind: "endTurn" }
    ], turn);
    recordHandOpportunityDecision(tracker, game, { kind: "endTurn" }, turn, step);
  }
  opponent.score += 2;
  game.phase = "complete";
  game.winnerId = opponent.id;
  const [outcome] = completeHandOpportunityTracking(tracker, game, 10, "game-ended");
  assert.equal(outcome.playableTurnCount, 3);
  assert.equal(outcome.playableOpportunityCount, 3);
  assert.equal(outcome.terminalPassCount, 3);
  assert.equal(outcome.used, false);
  assert.equal(outcome.result.stale, true);
  assert.equal(outcome.result.harmful, true);
  assert.equal(outcome.result.reservationRegret > 0.1, true);
  assert.equal(steps.at(-1).turningPoint, "stale-hand");
});

test("a card held for a later payoff is not punished solely for its age", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const heldCard = {
    ...structuredClone(cards.retreat),
    instanceId: "delayed-payoff-card",
    ownerId: player.id,
    controllerId: player.id,
    energy: 1,
    power: []
  };
  player.hand = [heldCard];
  const tracker = createHandOpportunityTracker(player.id);
  for (let turn = 1; turn <= 3; turn += 1) {
    game.turnSequence = turn;
    observeHandOpportunityWindow(tracker, game, [
      { kind: "beginPlayCard", cardId: heldCard.instanceId },
      { kind: "endTurn" }
    ], turn);
    recordHandOpportunityDecision(tracker, game, { kind: "endTurn" }, turn, { actionCount: turn });
  }
  game.turnSequence = 4;
  observeHandOpportunityWindow(tracker, game, [
    { kind: "beginPlayCard", cardId: heldCard.instanceId },
    { kind: "endTurn" }
  ], 4);
  recordHandOpportunityDecision(tracker, game, { kind: "beginPlayCard", cardId: heldCard.instanceId }, 4, { actionCount: 4 });
  player.hand = [];
  player.score += 1;
  const [outcome] = resolveHandOpportunityCards(tracker, game, 5);
  assert.equal(outcome.used, true);
  assert.equal(outcome.result.laterPayoff, true);
  assert.equal(outcome.result.reservationRegret, 0);
  assert.equal(outcome.result.harmful, false);
});

test("an unplayable card held for four turns is diagnosed separately from refusing a legal play", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const heldCard = {
    ...structuredClone(cards.retreat),
    instanceId: "unplayable-dormant-card",
    ownerId: player.id,
    controllerId: player.id,
    energy: 9,
    power: []
  };
  player.hand = [heldCard];
  const tracker = createHandOpportunityTracker(player.id);
  for (let turn = 1; turn <= 4; turn += 1) {
    game.turnSequence = turn;
    observeHandOpportunityWindow(tracker, game, [{ kind: "endTurn" }], turn);
    recordHandOpportunityDecision(tracker, game, { kind: "endTurn" }, turn, { actionCount: turn });
  }
  const [outcome] = completeHandOpportunityTracking(tracker, game, 6, "collection-ended");
  assert.equal(outcome.heldTurnCount, 4);
  assert.equal(outcome.playableTurnCount, 0);
  assert.equal(outcome.result.unplayableDormancy, true);
  assert.equal(outcome.result.stale, false);
  assert.equal(outcome.result.reservationRegret, 0);
});

test("training shaping values generic base development before battlefield deployment", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const player = game.players[0];
  const before = trainingShapingPotential(game, player.id);
  player.base.push({ instanceId: "development-unit", controllerId: player.id, might: 8, damage: 0 });
  assert.equal(trainingShapingPotential(game, player.id) > before, true);
});

test("underperforming deck curriculum mixes focused opponents, mirrors, and unbiased non-focus games", () => {
  const focused = resolveTrainingDecks(decklists, "origins-era");
  const focusDeckId = "proving-grounds-master-yi";
  const curriculum = { focusDeckIds: [focusDeckId], focusFraction: 0.5, mirrorFraction: 0.125 };
  const schedules = Array.from({ length: 16 }, (_, block) => scheduledCurriculumDeckPair(focused, block, 20260719, curriculum));
  const counts = schedules.reduce((output, item) => ({ ...output, [item.mode]: (output[item.mode] || 0) + 1 }), {});
  assert.deepEqual(counts, { "balanced-non-focus": 8, "focus-mirror": 2, "focus-opponent": 6 });
  for (const item of schedules) {
    const focusAppearances = item.decks.filter((deck) => deck.id === focusDeckId).length;
    if (item.mode === "focus-mirror") assert.equal(focusAppearances, 2);
    else if (item.mode === "focus-opponent") assert.equal(focusAppearances, 1);
    else assert.equal(focusAppearances, 0);
  }
});

test("training scheduler reserves 25% mirrors, 60% balanced cross-play, and 15% weakness focus", () => {
  const focused = resolveTrainingDecks(decklists, "origins-era");
  const curriculum = { focusDeckIds: ["proving-grounds-master-yi"], focusFraction: 0.15 };
  const schedules = Array.from({ length: 40 }, (_, block) => scheduledTrainingDeckPair(focused, block, 20260721, {
    mirrorFraction: 0.25,
    curriculum
  }));
  const counts = schedules.reduce((output, item) => ({ ...output, [item.mode]: (output[item.mode] || 0) + 1 }), {});
  assert.deepEqual(counts, { "balanced-cross": 24, "baseline-mirror": 10, "weakness-focus": 6 });
  assert.equal(schedules.filter((item) => item.mode === "weakness-focus")
    .every((item) => item.decks.some((deck) => deck.id === curriculum.focusDeckIds[0])), true);
  const exposure = Object.fromEntries(focused.map((deck) => [deck.id, 0]));
  for (const item of schedules.slice(0, 20)) {
    for (const deck of item.decks) exposure[deck.id] += 1;
  }
  assert.equal(Math.min(...Object.values(exposure)) >= 7, true, JSON.stringify(exposure));
});

test("v2 training deck schedule mirrors every non-mirror pairing across both seats", () => {
  const focused = resolveTrainingDecks(decklists, "origins-era");
  const schedules = Array.from({ length: 160 }, (_, block) =>
    scheduledTrainingDeckPair(focused, block, 20260721, {
      mirrorFraction: 0.25,
      deckSeatScheduleVersion: "deck-seat-schedule-v2"
    }));
  const orientations = new Map();
  for (const item of schedules.filter(
    (schedule) => schedule.decks[0].id !== schedule.decks[1].id
  )) {
    const key = item.decks.map((deck) => deck.id).sort().join("|");
    const direction = item.decks.map((deck) => deck.id).join("|");
    const counts = orientations.get(key) || new Map();
    counts.set(direction, (counts.get(direction) || 0) + 1);
    orientations.set(key, counts);
  }
  for (const counts of orientations.values()) {
    assert.equal(counts.size, 2);
    assert.equal(new Set(counts.values()).size, 1);
  }
  const masterYiSeats = new Set();
  for (const item of schedules) {
    item.decks.forEach((deck, seat) => {
      if (deck.id === "proving-grounds-master-yi") {
        masterYiSeats.add(`p${seat + 1}`);
      }
    });
  }
  assert.deepEqual(masterYiSeats, new Set(["p1", "p2"]));
});

test("bootstrap missing deck-seat coverage targets the requested seat", () => {
  assert.deepEqual(evaluatorBootstrapFocusDeckSeats([
    "proving-grounds-master-yi:p1",
    "origins-leona:p2",
    "proving-grounds-master-yi:p1"
  ]), {
    "origins-leona": ["p2"],
    "proving-grounds-master-yi": ["p1"]
  });
  const focused = resolveTrainingDecks(decklists, "origins-era");
  const curriculum = {
    focusDeckIds: ["proving-grounds-master-yi"],
    focusDeckSeats: { "proving-grounds-master-yi": ["p1"] },
    focusFraction: 0.75
  };
  const targeted = Array.from({ length: 80 }, (_, block) =>
    scheduledTrainingDeckPair(focused, block, 20260721, {
      mirrorFraction: 0.25,
      curriculum,
      deckSeatScheduleVersion: "deck-seat-schedule-v2"
    }))
    .filter((item) =>
      item.mode === "weakness-focus"
        && item.decks[0].id !== item.decks[1].id);
  assert.equal(targeted.length > 0, true);
  assert.equal(targeted.every(
    (item) => item.decks[0].id === "proving-grounds-master-yi"
  ), true);

  const symmetric = Array.from({ length: 80 }, (_, block) =>
    scheduledTrainingDeckPair(focused, block, 20260721, {
      mirrorFraction: 0.25,
      curriculum: {
        focusDeckIds: ["proving-grounds-master-yi"],
        focusFraction: 0.75
      },
      deckSeatScheduleVersion: "deck-seat-schedule-v2"
    }))
    .filter((item) =>
      item.mode === "weakness-focus"
        && item.decks[0].id !== item.decks[1].id);
  assert.deepEqual(
    new Set(symmetric.map((item) =>
      item.decks.findIndex(
        (deck) => deck.id === "proving-grounds-master-yi"
      ))),
    new Set([0, 1])
  );

  const bothSeatsMissing = Array.from({ length: 80 }, (_, block) =>
    scheduledTrainingDeckPair(focused, block, 20260721, {
      mirrorFraction: 0.25,
      curriculum: {
        focusDeckIds: ["proving-grounds-master-yi"],
        focusDeckSeats: {
          "proving-grounds-master-yi": ["p1", "p2"]
        },
        focusFraction: 0.75
      },
      deckSeatScheduleVersion: "deck-seat-schedule-v2"
    }))
    .filter((item) =>
      item.mode === "weakness-focus"
        && item.decks[0].id !== item.decks[1].id);
  assert.deepEqual(
    new Set(bothSeatsMissing.map((item) =>
      item.decks.findIndex(
        (deck) => deck.id === "proving-grounds-master-yi"
      ))),
    new Set([0, 1])
  );
});

test("evaluation schedule is exactly symmetric across seat and initiative", () => {
  assert.deepEqual(evaluationConditionSchedule(0), { block: 0, candidateSeat: 0, firstPlayerId: "p1" });
  assert.deepEqual(evaluationConditionSchedule(3), { block: 0, candidateSeat: 1, firstPlayerId: "p2" });
  assert.deepEqual(auditEvaluationScheduleSymmetry(80), {
    version: 1,
    games: 80,
    expectedPerCondition: 20,
    conditions: { "seat-0-first": 20, "seat-1-second": 20, "seat-0-second": 20, "seat-1-first": 20 },
    passed: true
  });
});

test("unfinished evaluation games use a conservative deterministic adjudication", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  game.players[0].score = 4;
  game.players[1].score = 2;
  assert.equal(adjudicateEvaluationGame(game, 0).winnerId, "p1");
  game.players[1].score = 4;
  for (const field of game.battlefields) {
    field.controlledBy = null;
    field.units = [];
  }
  const tie = adjudicateEvaluationGame(game, 0);
  assert.equal(tie.winnerId, "p2");
  assert.equal(tie.conservativeTieBreak, true);
});

test("underperforming deck curriculum selects the weakest evaluated deck without a card-name rule", () => {
  const focused = resolveTrainingDecks(decklists, "origins-era");
  const deckIds = focused.map((deck) => deck.id);
  const deckStats = Object.fromEntries(deckIds.map((deckId, index) => [deckId, { completed: 8, wins: index, winRate: index / 8, meanScoreFor: index }]));
  const curriculum = selectUnderperformingDeckCurriculum({ metadata: { absoluteEvaluation: { deckStats } } }, deckIds, { threshold: 0.2 });
  assert.deepEqual(curriculum.focusDeckIds, [deckIds[0]]);
  assert.equal(curriculum.evidence.winRate, 0);
  for (const stat of Object.values(deckStats)) stat.winRate = 0.5;
  assert.equal(selectUnderperformingDeckCurriculum({ metadata: { absoluteEvaluation: { deckStats } } }, deckIds, { threshold: 0.2 }), null);
});

test("neural public-state encoding and Bayesian belief do not depend on hidden hand order", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const viewerId = game.players[0].id;
  const before = Array.from(encodeState(game, viewerId));
  const beliefBefore = inferOpponentDeckBelief(game, viewerId);
  game.players[1].hand.reverse();
  assert.deepEqual(Array.from(encodeState(game, viewerId)), before);
  assert.deepEqual(inferOpponentDeckBelief(game, viewerId).posterior.map((item) => [item.deckId, item.probability]), beliefBefore.posterior.map((item) => [item.deckId, item.probability]));
  assert.equal(before.length, STATE_DIM);
});

test("neural state encoding exposes domain-specific Reaction reserves without changing checkpoint dimensions", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actor = game.players[0];
  actor.hand = [{
    ...structuredClone(cards.retreat),
    instanceId: "encoded-reserve-reaction",
    ownerId: actor.id,
    controllerId: actor.id,
    energy: 1,
    power: [{ domain: DOMAINS.BODY, amount: 1 }],
    tags: ["Reaction"],
    keywords: ["Reaction"]
  }];
  actor.runes = [{
    ...makeRune(DOMAINS.BODY),
    instanceId: "encoded-reserve-rune",
    ownerId: actor.id,
    controllerId: actor.id,
    exhausted: false
  }];
  const matching = Array.from(encodeState(game, actor.id));
  actor.runes[0].domain = DOMAINS.CALM;
  const mismatching = Array.from(encodeState(game, actor.id));

  assert.equal(matching.length, STATE_DIM);
  assert.equal(mismatching.length, STATE_DIM);
  assert.notDeepEqual(matching, mismatching,
    "the value head can learn that equal Rune counts do not imply equal Reaction coverage");
});

test("AI encodings distinguish a Rune's Energy and Power activated abilities", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actor = game.players[0];
  const rune = {
    ...makeRune(DOMAINS.BODY),
    instanceId: "encoded-basic-rune",
    ownerId: actor.id,
    controllerId: actor.id,
    exhausted: false
  };
  actor.runes = [rune];
  const energy = { kind: "activateCard", cardId: rune.instanceId, abilityId: `${rune.instanceId}:basic-rune-energy` };
  const power = { kind: "activateCard", cardId: rune.instanceId, abilityId: `${rune.instanceId}:basic-rune-power` };

  assert.notDeepEqual(Array.from(encodeAction(game, actor.id, energy)), Array.from(encodeAction(game, actor.id, power)));
  assert.equal(actionFeatures(game, actor.id, energy)["ability:basic-rune-energy"], 1);
  assert.equal(actionFeatures(game, actor.id, power)["ability:basic-rune-power"], 1);

  const generatedPowerAction = { kind: "togglePaymentPoolPower", powerId: "generated-body-power" };
  const generatedPowerEncoding = encodeAction(game, actor.id, generatedPowerAction);
  assert.equal(generatedPowerEncoding[67], 1, "generated Power payment has a checkpoint-compatible action-kind feature");
  assert.equal(actionStage(generatedPowerAction), "payment");
  actor.runePool = { energy: [], power: [{ id: "generated-body-power", domain: DOMAINS.BODY }] };
  game.pendingPayment = {
    playerId: actor.id,
    energyCost: 0,
    powerCost: [{ domain: DOMAINS.BODY, amount: 1 }],
    energyRuneIds: [],
    poolEnergyIds: [],
    powerRuneIds: [],
    poolPowerIds: ["generated-body-power"]
  };
  const generatedPowerFeatures = actionFeatures(game, actor.id, generatedPowerAction);
  assert.equal(generatedPowerFeatures.paymentPowerProgress, 1);
  assert.equal(generatedPowerFeatures.togglePoolPowerRemovesSelection, 1);
});

test("neural action encodings distinguish effect options, battlefields, and generated payment resources", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actor = game.players[0];
  game.pendingChoice = {
    playerId: actor.id,
    effect: "encoding-regression",
    options: [{ id: "left", amount: 1 }, { id: "right", amount: 2 }]
  };
  assert.notDeepEqual(
    Array.from(encodeAction(game, actor.id, { kind: "chooseEffectOption", optionId: "left" })),
    Array.from(encodeAction(game, actor.id, { kind: "chooseEffectOption", optionId: "right" }))
  );

  const fields = game.players.flatMap((player) => player.availableBattlefields).slice(0, 2);
  assert.equal(fields.length, 2);
  assert.notDeepEqual(
    Array.from(encodeAction(game, actor.id, { kind: "selectBattlefield", battlefieldId: fields[0].instanceId })),
    Array.from(encodeAction(game, actor.id, { kind: "selectBattlefield", battlefieldId: fields[1].instanceId }))
  );

  actor.runePool = { energy: [{ id: "energy-body", domain: DOMAINS.BODY }, { id: "energy-mind", domain: DOMAINS.MIND }], power: [] };
  assert.notDeepEqual(
    Array.from(encodeAction(game, actor.id, { kind: "togglePaymentPoolEnergy", energyId: "energy-body" })),
    Array.from(encodeAction(game, actor.id, { kind: "togglePaymentPoolEnergy", energyId: "energy-mind" }))
  );

  const legal = [
    { kind: "chooseEffectOption", optionId: "left" },
    { kind: "chooseEffectOption", optionId: "right" },
    { kind: "declineEffectChoice" }
  ];
  const actionSet = encodeActionSet(game, actor.id, legal);
  const signatures = Array.from({ length: actionSet.legalCount }, (_, index) =>
    Array.from(actionSet.encoded.subarray(index * ACTION_DIM, (index + 1) * ACTION_DIM)).join(","));
  assert.equal(new Set(signatures).size, legal.length, "every legal action reaches the model with a distinct vector");
});

test("neural encodings expose reusable card effects and the player's own deck plan", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actor = game.players[0];
  const mobilize = { ...structuredClone(Object.values(cards).find((card) => card.cardNumber === "OGN-134/298")), instanceId: "effect-mobilize", ownerId: actor.id, controllerId: actor.id };
  const confront = { ...structuredClone(Object.values(cards).find((card) => card.cardNumber === "OGN-129/298")), instanceId: "effect-confront", ownerId: actor.id, controllerId: actor.id };
  actor.hand = [mobilize, confront];
  const mobilizeEncoding = encodeAction(game, actor.id, { kind: "beginPlayCard", cardId: mobilize.instanceId, destination: "base" });
  const confrontEncoding = encodeAction(game, actor.id, { kind: "beginPlayCard", cardId: confront.instanceId, destination: "base" });
  assert.notDeepEqual(Array.from(mobilizeEncoding.slice(69, 86)), Array.from(confrontEncoding.slice(69, 86)));
  assert.equal(Array.from(mobilizeEncoding.slice(69, 86)).some((value) => value > 0), true);

  actor.hand = [];
  actor.mainDeck = [mobilize];
  const rampDeck = Array.from(encodeState(game, actor.id));
  actor.mainDeck = [confront];
  const interactionDeck = Array.from(encodeState(game, actor.id));
  assert.notDeepEqual(rampDeck, interactionDeck, "the policy state includes effect-level own-deck context without revealing the opponent's deck");
});

test("relational state encoding preserves battlefield location and individual unit status", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const viewer = game.players[0];
  const unit = { ...structuredClone(cards.annieFiery), instanceId: "relational-unit", ownerId: viewer.id, controllerId: viewer.id, exhausted: false, stunned: false, attachments: [] };
  game.battlefields = [
    { ...structuredClone(viewer.availableBattlefields[0]), instanceId: "field-a", controlledBy: null, units: [unit], hidden: [] },
    { ...structuredClone(viewer.availableBattlefields[1]), instanceId: "field-b", controlledBy: null, units: [], hidden: [] }
  ];
  const atFirstField = Array.from(encodeState(game, viewer.id));
  game.battlefields[0].units = [];
  game.battlefields[1].units = [unit];
  const atSecondField = Array.from(encodeState(game, viewer.id));
  assert.notDeepEqual(atSecondField, atFirstField);
  unit.stunned = true;
  unit.damage = 2;
  assert.notDeepEqual(Array.from(encodeState(game, viewer.id)), atSecondField);
});

test("incomplete games have no terminal reward and league evaluation keeps per-opponent evidence", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  assert.equal(terminalRewards(game), null);
  assert.equal(leagueGamesPerOpponent(9, { games: 20 }), 20);
  assert.equal(leagueGamesPerOpponent(9, { gamesPerOpponent: 36 }), 36);
});

test("best-of-three trajectories store the computed match reward without an undefined reward map", () => {
  const model = createNeuralModel();
  const result = playNeuralBestOfThree({
    decks: decks.slice(0, 2),
    models: [model, model],
    trainableSeats: [0],
    maxActions: 1,
    teacherFraction: 0,
    postmortemReviews: 0,
    captureReplays: false,
    engineFingerprint: "best-of-three-reward-test",
    random: () => 0.25
  });
  assert.equal(result.trajectories.length, 1);
  assert.equal(result.trajectories[0].terminalOutcome, 0);
});

test("adjudicated evaluation games are reported but never enter promotion win statistics", () => {
  const candidate = createNeuralModel();
  const champion = deserializeNeuralModel(serializeNeuralModel(candidate));
  const result = evaluateNeuralModels(candidate, champion, decks.slice(0, 2), {
    games: 4,
    maxActions: 1,
    seed: 991,
    greedy: true
  });
  assert.equal(result.completed, 0);
  assert.equal(result.naturallyCompleted, 0);
  assert.equal(result.adjudicatedGames, 4);
  assert.equal(result.candidateWins, 0);
  assert.equal(result.winRate, 0);
  assert.equal(result.promoted, false);
});

test("determinization preserves private slot identities while sampling only belief-compatible cards", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const viewerId = game.players[0].id;
  const ids = game.players[1].hand.map((card) => card.instanceId);
  const sampled = determinizeGame(game, viewerId, inferOpponentDeckBelief(game, viewerId), () => 0.2);
  assert.deepEqual(sampled.players[1].hand.map((card) => card.instanceId), ids);
  assert.equal(sampled.players[1].hand.every((card) => card.ownerId === game.players[1].id), true);
});

test("determinization keeps a viewer-controlled facedown card private to that controller", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const viewer = game.players[0];
  const opponent = game.players[1];
  const original = {
    ...structuredClone(cards.annieFiery),
    instanceId: "controlled-hidden-slot",
    ownerId: opponent.id,
    controllerId: viewer.id
  };
  opponent.hand = [];
  opponent.mainDeck = [];
  game.battlefields = [{
    instanceId: "determinization-hidden-field",
    name: "Determinization Hidden Field",
    type: "battlefield",
    controlledBy: viewer.id,
    units: [],
    hidden: []
  }];
  game.battlefields[0].hidden = [{
    ownerId: opponent.id,
    hiddenByPlayerId: viewer.id,
    card: original
  }];
  const belief = {
    observedCards: {},
    posterior: [{
      probability: 1,
      profile: { cardCounts: { [cards.lonelyPoro.cardNumber]: 1 } }
    }]
  };

  const controlled = determinizeGame(game, viewer.id, belief, () => 0);
  assert.equal(controlled.battlefields[0].hidden[0].card.name, cards.annieFiery.name);
  assert.equal(controlled.battlefields[0].hidden[0].card.controllerId, viewer.id);

  game.battlefields[0].hidden[0].card.controllerId = opponent.id;
  game.battlefields[0].hidden[0].hiddenByPlayerId = opponent.id;
  const unknown = determinizeGame(game, viewer.id, belief, () => 0);
  assert.equal(unknown.battlefields[0].hidden[0].card.name, cards.lonelyPoro.name);
  assert.equal(unknown.battlefields[0].hidden[0].card.controllerId, opponent.id);
});

test("recurrent neural policy serializes, restores and scores the legal action set", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const model = createNeuralModel();
  const first = createNeuralSession(model).decide(game, actorId, legal, { greedy: true });
  const restored = deserializeNeuralModel(serializeNeuralModel(model));
  const second = createNeuralSession(restored).decide(game, actorId, legal, { greedy: true });
  assert.equal(first.action.kind, second.action.kind);
  assert.equal(first.belief.length, CARD_VOCABULARY.length);
  assert.equal(Number.isFinite(first.value), true);
});

test("full heuristic audit scores exactly match the default AI policy evaluator on the same candidates", () => {
  const game = createMulliganTestGame();
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const expectedByKey = new Map(
    scoreActions(game, actorId, legal, DEFAULT_AI_MODEL)
      .map((item) => [item.key, item.score])
  );
  const scores = fullHeuristicScoresForActions(game, actorId, legal);
  assert.deepEqual(
    scores,
    legal.map((action) => expectedByKey.get(actionKey(action)))
  );
});

test("empty policy weights preserve scores while deferring unused strategic features", () => {
  const game = createMulliganTestGame();
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const fast = scoreActions(game, actorId, legal, DEFAULT_AI_MODEL);
  assert.equal(
    typeof Object.getOwnPropertyDescriptor(fast[0], "features")?.get,
    "function"
  );

  const forcedFullPath = structuredClone(DEFAULT_AI_MODEL);
  forcedFullPath.policyWeights = { "test:unused-feature": 1 };
  const full = scoreActions(game, actorId, legal, forcedFullPath);
  const fullByKey = new Map(full.map((item) => [item.key, item]));
  assert.deepEqual(
    fast.map((item) => [item.key, item.score]),
    full.map((item) => [item.key, item.score])
  );
  for (const item of fast) {
    assert.deepEqual(item.features, fullByKey.get(item.key).features);
  }
});

test("flat inference can omit extended public logs without changing core observation", () => {
  const game = createGame({
    decks: decks.slice(0, 2),
    interactive: true,
    manualActionChainPriority: true
  });
  const viewerId = game.players[0].id;
  recordPublicTurnEvent(game, {
    kind: "action",
    actionKind: "beginPlayCard",
    actorId: viewerId,
    visibility: "public"
  });
  game.responseObservations = [{
    id: "response-test",
    outcome: "pass",
    responderId: game.players[1].id,
    turnSequence: game.turnSequence,
    turnNumber: game.turnNumber
  }];
  const full = observeGame(game, viewerId);
  const light = observeGame(game, viewerId, {
    includeExtendedContext: false
  });
  assert.equal(full.turnEvents.length, 1);
  assert.equal(full.responseObservations.length, 1);
  assert.deepEqual(light.turnEvents, []);
  assert.deepEqual(light.responseObservations, []);
  assert.deepEqual(light.self, full.self);
  assert.deepEqual(light.opponent, full.opponent);
  assert.deepEqual(light.battlefields, full.battlefields);
});

test("independent neural evaluators require a frozen certificate and a distinct evaluator core", () => {
  const model = createNeuralModel();
  model.metadata.engineFingerprint = "sha256:test-engine";
  model.metadata.engineValidationStatus = "current-engine-validated";
  model.calibration = {
    testGames: 120,
    brier: 0.2,
    expectedCalibrationError: 0.1,
    rankingAuc: 0.65,
    bootstrap: {
      unit: "game",
      rankingAuc95: [0.55, 0.75]
    }
  };
  const issued = createEvaluatorCertificate(model, {
    engineFingerprint: "sha256:test-engine",
    frozen: true,
    holdout: {
      games: 120,
      completed: 120,
      completionRate: 1,
      invalidGames: 0,
      independent: true,
      seedProtected: true,
      seedManifestHash: "audit-seeds"
    },
    actionRanking: {
      version: 4,
      reference: ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
      referenceVersion: ACTION_RANKING_AUDIT_REFERENCE_VERSION,
      referenceContract: ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
      evaluatorPath: "gru-value-head-calibrated-probability-v1",
      comparator: "default-ai-post-action-state-evaluator-v1",
      comparatorScope:
        "evaluateState on the same post-action production rollout cutoff states",
      splitUnit: "game-cluster-bootstrap",
      weighting: "deck-seat-macro",
      games: 120,
      contributingGames: 40,
      decisions: 80,
      neuralAccuracy: 0.7,
      heuristicAccuracy: 0.55,
      pairedImprovement: 0.15,
      pairedImprovementLowerBound: 0.03,
      pairedImprovementUpperBound: 0.27,
      bootstrap: {
        version: 1,
        unit: "game",
        stratification: "deck-seat-macro",
        samples: 2000,
        contributingGames: 40,
        mean: 0.15,
        lowerBound: 0.03,
        upperBound: 0.27,
        seedFingerprint: "stable:test"
      },
      phaseBands: eligibleActionPhaseBands(),
      actionClasses: eligibleActionClasses()
    },
    leafValueRanking: eligibleLeafValueRankingEvidence()
  });
  assert.equal(issued.status.eligible, true, issued.status.reasons.join(","));
  model.metadata.evaluatorCertificate = issued.certificate;

  const lateInferiorCertificate = structuredClone(issued.certificate);
  lateInferiorCertificate.actionRanking.phaseBands.late.neuralAccuracy = 0.55;
  lateInferiorCertificate.actionRanking.phaseBands.late.comparatorAccuracy = 0.85;
  lateInferiorCertificate.actionRanking.phaseBands.late
    .pairedImprovementLowerBound = -0.3;
  model.metadata.evaluatorCertificate = lateInferiorCertificate;
  const lateInferior = evaluatorCertificateStatus(model, {
    engineFingerprint: "sha256:test-engine"
  });
  assert.equal(lateInferior.eligible, false);
  assert.ok(lateInferior.reasons.includes("action-ranking-phase-inferior-late"));
  assert.ok(lateInferior.reasons.includes(
    "action-ranking-phase-cluster-unconfirmed-late"
  ));
  model.metadata.evaluatorCertificate = issued.certificate;

  const missingActionClassCertificate = structuredClone(issued.certificate);
  delete missingActionClassCertificate.actionRanking.actionClasses.mulligan;
  model.metadata.evaluatorCertificate = missingActionClassCertificate;
  const missingActionClass = evaluatorCertificateStatus(model, {
    engineFingerprint: "sha256:test-engine"
  });
  assert.equal(missingActionClass.eligible, false);
  assert.ok(missingActionClass.reasons.includes(
    "insufficient-action-ranking-class-mulligan"
  ), missingActionClass.reasons.join(","));
  model.metadata.evaluatorCertificate = issued.certificate;
  const accepted = evaluatorCertificateStatus(model, {
    engineFingerprint: "sha256:test-engine"
  });
  assert.equal(accepted.eligible, true, accepted.reasons.join(","));
  assert.equal(accepted.modelHash, neuralEvaluatorModelHash(model));

  const sparseRankingCertificate = structuredClone(issued.certificate);
  sparseRankingCertificate.actionRanking.contributingGames = 1;
  model.metadata.evaluatorCertificate = sparseRankingCertificate;
  const sparseRanking = evaluatorCertificateStatus(model, {
    engineFingerprint: "sha256:test-engine"
  });
  assert.equal(sparseRanking.eligible, false);
  assert.equal(sparseRanking.reasons.includes("insufficient-action-ranking-games"), true);
  model.metadata.evaluatorCertificate = issued.certificate;

  const tacticalPriorOnlyCertificate = structuredClone(issued.certificate);
  tacticalPriorOnlyCertificate.actionRanking.comparator = "recorded-tactical-prior";
  model.metadata.evaluatorCertificate = tacticalPriorOnlyCertificate;
  const tacticalPriorOnly = evaluatorCertificateStatus(model, {
    engineFingerprint: "sha256:test-engine"
  });
  assert.equal(tacticalPriorOnly.eligible, false);
  assert.equal(
    tacticalPriorOnly.reasons.includes(
      "action-ranking-comparator-not-production-cutoff-heuristic"
    ),
    true
  );
  model.metadata.evaluatorCertificate = issued.certificate;

  const sameWeightsDifferentObject = deserializeNeuralModel(serializeNeuralModel(model));
  const sameCheckpoint = evaluatorCertificateStatus(sameWeightsDifferentObject, {
    engineFingerprint: "sha256:test-engine",
    primaryModel: model
  });
  assert.equal(sameCheckpoint.eligible, false);
  assert.equal(sameCheckpoint.reasons.includes("same-evaluator-leaf-as-primary"), true);

  const proposalOnlyDifferent = deserializeNeuralModel(serializeNeuralModel(model));
  const proposalWeights = proposalOnlyDifferent.layers.teacherProposalValue.getWeights();
  const changedProposalWeights = proposalWeights.map((weight, index) =>
    index === 0 ? tf.add(weight, tf.onesLike(weight)) : weight.clone());
  proposalOnlyDifferent.layers.teacherProposalValue.setWeights(changedProposalWeights);
  changedProposalWeights.forEach((weight) => weight.dispose());
  assert.notEqual(neuralArtifactHash(proposalOnlyDifferent), neuralArtifactHash(model));
  assert.equal(neuralEvaluatorCoreHash(proposalOnlyDifferent), neuralEvaluatorCoreHash(model));
  assert.equal(neuralEvaluatorLeafHash(proposalOnlyDifferent), neuralEvaluatorLeafHash(model));
  const proposalCertificate = createEvaluatorCertificate(proposalOnlyDifferent, {
    engineFingerprint: "sha256:test-engine",
    frozen: true,
    holdout: issued.certificate.holdout,
    calibration: issued.certificate.calibration,
    actionRanking: issued.certificate.actionRanking,
    leafValueRanking: issued.certificate.leafValueRanking
  });
  proposalOnlyDifferent.metadata.evaluatorCertificate = proposalCertificate.certificate;
  const proposalOnlyStatus = evaluatorCertificateStatus(proposalOnlyDifferent, {
    engineFingerprint: "sha256:test-engine",
    primaryModel: model
  });
  assert.equal(proposalOnlyStatus.eligible, false);
  assert.equal(
    proposalOnlyStatus.reasons.includes("same-evaluator-leaf-as-primary"),
    true
  );

  const actionValueOnlyDifferent = deserializeNeuralModel(serializeNeuralModel(model));
  const actionValueWeights = actionValueOnlyDifferent.layers.actionValue.getWeights();
  const changedActionValueWeights = actionValueWeights.map((weight, index) =>
    index === 0 ? tf.add(weight, tf.onesLike(weight)) : weight.clone());
  actionValueOnlyDifferent.layers.actionValue.setWeights(changedActionValueWeights);
  changedActionValueWeights.forEach((weight) => weight.dispose());
  assert.equal(
    neuralEvaluatorCoreHash(actionValueOnlyDifferent),
    neuralEvaluatorCoreHash(model)
  );
  assert.notEqual(
    neuralArtifactHash(actionValueOnlyDifferent),
    neuralArtifactHash(model)
  );
  assert.equal(
    neuralEvaluatorLeafHash(actionValueOnlyDifferent),
    neuralEvaluatorLeafHash(model)
  );

  const calibrationDifferent = deserializeNeuralModel(serializeNeuralModel(model));
  calibrationDifferent.calibration = {
    ...calibrationDifferent.calibration,
    bias: (Number(calibrationDifferent.calibration.bias) || 0) + 0.5
  };
  assert.notEqual(
    neuralEvaluatorLeafHash(calibrationDifferent),
    neuralEvaluatorLeafHash(model)
  );
  assert.notEqual(neuralArtifactHash(calibrationDifferent), neuralArtifactHash(model));

  const staleEngine = evaluatorCertificateStatus(model, {
    engineFingerprint: "sha256:other-engine"
  });
  assert.equal(staleEngine.eligible, false);
  assert.equal(staleEngine.reasons.includes("engine-fingerprint-mismatch"), true);
});

test("policy-Q certificates may evaluate leaves but cannot certify or correct actions", () => {
  const model = createNeuralModel();
  model.metadata.engineFingerprint = "sha256:policy-q-engine";
  model.metadata.engineValidationStatus = "current-engine-validated";
  model.calibration = {
    temperature: 1,
    bias: 0,
    testGames: 120,
    brier: 0.2,
    expectedCalibrationError: 0.1,
    rankingAuc: 0.65,
    bootstrap: {
      unit: "game",
      rankingAuc95: [0.55, 0.75]
    }
  };
  const issued = createEvaluatorCertificate(model, {
    certificateKind: EVALUATOR_CERTIFICATE_KINDS.policyQ,
    engineFingerprint: "sha256:policy-q-engine",
    frozen: true,
    holdout: {
      games: 120,
      completed: 120,
      completionRate: 1,
      invalidGames: 0,
      independent: true,
      seedProtected: true,
      seedManifestHash: "policy-q-seeds"
    },
    calibration: model.calibration,
    actionRanking: {},
    leafValueRanking: eligibleLeafValueRankingEvidence()
  });
  assert.equal(issued.status.eligible, true, issued.status.reasons.join(","));
  model.metadata.evaluatorCertificate = issued.certificate;
  assert.equal(issued.certificate.permissions.leafEvaluation, true);
  assert.equal(issued.certificate.permissions.proposalRanking, false);
  assert.equal(
    issued.certificate.permissions.proposalRankingHeads.generalActionQ,
    false
  );
  assert.equal(
    issued.certificate.permissions.proposalRankingHeads.mulliganQ,
    false
  );
  assert.equal(issued.certificate.permissions.policyConditionedActionQ, false);
  assert.equal(issued.certificate.scope, "state-value-only");
  assert.equal(issued.certificate.permissions.policyCorrection, false);
  assert.equal(issued.certificate.permissions.formalActionCertification, false);
  const leafPool = certifiedIndependentEvaluators([model], null, {
    engineFingerprint: "sha256:policy-q-engine",
    requiredPermission: "leafEvaluation"
  });
  assert.equal(leafPool.accepted.length, 1);
  const actionPool = certifiedIndependentEvaluators([model], null, {
    engineFingerprint: "sha256:policy-q-engine"
  });
  assert.equal(actionPool.accepted.length, 0);
  assert.ok(actionPool.rejected[0].reasons.includes(
    "missing-evaluator-permission-formalActionCertification"
  ));
  const wrongKind = evaluatorCertificateStatus(model, {
    engineFingerprint: "sha256:policy-q-engine",
    certificateKind: EVALUATOR_CERTIFICATE_KINDS.robustAction
  });
  assert.equal(wrongKind.eligible, false);
  assert.ok(wrongKind.reasons.includes("certificate-kind-mismatch"));
});

test("production teacher rollouts use an authorized mulligan Q head without leaf-audit capture", () => {
  const evaluator = createNeuralModel();
  evaluator.metadata.engineFingerprint = "sha256:policy-q-routing-engine";
  evaluator.metadata.engineValidationStatus = "current-engine-validated";
  evaluator.calibration = {
    temperature: 1,
    bias: 0,
    testGames: 120,
    brier: 0.2,
    expectedCalibrationError: 0.1,
    rankingAuc: 0.65,
    bootstrap: {
      unit: "game",
      rankingAuc95: [0.55, 0.75]
    }
  };
  const actionRanking = {
    version: 4,
    reference: ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
    referenceVersion: ACTION_RANKING_AUDIT_REFERENCE_VERSION,
    referenceContract: ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
    evaluatorPath: "gru-value-head-calibrated-probability-v1",
    comparator: "default-ai-post-action-state-evaluator-v1",
    comparatorScope:
      "evaluateState on the same post-action production rollout cutoff states",
    splitUnit: "game-cluster-bootstrap",
    weighting: "deck-seat-macro",
    games: 120,
    contributingGames: 40,
    decisions: 80,
    neuralAccuracy: 0.7,
    heuristicAccuracy: 0.55,
    pairedImprovement: 0.15,
    pairedImprovementLowerBound: 0.03,
    pairedImprovementUpperBound: 0.27,
    bootstrap: {
      version: 1,
      unit: "game",
      stratification: "deck-seat-macro",
      samples: 2000,
      contributingGames: 40,
      mean: 0.15,
      lowerBound: 0.03,
      upperBound: 0.27,
      seedFingerprint: "stable:policy-q-routing"
    },
    targetHeads: {
      [EVALUATOR_TARGET_HEADS.mulliganQ]: {
        decisions: 80,
        contributingGames: 40,
        neuralAccuracy: 0.7,
        pairedImprovementLowerBound: 0.03,
        bootstrap: {
          unit: "game",
          lowerBound: 0.03
        }
      }
    },
    phaseBands: eligibleActionPhaseBands(),
    actionClasses: eligibleActionClasses()
  };
  const issued = createEvaluatorCertificate(evaluator, {
    certificateKind: EVALUATOR_CERTIFICATE_KINDS.policyQ,
    engineFingerprint: evaluator.metadata.engineFingerprint,
    frozen: true,
    holdout: {
      games: 120,
      completed: 120,
      completionRate: 1,
      invalidGames: 0,
      independent: true,
      seedProtected: true,
      seedManifestHash: "policy-q-routing-seeds"
    },
    calibration: evaluator.calibration,
    actionRanking,
    leafValueRanking: eligibleLeafValueRankingEvidence()
  });
  assert.equal(issued.status.eligible, true, issued.status.reasons.join(","));
  assert.equal(issued.certificate.permissions.proposalRanking, true);
  assert.equal(
    issued.certificate.permissions.proposalRankingHeads.mulliganQ,
    true
  );
  assert.equal(
    issued.certificate.permissions.proposalRankingHeads.generalActionQ,
    false
  );
  assert.equal(issued.certificate.permissions.policyCorrection, false);
  evaluator.metadata.evaluatorCertificate = issued.certificate;
  const mulliganPool = certifiedIndependentEvaluators([evaluator], null, {
    engineFingerprint: evaluator.metadata.engineFingerprint,
    requiredPermission: "proposalRanking",
    requiredTargetHead: EVALUATOR_TARGET_HEADS.mulliganQ
  });
  assert.equal(mulliganPool.accepted.length, 1);
  const generalActionPool = certifiedIndependentEvaluators([evaluator], null, {
    engineFingerprint: evaluator.metadata.engineFingerprint,
    requiredPermission: "proposalRanking",
    requiredTargetHead: EVALUATOR_TARGET_HEADS.generalActionQ
  });
  assert.equal(generalActionPool.accepted.length, 0);

  const game = createMulliganTestGame();
  const actorId = game.players[0].id;
  const actions = enumerateAiPolicyActions(game, actorId).slice(0, 2);
  assert.equal(actions.length, 2);
  const results = rolloutAlternatives(
    game,
    actorId,
    actions,
    DEFAULT_AI_MODEL,
    {
      simulations: 1,
      depth: 1,
      evaluatorModels: [evaluator],
      engineFingerprint: evaluator.metadata.engineFingerprint,
      informationSetHash: "information-set:policy-q-routing",
      captureProductionLeafAudit: false,
      random: () => 0.25
    }
  );
  assert.equal(results.length, 2);
  assert.ok(results.every((result) =>
    result.independentEvaluatorActionQAvailable === true));
  assert.ok(results.every((result) =>
    result.independentEvaluatorActionQTargetHead
      === EVALUATOR_TARGET_HEADS.mulliganQ));
  assert.ok(results.every((result) =>
    result.independentEvaluatorPolicyCorrectionEligible === false));
});

test("evaluator-only selection excludes the deployed policy but can preserve another epoch", () => {
  const primary = createNeuralModel();
  const distinct = deserializeNeuralModel(serializeNeuralModel(primary));
  const valueWeights = distinct.layers.value.getWeights();
  const changedWeights = valueWeights.map((weight, index) =>
    index === 0 ? tf.add(weight, tf.onesLike(weight)) : weight.clone());
  distinct.layers.value.setWeights(changedWeights);
  changedWeights.forEach((weight) => weight.dispose());
  const primaryLeafHash = neuralEvaluatorLeafHash(primary);
  const distinctLeafHash = neuralEvaluatorLeafHash(distinct);
  const selected = selectEvaluatorOnlyArtifact([
    {
      epoch: 2,
      status: { eligible: true },
      evaluatorLeafHash: primaryLeafHash,
      selectionScore: 100
    },
    {
      epoch: 3,
      status: { eligible: true },
      evaluatorLeafHash: distinctLeafHash,
      selectionScore: 90
    }
  ], primary);
  assert.equal(selected.epoch, 3);
  assert.equal(selectEvaluatorOnlyArtifact([{
    epoch: 2,
    status: { eligible: true },
    evaluatorLeafHash: primaryLeafHash,
    selectionScore: 100
  }], primary), null);
});

test("action-ranking confidence resamples games rather than treating decisions as independent", () => {
  const first = bootstrapGamePairedImprovements([
    { gameId: "g1", improvement: 1 },
    { gameId: "g2", improvement: -1 },
    { gameId: "g3", improvement: 0.5 },
    { gameId: "g4", improvement: -0.5 }
  ], { samples: 1000 });
  const second = bootstrapGamePairedImprovements([
    { gameId: "g4", improvement: -0.5 },
    { gameId: "g2", improvement: -1 },
    { gameId: "g1", improvement: 1 },
    { gameId: "g3", improvement: 0.5 }
  ], { samples: 1000 });
  assert.deepEqual(first, second);
  assert.equal(first.contributingGames, 4);
  assert.equal(first.unit, "game");
  assert.equal(first.lowerBound < 0, true);
});

test("evaluator confidence macro-averages deck seats instead of rewarding an overrepresented seat", () => {
  const evidence = [
    { gameId: "p1-1", stratum: "master-yi:p1", improvement: 1 },
    ...Array.from({ length: 9 }, (_, index) => ({
      gameId: `p2-${index + 1}`,
      stratum: "master-yi:p2",
      improvement: -1
    }))
  ];
  const macro = bootstrapStratifiedGamePairedImprovements(evidence, {
    samples: 1000
  });
  assert.equal(macro.stratification, "deck-seat-macro");
  assert.equal(macro.strata, 2);
  assert.equal(macro.mean, 0);
});

test("action-ranking references require independent terminal evidence with 75% complete samples", () => {
  const base = {
    informationSetHash: "information-set:test",
    informationSetHashVersion: 1,
    correctIndex: 1,
    comparedIndex: 0,
    correctActionKey: "endTurn",
    comparedActionKey: "passShowdown",
    evidenceKind: "confirmed-terminal-rollout-dominance",
    pairedSamples: 16,
    pairedLowerBound: 0.05,
    pairedUpperBound: 0.3,
    seedBanks: {
      screening: ["screen"],
      confirmation: ["confirmation"],
      disjoint: true
    },
    determinizationAudit: { version: 1, complete: true },
    leafValuePairs: [terminalLeafValuePair(7)],
    modelHashes: []
  };
  assert.equal(createActionRankingReference({
    ...base,
    validSamples: { correct: 12, compared: 12 },
    terminalSamples: { correct: 11, compared: 12 }
  }), null);
  const accepted = createActionRankingReference({
    ...base,
    validSamples: { correct: 12, compared: 12 },
    terminalSamples: { correct: 12, compared: 12 }
  });
  assert.equal(validActionRankingReference(accepted, {
    informationSetHash: base.informationSetHash,
    legalActionKeys: ["passShowdown", "endTurn"]
  }), true);
  assert.equal(validActionRankingReference(accepted, {
    informationSetHash: base.informationSetHash,
    legalActionKeys: ["endTurn", "passShowdown"]
  }), false);
  assert.equal(accepted.modelHashes.length, 0);
  const acceptedWithoutLeafPair = createActionRankingReference({
    ...base,
    validSamples: { correct: 12, compared: 12 },
    terminalSamples: { correct: 12, compared: 12 },
    leafValuePairs: []
  });
  assert.equal(validActionRankingReference(acceptedWithoutLeafPair, {
    informationSetHash: base.informationSetHash,
    legalActionKeys: ["passShowdown", "endTurn"]
  }), true);
  assert.equal(acceptedWithoutLeafPair.leafValueReference, null);
});

test("independent terminal action audit uses disjoint fixed 32 and 64 seed banks", () => {
  const accepted = independentTerminalActionAuditReference("audit-contract");
  assert.equal(validActionRankingAuditReference(accepted, {
    informationSetHash: "information-set:audit-contract",
    legalActionKeys: ["passShowdown", "endTurn"]
  }), true);
  assert.equal(accepted.policyCorrectionIndependent, true);
  assert.ok(accepted.excludedFrom.includes("policy-loss"));
  const overlapping = structuredClone(accepted);
  overlapping.seedBanks.final[0] = overlapping.seedBanks.selection[0];
  assert.equal(validActionRankingAuditReference(overlapping, {
    informationSetHash: "information-set:audit-contract",
    legalActionKeys: ["passShowdown", "endTurn"]
  }), false);
  const incomplete = structuredClone(accepted);
  incomplete.final.terminalPairs = 31;
  assert.equal(validActionRankingAuditReference(incomplete, {
    informationSetHash: "information-set:audit-contract",
    legalActionKeys: ["passShowdown", "endTurn"]
  }), false);
});

test("action ranking certification evaluates the deployed calibrated leaf-value path", () => {
  const model = createNeuralModel();
  const reference =
    independentTerminalActionAuditReference("leaf-path-ranking");
  const ranking = evaluateActionRankingAudit(model, [{
    gameId: "leaf-path-ranking-game",
    steps: [{
      informationSetHash: "information-set:leaf-path-ranking",
      legalActionKeys: ["passShowdown", "endTurn"],
      actionRankingAuditReference: reference
    }]
  }], {
    bootstrapSamples: 100
  });
  assert.equal(ranking.decisions, 1);
  assert.equal(ranking.evaluatedStatePairs, 32);
  assert.equal(
    ranking.evaluatorPath,
    "gru-value-head-calibrated-probability-v1"
  );
  assert.equal(
    ranking.comparator,
    "default-ai-post-action-state-evaluator-v1"
  );
});

test("action ranking certification retains losing seeds and follows the aggregate terminal direction", () => {
  const model = createNeuralModel();
  const reference = independentTerminalActionAuditReference(
    "unconditioned-terminal-direction"
  );
  assert.equal(reference.evaluatorStatePairs.length, 32);
  assert.equal(reference.evaluatorTarget.positiveRate, 20 / 32);
  assert.equal(reference.evaluatorTarget.negativeRate, 12 / 32);
  assert.equal(reference.evaluatorTarget.direction, "recommended");
  const ranking = evaluateActionRankingAudit(model, [{
    gameId: "unconditioned-terminal-direction-game",
    steps: [{
      informationSetHash:
        "information-set:unconditioned-terminal-direction",
      legalActionKeys: ["passShowdown", "endTurn"],
      actionRankingAuditReference: reference
    }]
  }], {
    bootstrapSamples: 100
  });
  assert.equal(ranking.decisions, 1);
  assert.equal(ranking.evaluatedStatePairs, 32);
});

test("production-cutoff leaf evidence keeps only same-seed terminal audit pairs", () => {
  const state = (value) => {
    const encoded = new Float32Array(STATE_DIM);
    encoded[0] = value;
    return encoded;
  };
  const pairs = pairedTerminalLeafValuePairs([
    {
      simulationSeed: 8,
      terminal: false,
      productionLeafAudit: {
        terminal: true,
        outcome: 1,
        state: state(1),
        captureStep: 5,
        depthBin: "0-7"
      }
    },
    {
      simulationSeed: 9,
      terminal: false,
      productionLeafAudit: {
        terminal: true,
        outcome: 0,
        state: state(2),
        captureStep: 6,
        depthBin: "0-7"
      }
    }
  ], [
    {
      simulationSeed: 8,
      terminal: false,
      productionLeafAudit: {
        terminal: true,
        outcome: 0,
        state: state(-1),
        captureStep: 5,
        depthBin: "0-7"
      }
    },
    {
      simulationSeed: 10,
      terminal: false,
      productionLeafAudit: {
        terminal: true,
        outcome: 0,
        state: state(-2),
        captureStep: 6,
        depthBin: "0-7"
      }
    }
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].simulationSeed, 8);
  assert.equal(pairs[0].correctState.length, STATE_DIM);
  assert.equal(pairs[0].comparedState.length, STATE_DIM);
});

test("leaf evaluator audit scores the same calibrated value path used by rollout", () => {
  const model = createNeuralModel();
  const reference = createActionRankingReference({
    informationSetHash: "information-set:leaf-audit",
    informationSetHashVersion: 1,
    correctIndex: 1,
    comparedIndex: 0,
    correctActionKey: "endTurn",
    comparedActionKey: "passShowdown",
    evidenceKind: "confirmed-terminal-rollout-dominance",
    validSamples: { correct: 16, compared: 16 },
    terminalSamples: { correct: 16, compared: 16 },
    pairedSamples: 16,
    pairedLowerBound: 0.1,
    pairedUpperBound: 0.3,
    seedBanks: {
      screening: ["screen:leaf"],
      confirmation: ["confirmation:leaf"],
      disjoint: true
    },
    determinizationAudit: { version: 1, complete: true },
    leafValuePairs: [
      terminalLeafValuePair(101),
      terminalLeafValuePair(102)
    ],
    modelHashes: []
  });
  const audit = evaluateLeafValueRankingAudit(model, [{
    gameId: "leaf-game",
    steps: [{
      informationSetHash: "information-set:leaf-audit",
      legalActionKeys: ["passShowdown", "endTurn"],
      actionRankingReference: reference
    }]
  }], { bootstrapSamples: 100 });
  assert.equal(audit.referenceContract, LEAF_VALUE_REFERENCE_CONTRACT);
  assert.equal(audit.evaluatorPath, "gru-value-head-calibrated-probability-v1");
  assert.equal(audit.decisions, 2);
  assert.equal(audit.contributingGames, 1);
  assert.equal(audit.depthBins["0-7"].decisions, 2);
});

test("streamed evaluator audit accumulators preserve whole-partition results", () => {
  const model = createNeuralModel();
  const trajectories = ["stream-a", "stream-b"].map((identity, index) => ({
    gameId: `${identity}-game`,
    deckId: "deck-a",
    playerSeat: index,
    steps: [{
      informationSetHash: `information-set:${identity}`,
      legalActionKeys: ["passShowdown", "endTurn"],
      actionRankingAuditReference:
        independentTerminalActionAuditReference(identity),
      leafValueAuditReference: createLeafValueReference([
        terminalLeafValuePair(300 + index * 2),
        terminalLeafValuePair(301 + index * 2)
      ], {
        source: "teacher-independent-production-cutoff-audit",
        policyCorrectionIndependent: true
      })
    }]
  }));
  const actionWhole = evaluateActionRankingAudit(model, trajectories, {
    bootstrapSamples: 200
  });
  const actionAccumulator = createActionRankingAuditAccumulator();
  for (const trajectory of trajectories) {
    accumulateActionRankingAudit(model, [trajectory], actionAccumulator);
  }
  assert.deepEqual(
    finalizeActionRankingAudit(actionAccumulator, {
      bootstrapSamples: 200
    }),
    actionWhole
  );
  assert.deepEqual(Object.keys(actionWhole.deckSeats), [
    "deck-a:p1",
    "deck-a:p2"
  ]);
  assert.equal(
    actionWhole.targetHeads[EVALUATOR_TARGET_HEADS.generalActionQ].decisions,
    2
  );
  assert.equal(
    actionWhole.targetHeads[EVALUATOR_TARGET_HEADS.mulliganQ].decisions,
    0
  );
  assert.equal(
    actionWhole.deckSeatPhases["deck-a:p1::unknown"].decisions,
    1
  );
  assert.equal(
    actionWhole.deckSeatActionClasses["deck-a:p1::pass-turn-end"]
      .neuralAccuracyInterval.method,
    "deck-seat-stratified-game-hoeffding-v1"
  );
  assert.deepEqual(actionWhole.opportunityMask.deckSeatActionClasses, []);
  assert.equal(
    Object.hasOwn(
      actionWhole.deckSeatActionClasses,
      "deck-a:p1::target-effect-choice"
    ),
    false
  );

  const leafWhole = evaluateLeafValueRankingAudit(model, trajectories, {
    bootstrapSamples: 200
  });
  const leafAccumulator = createLeafValueRankingAuditAccumulator();
  for (const trajectory of trajectories) {
    accumulateLeafValueRankingAudit(model, [trajectory], leafAccumulator);
  }
  assert.deepEqual(
    finalizeLeafValueRankingAudit(leafAccumulator, {
      bootstrapSamples: 200
    }),
    leafWhole
  );
  assert.deepEqual(Object.keys(leafWhole.deckSeats), [
    "deck-a:p1",
    "deck-a:p2"
  ]);
  assert.equal(
    leafWhole.deckSeatPhases["deck-a:p2::unknown"].accuracyInterval.method,
    "deck-seat-stratified-game-hoeffding-v1"
  );
  assert.deepEqual(leafWhole.opportunityMask.deckSeatPhases, []);
});

test("standalone production leaf references are audited without a policy correction", () => {
  const model = createNeuralModel();
  const leafValueAuditReference = createLeafValueReference([
    terminalLeafValuePair(201),
    terminalLeafValuePair(202)
  ], {
    source: "teacher-independent-production-cutoff-audit",
    policyCorrectionIndependent: true,
    actionEffectComparison: terminalLeafActionEffectComparison()
  });
  const trajectories = [{
    gameId: "standalone-leaf-game",
    deckId: "deck",
    playerSeat: 0,
    steps: [{
      informationSetHash: "information-set:standalone-leaf",
      legalActionKeys: ["passShowdown", "endTurn"],
      actionRankingReference: null,
      leafValueAuditReference
    }]
  }];
  const ranking = evaluateLeafValueRankingAudit(model, trajectories, {
    bootstrapSamples: 100
  });
  assert.equal(ranking.decisions, 2);
  assert.equal(ranking.actionEffectRanking.comparisons, 1);
  assert.equal(ranking.actionEffectRanking.decisive, 1);
  assert.equal(
    ranking.actionEffectRanking.targetedDecisiveAudit.evidenceSource,
    "paired-terminal-outcome-pairs-v1"
  );
  const bootstrap = summarizeEvaluatorCertificationTrajectories(trajectories, {
    deckIds: ["deck"],
    minimumGames: 100,
    minimumActionReferences: 50,
    minimumLeafValuePairs: 50
  });
  assert.equal(bootstrap.actionReferenceCount, 0);
  assert.equal(bootstrap.leafValuePairCount, 2);
  assert.equal(bootstrap.complete, false);
});

test("natural action-effect summaries separate audited and unavailable decisions", () => {
  const model = createNeuralModel();
  const samplingFrame = {
    version: 2,
    contract: "natural-leaf-audit-sampling-frame-v2",
    datasetKey: "natural-assessment-test",
    taskIndex: 1,
    certificationRole: "training",
    scope: null,
    distribution: "natural-distribution",
    candidateSelection: "hash-priority-reservoir-policy-decision-v1",
    parentTaskManifestHash: "parent-manifest",
    eligibleDecisions: 1,
    selectionProbability: 1,
    weighting: "inverse-propensity-per-decision-v1"
  };
  samplingFrame.taskManifestHash = createHash("sha256")
    .update(JSON.stringify(samplingFrame))
    .digest("hex");
  const comparison = terminalLeafActionEffectComparison();
  comparison.samplingFrame = samplingFrame;
  const auditedReference = createLeafValueReference([], {
    source: "teacher-independent-production-cutoff-audit",
    policyCorrectionIndependent: true,
    actionEffectComparison: comparison
  });
  const ranking = evaluateLeafValueRankingAudit(model, [{
    gameId: "natural-audited-game",
    deckId: "deck",
    playerSeat: 0,
    steps: [{
      informationSetHash: "information-set:natural-audited",
      legalActionKeys: ["passShowdown", "endTurn"],
      leafValueAuditReference: auditedReference
    }]
  }, {
    gameId: "natural-unavailable-game",
    deckId: "deck",
    playerSeat: 0,
    steps: [{
      informationSetHash: "information-set:natural-unavailable",
      legalActionKeys: ["passShowdown", "endTurn"],
      naturalLeafAuditSamplingObservation: {
        version: 2,
        contract: "natural-leaf-audit-sampling-observation-v2",
        status: "audit-unavailable",
        samplingFrame
      }
    }]
  }], {
    bootstrapSamples: 100,
    certificationRole: "training",
    datasetKey: "natural-assessment-test"
  });
  const natural = ranking.actionEffectRanking.naturalDistributionAudit;
  assert.equal(natural.contract, "paired-action-effect-evaluator-regret-v15");
  assert.equal(natural.comparisons, 2);
  assert.equal(natural.auditedComparisons, 1);
  assert.equal(natural.knownZeroComparisons, 0);
  assert.equal(natural.riskAssessedComparisons, 1);
  assert.equal(natural.riskAssessedContributingGames, 1);
  assert.equal(natural.riskAssessmentCoverage, 0.5);
  assert.equal(natural.unavailableComparisons, 1);
});

test("evaluator bootstrap separates calibration, leaf, and action audit work", () => {
  const incomplete = {
    representativeCalibrationGames: 0,
    actionReferenceCount: 0,
    actionReferenceGameCount: 0,
    leafValuePairCount: 0,
    leafValueReferenceGameCount: 0,
    missingActionReferenceCoverage: ["deck:p1"],
    missingLeafValueCoverage: ["deck:p1"],
    certificationPartitions: {}
  };
  assert.equal(
    evaluatorBootstrapSamplingMode(incomplete, 0, 8),
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.calibration
  );
  assert.equal(
    evaluatorBootstrapSamplingMode(incomplete, 8, 8),
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
  );
  assert.equal(
    evaluatorBootstrapSamplingMode(incomplete, 16, 8),
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
  );

  const calibration = evaluatorBootstrapCollectionOptions(
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.calibration
  );
  assert.equal(calibration.teacherFraction, 0);
  assert.equal(calibration.teacherBudget, 0);
  assert.equal(calibration.captureProductionLeafAudit, false);
  assert.equal(calibration.captureIndependentLeafAudit, false);
  assert.equal(calibration.captureIndependentActionAudit, false);
  assert.equal(calibration.teacherActionAuditBudget, 0);

  const leaf = evaluatorBootstrapCollectionOptions(
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf
  );
  assert.equal(leaf.captureProductionLeafAudit, true);
  assert.equal(leaf.captureIndependentLeafAudit, true);
  assert.equal(leaf.captureIndependentActionAudit, false);
  assert.equal(leaf.teacherActionAuditBudget, 0);
  assert.equal(leaf.teacherLeafAuditPairBudget, 1);
  assert.equal(leaf.stopTeacherAfterLeafAuditBudget, true);

  const action = evaluatorBootstrapCollectionOptions(
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
  );
  assert.equal(action.captureProductionLeafAudit, true);
  assert.equal(action.captureIndependentLeafAudit, false);
  assert.equal(action.captureIndependentActionAudit, true);
  assert.equal(action.deferIndependentActionAudit, true);
  assert.equal(action.teacherActionAuditCandidatePoolSize, 5);
  assert.equal(action.teacherActionAuditBudget, 1);
  assert.equal(action.bestOfThreeFraction, 0);
  assert.equal(action.teacherBudget, 24);
  assert.equal(action.teacherActionAuditMaximumQueries, 24);
  assert.equal(action.teacherActionAuditReducedQueryFraction, 0.35);
  assert.equal(action.teacherActionAuditSaturationQueries, 8);
  assert.equal(action.stopTeacherAfterActionAuditBudget, false);
  assert.equal(detachedActionAuditIsEnabled(319), false);
  assert.equal(detachedActionAuditIsEnabled(320), true);
  assert.equal(detachedActionAuditIsEnabled(479, 480), false);
  assert.equal(detachedActionAuditIsEnabled(480, 480), true);
});

test("policy-Q runtime audit options suppress robust action collection", () => {
  const runtimeOptions = evaluatorBootstrapRuntimeAuditOptions({
    collectionScope: "policy-q",
    completionPartitionRequirements: EVALUATOR_POLICY_Q_EVIDENCE_REQUIREMENTS,
    ignoreActionEvidenceProtocolRequirements: true
  }, {
    minimumActionReferences: 450,
    minimumActionReferenceGames: 300
  });
  assert.equal(runtimeOptions.collectionScope, "policy-q");
  assert.equal(runtimeOptions.ignoreActionEvidenceProtocolRequirements, true);
  assert.equal(
    evaluatorBootstrapEvidenceRequirement("training", runtimeOptions)
      .minimumActionReferences,
    0
  );
  const needs = evaluatorBootstrapSamplingNeeds({
    representativeCalibrationGames: 0,
    actionReferenceCount: 0,
    actionReferenceGameCount: 0,
    leafValuePairCount: 0,
    leafValueReferenceGameCount: 0,
    missingActionReferenceCoverage: ["deck:p1"],
    missingLeafValueCoverage: ["deck:p1"],
    certificationPartitions: {}
  }, runtimeOptions);
  assert.equal(needs.action, false);
  assert.equal(needs.leaf, true);
});

test("detached evaluator action audits stay within the configured process pool", () => {
  assert.equal(evaluatorBootstrapActionAuditProcesses(8), 8);
  assert.equal(evaluatorBootstrapActionAuditProcesses(8, 16), 8);
  assert.equal(evaluatorBootstrapActionAuditProcesses(8, 4), 4);
});

test("an explicit detached evaluator maximum may exceed the collection pool", () => {
  assert.equal(evaluatorBootstrapMaximumActionAuditProcesses(8), 8);
  assert.equal(evaluatorBootstrapMaximumActionAuditProcesses(8, 16), 16);
  assert.equal(evaluatorBootstrapMaximumActionAuditProcesses(8, 4), 4);
});

test("rolling evaluator queue stops assigning only after its evidence role is complete", () => {
  const completeLeafPartition = {
    acceptedGames: 20,
    actionReferenceCount: 0,
    actionReferenceGameCount: 0,
    leafValuePairCount: 50,
    leafValueReferenceGameCount: 20,
    missingActionReferenceCoverage: ["deck:p1"],
    missingLeafValueCoverage: []
  };
  const audit = {
    representativeCalibrationGames: 0,
    actionReferenceCount: 0,
    actionReferenceGameCount: 0,
    leafValuePairCount: 150,
    leafValueReferenceGameCount: 60,
    missingActionReferenceCoverage: ["deck:p1"],
    missingLeafValueCoverage: [],
    certificationPartitions: {
      development: completeLeafPartition,
      confirmation: completeLeafPartition,
      "final-audit": completeLeafPartition
    }
  };
  assert.equal(evaluatorBootstrapSamplingModeNeedsWork(
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.leaf,
    audit
  ), false);
  assert.equal(evaluatorBootstrapSamplingModeNeedsWork(
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action,
    audit
  ), true);
  assert.equal(evaluatorBootstrapSamplingModeNeedsWork(
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.calibration,
    audit
  ), true);
});

test("action audit futility stops only when the fixed bank cannot pass", () => {
  const evidence = (differences) => ({
    terminalEvidence: {
      attemptedPairs: differences.length,
      outcomePairs: differences.map((difference, index) => ({
        simulationSeed: index + 1,
        leftOutcome: difference > 0 ? 1 : 0,
        rightOutcome: difference < 0 ? 1 : 0
      })),
      rates: {
        valid: {
          recommended: { successes: differences.length },
          selected: { successes: differences.length },
          paired: { successes: differences.length }
        },
        terminal: {
          recommended: { successes: differences.length },
          selected: { successes: differences.length },
          paired: { successes: differences.length }
        }
      }
    }
  });
  assert.deepEqual(
    independentActionAuditPreselectionFutilityReasons(
      evidence(Array(24).fill(-1)),
      { seedBanksDisjoint: true }
    ),
    ["preselection-positive-lower-bound-impossible"]
  );
  assert.deepEqual(
    independentActionAuditFutilityReasons(evidence(Array(8).fill(-1)), {
      targetPairs: 32,
      minimumTerminalPairs: 16,
      seedBanksDisjoint: true
    }),
    []
  );
});

test("action audit near-miss rescue accepts only a clean independent-boundary miss", () => {
  const diagnostic = {
    status: "final-failed",
    final: {
      attemptedPairs: 64,
      seedCount: 64,
      terminalPairs: 64,
      mean: 0.125,
      lowerBound: -0.002,
      determinization: { complete: true },
      failureReasons: ["nonpositive-terminal-paired-lower-bound"]
    }
  };
  assert.equal(
    independentActionAuditNearMissRescueEligible(diagnostic),
    true
  );
  assert.equal(
    independentActionAuditNearMissRescueEligible({
      ...diagnostic,
      final: { ...diagnostic.final, lowerBound: -0.031 }
    }),
    false
  );
  assert.equal(
    independentActionAuditNearMissRescueEligible({
      ...diagnostic,
      final: {
        ...diagnostic.final,
        failureReasons: [
          "nonpositive-terminal-paired-lower-bound",
          "terminal-rate-lower-bound"
        ]
      }
    }),
    false
  );
  assert.equal(
    independentActionAuditNearMissRescueEligible({
      ...diagnostic,
      final: {
        ...diagnostic.final,
        determinization: { complete: false }
      }
    }),
    false
  );
});

test("action audit candidate pool preserves strong priorities and exploration", () => {
  const candidate = (index, lowerBound, stratum) => ({
    descriptor: {
      auditKey: `candidate-${index}`,
      priority: {
        confirmationLowerBound: lowerBound,
        confirmationMean: lowerBound + 0.1
      }
    },
    stratum: { key: stratum }
  });
  const selected = selectIndependentActionAuditCandidatePool([
    candidate(0, 0.01, "common"),
    candidate(1, 0.02, "common"),
    candidate(2, 0.03, "common"),
    candidate(3, 0.04, "common"),
    candidate(4, 0.05, "common"),
    candidate(5, -0.2, "rare")
  ], 5);
  assert.equal(selected.length, 5);
  assert.equal(
    selected.filter((item) => item.selectionSource === "priority").length,
    4
  );
  assert.equal(
    selected.filter((item) =>
      item.selectionSource === "stratified-exploration").length,
    1
  );
  assert.ok(selected.some((item) => item.stratum.key === "rare"));
  assert.ok(selected.some((item) => item.descriptor.auditKey === "candidate-4"));
  assert.ok(!selected.some((item) => item.descriptor.auditKey === "candidate-0"));
});

test("action audit teacher queries taper only after candidate saturation", () => {
  assert.deepEqual(
    actionAuditTeacherQuerySchedule({
      candidateCount: 2,
      poolSize: 5,
      teacherQueries: 6,
      maximumQueries: 24,
      baseFraction: 0.75,
      reducedFraction: 0.35,
      lastPoolChangeAtQuery: 5
    }).queryFraction,
    0.75
  );
  assert.equal(
    actionAuditTeacherQuerySchedule({
      candidateCount: 4,
      poolSize: 5,
      teacherQueries: 10,
      maximumQueries: 24,
      baseFraction: 0.75,
      reducedFraction: 0.35,
      lastPoolChangeAtQuery: 9
    }).queryFraction,
    0.35
  );
  assert.equal(
    actionAuditTeacherQuerySchedule({
      candidateCount: 5,
      poolSize: 5,
      teacherQueries: 18,
      maximumQueries: 24,
      baseFraction: 0.75,
      reducedFraction: 0.35,
      saturationQueries: 8,
      lastPoolChangeAtQuery: 10
    }).allowed,
    false
  );
  assert.equal(
    actionAuditTeacherQuerySchedule({
      candidateCount: 5,
      poolSize: 5,
      teacherQueries: 18,
      maximumQueries: 24,
      baseFraction: 0.75,
      reducedFraction: 0.35,
      saturationQueries: 8,
      lastPoolChangeAtQuery: 10,
      critical: true
    }).forceQuery,
    true
  );
  assert.equal(
    actionAuditTeacherQuerySchedule({
      candidateCount: 5,
      poolSize: 5,
      teacherQueries: 18,
      maximumQueries: 24,
      baseFraction: 0.75,
      reducedFraction: 0.35,
      saturationQueries: 8,
      lastPoolChangeAtQuery: 10,
      missingActionClass: true
    }).forceQuery,
    true
  );
  assert.equal(
    actionAuditTeacherQuerySchedule({
      candidateCount: 1,
      poolSize: 5,
      teacherQueries: 24,
      maximumQueries: 24,
      baseFraction: 0.75
    }).allowed,
    false
  );
});

test("evaluator audit strata use turnNumber and production action kinds", () => {
  assert.equal(evaluatorAuditPhaseBand({ phase: "main", turnNumber: 1 }), "early");
  assert.equal(evaluatorAuditPhaseBand({ phase: "main", turnNumber: 4 }), "mid");
  assert.equal(evaluatorAuditPhaseBand({ phase: "main", turnNumber: 7 }), "late");
  assert.equal(evaluatorAuditPhaseBand({ phase: "mulligan", turnNumber: 1 }), "mulligan");
  assert.equal(evaluatorAuditPhaseBand({ phase: "main" }), "unknown");

  assert.equal(evaluatorAuditActionClass({
    selectedAction: { kind: "beginPlayCard" },
    legalActions: [{ kind: "beginPlayCard" }, { kind: "endTurn" }]
  }), "card-use-vs-resource-preservation");
  assert.equal(evaluatorAuditActionClass({
    selectedAction: { kind: "moveUnit" },
    legalActions: [{ kind: "moveUnit" }, { kind: "endTurn" }]
  }), "movement-combat");
  assert.equal(evaluatorAuditActionClass({
    selectedAction: { kind: "chooseEffectOption" },
    legalActions: [{ kind: "chooseEffectOption" }]
  }), "target-effect-choice");
  assert.deepEqual(evaluatorAuditOpportunityActionClasses({
    phaseBand: "mid",
    legalActions: [
      { kind: "beginPlayCard" },
      { kind: "endTurn" },
      { kind: "chooseEffectOption" }
    ]
  }), [
    "card-use-vs-resource-preservation",
    "target-effect-choice"
  ]);
  assert.deepEqual(evaluatorAuditOpportunityActionClasses({
    phaseBand: "mid",
    legalActions: [{ kind: "endTurn" }]
  }), []);

  const state = new Float32Array(STATE_DIM);
  state[17] = 7 / 20;
  const trajectory = {
    deckId: "origins-kaisa",
    playerId: "p2",
    steps: [{
      state,
      selectedActionKey: JSON.stringify({ kind: "endTurn" }),
      recommendedActionKey: JSON.stringify({
        kind: "beginPlayChampion",
        cardId: "champion"
      }),
      legalActionKeys: [
        JSON.stringify({ kind: "beginPlayChampion", cardId: "champion" }),
        JSON.stringify({ kind: "endTurn" })
      ],
      actionRankingAuditReference: {
        auditStratum: { version: 1, phaseBand: "early", actionClass: "other" }
      },
      actionRankingAuditDiagnostic: {
        racing: { stratum: { version: 1, phaseBand: "early", actionClass: "other" } }
      }
    }]
  };
  reclassifyTrajectoryAuditStrata(trajectory);
  assert.equal(
    trajectory.steps[0].actionRankingAuditReference.auditStratum.phaseBand,
    "late"
  );
  assert.equal(
    trajectory.steps[0].actionRankingAuditReference.auditStratum.actionClass,
    "card-use-vs-resource-preservation"
  );
  assert.deepEqual(
    trajectory.steps[0].actionRankingAuditDiagnostic.racing.stratum,
    trajectory.steps[0].actionRankingAuditDiagnostic.auditStratum
  );
});

test("action audit query strata detect playable-card versus resource hold without a teacher action", () => {
  assert.equal(
    independentActionAuditQueryActionClass(
      { phase: "play", round: 3 },
      { kind: "playCard" },
      [{ kind: "playCard" }, { kind: "endTurn" }]
    ),
    "card-use-vs-resource-preservation"
  );
  assert.equal(
    independentActionAuditQueryActionClass(
      { phase: "play", round: 3 },
      { kind: "endTurn" },
      [{ kind: "playCard" }, { kind: "endTurn" }]
    ),
    "card-use-vs-resource-preservation"
  );
});

test("action certification partitions advance development before holdouts", () => {
  const incomplete = (references) => ({
    acceptedGames: 30,
    actionReferenceCount: references,
    actionReferenceGameCount: references,
    missingActionReferenceCoverage: references >= 50 ? [] : ["deck:p1"]
  });
  const audit = {
    certificationPartitions: {
      development: incomplete(49),
      confirmation: incomplete(0),
      "final-audit": incomplete(0)
    }
  };
  assert.equal(
    evaluatorBootstrapActionCertificationRole(audit),
    "development"
  );
  audit.certificationPartitions.development = incomplete(50);
  assert.equal(
    evaluatorBootstrapActionCertificationRole(audit),
    "confirmation"
  );
  audit.certificationPartitions.confirmation = incomplete(50);
  assert.equal(
    evaluatorBootstrapActionCertificationRole(audit),
    "final-audit"
  );
});

test("official evaluator evidence requirements separate training from protected holdouts", () => {
  const options = {
    evidencePartitionRequirements:
      EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS
  };
  assert.deepEqual(
    evaluatorBootstrapEvidenceRequirement("training", options),
    EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS.training
  );
  assert.equal(
    evaluatorBootstrapEvidenceRequirement("development", options)
      .minimumActionReferences,
    220
  );
  assert.equal(
    evaluatorBootstrapEvidenceRequirement("confirmation", options)
      .minimumLeafValuePairs,
    400
  );
  assert.equal(
    evaluatorBootstrapEvidenceRequirement("final-audit", options)
      .minimumActionReferences,
    280
  );

  const completeAtLegacyFloor = {
    acceptedGames: 300,
    actionReferenceCount: 50,
    actionReferenceGameCount: 50,
    missingActionReferenceCoverage: [],
    missingActionReferencePhaseCoverage: [],
    missingActionReferenceActionClassCoverage: [],
    missingActionReferenceDeckPhaseCoverage: []
  };
  const audit = {
    certificationPartitions: {
      training: completeAtLegacyFloor,
      development: completeAtLegacyFloor,
      confirmation: completeAtLegacyFloor,
      "final-audit": completeAtLegacyFloor
    }
  };
  assert.equal(
    evaluatorBootstrapActionCertificationRole(audit, options),
    "training"
  );
  audit.certificationPartitions.training = {
    ...completeAtLegacyFloor,
    actionReferenceCount: 450,
    actionReferenceGameCount: 300
  };
  assert.equal(
    evaluatorBootstrapActionCertificationRole(audit, options),
    "development"
  );
});

test("evaluator bootstrap stage gates expose no protected role early", () => {
  const audit = {
    certificationPartitions: {
      training: { complete: true },
      development: { complete: true },
      confirmation: { complete: false },
      "final-audit": { complete: false }
    }
  };
  assert.equal(
    evaluatorBootstrapEvidenceRolesComplete(
      audit,
      ["training", "development"]
    ),
    true
  );
  assert.equal(
    evaluatorBootstrapEvidenceRolesComplete(audit, ["confirmation"]),
    false
  );
  audit.certificationPartitions.confirmation.complete = true;
  assert.equal(
    evaluatorBootstrapEvidenceRolesComplete(audit, ["confirmation"]),
    true
  );
  assert.equal(
    evaluatorBootstrapEvidenceRolesComplete(audit, ["final-audit"]),
    false
  );
  audit.certificationPartitions.confirmation = {
    complete: false,
    acceptedGames: 0,
    actionReferenceCount: 0,
    actionReferenceGameCount: 0
  };
  const stagedPlan = evaluatorBootstrapActionCertificationRolePlan(
    audit,
    8,
    {
      evidencePartitionRequirements:
        EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS,
      activeEvidenceRoles: ["confirmation"],
      fillActionPlanCapacity: true
    }
  );
  assert.equal(stagedPlan.primaryRole, "confirmation");
  assert.deepEqual([...new Set(stagedPlan.roles)], ["confirmation"]);
});

test("evaluator bootstrap fills an independent training partition before certification holdouts", () => {
  const complete = {
    acceptedGames: 30,
    actionReferenceCount: 50,
    actionReferenceGameCount: 20,
    missingActionReferenceCoverage: [],
    missingActionReferencePhaseCoverage: [],
    missingActionReferenceActionClassCoverage: [],
    missingActionReferenceDeckPhaseCoverage: []
  };
  const audit = {
    certificationPartitions: {
      training: { ...complete, actionReferenceCount: 49 },
      development: complete,
      confirmation: complete,
      "final-audit": complete
    }
  };
  assert.equal(
    evaluatorBootstrapActionCertificationRole(audit),
    "training"
  );
  audit.certificationPartitions.training = complete;
  assert.equal(evaluatorBootstrapActionCertificationRole(audit), null);
});

test("observed evaluator holdouts are downgraded before compatible migration", () => {
  const policy = EVALUATOR_BOOTSTRAP_HOLDOUT_MIGRATION_POLICIES
    .observedHoldouts;
  assert.equal(
    migratedCertificationRole("development", "action-ranking-audit", policy),
    "training"
  );
  assert.equal(
    migratedCertificationRole("confirmation", "leaf-audit", policy),
    "development"
  );
  assert.equal(
    migratedCertificationRole("final-audit", "action-ranking-audit", policy),
    "training"
  );
  assert.equal(
    migratedCertificationRole(null, "leaf-audit", policy),
    "training"
  );
  assert.equal(
    migratedCertificationRole("development", "calibration-only", policy),
    null
  );
});

test("compatible evaluator migration rewrites the allocation dataset key and preserves provenance", () => {
  const migratedAt = "2026-08-07T12:00:00.000Z";
  const compatibilityMigration = {
    version: 2,
    fromDatasetKey: "source-key",
    toDatasetKey: "target-key",
    migratedGames: 1920
  };
  const state = migratedEvaluatorBootstrapAllocationState({
    version: 1,
    datasetKey: "source-key",
    allocatedGames: 2240,
    expansions: 6
  }, {
    targetDatasetKey: "target-key",
    migratedAt,
    migratedGames: 1920,
    compatibilityMigration
  });
  assert.equal(state.datasetKey, "target-key");
  assert.equal(state.allocatedGames, 2240);
  assert.equal(state.deckSeatSchedule.boundaryGameIndex, 1920);
  assert.deepEqual(state.compatibilityMigration, compatibilityMigration);
  assert.equal(state.updatedAt, migratedAt);
});

test("compatible evaluator migration preserves structured v2 evidence under the target fingerprint", () => {
  const source = "sha256:structured-source";
  const target = "sha256:structured-target";
  const snapshot = () => ({
    engineFingerprint: source,
    evidenceSchemaVersion: STRUCTURED_EVIDENCE_SCHEMA_VERSION
  });
  const transition = () => ({
    ...snapshot(),
    source: "viewer-public-transition",
    preAction: { ...snapshot(), source: "viewer-public-observation" },
    postAction: { ...snapshot(), source: "viewer-public-observation" }
  });
  const trajectory = {
    steps: [{
      actionRankingAuditReference: {
        evaluatorStatePairs: [{
          recommendedStructuredState: transition(),
          selectedStructuredState: snapshot()
        }]
      },
      leafValueAuditReference: {
        pairs: [{
          correctStructuredState: snapshot(),
          comparedStructuredState: snapshot()
        }]
      },
      actionRankingReference: {
        leafValueReference: {
          pairs: [{
            correctStructuredState: snapshot(),
            comparedStructuredState: snapshot()
          }]
        }
      }
    }]
  };
  migrateEvaluatorBootstrapStructuredEvidenceFingerprints(
    trajectory,
    source,
    target
  );
  const migratedSnapshots = [
    ...trajectory.steps[0].actionRankingAuditReference.evaluatorStatePairs
      .flatMap((pair) => [
        pair.recommendedStructuredState,
        pair.selectedStructuredState
      ]),
    ...trajectory.steps[0].leafValueAuditReference.pairs.flatMap((pair) => [
      pair.correctStructuredState,
      pair.comparedStructuredState
    ]),
    ...trajectory.steps[0].actionRankingReference.leafValueReference.pairs
      .flatMap((pair) => [
        pair.correctStructuredState,
        pair.comparedStructuredState
      ])
  ];
  assert.ok(migratedSnapshots.every((item) =>
    item.engineFingerprint === target
      && item.compatibilityMigration.fromEngineFingerprint === source
      && item.compatibilityMigration.toEngineFingerprint === target));
  const migratedTransition = trajectory.steps[0]
    .actionRankingAuditReference.evaluatorStatePairs[0]
    .recommendedStructuredState;
  assert.equal(migratedTransition.preAction.engineFingerprint, target);
  assert.equal(migratedTransition.postAction.engineFingerprint, target);
  const chained = {
    evaluatorBootstrapCompatibilityMigration: {
      fromEngineFingerprint: "sha256:older-source",
      toEngineFingerprint: source
    },
    steps: [{
      leafValueAuditReference: {
        pairs: [{
          correctStructuredState: {
            engineFingerprint: "sha256:older-source"
          }
        }]
      }
    }]
  };
  migrateEvaluatorBootstrapStructuredEvidenceFingerprints(
    chained,
    source,
    target
  );
  assert.deepEqual(
    chained.steps[0].leafValueAuditReference.pairs[0]
      .correctStructuredState.compatibilityMigration,
    {
      version: 1,
      fromEngineFingerprint: "sha256:older-source",
      viaEngineFingerprint: source,
      toEngineFingerprint: target
    }
  );
  assert.throws(() =>
    migrateEvaluatorBootstrapStructuredEvidenceFingerprints({
      steps: [{
        leafValueAuditReference: {
          pairs: [{
            correctStructuredState: {
              engineFingerprint: "sha256:unexpected"
            }
          }]
        }
      }]
    }, source, target), /source fingerprint mismatch/);
});

test("action certification queue reserves only the estimated current-role work and prefetches the next holdout", () => {
  const complete = {
    acceptedGames: 100,
    actionReferenceCount: 50,    structuredV2ActionReferenceCount: 50,
    actionReferenceGameCount: 50,    structuredV2ActionReferenceGameCount: 50,
    missingActionReferenceCoverage: [],
    samplingModes: { "action-ranking-audit": 300 }
  };
  const audit = {
    certificationPartitions: {
      development: {
        ...complete,
        actionReferenceCount: 48,        structuredV2ActionReferenceCount: 48,
        actionReferenceGameCount: 48
      },
      confirmation: {
        acceptedGames: 20,
        actionReferenceCount: 4,        structuredV2ActionReferenceCount: 4,
        actionReferenceGameCount: 4,        structuredV2ActionReferenceGameCount: 4,
        missingActionReferenceCoverage: [],
        samplingModes: { "action-ranking-audit": 24 }
      },
      "final-audit": {
        acceptedGames: 0,
        actionReferenceCount: 0,        structuredV2ActionReferenceCount: 0,
        actionReferenceGameCount: 0,        structuredV2ActionReferenceGameCount: 0,
        missingActionReferenceCoverage: [],
        samplingModes: {}
      }
    }
  };
  assert.equal(
    evaluatorBootstrapActionRoleGameDemand(
      audit.certificationPartitions.development
    ).demand,
    13
  );
  const plan = evaluatorBootstrapActionCertificationRolePlan(audit, 32);
  assert.equal(plan.primaryRole, "development");
  assert.deepEqual(plan.allocations, {
    development: 13,
    confirmation: 19
  });
  assert.deepEqual(plan.roles.slice(0, 13), Array(13).fill("development"));
  assert.deepEqual(plan.roles.slice(13), Array(19).fill("confirmation"));
  assert.deepEqual(plan.prefetchedRoles, ["confirmation"]);
});

test("action certification queue does not pad unused capacity with completed-role work", () => {
  const nearlyComplete = (phase) => ({
    acceptedGames: 100,
    actionReferenceCount: 50,    structuredV2ActionReferenceCount: 50,
    actionReferenceGameCount: 50,    structuredV2ActionReferenceGameCount: 50,
    actionReferencePhaseCoverage: {
      early: 5,
      mid: 5,
      late: 5,
      mulligan: phase === "mulligan" ? 4 : 5
    },
    missingActionReferenceCoverage: [],
    missingActionReferencePhaseCoverage: [phase],
    samplingModes: { "action-ranking-audit": 400 }
  });
  const complete = {
    ...nearlyComplete("mulligan"),
    actionReferencePhaseCoverage: {
      early: 5,
      mid: 5,
      late: 5,
      mulligan: 5
    },
    missingActionReferencePhaseCoverage: []
  };
  const plan = evaluatorBootstrapActionCertificationRolePlan({
    certificationPartitions: {
      development: nearlyComplete("mulligan"),
      confirmation: complete,
      "final-audit": complete
    }
  }, 48);
  assert.equal(plan.primaryRole, "development");
  assert.deepEqual(plan.allocations, { development: 8 });
  assert.equal(plan.roles.length, 8);
});

test("action evidence collection uses full bulk windows until the remaining yield fits inside the previous bulk", () => {
  const complete = {
    acceptedGames: 100,
    actionReferenceCount: 50,    structuredV2ActionReferenceCount: 50,
    actionReferenceGameCount: 50,    structuredV2ActionReferenceGameCount: 50,
    missingActionReferenceCoverage: [],
    missingActionReferencePhaseCoverage: [],
    missingActionReferenceActionClassCoverage: [],
    missingActionReferenceDeckPhaseCoverage: [],
    samplingModes: { "action-ranking-audit": 100 }
  };
  const largeGap = {
    ...complete,
    actionReferenceCount: 40,    structuredV2ActionReferenceCount: 40,
    actionReferenceGameCount: 40,    structuredV2ActionReferenceGameCount: 40,
    samplingModes: { "action-ranking-audit": 80 }
  };
  const audit = {
    certificationPartitions: {
      development: largeGap,
      confirmation: complete,
      "final-audit": complete
    }
  };
  const bulk = evaluatorBootstrapActionCollectionStrategy(audit, 48, {
    lastActionBulkBatch: { evidenceUnitsGained: 10 }
  });
  assert.equal(bulk.mode, "bulk");
  assert.equal(bulk.taskLimit, 48);
  assert.equal(bulk.rolePlan.roles.length, 48);

  const fine = evaluatorBootstrapActionCollectionStrategy({
    certificationPartitions: {
      development: {
        ...largeGap,
        actionReferenceCount: 46,        structuredV2ActionReferenceCount: 46,
        actionReferenceGameCount: 46
      },
      confirmation: complete,
      "final-audit": complete
    }
  }, 48, {
    lastActionBulkBatch: { evidenceUnitsGained: 10 }
  });
  assert.equal(fine.mode, "fine");
  assert.equal(fine.taskLimit, 1);
  assert.equal(fine.rolePlan.roles.length, 1);
});

test("leaf certification queue assigns missing deck phases to their exact holdout roles", () => {
  const complete = {
    acceptedGames: 100,
    leafValuePairCount: 100,
    leafValueReferenceGameCount: 60,
    structuredV2LeafValuePairCount: 100,
    structuredV2LeafValueReferenceGameCount: 60,
    missingLeafValueCoverage: [],
    missingLeafValuePhaseCoverage: [],
    missingLeafValueDeckPhaseCoverage: [],
    missingStructuredV2LeafValueCoverage: [],
    missingStructuredV2LeafValuePhaseCoverage: [],
    missingStructuredV2LeafValueDeckPhaseCoverage: [],
    samplingModes: { "leaf-audit": 100 }
  };
  const audit = {
    certificationPartitions: {
      development: complete,
      confirmation: {
        ...complete,
        missingLeafValueDeckPhaseCoverage: ["origins-sett::late"],
        missingStructuredV2LeafValueDeckPhaseCoverage: ["origins-sett::late"]
      },
      "final-audit": {
        ...complete,
        missingLeafValueDeckPhaseCoverage: [
          "proving-grounds-annie::mid",
          "proving-grounds-master-yi::late",
          "origins-leona::mid"
        ],
        missingStructuredV2LeafValueDeckPhaseCoverage: [
          "proving-grounds-annie::mid",
          "proving-grounds-master-yi::late",
          "origins-leona::mid"
        ]
      }
    }
  };
  assert.equal(
    evaluatorBootstrapLeafCertificationRole(audit),
    "confirmation"
  );
  assert.equal(
    evaluatorBootstrapLeafRoleGameDemand(
      audit.certificationPartitions.confirmation
    ).demand,
    4
  );
  const plan = evaluatorBootstrapLeafCertificationRolePlan(audit, 24);
  assert.equal(plan.primaryRole, "confirmation");
  assert.deepEqual(plan.allocations, {
    confirmation: 4,
    "final-audit": 12
  });
  assert.deepEqual(plan.roles.slice(0, 4), Array(4).fill("confirmation"));
  assert.deepEqual(plan.roles.slice(4), Array(12).fill("final-audit"));
  assert.equal(plan.focuses.slice(0, 4)
    .filter((focus) => focus.naturalDistribution).length, 2);
  assert.ok(plan.focuses.slice(0, 4)
    .filter((focus) => !focus.naturalDistribution)
    .every((focus) => focus.deckPhaseKey === "origins-sett::late"));
  assert.deepEqual(
    [...new Set(plan.focuses.slice(4)
      .filter((focus) => !focus.naturalDistribution)
      .map((focus) => focus.deckPhaseKey))]
      .sort(),
    [
      "proving-grounds-annie::mid",
      "proving-grounds-master-yi::late",
      "origins-leona::mid"
    ].sort()
  );
});

test("leaf certification demand counts quantitative phase deficits", () => {
  const requirement = {
    minimumGames: 240,
    minimumLeafValuePairs: 1800,
    minimumLeafValueReferenceGames: 240,
    minimumStructuredV2LeafValuePairs: 1800,
    minimumStructuredV2LeafValueReferenceGames: 240,
    minimumLeafValuePairsByPhase: {
      mulligan: 1000,
      early: 1000,
      mid: 1000,
      late: 300
    },
    minimumLeafValueReferenceGamesByPhase: {
      mulligan: 320,
      early: 320,
      mid: 320,
      late: 100
    },
    minimumLeafValuePairsPerDeckPhase: 0,
    minimumLeafValueReferenceGamesPerDeckPhase: 0
  };
  const partition = {
    role: "training",
    acceptedGames: 2318,
    leafValuePairCount: 3901,
    structuredV2LeafValuePairCount: 1956,
    leafValueReferenceGameCount: 573,
    structuredV2LeafValueReferenceGameCount: 324,
    leafValuePhaseCoverage: {
      mulligan: 263,
      early: 572,
      mid: 605,
      late: 516
    },
    structuredV2LeafValuePhaseCoverage: {
      mulligan: 263,
      early: 572,
      mid: 605,
      late: 516
    },
    leafValuePhaseReferenceGameCount: {
      mulligan: 112,
      early: 85,
      mid: 86,
      late: 86
    },
    structuredV2LeafValuePhaseReferenceGameCount: {
      mulligan: 112,
      early: 85,
      mid: 86,
      late: 86
    },
    missingLeafValueCoverage: [],
    missingStructuredV2LeafValueCoverage: [],
    missingLeafValuePhaseCoverage: ["mulligan", "early", "mid"],
    missingStructuredV2LeafValuePhaseCoverage: ["mulligan", "early", "mid"],
    missingLeafValueDeckPhaseCoverage: [],
    missingStructuredV2LeafValueDeckPhaseCoverage: [],
    samplingModes: { "leaf-audit": 573 }
  };
  const options = evaluatorBootstrapRuntimeAuditOptions({
    evidencePartitionRequirements: { training: requirement }
  });
  const demand = evaluatorBootstrapLeafRoleGameDemand(
    partition,
    options,
    "training"
  );
  assert.ok(demand.phaseDemand >= 600);
  assert.equal(demand.demand, demand.phaseDemand);
  assert.equal(
    evaluatorBootstrapLeafCertificationRolePlan({
      certificationPartitions: { training: partition }
    }, 70, options).roles.length,
    70
  );
  const plan = evaluatorBootstrapLeafCertificationRolePlan({
    certificationPartitions: { training: partition }
  }, 70, options);
  const phaseAllocations = Object.groupBy
    ? Object.fromEntries(Object.entries(Object.groupBy(
      plan.focuses,
      (focus) => focus.phaseBand
    )).map(([phaseBand, focuses]) => [phaseBand, focuses.length]))
    : plan.focuses.reduce((counts, focus) => ({
      ...counts,
      [focus.phaseBand]: (counts[focus.phaseBand] || 0) + 1
    }), {});
  assert.deepEqual(phaseAllocations, {
    mulligan: 14,
    early: 10,
    mid: 10,
    late: 1,
    undefined: 35
  });
});

test("balanced evaluator records cap dense phases while preserving phase and deck-seat support", () => {
  const deckIds = ["deck-a", "deck-b"];
  const phases = [
    ...Array(45).fill("mid"),
    ...Array(8).fill("early"),
    ...Array(8).fill("late"),
    ...Array(5).fill("mulligan")
  ];
  const records = phases.map((phaseBand, index) => {
    const deckId = deckIds[index % deckIds.length];
    const seat = index % 4 < 2 ? "p1" : "p2";
    return {
      workerIndex: index % 4,
      gameIndex: index,
      samplingMode: "action-ranking-audit",
      resultIndex: {
        actionReferenceCount: 1,
        leafValuePairCount: 0,
        actionReferenceIdentities: [{
          identity: `reference-${index}`,
          coverageKey: `${deckId}:${seat}`,
          phaseBand,
          actionClass: phaseBand === "mulligan" ? "mulligan" : "movement-combat"
        }]
      }
    };
  });
  const selected = selectBalancedEvaluatorBootstrapRecords(records, {
    maximumRecords: 100,
    targetActionReferences: 50,
    minimumActionReferencesPerPhase: 5,
    deckIds,
    seed: "balanced-record-test"
  });
  assert.equal(selected.length, 50);
  const selectedIdentities = selected.flatMap(
    (record) => record.resultIndex.actionReferenceIdentities
  );
  for (const phase of ["early", "mid", "late", "mulligan"]) {
    assert.ok(selectedIdentities.filter(
      (identity) => identity.phaseBand === phase
    ).length >= 5);
  }
  for (const deckId of deckIds) {
    for (const seat of ["p1", "p2"]) {
      assert.ok(selectedIdentities.some(
        (identity) => identity.coverageKey === `${deckId}:${seat}`
      ));
    }
  }
  assert.ok(selectedIdentities.filter(
    (identity) => identity.phaseBand === "mid"
  ).length < 45);
});

test("balanced evaluator records preserve the complete role evidence contract", () => {
  const deckIds = ["deck-a", "deck-b"];
  const phases = ["mulligan", "early", "mid", "late"];
  const records = [];
  let gameIndex = 0;
  for (const deckId of deckIds) {
    for (const seat of ["p1", "p2"]) {
      for (const phaseBand of phases) {
        for (let repeat = 0; repeat < 2; repeat += 1) {
          const actionClass = EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES[
            gameIndex % EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.length
          ];
          const coverageKey = `${deckId}:${seat}`;
          const deckPhaseKey = `${deckId}::${phaseBand}`;
          records.push({
            workerIndex: gameIndex % 4,
            gameIndex,
            samplingMode: "action-ranking-audit",
            resultIndex: currentEvidenceIndexFixture({
              version: 5,
              valid: true,
              gameCoverage: { [coverageKey]: 1 },
              actionReferenceCoverage: { [coverageKey]: 1 },
              leafValueCoverage: { [coverageKey]: 3 },
              stratumVersion: 2,
              actionReferencePhaseCoverage: { [phaseBand]: 1 },
              actionReferenceActionClassCoverage: { [actionClass]: 1 },
              leafValuePhaseCoverage: { [phaseBand]: 3 },
              leafValueDeckPhaseCoverage: { [deckPhaseKey]: 3 },
              actionReferenceIdentities: [{
                identity: `balanced-reference-${gameIndex}`,
                deckId,
                coverageKey,
                phaseBand,
                actionClass
              }],
              actionReferenceCount: 1,
              leafValuePairCount: 3,
              actionAuditRacing: {},
              logicalGames: 1,
              physicalGames: 1
            })
          });
          gameIndex += 1;
        }
      }
    }
  }
  const evidenceRequirement = {
    minimumGames: 24,
    minimumActionReferences: 24,
    minimumActionReferenceGames: 24,
    minimumLeafValuePairs: 48,
    minimumLeafValueReferenceGames: 16,
    minimumActionReferencesPerDeckSeat: 4,
    minimumLeafValuePairsPerDeckSeat: 6,
    minimumActionReferencesByPhase: Object.fromEntries(
      phases.map((phase) => [phase, 6])
    ),
    minimumActionReferenceGamesByPhase: Object.fromEntries(
      phases.map((phase) => [phase, 6])
    ),
    minimumLeafValuePairsByPhase: Object.fromEntries(
      phases.map((phase) => [phase, 6])
    ),
    minimumLeafValueReferenceGamesByPhase: Object.fromEntries(
      phases.map((phase) => [phase, 2])
    ),
    minimumActionReferencesPerCoreClass: 5,
    minimumActionReferenceGamesPerCoreClass: 5,
    minimumActionReferencesPerDeckPhase: 2,
    minimumActionReferenceGamesPerDeckPhase: 2,
    minimumLeafValuePairsPerDeckPhase: 6,
    minimumLeafValueReferenceGamesPerDeckPhase: 2
  };
  const selected = selectBalancedEvaluatorBootstrapRecords(records, {
    maximumRecords: records.length,
    evidenceRequirement,
    deckIds,
    seed: "complete-role-evidence-contract"
  });
  const audit = summarizeEvaluatorBootstrap({ records: selected }, {
    ...evidenceRequirement,
    deckIds,
    includeCertificationPartitions: false,
    minimumGamesFloor: 0,
    minimumReferenceFloor: 0,
    minimumReferenceGamesFloor: 0,
    minimumCalibrationFloor: 0,
    minimumRepresentativeCalibrationGames: 0
  });
  assert.equal(audit.complete, true);
  assert.ok(audit.actionReferenceGameCount >= 24);
  assert.ok(audit.leafValueReferenceGameCount >= 16);
  assert.deepEqual(audit.missingActionReferenceCoverage, []);
  assert.deepEqual(audit.missingLeafValueCoverage, []);
  assert.deepEqual(audit.missingActionReferenceActionClassCoverage, []);
  assert.deepEqual(audit.missingActionReferenceDeckPhaseCoverage, []);
  assert.deepEqual(audit.missingLeafValueDeckPhaseCoverage, []);
});

test("evaluator bootstrap resumes only the unfinished tasks from its persisted collection window", () => {
  const allocation = {
    activeCollectionWindow: {
      version: 1,
      samplingMode: "action-ranking-audit",
      startCompletedLogical: 569,
      targetCompletedLogical: 617
    }
  };
  assert.equal(
    evaluatorBootstrapResumeTaskLimit(
      24,
      allocation,
      616,
      "action-ranking-audit"
    ),
    1
  );
  assert.equal(
    evaluatorBootstrapResumeTaskLimit(
      24,
      allocation,
      617,
      "action-ranking-audit"
    ),
    24
  );
  assert.equal(
    evaluatorBootstrapResumeTaskLimit(
      24,
      allocation,
      618,
      "action-ranking-audit"
    ),
    24
  );
  assert.equal(
    evaluatorBootstrapResumeTaskLimit(
      24,
      allocation,
      616,
      "leaf-audit"
    ),
    24
  );
});

test("evaluator bootstrap carries persisted pending action audits into the next coordinator pass", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-pending-detached-audit-")
  );
  const archivePath = path.join(directory, "pending.json.gz");
  const result = {
    summaries: [{
      completed: true,
      naturallyCompleted: true,
      invalid: false
    }],
    trajectories: [],
    pendingActionAudit: {
      executionContract: "global-seed-batch-queue-v1",
      candidates: [{ auditKey: "pending-candidate" }]
    }
  };
  const record = {
    samplingMode: "action-ranking-audit",
    archivePath,
    resultIndex: createEvaluatorBootstrapResultIndex(result)
  };
  try {
    await writeTrajectoryArchive(archivePath, result);
    assert.deepEqual(
      await pendingDetachedActionAuditRecords([record]),
      [record]
    );
    assert.deepEqual(
      await pendingDetachedActionAuditRecords([{
        ...record,
        archivePath: path.join(directory, "must-not-be-read.json.gz"),
        detachedActionAuditComplete: true
      }]),
      []
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("prefetched certification task keeps its own role and collection metadata across retries", () => {
  const task = {
    workerIndex: 2,
    gameIndex: 7,
    assignedGames: 20,
    comparisonBlockOffset: 4
  };
  const resolved = resolveSelfPlayTaskOptions(
    task,
    3,
    8,
    ({ taskIndex }) => ({
      optionOverrides: {
        deckCurriculum: {
          focusDeckIds: ["origins-kaisa"],
          focusDeckSeats: { "origins-kaisa": ["p2"] }
        },
        resultHandoff: {
          kind: "evaluator-bootstrap",
          datasetKey: "dataset",
          samplingMode: "action-ranking-audit",
          certificationRole: taskIndex < 2
            ? "development"
            : "confirmation"
        }
      },
      taskContext: {
        certificationRole: "confirmation",
        prefetched: true
      }
    })
  );
  assert.deepEqual(task, {
    workerIndex: 2,
    gameIndex: 7,
    assignedGames: 20,
    comparisonBlockOffset: 4
  });
  assert.equal(
    resolved.optionOverrides.resultHandoff.certificationRole,
    "confirmation"
  );
  assert.equal(resolved.taskContext.prefetched, true);
  assert.equal(resolved.workerIndex, task.workerIndex);
  assert.equal(resolved.gameIndex, task.gameIndex);
});

test("self-play workers persist each prefetched task under its scheduled certification role", async () => {
  const seen = [];
  const roles = ["development", "confirmation"];
  const collected = await collectProcessPoolSelfPlay({
    games: 2,
    workers: 1,
    processes: 1,
    decks: decks.slice(0, 2),
    model: createNeuralModel(),
    maxActions: 1,
    teacherFraction: 0,
    streamResultHandoff: true,
    retainResults: false,
    resultHandoff: {
      kind: "evaluator-bootstrap",
      datasetKey: "role-prefetch-test",
      samplingMode: "action-ranking-audit",
      certificationRole: "development"
    },
    resolveTaskOptions: ({ taskIndex }) => ({
      optionOverrides: {
        resultHandoff: {
          kind: "evaluator-bootstrap",
          datasetKey: "role-prefetch-test",
          samplingMode: "action-ranking-audit",
          certificationRole: roles[taskIndex]
        }
      },
      taskContext: {
        certificationRole: roles[taskIndex],
        prefetched: taskIndex > 0
      }
    }),
    onGameHandoff: (game) => {
      seen.push({
        contextRole: game.taskContext.certificationRole,
        summaryRole: game.resultSummary.certificationRole
      });
    }
  });
  assert.equal(collected.workerStats.collectedGames, 2);
  assert.deepEqual(seen, [
    {
      contextRole: "development",
      summaryRole: "development"
    },
    {
      contextRole: "confirmation",
      summaryRole: "confirmation"
    }
  ]);
});

test("self-play workers receive evaluator audit phase focus through base and task options", async () => {
  const seen = [];
  const collected = await collectProcessPoolSelfPlay({
    games: 1,
    workers: 1,
    processes: 1,
    decks: decks.slice(0, 2),
    model: createNeuralModel(),
    maxActions: 1,
    teacherFraction: 0,
    teacherLeafAuditFocusPhaseBands: ["late"],
    teacherActionAuditFocusActionClasses: ["movement-combat"],
    streamResultHandoff: true,
    retainResults: false,
    resultHandoff: {
      kind: "evaluator-bootstrap",
      datasetKey: "phase-focus-handoff-test",
      samplingMode: "leaf-audit",
      certificationRole: null
    },
    resolveTaskOptions: () => ({
      optionOverrides: {
        teacherLeafAuditFocusPhaseBands: ["mid"],
        teacherActionAuditFocusPhaseBands: ["mid"],
        teacherActionAuditFocusActionClasses: [
          "card-use-vs-resource-preservation"
        ],
        resultHandoff: {
          kind: "evaluator-bootstrap",
          datasetKey: "phase-focus-handoff-test",
          samplingMode: "leaf-audit",
          certificationRole: null
        }
      }
    }),
    onGameHandoff: (game) => {
      seen.push(game.resultSummary.appliedAuditPhaseFocus);
    }
  });
  assert.equal(collected.workerStats.collectedGames, 1);
  assert.deepEqual(seen, [{
    leaf: ["mid"],
    action: ["mid"],
    actionClasses: ["card-use-vs-resource-preservation"]
  }]);
});

test("focused evaluator audits reserve teacher queries for the requested phase", () => {
  const leafOptions = {
    captureIndependentLeafAudit: true,
    leafFocusPhaseBands: ["late"]
  };
  assert.equal(teacherAuditPhaseFocusAllowsQuery({
    ...leafOptions,
    currentPhaseBand: "early"
  }), false);
  assert.equal(teacherAuditPhaseFocusAllowsQuery({
    ...leafOptions,
    currentPhaseBand: "mid"
  }), false);
  assert.equal(teacherAuditPhaseFocusAllowsQuery({
    ...leafOptions,
    currentPhaseBand: "late"
  }), true);
  assert.equal(teacherAuditPhaseFocusAllowsQuery({
    currentPhaseBand: "late",
    deferIndependentActionAudit: true,
    actionFocusPhaseBands: ["late"]
  }), true);
  assert.equal(teacherAuditPhaseFocusAllowsQuery({
    currentPhaseBand: "early",
    deferIndependentActionAudit: true,
    actionFocusPhaseBands: ["late"]
  }), false);
});

test("audit-only teacher search stops exactly when its useful evidence budget is exhausted", () => {
  assert.equal(teacherAuditCollectionBudgetExhausted({
    stopTeacherAfterActionAuditBudget: true,
    captureIndependentActionAudit: true,
    actionAuditAttempts: 1,
    actionAuditBudget: 2
  }), false);
  assert.equal(teacherAuditCollectionBudgetExhausted({
    stopTeacherAfterActionAuditBudget: true,
    captureIndependentActionAudit: true,
    actionAuditAttempts: 2,
    actionAuditBudget: 2
  }), true);
  assert.equal(teacherAuditCollectionBudgetExhausted({
    stopTeacherAfterLeafAuditBudget: true,
    captureIndependentLeafAudit: true,
    leafAuditAttempts: 6,
    leafAuditPairBudget: 6
  }), true);
  assert.equal(teacherAuditCollectionBudgetExhausted({
    stopTeacherAfterLeafAuditBudget: true,
    captureIndependentLeafAudit: true,
    leafAuditAttempts: 0,
    leafAuditPairs: 6,
    leafAuditPairBudget: 6
  }), false);
});

test("incomplete evaluator bootstrap cannot issue a certificate", () => {
  const model = createNeuralModel();
  model.metadata.engineFingerprint = "sha256:test-engine";
  model.metadata.engineValidationStatus = "current-engine-validated";
  const issued = createEvaluatorCertificate(model, {
    engineFingerprint: "sha256:test-engine",
    frozen: true,
    bootstrapRequired: true,
    bootstrapAudit: {
      version: 2,
      complete: false,
      acceptedGames: 100,
      referenceCount: 50,
      contributingGames: 20,
      gameCoverage: { "deck:p1": 50, "deck:p2": 50 },
      referenceCoverage: { "deck:p1": 50 },
      missingGameCoverage: [],
      missingReferenceCoverage: ["deck:p2"]
    },
    holdout: {
      games: 120,
      completed: 120,
      completionRate: 1,
      invalidGames: 0,
      independent: true,
      seedProtected: true
    },
    calibration: {
      testGames: 120,
      brier: 0.2,
      expectedCalibrationError: 0.1
    },
    actionRanking: {
      referenceVersion: ACTION_RANKING_AUDIT_REFERENCE_VERSION,
      referenceContract: ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
      evaluatorPath: "gru-value-head-calibrated-probability-v1",
      comparator: "default-ai-post-action-state-evaluator-v1",
      splitUnit: "game-cluster-bootstrap",
      contributingGames: 20,
      decisions: 50,
      neuralAccuracy: 0.7,
      heuristicAccuracy: 0.5,
      pairedImprovementLowerBound: 0.05,
      bootstrap: { unit: "game" }
    }
  });
  assert.equal(issued.status.eligible, false);
  assert.equal(issued.status.reasons.includes("evaluator-bootstrap-incomplete"), true);
  assert.deepEqual(
    issued.certificate.evaluatorBootstrap.missingReferenceCoverage,
    ["deck:p2"]
  );
});

test("evaluator bootstrap requires action and leaf evidence in every phase", () => {
  const records = EVALUATOR_AUDIT_PHASE_BANDS.flatMap((phase) =>
    Array.from({ length: 8 }, (_, index) => {
      const leafPairs = index < 4 ? 3 : 0;
      const actionClass = EVALUATOR_AUDIT_CORE_ACTION_CLASSES[
        index % EVALUATOR_AUDIT_CORE_ACTION_CLASSES.length
      ];
      return {
        workerIndex: index,
        gameIndex: `${phase}-${index}`,
        samplingMode: "uniform-balanced",
        resultIndex: currentEvidenceIndexFixture({
          version: EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION,
          valid: true,
          gameCoverage: {},
          actionReferenceCoverage: {},
          leafValueCoverage: {},
          stratumVersion: EVALUATOR_AUDIT_STRATUM_VERSION,
          actionReferencePhaseCoverage: { [phase]: 1 },
          actionReferenceActionClassCoverage: { [actionClass]: 1 },
          leafValuePhaseCoverage: { [phase]: leafPairs },
          actionReferenceIdentities: [{
            identity: `${phase}:${index}`,
            deckId: "deck",
            coverageKey: "deck:p1",
            phaseBand: phase,
            actionClass
          }],
          leafValuePairCount: leafPairs,
          actionAuditRacing: {},
          logicalGames: 1,
          physicalGames: 1
        })
      };
    })
  );
  const options = {
    deckIds: [],
    includeCertificationPartitions: false,
    minimumGamesFloor: 0,
    minimumReferenceFloor: 0,
    minimumReferenceGamesFloor: 0,
    minimumCalibrationFloor: 0,
    minimumGames: 0,
    minimumActionReferences: 0,
    minimumLeafValuePairs: 0,
    minimumActionReferenceGames: 0,
    minimumLeafValueReferenceGames: 0,
    minimumRepresentativeCalibrationGames: 0
  };
  const complete = summarizeEvaluatorBootstrap({ records }, options);
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.missingActionReferencePhaseCoverage, []);
  assert.deepEqual(complete.missingLeafValuePhaseCoverage, []);
  assert.deepEqual(complete.missingActionReferenceActionClassCoverage, []);

  const withoutLate = summarizeEvaluatorBootstrap({
    records: records.filter((record) =>
      !String(record.gameIndex).startsWith("late-"))
  }, options);
  assert.equal(withoutLate.complete, false);
  assert.ok(withoutLate.missingActionReferencePhaseCoverage.includes("late"));
  assert.ok(withoutLate.missingLeafValuePhaseCoverage.includes("late"));
});

test("evaluator bootstrap requires each deck to contribute mid and late evidence", () => {
  const deckIds = ["deck-a", "deck-b"];
  const records = EVALUATOR_AUDIT_PHASE_BANDS.flatMap((phase) =>
    Array.from({ length: 8 }, (_, index) => {
      const deckId = deckIds[index % deckIds.length];
      const actionClass = EVALUATOR_AUDIT_CORE_ACTION_CLASSES[
        index % EVALUATOR_AUDIT_CORE_ACTION_CLASSES.length
      ];
      return {
        workerIndex: index,
        gameIndex: `${phase}-${index}`,
        samplingMode: "uniform-balanced",
        resultIndex: currentEvidenceIndexFixture({
          version: EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION,
          valid: true,
          gameCoverage: { [`${deckId}:p1`]: 1 },
          actionReferenceCoverage: { [`${deckId}:p1`]: 1 },
          leafValueCoverage: { [`${deckId}:p1`]: 1 },
          stratumVersion: EVALUATOR_AUDIT_STRATUM_VERSION,
          actionReferencePhaseCoverage: { [phase]: 1 },
          actionReferenceActionClassCoverage: { [actionClass]: 1 },
          leafValuePhaseCoverage: { [phase]: 1 },
          leafValueDeckPhaseCoverage: { [`${deckId}::${phase}`]: 1 },
          actionReferenceIdentities: [{
            identity: `${phase}:${index}`,
            deckId,
            coverageKey: `${deckId}:p1`,
            phaseBand: phase,
            actionClass
          }],
          leafValuePairCount: 1,
          actionAuditRacing: {},
          logicalGames: 1,
          physicalGames: 1
        })
      };
    })
  );
  const options = {
    deckIds,
    includeCertificationPartitions: false,
    minimumGamesFloor: 0,
    minimumReferenceFloor: 0,
    minimumReferenceGamesFloor: 0,
    minimumCalibrationFloor: 0,
    minimumGames: 0,
    minimumActionReferences: 0,
    minimumLeafValuePairs: 0,
    minimumActionReferenceGames: 0,
    minimumLeafValueReferenceGames: 0,
    minimumRepresentativeCalibrationGames: 0
  };
  const complete = summarizeEvaluatorBootstrap({ records }, options);
  assert.equal(complete.missingActionReferenceDeckPhaseCoverage.length, 0);
  assert.equal(complete.missingLeafValueDeckPhaseCoverage.length, 0);

  const withoutDeckALate = summarizeEvaluatorBootstrap({
    records: records.filter((record) => !(
      String(record.gameIndex).startsWith("late-")
        && record.resultIndex.actionReferenceIdentities[0].deckId === "deck-a"
    ))
  }, options);
  assert.ok(withoutDeckALate.missingActionReferenceDeckPhaseCoverage.includes(
    "deck-a::late"
  ));
  assert.ok(withoutDeckALate.missingLeafValueDeckPhaseCoverage.includes(
    "deck-a::late"
  ));
});

test("evaluator bootstrap deduplicates phase and action-class counts by reference identity", () => {
  const resultIndex = (gameIndex) => currentEvidenceIndexFixture({
    version: EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION,
    valid: true,
    gameCoverage: { "deck:p1": 1 },
    actionReferenceCoverage: { "deck:p1": 1 },
    leafValueCoverage: {},
    stratumVersion: EVALUATOR_AUDIT_STRATUM_VERSION,
    actionReferencePhaseCoverage: { late: 1 },
    actionReferenceActionClassCoverage: { "movement-combat": 1 },
    actionReferenceDeckPhaseCoverage: { "deck::late": 1 },
    leafValuePhaseCoverage: {},
    leafValueDeckPhaseCoverage: {},
    structuredV2ActionReferenceCoverage: {},
    structuredV2ActionReferencePhaseCoverage: {},
    structuredV2ActionReferenceActionClassCoverage: {},
    structuredV2ActionReferenceDeckPhaseCoverage: {},
    structuredV2LeafValueCoverage: {},
    structuredV2LeafValuePhaseCoverage: {},
    structuredV2LeafValueDeckPhaseCoverage: {},
    structuredV2ActionReferenceIdentities: [],
    actionEvidenceGradeCounts: {},
    actionEvidenceIndependentOpeningStates: {},
    actionEvidenceIndependentOpeningStateCount: 0,
    naturalDistributionActionAudit: {},
    leafActionEffectAudit: { comparisons: 0, phaseBands: {} },
    actionEvidenceComputeEfficiency: {},
    actionReferenceIdentities: [{
      identity: "same-reference",
      deckId: "deck",
      coverageKey: "deck:p1",
      phaseBand: "late",
      actionClass: "movement-combat"
    }],
    leafValuePairCount: 0,
    actionAuditRacing: {},
    logicalGames: 1,
    physicalGames: 1,
    gameIndex
  });
  const audit = summarizeEvaluatorBootstrap({
    records: [0, 1].map((gameIndex) => ({
      workerIndex: 0,
      gameIndex,
      samplingMode: "action-ranking-audit",
      resultIndex: resultIndex(gameIndex)
    }))
  }, {
    deckIds: [],
    includeCertificationPartitions: false,
    minimumGamesFloor: 0,
    minimumReferenceFloor: 0,
    minimumReferenceGamesFloor: 0,
    minimumCalibrationFloor: 0
  });
  assert.equal(audit.actionReferenceCount, 1);
  assert.equal(audit.actionReferencePhaseCoverage.late, 1);
  assert.equal(audit.actionReferencePhaseGameCount.late, 1);
  assert.equal(audit.actionReferenceActionClassCoverage["movement-combat"], 1);
  assert.equal(
    audit.actionReferenceActionClassGameCount["movement-combat"],
    1
  );
});

test("evaluator bootstrap normalizes p2 and requires reference coverage per deck seat", () => {
  const deckId = "deck";
  const referenceFor = (suffix) => {
    const reference = independentTerminalActionAuditReference(suffix);
    const structured = syntheticStructuredEvidence(
      reference.informationSetHash
    );
    for (const pair of reference.evaluatorStatePairs) {
      pair.recommendedStructuredState = structuredClone(structured);
      pair.selectedStructuredState = structuredClone(structured);
    }
    return reference;
  };
  const records = Array.from({ length: 450 }, (_, gameIndex) => ({
    workerIndex: gameIndex % 4,
    gameIndex,
    samplingMode: gameIndex % 2 === 0
      ? "uniform-balanced"
      : "uncertainty-high-regret",
    result: {
      trajectories: [0, 1].map((playerSeat) => ({
        gameId: `game-${gameIndex}`,
        deckId,
        playerSeat,
        steps: gameIndex < 225 ? [{
          informationSetHash: `information-set:${gameIndex}:${playerSeat}`,
          legalActionKeys: ["passShowdown", "endTurn"],
          actionRankingAuditReference:
            referenceFor(`${gameIndex}:${playerSeat}`),
          leafValueAuditReference: createLeafValueReference([(() => {
            const pair = terminalLeafValuePair(
              gameIndex * 2 + playerSeat + 1
            );
            const structured = syntheticStructuredEvidence(
              `information-set:${gameIndex}:${playerSeat}`
            );
            pair.correctStructuredState = structuredClone(structured);
            pair.comparedStructuredState = structuredClone(structured);
            return pair;
          })()], {
            source: "teacher-independent-production-cutoff-audit",
            policyCorrectionIndependent: true
          })
        }] : []
      }))
    }
  }));
  const complete = summarizeEvaluatorBootstrap({ records, invalidRecords: [] }, {
    deckIds: [deckId],
    minimumGames: 100,
    minimumReferences: 50,
    minimumReferenceGames: 20,
    minimumReferencesPerDeckSeat: 1
  });
  assert.ok(complete.gameCoverage[`${deckId}:p2`] > 0);
  assert.ok(complete.referenceCoverage[`${deckId}:p2`] > 0);

  const p1Only = structuredClone(records);
  for (const record of p1Only) {
    record.result.trajectories[1].steps = [];
  }
  const incomplete = summarizeEvaluatorBootstrap({
    records: p1Only,
    invalidRecords: []
  }, {
    deckIds: [deckId],
    minimumGames: 100,
    minimumReferences: 25,
    minimumReferenceGames: 20,
    minimumReferencesPerDeckSeat: 1
  });
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.missingReferenceCoverage, [`${deckId}:p2`]);
});

test("evaluator certification partitions are deterministic and game-disjoint", () => {
  const records = Array.from({ length: 90 }, (_, gameIndex) => ({
    workerIndex: gameIndex % 3,
    gameIndex,
    samplingMode: gameIndex < 5
      ? EVALUATOR_BOOTSTRAP_SAMPLING_MODES.calibration
      : gameIndex < 10
        ? "uniform-balanced"
        : EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action,
    result: {
      trajectories: [{
        gameId: `partition-game-${gameIndex}`,
        deckId: "deck",
        playerSeat: gameIndex % 2,
        steps: [{
          informationSetHash: `information-set:partition:${gameIndex}`,
          legalActionKeys: ["passShowdown", "endTurn"],
          actionRankingAuditReference:
            independentTerminalActionAuditReference(`partition:${gameIndex}`),
          leafValueAuditReference: createLeafValueReference([
            terminalLeafValuePair(gameIndex + 1)
          ], {
            source: "teacher-independent-production-cutoff-audit",
            policyCorrectionIndependent: true
          })
        }]
      }]
    }
  }));
  const first = partitionEvaluatorBootstrapRecords(records, {
    deckIds: ["deck"],
    seed: "partition-test"
  });
  const second = partitionEvaluatorBootstrapRecords(records, {
    deckIds: ["deck"],
    seed: "partition-test"
  });
  const keys = (partition) => partition.map((record) =>
    `${record.workerIndex}:${record.gameIndex}`);
  assert.deepEqual(
    Object.fromEntries(Object.entries(first).map(([role, partition]) => [
      role,
      keys(partition)
    ])),
    Object.fromEntries(Object.entries(second).map(([role, partition]) => [
      role,
      keys(partition)
    ]))
  );
  const allKeys = Object.values(first).flatMap(keys);
  assert.equal(new Set(allKeys).size, records.length);
  assert.equal(allKeys.length, records.length);
  assert.equal(first.calibration.length, 10);
});

test("evaluator bootstrap does not confuse 25 action references with 50 leaf pairs", () => {
  const records = Array.from({ length: 100 }, (_, gameIndex) => {
    const playerSeat = gameIndex % 2;
    const informationSetHash = `information-set:unit-mismatch:${gameIndex}`;
    const reference = gameIndex < 25
      ? independentTerminalActionAuditReference(
        `unit-mismatch:${gameIndex}`
      )
      : null;
    return {
      workerIndex: gameIndex % 4,
      gameIndex,
      samplingMode: "uniform-balanced",
      result: {
        trajectories: [{
          gameId: `mismatch-game-${gameIndex}`,
          deckId: "deck",
          playerSeat,
          steps: reference ? [{
            informationSetHash,
            legalActionKeys: ["passShowdown", "endTurn"],
            actionRankingAuditReference: reference,
            leafValueAuditReference: createLeafValueReference([
              terminalLeafValuePair(gameIndex * 2 + 1),
              terminalLeafValuePair(gameIndex * 2 + 2)
            ], {
              source: "teacher-independent-production-cutoff-audit",
              policyCorrectionIndependent: true
            })
          }] : []
        }]
      }
    };
  });
  const audit = summarizeEvaluatorBootstrap({ records, invalidRecords: [] }, {
    deckIds: ["deck"],
    minimumGames: 100,
    minimumActionReferences: 50,
    minimumLeafValuePairs: 50,
    minimumActionReferenceGames: 20,
    minimumLeafValueReferenceGames: 20,
    minimumActionReferencesPerDeckSeat: 1,
    minimumLeafValuePairsPerDeckSeat: 1
  });
  assert.equal(audit.actionReferenceCount, 25);
  assert.equal(audit.leafValuePairCount, 50);
  assert.equal(audit.complete, false);
});

test("certification game selection preserves referenced deck-seat games before truncation", () => {
  const referenceTrajectory = (gameId, playerSeat, seed) => {
    const informationSetHash = `information-set:${gameId}`;
    return {
      gameId,
      deckId: "deck",
      playerSeat,
      steps: [{
        informationSetHash,
        legalActionKeys: ["passShowdown", "endTurn"],
        actionRankingAuditReference:
          independentTerminalActionAuditReference(gameId),
        leafValueAuditReference: createLeafValueReference([
          terminalLeafValuePair(seed)
        ], {
          source: "teacher-independent-production-cutoff-audit",
          policyCorrectionIndependent: true
        })
      }]
    };
  };
  const grouped = [
    ["game-000", [referenceTrajectory("game-000", 0, 1)]],
    ["game-001", [referenceTrajectory("game-001", 1, 2)]],
    ...Array.from({ length: 5 }, (_, index) => [
      `game-${100 + index}`,
      [{
        gameId: `game-${100 + index}`,
        deckId: "deck",
        playerSeat: index % 2,
        steps: []
      }]
    ])
  ];
  const selected = selectEvaluatorCertificationGames(grouped, {
    maximumGames: 4,
    deckIds: ["deck"]
  });
  assert.equal(selected.some(([gameId]) => gameId === "game-000"), true);
  assert.equal(selected.some(([gameId]) => gameId === "game-001"), true);
  const audit = summarizeEvaluatorCertificationTrajectories(
    selected.flatMap(([, trajectories]) => trajectories),
    {
      deckIds: ["deck"],
      minimumGames: 100,
      minimumActionReferences: 50,
      minimumLeafValuePairs: 50
    }
  );
  assert.ok(audit.actionReferenceCoverage["deck:p1"] > 0);
  assert.ok(audit.actionReferenceCoverage["deck:p2"] > 0);
  assert.ok(audit.leafValueCoverage["deck:p1"] > 0);
  assert.ok(audit.leafValueCoverage["deck:p2"] > 0);
});

test("evaluator bootstrap exhausts an invalid coordinate after its retry limit", () => {
  const completed = completedGameIndexMap([], [
    { workerIndex: 2, gameIndex: 7 },
    { workerIndex: 2, gameIndex: 7 },
    { workerIndex: 2, gameIndex: 7 }
  ], 3);
  assert.equal(completed.get(2).has(7), true);
  const retryable = completedGameIndexMap([], [
    { workerIndex: 2, gameIndex: 7 },
    { workerIndex: 2, gameIndex: 7 }
  ], 3);
  assert.equal(retryable.has(2), false);
});

test("an exhausted evaluator bootstrap expands by one bounded generation chunk", () => {
  const current = {
    status: "exhausted-incomplete",
    allocatedGames: 320,
    expansions: 0
  };
  const expanded = nextEvaluatorBootstrapAllocation(current, 320, {
    extensionGames: 160,
    maximumTotalGames: 640
  });
  assert.equal(expanded.status, "collecting");
  assert.equal(expanded.allocatedGames, 480);
  assert.equal(expanded.expansions, 1);
  assert.equal(nextEvaluatorBootstrapAllocation(expanded, 479, {
    extensionGames: 160,
    maximumTotalGames: 640
  }), expanded);
  const final = nextEvaluatorBootstrapAllocation({
    ...current,
    allocatedGames: 640
  }, 640, {
    extensionGames: 160,
    maximumTotalGames: 640
  });
  assert.equal(final.allocatedGames, 640);
});

test("an evaluator bootstrap can keep extending until its evidence contract is complete", () => {
  const exhausted = {
    status: "exhausted-incomplete",
    allocatedGames: 640,
    expansions: 2
  };
  const expanded = nextEvaluatorBootstrapAllocation(exhausted, 640, {
    extensionGames: 64,
    maximumTotalGames: 640,
    continueUntilComplete: true
  });
  assert.equal(expanded.status, "collecting");
  assert.equal(expanded.allocatedGames, 704);
  assert.equal(expanded.expansions, 3);
});

test("evaluator bootstrap key changes with confirmation and reference contracts", () => {
  const base = {
    engineFingerprint: "sha256:engine",
    learningTargetVersion: 8,
    teacherLabelVersion: 8,
    deckIds: ["deck"],
    continuationLineage: {
      version: 1,
      continuationPolicyHash: "policy-a",
      opponentPoolHash: "opponents-a",
      teacherEvaluatorPoolHash: "evaluators-a",
      deckConfigurationHash: "decks-a"
    },
    collection: {
      seed: 1,
      maxActions: 1200,
      temperature: 0.85,
      mirrorFraction: 0.25,
      bestOfThreeFraction: 0,
      balancedPairings: true,
      teacherEvaluatorMode: "heuristic-only",
      teacherScreenSimulations: 4,
      teacherConfirmationSimulations: 16,
      teacherConfirmationMaxSimulations: 32,
      teacherDepth: 16,
      teacherCandidates: 6
    }
  };
  assert.notEqual(
    evaluatorBootstrapDatasetKey(base),
    evaluatorBootstrapDatasetKey({
      ...base,
      collection: { ...base.collection, teacherConfirmationSimulations: 32 }
    })
  );
  assert.notEqual(
    evaluatorBootstrapDatasetKey(base),
    evaluatorBootstrapDatasetKey({
      ...base,
      continuationLineage: {
        ...base.continuationLineage,
        continuationPolicyHash: "policy-b"
      }
    })
  );
  assert.notEqual(
    evaluatorBootstrapDatasetKey(base),
    evaluatorBootstrapDatasetKey({
      ...base,
      collection: { ...base.collection, temperature: 1 }
    })
  );
  const descriptor = evaluatorBootstrapDatasetDescriptor(base);
  assert.equal(
    descriptor.auditStrata.version,
    EVALUATOR_AUDIT_STRATUM_VERSION
  );
  assert.deepEqual(
    descriptor.auditStrata.phaseBands,
    EVALUATOR_AUDIT_PHASE_BANDS
  );
  assert.deepEqual(descriptor.auditStrata.requirements, {
    actionReferencesPerPhase: 5,
    actionReferenceGamesPerPhase: 5,
    leafValuePairsPerPhase: 12,
    leafValueReferenceGamesPerPhase: 4,
    actionReferencesPerCoreClass: 5,
    actionReferenceGamesPerCoreClass: 5,
    actionReferencesPerDeckPhase: 1,
    actionReferenceGamesPerDeckPhase: 1,
    leafValuePairsPerDeckPhase: 1,
    leafValueReferenceGamesPerDeckPhase: 1,
    requiredDeckPhases: ["mulligan", "early", "mid", "late"]
  });
});

test("every registered card has a collision-free neural vocabulary index", () => {
  const registered = decks.flatMap((deck) => [...deck.main, ...(deck.sideboard || [])]).map((card) => card.cardNumber);
  const indices = registered.map(cardIndex);
  assert.equal(indices.every((index) => index > 0), true);
  const uniqueNumbers = new Set(registered);
  assert.equal(new Set([...uniqueNumbers].map(cardIndex)).size, uniqueNumbers.size);
});

test("sideboard policy exposes learned swaps and preserves the registered pool", () => {
  const deck = structuredClone(decks.find((candidate) => candidate.sideboard?.length));
  const before = [...deck.main, ...deck.sideboard].map((card) => card.cardNumber).sort();
  const actions = enumerateSideboardActions(deck, { sideboardStats: {} });
  const swap = actions.find((action) => action.kind === "sideboardSwap");
  assert.ok(swap);
  assert.equal(applyResolvedSideboardSwap(deck, swap), true);
  assert.deepEqual([...deck.main, ...deck.sideboard].map((card) => card.cardNumber).sort(), before);
});

test("sideboard policy cannot remove the only Champion matching the Legend", () => {
  const deck = structuredClone(decks.find((candidate) => candidate.id === "proving-grounds-annie"));
  const champion = deck.main.find((card) => championMatchesLegend(card, deck.legend));
  const incoming = deck.sideboard.find((card) => !championMatchesLegend(card, deck.legend));
  const unsafe = { kind: "sideboardSwap", outCardNumber: champion.cardNumber, inCardNumber: incoming.cardNumber };
  const before = structuredClone(deck);
  assert.equal(sideboardSwapPreservesStartingChampion(deck, unsafe.outCardNumber, unsafe.inCardNumber), false);
  assert.equal(enumerateSideboardActions(deck).some((action) => action.kind === "sideboardSwap"
    && action.outCardNumber === unsafe.outCardNumber && action.inCardNumber === unsafe.inCardNumber), false);
  assert.equal(applyResolvedSideboardSwap(deck, unsafe), false);
  assert.deepEqual(deck, before);
  assert.equal(enumerateSideboardActions(deck).some((action) => action.kind === "sideboardSwap"), true);
});

test("self-play collection checkpoints reuse matching per-game trajectory chunks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-resume-"));
  const descriptor = createCollectionDescriptor({
    generation: 2,
    modelGeneration: 1,
    engineFingerprint: "sha256:test",
    cardPoolId: "origins-era",
    games: 1,
    workers: 1,
    seed: 123,
    maxActions: 600,
    temperature: 1,
    shapingWeight: 0.35,
    bestOfThreeFraction: 0.25,
    mirrorFraction: 0.25,
    evolveDecks: true,
    trainingDeckIds: ["proving-grounds-annie"]
  });
  const gameResult = {
    trajectories: [{ playerId: "p1", completed: true, steps: Array.from({ length: 260 }, (_, index) => ({ state: new Float32Array([index, index + 1]) })) }],
    summaries: [{ completed: true }],
    deckLearning: { metaStats: { games: 1, cardAppearances: {} } }
  };
  try {
    await saveGenerationResume(directory, descriptor, [decks[0]]);
    await saveCollectedGame(directory, descriptor, { workerIndex: 0, gameIndex: 0, seed: 123, result: gameResult });
    assert.equal((await loadGenerationResume(directory, descriptor)).population.length, 1);
    assert.deepEqual([...(await inspectCollectedGames(directory, descriptor)).get(0)], [0]);
    const restored = await loadPersistedCollection(directory, descriptor);
    assert.equal(restored.trajectories[0].steps.length, 260);
    assert.equal(restored.trajectories[0].steps[0].state instanceof Float32Array, true);
    await saveCompletedCollection(directory, descriptor);
    assert.equal((await loadCompletedCollection(directory, descriptor)).resumedFromArchive, true);
    const stale = { ...descriptor, collectionKey: "stale" };
    assert.equal(await loadGenerationResume(directory, stale), null);
    assert.equal((await inspectCollectedGames(directory, stale)).get(0).size, 0);
    assert.equal(await loadCompletedCollection(directory, stale), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("game-boundary stops load sparse completed self-play coordinates without demanding unfinished games", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-partial-stop-"));
  const descriptor = createCollectionDescriptor({
    generation: 8,
    modelGeneration: 7,
    engineFingerprint: "sha256:partial-stop",
    cardPoolId: "origins-era",
    games: 8,
    workers: 2,
    seed: 456,
    maxActions: 600,
    temperature: 1,
    shapingWeight: 0,
    bestOfThreeFraction: 0,
    mirrorFraction: 0,
    evolveDecks: false,
    trainingDeckIds: ["proving-grounds-annie"]
  });
  const result = (id) => ({
    trajectories: [{ gameId: id, completed: true, steps: [] }],
    summaries: [{ gameId: id, completed: true }],
    deckLearning: { metaStats: { games: 1, cardAppearances: {} } }
  });
  try {
    await saveCollectedGame(directory, descriptor, {
      workerIndex: 0,
      gameIndex: 0,
      seed: 456,
      result: result("0:0")
    });
    await saveCollectedGame(directory, descriptor, {
      workerIndex: 1,
      gameIndex: 2,
      seed: 789,
      result: result("1:2")
    });
    await assert.rejects(
      loadPersistedCollection(directory, descriptor),
      /Missing persisted self-play game/
    );
    const partial = await loadAvailablePersistedCollection(
      directory,
      descriptor
    );
    assert.deepEqual(
      partial.summaries.map((summary) => summary.gameId).sort(),
      ["0:0", "1:2"]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit compatible migration reuses dimension-safe collection games after a diagnostic engine fix", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-compatible-resume-"));
  const options = {
    generation: 7,
    modelGeneration: 6,
    cardPoolId: "origins-era",
    games: 1,
    workers: 1,
    seed: 123,
    maxActions: 600,
    temperature: 0.85,
    shapingWeight: 0,
    bestOfThreeFraction: 0.25,
    mirrorFraction: 0.25,
    evolveDecks: false,
    trainingDeckIds: ["origins-kaisa"]
  };
  const source = createCollectionDescriptor({ ...options, engineFingerprint: "sha256:old" });
  const target = createCollectionDescriptor({ ...options, engineFingerprint: "sha256:new" });
  const step = {
    state: new Float32Array(STATE_DIM),
    actions: new Float32Array(MAX_ACTIONS * ACTION_DIM),
    selectedIndex: 0,
    legalCount: 1,
    selectedActionKey: "endTurn",
    legalActionKeys: ["endTurn"],
    originalLegalCount: 1
  };
  try {
    await saveGenerationResume(directory, source, [decks[0]]);
    await saveCollectedGame(directory, source, {
      workerIndex: 0,
      gameIndex: 0,
      seed: 123,
      result: {
        trajectories: [{
          gameId: "compatible-game",
          playerId: "p1",
          completed: true,
          engineFingerprint: source.engineFingerprint,
          decisionSafetyVersion: 1,
          decisionSafetyViolations: [],
          steps: [step]
        }],
        summaries: [{ completed: true }],
        deckLearning: {}
      }
    });
    const migration = await migrateCompatibleCollection(directory, target, source.engineFingerprint);
    assert.equal(migration.migratedGames, 1);
    assert.equal(migration.sourceCollectionKey, source.collectionKey);
    assert.equal(migration.targetCollectionKey, target.collectionKey);
    assert.equal((await loadGenerationResume(directory, target)).population.length, 1);
    assert.equal(
      (await loadGenerationResume(directory, target))
        .compatibilityMigration.fromCollectionKey,
      source.collectionKey
    );
    assert.deepEqual([...(await inspectCollectedGames(directory, target)).get(0)], [0]);
    const restored = await loadPersistedCollection(directory, target);
    assert.equal(restored.trajectories[0].engineFingerprint, target.engineFingerprint);
    assert.equal(restored.trajectories[0].replayCompatibility.fromEngineFingerprint, source.engineFingerprint);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("process self-play pool dynamically queues unfinished logical games without changing their coordinates", () => {
  const completed = new Map([
    [0, new Set([0])],
    [1, new Set([1])]
  ]);
  const queue = buildSelfPlayTaskQueue(10, 3, completed);
  assert.deepEqual(queue.assignments, [4, 3, 3]);
  assert.deepEqual(queue.tasks.map(({ workerIndex, gameIndex }) => [workerIndex, gameIndex]), [
    [1, 0], [2, 0],
    [0, 1], [2, 1],
    [0, 2], [1, 2], [2, 2],
    [0, 3]
  ]);
  assert.equal(queue.tasks.some(({ workerIndex, gameIndex }) => workerIndex === 0 && gameIndex === 0), false);
  assert.equal(queue.tasks.some(({ workerIndex, gameIndex }) => workerIndex === 1 && gameIndex === 1), false);
});

test("process self-play pool drains without assigning a new game when a boundary stop is requested", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-boundary-stop-")
  );
  const stopRequestPath = path.join(directory, "stop.request.json");
  await writeFile(
    stopRequestPath,
    `${JSON.stringify({ handoffId: "test-handoff-id" })}\n`,
    "utf8"
  );
  try {
    const collected = await collectProcessPoolSelfPlay({
      games: 1,
      workers: 1,
      processes: 1,
      decks: decks.slice(0, 2),
      model: createNeuralModel(),
      stopRequestPath,
      loadCollectedResults: async () => ({
        trajectories: [],
        summaries: [],
        deckLearning: {}
      })
    });
    assert.equal(collected.workerStats.stoppedAtGameBoundary, true);
    assert.equal(collected.workerStats.stopHandoffId, "test-handoff-id");
    assert.equal(collected.workerStats.collectedGames, 0);
    assert.equal(collected.workerStats.pendingTasks, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("process self-play pool keeps a rolling queue but closes assignments after a persisted result", async () => {
  const collected = await collectProcessPoolSelfPlay({
    games: 3,
    workers: 1,
    processes: 1,
    decks: decks.slice(0, 2),
    model: createNeuralModel(),
    maxActions: 1,
    teacherFraction: 0,
    shouldAssignNext: () => ({
      continue: false,
      reason: "test-evidence-target-satisfied"
    })
  });
  assert.equal(collected.workerStats.collectedGames, 1);
  assert.equal(collected.workerStats.assignmentClosed, true);
  assert.equal(
    collected.workerStats.assignmentClosedReason,
    "test-evidence-target-satisfied"
  );
  assert.equal(collected.workerStats.pendingTasks, 2);
  assert.equal(collected.workerStats.stoppedAtGameBoundary, false);
});

test("process self-play pool partitions TensorFlow threads without overriding an explicit operator setting", () => {
  const automatic = selfPlayProcessEnvironment(4, {});
  assert.equal(Number(automatic.TF_NUM_INTRAOP_THREADS) >= 1, true);
  assert.equal(automatic.TF_NUM_INTEROP_THREADS, "1");
  assert.equal(automatic.OMP_NUM_THREADS, automatic.TF_NUM_INTRAOP_THREADS);
  const explicit = selfPlayProcessEnvironment(4, {
    TF_NUM_INTRAOP_THREADS: "2",
    TF_NUM_INTEROP_THREADS: "3",
    OMP_NUM_THREADS: "4"
  });
  assert.equal(explicit.TF_NUM_INTRAOP_THREADS, "2");
  assert.equal(explicit.TF_NUM_INTEROP_THREADS, "3");
  assert.equal(explicit.OMP_NUM_THREADS, "4");
  assert.deepEqual(
    selfPlayChildExecArgv([
      "--input-type=module",
      "-e",
      "inline source",
      "--trace-warnings",
      "--test-name-pattern",
      "pool",
      "--test-name-pattern=pool"
    ]),
    ["--trace-warnings"]
  );
});

test("evaluation checkpoints persist games and matching evaluations reuse them", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-evaluation-resume-"));
  const descriptor = createEvaluationDescriptor({
    trainingIteration: 3,
    stage: "candidate-vs-champion",
    candidateHash: "candidate",
    opponentHashes: ["champion"],
    engineFingerprint: "sha256:test",
    games: 4,
    seed: 991,
    maxActions: 1,
    trainingDeckIds: decks.slice(0, 2).map((deck) => deck.id)
  });
  try {
    const candidate = createNeuralModel();
    const champion = deserializeNeuralModel(serializeNeuralModel(candidate));
    const initial = evaluateNeuralModels(candidate, champion, decks.slice(0, 2), { games: 4, maxActions: 1, seed: 991 });
    assert.equal(initial.summaries.every((summary) => summary.deckIds[0] === summary.deckIds[1]), true);
    initial.summaries.forEach((summary, index) => saveEvaluationGame(directory, descriptor, index, summary));
    const restored = loadEvaluationGames(directory, descriptor);
    const progress = [];
    const resumed = evaluateNeuralModels(candidate, champion, decks.slice(0, 2), {
      games: 4,
      maxActions: 1,
      seed: 991,
      resumedSummaries: Array.from({ length: 4 }, (_, index) => restored.get(index)),
      onGameComplete: (item) => progress.push(item)
    });
    assert.equal(restored.size, 4);
    assert.deepEqual(resumed.summaries, initial.summaries);
    assert.equal(progress.every((item) => item.resumed === true), true);
    assert.deepEqual(Object.values(resumed.conditionStats).map((item) => item.games), [1, 1, 1, 1]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid evaluation checkpoints are recomputed instead of resumed", () => {
  const candidate = createNeuralModel();
  const champion = deserializeNeuralModel(serializeNeuralModel(candidate));
  const initial = evaluateNeuralModels(candidate, champion, decks.slice(0, 2), { games: 4, maxActions: 1, seed: 1191 });
  const resumedSummaries = initial.summaries.map((summary, index) => index === 0
    ? { ...summary, completed: false, adjudicated: false, counted: false, invalid: true, invalidReason: { kind: "test-cycle" } }
    : summary);
  const progress = [];
  const result = evaluateNeuralModels(candidate, champion, decks.slice(0, 2), {
    games: 4,
    maxActions: 1,
    seed: 1191,
    resumedSummaries,
    onGameComplete: (item) => progress.push(item)
  });
  assert.equal(progress[0].resumed, false);
  assert.equal(result.summaries[0].invalid, false);
  assert.equal(progress.slice(1).every((item) => item.resumed), true);
});

test("greedy evaluation is reproducible with the same model and seed", () => {
  const candidate = createNeuralModel();
  const champion = deserializeNeuralModel(serializeNeuralModel(candidate));
  const options = { games: 4, maxActions: 2, seed: 18181, greedy: true, temperature: 0.05 };
  const first = evaluateNeuralModels(candidate, champion, decks.slice(0, 2), options);
  const second = evaluateNeuralModels(candidate, champion, decks.slice(0, 2), options);
  assert.deepEqual(second.summaries, first.summaries);
});

test("external meta import produces normalized deck and card weights", () => {
  const deck = decks[0];
  const snapshot = normalizeMetaSnapshot({ decks: [{ id: deck.id, legend: deck.legend.cardNumber, games: 100, wins: 55, share: 0.4, main: [...new Map(deck.main.map((card) => [card.cardNumber, deck.main.filter((item) => item.cardNumber === card.cardNumber).length])).entries()] }] });
  assert.equal(snapshot.decks.length, 1);
  assert.equal(snapshot.deckWeights[deck.id], 1);
  assert.equal(Object.keys(snapshot.cardStats).length > 0, true);
});

test("human coaching decisions persist as sparse public training samples", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const action = enumerateLegalActions(game, actorId)[0];
  const sample = encodeHumanDecisionSample(game, actorId, action, { best: { key: JSON.stringify(action), simulations: 16, confidenceInterval: [0.45, 0.6] }, confidence: "medium", regret: 0 });
  const trajectories = hydrateHumanReplayTrajectories([{ id: "human-1", humanPlayerId: actorId, winnerId: actorId, decisions: [{ actorId, trainingSample: sample }] }], { engineFingerprint: "sha256:test" });
  assert.equal(sample.state.length < STATE_DIM, true);
  assert.equal(trajectories.length, 1);
  assert.equal(trajectories[0].steps[0].state.length, STATE_DIM);
  assert.equal(trajectories[0].completed, true);
  assert.equal(trajectories[0].engineFingerprint, "sha256:test");
  assert.equal(trajectories[0].steps[0].oldLogProbability, 0);
});

test("released card pools are cumulative and Origins excludes later packs", () => {
  const counts = CARD_POOL_FORMATS.map((pool) => cardNumbersForPool(pool.id).size);
  assert.deepEqual(counts, [384, 605, 824, 990]);
  assert.equal(counts.every((count, index) => index === 0 || count > counts[index - 1]), true);
  const spiritforgedCard = Object.values(cards).find((card) => card.cardNumber.startsWith("SFD-"));
  assert.equal(cardAllowedInPool(spiritforgedCard, "origins-era"), false);
  assert.equal(cardAllowedInPool(spiritforgedCard, "spiritforged-era"), true);
});

test("historical Origins preset preserves official Houston field shares", () => {
  const preset = buildMetaPreset();
  const kaisa = preset.decks.find((deck) => deck.id === "origins-kaisa");
  assert.equal(preset.cardPoolId, "origins-era");
  assert.equal(preset.fieldSize, 1129);
  assert.equal(kaisa.games, ORIGINS_HOUSTON_2025.legendCounts["Kai'Sa, Daughter of the Void"]);
  assert.equal(kaisa.winRate, null);
  assert.equal(preset.unrepresentedLegendCounts["Jinx, Loose Cannon"], 24);
});

test("hierarchical action cap retains every active decision stage", () => {
  const kinds = ["confirmPayment", "chooseEffectOption", "passShowdown", "sideboardDone", "confirmMulligan", "moveUnit", "endTurn"];
  const actions = kinds.flatMap((kind) => Array.from({ length: 70 }, (_, index) => ({ kind, index })));
  const selected = selectHierarchicalActions(actions, 192);
  assert.equal(selected.length, 192);
  assert.deepEqual(new Set(selected.map(actionStage)), new Set(["payment", "choice", "reaction", "match", "mulligan", "movement", "main"]));
});

test("imitation action capping always preserves the full-set teacher choice", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const actions = Array.from({ length: MAX_ACTIONS + 20 }, (_, index) => ({ kind: "endTurn", syntheticIndex: index }));
  const teacherChoice = actions.at(-1);
  const encoded = encodeActionSet(game, actorId, actions, { requiredActions: [teacherChoice] });
  assert.equal(encoded.truncated, true);
  assert.equal(encoded.originalLegalCount, actions.length);
  assert.equal(encoded.actions.includes(teacherChoice), true);
});

test("trajectory shards round-trip typed neural tensors", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-"));
  const filename = path.join(directory, "shard.json.gz");
  try {
    await writeTrajectoryArchive(filename, {
      generation: 4,
      trajectories: [{
        state: new Float32Array([1.25, -0.5]),
        actions: new Uint16Array([2, 9]),
        postmortemCorrectionSteps: [{ state: new Float32Array([0.25, 0.75]) }]
      }]
    });
    const restored = await readTrajectoryArchive(filename);
    assert.equal(restored.trajectories[0].state instanceof Float32Array, true);
    assert.deepEqual([...restored.trajectories[0].state], [1.25, -0.5]);
    assert.deepEqual([...restored.trajectories[0].actions], [2, 9]);
    assert.equal(restored.trajectories[0].postmortemCorrectionSteps[0].state instanceof Float32Array, true);
    assert.deepEqual([...restored.trajectories[0].postmortemCorrectionSteps[0].state], [0.25, 0.75]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("trajectory archives stream top-level trajectory collections without stringifying the whole payload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-stream-"));
  const filename = path.join(directory, "holdout.json.gz");
  const payload = {
    version: 1,
    role: "calibration-fit",
    trajectories: Array.from({ length: 24 }, (_, index) => ({
      gameId: `game-${index}`,
      state: new Float32Array([index, index + 0.5]),
      actions: new Uint16Array([index, index + 1])
    }))
  };
  const originalStringify = JSON.stringify;
  try {
    JSON.stringify = function stringifyWithoutWholeArchive(value, ...args) {
      if (value === payload) throw new RangeError("Invalid string length");
      return originalStringify.call(JSON, value, ...args);
    };
    await writeTrajectoryArchive(filename, payload);
  } finally {
    JSON.stringify = originalStringify;
  }
  try {
    const restored = await readTrajectoryArchive(filename);
    assert.equal(restored.trajectories.length, payload.trajectories.length);
    assert.deepEqual([...restored.trajectories[23].state], [23, 23.5]);
    assert.deepEqual([...restored.trajectories[23].actions], [23, 24]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("self-play process results use an archive handoff instead of cloning trajectories over IPC", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-handoff-"));
  const result = {
    trajectories: [{
      gameId: "worker-2-game-42",
      state: new Float32Array([0.25, 0.75]),
      actions: new Uint16Array([4, 9])
    }],
    summaries: [{ winner: "p1" }],
    performance: { actionCount: 12 }
  };
  try {
    const handoff = await createSelfPlayResultHandoff(result, directory, {
      summary: { version: 1, kind: "test-summary" }
    });
    assert.deepEqual(
      Object.keys(handoff).sort(),
      ["resultArchivePath", "resultSummaryPath"]
    );
    assert.equal("result" in handoff, false);
    assert.deepEqual(
      await readSelfPlayResultHandoffSummary(handoff),
      { version: 1, kind: "test-summary" }
    );
    const restored = await consumeSelfPlayResultHandoff(handoff);
    assert.deepEqual([...restored.trajectories[0].state], [0.25, 0.75]);
    assert.deepEqual([...restored.trajectories[0].actions], [4, 9]);
    assert.deepEqual(restored.summaries, result.summaries);
    assert.deepEqual(restored.performance, result.performance);
    await assert.rejects(
      readTrajectoryArchive(handoff.resultArchivePath),
      /ENOENT/
    );
    await assert.rejects(
      readFile(handoff.resultSummaryPath, "utf8"),
      /ENOENT/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("detached action-audit workers share model options by archive instead of cloning them over IPC", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-audit-options-"));
  const options = {
    model: {
      version: 1,
      policyKernel: new Float32Array([0.25, 0.5, 0.75])
    },
    league: [],
    teacherEvaluatorModels: [],
    teacherEvaluatorMode: "heuristic-only",
    engineFingerprint: "sha256:focused-regression"
  };
  try {
    const handoff = await createActionAuditOptionsHandoff(options, directory);
    assert.deepEqual(Object.keys(handoff), ["optionsArchivePath"]);
    assert.equal("options" in handoff, false);
    const first = await readActionAuditOptionsHandoff(handoff);
    const second = await readActionAuditOptionsHandoff(handoff);
    assert.deepEqual([...first.model.policyKernel], [0.25, 0.5, 0.75]);
    assert.deepEqual([...second.model.policyKernel], [0.25, 0.5, 0.75]);
    assert.equal(first.engineFingerprint, options.engineFingerprint);
    await discardActionAuditOptionsHandoff(handoff);
    await assert.rejects(
      readActionAuditOptionsHandoff(handoff),
      /ENOENT/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("detached action audits parallelize one paired seed per task without discarding legacy batches", () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(
    actionAuditSeedTaskChunks(seeds),
    seeds.map((seed) => [seed])
  );
  assert.deepEqual(
    actionAuditSeedTaskChunks(seeds, { preferredChunkSize: 4 }),
    [[1, 2, 3, 4], [5, 6, 7, 8]]
  );
  assert.deepEqual(
    actionAuditSeedTaskChunks(seeds, {
      legacyChunkAvailable(chunk) {
        return chunk[0] === 1;
      }
    }),
    [[1, 2, 3, 4], [5], [6], [7], [8]]
  );
  assert.equal(
    detachedActionAuditProcessCount([{ entries: [{}] }], 16),
    16
  );
  assert.equal(
    detachedActionAuditProcessCount([{ entries: [{}] }], 12),
    12
  );
  assert.equal(detachedActionAuditProcessCount([], 16), 1);
  assert.equal(actionAuditAdaptiveSeedChunkSize(240, 15), 4);
  assert.equal(actionAuditAdaptiveSeedChunkSize(80, 15), 2);
  assert.equal(actionAuditAdaptiveSeedChunkSize(16, 15), 1);
  assert.notEqual(
    seedBatchTaskId("candidate", "selection", [1], ["a::opponent"]),
    seedBatchTaskId("candidate", "selection", [1], ["b::opponent"])
  );
  assert.equal(actionAuditPoolShouldScaleUp({
    currentProcesses: 9,
    maximumProcesses: 16,
    queuedTasks: 12,
    idleProcesses: 0,
    freeMemoryBytes: 12 * 1024 ** 3,
    minimumFreeMemoryBytes: 4 * 1024 ** 3,
    workerHeadroomBytes: 768 * 1024 ** 2
  }), true);
  assert.equal(actionAuditPoolShouldScaleUp({
    currentProcesses: 9,
    maximumProcesses: 16,
    queuedTasks: 12,
    idleProcesses: 0,
    freeMemoryBytes: 4.5 * 1024 ** 3,
    minimumFreeMemoryBytes: 4 * 1024 ** 3,
    workerHeadroomBytes: 768 * 1024 ** 2
  }), false);
  assert.equal(actionAuditPoolShouldScaleUp({
    currentProcesses: 16,
    maximumProcesses: 16,
    queuedTasks: 12,
    idleProcesses: 0,
    freeMemoryBytes: 12 * 1024 ** 3,
    minimumFreeMemoryBytes: 4 * 1024 ** 3
  }), false);
  const retiringSlotIndexes = new Set([3]);
  assert.equal(actionAuditSlotRetirementRequested(
    { index: 3, retireRequested: false },
    retiringSlotIndexes
  ), true);
  assert.equal(actionAuditSlotRetirementRequested(
    { index: 2, retireRequested: false },
    retiringSlotIndexes
  ), false);
  assert.equal(actionAuditSlotRetirementRequested(
    { index: 2, retireRequested: true },
    retiringSlotIndexes
  ), true);
  assert.equal(detachedActionAuditFineRoleChunkGames(8), 3);
  assert.equal(detachedActionAuditFineRoleChunkGames(12), 4);
  assert.equal(detachedActionAuditFineRoleChunkGames(16), 5);
  assert.equal(detachedActionAuditFineRoleChunkGames(16, null, {
    remainingEvidenceUnits: 1
  }), 1);
  assert.equal(detachedActionAuditFineRoleChunkGames(16, null, {
    remainingEvidenceUnits: 3
  }), 2);
  assert.equal(detachedActionAuditFineRoleChunkGames(16, null, {
    remainingEvidenceUnits: 6
  }), 3);
  assert.equal(detachedActionAuditFineRoleChunkGames(12, 3), 3);
  assert.deepEqual(
    detachedActionAuditPipelineChunks([1, 2, 3, 4, 5, 6]),
    [[1, 2], [3, 4], [5, 6]]
  );
  assert.deepEqual(
    detachedActionAuditPipelineChunks([1, 2, 3], { microChunkGames: 1 }),
    [[1], [2], [3]]
  );
});

test("detached action audits restore completed two-seed batches across chunk-size changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-audit-resume-"));
  const candidateId = "candidate-two-seed-resume";
  const bank = "selection";
  const seeds = [101, 202];
  const recommendedAction = { kind: "endTurn" };
  const selectedAction = { kind: "passShowdown" };
  const entry = {
    candidateId,
    candidate: {
      descriptor: { recommendedAction, selectedAction }
    },
    selectionSeeds: [...seeds, 303, 404],
    finalSeeds: [],
    rescueFinalSeeds: [],
    selectionResults: [],
    finalResults: [],
    rescueFinalResults: []
  };
  const taskId = seedBatchTaskId(candidateId, bank, seeds);
  const samples = (terminalOutcome) => seeds.map((simulationSeed) => ({
    simulationSeed,
    value: terminalOutcome,
    terminal: true,
    terminalOutcome,
    postActionAuditState: null,
    productionLeafAudit: null
  }));
  try {
    await writeTrajectoryArchive(
      path.join(directory, `${taskId}.seed-batch.json.gz`),
      {
        version: 1,
        contract: "independent-action-audit-seed-batch-v1",
        taskId,
        candidateId,
        bank,
        seeds,
        results: [
          {
            version: 1,
            action: recommendedAction,
            simulationSeeds: seeds,
            samples: samples(1)
          },
          {
            version: 1,
            action: selectedAction,
            simulationSeeds: seeds,
            samples: samples(0)
          }
        ]
      }
    );
    assert.equal(
      await restoreExistingActionAuditSeedBatches(directory, [entry]),
      1
    );
    assert.equal(entry.selectionResults.length, 2);
    assert.deepEqual(
      entry.selectionResults.map((result) => result.simulationSeeds),
      [seeds, seeds]
    );
    assert.equal(entry.selectionEvidence.terminalEvidence.validPairs, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("detached action-audit workers prefer cached candidates and steal other work", () => {
  const pending = [
    { taskId: "b-1", candidateId: "b" },
    { taskId: "a-2", candidateId: "a" },
    { taskId: "c-1", candidateId: "c" }
  ];
  assert.equal(takePreferredActionAuditTask(pending, "a").taskId, "a-2");
  assert.equal(takePreferredActionAuditTask(pending, "a").taskId, "b-1");
  assert.equal(takePreferredActionAuditTask(pending, "c").taskId, "c-1");
  assert.equal(takePreferredActionAuditTask(pending, "c"), null);
});

test("detached action-audit pool overlaps independent pipeline requests", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-audit-pipeline-"));
  const game = createMulliganTestGame();
  const player = game.players[0];
  const actions = enumerateMulliganPlans(game, player.id).slice(0, 2);
  const engineFingerprint = "sha256:pipeline-regression";
  let pool = null;
  try {
    const tasks = [];
    for (const [index, seed] of [101, 202, 303, 404].entries()) {
      const candidateId = `pipeline-candidate-${index}`;
      const candidatePath = path.join(directory, `${candidateId}.json.gz`);
      await writeTrajectoryArchive(candidatePath, {
        version: 1,
        contract: "detached-action-audit-candidate-v1",
        candidate: {
          game,
          actorId: player.id,
          engineFingerprint,
          descriptor: {
            auditKey: `audit-key-${index}`,
            informationSetHash: `information-set-${index}`,
            recommendedAction: actions[0],
            selectedAction: actions[1],
            search: { depth: 1, minimumTurnTransitions: 0 }
          }
        },
        modelSeatSources: []
      });
      tasks.push({
        taskId: `pipeline-task-${index}`,
        candidateId,
        candidatePath,
        sourceArchivePath: candidatePath,
        bank: "selection",
        seeds: [seed],
        maximumSteps: 192,
        outputPath: path.join(directory, `pipeline-result-${index}.json.gz`)
      });
    }
    let freeMemoryBytes = 8 * 1024 ** 3;
    pool = await createAuditPool({
      processes: 2,
      initialProcesses: 1,
      dynamicScaleHealthySamples: 1,
      dynamicScaleIntervalMs: 1_000,
      dynamicWorkerHeadroomBytes: 256 * 1024 ** 2,
      minimumFreeMemoryBytes: 1,
      freeMemoryProvider: () => freeMemoryBytes,
      teacherEvaluatorMode: "heuristic-only",
      engineFingerprint
    });
    const [first, second] = await Promise.all([
      pool.run([tasks[0]], { stage: "pipeline-a", pairedSeeds: 1 }),
      pool.run([tasks[1]], { stage: "pipeline-b", pairedSeeds: 1 })
    ]);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(
      (await readTrajectoryArchive(first[0].outputPath)).taskId,
      tasks[0].taskId
    );
    assert.equal(
      (await readTrajectoryArchive(second[0].outputPath)).taskId,
      tasks[1].taskId
    );
    assert.equal(pool.processCount, 2);
    freeMemoryBytes = 0;
    const thirdPromise = pool.run(
      [tasks[2]],
      { stage: "pipeline-c", pairedSeeds: 1 }
    );
    const fourthPromise = pool.run(
      [tasks[3]],
      { stage: "pipeline-d", pairedSeeds: 1 }
    );
    try {
      const deadline = Date.now() + 4_000;
      while (pool.processCount !== 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(pool.desiredProcessCount, 1);
      assert.equal(pool.processCount, 1);
      freeMemoryBytes = 8 * 1024 ** 3;
      const [third, fourth] = await Promise.all([
        thirdPromise,
        fourthPromise
      ]);
      assert.equal(third.length, 1);
      assert.equal(fourth.length, 1);
    } finally {
      freeMemoryBytes = 8 * 1024 ** 3;
    }
  } finally {
    await pool?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluator early checkpoints require v2 counts and balanced training strata", () => {
  const checkpoint = EVALUATOR_EARLY_DIAGNOSTIC_CHECKPOINTS[0];
  const partition = {
    acceptedGames: 75,
    actionReferenceCount: 100,
    actionReferenceGameCount: 70,
    leafValuePairCount: 300,
    leafValueReferenceGameCount: 50,
    structuredV2ActionReferenceCount: 100,
    structuredV2ActionReferenceGameCount: 70,
    structuredV2LeafValuePairCount: 300,
    structuredV2LeafValueReferenceGameCount: 50,
    actionReferencePhaseCoverage: { mulligan: 10, early: 15, mid: 35, late: 20 },
    actionReferencePhaseGameCount: { mulligan: 6, early: 10, mid: 25, late: 14 },
    structuredV2ActionReferencePhaseCoverage: {
      mulligan: 10,
      early: 15,
      mid: 35,
      late: 20
    },
    structuredV2ActionReferencePhaseGameCount: {
      mulligan: 6,
      early: 10,
      mid: 25,
      late: 14
    },
    leafValuePhaseCoverage: { mulligan: 10, early: 20, mid: 45, late: 20 },
    leafValuePhaseReferenceGameCount: { mulligan: 5, early: 8, mid: 15, late: 8 },
    structuredV2LeafValuePhaseCoverage: {
      mulligan: 10,
      early: 20,
      mid: 45,
      late: 20
    },
    structuredV2LeafValuePhaseReferenceGameCount: {
      mulligan: 5,
      early: 8,
      mid: 15,
      late: 8
    },
    actionReferenceActionClassCoverage: Object.fromEntries(
      EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map((key) => [key, 8])
    ),
    actionReferenceActionClassGameCount: Object.fromEntries(
      EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map((key) => [key, 6])
    ),
    structuredV2ActionReferenceActionClassCoverage: Object.fromEntries(
      EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map((key) => [key, 8])
    ),
    structuredV2ActionReferenceActionClassGameCount: Object.fromEntries(
      EVALUATOR_BOOTSTRAP_CORE_ACTION_CLASSES.map((key) => [key, 6])
    )
  };
  const audit = { certificationPartitions: { training: partition } };
  assert.equal(evaluatorBootstrapEvidenceCheckpointComplete(audit, {
    role: "training",
    requirement: checkpoint.requirement
  }), true);
  partition.structuredV2ActionReferenceCount = 49;
  assert.equal(evaluatorBootstrapEvidenceCheckpointComplete(audit, {
    role: "training",
    requirement: checkpoint.requirement
  }), false);
  partition.structuredV2ActionReferenceCount = 100;
  partition.structuredV2ActionReferencePhaseCoverage.late = 0;
  assert.equal(evaluatorBootstrapEvidenceCheckpointComplete(audit, {
    role: "training",
    requirement: checkpoint.requirement
  }), false);
});

test("evaluator bootstrap checkpoint also drives live role demand", () => {
  const runtime = evaluatorBootstrapRuntimeAuditOptions({
    evidencePartitionRequirements: {
      training: {
        minimumGames: 100,
        minimumLeafValuePairs: 400,
        minimumLeafValueReferenceGames: 100,
        minimumStructuredV2LeafValuePairs: 400,
        minimumStructuredV2LeafValueReferenceGames: 100,
        minimumLeafValuePairsByPhase: { mulligan: 100, early: 100 },
        minimumLeafValueReferenceGamesByPhase: { mulligan: 30, early: 30 }
      }
    },
    stopWhenEvidenceCheckpoint: {
      role: "training",
      requirement: {
        minimumGames: 240,
        minimumLeafValuePairs: 1800,
        minimumLeafValueReferenceGames: 240,
        minimumStructuredV2LeafValuePairs: 1800,
        minimumStructuredV2LeafValueReferenceGames: 240,
        minimumLeafValuePairsByPhase: { mulligan: 1000, early: 1000 },
        minimumLeafValueReferenceGamesByPhase: { mulligan: 320, early: 320 }
      }
    }
  });
  const requirement = evaluatorBootstrapEvidenceRequirement(
    "training",
    runtime
  );
  assert.equal(requirement.minimumLeafValuePairs, 1800);
  assert.equal(requirement.minimumLeafValueReferenceGames, 240);
  assert.deepEqual(requirement.minimumLeafValuePairsByPhase, {
    mulligan: 1000,
    early: 1000
  });
  assert.deepEqual(requirement.minimumLeafValueReferenceGamesByPhase, {
    mulligan: 320,
    early: 320
  });
  const partition = {
    role: "training",
    acceptedGames: 240,
    leafValuePairCount: 900,
    leafValueReferenceGameCount: 200,
    structuredV2LeafValuePairCount: 900,
    structuredV2LeafValueReferenceGameCount: 200,
    missingLeafValueCoverage: [],
    missingLeafValuePhaseCoverage: ["mulligan", "early"],
    missingLeafValueDeckPhaseCoverage: [],
    missingStructuredV2LeafValueCoverage: [],
    missingStructuredV2LeafValuePhaseCoverage: ["mulligan", "early"],
    missingStructuredV2LeafValueDeckPhaseCoverage: [],
    samplingModes: { "leaf-value-audit": 200 }
  };
  assert.equal(
    evaluatorBootstrapLeafCertificationRole({
      certificationPartitions: { training: partition }
    }, runtime),
    "training"
  );
  assert.ok(evaluatorBootstrapLeafCertificationRolePlan({
    certificationPartitions: { training: partition }
  }, 8, runtime).roles.length > 0);
});

test("structured-v2 gaps keep deck seat and phase atomic in action collection", () => {
  const partition = {
    role: "training",
    acceptedGames: 500,
    actionReferenceCount: 500,
    actionReferenceGameCount: 350,
    structuredV2ActionReferenceCount: 500,
    structuredV2ActionReferenceGameCount: 350,
    missingActionReferenceCoverage: [],
    missingActionReferencePhaseCoverage: [],
    missingActionReferenceActionClassCoverage: [],
    missingActionReferenceDeckPhaseCoverage: [],
    missingStructuredV2ActionReferenceCoverage: ["origins-leona:p2"],
    missingStructuredV2ActionReferencePhaseCoverage: ["late"],
    missingStructuredV2ActionReferenceActionClassCoverage: [],
    missingStructuredV2ActionReferenceDeckPhaseCoverage: [
      "origins-leona::late"
    ],
    actionAuditRacing: {},
    samplingModes: { "action-ranking-audit": 500 }
  };
  const plan = evaluatorBootstrapActionCertificationRolePlan({
    certificationPartitions: { training: partition }
  }, 4, {
    activeEvidenceRoles: ["training"],
    evidencePartitionRequirements: EVALUATOR_BOOTSTRAP_EVIDENCE_REQUIREMENTS,
    fillActionPlanCapacity: true
  });
  assert.equal(plan.primaryRole, "training");
  assert.deepEqual(plan.focuses[0], {
    deckPhaseKey: "origins-leona::late",
    deckId: "origins-leona",
    deckSeat: "origins-leona:p2",
    phaseBand: "late"
  });
});

test("evaluator early diagnostics keep a fixed anchor and stop only repeated strong failures", () => {
  const records = Array.from({ length: 30 }, (_, index) => ({
    datasetKey: "diagnostic",
    workerIndex: index % 4,
    gameIndex: index,
    samplingMode: index % 2 ? "action-ranking-audit" : "leaf-audit"
  }));
  const split = splitEvaluatorEarlyDiagnosticRecords(records, {
    seed: "fixed",
    validationFraction: 0.2
  });
  const trainingKeys = new Set(split.training.map((item) => item.gameIndex));
  assert.equal(split.validation.some((item) => trainingKeys.has(item.gameIndex)), false);
  assert.equal(split.training.length + split.validation.length, records.length);
  const expanded = splitEvaluatorEarlyDiagnosticRecords([
    ...records,
    ...Array.from({ length: 30 }, (_, index) => ({
      datasetKey: "diagnostic",
      workerIndex: index % 4,
      gameIndex: index + 30,
      samplingMode: index % 2 ? "action-ranking-audit" : "leaf-audit"
    }))
  ], {
    seed: "fixed",
    validationFraction: 0.2,
    previousSplit: split
  });
  assert.deepEqual(
    expanded.anchorValidationRecordKeys,
    split.anchorValidationRecordKeys
  );
  assert.equal(split.trainingRecordKeys.every((key) =>
    expanded.trainingRecordKeys.includes(key)), true);
  assert.deepEqual(
    evaluatorEarlyDiagnosticTrainingRequirement(
      EVALUATOR_EARLY_DIAGNOSTIC_CHECKPOINTS[0].requirement
    ),
    {
      minimumActionReferences: 22,
      minimumLeafValuePairs: 81,
      minimumStructuredV2ActionReferences: 22,
      minimumStructuredV2LeafValuePairs: 81
    }
  );
  const lowCandidate = {
    architecture: { id: "flat-v1-64" },
    replica: 0,
    evaluatorTraining: { history: [{
      samples: 100,
      batches: 4,
      loss: 0.5,
      rankingLoss: 0.3,
      outcomeLoss: 0.2
    }] },
    trainingActionRanking: { neuralAccuracy: 0.51 },
    trainingLeafValueRanking: { accuracy: 0.5 },
    actionRanking: {
      neuralAccuracy: 0.42,
      neuralAccuracyUpperBound: 0.49,
      neuralAccuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      },
      deckSeatPhases: {
        "origins-leona:p2::mid": {
          decisions: 12,
          contributingGames: 6,
          neuralAccuracy: 0.33,
          neuralAccuracyUpperBound: 0.48,
          neuralAccuracyInterval: {
            method: "deck-seat-stratified-game-hoeffding-v1"
          },
          comparatorAccuracy: 0.58,
          pairedImprovementUpperBound: -0.01
        }
      },
      deckSeatActionClasses: {
        "origins-leona:p2::target-effect-choice": {
          decisions: 12,
          contributingGames: 6,
          neuralAccuracy: 0.33,
          neuralAccuracyUpperBound: 0.48,
          neuralAccuracyInterval: {
            method: "deck-seat-stratified-game-hoeffding-v1"
          },
          comparatorAccuracy: 0.58,
          pairedImprovementUpperBound: -0.01
        }
      }
    },
    leafValueRanking: {
      accuracy: 0.4,
      accuracyUpperBound: 0.48,
      accuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      }
    },
    anchorActionRanking: {
      neuralAccuracy: 0.42,
      neuralAccuracyUpperBound: 0.49,
      neuralAccuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      }
    },
    anchorLeafValueRanking: {
      accuracy: 0.4,
      accuracyUpperBound: 0.48,
      accuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      }
    }
  };
  const firstWarning = evaluatorEarlyDiagnosticStatus([lowCandidate], {
    checkpointId: "first",
    checkpointOrdinal: 0,
    validationEvidenceSufficient: true
  });
  assert.equal(firstWarning.failed, false);
  assert.equal(firstWarning.status, "strong-warning-continue");
  assert.equal(firstWarning.strongFailureObserved, true);
  assert.equal(firstWarning.officialSelectionEligible, false);
  const missingUpper = evaluatorEarlyDiagnosticStatus([{
    ...lowCandidate,
    actionRanking: { neuralAccuracy: 0.49 },
    anchorActionRanking: { neuralAccuracy: 0.49 }
  }], {
    checkpointId: "first",
    checkpointOrdinal: 0,
    validationEvidenceSufficient: true
  });
  assert.equal(missingUpper.failed, false);
  assert.equal(missingUpper.diagnosticInvalid, true);
  assert.equal(missingUpper.status, "inconclusive-continue");
  const repeatedFailure = evaluatorEarlyDiagnosticStatus([
    lowCandidate,
    { ...lowCandidate, replica: 1 }
  ], {
    checkpointId: "second",
    checkpointOrdinal: 1,
    previous: firstWarning,
    validationEvidenceSufficient: true
  });
  assert.equal(repeatedFailure.failed, true);
  assert.deepEqual(
    repeatedFailure.reasons,
    [
      "repeated-action-shadow-validation-failure-with-no-anchor-improvement",
      "repeated-leaf-shadow-validation-failure-with-no-anchor-improvement"
    ]
  );
  const promising = evaluatorEarlyDiagnosticStatus([{
    architecture: { id: "structured-attention-v2-128" },
    replica: 0,
    evaluatorTraining: { history: [{
      samples: 100,
      batches: 4,
      loss: 0.2,
      rankingLoss: 0.1,
      outcomeLoss: 0.1
    }] },
    trainingActionRanking: { neuralAccuracy: 0.68 },
    trainingLeafValueRanking: { accuracy: 0.66 },
    actionRanking: {
      neuralAccuracy: 0.61,
      neuralAccuracyUpperBound: 0.7,
      neuralAccuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      }
    },
    leafValueRanking: {
      accuracy: 0.6,
      accuracyUpperBound: 0.69,
      accuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      }
    },
    anchorActionRanking: {
      neuralAccuracy: 0.61,
      neuralAccuracyUpperBound: 0.7,
      neuralAccuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      }
    },
    anchorLeafValueRanking: {
      accuracy: 0.6,
      accuracyUpperBound: 0.69,
      accuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      }
    }
  }], {
    checkpointId: "first",
    checkpointOrdinal: 0,
    validationEvidenceSufficient: true
  });
  assert.equal(promising.failed, false);
  assert.equal(promising.status, "promising");
});

test("evaluator early shadow development warns first and only stops repeated fixed-anchor overfit", () => {
  const candidate = (replica, anchorAccuracy = 0.42) => ({
    architecture: { id: "structured-attention-v2-128" },
    replica,
    evaluatorTraining: { history: [{
      samples: 200,
      batches: 8,
      loss: 0.2,
      rankingLoss: 0.1,
      outcomeLoss: 0.1
    }] },
    trainingActionRanking: { neuralAccuracy: 0.72 },
    trainingLeafValueRanking: { accuracy: 0.7 },
    actionRanking: {
      neuralAccuracy: 0.44,
      neuralAccuracyUpperBound: 0.49,
      neuralAccuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      },
      phaseBands: {
        mid: {
          decisions: 20,
          contributingGames: 10,
          neuralAccuracy: 0.35,
          neuralAccuracyUpperBound: 0.48,
          neuralAccuracyInterval: {
            method: "deck-seat-stratified-game-hoeffding-v1"
          },
          comparatorAccuracy: 0.6,
          pairedImprovementUpperBound: -0.02
        },
        late: {
          decisions: 1,
          contributingGames: 1,
          neuralAccuracy: 0,
          neuralAccuracyUpperBound: 0
        }
      },
      deckSeatPhases: {
        "origins-leona:p2::mid": {
          decisions: 12,
          contributingGames: 6,
          neuralAccuracy: 0.33,
          neuralAccuracyUpperBound: 0.48,
          neuralAccuracyInterval: {
            method: "deck-seat-stratified-game-hoeffding-v1"
          },
          comparatorAccuracy: 0.58,
          pairedImprovementUpperBound: -0.01
        }
      },
      deckSeatActionClasses: {
        "origins-leona:p2::target-effect-choice": {
          decisions: 12,
          contributingGames: 6,
          neuralAccuracy: 0.33,
          neuralAccuracyUpperBound: 0.48,
          neuralAccuracyInterval: {
            method: "deck-seat-stratified-game-hoeffding-v1"
          },
          comparatorAccuracy: 0.58,
          pairedImprovementUpperBound: -0.01
        }
      }
    },
    leafValueRanking: {
      accuracy: 0.43,
      accuracyUpperBound: 0.49,
      accuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      },
      phaseBands: {
        mid: {
          decisions: 20,
          contributingGames: 8,
          accuracy: 0.4,
          accuracyUpperBound: 0.48,
          accuracyInterval: {
            method: "deck-seat-stratified-game-hoeffding-v1"
          },
          pairedAdvantageUpperBound: -0.01
        }
      }
    },
    anchorActionRanking: {
      neuralAccuracy: anchorAccuracy,
      neuralAccuracyUpperBound: 0.49,
      neuralAccuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      }
    },
    anchorLeafValueRanking: {
      accuracy: anchorAccuracy,
      accuracyUpperBound: 0.48,
      accuracyInterval: {
        method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
      }
    },
    calibration: {
      brier: 0.34,
      expectedCalibrationError: 0.28,
      rankingAuc: 0.47,
      logLoss: 0.81,
      calibrationSlope: 0.35,
      testGames: 30
    },
    generalizationGap: 0.28
  });
  const first = evaluatorEarlyDiagnosticStatus([candidate(0)], {
    checkpointId: "first",
    checkpointOrdinal: 0,
    validationEvidenceSufficient: true
  });
  assert.equal(first.failed, false);
  assert.equal(first.strongFailureObserved, false);
  assert.equal(first.shadowDevelopment.strongOverfitObserved, true);
  assert.equal(first.shadowDevelopment.candidateRiskCount, 1);
  assert.equal(first.warnings.includes(
    "shadow-development-generalization-gap"
  ), true);
  assert.equal(first.warnings.includes(
    "shadow-development-calibration-risk"
  ), true);
  assert.equal(first.warnings.includes(
    "shadow-development-stratum-risk"
  ), true);
  assert.deepEqual(
    first.candidates[0].shadowDevelopment.actionStrata.insufficient,
    ["phase:late"]
  );
  assert.equal(
    first.candidates[0].shadowDevelopment.actionStrata.risks
      .some((item) => item.key === "late"),
    false
  );
  const actionFocus = evaluatorBootstrapDiagnosticFocus(
    first.shadowDevelopment.diagnosticDemand,
    "training",
    EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
  );
  assert.equal(actionFocus.phaseBands.includes("mid"), true);
  assert.equal(
    actionFocus.actionClasses.includes("target-effect-choice"),
    true
  );
  assert.equal(actionFocus.deckSeats.includes("origins-leona:p2"), true);
  const atomicFocus = evaluatorBootstrapDiagnosticFocus({
    version: 1,
    role: "training",
    priority: "warning-only",
    officialEvidenceRuleChanged: false,
    items: [{
      evidenceKind: "action",
      reason: "observed-performance-risk",
      deckSeat: "origins-leona:p2",
      phaseBand: "mid",
      actionClass: "target-effect-choice"
    }]
  }, "training", EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action);
  assert.deepEqual(evaluatorBootstrapDiagnosticTaskFocus(atomicFocus, 0), {
    evidenceKind: "action",
    reason: "observed-performance-risk",
    deckSeat: "origins-leona:p2",
    phaseBand: "mid",
    actionClass: "target-effect-choice",
    auditDistribution: null,
    missingMetric: null,
    requiredAdditionalGames: 0
  });
  assert.equal(evaluatorBootstrapDiagnosticTaskFocus(atomicFocus, 3), null);
  assert.deepEqual(
    evaluatorBootstrapDiagnosticFocus(
      first.shadowDevelopment.diagnosticDemand,
      "development",
      EVALUATOR_BOOTSTRAP_SAMPLING_MODES.action
    ),
    { items: [], phaseBands: [], actionClasses: [], deckSeats: [] }
  );

  const second = evaluatorEarlyDiagnosticStatus([
    candidate(0),
    candidate(1, 0.31)
  ], {
    checkpointId: "second",
    checkpointOrdinal: 1,
    previous: first,
    validationEvidenceSufficient: true
  });
  assert.equal(second.failed, true);
  assert.equal(second.repeatedModelFailure, false);
  assert.equal(second.repeatedShadowOverfit, true);
  assert.deepEqual(second.reasons, [
    "repeated-action-fixed-anchor-overfit-across-replicas",
    "repeated-leaf-fixed-anchor-overfit-across-replicas"
  ]);
  assert.equal(second.warnings.includes(
    "shadow-development-replica-instability"
  ), true);
});

test("evaluator early validation evidence requires balanced structured-v2 strata", () => {
  const records = [{
    resultIndex: {
      structuredV2ActionReferenceCount: 1,
      structuredV2LeafValuePairCount: 2,
      structuredV2ActionReferenceIdentities: ["action-1"],
      actionReferenceIdentities: [{
        identity: "action-1",
        phaseBand: "late",
        actionClass: "movement-combat",
        coverageKey: "deck-a:p1"
      }],
      leafValuePhaseCoverage: { mulligan: 5, early: 5, mid: 5, late: 2 },
      leafValueCoverage: { "deck-a:p1": 8, "deck-a:p2": 9 },
      structuredV2LeafValuePhaseCoverage: { late: 2 },
      structuredV2LeafValueCoverage: { "deck-a:p1": 2 }
    }
  }];
  const summary = summarizeEvaluatorEarlyDiagnosticEvidence(records, {
    deckIds: ["deck-a"]
  });
  assert.equal(summary.sufficient, false);
  assert.deepEqual(summary.missing.actionPhases, ["mulligan", "early", "mid"]);
  assert.deepEqual(summary.missing.actionDeckSeats, ["deck-a:p2"]);
  assert.deepEqual(summary.missing.leafDeckSeats, ["deck-a:p2"]);

  const legacyOnly = summarizeEvaluatorEarlyDiagnosticEvidence([{
    resultIndex: {
      actionReferenceCount: 4,
      leafValuePairCount: 8,
      structuredV2ActionReferenceCount: 0,
      structuredV2LeafValuePairCount: 0,
      structuredV2ActionReferenceIdentities: [],
      actionReferenceIdentities: [
        {
          identity: "legacy-mulligan",
          phaseBand: "mulligan",
          actionClass: "mulligan",
          coverageKey: "deck-a:p1"
        },
        {
          identity: "legacy-early",
          phaseBand: "early",
          actionClass: "movement-combat",
          coverageKey: "deck-a:p2"
        },
        {
          identity: "legacy-mid",
          phaseBand: "mid",
          actionClass: "target-effect-choice",
          coverageKey: "deck-a:p1"
        },
        {
          identity: "legacy-late",
          phaseBand: "late",
          actionClass: "card-use-vs-resource-preservation",
          coverageKey: "deck-a:p2"
        }
      ],
      leafValuePhaseCoverage: {
        mulligan: 2,
        early: 2,
        mid: 2,
        late: 2
      },
      leafValueCoverage: {
        "deck-a:p1": 4,
        "deck-a:p2": 4
      },
      structuredV2LeafValuePhaseCoverage: {},
      structuredV2LeafValueCoverage: {}
    }
  }], {
    deckIds: ["deck-a"],
    requireStructuredV2: false
  });
  assert.equal(legacyOnly.requireStructuredV2, false);
  assert.equal(legacyOnly.eligibleActionReferences, 4);
  assert.equal(legacyOnly.eligibleLeafValuePairs, 8);
  assert.equal(legacyOnly.sufficient, true);
});

test("evaluator early diagnostic split balances every label on multi-condition games", () => {
  const records = Array.from({ length: 8 }, (_, index) => {
    const actionRare = index < 2;
    const leafRare = index >= 2 && index < 4;
    return {
      datasetKey: "diagnostic-multilabel",
      workerIndex: index,
      gameIndex: index,
      samplingMode: "action-ranking-audit",
      resultIndex: {
        structuredV2ActionReferenceCoverage: {
          "deck-a:p1": 1,
          ...(actionRare ? { "deck-b:p2": 1 } : {})
        },
        structuredV2ActionReferencePhaseCoverage: {
          early: 1,
          ...(actionRare ? { late: 1 } : {})
        },
        structuredV2ActionReferenceActionClassCoverage: {
          "movement-combat": 1,
          ...(actionRare ? { "target-effect-choice": 1 } : {})
        },
        structuredV2ActionReferenceDeckPhaseCoverage: {
          "deck-a::early": 1,
          ...(actionRare ? { "deck-b::late": 1 } : {})
        },
        structuredV2LeafValueCoverage: {
          "deck-a:p1": 1,
          ...(leafRare ? { "deck-b:p2": 1 } : {})
        },
        structuredV2LeafValuePhaseCoverage: {
          early: 1,
          ...(leafRare ? { late: 1 } : {})
        },
        structuredV2LeafValueDeckPhaseCoverage: {
          "deck-a::early": 1,
          ...(leafRare ? { "deck-b::late": 1 } : {})
        }
      }
    };
  });
  const split = splitEvaluatorEarlyDiagnosticRecords(records, {
    seed: "multilabel-fixed",
    validationFraction: 0.25,
    requireStructuredV2: true
  });
  const contains = (items, field, key) => items.some((record) =>
    Number(record.resultIndex?.[field]?.[key]) > 0);
  assert.equal(split.validation.length, 2);
  assert.equal(contains(
    split.validation,
    "structuredV2ActionReferenceDeckPhaseCoverage",
    "deck-b::late"
  ), true);
  assert.equal(contains(
    split.validation,
    "structuredV2LeafValueDeckPhaseCoverage",
    "deck-b::late"
  ), true);
  assert.equal(contains(
    split.training,
    "structuredV2ActionReferenceDeckPhaseCoverage",
    "deck-b::late"
  ), true);
  assert.equal(contains(
    split.training,
    "structuredV2LeafValueDeckPhaseCoverage",
    "deck-b::late"
  ), true);
});

test("evaluator early split balance requires counts and independent games", () => {
  const phases = ["mulligan", "early", "mid", "late"];
  const classes = [
    "mulligan",
    "movement-combat",
    "target-effect-choice",
    "card-use-vs-resource-preservation"
  ];
  const record = (ordinal, copy) => {
    const phase = phases[ordinal];
    const actionClass = classes[ordinal];
    const coverageKey = `deck-a:p${ordinal % 2 + 1}`;
    const identity = `action-${copy}-${ordinal}`;
    return {
      workerIndex: copy,
      gameIndex: ordinal,
      resultIndex: {
        structuredV2ActionReferenceCount: 1,
        structuredV2LeafValuePairCount: 1,
        structuredV2ActionReferenceIdentities: [identity],
        actionReferenceIdentities: [{
          identity,
          phaseBand: phase,
          actionClass,
          coverageKey
        }],
        structuredV2ActionReferencePhaseCoverage: { [phase]: 1 },
        structuredV2ActionReferenceActionClassCoverage: { [actionClass]: 1 },
        structuredV2ActionReferenceCoverage: { [coverageKey]: 1 },
        structuredV2ActionReferenceDeckPhaseCoverage: {
          [`deck-a::${phase}`]: 1
        },
        structuredV2LeafValuePhaseCoverage: { [phase]: 1 },
        structuredV2LeafValueCoverage: { [coverageKey]: 1 },
        structuredV2LeafValueDeckPhaseCoverage: {
          [`deck-a::${phase}`]: 1
        }
      }
    };
  };
  const requirement = {
    minimumActionReferences: 8,
    minimumLeafValuePairs: 8,
    minimumActionReferencesByPhase: Object.fromEntries(
      phases.map((key) => [key, 2])
    ),
    minimumActionReferenceGamesByPhase: Object.fromEntries(
      phases.map((key) => [key, 2])
    ),
    minimumLeafValuePairsByPhase: Object.fromEntries(
      phases.map((key) => [key, 2])
    ),
    minimumLeafValueReferenceGamesByPhase: Object.fromEntries(
      phases.map((key) => [key, 2])
    ),
    minimumActionReferencesPerCoreClass: 2,
    minimumActionReferenceGamesPerCoreClass: 2,
    minimumActionReferencesPerDeckSeat: 2,
    minimumActionReferenceGamesPerDeckSeat: 2,
    minimumLeafValuePairsPerDeckSeat: 2,
    minimumLeafValueReferenceGamesPerDeckSeat: 2,
    minimumActionReferencesPerDeckPhase: 2,
    minimumActionReferenceGamesPerDeckPhase: 2,
    minimumLeafValuePairsPerDeckPhase: 2,
    minimumLeafValueReferenceGamesPerDeckPhase: 2
  };
  const once = phases.map((_, ordinal) => record(ordinal, 0));
  const twice = [...once, ...phases.map((_, ordinal) => record(ordinal, 1))];
  const insufficient = summarizeEvaluatorEarlyDiagnosticEvidence(once, {
    deckIds: ["deck-a"],
    requirement
  });
  const sufficient = summarizeEvaluatorEarlyDiagnosticEvidence(twice, {
    deckIds: ["deck-a"],
    requirement
  });
  assert.equal(insufficient.sufficient, false);
  assert.deepEqual(insufficient.missing.actionPhaseGames, phases);
  assert.deepEqual(insufficient.missing.actionDeckPhases,
    phases.map((phase) => `deck-a::${phase}`));
  assert.equal(sufficient.sufficient, true);
});

test("invalid early diagnostic retries expand every balance requirement", () => {
  const base = EVALUATOR_EARLY_DIAGNOSTIC_CHECKPOINTS[0].requirement;
  const firstRetry = expandEvaluatorEarlyDiagnosticRequirement(base, 1);
  const secondRetry = expandEvaluatorEarlyDiagnosticRequirement(base, 2);
  const validation = evaluatorEarlyDiagnosticSplitEvidenceRequirement(
    firstRetry,
    { role: "validation", validationFraction: 0.3 }
  );
  assert.equal(firstRetry.minimumStructuredV2ActionReferences, 75);
  assert.equal(firstRetry.minimumStructuredV2LeafValuePairs, 270);
  assert.equal(secondRetry.minimumStructuredV2ActionReferences, 100);
  assert.equal(secondRetry.minimumStructuredV2LeafValuePairs, 360);
  assert.equal(validation.minimumActionReferences >= 20, true);
  assert.equal(validation.minimumActionReferenceGamesByPhase.late >= 2, true);
  assert.equal(validation.minimumActionReferencesPerDeckPhase >= 1, true);
});

test("evaluator early action bounds preserve small-sample uncertainty", () => {
  const small = conservativeGameClusterAccuracyInterval({
    neuralAccuracy: 0.45,
    contributingGames: 20
  });
  const large = conservativeGameClusterAccuracyInterval({
    neuralAccuracy: 0.4,
    contributingGames: 200
  });
  assert.equal(small.upperBound > 0.5, true);
  assert.equal(large.upperBound < 0.5, true);
  assert.equal(
    conservativeGameClusterAccuracyInterval({
      neuralAccuracy: 0.49,
      contributingGames: null
    }).upperBound,
    null
  );
});

test("evaluator early action bootstrap preserves macro weighting and sparse uncertainty", () => {
  const games = [
    ...Array.from({ length: 90 }, (_, index) => ({
      gameId: `major-${index}`,
      stratum: "deck-a:p1",
      correct: 1,
      decisions: 1
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      gameId: `minor-${index}`,
      stratum: "deck-b:p2",
      correct: 0,
      decisions: 1
    }))
  ];
  const interval = bootstrapStratifiedGameAccuracyInterval(games, {
    samples: 500
  });
  assert.equal(
    interval.method,
    "deck-seat-stratified-game-bootstrap-hoeffding-v2"
  );
  assert.equal(interval.mean, 0.5);
  assert.equal(interval.bootstrapUpperBound, 0.5);
  assert.equal(interval.upperBound > interval.bootstrapUpperBound, true);
  assert.equal(interval.effectiveGames < games.length, true);

  const unanimousSparse = bootstrapStratifiedGameAccuracyInterval([{
    gameId: "only-observation",
    stratum: "deck-a:p1",
    correct: 0,
    decisions: 1
  }], { samples: 500 });
  assert.equal(unanimousSparse.bootstrapUpperBound, 0);
  assert.equal(unanimousSparse.upperBound, 1);
});

test("detached action audits permanently classify records skipped after a role target is satisfied", () => {
  const game = {
    entries: [
      { diagnostic: { status: "candidate-pending" }, audit: null },
      { diagnostic: { status: "verified" }, audit: { source: "proof" } }
    ]
  };
  markActionAuditGameSkippedTargetSatisfied(game);
  assert.equal(game.entries[0].diagnostic.status, "skipped-target-satisfied");
  assert.deepEqual(
    game.entries[0].diagnostic.gateReasons,
    ["certification-role-target-satisfied"]
  );
  assert.equal(game.entries[1].diagnostic.status, "verified");
});

test("heuristic-only detached action audits do not serialize unused neural models into every worker", () => {
  const unavailableModel = {
    session: {
      getWeights() {
        throw new Error("heuristic-only audit must not serialize the model");
      }
    }
  };
  const options = actionAuditWorkerOptions({
    model: unavailableModel,
    league: [unavailableModel],
    teacherEvaluatorModels: [unavailableModel],
    teacherEvaluatorMode: "heuristic-only",
    engineFingerprint: "sha256:focused-regression"
  });
  assert.equal(options.model, null);
  assert.deepEqual(options.league, []);
  assert.deepEqual(options.teacherEvaluatorModels, []);
  assert.equal(options.teacherEvaluatorMode, "heuristic-only");
});

test("self-play handoff commits a pair once and never overwrites an accepted pair", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-handoff-transaction-")
  );
  const archivePath = path.join(directory, "accepted.json.gz");
  const summaryPath = path.join(directory, "accepted.summary.json");
  try {
    const first = await createSelfPlayResultHandoff({
      trajectories: [],
      summaries: [{ winner: "p1" }]
    }, directory, {
      summary: { version: 1, winner: "p1" }
    });
    const adopted = await adoptSelfPlayResultHandoff(
      first,
      archivePath,
      summaryPath
    );
    assert.equal(adopted.reusedExisting, undefined);
    assert.equal(
      JSON.parse(await readFile(
        path.join(directory, "accepted.commit.json"),
        "utf8"
      )).version,
      1
    );

    const duplicate = await createSelfPlayResultHandoff({
      trajectories: [],
      summaries: [{ winner: "p2" }]
    }, directory, {
      summary: { version: 1, winner: "p2" }
    });
    const reused = await adoptSelfPlayResultHandoff(
      duplicate,
      archivePath,
      summaryPath
    );
    assert.equal(reused.reusedExisting, true);
    assert.equal(
      (await readTrajectoryArchive(archivePath)).summaries[0].winner,
      "p1"
    );
    assert.equal(
      JSON.parse(await readFile(summaryPath, "utf8")).winner,
      "p1"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluator bootstrap compact indexes preserve progress counts without retaining trajectories", () => {
  const informationSetHash = "indexed-game-information-set";
  const structured = syntheticStructuredEvidence(informationSetHash);
  const leafPairs = [terminalLeafValuePair(71), terminalLeafValuePair(72)]
    .map((pair) => ({
      ...pair,
      correctStructuredState: structuredClone(structured),
      comparedStructuredState: structuredClone(structured)
    }));
  const result = {
    summaries: [{
      completed: true,
      naturallyCompleted: true,
      invalid: false
    }],
    trajectories: [{
      gameId: "indexed-game",
      deckId: "deck",
      playerId: "p2",
      engineFingerprint: structured.engineFingerprint,
      steps: [{
        informationSetHash,
        leafValueAuditReference: createLeafValueReference([
          ...leafPairs
        ], {
          source: "teacher-independent-production-cutoff-audit",
          policyCorrectionIndependent: true
        })
      }]
    }]
  };
  const fullRecord = {
    workerIndex: 1,
    gameIndex: 2,
    samplingMode: "leaf-audit",
    result
  };
  const indexedRecord = {
    workerIndex: 1,
    gameIndex: 2,
    samplingMode: "leaf-audit",
    resultIndex: createEvaluatorBootstrapResultIndex(result)
  };
  const options = {
    deckIds: ["deck"],
    includeCertificationPartitions: false,
    minimumGamesFloor: 0,
    minimumReferenceFloor: 0,
    minimumReferenceGamesFloor: 0,
    minimumCalibrationFloor: 0
  };
  const full = summarizeEvaluatorBootstrap({
    records: [fullRecord],
    invalidRecords: []
  }, options);
  const indexed = summarizeEvaluatorBootstrap({
    records: [indexedRecord],
    invalidRecords: []
  }, options);
  assert.equal(indexed.acceptedGames, full.acceptedGames);
  assert.equal(indexed.leafValuePairCount, full.leafValuePairCount);
  assert.equal(indexed.structuredV2LeafValuePairCount, 2);
  assert.equal(full.structuredV2LeafValuePairCount, 2);
  assert.equal(
    indexed.leafValueReferenceGameCount,
    full.leafValueReferenceGameCount
  );
  assert.deepEqual(indexed.gameCoverage, full.gameCoverage);
  assert.deepEqual(indexed.leafValueCoverage, full.leafValueCoverage);
  assert.deepEqual(indexedRecord.resultIndex.structuredV2LeafValueCoverage, {
    "deck:p2": 2
  });
  assert.equal(
    Object.values(
      indexedRecord.resultIndex.structuredV2LeafValuePhaseCoverage
    ).reduce((sum, count) => sum + count, 0),
    2
  );
  assert.equal("result" in indexedRecord, false);
});

test("evaluator bootstrap indexes physical BO3 audit work recursively", () => {
  const physicalGame = (teacherQueries, pairedSeeds) => ({
    completed: true,
    naturallyCompleted: true,
    invalid: false,
    teacherQueries,
    teacherActionAuditCandidatesDiscovered: 4,
    teacherActionAuditAttempts: 4,
    teacherActionAuditCandidatesExpandedTo16: 2,
    teacherActionAuditCandidatesExpandedTo32: 1,
    teacherActionAuditFinalCandidates: 1,
    teacherActionAuditPairedSeedsCompleted: pairedSeeds,
    teacherActionAuditCandidatePoolChanges: 2,
    teacherActionAuditQueriesSuppressed: 7,
    teacherActionAuditReferences: 1
  });
  const index = createEvaluatorBootstrapResultIndex({
    summaries: [{
      type: "bestOfThree",
      completed: true,
      naturallyCompleted: true,
      invalid: false,
      games: [
        physicalGame(20, 96),
        physicalGame(12, 32)
      ]
    }],
    trajectories: []
  });
  assert.equal(index.logicalGames, 1);
  assert.equal(index.physicalGames, 2);
  assert.equal(index.actionAuditRacing.discovered, 8);
  assert.equal(index.actionAuditRacing.pairedSeedsCompleted, 128);
  assert.equal(index.actionAuditRacing.teacherQueries, 32);
  assert.equal(index.actionAuditRacing.candidatePoolChanges, 4);
  assert.equal(index.actionAuditRacing.queriesSuppressed, 14);
});

test("legacy evaluator bootstrap archives migrate one record into a compact resume index", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-bootstrap-index-")
  );
  const datasetKey = "legacy-index-test";
  const archivePath = path.join(
    directory,
    "worker-001-game-00002.json.gz"
  );
  try {
    await writeTrajectoryArchive(archivePath, {
      version: 1,
      datasetKey,
      workerIndex: 1,
      gameIndex: 2,
      samplingMode: "leaf-audit",
      result: {
        summaries: [{
          completed: true,
          naturallyCompleted: true,
          invalid: false
        }],
        trajectories: [{
          gameId: "legacy-game",
          deckId: "deck",
          playerId: "p1",
          steps: []
        }]
      }
    });
    const loaded = await loadEvaluatorBootstrap(directory, datasetKey);
    assert.equal(loaded.records.length, 1);
    assert.equal(loaded.trajectories.length, 0);
    assert.equal("result" in loaded.records[0], false);
    assert.equal(
      (await readdir(directory))
        .includes("worker-001-game-00002.summary.json"),
      true
    );
    const materialized = await materializeEvaluatorBootstrapRecords(
      loaded.records
    );
    assert.equal(materialized[0].result.trajectories[0].deckId, "deck");
    assert.equal(
      materialized[0].result.trajectories[0]
        .evaluatorBootstrapSamplingMode,
      "leaf-audit"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a result-v1 bootstrap archive without its summary recovers coordinates from its filename", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-bootstrap-orphan-")
  );
  const datasetKey = "orphan-summary-test";
  const archivePath = path.join(
    directory,
    "worker-003-game-00017.json.gz"
  );
  try {
    await writeTrajectoryArchive(archivePath, {
      summaries: [{
        completed: true,
        naturallyCompleted: true,
        invalid: false
      }],
      trajectories: [{
        gameId: "orphan-game",
        deckId: "deck",
        playerId: "p2",
        evaluatorBootstrapSamplingMode: "leaf-audit",
        steps: []
      }]
    });
    const loaded = await loadEvaluatorBootstrap(directory, datasetKey);
    assert.equal(loaded.records.length, 1);
    assert.equal(loaded.records[0].workerIndex, 3);
    assert.equal(loaded.records[0].gameIndex, 17);
    assert.equal(loaded.records[0].samplingMode, "leaf-audit");
    assert.equal(
      (await readdir(directory))
        .includes("worker-003-game-00017.summary.json"),
      true
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("detached action audit persists the latest result index with its archive", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-detached-audit-commit-")
  );
  const datasetKey = "detached-audit-commit-test";
  const archivePath = path.join(
    directory,
    "worker-000-game-00000.json.gz"
  );
  const summaryPath = path.join(
    directory,
    "worker-000-game-00000.summary.json"
  );
  const result = evaluatorBootstrapResultWithActionReferences([
    independentTerminalActionAuditReference("persist-latest")
  ]);
  const game = {
    record: {
      archivePath,
      summaryPath,
      resultIndex: null
    }
  };
  try {
    await writeTrajectoryArchive(archivePath, {
      summaries: [],
      trajectories: []
    });
    await writeFile(summaryPath, `${JSON.stringify({
      version: 1,
      kind: "evaluator-bootstrap",
      datasetKey,
      workerIndex: 0,
      gameIndex: 0,
      samplingMode: "action-ranking-audit",
      certificationRole: "development",
      resultIndex: createEvaluatorBootstrapResultIndex({
        summaries: [],
        trajectories: []
      })
    })}\n`, "utf8");

    await persistFinalizedEvaluatorBootstrapGame(
      game,
      result,
      result,
      { references: 1, pairedSeedsCompleted: 96 }
    );

    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.equal(summary.resultIndex.actionReferenceCount, 1);
    assert.equal(game.record.resultIndex.actionReferenceCount, 1);
    assert.equal(summary.archiveTransaction.version, 2);
    assert.equal(
      JSON.parse(await readFile(
        path.join(directory, "worker-000-game-00000.commit.json"),
        "utf8"
      )).transactionId,
      summary.archiveTransaction.transactionId
    );
    assert.equal(
      (await readdir(directory))
        .some((name) => name.endsWith(".updating.json")),
      false
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluator bootstrap rejects a stale summary and rebuilds it after an interrupted archive replacement", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-detached-audit-recovery-")
  );
  const datasetKey = "detached-audit-recovery-test";
  const archivePath = path.join(
    directory,
    "worker-000-game-00000.json.gz"
  );
  const summaryPath = path.join(
    directory,
    "worker-000-game-00000.summary.json"
  );
  const firstResult = evaluatorBootstrapResultWithActionReferences([
    independentTerminalActionAuditReference("before-interruption")
  ]);
  const secondResult = evaluatorBootstrapResultWithActionReferences([
    independentTerminalActionAuditReference("after-interruption-a"),
    independentTerminalActionAuditReference("after-interruption-b")
  ]);
  const game = {
    record: {
      archivePath,
      summaryPath,
      resultIndex: null
    }
  };
  try {
    await writeTrajectoryArchive(archivePath, firstResult);
    await writeFile(summaryPath, `${JSON.stringify({
      version: 1,
      kind: "evaluator-bootstrap",
      datasetKey,
      workerIndex: 0,
      gameIndex: 0,
      samplingMode: "action-ranking-audit",
      certificationRole: "development",
      resultIndex: createEvaluatorBootstrapResultIndex(firstResult)
    })}\n`, "utf8");
    await persistFinalizedEvaluatorBootstrapGame(
      game,
      firstResult,
      firstResult,
      { references: 1, pairedSeedsCompleted: 96 }
    );

    await assert.rejects(
      persistFinalizedEvaluatorBootstrapGame(
        game,
        secondResult,
        secondResult,
        { references: 2, pairedSeedsCompleted: 192 },
        {
          afterArchiveReplace() {
            throw new Error("simulated interruption after archive replace");
          }
        }
      ),
      /simulated interruption/
    );
    assert.equal(
      JSON.parse(await readFile(summaryPath, "utf8"))
        .resultIndex.actionReferenceCount,
      1
    );
    assert.equal(
      (await readdir(directory))
        .some((name) => name.endsWith(".updating.json")),
      true
    );

    const loaded = await loadEvaluatorBootstrap(directory, datasetKey);
    assert.equal(loaded.records.length, 1);
    assert.equal(loaded.records[0].resultIndex.actionReferenceCount, 2);
    const repairedSummary = JSON.parse(await readFile(summaryPath, "utf8"));
    const repairedCommit = JSON.parse(await readFile(
      path.join(directory, "worker-000-game-00000.commit.json"),
      "utf8"
    ));
    assert.equal(repairedSummary.resultIndex.actionReferenceCount, 2);
    assert.equal(
      repairedCommit.transactionId,
      repairedSummary.archiveTransaction.transactionId
    );
    assert.equal(
      (await readdir(directory))
        .some((name) => name.endsWith(".updating.json")),
      false
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("self-play worker lifecycle limits recycle RSS and task retries", () => {
  assert.equal(shouldRecycleSelfPlayWorker({
    completedGames: 4,
    rssBytes: 100
  }, {
    maximumGamesPerProcess: 4,
    maximumWorkerRssBytes: 1000
  }), true);
  assert.equal(shouldRecycleSelfPlayWorker({
    completedGames: 1,
    rssBytes: 1200
  }, {
    maximumGamesPerProcess: 4,
    maximumWorkerRssBytes: 1000
  }), true);
  assert.equal(shouldRecycleSelfPlayWorker({
    completedGames: 1,
    rssBytes: 100
  }, {
    maximumGamesPerProcess: 4,
    maximumWorkerRssBytes: 1000
  }), false);
  assert.equal(selfPlayTaskRetryAllowed(0, 2), true);
  assert.equal(selfPlayTaskRetryAllowed(1, 2), true);
  assert.equal(selfPlayTaskRetryAllowed(2, 2), false);
  assert.equal(selfPlayWorkerRetryDelayMs(3221226505, "win32"), 5_000);
  assert.equal(selfPlayWorkerRetryDelayMs(1, "win32"), 0);
  assert.equal(selfPlayWorkerRetryDelayMs(3221226505, "linux"), 0);
});

test("self-play process limits separate the memory-safe initial pool from its ceiling", () => {
  assert.deepEqual(selfPlayProcessLimits({
    processes: 13,
    maximumProcesses: 16
  }, 24), {
    initialProcessCount: 13,
    maximumProcessCount: 16
  });
  assert.deepEqual(selfPlayProcessLimits({
    processes: 13,
    maximumProcesses: 16
  }, 8), {
    initialProcessCount: 8,
    maximumProcessCount: 8
  });
});

test("self-play dynamic scaling preserves the reserve and observed worker headroom", () => {
  const gib = 1024 ** 3;
  assert.deepEqual(selfPlayDynamicScaleDecision({
    processCount: 13,
    desiredProcessCount: 13,
    freeMemoryBytes: 10 * gib,
    observedWorkerRssBytes: gib,
    queuedTasks: 20,
    idleProcesses: 0,
    retiringProcesses: 0,
    dynamicScaling: true
  }, {
    maximumProcessCount: 16,
    minimumFreeMemoryBytes: 4 * gib,
    workerHeadroomBytes: gib
  }), {
    action: "scale-up",
    desiredProcessCount: 14,
    requiredHeadroomBytes: Math.ceil(1.25 * gib)
  });
  assert.equal(selfPlayDynamicScaleDecision({
    processCount: 14,
    desiredProcessCount: 14,
    freeMemoryBytes: 3 * gib,
    observedWorkerRssBytes: gib,
    queuedTasks: 20,
    idleProcesses: 0,
    retiringProcesses: 0,
    dynamicScaling: true
  }, {
    maximumProcessCount: 16,
    minimumFreeMemoryBytes: 4 * gib,
    workerHeadroomBytes: gib
  }).action, "scale-down");
});

test("self-play process pool scales up and retires a busy worker after memory pressure", async () => {
  let sawScaleUp = false;
  let sawScaleDown = false;
  let memoryPressure = false;
  const collected = await collectProcessPoolSelfPlay({
    games: 20,
    workers: 4,
    processes: 1,
    maximumProcesses: 2,
    dynamicScaleHealthySamples: 1,
    dynamicScaleIntervalMs: 1_000,
    dynamicWorkerHeadroomBytes: 256 * 1024 ** 2,
    minimumFreeMemoryBytes: 100,
    // Apply pressure once two workers are actually busy. Model initialization
    // and loaded machines can outlast a short wall-clock pressure window.
    freeMemoryBytes: () => memoryPressure ? 50 : 10 * 1024 ** 3,
    workerPath: path.resolve(
      "tests/fixtures/ai-selfplay-delayed-worker.mjs"
    ),
    workerEnvironment: {
      RIFTBOUND_DELAYED_WORKER_MS: "400"
    },
    decks: decks.slice(0, 2),
    model: createNeuralModel(),
    maxActions: 1,
    teacherFraction: 0,
    onWorkerHeartbeat: (snapshot) => {
      sawScaleUp ||= snapshot.processCount >= 2
        && snapshot.peakProcessCount >= 2;
      sawScaleDown ||= snapshot.desiredProcessCount === 1
        && snapshot.peakProcessCount >= 2;
      memoryPressure = !sawScaleDown && sawScaleUp && snapshot.active.length >= 2;
    }
  });
  assert.equal(collected.workerStats.collectedGames, 20);
  assert.equal(collected.workerStats.initial, 1);
  assert.equal(collected.workerStats.maximum, 2);
  assert.equal(collected.workerStats.peak, 2);
  assert.equal(sawScaleUp, true);
  assert.equal(sawScaleDown, true);
});

test("self-play continuation accounting tolerates a retired null slot", async () => {
  const startedAt = Date.now();
  let continuationChecks = 0;
  let sawRetiredCapacity = false;
  const collected = await collectProcessPoolSelfPlay({
    games: 12,
    workers: 4,
    processes: 2,
    maximumProcesses: 2,
    dynamicScaleHealthySamples: 1,
    dynamicScaleIntervalMs: 1_000,
    dynamicWorkerHeadroomBytes: 256 * 1024 ** 2,
    minimumFreeMemoryBytes: 100,
    freeMemoryBytes: () => {
      const elapsed = Date.now() - startedAt;
      return elapsed >= 700 && elapsed < 2_400
        ? 50
        : 10 * 1024 ** 3;
    },
    workerPath: path.resolve(
      "tests/fixtures/ai-selfplay-delayed-worker.mjs"
    ),
    workerEnvironment: {
      RIFTBOUND_DELAYED_WORKER_MS: "300"
    },
    decks: decks.slice(0, 2),
    model: createNeuralModel(),
    maxActions: 1,
    teacherFraction: 0,
    shouldAssignNext: ({ activeTasks }) => {
      continuationChecks += 1;
      assert.equal(Number.isInteger(activeTasks), true);
      return true;
    },
    onWorkerHeartbeat: (snapshot) => {
      sawRetiredCapacity ||= snapshot.desiredProcessCount === 1;
    }
  });
  assert.equal(collected.workerStats.collectedGames, 12);
  assert.equal(continuationChecks, 12);
  assert.equal(sawRetiredCapacity, true);
});

test("self-play process pool rotates a worker after its configured game budget", async () => {
  const processIds = new Set();
  let finalHeartbeat = null;
  const collected = await collectProcessPoolSelfPlay({
    games: 2,
    workers: 1,
    processes: 1,
    decks: decks.slice(0, 2),
    model: createNeuralModel(),
    maxActions: 1,
    teacherFraction: 0,
    maximumGamesPerProcess: 1,
    onWorkerHeartbeat: (snapshot) => {
      finalHeartbeat = snapshot;
      for (const active of snapshot.active || []) {
        processIds.add(active.processId);
      }
    }
  });
  assert.equal(collected.workerStats.collectedGames, 2);
  assert.equal(processIds.size >= 2, true);
  assert.equal(finalHeartbeat.completedTasks, 2);
  assert.equal(finalHeartbeat.totalTasks, 2);
  assert.deepEqual(finalHeartbeat.active, []);
});

test("self-play process pool resumes assignment after memory backpressure clears", async () => {
  let memoryChecks = 0;
  let observedBackpressure = false;
  const collected = await collectProcessPoolSelfPlay({
    games: 1,
    workers: 1,
    processes: 1,
    decks: decks.slice(0, 2),
    model: createNeuralModel(),
    maxActions: 1,
    teacherFraction: 0,
    minimumFreeMemoryBytes: 100,
    memoryBackpressurePollMs: 10,
    freeMemoryBytes: () => {
      memoryChecks += 1;
      return memoryChecks < 2 ? 50 : 1000;
    },
    onWorkerHeartbeat: (snapshot) => {
      observedBackpressure ||= snapshot.memoryBackpressured === true;
    }
  });
  assert.equal(collected.workerStats.collectedGames, 1);
  assert.equal(memoryChecks >= 2, true);
  assert.equal(observedBackpressure, true);
});

test("a crashed self-play worker retries the identical seed and persists one handoff", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-worker-retry-")
  );
  const markerPath = path.join(directory, "failed-once.marker");
  const seedLogPath = path.join(directory, "seeds.log");
  const finalArchivePath = path.join(directory, "accepted.json.gz");
  const finalSummaryPath = path.join(directory, "accepted.summary.json");
  const retries = [];
  try {
    const collected = await collectProcessPoolSelfPlay({
      games: 1,
      workers: 1,
      processes: 1,
      decks: decks.slice(0, 2),
      model: createNeuralModel(),
      seed: 77123,
      workerPath: path.resolve(
        "tests/fixtures/ai-selfplay-flaky-worker.mjs"
      ),
      workerEnvironment: {
        RIFTBOUND_FLAKY_WORKER_MARKER: markerPath,
        RIFTBOUND_FLAKY_WORKER_SEED_LOG: seedLogPath
      },
      streamResultHandoff: true,
      retainResults: false,
      maximumTaskRetries: 2,
      onTaskRetry: (retry) => retries.push(retry),
      onGameHandoff: (game) => adoptSelfPlayResultHandoff(
        game.resultHandoff,
        finalArchivePath,
        finalSummaryPath
      ),
      loadCollectedResults: async () => ({
        trajectories: [],
        summaries: [],
        deckLearning: {}
      })
    });
    const seeds = (await readFile(seedLogPath, "utf8"))
      .trim()
      .split(/\r?\n/);
    assert.deepEqual(seeds, ["77123", "77123"]);
    assert.equal(retries.length, 1);
    assert.equal(retries[0].seed, 77123);
    assert.equal(collected.workerStats.collectedGames, 1);
    assert.equal((await readdir(directory))
      .filter((name) => name === "accepted.json.gz").length, 1);
    assert.equal((await readTrajectoryArchive(finalArchivePath))
      .summaries[0].completed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a self-play worker startup crash backs off and then recovers", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-worker-startup-retry-")
  );
  const markerPath = path.join(directory, "failed-once.marker");
  const retries = [];
  try {
    const collected = await collectProcessPoolSelfPlay({
      games: 1,
      workers: 1,
      processes: 1,
      decks: decks.slice(0, 2),
      model: createNeuralModel(),
      workerPath: path.resolve(
        "tests/fixtures/ai-selfplay-startup-flaky-worker.mjs"
      ),
      workerEnvironment: {
        RIFTBOUND_STARTUP_WORKER_MARKER: markerPath
      },
      maximumWorkerStartupRetries: 2,
      workerStartupRetryBaseDelayMs: 10,
      onWorkerStartupRetry: (retry) => retries.push(retry)
    });
    assert.equal(collected.workerStats.collectedGames, 1);
    assert.equal(retries.length, 1);
    assert.equal(retries[0].retryAttempt, 1);
    assert.equal(retries[0].delayMs, 10);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repeated self-play worker startup crashes fail instead of respawning forever", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-worker-startup-failure-")
  );
  const retries = [];
  try {
    await assert.rejects(
      collectProcessPoolSelfPlay({
        games: 1,
        workers: 1,
        processes: 1,
        decks: decks.slice(0, 2),
        model: createNeuralModel(),
        workerPath: path.resolve(
          "tests/fixtures/ai-selfplay-startup-flaky-worker.mjs"
        ),
        workerEnvironment: {
          RIFTBOUND_STARTUP_WORKER_MARKER:
            path.join(directory, "always-fail.marker"),
          RIFTBOUND_STARTUP_WORKER_ALWAYS_FAIL: "true"
        },
        maximumWorkerStartupRetries: 2,
        workerStartupRetryBaseDelayMs: 10,
        onWorkerStartupRetry: (retry) => retries.push(retry)
      }),
      (error) => error?.code === "AI_SELFPLAY_WORKER_INITIALIZATION_FAILED"
        && error?.startupRetryAttempts === 2
    );
    assert.equal(retries.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("streaming 50 large worker results keeps parent memory bounded and leaves no handoff directory", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "riftbound-ai-large-stream-")
  );
  const rssBefore = process.memoryUsage().rss;
  try {
    const collected = await collectProcessPoolSelfPlay({
      games: 50,
      workers: 4,
      processes: 4,
      decks: decks.slice(0, 2),
      model: createNeuralModel(),
      seed: 88123,
      workerPath: path.resolve(
        "tests/fixtures/ai-selfplay-large-result-worker.mjs"
      ),
      workerEnvironment: {
        RIFTBOUND_LARGE_RESULT_VALUES: "262144"
      },
      resultHandoffRoot: directory,
      streamResultHandoff: true,
      retainResults: false,
      maximumGamesPerProcess: 5,
      maximumTaskRetries: 2,
      onGameHandoff: (game) => {
        const identity =
          `${game.workerIndex}-${game.gameIndex}`;
        return adoptSelfPlayResultHandoff(
          game.resultHandoff,
          path.join(directory, `${identity}.json.gz`),
          path.join(directory, `${identity}.summary.json`)
        );
      },
      loadCollectedResults: async () => ({
        trajectories: [],
        summaries: [],
        deckLearning: {}
      })
    });
    const names = await readdir(directory);
    assert.equal(collected.workerStats.collectedGames, 50);
    assert.equal(collected.trajectories.length, 0);
    assert.equal(names.filter((name) => name.endsWith(".json.gz")).length, 50);
    assert.equal(
      names.filter((name) => name.endsWith(".summary.json")).length,
      50
    );
    assert.equal(
      names.some((name) => name.startsWith("riftbound-ai-selfplay-pool-")),
      false
    );
    assert.equal(
      process.memoryUsage().rss - rssBefore < 256 * 1024 * 1024,
      true
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("historical meta weighting favors the dominant Origins deck while retaining exploration", () => {
  const meta = buildMetaPreset();
  const kaisa = decks.find((deck) => deck.id === "origins-kaisa");
  const other = decks.find((deck) => deck.id === "origins-sett");
  assert.equal(weightedDeckPick([kaisa, other], () => 0.1, meta, 0.7).id, kaisa.id);
  assert.ok(weightedDeckPick([kaisa, other], () => 0.99, meta, 0.7));
});

test("behavior-cloning bootstrap trains and reports held-out action metrics", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, legal, { greedy: true });
  const step = {
    state: decision.stateEncoding,
    actions: decision.actionEncoding.slice(0, decision.legalCount * ACTION_DIM),
    selectedIndex: decision.selectedIndex,
    legalCount: decision.legalCount,
    oldLogProbability: 0,
    value: 0,
    beliefTarget: new Float32Array(decision.belief.length),
    initialMemory: decision.initialMemory,
    advantage: 1,
    return: 1,
    imitation: true
  };
  const trajectories = [{ gameId: "bc-one", playerId: actorId, steps: [step] }];
  const epochProgress = [];
  const trained = trainBehaviorCloning(model, trajectories, { epochs: 1, batchSize: 1, onEpoch: (item) => epochProgress.push(item) });
  const evaluated = evaluateBehaviorCloning(model, trajectories, { batchSize: 1 });
  assert.equal(trained.history.length, 1);
  assert.equal(epochProgress.length, 1);
  assert.equal(epochProgress[0].epoch, 1);
  assert.equal(evaluated.steps, 1);
  assert.equal(Number.isFinite(evaluated.policyLoss), true);
  assert.equal(evaluated.actionAccuracy >= 0 && evaluated.actionAccuracy <= 1, true);
  assert.equal(evaluated.decisionChanceAccuracy >= 0 && evaluated.decisionChanceAccuracy <= 1, true);
});

test("PPO behavior-policy ratio is one before an update at non-unit temperature", () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, legal, {
    temperature: 0.85,
    random: () => 0.37
  });
  const batch = packPpoBatch([{
    gameId: "temperature-ratio",
    playerId: actorId,
    completed: true,
    won: true,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding.slice(0, decision.legalCount * ACTION_DIM),
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      behaviorTemperature: decision.behaviorTemperature,
      value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 1,
      return: 1,
      terminalOutcome: 1,
      teacherConfidence: 0
    }]
  }]);
  const ratios = evaluatePpoBatchPolicyRatios(model, batch);
  assert.equal(ratios.length, 1);
  assert.ok(Math.abs(ratios[0] - 1) < 1e-5, `ratio=${ratios[0]}`);
});

test("single-action teacher correction directly raises the recommendation and lowers the rejected choice", () => {
  const game = createMulliganTestGame();
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const model = createNeuralModel();
  const before = createNeuralSession(model).decide(game, actorId, legal, { greedy: true });
  assert.ok(before.legalCount >= 2);
  const rejectedIndex = before.selectedIndex;
  const teacherIndex = (rejectedIndex + 1) % before.legalCount;
  const teacherTargets = new Array(before.legalCount).fill(0);
  teacherTargets[teacherIndex] = 1;
  const batch = packPpoBatch([{
    gameId: "single-teacher-policy-correction",
    playerId: actorId,
    completed: true,
    won: true,
    steps: [{
      state: before.stateEncoding,
      actions: before.actionEncoding.slice(0, before.legalCount * ACTION_DIM),
      selectedIndex: rejectedIndex,
      legalCount: before.legalCount,
      oldLogProbability: before.logProbability,
      behaviorTemperature: 1,
      value: before.value,
      beliefTarget: new Float32Array(before.belief.length),
      initialMemory: before.initialMemory,
      advantage: 0,
      return: 0,
      terminalOutcome: 1,
      teacherIndex,
      teacherTargets,
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      teacherCorrectionEligible: true,
      teacherVerificationStatus: "verified",
      teacherPolicyEligible: true,
      teacherConfirmation: {
        determinizationAudit: { version: 1, complete: true }
      },
      teacherConfidence: 1,
      teacherRankingMargin: 0.25
    }]
  }]);
  assert.equal(batch.teacherSupports[teacherIndex], 1);
  assert.equal(batch.teacherSupports[rejectedIndex], 1);
  assert.equal(batch.policyStepWeights[0], 0);
  const optimizer = tf.train.adam(0.001);
  const metrics = trainPpoBatch(model, batch, optimizer, {
    policyCoefficient: 0,
    valueCoefficient: 0,
    actionValueCoefficient: 0,
    diagnosticCoefficient: 0,
    beliefCoefficient: 0,
    entropyCoefficient: 0,
    teacherCoefficient: 1,
    teacherPolicyPreferenceCoefficient: 1,
    teacherRankingCoefficient: 0,
    teacherActionValueCoefficient: 0,
    anchorCoefficient: 0
  });
  optimizer.dispose();
  const after = createNeuralSession(model).decide(game, actorId, legal, { greedy: true });
  assert.ok(metrics.teacherLoss > 0);
  assert.ok(metrics.teacherDistillationLoss > 0);
  assert.ok(metrics.teacherPolicyPreferenceLoss > 0);
  assert.ok(after.probabilities[teacherIndex] > before.probabilities[teacherIndex],
    `teacher probability ${before.probabilities[teacherIndex]} -> ${after.probabilities[teacherIndex]}`);
  assert.ok(after.probabilities[rejectedIndex] < before.probabilities[rejectedIndex],
    `rejected probability ${before.probabilities[rejectedIndex]} -> ${after.probabilities[rejectedIndex]}`);
});

test("provisional-only supervision is record-only and skips the optimizer entirely", () => {
  const game = createMulliganTestGame();
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const model = createNeuralModel();
  const before = createNeuralSession(model).decide(game, actorId, legal, { greedy: true });
  const teacherIndex = (before.selectedIndex + 1) % before.legalCount;
  const batch = packPpoBatch([{
    gameId: "provisional-record-only",
    playerId: actorId,
    completed: true,
    steps: [{
      state: before.stateEncoding,
      actions: before.actionEncoding,
      selectedIndex: before.selectedIndex,
      legalCount: before.legalCount,
      oldLogProbability: before.logProbability,
      behaviorTemperature: 1,
      value: before.value,
      beliefTarget: new Float32Array(before.belief.length),
      initialMemory: before.initialMemory,
      advantage: 0,
      return: 0,
      teacherIndex,
      teacherTargets: Array.from({ length: before.legalCount }, (_, index) => index === teacherIndex ? 1 : 0),
      teacherActionValueTargets: Array.from({ length: before.legalCount }, (_, index) => index === teacherIndex ? 1 : -1),
      teacherActionValueWeights: new Array(before.legalCount).fill(1),
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      teacherCorrectionEligible: false,
      teacherVerificationStatus: "provisional",
      teacherPolicyEligible: false,
      teacherActionValueEligible: true,
      teacherConfidence: 0.8
    }]
  }]);
  assert.equal(batch.teacherWeights[0], 0);
  assert.equal(Array.from(batch.teacherActionValueWeights).some((weight) => weight > 0), false);
  let optimizerCalls = 0;
  const metrics = trainPpoBatch(model, batch, {
    minimize() {
      optimizerCalls += 1;
      throw new Error("record-only batches must not call the optimizer");
    }
  }, {
    policyCoefficient: 0,
    valueCoefficient: 0,
    actionValueCoefficient: 0,
    diagnosticCoefficient: 0,
    beliefCoefficient: 0,
    entropyCoefficient: 0,
    teacherCoefficient: 1,
    teacherPolicyPreferenceCoefficient: 1,
    teacherRankingCoefficient: 1,
    teacherActionValueCoefficient: 1,
    anchorCoefficient: 0
  });
  const after = createNeuralSession(model).decide(game, actorId, legal, { greedy: true });
  assert.equal(optimizerCalls, 0);
  assert.equal(metrics.optimizerStepApplied, false);
  assert.deepEqual(after.logits, before.logits);
  assert.deepEqual(after.probabilities, before.probabilities);
});

test("action audit references are certification-only and create no training gradient", () => {
  const game = createMulliganTestGame();
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(
    game,
    actorId,
    legal,
    { greedy: true }
  );
  const batch = packPpoBatch([{
    gameId: "action-audit-gradient-isolation",
    playerId: actorId,
    completed: true,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      behaviorTemperature: 1,
      value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 0,
      return: 0,
      actionRankingAuditReference:
        independentTerminalActionAuditReference("gradient-isolation")
    }]
  }]);
  assert.equal(Array.from(batch.teacherWeights).some((weight) => weight > 0), false);
  assert.equal(
    Array.from(batch.teacherActionValueWeights)
      .some((weight) => weight > 0),
    false
  );
  let optimizerCalls = 0;
  const metrics = trainPpoBatch(model, batch, {
    minimize() {
      optimizerCalls += 1;
      throw new Error("certification audit must not call the optimizer");
    }
  }, {
    policyCoefficient: 0,
    valueCoefficient: 0,
    actionValueCoefficient: 0,
    diagnosticCoefficient: 0,
    beliefCoefficient: 0,
    entropyCoefficient: 0,
    teacherCoefficient: 1,
    teacherPolicyPreferenceCoefficient: 1,
    teacherRankingCoefficient: 1,
    teacherActionValueCoefficient: 1,
    anchorCoefficient: 0
  });
  assert.equal(optimizerCalls, 0);
  assert.equal(metrics.optimizerStepApplied, false);
});

test("only matching high-confidence policy-Q evidence creates anchored local corrections", () => {
  const suffix = "policy-q-local-correction";
  const baseReference = independentTerminalActionAuditReference(suffix);
  const additionalPairs = baseReference.seedBanks.final.slice(32, 48).map(
    (simulationSeed, index) => ({
      simulationSeed,
      recommendedOutcome: index < 10 ? 1 : 0,
      selectedOutcome: index < 10 ? 0 : 1
    })
  );
  const reference = structuredClone(baseReference);
  reference.evaluatorStatePairs.push(...additionalPairs.map((pair) =>
    terminalEvaluatorStatePair(pair.simulationSeed, pair)));
  reference.final.samples = 48;
  reference.final.terminalPairs = 48;
  reference.final.terminalOutcomePairs.push(...additionalPairs);
  reference.final.rates = auditRateEvidence(48, 64);
  const trajectory = {
    gameId: "policy-q-local-correction-game",
    deckId: "origins-annie",
    playerId: "p1",
    steps: [{
      state: new Float32Array(STATE_DIM),
      actions: new Float32Array(MAX_ACTIONS * ACTION_DIM),
      selectedIndex: 0,
      legalCount: 2,
      legalActionKeys: ["passShowdown", "endTurn"],
      oldLogProbability: 0,
      behaviorTemperature: 1,
      value: 0,
      advantage: 0,
      return: 0,
      initialMemory: [],
      informationSetHash: reference.informationSetHash,
      actionRankingAuditReference: reference
    }]
  };
  const allowed = policyConditionedActionCorrectionTrajectories(
    [trajectory],
    {
      enabled: true,
      datasetContinuationPolicyHash: "policy-hash:pi5",
      currentPolicyHash: "policy-hash:pi5",
      maximumCorrections: 8
    }
  );
  assert.equal(allowed.length, 1);
  assert.equal(allowed[0].steps[0].teacherIndex, 1);
  assert.equal(allowed[0].steps[0].source,
    "high-confidence-policy-conditioned-q");
  assert.ok(allowed[0].steps[0].teacherConfidence <= 0.35);
  assert.equal(
    allowed[0].steps[0].policyConditionedCorrection.anchorKlRequired,
    true
  );
  const wrongLineage = policyConditionedActionCorrectionTrajectories(
    [trajectory],
    {
      enabled: true,
      datasetContinuationPolicyHash: "policy-hash:pi5",
      currentPolicyHash: "policy-hash:other",
      maximumCorrections: 8
    }
  );
  assert.deepEqual(wrongLineage, []);
  const mismatchedComparedAction = structuredClone(trajectory);
  mismatchedComparedAction.steps[0].selectedIndex = 2;
  mismatchedComparedAction.steps[0].legalCount = 3;
  mismatchedComparedAction.steps[0].legalActionKeys = [
    "passShowdown",
    "endTurn",
    "pass"
  ];
  assert.deepEqual(policyConditionedActionCorrectionTrajectories(
    [mismatchedComparedAction],
    {
      enabled: true,
      datasetContinuationPolicyHash: "policy-hash:pi5",
      currentPolicyHash: "policy-hash:pi5",
      maximumCorrections: 8
    }
  ), []);
});

test("provisional search updates only the isolated proposal head and leaves deployed policy bit-identical", () => {
  const game = createMulliganTestGame();
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  const teacherIndex = (decision.selectedIndex + 1) % decision.legalCount;
  const batch = packPpoBatch([{
    gameId: "provisional-action-value",
    playerId: actorId,
    completed: true,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 0,
      return: 0,
      teacherIndex,
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      teacherCorrectionEligible: false,
      teacherVerificationStatus: "provisional",
      teacherPolicyEligible: false,
      teacherActionValueEligible: true,
      teacherConfirmation: {
        independent: true,
        seedBanks: { disjoint: true },
        determinizationAudit: { version: 1, complete: true },
        validPairedSamples: 8,
        validRates: { recommended: 1, selected: 1 },
        pairedEvidence: { lowerBound: 0.05 },
        evaluatorComparison: {
          available: true,
          independent: true,
          conflict: false,
          materialConflict: false,
          agreesOnDirection: true,
          primaryDelta: 0.2,
          independentDelta: 0.15
        }
      },
      teacherConfidence: 0.5,
      teacherActionValueTargets: new Array(decision.legalCount).fill(0.25),
      teacherActionValueWeights: new Array(decision.legalCount).fill(0.2)
    }]
  }]);
  assert.equal(batch.teacherWeights[0], 0);
  assert.equal(Array.from(batch.teacherActionValueWeights).some((weight) => weight > 0), true);
  const beforeCheckpoint = serializeNeuralModel(model);
  const beforeDecision = createNeuralSession(model).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  const optimizer = tf.train.sgd(0.01);
  const metrics = trainTeacherProposalValueBatch(model, batch, optimizer, {
    coefficient: 1
  });
  optimizer.dispose();
  const afterCheckpoint = serializeNeuralModel(model);
  const afterDecision = createNeuralSession(model).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  assert.ok(metrics.teacherProposalValueLoss > 0);
  assert.deepEqual(afterDecision.logits, beforeDecision.logits);
  assert.deepEqual(afterDecision.probabilities, beforeDecision.probabilities);
  for (const [layerName, weights] of Object.entries(beforeCheckpoint.weights)) {
    if (layerName === "teacherProposalValue") continue;
    assert.deepEqual(afterCheckpoint.weights[layerName], weights, layerName);
  }
  assert.notDeepEqual(
    afterCheckpoint.weights.teacherProposalValue,
    beforeCheckpoint.weights.teacherProposalValue
  );
});

test("Run A record-only policy records verified teacher signals without consuming correction batches", async () => {
  const game = createMulliganTestGame();
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  const teacherIndex = (decision.selectedIndex + 1) % decision.legalCount;
  const trajectory = {
    gameId: "run-a-record-only-teacher",
    playerId: actorId,
    deckId: "test-deck",
    condition: "test",
    completed: true,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      behaviorTemperature: 1,
      value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 0,
      return: 0,
      teacherIndex,
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      teacherCorrectionEligible: true,
      teacherVerificationStatus: "verified",
      teacherPolicyEligible: true,
      teacherConfirmation: {
        determinizationAudit: { version: 1, complete: true }
      },
      teacherConfidence: 1,
      teacherSelectedRegret: 0.2,
      teacherRankingMargin: 0.1,
      teacherActionValueTargets: new Array(decision.legalCount).fill(0),
      teacherActionValueWeights: new Array(decision.legalCount).fill(1)
    }]
  };
  const trained = await trainRecurrentPpo(model, [trajectory], {
    epochs: 1,
    batchSize: 1,
    teacherConsumptionPolicy: "record-only-v1",
    gradientConflictDiagnostics: true,
    selectBestEpoch: false,
    calibrationTrajectories: [trajectory]
  });
  assert.equal(trained.model.metadata.teacherConsumptionPolicy, "record-only-v1");
  assert.equal(trained.model.metadata.teacherSignalsConsumed, false);
  assert.equal(trained.model.metadata.recordedTeacherSignals.verifiedChunks, 1);
  assert.equal(trained.model.metadata.teacherCorrectionChunks, 0);
  assert.equal(
    trained.model.metadata.gradientConflictDiagnostics.batches.teacher["test-deck"].available,
    true
  );
  assert.equal(trained.model.metadata.gradientConflictDiagnostics.optimizerMutation, false);
});

test("Run A produces identical weights when all correction fields are stripped", async () => {
  const game = createMulliganTestGame();
  const actorId = activeActorId(game);
  const initial = createNeuralModel();
  const initialCheckpoint = serializeNeuralModel(initial);
  const decision = createNeuralSession(initial).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  const teacherIndex = (decision.selectedIndex + 1) % decision.legalCount;
  const baseStep = {
    state: decision.stateEncoding,
    actions: decision.actionEncoding,
    selectedIndex: decision.selectedIndex,
    legalCount: decision.legalCount,
    oldLogProbability: decision.logProbability,
    behaviorTemperature: 1,
    value: decision.value,
    beliefTarget: new Float32Array(decision.belief.length),
    initialMemory: decision.initialMemory,
    advantage: 1,
    return: 0
  };
  const correctedStep = {
    ...baseStep,
    teacherIndex,
    teacherLabelVersion: TEACHER_LABEL_VERSION,
    teacherCorrectionEligible: true,
    teacherVerificationStatus: "verified",
    teacherPolicyEligible: true,
    teacherConfirmation: {
      determinizationAudit: { version: 1, complete: true }
    },
    teacherActionValueEligible: true,
    teacherConfidence: 1,
    teacherSelectedRegret: 0.2,
    teacherRankingMargin: 0.1,
    teacherActionValueTargets: Array.from(
      { length: decision.legalCount },
      (_, index) => index === teacherIndex ? 1 : 0
    ),
    teacherActionValueWeights: new Array(decision.legalCount).fill(1)
  };
  const cleanStep = { ...baseStep, advantage: -1 };
  const correctedTrajectory = {
    gameId: "run-a-weight-equivalence",
    playerId: actorId,
    deckId: "test-deck",
    condition: "test",
    completed: true,
    steps: [correctedStep, cleanStep]
  };
  const strippedTrajectory = {
    ...correctedTrajectory,
    steps: [{ ...baseStep }, cleanStep]
  };
  const correctedModel = deserializeNeuralModel(initialCheckpoint);
  const strippedModel = deserializeNeuralModel(initialCheckpoint);
  await trainRecurrentPpo(correctedModel, [correctedTrajectory], {
    epochs: 1,
    batchSize: 1,
    learningRate: 0.0001,
    teacherConsumptionPolicy: "record-only-v1",
    selectBestEpoch: false,
    random: seededRandom(77)
  });
  await trainRecurrentPpo(strippedModel, [strippedTrajectory], {
    epochs: 1,
    batchSize: 1,
    learningRate: 0.0001,
    teacherConsumptionPolicy: "record-only-v1",
    selectBestEpoch: false,
    random: seededRandom(77)
  });
  assert.deepEqual(
    serializeNeuralModel(correctedModel).weights,
    serializeNeuralModel(strippedModel).weights
  );
});

test("PPO training reports batch and epoch progress with metrics", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const legal = enumerateLegalActions(game, actorId);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, legal, { greedy: true });
  const trajectories = [{
    gameId: "ppo-progress",
    playerId: actorId,
    completed: true,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding.slice(0, decision.legalCount * ACTION_DIM),
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 1,
      return: 1,
      teacherIndex: decision.selectedIndex,
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      teacherCorrectionEligible: true,
      teacherVerificationStatus: "verified",
      teacherPolicyEligible: true,
      teacherConfirmation: {
        determinizationAudit: { version: 1, complete: true }
      },
      teacherConfidence: 1,
      teacherActionValueTargets: Array.from({ length: decision.legalCount }, (_, index) => index === decision.selectedIndex ? 1 : 0),
      teacherActionValueWeights: Array.from({ length: decision.legalCount }, (_, index) => index === decision.selectedIndex ? 1 : 0)
    }]
  }];
  const packed = packPpoBatch(trajectories);
  assert.equal(packed.teacherActionValueTargets[decision.selectedIndex], 1);
  assert.equal(packed.teacherActionValueWeights[decision.selectedIndex], 1);
  const stalePacked = packPpoBatch([{
    ...trajectories[0],
    steps: trajectories[0].steps.map((item) => ({
      ...item,
      teacherLabelVersion: TEACHER_LABEL_VERSION - 1
    }))
  }]);
  assert.equal(stalePacked.teacherWeights[0], 0);
  assert.equal(stalePacked.teacherActionValueWeights[decision.selectedIndex], 0);
  const batches = [];
  const epochs = [];
  const anchor = deserializeNeuralModel(serializeNeuralModel(model));
  const stableAnchor = deserializeNeuralModel(serializeNeuralModel(model));
  await trainRecurrentPpo(model, trajectories, {
    epochs: 1,
    batchSize: 1,
    gradientConflictDiagnostics: true,
    auxiliaryTrajectories: [{ ...trajectories[0], gameId: "off-policy-replay", replay: true }],
    anchorModels: [
      { model: anchor, weight: 0.75 },
      { model: stableAnchor, weight: 0.25 }
    ],
    onBatch: (item) => batches.push(item),
    onEpoch: (item) => epochs.push(item)
  });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].completedBatches, 1);
  assert.equal(batches[0].totalBatches, 1);
  assert.equal(Number.isFinite(batches[0].metrics.loss), true);
  assert.equal(Number.isFinite(batches[0].metrics.actionValueLoss), true);
  assert.equal(Number.isFinite(batches[0].metrics.teacherActionValueLoss), true);
  assert.equal(Number.isFinite(batches[0].metrics.teacherLoss), true);
  assert.equal(Number.isFinite(batches[0].metrics.teacherRankingLoss), true);
  assert.equal(Number.isFinite(batches[0].metrics.anchorKl), true);
  assert.equal(Number.isFinite(batches[0].metrics.gradientNorm), true);
  assert.equal(epochs.length, 1);
  assert.equal(epochs[0].epoch, 1);
  assert.equal(model.metadata.offPolicyReplayExcludedFromPpo, 1);
  assert.equal(model.metadata.auxiliarySupervisionTrajectories, 1);
  assert.equal(model.metadata.gradientConflictDiagnostics.optimizerMutation, false);
  assert.equal(
    model.metadata.gradientConflictDiagnostics.cosineMatrix["ppo:unknown"]["ppo:unknown"],
    1
  );
});

test("PPO gives high-regret teacher disagreements a focused correction pass", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, enumerateLegalActions(game, actorId), { greedy: true });
  const trajectory = {
    gameId: "teacher-correction",
    playerId: actorId,
    completed: true,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: 0,
      legalCount: 2,
      oldLogProbability: 0,
      value: 0,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 0,
      return: 0,
      teacherIndex: 1,
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      teacherCorrectionEligible: true,
      teacherVerificationStatus: "verified",
      teacherPolicyEligible: true,
      teacherConfirmation: {
        determinizationAudit: { version: 1, complete: true }
      },
      teacherConfidence: 0.8,
      teacherSelectedRegret: 0.2,
      teacherRankingMargin: 0.1,
      teacherTargets: [0, 1],
      teacherActionValueTargets: [-0.5, 0.5],
      teacherActionValueWeights: [0.8, 0.8],
      turningPoint: "teacher-critical"
    }, {
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: 0,
      legalCount: 2,
      oldLogProbability: 0,
      value: 0,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 0,
      return: 0,
      teacherIndex: 1,
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      teacherCorrectionEligible: false,
      teacherVerificationStatus: "provisional",
      teacherPolicyEligible: false,
      teacherActionValueEligible: true,
      teacherConfirmation: {
        independent: true,
        seedBanks: { disjoint: true },
        determinizationAudit: { version: 1, complete: true },
        validPairedSamples: 8,
        validRates: { recommended: 1, selected: 1 },
        pairedEvidence: { lowerBound: 0.05 },
        evaluatorComparison: {
          available: true,
          independent: true,
          conflict: false,
          materialConflict: false,
          agreesOnDirection: true,
          primaryDelta: 0.2,
          independentDelta: 0.15
        }
      },
      teacherConfidence: 0.8,
      teacherSelectedRegret: 0.2,
      teacherTargets: [0, 1],
      teacherActionValueTargets: [-0.5, 0.5],
      teacherActionValueWeights: [0.8, 0.8]
    }]
  };
  const phases = [];
  await trainRecurrentPpo(model, [trajectory], {
    epochs: 1,
    batchSize: 1,
    teacherCorrectionFraction: 0.35,
    onBatch: (item) => phases.push(item.phase)
  });
  assert.deepEqual(phases, ["teacher-correction", "ppo", "provisional-action-value"]);
  assert.equal(model.metadata.teacherCorrectionChunks, 1);
  assert.equal(model.metadata.teacherCorrectionSteps, 1);
  const mass = model.metadata.correctionBalance.provisionalActionValue.effectiveMassCap;
  assert.ok(mass.appliedProvisionalByDeck.unknown
    <= mass.verifiedByDeck.unknown * mass.maximumVerifiedRatioPerDeck + 1e-9);
});

test("PPO trains deterministic proof labels in their own correction phase", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, [
    { kind: "endTurn" },
    { kind: "passShowdown" }
  ], { greedy: true });
  const proofIndex = 1;
  const trajectory = {
    gameId: "proof-correction",
    playerId: actorId,
    completed: true,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: 0,
      legalCount: decision.legalCount,
      oldLogProbability: 0,
      value: 0,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 0,
      return: 0,
      proofLabelVersion: PROOF_LABEL_VERSION,
      proofCorrectionEligible: true,
      proofConfidence: 1,
      proofIndex,
      proofKind: "immediate-terminal-win",
      proofTargets: Array.from({ length: decision.legalCount }, (_, index) => index === proofIndex ? 1 : 0),
      proofActionValueTargets: Array.from({ length: decision.legalCount }, (_, index) =>
        index === proofIndex ? 1 : index === 0 ? -1 : 0),
      proofActionValueWeights: Array.from({ length: decision.legalCount }, (_, index) =>
        index === proofIndex || index === 0 ? 1 : 0)
    }]
  };
  const phases = [];
  await trainRecurrentPpo(model, [trajectory], {
    epochs: 1,
    batchSize: 1,
    teacherCorrectionFraction: 0.35,
    onBatch: (item) => phases.push(item.phase)
  });
  assert.deepEqual(phases, ["proof-correction", "ppo"]);
  assert.equal(model.metadata.proofCorrectionChunks, 1);
  assert.equal(model.metadata.teacherCorrectionChunks, 0);
  assert.ok(model.metadata.correctionBalance.policyConnectedMass.proofPolicyMass > 0);
  assert.ok(model.metadata.correctionBalance.policyConnectedMass.totalPolicyConnectedMass > 0);
});

test("PPO adds verified counterfactual macro choices only to the teacher-correction phase", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  const macroStep = {
    state: decision.stateEncoding,
    actions: decision.actionEncoding,
    selectedIndex: 1,
    legalCount: 2,
    originalLegalCount: decision.legalCount,
    oldLogProbability: 0,
    value: 0,
    beliefTarget: new Float32Array(decision.belief.length),
    initialMemory: decision.initialMemory,
    advantage: 0.8,
    return: 0.5,
    teacherIndex: 1,
    teacherLabelVersion: TEACHER_LABEL_VERSION,
    teacherCorrectionEligible: true,
    teacherVerificationStatus: "verified",
    teacherConfidence: 0.8,
    imitation: true,
    source: "simulation-teacher-macro"
  };
  const trajectory = {
    gameId: "teacher-macro-correction",
    playerId: actorId,
    completed: true,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: 0,
      legalCount: 2,
      oldLogProbability: 0,
      value: 0,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 0,
      return: 0,
      teacherIndex: 1,
      teacherLabelVersion: TEACHER_LABEL_VERSION,
      teacherCorrectionEligible: true,
      teacherVerificationStatus: "verified",
      teacherPolicyEligible: true,
      teacherConfirmation: {
        determinizationAudit: { version: 1, complete: true }
      },
      teacherConfidence: 0.8,
      teacherSelectedRegret: 0.2,
      teacherMacroDemonstrationSteps: [macroStep]
    }]
  };
  const phases = [];
  await trainRecurrentPpo(model, [trajectory], {
    epochs: 1,
    batchSize: 1,
    teacherCorrectionFraction: 0.35,
    onBatch: (item) => phases.push(item.phase)
  });
  assert.deepEqual(phases, ["teacher-correction", "teacher-correction", "ppo"]);
  assert.equal(model.metadata.teacherMacroCorrectionChunks, 1);
  assert.equal(model.metadata.teacherCorrectionChunks, 2);
});

test("PPO trains verified defeat reviews in a separate postmortem correction phase", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  const correctionStep = {
    state: decision.stateEncoding,
    actions: decision.actionEncoding,
    selectedIndex: Math.min(1, decision.legalCount - 1),
    legalCount: decision.legalCount,
    originalLegalCount: decision.legalCount,
    oldLogProbability: 0,
    value: 0,
    beliefTarget: new Float32Array(decision.belief.length),
    initialMemory: decision.initialMemory,
    advantage: 0.8,
    return: 0.5,
    teacherIndex: Math.min(1, decision.legalCount - 1),
    teacherLabelVersion: TEACHER_LABEL_VERSION,
    teacherCorrectionEligible: true,
    teacherVerificationStatus: "verified",
    teacherConfidence: 0.8,
    teacherTargets: Array.from({ length: decision.legalCount }, (_, index) =>
      index === Math.min(1, decision.legalCount - 1) ? 1 : 0),
    postmortemVersion: POSTMORTEM_REVIEW_VERSION,
    imitation: true,
    source: "defeat-postmortem"
  };
  const trajectory = {
    gameId: "defeat-postmortem-correction",
    playerId: actorId,
    completed: true,
    resultClass: "loss",
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: -1,
      return: -1,
      teacherIndex: decision.selectedIndex,
      postmortemReview: {
        version: POSTMORTEM_REVIEW_VERSION,
        avoidableLoss: true,
        independentConfirmation: true,
        confirmationValidity: true,
        determinizationAudit: { complete: true },
        cause: "missed-action-before-stop"
      },
      postmortemCorrectionSteps: [correctionStep]
    }]
  };
  const phases = [];
  await trainRecurrentPpo(model, [trajectory], {
    epochs: 1,
    batchSize: 1,
    teacherCorrectionFraction: 0.35,
    onBatch: (item) => phases.push(item.phase)
  });
  assert.deepEqual(phases, ["postmortem-correction", "ppo"]);
  assert.equal(model.metadata.postmortemCorrectionChunks, 1);
  assert.equal(model.metadata.teacherCorrectionChunks, 0);
});

test("PPO chunk ordering round-robins across training strata", () => {
  const chunks = [
    { id: "a1", deckId: "a", matchupType: "mirror", condition: "first", resultClass: "win", marginClass: "close", opponentGeneration: 1 },
    { id: "a2", deckId: "a", matchupType: "mirror", condition: "first", resultClass: "win", marginClass: "close", opponentGeneration: 1 },
    { id: "a3", deckId: "a", matchupType: "mirror", condition: "first", resultClass: "win", marginClass: "close", opponentGeneration: 1 },
    { id: "b1", deckId: "b", matchupType: "cross", condition: "second", resultClass: "loss", marginClass: "blowout", opponentGeneration: 0 },
    { id: "b2", deckId: "b", matchupType: "cross", condition: "second", resultClass: "loss", marginClass: "blowout", opponentGeneration: 0 }
  ];
  const ordered = stratifiedChunkOrder(chunks, () => 0.5);
  assert.notEqual(ordered[0].deckId, ordered[1].deckId);
  assert.deepEqual(new Set(ordered.map((item) => item.id)), new Set(chunks.map((item) => item.id)));
  const summary = summarizeTrainingStrata(chunks);
  assert.deepEqual(summary.dimensions.deck, { a: 3, b: 2 });
  assert.deepEqual(summary.dimensions.result, { win: 3, loss: 2 });
});

test("a failed epoch retention guard restores its starting weights", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, enumerateLegalActions(game, actorId), { greedy: true });
  const trajectory = {
    gameId: "guard-rollback", playerId: actorId, completed: true, deckId: decks[0].id,
    steps: [{
      state: decision.stateEncoding, actions: decision.actionEncoding, selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount, oldLogProbability: decision.logProbability, value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length), initialMemory: decision.initialMemory,
      advantage: 1, return: 1, teacherIndex: decision.selectedIndex, teacherConfidence: 1
    }]
  };
  const before = serializeNeuralModel(model).weights;
  const trained = await trainRecurrentPpo(model, [trajectory], { epochs: 1, batchSize: 1, learningRate: 0.01, epochGuard: () => ({ passed: false, reason: "test" }) });
  assert.deepEqual(serializeNeuralModel(model).weights, before);
  assert.equal(trained.epochGuards[0].passed, false);
  assert.equal(model.metadata.epochs, 0);
});

test("PPO keeps the best accepted retention epoch instead of the last epoch", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, enumerateLegalActions(game, actorId), { greedy: true });
  const trajectory = {
    gameId: "best-epoch", playerId: actorId, completed: true, deckId: decks[0].id,
    steps: [{
      state: decision.stateEncoding, actions: decision.actionEncoding, selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount, oldLogProbability: decision.logProbability, value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length), initialMemory: decision.initialMemory,
      advantage: 1, return: 1, teacherIndex: decision.selectedIndex, teacherConfidence: 1
    }]
  };
  let firstEpochOptimizerState = null;
  const trained = await trainRecurrentPpo(model, [trajectory], {
    epochs: 2,
    batchSize: 1,
    learningRate: 0.001,
    selectBestEpoch: true,
    epochGuard: ({ epoch }) => ({ passed: true, score: epoch === 1 ? 0.5 : 0.25 }),
    onEpochCheckpoint: ({ epoch, optimizerState }) => {
      if (epoch === 1) firstEpochOptimizerState = optimizerState;
    }
  });
  assert.equal(trained.epochGuards.every((guard) => guard.passed), true);
  assert.equal(model.metadata.acceptedEpochs, 2);
  assert.equal(model.metadata.selectedEpoch, 1);
  assert.equal(model.metadata.epochs, 1);
  assert.equal(model.metadata.selectedEpochScore, 0.5);
  assert.deepEqual(
    (await serializeOptimizer(trained.optimizer, model.generation)).weights,
    firstEpochOptimizerState.weights
  );
});

test("PPO resumes from an epoch checkpoint with model, Adam moments, selection state, and RNG intact", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const initial = createNeuralModel();
  const decision = createNeuralSession(initial).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  const trajectory = {
    gameId: "epoch-resume",
    playerId: actorId,
    completed: true,
    deckId: decks[0].id,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 1,
      return: 1,
      teacherIndex: decision.selectedIndex,
      teacherConfidence: 0
    }]
  };
  const initialCheckpoint = serializeNeuralModel(initial);
  const fullModel = deserializeNeuralModel(initialCheckpoint);
  const fullRandom = seededRandom(9191);
  const full = await trainRecurrentPpo(fullModel, [trajectory], {
    epochs: 2,
    batchSize: 1,
    learningRate: 0.001,
    random: fullRandom,
    selectBestEpoch: true,
    baselineSelectionScore: 0.5,
    epochGuard: ({ epoch }) => ({ passed: true, score: 0.55 + epoch * 0.01 })
  });

  const interruptedModel = deserializeNeuralModel(initialCheckpoint);
  const interruptedRandom = seededRandom(9191);
  let checkpoint = null;
  await assert.rejects(trainRecurrentPpo(interruptedModel, [trajectory], {
    epochs: 2,
    batchSize: 1,
    learningRate: 0.001,
    random: interruptedRandom,
    selectBestEpoch: true,
    baselineSelectionScore: 0.5,
    epochGuard: ({ epoch }) => ({ passed: true, score: 0.55 + epoch * 0.01 }),
    onEpochCheckpoint: (item) => {
      if (item.epoch !== 1) return;
      checkpoint = {
        candidate: serializeNeuralModel(interruptedModel),
        optimizerState: item.optimizerState,
        randomState: item.randomState,
        selectionState: item.selectionState
      };
      throw new Error("simulated interruption");
    }
  }), /simulated interruption/);
  assert.ok(checkpoint);

  const resumedModel = deserializeNeuralModel(checkpoint.candidate);
  const resumedRandom = seededRandom(1);
  resumedRandom.setState(checkpoint.randomState);
  const resumedOptimizer = await restoreAdamOptimizer(checkpoint.optimizerState, 0.001);
  const resumed = await trainRecurrentPpo(resumedModel, [trajectory], {
    epochs: 2,
    startEpoch: 1,
    resumeState: checkpoint.selectionState,
    batchSize: 1,
    learningRate: 0.001,
    optimizer: resumedOptimizer,
    random: resumedRandom,
    selectBestEpoch: true,
    baselineSelectionScore: 0.5,
    epochGuard: ({ epoch }) => ({ passed: true, score: 0.55 + epoch * 0.01 })
  });
  assert.deepEqual(serializeNeuralModel(resumedModel).weights, serializeNeuralModel(fullModel).weights);
  const optimizerPayload = async (optimizer, generation) =>
    (await serializeOptimizer(optimizer, generation)).weights
      .map(({ shape, values }) => ({ shape, values }));
  assert.deepEqual(
    await optimizerPayload(resumed.optimizer, resumedModel.generation),
    await optimizerPayload(full.optimizer, fullModel.generation)
  );
  assert.equal(resumedModel.metadata.selectedEpoch, fullModel.metadata.selectedEpoch);
});

test("PPO resume preserves top-two candidates and still runs final confirmation and audit", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const initial = createNeuralModel();
  const decision = createNeuralSession(initial).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  const trajectory = {
    gameId: "final-selector-resume",
    playerId: actorId,
    completed: true,
    deckId: decks[0].id,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 1,
      return: 1,
      teacherIndex: decision.selectedIndex,
      teacherConfidence: 0
    }]
  };
  const initialCheckpoint = serializeNeuralModel(initial);
  const selector = async ({ epoch }) => ({
    selectionEligible: true,
    score: epoch === 1 ? 0.61 : 0.59,
    tieBreakerScore: epoch === 1 ? 0.2 : 0.1
  });
  const auditor = async ({ confirmation }) => ({
    selectionEligible: true,
    score: confirmation.score,
    tieBreakerScore: confirmation.tieBreakerScore
  });
  const fullModel = deserializeNeuralModel(initialCheckpoint);
  await trainRecurrentPpo(fullModel, [trajectory], {
    epochs: 2,
    batchSize: 1,
    learningRate: 0.001,
    selectBestEpoch: true,
    baselineSelectionScore: 0.5,
    baselineTieBreakerScore: 0,
    epochGuard: ({ epoch }) => ({ passed: true, score: 0.55 + epoch * 0.01 }),
    finalEpochSelector: selector,
    finalEpochAuditor: auditor
  });
  assert.equal(fullModel.metadata.selectedEpoch, 1);

  const interruptedModel = deserializeNeuralModel(initialCheckpoint);
  let checkpoint = null;
  await assert.rejects(trainRecurrentPpo(interruptedModel, [trajectory], {
    epochs: 2,
    batchSize: 1,
    learningRate: 0.001,
    selectBestEpoch: true,
    baselineSelectionScore: 0.5,
    baselineTieBreakerScore: 0,
    epochGuard: ({ epoch }) => ({ passed: true, score: 0.55 + epoch * 0.01 }),
    finalEpochSelector: selector,
    finalEpochAuditor: auditor,
    onEpochCheckpoint: (item) => {
      if (item.epoch !== 2) return;
      checkpoint = {
        candidate: serializeNeuralModel(interruptedModel),
        optimizerState: item.optimizerState,
        randomState: item.randomState,
        selectionState: item.selectionState
      };
      throw new Error("interrupt-before-final-selector");
    }
  }), /interrupt-before-final-selector/);
  assert.equal(checkpoint.selectionState.version, 2);
  assert.equal(checkpoint.selectionState.epochSelectionCandidates.length, 2);
  assert.ok(checkpoint.selectionState.finalSelectionBaselineSnapshot);

  const resumedModel = deserializeNeuralModel(checkpoint.candidate);
  const resumedOptimizer = await restoreAdamOptimizer(checkpoint.optimizerState, 0.001);
  const resumed = await trainRecurrentPpo(resumedModel, [trajectory], {
    epochs: 2,
    startEpoch: 2,
    resumeState: checkpoint.selectionState,
    batchSize: 1,
    learningRate: 0.001,
    optimizer: resumedOptimizer,
    selectBestEpoch: true,
    baselineSelectionScore: 0.5,
    baselineTieBreakerScore: 0,
    finalEpochSelector: selector,
    finalEpochAuditor: auditor
  });
  assert.equal(resumedModel.metadata.selectedEpoch, 1);
  assert.equal(resumedModel.metadata.finalEpochConfirmations.length, 2);
  assert.equal(resumedModel.metadata.finalEpochAudit.epoch, 1);
  assert.deepEqual(
    serializeNeuralModel(resumedModel).weights,
    serializeNeuralModel(fullModel).weights
  );
  resumed.optimizer.dispose();
});

test("evaluator evidence training changes only GRU/value and raises the preferred state", () => {
  const model = createNeuralModel();
  const preferredState = new Float32Array(STATE_DIM);
  const comparedState = new Float32Array(STATE_DIM);
  preferredState[0] = 1;
  comparedState[0] = -1;
  const before = serializeNeuralModel(model).weights;
  const optimizer = tf.train.adam(0.001);
  try {
    for (let iteration = 0; iteration < 24; iteration += 1) {
      trainEvaluatorValuePairBatch(model, [{
        preferredState,
        comparedState,
        preferredTarget: 1,
        comparedTarget: -1
      }], optimizer, { margin: 0.2 });
    }
  } finally {
    optimizer.dispose();
  }
  const after = serializeNeuralModel(model).weights;
  assert.ok(
    estimateEncodedNeuralValue(model, preferredState)
      > estimateEncodedNeuralValue(model, comparedState)
  );
  for (const layer of [
    "stateProjection",
    "actionProjection",
    "actionBias",
    "actionValue",
    "teacherProposalValue",
    "diagnostic",
    "belief"
  ]) {
    assert.deepEqual(after[layer], before[layer], `${layer} must remain frozen`);
  }
  assert.notDeepEqual(after.gru, before.gru);
  assert.notDeepEqual(after.value, before.value);
});

test("six isolated evaluator architectures share evidence without changing policy weights", () => {
  const preferredState = new Float32Array(STATE_DIM);
  const comparedState = new Float32Array(STATE_DIM);
  preferredState[0] = 1;
  comparedState[1] = 1;
  const game = createGame({ decks: decks.slice(0, 2), interactive: true });
  const informationSetHash = "architecture-test-information-set";
  const engineFingerprint = "sha256:architecture-test-engine";
  const baseStructuredState = createPublicStructuredEvidenceSnapshot(
    game,
    game.players[0].id,
    { engineFingerprint, informationSetHash }
  );
  const preferredStructuredState = structuredClone(baseStructuredState);
  const comparedStructuredState = structuredClone(baseStructuredState);
  preferredStructuredState.global.turnNumber = 2;
  comparedStructuredState.global.turnNumber = 1;
  for (const architecture of EVALUATOR_ARCHITECTURE_SPECS) {
    const model = createNeuralModel();
    attachEvaluatorArchitecture(model, architecture, {
      seed: `architecture-test:${architecture.id}`,
      warmStart: false
    });
    const behaviorBefore = neuralBehaviorHash(model);
    const evaluatorBefore = neuralEvaluatorLeafHash(model);
    const optimizer = tf.train.adam(0.001);
    try {
      trainEvaluatorValuePairBatch(model, [{
        preferredState,
        comparedState,
        preferredStructuredState,
        comparedStructuredState,
        informationSetHash,
        preferredTarget: 1,
        comparedTarget: -1
      }], optimizer, { margin: 0.2, engineFingerprint });
    } finally {
      optimizer.dispose();
    }
    assert.equal(neuralBehaviorHash(model), behaviorBefore, architecture.id);
    assert.notEqual(neuralEvaluatorLeafHash(model), evaluatorBefore, architecture.id);
    const checkpoint = serializeNeuralModel(model);
    const restored = deserializeNeuralModel(checkpoint);
    assert.equal(checkpoint.architecture.evaluator.id, architecture.id);
    assert.deepEqual(evaluatorLayerNames(restored), evaluatorLayerNames(model));
    const estimate = (candidate) => evaluatorRequiresStructuredV2(candidate)
      ? estimateEvidenceNeuralValue(
        candidate,
        preferredState,
        preferredStructuredState,
        { engineFingerprint, informationSetHash }
      )
      : estimateEncodedNeuralValue(candidate, preferredState);
    assert.equal(estimate(restored), estimate(model));
    assert.equal(
      evaluatorPathId(restored),
      `${architecture.id}-calibrated-multihead-policy-q-v2`
    );
  }
  const setLayers = evaluatorLayerNames((() => {
    const model = createNeuralModel();
    attachEvaluatorArchitecture(model, "structured-set-v2-128", {
      seed: 1,
      warmStart: false
    });
    return model;
  })());
  const attentionModel = createNeuralModel();
  attachEvaluatorArchitecture(attentionModel, "structured-attention-v2-128", {
    seed: 1,
    warmStart: false
  });
  assert.equal(setLayers.includes("evaluatorCardQuery"), false);
  assert.equal(evaluatorLayerNames(attentionModel).includes("evaluatorCardQuery"), true);
});

test("evaluator state, general-action, and mulligan Q heads train separately", () => {
  const model = createNeuralModel();
  attachEvaluatorArchitecture(model, "flat-v1-64", {
    seed: "multihead-policy-q-test",
    warmStart: false
  });
  const preferredState = new Float32Array(STATE_DIM);
  const comparedState = new Float32Array(STATE_DIM);
  preferredState[0] = 1;
  comparedState[0] = -1;
  const before = serializeNeuralModel(model).weights;
  const optimizer = tf.train.adam(0.001);
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      trainEvaluatorValuePairBatch(model, [{
        targetHead: EVALUATOR_TARGET_HEADS.generalActionQ,
        preferredState,
        comparedState,
        preferredTarget: 1,
        comparedTarget: -1
      }], optimizer, {
        targetHead: EVALUATOR_TARGET_HEADS.generalActionQ,
        margin: 0.2
      });
    }
  } finally {
    optimizer.dispose();
  }
  const afterGeneral = serializeNeuralModel(model).weights;
  assert.notDeepEqual(afterGeneral.evaluatorActionQ, before.evaluatorActionQ);
  assert.deepEqual(afterGeneral.evaluatorValue, before.evaluatorValue);
  assert.deepEqual(afterGeneral.evaluatorMulliganQ, before.evaluatorMulliganQ);
  const mulliganOptimizer = tf.train.adam(0.001);
  try {
    trainEvaluatorValuePairBatch(model, [{
      targetHead: EVALUATOR_TARGET_HEADS.mulliganQ,
      preferredState,
      comparedState,
      preferredTarget: 1,
      comparedTarget: -1
    }], mulliganOptimizer, {
      targetHead: EVALUATOR_TARGET_HEADS.mulliganQ,
      margin: 0.2
    });
  } finally {
    mulliganOptimizer.dispose();
  }
  const afterMulligan = serializeNeuralModel(model).weights;
  assert.notDeepEqual(
    afterMulligan.evaluatorMulliganQ,
    afterGeneral.evaluatorMulliganQ
  );
  assert.deepEqual(
    afterMulligan.evaluatorActionQ,
    afterGeneral.evaluatorActionQ
  );
  assert.deepEqual(afterMulligan.evaluatorValue, afterGeneral.evaluatorValue);
});

test("structured v2 evaluator training stages legacy pretraining, v2 finetuning, and bounded rehearsal", async () => {
  const engineFingerprint = "sha256:staged-structured-v2-engine";
  const game = createGame({ decks: decks.slice(0, 2), interactive: true });
  const structuredSteps = Array.from({ length: 4 }, (_, index) => {
    const reference = independentTerminalActionAuditReference(
      `staged-structured-v2-${index}`
    );
    const snapshot = createPublicStructuredEvidenceSnapshot(
      game,
      game.players[0].id,
      {
        engineFingerprint,
        informationSetHash: reference.informationSetHash
      }
    );
    for (const pair of reference.evaluatorStatePairs) {
      pair.recommendedStructuredState = structuredClone(snapshot);
      pair.selectedStructuredState = structuredClone(snapshot);
    }
    return {
      informationSetHash: reference.informationSetHash,
      legalActionKeys: ["passShowdown", "endTurn"],
      actionRankingAuditReference: reference
    };
  });
  const legacyReference = independentTerminalActionAuditReference(
    "staged-legacy-v1"
  );
  const trajectories = [{
    gameId: "staged-structured-v2-game",
    completed: true,
    steps: [...structuredSteps, {
      informationSetHash: legacyReference.informationSetHash,
      legalActionKeys: ["passShowdown", "endTurn"],
      actionRankingAuditReference: legacyReference
    }]
  }];
  const model = createNeuralModel();
  attachEvaluatorArchitecture(model, "structured-set-v2-128", {
    seed: "staged-structured-v2-test",
    warmStart: false
  });
  const report = await trainEvaluatorFromAuditEvidence(
    model,
    async function* batchFactory() {
      yield trajectories;
    },
    {
      epochs: 4,
      batchSize: 64,
      learningRate: 0.0001,
      legacyRehearsalFraction: 0.2,
      maximumActionPairsPerDecision: 1,
      engineFingerprint
    }
  );
  assert.deepEqual(report.history.map((entry) => entry.stage), [
    "legacy-v1-common-pretraining",
    "structured-v2-only-finetune",
    "structured-v2-only-finetune",
    "structured-v2-finetune-with-legacy-rehearsal"
  ]);
  assert.equal(report.history[0].samples, 5);
  assert.equal(report.history[1].samples, 4);
  assert.equal(report.history[2].samples, 4);
  assert.equal(report.history[3].samples, 5);
  assert.ok(
    report.history[3].samples - report.history[2].samples
      <= report.history[3].samples * 0.2
  );
  assert.equal(report.legacyRehearsalFraction, 0.2);
});

test("evaluator training batches cross streamed archive boundaries", async () => {
  const references = Array.from({ length: 5 }, (_, index) =>
    independentTerminalActionAuditReference(`stream-batch-${index}`));
  const trajectoryChunks = references.map((reference, index) => [{
    gameId: `stream-batch-game-${index}`,
    completed: true,
    steps: [{
      informationSetHash: reference.informationSetHash,
      legalActionKeys: ["passShowdown", "endTurn"],
      actionRankingAuditReference: reference
    }]
  }]);
  const model = createNeuralModel();
  attachEvaluatorArchitecture(model, "flat-v1-64", {
    seed: "stream-batch-test",
    warmStart: false
  });
  const report = await trainEvaluatorFromAuditEvidence(
    model,
    async function* batchFactory() {
      for (const trajectories of trajectoryChunks) yield trajectories;
    },
    {
      epochs: 1,
      batchSize: 4,
      learningRate: 0.0001,
      maximumActionPairsPerDecision: 1
    }
  );
  assert.equal(report.history[0].samples, 5);
  assert.equal(report.history[0].batches, 2);
});

test("structured v1 partitions all legacy values and v2 stores public observations only", () => {
  const encoded = Float32Array.from(
    { length: STATE_DIM },
    (_, index) => index / STATE_DIM
  );
  const tokens = structuredStateTokens(encoded);
  const flattened = [
    ...tokens.scalars,
    ...tokens.cardZones.flatMap((zone) => [...zone]),
    ...tokens.battlefields.flatMap((field) => [
      ...field.features,
      ...field.units.flatMap((unit) => [...unit])
    ]),
    ...tokens.bases.flatMap((base) => base.flatMap((unit) => [...unit])),
    ...tokens.context
  ];
  assert.deepEqual(flattened, [...encoded]);

  const game = createGame({ decks: decks.slice(0, 2), interactive: true });
  const viewerId = game.players[0].id;
  const snapshot = createPublicStructuredEvidenceSnapshot(game, viewerId, {
    engineFingerprint: "sha256:structured-evidence-test-engine",
    informationSetHash: "structured-evidence-test-information-set"
  });
  assert.equal(validPublicStructuredEvidenceSnapshot(snapshot), true);
  assert.equal(validPublicStructuredEvidenceSnapshot(snapshot, {
    engineFingerprint: "sha256:other-engine"
  }), false);
  assert.equal(snapshot.featureAvailableMask.hiddenOpponentCards, false);
  assert.equal(snapshot.players[0].hand.length, game.players[0].hand.length);
  assert.equal(snapshot.players[1].hand.length, 0);
  assert.equal(snapshot.players[1].handCount, game.players[1].hand.length);
  recordPublicTurnEvent(game, {
    kind: "response",
    outcome: "pass",
    actorId: viewerId,
    visibility: "public"
  });
  const eventSnapshot = createPublicStructuredEvidenceSnapshot(
    game,
    viewerId,
    {
      engineFingerprint: "sha256:structured-evidence-test-engine",
      informationSetHash: "structured-evidence-test-information-set"
    }
  );
  const eventEncoding = encodePublicStructuredEvidence(eventSnapshot, {
    engineFingerprint: "sha256:structured-evidence-test-engine",
    informationSetHash: "structured-evidence-test-information-set",
    legacyState: encoded
  });
  assert.equal(eventSnapshot.turnEvents.at(-1).outcome, "pass");
  assert.ok(eventEncoding.global[50] > 0);
  assert.ok([...eventEncoding.turnEventMask].some((value) => value === 1));
  game.publicTurnEvents = [];
  game.publicTurnEventSequence = 0;
  recordPublicTurnEvent(game, {
    kind: "decision",
    actionKind: "beginPlayCard",
    actorId: viewerId,
    sourceCardNumber: game.players[0].legend.cardNumber,
    visibility: "public"
  });
  for (let index = 0; index < 70; index += 1) {
    recordPublicTurnEvent(game, {
      kind: "decision",
      actionKind: "confirmPayment",
      actorId: viewerId,
      count: 1,
      visibility: "public"
    });
  }
  const prioritizedSnapshot = createPublicStructuredEvidenceSnapshot(
    game,
    viewerId,
    {
      engineFingerprint: "sha256:structured-evidence-test-engine",
      informationSetHash: "structured-evidence-test-information-set"
    }
  );
  assert.equal(prioritizedSnapshot.turnEvents.length, 32);
  assert.equal(
    prioritizedSnapshot.turnEvents.some((event) =>
      event.actionKind === "beginPlayCard"),
    true,
    "strategic card play survives payment-summary overflow"
  );

  const playedCard = game.players[0].legend;
  const action = {
    kind: "activateCard",
    cardId: playedCard.instanceId,
    abilityId: "structured-relation-test"
  };
  const transition = createPublicStructuredEvidenceTransition(
    game,
    structuredClone(game),
    viewerId,
    {
      action,
      engineFingerprint: "sha256:structured-evidence-test-engine",
      informationSetHash: "structured-evidence-test-information-set"
    }
  );
  const transitionEncoding = encodePublicStructuredEvidence(transition, {
    engineFingerprint: "sha256:structured-evidence-test-engine",
    informationSetHash: "structured-evidence-test-information-set",
    legacyState: encoded
  });
  assert.ok(
    [...transitionEncoding.actionSourceMask]
      .some((value) => value === 1)
  );
  assert.equal(
    [...transitionEncoding.actionTargetMask]
      .some((value) => value === 1),
    false
  );
  const reference = createLeafValueReference([{
    simulationSeed: 7,
    correctState: encoded,
    comparedState: encoded,
    correctStructuredState: snapshot,
    comparedStructuredState: snapshot,
    correctOutcome: 1,
    comparedOutcome: 0
  }]);
  assert.equal(
    reference.pairs[0].correctStructuredState.encoderFingerprint,
    snapshot.encoderFingerprint
  );
});

test("structured v2 action evidence is bound to its parent information set", () => {
  const reference = independentTerminalActionAuditReference(
    "structured-v2-provenance"
  );
  const game = createGame({ decks: decks.slice(0, 2), interactive: true });
  const engineFingerprint = "sha256:structured-v2-provenance-engine";
  const snapshot = createPublicStructuredEvidenceSnapshot(
    game,
    game.players[0].id,
    {
      engineFingerprint,
      informationSetHash: reference.informationSetHash
    }
  );
  for (const pair of reference.evaluatorStatePairs) {
    pair.recommendedStructuredState = structuredClone(snapshot);
    pair.selectedStructuredState = structuredClone(snapshot);
  }
  assert.equal(validActionRankingAuditReference(reference, {
    informationSetHash: reference.informationSetHash,
    legalActionKeys: ["passShowdown", "endTurn"]
  }), true);
  reference.evaluatorStatePairs[0].selectedStructuredState.informationSetHash =
    "wrong-information-set";
  assert.equal(validActionRankingAuditReference(reference, {
    informationSetHash: reference.informationSetHash,
    legalActionKeys: ["passShowdown", "endTurn"]
  }), false);
});

test("evaluator audit 0/1 terminal outcomes become tanh +1/-1 targets", () => {
  const reference = independentTerminalActionAuditReference(
    "value-target-range"
  );
  const leafValueAuditReference = createLeafValueReference([
    terminalLeafValuePair(901)
  ], {
    source: "teacher-independent-production-cutoff-audit",
    policyCorrectionIndependent: true
  });
  const samples = evaluatorValueTrainingSamples([{
    gameId: "value-target-range",
    playerId: "p1",
    completed: true,
    steps: [{
      informationSetHash: reference.informationSetHash,
      legalActionKeys: ["passShowdown", "endTurn"],
      actionRankingAuditReference: reference,
      leafValueAuditReference
    }]
  }], { maximumActionPairsPerDecision: 1 });
  assert.equal(samples.length, 2);
  for (const sample of samples) {
    assert.equal(sample.preferredTarget, 1);
    assert.equal(sample.comparedTarget, -1);
  }
  assert.deepEqual(samples.map((sample) => sample.source).sort(), [
    "terminal-action-ranking",
    "terminal-leaf-ranking"
  ]);
});

test("a soft-screened epoch still reaches independent top-two confirmation", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(
    game,
    actorId,
    enumerateLegalActions(game, actorId),
    { greedy: true }
  );
  const trajectory = {
    gameId: "soft-screen-confirmation",
    playerId: actorId,
    completed: true,
    deckId: decks[0].id,
    steps: [{
      state: decision.stateEncoding,
      actions: decision.actionEncoding,
      selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount,
      oldLogProbability: decision.logProbability,
      value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length),
      initialMemory: decision.initialMemory,
      advantage: 1,
      return: 1,
      teacherIndex: decision.selectedIndex,
      teacherConfidence: 0
    }]
  };
  const confirmations = [];
  await trainRecurrentPpo(model, [trajectory], {
    epochs: 2,
    batchSize: 1,
    learningRate: 0.001,
    selectBestEpoch: true,
    baselineSelectionScore: 0.5,
    epochGuard: ({ epoch }) => ({
      passed: true,
      selectionEligible: false,
      score: 0.44 + epoch * 0.01
    }),
    finalEpochSelector: async ({ epoch }) => {
      confirmations.push(epoch);
      return {
        selectionEligible: false,
        score: 0.45,
        tieBreakerScore: 0,
        reasons: ["independent-confirmation-failed"]
      };
    }
  });
  assert.deepEqual(confirmations.sort(), [1, 2]);
  assert.equal(model.metadata.selectedEpoch, 0);
});

test("PPO never selects an epoch marked ineligible by the practical guard", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, enumerateLegalActions(game, actorId), { greedy: true });
  const before = serializeNeuralModel(model).weights;
  const trajectory = {
    gameId: "ineligible-epoch", playerId: actorId, completed: true, deckId: decks[0].id,
    steps: [{
      state: decision.stateEncoding, actions: decision.actionEncoding, selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount, oldLogProbability: decision.logProbability, value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length), initialMemory: decision.initialMemory,
      advantage: 1, return: 1, teacherIndex: decision.selectedIndex, teacherConfidence: 1
    }]
  };
  await trainRecurrentPpo(model, [trajectory], {
    epochs: 1,
    batchSize: 1,
    selectBestEpoch: true,
    baselineSelectionScore: 0.5,
    epochGuard: () => ({ passed: true, selectionEligible: false, score: 1 })
  });
  assert.deepEqual(serializeNeuralModel(model).weights, before);
  assert.equal(model.metadata.selectedEpoch, 0);
  assert.equal(model.generation, 0);
});

test("PPO restores the pre-training baseline when every accepted epoch scores lower", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, enumerateLegalActions(game, actorId), { greedy: true });
  const trajectory = {
    gameId: "baseline-best", playerId: actorId, completed: true, deckId: decks[0].id,
    steps: [{
      state: decision.stateEncoding, actions: decision.actionEncoding, selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount, oldLogProbability: decision.logProbability, value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length), initialMemory: decision.initialMemory,
      advantage: 1, return: 1, teacherIndex: decision.selectedIndex, teacherConfidence: 1
    }]
  };
  const before = serializeNeuralModel(model).weights;
  await trainRecurrentPpo(model, [trajectory], {
    epochs: 2,
    batchSize: 1,
    learningRate: 0.001,
    selectBestEpoch: true,
    baselineSelectionScore: 0.75,
    epochGuard: ({ epoch }) => ({ passed: true, score: 0.6 - epoch * 0.1 })
  });
  assert.deepEqual(serializeNeuralModel(model).weights, before);
  assert.equal(model.generation, 0);
  assert.equal(model.metadata.selectedEpoch, 0);
  assert.equal(model.metadata.baselineSelected, true);
});

test("PPO waits for the minimum evidence window before early stopping", async () => {
  const game = createGame({ decks: decks.slice(0, 2), interactive: true, manualActionChainPriority: true });
  const actorId = activeActorId(game);
  const model = createNeuralModel();
  const decision = createNeuralSession(model).decide(game, actorId, enumerateLegalActions(game, actorId), { greedy: true });
  const trajectory = {
    gameId: "early-stop", playerId: actorId, completed: true, deckId: decks[0].id,
    steps: [{
      state: decision.stateEncoding, actions: decision.actionEncoding, selectedIndex: decision.selectedIndex,
      legalCount: decision.legalCount, oldLogProbability: decision.logProbability, value: decision.value,
      beliefTarget: new Float32Array(decision.belief.length), initialMemory: decision.initialMemory,
      advantage: 1, return: 1, teacherIndex: decision.selectedIndex, teacherConfidence: 1
    }]
  };
  const epochs = [];
  await trainRecurrentPpo(model, [trajectory], {
    epochs: 8,
    batchSize: 1,
    selectBestEpoch: true,
    baselineSelectionScore: 0.75,
    earlyStoppingPatience: 2,
    minimumEpochsBeforeEarlyStopping: 4,
    minimumScoreImprovement: 0.001,
    epochGuard: ({ epoch }) => ({ passed: true, score: 0.7 - epoch * 0.01 }),
    onEpoch: ({ epoch }) => epochs.push(epoch)
  });
  assert.deepEqual(epochs, [1, 2, 3, 4]);
  assert.equal(model.metadata.stoppedEarly, true);
  assert.equal(model.metadata.stopReason, "selection-score-plateau");
  assert.equal(model.metadata.minimumEpochsBeforeEarlyStopping, 4);
  assert.equal(model.metadata.selectedEpoch, 0);
});

test("legacy action kernels are zero-padded for the tactical action features", () => {
  const checkpoint = serializeNeuralModel(createNeuralModel());
  checkpoint.architecture.actionDim = LEGACY_ACTION_DIM;
  for (const name of ["actionProjection", "actionBias"]) {
    const kernel = checkpoint.weights[name][0];
    const rowSize = kernel.shape.slice(1).reduce((product, value) => product * value, 1);
    kernel.shape[0] = LEGACY_ACTION_DIM;
    kernel.values = kernel.values.slice(0, LEGACY_ACTION_DIM * rowSize);
  }
  const migrated = serializeNeuralModel(deserializeNeuralModel(checkpoint));
  assert.equal(migrated.architecture.actionDim, ACTION_DIM);
  assert.equal(migrated.weights.actionProjection[0].shape[0], ACTION_DIM);
  assert.equal(migrated.weights.actionBias[0].shape[0], ACTION_DIM);
});

test("v2 checkpoints preserve learned layers while zero-padding expanded inputs", () => {
  const checkpoint = serializeNeuralModel(createNeuralModel());
  checkpoint.version = 2;
  checkpoint.metadata.actionRepresentation = "semantic-tactical-v2";
  delete checkpoint.weights.actionValue;
  for (const [name, legacyRows] of [["gru", 1688], ["actionProjection", 128], ["actionBias", 128]]) {
    const kernel = checkpoint.weights[name][0];
    const rowSize = kernel.shape.slice(1).reduce((product, value) => product * value, 1);
    kernel.shape[0] = legacyRows;
    kernel.values = kernel.values.slice(0, legacyRows * rowSize);
  }
  const migrated = serializeNeuralModel(deserializeNeuralModel(checkpoint));
  assert.equal(migrated.version, NEURAL_MODEL_VERSION);
  assert.equal(migrated.weights.gru[0].shape[0], STATE_DIM);
  assert.equal(migrated.weights.actionProjection[0].shape[0], ACTION_DIM);
  assert.equal(migrated.weights.actionBias[0].shape[0], ACTION_DIM);
  assert.equal(migrated.weights.actionValue.length, 2);
  assert.equal(migrated.weights.actionProjection[0].values.slice(128 * 64).every((value) => value === 0), true);
});

test("v2 checkpoints forget the former composite tactical shortcut", () => {
  const checkpoint = serializeNeuralModel(createNeuralModel());
  checkpoint.metadata.actionRepresentation = "semantic-tactical-v2";
  for (const name of ["actionProjection", "actionBias"]) {
    const kernel = checkpoint.weights[name][0];
    const rowSize = kernel.shape.slice(1).reduce((product, value) => product * value, 1);
    const start = (LEGACY_ACTION_DIM + 15) * rowSize;
    kernel.values.fill(1, start, start + rowSize);
  }
  const migrated = serializeNeuralModel(deserializeNeuralModel(checkpoint));
  assert.equal(migrated.metadata.actionRepresentation, "semantic-tactical-v3");
  for (const name of ["actionProjection", "actionBias"]) {
    const kernel = migrated.weights[name][0];
    const rowSize = kernel.shape.slice(1).reduce((product, value) => product * value, 1);
    const start = (LEGACY_ACTION_DIM + 15) * rowSize;
    assert.deepEqual(kernel.values.slice(start, start + rowSize), new Array(rowSize).fill(0));
  }
});

test("Adam optimizer remains usable across repeated checkpoint serialization", async () => {
  const optimizer = await restoreAdamOptimizer(null, 0.01);
  const variable = tf.variable(tf.scalar(2));
  try {
    optimizer.minimize(() => variable.square(), false, [variable]);
    const first = await serializeOptimizer(optimizer, 1);
    const valueAfterFirstStep = variable.dataSync()[0];
    optimizer.minimize(() => variable.square(), false, [variable]);
    const second = await serializeOptimizer(optimizer, 1);
    assert.equal(first.weights.length > 1, true);
    assert.equal(second.weights.length, first.weights.length);
    assert.equal(second.weights[0].values[0], first.weights[0].values[0] + 1);
    assert.equal(variable.dataSync()[0] < valueAfterFirstStep, true);
  } finally {
    variable.dispose();
    optimizer.dispose();
  }
});

test("bootstrap quality gates reject corrupt data and accept measurable learning", () => {
  const validStep = {
    state: new Float32Array(STATE_DIM),
    actions: new Float32Array(ACTION_DIM),
    selectedIndex: 0,
    legalCount: 1,
    beliefTarget: new Float32Array(CARD_VOCABULARY.length),
    initialMemory: new Float32Array(64),
    advantage: 1,
    return: 1,
    teacherConfidence: 1,
    selectedKind: "endTurn",
    originalLegalCount: 1,
    actionSetTruncated: false
  };
  const trajectories = ["quality-1", "quality-2"].map((gameId, index) => ({ gameId, playerId: "p1", completed: true, steps: Array.from({ length: 10 }, () => ({ ...validStep })) }));
  const summaries = trajectories.map((trajectory, index) => ({ gameId: trajectory.gameId, completed: true, capped: false, firstPlayerId: index ? "p2" : "p1", deckIds: [decks[0].id, decks[1].id] }));
  const dataset = auditImitationDataset({
    collected: { trajectories, summaries, completedGames: 2, attemptedGames: 2, targetGames: 2 },
    split: { training: [trajectories[0]], validation: [trajectories[1]] },
    deckIds: [decks[0].id, decks[1].id]
  });
  assert.equal(dataset.passed, true);
  trajectories[0].steps[0].state[0] = Number.NaN;
  assert.equal(auditImitationDataset({ collected: { trajectories, summaries, completedGames: 2, attemptedGames: 2, targetGames: 2 }, split: { training: [trajectories[0]], validation: [trajectories[1]] }, deckIds: [decks[0].id, decks[1].id] }).passed, false);

  const quality = assessBehaviorCloningQuality({
    baseline: { decisionAccuracy: 0.2, policyLoss: 2 },
    validation: { decisionAccuracy: 0.35, decisionChanceAccuracy: 0.2, decisionSteps: 100, policyLoss: 1.5, valueMse: 0.8, beliefLoss: 0.4 },
    training: { decisionAccuracy: 0.4, policyLoss: 1.3 },
    validationGames: 10
  });
  assert.equal(quality.passed, true);
});

test("evaluator bootstrap stage handoff serializes models without callbacks", () => {
  const model = createNeuralModel();
  model.generation = 7;
  const request = serializeEvaluatorBootstrapStageRequest({
    dataRoot: "memory-safe-stage",
    processes: 12,
    maximumSelfPlayProcesses: 16,
    dynamicSelfPlayScaling: true,
    diagnosticDemand: {
      version: 1,
      role: "training",
      priority: "warning-only",
      officialEvidenceRuleChanged: false,
      items: [{
        evidenceKind: "action",
        phaseBand: "mid",
        actionClass: "target-effect-choice",
        deckSeat: "origins-leona:p2"
      }]
    },
    onAuditProgress: () => assert.fail("callback must not be serialized"),
    collection: {
      model,
      league: [model],
      teacherEvaluatorModels: [model],
      decks: [{ id: "deck-a" }],
      onStopRequested: () => assert.fail("callback must not be serialized")
    }
  }, { stageId: "stage-test" });
  assert.doesNotThrow(() => JSON.stringify(request));
  assert.equal(request.options.onAuditProgress, undefined);
  assert.equal(request.options.collection.onStopRequested, undefined);
  assert.equal(request.options.collection.checkpointTable.length, 1);
  const onAuditProgress = () => {};
  const onStopRequested = () => {};
  const hydrated = hydrateEvaluatorBootstrapStageRequest(request, {
    onAuditProgress,
    onStopRequested
  });
  assert.equal(hydrated.processes, 12);
  assert.equal(hydrated.maximumSelfPlayProcesses, 16);
  assert.equal(hydrated.dynamicSelfPlayScaling, true);
  assert.deepEqual(
    hydrated.diagnosticDemand,
    request.options.diagnosticDemand
  );
  assert.equal(hydrated.onAuditProgress, onAuditProgress);
  assert.equal(hydrated.collection.onStopRequested, onStopRequested);
  assert.equal(hydrated.collection.model.generation, 7);
  assert.equal(hydrated.collection.league[0].generation, 7);
  assert.equal(hydrated.collection.teacherEvaluatorModels[0].generation, 7);
  assert.equal(hydrated.collection.league[0], hydrated.collection.model);
  assert.equal(
    hydrated.collection.teacherEvaluatorModels[0],
    hydrated.collection.model
  );
  assert.notEqual(hydrated.collection.model, model);
});

test("evaluator bootstrap stage retries only missing result handoffs", () => {
  assert.equal(EVALUATOR_BOOTSTRAP_STAGE_MAX_ATTEMPTS, 3);
  assert.equal(evaluatorBootstrapStageAttemptDecision({
    result: null,
    attempt: 1
  }), "retry");
  assert.equal(evaluatorBootstrapStageAttemptDecision({
    result: null,
    attempt: 2
  }), "retry");
  assert.equal(evaluatorBootstrapStageAttemptDecision({
    result: null,
    attempt: 3
  }), "failed");
  assert.equal(evaluatorBootstrapStageAttemptDecision({
    result: null,
    attempt: 1,
    shutdownRequested: true
  }), "failed");
  assert.equal(evaluatorBootstrapStageAttemptDecision({
    result: { ok: false },
    attempt: 1
  }), "failed");
  assert.equal(evaluatorBootstrapStageAttemptDecision({
    result: { ok: true },
    attempt: 3
  }), "complete");
});

test("advanced deck mutations preserve card count, rune count and unique battlefield count", () => {
  const deck = decks.find((candidate) => new Set(candidate.runes.map((rune) => rune.domain)).size > 1) || decks[0];
  const model = { cardStats: {}, synergyStats: {}, battlefieldStats: {}, runeStats: {} };
  const cardsMutated = mutateCardPackage(deck, model, () => 0.3, 3);
  const runesMutated = mutateRuneDistribution(deck, model, () => 0.1);
  const fieldsMutated = mutateBattlefieldSuite(deck, model, () => 0.1);
  const sideboardMutated = mutateSideboardPackage(deck, model, () => 0.1);
  assert.equal(cardsMutated.main.length, deck.main.length);
  assert.equal(cardsMutated.evolution?.changes.length, 3);
  const registeredCounts = new Map();
  for (const card of [...cardsMutated.main, ...(cardsMutated.sideboard || [])]) {
    registeredCounts.set(card.name, (registeredCounts.get(card.name) || 0) + 1);
  }
  assert.equal([...registeredCounts.values()].every((count) => count <= 3), true);
  assert.equal([...cardsMutated.main, ...(cardsMutated.sideboard || [])].filter((card) => card.tags?.includes("Signature") || card.tags?.includes("Signature Spell")).length <= 3, true);
  assert.equal(runesMutated.runes.length, deck.runes.length);
  assert.equal(fieldsMutated.battlefields.length, deck.battlefields.length);
  assert.equal(new Set(fieldsMutated.battlefields.map((field) => field.cardNumber)).size, fieldsMutated.battlefields.length);
  assert.equal(sideboardMutated.sideboard.length <= DECK_RULES.sideboardMax, true);
  assert.equal(sideboardMutated.main.length, deck.main.length);
});

function currentEvidenceIndexFixture(overrides) {
  const empty = createEvaluatorBootstrapResultIndex({
    summaries: [{ completed: true, naturallyCompleted: true }], trajectories: []
  });
  const index = { ...empty, ...overrides,
    version: EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION,
    stratumVersion: EVALUATOR_AUDIT_STRATUM_VERSION };
  for (const suffix of ["Coverage", "PhaseCoverage", "ActionClassCoverage", "DeckPhaseCoverage"]) {
    index["structuredV2ActionReference" + suffix] = { ...(index["actionReference" + suffix] || {}) };
  }
  for (const suffix of ["Coverage", "PhaseCoverage", "DeckPhaseCoverage"]) {
    index["structuredV2LeafValue" + suffix] = { ...(index["leafValue" + suffix] || {}) };
  }
  index.structuredV2ActionReferenceIdentities = (index.actionReferenceIdentities || []).map((item) => item.identity);
  index.structuredV2LeafValuePairCount = index.leafValuePairCount || 0;
  return index;
}
