import {
  actionRankingAuditEvidenceGrade,
  validActionRankingAuditReference,
  validActionRankingReference,
  validIndependentLeafValueReference,
  validLeafValueReference
} from "../src/ai/neural/action-ranking-reference.mjs";
import {
  ACTION_EVIDENCE_GRADES,
  assessActionEvidence,
  actionEvidenceProtocolCoversPhase,
  summarizeActionEvidenceEfficiency,
  summarizeNaturalDistributionActionAudit
} from "../src/ai/neural/evidence-protocol.mjs";
import {
  EVALUATOR_AUDIT_STRATUM_VERSION,
  normalizeEvaluatorAuditStratum
} from "../src/ai/neural/audit-strata.mjs";
import { validPublicStructuredEvidenceSnapshot } from "../src/ai/neural/structured-evidence.mjs";
import { pairedBinaryDifferenceInterval } from "../src/ai/neural/paired-action-effect-statistics.mjs";

// v16 rebuilds derived action-effect assessments from the preserved raw
// outcome pairs using the paired finite-sample interval contract.
export const EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION = 17;

export function createEvaluatorBootstrapResultIndex(result) {
  const summaries = result?.summaries || [];
  const valid = summaries.length > 0
    && summaries.every((summary) =>
      summary.completed === true
        && summary.invalid !== true
        && summary.naturallyCompleted !== false);
  const gameCoverage = {};
  const actionReferenceCoverage = {};
  const leafValueCoverage = {};
  const actionReferencePhaseCoverage = {};
  const actionReferenceActionClassCoverage = {};
  const actionReferenceDeckPhaseCoverage = {};
  const leafValuePhaseCoverage = {};
  const leafValueDeckPhaseCoverage = {};
  const structuredV2ActionReferenceCoverage = {};
  const structuredV2ActionReferencePhaseCoverage = {};
  const structuredV2ActionReferenceActionClassCoverage = {};
  const structuredV2ActionReferenceDeckPhaseCoverage = {};
  const structuredV2LeafValueCoverage = {};
  const structuredV2LeafValuePhaseCoverage = {};
  const structuredV2LeafValueDeckPhaseCoverage = {};
  const actionReferenceIdentities = [];
  const structuredV2ActionReferenceIdentities = [];
  const seenActionReferences = new Set();
  const actionEvidenceGradeCounts = {};
  const actionEvidenceStatisticalStrengthCounts = {};
  const actionEvidenceContinuationScopeCounts = {};
  const actionEvidenceDispositionCounts = {};
  const actionEvidenceProvenanceStatusCounts = {};
  const actionEvidencePairwiseRegret = createPairwiseRegretAccumulator();
  const actionEvidenceOpeningStatesByGrade = {};
  const naturalDistributionItems = [];
  const naturalDistributionSeen = new Set();
  const leafActionEffectAudit = createLeafActionEffectAuditAccumulator();
  const seenLeafActionEffects = new Set();
  const actionAuditCompute = {
    cpuMilliseconds: 0,
    gpuMilliseconds: 0,
    wallMilliseconds: 0
  };
  let leafValuePairCount = 0;
  let structuredV2LeafValuePairCount = 0;
  let diagnosticPairedSeedsCompleted = 0;
  const actionAuditRacing = {
    discovered: 0,
    pilotAttempted: 0,
    expandedTo16: 0,
    expandedTo32: 0,
    finalAttempted: 0,
    pairedSeedsCompleted: 0,
    teacherQueries: 0,
    candidatePoolChanges: 0,
    queriesSuppressed: 0,
    references: 0
  };
  const physicalSummaries = summaries.flatMap(physicalGameSummaries);

  for (const summary of physicalSummaries) {
    actionAuditRacing.discovered +=
      Number(summary.teacherActionAuditCandidatesDiscovered) || 0;
    actionAuditRacing.pilotAttempted +=
      Number(summary.teacherActionAuditAttempts) || 0;
    actionAuditRacing.expandedTo16 +=
      Number(summary.teacherActionAuditCandidatesExpandedTo16) || 0;
    actionAuditRacing.expandedTo32 +=
      Number(summary.teacherActionAuditCandidatesExpandedTo32) || 0;
    actionAuditRacing.finalAttempted +=
      Number(summary.teacherActionAuditFinalCandidates) || 0;
    actionAuditRacing.pairedSeedsCompleted +=
      Number(summary.teacherActionAuditPairedSeedsCompleted) || 0;
    actionAuditRacing.teacherQueries +=
      Number(summary.teacherQueries) || 0;
    actionAuditRacing.candidatePoolChanges +=
      Number(summary.teacherActionAuditCandidatePoolChanges) || 0;
    actionAuditRacing.queriesSuppressed +=
      Number(summary.teacherActionAuditQueriesSuppressed) || 0;
    actionAuditRacing.references +=
      Number(summary.teacherActionAuditReferences) || 0;
  }

  for (const trajectory of result?.trajectories || []) {
    const coverageKey = `${trajectory.deckId || "unknown"}:${normalizedTrajectorySeat(trajectory)}`;
    gameCoverage[coverageKey] = (gameCoverage[coverageKey] || 0) + 1;
    for (const step of trajectory.steps || []) {
      const diagnostic = step.actionRankingAuditDiagnostic || null;
      if (diagnostic?.computeUsage) {
        accumulateComputeUsage(actionAuditCompute, diagnostic.computeUsage);
      }
      diagnosticPairedSeedsCompleted += pairedSeedsForAuditDiagnostic(
        diagnostic
      );
      const actionReference = evaluatorActionReference(step);
      const actionReferenceIdentity = actionReference
        ? stableActionReferenceIdentity(actionReference)
        : null;
      if (actionReferenceIdentity
        && !seenActionReferences.has(actionReferenceIdentity)) {
        const auditStratum = normalizeEvaluatorAuditStratum({
          stored: actionReference.auditStratum,
          state: step.state,
          recommendedAction:
            actionReference.correctActionKey || step.recommendedActionKey,
          selectedAction:
            actionReference.comparedActionKey || step.selectedActionKey,
          legalActions: step.legalActionKeys,
          deckId: trajectory.deckId,
          seat: normalizedTrajectorySeat(trajectory)
        });
        const evidenceGrade = actionRankingAuditEvidenceGrade(
          actionReference
        );
        const evidenceAssessment = assessActionEvidence(actionReference);
        const inProtocolScope = actionReference.evidenceProtocol
          ? actionEvidenceProtocolCoversPhase(
            actionReference.evidenceProtocol,
            auditStratum.phaseBand
          )
          : ["mulligan", "early"].includes(auditStratum.phaseBand);
        actionEvidenceStatisticalStrengthCounts[
          evidenceAssessment.statisticalStrength
        ] = (actionEvidenceStatisticalStrengthCounts[
          evidenceAssessment.statisticalStrength
        ] || 0) + 1;
        actionEvidenceContinuationScopeCounts[
          evidenceAssessment.continuationScope
        ] = (actionEvidenceContinuationScopeCounts[
          evidenceAssessment.continuationScope
        ] || 0) + 1;
        actionEvidenceDispositionCounts[evidenceAssessment.disposition] =
          (actionEvidenceDispositionCounts[evidenceAssessment.disposition] || 0)
          + 1;
        actionEvidenceProvenanceStatusCounts[
          evidenceAssessment.provenanceStatus
        ] = (actionEvidenceProvenanceStatusCounts[
          evidenceAssessment.provenanceStatus
        ] || 0) + 1;
        accumulatePairwiseRegret(
          actionEvidencePairwiseRegret,
          evidenceAssessment,
          auditStratum.phaseBand
        );
        if (inProtocolScope) {
          actionEvidenceGradeCounts[evidenceGrade] =
            (actionEvidenceGradeCounts[evidenceGrade] || 0) + 1;
          if ([
            ACTION_EVIDENCE_GRADES.terminalRobust,
            ACTION_EVIDENCE_GRADES.continuationConsistent
          ].includes(evidenceGrade)) {
            actionEvidenceOpeningStatesByGrade[evidenceGrade] ||= new Set();
            actionEvidenceOpeningStatesByGrade[evidenceGrade].add(
              actionReference.informationSetHash
            );
          }
        }
        seenActionReferences.add(actionReferenceIdentity);
        actionReferenceIdentities.push({
          identity: actionReferenceIdentity,
          openingStateId: actionReference.informationSetHash,
          deckId: trajectory.deckId || "unknown",
          coverageKey,
          stratumVersion: EVALUATOR_AUDIT_STRATUM_VERSION,
          phaseBand: auditStratum.phaseBand,
          actionClass: auditStratum.actionClass,
          evidenceGrade,
          evidenceAssessment: {
            version: evidenceAssessment.version,
            contract: evidenceAssessment.contract,
            statisticalStrength: evidenceAssessment.statisticalStrength,
            continuationScope: evidenceAssessment.continuationScope,
            disposition: evidenceAssessment.disposition,
            effectEstimate: evidenceAssessment.effectEstimate,
            effectLowerBound: evidenceAssessment.effectLowerBound,
            effectUpperBound: evidenceAssessment.effectUpperBound,
            decisiveEffectThreshold:
              evidenceAssessment.decisiveEffectThreshold,
            observedPairGap: evidenceAssessment.observedPairGap,
            observedPairGapScope: evidenceAssessment.observedPairGapScope,
            pairwiseRegret: evidenceAssessment.pairwiseRegret,
            pairwiseRegretScope: evidenceAssessment.pairwiseRegretScope,
            provenanceStatus: evidenceAssessment.provenanceStatus,
            sampleWeight: evidenceAssessment.sampleWeight,
            policyQTraining:
              evidenceAssessment.authorizedUses.policyQTraining === true,
            formalActionCertification:
              evidenceAssessment.authorizedUses.formalActionCertification
                === true
          },
          inProtocolScope,
          samplingFrame: structuredClone(
            actionReference.samplingFrame || null
          )
        });
        if (actionReferenceHasStructuredV2(
          actionReference,
          step,
          trajectory.engineFingerprint
        )) {
          structuredV2ActionReferenceIdentities.push(
            actionReferenceIdentity
          );
          const deckPhaseKey =
            `${trajectory.deckId || "unknown"}::${auditStratum.phaseBand}`;
          structuredV2ActionReferenceCoverage[coverageKey] =
            (structuredV2ActionReferenceCoverage[coverageKey] || 0) + 1;
          structuredV2ActionReferencePhaseCoverage[auditStratum.phaseBand] =
            (structuredV2ActionReferencePhaseCoverage[auditStratum.phaseBand]
              || 0) + 1;
          structuredV2ActionReferenceActionClassCoverage[
            auditStratum.actionClass
          ] = (structuredV2ActionReferenceActionClassCoverage[
            auditStratum.actionClass
          ] || 0) + 1;
          structuredV2ActionReferenceDeckPhaseCoverage[deckPhaseKey] =
            (structuredV2ActionReferenceDeckPhaseCoverage[deckPhaseKey] || 0)
            + 1;
        }
        actionReferenceCoverage[coverageKey] =
          (actionReferenceCoverage[coverageKey] || 0) + 1;
        actionReferencePhaseCoverage[auditStratum.phaseBand] =
          (actionReferencePhaseCoverage[auditStratum.phaseBand] || 0) + 1;
        actionReferenceActionClassCoverage[auditStratum.actionClass] =
          (actionReferenceActionClassCoverage[auditStratum.actionClass] || 0)
          + 1;
        const deckPhaseKey =
          `${trajectory.deckId || "unknown"}::${auditStratum.phaseBand}`;
        actionReferenceDeckPhaseCoverage[deckPhaseKey] =
          (actionReferenceDeckPhaseCoverage[deckPhaseKey] || 0) + 1;
      }
      const samplingFrame = actionReference?.samplingFrame
        || diagnostic?.samplingFrame
        || step.evidenceSamplingFrame;
      const naturalFrameInScope = samplingFrame?.scope
        === "opening-and-mulligan"
        ? ["mulligan", "early"].includes(
          normalizeEvaluatorAuditStratum({
            stored: actionReference?.auditStratum,
            state: step.state,
            recommendedAction:
              actionReference?.correctActionKey || step.recommendedActionKey,
            selectedAction:
              actionReference?.comparedActionKey || step.selectedActionKey,
            legalActions: step.legalActionKeys,
            deckId: trajectory.deckId,
            seat: normalizedTrajectorySeat(trajectory)
          }).phaseBand
        )
        : true;
      if (samplingFrame?.distribution === "natural-distribution"
        && naturalFrameInScope) {
        const naturalIdentity = actionReferenceIdentity
          || diagnostic?.auditKey
          || `${trajectory.playerId}:${step.informationSetHash}`;
        if (!naturalDistributionSeen.has(naturalIdentity)) {
          naturalDistributionSeen.add(naturalIdentity);
          naturalDistributionItems.push(naturalDistributionAuditItem({
            trajectory,
            step,
            actionReference,
            diagnostic
          }));
        }
      }
      const leafReferences = [
        validIndependentLeafValueReference(step.leafValueAuditReference)
          ? step.leafValueAuditReference
          : null,
        validActionRankingReference(step.actionRankingReference, {
          informationSetHash: step.informationSetHash,
          legalActionKeys: step.legalActionKeys
        })
          ? step.actionRankingReference?.leafValueReference
          : null
      ].filter(validLeafValueReference);
      for (const leafReference of leafReferences) {
        const pairs = leafReference.pairs?.length || 0;
        const auditStratum = normalizeEvaluatorAuditStratum({
          stored: leafReference.auditStratum,
          state: step.state,
          recommendedAction: step.recommendedActionKey,
          selectedAction: step.selectedActionKey,
          legalActions: step.legalActionKeys,
          deckId: trajectory.deckId,
          seat: normalizedTrajectorySeat(trajectory)
        });
        const comparison = leafReference.actionEffectComparison;
        const comparisonIdentity = comparison
          ? `${step.informationSetHash || "unknown"}:`
            + `${comparison.recommendedActionKey}:`
            + `${comparison.comparedActionKey}`
          : null;
        if (comparisonIdentity && !seenLeafActionEffects.has(
          comparisonIdentity
        )) {
          seenLeafActionEffects.add(comparisonIdentity);
          accumulateLeafActionEffectAudit(
            leafActionEffectAudit,
            comparison,
            auditStratum.phaseBand
          );
        }
        leafValuePairCount += pairs;
        const structuredV2Pairs = (leafReference.pairs || [])
          .filter((pair) => leafPairHasStructuredV2(
            pair,
            step,
            trajectory.engineFingerprint
          ))
          .length;
        structuredV2LeafValuePairCount += structuredV2Pairs;
        leafValueCoverage[coverageKey] =
          (leafValueCoverage[coverageKey] || 0) + pairs;
        leafValuePhaseCoverage[auditStratum.phaseBand] =
          (leafValuePhaseCoverage[auditStratum.phaseBand] || 0) + pairs;
        const deckPhaseKey =
          `${trajectory.deckId || "unknown"}::${auditStratum.phaseBand}`;
        leafValueDeckPhaseCoverage[deckPhaseKey] =
          (leafValueDeckPhaseCoverage[deckPhaseKey] || 0) + pairs;
        if (structuredV2Pairs > 0) {
          structuredV2LeafValueCoverage[coverageKey] =
            (structuredV2LeafValueCoverage[coverageKey] || 0)
            + structuredV2Pairs;
          structuredV2LeafValuePhaseCoverage[auditStratum.phaseBand] =
            (structuredV2LeafValuePhaseCoverage[auditStratum.phaseBand] || 0)
            + structuredV2Pairs;
          structuredV2LeafValueDeckPhaseCoverage[deckPhaseKey] =
            (structuredV2LeafValueDeckPhaseCoverage[deckPhaseKey] || 0)
            + structuredV2Pairs;
        }
      }
    }
  }
  if (actionAuditRacing.pairedSeedsCompleted === 0) {
    actionAuditRacing.pairedSeedsCompleted =
      diagnosticPairedSeedsCompleted;
  }

  return {
    version: EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION,
    valid,
    gameCoverage,
    actionReferenceCoverage,
    leafValueCoverage,
    stratumVersion: EVALUATOR_AUDIT_STRATUM_VERSION,
    actionReferencePhaseCoverage,
    actionReferenceActionClassCoverage,
    actionReferenceDeckPhaseCoverage,
    leafValuePhaseCoverage,
    leafValueDeckPhaseCoverage,
    structuredV2ActionReferenceCoverage,
    structuredV2ActionReferencePhaseCoverage,
    structuredV2ActionReferenceActionClassCoverage,
    structuredV2ActionReferenceDeckPhaseCoverage,
    structuredV2LeafValueCoverage,
    structuredV2LeafValuePhaseCoverage,
    structuredV2LeafValueDeckPhaseCoverage,
    actionReferenceIdentities,
    structuredV2ActionReferenceIdentities,
    actionReferenceCount: actionReferenceIdentities.length,
    actionEvidenceGradeCounts,
    actionEvidenceStatisticalStrengthCounts,
    actionEvidenceContinuationScopeCounts,
    actionEvidenceDispositionCounts,
    actionEvidenceProvenanceStatusCounts,
    actionEvidenceObservedPairGap:
      finalizePairwiseRegretAccumulator(actionEvidencePairwiseRegret),
    actionEvidencePairwiseRegret:
      finalizePairwiseRegretAccumulator(actionEvidencePairwiseRegret),
    actionEvidenceIndependentOpeningStates: Object.fromEntries(
      Object.entries(actionEvidenceOpeningStatesByGrade).map(
        ([grade, states]) => [grade, states.size]
      )
    ),
    actionEvidenceIndependentOpeningStateCount: new Set(
      actionReferenceIdentities.filter((item) => item.inProtocolScope
        && [
          ACTION_EVIDENCE_GRADES.terminalRobust,
          ACTION_EVIDENCE_GRADES.continuationConsistent
        ].includes(item.evidenceGrade))
        .map((item) => item.openingStateId)
        .filter(Boolean)
    ).size,
    naturalDistributionActionAudit:
      summarizeNaturalDistributionActionAudit(naturalDistributionItems),
    leafActionEffectAudit: finalizeLeafActionEffectAudit(
      leafActionEffectAudit
    ),
    actionEvidenceComputeEfficiency: summarizeActionEvidenceEfficiency({
      validIndependentEvidence:
        (actionEvidenceGradeCounts[
          ACTION_EVIDENCE_GRADES.terminalRobust
        ] || 0)
        + (actionEvidenceGradeCounts[
          ACTION_EVIDENCE_GRADES.continuationConsistent
        ] || 0),
      ...actionAuditCompute
    }),
    leafValuePairCount,
    structuredV2ActionReferenceCount:
      structuredV2ActionReferenceIdentities.length,
    structuredV2LeafValuePairCount,
    actionAuditRacing,
    logicalGames: summaries.length,
    physicalGames: physicalSummaries.length,
    hasActionReference: actionReferenceIdentities.length > 0,
    hasLeafValueReference: leafValuePairCount > 0
  };
}

