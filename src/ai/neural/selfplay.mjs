import {needsPaymentOptionDecision} from '../payment-options.mjs';
import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { createGame, currentMight } from "../../engine.mjs";
import { championMatchesLegend } from "../../engine/setup.mjs";
import { activeActorId, applyAiAction, auditDecisionBoundary, auditRecordedDecisionSafety, createAiDecisionCycleGuard, enumerateAiPolicyActions, actionKey, cloneGame, planPaymentActions } from "../actions.mjs";
import { reviewCombatContinuations, hasCombatSacrificePayoff } from "../combat-safety.mjs";
import { recommendPublicTacticalAction } from "../tactical-baseline.mjs";
import { updateDeckLearning } from "../deckbuilding.mjs";
import { DEFAULT_AI_MODEL, scoreActions } from "../policy.mjs";
import { ACTION_DIM, encodeOpponentDeckTarget } from "./encoding.mjs";
import {
  NEURAL_HIDDEN_SIZE,
  createNeuralSession,
  deserializeNeuralModel,
  estimateNeuralValue,
  serializeNeuralModel
} from "./model.mjs";
import { resolvePlannedPayment } from "../payment-planner.mjs";
import {
  runIndependentActionAuditCandidateRace,
  simulationTeacherDecision,
  TEACHER_LABEL_VERSION
} from "./teacher.mjs";
import { mulliganPlanProfile } from "../mulligan.mjs";
import { NATURAL_MIXTURE_SELECTION, naturalLeafSamplingChannel,
  naturalLeafMixtureSamplingFrame } from "./natural-leaf-sampling.mjs";
import { tacticalActionProfile } from "../action-tactics.mjs";
import { appendSpectatorReplayFrame, createSpectatorReplay, finalizeSpectatorReplay } from "../spectator-replay.mjs";
import {
  compactResourceReservationOutcome,
  completeResourceReservation,
  createResourceReservationIntent,
  observeResourceReservationAction,
  resourceReservationResolutionReason
} from "../resource-reservation.mjs";
import {
  compactHandOpportunityOutcome,
  completeHandOpportunityTracking,
  createHandOpportunityTracker,
  observeHandOpportunityWindow,
  recordHandOpportunityDecision,
  resolveHandOpportunityCards
} from "../hand-opportunity.mjs";
import {
  capturePostmortemCandidate,
  finalizePostmortemCandidate,
  retainPostmortemCandidate,
  reviewDefeatPostmortems
} from "./postmortem.mjs";
import { proofTeacherDecision } from "./proof-teacher.mjs";
import { certifiedIndependentEvaluators } from "./evaluator-certification.mjs";
import { createInformationSetHash } from "./teacher-contract.mjs";
import {
  createActionRankingAuditReference,
  createActionRankingReference,
  createLeafValueReference
} from "./action-ranking-reference.mjs";
import {
  evaluatorAuditActionClass,
  evaluatorAuditPhaseBand,
  normalizeEvaluatorAuditStratum
} from "./audit-strata.mjs";

export const NEURAL_LEARNING_TARGET_VERSION = 9;

export function teacherAuditCollectionBudgetExhausted(options = {}) {
  const actionExhausted =
    options.stopTeacherAfterActionAuditBudget === true
    && options.captureIndependentActionAudit === true
    && Number(options.actionAuditAttempts)
      >= Math.max(0, Number(options.actionAuditBudget) || 0);
  const leafExhausted =
    options.stopTeacherAfterLeafAuditBudget === true
    && options.captureIndependentLeafAudit === true
    && Number(options.leafAuditAttempts)
      >= Math.max(0, Number(options.leafAuditPairBudget) || 0);
  return actionExhausted || leafExhausted;
}

export function selectIndependentActionAuditCandidatePool(
  candidates = [],
  limit = 5,
  options = {}
) {
  const maximum = Math.max(1, Math.floor(Number(limit) || 5));
  const unique = [...new Map(
    candidates
      .filter((candidate) => candidate?.descriptor?.auditKey)
      .map((candidate) => [candidate.descriptor.auditKey, candidate])
  ).values()];
  const focusPhaseBands = new Set(options.focusPhaseBands || []);
  const focusActionClasses = new Set(options.focusActionClasses || []);
  for (const candidate of unique) {
    candidate.auditFocusPriority =
      (focusPhaseBands.has(candidate.stratum?.phaseBand) ? 2 : 0)
      + (focusActionClasses.has(candidate.stratum?.actionClass) ? 1 : 0);
  }
  const manifestSelection = options.evidenceProtocolManifest
    ?.candidateSelection;
  const guidedFraction = Number.isFinite(
    Number(manifestSelection?.evaluatorGuidedFraction)
  )
    ? Math.max(0, Math.min(
      1,
      Number(manifestSelection.evaluatorGuidedFraction)
    ))
    : 0.8;
  const strongSlots = Math.max(
    1,
    Math.min(maximum, Math.floor(maximum * guidedFraction))
  );
  const strong = [...unique]
    .sort(compareIndependentActionAuditCandidatePriority)
    .slice(0, strongSlots);
  const strongKeys = new Set(
    strong.map((candidate) => candidate.descriptor.auditKey)
  );
  const strongStrata = new Set(
    strong.map((candidate) => candidate.stratum?.key).filter(Boolean)
  );
  const exploration = unique
    .filter((candidate) =>
      !strongKeys.has(candidate.descriptor.auditKey))
    .sort((left, right) => {
      const leftNovel = strongStrata.has(left.stratum?.key) ? 0 : 1;
      const rightNovel = strongStrata.has(right.stratum?.key) ? 0 : 1;
      return rightNovel - leftNovel
        || stableSelfPlayHash(left.descriptor.auditKey)
          - stableSelfPlayHash(right.descriptor.auditKey)
        || left.descriptor.auditKey.localeCompare(
          right.descriptor.auditKey
        );
    })
    .slice(0, Math.max(0, maximum - strong.length));
  const explorationPopulation = Math.max(0, unique.length - strong.length);
  const explorationSlots = Math.max(0, maximum - strong.length);
  for (const candidate of strong) {
    candidate.selectionSource = "priority";
    candidate.samplingPropensity = {
      version: 1,
      contract: "action-evidence-candidate-sampling-propensity-v1",
      channel: "evaluator-guided-priority",
      channelProbability: guidedFraction,
      inclusionProbability: null,
      inclusionProbabilityReason: "deterministic-priority-selection",
      population: unique.length,
      slots: strongSlots
    };
  }
  for (const candidate of exploration) {
    candidate.selectionSource = "stratified-exploration";
    candidate.samplingPropensity = {
      version: 1,
      contract: "action-evidence-candidate-sampling-propensity-v1",
      channel: "evaluator-blind-stratified",
      channelProbability: 1 - guidedFraction,
      inclusionProbability: explorationPopulation > 0
        ? Math.min(1, explorationSlots / explorationPopulation)
        : null,
      inclusionProbabilityReason:
        "precommitted-stable-hash-within-blind-channel",
      population: explorationPopulation,
      slots: explorationSlots
    };
  }
  return [...strong, ...exploration];
}

export function actionAuditTeacherQuerySchedule(options = {}) {
  const candidateCount = Math.max(
    0,
    Math.floor(Number(options.candidateCount) || 0)
  );
  const poolSize = Math.max(
    1,
    Math.floor(Number(options.poolSize) || 5)
  );
  const teacherQueries = Math.max(
    0,
    Math.floor(Number(options.teacherQueries) || 0)
  );
  const maximumQueries = Math.max(
    1,
    Math.floor(Number(options.maximumQueries) || 24)
  );
  const baseFraction = Math.max(
    0,
    Math.min(1, Number(options.baseFraction) || 0)
  );
  const reducedFraction = Math.max(
    0,
    Math.min(
      baseFraction,
      Number.isFinite(Number(options.reducedFraction))
        ? Number(options.reducedFraction)
        : 0.35
    )
  );
  const saturationQueries = Math.max(
    1,
    Math.floor(Number(options.saturationQueries) || 8)
  );
  const queriesSincePoolChange = Math.max(
    0,
    teacherQueries
      - Math.max(
        0,
        Math.floor(Number(options.lastPoolChangeAtQuery) || 0)
      )
  );
  if (teacherQueries >= maximumQueries) {
    return {
      allowed: false,
      forceQuery: false,
      queryFraction: 0,
      reason: "action-audit-query-limit",
      candidateCount,
      queriesSincePoolChange
    };
  }
  if (candidateCount <= 2) {
    return {
      allowed: true,
      forceQuery: options.missingPhaseBand === true
        || options.missingActionClass === true
        || options.urgent === true
        || options.critical === true,
      queryFraction: baseFraction,
      reason: "candidate-pool-bootstrap",
      candidateCount,
      queriesSincePoolChange
    };
  }
  const important = options.urgent === true
    || options.critical === true
    || options.missingPhaseBand === true
    || options.missingActionClass === true;
  if (candidateCount < poolSize) {
    return {
      allowed: true,
      forceQuery: important,
      queryFraction: important ? 1 : reducedFraction,
      reason: important
        ? "candidate-pool-important-gap"
        : "candidate-pool-filling",
      candidateCount,
      queriesSincePoolChange
    };
  }
  if (important) {
    return {
      allowed: true,
      forceQuery: true,
      queryFraction: 1,
      reason: "candidate-pool-full-important",
      candidateCount,
      queriesSincePoolChange
    };
  }
  if (queriesSincePoolChange >= saturationQueries) {
    return {
      allowed: false,
      forceQuery: false,
      queryFraction: 0,
      reason: "candidate-pool-saturated",
      candidateCount,
      queriesSincePoolChange
    };
  }
  return {
    allowed: true,
    forceQuery: false,
    queryFraction: reducedFraction,
    reason: "candidate-pool-saturation-probe",
    candidateCount,
    queriesSincePoolChange
  };
}

export function teacherAuditPhaseFocusAllowsQuery(options = {}) {
  const phaseBand = options.currentPhaseBand;
  const leafFocus = new Set(options.leafFocusPhaseBands || []);
  const actionFocus = new Set(options.actionFocusPhaseBands || []);
  if (options.captureIndependentLeafAudit === true
    && leafFocus.size > 0
    && !leafFocus.has(phaseBand)) return false;
  if (options.deferIndependentActionAudit === true
    && actionFocus.size > 0
    && !actionFocus.has(phaseBand)) return false;
  return true;
}

export function independentActionAuditQueryActionClass(
  game,
  selectedAction,
  legalActions = []
) {
  return evaluatorAuditActionClass({
    game,
    selectedAction,
    legalActions
  });
}

function compareIndependentActionAuditCandidatePriority(left, right) {
  const leftPriority = left.descriptor?.priority || {};
  const rightPriority = right.descriptor?.priority || {};
  return (
    (Number(right.auditFocusPriority) || 0)
      - (Number(left.auditFocusPriority) || 0)
    || (Number(rightPriority.confirmationLowerBound) || 0)
      - (Number(leftPriority.confirmationLowerBound) || 0)
    || (Number(rightPriority.confirmationMean) || 0)
      - (Number(leftPriority.confirmationMean) || 0)
    || (Number(rightPriority.policyRankingDifference) || 0)
      - (Number(leftPriority.policyRankingDifference) || 0)
    || (Number(rightPriority.decisionScoreDifference) || 0)
      - (Number(leftPriority.decisionScoreDifference) || 0)
    || (Number(rightPriority.decisionLeverage) || 0)
      - (Number(leftPriority.decisionLeverage) || 0)
    || String(left.descriptor.auditKey)
      .localeCompare(String(right.descriptor.auditKey))
  );
}

function independentActionAuditStratum(options = {}) {
  return normalizeEvaluatorAuditStratum({
    game: options.game,
    recommendedAction: options.recommendedAction,
    selectedAction: options.selectedAction,
    legalActions: options.legalActions,
    deckId: options.deckId,
    seat: options.seat ?? options.actorId
  });
}

function independentActionAuditActionClass(
  game,
  recommendedKind = "unknown",
  selectedKind = "unknown"
) {
  return evaluatorAuditActionClass({
    game,
    recommendedAction: recommendedKind,
    selectedAction: selectedKind
  });
}

function independentActionAuditPhaseBand(game) {
  return evaluatorAuditPhaseBand(game);
}

function stableSelfPlayHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function playNeuralSelfPlayGame(options) {
  const { decks, model, maxActions = 600, random = Math.random, firstPlayerId = "p1" } = options;
  const shapingWeight = Math.max(0, Number(options.shapingWeight) || 0);
  const game = createGame({ decks,
    ...(options.learnFirstPlayerChoice ? {firstPlayerChooserId:firstPlayerId} : {firstPlayerId}),
    interactive: true, manualActionChainPriority: true, decisionSafety: "strict", random, randomSeed: options.randomSeed });
  const spectatorReplay = options.captureReplay ? createSpectatorReplay(game, options.replayMetadata) : null;
  const models = options.models || [model, model];
  const teacherEvaluatorMode = options.teacherEvaluatorMode || "certified-neural-ensemble";
  const teacherUsesNeuralEvaluation = teacherEvaluatorMode !== "heuristic-only";
  const teacherNeuralModels = teacherUsesNeuralEvaluation
    ? Object.fromEntries(game.players.map((player, playerSeat) => [player.id, models[playerSeat]]))
    : {};
  const teacherEvaluatorPool = teacherUsesNeuralEvaluation
    ? [...new Set([
      ...(options.teacherEvaluatorModels || []),
      ...models
    ].filter(Boolean))]
    : [];
  const teacherEvaluatorCertification = teacherUsesNeuralEvaluation
    ? Object.fromEntries(game.players.map((player, playerSeat) => {
      const certification = certifiedIndependentEvaluators(
        teacherEvaluatorPool,
        models[playerSeat],
        {
          engineFingerprint: options.engineFingerprint,
          requiredPermission: "leafEvaluation"
        }
      );
      return [player.id, certification];
    }))
    : {};
  const sessions = models.map((seatModel) => createNeuralSession(seatModel));
  const trainableSeats = new Set(options.trainableSeats || [0, 1]);
  const trajectories = new Map(game.players.map((player) => [player.id, []]));
  const postmortemCandidates = new Map(game.players.map((player) => [player.id, []]));
  let actionCount = 0;
  let engineActionCount = 0;
  let paymentPlans = 0;
  let paymentActions = 0;
  let teacherQueries = 0;
  let teacherAgreements = 0;
  let teacherCommitRecommendations = 0;
  let teacherReserveRecommendations = 0;
  let teacherResponseProbabilityTotal = 0;
  let teacherExpectedWinRateTotal = 0;
  let mulliganDecisions = 0;
  let mulliganCardsReturned = 0;
  let teacherMulliganQueries = 0;
  let teacherUncertaintyQueries = 0;
  let teacherCriticalQueries = 0;
  let teacherUrgentQueries = 0;
  let teacherVerifiedCorrections = 0;
  let teacherProvisionalLabels = 0;
  let teacherRejectedLabels = 0;
  let teacherActionAuditAttempts = 0;
  let teacherActionAuditReferences = 0;
  let teacherLeafAuditPairs = 0;
  let teacherLeafAuditAttempts = 0;
  let naturalLeafAuditEligibleDecisions = 0;
  let naturalLeafAuditReservoir = null;
  const naturalMixture = options.evidenceSamplingFrame?.candidateSelection
    === NATURAL_MIXTURE_SELECTION;
  const naturalChannel = naturalMixture
    ? naturalLeafSamplingChannel(options.evidenceSamplingFrame.taskManifestHash)
    : "population";
  const naturalPhaseCounts = { mulligan: 0, early: 0, mid: 0, late: 0, unknown: 0 };
  const teacherActionAuditDiagnosticCounts = {};
  const teacherActionAuditFailureReasons = {};
  const teacherActionAuditKeys = new Set();
  let teacherActionAuditCandidatesDiscovered = 0;
  let teacherActionAuditCandidatesExpandedTo16 = 0;
  let teacherActionAuditCandidatesExpandedTo32 = 0;
  let teacherActionAuditFinalCandidates = 0;
  let teacherActionAuditPairedSeedsCompleted = 0;
  let teacherActionAuditCandidatePoolChanges = 0;
  let teacherActionAuditQueriesSuppressed = 0;
  let teacherActionAuditCandidatePoolLastChangedAtQuery = 0;
  let deferredActionAuditCandidates = [];
  const teacherQueryTypes = {};
  let teacherImmediateProofs = 0;
  let teacherMacroProofs = 0;
  let teacherMacroDemonstrationSteps = 0;
  let proofChecks = 0;
  let proofLabels = 0;
  let proofAgreements = 0;
  let proofCorrections = 0;
  const proofKinds = {};
  const turningPoints = {};
  const activeResourceReservations = new Map();
  const resourceReservationOutcomes = [];
  const handOpportunityTrackers = new Map(game.players
    .filter((_, seat) => trainableSeats.has(seat))
    .map((player) => [player.id, createHandOpportunityTracker(player.id)]));
  const handOpportunityOutcomes = [];
  let selectedMulliganExpectedDeltaTotal = 0;
  let mulliganExpectedDeltaTotal = 0;
  const teacherBudget = Math.max(0, options.teacherBudget ?? 16);
  const teacherCriticalBudget = Math.max(0, options.teacherCriticalBudget ?? 8);
  const teacherUrgentBudget = Math.max(0, options.teacherUrgentBudget ?? 4);
  const teacherTypeBudget = Math.max(1, Number(options.teacherTypeBudget)
    || Math.ceil(Math.max(1, teacherBudget) / 4));
  const teacherFraction = Math.max(0, Math.min(1, options.teacherFraction ?? 0.12));
  const configuredTeacherActionAuditBudget =
    Number(options.teacherActionAuditBudget);
  const teacherActionAuditBudget = Number.isFinite(
    configuredTeacherActionAuditBudget
  )
    ? Math.max(0, configuredTeacherActionAuditBudget)
    : 4;
  const deferIndependentActionAudit =
    options.deferIndependentActionAudit === true;
  const detachedIndependentActionAudit =
    deferIndependentActionAudit
    && options.detachedIndependentActionAudit === true;
  const deferredLeafAuditCandidates = [];
  const retainDeferredLeafAudit = (teacher, candidate) => {
    if (!teacher?.deferredLeafAuditCandidate) return;
    deferredLeafAuditCandidates.push({
      ...serializeDeferredActionAuditCandidate({
        ...candidate, descriptor: teacher.deferredLeafAuditCandidate,
        engineFingerprint: options.engineFingerprint
      }),
      deckId: candidate.deckId, seat: candidate.seat,
      stratum: { phaseBand: candidate.phaseBand || normalizeEvaluatorAuditStratum({
        game: candidate.game, deckId: candidate.deckId, seat: candidate.seat
      }).phaseBand },
      legalActions: structuredClone(candidate.legalActions),
      // The recorded locator owns the only destination for a later label.
      recordedStepLocator: {
        actorId: candidate.actorId,
        stepIndex: trajectories.get(candidate.actorId).indexOf(candidate.recordedStep),
        informationSetHash: candidate.recordedStep.informationSetHash,
        selectedIndex: candidate.recordedStep.selectedIndex
      }
    });
  };
  const teacherActionAuditCandidatePoolSize = Math.max(
    4,
    Math.min(
      8,
      Number(options.teacherActionAuditCandidatePoolSize) || 5
    )
  );
  const teacherActionAuditMaximumQueries = Math.max(
    1,
    Math.floor(Number(options.teacherActionAuditMaximumQueries) || 24)
  );
  const teacherActionAuditReducedQueryFraction = Math.max(
    0,
    Math.min(
      teacherFraction,
      Number.isFinite(Number(options.teacherActionAuditReducedQueryFraction))
        ? Number(options.teacherActionAuditReducedQueryFraction)
        : 0.35
    )
  );
  const teacherActionAuditSaturationQueries = Math.max(
    1,
    Math.floor(Number(options.teacherActionAuditSaturationQueries) || 8)
  );
  const teacherActionAuditFocusPhaseBands = new Set(
    options.teacherActionAuditFocusPhaseBands || []
  );
  const teacherActionAuditFocusActionClasses = new Set(
    options.teacherActionAuditFocusActionClasses || []
  );
  const configuredTeacherLeafAuditPairBudget =
    Number(options.teacherLeafAuditPairBudget);
  const teacherLeafAuditPairBudget = Number.isFinite(
    configuredTeacherLeafAuditPairBudget
  )
    ? Math.max(0, Math.floor(configuredTeacherLeafAuditPairBudget))
    : Number.POSITIVE_INFINITY;
  const postmortemCaptureLimit = Math.max(2, Math.min(12, Number(options.postmortemCaptureLimit) || 8));
  const postmortemAuditInterval = Math.max(6, Math.min(32,
    Number(options.postmortemAuditInterval) || 12));
  const configuredPostmortemReviews = Number(options.postmortemReviews);
  const postmortemReviews = Math.max(0, Math.min(4,
    Number.isFinite(configuredPostmortemReviews) ? configuredPostmortemReviews : 2));
  const decisionCycleGuard = createAiDecisionCycleGuard();
  const resolveResourceReservations = (forcedReason = null) => {
    for (const [playerId, active] of activeResourceReservations) {
      const reason = forcedReason || resourceReservationResolutionReason(active.reservation, game, actionCount);
      if (!reason) continue;
      const outcome = completeResourceReservation(active.reservation, game, actionCount, reason);
      active.step.resourceReservationOutcome = outcome;
      active.step.resourceReservationDiagnosticReward = outcome.result.learningReward;
      resourceReservationOutcomes.push(compactResourceReservationOutcome(outcome));
      activeResourceReservations.delete(playerId);
    }
  };
  while (game.phase !== "complete" && actionCount < maxActions) {
    const decisionCycle = decisionCycleGuard.inspect(game);
    if (decisionCycle) throw createSelfPlayError("AI decision cycle detected.", game, decisionCycle);
    if (game.pendingPayment && !needsPaymentOptionDecision(game)) {
      const payment = resolvePlannedPayment(game, neuralPaymentOptions(models[game.players.findIndex((player) => player.id === game.pendingPayment.playerId)]));
      if (!payment?.ok) throw createSelfPlayError("AI payment planner could not complete a legal payment.", game, {
        kind: "payment-plan-failed", stage: "payment", actionCount, actorId: game.pendingPayment?.playerId || null
      });
      paymentPlans += 1;
      paymentActions += payment.actionsApplied;
      engineActionCount += payment.actionsApplied;
      continue;
    }
    const actorId = activeActorId(game);
    const legal = enumerateAiPolicyActions(game, actorId);
    const boundaryViolations = auditDecisionBoundary(game, actorId, legal);
    if (boundaryViolations.length) throw createSelfPlayError(`Decision safety violation: ${boundaryViolations[0].kind}`, game, {
      kind: boundaryViolations[0].kind,
      stage: "before-action",
      actionCount,
      actorId
    });
    const seat = game.players.findIndex((player) => player.id === actorId);
    if (!actorId || !legal.length) break;
    observeHandOpportunityWindow(handOpportunityTrackers.get(actorId), game, legal, actionCount);
    const decision = sessions[seat].decide(game, actorId, legal, { temperature: options.temperature || 0.8, random });
    const legalActionKeys = trainableSeats.has(seat)
      ? decision.legalActions.map(actionKey)
      : null;
    const decisionInformationSetHash = trainableSeats.has(seat)
      ? createInformationSetHash({
        actorId,
        state: decision.stateEncoding,
        initialMemory: decision.initialMemory,
        legalActionKeys
      })
      : null;
    const naturalLeafSamplingFrame =
      options.evidenceSamplingFrame?.distribution === "natural-distribution"
      && (naturalMixture || options.evidenceSamplingFrame?.candidateSelection
        === "hash-priority-reservoir-policy-decision-v1")
        ? options.evidenceSamplingFrame
        : null;
    // One reservoir for the precommitted channel; no teacher call until the
    // game is complete. Population counts include ALL eligible decisions.
    const naturalLeafAuditSelected = false;
    let proof = null;
    if (trainableSeats.has(seat)) {
      proofChecks += 1;
      proof = proofTeacherDecision(game, actorId, decision.legalActions, decision.action);
      if (proof) {
        proofLabels += 1;
        if (proof.agreement) proofAgreements += 1;
        if (proof.correctionEligible) proofCorrections += 1;
        proofKinds[proof.proofKind] = (proofKinds[proof.proofKind] || 0) + 1;
      }
    }
    const selectedMulliganPlan = game.phase === "mulligan"
      ? mulliganPlanProfile(game, actorId, decision.action)
      : null;
    let teacher = null;
    const criticalDecision = criticalTacticalDecisionProfile(game, actorId, decision);
    const criticalTacticalChoice = criticalDecision.critical;
    const uncertainty = decisionUncertainty(decision);
    const teacherQueryType = game.phase === "mulligan"
      ? "mulligan"
      : criticalDecision.urgent
        ? `urgent:${criticalDecision.types?.[0] || "general"}`
        : criticalTacticalChoice
          ? `critical:${criticalDecision.types?.[0] || "general"}`
          : uncertainty >= 0.45
            ? "uncertainty"
            : "exploration";
    const queryTypeUnderBudget = (teacherQueryTypes[teacherQueryType] || 0) < teacherTypeBudget;
    const auditCollectionBudgetExhausted =
      teacherAuditCollectionBudgetExhausted({
        stopTeacherAfterActionAuditBudget:
          options.stopTeacherAfterActionAuditBudget === true,
        captureIndependentActionAudit:
          options.captureIndependentActionAudit === true,
        actionAuditAttempts: teacherActionAuditAttempts,
        actionAuditBudget: teacherActionAuditBudget,
        stopTeacherAfterLeafAuditBudget:
          options.stopTeacherAfterLeafAuditBudget === true,
        captureIndependentLeafAudit:
          options.captureIndependentLeafAudit !== false,
        leafAuditAttempts: teacherLeafAuditAttempts,
        leafAuditPairBudget: teacherLeafAuditPairBudget
      });
    const representedPhaseBands = new Set(
      deferredActionAuditCandidates
        .map((candidate) => candidate.stratum?.phaseBand)
        .filter(Boolean)
    );
    const representedActionClasses = new Set(
      deferredActionAuditCandidates
        .map((candidate) => candidate.stratum?.actionClass)
        .filter(Boolean)
    );
    const currentAuditPhaseBand = independentActionAuditPhaseBand(game);
    const currentAuditActionClass = independentActionAuditQueryActionClass(
      game,
      decision.action,
      decision.legalActions
    );
    // Focused evaluator-bootstrap games are evidence collection jobs, not PPO
    // policy games. Do not spend their finite teacher-query budget before the
    // requested phase is reached; the whole budget remains available for the
    // missing late/mid/early stratum.
    const auditPhaseFocusAllowsTeacherQuery =
      teacherAuditPhaseFocusAllowsQuery({
        currentPhaseBand: currentAuditPhaseBand,
        captureIndependentLeafAudit:
          options.captureIndependentLeafAudit !== false,
        leafFocusPhaseBands:
          options.teacherLeafAuditFocusPhaseBands || [],
        deferIndependentActionAudit,
        actionFocusPhaseBands:
          options.teacherActionAuditFocusPhaseBands || []
      });
    if (naturalLeafSamplingFrame
      && decisionInformationSetHash
      && auditPhaseFocusAllowsTeacherQuery) {
      naturalLeafAuditEligibleDecisions += 1;
      naturalPhaseCounts[currentAuditPhaseBand] += 1;
    }
    const actionAuditQuerySchedule = deferIndependentActionAudit
      ? actionAuditTeacherQuerySchedule({
        candidateCount: deferredActionAuditCandidates.length,
        poolSize: teacherActionAuditCandidatePoolSize,
        teacherQueries,
        maximumQueries: teacherActionAuditMaximumQueries,
        baseFraction: teacherFraction,
        reducedFraction: teacherActionAuditReducedQueryFraction,
        saturationQueries: teacherActionAuditSaturationQueries,
        lastPoolChangeAtQuery:
          teacherActionAuditCandidatePoolLastChangedAtQuery,
        urgent: criticalDecision.urgent,
        critical: criticalTacticalChoice,
        missingPhaseBand:
          teacherActionAuditFocusPhaseBands.has(currentAuditPhaseBand)
          || !representedPhaseBands.has(currentAuditPhaseBand),
        missingActionClass:
          teacherActionAuditFocusActionClasses.has(currentAuditActionClass)
          || !representedActionClasses.has(currentAuditActionClass)
      })
      : {
        allowed: true,
        forceQuery: false,
        queryFraction: teacherFraction,
        reason: "standard-teacher-query"
      };
    if (deferIndependentActionAudit
      && (actionAuditQuerySchedule.allowed === false
        || auditPhaseFocusAllowsTeacherQuery === false)) {
      teacherActionAuditQueriesSuppressed += 1;
    }
    const teacherEligible = trainableSeats.has(seat)
      && (!proof || naturalLeafAuditSelected)
      && teacherFraction > 0
      && !auditCollectionBudgetExhausted
      && auditPhaseFocusAllowsTeacherQuery
      && actionAuditQuerySchedule.allowed !== false
      && (naturalLeafAuditSelected
        || teacherQueries < teacherBudget
        || (criticalTacticalChoice && teacherCriticalQueries < teacherCriticalBudget)
        || (criticalDecision.urgent && teacherUrgentQueries < teacherUrgentBudget));
    const uncertaintyQuery = teacherEligible && shouldQueryTeacherForUncertainty(decision, game.phase);
    if (teacherEligible && (naturalLeafSamplingFrame
      ? naturalLeafAuditSelected
      : (criticalDecision.urgent
        || criticalTacticalChoice
        || actionAuditQuerySchedule.forceQuery === true
        || (queryTypeUnderBudget && (
          game.phase === "mulligan"
          || uncertaintyQuery
          || random() < actionAuditQuerySchedule.queryFraction
        ))))) {
      const baselineReview = models[seat]?.metadata?.tacticalBaseline
        ? recommendPublicTacticalAction(game,actorId,decision.legalActions) : null;
      if (baselineReview) criticalDecision.tacticalBaselineReview = baselineReview;
      teacher = simulationTeacherDecision(game, actorId, decision.legalActions, {
        model: DEFAULT_AI_MODEL,
        neuralModel: teacherUsesNeuralEvaluation ? models[seat] : null,
        neuralModels: teacherNeuralModels,
        evaluatorModels: teacherEvaluatorCertification[actorId]?.accepted || [],
        evaluatorModelsCertified: true,
        engineFingerprint: options.engineFingerprint,
        // The reviewer may retain the acting player's own public-history
        // memory, but must not import the opponent session's private-hand
        // history into viewer-side determinizations.
        initialMemories: { [actorId]: sessions[seat].memory(actorId) },
        neuralBelief: decision.belief,
        requiredAction: decision.action,
        requiredActions: [...(baselineReview ? [baselineReview.action,baselineReview.hold] : []),
          ...criticalDecision.requiredActions],
        policyProbabilities: decision.probabilities,
        proposalValues: decision.teacherProposalValues,
        informationSetHash: decisionInformationSetHash,
        screenSimulations: options.teacherScreenSimulations
          ?? options.teacherSimulations
          ?? 4,
        confirmationSimulations: options.teacherConfirmationSimulations ?? 16,
        confirmationMaxSimulations: options.teacherConfirmationMaxSimulations ?? 32,
        depth: options.teacherDepth || 10,
        maxCandidates: options.teacherCandidates || 6,
        leafAuditSimulations:
          options.teacherLeafAuditSimulations ?? 128,
        detachedIndependentLeafAudit: options.detachedIndependentLeafAudit === true,
        captureProductionLeafAudit:
          options.captureProductionLeafAudit === true,
        captureIndependentLeafAudit:
          options.captureIndependentLeafAudit !== false
            // Natural jobs commit one candidate over the complete game below.
            // Running the expensive final audit here would favour the first
            // eligible decision and could run several 128-pair audits in one
            // game.
            && !naturalLeafSamplingFrame
            && (!(options.teacherLeafAuditFocusPhaseBands || []).length
              || (options.teacherLeafAuditFocusPhaseBands || [])
                .includes(currentAuditPhaseBand))
            && teacherLeafAuditAttempts < teacherLeafAuditPairBudget,
        independentLeafPairLimit: Number.isFinite(
          teacherLeafAuditPairBudget
        )
          ? Math.min(
            2,
            Math.max(
              0,
              teacherLeafAuditPairBudget - teacherLeafAuditAttempts
            )
          )
          : 2,
        captureIndependentActionAudit:
          options.captureIndependentActionAudit === true,
        deferIndependentActionAudit,
        actionAuditEnabled: deferIndependentActionAudit
          ? true
          : teacherActionAuditAttempts < teacherActionAuditBudget,
        actionAuditExistingKeys: [...teacherActionAuditKeys],
        actionAuditMaximumSteps:
          Math.max(1, Number(options.teacherActionAuditMaximumSteps) || 1200),
        evidenceProtocolManifest:
          options.evidenceProtocolManifest || null,
        evidenceSamplingFrame:
          options.evidenceSamplingFrame || null,
        uncertainty,
        critical: criticalTacticalChoice,
        random
      });
      if (teacher) {
        if (teacher.independentLeafAuditAttempted === true) {
          teacherLeafAuditAttempts += 1;
        }
        if (teacher.actionAuditAttempted === true && teacher.actionAuditKey) {
          teacherActionAuditAttempts += 1;
          teacherActionAuditKeys.add(teacher.actionAuditKey);
        }
        if (teacher.deferredActionAuditCandidate?.auditKey) {
          teacherActionAuditKeys.add(
            teacher.deferredActionAuditCandidate.auditKey
          );
        }
        if (teacher.independentActionRankingAudit) {
          teacherActionAuditReferences += 1;
        }
        teacherLeafAuditPairs +=
          teacher.independentLeafValuePairs?.length || 0;
        const actionAuditDiagnostic =
          teacher.deferredActionAuditCandidate
            ? null
            : teacher.independentActionRankingAuditDiagnostic;
        if (actionAuditDiagnostic) {
          const status = actionAuditDiagnostic.status || "unknown";
          teacherActionAuditDiagnosticCounts[status] =
            (teacherActionAuditDiagnosticCounts[status] || 0) + 1;
          for (const reason of [
            ...(actionAuditDiagnostic.gateReasons || []),
            ...(actionAuditDiagnostic.preselection?.failureReasons || []),
            ...(actionAuditDiagnostic.selection?.failureReasons || []),
            ...(actionAuditDiagnostic.final?.failureReasons || [])
          ]) {
            teacherActionAuditFailureReasons[reason] =
              (teacherActionAuditFailureReasons[reason] || 0) + 1;
          }
        }
        teacherQueries += 1;
        teacherQueryTypes[teacherQueryType] = (teacherQueryTypes[teacherQueryType] || 0) + 1;
        if (criticalTacticalChoice) teacherCriticalQueries += 1;
        if (criticalDecision.urgent) teacherUrgentQueries += 1;
        if (uncertaintyQuery) teacherUncertaintyQueries += 1;
        if (teacher.selectedIndex === decision.selectedIndex) teacherAgreements += 1;
        if (teacher.resourcePlan?.posture === "commit") teacherCommitRecommendations += 1;
        if (teacher.resourcePlan?.posture === "reserve") teacherReserveRecommendations += 1;
        teacherResponseProbabilityTotal += teacher.responseRisk?.probability || 0;
        teacherExpectedWinRateTotal += teacher.expectedWinRate || 0;
        if (teacher.mulliganPlan) {
          teacherMulliganQueries += 1;
          mulliganExpectedDeltaTotal += teacher.mulliganPlan.expectedDelta || 0;
        }
        if (teacher.verification?.status === "verified" && teacher.correctionEligible
          && teacher.selectedIndex !== decision.selectedIndex) teacherVerifiedCorrections += 1;
        else if (teacher.verification?.status === "rejected") teacherRejectedLabels += 1;
        else teacherProvisionalLabels += 1;
        if (teacher.verification?.proofKind === "immediate-terminal-win") teacherImmediateProofs += 1;
        if (teacher.verification?.proofKind === "verified-declaration-macro") teacherMacroProofs += 1;
        teacherMacroDemonstrationSteps += teacher.macroDemonstration?.steps?.length || 0;
      }
    }
    const beforePotential = trainableSeats.has(seat) && shapingWeight > 0
      ? trainingShapingPotential(game, actorId)
      : 0;
    const beliefTarget = trainableSeats.has(seat) ? encodeOpponentDeckTarget(game, actorId) : null;
    const beforeScoreLead = scoreLead(game, actorId);
    const selectedTactics = tacticalActionProfile(game, actorId, decision.action);
    resolveResourceReservations();
    const existingReservation = activeResourceReservations.get(actorId) || null;
    const wasTargetUsed = existingReservation?.reservation.targetUsed || false;
    if (existingReservation) observeResourceReservationAction(existingReservation.reservation, game, decision.action, actionCount);
    const reservationIntent = !existingReservation && trainableSeats.has(seat)
      ? createResourceReservationIntent(game, actorId, decision.action, actionCount, {
        counterfactual: teacher?.policyComparison || null
      })
      : null;
    const teacherLearningWeight = teacherSupervisionWeight(teacher, criticalDecision);
    const teacherValueSupervision = teacherAlternativeValueSupervision(
      teacher,
      decision.legalActions,
      teacherLearningWeight
    );
    const fullHeuristicScores = teacher || proof
      ? fullHeuristicScoresForActions(game, actorId, decision.legalActions)
      : null;
    let recordedStep = null;
    let postmortemCandidate = null;
    if (trainableSeats.has(seat)) {
      const informationSetHash = decisionInformationSetHash;
      recordedStep = {
        actionCount,
        state: decision.stateEncoding,
        actions: decision.actionEncoding.slice(0, decision.legalCount * ACTION_DIM),
        selectedIndex: decision.selectedIndex,
        legalCount: decision.legalCount,
        oldLogProbability: decision.logProbability,
        behaviorTemperature: decision.behaviorTemperature,
        value: decision.value,
        beliefTarget,
        initialMemory: decision.initialMemory,
        informationSetHash,
        informationSetHashVersion: 1,
        evidenceSamplingFrame: structuredClone(
          options.evidenceSamplingFrame || null
        ),
        naturalLeafAuditSamplingObservation: naturalLeafAuditSelected
          ? null
          : null,
        actionRankingReference: actionRankingReferenceForDecision({
          proof,
          teacher,
          decision,
          informationSetHash,
          legalActionKeys
        }),
        actionRankingAuditReference:
          actionRankingAuditReferenceForDecision({
            teacher,
            decision,
            informationSetHash,
            legalActionKeys
          }),
        actionRankingAuditDiagnostic:
          teacher?.independentActionRankingAuditDiagnostic
            ? structuredClone(
              teacher.independentActionRankingAuditDiagnostic
            )
            : null,
        leafValueAuditReference: teacherLeafValueAuditReference(teacher, {
          game,
          deckId: decks[seat]?.id || null,
          seat,
          recommendedAction: teacher?.action,
          selectedAction: decision.action,
          legalActions: decision.legalActions
        }),
        selectedActionKey: actionKey(decision.action),
        behaviorActionKey: actionKey(decision.action),
        recommendedActionKey: teacher?.action ? actionKey(teacher.action) : null,
        legalActionKeys,
        actionManifestVersion: 2,
        originalLegalActionKeys: legal.map(actionKey),
        originalLegalCount: legal.length,
        selectedActionValue: decision.selectedActionValue,
        fullHeuristicEvaluatorVersion: fullHeuristicScores ? 1 : null,
        fullHeuristicScores,
        stopActionValue: stopActionValue(decision),
        proofLabelVersion: proof?.labelVersion ?? null,
        proofCorrectionEligible: proof?.correctionEligible === true,
        proofAgreement: proof?.agreement === true,
        proofIndex: proof?.selectedIndex ?? 0,
        proofConfidence: proof?.confidence ?? 0,
        proofKind: proof?.proofKind ?? null,
        proofEvidenceKind: proof?.evidenceKind ?? null,
        proofReasons: proof?.reasons ?? null,
        proofCorrectionAlternativeKeys: proof?.correctionAlternativeKeys ?? null,
        proofTargets: proof?.targets ?? null,
        proofActionValueTargets: proof?.actionValueTargets ?? null,
        proofActionValueWeights: proof?.actionValueWeights ?? null,
        teacherLabelVersion: teacher?.labelVersion ?? null,
        teacherCorrectionEligible: teacher?.correctionEligible === true,
        teacherVerificationStatus: teacher?.verification?.status ?? null,
        teacherVerificationReasons: teacher?.verification?.reasons ?? null,
        teacherIndex: teacher?.selectedIndex ?? 0,
        teacherConfidence: teacherLearningWeight,
        teacherSearchConfidence: teacher?.searchConfidence ?? 0,
        teacherCorrectionConfidence: teacher?.correctionConfidence ?? 0,
        teacherCorrectionThreshold: teacher?.verification?.correctionThreshold ?? null,
        teacherProofKind: teacher?.verification?.proofKind ?? null,
        teacherEvidenceSource: teacherEvidenceSource(teacher),
        teacherImmediateProof: teacher?.immediateProof ?? null,
        teacherConfirmation: storedTeacherConfirmation(teacher?.confirmation),
        teacherSupervisionTier: teacherPolicySupervisionTier(teacher),
        teacherPolicyEligible: verifiedTeacherPolicyEligibility(teacher),
        // Policy correction remains verified-only. Provisional search values
        // may supervise the auxiliary action-value head at low weight when the
        // independent evaluator does not materially oppose the search.
        teacherActionValueEligible: teacherActionValueSupervisionEligibility(teacher)
          && teacherValueSupervision.weights.some((weight) => Number(weight) > 0),
        teacherAppliedPolicyWeight: verifiedTeacherPolicyEligibility(teacher)
          ? teacherLearningWeight
          : 0,
        teacherEvaluatorComparison: teacher?.policyComparison?.evaluatorComparison ?? null,
        teacherCorrectionAlternativeKeys: teacher?.correctionAlternativeKeys ?? null,
        teacherMacroContinuation: teacher?.macroContinuation ?? null,
        teacherMacroDemonstrationSteps: teacherMacroTrainingSteps(teacher, {
          parentInformationSetHash: informationSetHash,
          parentSelectedActionKey: actionKey(decision.action),
          parentEvidenceSource: teacherEvidenceSource(teacher)
        }),
        teacherTargets: teacherTargetDistribution(teacher, decision.legalActions),
        teacherActionValueTargets: teacherValueSupervision.targets,
        teacherActionValueWeights: teacherValueSupervision.weights,
        teacherExpectedWinRate: teacher?.expectedWinRate ?? null,
        teacherDecisionScore: teacher?.decisionScore ?? null,
        teacherDownsideWinRate: teacher?.downsideWinRate ?? null,
        teacherResourcePosture: teacher?.resourcePlan?.posture ?? null,
        teacherResourceCommitment: teacher?.resourcePlan?.commitment ?? null,
        teacherResponseProbability: teacher?.responseRisk?.probability ?? null,
        teacherExpectedResponseThreat: teacher?.responseRisk?.expectedThreat ?? null,
        teacherObservedResponsePasses: teacher?.responseRisk?.observedPasses ?? null,
        teacherResponsePassEvidenceStrength: teacher?.responseRisk?.passEvidenceStrength ?? null,
        teacherMulliganExpectedDelta: teacher?.mulliganPlan?.expectedDelta ?? null,
        teacherMulliganSelectedCount: teacher?.mulliganPlan?.selectedCount ?? null,
        teacherHoldExpectedWinRate: teacher?.holdComparison?.expectedWinRate ?? null,
        teacherGainOverHolding: teacher?.holdComparison?.gainFromBest ?? null,
        teacherPairedGainOverHolding: teacher?.holdComparison?.pairedGainFromBest ?? null,
        teacherSelectedExpectedWinRate: teacher?.policyComparison?.selectedExpectedWinRate ?? null,
        teacherSelectedRegret: teacher?.policyComparison?.regret ?? null,
        teacherSelectedPairedGainOverHold: teacher?.policyComparison?.pairedGainOverHold ?? null,
        teacherRankingMargin: teacher?.policyComparison?.regret > 0
          ? Math.min(0.5, Math.max(0.05, teacher.policyComparison.regret * 0.5))
          : 0,
        criticalDecisionTypes: criticalDecision.types,
        criticalDecisionUrgent: criticalDecision.urgent,
        criticalAlternativeActionKeys: criticalDecision.requiredActions.map(actionKey),
        combatContinuationReview: criticalDecision.combatContinuationReview || null,
        tacticalBaselineReview: criticalDecision.tacticalBaselineReview || null,
        combatSacrificePossible: criticalDecision.combatSacrificePossible || false,
        teacherSearch: teacher?.search || null,
        teacherAlternatives: teacher?.alternatives?.map((alternative) => ({
          actionKey: actionKey(alternative.action),
          expectedWinRate: alternative.expectedWinRate,
          decisionScore: alternative.decisionScore,
          downsideWinRate: alternative.downsideWinRate,
          confidenceInterval: alternative.confidenceInterval,
          simulations: alternative.simulations,
          attemptedSimulations: alternative.attemptedSimulations,
          invalidSimulations: alternative.invalidSimulations,
          validRate: alternative.validRate,
          minimumValidRate: alternative.minimumValidRate,
          rolloutEvidenceEligible: alternative.rolloutEvidenceEligible,
          invalidReasons: alternative.invalidReasons,
          simulationSeedFingerprint: alternative.simulationSeedFingerprint,
          reusedSimulations: alternative.reusedSimulations,
          additionalSimulations: alternative.additionalSimulations,
          pairedGainOverHold: alternative.pairedGainOverHold,
          terminalRate: alternative.terminalRate,
          immediateTerminalRate: alternative.immediateTerminalRate,
          immediateTerminalWinRate: alternative.immediateTerminalWinRate,
          saturatedLeafRate: alternative.saturatedLeafRate,
          neuralLeafWinRate: alternative.neuralLeafWinRate,
          heuristicLeafWinRate: alternative.heuristicLeafWinRate,
          neuralHeuristicDisagreement: alternative.neuralHeuristicDisagreement,
          initialChoiceRate: alternative.initialChoiceRate,
          macroContinuation: alternative.macroContinuation,
          resourceCommitment: alternative.resourcePlan?.commitment ?? null,
          responseProbability: alternative.responseRisk?.probability ?? null
        })) || null,
        selectedMulliganExpectedDelta: selectedMulliganPlan?.expectedDelta ?? null,
        selectedMulliganCardNumbers: selectedMulliganPlan?.selectedCardNumbers ?? null,
        tacticalProfile: compactTacticalProfile(selectedTactics),
        scoreLeadBefore: beforeScoreLead,
        shapingPotential: beforePotential,
        shapedReward: 0
      };
      if (naturalLeafSamplingFrame && auditPhaseFocusAllowsTeacherQuery
        && (naturalChannel === "population" || naturalChannel === currentAuditPhaseBand)) {
        const priority = naturalMixture
          ? createHash("sha256").update(
            `${naturalLeafSamplingFrame.taskManifestHash}:mixture-reservoir:`
            + `${actionCount}:${decisionInformationSetHash}`
          ).digest("hex")
          : stableSelfPlayHash(`${naturalLeafSamplingFrame.taskManifestHash}`
            + `:reservoir:${decisionInformationSetHash}`);
        if (!naturalLeafAuditReservoir
          || priority < naturalLeafAuditReservoir.priority) {
          naturalLeafAuditReservoir = {
            priority,
            phaseBand: currentAuditPhaseBand,
            game: cloneGame(game),
            actorId,
            seat,
            legalActions: structuredClone(decision.legalActions),
            decision: {
              action: structuredClone(decision.action),
              belief: structuredClone(decision.belief),
              probabilities: [...(decision.probabilities || [])],
              teacherProposalValues: structuredClone(
                decision.teacherProposalValues || null
              ),
              selectedIndex: decision.selectedIndex,
              initialMemory: structuredClone(decision.initialMemory)
            },
            initialMemories: {
              [actorId]: structuredClone(sessions[seat].memory(actorId))
            },
            informationSetHash,
            uncertainty,
            critical: criticalTacticalChoice,
            recordedStep,
            deckId: decks[seat]?.id || null,
            samplingFrame: structuredClone(naturalLeafSamplingFrame)
          };
        }
      }
      if (reservationIntent) recordedStep.resourceReservationIntent = structuredClone(reservationIntent);
      if (existingReservation) recordedStep.resourceReservationId = existingReservation.reservation.id;
      if (existingReservation?.reservation.targetUsed && !wasTargetUsed) {
        recordedStep.fulfillsResourceReservationId = existingReservation.reservation.id;
      }
      trajectories.get(actorId).push(recordedStep);
      retainDeferredLeafAudit(teacher, {
        game, actorId, seat, deckId: decks[seat]?.id, recordedStep,
        legalActions: decision.legalActions,
        initialMemories: { [actorId]: sessions[seat].memory(actorId) },
        neuralBelief: decision.belief
      });
      if (teacher?.deferredActionAuditCandidate) {
        const descriptor = teacher.deferredActionAuditCandidate;
        const candidate = {
          descriptor,
          recordedStep,
          actionCount,
          recordedStepLocator: {
            actorId,
            informationSetHash: recordedStep.informationSetHash || null,
            selectedIndex: Number(recordedStep.selectedIndex),
            actionCount
          },
          stratum: independentActionAuditStratum({
            game,
            actorId,
            seat,
            deckId: decks[seat]?.id || null,
            recommendedAction: descriptor.recommendedAction,
            selectedAction: descriptor.selectedAction,
            legalActions: decision.legalActions
          })
        };
        const previousCandidateKeys = new Set(
          deferredActionAuditCandidates.map(
            (entry) => entry.descriptor.auditKey
          )
        );
        const retained = selectIndependentActionAuditCandidatePool(
          [...deferredActionAuditCandidates, candidate],
          teacherActionAuditCandidatePoolSize,
          {
            focusPhaseBands: [...teacherActionAuditFocusPhaseBands],
            focusActionClasses: [...teacherActionAuditFocusActionClasses],
            evidenceProtocolManifest: options.evidenceProtocolManifest || null
          }
        );
        for (const retainedCandidate of retained) {
          retainedCandidate.descriptor.samplingFrame = {
            ...(retainedCandidate.descriptor.samplingFrame || {}),
            candidateSelection: structuredClone(
              retainedCandidate.samplingPropensity || null
            )
          };
        }
        if (retained.includes(candidate)) {
          Object.assign(candidate, {
            game: cloneGame(game),
            actorId,
            model: DEFAULT_AI_MODEL,
            neuralModel:
              teacherUsesNeuralEvaluation ? models[seat] : null,
            neuralModels: teacherNeuralModels,
            evaluatorModels:
              teacherEvaluatorCertification[actorId]?.accepted || [],
            evaluatorModelsCertified: true,
            engineFingerprint: options.engineFingerprint,
            initialMemories: {
              [actorId]: structuredClone(
                sessions[seat].memory(actorId)
              )
            },
            neuralBelief: decision.belief
              ? Float32Array.from(decision.belief)
              : null
          });
        }
        const retainedCandidateKeys = new Set(
          retained.map((entry) => entry.descriptor.auditKey)
        );
        const candidatePoolChanged =
          retainedCandidateKeys.size !== previousCandidateKeys.size
          || [...retainedCandidateKeys].some(
            (key) => !previousCandidateKeys.has(key)
          );
        if (candidatePoolChanged) {
          teacherActionAuditCandidatePoolLastChangedAtQuery =
            teacherQueries;
          teacherActionAuditCandidatePoolChanges += 1;
        }
        deferredActionAuditCandidates = retained;
      }
      if (postmortemReviews > 0) {
        postmortemCandidate = capturePostmortemCandidate(game, actorId, decision, recordedStep, {
          teacher,
          criticalDecision,
          uncertainty,
          compactAudit: actionCount % postmortemAuditInterval === 0,
          initialMemories: { [actorId]: sessions[seat].memory(actorId) }
        });
      }
    }
    recordHandOpportunityDecision(handOpportunityTrackers.get(actorId), game, decision.action, actionCount, recordedStep);
    if (decision.action.kind === "submitMulligan") {
      mulliganDecisions += 1;
      mulliganCardsReturned += decision.action.cardIds?.length || 0;
      selectedMulliganExpectedDeltaTotal += selectedMulliganPlan?.expectedDelta || 0;
    }
    const result = applyAiAction(game, decision.action, actorId);
    if (!result?.ok) throw createSelfPlayError(`Neural policy selected illegal action: ${decision.action.kind}`, game, {
      kind: "illegal-policy-action",
      stage: "apply-action",
      actionCount,
      actorId,
      action: structuredClone(decision.action)
    });
    engineActionCount += 1;
    if (game.pendingPayment && !needsPaymentOptionDecision(game)) {
      const payment = resolvePlannedPayment(game, neuralPaymentOptions(models[seat]));
      if (!payment?.ok) throw createSelfPlayError("AI payment planner could not complete a selected action's payment.", game, {
        kind: "payment-plan-failed", stage: "after-strategic-action", actionCount, actorId,
        previousAction: structuredClone(decision.action)
      });
      paymentPlans += 1;
      paymentActions += payment.actionsApplied;
      engineActionCount += payment.actionsApplied;
    }
    const postActionViolations = auditRecordedDecisionSafety(game);
    if (postActionViolations.length) throw createSelfPlayError(`Decision safety violation: ${postActionViolations[0].kind}`, game, {
      kind: postActionViolations[0].kind,
      stage: "after-action",
      actionCount,
      actorId: activeActorId(game),
      previousActorId: actorId,
      previousAction: structuredClone(decision.action)
    });
    if (spectatorReplay) appendSpectatorReplayFrame(spectatorReplay, game, actorId, decision.action);
    if (recordedStep) {
      recordedStep.scoreLeadAfter = scoreLead(game, actorId);
      recordedStep.turningPoint = highestPriorityTurningPoint([
        recordedStep.turningPoint,
        classifyTeacherCorrectionPoint(recordedStep),
        classifyTurningPoint(recordedStep.scoreLeadBefore, recordedStep.scoreLeadAfter, game.victoryScore || 8)
      ]);
      if (recordedStep.turningPoint) turningPoints[recordedStep.turningPoint] = (turningPoints[recordedStep.turningPoint] || 0) + 1;
      if (postmortemCandidate) {
        retainPostmortemCandidate(
          postmortemCandidates,
          finalizePostmortemCandidate(postmortemCandidate, recordedStep, game),
          postmortemCaptureLimit
        );
      }
    }
    if (reservationIntent && recordedStep) {
      activeResourceReservations.set(actorId, { reservation: reservationIntent, step: recordedStep });
    }
    actionCount += 1;
    for (const tracker of handOpportunityTrackers.values()) {
      handOpportunityOutcomes.push(...resolveHandOpportunityCards(tracker, game, actionCount));
    }
    resolveResourceReservations();
  }
  const completed = game.phase === "complete" && Boolean(game.winnerId);
  if (completed && naturalLeafAuditReservoir) {
    const candidate = naturalLeafAuditReservoir;
    const selectionProbability = naturalLeafAuditEligibleDecisions > 0
      ? 1 / naturalLeafAuditEligibleDecisions
      : 0;
    const committedSamplingFrame = {
      version: 2,
      contract: "natural-leaf-audit-sampling-frame-v2",
      datasetKey: candidate.samplingFrame.datasetKey,
      taskIndex: candidate.samplingFrame.taskIndex,
      certificationRole: candidate.samplingFrame.certificationRole,
      scope: candidate.samplingFrame.scope || null,
      distribution: "natural-distribution",
      candidateSelection: "hash-priority-reservoir-policy-decision-v1",
      parentTaskManifestHash: candidate.samplingFrame.taskManifestHash,
      ...(candidate.samplingFrame.plannedFinalSimulations != null ? {
        plannedFinalSimulations: candidate.samplingFrame.plannedFinalSimulations
      } : {}),
      eligibleDecisions: naturalLeafAuditEligibleDecisions,
      selectionProbability,
      weighting: "inverse-propensity-per-decision-v1"
    };
    const samplingFrame = naturalMixture
      ? naturalLeafMixtureSamplingFrame(candidate.samplingFrame,
        naturalPhaseCounts, candidate.phaseBand)
      : {
      ...committedSamplingFrame,
      taskManifestHash: createHash("sha256")
        .update(JSON.stringify(committedSamplingFrame))
        .digest("hex")
    };
    const auditTeacher = simulationTeacherDecision(
      candidate.game,
      candidate.actorId,
      candidate.legalActions,
      {
        model: DEFAULT_AI_MODEL,
        neuralModel: teacherUsesNeuralEvaluation
          ? models[candidate.seat]
          : null,
        neuralModels: teacherNeuralModels,
        evaluatorModels:
          teacherEvaluatorCertification[candidate.actorId]?.accepted || [],
        evaluatorModelsCertified: true,
        engineFingerprint: options.engineFingerprint,
        initialMemories: candidate.initialMemories,
        neuralBelief: candidate.decision.belief,
        requiredAction: candidate.decision.action,
        requiredActions: [],
        policyProbabilities: candidate.decision.probabilities,
        proposalValues: candidate.decision.teacherProposalValues,
        informationSetHash: candidate.informationSetHash,
        screenSimulations: options.teacherScreenSimulations
          ?? options.teacherSimulations
          ?? 4,
        confirmationSimulations: options.teacherConfirmationSimulations ?? 16,
        confirmationMaxSimulations:
          options.teacherConfirmationMaxSimulations ?? 32,
        depth: options.teacherDepth || 10,
        maxCandidates: options.teacherCandidates || 6,
        leafAuditSimulations: options.teacherLeafAuditSimulations ?? 128,
        detachedIndependentLeafAudit: options.detachedIndependentLeafAudit === true,
        captureProductionLeafAudit:
          options.captureProductionLeafAudit === true,
        captureIndependentLeafAudit: true,
        independentLeafPairLimit: 1,
        captureIndependentActionAudit: false,
        evidenceProtocolManifest: options.evidenceProtocolManifest || null,
        evidenceSamplingFrame: samplingFrame,
        uncertainty: candidate.uncertainty,
        critical: candidate.critical,
        random: seededRandom(
          stableSelfPlayHash(`${samplingFrame.taskManifestHash}:final`)
        )
      }
    );
    retainDeferredLeafAudit(auditTeacher, candidate);
    if (auditTeacher?.independentLeafAuditAttempted === true) {
      teacherLeafAuditAttempts += 1;
    }
    teacherLeafAuditPairs +=
      auditTeacher?.independentLeafValuePairs?.length || 0;
    candidate.recordedStep.naturalLeafAuditSamplingObservation = {
      version: naturalMixture ? 3 : 2,
      contract: naturalMixture ? "natural-leaf-audit-sampling-observation-v3"
        : "natural-leaf-audit-sampling-observation-v2",
      samplingFrame,
      status: auditTeacher?.independentLeafActionEffectComparison
        ? "audited"
        : candidate.legalActions.length === 1
          || (auditTeacher
            && auditTeacher.selectedIndex === candidate.decision.selectedIndex)
          ? "identical-action-zero-regret"
          : "audit-unavailable"
    };
    candidate.recordedStep.leafValueAuditReference =
      teacherLeafValueAuditReference(auditTeacher, {
        game: candidate.game,
        deckId: candidate.deckId,
        seat: candidate.seat,
        recommendedAction: auditTeacher?.action,
        selectedAction: candidate.decision.action,
        legalActions: candidate.legalActions
      });
  }
  if (completed && deferIndependentActionAudit
    && !detachedIndependentActionAudit
    && deferredActionAuditCandidates.length > 0) {
    const race = runIndependentActionAuditCandidateRace(
      deferredActionAuditCandidates,
      {
        maximumSteps: Math.max(
          192,
          Number(options.teacherActionAuditMaximumSteps) || 1200
        )
      }
    );
    teacherActionAuditAttempts += race.summary.pilotAttempted;
    teacherActionAuditReferences += race.summary.references;
    teacherActionAuditCandidatesDiscovered += race.summary.discovered;
    teacherActionAuditCandidatesExpandedTo16 += race.summary.expandedTo16;
    teacherActionAuditCandidatesExpandedTo32 += race.summary.expandedTo32;
    teacherActionAuditFinalCandidates += race.summary.finalAttempted;
    teacherActionAuditPairedSeedsCompleted +=
      Number(race.summary.pairedSeedsCompleted) || 0;
    const candidateByKey = new Map(
      deferredActionAuditCandidates.map((candidate) => [
        candidate.descriptor.auditKey,
        candidate
      ])
    );
    for (const result of race.candidates) {
      const candidate = candidateByKey.get(result.auditKey);
      const step = candidate?.recordedStep;
      if (!step) continue;
      step.actionRankingAuditDiagnostic =
        structuredClone(result.diagnostic);
      const status = result.diagnostic?.status || "unknown";
      teacherActionAuditDiagnosticCounts[status] =
        (teacherActionAuditDiagnosticCounts[status] || 0) + 1;
      for (const checkpoint of result.diagnostic?.racing?.checkpoints || []) {
        for (const reason of checkpoint.failureReasons || []) {
          teacherActionAuditFailureReasons[reason] =
            (teacherActionAuditFailureReasons[reason] || 0) + 1;
        }
      }
      if (!result.audit) continue;
      const descriptor = candidate.descriptor;
      step.actionRankingAuditReference =
        createActionRankingAuditReference({
          audit: result.audit,
          informationSetHash: step.informationSetHash,
          informationSetHashVersion: 1,
          correctIndex: descriptor.recommendedIndex,
          comparedIndex: descriptor.selectedIndex,
          correctActionKey:
            step.legalActionKeys?.[descriptor.recommendedIndex],
          comparedActionKey:
            step.legalActionKeys?.[descriptor.selectedIndex]
        });
      if (!step.actionRankingAuditReference) {
        teacherActionAuditReferences -= 1;
        teacherActionAuditDiagnosticCounts["reference-contract-rejected"] =
          (teacherActionAuditDiagnosticCounts[
            "reference-contract-rejected"
          ] || 0) + 1;
      }
    }
  }
  resolveResourceReservations(completed ? "game-ended" : "collection-ended");
  for (const tracker of handOpportunityTrackers.values()) {
    const priorOutcomes = tracker.outcomes.length;
    completeHandOpportunityTracking(tracker, game, actionCount, completed ? "game-ended" : "collection-ended");
    handOpportunityOutcomes.push(...tracker.outcomes.slice(priorOutcomes));
  }
  const rewards = completed ? terminalRewards(game) : null;
  const postmortem = reviewDefeatPostmortems(postmortemCandidates, {
    winnerId: completed ? game.winnerId : null,
    finalScores: game.players.map((player) => player.score),
    maximumReviews: postmortemReviews,
    minimumSimulations: options.postmortemSimulations || 16,
    maximumSimulations: options.teacherConfirmationMaxSimulations || 32,
    screenSimulations: options.teacherScreenSimulations
      ?? options.teacherSimulations
      ?? 4,
    minimumConfidence: options.postmortemMinimumConfidence || 0.45,
    minimumRegret: options.postmortemMinimumRegret || 0.05,
    depth: options.postmortemDepth || Math.max(16, options.teacherDepth || 10),
    maxCandidates: options.postmortemCandidates || options.teacherCandidates || 6,
    winnerReviewFraction: options.postmortemWinnerReviewFraction ?? 0.15,
    model: DEFAULT_AI_MODEL,
    engineFingerprint: options.engineFingerprint,
    neuralModels: teacherNeuralModels,
    evaluatorModelsByActor: Object.fromEntries(game.players.map((player) => [
      player.id,
      teacherEvaluatorCertification[player.id]?.accepted || []
    ]))
  });
  if (spectatorReplay) finalizeSpectatorReplay(spectatorReplay, game, options.replayMetadata);
  const outputTrajectories = [];
  const recordedSteps = [...trajectories.values()].flat();
  for (const key of Object.keys(turningPoints)) delete turningPoints[key];
  for (const step of recordedSteps) {
    if (step.turningPoint) turningPoints[step.turningPoint] = (turningPoints[step.turningPoint] || 0) + 1;
  }
  const tacticalSteps = recordedSteps.filter((step) => step.tacticalProfile);
  const movementTacticalSteps = tacticalSteps.filter((step) => step.tacticalProfile.isMovement);
  for (let seat = 0; seat < game.players.length; seat += 1) {
    const player = game.players[seat];
    if (!trainableSeats.has(seat)) continue;
    const steps = trajectories.get(player.id);
    if (!completed) continue;
    applyGeneralizedAdvantageEstimation(
      steps,
      rewards[player.id],
      options.gamma || 0.997,
      options.gaeLambda || 0.95,
      options.shapingWeight || 0,
      options.diagnosticWeight ?? 0,
      {
        longLambda: options.longHorizonLambda ?? 1,
        longWeight: options.longHorizonWeight ?? 0.6
      }
    );
    outputTrajectories.push({
      playerId: player.id,
      ...(options.evidenceSamplingFrame?.distribution === "natural-distribution"
        ? { leafAuditSamplingDistribution: "natural-distribution" } : {}),
      completed: true,
      learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
      engineFingerprint: options.engineFingerprint || null,
      decisionSafetyVersion: game.decisionSafety?.version || null,
      teacherEvaluatorCertification: {
        version: 1,
        actorId: player.id,
        accepted: teacherEvaluatorCertification[player.id]?.accepted?.length || 0,
        rejectedReasons: (teacherEvaluatorCertification[player.id]?.rejected || [])
          .map((item) => item.reasons)
      },
      decisionSafetyViolations: structuredClone(game.decisionSafety?.violations || []),
      terminalOutcome: rewards[player.id],
      steps
    });
  }
  return {
    trajectories: outputTrajectories,
    pendingLeafAudit: completed && deferredLeafAuditCandidates.length
      ? { version: 1, contract: "detached-leaf-audit-state-bank-v1",
        candidates: deferredLeafAuditCandidates } : null,
    pendingActionAudit:
      completed
      && detachedIndependentActionAudit
      && deferredActionAuditCandidates.length > 0
        ? {
          version: 1,
          contract: "detached-independent-action-audit-candidates-v1",
          executionContract: "global-seed-batch-queue-v1",
          modelSeatSources: structuredClone(
            options.actionAuditModelSeatSources || []
          ),
          candidates: deferredActionAuditCandidates.map(
            serializeDeferredActionAuditCandidate
          )
        }
        : null,
    summary: {
      winnerId: game.winnerId || null,
      completed: game.phase === "complete",
      actions: actionCount,
      scores: game.players.map((player) => player.score),
      deckIds: decks.map((deck) => deck.id),
      strategicActions: actionCount,
      engineActions: engineActionCount,
      paymentPlans,
      paymentActions,
      teacherQueries,
      teacherEvaluatorMode,
      teacherAgreements,
      teacherCommitRecommendations,
      teacherReserveRecommendations,
      teacherAverageResponseProbability: teacherQueries ? teacherResponseProbabilityTotal / teacherQueries : 0,
      teacherAverageExpectedWinRate: teacherQueries ? teacherExpectedWinRateTotal / teacherQueries : 0,
      mulliganDecisions,
      mulliganCardsReturned,
      teacherMulliganQueries,
      teacherUncertaintyQueries,
      teacherCriticalQueries,
      teacherUrgentQueries,
      teacherVerifiedCorrections,
      teacherProvisionalLabels,
      teacherRejectedLabels,
      teacherActionAuditAttempts,
      teacherActionAuditReferences,
      teacherActionAuditCandidatesDiscovered,
      teacherActionAuditCandidatesExpandedTo16,
      teacherActionAuditCandidatesExpandedTo32,
      teacherActionAuditFinalCandidates,
      teacherActionAuditPairedSeedsCompleted,
      teacherActionAuditCandidatePoolChanges,
      teacherActionAuditQueriesSuppressed,
      teacherActionAuditMaximumQueries:
        deferIndependentActionAudit
          ? teacherActionAuditMaximumQueries
          : null,
      teacherActionAuditExecution:
        detachedIndependentActionAudit
          ? "global-seed-batch-queue-v1"
          : deferIndependentActionAudit
            ? "inline-candidate-race-v1"
            : null,
      teacherLeafAuditPairs,
      teacherLeafAuditAttempts,
      teacherActionAuditDiagnosticCounts,
      teacherActionAuditFailureReasons,
      teacherQueryTypes,
      teacherTypeBudget,
      teacherImmediateProofs,
      teacherMacroProofs,
      teacherMacroDemonstrationSteps,
      proofChecks,
      proofLabels,
      proofAgreements,
      proofCorrections,
      proofKinds,
      postmortemCapturedCandidates: postmortem.capturedCandidates,
      postmortemReviews: postmortem.reviewed,
      postmortemWinnerAudits: postmortem.winnerAudits,
      postmortemLoserAudits: postmortem.loserAudits,
      postmortemVerifiedCorrections: postmortem.verifiedCorrections,
      postmortemUnprovenReviews: postmortem.unproven,
      postmortemAverageRegret: postmortem.averageRegret,
      postmortemCauses: postmortem.causes,
      postmortemReviewDetails: postmortem.reviews,
      criticalDecisionSteps: recordedSteps.filter((step) => step.criticalDecisionTypes?.length).length,
      urgentDecisionSteps: recordedSteps.filter((step) => step.criticalDecisionUrgent).length,
      tacticalDecisions: tacticalSteps.length,
      misalignedTargetChoices: tacticalSteps.filter((step) => step.tacticalProfile.targetAlignment < 0).length,
      lowImpactTradeoffChoices: tacticalSteps.filter((step) => step.tacticalProfile.targetAlignment < 0
        && step.tacticalProfile.targetImpact < 0.5 && step.tacticalProfile.casterSideBenefit > 0).length,
      hopelessReinforcements: tacticalSteps.filter((step) => step.tacticalProfile.hopelessReinforcement).length,
      reversedRemovals: tacticalSteps.filter((step) => step.tacticalProfile.reversesRemoval).length,
      singleUnitMoves: tacticalSteps.filter((step) => step.tacticalProfile.isMovement
        && step.tacticalProfile.movingUnitCount === 1).length,
      multiUnitMoves: tacticalSteps.filter((step) => step.tacticalProfile.isMovement
        && step.tacticalProfile.movingUnitCount > 1).length,
      directBreakthroughMoves: tacticalSteps.filter((step) =>
        step.tacticalProfile.canRemoveEnemyNoResponse).length,
      tacticalSetupMoves: tacticalSteps.filter((step) =>
        step.tacticalProfile.tacticalRemovalPossible).length,
      noOpponentImpactMoves: tacticalSteps.filter((step) =>
        step.tacticalProfile.noOpponentImpact).length,
      averageMoveGroupSize: movementTacticalSteps.length
        ? movementTacticalSteps.reduce((sum, step) => sum + step.tacticalProfile.movingUnitCount, 0)
          / movementTacticalSteps.length
        : 0,
      averageTacticalPrior: tacticalSteps.length
        ? tacticalSteps.reduce((sum, step) => sum + step.tacticalProfile.tacticalPrior, 0) / tacticalSteps.length
        : 0,
      turningPoints,
      resourceReservationDecisions: resourceReservationOutcomes.length,
      resourceReservationTargetsUsed: resourceReservationOutcomes.filter((outcome) => outcome.targetUsed).length,
      beneficialResourceReservations: resourceReservationOutcomes.filter((outcome) => outcome.result.beneficial).length,
      harmfulResourceReservations: resourceReservationOutcomes.filter((outcome) => outcome.result.harmful).length,
      averageResourceReservationReward: resourceReservationOutcomes.length
        ? resourceReservationOutcomes.reduce((sum, outcome) => sum + outcome.result.learningReward, 0) / resourceReservationOutcomes.length
        : 0,
      resourceReservationOutcomes,
      handOpportunityDecisions: handOpportunityOutcomes.length,
      staleHandCards: handOpportunityOutcomes.filter((outcome) => outcome.result.stale).length,
      harmfulStaleHandCards: handOpportunityOutcomes.filter((outcome) => outcome.result.harmful).length,
      unplayableDormantCards: handOpportunityOutcomes.filter((outcome) => outcome.result.unplayableDormancy).length,
      averageHandReservationRegret: handOpportunityOutcomes.length
        ? handOpportunityOutcomes.reduce((sum, outcome) => sum + outcome.result.reservationRegret, 0) / handOpportunityOutcomes.length
        : 0,
      diagnosticRewardSteps: recordedSteps.filter((step) =>
        Number(step.resourceReservationDiagnosticReward) || Number(step.handOpportunityDiagnosticReward)).length,
      totalDiagnosticReward: recordedSteps.reduce((sum, step) => sum
        + (Number(step.resourceReservationDiagnosticReward) || 0)
        + (Number(step.handOpportunityDiagnosticReward) || 0), 0),
      handOpportunityOutcomes: handOpportunityOutcomes.map(compactHandOpportunityOutcome),
      averageSelectedMulliganExpectedDelta: mulliganDecisions ? selectedMulliganExpectedDeltaTotal / mulliganDecisions : 0,
      teacherAverageMulliganExpectedDelta: teacherMulliganQueries ? mulliganExpectedDeltaTotal / teacherMulliganQueries : 0,
      decisionSafetyViolations: structuredClone(game.decisionSafety?.violations || [])
    },
    game,
    spectatorReplay
  };
}

