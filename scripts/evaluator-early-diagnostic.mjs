import { createHash } from "node:crypto";

const EVALUATOR_EARLY_DIAGNOSTIC_RECOVERY_FLOOR = 0.575;

export const EVALUATOR_EARLY_DIAGNOSTIC_CHECKPOINTS = Object.freeze([
  Object.freeze({
    id: "v2-50-action-180-leaf",
    validationFraction: 0.3,
    replicas: 1,
    epochs: 4,
    requirement: Object.freeze({
      minimumGames: 40,
      minimumActionReferences: 50,
      minimumActionReferenceGames: 35,
      minimumLeafValuePairs: 180,
      minimumLeafValueReferenceGames: 30,
      minimumStructuredV2ActionReferences: 50,
      minimumStructuredV2ActionReferenceGames: 35,
      minimumStructuredV2LeafValuePairs: 180,
      minimumStructuredV2LeafValueReferenceGames: 30,
      minimumActionReferencesPerDeckSeat: 2,
      minimumLeafValuePairsPerDeckSeat: 4,
      minimumActionReferencesByPhase: Object.freeze({
        mulligan: 5,
        early: 8,
        mid: 18,
        late: 10
      }),
      minimumActionReferenceGamesByPhase: Object.freeze({
        mulligan: 3,
        early: 5,
        mid: 12,
        late: 7
      }),
      minimumLeafValuePairsByPhase: Object.freeze({
        mulligan: 5,
        early: 12,
        mid: 28,
        late: 12
      }),
      minimumLeafValueReferenceGamesByPhase: Object.freeze({
        mulligan: 3,
        early: 5,
        mid: 9,
        late: 5
      }),
      minimumActionReferencesPerCoreClass: 4,
      minimumActionReferenceGamesPerCoreClass: 3,
      minimumActionReferencesPerDeckPhase: 1,
      minimumActionReferenceGamesPerDeckPhase: 1,
      minimumLeafValuePairsPerDeckPhase: 2,
      minimumLeafValueReferenceGamesPerDeckPhase: 1
    })
  }),
  Object.freeze({
    id: "v2-200-action-700-leaf",
    validationFraction: 0.35,
    replicas: 2,
    epochs: 6,
    requirement: Object.freeze({
      minimumGames: 150,
      minimumActionReferences: 200,
      minimumActionReferenceGames: 140,
      minimumLeafValuePairs: 700,
      minimumLeafValueReferenceGames: 100,
      minimumStructuredV2ActionReferences: 200,
      minimumStructuredV2ActionReferenceGames: 140,
      minimumStructuredV2LeafValuePairs: 700,
      minimumStructuredV2LeafValueReferenceGames: 100,
      minimumActionReferencesPerDeckSeat: 8,
      minimumLeafValuePairsPerDeckSeat: 10,
      minimumActionReferencesByPhase: Object.freeze({
        mulligan: 20,
        early: 30,
        mid: 70,
        late: 40
      }),
      minimumActionReferenceGamesByPhase: Object.freeze({
        mulligan: 12,
        early: 20,
        mid: 50,
        late: 28
      }),
      minimumLeafValuePairsByPhase: Object.freeze({
        mulligan: 20,
        early: 45,
        mid: 100,
        late: 45
      }),
      minimumLeafValueReferenceGamesByPhase: Object.freeze({
        mulligan: 10,
        early: 18,
        mid: 35,
        late: 18
      }),
      minimumActionReferencesPerCoreClass: 16,
      minimumActionReferenceGamesPerCoreClass: 10,
      minimumActionReferencesPerDeckPhase: 3,
      minimumActionReferenceGamesPerDeckPhase: 2,
      minimumLeafValuePairsPerDeckPhase: 5,
      minimumLeafValueReferenceGamesPerDeckPhase: 2
    })
  })
]);

export function expandEvaluatorEarlyDiagnosticRequirement(
  requirement = {},
  retryOrdinal = 1
) {
  const multiplier = 1 + (Math.max(1, Number(retryOrdinal) || 1) * 0.5);
  const scale = (value, minimumIncrease = 0) => {
    const current = Math.max(0, Number(value) || 0);
    return Math.ceil(Math.max(
      current * multiplier,
      current + Math.min(current, minimumIncrease)
    ));
  };
  const scaleMap = (value = {}) => Object.fromEntries(
    Object.entries(value || {}).map(([key, count]) => [key, scale(count)])
  );
  return {
    ...requirement,
    minimumGames: scale(requirement.minimumGames, 20),
    minimumActionReferences: scale(requirement.minimumActionReferences, 25),
    minimumActionReferenceGames: scale(
      requirement.minimumActionReferenceGames,
      18
    ),
    minimumLeafValuePairs: scale(requirement.minimumLeafValuePairs, 90),
    minimumLeafValueReferenceGames: scale(
      requirement.minimumLeafValueReferenceGames,
      15
    ),
    minimumStructuredV2ActionReferences: scale(
      requirement.minimumStructuredV2ActionReferences,
      25
    ),
    minimumStructuredV2ActionReferenceGames: scale(
      requirement.minimumStructuredV2ActionReferenceGames,
      18
    ),
    minimumStructuredV2LeafValuePairs: scale(
      requirement.minimumStructuredV2LeafValuePairs,
      90
    ),
    minimumStructuredV2LeafValueReferenceGames: scale(
      requirement.minimumStructuredV2LeafValueReferenceGames,
      15
    ),
    minimumActionReferencesPerDeckSeat: scale(
      requirement.minimumActionReferencesPerDeckSeat
    ),
    minimumLeafValuePairsPerDeckSeat: scale(
      requirement.minimumLeafValuePairsPerDeckSeat
    ),
    minimumActionReferencesByPhase: scaleMap(
      requirement.minimumActionReferencesByPhase
    ),
    minimumActionReferenceGamesByPhase: scaleMap(
      requirement.minimumActionReferenceGamesByPhase
    ),
    minimumLeafValuePairsByPhase: scaleMap(
      requirement.minimumLeafValuePairsByPhase
    ),
    minimumLeafValueReferenceGamesByPhase: scaleMap(
      requirement.minimumLeafValueReferenceGamesByPhase
    ),
    minimumActionReferencesPerCoreClass: scale(
      requirement.minimumActionReferencesPerCoreClass
    ),
    minimumActionReferenceGamesPerCoreClass: scale(
      requirement.minimumActionReferenceGamesPerCoreClass
    ),
    minimumActionReferencesPerDeckPhase: scale(
      requirement.minimumActionReferencesPerDeckPhase
    ),
    minimumActionReferenceGamesPerDeckPhase: scale(
      requirement.minimumActionReferenceGamesPerDeckPhase
    ),
    minimumLeafValuePairsPerDeckPhase: scale(
      requirement.minimumLeafValuePairsPerDeckPhase
    ),
    minimumLeafValueReferenceGamesPerDeckPhase: scale(
      requirement.minimumLeafValueReferenceGamesPerDeckPhase
    )
  };
}