function createLeafActionEffectAuditAccumulator() {
  return {
    comparisons: 0,
    targeted: 0,
    natural: 0,
    decisive: 0,
    nearEquivalent: 0,
    inconclusive: 0,
    totalPairedSamples: 0,
    totalIntervalWidth: 0,
    phaseBands: {}
  };
}

function accumulateLeafActionEffectAudit(target, comparison, phaseBand) {
  const audit = comparison?.pairedAudit;
  const interval = pairedBinaryDifferenceInterval(
    audit?.outcomePairs || [],
    audit?.confidence
  );
  if (!interval) return;
  const decisiveThreshold = Math.max(
    0,
    Number(comparison.decisiveEffectThreshold) || 0.01
  );
  const equivalentMargin = Math.max(
    0,
    Number(comparison.nearEquivalentMargin) || 0.01
  );
  const minimumEquivalentSamples = Math.max(
    32,
    Number(comparison.minimumNearEquivalentSamples) || 32
  );
  const disposition = interval.lowerBound > decisiveThreshold
      || interval.upperBound < -decisiveThreshold
    ? "decisive"
    : interval.samples >= minimumEquivalentSamples
      && interval.lowerBound >= -equivalentMargin
      && interval.upperBound <= equivalentMargin
      ? "nearEquivalent"
      : "inconclusive";
  const distribution = comparison.samplingFrame?.distribution
    === "natural-distribution" ? "natural" : "targeted";
  target.comparisons += 1;
  target[distribution] += 1;
  target[disposition] += 1;
  target.totalPairedSamples += interval.samples;
  target.totalIntervalWidth += interval.upperBound - interval.lowerBound;
  target.phaseBands[phaseBand] ||= createLeafActionEffectAuditAccumulator();
  const phase = target.phaseBands[phaseBand];
  phase.comparisons += 1;
  phase[distribution] += 1;
  phase[disposition] += 1;
  phase.totalPairedSamples += interval.samples;
  phase.totalIntervalWidth += interval.upperBound - interval.lowerBound;
}

