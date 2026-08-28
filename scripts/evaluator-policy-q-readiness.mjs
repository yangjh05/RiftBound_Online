import { createHash } from "node:crypto";

const EVALUATOR_AUDIT_PHASE_BANDS = Object.freeze([
  "mulligan", "early", "mid", "late"
]);

export const POLICY_Q_SHADOW_READINESS_CONTRACT =
  "policy-q-training-only-shadow-readiness-v20";

export const POLICY_Q_FORMAL_AUDIT_CONTRACT =
  "policy-q-formal-accuracy-regret-safety-v15";

export const PHASE_POLICY_Q_REQUIREMENTS = Object.freeze({
  mulligan: Object.freeze({
    binaryAccuracyRole: "screening-only",
    requireDecisiveAccuracy: true,
    requireNaturalRegret: true,
    requireTailRisk: true,
    preferTerminalEvidence: false
  }),
  early: Object.freeze({
    binaryAccuracyRole: "screening-only",
    requireDecisiveAccuracy: true,
    requireNaturalRegret: true,
    requireTailRisk: true,
    preferTerminalEvidence: false
  }),
  mid: Object.freeze({
    binaryAccuracyRole: "supporting",
    requireDecisiveAccuracy: true,
    requireNaturalRegret: true,
    requireTailRisk: true,
    preferTerminalEvidence: false
  }),
  late: Object.freeze({
    binaryAccuracyRole: "supporting",
    requireDecisiveAccuracy: true,
    requireNaturalRegret: true,
    requireTailRisk: true,
    preferTerminalEvidence: true
  })
});

export const POLICY_Q_FORMAL_AUDIT_REQUIREMENTS = Object.freeze({
  contract: POLICY_Q_FORMAL_AUDIT_CONTRACT,
  actionEffectContract: "paired-action-effect-evaluator-regret-v15",
  targeted: Object.freeze({
    minimumComparisons: 100,
    minimumContributingGames: 60,
    minimumDecisiveCoverage: 0.1,
    minimumDecisiveAccuracy: 0.6,
    minimumDecisiveAccuracyLowerBound: 0.45,
    maximumDecisiveAccuracyIntervalWidth: 0.2,
    minimumPhaseComparisons: 20,
    minimumPhaseContributingGames: 12,
    minimumPhaseDecisiveComparisons: 8,
    minimumPhaseDecisiveGames: 8,
    minimumPhaseDecisiveAccuracy: 0.55,
    minimumPhaseDecisiveAccuracyLowerBound: 0.35,
    maximumPhaseDecisiveAccuracyIntervalWidth: 0.25
  }),
  natural: Object.freeze({
    minimumComparisons: 120,
    minimumContributingGames: 80,
    minimumRiskAssessedComparisons: 100,
    minimumRiskAssessedGames: 70,
    minimumRiskAssessmentCoverage: 0.8,
    maximumPopulationRegretUpperBound: 0.25,
    maximumThreePercentLossRate: 0.2,
    maximumFivePercentLossRate: 0.15,
    maximumWorstTenPercentCvar: 0.25,
    maximumPopulationRegretIntervalWidth: 0.08,
    maximumLossRateIntervalWidth: 0.1,
    maximumWorstTenPercentCvarIntervalWidth: 0.12,
    minimumPhaseSafetyComparisons: 20,
    minimumPhaseSafetyGames: 20,
    minimumPhaseRiskAssessedComparisons: 16,
    minimumPhaseRiskAssessedGames: 16,
    minimumPhaseRiskAssessmentCoverage: 0.75,
    minimumDeckSeatSafetyComparisons: 12,
    minimumDeckSeatSafetyGames: 10,
    minimumDeckSeatRiskAssessedComparisons: 10,
    minimumDeckSeatRiskAssessedGames: 8,
    minimumDeckSeatRiskAssessmentCoverage: 0.75,
    minimumDeckSeatPhaseSafetyComparisons: 8,
    minimumDeckSeatPhaseSafetyGames: 8,
    minimumDeckSeatPhaseRiskAssessedComparisons: 6,
    minimumDeckSeatPhaseRiskAssessedGames: 6,
    minimumDeckSeatPhaseRiskAssessmentCoverage: 0.75,
    maximumStratumPopulationRegretUpperBound: 0.35,
    maximumStratumThreePercentLossRate: 0.35,
    maximumStratumFivePercentLossRate: 0.25,
    maximumStratumWorstTenPercentCvar: 0.35,
    maximumStratumPopulationRegretIntervalWidth: 0.15,
    maximumStratumLossRateIntervalWidth: 0.2,
    maximumStratumWorstTenPercentCvarIntervalWidth: 0.2
  }),
  phasePolicies: PHASE_POLICY_Q_REQUIREMENTS
});

// Preserve v4's model initialization/order namespace.  v5 changes only the
// ranking assessment, so trained weights remain reusable while audits refresh.
export const POLICY_Q_SHADOW_MODEL_TRAINING_NAMESPACE_HASH =
  "c58fcecd05bd06ddc38cabc2ea89fd1cdde9268537d66c66da5e01950df51f58";

const POLICY_Q_SHADOW_READINESS_LEGACY_CONTRACT =
  "policy-q-training-only-shadow-readiness-v1";

const POLICY_Q_SHADOW_READINESS_LEGACY_GRID = Object.freeze({
  version: 1,
  validationFraction: 0.2,
  architectureScreen: Object.freeze({
    learningRate: 0.0001,
    epochs: 8,
    replicas: 2,
    shortlist: 3
  }),
  learningRates: Object.freeze([0.00005, 0.0001, 0.0002]),
  epochs: Object.freeze([8, 12, 16]),
  finalReplicas: 3,
  maximumCollectionAttempts: 2,
  performanceRequirements: Object.freeze({
    requirePerformance: true,
    minimumLeafAccuracy: 0.63,
    minimumPhaseAccuracy: 0.65,
    minimumPhaseAccuracyLowerBound: 0.45,
    maximumGeneralizationGap: 0.05
  })
});

export const POLICY_Q_SHADOW_READINESS_GRID = Object.freeze({
  version: 8,
  validationFraction: 0.2,
  architectureScreen: Object.freeze({
    learningRate: 0.0001,
    epochs: 8,
    replicas: 2,
    shortlist: 3,
    groups: Object.freeze([
      "legacy-v1",
      "structured-set-v2",
      "structured-attention-v2"
    ])
  }),
  learningRates: Object.freeze([0.00005, 0.0001, 0.0002]),
  epochs: Object.freeze([8, 12, 16]),
  epochsByArchitectureGroup: Object.freeze({
    // Structured-v2 sees fewer usable samples per epoch because its first
    // quarter is common v1 pretraining and the remainder is v2-only.  Eight
    // legacy epochs and sixteen structured-v2 epochs give the closest
    // practical match in total optimizer sample exposure on Run C.
    "legacy-v1": Object.freeze([8]),
    "structured-set-v2": Object.freeze([16]),
    "structured-attention-v2": Object.freeze([16])
  }),
  finalReplicas: 3,
  maximumCollectionAttempts: 3,
  minimumStructuralFailureReplicas: 2,
  adaptivePhaseEffectiveGames: Object.freeze({
    minimum: 35,
    target: 42,
    maximum: 50
  }),
  performanceRequirements: Object.freeze({
    requirePerformance: true,
    confidenceBoundSource: "bootstrap-shadow",
    minimumLeafAccuracy: 0.63,
    minimumPhaseAccuracy: 0.65,
    minimumPhaseAccuracyLowerBound: 0.45,
    maximumGeneralizationGap: 0.05,
    phasePolicies: PHASE_POLICY_Q_REQUIREMENTS,
    regretAlternative: Object.freeze({
      contract: "paired-action-effect-evaluator-regret-v15",
      minimumComparisons: 12,
      minimumContributingGames: 8,
      minimumRiskAssessedComparisons: 8,
      minimumRiskAssessedGames: 6,
      minimumRiskAssessmentCoverage: 0.5,
      minimumDecisiveCoverage: 0.2,
      minimumClassifiedCoverage: 0.2,
      minimumDecisiveAccuracy: 0.6,
      minimumDecisiveAccuracyLowerBound: 0.4,
      maximumObservedClassificationRegret: 0.05,
      maximumObservedClassificationRegretUpperBound: 0.25,
      maximumPopulationRegretUpperBound: 0.25,
      maximumThreePercentLossRate: 0.2,
      maximumFivePercentLossRate: 0.15,
      maximumWorstTenPercentCvar: 0.25
    }),
    phaseActionEffect: Object.freeze({
      targeted: Object.freeze({
        minimumComparisons: 6,
        minimumContributingGames: 4,
        minimumDecisiveComparisons: 2,
        minimumDecisiveGames: 2,
        precisionTargetContributingGames: 16,
        minimumDecisiveAccuracy: 0.55,
        minimumDecisiveAccuracyLowerBound: 0.35
      }),
      natural: Object.freeze({
        minimumComparisons: 6,
        minimumContributingGames: 4,
        minimumRiskAssessedComparisons: 4,
        minimumRiskAssessedGames: 3,
        minimumRiskAssessmentCoverage: 0.5,
        precisionTargetContributingGames: 32,
        maximumPopulationRegretUpperBound: 0.35,
        maximumThreePercentLossRate: 0.35,
        maximumFivePercentLossRate: 0.25,
        maximumWorstTenPercentCvar: 0.35
      })
    })
  })
});

