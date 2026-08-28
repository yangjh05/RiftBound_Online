import {
  ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
  ACTION_RANKING_AUDIT_REFERENCE_VERSION,
  LEAF_VALUE_REFERENCE_CONTRACT,
  LEAF_VALUE_REFERENCE_VERSION
} from "./action-ranking-reference.mjs";
import { STATE_DIM } from "./encoding.mjs";
import {
  evaluatorArchitecture,
  evaluatorLayerNames,
  evaluatorPathId,
  EVALUATOR_TARGET_HEADS
} from "./evaluator-architecture.mjs";
import {
  EVALUATOR_AUDIT_CORE_ACTION_CLASSES,
  EVALUATOR_AUDIT_PHASE_BANDS
} from "./audit-strata.mjs";
import {
  STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT,
  STRUCTURED_EVIDENCE_SCHEMA_VERSION
} from "./structured-evidence.mjs";
import {
  actionEvidenceRequirement,
  validActionEvidenceProtocolManifest
} from "./evidence-protocol.mjs";

export const EVALUATOR_CERTIFICATE_VERSION = 26;
export const EVALUATOR_CERTIFICATE_KINDS = Object.freeze({
  policyQ: "policy-q",
  robustAction: "robust-action"
});
const MINIMUM_ACTION_PHASE_DECISIONS = 5;
const MINIMUM_ACTION_PHASE_GAMES = 5;
const MINIMUM_LEAF_PHASE_DECISIONS = 12;
const MINIMUM_LEAF_PHASE_GAMES = 4;
const MINIMUM_ACTION_CLASS_DECISIONS = 5;
const MINIMUM_ACTION_CLASS_GAMES = 5;
const MAXIMUM_STRATUM_COMPARATOR_REGRESSION = 0.1;
const MINIMUM_STRATUM_PAIRED_LOWER_BOUND = -0.1;
// The aggregate audit must still beat its comparator with a positive paired
// lower bound. Per-phase checks are anti-blind-spot guards, so require a
// majority with a non-trivial confidence floor without demanding that each
// five-game slice independently prove superiority at 95% confidence.
const MINIMUM_PHASE_ACCURACY_LOWER_BOUND = 0.35;

const BEHAVIOR_LAYER_NAMES = Object.freeze([
  "gru",
  "stateProjection",
  "actionProjection",
  "actionBias",
  "actionValue"
]);
export function neuralEvaluatorModelHash(model) {
  return neuralArtifactHash(model);
}

export function neuralArtifactHash(model) {
  return hashNeuralLayers(model, Object.keys(model?.layers || {}).sort(), {
    kind: "artifact",
    includeGeneration: true,
    includeCalibration: "full",
    includeLeafEncoding: true
  });
}

export function neuralBehaviorHash(model) {
  return hashNeuralLayers(model, BEHAVIOR_LAYER_NAMES, {
    kind: "behavior",
    includeGeneration: false
  });
}

export function neuralEvaluatorCoreHash(model) {
  return hashNeuralLayers(model, evaluatorLayerNames(model), {
    kind: "evaluator-core",
    includeGeneration: false,
    includeLeafEncoding: true
  });
}

export function neuralEvaluatorLeafHash(model) {
  return hashNeuralLayers(model, evaluatorLayerNames(model), {
    kind: "evaluator-leaf",
    includeGeneration: false,
    includeCalibration: "output",
    includeLeafEncoding: true
  });
}

function hashNeuralLayers(model, requestedLayerNames, options = {}) {
  if (!model?.layers) return null;
  const layerNames = requestedLayerNames.filter((name) => model.layers[name]);
  if (layerNames.length !== requestedLayerNames.length) return null;
  const states = [2166136261, 2246822519, 3266489917, 668265263];
  hashText(states, JSON.stringify({
    kind: options.kind || "model",
    version: model.version,
    generation: options.includeGeneration ? model.generation : null,
    layerNames,
    leafEncoding: options.includeLeafEncoding
      ? {
        stateDim: STATE_DIM,
        cardRepresentation: model?.metadata?.cardRepresentation || null,
        evaluatorArchitecture: evaluatorArchitecture(model),
        structuredEvidenceSchemaVersion:
          STRUCTURED_EVIDENCE_SCHEMA_VERSION,
        structuredEvidenceEncoderFingerprint:
          STRUCTURED_EVIDENCE_ENCODER_FINGERPRINT
      }
      : null,
    calibration: options.includeCalibration === "full"
      ? model?.calibration || null
      : options.includeCalibration === "output"
        ? {
          temperature: Number(model?.calibration?.temperature) || 1,
          bias: Number(model?.calibration?.bias) || 0
        }
        : null
  }));
  for (const name of layerNames) {
    hashText(states, name);
    for (const tensor of model.layers[name].getWeights()) {
      hashText(states, JSON.stringify(tensor.shape));
      const values = tensor.dataSync();
      const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      for (let index = 0; index < bytes.length; index += 1) hashByte(states, bytes[index]);
    }
  }
  return `neural-${options.kind || "model"}-${states.map((state) =>
    (state >>> 0).toString(16).padStart(8, "0")).join("")}`;
}