function finalizeLeafActionEffectAudit(value) {
  const result = {
    comparisons: value.comparisons,
    targeted: value.targeted,
    natural: value.natural,
    decisive: value.decisive,
    nearEquivalent: value.nearEquivalent,
    inconclusive: value.inconclusive,
    totalPairedSamples: value.totalPairedSamples,
    meanIntervalWidth: value.comparisons > 0
      ? value.totalIntervalWidth / value.comparisons
      : null,
    phaseBands: {}
  };
  for (const [phase, summary] of Object.entries(value.phaseBands || {})) {
    result.phaseBands[phase] = finalizeLeafActionEffectAudit(summary);
  }
  return result;
}

function pairedSeedsForAuditDiagnostic(diagnostic) {
  if (!diagnostic) return 0;
  const checkpoints = diagnostic.racing?.checkpoints || [];
  if (checkpoints.length > 0) {
    const maximumByBank = {};
    for (const checkpoint of checkpoints) {
      const bank = checkpoint.bank || "selection";
      maximumByBank[bank] = Math.max(
        Number(maximumByBank[bank]) || 0,
        Number(checkpoint.attemptedPairs) || 0
      );
    }
    return Object.values(maximumByBank).reduce(
      (sum, count) => sum + Number(count || 0),
      0
    );
  }
  const selectionPairs = Math.max(
    Number(diagnostic.preselection?.attemptedPairs) || 0,
    Number(diagnostic.selection?.attemptedPairs) || 0
  );
  const finalPairs = Number(diagnostic.final?.attemptedPairs) || 0;
  return selectionPairs + finalPairs;
}