export function policyQShadowReadinessGridHash(
  grid = POLICY_Q_SHADOW_READINESS_GRID
) {
  return createHash("sha256")
    .update(JSON.stringify({
      contract: POLICY_Q_SHADOW_READINESS_CONTRACT,
      grid
    }))
    .digest("hex");
}

export function policyQShadowLegacyReadinessGridHash() {
  return createHash("sha256")
    .update(JSON.stringify({
      contract: POLICY_Q_SHADOW_READINESS_LEGACY_CONTRACT,
      grid: POLICY_Q_SHADOW_READINESS_LEGACY_GRID
    }))
    .digest("hex");
}

export function policyQShadowConfigurationGrid(
  architectures,
  grid = POLICY_Q_SHADOW_READINESS_GRID
) {
  const configurations = [];
  for (const architecture of architectures || []) {
    for (const learningRate of grid.learningRates || []) {
      for (const epochs of policyQShadowEpochsForArchitecture(
        architecture,
        grid
      )) {
        configurations.push({
          ordinal: configurations.length + 1,
          architecture,
          learningRate,
          epochs,
          configurationId: [
            architecture.id,
            `lr-${String(learningRate).replace(/[^0-9]/g, "")}`,
            `epochs-${epochs}`
          ].join("-")
        });
      }
    }
  }
  return configurations;
}

export function policyQShadowCollectionRoles() {
  // Protected development/confirmation/final-audit records are intentionally
  // absent. The returned value is also used by the orchestration tests.
  return Object.freeze(["training"]);
}

export function selectPolicyQShadowArchitectures(
  candidates = [],
  architectureSpecs = [],
  maximum = POLICY_Q_SHADOW_READINESS_GRID.architectureScreen.shortlist
) {
  const byArchitecture = new Map();
  for (const candidate of candidates || []) {
    const id = candidate?.architecture?.id
      || candidate?.evaluatorArchitecture?.id
      || candidate?.evaluatorArchitecture;
    if (!id) continue;
    const items = byArchitecture.get(id) || [];
    items.push(candidate);
    byArchitecture.set(id, items);
  }
  const allowed = new Map(
    (architectureSpecs || []).map((item) => [item.id, item])
  );
  const ranked = [...byArchitecture.entries()]
    .filter(([id]) => allowed.has(id))
    .filter(([, items]) => Number.isFinite(medianCandidateScore(items)))
    .sort((left, right) =>
      medianCandidateScore(right[1]) - medianCandidateScore(left[1])
        || left[0].localeCompare(right[0]));
  const selected = [];
  const selectedIds = new Set();
  for (const group of POLICY_Q_SHADOW_READINESS_GRID
    .architectureScreen.groups) {
    const match = ranked.find(([id]) =>
      policyQShadowArchitectureGroup(allowed.get(id)) === group);
    if (!match) continue;
    selected.push({ ...allowed.get(match[0]) });
    selectedIds.add(match[0]);
  }
  for (const [id] of ranked) {
    if (selected.length >= Math.max(1, Number(maximum) || 1)) break;
    if (selectedIds.has(id)) continue;
    selected.push({ ...allowed.get(id) });
    selectedIds.add(id);
  }
  return selected.slice(0, Math.max(1, Number(maximum) || 1));
}

export function policyQShadowArchitectureGroup(architecture = {}) {
  const family = String(architecture?.family || "");
  const inputSchema = String(architecture?.inputSchema || "");
  if (inputSchema === "legacy-v1"
    || family === "flat-v1"
    || family === "structured-set-v1") return "legacy-v1";
  if (family === "structured-set-v2") return "structured-set-v2";
  if (family === "structured-attention-v2") {
    return "structured-attention-v2";
  }
  return family || inputSchema || "unknown";
}

export function policyQShadowEpochsForArchitecture(
  architecture,
  grid = POLICY_Q_SHADOW_READINESS_GRID
) {
  const group = policyQShadowArchitectureGroup(architecture);
  const configured = grid.epochsByArchitectureGroup?.[group];
  return Array.isArray(configured) && configured.length
    ? [...configured]
    : [...(grid.epochs || [])];
}

export function selectPolicyQShadowConfiguration(results = []) {
  const eligible = (results || []).filter((item) =>
    item?.gate?.passed === true && item?.gate?.selected);
  if (!eligible.length) return null;
  return [...eligible].sort((left, right) =>
    candidateScore(right.gate.selected) - candidateScore(left.gate.selected)
      || Number(left.epochs) - Number(right.epochs)
      || Number(left.learningRate) - Number(right.learningRate)
      || String(left.architecture?.id || "")
        .localeCompare(String(right.architecture?.id || "")))[0];
}