export function splitEvaluatorEarlyDiagnosticRecords(records = [], options = {}) {
  const validationFraction = Math.max(
    0.1,
    Math.min(0.4, Number(options.validationFraction) || 0.2)
  );
  const seed = String(options.seed || "evaluator-early-diagnostic-v3");
  const previousTrainingKeys = new Set(
    options.previousSplit?.trainingRecordKeys || []
  );
  const previousValidationKeys = new Set(
    options.previousSplit?.validationRecordKeys || []
  );
  const hasFixedAnchor = previousValidationKeys.size > 0;
  const training = [];
  const validation = [];
  const unassigned = [];
  for (const record of records || []) {
    const recordKey = diagnosticRecordKey(record);
    if (previousValidationKeys.has(recordKey)) {
      validation.push(record);
      continue;
    }
    if (previousTrainingKeys.has(recordKey)) {
      training.push(record);
      continue;
    }
    unassigned.push(record);
  }
  const targetValidationCount = records.length > 1
    ? Math.max(1, Math.floor(records.length * validationFraction))
    : 0;
  const additionalValidationCount = Math.max(
    0,
    Math.min(
      unassigned.length,
      targetValidationCount - validation.length
    )
  );
  const selectedValidation = selectMultilabelDiagnosticValidationRecords(
    records,
    unassigned,
    validation,
    additionalValidationCount,
    { ...options, seed, validationFraction }
  );
  const selectedValidationKeys = new Set(
    selectedValidation.map(diagnosticRecordKey)
  );
  for (const record of unassigned) {
    if (selectedValidationKeys.has(diagnosticRecordKey(record))) {
      validation.push(record);
    } else {
      training.push(record);
    }
  }
  if (validation.length === 0 && training.length > 1) {
    validation.push(training.pop());
  }
  const validationRecordKeys = validation.map(diagnosticRecordKey).sort();
  const trainingRecordKeys = training.map(diagnosticRecordKey).sort();
  const anchorValidationRecordKeys = hasFixedAnchor
    ? [...previousValidationKeys].filter((key) =>
      validationRecordKeys.includes(key)).sort()
    : [...validationRecordKeys];
  const anchorSet = new Set(anchorValidationRecordKeys);
  return {
    training,
    validation,
    anchorValidation: validation.filter((record) =>
      anchorSet.has(diagnosticRecordKey(record))),
    trainingRecordKeys,
    validationRecordKeys,
    anchorValidationRecordKeys,
    fixedAnchorReused: hasFixedAnchor
  };
}

export function evaluatorEarlyDiagnosticTrainingRequirement(
  requirement = {},
  options = {}
) {
  const fraction = Math.max(
    0.25,
    Math.min(0.75, Number(options.minimumFraction) || 0.45)
  );
  const scaled = (key, floor) => Math.max(
    floor,
    Math.floor((Number(requirement[key]) || 0) * fraction)
  );
  return {
    minimumActionReferences: scaled("minimumActionReferences", 20),
    minimumLeafValuePairs: scaled("minimumLeafValuePairs", 50),
    minimumStructuredV2ActionReferences:
      scaled("minimumStructuredV2ActionReferences", 20),
    minimumStructuredV2LeafValuePairs:
      scaled("minimumStructuredV2LeafValuePairs", 50)
  };
}

export function evaluatorEarlyDiagnosticSplitEvidenceRequirement(
  requirement = {},
  options = {}
) {
  const requireActionEvidence = options.requireActionEvidence !== false;
  const validationFraction = Math.max(
    0.1,
    Math.min(0.4, Number(options.validationFraction) || 0.2)
  );
  const role = options.role === "validation" ? "validation" : "training";
  const share = role === "validation"
    ? validationFraction
    : 1 - validationFraction;
  // Only half of the nominal share is required because records can carry
  // several correlated references.  Floors still prevent one-game strata
  // from being treated as balanced.
  const scale = (value, floor = 0) => Math.max(
    floor,
    Math.floor((Number(value) || 0) * share * 0.5)
  );
  const scaleMap = (value = {}, floor = 0) => Object.fromEntries(
    Object.entries(value || {}).map(([key, count]) => [
      key,
      scale(count, floor)
    ])
  );
  const training = role === "training";
  return {
    minimumActionReferences: requireActionEvidence ? scale(
      requirement.minimumStructuredV2ActionReferences
        || requirement.minimumActionReferences,
      20
    ) : 0,
    minimumLeafValuePairs: scale(
      requirement.minimumStructuredV2LeafValuePairs
        || requirement.minimumLeafValuePairs,
      50
    ),
    minimumActionReferencesByPhase: requireActionEvidence ? scaleMap(
      requirement.minimumActionReferencesByPhase,
      training ? 3 : 2
    ) : {},
    minimumActionReferenceGamesByPhase: requireActionEvidence ? scaleMap(
      requirement.minimumActionReferenceGamesByPhase,
      training ? 3 : 2
    ) : {},
    minimumLeafValuePairsByPhase: scaleMap(
      requirement.minimumLeafValuePairsByPhase,
      training ? 5 : 3
    ),
    minimumLeafValueReferenceGamesByPhase: scaleMap(
      requirement.minimumLeafValueReferenceGamesByPhase,
      training ? 3 : 2
    ),
    minimumActionReferencesPerCoreClass: requireActionEvidence ? scale(
      requirement.minimumActionReferencesPerCoreClass,
      training ? 3 : 2
    ) : 0,
    minimumActionReferenceGamesPerCoreClass: requireActionEvidence ? scale(
      requirement.minimumActionReferenceGamesPerCoreClass,
      training ? 2 : 2
    ) : 0,
    minimumActionReferencesPerDeckSeat: requireActionEvidence ? scale(
      requirement.minimumActionReferencesPerDeckSeat,
      training ? 2 : 2
    ) : 0,
    minimumActionReferenceGamesPerDeckSeat: requireActionEvidence
      ? (training ? 2 : 1)
      : 0,
    minimumLeafValuePairsPerDeckSeat: scale(
      requirement.minimumLeafValuePairsPerDeckSeat,
      training ? 3 : 2
    ),
    minimumLeafValueReferenceGamesPerDeckSeat: training ? 2 : 1,
    minimumActionReferencesPerDeckPhase: requireActionEvidence ? scale(
      requirement.minimumActionReferencesPerDeckPhase,
      1
    ) : 0,
    minimumActionReferenceGamesPerDeckPhase: requireActionEvidence ? scale(
      requirement.minimumActionReferenceGamesPerDeckPhase,
      1
    ) : 0,
    minimumLeafValuePairsPerDeckPhase: scale(
      requirement.minimumLeafValuePairsPerDeckPhase,
      training ? 2 : 1
    ),
    minimumLeafValueReferenceGamesPerDeckPhase: scale(
      requirement.minimumLeafValueReferenceGamesPerDeckPhase,
      1
    )
  };
}