export function validEvaluatorBootstrapResultIndex(index) {
  return index?.version === EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION
    && typeof index.valid === "boolean"
    && index.gameCoverage
    && index.actionReferenceCoverage
    && index.leafValueCoverage
    && index.stratumVersion === EVALUATOR_AUDIT_STRATUM_VERSION
    && index.actionReferencePhaseCoverage
    && index.actionReferenceActionClassCoverage
    && index.actionReferenceDeckPhaseCoverage
    && index.leafValuePhaseCoverage
    && index.leafValueDeckPhaseCoverage
    && index.structuredV2ActionReferenceCoverage
    && index.structuredV2ActionReferencePhaseCoverage
    && index.structuredV2ActionReferenceActionClassCoverage
    && index.structuredV2ActionReferenceDeckPhaseCoverage
    && index.structuredV2LeafValueCoverage
    && index.structuredV2LeafValuePhaseCoverage
    && index.structuredV2LeafValueDeckPhaseCoverage
    && index.actionEvidenceGradeCounts
    && index.actionEvidenceStatisticalStrengthCounts
    && index.actionEvidenceContinuationScopeCounts
    && index.actionEvidenceDispositionCounts
    && index.actionEvidenceProvenanceStatusCounts
    && index.actionEvidenceObservedPairGap
    && index.actionEvidencePairwiseRegret
    && index.actionEvidenceIndependentOpeningStates
    && Number.isFinite(Number(
      index.actionEvidenceIndependentOpeningStateCount
    ))
    && index.naturalDistributionActionAudit
    && index.leafActionEffectAudit
    && index.actionEvidenceComputeEfficiency
    && Array.isArray(index.actionReferenceIdentities);
}