export function policyQShadowReadinessDemand(
  gate = {},
  grid = POLICY_Q_SHADOW_READINESS_GRID
) {
  const candidates = (gate.candidates || [])
    .filter((item) => item?.leafValueRanking)
    .sort((left, right) => candidateScore(right) - candidateScore(left));
  const candidate = candidates[0];
  if (!candidate) {
    return {
      version: 3,
      contract: "policy-q-shadow-action-effect-training-demand-v3",
      role: "training",
      priority: "warning-only",
      officialEvidenceRuleChanged: false,
      items: [{
        evidenceKind: "leaf",
        reason: "shadow-readiness-no-evaluable-candidate"
      }]
    };
  }
  const candidateArchitecture = String(candidate?.architecture?.id || "");
  const cohort = candidates.filter((item) =>
    String(item?.architecture?.id || "") === candidateArchitecture);
  const requiredStableReplicas = Math.max(
    1,
    Math.min(
      cohort.length,
      Number(gate.requiredStableReplicas) || 1
    )
  );
  const items = [];
  for (const [phaseBand, summary] of Object.entries(
    candidate.leafValueRanking.phaseBands || {}
  )) {
    const phaseSummaries = cohort.map((item) => ({
      accuracy: item?.leafValueRanking?.phaseBands?.[phaseBand],
      actionEffect: item?.leafValueRanking?.actionEffectRanking
    }))
      .filter((item) => item.accuracy);
    const passingReplicas = phaseSummaries.filter((item) =>
      policyQShadowPhasePasses(
        item.accuracy,
        item.actionEffect,
        grid.performanceRequirements,
        phaseBand
      )).length;
    if (passingReplicas >= requiredStableReplicas) continue;
    const observedAccuracy = medianFinite(phaseSummaries.map((item) =>
      item?.accuracy?.accuracy));
    const observedLowerBound = minimumFinite(phaseSummaries.map((item) =>
      shadowBootstrapAccuracyBound(item?.accuracy, "lower")));
    const observedEffectiveGames = minimumFinite(phaseSummaries.map((item) =>
      shadowEffectiveGames(item?.accuracy)));
    const statuses = phaseSummaries.map((item) =>
      policyQShadowPhaseAuditStatus(
        item.actionEffect,
        phaseBand,
        grid.performanceRequirements
      ));
    const targetedSufficientReplicas = statuses.filter((status) =>
      status.targetedSufficient).length;
    const naturalSufficientReplicas = statuses.filter((status) =>
      status.naturalSufficient).length;
    const targetedPassingReplicas = statuses.filter((status) =>
      status.targetedPass).length;
    const naturalPassingReplicas = statuses.filter((status) =>
      status.naturalPass).length;
    const targetedPotentialReplicas = statuses.filter((status) =>
      status.targetedPass || status.targetedCouldPass).length;
    const naturalPotentialReplicas = statuses.filter((status) =>
      status.naturalPass || status.naturalCouldPass).length;
    const common = {
      phaseBand,
      observedAccuracy: finiteOrNull(observedAccuracy),
      observedLowerBound: finiteOrNull(observedLowerBound),
      confidenceBoundSource: "bootstrap-shadow",
      observedEffectiveGames: finiteOrNull(observedEffectiveGames),
      passingReplicas,
      requiredStableReplicas
    };
    const overallCouldPassReplicas = statuses.filter((status) =>
      status.couldPass).length;
    if (overallCouldPassReplicas < requiredStableReplicas) {
      items.push({
        ...common,
        evidenceKind: "model-tuning",
        missingMetric: "action-effect-performance",
        reason: "shadow-readiness-action-effect-performance-unmet",
        requiredAdditionalGames: 0
      });
      continue;
    }
    if (targetedSufficientReplicas < requiredStableReplicas) {
      const requirement = grid.performanceRequirements.phaseActionEffect
        .targeted;
      const observedGames = minimumFinite(statuses.map((status) =>
        status.targetedContributingGames));
      items.push({
        ...common,
        evidenceKind: "action-effect",
        auditDistribution: "targeted-decisive",
        missingMetric: "decisive-accuracy-confidence",
        reason: "shadow-readiness-targeted-action-effect-insufficient",
        observedActionEffectGames: finiteOrNull(observedGames),
        requiredAdditionalGames: Math.max(
          1,
          Number(requirement.minimumContributingGames)
            - (Number(observedGames) || 0)
        )
      });
    } else if (targetedPassingReplicas < requiredStableReplicas
      && targetedPotentialReplicas >= requiredStableReplicas) {
      const requirement = grid.performanceRequirements.phaseActionEffect
        .targeted;
      const observedGames = minimumFinite(statuses
        .filter((status) => status.targetedSufficient
          && !status.targetedPass
          && status.targetedCouldPass)
        .map((status) => status.targetedContributingGames));
      items.push({
        ...common,
        evidenceKind: "action-effect",
        auditDistribution: "targeted-decisive",
        missingMetric: "decisive-accuracy-confidence-precision",
        reason: "shadow-readiness-targeted-action-effect-uncertain",
        observedActionEffectGames: finiteOrNull(observedGames),
        requiredAdditionalGames: precisionAdditionalGames(
          observedGames,
          requirement.precisionTargetContributingGames
        )
      });
    }
    if (naturalSufficientReplicas < requiredStableReplicas) {
      const requirement = grid.performanceRequirements.phaseActionEffect
        .natural;
      const observedGames = minimumFinite(statuses.map((status) =>
        status.naturalRiskAssessedContributingGames));
      const observedComparisons = minimumFinite(statuses.map((status) =>
        status.naturalRiskAssessedComparisons));
      const observedCoverage = minimumFinite(statuses.map((status) =>
        status.naturalRiskAssessmentCoverage));
      const observedPopulationGames = minimumFinite(statuses.map((status) =>
        status.naturalContributingGames));
      const observedPopulationComparisons = minimumFinite(statuses.map(
        (status) => status.naturalComparisons
      ));
      const requiredAssessedForCoverage = Math.ceil(
        Number(requirement.minimumRiskAssessmentCoverage)
          * Math.max(
            Number(requirement.minimumComparisons) || 0,
            Number(observedPopulationComparisons) || 0
          )
      );
      items.push({
        ...common,
        evidenceKind: "action-effect",
        auditDistribution: "natural-distribution",
        missingMetric: "natural-risk-assessment-coverage",
        reason: "shadow-readiness-natural-action-effect-audit-insufficient",
        observedActionEffectGames: finiteOrNull(observedGames),
        observedActionEffectComparisons: finiteOrNull(observedComparisons),
        observedRiskAssessmentCoverage: finiteOrNull(observedCoverage),
        requiredAdditionalGames: Math.max(
          1,
          Number(requirement.minimumContributingGames)
            - (Number(observedPopulationGames) || 0),
          Number(requirement.minimumRiskAssessedGames)
            - (Number(observedGames) || 0),
          Number(requirement.minimumRiskAssessedComparisons)
            - (Number(observedComparisons) || 0),
          requiredAssessedForCoverage
            - (Number(observedComparisons) || 0)
        )
      });
    } else if (naturalPassingReplicas < requiredStableReplicas
      && naturalPotentialReplicas >= requiredStableReplicas) {
      const requirement = grid.performanceRequirements.phaseActionEffect
        .natural;
      const observedGames = minimumFinite(statuses
        .filter((status) => status.naturalSufficient
          && !status.naturalPass
          && status.naturalCouldPass)
        .map((status) => status.naturalRiskAssessedContributingGames));
      items.push({
        ...common,
        evidenceKind: "action-effect",
        auditDistribution: "natural-distribution",
        missingMetric: "population-regret-confidence-precision",
        reason: "shadow-readiness-natural-action-effect-uncertain",
        observedActionEffectGames: finiteOrNull(observedGames),
        requiredAdditionalGames: precisionAdditionalGames(
          observedGames,
          requirement.precisionTargetContributingGames
        )
      });
    }
  }
  const deckSeatPhaseKeys = new Set(cohort.flatMap((item) =>
    Object.keys(item?.leafValueRanking?.deckSeatPhases || {})));
  for (const key of [...deckSeatPhaseKeys].sort()) {
    const summaries = cohort.map((item) =>
      item?.leafValueRanking?.deckSeatPhases?.[key]).filter(Boolean);
    const supported = summaries.filter((summary) =>
      Number(summary?.decisions) >= 4
        && Number(summary?.contributingGames) >= 3);
    if (supported.length < requiredStableReplicas) continue;
    const weakReplicas = supported.filter((summary) =>
      Number(summary?.accuracy) < 0.6).length;
    const observedAccuracy = medianFinite(supported.map((summary) =>
      summary?.accuracy));
    if (weakReplicas < requiredStableReplicas
      || !(Number(observedAccuracy) < 0.6)) continue;
    const parsed = parseDeckSeatPhase(key);
    if (!parsed) continue;
    const observedLowerBound = minimumFinite(supported.map((summary) =>
      shadowBootstrapAccuracyBound(summary, "lower")));
    const observedEffectiveGames = minimumFinite(supported.map((summary) =>
      shadowEffectiveGames(summary)));
    for (const auditDistribution of [
      "targeted-decisive",
      "natural-distribution"
    ]) items.push({
      evidenceKind: "action-effect",
      auditDistribution,
      ...parsed,
      missingMetric: auditDistribution === "natural-distribution"
        ? "deck-seat-phase-tail-risk"
        : "deck-seat-phase-decisive-accuracy",
      reason: "shadow-readiness-weak-deck-seat-phase-action-effect",
      observedAccuracy: finiteOrNull(observedAccuracy),
      observedLowerBound: finiteOrNull(observedLowerBound),
      observedEffectiveGames: finiteOrNull(observedEffectiveGames),
      requiredAdditionalGames: Math.max(
        1,
        8 - Math.floor(Number(observedEffectiveGames) || 0)
      ),
      weakReplicas,
      supportedReplicas: supported.length,
      requiredStableReplicas
    });
  }
  if (!items.length) {
    items.push({
      evidenceKind: "leaf",
      reason: "shadow-readiness-generalization-or-replica-instability"
    });
  }
  return {
    version: 3,
    contract: "policy-q-shadow-action-effect-training-demand-v3",
    role: "training",
    priority: "warning-only",
    officialEvidenceRuleChanged: false,
    items: items.slice(0, 16)
  };
}

function precisionAdditionalGames(observedGames, targetGames) {
  const observed = Math.max(0, Math.floor(Number(observedGames) || 0));
  const target = Math.max(observed + 1, Math.floor(Number(targetGames) || 0));
  return Math.max(1, target - observed);
}

export function expandPolicyQShadowReadinessRequirement(
  requirement = {},
  attempt = 1,
  readiness = null,
  grid = POLICY_Q_SHADOW_READINESS_GRID,
  options = {}
) {
  const ordinal = Math.max(1, Number(attempt) || 1);
  const grow = (value, increment) => Math.ceil(Math.max(
    Number(value) || 0,
    (Number(value) || 0) * (1 + ordinal * 0.2),
    (Number(value) || 0) + increment * ordinal
  ));
  const growMap = (value = {}, increment = 0) => Object.fromEntries(
    Object.entries(value || {}).map(([key, count]) => [
      key,
      grow(count, increment)
    ])
  );
  const demandItems = readiness?.diagnosticDemand?.items || [];
  const actionEffectItems = demandItems.filter((item) =>
    item?.evidenceKind === "action-effect");
  const leafItems = demandItems.filter((item) =>
    item?.evidenceKind === "leaf");
  const actionEffectAdditionalGames = Math.min(
    160,
    actionEffectItems.reduce((sum, item) =>
      sum + Math.max(0, Math.ceil(Number(item.requiredAdditionalGames) || 0)), 0)
  );
  if (actionEffectItems.length && !leafItems.length) {
    // Re-evaluate precision after a small independent-game wave. Large fixed
    // 160-game extensions conceal zero-yield audit contracts for many hours.
    const requestedGames = Math.min(
      32,
      Math.max(16, actionEffectAdditionalGames)
    );
    const acceptedGames = Math.max(
      0,
      Math.floor(Number(options.currentAcceptedGames) || 0)
    );
    return {
      ...requirement,
      // Action-effect audits are collected in leaf-audit games, but ordinary
      // discordant leaf-pair quotas must not be inflated.  A game ceiling is
      // enough to schedule the requested precommitted targeted/natural tasks.
      // Anchor the new quota after the already accepted dataset.  Using only
      // the original requirement allowed a large resumed dataset to satisfy
      // every retry immediately without collecting any action-effect audit.
      minimumGames: Math.ceil(
        Math.max(
          (Number(requirement.minimumGames) || 0) + requestedGames,
          acceptedGames + requestedGames
        )
      ),
      shadowActionEffectDemand: {
        version: 2,
        contract: "policy-q-shadow-action-effect-collection-v2",
        collectionFloorGames: acceptedGames,
        requestedGames,
        items: structuredClone(actionEffectItems)
      }
    };
  }
  const expanded = {
    ...requirement,
    minimumGames: grow(requirement.minimumGames, 40),
    minimumLeafValuePairs: grow(requirement.minimumLeafValuePairs, 300),
    minimumLeafValueReferenceGames: grow(
      requirement.minimumLeafValueReferenceGames,
      40
    ),
    minimumStructuredV2LeafValuePairs: grow(
      requirement.minimumStructuredV2LeafValuePairs,
      300
    ),
    minimumStructuredV2LeafValueReferenceGames: grow(
      requirement.minimumStructuredV2LeafValueReferenceGames,
      40
    ),
    minimumLeafValuePairsByPhase: growMap(
      requirement.minimumLeafValuePairsByPhase,
      50
    ),
    minimumLeafValueReferenceGamesByPhase: growMap(
      requirement.minimumLeafValueReferenceGamesByPhase,
      20
    ),
    minimumLeafValuePairsPerDeckSeat: grow(
      requirement.minimumLeafValuePairsPerDeckSeat,
      4
    ),
    minimumLeafValuePairsPerDeckPhase: grow(
      requirement.minimumLeafValuePairsPerDeckPhase,
      4
    ),
    minimumLeafValueReferenceGamesPerDeckPhase: grow(
      requirement.minimumLeafValueReferenceGamesPerDeckPhase,
      2
    )
  };
  for (const item of demandItems) {
    const phase = item?.phaseBand;
    if (!phase || !(phase in (requirement.minimumLeafValueReferenceGamesByPhase
      || {}))) continue;
    const observed = Number(item.observedEffectiveGames);
    const requested = Number(item.targetEffectiveGames);
    const target = Math.max(
      grid.adaptivePhaseEffectiveGames.minimum,
      Math.min(
        grid.adaptivePhaseEffectiveGames.maximum,
        Number.isFinite(requested)
          ? requested
          : grid.adaptivePhaseEffectiveGames.target
      )
    );
    if (!(observed > 0) || observed >= target) continue;
    const scale = Math.min(4, target / observed);
    const baseGames = Number(
      requirement.minimumLeafValueReferenceGamesByPhase?.[phase]
    ) || 0;
    const basePairs = Number(
      requirement.minimumLeafValuePairsByPhase?.[phase]
    ) || 0;
    expanded.minimumLeafValueReferenceGamesByPhase[phase] = Math.max(
      expanded.minimumLeafValueReferenceGamesByPhase[phase] || 0,
      Math.ceil(baseGames * scale)
    );
    expanded.minimumLeafValuePairsByPhase[phase] = Math.max(
      expanded.minimumLeafValuePairsByPhase[phase] || 0,
      Math.ceil(basePairs * scale)
    );
  }
  return expanded;
}