function serializeDeferredActionAuditCandidate(candidate) {
  return {
    version: 1,
    auditKey: candidate.descriptor.auditKey,
    descriptor: structuredClone(candidate.descriptor),
    recordedStepLocator: structuredClone(
      candidate.recordedStepLocator || null
    ),
    actionCount: Number(candidate.actionCount) || 0,
    stratum: structuredClone(candidate.stratum || null),
    selectionSource: candidate.selectionSource || "priority",
    game: cloneGame(candidate.game),
    actorId: candidate.actorId,
    initialMemories: structuredClone(candidate.initialMemories || {}),
    neuralBelief: candidate.neuralBelief
      ? Float32Array.from(candidate.neuralBelief)
      : null,
    engineFingerprint: candidate.engineFingerprint || null
  };
}

export function playNeuralBestOfThree(options) {
  const random = options.random || Math.random;
  const currentDecks = options.decks.map((deck) => structuredClone(deck));
  const models = options.models || [options.model, options.model];
  const sideboardSessions = models.map((model) => createNeuralSession(model));
  const trainableSeats = new Set(options.trainableSeats || [0, 1]);
  const matchSteps = [[], []];
  const wins = [0, 0];
  const games = [];
  const spectatorReplays = [];
  const sideboardHistory = [];
  const initialDecks = options.decks.map((deck) => structuredClone(deck));
  let firstPlayerId = options.firstPlayerId || "p1";
  let lastGame = null;
  for (let gameNumber = 1; gameNumber <= 3 && Math.max(...wins) < 2; gameNumber += 1) {
    let played;
    try {
      played = playNeuralSelfPlayGame({
        ...options,
        decks: currentDecks,
        models,
        trainableSeats: [...trainableSeats],
        firstPlayerId,
        // Later games already have a loser-selected play order below.
        learnFirstPlayerChoice: gameNumber === 1 && Boolean(options.learnFirstPlayerChoice),
        random
      });
    } catch (error) {
      throw enrichSelfPlayError(error, {
        match: {
          gameNumber,
          firstPlayerId,
          wins: [...wins],
          initialDecks,
          currentDecks: currentDecks.map((deck) => structuredClone(deck)),
          sideboardHistory
        }
      });
    }
    lastGame = played.game;
    games.push(played.summary);
    if (played.spectatorReplay) {
      played.spectatorReplay.matchGameNumber = gameNumber;
      spectatorReplays.push(played.spectatorReplay);
    }
    for (const trajectory of played.trajectories) {
      const seat = trajectory.playerId === "p1" ? 0 : 1;
      matchSteps[seat].push(...trajectory.steps);
    }
    const actualWinnerSeat = played.game.winnerId === "p1" ? 0 : played.game.winnerId === "p2" ? 1 : -1;
    const winnerSeat = actualWinnerSeat;
    if (winnerSeat >= 0) wins[winnerSeat] += 1;
    if (Math.max(...wins) >= 2 || gameNumber === 3) break;
    if (winnerSeat < 0) continue;
    for (let seat = 0; seat < 2; seat += 1) {
      if (!currentDecks[seat].sideboard?.length) continue;
      const playerId = `p${seat + 1}`;
      const sideboardSession = sideboardSessions[seat];
      lastGame.aiSideboardContext ||= {};
      lastGame.aiSideboardContext[playerId] = {
        main: currentDecks[seat].main,
        sideboard: currentDecks[seat].sideboard,
        metaCards: metaWeightedCards(options.meta || models[seat].knowledge)
      };
      for (let swap = 0; swap < Math.min(3, currentDecks[seat].sideboard.length); swap += 1) {
        const legal = enumerateSideboardActions(currentDecks[seat], models[seat].knowledge, 191);
        const decision = sideboardSession.decide(lastGame, playerId, legal, { temperature: options.temperature || 0.8, random });
        if (trainableSeats.has(seat)) matchSteps[seat].push(sideboardStep(decision, lastGame, playerId));
        if (!decision || decision.action.kind === "sideboardDone") break;
        const applied = applyResolvedSideboardSwap(currentDecks[seat], decision.action);
        sideboardHistory.push({ gameNumber, seat, action: structuredClone(decision.action), applied });
        if (!applied) throw createSelfPlayError("Neural policy selected an invalid sideboard swap.", lastGame, {
          kind: "invalid-sideboard-swap",
          stage: "sideboard",
          match: {
            gameNumber,
            firstPlayerId,
            wins: [...wins],
            initialDecks,
            currentDecks: currentDecks.map((deck) => structuredClone(deck)),
            sideboardHistory
          }
        });
      }
    }
    if (winnerSeat >= 0) {
      const chooserSeat = 1 - winnerSeat;
      const chooserId = `p${chooserSeat + 1}`;
      const decision = sideboardSessions[chooserSeat].decide(lastGame, chooserId, [
        { kind: "chooseFirstPlayer", playerId: "p1" },
        { kind: "chooseFirstPlayer", playerId: "p2" }
      ], { temperature: options.temperature || 0.8, random });
      if (trainableSeats.has(chooserSeat)) matchSteps[chooserSeat].push(sideboardStep(decision, lastGame, chooserId));
      firstPlayerId = decision.action.playerId;
    }
  }
  const winnerSeat = wins[0] > wins[1] ? 0 : wins[1] > wins[0] ? 1 : -1;
  const trajectories = [];
  for (let seat = 0; seat < 2; seat += 1) {
    if (!trainableSeats.has(seat)) continue;
    const reward = winnerSeat < 0 ? 0 : winnerSeat === seat ? 1 : -1;
    applyGeneralizedAdvantageEstimation(
      matchSteps[seat],
      reward,
      options.gamma || 0.997,
      options.gaeLambda || 0.95,
      options.shapingWeight || 0,
      options.diagnosticWeight ?? 0,
      {
        longLambda: options.longHorizonLambda ?? 1,
        longWeight: options.longHorizonWeight ?? 0.6
      }
    );
    trajectories.push({
      playerId: `p${seat + 1}`,
      match: true,
      completed: winnerSeat >= 0,
      learningTargetVersion: NEURAL_LEARNING_TARGET_VERSION,
      terminalOutcome: reward,
      engineFingerprint: options.engineFingerprint || null,
      decisionSafetyVersion: 1,
      decisionSafetyViolations: games.flatMap((game) => game.decisionSafetyViolations || []),
      steps: matchSteps[seat]
    });
  }
  return {
    trajectories,
    summary: {
      type: "bestOfThree",
      completed: winnerSeat >= 0,
      winnerId: winnerSeat >= 0 ? `p${winnerSeat + 1}` : null,
      wins,
      games,
      deckIds: options.decks.map((deck) => deck.id),
      postmortemCapturedCandidates: games.reduce((sum, game) =>
        sum + (Number(game.postmortemCapturedCandidates) || 0), 0),
      postmortemReviews: games.reduce((sum, game) =>
        sum + (Number(game.postmortemReviews) || 0), 0),
      postmortemWinnerAudits: games.reduce((sum, game) =>
        sum + (Number(game.postmortemWinnerAudits) || 0), 0),
      postmortemLoserAudits: games.reduce((sum, game) =>
        sum + (Number(game.postmortemLoserAudits) || 0), 0),
      postmortemVerifiedCorrections: games.reduce((sum, game) =>
        sum + (Number(game.postmortemVerifiedCorrections) || 0), 0),
      postmortemUnprovenReviews: games.reduce((sum, game) =>
        sum + (Number(game.postmortemUnprovenReviews) || 0), 0),
      postmortemAverageRegret: weightedPostmortemRegret(games),
      postmortemCauses: mergePostmortemCauses(games),
      postmortemReviewDetails: games.flatMap((game) => game.postmortemReviewDetails || []),
      proofChecks: games.reduce((sum, game) => sum + (Number(game.proofChecks) || 0), 0),
      proofLabels: games.reduce((sum, game) => sum + (Number(game.proofLabels) || 0), 0),
      proofAgreements: games.reduce((sum, game) => sum + (Number(game.proofAgreements) || 0), 0),
      proofCorrections: games.reduce((sum, game) => sum + (Number(game.proofCorrections) || 0), 0),
      proofKinds: mergeProofKinds(games)
    },
    game: lastGame,
    spectatorReplays
  };
}