function naturalDistributionAuditItem(options = {}) {
  const reference = options.actionReference;
  const diagnostic = options.diagnostic;
  const final = reference?.final || diagnostic?.final || {};
  const assessment = reference ? assessActionEvidence(reference) : null;
  const equivalentMargin = Number(
    reference?.evidenceProtocol?.statistics?.nearEquivalentMargin
  ) || 0.01;
  const lower = Number(final?.lowerBound);
  const upper = Number(final?.upperBound);
  const disposition = reference
    ? assessment?.disposition || "inconclusive"
    : Number.isFinite(lower)
      && Number.isFinite(upper)
      && lower >= -equivalentMargin
      && upper <= equivalentMargin
      ? "near-equivalent"
      : "inconclusive";
  const summary = options.trajectory?.matchup || {};
  return {
    openingStateId:
      reference?.informationSetHash || options.step?.informationSetHash,
    disposition,
    correct: null,
    // A stored selected-pair gap is not evaluator regret. The latter can only
    // be filled after an evaluator actually chooses one branch.
    regret: null,
    observedPairGap: assessment?.observedPairGap ?? null,
    observedPairGapScope: assessment?.observedPairGapScope ?? null,
    deckId: options.trajectory?.deckId || "unknown",
    seat: normalizedTrajectorySeat(options.trajectory),
    matchup: summary.id || summary.opponentDeckId || "unknown"
  };
}