export function evaluatorCertificateStatus(model, options = {}) {
  const certificate = model?.metadata?.evaluatorCertificate || null;
  const reasons = [];
  const expectedCertificateKind = options.certificateKind || null;
  const certificateKind = certificate?.certificateKind || null;
  const robustActionCertificate = certificateKind
    === EVALUATOR_CERTIFICATE_KINDS.robustAction;
  const policyQCertificate = certificateKind
    === EVALUATOR_CERTIFICATE_KINDS.policyQ;
  const expectedEngineFingerprint = options.engineFingerprint || null;
  const primaryModel = options.primaryModel || null;
  const minimumHoldoutGames = Math.max(100, Number(options.minimumHoldoutGames) || 100);
  const minimumRankingDecisions = Math.max(50, Number(options.minimumRankingDecisions) || 50);
  const minimumRankingGames = Math.max(20, Number(options.minimumRankingGames) || 20);
  const minimumLeafRankingDecisions = Math.max(
    50,
    Number(options.minimumLeafRankingDecisions) || 50
  );
  const minimumLeafRankingGames = Math.max(
    20,
    Number(options.minimumLeafRankingGames) || 20
  );
  const maximumBrier = Math.max(0, Number(options.maximumBrier) || 0.3);
  const maximumEce = Math.max(0, Number(options.maximumEce) || 0.25);
  const artifactHash = neuralArtifactHash(model);
  const behaviorHash = neuralBehaviorHash(model);
  const evaluatorCoreHash = neuralEvaluatorCoreHash(model);
  const evaluatorLeafHash = neuralEvaluatorLeafHash(model);
  const expectedEvaluatorPath = evaluatorPathId(model);
  const primaryArtifactHash = primaryModel ? neuralArtifactHash(primaryModel) : null;
  const primaryEvaluatorCoreHash = primaryModel
    ? neuralEvaluatorCoreHash(primaryModel)
    : null;
  const primaryEvaluatorLeafHash = primaryModel
    ? neuralEvaluatorLeafHash(primaryModel)
    : null;
  if (!certificate) reasons.push("missing-certificate");
  if (certificate?.version !== EVALUATOR_CERTIFICATE_VERSION) reasons.push("certificate-version");
  if (!Object.values(EVALUATOR_CERTIFICATE_KINDS).includes(certificateKind)) {
    reasons.push("certificate-kind");
  }
  if (expectedCertificateKind && certificateKind !== expectedCertificateKind) {
    reasons.push("certificate-kind-mismatch");
  }
  if (!validEvaluatorCertificatePermissions(
    certificateKind,
    certificate,
    certificate?.permissions
  )) reasons.push("certificate-permissions");
  if (certificate?.frozen !== true) reasons.push("evaluator-not-frozen");
  if (!artifactHash
    || certificate?.artifactHash !== artifactHash
    || certificate?.modelHash !== artifactHash) reasons.push("artifact-hash-mismatch");
  if (!behaviorHash || certificate?.behaviorHash !== behaviorHash) {
    reasons.push("behavior-hash-mismatch");
  }
  if (!evaluatorCoreHash || certificate?.evaluatorCoreHash !== evaluatorCoreHash) {
    reasons.push("evaluator-core-hash-mismatch");
  }
  if (!evaluatorLeafHash || certificate?.evaluatorLeafHash !== evaluatorLeafHash) {
    reasons.push("evaluator-leaf-hash-mismatch");
  }
  if (JSON.stringify(certificate?.evaluatorArchitecture || null)
      !== JSON.stringify(evaluatorArchitecture(model) || null)) {
    reasons.push("evaluator-architecture-mismatch");
  }
  if (primaryEvaluatorLeafHash && evaluatorLeafHash === primaryEvaluatorLeafHash) {
    reasons.push("same-evaluator-leaf-as-primary");
  }
  if (expectedEngineFingerprint
    && (certificate?.engineFingerprint !== expectedEngineFingerprint
      || model?.metadata?.engineFingerprint !== expectedEngineFingerprint)) {
    reasons.push("engine-fingerprint-mismatch");
  }
  if (model?.metadata?.engineValidationStatus !== "current-engine-validated") {
    reasons.push("current-engine-validation-missing");
  }
  const holdout = certificate?.holdout || {};
  if (Number(holdout.games) < minimumHoldoutGames) reasons.push("insufficient-independent-holdout");
  if (holdout.independent !== true) reasons.push("holdout-not-independent");
  if (holdout.seedProtected !== true) reasons.push("holdout-seed-not-protected");
  if (Number(holdout.invalidGames) > 0) reasons.push("holdout-invalid-games");
  if (Number(holdout.completionRate) < 0.9) reasons.push("holdout-completion-rate");
  const calibration = certificate?.calibration || {};
  if (Number(calibration.temperature) !==
      (Number(model?.calibration?.temperature) || 1)
    || Number(calibration.bias) !==
      (Number(model?.calibration?.bias) || 0)) {
    reasons.push("calibration-output-mismatch");
  }
  if (Number(calibration.testGames) < minimumHoldoutGames) reasons.push("insufficient-calibration-games");
  if (!Number.isFinite(Number(calibration.brier)) || Number(calibration.brier) > maximumBrier) {
    reasons.push("calibration-brier");
  }
  if (!Number.isFinite(Number(calibration.expectedCalibrationError))
    || Number(calibration.expectedCalibrationError) > maximumEce) {
    reasons.push("calibration-ece");
  }
  if (!Number.isFinite(Number(calibration.rankingAuc))
    || Number(calibration.rankingAuc) <= 0.5) {
    reasons.push("calibration-ranking-auc");
  }
  if (!Array.isArray(calibration.bootstrap?.rankingAuc95)
    || !Number.isFinite(Number(calibration.bootstrap.rankingAuc95[0]))
    || Number(calibration.bootstrap.rankingAuc95[0]) <= 0.5) {
    reasons.push("calibration-ranking-auc-unconfirmed");
  }
  const actionRanking = certificate?.actionRanking || {};
  const evaluatorBootstrap = certificate?.evaluatorBootstrap || {};
  if (evaluatorBootstrap.required === true && evaluatorBootstrap.complete !== true) {
    reasons.push("evaluator-bootstrap-incomplete");
  }
  if (evaluatorBootstrap.required === true
    && !evaluatorBootstrap.certificationDatasetFingerprint) {
    reasons.push("evaluator-bootstrap-dataset-fingerprint-missing");
  }
  const evidenceProtocol = evaluatorBootstrap.evidenceProtocol || null;
  if (robustActionCertificate && evidenceProtocol) {
    if (!validActionEvidenceProtocolManifest(evidenceProtocol)) {
      reasons.push("action-evidence-protocol-invalid");
    } else {
      const requirement = actionEvidenceRequirement(
        "final-audit",
        evidenceProtocol
      );
      const natural = evaluatorBootstrap.naturalDistributionActionAudit || {};
      const evaluatorNatural = actionRanking.naturalDistribution || {};
      if (Number(natural.states) < Number(
        requirement.naturalDistributionAuditMinimum || 0
      )) reasons.push("natural-action-audit-insufficient");
      if (!(Number(natural.decisiveCoverage)
        >= Number(requirement.decisiveCoverageMinimum || 0))) {
        reasons.push("natural-action-audit-decisive-coverage");
      }
      if (Number(natural.nearEquivalent) < Number(
        requirement.nearEquivalentMinimum || 0
      )) reasons.push("natural-action-audit-near-equivalent-insufficient");
      if (Number(natural.decisive) > 0
        && (!Number.isFinite(Number(evaluatorNatural.conditionalAccuracy))
          || !Number.isFinite(Number(evaluatorNatural.expectedRegret)))) {
        reasons.push("natural-action-audit-evaluator-metrics-missing");
      }
      if (!Array.isArray(natural.weakestStrata)
        || !Array.isArray(evaluatorNatural.weakestStrata)) {
        reasons.push("natural-action-audit-weakest-strata-missing");
      }
    }
  }
  if (robustActionCertificate) {
  const comparatorAccuracy = Number(
    actionRanking.comparatorAccuracy ?? actionRanking.heuristicAccuracy
  );
  if (Number(actionRanking.referenceVersion)
      !== ACTION_RANKING_AUDIT_REFERENCE_VERSION
    || actionRanking.referenceContract
      !== ACTION_RANKING_AUDIT_REFERENCE_CONTRACT) {
    reasons.push("action-ranking-reference-contract");
  }
  if (actionRanking.evaluatorPath !== expectedEvaluatorPath
    || JSON.stringify(actionRanking.evaluatorArchitecture || null)
      !== JSON.stringify(evaluatorArchitecture(model) || null)) {
    reasons.push("action-ranking-evaluator-path");
  }
  if (actionRanking.comparator
      !== "default-ai-post-action-state-evaluator-v1") {
    reasons.push("action-ranking-comparator-not-production-cutoff-heuristic");
  }
  if (Number(actionRanking.decisions) < minimumRankingDecisions) {
    reasons.push("insufficient-action-ranking-decisions");
  }
  if (Number(actionRanking.contributingGames) < minimumRankingGames) {
    reasons.push("insufficient-action-ranking-games");
  }
  if (actionRanking.splitUnit !== "game-cluster-bootstrap"
    || actionRanking.bootstrap?.unit !== "game"
    || actionRanking.weighting !== "deck-seat-macro"
    || actionRanking.bootstrap?.stratification !== "deck-seat-macro") {
    reasons.push("action-ranking-not-game-clustered");
  }
  if (!Number.isFinite(Number(actionRanking.neuralAccuracy))
    || !Number.isFinite(comparatorAccuracy)
    || Number(actionRanking.neuralAccuracy) <= comparatorAccuracy) {
    reasons.push("action-ranking-not-better-than-full-heuristic");
  }
  if (!Number.isFinite(Number(actionRanking.pairedImprovementLowerBound))
    || Number(actionRanking.pairedImprovementLowerBound) <= 0) {
    reasons.push("action-ranking-improvement-unconfirmed");
  }
  for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
    const evidence = actionRanking.phaseBands?.[phase] || {};
    if (evidenceCountBelow(evidence.decisions, MINIMUM_ACTION_PHASE_DECISIONS)
      || evidenceCountBelow(
        evidence.contributingGames,
        MINIMUM_ACTION_PHASE_GAMES
      )) {
      reasons.push(`insufficient-action-ranking-phase-${phase}`);
      continue;
    }
    if (!(Number(evidence.neuralAccuracy) > 0.5)
      || !(Number(evidence.neuralAccuracyLowerBound)
        > MINIMUM_PHASE_ACCURACY_LOWER_BOUND)) {
      reasons.push(`action-ranking-phase-unconfirmed-${phase}`);
    }
    if (!stratumComparatorNonInferior(evidence)) {
      reasons.push(`action-ranking-phase-inferior-${phase}`);
    }
    if (!stratumClusterEvidenceNonInferior(evidence)) {
      reasons.push(`action-ranking-phase-cluster-unconfirmed-${phase}`);
    }
  }
  for (const actionClass of EVALUATOR_AUDIT_CORE_ACTION_CLASSES) {
    const evidence = actionRanking.actionClasses?.[actionClass] || {};
    if (evidenceCountBelow(evidence.decisions, MINIMUM_ACTION_CLASS_DECISIONS)
      || evidenceCountBelow(
        evidence.contributingGames,
        MINIMUM_ACTION_CLASS_GAMES
      )) {
      reasons.push(`insufficient-action-ranking-class-${actionClass}`);
      continue;
    }
    if (!(Number(evidence.neuralAccuracy) > 0.5)
      || !(Number(evidence.neuralAccuracyLowerBound)
        > MINIMUM_PHASE_ACCURACY_LOWER_BOUND)) {
      reasons.push(`action-ranking-class-unconfirmed-${actionClass}`);
    }
    if (!stratumComparatorNonInferior(evidence)) {
      reasons.push(`action-ranking-class-inferior-${actionClass}`);
    }
    if (!stratumClusterEvidenceNonInferior(evidence)) {
      reasons.push(`action-ranking-class-cluster-unconfirmed-${actionClass}`);
    }
  }
  }
  const leafValueRanking = certificate?.leafValueRanking || {};
  if (Number(leafValueRanking.referenceVersion) !== LEAF_VALUE_REFERENCE_VERSION
    || leafValueRanking.referenceContract !== LEAF_VALUE_REFERENCE_CONTRACT) {
    reasons.push("leaf-value-reference-contract");
  }
  if (leafValueRanking.evaluatorPath !== expectedEvaluatorPath
    || JSON.stringify(leafValueRanking.evaluatorArchitecture || null)
      !== JSON.stringify(evaluatorArchitecture(model) || null)) {
    reasons.push("leaf-value-evaluator-path");
  }
  if (Number(leafValueRanking.decisions) < minimumLeafRankingDecisions) {
    reasons.push("insufficient-leaf-value-ranking-decisions");
  }
  if (Number(leafValueRanking.contributingGames) < minimumLeafRankingGames) {
    reasons.push("insufficient-leaf-value-ranking-games");
  }
  if (leafValueRanking.splitUnit !== "game-cluster-bootstrap"
    || leafValueRanking.bootstrap?.unit !== "game"
    || leafValueRanking.weighting !== "deck-seat-macro"
    || leafValueRanking.bootstrap?.stratification !== "deck-seat-macro") {
    reasons.push("leaf-value-ranking-not-game-clustered");
  }
  if (policyQCertificate) {
    if (leafValueRanking.formalPolicyQAudit?.eligible !== true
      || leafValueRanking.formalPolicyQAudit?.contract
        !== "policy-q-formal-accuracy-regret-safety-v15"
      || leafValueRanking.formalPolicyQAudit
        ?.deckSeatPhaseOpportunityContract
          !== "training-deck-seat-cartesian-v1"
      || !(Number(leafValueRanking.formalPolicyQAudit
        ?.expectedDeckSeatPhases?.length) > 0)) {
      reasons.push("policy-q-formal-audit-unconfirmed");
    }
  } else {
    if (!Number.isFinite(Number(leafValueRanking.accuracy))
      || Number(leafValueRanking.accuracy) <= 0.5) {
      reasons.push("leaf-value-ranking-not-better-than-chance");
    }
    if (!Number.isFinite(Number(leafValueRanking.accuracyLowerBound))
      || Number(leafValueRanking.accuracyLowerBound) <= 0.5) {
      reasons.push("leaf-value-ranking-unconfirmed");
    }
  }
  for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
    const evidence = leafValueRanking.phaseBands?.[phase] || {};
    if (evidenceCountBelow(evidence.decisions, MINIMUM_LEAF_PHASE_DECISIONS)
      || evidenceCountBelow(
        evidence.contributingGames,
        MINIMUM_LEAF_PHASE_GAMES
      )) {
      reasons.push(`insufficient-leaf-value-phase-${phase}`);
      continue;
    }
    if (!policyQCertificate && (!(Number(evidence.accuracy) > 0.5)
      || !(Number(evidence.accuracyLowerBound)
        > MINIMUM_PHASE_ACCURACY_LOWER_BOUND))) {
      reasons.push(`leaf-value-phase-unconfirmed-${phase}`);
    }
    if (!policyQCertificate
      && (!Number.isFinite(Number(evidence.pairedAdvantageLowerBound))
      || Number(evidence.pairedAdvantageLowerBound)
        <= MINIMUM_STRATUM_PAIRED_LOWER_BOUND)) {
      reasons.push(`leaf-value-phase-cluster-unconfirmed-${phase}`);
    }
  }
  return {
    version: 1,
    eligible: reasons.length === 0,
    reasons,
    modelHash: artifactHash,
    artifactHash,
    behaviorHash,
    evaluatorCoreHash,
    evaluatorLeafHash,
    primaryHash: primaryArtifactHash,
    primaryArtifactHash,
    primaryEvaluatorCoreHash,
    primaryEvaluatorLeafHash,
    certificate
  };
}