export function evaluatorEarlyDiagnosticStatus(
  candidates = [],
  options = {}
) {
  const summaries = (candidates || []).map((candidate) => {
    const trainingAction = finiteMetric(
      candidate?.trainingActionRanking?.neuralAccuracy
    );
    const trainingLeaf = finiteMetric(
      candidate?.trainingLeafValueRanking?.accuracy
    );
    const validationAction = finiteMetric(
      candidate?.actionRanking?.neuralAccuracy
    );
    const validationLeaf = finiteMetric(
      candidate?.leafValueRanking?.accuracy
    );
    const validationActionInterval =
      candidate?.actionRanking?.neuralAccuracyInterval
      || conservativeGameClusterAccuracyInterval(candidate?.actionRanking);
    const validationActionUpper = finiteMetric(
      candidate?.actionRanking?.neuralAccuracyUpperBound,
      validationActionInterval.upperBound
    );
    const validationLeafUpper = finiteMetric(
      candidate?.leafValueRanking?.accuracyUpperBound
    );
    const validationLeafInterval =
      candidate?.leafValueRanking?.accuracyInterval || { method: "unavailable" };
    const anchorAction = finiteMetric(
      candidate?.anchorActionRanking?.neuralAccuracy
    );
    const anchorLeaf = finiteMetric(
      candidate?.anchorLeafValueRanking?.accuracy
    );
    const anchorActionInterval =
      candidate?.anchorActionRanking?.neuralAccuracyInterval
      || conservativeGameClusterAccuracyInterval(
        candidate?.anchorActionRanking
      );
    const anchorActionUpper = finiteMetric(
      candidate?.anchorActionRanking?.neuralAccuracyUpperBound,
      anchorActionInterval.upperBound
    );
    const anchorLeafUpper = finiteMetric(
      candidate?.anchorLeafValueRanking?.accuracyUpperBound
    );
    const anchorLeafInterval =
      candidate?.anchorLeafValueRanking?.accuracyInterval || { method: "unavailable" };
    const history = candidate?.evaluatorTraining?.history || [];
    const trainingPipelineKnown = history.length > 0;
    const trainingPipelineValid = trainingPipelineKnown && history.every((item) =>
      Number(item?.samples) > 0
        && Number(item?.batches) > 0
        && Number.isFinite(finiteMetric(item?.loss))
        && Number.isFinite(finiteMetric(item?.rankingLoss))
        && Number.isFinite(finiteMetric(item?.outcomeLoss)));
    const shadowDevelopment = summarizeShadowDevelopmentCandidate(candidate, {
      trainingAction,
      trainingLeaf,
      validationAction,
      validationLeaf,
      anchorAction,
      anchorLeaf,
      anchorActionUpper,
      anchorLeafUpper
    });
    return {
      architecture: candidate?.architecture?.id || "unknown",
      replica: Number(candidate?.replica) || 0,
      trainingActionAccuracy: trainingAction,
      trainingLeafAccuracy: trainingLeaf,
      trainingMinimumAccuracy: Math.min(trainingAction, trainingLeaf),
      validationActionAccuracy: validationAction,
      validationLeafAccuracy: validationLeaf,
      validationMinimumAccuracy: Math.min(validationAction, validationLeaf),
      validationMinimumUpperBound: Math.min(
        validationActionUpper,
        validationLeafUpper
      ),
      validationActionUpperBound: validationActionUpper,
      validationLeafUpperBound: validationLeafUpper,
      anchorActionAccuracy: anchorAction,
      anchorLeafAccuracy: anchorLeaf,
      anchorMinimumAccuracy: Math.min(anchorAction, anchorLeaf),
      anchorActionUpperBound: anchorActionUpper,
      anchorLeafUpperBound: anchorLeafUpper,
      anchorMinimumUpperBound: Math.min(
        anchorActionUpper,
        anchorLeafUpper
      ),
      validationActionInterval,
      validationLeafInterval,
      anchorActionInterval,
      anchorLeafInterval,
      confidenceIntervalsComplete: [
        validationActionUpper,
        validationLeafUpper,
        anchorActionUpper,
        anchorLeafUpper
      ].every(Number.isFinite)
        && validationActionInterval.method
          === "deck-seat-stratified-game-bootstrap-hoeffding-v2"
        && validationLeafInterval.method
          === "deck-seat-stratified-game-bootstrap-hoeffding-v2"
        && anchorActionInterval.method
          === "deck-seat-stratified-game-bootstrap-hoeffding-v2"
        && anchorLeafInterval.method
          === "deck-seat-stratified-game-bootstrap-hoeffding-v2",
      trainingPipelineKnown,
      trainingPipelineValid,
      shadowDevelopment
    };
  });
  const completeSummaries = summaries.filter((item) => [
    item.trainingMinimumAccuracy,
    item.validationMinimumAccuracy,
    item.validationMinimumUpperBound,
    item.anchorMinimumAccuracy,
    item.anchorMinimumUpperBound
  ].every(Number.isFinite) && item.confidenceIntervalsComplete);
  const bestTrainingMinimumAccuracy = maximumMetric(
    completeSummaries,
    "trainingMinimumAccuracy"
  );
  const bestValidationMinimumAccuracy = maximumMetric(
    completeSummaries,
    "validationMinimumAccuracy"
  );
  const bestValidationMinimumUpperBound = maximumMetric(
    completeSummaries,
    "validationMinimumUpperBound"
  );
  const bestAnchorMinimumAccuracy = maximumMetric(
    completeSummaries,
    "anchorMinimumAccuracy"
  );
  const bestAnchorMinimumUpperBound = maximumMetric(
    completeSummaries,
    "anchorMinimumUpperBound"
  );
  const diagnosticInvalid = summaries.length === 0
    || completeSummaries.length !== summaries.length
    || summaries.some((item) => item.trainingPipelineKnown !== true)
    || options.validationEvidenceSufficient === false;
  const pipelineFailure = summaries.length > 0
    && summaries.every((item) => item.trainingPipelineKnown === true
      && item.trainingPipelineValid !== true);
  const replicaCounts = new Map();
  for (const item of completeSummaries) {
    replicaCounts.set(
      item.architecture,
      (replicaCounts.get(item.architecture) || 0) + 1
    );
  }
  const replicaCoverageComplete = replicaCounts.size > 0
    && [...replicaCounts.values()].every((count) => count >= 2);
  const previous = options.previous || null;
  const heads = Object.fromEntries(["action", "leaf"].map((head) => [
    head,
    evaluatorEarlyDiagnosticHeadStatus(head, completeSummaries, {
      diagnosticInvalid,
      checkpointOrdinal: options.checkpointOrdinal,
      previous,
      replicaCoverageComplete
    })
  ]));
  const strongFailureObserved = Object.values(heads).some(
    (item) => item.strongFailureObserved
  );
  const shadowValidationWarningObserved = Object.values(heads).some(
    (item) => item.pointFailureObserved
  );
  const cumulativeValidationFailureObserved = Object.values(heads).some(
    (item) => item.cumulativeValidationFailureObserved
  );
  const shadowStrongOverfitObserved = Object.values(heads).some(
    (item) => item.overfitObserved
  );
  const cumulativeShadowOverfitObserved = Object.values(heads).some(
    (item) => item.cumulativeOverfitObserved
  );
  const repeatedModelFailure = Object.values(heads).some(
    (item) => item.repeatedFailure
  );
  const repeatedShadowOverfit = Object.values(heads).some(
    (item) => item.repeatedOverfit
  );
  const headImprovements = Object.values(heads)
    .map((item) => item.improvementFromPreviousCheckpoint)
    .filter(Number.isFinite);
  const improvement = headImprovements.length
    ? Math.max(...headImprovements)
    : null;
  const shadowDevelopment = summarizeShadowDevelopmentAcrossCandidates(
    completeSummaries,
    {
      strongOverfitObserved: shadowStrongOverfitObserved,
      cumulativeValidationFailureObserved,
      cumulativeShadowOverfitObserved,
      repeatedShadowOverfit
    }
  );
  const failed = pipelineFailure
    || repeatedModelFailure
    || repeatedShadowOverfit;
  const warnings = [];
  if (shadowValidationWarningObserved) {
    warnings.push(
      "all-architectures-low-on-shadow-validation-and-fixed-anchor"
    );
  }
  if (diagnosticInvalid) {
    warnings.push("diagnostic-incomplete-or-unbalanced-continue");
  }
  warnings.push(...shadowDevelopment.warnings);
  const reasons = [];
  if (pipelineFailure) reasons.push("all-candidates-training-pipeline-invalid");
  for (const [head, item] of Object.entries(heads)) {
    if (item.repeatedFailure) {
      reasons.push(
        `repeated-${head}-shadow-validation-failure-with-no-anchor-improvement`
      );
    }
    if (item.repeatedOverfit) {
      reasons.push(`repeated-${head}-fixed-anchor-overfit-across-replicas`);
    }
  }
  return {
    version: 6,
    contract: "evaluator-training-shadow-development-v6",
    checkpointId: options.checkpointId || null,
    checkpointOrdinal: Math.max(0, Number(options.checkpointOrdinal) || 0),
    optimisticRecoveryFloor: EVALUATOR_EARLY_DIAGNOSTIC_RECOVERY_FLOOR,
    failureOnly: true,
    officialSelectionEligible: false,
    confirmationEligible: false,
    finalAuditEligible: false,
    status: failed
      ? "failed"
      : shadowValidationWarningObserved
        || shadowDevelopment.warnings.length > 0
        ? "strong-warning-continue"
      : bestValidationMinimumAccuracy >= 0.55
        ? "promising"
        : "inconclusive-continue",
    failed,
    reasons,
    warnings,
    diagnosticInvalid,
    pipelineFailure,
    strongFailureObserved,
    shadowValidationWarningObserved,
    cumulativeValidationFailureObserved,
    repeatedModelFailure,
    repeatedShadowOverfit,
    heads,
    shadowDevelopment,
    replicaCoverageComplete,
    candidateCount: summaries.length,
    completeCandidateCount: completeSummaries.length,
    bestTrainingMinimumAccuracy,
    bestValidationMinimumAccuracy,
    bestValidationMinimumUpperBound,
    bestAnchorMinimumAccuracy,
    bestAnchorMinimumUpperBound,
    improvementFromPreviousCheckpoint: improvement,
    candidates: summaries
  };
}