export function classifyPolicyQShadowReadiness(
  gate = {},
  options = {}
) {
  if (gate?.passed === true) return {
    outcome: "passed",
    structuralFailure: false,
    reasons: []
  };
  const requirements = options.performanceRequirements
    || POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements;
  const minimumReplicas = Math.max(2, Number(
    options.minimumStructuralFailureReplicas
      || POLICY_Q_SHADOW_READINESS_GRID.minimumStructuralFailureReplicas
  ) || 2);
  const byArchitecture = new Map();
  const expectedArchitectures = new Set();
  for (const candidate of gate?.candidates || []) {
    const id = String(candidate?.architecture?.id || "unknown");
    expectedArchitectures.add(id);
    if (!candidate?.leafValueRanking) continue;
    if (!byArchitecture.has(id)) byArchitecture.set(id, []);
    byArchitecture.get(id).push(candidate);
  }
  const groups = [...expectedArchitectures].map((architecture) => [
    architecture,
    byArchitecture.get(architecture) || []
  ]);
  if (!groups.length || groups.some(([, candidates]) =>
    candidates.length < minimumReplicas)) return {
    outcome: "inconclusive",
    structuralFailure: false,
    reasons: ["policy-q-shadow-replica-evidence-insufficient"]
  };
  const failures = groups.map(([architecture, candidates]) => ({
    architecture,
    repeatedMetrics: repeatedOptimisticFailureMetrics(
      candidates,
      requirements
    )
  }));
  const commonRepeatedMetrics = failures.length
    ? failures[0].repeatedMetrics.filter((metric) =>
      failures.every((item) => item.repeatedMetrics.includes(metric)))
    : [];
  // Different architectures can fail for different reasons without proving
  // one shared structural limitation. Automatic failure requires one exact
  // optimistic-upper-bound metric to repeat across every architecture and
  // every required replica.
  const structuralFailure = commonRepeatedMetrics.length > 0;
  return {
    outcome: structuralFailure ? "structural-failure" : "inconclusive",
    structuralFailure,
    reasons: structuralFailure
      ? ["policy-q-shadow-repeated-optimistic-upper-bound-failure"]
      : ["policy-q-shadow-more-evidence-or-tuning-needed"],
    failures,
    commonRepeatedMetrics
  };
}

function repeatedOptimisticFailureMetrics(candidates, requirements) {
  const metricSets = candidates.map((candidate) => {
    const metrics = new Set();
    const leaf = candidate.leafValueRanking || {};
    const overallStatus = policyQShadowActionEffectStatus(
      leaf.actionEffectRanking,
      null,
      requirements
    );
    if (overallStatus.targetedSufficient
      && overallStatus.naturalSufficient
      && !overallStatus.couldPass) {
      metrics.add("overall");
    }
    for (const phase of Object.keys(leaf.phaseBands || {})) {
      const status = policyQShadowPhaseAuditStatus(
        leaf.actionEffectRanking,
        phase,
        requirements
      );
      if (status.targetedSufficient
        && status.naturalSufficient
        && !status.couldPass) {
        metrics.add(`phase:${phase}`);
      }
    }
    return metrics;
  });
  if (!metricSets.length) return [];
  return [...metricSets[0]].filter((metric) =>
    metricSets.every((set) => set.has(metric)));
}

export function policyQShadowPhasePasses(
  accuracySummary = {},
  actionEffectRanking = {},
  requirements = POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements,
  phaseBand = null
) {
  void accuracySummary;
  if (!EVALUATOR_AUDIT_PHASE_BANDS.includes(phaseBand)) return false;
  return policyQShadowPhaseAuditStatus(
    actionEffectRanking,
    phaseBand,
    requirements
  ).passes;
}

export function policyQShadowOverallPasses(
  leafValueRanking = {},
  requirements = POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements
) {
  return policyQShadowActionEffectStatus(
    leafValueRanking?.actionEffectRanking,
    null,
    requirements
  ).passes;
}

export function policyQShadowActionEffectGateStatus(
  leafValueRanking = {},
  requirements = POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements
) {
  const actionEffectRanking = leafValueRanking?.actionEffectRanking || {};
  const overall = policyQShadowActionEffectStatus(
    actionEffectRanking,
    null,
    requirements
  );
  const phases = Object.fromEntries(EVALUATOR_AUDIT_PHASE_BANDS.map(
    (phase) => [
      phase,
      policyQShadowPhaseAuditStatus(
        actionEffectRanking,
        phase,
        requirements
      )
    ]
  ));
  const reasons = [];
  if (!overall.targetedSufficient) {
    reasons.push("policy-q-shadow-targeted-action-effect-overall-insufficient");
  }
  if (!overall.naturalSufficient) {
    reasons.push("policy-q-shadow-natural-action-effect-overall-insufficient");
  }
  if (overall.targetedSufficient && overall.naturalSufficient
    && !overall.passes) {
    reasons.push("policy-q-shadow-action-effect-overall-performance");
  }
  for (const [phase, status] of Object.entries(phases)) {
    if (!status.targetedSufficient) {
      reasons.push(`policy-q-shadow-targeted-action-effect-phase-insufficient-${phase}`);
    }
    if (!status.naturalSufficient) {
      reasons.push(`policy-q-shadow-natural-action-effect-phase-insufficient-${phase}`);
    }
    if (status.targetedSufficient && status.naturalSufficient
      && !status.passes) {
      reasons.push(`policy-q-shadow-action-effect-phase-performance-${phase}`);
    }
  }
  return {
    version: 1,
    contract: POLICY_Q_SHADOW_READINESS_CONTRACT,
    eligible: overall.passes
      && Object.values(phases).every((status) => status.passes),
    reasons,
    overall,
    phases
  };
}

export function policyQShadowPhaseAuditStatus(
  actionEffectRanking = {},
  phaseBand,
  requirements = POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements
) {
  if (!EVALUATOR_AUDIT_PHASE_BANDS.includes(phaseBand)) {
    return emptyShadowActionEffectStatus("unknown-phase");
  }
  return policyQShadowActionEffectStatus(
    actionEffectRanking,
    phaseBand,
    requirements
  );
}