export function createEvaluatorCertificate(model, evidence = {}) {
  const calibration = evidence.calibration || model?.calibration || {};
  const holdout = evidence.holdout || {};
  const actionRanking = evidence.actionRanking || {};
  const leafValueRanking = evidence.leafValueRanking || {};
  const bootstrapAudit = evidence.bootstrapAudit || null;
  const artifactHash = neuralArtifactHash(model);
  const certificateKind = Object.values(EVALUATOR_CERTIFICATE_KINDS).includes(
    evidence.certificateKind
  )
    ? evidence.certificateKind
    : EVALUATOR_CERTIFICATE_KINDS.robustAction;
  const actionQAuthorization = actionQHeadAuthorization(
    certificateKind,
    actionRanking
  );
  const policyConditionedActionQValidated =
    Object.values(actionQAuthorization.heads).some(Boolean);
  const certificate = {
    version: EVALUATOR_CERTIFICATE_VERSION,
    certificateKind,
    scope: certificateKind === EVALUATOR_CERTIFICATE_KINDS.policyQ
      ? policyConditionedActionQValidated
        ? "state-value-and-policy-conditioned-action-q"
        : "state-value-only"
      : "multi-continuation-robust-action",
    permissions: evaluatorCertificatePermissions(
      certificateKind,
      actionQAuthorization.heads
    ),
    actionQAuthorization,
    evaluatorId: evidence.evaluatorId
      || `evaluator-generation-${model?.generation ?? "unknown"}`,
    modelHash: artifactHash,
    artifactHash,
    behaviorHash: neuralBehaviorHash(model),
    evaluatorCoreHash: neuralEvaluatorCoreHash(model),
    evaluatorLeafHash: neuralEvaluatorLeafHash(model),
    evaluatorArchitecture: evaluatorArchitecture(model),
    engineFingerprint: evidence.engineFingerprint || model?.metadata?.engineFingerprint || null,
    frozen: evidence.frozen === true,
    issuedAt: evidence.issuedAt || new Date().toISOString(),
    holdout: {
      games: Number(holdout.games) || 0,
      completed: Number(holdout.completed) || 0,
      completionRate: Number(holdout.completionRate) || 0,
      invalidGames: Number(holdout.invalidGames) || 0,
      independent: holdout.independent === true,
      seedProtected: holdout.seedProtected === true,
      seedManifestHash: holdout.seedManifestHash || null
    },
    calibration: {
      temperature: Number(model?.calibration?.temperature) || 1,
      bias: Number(model?.calibration?.bias) || 0,
      testGames: Number(calibration.testGames) || 0,
      brier: finiteOrNull(calibration.brier),
      expectedCalibrationError: finiteOrNull(calibration.expectedCalibrationError),
      rankingAuc: finiteOrNull(calibration.rankingAuc),
      bootstrap: calibration.bootstrap || null
    },
    evaluatorBootstrap: {
      required: evidence.bootstrapRequired === true,
      complete: evidence.bootstrapRequired === true
        ? bootstrapAudit?.complete === true
        : true,
      datasetVersion: Number(bootstrapAudit?.version) || null,
      acceptedGames: Number(bootstrapAudit?.acceptedGames) || 0,
      referenceCount: Number(bootstrapAudit?.referenceCount) || 0,
      referenceCountUnit: bootstrapAudit?.referenceCountUnit || null,
      actionReferenceCount: Number(bootstrapAudit?.actionReferenceCount) || 0,
      leafValuePairCount: Number(bootstrapAudit?.leafValuePairCount) || 0,
      contributingGames: Number(bootstrapAudit?.contributingGames) || 0,
      actionReferenceGameCount:
        Number(bootstrapAudit?.actionReferenceGameCount) || 0,
      leafValueReferenceGameCount:
        Number(bootstrapAudit?.leafValueReferenceGameCount) || 0,
      gameCoverage: structuredClone(bootstrapAudit?.gameCoverage || {}),
      referenceCoverage: structuredClone(bootstrapAudit?.referenceCoverage || {}),
      actionReferenceCoverage:
        structuredClone(bootstrapAudit?.actionReferenceCoverage || {}),
      leafValueCoverage: structuredClone(bootstrapAudit?.leafValueCoverage || {}),
      stratumVersion: Number(bootstrapAudit?.stratumVersion) || null,
      actionReferencePhaseCoverage: structuredClone(
        bootstrapAudit?.actionReferencePhaseCoverage || {}
      ),
      actionReferencePhaseGameCount: structuredClone(
        bootstrapAudit?.actionReferencePhaseGameCount || {}
      ),
      actionReferenceActionClassCoverage: structuredClone(
        bootstrapAudit?.actionReferenceActionClassCoverage || {}
      ),
      actionReferenceActionClassGameCount: structuredClone(
        bootstrapAudit?.actionReferenceActionClassGameCount || {}
      ),
      actionReferenceDeckPhaseCoverage: structuredClone(
        bootstrapAudit?.actionReferenceDeckPhaseCoverage || {}
      ),
      actionReferenceDeckPhaseGameCount: structuredClone(
        bootstrapAudit?.actionReferenceDeckPhaseGameCount || {}
      ),
      leafValuePhaseCoverage: structuredClone(
        bootstrapAudit?.leafValuePhaseCoverage || {}
      ),
      leafValuePhaseReferenceGameCount: structuredClone(
        bootstrapAudit?.leafValuePhaseReferenceGameCount || {}
      ),
      leafValueDeckPhaseCoverage: structuredClone(
        bootstrapAudit?.leafValueDeckPhaseCoverage || {}
      ),
      leafValueDeckPhaseReferenceGameCount: structuredClone(
        bootstrapAudit?.leafValueDeckPhaseReferenceGameCount || {}
      ),
      missingGameCoverage: [...(bootstrapAudit?.missingGameCoverage || [])],
      missingReferenceCoverage: [...(bootstrapAudit?.missingReferenceCoverage || [])],
      missingActionReferenceCoverage:
        [...(bootstrapAudit?.missingActionReferenceCoverage || [])],
      missingLeafValueCoverage:
        [...(bootstrapAudit?.missingLeafValueCoverage || [])],
      missingActionReferencePhaseCoverage:
        [...(bootstrapAudit?.missingActionReferencePhaseCoverage || [])],
      missingActionReferenceActionClassCoverage:
        [...(bootstrapAudit?.missingActionReferenceActionClassCoverage || [])],
      missingActionReferenceDeckPhaseCoverage:
        [...(bootstrapAudit?.missingActionReferenceDeckPhaseCoverage || [])],
      missingLeafValuePhaseCoverage:
        [...(bootstrapAudit?.missingLeafValuePhaseCoverage || [])],
      missingLeafValueDeckPhaseCoverage:
        [...(bootstrapAudit?.missingLeafValueDeckPhaseCoverage || [])],
      certificationDatasetFingerprint:
        bootstrapAudit?.certificationDatasetFingerprint || null,
      certificationDatasetManifest:
        structuredClone(bootstrapAudit?.certificationDatasetManifest || null),
      allocation: structuredClone(bootstrapAudit?.allocation || null),
      evidenceProtocol: structuredClone(
        bootstrapAudit?.evidenceProtocol || null
      ),
      actionEvidenceGradeCounts: structuredClone(
        bootstrapAudit?.actionEvidenceGradeCounts || {}
      ),
      actionEvidenceIndependentOpeningStateCount:
        Number(bootstrapAudit?.actionEvidenceIndependentOpeningStateCount) || 0,
      naturalDistributionActionAudit: structuredClone(
        bootstrapAudit?.naturalDistributionActionAudit || null
      ),
      actionEvidenceComputeEfficiency: structuredClone(
        bootstrapAudit?.actionEvidenceComputeEfficiency || null
      )
    },
    actionRanking: {
      version: Number(actionRanking.version) || 1,
      reference: actionRanking.reference || null,
      referenceVersion: Number(actionRanking.referenceVersion) || 0,
      referenceContract: actionRanking.referenceContract || null,
      evaluatorPath: actionRanking.evaluatorPath || null,
      evaluatorArchitecture:
        structuredClone(actionRanking.evaluatorArchitecture || null),
      comparator: actionRanking.comparator || null,
      comparatorScope: actionRanking.comparatorScope || null,
      splitUnit: actionRanking.splitUnit || null,
      weighting: actionRanking.weighting || null,
      games: Number(actionRanking.games) || 0,
      contributingGames: Number(actionRanking.contributingGames) || 0,
      decisions: Number(actionRanking.decisions) || 0,
      neuralAccuracy: finiteOrNull(actionRanking.neuralAccuracy),
      comparatorAccuracy: finiteOrNull(
        actionRanking.comparatorAccuracy ?? actionRanking.heuristicAccuracy
      ),
      heuristicAccuracy: finiteOrNull(actionRanking.heuristicAccuracy),
      pairedImprovement: finiteOrNull(actionRanking.pairedImprovement),
      pairedImprovementLowerBound: finiteOrNull(actionRanking.pairedImprovementLowerBound),
      pairedImprovementUpperBound: finiteOrNull(actionRanking.pairedImprovementUpperBound),
      bootstrap: actionRanking.bootstrap || null,
      targetHeads: structuredClone(actionRanking.targetHeads || {}),
      phaseBands: structuredClone(actionRanking.phaseBands || {}),
      actionClasses: structuredClone(actionRanking.actionClasses || {}),
      naturalDistribution: structuredClone(
        actionRanking.naturalDistribution || null
      )
    },
    leafValueRanking: {
      version: Number(leafValueRanking.version) || 1,
      referenceVersion: Number(leafValueRanking.referenceVersion) || 0,
      referenceContract: leafValueRanking.referenceContract || null,
      evaluatorPath: leafValueRanking.evaluatorPath || null,
      evaluatorArchitecture:
        structuredClone(leafValueRanking.evaluatorArchitecture || null),
      splitUnit: leafValueRanking.splitUnit || null,
      weighting: leafValueRanking.weighting || null,
      games: Number(leafValueRanking.games) || 0,
      contributingGames: Number(leafValueRanking.contributingGames) || 0,
      decisions: Number(leafValueRanking.decisions) || 0,
      correct: Number(leafValueRanking.correct) || 0,
      accuracy: finiteOrNull(leafValueRanking.accuracy),
      accuracyLowerBound: finiteOrNull(leafValueRanking.accuracyLowerBound),
      accuracyUpperBound: finiteOrNull(leafValueRanking.accuracyUpperBound),
      pairedAdvantage: finiteOrNull(leafValueRanking.pairedAdvantage),
      pairedAdvantageLowerBound: finiteOrNull(
        leafValueRanking.pairedAdvantageLowerBound
      ),
      pairedAdvantageUpperBound: finiteOrNull(
        leafValueRanking.pairedAdvantageUpperBound
      ),
      depthBins: structuredClone(leafValueRanking.depthBins || {}),
      bootstrap: leafValueRanking.bootstrap || null,
      phaseBands: structuredClone(leafValueRanking.phaseBands || {}),
      actionEffectRanking: structuredClone(
        leafValueRanking.actionEffectRanking || null
      ),
      formalPolicyQAudit: structuredClone(
        leafValueRanking.formalPolicyQAudit || null
      )
    }
  };
  const status = evaluatorCertificateStatus({
    ...model,
    metadata: {
      ...model?.metadata,
      engineValidationStatus: model?.metadata?.engineValidationStatus,
      evaluatorCertificate: certificate
    }
  }, {
    engineFingerprint: certificate.engineFingerprint,
    certificateKind,
    minimumHoldoutGames: evidence.minimumHoldoutGames,
    minimumRankingGames: evidence.minimumRankingGames
  });
  return { certificate, status };
}