function createPairwiseRegretAccumulator() {
  return {
    comparisons: 0,
    observedRegretComparisons: 0,
    totalObservedRegret: 0,
    byScope: {},
    byPhase: {}
  };
}

function accumulatePairwiseRegret(target, assessment, phaseBand = "unknown") {
  target.comparisons += 1;
  const scope = String(
    assessment?.observedPairGapScope
      || assessment?.pairwiseRegretScope
      || "unknown"
  );
  const phase = String(phaseBand || "unknown");
  target.byScope[scope] ||= {
    comparisons: 0,
    observedRegretComparisons: 0,
    totalObservedRegret: 0
  };
  target.byPhase[phase] ||= {
    comparisons: 0,
    observedRegretComparisons: 0,
    totalObservedRegret: 0
  };
  target.byScope[scope].comparisons += 1;
  target.byPhase[phase].comparisons += 1;
  const regret = Number(
    assessment?.observedPairGap ?? assessment?.pairwiseRegret
  );
  if ((assessment?.observedPairGap ?? assessment?.pairwiseRegret) == null
    || !Number.isFinite(regret)) return;
  target.observedRegretComparisons += 1;
  target.totalObservedRegret += Math.max(0, regret);
  for (const bucket of [target.byScope[scope], target.byPhase[phase]]) {
    bucket.observedRegretComparisons += 1;
    bucket.totalObservedRegret += Math.max(0, regret);
  }
}