function policyQShadowActionEffectStatus(
  actionEffectRanking = {},
  phaseBand = null,
  requirements = POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements
) {
  const targetedRoot = actionEffectRanking?.targetedDecisiveAudit || {};
  const naturalRoot = actionEffectRanking?.naturalDistributionAudit || {};
  const targeted = phaseBand
    ? targetedRoot.phaseBands?.[phaseBand] || {}
    : targetedRoot;
  const natural = phaseBand
    ? naturalRoot.phaseBands?.[phaseBand] || {}
    : naturalRoot;
  const base = requirements.regretAlternative || {};
  const targetedRequirement = phaseBand
    ? requirements.phaseActionEffect?.targeted || {}
    : {
      minimumComparisons: base.minimumComparisons,
      minimumContributingGames: base.minimumContributingGames,
      minimumDecisiveComparisons: 1,
      minimumDecisiveGames: 1,
      minimumDecisiveAccuracy: base.minimumDecisiveAccuracy,
      minimumDecisiveAccuracyLowerBound:
        base.minimumDecisiveAccuracyLowerBound
    };
  const naturalRequirement = phaseBand
    ? requirements.phaseActionEffect?.natural || {}
    : {
      minimumComparisons: base.minimumComparisons,
      minimumContributingGames: base.minimumContributingGames,
      minimumRiskAssessedComparisons:
        base.minimumRiskAssessedComparisons,
      minimumRiskAssessedGames: base.minimumRiskAssessedGames,
      minimumRiskAssessmentCoverage:
        base.minimumRiskAssessmentCoverage,
      maximumPopulationRegretUpperBound:
        base.maximumPopulationRegretUpperBound,
      maximumThreePercentLossRate: base.maximumThreePercentLossRate,
      maximumFivePercentLossRate: base.maximumFivePercentLossRate,
      maximumWorstTenPercentCvar: base.maximumWorstTenPercentCvar
    };
  const phasePolicy = phaseBand
    ? requirements.phasePolicies?.[phaseBand] || {}
    : {};
  const contractValid = actionEffectRanking?.contract === base.contract;
  const terminalEvidenceValid = phasePolicy.preferTerminalEvidence !== true
    || (
      targetedRoot.evidenceSource === "paired-terminal-outcome-pairs-v1"
      && naturalRoot.evidenceSource === "paired-terminal-outcome-pairs-v1"
    );
  const targetedProvenanceValid = contractValid
    && terminalEvidenceValid
    && targetedRoot.auditDistribution === "teacher-selected-targeted"
    && targetedRoot.samplingContract
      === "teacher-selected-policy-decision-pair-v1"
    && targetedRoot.provenanceValidated === true;
  const naturalProvenanceValid = contractValid
    && terminalEvidenceValid
    && naturalRoot.auditDistribution === "natural-policy-decision-pairs"
    && naturalRoot.samplingContract
      === "hash-priority-reservoir-policy-decision-v1"
    && naturalRoot.provenanceValidated === true;
  const decisiveGames = Number(
    targeted.decisiveAccuracyInterval?.contributingGames
  );
  const targetedSufficient = targetedProvenanceValid
    && Number(targeted.comparisons)
      >= Number(targetedRequirement.minimumComparisons)
    && Number(targeted.contributingGames)
      >= Number(targetedRequirement.minimumContributingGames)
    && Number(targeted.decisive)
      >= Number(targetedRequirement.minimumDecisiveComparisons)
    && decisiveGames >= Number(targetedRequirement.minimumDecisiveGames)
    && Number.isFinite(Number(targeted.decisiveAccuracy))
    && Number.isFinite(Number(
      targeted.decisiveAccuracyInterval?.lowerBound
    ));
  const targetedPass = targetedSufficient
    && Number(targeted.decisiveAccuracy)
      >= Number(targetedRequirement.minimumDecisiveAccuracy)
    && Number(targeted.decisiveAccuracyInterval?.lowerBound)
      > Number(targetedRequirement.minimumDecisiveAccuracyLowerBound);
  const naturalTail = natural.populationRegretTailRiskConfidence || {};
  const naturalSufficient = naturalProvenanceValid
    && Number(natural.comparisons)
      >= Number(naturalRequirement.minimumComparisons)
    && Number(natural.contributingGames)
      >= Number(naturalRequirement.minimumContributingGames)
    && naturalRiskAssessmentSufficient(natural, naturalRequirement)
    && validFormalPopulationRiskBounds(natural);
  const naturalPass = naturalSufficient
    && Number(natural.populationRegretConfidenceUpperBound)
      <= Number(naturalRequirement.maximumPopulationRegretUpperBound)
    && Number(naturalTail.aboveThreePercentRate?.upperBound)
      <= Number(naturalRequirement.maximumThreePercentLossRate)
    && Number(naturalTail.aboveFivePercentRate?.upperBound)
      <= Number(naturalRequirement.maximumFivePercentLossRate)
    && Number(naturalTail.worstTenPercentCvar?.upperBound)
      <= Number(naturalRequirement.maximumWorstTenPercentCvar);
  const targetedOptimisticUpper = Number(
    targeted.decisiveAccuracyInterval?.upperBound
  );
  const targetedCouldPass = !targetedSufficient
    || !Number.isFinite(targetedOptimisticUpper)
    || targetedOptimisticUpper
      >= Number(targetedRequirement.minimumDecisiveAccuracy);
  const naturalCouldPass = !naturalSufficient
    || naturalPass
    || Number(natural.riskAssessmentCoverage) < 1
    || naturalRiskOptimisticLowerBoundsCouldPass(
      natural,
      naturalRequirement
    );
  return {
    passes: targetedPass && naturalPass,
    couldPass: targetedCouldPass && naturalCouldPass,
    targetedSufficient,
    naturalSufficient,
    targetedPass,
    naturalPass,
    targetedCouldPass,
    naturalCouldPass,
    targetedContributingGames: Number(targeted.contributingGames) || 0,
    naturalComparisons: Number(natural.comparisons) || 0,
    naturalContributingGames: Number(natural.contributingGames) || 0,
    naturalRiskAssessedComparisons:
      Number(natural.riskAssessedComparisons) || 0,
    naturalRiskAssessedContributingGames:
      Number(natural.riskAssessedContributingGames) || 0,
    naturalRiskAssessmentCoverage:
      Number(natural.riskAssessmentCoverage) || 0,
    naturalUnavailableComparisons:
      Number(natural.unavailableComparisons) || 0,
    binaryAccuracyRole: phaseBand
      ? phasePolicy.binaryAccuracyRole || null
      : "screening-only"
  };
}

function naturalRiskAssessmentSufficient(summary, requirement) {
  return Number(summary?.riskAssessedComparisons)
      >= Number(requirement?.minimumRiskAssessedComparisons)
    && Number(summary?.riskAssessedContributingGames)
      >= Number(requirement?.minimumRiskAssessedGames)
    && Number(summary?.riskAssessmentCoverage)
      >= Number(requirement?.minimumRiskAssessmentCoverage);
}

function naturalRiskOptimisticLowerBoundsCouldPass(summary, requirement) {
  const bootstrap = summary?.populationRiskBootstrap || {};
  const comparisons = [
    [bootstrap.meanRegret,
      requirement.maximumPopulationRegretUpperBound],
    [bootstrap.aboveThreePercentRate,
      requirement.maximumThreePercentLossRate],
    [bootstrap.aboveFivePercentRate,
      requirement.maximumFivePercentLossRate],
    [bootstrap.worstTenPercentCvar,
      requirement.maximumWorstTenPercentCvar]
  ];
  // Missing lower bounds mean uncertainty, not proof of failure. More data is
  // futile only when even an optimistic bound is already beyond its limit.
  return comparisons.every(([interval, maximum]) => {
    const lower = Number(interval?.lowerBound);
    const point = Number(interval?.pointEstimate);
    const upper = Number(interval?.upperBound);
    const threshold = Number(maximum);
    const coherent = Number.isFinite(lower)
      && Number.isFinite(point)
      && Number.isFinite(upper)
      && lower >= 0
      && lower <= point
      && point <= upper;
    return !coherent
      || !Number.isFinite(threshold)
      || lower <= threshold;
  });
}