function weightedPostmortemRegret(games) {
  const reviews = games.reduce((sum, game) => sum + (Number(game.postmortemReviews) || 0), 0);
  if (!reviews) return 0;
  return games.reduce((sum, game) => sum
    + (Number(game.postmortemAverageRegret) || 0) * (Number(game.postmortemReviews) || 0), 0) / reviews;
}

function mergePostmortemCauses(games) {
  const causes = {};
  for (const game of games) {
    for (const [cause, count] of Object.entries(game.postmortemCauses || {})) {
      causes[cause] = (causes[cause] || 0) + Number(count || 0);
    }
  }
  return causes;
}

function mergeProofKinds(games) {
  const kinds = {};
  for (const game of games) {
    for (const [kind, count] of Object.entries(game.proofKinds || {})) {
      kinds[kind] = (kinds[kind] || 0) + Number(count || 0);
    }
  }
  return kinds;
}

export function enumerateSideboardActions(deck, knowledge = {}, limit = 191) {
  const main = [...new Map((deck.main || []).map((card) => [card.cardNumber, card])).values()];
  const sideboard = [...new Map((deck.sideboard || []).map((card) => [card.cardNumber, card])).values()];
  const scored = [];
  for (const outgoing of main) {
    for (const incoming of sideboard) {
      if (!sideboardSwapPreservesStartingChampion(deck, outgoing.cardNumber, incoming.cardNumber)) continue;
      scored.push({
        kind: "sideboardSwap",
        outCardNumber: outgoing.cardNumber,
        inCardNumber: incoming.cardNumber,
        score: sideboardPrior(knowledge, incoming.cardNumber) - sideboardPrior(knowledge, outgoing.cardNumber)
      });
    }
  }
  scored.sort((left, right) => right.score - left.score || left.outCardNumber.localeCompare(right.outCardNumber) || left.inCardNumber.localeCompare(right.inCardNumber));
  return [...scored.slice(0, limit).map(({ score, ...action }) => action), { kind: "sideboardDone" }];
}

export function applyResolvedSideboardSwap(deck, action) {
  if (action?.kind !== "sideboardSwap") return false;
  if (!sideboardSwapPreservesStartingChampion(deck, action.outCardNumber, action.inCardNumber)) return false;
  const outIndex = deck.main.findIndex((card) => card.cardNumber === action.outCardNumber);
  const inIndex = deck.sideboard.findIndex((card) => card.cardNumber === action.inCardNumber);
  if (outIndex < 0 || inIndex < 0) return false;
  const outgoing = deck.main[outIndex];
  deck.main[outIndex] = deck.sideboard[inIndex];
  deck.sideboard[inIndex] = outgoing;
  return true;
}

export function sideboardSwapPreservesStartingChampion(deck, outCardNumber, inCardNumber) {
  const outIndex = deck?.main?.findIndex((card) => card.cardNumber === outCardNumber) ?? -1;
  const inIndex = deck?.sideboard?.findIndex((card) => card.cardNumber === inCardNumber) ?? -1;
  if (outIndex < 0 || inIndex < 0) return false;
  const remainingMain = deck.main.filter((card, index) => index !== outIndex);
  remainingMain.push(deck.sideboard[inIndex]);
  return remainingMain.some((card) => championMatchesLegend(card, deck.legend));
}

export function evaluateNeuralModels(candidate, champion, decks, options = {}) {
  if(Boolean(options.decisionReviewHash)!==(typeof options.reviewDecision==='function'))
    throw new Error('Evaluation reviewer and identity must be supplied together.');
  const evaluationMode = options.evaluationMode || "same-deck-mirror-v2";
  const evaluationBlockSize = evaluationMode === "same-deck-mirror-v3" ? 8 : 4;
  const games = Math.max(evaluationBlockSize,
    Math.ceil((options.games || 20) / evaluationBlockSize) * evaluationBlockSize);
  let candidateWins = 0;
  let completed = 0;
  const seatStats = [{ games: 0, completed: 0, wins: 0 }, { games: 0, completed: 0, wins: 0 }];
  const conditionStats = {};
  const summaries = [];
  let naturallyCompleted = 0;
  let adjudicatedGames = 0;
  let adjudicatedWins = 0;
  let pair = null;
  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const { candidateSeat, firstPlayerId } = evaluationConditionSchedule(gameIndex);
    if (evaluationMode.startsWith("cross-deck-matrix-")) {
      const matchup = scheduledEvaluationMatrixPair(decks, Math.floor(gameIndex / 4), options.seed || 1);
      pair = candidateSeat === 0 ? matchup : [matchup[1], matchup[0]];
    } else if (gameIndex % evaluationBlockSize === 0) {
      pair = evaluationMode.startsWith("same-deck-mirror-")
        ? scheduledEvaluationDeckPair(decks, Math.floor(gameIndex / evaluationBlockSize), options.seed || 1)
        : scheduledDeckPair(decks, Math.floor(gameIndex / evaluationBlockSize), options.seed || 1);
    }
    const gameSeed = ((options.seed || 1)
      + Math.floor(gameIndex / evaluationBlockSize) * 104729) >>> 0;
    const streamAssignment = evaluationMode === "same-deck-mirror-v3"
      ? Math.floor((gameIndex % 8) / 4)
      : 0;
    const expected = {
      candidateSeat,
      firstPlayerId,
      gameSeed,
      evaluationMode,
      streamAssignment,
      deckIds: pair.map((deck) => deck.id),
      ...(options.decisionReviewHash ? {decisionReviewHash:options.decisionReviewHash} : {})
    };
    const reusable = reusableEvaluationSummary(options.resumedSummaries?.[gameIndex], expected);
    let summary = reusable;
    if (!summary) {
      const playerRandomSeeds = ["same-deck-mirror-v2", "same-deck-mirror-v3"].includes(evaluationMode)
        ? pairedEvaluationPlayerSeeds(gameSeed, candidateSeat, streamAssignment)
        : null;
      const game = createGame({ decks: pair, firstPlayerId, interactive: true, manualActionChainPriority: true, decisionSafety: "strict", random: seededRandom(gameSeed), randomSeed: gameSeed, playerRandomSeeds });
      // Evaluation consumes only the selected action. The lean path retains
      // policy + action-Q logits and recurrent memory, omitting unused heads.
      const sessionOptions = { lean: options.fullInference !== true, maxHistory: 0 };
      const sessions = [createNeuralSession(candidateSeat === 0 ? candidate : champion, sessionOptions), createNeuralSession(candidateSeat === 1 ? candidate : champion, sessionOptions)];
      const decisionCycleGuard = createAiDecisionCycleGuard();
      const decisionSeeds = pairedEvaluationDecisionSeeds(
        gameSeed,
        candidateSeat,
        streamAssignment
      );
      const decisionRandoms = [
        seededRandom(decisionSeeds.p1),
        seededRandom(decisionSeeds.p2)
      ];
      let actionCount = 0;
      let invalid = null;
      const reviewStats=options.reviewDecision?[0,1].map(()=>({decisions:0,changed:0,previews:0,budgetExceeded:0,errors:0,reasons:{}})):null;
      for (; actionCount < (options.maxActions || 600) && game.phase !== "complete"; actionCount += 1) {
        const decisionCycle = decisionCycleGuard.inspect(game);
        if (decisionCycle) {
          invalid = { ...decisionCycle, message: "AI decision cycle detected during evaluation." };
          break;
        }
        if (game.pendingPayment && !needsPaymentOptionDecision(game)) {
          const paymentSeat = game.players.findIndex((player) => player.id === game.pendingPayment.playerId);
          const paymentModel = paymentSeat === candidateSeat ? candidate : champion;
          if (!resolvePlannedPayment(game, neuralPaymentOptions(paymentModel))?.ok) {
            invalid = { kind: "payment-plan-failed", playerId: game.pendingPayment?.playerId || null };
            break;
          }
          continue;
        }
        const actorId = activeActorId(game);
        const legal = enumerateAiPolicyActions(game, actorId);
        const boundaryViolations = auditDecisionBoundary(game, actorId, legal);
        if (boundaryViolations.length) {
          invalid = { kind: "decision-safety-violation", violation: structuredClone(boundaryViolations[0]) };
          break;
        }
        const seat = game.players.findIndex((player) => player.id === actorId);
        let selected = sessions[seat].decide(game, actorId, legal, {
          greedy: options.greedy !== false,
          temperature: options.temperature ?? 0.05,
          random: decisionRandoms[seat]
        });
        if(options.reviewDecision && selected){
          const reviewed=options.reviewDecision(game,actorId,selected,legal),diagnostic=reviewed?.review,stats=reviewStats[seat];
          stats.decisions++;stats.changed+=Number(diagnostic?.applied===true);stats.previews+=diagnostic?.previews||0;
          stats.budgetExceeded+=Number(diagnostic?.budgetExceeded===true);
          const reason=diagnostic?.reason||'missing-review';stats.reasons[reason]=(stats.reasons[reason]||0)+1;
          if(!reviewed?.selection || !diagnostic || diagnostic.reason==='review-error'){
            stats.errors++;invalid={kind:'evaluation-review-failed',actorId,error:diagnostic?.error||reason};break;
          }
          selected=reviewed.selection;
        }
        if (!selected || !applyAiAction(game, selected.action, actorId)?.ok) {
          invalid = { kind: "illegal-or-missing-policy-action", actorId, legalActions: legal.length };
          break;
        }
        const postActionViolations = auditRecordedDecisionSafety(game);
        if (postActionViolations.length) {
          invalid = { kind: "decision-safety-violation", violation: structuredClone(postActionViolations[0]) };
          break;
        }
      }
      const completedGame = game.phase === "complete" && Boolean(game.winnerId);
      const adjudication = completedGame || invalid ? null : adjudicateEvaluationGame(game, candidateSeat);
      summary = {
        completed: completedGame,
        invalid: Boolean(invalid),
        invalidReason: invalid,
        adjudicated: Boolean(adjudication),
        adjudication,
        counted: completedGame || Boolean(adjudication),
        winnerId: game.winnerId || adjudication?.winnerId || null,
        ...expected,
        scores: game.players.map((player) => player.score),
        actions: actionCount,
        ...(reviewStats?{decisionReviewStats:reviewStats}:{})
      };
    }
    summary.aiSeats ||= candidateSeat === 0
      ? [summarizeAiModel(candidate, "candidate"), summarizeAiModel(champion, options.opponentRole || "champion")]
      : [summarizeAiModel(champion, options.opponentRole || "champion"), summarizeAiModel(candidate, "candidate")];
    seatStats[candidateSeat].games += 1;
    const candidatePlayerId = candidateSeat === 0 ? "p1" : "p2";
    const condition = conditionStats[`seat-${candidateSeat}-${firstPlayerId === candidatePlayerId ? "first" : "second"}`] ||= { games: 0, completed: 0, wins: 0 };
    condition.games += 1;
    if (summary.completed) {
      completed += 1;
      naturallyCompleted += 1;
      seatStats[candidateSeat].completed += 1;
      condition.completed += 1;
      if (summary.winnerId === candidatePlayerId) candidateWins += 1;
      if (summary.winnerId === candidatePlayerId) seatStats[candidateSeat].wins += 1;
      if (summary.winnerId === candidatePlayerId) condition.wins += 1;
    } else if (summary.adjudicated) {
      adjudicatedGames += 1;
      if (summary.winnerId === candidatePlayerId) adjudicatedWins += 1;
    }
    summaries.push(summary);
    options.onGameComplete?.({ game: gameIndex + 1, games, completed, candidateWins, winRate: completed ? candidateWins / completed : 0, summary, resumed: Boolean(reusable) });
  }
  const winRate = completed ? candidateWins / completed : 0;
  const wilsonLowerBound = wilsonLower(candidateWins, completed);
  for (const stat of seatStats) {
    stat.winRate = stat.completed ? stat.wins / stat.completed : 0;
    stat.wilsonLowerBound = wilsonLower(stat.wins, stat.completed);
  }
  finalizeEvaluationStats(conditionStats);
  const seatGap = Math.abs(seatStats[0].winRate - seatStats[1].winRate);
  const conditionGap = evaluationConditionGap(conditionStats);
  const stability = evaluationStability(summaries);
  const invalidGames = summaries.filter((summary) => summary.invalid).length;
  return {
    games, completed, naturallyCompleted, adjudicatedGames, adjudicatedWins,
    adjudicatedWinRate: adjudicatedGames ? adjudicatedWins / adjudicatedGames : 0,
    invalidGames, candidateWins, winRate, wilsonLowerBound, seatStats, conditionStats,
    conditionGap, stability, deckStats: candidateDeckStats(summaries),
    matchupStats: candidateMatchupStats(summaries),
    matrixCoverage: evaluationMatrixCoverage(summaries, decks),
    seatGap,
    promoted: naturallyCompleted >= Math.ceil(games * 0.8)
      && wilsonLowerBound > (options.wilsonThreshold || 0.5)
      && seatGap <= (options.maxSeatGap || 0.2),
    summaries
  };
}