function evaluatorEarlyDiagnosticHeadStatus(
  head,
  summaries,
  options = {}
) {
  const prefix = head === "action" ? "Action" : "Leaf";
  const trainingKey = `training${prefix}Accuracy`;
  const validationKey = `validation${prefix}Accuracy`;
  const validationUpperKey = `validation${prefix}UpperBound`;
  const anchorKey = `anchor${prefix}Accuracy`;
  const values = summaries || [];
  const available = options.diagnosticInvalid !== true && values.length > 0;
  const pointFailureObserved = available && values.every((item) =>
    item[validationKey] < 0.5 && item[anchorKey] < 0.5);
  const strongFailureObserved = pointFailureObserved
    && values.every((item) => item[trainingKey] < 0.52);
  const cumulativeValidationFailureObserved = available
    && values.every((item) => item[validationUpperKey]
      < EVALUATOR_EARLY_DIAGNOSTIC_RECOVERY_FLOOR);
  const overfitObserved = available && values.every((item) =>
    item[trainingKey] >= 0.58
      && item[anchorKey] < 0.5
      && item[trainingKey] - item[anchorKey] >= 0.08);
  const cumulativeOverfitObserved = overfitObserved
    && cumulativeValidationFailureObserved;
  const previousByCandidate = new Map(
    (options.previous?.candidates || []).map((item) => [
      `${item.architecture}:${item.replica}`,
      item
    ])
  );
  const matchedImprovements = values.flatMap((item) => {
    const earlier = previousByCandidate.get(
      `${item.architecture}:${item.replica}`
    );
    const earlierAccuracy = finiteMetric(earlier?.[anchorKey]);
    return Number.isFinite(earlierAccuracy)
      ? [item[anchorKey] - earlierAccuracy]
      : [];
  });
  const improvementFromPreviousCheckpoint = matchedImprovements.length
    ? Math.max(...matchedImprovements)
    : null;
  const previousHead = options.previous?.heads?.[head];
  const repeatedOverfit = Number(options.checkpointOrdinal) > 0
    && previousHead?.overfitObserved === true
    && cumulativeOverfitObserved
    && options.replicaCoverageComplete === true
    && Number.isFinite(improvementFromPreviousCheckpoint)
    && improvementFromPreviousCheckpoint < 0.01;
  const repeatedFailure = Number(options.checkpointOrdinal) > 0
    && previousHead?.pointFailureObserved === true
    && pointFailureObserved
    && cumulativeValidationFailureObserved
    && !cumulativeOverfitObserved
    && options.replicaCoverageComplete === true
    && Number.isFinite(improvementFromPreviousCheckpoint)
    && improvementFromPreviousCheckpoint < 0.01;
  return {
    pointFailureObserved,
    strongFailureObserved,
    cumulativeValidationFailureObserved,
    overfitObserved,
    cumulativeOverfitObserved,
    repeatedFailure,
    repeatedOverfit,
    improvementFromPreviousCheckpoint
  };
}

function summarizeShadowDevelopmentCandidate(candidate, metrics = {}) {
  const derivedGaps = [
    finiteDifference(metrics.trainingAction, metrics.validationAction),
    finiteDifference(metrics.trainingLeaf, metrics.validationLeaf)
  ].filter(Number.isFinite);
  const derivedGap = derivedGaps.length ? Math.max(...derivedGaps) : null;
  const generalizationGap = finiteMetric(
    candidate?.generalizationGap,
    derivedGap
  );
  const trainingMinimumAccuracy = Math.min(
    metrics.trainingAction,
    metrics.trainingLeaf
  );
  const anchorMinimumUpperBound = Math.min(
    metrics.anchorActionUpper,
    metrics.anchorLeafUpper
  );
  const fixedAnchorGaps = [
    finiteDifference(metrics.trainingAction, metrics.anchorAction),
    finiteDifference(metrics.trainingLeaf, metrics.anchorLeaf)
  ].filter(Number.isFinite);
  const fixedAnchorGap = fixedAnchorGaps.length
    ? Math.max(...fixedAnchorGaps)
    : null;
  const overfitByHead = {
    action: [metrics.trainingAction, metrics.anchorAction]
      .every(Number.isFinite)
      && metrics.trainingAction >= 0.58
      && metrics.anchorAction < 0.5
      && metrics.trainingAction - metrics.anchorAction >= 0.08,
    leaf: [metrics.trainingLeaf, metrics.anchorLeaf]
      .every(Number.isFinite)
      && metrics.trainingLeaf >= 0.58
      && metrics.anchorLeaf < 0.5
      && metrics.trainingLeaf - metrics.anchorLeaf >= 0.08
  };
  const calibration = summarizeShadowCalibration(candidate?.calibration);
  const actionStrata = summarizeShadowStrata(
    candidate?.actionRanking,
    "action"
  );
  const leafStrata = summarizeShadowStrata(
    candidate?.leafValueRanking,
    "leaf"
  );
  const severeFixedAnchorOverfit = Object.values(overfitByHead).some(Boolean);
  const warnings = [];
  if (Number.isFinite(generalizationGap) && generalizationGap >= 0.08) {
    warnings.push("generalization-gap");
  }
  if (calibration.riskReasons.length > 0) warnings.push("calibration-risk");
  if (actionStrata.risks.length > 0) warnings.push("action-stratum-risk");
  if (leafStrata.risks.length > 0) warnings.push("leaf-stratum-risk");
  if (severeFixedAnchorOverfit) warnings.push("fixed-anchor-overfit");
  return {
    generalizationGap: Number.isFinite(generalizationGap)
      ? generalizationGap
      : null,
    trainingMinimumAccuracy: Number.isFinite(trainingMinimumAccuracy)
      ? trainingMinimumAccuracy
      : null,
    anchorMinimumUpperBound: Number.isFinite(anchorMinimumUpperBound)
      ? anchorMinimumUpperBound
      : null,
    fixedAnchorGap: Number.isFinite(fixedAnchorGap)
      ? fixedAnchorGap
      : null,
    severeFixedAnchorOverfit,
    overfitByHead,
    calibration,
    actionStrata,
    leafStrata,
    warnings: [...new Set(warnings)].sort()
  };
}

function summarizeShadowCalibration(calibration = {}) {
  const brier = finiteMetric(calibration?.brier);
  const expectedCalibrationError = finiteMetric(
    calibration?.expectedCalibrationError
  );
  const rankingAuc = finiteMetric(calibration?.rankingAuc);
  const logLoss = finiteMetric(calibration?.logLoss);
  const calibrationSlope = finiteMetric(calibration?.calibrationSlope);
  const testGames = finiteMetric(calibration?.testGames);
  const riskReasons = [];
  // Calibration has no sufficiently conservative interval at the pilot stage,
  // so it is diagnostic-only and can never authorize an automatic stop.
  if (Number.isFinite(brier) && brier > 0.3) riskReasons.push("high-brier");
  if (Number.isFinite(expectedCalibrationError)
    && expectedCalibrationError > 0.25) {
    riskReasons.push("high-ece");
  }
  if (Number.isFinite(rankingAuc) && rankingAuc <= 0.5) {
    riskReasons.push("weak-ranking-auc");
  }
  if (Number.isFinite(logLoss) && logLoss > 0.75) {
    riskReasons.push("high-log-loss");
  }
  if (Number.isFinite(testGames) && testGames >= 20
    && Number.isFinite(calibrationSlope)
    && (calibrationSlope < 0.5 || calibrationSlope > 1.5)) {
    riskReasons.push("calibration-slope-drift");
  }
  return {
    available: [
      brier,
      expectedCalibrationError,
      rankingAuc,
      logLoss
    ]
      .every(Number.isFinite),
    brier: Number.isFinite(brier) ? brier : null,
    expectedCalibrationError: Number.isFinite(expectedCalibrationError)
      ? expectedCalibrationError
      : null,
    rankingAuc: Number.isFinite(rankingAuc) ? rankingAuc : null,
    logLoss: Number.isFinite(logLoss) ? logLoss : null,
    calibrationSlope: Number.isFinite(calibrationSlope)
      ? calibrationSlope
      : null,
    testGames: Number.isFinite(testGames) ? testGames : null,
    riskReasons
  };
}