function shadowBootstrapAccuracyLowerBound(summary = {}) {
  for (const value of [
    summary?.accuracyInterval?.bootstrapLowerBound,
    summary?.accuracyInterval?.lowerBound,
    summary?.accuracyLowerBound
  ]) {
    if (value == null) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function finiteAverage(values = []) {
  const finite = values.filter((value) => value != null
      && Number.isFinite(Number(value)))
    .map(Number);
  return finite.length
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : 0;
}

export function policyQShadowSelectionSignal(
  leafValueRanking = {},
  requirements = POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements
) {
  const effect = leafValueRanking?.actionEffectRanking || {};
  const targeted = effect.targetedDecisiveAudit || {};
  const natural = effect.naturalDistributionAudit || {};
  const overallNatural = requirements.regretAlternative || {};
  const phaseNatural = requirements.phaseActionEffect?.natural || {};
  const groups = [
    { targeted, natural, naturalRequirement: overallNatural },
    ...EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => ({
      targeted: targeted.phaseBands?.[phase] || {},
      natural: natural.phaseBands?.[phase] || {},
      naturalRequirement: phaseNatural
    }))
  ];
  const targetedLowerBounds = groups.map((group) =>
    Number(group.targeted.decisiveAccuracyInterval?.lowerBound));
  const naturalSafetyMargins = groups.map((group) => {
    const tail = group.natural.populationRegretTailRiskConfidence || {};
    const pairs = [
      [group.natural.populationRegretConfidenceUpperBound,
        group.naturalRequirement.maximumPopulationRegretUpperBound],
      [tail.aboveThreePercentRate?.upperBound,
        group.naturalRequirement.maximumThreePercentLossRate],
      [tail.aboveFivePercentRate?.upperBound,
        group.naturalRequirement.maximumFivePercentLossRate],
      [tail.worstTenPercentCvar?.upperBound,
        group.naturalRequirement.maximumWorstTenPercentCvar]
    ];
    if (!pairs.every(([value, maximum]) =>
      Number.isFinite(Number(value))
        && Number.isFinite(Number(maximum))
        && Number(maximum) > 0)) return Number.NaN;
    return Math.min(...pairs.map(([value, maximum]) =>
      Math.max(-1, Math.min(1,
        (Number(maximum) - Number(value)) / Number(maximum)))));
  });
  const actionEffectStatuses = [
    policyQShadowActionEffectStatus(effect, null, requirements),
    ...EVALUATOR_AUDIT_PHASE_BANDS.map((phase) =>
      policyQShadowActionEffectStatus(effect, phase, requirements))
  ];
  const actionEffectComplete = effect.contract
      === requirements.regretAlternative?.contract
    && actionEffectStatuses.every((status) =>
      status.targetedSufficient && status.naturalSufficient)
    && targetedLowerBounds.every(Number.isFinite)
    && naturalSafetyMargins.every(Number.isFinite);
  const worstTargetedLowerBound = actionEffectComplete
    ? Math.min(...targetedLowerBounds) : -1;
  const worstNaturalSafetyMargin = actionEffectComplete
    ? Math.min(...naturalSafetyMargins) : -1;
  const phaseBinaryBounds = Object.fromEntries(
    EVALUATOR_AUDIT_PHASE_BANDS.map((phase) => [
      phase,
      shadowBootstrapAccuracyLowerBound(
        leafValueRanking.phaseBands?.[phase] || {}
      )
    ])
  );
  const screeningBinaryReference = finiteAverage(
    EVALUATOR_AUDIT_PHASE_BANDS
      .filter((phase) => requirements.phasePolicies?.[phase]
        ?.binaryAccuracyRole === "screening-only")
      .map((phase) => phaseBinaryBounds[phase])
  );
  const supportingBinaryReference = finiteAverage(
    EVALUATOR_AUDIT_PHASE_BANDS
      .filter((phase) => requirements.phasePolicies?.[phase]
        ?.binaryAccuracyRole === "supporting")
      .map((phase) => phaseBinaryBounds[phase])
  );
  const overallBinaryReference =
    shadowBootstrapAccuracyLowerBound(leafValueRanking) || 0;
  // Action-effect evidence defines Policy-Q selection. Binary ranking remains
  // a low-weight diagnostic, especially in noisy opening phases.
  const primaryScore = worstTargetedLowerBound * 5_000
    + worstNaturalSafetyMargin * 5_000;
  const binaryReferenceScore = screeningBinaryReference * 25
    + supportingBinaryReference * 100
    + overallBinaryReference * 100;
  return {
    contract: POLICY_Q_SHADOW_READINESS_CONTRACT,
    actionEffectComplete,
    worstTargetedLowerBound,
    worstNaturalSafetyMargin,
    screeningBinaryReference,
    supportingBinaryReference,
    overallBinaryReference,
    primaryScore,
    binaryReferenceScore,
    score: primaryScore + binaryReferenceScore
  };
}

function emptyShadowActionEffectStatus(reason) {
  return {
    passes: false,
    couldPass: true,
    targetedSufficient: false,
    naturalSufficient: false,
    targetedPass: false,
    naturalPass: false,
    targetedCouldPass: true,
    naturalCouldPass: true,
    targetedContributingGames: 0,
    naturalComparisons: 0,
    naturalContributingGames: 0,
    naturalRiskAssessedComparisons: 0,
    naturalRiskAssessedContributingGames: 0,
    naturalRiskAssessmentCoverage: 0,
    naturalUnavailableComparisons: 0,
    reason
  };
}

export function policyQFormalAuditStatus(
  leafValueRanking = {},
  requirements = POLICY_Q_FORMAL_AUDIT_REQUIREMENTS,
  context = {}
) {
  const reasons = [];
  const expectedDeckSeats = [...new Set(
    (context.expectedDeckSeats || []).map(String).filter(Boolean)
  )].sort();
  const expectedDeckSeatPhases = [...new Set(
    (context.expectedDeckSeatPhases || []).map(String).filter(Boolean)
  )].sort();
  const opportunityContract = String(
    context.deckSeatPhaseOpportunityContract || ""
  );
  const expectedDeckSeatSet = new Set(expectedDeckSeats);
  const opportunityContractValid = opportunityContract
      === "training-deck-seat-cartesian-v1"
    && expectedDeckSeats.length > 0
    && expectedDeckSeatPhases.length > 0
    && expectedDeckSeatPhases.every((key) => {
      const parsed = parseDeckSeatPhase(key);
      return parsed && expectedDeckSeatSet.has(parsed.deckSeat);
    });
  if (!opportunityContractValid) {
    reasons.push("policy-q-formal-deck-seat-phase-opportunity-contract");
  }
  const effect = leafValueRanking?.actionEffectRanking || {};
  if (effect.contract !== requirements.actionEffectContract) {
    reasons.push("policy-q-formal-action-effect-contract");
    return {
      version: 1,
      contract: requirements.contract,
      eligible: false,
      reasons
    };
  }
  const targeted = effect.targetedDecisiveAudit || {};
  const natural = effect.naturalDistributionAudit || {};
  requireTargetedDecisiveAudit(
    targeted,
    requirements.targeted,
    reasons,
    requirements.phasePolicies
  );
  requireNaturalRegretAudit(
    natural,
    requirements.natural,
    reasons,
    expectedDeckSeats,
    expectedDeckSeatPhases,
    requirements.phasePolicies
  );
  return {
    version: 1,
    contract: requirements.contract,
    eligible: reasons.length === 0,
    reasons,
    deckSeatPhaseOpportunityContract: opportunityContract,
    expectedDeckSeats,
    expectedDeckSeatPhases,
    targetedDecisiveAudit: targeted,
    naturalDistributionAudit: natural
  };
}

function requireTargetedDecisiveAudit(
  summary,
  requirement,
  reasons,
  phasePolicies = PHASE_POLICY_Q_REQUIREMENTS
) {
  if (summary.auditDistribution !== "teacher-selected-targeted"
    || summary.samplingContract
      !== "teacher-selected-policy-decision-pair-v1"
    || summary.provenanceValidated !== true
    || Number(summary.comparisons) < requirement.minimumComparisons
    || Number(summary.contributingGames) < requirement.minimumContributingGames) {
    reasons.push("policy-q-targeted-audit-insufficient");
  }
  if (!Number.isFinite(Number(summary.decisiveCoverage))
    || !(Number(summary.decisiveCoverage)
    >= requirement.minimumDecisiveCoverage)) {
    reasons.push("policy-q-targeted-decisive-coverage");
  }
  if (!Number.isFinite(Number(summary.decisiveAccuracy))
    || !Number.isFinite(Number(summary.decisiveAccuracyInterval?.lowerBound))
    || !(Number(summary.decisiveAccuracy)
    >= requirement.minimumDecisiveAccuracy)
    || !(Number(summary.decisiveAccuracyInterval?.lowerBound)
      > requirement.minimumDecisiveAccuracyLowerBound)
    || !confidenceIntervalWidthAtMost(
      summary.decisiveAccuracyInterval,
      requirement.maximumDecisiveAccuracyIntervalWidth
    )) {
    reasons.push("policy-q-targeted-decisive-accuracy");
  }
  for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
    const policy = phasePolicies?.[phase] || {};
    const item = summary.phaseBands?.[phase] || {};
    if (Number(item.comparisons) < requirement.minimumPhaseComparisons
      || Number(item.contributingGames)
        < requirement.minimumPhaseContributingGames) {
      reasons.push(`policy-q-targeted-phase-insufficient-${phase}`);
    } else {
      const decisiveGames = Number(
        item.decisiveAccuracyInterval?.contributingGames
      );
      if (Number(item.decisive)
          < requirement.minimumPhaseDecisiveComparisons
        || decisiveGames < requirement.minimumPhaseDecisiveGames) {
        reasons.push(`policy-q-targeted-phase-decisive-insufficient-${phase}`);
      } else if (!(Number(item.decisiveAccuracy)
          >= requirement.minimumPhaseDecisiveAccuracy)
        || !(Number(item.decisiveAccuracyInterval?.lowerBound)
          > requirement.minimumPhaseDecisiveAccuracyLowerBound)
        || !confidenceIntervalWidthAtMost(
          item.decisiveAccuracyInterval,
          requirement.maximumPhaseDecisiveAccuracyIntervalWidth
        )) {
        reasons.push(`policy-q-targeted-phase-accuracy-${phase}`);
      }
    }
    if (policy.requireDecisiveAccuracy !== true) {
      reasons.push(`policy-q-targeted-phase-contract-${phase}`);
    }
    if (policy.preferTerminalEvidence === true
      && summary.evidenceSource !== "paired-terminal-outcome-pairs-v1") {
      reasons.push(`policy-q-targeted-phase-terminal-evidence-${phase}`);
    }
  }
}