function finalizePairwiseRegretAccumulator(target) {
  const finalizeBuckets = (buckets) => Object.fromEntries(
    Object.entries(buckets).map(([key, bucket]) => [key, {
      ...bucket,
      meanObservedPairwiseRegret: bucket.observedRegretComparisons > 0
        ? bucket.totalObservedRegret / bucket.observedRegretComparisons
        : null
    }])
  );
  return {
    version: 1,
    contract: "selected-action-observed-pair-gap-summary-v1",
    populationEstimate: false,
    comparisons: target.comparisons,
    observedRegretComparisons: target.observedRegretComparisons,
    totalObservedRegret: target.totalObservedRegret,
    meanObservedPairwiseRegret: target.observedRegretComparisons > 0
      ? target.totalObservedRegret / target.observedRegretComparisons
      : null,
    meanObservedPairGap: target.observedRegretComparisons > 0
      ? target.totalObservedRegret / target.observedRegretComparisons
      : null,
    byScope: finalizeBuckets(target.byScope),
    byPhase: finalizeBuckets(target.byPhase)
  };
}

function accumulateComputeUsage(target, usage = {}) {
  target.cpuMilliseconds += Math.max(
    0,
    Number(usage?.cpuMilliseconds) || 0
  );
  target.gpuMilliseconds += Math.max(
    0,
    Number(usage?.gpuMilliseconds) || 0
  );
  target.wallMilliseconds += Math.max(
    0,
    Number(usage?.wallMilliseconds) || 0
  );
}