function summarizeShadowStrata(ranking = {}, kind) {
  const groups = kind === "action"
    ? [
      ["phase", ranking?.phaseBands],
      ["action-class", ranking?.actionClasses],
      ["deck-seat", ranking?.deckSeats],
      ["deck-seat-phase", ranking?.deckSeatPhases],
      ["deck-seat-action-class", ranking?.deckSeatActionClasses]
    ]
    : [
      ["phase", ranking?.phaseBands],
      ["deck-seat", ranking?.deckSeats],
      ["deck-seat-phase", ranking?.deckSeatPhases]
    ];
  const entries = [];
  for (const [group, values] of groups) {
    for (const [key, value] of Object.entries(values || {})) {
      const decisions = finiteMetric(value?.decisions);
      const contributingGames = finiteMetric(value?.contributingGames);
      const accuracy = finiteMetric(
        kind === "action" ? value?.neuralAccuracy : value?.accuracy
      );
      const accuracyUpperBound = finiteMetric(
        kind === "action"
          ? value?.neuralAccuracyUpperBound
          : value?.accuracyUpperBound
      );
      const comparatorAccuracy = kind === "action"
        ? finiteMetric(value?.comparatorAccuracy)
        : 0.5;
      const pairedUpperBound = finiteMetric(
        kind === "action"
          ? value?.pairedImprovementUpperBound
          : value?.pairedAdvantageUpperBound
      );
      const accuracyInterval = kind === "action"
        ? value?.neuralAccuracyInterval
        : value?.accuracyInterval;
      const gameClustered = accuracyInterval?.method
        === "deck-seat-stratified-game-hoeffding-v1";
      const sufficient = Number.isFinite(decisions)
        && Number.isFinite(contributingGames)
        && decisions >= (kind === "action" ? 8 : 12)
        && contributingGames >= (kind === "action" ? 5 : 4);
      const riskReasons = [];
      if (sufficient && gameClustered
        && Number.isFinite(accuracyUpperBound)
        && accuracyUpperBound < 0.5) {
        riskReasons.push("accuracy-upper-below-chance");
      }
      if (sufficient && Number.isFinite(pairedUpperBound)
        && pairedUpperBound < 0) {
        riskReasons.push(kind === "action"
          ? "worse-than-comparator"
          : "advantage-upper-below-zero");
      }
      entries.push({
        group,
        key,
        decisions: Number.isFinite(decisions) ? decisions : null,
        contributingGames: Number.isFinite(contributingGames)
          ? contributingGames
          : null,
        sufficient,
        gameClustered,
        accuracyIntervalMethod: accuracyInterval?.method || "unavailable",
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        accuracyUpperBound: Number.isFinite(accuracyUpperBound)
          ? accuracyUpperBound
          : null,
        comparatorAccuracy: Number.isFinite(comparatorAccuracy)
          ? comparatorAccuracy
          : null,
        pairedUpperBound: Number.isFinite(pairedUpperBound)
          ? pairedUpperBound
          : null,
        riskReasons
      });
    }
  }
  return {
    evaluated: entries.filter((item) => item.sufficient).length,
    insufficient: entries.filter((item) => !item.sufficient).map(
      (item) => `${item.group}:${item.key}`
    ),
    risks: entries.filter((item) => item.riskReasons.length > 0),
    entries
  };
}

function summarizeShadowDevelopmentAcrossCandidates(summaries, options = {}) {
  const candidateWarnings = summaries.flatMap((item) =>
    item.shadowDevelopment?.warnings || []);
  const architectureReplicas = new Map();
  for (const item of summaries) {
    if (!architectureReplicas.has(item.architecture)) {
      architectureReplicas.set(item.architecture, []);
    }
    architectureReplicas.get(item.architecture).push(item);
  }
  const replicaStability = [...architectureReplicas.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([architecture, items]) => {
      const anchorValues = items.map((item) => item.anchorMinimumAccuracy)
        .filter(Number.isFinite);
      const range = anchorValues.length >= 2
        ? Math.max(...anchorValues) - Math.min(...anchorValues)
        : null;
      const ordered = [...anchorValues].sort((left, right) => left - right);
      const median = ordered.length
        ? ordered[Math.floor((ordered.length - 1) / 2)]
        : null;
      const average = ordered.length
        ? ordered.reduce((sum, value) => sum + value, 0) / ordered.length
        : null;
      const variance = ordered.length >= 2
        ? ordered.reduce(
          (sum, value) => sum + (value - average) ** 2,
          0
        ) / ordered.length
        : null;
      return {
        architecture,
        replicas: anchorValues.length,
        weakestAnchorAccuracy: ordered.length ? ordered[0] : null,
        medianAnchorAccuracy: median,
        meanAnchorAccuracy: average,
        anchorAccuracyVariance: variance,
        anchorAccuracyStandardDeviation: Number.isFinite(variance)
          ? Math.sqrt(variance)
          : null,
        anchorAccuracyRange: range,
        unstable: Number.isFinite(range) && range >= 0.1
      };
    });
  const warnings = [];
  if (candidateWarnings.includes("generalization-gap")) {
    warnings.push("shadow-development-generalization-gap");
  }
  if (candidateWarnings.includes("calibration-risk")) {
    warnings.push("shadow-development-calibration-risk");
  }
  if (candidateWarnings.some((item) => item.endsWith("stratum-risk"))) {
    warnings.push("shadow-development-stratum-risk");
  }
  if (options.strongOverfitObserved === true) {
    warnings.push("all-architectures-fixed-anchor-overfit");
  }
  if (replicaStability.some((item) => item.unstable)) {
    warnings.push("shadow-development-replica-instability");
  }
  const diagnosticDemand = shadowDiagnosticDemand(summaries);
  return {
    version: 2,
    officialSelectionEligible: false,
    strongOverfitObserved: options.strongOverfitObserved === true,
    cumulativeValidationFailureObserved:
      options.cumulativeValidationFailureObserved === true,
    cumulativeShadowOverfitObserved:
      options.cumulativeShadowOverfitObserved === true,
    repeatedShadowOverfit: options.repeatedShadowOverfit === true,
    candidateRiskCount: summaries.filter(
      (item) => item.shadowDevelopment?.warnings?.length > 0
    ).length,
    replicaStability,
    diagnosticDemand,
    warnings
  };
}

function shadowDiagnosticDemand(summaries = []) {
  const support = new Map();
  for (const summary of summaries) {
    const candidateItems = new Map();
    for (const [evidenceKind, strata] of [
      ["action", summary.shadowDevelopment?.actionStrata],
      ["leaf", summary.shadowDevelopment?.leafStrata]
    ]) {
      for (const item of strata?.entries || []) {
        const reason = item.riskReasons?.length
          ? "observed-performance-risk"
          : !item.sufficient
            ? "insufficient-shadow-sample"
            : null;
        if (!reason) continue;
        const key = `${evidenceKind}|${item.group}|${item.key}`;
        candidateItems.set(key, {
          evidenceKind,
          group: item.group,
          key: item.key,
          reason,
          priority: "warning-only"
        });
      }
    }
    for (const [key, item] of candidateItems) {
      const current = support.get(key) || { ...item, candidates: 0 };
      current.candidates += 1;
      if (item.reason === "observed-performance-risk") {
        current.reason = item.reason;
      }
      support.set(key, current);
    }
  }
  const requiredSupport = Math.max(1, Math.ceil(summaries.length / 2));
  const items = [...support.values()]
    .filter((item) => item.candidates >= requiredSupport)
    .sort((left, right) =>
      Number(right.reason === "observed-performance-risk")
        - Number(left.reason === "observed-performance-risk")
      || right.candidates - left.candidates
      || left.evidenceKind.localeCompare(right.evidenceKind)
      || left.group.localeCompare(right.group)
      || left.key.localeCompare(right.key))
    .slice(0, 24)
    .map((item) => ({
      ...item,
      ...shadowDemandDimensions(item.group, item.key)
    }));
  return {
    version: 1,
    role: "training",
    priority: "warning-only",
    officialEvidenceRuleChanged: false,
    requiredCandidateSupport: requiredSupport,
    items
  };
}