function requireNaturalRegretAudit(
  summary,
  requirement,
  reasons,
  expectedDeckSeats = [],
  expectedDeckSeatPhases = [],
  phasePolicies = PHASE_POLICY_Q_REQUIREMENTS
) {
  if (summary.auditDistribution !== "natural-policy-decision-pairs"
    || summary.samplingContract
      !== "hash-priority-reservoir-policy-decision-v1"
    || summary.provenanceValidated !== true
    || summary.populationEstimand
      !== "ipw-per-decision-natural-policy-decision-pairs-v2"
    || summary.populationRiskBootstrap?.method
      !== "game-cluster-percentile-bootstrap-ipw-per-decision-v2"
    || summary.populationRiskBootstrap?.estimand !== "per-decision"
    || summary.populationRiskBootstrap?.weighting
      !== "inverse-propensity-per-decision-v1"
    || summary.populationRiskBootstrap?.version !== 2
    || Number(summary.populationRiskBootstrap?.samples) < 500
    || Number(summary.populationRiskBootstrap?.contributingGames)
      !== Number(summary.contributingGames)
    || Number(summary.populationRiskBootstrap?.decisions)
      !== Number(summary.comparisons)
    || !(Number(summary.populationRiskBootstrap?.totalPopulationWeight) > 0)
    || !(Number(summary.populationRiskBootstrap?.maximumSampleWeight) >= 1)
    || !validFormalPopulationRiskBounds(summary)
    || Number(summary.comparisons) < requirement.minimumComparisons
    || Number(summary.contributingGames) < requirement.minimumContributingGames
    || !naturalRiskAssessmentSufficient(summary, requirement)) {
    reasons.push("policy-q-natural-audit-insufficient");
    return;
  }
  const tail = summary.populationRegretTailRiskConfidence || {};
  if (!Number.isFinite(Number(summary.populationRegretConfidenceUpperBound))
    || !(Number(summary.populationRegretConfidenceUpperBound)
    <= requirement.maximumPopulationRegretUpperBound)) {
    reasons.push("policy-q-natural-population-regret");
  }
  const tailUpper = {
    aboveThreePercentRate: tail.aboveThreePercentRate?.upperBound,
    aboveFivePercentRate: tail.aboveFivePercentRate?.upperBound,
    worstTenPercentCvar: tail.worstTenPercentCvar?.upperBound
  };
  if (!Object.values(tailUpper).every((value) => value != null
      && Number.isFinite(Number(value)))
    || !(Number(tailUpper.aboveThreePercentRate)
      <= requirement.maximumThreePercentLossRate)
    || !(Number(tailUpper.aboveFivePercentRate)
      <= requirement.maximumFivePercentLossRate)
    || !(Number(tailUpper.worstTenPercentCvar)
      <= requirement.maximumWorstTenPercentCvar)) {
    reasons.push("policy-q-natural-tail-risk");
  }
  if (!formalPopulationRiskPrecisionSufficient(summary, {
    maximumPopulationRegretIntervalWidth:
      requirement.maximumPopulationRegretIntervalWidth,
    maximumLossRateIntervalWidth:
      requirement.maximumLossRateIntervalWidth,
    maximumWorstTenPercentCvarIntervalWidth:
      requirement.maximumWorstTenPercentCvarIntervalWidth
  })) {
    reasons.push("policy-q-natural-confidence-precision");
  }
  for (const [kind, strata] of [
    ["phase", summary.phaseBands],
    ["deck-seat", summary.deckSeats],
    ["deck-seat-phase", summary.deckSeatPhases]
  ]) {
    const safetyRequirement = naturalSafetyRequirementForKind(
      requirement,
      kind
    );
    for (const [key, item] of Object.entries(strata || {})) {
      if (Number(item.comparisons)
          < safetyRequirement.minimumComparisons
        || Number(item.contributingGames)
          < safetyRequirement.minimumGames
        || !naturalRiskAssessmentSufficient(item, safetyRequirement)) {
        reasons.push(`policy-q-natural-${kind}-insufficient-${key}`);
      } else {
        const itemTail = item.populationRegretTailRiskConfidence || {};
        if (!validFormalPopulationRiskBounds(item)
          || !(Number(item.populationRegretConfidenceUpperBound)
            <= requirement.maximumStratumPopulationRegretUpperBound)) {
          reasons.push(`policy-q-natural-${kind}-regret-${key}`);
        }
        if (!(Number(itemTail.aboveThreePercentRate?.upperBound)
            <= requirement.maximumStratumThreePercentLossRate)
          || !(Number(itemTail.aboveFivePercentRate?.upperBound)
            <= requirement.maximumStratumFivePercentLossRate)
          || !(Number(itemTail.worstTenPercentCvar?.upperBound)
            <= requirement.maximumStratumWorstTenPercentCvar)) {
          reasons.push(`policy-q-natural-${kind}-tail-risk-${key}`);
        }
        if (!formalPopulationRiskPrecisionSufficient(item, {
          maximumPopulationRegretIntervalWidth:
            requirement.maximumStratumPopulationRegretIntervalWidth,
          maximumLossRateIntervalWidth:
            requirement.maximumStratumLossRateIntervalWidth,
          maximumWorstTenPercentCvarIntervalWidth:
            requirement.maximumStratumWorstTenPercentCvarIntervalWidth
        })) {
          reasons.push(`policy-q-natural-${kind}-precision-${key}`);
        }
      }
    }
  }
  for (const phase of EVALUATOR_AUDIT_PHASE_BANDS) {
    const policy = phasePolicies?.[phase] || {};
    if (!summary.phaseBands?.[phase]) {
      reasons.push(`policy-q-natural-phase-missing-${phase}`);
    }
    if (policy.requireNaturalRegret !== true
      || policy.requireTailRisk !== true) {
      reasons.push(`policy-q-natural-phase-contract-${phase}`);
    }
    if (policy.preferTerminalEvidence === true
      && summary.evidenceSource !== "paired-terminal-outcome-pairs-v1") {
      reasons.push(`policy-q-natural-phase-terminal-evidence-${phase}`);
    }
  }
  for (const key of expectedDeckSeats) {
    if (!summary.deckSeats?.[key]) {
      reasons.push(`policy-q-natural-deck-seat-missing-${key}`);
    }
  }
  for (const key of expectedDeckSeatPhases) {
    if (!summary.deckSeatPhases?.[key]) {
      reasons.push(`policy-q-natural-deck-seat-phase-missing-${key}`);
    }
  }
}

function naturalSafetyRequirementForKind(requirement, kind) {
  if (kind === "phase") {
    return {
      minimumComparisons: requirement.minimumPhaseSafetyComparisons,
      minimumGames: requirement.minimumPhaseSafetyGames,
      minimumRiskAssessedComparisons:
        requirement.minimumPhaseRiskAssessedComparisons,
      minimumRiskAssessedGames:
        requirement.minimumPhaseRiskAssessedGames,
      minimumRiskAssessmentCoverage:
        requirement.minimumPhaseRiskAssessmentCoverage
    };
  }
  if (kind === "deck-seat") {
    return {
      minimumComparisons: requirement.minimumDeckSeatSafetyComparisons,
      minimumGames: requirement.minimumDeckSeatSafetyGames,
      minimumRiskAssessedComparisons:
        requirement.minimumDeckSeatRiskAssessedComparisons,
      minimumRiskAssessedGames:
        requirement.minimumDeckSeatRiskAssessedGames,
      minimumRiskAssessmentCoverage:
        requirement.minimumDeckSeatRiskAssessmentCoverage
    };
  }
  return {
    minimumComparisons: requirement.minimumDeckSeatPhaseSafetyComparisons,
    minimumGames: requirement.minimumDeckSeatPhaseSafetyGames,
    minimumRiskAssessedComparisons:
      requirement.minimumDeckSeatPhaseRiskAssessedComparisons,
    minimumRiskAssessedGames:
      requirement.minimumDeckSeatPhaseRiskAssessedGames,
    minimumRiskAssessmentCoverage:
      requirement.minimumDeckSeatPhaseRiskAssessmentCoverage
  };
}

function confidenceIntervalWidthAtMost(interval, maximumWidth) {
  const lower = Number(interval?.lowerBound);
  const upper = Number(interval?.upperBound);
  const limit = Number(maximumWidth);
  return Number.isFinite(lower)
    && Number.isFinite(upper)
    && Number.isFinite(limit)
    && upper >= lower
    && upper - lower <= limit + 1e-12;
}

function formalPopulationRiskPrecisionSufficient(summary, requirement) {
  const bootstrap = summary?.populationRiskBootstrap || {};
  return confidenceIntervalWidthAtMost(
    bootstrap.meanRegret,
    requirement.maximumPopulationRegretIntervalWidth
  ) && confidenceIntervalWidthAtMost(
    bootstrap.aboveThreePercentRate,
    requirement.maximumLossRateIntervalWidth
  ) && confidenceIntervalWidthAtMost(
    bootstrap.aboveFivePercentRate,
    requirement.maximumLossRateIntervalWidth
  ) && confidenceIntervalWidthAtMost(
    bootstrap.worstTenPercentCvar,
    requirement.maximumWorstTenPercentCvarIntervalWidth
  );
}