export function mergeNeuralEvaluations(evaluations, decks) {
  const valid = (evaluations || []).filter(Boolean);
  const summaries = valid.flatMap((evaluation) => evaluation.summaries || []);
  const games = valid.reduce((sum, evaluation) => sum + (Number(evaluation.games) || 0), 0);
  const seatStats = [{ games: 0, completed: 0, wins: 0 }, { games: 0, completed: 0, wins: 0 }];
  const conditionStats = {};
  let completed = 0;
  let naturallyCompleted = 0;
  let candidateWins = 0;
  let adjudicatedGames = 0;
  let adjudicatedWins = 0;
  for (const summary of summaries) {
    const candidateSeat = Number(summary.candidateSeat) === 1 ? 1 : 0;
    const candidatePlayerId = candidateSeat === 0 ? "p1" : "p2";
    const first = summary.firstPlayerId === candidatePlayerId ? "first" : "second";
    const condition = conditionStats[`seat-${candidateSeat}-${first}`] ||= {
      games: 0, completed: 0, wins: 0
    };
    seatStats[candidateSeat].games += 1;
    condition.games += 1;
    if (summary.completed) {
      completed += 1;
      naturallyCompleted += 1;
      seatStats[candidateSeat].completed += 1;
      condition.completed += 1;
      if (summary.winnerId === candidatePlayerId) {
        candidateWins += 1;
        seatStats[candidateSeat].wins += 1;
        condition.wins += 1;
      }
    } else if (summary.adjudicated) {
      adjudicatedGames += 1;
      if (summary.winnerId === candidatePlayerId) adjudicatedWins += 1;
    }
  }
  for (const stat of seatStats) {
    stat.winRate = stat.completed ? stat.wins / stat.completed : 0;
    stat.wilsonLowerBound = wilsonLower(stat.wins, stat.completed);
  }
  finalizeEvaluationStats(conditionStats);
  const winRate = completed ? candidateWins / completed : 0;
  return {
    games,
    completed,
    naturallyCompleted,
    adjudicatedGames,
    adjudicatedWins,
    adjudicatedWinRate: adjudicatedGames ? adjudicatedWins / adjudicatedGames : 0,
    invalidGames: summaries.filter((summary) => summary.invalid).length,
    candidateWins,
    winRate,
    wilsonLowerBound: wilsonLower(candidateWins, completed),
    seatStats,
    conditionStats,
    conditionGap: evaluationConditionGap(conditionStats),
    stability: evaluationStability(summaries),
    deckStats: candidateDeckStats(summaries),
    matchupStats: candidateMatchupStats(summaries),
    matrixCoverage: evaluationMatrixCoverage(summaries, decks),
    seatGap: Math.abs(seatStats[0].winRate - seatStats[1].winRate),
    summaries
  };
}

export function evaluateNeuralLeague(candidate, opponents, decks, options = {}) {
  const pool = opponents.length ? opponents : [candidate];
  const gamesPerOpponent = leagueGamesPerOpponent(pool.length, options);
  let evaluatedGames = 0;
  const results = pool.map((opponent, index) => evaluateNeuralModels(candidate, opponent, decks, {
    ...options,
    games: gamesPerOpponent,
    seed: options.opponentSeeds?.[index] ?? ((options.seed || Date.now()) + index * 7919),
    opponentRole: "league",
    resumedSummaries: options.resumedSummariesByOpponent?.[index],
    onGameComplete: (progress) => {
      evaluatedGames += 1;
      options.onGameComplete?.({
        game: evaluatedGames,
        games: pool.length * gamesPerOpponent,
        opponent: index + 1,
        opponents: pool.length,
        opponentGame: progress.game,
        gamesPerOpponent,
        progress
      });
    }
  }));
  const completed = results.reduce((sum, result) => sum + result.completed, 0);
  const naturallyCompleted = results.reduce((sum, result) => sum + result.naturallyCompleted, 0);
  const adjudicatedGames = results.reduce((sum, result) => sum + result.adjudicatedGames, 0);
  const adjudicatedWins = results.reduce((sum, result) => sum + (result.adjudicatedWins || 0), 0);
  const invalidGames = results.reduce((sum, result) => sum + (result.invalidGames || 0), 0);
  const candidateWins = results.reduce((sum, result) => sum + result.candidateWins, 0);
  return {
    opponents: pool.length,
    games: results.reduce((sum, result) => sum + result.games, 0),
    completed,
    naturallyCompleted,
    adjudicatedGames,
    adjudicatedWins,
    adjudicatedWinRate: adjudicatedGames ? adjudicatedWins / adjudicatedGames : 0,
    invalidGames,
    candidateWins,
    winRate: completed ? candidateWins / completed : 0,
    wilsonLowerBound: wilsonLower(candidateWins, completed),
    worstOpponentWinRate: Math.min(...results.map((result) => result.winRate)),
    worstOpponentWilsonLowerBound: Math.min(...results.map((result) => result.wilsonLowerBound)),
    maxSeatGap: Math.max(...results.map((result) => result.seatGap || 0)),
    maxConditionGap: Math.max(...results.map((result) => result.conditionGap || 0)),
    blowoutRate: completed ? results.reduce((sum, result) => sum + (result.stability?.blowouts || 0), 0) / completed : 0,
    results
  };
}

export function leagueGamesPerOpponent(opponentCount, options = {}) {
  return Math.max(20, Math.ceil(options.gamesPerOpponent || (options.games || 20) / Math.max(1, opponentCount)));
}

export function evaluateNeuralAgainstHeuristic(candidate, decks, options = {}) {
  const evaluationMode = options.evaluationMode || "same-deck-mirror-v2";
  const evaluationBlockSize = evaluationMode === "same-deck-mirror-v3" ? 8 : 4;
  const games = Math.max(evaluationBlockSize,
    Math.ceil((options.games || 40) / evaluationBlockSize) * evaluationBlockSize);
  let candidateWins = 0;
  let completed = 0;
  const seatStats = [{ games: 0, completed: 0, wins: 0 }, { games: 0, completed: 0, wins: 0 }];
  const conditionStats = {};
  const summaries = [];
  let naturallyCompleted = 0;
  let adjudicatedGames = 0;
  let adjudicatedWins = 0;
  let pair = null;
  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const { candidateSeat, firstPlayerId } = evaluationConditionSchedule(gameIndex);
    if (evaluationMode.startsWith("cross-deck-matrix-")) {
      const matchup = scheduledEvaluationMatrixPair(decks, Math.floor(gameIndex / 4), options.seed || 1);
      pair = candidateSeat === 0 ? matchup : [matchup[1], matchup[0]];
    } else if (gameIndex % evaluationBlockSize === 0) {
      pair = evaluationMode.startsWith("same-deck-mirror-")
        ? scheduledEvaluationDeckPair(decks, Math.floor(gameIndex / evaluationBlockSize), options.seed || 1)
        : scheduledDeckPair(decks, Math.floor(gameIndex / evaluationBlockSize), options.seed || 1);
    }
    const gameSeed = ((options.seed || 1)
      + Math.floor(gameIndex / evaluationBlockSize) * 130363) >>> 0;
    const streamAssignment = evaluationMode === "same-deck-mirror-v3"
      ? Math.floor((gameIndex % 8) / 4)
      : 0;
    const expected = {
      candidateSeat,
      firstPlayerId,
      gameSeed,
      evaluationMode,
      streamAssignment,
      deckIds: pair.map((deck) => deck.id)
    };
    const reusable = reusableEvaluationSummary(options.resumedSummaries?.[gameIndex], expected);
    let summary = reusable;
    if (!summary) {
      const playerRandomSeeds = ["same-deck-mirror-v2", "same-deck-mirror-v3"].includes(evaluationMode)
        ? pairedEvaluationPlayerSeeds(gameSeed, candidateSeat, streamAssignment)
        : null;
      const game = createGame({ decks: pair, firstPlayerId, interactive: true, manualActionChainPriority: true, decisionSafety: "strict", random: seededRandom(gameSeed), randomSeed: gameSeed, playerRandomSeeds });
      const candidateSession = createNeuralSession(candidate);
      const decisionCycleGuard = createAiDecisionCycleGuard();
      const decisionSeeds = pairedEvaluationDecisionSeeds(
        gameSeed,
        candidateSeat,
        streamAssignment
      );
      const decisionRandom = seededRandom(candidateSeat === 0
        ? decisionSeeds.p1
        : decisionSeeds.p2);
      let actionCount = 0;
      let invalid = null;
      for (; actionCount < (options.maxActions || 600) && game.phase !== "complete"; actionCount += 1) {
        const decisionCycle = decisionCycleGuard.inspect(game);
        if (decisionCycle) {
          invalid = { ...decisionCycle, message: "AI decision cycle detected during evaluation." };
          break;
        }
        if (game.pendingPayment && !needsPaymentOptionDecision(game)) {
          const paymentSeat = game.players.findIndex((player) => player.id === game.pendingPayment.playerId);
          const paymentModel = paymentSeat === candidateSeat ? candidate : (options.baseline || DEFAULT_AI_MODEL);
          if (!resolvePlannedPayment(game, neuralPaymentOptions(paymentModel))?.ok) {
            invalid = { kind: "payment-plan-failed", playerId: game.pendingPayment?.playerId || null };
            break;
          }
          continue;
        }
        const actorId = activeActorId(game);
        const legal = enumerateAiPolicyActions(game, actorId);
        const boundaryViolations = auditDecisionBoundary(game, actorId, legal);
        if (boundaryViolations.length) {
          invalid = { kind: "decision-safety-violation", violation: structuredClone(boundaryViolations[0]) };
          break;
        }
        const seat = game.players.findIndex((player) => player.id === actorId);
        const action = seat === candidateSeat
          ? candidateSession.decide(game, actorId, legal, {
            greedy: options.greedy !== false,
            temperature: options.temperature ?? 0.05,
            random: decisionRandom
          })?.action
          : scoreActions(game, actorId, legal, options.baseline || DEFAULT_AI_MODEL)[0]?.action;
        if (!action || !applyAiAction(game, action, actorId)?.ok) {
          invalid = { kind: "illegal-or-missing-policy-action", actorId, legalActions: legal.length };
          break;
        }
        const postActionViolations = auditRecordedDecisionSafety(game);
        if (postActionViolations.length) {
          invalid = { kind: "decision-safety-violation", violation: structuredClone(postActionViolations[0]) };
          break;
        }
      }
      const completedGame = game.phase === "complete" && Boolean(game.winnerId);
      const adjudication = completedGame || invalid ? null : adjudicateEvaluationGame(game, candidateSeat);
      summary = {
        completed: completedGame,
        invalid: Boolean(invalid),
        invalidReason: invalid,
        adjudicated: Boolean(adjudication),
        adjudication,
        counted: completedGame || Boolean(adjudication),
        winnerId: game.winnerId || adjudication?.winnerId || null,
        ...expected,
        scores: game.players.map((player) => player.score),
        actions: actionCount
      };
    }
    summary.aiSeats ||= candidateSeat === 0
      ? [summarizeAiModel(candidate, "candidate"), { role: "heuristic", generation: null }]
      : [{ role: "heuristic", generation: null }, summarizeAiModel(candidate, "candidate")];
    seatStats[candidateSeat].games += 1;
    const candidatePlayerId = candidateSeat === 0 ? "p1" : "p2";
    const condition = conditionStats[`seat-${candidateSeat}-${firstPlayerId === candidatePlayerId ? "first" : "second"}`] ||= { games: 0, completed: 0, wins: 0 };
    condition.games += 1;
    if (summary.completed) {
      completed += 1;
      naturallyCompleted += 1;
      seatStats[candidateSeat].completed += 1;
      condition.completed += 1;
      if (summary.winnerId === candidatePlayerId) {
        candidateWins += 1;
        seatStats[candidateSeat].wins += 1;
        condition.wins += 1;
      }
    } else if (summary.adjudicated) {
      adjudicatedGames += 1;
      if (summary.winnerId === candidatePlayerId) adjudicatedWins += 1;
    }
    summaries.push(summary);
    options.onGameComplete?.({ game: gameIndex + 1, games, completed, candidateWins, winRate: completed ? candidateWins / completed : 0, summary, resumed: Boolean(reusable) });
  }
  for (const stat of seatStats) {
    stat.winRate = stat.completed ? stat.wins / stat.completed : 0;
    stat.wilsonLowerBound = wilsonLower(stat.wins, stat.completed);
  }
  finalizeEvaluationStats(conditionStats);
  const winRate = completed ? candidateWins / completed : 0;
  const wilsonLowerBound = wilsonLower(candidateWins, completed);
  const seatGap = Math.abs(seatStats[0].winRate - seatStats[1].winRate);
  const conditionGap = evaluationConditionGap(conditionStats);
  const stability = evaluationStability(summaries);
  const invalidGames = summaries.filter((summary) => summary.invalid).length;
  return {
    games, completed, naturallyCompleted, adjudicatedGames, adjudicatedWins,
    adjudicatedWinRate: adjudicatedGames ? adjudicatedWins / adjudicatedGames : 0,
    invalidGames, candidateWins, winRate, wilsonLowerBound, seatStats, conditionStats,
    conditionGap, stability, deckStats: candidateDeckStats(summaries),
    matchupStats: candidateMatchupStats(summaries),
    matrixCoverage: evaluationMatrixCoverage(summaries, decks),
    seatGap,
    promoted: naturallyCompleted >= Math.ceil(games * 0.8)
      && wilsonLowerBound >= (options.wilsonThreshold ?? 0.4)
      && seatGap <= (options.maxSeatGap || 0.2),
    summaries
  };
}

export async function collectParallelSelfPlay(options) {
  const workers = Math.max(1, Math.min(options.workers || 1, options.games));
  const serializedModel = serializeNeuralModel(options.model);
  const serializedLeague = (options.league || []).map(serializeNeuralModel);
  const serializedTeacherEvaluators = (options.teacherEvaluatorModels || [])
    .map(serializeNeuralModel);
  const assignments = Array.from({ length: workers }, (_, index) => Math.floor(options.games / workers) + (index < options.games % workers ? 1 : 0));
  const comparisonBlockOffsets = assignments.map((_, index) => assignments.slice(0, index).reduce((sum, count) => sum + Math.ceil(count / 4), 0));
  const settledResults = await Promise.allSettled(assignments.filter(Boolean).map((games, index) => {
    return new Promise((resolve, reject) => {
      const workerSeed = (options.seed || Date.now()) + index * 100003;
      const completedGameIndexes = [...(options.completedGameIndexes?.get?.(index) || options.completedGameIndexes?.[index] || [])];
      const streamGames = typeof options.onGameComplete === "function";
      const worker = new Worker(new URL("../../../scripts/ai-selfplay-worker.mjs", import.meta.url), {
        execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
        workerData: {
          games,
          workerIndex: index,
          seed: workerSeed,
          maxActions: options.maxActions || 600,
          temperature: options.temperature || 0.8,
          model: serializedModel,
          league: serializedLeague,
          teacherEvaluatorModels: serializedTeacherEvaluators,
          meta: options.meta || null,
          bestOfThreeFraction: options.bestOfThreeFraction ?? 0.25,
          mirrorFraction: options.mirrorFraction ?? 0.25,
          shapingWeight: options.shapingWeight || 0,
          diagnosticWeight: options.diagnosticWeight ?? 0,
          gamma: options.gamma ?? 0.997,
          gaeLambda: options.gaeLambda ?? 0.95,
          longHorizonLambda: options.longHorizonLambda ?? 1,
          longHorizonWeight: options.longHorizonWeight ?? 0.6,
          engineFingerprint: options.engineFingerprint || null,
          decks: options.decks,
          balancedPairings: options.balancedPairings !== false,
          deckCurriculum: options.deckCurriculum || null,
          teacherFraction: options.teacherFraction ?? 0.12,
          teacherBudget: options.teacherBudget ?? 16,
          teacherCriticalBudget: options.teacherCriticalBudget ?? 8,
          teacherUrgentBudget: options.teacherUrgentBudget ?? 4,
          teacherScreenSimulations: options.teacherScreenSimulations
            ?? options.teacherSimulations
            ?? 4,
          teacherConfirmationSimulations: options.teacherConfirmationSimulations ?? 16,
          teacherConfirmationMaxSimulations: options.teacherConfirmationMaxSimulations ?? 32,
          teacherDepth: options.teacherDepth || 10,
          teacherCandidates: options.teacherCandidates || 6,
          teacherLeafAuditSimulations:
            options.teacherLeafAuditSimulations ?? 128,
          teacherEvaluatorMode: options.teacherEvaluatorMode || "certified-neural-ensemble",
          captureProductionLeafAudit:
            options.captureProductionLeafAudit === true,
          captureIndependentLeafAudit:
            options.captureIndependentLeafAudit !== false,
          detachedIndependentLeafAudit:
            options.detachedIndependentLeafAudit === true,
          captureIndependentActionAudit:
            options.captureIndependentActionAudit === true,
          deferIndependentActionAudit:
            options.deferIndependentActionAudit === true,
          detachedIndependentActionAudit:
            options.detachedIndependentActionAudit === true,
          teacherActionAuditCandidatePoolSize:
            Number(options.teacherActionAuditCandidatePoolSize) || 0,
          teacherActionAuditMaximumQueries:
            Number(options.teacherActionAuditMaximumQueries) || 0,
          teacherActionAuditReducedQueryFraction:
            Number.isFinite(
              Number(options.teacherActionAuditReducedQueryFraction)
            )
              ? Math.max(
                0,
                Math.min(
                  1,
                  Number(options.teacherActionAuditReducedQueryFraction)
                )
              )
              : undefined,
          teacherActionAuditSaturationQueries:
            Number(options.teacherActionAuditSaturationQueries) || 0,
          teacherActionAuditBudget:
            Number.isFinite(Number(options.teacherActionAuditBudget))
              ? Math.max(0, Number(options.teacherActionAuditBudget))
              : 4,
          teacherActionAuditMaximumSteps:
            Math.max(
              192,
              Number(options.teacherActionAuditMaximumSteps) || 1200
            ),
          stopTeacherAfterActionAuditBudget:
            options.stopTeacherAfterActionAuditBudget === true,
          teacherLeafAuditPairBudget:
            Number.isFinite(Number(options.teacherLeafAuditPairBudget))
              ? Math.max(
                0,
                Math.floor(Number(options.teacherLeafAuditPairBudget))
              )
              : undefined,
          stopTeacherAfterLeafAuditBudget:
            options.stopTeacherAfterLeafAuditBudget === true,
          comparisonBlockOffset: comparisonBlockOffsets[index],
          pairingSeed: options.seed || 1,
          completedGameIndexes,
          streamGames
        }
      });
      let settled = false;
      worker.on("message", async (message) => {
        if (settled) return;
        if (message?.type === "game-complete") {
          try {
            await options.onGameComplete({
              workerIndex: index,
              gameIndex: message.gameIndex,
              games,
              seed: workerSeed,
              result: message.result
            });
            worker.postMessage({ type: "game-saved", gameIndex: message.gameIndex });
          } catch (error) {
            settled = true;
            worker.terminate();
            reject(error);
          }
          return;
        }
        if (message?.type === "error") {
          settled = true;
          const error = new Error(message.error?.message || "Self-play worker failed.");
          error.stack = message.error?.stack || error.stack;
          error.code = message.error?.code || "AI_SELFPLAY_WORKER_FAILED";
          error.diagnostic = message.error?.diagnostic || null;
          reject(error);
          return;
        }
        if (message?.type === "complete") {
          settled = true;
          resolve(message.result);
        }
      });
      worker.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      worker.once("exit", (code) => {
        if (!settled && code !== 0) {
          settled = true;
          reject(new Error(`Self-play worker exited with code ${code}`));
        }
      });
    });
  }));
  const failed = settledResults.find((item) => item.status === "rejected");
  if (failed) {
    throw enrichSelfPlayError(failed.reason, {
      workers: {
        total: settledResults.length,
        completed: settledResults.filter((item) => item.status === "fulfilled").length,
        failed: settledResults.filter((item) => item.status === "rejected").length
      }
    });
  }
  const workerResults = settledResults.map((item) => item.value);
  if (typeof options.loadCollectedResults === "function") {
    const collected = await options.loadCollectedResults();
    collected.workerStats = {
      total: workerResults.length,
      reusedGames: workerResults.reduce((sum, result) => sum + (result.skippedGames || 0), 0),
      collectedGames: workerResults.reduce((sum, result) => sum + (result.computedGames || 0), 0)
    };
    return collected;
  }
  const results = workerResults;
  return {
    trajectories: results.flatMap((result) => result.trajectories),
    summaries: results.flatMap((result) => result.summaries),
    deckLearning: mergeLearningSnapshots(results.map((result) => result.deckLearning)),
    workerStats: { total: results.length, reusedGames: 0, collectedGames: options.games }
  };
}