function evaluatorCertificatePermissions(
  certificateKind,
  authorizedHeads = {}
) {
  const proposalRankingHeads = {
    generalActionQ: authorizedHeads?.generalActionQ === true,
    mulliganQ: authorizedHeads?.mulliganQ === true
  };
  const anyProposalRanking = Object.values(proposalRankingHeads).some(Boolean);
  if (certificateKind === EVALUATOR_CERTIFICATE_KINDS.policyQ) {
    return {
      leafEvaluation: true,
      proposalRanking: anyProposalRanking,
      proposalRankingHeads,
      policyConditionedActionQ: anyProposalRanking,
      policyConditionedActionQHeads: proposalRankingHeads,
      criticInitialization: true,
      uncertaintyEstimation: true,
      policyCorrection: false,
      formalActionCertification: false,
      policyPromotionEligible: false
    };
  }
  return {
    leafEvaluation: true,
    proposalRanking: true,
    proposalRankingHeads,
    policyConditionedActionQ: true,
    policyConditionedActionQHeads: proposalRankingHeads,
    criticInitialization: true,
    uncertaintyEstimation: true,
    policyCorrection: true,
    formalActionCertification: true,
    policyPromotionEligible: false
  };
}

function validEvaluatorCertificatePermissions(
  certificateKind,
  certificate,
  permissions
) {
  const expectedAuthorization = actionQHeadAuthorization(
    certificateKind,
    certificate?.actionRanking || {}
  );
  return JSON.stringify(permissions || null)
    === JSON.stringify(evaluatorCertificatePermissions(
      certificateKind,
      expectedAuthorization.heads
    ))
    && JSON.stringify(certificate?.actionQAuthorization || null)
      === JSON.stringify(expectedAuthorization);
}