function actionReferenceHasStructuredV2(
  reference,
  step,
  engineFingerprint
) {
  return (reference?.evaluatorStatePairs || []).length > 0
    && reference.evaluatorStatePairs.every((pair) =>
      validStructuredPair(
        pair.recommendedStructuredState,
        pair.selectedStructuredState,
        step,
        engineFingerprint
      ));
}

function leafPairHasStructuredV2(pair, step, engineFingerprint) {
  return validStructuredPair(
    pair?.correctStructuredState,
    pair?.comparedStructuredState,
    step,
    engineFingerprint
  );
}

function validStructuredPair(left, right, step, engineFingerprint) {
  if (!validPublicStructuredEvidenceSnapshot(left, {
    informationSetHash: step?.informationSetHash,
    engineFingerprint
  }) || !validPublicStructuredEvidenceSnapshot(right, {
    informationSetHash: step?.informationSetHash,
    engineFingerprint
  })) return false;
  return left.engineFingerprint === right.engineFingerprint
    && left.informationSetHash === right.informationSetHash
    && left.engineFingerprint === engineFingerprint;
}

function physicalGameSummaries(summary) {
  if (!Array.isArray(summary?.games) || summary.games.length === 0) {
    return summary ? [summary] : [];
  }
  return summary.games.flatMap(physicalGameSummaries);
}

function evaluatorActionReference(step) {
  const auditReference = step?.actionRankingAuditReference;
  if (validActionRankingAuditReference(auditReference, {
    informationSetHash: step?.informationSetHash,
    legalActionKeys: step?.legalActionKeys
  })) return auditReference;
  return null;
}

function stableActionReferenceIdentity(reference) {
  return [
    reference.contract,
    reference.informationSetHash,
    reference.correctActionKey,
    reference.comparedActionKey
  ].join("|");
}

function normalizedTrajectorySeat(trajectory) {
  if (trajectory?.playerId === "p1" || trajectory?.playerId === "p2") {
    return trajectory.playerId;
  }
  if (Number(trajectory?.playerSeat) === 0) return "p1";
  if (Number(trajectory?.playerSeat) === 1) return "p2";
  return "unknown";
}