function shadowDemandDimensions(group, key) {
  if (group === "phase") return { phaseBand: key };
  if (group === "action-class") return { actionClass: key };
  if (group === "deck-seat") return { deckSeat: key };
  if (group === "deck-seat-phase") {
    const [deckSeat, phaseBand] = splitCompositeStratumKey(key);
    return { deckSeat, phaseBand };
  }
  if (group === "deck-seat-action-class") {
    const [deckSeat, actionClass] = splitCompositeStratumKey(key);
    return { deckSeat, actionClass };
  }
  return {};
}

function splitCompositeStratumKey(key) {
  const separator = String(key).lastIndexOf("::");
  return separator < 0
    ? [String(key), null]
    : [String(key).slice(0, separator), String(key).slice(separator + 2)];
}

function finiteDifference(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    ? left - right
    : Number.NaN;
}

export function conservativeGameClusterAccuracyInterval(
  ranking = {},
  options = {}
) {
  const accuracy = finiteMetric(ranking?.neuralAccuracy);
  const games = Math.floor(finiteMetric(ranking?.contributingGames));
  if (!Number.isFinite(accuracy) || !Number.isFinite(games) || games < 1) {
    return {
      lowerBound: null,
      upperBound: null,
      contributingGames: Number.isFinite(games) ? games : null,
      method: "unavailable"
    };
  }
  const alpha = Math.max(
    1e-6,
    Math.min(0.25, Number(options.alpha) || 0.05)
  );
  // Treat the game as the independent unit and use a distribution-free
  // Hoeffding radius. This is intentionally more conservative than treating
  // every decision in a game as independent. Validation balance is checked
  // separately before this interval can authorize an early failure.
  const radius = Math.sqrt(Math.log(2 / alpha) / (2 * games));
  return {
    lowerBound: Math.max(0, accuracy - radius),
    upperBound: Math.min(1, accuracy + radius),
    contributingGames: games,
    alpha,
    method: "game-cluster-hoeffding-conservative-v1"
  };
}

export function bootstrapStratifiedGameAccuracyInterval(
  gameResults = [],
  options = {}
) {
  const normalized = (gameResults || []).map((item, index) => ({
    gameId: String(item?.gameId || `game-${index}`),
    stratum: String(item?.stratum || "unknown"),
    correct: Number(item?.correct),
    decisions: Number(item?.decisions)
  })).filter((item) => Number.isFinite(item.correct)
    && Number.isFinite(item.decisions)
    && item.decisions > 0)
    .sort((left, right) => left.stratum.localeCompare(right.stratum)
      || left.gameId.localeCompare(right.gameId));
  if (normalized.length === 0) {
    return {
      lowerBound: null,
      upperBound: null,
      mean: null,
      contributingGames: 0,
      strata: 0,
      samples: 0,
      method: "unavailable"
    };
  }
  const byStratum = new Map();
  for (const item of normalized) {
    if (!byStratum.has(item.stratum)) byStratum.set(item.stratum, []);
    byStratum.get(item.stratum).push(item);
  }
  const groups = [...byStratum.entries()].sort(([left], [right]) =>
    left.localeCompare(right));
  const macroAccuracy = (groupValues) => {
    const values = groupValues.map((items) => {
      const decisions = items.reduce((sum, item) => sum + item.decisions, 0);
      const correct = items.reduce((sum, item) => sum + item.correct, 0);
      return decisions > 0 ? correct / decisions : Number.NaN;
    }).filter(Number.isFinite);
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : Number.NaN;
  };
  const samples = Math.max(500, Math.floor(Number(options.samples) || 2000));
  const seedText = normalized.map((item) => [
    item.stratum,
    item.gameId,
    item.correct,
    item.decisions
  ].join(":")).join("|");
  let state = Number.parseInt(
    createHash("sha256").update(seedText).digest("hex").slice(0, 8),
    16
  ) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const bootstrapValues = new Array(samples);
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const sampledGroups = groups.map(([, items]) =>
      Array.from({ length: items.length }, () =>
        items[Math.floor(random() * items.length)]));
    bootstrapValues[sampleIndex] = macroAccuracy(sampledGroups);
  }
  bootstrapValues.sort((left, right) => left - right);
  const quantile = (probability) => bootstrapValues[Math.max(
    0,
    Math.min(
      bootstrapValues.length - 1,
      Math.floor(probability * (bootstrapValues.length - 1))
    )
  )];
  const alpha = Math.max(
    Number.EPSILON,
    Math.min(0.5, Number(options.alpha) || 0.05)
  );
  const stratumWeight = 1 / groups.length;
  let squaredGameWeightSum = 0;
  for (const [, items] of groups) {
    const stratumDecisions = items.reduce(
      (sum, item) => sum + item.decisions,
      0
    );
    if (!(stratumDecisions > 0)) continue;
    for (const item of items) {
      const gameWeight = stratumWeight
        * (item.decisions / stratumDecisions);
      squaredGameWeightSum += gameWeight * gameWeight;
    }
  }
  const mean = macroAccuracy(groups.map(([, items]) => items));
  const weightedHoeffdingRadius = squaredGameWeightSum > 0
    ? Math.sqrt(
      Math.log(2 / alpha) * squaredGameWeightSum / 2
    )
    : 1;
  const bootstrapLowerBound = quantile(alpha / 2);
  const bootstrapUpperBound = quantile(1 - alpha / 2);
  const weightedHoeffdingLowerBound = Math.max(
    0,
    mean - weightedHoeffdingRadius
  );
  const weightedHoeffdingUpperBound = Math.min(
    1,
    mean + weightedHoeffdingRadius
  );
  return {
    // Percentile bootstrap can collapse to a point when every observed game
    // in a stratum has the same result.  Keep the more conservative weighted
    // Hoeffding envelope so sparse or unanimous observations never masquerade
    // as certainty in an automatic early-failure decision.
    lowerBound: Math.min(
      bootstrapLowerBound,
      weightedHoeffdingLowerBound
    ),
    upperBound: Math.max(
      bootstrapUpperBound,
      weightedHoeffdingUpperBound
    ),
    mean,
    contributingGames: normalized.length,
    strata: groups.length,
    samples,
    alpha,
    effectiveGames: squaredGameWeightSum > 0
      ? 1 / squaredGameWeightSum
      : 0,
    bootstrapLowerBound,
    bootstrapUpperBound,
    weightedHoeffdingLowerBound,
    weightedHoeffdingUpperBound,
    weightedHoeffdingRadius,
    method: "deck-seat-stratified-game-bootstrap-hoeffding-v2"
  };
}