function policyQActionRankingEvidenceEligible(headEvidence) {
  return Number(headEvidence?.decisions) >= 50
    && Number(headEvidence?.contributingGames) >= 20
    && Number(headEvidence?.neuralAccuracy) >= 0.5
    && headEvidence?.bootstrap?.unit === "game"
    && Number.isFinite(Number(headEvidence?.pairedImprovementLowerBound))
    && Number(headEvidence.pairedImprovementLowerBound)
      >= MINIMUM_STRATUM_PAIRED_LOWER_BOUND;
}

function actionQHeadAuthorization(certificateKind, actionRanking) {
  const robust = certificateKind === EVALUATOR_CERTIFICATE_KINDS.robustAction;
  const heads = {
    generalActionQ: robust
      || policyQActionRankingEvidenceEligible(
        actionRanking?.targetHeads?.[EVALUATOR_TARGET_HEADS.generalActionQ]
      ),
    mulliganQ: robust
      || policyQActionRankingEvidenceEligible(
        actionRanking?.targetHeads?.[EVALUATOR_TARGET_HEADS.mulliganQ]
      )
  };
  return {
    version: 2,
    validated: Object.values(heads).some(Boolean),
    scope: robust
      ? "multi-continuation-robust"
      : Object.values(heads).some(Boolean)
        ? "policy-conditioned"
        : false,
    heads,
    evidence: Object.fromEntries(Object.entries(heads).map(([head, valid]) => {
      const targetHead = head === "mulliganQ"
        ? EVALUATOR_TARGET_HEADS.mulliganQ
        : EVALUATOR_TARGET_HEADS.generalActionQ;
      const item = actionRanking?.targetHeads?.[targetHead] || {};
      return [head, {
        validated: valid,
        decisions: Number(item.decisions) || 0,
        contributingGames: Number(item.contributingGames) || 0,
        neuralAccuracy: finiteOrNull(item.neuralAccuracy),
        pairedImprovementLowerBound: finiteOrNull(
          item.pairedImprovementLowerBound
        )
      }];
    }))
  };
}