export async function collectSequential(options) {
  const trajectories = [];
  const summaries = [];
  const learningModel = { deckStats: {}, cardStats: {}, matchupStats: {}, metaStats: { games: 0, cardAppearances: {} }, archetypeStats: {} };
  const completedGameIndexes = new Set(options.completedGameIndexes || []);
  let computedGames = 0;
  for (let index = 0; index < options.games; index += 1) {
    if (completedGameIndexes.has(index)) continue;
    const schedule = selfPlayComparisonSchedule(index);
    const globalComparisonBlock = (options.comparisonBlockOffset || 0) + schedule.comparisonBlock;
    const pairingSeed = ((options.seed || Date.now()) + schedule.comparisonBlock * 104729) >>> 0;
    const pairingRandom = seededRandom(pairingSeed);
    const gameSeed = ((options.seed || Date.now()) + index * 130363) >>> 0;
    const random = seededRandom(gameSeed);
    const pairing = options.balancedPairings === false
      ? { decks: pickDeckPair(options.decks, pairingRandom, options.meta), mode: "weighted-random", focusDeckId: null }
      : scheduledTrainingDeckPair(options.decks, globalComparisonBlock, options.pairingSeed || options.seed || 1, {
        mirrorFraction: options.mirrorFraction ?? 0.25,
        curriculum: options.deckCurriculum,
        deckSeatScheduleVersion:
          options.deckSeatScheduleVersion || "deck-seat-schedule-v1"
      });
    const decks = pairing.decks;
    const league = options.league || [];
    const focusedOpponents = pairing.mode === "weakness-focus" && options.deckCurriculum?.focusOpponentGenerations?.length
      ? league.filter((model) => options.deckCurriculum.focusOpponentGenerations.includes(model.generation))
      : [];
    const opponentPool = focusedOpponents.length ? focusedOpponents : league;
    const opponent = opponentPool.length
      ? sampleLeagueOpponent(opponentPool, league, options.leagueSamplingWeights, pairingRandom)
      : options.model;
    const trainedSeat = league.length ? schedule.learnerSeat : null;
    const models = trainedSeat == null ? [options.model, options.model] : trainedSeat === 0 ? [options.model, opponent] : [opponent, options.model];
    const opponentLeagueIndex = league.indexOf(opponent);
    const actionAuditModelSeatSources = models.map((seatModel) => {
      if (seatModel === options.model) return { kind: "learner" };
      const leagueIndex = league.indexOf(seatModel);
      return leagueIndex >= 0
        ? { kind: "league", index: leagueIndex }
        : opponentLeagueIndex >= 0
          ? { kind: "league", index: opponentLeagueIndex }
          : { kind: "learner" };
    });
    const playMatch = decks.every((deck) => deck.sideboard?.length) && pairingRandom() < (options.bestOfThreeFraction ?? 0.25);
    const firstPlayerId = schedule.firstPlayerId;
    let result;
    try {
      const replayEvery = Math.max(1, Number(options.replayEvery) || 8);
      const captureReplay = options.captureReplays === true && index % replayEvery === 0;
      result = (playMatch ? playNeuralBestOfThree : playNeuralSelfPlayGame)({
        ...options,
        decks,
        models,
        actionAuditModelSeatSources,
        trainableSeats: trainedSeat == null ? [0, 1] : [trainedSeat],
        random,
        firstPlayerId,
        captureReplay
      });
      result.summary.aiSeats = models.map((model, seat) => summarizeAiModel(model, trainedSeat == null || seat === trainedSeat ? "learner" : "league"));
      result.summary.firstPlayerId = result.game?.firstPlayerId || firstPlayerId;
      result.summary.firstPlayerChooserId = options.learnFirstPlayerChoice ? firstPlayerId : null;
      result.summary.gameSeed = gameSeed;
      result.summary.scores ||= result.game?.players?.map((player) => player.score) || null;
      result.summary.comparisonBlock = schedule.comparisonBlock;
      result.summary.globalComparisonBlock = globalComparisonBlock;
      result.summary.deckCurriculum = {
        mode: pairing.mode,
        focusDeckId: pairing.focusDeckId,
        focusDeckSeat: pairing.focusedSeat || null
      };
      result.summary.deckSeatSchedule = {
        version:
          pairing.deckSeatScheduleVersion || "deck-seat-schedule-v1",
        reversed: pairing.deckSeatReversed === true,
        boundaryGameIndex:
          options.deckSeatScheduleBoundaryGameIndex ?? null
      };
      result.summary.learnerSeat = trainedSeat;
      result.summary.learnerPlayerId = trainedSeat == null ? null : `p${trainedSeat + 1}`;
      result.summary.learnerWentFirst = trainedSeat == null ? null : result.summary.firstPlayerId === `p${trainedSeat + 1}`;
    } catch (error) {
      throw enrichSelfPlayError(error, {
        collection: {
          workerIndex: options.workerIndex ?? null,
          gameIndex: index,
          seed: options.seed,
          playMatch,
          firstPlayerId,
          deckIds: decks.map((deck) => deck.id),
          decks: decks.map((deck) => structuredClone(deck))
        }
      });
    }
    const gameId = `worker-${options.workerIndex ?? 0}-game-${index}`;
    const spectatorReplays = result.spectatorReplays || (result.spectatorReplay ? [result.spectatorReplay] : []);
    for (const [replayIndex, replay] of spectatorReplays.entries()) {
      const suffix = replay.matchGameNumber || replayIndex + 1;
      replay.id = `selfplay-g${Math.max(0, Number(options.model?.generation) || 0)}-w${options.workerIndex ?? 0}-n${index}-m${suffix}-${Date.now()}`;
      replay.gameId = gameId;
      replay.generation = Number(options.model?.generation) || 0;
      replay.models = models.map((seatModel, seat) => ({
        playerId: `p${seat + 1}`,
        generation: Number(seatModel?.generation) || 0,
        role: trainedSeat == null || seat === trainedSeat ? "learner" : "league"
      }));
      replay.decks = decks.map((deck, seat) => ({
        playerId: `p${seat + 1}`,
        id: deck.id || `seat-${seat + 1}`,
        name: deck.playerName || deck.name || deck.id || `Player ${seat + 1}`,
        legend: deck.legend ? { cardNumber: deck.legend.cardNumber, name: deck.legend.name } : null
      }));
    }
    for (const trajectory of result.trajectories) {
      const seat = trajectory.playerId === "p2" ? 1 : 0;
      const winnerSeat = result.summary.winnerId === "p2" ? 1 : result.summary.winnerId === "p1" ? 0 : -1;
      const scores = result.summary.scores || result.game?.players?.map((player) => player.score) || [0, 0];
      trajectory.gameId = gameId;
      trajectory.deckId = decks[seat]?.id || null;
      trajectory.opponentDeckId = decks[1 - seat]?.id || null;
      trajectory.deckSeatScheduleVersion =
        pairing.deckSeatScheduleVersion || "deck-seat-schedule-v1";
      trajectory.deckSeatScheduleBoundaryGameIndex =
        options.deckSeatScheduleBoundaryGameIndex ?? null;
      trajectory.matchupType = decks[0]?.id === decks[1]?.id ? "mirror" : "cross-deck";
      trajectory.collectionMode = pairing.mode;
      trajectory.playerSeat = seat;
      trajectory.wentFirst = result.summary.firstPlayerId === `p${seat + 1}`;
      trajectory.condition = `seat-${seat}-${trajectory.wentFirst ? "first" : "second"}`;
      trajectory.opponentGeneration = models[1 - seat]?.generation ?? null;
      trajectory.won = winnerSeat >= 0 ? winnerSeat === seat : null;
      trajectory.scoreMargin = (scores[seat] || 0) - (scores[1 - seat] || 0);
      trajectory.resultClass = winnerSeat < 0 ? "incomplete" : trajectory.won ? "win" : "loss";
      trajectory.marginClass = Math.abs(trajectory.scoreMargin) >= 6 ? "blowout" : Math.abs(trajectory.scoreMargin) <= 2 ? "close" : "normal";
    }
    if (options.retainResults !== false) {
      trajectories.push(...result.trajectories);
      summaries.push(result.summary);
    }
    const gameLearning = { deckStats: {}, cardStats: {}, matchupStats: {}, metaStats: { games: 0, cardAppearances: {} }, archetypeStats: {} };
    recordSideboardLearning(gameLearning, result.trajectories);
    recordSideboardLearning(learningModel, result.trajectories);
    if (result.summary.winnerId) {
      updateDeckLearning(gameLearning, decks, result.summary.winnerId, result.game.players);
      updateDeckLearning(learningModel, decks, result.summary.winnerId, result.game.players);
    }
    computedGames += 1;
    await options.onGameComplete?.({
      gameIndex: index,
      result: {
        trajectories: result.trajectories,
        summaries: [result.summary],
        deckLearning: gameLearning,
        spectatorReplays,
        pendingActionAudit: result.pendingActionAudit || null,
        pendingLeafAudit: result.pendingLeafAudit || null
      }
    });
  }
  return {
    trajectories: options.retainResults === false ? [] : trajectories,
    summaries: options.retainResults === false ? [] : summaries,
    deckLearning: options.retainResults === false ? {} : learningModel,
    computedGames,
    skippedGames: completedGameIndexes.size
  };
}

export function selfPlayComparisonSchedule(index) {
  const safeIndex = Math.max(0, Math.floor(index));
  return {
    comparisonBlock: Math.floor(safeIndex / 4),
    learnerSeat: safeIndex % 2,
    firstPlayerId: Math.floor(safeIndex / 2) % 2 ? "p2" : "p1"
  };
}

export function scheduledDeckPair(decks, blockIndex, seed = 1) {
  if (decks.length < 2) throw new Error("AI training requires at least two decks.");
  const ordered = [...decks].sort((left, right) => left.id.localeCompare(right.id));
  const pairs = roundRobinPairs(ordered);
  const rotation = (seed >>> 0) % pairs.length;
  return pairs[(Math.max(0, blockIndex) + rotation) % pairs.length];
}

export function scheduledEvaluationDeckPair(decks, blockIndex, seed = 1) {
  if (!decks.length) throw new Error("AI evaluation requires at least one deck.");
  const ordered = [...decks].sort((left, right) => left.id.localeCompare(right.id));
  const rotation = (seed >>> 0) % ordered.length;
  const deck = ordered[(Math.max(0, Math.floor(blockIndex)) + rotation) % ordered.length];
  return [deck, deck];
}

export function scheduledEvaluationMatrixPair(decks, blockIndex, seed = 1) {
  if (!decks.length) throw new Error("AI evaluation requires at least one deck.");
  const ordered = [...decks].sort((left, right) => left.id.localeCompare(right.id));
  const safeBlock = Math.max(0, Math.floor(blockIndex));
  const candidateIndex = safeBlock % ordered.length;
  const opponentCycle = Math.floor(safeBlock / ordered.length) % ordered.length;
  const rotation = (seed >>> 0) % ordered.length;
  const opponentIndex = (candidateIndex + opponentCycle + rotation) % ordered.length;
  return [ordered[candidateIndex], ordered[opponentIndex]];
}

export function evaluationConditionSchedule(gameIndex) {
  const safeIndex = Math.max(0, Math.floor(gameIndex));
  return {
    block: Math.floor(safeIndex / 4),
    candidateSeat: safeIndex % 2,
    firstPlayerId: Math.floor(safeIndex / 2) % 2 ? "p2" : "p1"
  };
}

export function pairedEvaluationPlayerSeeds(gameSeed, candidateSeat, streamAssignment = 0) {
  const candidateSeed = ((gameSeed >>> 0) ^ 0x51ed270b) >>> 0 || 1;
  const opponentSeed = ((gameSeed >>> 0) ^ 0xa4c1f326) >>> 0 || 1;
  const candidateReceivesCandidateStream = Number(streamAssignment) % 2 === 0;
  const candidateAssignedSeed = candidateReceivesCandidateStream ? candidateSeed : opponentSeed;
  const opponentAssignedSeed = candidateReceivesCandidateStream ? opponentSeed : candidateSeed;
  return candidateSeat === 0
    ? { p1: candidateAssignedSeed, p2: opponentAssignedSeed }
    : { p1: opponentAssignedSeed, p2: candidateAssignedSeed };
}

export function pairedEvaluationDecisionSeeds(gameSeed, candidateSeat, streamAssignment = 0) {
  const candidateSeed = ((gameSeed >>> 0) ^ 0x9e3779b9) >>> 0 || 1;
  const opponentSeed = ((gameSeed >>> 0) ^ 0x85ebca6b) >>> 0 || 1;
  const candidateReceivesCandidateStream = Number(streamAssignment) % 2 === 0;
  const candidateAssignedSeed = candidateReceivesCandidateStream ? candidateSeed : opponentSeed;
  const opponentAssignedSeed = candidateReceivesCandidateStream ? opponentSeed : candidateSeed;
  return candidateSeat === 0
    ? { p1: candidateAssignedSeed, p2: opponentAssignedSeed }
    : { p1: opponentAssignedSeed, p2: candidateAssignedSeed };
}

export function auditEvaluationScheduleSymmetry(games, options = {}) {
  const blockSize = options.evaluationMode === "same-deck-mirror-v3" ? 8 : 4;
  const roundedGames = Math.max(blockSize, Math.ceil((games || blockSize) / blockSize) * blockSize);
  const conditions = new Map();
  const streamAssignments = new Map();
  for (let gameIndex = 0; gameIndex < roundedGames; gameIndex += 1) {
    const condition = evaluationConditionSchedule(gameIndex);
    const candidateId = `p${condition.candidateSeat + 1}`;
    const key = `seat-${condition.candidateSeat}-${condition.firstPlayerId === candidateId ? "first" : "second"}`;
    conditions.set(key, (conditions.get(key) || 0) + 1);
    if (blockSize === 8) {
      const streamKey = `candidate-stream-${Math.floor((gameIndex % 8) / 4)}`;
      streamAssignments.set(streamKey, (streamAssignments.get(streamKey) || 0) + 1);
    }
  }
  const expected = roundedGames / 4;
  const required = ["seat-0-first", "seat-0-second", "seat-1-first", "seat-1-second"];
  const streamPassed = blockSize !== 8
    || ["candidate-stream-0", "candidate-stream-1"]
      .every((key) => streamAssignments.get(key) === roundedGames / 2);
  const passed = required.every((key) => conditions.get(key) === expected) && streamPassed;
  if (blockSize === 4) {
    return {
      version: 1,
      games: roundedGames,
      expectedPerCondition: expected,
      conditions: Object.fromEntries(conditions),
      passed
    };
  }
  return {
    version: 2,
    games: roundedGames,
    blockSize,
    expectedPerCondition: expected,
    conditions: Object.fromEntries(conditions),
    streamAssignments: Object.fromEntries(streamAssignments),
    passed
  };
}

export const TRAINING_SCHEDULE_CYCLE_BLOCKS = 20;

export function scheduledTrainingDeckPair(decks, blockIndex, seed = 1, options = {}) {
  if (!decks.length) throw new Error("AI training requires at least one deck.");
  const ordered = [...decks].sort((left, right) => left.id.localeCompare(right.id));
  const cycleLength = TRAINING_SCHEDULE_CYCLE_BLOCKS;
  const mirrorSlots = Math.max(0, Math.min(cycleLength, Math.round((options.mirrorFraction ?? 0.25) * cycleLength)));
  const curriculum = options.curriculum || null;
  const focusIds = new Set(curriculum?.focusDeckIds || []);
  const focused = ordered.filter((deck) => focusIds.has(deck.id));
  const focusSlots = focused.length
    ? Math.max(0, Math.min(cycleLength - mirrorSlots, Math.round((curriculum.focusFraction ?? 0.15) * cycleLength)))
    : 0;
  const safeBlock = Math.max(0, Math.floor(blockIndex));
  const schedule = proportionalSchedule({
    "baseline-mirror": mirrorSlots,
    "weakness-focus": focusSlots,
    "balanced-cross": cycleLength - mirrorSlots - focusSlots
  });
  const rawSlot = safeBlock % cycleLength;
  const rotation = (seed >>> 0) % cycleLength;
  const slot = (rawSlot + rotation) % cycleLength;
  const mode = schedule[slot];
  // Each mode advances its own deterministic sequence. Using safeBlock here
  // skipped round-robin pairs whenever a mirror/focus slot intervened and
  // could leave one deck with only a handful of trainable trajectories.
  const modeOrdinal = Math.floor(safeBlock / cycleLength) * schedule.filter((item) => item === mode).length
    + Array.from({ length: rawSlot }, (_, index) => schedule[(index + rotation) % cycleLength])
      .filter((item) => item === mode).length;
  const symmetricDeckSeats =
    options.deckSeatScheduleVersion === "deck-seat-schedule-v2";
  const logicalModeOrdinal = symmetricDeckSeats
    ? Math.floor(modeOrdinal / 2)
    : modeOrdinal;
  const seatReversed = symmetricDeckSeats && modeOrdinal % 2 === 1;
  const scheduledPair = (pair, focusDeckId = null) => {
    if (!symmetricDeckSeats || pair[0]?.id === pair[1]?.id) {
      return {
        decks: pair,
        deckSeatScheduleVersion:
          options.deckSeatScheduleVersion || "deck-seat-schedule-v1",
        deckSeatReversed: false
      };
    }
    let oriented = [...pair];
    const requestedSeats =
      options.curriculum?.focusDeckSeats?.[focusDeckId] || [];
    const requestedSeat = requestedSeats.length === 1
      ? requestedSeats[0] === "p1"
        ? 0
        : requestedSeats[0] === "p2"
          ? 1
          : null
      : null;
    if (requestedSeat != null) {
      const focusIndex = oriented.findIndex(
        (deck) => deck.id === focusDeckId
      );
      if (focusIndex >= 0 && focusIndex !== requestedSeat) {
        oriented.reverse();
      }
      return {
        decks: oriented,
        deckSeatScheduleVersion: options.deckSeatScheduleVersion,
        deckSeatReversed:
          oriented[0]?.id !== pair[0]?.id,
        focusedSeat: `p${requestedSeat + 1}`
      };
    }
    if (seatReversed) oriented.reverse();
    return {
      decks: oriented,
      deckSeatScheduleVersion: options.deckSeatScheduleVersion,
      deckSeatReversed: seatReversed
    };
  };
  if (mode === "baseline-mirror") {
    const deck = ordered[logicalModeOrdinal % ordered.length];
    return {
      ...scheduledPair([deck, deck]),
      mode: "baseline-mirror",
      focusDeckId: focusIds.has(deck.id) ? deck.id : null
    };
  }
  if (mode === "weakness-focus") {
    const focusDeck = focused[logicalModeOrdinal % focused.length];
    const others = ordered.filter((deck) => deck.id !== focusDeck.id);
    if (!others.length) {
      return {
        ...scheduledPair([focusDeck, focusDeck], focusDeck.id),
        mode: "weakness-focus",
        focusDeckId: focusDeck.id
      };
    }
    const opponent =
      others[(logicalModeOrdinal + (seed >>> 0)) % others.length];
    const pair = focusDeck.id.localeCompare(opponent.id) <= 0 ? [focusDeck, opponent] : [opponent, focusDeck];
    return {
      ...scheduledPair(pair, focusDeck.id),
      mode: "weakness-focus",
      focusDeckId: focusDeck.id
    };
  }
  return {
    ...scheduledPair(
      scheduledDeckPair(ordered, logicalModeOrdinal, seed)
    ),
    mode: "balanced-cross",
    focusDeckId: null
  };
}

function proportionalSchedule(counts) {
  const entries = Object.entries(counts);
  const length = entries.reduce((sum, [, count]) => sum + count, 0);
  const assigned = Object.fromEntries(entries.map(([key]) => [key, 0]));
  return Array.from({ length }, (_, slot) => {
    const available = entries.filter(([key, count]) => assigned[key] < count);
    available.sort(([leftKey, leftCount], [rightKey, rightCount]) => {
      const leftDeficit = leftCount * (slot + 1) / length - assigned[leftKey];
      const rightDeficit = rightCount * (slot + 1) / length - assigned[rightKey];
      return rightDeficit - leftDeficit || rightCount - leftCount || leftKey.localeCompare(rightKey);
    });
    const selected = available[0][0];
    assigned[selected] += 1;
    return selected;
  });
}

export function scheduledCurriculumDeckPair(decks, blockIndex, seed = 1, curriculum = null) {
  const focusIds = new Set(curriculum?.focusDeckIds || []);
  const focused = decks.filter((deck) => focusIds.has(deck.id)).sort((left, right) => left.id.localeCompare(right.id));
  if (!focused.length) return { decks: scheduledDeckPair(decks, blockIndex, seed), mode: "balanced", focusDeckId: null };

  const others = decks.filter((deck) => !focusIds.has(deck.id)).sort((left, right) => left.id.localeCompare(right.id));
  const cycleLength = 8;
  const focusSlots = Math.max(1, Math.min(cycleLength, Math.round((curriculum.focusFraction ?? 0.5) * cycleLength)));
  const mirrorSlots = Math.max(0, Math.min(focusSlots, Math.round((curriculum.mirrorFraction ?? 0.125) * cycleLength)));
  const safeBlock = Math.max(0, Math.floor(blockIndex));
  const rotation = (seed >>> 0) % cycleLength;
  const slot = (safeBlock + rotation) % cycleLength;
  const focusDeck = focused[(Math.floor(safeBlock / cycleLength) + (seed >>> 0)) % focused.length];

  if (slot < mirrorSlots || !others.length) {
    return { decks: [focusDeck, focusDeck], mode: "focus-mirror", focusDeckId: focusDeck.id };
  }
  if (slot < focusSlots || others.length < 2) {
    const opponent = others[(safeBlock + (seed >>> 0)) % others.length];
    const pair = focusDeck.id.localeCompare(opponent.id) <= 0 ? [focusDeck, opponent] : [opponent, focusDeck];
    return { decks: pair, mode: "focus-opponent", focusDeckId: focusDeck.id };
  }
  return { decks: scheduledDeckPair(others, safeBlock, seed), mode: "balanced-non-focus", focusDeckId: focusDeck.id };
}

export function selectUnderperformingDeckCurriculum(model, deckIds, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? Math.max(0, Math.min(0.5, options.threshold)) : 0.2;
  const stats = model?.metadata?.absoluteEvaluation?.deckStats || model?.metadata?.evaluation?.deckStats || {};
  const candidates = deckIds
    .map((deckId) => ({ deckId, ...(stats[deckId] || {}) }))
    .filter((item) => Number(item.completed) >= 2 && (options.alwaysFocus || Number(item.winRate) < threshold))
    .sort((left, right) => Number(left.winRate) - Number(right.winRate)
      || Number(left.meanScoreFor) - Number(right.meanScoreFor)
      || left.deckId.localeCompare(right.deckId));
  if (!candidates.length) return null;
  const focusFraction = Number.isFinite(options.focusFraction) ? Math.max(0.1, Math.min(0.4, options.focusFraction)) : 0.15;
  const mirrorFraction = Number.isFinite(options.mirrorFraction) ? Math.max(0, Math.min(focusFraction, options.mirrorFraction)) : 0.125;
  const weakest = candidates[0];
  const leagueResults = model?.metadata?.leagueEvaluation?.results || [];
  const weakestLeagueResult = [...leagueResults].filter((result) => Number(result.completed) >= 4)
    .sort((left, right) => Number(left.winRate) - Number(right.winRate))[0] || null;
  const weakestLeagueOpponent = weakestLeagueResult?.summaries?.flatMap((summary) => summary.aiSeats || [])
    .find((seat) => seat.role === "league" || seat.role === "champion") || null;
  const conditions = model?.metadata?.evaluation?.conditionStats || {};
  const weakestCondition = Object.entries(conditions).filter(([, value]) => Number(value.completed) >= 2)
    .sort(([, left], [, right]) => Number(left.winRate) - Number(right.winRate))[0] || null;
  return {
    version: 2,
    method: "worst-group-curriculum",
    focusDeckIds: [weakest.deckId],
    focusConditionKeys: weakestCondition ? [weakestCondition[0]] : [],
    focusOpponentGenerations: Number.isInteger(weakestLeagueOpponent?.generation) ? [weakestLeagueOpponent.generation] : [],
    focusFraction,
    mirrorFraction,
    selectionThreshold: threshold,
    evidence: {
      completed: Number(weakest.completed) || 0,
      wins: Number(weakest.wins) || 0,
      winRate: Number(weakest.winRate) || 0,
      meanScoreFor: Number(weakest.meanScoreFor) || 0,
      meanScoreAgainst: Number(weakest.meanScoreAgainst) || 0
    },
    conditionEvidence: weakestCondition ? { key: weakestCondition[0], ...weakestCondition[1] } : null,
    opponentEvidence: weakestLeagueResult ? {
      generation: weakestLeagueOpponent?.generation ?? null,
      games: weakestLeagueResult.completed,
      winRate: weakestLeagueResult.winRate
    } : null
  };
}