export function summarizeEvaluatorEarlyDiagnosticEvidence(
  records = [],
  options = {}
) {
  const requireStructuredV2 = options.requireStructuredV2 !== false;
  const requireActionEvidence = options.requireActionEvidence !== false;
  const requirement = options.requirement || {};
  const actionPhaseCoverage = {};
  const actionPhaseGameCount = {};
  const leafPhaseCoverage = {};
  const leafPhaseGameCount = {};
  const actionClassCoverage = {};
  const actionClassGameCount = {};
  const actionDeckSeatCoverage = {};
  const actionDeckSeatGameCount = {};
  const leafDeckSeatCoverage = {};
  const leafDeckSeatGameCount = {};
  const actionDeckPhaseCoverage = {};
  const actionDeckPhaseGameCount = {};
  const leafDeckPhaseCoverage = {};
  const leafDeckPhaseGameCount = {};
  let structuredV2ActionReferences = 0;
  let structuredV2LeafValuePairs = 0;
  let eligibleActionReferences = 0;
  let eligibleLeafValuePairs = 0;
  const addCoverage = (target, gameTarget, values = {}) => {
    for (const [key, countValue] of Object.entries(values || {})) {
      const count = Math.max(0, Number(countValue) || 0);
      if (!(count > 0)) continue;
      target[key] = (target[key] || 0) + count;
      gameTarget[key] = (gameTarget[key] || 0) + 1;
    }
  };
  for (const record of records || []) {
    const index = record?.resultIndex || {};
    const structuredIds = new Set(
      index.structuredV2ActionReferenceIdentities || []
    );
    const eligibleIds = requireStructuredV2
      ? structuredIds
      : new Set((index.actionReferenceIdentities || [])
        .map((identity) => identity?.identity)
        .filter(Boolean));
    const eligibleIdentities = (index.actionReferenceIdentities || [])
      .filter((identity) => eligibleIds.has(identity?.identity));
    const identityCoverage = (keySelector) => {
      const values = {};
      for (const identity of eligibleIdentities) {
        const key = keySelector(identity);
        if (!key) continue;
        values[key] = (values[key] || 0) + 1;
      }
      return values;
    };
    const indexedActionPhaseCoverage = requireStructuredV2
      ? index.structuredV2ActionReferencePhaseCoverage || {}
      : index.actionReferencePhaseCoverage || {};
    const indexedActionClassCoverage = requireStructuredV2
      ? index.structuredV2ActionReferenceActionClassCoverage || {}
      : index.actionReferenceActionClassCoverage || {};
    const indexedActionDeckSeatCoverage = requireStructuredV2
      ? index.structuredV2ActionReferenceCoverage || {}
      : index.actionReferenceCoverage || {};
    const indexedActionDeckPhaseCoverage = requireStructuredV2
      ? index.structuredV2ActionReferenceDeckPhaseCoverage || {}
      : index.actionReferenceDeckPhaseCoverage || {};
    const actionPhaseValues = Object.keys(indexedActionPhaseCoverage).length
      ? indexedActionPhaseCoverage
      : identityCoverage((identity) => identity.phaseBand);
    const actionClassValues = Object.keys(indexedActionClassCoverage).length
      ? indexedActionClassCoverage
      : identityCoverage((identity) => identity.actionClass);
    const actionDeckSeatValues = Object.keys(indexedActionDeckSeatCoverage).length
      ? indexedActionDeckSeatCoverage
      : identityCoverage((identity) => identity.coverageKey);
    const actionDeckPhaseValues = Object.keys(
      indexedActionDeckPhaseCoverage
    ).length
      ? indexedActionDeckPhaseCoverage
      : identityCoverage((identity) => {
        const deckId = String(identity.coverageKey || "")
          .replace(/:p[12]$/, "");
        return deckId && identity.phaseBand
          ? `${deckId}::${identity.phaseBand}`
          : null;
      });
    addCoverage(
      actionPhaseCoverage,
      actionPhaseGameCount,
      actionPhaseValues
    );
    addCoverage(
      actionClassCoverage,
      actionClassGameCount,
      actionClassValues
    );
    addCoverage(
      actionDeckSeatCoverage,
      actionDeckSeatGameCount,
      actionDeckSeatValues
    );
    addCoverage(
      actionDeckPhaseCoverage,
      actionDeckPhaseGameCount,
      actionDeckPhaseValues
    );
    const structuredActionCount = Number(
      index.structuredV2ActionReferenceCount
    ) || 0;
    const structuredLeafCount = Number(
      index.structuredV2LeafValuePairCount
    ) || 0;
    const eligibleActionCount = requireStructuredV2
      ? structuredActionCount
      : Number(index.actionReferenceCount) || 0;
    const eligibleLeafCount = requireStructuredV2
      ? structuredLeafCount
      : Number(index.leafValuePairCount) || 0;
    structuredV2ActionReferences += structuredActionCount;
    structuredV2LeafValuePairs += structuredLeafCount;
    eligibleActionReferences += eligibleActionCount;
    eligibleLeafValuePairs += eligibleLeafCount;
    if (eligibleLeafCount > 0) {
      addCoverage(
        leafPhaseCoverage,
        leafPhaseGameCount,
        requireStructuredV2
          ? index.structuredV2LeafValuePhaseCoverage || {}
          : index.leafValuePhaseCoverage || {}
      );
      addCoverage(
        leafDeckSeatCoverage,
        leafDeckSeatGameCount,
        requireStructuredV2
          ? index.structuredV2LeafValueCoverage || {}
          : index.leafValueCoverage || {}
      );
      addCoverage(
        leafDeckPhaseCoverage,
        leafDeckPhaseGameCount,
        requireStructuredV2
          ? index.structuredV2LeafValueDeckPhaseCoverage || {}
          : index.leafValueDeckPhaseCoverage || {}
      );
    }
  }
  const requiredDeckSeats = (options.deckIds || []).flatMap((deckId) => [
    `${deckId}:p1`,
    `${deckId}:p2`
  ]);
  const requiredPhases = ["mulligan", "early", "mid", "late"];
  const requiredActionClasses = [
    "movement-combat",
    "target-effect-choice",
    "card-use-vs-resource-preservation",
    "mulligan"
  ];
  const requiredDeckPhases = (options.deckIds || []).flatMap((deckId) =>
    requiredPhases.map((phase) => `${deckId}::${phase}`));
  const missingMap = (keys, coverage, minimum) => keys.filter((key) =>
    Number(coverage[key] || 0) < Number(
      typeof minimum === "object" ? minimum?.[key] || 0 : minimum || 0
    ));
  const minimumActionPhase = requirement.minimumActionReferencesByPhase
    || Object.fromEntries(requiredPhases.map((key) => [key, 1]));
  const minimumActionPhaseGames =
    requirement.minimumActionReferenceGamesByPhase
    || Object.fromEntries(requiredPhases.map((key) => [key, 1]));
  const minimumLeafPhase = requirement.minimumLeafValuePairsByPhase
    || Object.fromEntries(requiredPhases.map((key) => [key, 1]));
  const minimumLeafPhaseGames =
    requirement.minimumLeafValueReferenceGamesByPhase
    || Object.fromEntries(requiredPhases.map((key) => [key, 1]));
  const missing = {
    actionPhases: requireActionEvidence ? missingMap(
      requiredPhases,
      actionPhaseCoverage,
      minimumActionPhase
    ) : [],
    actionPhaseGames: requireActionEvidence ? missingMap(
      requiredPhases,
      actionPhaseGameCount,
      minimumActionPhaseGames
    ) : [],
    leafPhases: missingMap(
      requiredPhases,
      leafPhaseCoverage,
      minimumLeafPhase
    ),
    leafPhaseGames: missingMap(
      requiredPhases,
      leafPhaseGameCount,
      minimumLeafPhaseGames
    ),
    actionClasses: requireActionEvidence ? missingMap(
      requiredActionClasses,
      actionClassCoverage,
      Number(requirement.minimumActionReferencesPerCoreClass) || 1
    ) : [],
    actionClassGames: requireActionEvidence ? missingMap(
      requiredActionClasses,
      actionClassGameCount,
      Number(requirement.minimumActionReferenceGamesPerCoreClass) || 1
    ) : [],
    actionDeckSeats: requireActionEvidence ? missingMap(
      requiredDeckSeats,
      actionDeckSeatCoverage,
      Number(requirement.minimumActionReferencesPerDeckSeat) || 1
    ) : [],
    actionDeckSeatGames: requireActionEvidence ? missingMap(
      requiredDeckSeats,
      actionDeckSeatGameCount,
      Number(requirement.minimumActionReferenceGamesPerDeckSeat) || 1
    ) : [],
    leafDeckSeats: missingMap(
      requiredDeckSeats,
      leafDeckSeatCoverage,
      Number(requirement.minimumLeafValuePairsPerDeckSeat) || 1
    ),
    leafDeckSeatGames: missingMap(
      requiredDeckSeats,
      leafDeckSeatGameCount,
      Number(requirement.minimumLeafValueReferenceGamesPerDeckSeat) || 1
    ),
    actionDeckPhases: requireActionEvidence ? missingMap(
      requiredDeckPhases,
      actionDeckPhaseCoverage,
      Number(requirement.minimumActionReferencesPerDeckPhase) || 0
    ) : [],
    actionDeckPhaseGames: requireActionEvidence ? missingMap(
      requiredDeckPhases,
      actionDeckPhaseGameCount,
      Number(requirement.minimumActionReferenceGamesPerDeckPhase) || 0
    ) : [],
    leafDeckPhases: missingMap(
      requiredDeckPhases,
      leafDeckPhaseCoverage,
      Number(requirement.minimumLeafValuePairsPerDeckPhase) || 0
    ),
    leafDeckPhaseGames: missingMap(
      requiredDeckPhases,
      leafDeckPhaseGameCount,
      Number(requirement.minimumLeafValueReferenceGamesPerDeckPhase) || 0
    )
  };
  return {
    requireStructuredV2,
    requireActionEvidence,
    requirement,
    eligibleActionReferences,
    eligibleLeafValuePairs,
    structuredV2ActionReferences,
    structuredV2LeafValuePairs,
    actionPhases: Object.keys(actionPhaseCoverage).sort(),
    leafPhases: Object.keys(leafPhaseCoverage).sort(),
    actionClasses: Object.keys(actionClassCoverage).sort(),
    actionDeckSeats: Object.keys(actionDeckSeatCoverage).sort(),
    leafDeckSeats: Object.keys(leafDeckSeatCoverage).sort(),
    actionPhaseCoverage,
    actionPhaseGameCount,
    leafPhaseCoverage,
    leafPhaseGameCount,
    actionClassCoverage,
    actionClassGameCount,
    actionDeckSeatCoverage,
    actionDeckSeatGameCount,
    leafDeckSeatCoverage,
    leafDeckSeatGameCount,
    actionDeckPhaseCoverage,
    actionDeckPhaseGameCount,
    leafDeckPhaseCoverage,
    leafDeckPhaseGameCount,
    missing,
    sufficient: (!requireActionEvidence || eligibleActionReferences
        >= Math.max(1, Number(requirement.minimumActionReferences) || 0))
      && eligibleLeafValuePairs
        >= Math.max(1, Number(requirement.minimumLeafValuePairs) || 0)
      && Object.values(missing).every((items) => items.length === 0)
  };
}