function validFormalPopulationRiskBounds(summary) {
  const bootstrap = summary.populationRiskBootstrap || {};
  const meanInterval = bootstrap.meanRegret || {};
  const tailIntervals = [
    bootstrap.aboveThreePercentRate,
    bootstrap.aboveFivePercentRate
  ];
  const validInterval = (interval, requireClopperPearson = false) => {
    const values = [
      interval?.pointEstimate,
      interval?.percentileUpperBound,
      interval?.concentrationUpperBound,
      interval?.upperBound
    ];
    if (requireClopperPearson) {
      values.push(interval?.clusterClopperPearsonUpperBound);
    }
    if (!values.every((value) => value != null
      && Number.isFinite(Number(value)))) return false;
    const expectedUpper = Math.max(
      Number(interval.percentileUpperBound),
      Number(interval.concentrationUpperBound),
      requireClopperPearson
        ? Number(interval.clusterClopperPearsonUpperBound) : 0
    );
    return Math.abs(Number(interval.upperBound) - expectedUpper) <= 1e-12;
  };
  const cvarInterval = bootstrap.worstTenPercentCvar || {};
  const cvarCorrection = bootstrap.cvarConcentration || {};
  const zeroLossCorrection = cvarCorrection.method
    === "zero-loss-cluster-clopper-pearson-v1";
  const magnitudeCorrection = cvarCorrection.method
    === "game-cluster-bonferroni-cvar-excess-bernstein-v1";
  const validCvarCorrection = zeroLossCorrection
    ? Array.isArray(cvarCorrection.thresholds)
      && cvarCorrection.thresholds.length === 0
      && Number.isFinite(Number(cvarCorrection.positiveClusterUpperBound))
      && Number.isFinite(Number(cvarCorrection.upperBound))
      && Number(cvarInterval.clusterClopperPearsonUpperBound)
        === Number(cvarCorrection.positiveClusterUpperBound)
      && Math.abs(
        Number(cvarCorrection.upperBound) - Math.min(
          1,
          Number(cvarCorrection.positiveClusterUpperBound) / 0.1
        )
      ) <= 1e-12
    : magnitudeCorrection
      && Number(cvarCorrection.tailFraction) === 0.1
      && Number(cvarCorrection.familywiseAlpha) === 0.05
      && Array.isArray(cvarCorrection.thresholds)
      && cvarCorrection.thresholds.length > 0
      && Number(cvarCorrection.thresholdAlpha)
        === Number(cvarCorrection.familywiseAlpha)
          / cvarCorrection.thresholds.length
      && cvarCorrection.thresholds.every((candidate) =>
        [candidate?.threshold, candidate?.excessMean,
          candidate?.excessUpperBound, candidate?.cvarUpperBound]
          .every((value) => Number.isFinite(Number(value))))
      && cvarCorrection.thresholds.some((candidate) =>
        Number(candidate.threshold) === Number(cvarCorrection.selectedThreshold)
          && Number(candidate.cvarUpperBound)
            === Number(cvarCorrection.upperBound))
      && cvarInterval.clusterClopperPearsonUpperBound == null;
  return validInterval(meanInterval)
    && tailIntervals.every((interval) => validInterval(interval, true))
    && validInterval(cvarInterval, zeroLossCorrection)
    && validCvarCorrection
    && Number(cvarInterval.concentrationUpperBound)
      === Number(cvarCorrection.upperBound)
    && Number(summary.populationRegretConfidenceUpperBound)
      === Number(meanInterval.upperBound)
    && Number(summary.populationRegretTailRiskConfidence
      ?.aboveThreePercentRate?.upperBound)
      === Number(bootstrap.aboveThreePercentRate?.upperBound)
    && Number(summary.populationRegretTailRiskConfidence
      ?.aboveFivePercentRate?.upperBound)
      === Number(bootstrap.aboveFivePercentRate?.upperBound)
    && Number(summary.populationRegretTailRiskConfidence
      ?.worstTenPercentCvar?.upperBound)
      === Number(bootstrap.worstTenPercentCvar?.upperBound);
}

export function policyQShadowRegretAlternativePasses(
  summary = {},
  requirements = POLICY_Q_SHADOW_READINESS_GRID.performanceRequirements
    .regretAlternative
) {
  if (!requirements || summary?.regretGateEligible !== true) return false;
  if (summary?.contract !== requirements.contract) return false;
  const populationTail = summary.populationRegretTailRisk || {};
  const requiredValues = [
    summary.comparisons,
    summary.decisiveCoverage,
    summary.classifiedCoverage,
    summary.decisiveAccuracy,
    summary.decisiveAccuracyInterval?.lowerBound,
    summary.observedClassificationRegret,
    summary.observedClassificationRegretInterval?.upperBound,
    summary.populationRegretUpperBound,
    populationTail.aboveThreePercentRate,
    populationTail.aboveFivePercentRate,
    populationTail.worstTenPercentCvar
  ];
  if (requiredValues.some((value) => value == null
    || !Number.isFinite(Number(value)))) return false;
  return Number(summary.comparisons) >= Number(requirements.minimumComparisons)
    && Number(summary.decisiveCoverage)
      >= Number(requirements.minimumDecisiveCoverage)
    && Number(summary.classifiedCoverage)
      >= Number(requirements.minimumClassifiedCoverage)
    && Number(summary.decisiveAccuracy)
      >= Number(requirements.minimumDecisiveAccuracy)
    && Number(summary.decisiveAccuracyInterval?.lowerBound)
      > Number(requirements.minimumDecisiveAccuracyLowerBound)
    && Number(summary.observedClassificationRegret)
      <= Number(requirements.maximumObservedClassificationRegret)
    && Number(summary.observedClassificationRegretInterval?.upperBound)
      <= Number(
        requirements.maximumObservedClassificationRegretUpperBound
      )
    && Number(summary.populationRegretUpperBound)
      <= Number(requirements.maximumPopulationRegretUpperBound)
    && Number(populationTail.aboveThreePercentRate)
      <= Number(requirements.maximumThreePercentLossRate)
    && Number(populationTail.aboveFivePercentRate)
      <= Number(requirements.maximumFivePercentLossRate)
    && Number(populationTail.worstTenPercentCvar)
      <= Number(requirements.maximumWorstTenPercentCvar);
}

function policyQShadowRegretAlternativeCouldPass(summary = {}, requirements) {
  if (!requirements || summary?.regretGateEligible !== true) return false;
  if (summary?.contract !== requirements.contract) return false;
  const optimisticAccuracy = Number(
    summary.decisiveAccuracyInterval?.upperBound
  );
  const optimisticRegret = Number(
    summary.observedClassificationRegretInterval?.lowerBound
  );
  const populationRegretUpperBound = Number(
    summary.populationRegretUpperBound
  );
  return Number(summary.comparisons) >= Number(requirements.minimumComparisons)
    && Number(summary.decisiveCoverage)
      >= Number(requirements.minimumDecisiveCoverage)
    && Number(summary.classifiedCoverage)
      >= Number(requirements.minimumClassifiedCoverage)
    && Number.isFinite(optimisticAccuracy)
    && optimisticAccuracy >= Number(requirements.minimumDecisiveAccuracy)
    && Number.isFinite(optimisticRegret)
    && optimisticRegret <= Number(
      requirements.maximumObservedClassificationRegret
    )
    && Number.isFinite(populationRegretUpperBound)
    && populationRegretUpperBound
      <= Number(requirements.maximumPopulationRegretUpperBound);
}

function shadowOptimisticAccuracyBound(summary = {}) {
  const values = [
    summary?.accuracyUpperBound,
    summary?.accuracyInterval?.upperBound,
    summary?.accuracyInterval?.bootstrapUpperBound,
    summary?.accuracyInterval?.weightedHoeffdingUpperBound,
    shadowBootstrapAccuracyBound(summary, "upper")
  ].filter((value) => value != null)
    .map(Number).filter(Number.isFinite);
  return values.length ? Math.max(...values) : Number.POSITIVE_INFINITY;
}

function shadowBootstrapAccuracyBound(summary = {}, side = "lower") {
  const directValue = summary?.accuracyInterval?.[
    side === "upper" ? "bootstrapUpperBound" : "bootstrapLowerBound"
  ];
  const direct = directValue == null ? Number.NaN : Number(directValue);
  if (Number.isFinite(direct)) return direct;
  const advantageValue = summary?.bootstrap?.[
    side === "upper" ? "upperBound" : "lowerBound"
  ];
  const advantage = advantageValue == null
    ? Number.NaN
    : Number(advantageValue);
  return Number.isFinite(advantage) ? 0.5 + advantage : null;
}

function shadowEffectiveGames(summary = {}) {
  const value = Number(summary?.accuracyInterval?.effectiveGames);
  if (Number.isFinite(value) && value > 0) return value;
  return Number(summary?.contributingGames) || 0;
}

function parseDeckSeatPhase(key) {
  const match = String(key || "").match(/^(.*:p[12])::(mulligan|early|mid|late)$/);
  if (!match) return null;
  return { deckSeat: match[1], phaseBand: match[2] };
}

function candidateScore(candidate) {
  const value = Number(candidate?.selectionScore);
  return Number.isFinite(value) ? value : -Infinity;
}

function medianCandidateScore(candidates) {
  const scores = (candidates || []).map(candidateScore)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!scores.length) return -Infinity;
  return scores[Math.floor((scores.length - 1) / 2)];
}

function medianFinite(items = []) {
  const values = items.filter((value) => value != null)
    .map(Number).filter(Number.isFinite)
    .sort((left, right) => left - right);
  return values.length ? values[Math.floor((values.length - 1) / 2)] : null;
}

function minimumFinite(items = []) {
  const values = items.filter((value) => value != null)
    .map(Number).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