function roundRobinPairs(decks) {
  const participants = decks.length % 2 ? [...decks, null] : [...decks];
  const pairs = [];
  for (let round = 0; round < participants.length - 1; round += 1) {
    for (let index = 0; index < participants.length / 2; index += 1) {
      const first = participants[index];
      const second = participants[participants.length - 1 - index];
      if (first && second) pairs.push(first.id.localeCompare(second.id) <= 0 ? [first, second] : [second, first]);
    }
    participants.splice(1, 0, participants.pop());
  }
  return pairs;
}

function candidateDeckStats(summaries) {
  const stats = {};
  for (const summary of summaries) {
    const seat = summary?.candidateSeat;
    const deckId = Number.isInteger(seat) ? summary.deckIds?.[seat] : null;
    if (!deckId) continue;
    const stat = stats[deckId] ||= { games: 0, completed: 0, wins: 0, scoreFor: 0, scoreAgainst: 0 };
    stat.games += 1;
    if (!summary.completed) continue;
    stat.completed += 1;
    stat.wins += summary.winnerId === `p${seat + 1}` ? 1 : 0;
    stat.scoreFor += summary.scores?.[seat] || 0;
    stat.scoreAgainst += summary.scores?.[1 - seat] || 0;
  }
  for (const stat of Object.values(stats)) {
    stat.winRate = stat.completed ? stat.wins / stat.completed : 0;
    stat.meanScoreFor = stat.completed ? stat.scoreFor / stat.completed : 0;
    stat.meanScoreAgainst = stat.completed ? stat.scoreAgainst / stat.completed : 0;
  }
  return stats;
}

function candidateMatchupStats(summaries) {
  const stats = {};
  for (const summary of summaries) {
    if (!summary?.completed || !Number.isInteger(summary.candidateSeat)) continue;
    const candidateDeckId = summary.deckIds?.[summary.candidateSeat];
    const opponentDeckId = summary.deckIds?.[1 - summary.candidateSeat];
    if (!candidateDeckId || !opponentDeckId) continue;
    const key = `${candidateDeckId}::${opponentDeckId}`;
    const stat = stats[key] ||= {
      candidateDeckId, opponentDeckId, games: 0, wins: 0,
      scoreFor: 0, scoreAgainst: 0
    };
    stat.games += 1;
    stat.wins += summary.winnerId === `p${summary.candidateSeat + 1}` ? 1 : 0;
    stat.scoreFor += Number(summary.scores?.[summary.candidateSeat]) || 0;
    stat.scoreAgainst += Number(summary.scores?.[1 - summary.candidateSeat]) || 0;
  }
  for (const stat of Object.values(stats)) {
    stat.winRate = stat.games ? stat.wins / stat.games : 0;
    stat.wilsonLowerBound = wilsonLower(stat.wins, stat.games);
    stat.meanScoreFor = stat.games ? stat.scoreFor / stat.games : 0;
    stat.meanScoreAgainst = stat.games ? stat.scoreAgainst / stat.games : 0;
  }
  return stats;
}

function evaluationMatrixCoverage(summaries, decks) {
  const requested = new Set();
  const completed = new Set();
  for (const summary of summaries) {
    if (!Number.isInteger(summary?.candidateSeat)) continue;
    const candidateDeckId = summary.deckIds?.[summary.candidateSeat];
    const opponentDeckId = summary.deckIds?.[1 - summary.candidateSeat];
    if (!candidateDeckId || !opponentDeckId) continue;
    const key = `${candidateDeckId}::${opponentDeckId}`;
    requested.add(key);
    if (summary.completed) completed.add(key);
  }
  const possible = Math.max(1, (decks?.length || 0) ** 2);
  return {
    version: 1,
    possibleMatchups: possible,
    requestedMatchups: requested.size,
    completedMatchups: completed.size,
    requestedCoverage: requested.size / possible,
    completedCoverage: completed.size / possible
  };
}

function sideboardStep(decision, game, playerId) {
  const legalActionKeys = decision.legalActions.map(actionKey);
  const informationSetHash = createInformationSetHash({
    actorId: playerId,
    state: decision.stateEncoding,
    initialMemory: decision.initialMemory,
    legalActionKeys
  });
  return {
    action: structuredClone(decision.action),
    state: decision.stateEncoding,
    actions: decision.actionEncoding.slice(0, decision.legalCount * ACTION_DIM),
    selectedIndex: decision.selectedIndex,
    legalCount: decision.legalCount,
    oldLogProbability: decision.logProbability,
    behaviorTemperature: decision.behaviorTemperature,
    value: decision.value,
    beliefTarget: encodeOpponentDeckTarget(game, playerId),
    initialMemory: decision.initialMemory,
    informationSetHash,
    informationSetHashVersion: 1,
    selectedActionKey: actionKey(decision.action),
    behaviorActionKey: actionKey(decision.action),
    legalActionKeys,
    originalLegalCount: decision.legalActions.length,
    selectedActionValue: decision.selectedActionValue,
    stopActionValue: stopActionValue(decision),
    decisionType: "sideboard",
    shapingPotential: 0
  };
}

function shouldQueryTeacherForUncertainty(decision, phase) {
  if ((decision?.legalCount || 0) < 2) return false;
  const probabilities = [...(decision.probabilities || [])].sort((left, right) => right - left);
  const probabilityGap = (probabilities[0] || 0) - (probabilities[1] || 0);
  const highLeverage = [
    "mulligan", "showdown", "action-chain", "choose", "payment"
  ].some((token) => String(phase || "").includes(token)) || [
    "beginPlayCard", "beginPlayChampion", "activateCard", "moveUnit", "endTurn", "passShowdown", "submitMulligan"
  ].includes(decision.action?.kind);
  return highLeverage && probabilityGap < 0.18;
}

function decisionUncertainty(decision) {
  const probabilities = (decision?.probabilities || []).filter((value) => value > 0);
  if (probabilities.length < 2) return 0;
  const entropy = -probabilities.reduce((sum, probability) => sum + probability * Math.log(probability), 0);
  return Math.max(0, Math.min(1, entropy / Math.log(probabilities.length)));
}

export function teacherPolicySupervisionTier(teacher) {
  if (teacher?.correctionEligible !== true || teacher?.verification?.status !== "verified") {
    return teacher?.verification?.status || "diagnostic";
  }
  if (teacher?.immediateProof?.won === true) return "engine-proof";
  const confirmation = teacher?.confirmation;
  const evaluator = confirmation?.evaluatorComparison
    || teacher?.policyComparison?.evaluatorComparison;
  const minimumTerminalRate = Math.min(
    Number(confirmation?.terminalRates?.recommended) || 0,
    Number(confirmation?.terminalRates?.selected) || 0
  );
  const independentEvaluatorAgreement = evaluator?.available === true
    && evaluator?.independent === true
    && evaluator?.independentEvaluatorAgreement === true
    && evaluator?.conflict !== true
    && evaluator?.materialConflict !== true
    && evaluator?.agreesOnDirection === true
    && Number(evaluator?.primaryDelta) > 0
    && Number(evaluator?.independentDelta) >= 0;
  const independentlyConfirmed = confirmation?.independent === true
    && confirmation?.seedBanks?.disjoint === true
    && confirmation?.determinizationAudit?.complete === true
    && Number(confirmation?.validPairedSamples) >= (
      independentEvaluatorAgreement ? 8 : 16
    )
    && Number(confirmation?.validRates?.recommended) >= 0.75
    && Number(confirmation?.validRates?.selected) >= 0.75
    && Number(confirmation?.pairedEvidence?.lowerBound) > 0
    && (minimumTerminalRate >= 0.75 || independentEvaluatorAgreement);
  return independentlyConfirmed ? "independent-confirmed" : "unverified";
}

export function verifiedTeacherPolicyEligibility(teacher) {
  return ["engine-proof", "independent-confirmed"].includes(
    teacherPolicySupervisionTier(teacher)
  );
}

export function teacherActionValueSupervisionEligibility(teacher) {
  if (verifiedTeacherPolicyEligibility(teacher)) return true;
  if (teacher?.verification?.status !== "provisional") return false;
  const confirmation = teacher?.confirmation;
  const evaluator = confirmation?.evaluatorComparison
    || teacher?.policyComparison?.evaluatorComparison;
  return confirmation?.independent === true
    && confirmation?.seedBanks?.disjoint === true
    && confirmation?.determinizationAudit?.complete === true
    && Number(confirmation?.validPairedSamples) >= 8
    && Number(confirmation?.validRates?.recommended) >= 0.75
    && Number(confirmation?.validRates?.selected) >= 0.75
    && Number(confirmation?.pairedEvidence?.lowerBound) > 0
    && evaluator?.available === true
    && evaluator?.independent === true
    && evaluator?.independentEvaluatorAgreement === true
    && evaluator?.conflict !== true
    && evaluator?.materialConflict !== true
    && evaluator?.agreesOnDirection === true
    && Number(evaluator?.primaryDelta) > 0
    && Number(evaluator?.independentDelta) >= 0;
}

function actionRankingReferenceForDecision({
  proof,
  teacher,
  decision,
  informationSetHash,
  legalActionKeys
}) {
  if (proof?.evidenceKind === "engine-proof"
    && proof?.correctionEligible === true
    && proof.selectedIndex !== decision.selectedIndex) {
    return createActionRankingReference({
      informationSetHash,
      informationSetHashVersion: 1,
      correctIndex: proof.selectedIndex,
      comparedIndex: decision.selectedIndex,
      correctActionKey: legalActionKeys[proof.selectedIndex],
      comparedActionKey: legalActionKeys[decision.selectedIndex],
      evidenceKind: "engine-proof",
      pairedSamples: 1,
      proofKind: proof.proofKind,
      modelHashes: []
    });
  }
  const confirmation = teacher?.confirmation;
  if (teacher?.verification?.proofKind !== "confirmed-terminal-rollout-dominance"
    || teacher?.verification?.status !== "verified"
    || teacher?.correctionEligible !== true
    || teacher.selectedIndex === decision.selectedIndex
    || confirmation?.independent !== true) return null;
  const samples = Number(confirmation.terminalPairedEvidence?.samples) || 0;
  const attemptedRecommended = Number(confirmation.attemptedSimulations?.recommended) || 0;
  const attemptedSelected = Number(confirmation.attemptedSimulations?.selected) || 0;
  return createActionRankingReference({
    informationSetHash,
    informationSetHashVersion: 1,
    correctIndex: teacher.selectedIndex,
    comparedIndex: decision.selectedIndex,
    correctActionKey: legalActionKeys[teacher.selectedIndex],
    comparedActionKey: legalActionKeys[decision.selectedIndex],
    evidenceKind: "confirmed-terminal-rollout-dominance",
    validSamples: {
      correct: Math.floor(attemptedRecommended * (Number(confirmation.validRates?.recommended) || 0)),
      compared: Math.floor(attemptedSelected * (Number(confirmation.validRates?.selected) || 0))
    },
    terminalSamples: {
      correct: Math.floor(
        attemptedRecommended
          * (Number(confirmation.validRates?.recommended) || 0)
          * (Number(confirmation.terminalRates?.recommended) || 0)
      ),
      compared: Math.floor(
        attemptedSelected
          * (Number(confirmation.validRates?.selected) || 0)
          * (Number(confirmation.terminalRates?.selected) || 0)
      )
    },
    pairedSamples: samples,
    pairedLowerBound: confirmation.terminalPairedEvidence?.lowerBound,
    pairedUpperBound: confirmation.terminalPairedEvidence?.upperBound,
    seedBanks: confirmation.seedBanks,
    determinizationAudit: confirmation.determinizationAudit,
    leafValuePairs: confirmation.leafValuePairs,
    proofKind: teacher.verification.proofKind,
    modelHashes: []
  });
}

function actionRankingAuditReferenceForDecision({
  teacher,
  decision,
  informationSetHash,
  legalActionKeys
}) {
  const audit = teacher?.independentActionRankingAudit;
  if (!audit
    || teacher.selectedIndex === decision.selectedIndex
    || audit.recommendedActionKey
      !== legalActionKeys[teacher.selectedIndex]
    || audit.selectedActionKey
      !== legalActionKeys[decision.selectedIndex]) return null;
  return createActionRankingAuditReference({
    audit,
    informationSetHash,
    informationSetHashVersion: 1,
    correctIndex: teacher.selectedIndex,
    comparedIndex: decision.selectedIndex,
    correctActionKey: legalActionKeys[teacher.selectedIndex],
    comparedActionKey: legalActionKeys[decision.selectedIndex]
  });
}

export function teacherLeafValueAuditReference(teacher, options = {}) {
  return createLeafValueReference(
    teacher?.independentLeafValuePairs,
    {
      source: "teacher-independent-production-cutoff-audit",
      policyCorrectionIndependent: true,
      actionEffectComparison:
        teacher?.independentLeafActionEffectComparison || null,
      auditStratum: normalizeEvaluatorAuditStratum({
        game: options.game,
        deckId: options.deckId,
        seat: options.seat,
        recommendedAction: options.recommendedAction,
        selectedAction: options.selectedAction,
        legalActions: options.legalActions
      })
    }
  );
}

function teacherEvidenceSource(teacher) {
  if (!teacher) return null;
  if (teacher.verification?.proofKind === "immediate-terminal-win") {
    return "engine-proof";
  }
  if (teacher.verification?.proofKind === "confirmed-terminal-rollout-dominance"
    || (Number(teacher.confirmation?.terminalPairedEvidence?.samples) >= 16
      && Number(teacher.confirmation?.terminalPairedEvidence?.lowerBound) > 0
      && teacher.confirmation?.determinizationAudit?.complete === true)) {
    return "terminal-confirmed";
  }
  const evaluator = teacher.policyComparison?.evaluatorComparison;
  if (evaluator?.available === true
    && evaluator?.independent === true
    && evaluator?.independentEvaluatorAgreement === true
    && evaluator?.conflict !== true
    && evaluator?.agreesOnDirection === true) {
    return "certified-evaluator";
  }
  return teacher.verification?.status === "verified"
    ? "other-verified"
    : "provisional";
}

function storedTeacherConfirmation(confirmation) {
  if (!confirmation) return null;
  const { leafValuePairs: _leafValuePairs, ...stored } = confirmation;
  return stored;
}