function diagnosticRecordHash(seed, group, record) {
  return createHash("sha256").update(JSON.stringify([
    seed,
    group,
    record?.datasetKey || null,
    record?.workerIndex ?? null,
    record?.gameIndex ?? null
  ])).digest("hex");
}

function diagnosticRecordKey(record) {
  return [
    record?.datasetKey || "unknown",
    record?.workerIndex ?? "unknown",
    record?.gameIndex ?? "unknown"
  ].join(":");
}

function diagnosticRecordLabels(record, options = {}) {
  const index = record?.resultIndex || {};
  const requireStructuredV2 = options.requireStructuredV2 === true;
  const labels = new Set([
    `sampling-mode:${record?.samplingMode || "unknown"}`
  ]);
  const addCoverage = (prefix, values) => {
    for (const [key, count] of Object.entries(values || {})) {
      if (Number(count) > 0) labels.add(`${prefix}:${key}`);
    }
  };
  addCoverage(
    "action-deck-seat",
    requireStructuredV2
      ? index.structuredV2ActionReferenceCoverage
      : index.actionReferenceCoverage || index.gameCoverage
  );
  addCoverage(
    "leaf-deck-seat",
    requireStructuredV2
      ? index.structuredV2LeafValueCoverage
      : index.leafValueCoverage || index.gameCoverage
  );
  addCoverage(
    "action-phase",
    requireStructuredV2
      ? index.structuredV2ActionReferencePhaseCoverage
      : index.actionReferencePhaseCoverage
  );
  addCoverage(
    "action-class",
    requireStructuredV2
      ? index.structuredV2ActionReferenceActionClassCoverage
      : index.actionReferenceActionClassCoverage
  );
  addCoverage(
    "leaf-phase",
    requireStructuredV2
      ? index.structuredV2LeafValuePhaseCoverage
      : index.leafValuePhaseCoverage
  );
  addCoverage(
    "action-deck-phase",
    requireStructuredV2
      ? index.structuredV2ActionReferenceDeckPhaseCoverage
      : index.actionReferenceDeckPhaseCoverage
  );
  addCoverage(
    "leaf-deck-phase",
    requireStructuredV2
      ? index.structuredV2LeafValueDeckPhaseCoverage
      : index.leafValueDeckPhaseCoverage
  );
  return [...labels].sort();
}

function selectMultilabelDiagnosticValidationRecords(
  records,
  candidates,
  fixedValidation,
  selectionCount,
  options = {}
) {
  if (selectionCount <= 0 || candidates.length === 0) return [];
  const validationFraction = Math.max(
    0.1,
    Math.min(0.4, Number(options.validationFraction) || 0.2)
  );
  const seed = String(options.seed || "evaluator-early-diagnostic-v3");
  const labelsByKey = new Map((records || []).map((record) => [
    diagnosticRecordKey(record),
    diagnosticRecordLabels(record, options)
  ]));
  const totalCounts = new Map();
  const validationCounts = new Map();
  const increment = (counts, labels) => {
    for (const label of labels || []) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  };
  for (const labels of labelsByKey.values()) increment(totalCounts, labels);
  for (const record of fixedValidation || []) {
    increment(validationCounts, labelsByKey.get(diagnosticRecordKey(record)));
  }
  const targets = new Map([...totalCounts].map(([label, total]) => [
    label,
    total > 1
      ? Math.min(total - 1, Math.max(1, Math.floor(total * validationFraction)))
      : 0
  ]));
  const pending = candidates.map((record) => {
    const labels = labelsByKey.get(diagnosticRecordKey(record)) || [];
    return {
      record,
      labels,
      hash: diagnosticRecordHash(seed, labels.join("|"), record)
    };
  });
  const selected = [];
  while (selected.length < selectionCount && pending.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < pending.length; index += 1) {
      const candidate = pending[index];
      let score = 0;
      for (const label of candidate.labels) {
        const total = totalCounts.get(label) || 0;
        const current = validationCounts.get(label) || 0;
        const target = targets.get(label) || 0;
        const deficit = Math.max(0, target - current);
        if (deficit > 0) {
          score += 4 + deficit / Math.max(1, target);
        } else {
          score -= 0.05;
        }
        const trainingCountAfterSelection = total - current - 1;
        if (trainingCountAfterSelection < Math.min(1, total)) {
          score -= 1_000;
        }
      }
      if (score > bestScore
        || (score === bestScore
          && candidate.hash.localeCompare(pending[bestIndex].hash) < 0)) {
        bestIndex = index;
        bestScore = score;
      }
    }
    const [chosen] = pending.splice(bestIndex, 1);
    selected.push(chosen.record);
    increment(validationCounts, chosen.labels);
  }
  return selected;
}

function finiteMetric(value, fallback = Number.NaN) {
  const fallbackNumber = fallback === null
    || fallback === undefined
    || fallback === ""
      ? Number.NaN
      : Number(fallback);
  if (value === null || value === undefined || value === "") {
    return Number.isFinite(fallbackNumber) ? fallbackNumber : Number.NaN;
  }
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  return Number.isFinite(fallbackNumber) ? fallbackNumber : Number.NaN;
}

function maximumMetric(items, key) {
  const values = items.map((item) => Number(item[key])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}