function stratumComparatorNonInferior(evidence) {
  return Number.isFinite(Number(evidence?.neuralAccuracy))
    && Number.isFinite(Number(evidence?.comparatorAccuracy))
    && Number(evidence.neuralAccuracy)
      >= Number(evidence.comparatorAccuracy)
        - MAXIMUM_STRATUM_COMPARATOR_REGRESSION;
}

function evidenceCountBelow(value, minimum) {
  return !Number.isFinite(Number(value)) || Number(value) < minimum;
}

function stratumClusterEvidenceNonInferior(evidence) {
  return evidence?.bootstrap?.unit === "game"
    && Number.isFinite(Number(evidence?.pairedImprovementLowerBound))
    && Number(evidence.pairedImprovementLowerBound)
      > MINIMUM_STRATUM_PAIRED_LOWER_BOUND;
}

export function certifiedIndependentEvaluators(models, primaryModel, options = {}) {
  const seen = new Set();
  const accepted = [];
  const rejected = [];
  for (const model of models || []) {
    if (!model) continue;
    const status = evaluatorCertificateStatus(model, {
      ...options,
      primaryModel
    });
    const requiredPermission = String(
      options.requiredPermission || "formalActionCertification"
    );
    const requiredTargetHead = options.requiredTargetHead || null;
    const requiredTargetHeadPermission = requiredTargetHead
      === EVALUATOR_TARGET_HEADS.mulliganQ
      ? "mulliganQ"
      : requiredTargetHead === EVALUATOR_TARGET_HEADS.generalActionQ
        ? "generalActionQ"
        : null;
    const targetHeadPermission = requiredTargetHead
      ? model?.metadata?.evaluatorCertificate?.permissions
        ?.proposalRankingHeads?.[requiredTargetHeadPermission] === true
      : true;
    if (!status.eligible
      || model?.metadata?.evaluatorCertificate?.permissions?.[
        requiredPermission
      ] !== true
      || !targetHeadPermission
      || seen.has(status.evaluatorLeafHash)) {
      if (status.eligible && model?.metadata?.evaluatorCertificate
        ?.permissions?.[requiredPermission] !== true) {
        status.reasons = [
          ...status.reasons,
          `missing-evaluator-permission-${requiredPermission}`
        ];
        status.eligible = false;
      }
      if (status.eligible && !targetHeadPermission) {
        status.reasons = [
          ...status.reasons,
          `missing-evaluator-permission-proposalRanking-${requiredTargetHead}`
        ];
        status.eligible = false;
      }
      rejected.push(status);
      continue;
    }
    seen.add(status.evaluatorLeafHash);
    accepted.push(model);
  }
  return { accepted, rejected };
}

export function selectEvaluatorOnlyArtifact(candidates, primaryModel) {
  const primaryLeafHash = primaryModel
    ? neuralEvaluatorLeafHash(primaryModel)
    : null;
  return [...(candidates || [])]
    .filter((item) =>
      item?.status?.eligible === true
        && item?.evaluatorLeafHash
        && (!primaryLeafHash
          || item.evaluatorLeafHash !== primaryLeafHash))
    .sort((left, right) =>
      Number(right.selectionScore) - Number(left.selectionScore)
        || Number(left.epoch) - Number(right.epoch))[0]
    || null;
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hashText(states, value) {
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashByte(states, code & 0xff);
    hashByte(states, code >>> 8);
  }
}

function hashByte(states, value) {
  const primes = [16777619, 2246822519, 3266489917, 374761393];
  for (let index = 0; index < states.length; index += 1) {
    states[index] ^= (value + index * 53) & 0xff;
    states[index] = Math.imul(states[index], primes[index]) >>> 0;
    states[index] ^= states[index] >>> (13 + index);
  }
}