function teacherTargetDistribution(teacher, legalActions) {
  if (!teacher?.alternatives?.length) return null;
  const correctionKeys = teacher.correctionEligible
    ? new Set(teacher.correctionAlternativeKeys || [])
    : null;
  const alternatives = correctionKeys?.size
    ? teacher.alternatives.filter((alternative) => correctionKeys.has(actionKey(alternative.action)))
    : teacher.alternatives;
  const scores = alternatives.map((alternative) => Number(alternative.decisionScore) || 0);
  const maximum = Math.max(...scores);
  const temperature = 0.08;
  const weights = scores.map((score) => Math.exp((score - maximum) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const byKey = new Map(alternatives.map((alternative, index) => [
    actionKey(alternative.action), weights[index] / total
  ]));
  return legalActions.map((action) => byKey.get(actionKey(action)) || 0);
}

function teacherMacroTrainingSteps(teacher, context = {}) {
  if (!verifiedTeacherPolicyEligibility(teacher)
    || teacher.verification?.proofKind !== "verified-declaration-macro"
    || !teacher.macroDemonstration?.verified
    || !teacher.macroDemonstration.steps?.length) return null;
  const confidence = Math.max(0, Math.min(1, Number(teacher.confidence) || 0));
  const expectedReturn = Math.max(-1, Math.min(1, (Number(teacher.expectedWinRate) || 0.5) * 2 - 1));
  const regret = Math.max(0, Number(teacher.policyComparison?.regret) || 0);
  return teacher.macroDemonstration.steps.map((step, index) => ({
    ...step,
    oldLogProbability: 0,
    value: 0,
    initialMemory: index === 0
      ? Float32Array.from(step.initialMemory || teacher.macroDemonstration.initialMemory
        || new Float32Array(NEURAL_HIDDEN_SIZE))
      : undefined,
    advantage: confidence,
    return: expectedReturn,
    teacherIndex: step.selectedIndex,
    teacherLabelVersion: TEACHER_LABEL_VERSION,
    teacherCorrectionEligible: true,
    teacherVerificationStatus: "verified",
    teacherPolicyEligible: true,
    teacherVerificationReasons: [],
    teacherConfidence: confidence,
    teacherSearchConfidence: teacher.searchConfidence,
    teacherCorrectionConfidence: teacher.correctionConfidence,
    teacherSelectedRegret: regret,
    teacherRankingMargin: Math.min(0.5, Math.max(0.05, regret * 0.5)),
    teacherProofKind: "verified-declaration-macro",
    teacherEvidenceSource: context.parentEvidenceSource || "unknown",
    teacherMacroStepIndex: index,
    teacherMacroParentActionKey: actionKey(teacher.action),
    informationSetHash: step.informationSetHash || createInformationSetHash({
      state: step.state,
      initialMemory: step.initialMemory,
      legalActionKeys: step.legalActionKeys
    }),
    parentInformationSetHash: context.parentInformationSetHash || null,
    behaviorActionKey: context.parentSelectedActionKey || null,
    recommendedActionKey: step.legalActionKeys?.[step.selectedIndex]
      || step.selectedActionKey
      || null,
    imitation: true,
    source: "simulation-teacher-macro"
  }));
}

export function teacherAlternativeValueSupervision(teacher, legalActions, learningWeight = teacher?.confidence || 0) {
  const targets = new Array(legalActions?.length || 0).fill(0);
  const weights = new Array(legalActions?.length || 0).fill(0);
  if (!teacher?.alternatives?.length || !legalActions?.length || learningWeight <= 0) return { targets, weights };
  const byKey = new Map(teacher.alternatives.map((alternative) => [actionKey(alternative.action), alternative]));
  for (let index = 0; index < legalActions.length; index += 1) {
    const alternative = byKey.get(actionKey(legalActions[index]));
    if (!alternative || !Number.isFinite(Number(alternative.expectedWinRate))) continue;
    const expectedWinRate = Math.max(0, Math.min(1, Number(alternative.expectedWinRate)));
    const interval = Array.isArray(alternative.confidenceInterval) ? alternative.confidenceInterval : null;
    const rawIntervalWidth = interval ? Number(interval[1]) - Number(interval[0]) : 1;
    const intervalWidth = Number.isFinite(rawIntervalWidth)
      ? Math.max(0, Math.min(1, rawIntervalWidth))
      : 1;
    const precision = Math.max(0.1, 1 - intervalWidth);
    targets[index] = expectedWinRate * 2 - 1;
    weights[index] = Math.max(0, Math.min(1, learningWeight * precision));
  }
  return { targets, weights };
}

function teacherSupervisionWeight(teacher, criticalDecision) {
  if (!teacher || teacher.labelVersion !== TEACHER_LABEL_VERSION) return 0;
  const confidence = Math.max(0, Math.min(1, Number(teacher.confidence) || 0));
  const searchConfidence = Math.max(0, Math.min(1, Number(teacher.searchConfidence) || confidence));
  const correctionConfidence = Math.max(0, Math.min(1,
    Number(teacher.correctionConfidence) || searchConfidence));
  // Regret describes how costly the disagreement might be; it is not evidence
  // that the teacher is right. Never amplify supervision beyond the search's
  // independently verified confidence.
  const verificationWeight = teacher.verification?.status === "verified" ? 1
    : teacher.verification?.status === "provisional" ? 0.5
      : 0;
  const leveragePenalty = criticalDecision?.urgent && !teacher.correctionEligible ? 0.8 : 1;
  const teacherDisagrees = teacher.policyComparison?.selectedAction
    && actionKey(teacher.policyComparison.selectedAction) !== actionKey(teacher.action);
  const evidenceConfidence = teacherDisagrees ? correctionConfidence : searchConfidence;
  return Math.max(0, Math.min(confidence, evidenceConfidence) * verificationWeight * leveragePenalty);
}

export function classifyTeacherCorrectionPoint(step) {
  const regret = Math.max(0, Number(step?.teacherSelectedRegret) || 0);
  if (step?.teacherLabelVersion !== TEACHER_LABEL_VERSION
    || step?.teacherCorrectionEligible !== true
    || !step?.teacherConfidence
    || step.teacherIndex === step.selectedIndex) return null;
  if (regret >= 0.12) return "teacher-critical";
  if (step.criticalDecisionUrgent && regret >= 0.03) return "teacher-urgent";
  if (regret >= 0.05) return "teacher-regret";
  return null;
}

export function criticalTacticalDecisionProfile(game, actorId, decision) {
  const empty = { critical: false, urgent: false, types: [], requiredActions: [] };
  if ((decision?.legalCount || 0) < 2) return empty;
  const relevant = (decision.legalActions || []).filter((action) => [
    "beginPlayCard", "beginPlayChampion", "activateCard", "moveUnit", "moveUnits",
    "chooseEffectOption", "declineEffectChoice", "endTurn", "passShowdown"
  ].includes(action.kind));
  const movementEntries = relevant
    .filter((action) => action.kind === "moveUnit" || action.kind === "moveUnits")
    .map((action) => ({ action, profile: tacticalActionProfile(game, actorId, action) }));
  const required = new Map();
  const types = new Set();
  let urgent = false;
  const addRequired = (action) => {
    if (action) required.set(actionKey(action), action);
  };
  const selected = decision.action;
  // Always keep an explicit resource-reserve alternative in tactical reviews.
  // A lost response exchange is not itself a label that the initiating move
  // was wrong; the existing paired, shared-world comparison tests the hold.
  const reserve = relevant.find(action => action.kind === 'endTurn' || action.kind === 'passShowdown');
  if (reserve && ['beginPlayCard','beginPlayChampion','activateCard','moveUnit','moveUnits'].includes(selected?.kind)) {
    types.add('tactical-action-versus-reserve');
    addRequired(reserve);
  }
  const combatSacrificePossible = ["moveUnit", "moveUnits", "passShowdown"].includes(selected?.kind)
    && hasCombatSacrificePayoff(game, actorId, game.battlefields.flatMap(field => field.units));
  const combatContinuationReview = selected?.kind === "passShowdown"
    ? reviewCombatContinuations(game, actorId, relevant, { cloneGame, applyAiAction, planPaymentActions })
    : null;
  if (combatContinuationReview) {
    types.add("combat-response-versus-reserve");
    for (const action of combatContinuationReview.requiredActions) addRequired(action);
  }
  if (["moveUnit", "moveUnits"].includes(selected?.kind)) {
    const selectedProfile = tacticalActionProfile(game, actorId, selected);
    const paired = movementEntries
      .filter(({ action }) => action.destinationId === selected.destinationId
        && action.kind !== selected.kind)
      .sort((left, right) => movementCriticalScore(right.profile) - movementCriticalScore(left.profile))[0] || null;
    if (paired) {
      types.add("movement-group-comparison");
      addRequired(paired.action);
      urgent ||= paired.profile.strictlyBeneficial && !selectedProfile.strictlyBeneficial;
    }
  }
  const stopSelected = selected?.kind === "endTurn" || selected?.kind === "passShowdown";
  const strictMovement = movementEntries
    .filter(({ profile }) => profile.strictlyBeneficial)
    .sort((left, right) => movementCriticalScore(right.profile) - movementCriticalScore(left.profile))[0] || null;
  if (stopSelected && strictMovement) {
    types.add("profitable-action-before-stop");
    addRequired(strictMovement.action);
    urgent = true;
  }
  if (game.pendingChoice) {
    const choices = relevant.filter((action) => action.kind === "chooseEffectOption")
      .map((action) => ({ action, profile: tacticalActionProfile(game, actorId, action) }));
    const alignments = choices.map(({ profile }) => profile.targetAlignment);
    const bestAligned = choices.sort((left, right) => effectChoiceScore(right.profile) - effectChoiceScore(left.profile))[0] || null;
    const enemyTargets = choices.filter(({profile}) => profile.targetRelation === 'enemy' && profile.targetContext);
    if (enemyTargets.length > 1) {
      // Equally legal enemy targets can have very different combat, scoring,
      // death-trigger and response outcomes. Send all of them to the existing
      // paired shared-world teacher, including the policy's selected target.
      types.add('enemy-target-opportunity-comparison');
      for (const {action} of enemyTargets) addRequired(action);
    }
    if (alignments.length > 1 && Math.max(...alignments) > Math.min(...alignments)) {
      types.add("effect-target-comparison");
      addRequired(bestAligned?.action);
      const selectedProfile = tacticalActionProfile(game, actorId, selected);
      urgent ||= selectedProfile.targetAlignment < 0 && selectedProfile.casterSideBenefit < 0.08;
    }
  }
  const projectedAdvantages = movementEntries.map(({ profile }) => profile.projectedFieldAdvantage);
  if (movementEntries.some(({ profile }) => profile.controlGain || profile.hopelessReinforcement
    || profile.reversesRemoval || profile.sourceControlRisk)
    || (projectedAdvantages.length > 1 && Math.max(...projectedAdvantages) - Math.min(...projectedAdvantages) >= 0.2)) {
    types.add("movement-outcome-comparison");
  }
  const victoryScore = Math.max(1, Number(game.victoryScore) || 8);
  if (Math.max(...game.players.map((player) => Number(player.score) || 0)) >= victoryScore - 2 && relevant.length >= 2) {
    types.add("near-victory");
    urgent ||= stopSelected;
  }
  const highImpactCard = relevant.some((action) => {
    if (!["beginPlayCard", "beginPlayChampion", "activateCard"].includes(action.kind)) return false;
    const card = decisionCard(game, actorId, action);
    return (card?.effects || []).some((effect) => effect.target
      || effect.draw || effect.damage || effect.amount || effect.kind === "moveUnit");
  });
  if (highImpactCard && relevant.some((action) => action.kind === "endTurn" || action.kind === "passShowdown")) {
    types.add("card-versus-resource-reserve");
  }
  return {
    critical: types.size > 0,
    urgent,
    types: [...types],
    combatContinuationReview,
    combatSacrificePossible,
    requiredActions: [...required.values()]
  };
}

function movementCriticalScore(profile) {
  return Number(profile.strictlyBeneficial) * 4
    + Number(profile.canRemoveEnemyNoResponse) * 2
    + Number(profile.tacticalRemovalPossible)
    + Number(profile.controlGain) * 0.8
    - Number(profile.sourceControlRisk) * 1.5
    - Number(profile.enemyCanRemoveFriendly)
    + (Number(profile.projectedFieldAdvantage) || 0)
    + Math.min(3, Number(profile.movingUnitCount) || 0) * 0.03;
}

function effectChoiceScore(profile) {
  return (Number(profile.targetAlignment) || 0) * Math.max(0.2, Number(profile.targetImpact) || 0)
    + (Number(profile.casterSideBenefit) || 0)
    + Number(profile.savesFromLethal) * 1.5;
}

function decisionCard(game, actorId, action) {
  const actor = game.players.find((player) => player.id === actorId);
  if (action.kind === "beginPlayChampion") return actor?.champion || null;
  const id = action.cardId || action.unitId || action.unitIds?.[0]
    || String(action.abilityId || "").split(":").slice(0, -1).join(":");
  return [
    actor?.legend, actor?.champion, ...(actor?.hand || []), ...(actor?.base || []),
    ...game.battlefields.flatMap((field) => field.units || [])
  ].filter(Boolean).find((card) => card.instanceId === id) || null;
}

function scoreLead(game, playerId) {
  const self = game.players.find((player) => player.id === playerId);
  const opponent = game.players.find((player) => player.id !== playerId);
  return (self?.score || 0) - (opponent?.score || 0);
}

function classifyTurningPoint(before, after, victoryScore) {
  if (Math.sign(before) !== Math.sign(after) && before !== 0 && after !== 0) return "lead-flip";
  if (Math.abs(before) < 3 && Math.abs(after) >= 3) return "lead-breakaway";
  if (Math.abs(before) < victoryScore - 2 && Math.abs(after) >= victoryScore - 2) return "near-victory";
  return null;
}

function highestPriorityTurningPoint(points) {
  const priority = {
    "teacher-critical": 7,
    "teacher-urgent": 6,
    "lead-flip": 5,
    "teacher-regret": 4,
    "stale-hand": 3,
    "near-victory": 2,
    "lead-breakaway": 1
  };
  return points.filter(Boolean).sort((left, right) => (priority[right] || 0) - (priority[left] || 0))[0] || null;
}

function recordSideboardLearning(model, trajectories) {
  model.sideboardStats ||= {};
  for (const trajectory of trajectories) {
    for (const step of trajectory.steps.filter((item) => item.decisionType === "sideboard" && item.action?.kind === "sideboardSwap")) {
      const reward = trajectory.steps.at(-1)?.return || 0;
      for (const [cardNumber, direction] of [[step.action.inCardNumber, 1], [step.action.outCardNumber, -1]]) {
        const stat = model.sideboardStats[cardNumber] ||= { games: 0, returnSum: 0 };
        stat.games += 1;
        stat.returnSum += reward * direction;
      }
    }
  }
}

function sideboardPrior(knowledge, cardNumber) {
  const sideboard = knowledge?.sideboardStats?.[cardNumber];
  const meta = knowledge?.externalMeta?.cardStats?.[cardNumber];
  return (sideboard?.games ? sideboard.returnSum / sideboard.games : 0) + (meta?.winRate || 0) * (meta?.inclusionRate || 0);
}

function metaWeightedCards(knowledge) {
  const profiles = Object.values(knowledge?.deckProfiles || {});
  const weights = knowledge?.externalMeta?.deckWeights || {};
  const cards = [];
  for (const profile of profiles) {
    const weight = weights[profile.id] || 1;
    for (const [cardNumber, count] of Object.entries(profile.cardCounts || {})) {
      for (let index = 0; index < Math.min(3, Math.ceil(count * weight)); index += 1) cards.push({ cardNumber });
    }
  }
  return cards;
}

export function hydrateWorkerModel(checkpoint) {
  return deserializeNeuralModel(checkpoint);
}

export function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
  random.getState = () => state >>> 0;
  random.setState = (nextState) => {
    state = Number(nextState) >>> 0 || 1;
    return state;
  };
  return random;
}

export function fullHeuristicScoresForActions(game, actorId, actions) {
  const scoresByKey = new Map(
    scoreActions(game, actorId, actions || [], DEFAULT_AI_MODEL)
      .map((item) => [item.key, Number(item.score) || 0])
  );
  return (actions || []).map((action) => scoresByKey.get(actionKey(action)) ?? 0);
}

function sampleLeagueOpponent(pool, fullLeague, configuredWeights, random) {
  if (!Array.isArray(configuredWeights) || configuredWeights.length !== fullLeague.length) {
    return pool[Math.floor(random() * pool.length)];
  }
  const weights = pool.map((model) => {
    const index = fullLeague.indexOf(model);
    return Math.max(0, Number(configuredWeights[index]) || 0);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return pool[Math.floor(random() * pool.length)];
  let roll = random() * total;
  for (let index = 0; index < pool.length; index += 1) {
    if (!(weights[index] > 0)) continue;
    roll -= weights[index];
    if (roll <= 0) return pool[index];
  }
  return pool.at(-1);
}

function reusableEvaluationSummary(summary, expected) {
  if(summary && (summary.decisionReviewHash||null)!==(expected.decisionReviewHash||null))
    throw new Error('Saved evaluation decision review changed.');
  if (summary?.invalid) return null;
  if (!summary || summary.gameSeed !== expected.gameSeed || summary.candidateSeat !== expected.candidateSeat || summary.firstPlayerId !== expected.firstPlayerId) return null;
  if (summary.evaluationMode !== expected.evaluationMode) return null;
  if (Number(summary.streamAssignment || 0) !== Number(expected.streamAssignment || 0)) return null;
  if (JSON.stringify(summary.deckIds) !== JSON.stringify(expected.deckIds)) return null;
  if (!Array.isArray(summary.scores) || typeof summary.completed !== "boolean") return null;
  return structuredClone(summary);
}

function summarizeAiModel(model, role) {
  return {
    role,
    generation: model?.generation ?? null,
    trainingIteration: model?.metadata?.trainingIteration ?? null,
    gamesTrained: model?.gamesTrained ?? null,
    trainedAt: model?.metadata?.trainedAt || null
  };
}

function finalizeEvaluationStats(stats) {
  for (const stat of Object.values(stats)) {
    stat.winRate = stat.completed ? stat.wins / stat.completed : 0;
    stat.wilsonLowerBound = wilsonLower(stat.wins, stat.completed);
  }
}

function evaluationConditionGap(stats) {
  const rates = Object.values(stats).filter((stat) => stat.completed).map((stat) => stat.winRate);
  return rates.length > 1 ? Math.max(...rates) - Math.min(...rates) : 0;
}

function evaluationStability(summaries) {
  const completed = summaries.filter((summary) => summary.completed && Array.isArray(summary.scores));
  let blowouts = 0;
  let closeGames = 0;
  let absoluteMarginTotal = 0;
  let candidateMarginTotal = 0;
  for (const summary of completed) {
    const seat = Number.isInteger(summary.candidateSeat) ? summary.candidateSeat : 0;
    const margin = (summary.scores[seat] || 0) - (summary.scores[1 - seat] || 0);
    const absolute = Math.abs(margin);
    absoluteMarginTotal += absolute;
    candidateMarginTotal += margin;
    if (absolute >= 6) blowouts += 1;
    if (absolute <= 2) closeGames += 1;
  }
  return {
    games: completed.length,
    blowouts,
    closeGames,
    blowoutRate: completed.length ? blowouts / completed.length : 0,
    closeGameRate: completed.length ? closeGames / completed.length : 0,
    meanAbsoluteScoreMargin: completed.length ? absoluteMarginTotal / completed.length : 0,
    meanCandidateScoreMargin: completed.length ? candidateMarginTotal / completed.length : 0
  };
}

export function adjudicateEvaluationGame(game, candidateSeat = 0) {
  if (!game?.players?.length) return null;
  const candidatePlayerId = `p${candidateSeat + 1}`;
  const opponentSeat = 1 - candidateSeat;
  const score = game.players.map((player) => Number(player.score) || 0);
  const control = game.players.map((player) => (game.battlefields || []).filter((field) => field.controlledBy === player.id).length);
  const might = game.players.map((player) => (game.battlefields || []).flatMap((field) => field.units || [])
    .filter((unit) => unit.controllerId === player.id)
    .reduce((sum, unit) => sum + Math.max(0, (Number(unit.might) || 0) + (Number(unit.mightModifier) || 0) + (Number(unit.buffs) || 0) - (Number(unit.damage) || 0)), 0));
  const comparisons = [
    { criterion: "score", values: score },
    { criterion: "battlefield-control", values: control },
    { criterion: "board-might", values: might }
  ];
  for (const comparison of comparisons) {
    if (comparison.values[candidateSeat] === comparison.values[opponentSeat]) continue;
    const winnerSeat = comparison.values[candidateSeat] > comparison.values[opponentSeat] ? candidateSeat : opponentSeat;
    return {
      version: 1,
      reason: "max-actions",
      criterion: comparison.criterion,
      conservativeTieBreak: false,
      winnerId: `p${winnerSeat + 1}`,
      candidatePlayerId,
      score,
      control,
      might
    };
  }
  return {
    version: 1,
    reason: "max-actions",
    criterion: "conservative-candidate-loss",
    conservativeTieBreak: true,
    winnerId: `p${opponentSeat + 1}`,
    candidatePlayerId,
    score,
    control,
    might
  };
}

export function enrichSelfPlayError(error, diagnostic) {
  const enriched = error instanceof Error ? error : new Error(String(error));
  enriched.code ||= "AI_SELFPLAY_FAILED";
  enriched.diagnostic = { ...(enriched.diagnostic || {}), ...structuredClone(diagnostic) };
  return enriched;
}

function createSelfPlayError(message, game, diagnostic = {}) {
  const error = new Error(message);
  error.code = "AI_SELFPLAY_FAILED";
  error.diagnostic = {
    ...diagnostic,
    game: summarizeFailedGame(game)
  };
  return error;
}

function summarizeFailedGame(game) {
  return {
    phase: game?.phase || null,
    turn: game?.turn || null,
    activePlayerId: game?.activePlayerId || null,
    actorId: activeActorId(game),
    winnerId: game?.winnerId || null,
    players: (game?.players || []).map((player) => ({
      id: player.id,
      legend: player.legend?.cardNumber || player.legend?.name || null,
      champion: player.champion?.cardNumber || player.champion?.name || null,
      chosenChampionName: player.chosenChampionName || null,
      availableChampions: (player.availableChampions || []).map((card) => card.cardNumber || card.name),
      score: player.score
    })),
    pendingChoice: game?.pendingChoice ? structuredClone(game.pendingChoice) : null,
    pendingPayment: game?.pendingPayment ? structuredClone(game.pendingPayment) : null,
    actionChain: game?.actionChain ? structuredClone(game.actionChain) : null
  };
}

export function applyGeneralizedAdvantageEstimation(
  steps,
  terminalReward,
  gamma,
  lambda,
  shapingWeight = 0,
  diagnosticWeight = 0,
  horizon = {}
) {
  let shortGae = 0;
  let longGae = 0;
  const longLambda = Math.max(lambda, Math.min(1, Number(horizon.longLambda) || lambda));
  const longWeight = Math.max(0, Math.min(1, Number(horizon.longWeight) || 0));
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const terminal = index === steps.length - 1;
    // A trajectory advances between decisions of the same player, including
    // the opponent's intervening actions. Terminal potential is always zero.
    if (Number.isFinite(steps[index].shapingPotential)) {
      const nextPotential = terminal ? 0 : Number(steps[index + 1].shapingPotential) || 0;
      steps[index].shapedReward = gamma * nextPotential - steps[index].shapingPotential;
    }
    const diagnosticReward = (Number(steps[index].resourceReservationDiagnosticReward) || 0)
      + (Number(steps[index].handOpportunityDiagnosticReward) || 0);
    const reward = (terminal ? terminalReward : 0)
      + (steps[index].shapedReward || 0) * shapingWeight
      + diagnosticReward * diagnosticWeight;
    const nextValue = terminal ? 0 : steps[index + 1].value;
    const delta = reward + gamma * nextValue - steps[index].value;
    shortGae = delta + gamma * lambda * (terminal ? 0 : shortGae);
    longGae = delta + gamma * longLambda * (terminal ? 0 : longGae);
    const mixedAdvantage = shortGae * (1 - longWeight) + longGae * longWeight;
    steps[index].shortHorizonReturn = shortGae + steps[index].value;
    steps[index].longHorizonReturn = longGae + steps[index].value;
    steps[index].advantage = mixedAdvantage;
    steps[index].return = mixedAdvantage + steps[index].value;
    steps[index].terminalOutcome = terminalReward;
  }
}

export function trainingShapingPotential(game, viewerId) {
  const self = game.players.find((player) => player.id === viewerId);
  const opponent = game.players.find((player) => player.id !== viewerId);
  if (!self || !opponent) return 0;
  const boardMight = (playerId) => game.battlefields.flatMap((field) => field.units)
    .filter((unit) => unit.controllerId === playerId)
    .reduce((sum, unit) => sum + currentMight(game, unit), 0);
  const baseMight = (player) => (player.base || [])
    .filter((unit) => (unit.controllerId || player.id) === player.id && Number(unit.might) > 0)
    .reduce((sum, unit) => sum + currentMight(game, unit), 0);
  const controlledFields = (playerId) => game.battlefields.filter((field) => field.controlledBy === playerId).length;
  const curveReadiness = (player) => {
    const cards = [...(player.mainDeck || []), ...(player.hand || [])].filter((card) => Number(card.energy) > 0);
    const cardDemand = Math.max(1, averageEnergy(cards));
    return Math.min(1.5, (player.runes?.length || 0) / cardDemand) / 1.5;
  };
  const score = ((self.score || 0) - (opponent.score || 0)) / Math.max(1, game.victoryScore || 8);
  const board = (boardMight(self.id) - boardMight(opponent.id)) / 40;
  const base = (baseMight(self) - baseMight(opponent)) / 40;
  const control = (controlledFields(self.id) - controlledFields(opponent.id)) / Math.max(1, game.battlefields.length);
  const resources = ((self.hand?.length || 0) - (opponent.hand?.length || 0)) / 20;
  const runeDevelopment = ((self.runes?.length || 0) - (opponent.runes?.length || 0)) / 12;
  const readiness = curveReadiness(self) - curveReadiness(opponent);
  const demand = averageEnergy([...self.mainDeck, ...self.hand]) / 12;
  const battlefieldCommitment = game.battlefields.reduce((total, field) => {
    const friendly = field.units.filter((unit) => unit.controllerId === self.id)
      .reduce((sum, unit) => sum + currentMight(game, unit), 0);
    const enemy = field.units.filter((unit) => unit.controllerId === opponent.id)
      .reduce((sum, unit) => sum + currentMight(game, unit), 0);
    if (!friendly) return total;
    if (enemy >= friendly + 3 && friendly < enemy * 0.72) return total - Math.min(1, friendly / 12);
    if (friendly > enemy) return total + Math.min(0.5, (friendly - enemy) / 16);
    return total;
  }, 0) / Math.max(1, game.battlefields.length);
  return Math.tanh(score * 1.5
    + board * 0.35
    + base * 0.14
    + control * 0.12
    + resources * 0.1
    + readiness * 0.14
    + runeDevelopment * (0.12 + demand * 0.18)
    + battlefieldCommitment * 0.18);
}

function compactTacticalProfile(profile) {
  return {
    sourceCardNumber: profile.sourceCardNumber,
    targetCardNumber: profile.targetCardNumber,
    targetRelation: profile.targetRelation,
    polarity: profile.polarity,
    targetAlignment: profile.targetAlignment,
    casterSideBenefit: profile.casterSideBenefit,
    drawUrgency: profile.drawUrgency,
    incomingDamage: profile.incomingDamage,
    savesFromLethal: profile.savesFromLethal,
    targetImpact: profile.targetImpact,
    targetContext: profile.targetContext,
    responseContext: profile.responseContext,
    destinationId: profile.destinationId,
    isMovement: profile.isMovement,
    movingUnitCount: profile.movingUnitCount,
    movingMight: profile.movingMight,
    movementTriggersUnresolved: Boolean(profile.movementTriggersUnresolved),
    attackingMight: profile.attackingMight,
    defendingMight: profile.defendingMight,
    enemyLethalThreshold: profile.enemyLethalThreshold,
    friendlyLethalThreshold: profile.friendlyLethalThreshold,
    projectedFieldAdvantage: profile.projectedFieldAdvantage,
    hopelessReinforcement: profile.hopelessReinforcement,
    reversesRemoval: profile.reversesRemoval,
    canRemoveEnemyNoResponse: profile.canRemoveEnemyNoResponse,
    tacticalRemovalPossible: profile.tacticalRemovalPossible,
    tacticalFollowupCardNumbers: profile.tacticalFollowupCardNumbers,
    noOpponentImpact: profile.noOpponentImpact,
    temporaryCreatesCleanBreakthrough: profile.temporaryCreatesCleanBreakthrough,
    sourceControlRisk: profile.sourceControlRisk,
    enemyCanRemoveFriendly: profile.enemyCanRemoveFriendly,
    strictlyBeneficial: profile.strictlyBeneficial,
    tacticalPrior: profile.tacticalPrior
  };
}

function averageEnergy(cards) {
  return cards.length ? cards.reduce((sum, card) => sum + (card.energy || 0), 0) / cards.length : 0;
}

function neuralPaymentOptions(model) {
  if (!model?.layers) return { model: model?.valueWeights ? model : DEFAULT_AI_MODEL };
  return {
    model: DEFAULT_AI_MODEL,
    learnedCandidateLimit: 3,
    valueEstimator: (game, actorId) => estimateNeuralValue(model, game, actorId)
  };
}

function stopActionValue(decision) {
  const index = decision.legalActions.findIndex((action) => action.kind === "endTurn" || action.kind === "passShowdown");
  return index >= 0 ? decision.actionValues[index] : null;
}

export function terminalRewards(game) {
  if (game.phase !== "complete" || !game.winnerId) return null;
  return Object.fromEntries(game.players.map((player) => [player.id, player.id === game.winnerId ? 1 : -1]));
}

function pickDeckPair(decks, random, meta = null) {
  const first = weightedDeckPick(decks, random, meta);
  let second = weightedDeckPick(decks, random, meta);
  if (decks.length > 1 && second === first) second = decks[(decks.indexOf(first) + 1) % decks.length];
  return [first, second];
}

function weightedDeckPick(decks, random, meta) {
  const weights = decks.map((deck) => {
    const exact = meta?.externalMeta?.deckWeights?.[deck.id] ?? meta?.deckWeights?.[deck.id];
    if (exact != null) return Math.max(0.0001, exact);
    const legendNumber = deck.legend?.cardNumber;
    const externalDecks = meta?.externalMeta?.decks || meta?.decks || [];
    const legendWeight = externalDecks.filter((item) => item.legendCardNumber === legendNumber)
      .reduce((sum, item) => sum + (item.share || 0), 0);
    return Math.max(0.0001, legendWeight || 1);
  });
  let roll = random() * weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < decks.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return decks[index];
  }
  return decks.at(-1);
}

function mergeLearningSnapshots(snapshots) {
  const output = { deckStats: {}, cardStats: {}, matchupStats: {}, metaStats: { games: 0, cardAppearances: {} }, archetypeStats: {} };
  for (const snapshot of snapshots) mergeObjects(output, snapshot);
  return output;
}

function mergeObjects(target, source, path = []) {
  for (const [key, value] of Object.entries(source || {})) {
    if (path[0] === "deckProfiles") {
      if (target[key] == null) target[key] = structuredClone(value);
      continue;
    }
    if (typeof value === "number") target[key] = (target[key] || 0) + value;
    else if (value && typeof value === "object") mergeObjects(target[key] ||= {}, value, [...path, key]);
    else if (target[key] == null) target[key] = value;
  }
  return target;
}

function wilsonLower(wins, games, z = 1.645) {
  if (!games) return 0;
  const proportion = wins / games;
  const denominator = 1 + z * z / games;
  const center = proportion + z * z / (2 * games);
  const margin = z * Math.sqrt((proportion * (1 - proportion) + z * z / (4 * games)) / games);
  return (center - margin) / denominator;
}
