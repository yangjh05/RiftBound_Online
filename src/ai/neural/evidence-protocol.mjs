export const ACTION_EVIDENCE_PROTOCOL_VERSION = 1;
export const ACTION_EVIDENCE_PROTOCOL_CONTRACT =
  "precommitted-continuation-action-evidence-v1";
export const ACTION_EVIDENCE_SEED_COMMITMENT_CONTRACT =
  "precommitted-action-evidence-seed-banks-v1";
export const ACTION_EVIDENCE_ASSESSMENT_VERSION = 3;
export const ACTION_EVIDENCE_ASSESSMENT_CONTRACT =
  "orthogonal-action-evidence-assessment-v3";

export const ACTION_EVIDENCE_DISPOSITIONS = Object.freeze({
  decisive: "decisive",
  nearEquivalent: "near-equivalent",
  inconclusive: "inconclusive",
  conflicted: "conflicted"
});

export const ACTION_EVIDENCE_STATISTICAL_STRENGTHS = Object.freeze({
  high: "high",
  medium: "medium",
  low: "low",
  invalid: "invalid"
});

export const ACTION_EVIDENCE_CONTINUATION_SCOPES = Object.freeze({
  terminalRobust: "terminal-robust",
  continuationConsistent: "continuation-consistent",
  policyConditioned: "policy-conditioned",
  poolConditioned: "pool-conditioned",
  nearEquivalent: "near-equivalent",
  conflicted: "conflicted",
  proposalOnly: "proposal-only"
});

export const ACTION_EVIDENCE_PROVENANCE_STATUSES = Object.freeze({
  exact: "exact",
  datasetRecoverable: "dataset-recoverable",
  unknown: "unknown"
});

export const ACTION_EVIDENCE_GRADES = Object.freeze({
  terminalRobust: "terminal-robust",
  continuationConsistent: "continuation-consistent",
  legacyTerminalConditioned: "legacy-terminal-conditioned",
  policyConditioned: "policy-conditioned",
  proposalOnly: "proposal-only",
  conflicted: "conflicted",
  nearEquivalent: "near-equivalent",
  inconclusive: "inconclusive"
});

export const ACTION_EVIDENCE_GRADE_USAGE = Object.freeze({
  [ACTION_EVIDENCE_GRADES.terminalRobust]: Object.freeze({
    evaluatorTraining: true,
    policyCorrection: "strong",
    formalAudit: "primary"
  }),
  [ACTION_EVIDENCE_GRADES.continuationConsistent]: Object.freeze({
    evaluatorTraining: true,
    policyCorrection: false,
    formalAudit: "reported-separately"
  }),
  [ACTION_EVIDENCE_GRADES.legacyTerminalConditioned]: Object.freeze({
    evaluatorTraining: "policy-q",
    policyCorrection: false,
    formalAudit: false
  }),
  [ACTION_EVIDENCE_GRADES.policyConditioned]: Object.freeze({
    evaluatorTraining: "value-and-q-only",
    policyCorrection: false,
    formalAudit: false
  }),
  [ACTION_EVIDENCE_GRADES.proposalOnly]: Object.freeze({
    evaluatorTraining: false,
    policyCorrection: false,
    formalAudit: false
  }),
  [ACTION_EVIDENCE_GRADES.conflicted]: Object.freeze({
    evaluatorTraining: "diagnostic-only",
    policyCorrection: false,
    formalAudit: "sensitivity-failure"
  }),
  [ACTION_EVIDENCE_GRADES.nearEquivalent]: Object.freeze({
    evaluatorTraining: "equivalence-target",
    policyCorrection: false,
    formalAudit: "coverage-denominator"
  }),
  [ACTION_EVIDENCE_GRADES.inconclusive]: Object.freeze({
    evaluatorTraining: false,
    policyCorrection: false,
    formalAudit: "coverage-denominator"
  })
});

export const DEFAULT_ACTION_EVIDENCE_REQUIREMENTS = Object.freeze({
  training: Object.freeze({
    terminalRobustMinimum: 0,
    continuationConsistentMinimum: 80,
    independentOpeningStateMinimum: 80,
    naturalDistributionAuditMinimum: 0,
    decisiveCoverageMinimum: 0,
    minimumDeckSeatCoverage: 0,
    nearEquivalentMinimum: 0
  }),
  development: Object.freeze({
    terminalRobustMinimum: 0,
    continuationConsistentMinimum: 40,
    independentOpeningStateMinimum: 50,
    naturalDistributionAuditMinimum: 50,
    decisiveCoverageMinimum: 0.1,
    minimumDeckSeatCoverage: 3,
    nearEquivalentMinimum: 0
  }),
  confirmation: Object.freeze({
    terminalRobustMinimum: 50,
    continuationConsistentMinimum: 0,
    independentOpeningStateMinimum: 60,
    naturalDistributionAuditMinimum: 60,
    decisiveCoverageMinimum: 0.1,
    minimumDeckSeatCoverage: 4,
    nearEquivalentMinimum: 0
  }),
  "final-audit": Object.freeze({
    terminalRobustMinimum: 50,
    continuationConsistentMinimum: 0,
    independentOpeningStateMinimum: 75,
    naturalDistributionAuditMinimum: 75,
    decisiveCoverageMinimum: 0.1,
    minimumDeckSeatCoverage: 5,
    nearEquivalentMinimum: 0
  })
});

const VALID_GRADES = new Set(Object.values(ACTION_EVIDENCE_GRADES));

export function createActionEvidenceProtocolManifest(options = {}) {
  const continuationMembers = normalizePoolMembers(
    options.continuationPool || []
  );
  const opponentMembers = normalizePoolMembers(options.opponentPool || []);
  const manifest = {
    version: ACTION_EVIDENCE_PROTOCOL_VERSION,
    contract: ACTION_EVIDENCE_PROTOCOL_CONTRACT,
    status: "precommitted",
    scope: options.scope || "opening-and-mulligan",
    continuationContractVersion:
      String(options.continuationContractVersion || "continuation-v1"),
    continuationMemoryContract: String(
      options.continuationMemoryContract
        || "public-information-state-zero-memory-v1"
    ),
    continuationPool: {
      members: continuationMembers,
      digest: stableProtocolDigest(continuationMembers),
      minimumBehaviorallyIndependent: Math.max(
        2,
        Math.floor(Number(options.minimumBehaviorallyIndependent) || 2)
      ),
      diversityProbeDigest: options.diversityProbeDigest || null,
      minimumDisagreementRate: finiteOr(
        options.minimumDisagreementRate,
        0.05
      ),
      minimumStrength: finiteOr(options.minimumContinuationStrength, 0.5)
    },
    opponentPool: {
      members: opponentMembers,
      digest: stableProtocolDigest(opponentMembers)
    },
    candidateSelection: {
      evaluatorGuidedFraction: clamp01(
        finiteOr(options.evaluatorGuidedFraction, 0.8)
      ),
      evaluatorBlindFraction: clamp01(
        finiteOr(options.evaluatorBlindFraction, 0.2)
      ),
      preserveContinuationConflicts: true,
      preserveEvaluatorHeuristicConflicts: true,
      recordSamplingPropensity: true
    },
    search: {
      contractHash: String(options.searchContractHash || ""),
      symmetricBranches: true,
      budgetPerBranch: Math.max(
        0,
        Math.floor(Number(options.searchBudgetPerBranch) || 0)
      ),
      triggerRuleHash: String(options.searchTriggerRuleHash || "")
    },
    chance: {
      scheduleVersion: String(options.chanceScheduleVersion || ""),
      commonRandomNumbers: true
    },
    seedBanks: {
      derivationVersion: String(
        options.seedDerivationVersion || "action-audit-seed-v2"
      ),
      pilotPairs: 8,
      selectionPairs: 32,
      finalPairs: 128,
      disjoint: true,
      committedBeforeFirstRollout: true
    },
    statistics: {
      minimumStrongEffect: Math.max(
        0,
        finiteOr(options.minimumStrongEffect, 0.02)
      ),
      minimumTrainingEffect: Math.max(
        0,
        finiteOr(options.minimumTrainingEffect, 0.01)
      ),
      sensitivityEpsilon: Math.max(
        0,
        finiteOr(options.sensitivityEpsilon, 0.02)
      ),
      nearEquivalentMargin: Math.max(
        0,
        finiteOr(options.nearEquivalentMargin, 0.01)
      ),
      confidenceLevel: clamp(
        finiteOr(options.confidenceLevel, 0.99),
        0.9,
        0.9999
      ),
      discoveryFalseDiscoveryRate: clamp(
        finiteOr(options.discoveryFalseDiscoveryRate, 0.05),
        0.001,
        0.25
      ),
      discoveryCorrection: "benjamini-hochberg-fdr",
      policyCorrection: "holm-fwer",
      sequentialInference: "fixed-bank-no-optional-stopping"
    },
    distributions: {
      training: "precommitted-stratified-with-blind-exploration",
      development: "protected-natural-plus-prespecified-strata",
      confirmation: "protected-natural-plus-prespecified-strata",
      finalAudit: "protected-natural-distribution"
    },
    pilot: {
      stratifiedOpeningStates: Math.max(
        100,
        Number(options.pilotStratifiedOpeningStates) || 100
      ),
      naturalOpeningStates: Math.max(
        100,
        Number(options.pilotNaturalOpeningStates) || 100
      ),
      benchmarkArms: [
        "terminal-only-64",
        "fixed-128",
        "racing-8-32-128",
        "short-screen-then-terminal-128",
        "strong-continuation-ablation",
        "opening-stratification-ablation"
      ],
      freezeAfterPilot: [
        "minimumStrongEffect",
        "sensitivityEpsilon",
        "searchBudgetPerBranch",
        "continuation-mixture",
        "candidate-selection-mixture"
      ]
    },
    requirements: normalizeRequirements(
      options.requirements || DEFAULT_ACTION_EVIDENCE_REQUIREMENTS
    )
  };
  manifest.protocolHash = stableProtocolDigest(manifest);
  if (!validActionEvidenceProtocolManifest(manifest)) {
    throw new Error("Action evidence protocol manifest is incomplete.");
  }
  return deepFreeze(manifest);
}

export function validActionEvidenceProtocolManifest(manifest) {
  if (manifest?.version !== ACTION_EVIDENCE_PROTOCOL_VERSION
    || manifest?.contract !== ACTION_EVIDENCE_PROTOCOL_CONTRACT
    || manifest?.status !== "precommitted"
    || !manifest?.protocolHash
    || manifest.protocolHash !== stableProtocolDigest({
      ...manifest,
      protocolHash: undefined
    })
    || !manifest?.continuationContractVersion
    || manifest?.continuationMemoryContract
      !== "public-information-state-zero-memory-v1"
    || !manifest?.continuationPool?.digest
    || manifest.continuationPool.digest !== stableProtocolDigest(
      manifest.continuationPool.members || []
    )
    || !manifest?.opponentPool?.digest
    || manifest.opponentPool.digest !== stableProtocolDigest(
      manifest.opponentPool.members || []
    )
    || !manifest?.search?.contractHash
    || !manifest?.search?.triggerRuleHash
    || manifest.search.symmetricBranches !== true
    || !manifest?.chance?.scheduleVersion
    || manifest.chance.commonRandomNumbers !== true
    || Number(manifest?.seedBanks?.pilotPairs) !== 8
    || Number(manifest?.seedBanks?.selectionPairs) !== 32
    || Number(manifest?.seedBanks?.finalPairs) !== 128
    || manifest.seedBanks.disjoint !== true
    || manifest.seedBanks.committedBeforeFirstRollout !== true
    || manifest?.statistics?.policyCorrection !== "holm-fwer"
    || manifest?.statistics?.discoveryCorrection
      !== "benjamini-hochberg-fdr"
    || !Number.isFinite(
      Number(manifest?.statistics?.discoveryFalseDiscoveryRate)
    )
    || Number(manifest.statistics.discoveryFalseDiscoveryRate) <= 0
    || Number(manifest.statistics.discoveryFalseDiscoveryRate) > 0.25
    || Number(manifest?.pilot?.stratifiedOpeningStates) < 100
    || Number(manifest?.pilot?.naturalOpeningStates) < 100
    || manifest?.candidateSelection?.recordSamplingPropensity !== true
    || !Array.isArray(manifest?.pilot?.benchmarkArms)
    || manifest.pilot.benchmarkArms.length < 6
    || !Array.isArray(manifest?.pilot?.freezeAfterPilot)) return false;
  const continuationMembers = manifest.continuationPool.members || [];
  const opponentMembers = manifest.opponentPool.members || [];
  if (continuationMembers.length === 0
    || opponentMembers.length === 0
    || new Set(continuationMembers.map((member) => member.id)).size
      !== continuationMembers.length
    || new Set(opponentMembers.map((member) => member.id)).size
      !== opponentMembers.length) return false;
  if (continuationMembers.some((member) =>
    member.behaviorallyIndependent === true)
    && !manifest.continuationPool.diversityProbeDigest) return false;
  const guided = Number(
    manifest.candidateSelection?.evaluatorGuidedFraction
  );
  const blind = Number(manifest.candidateSelection?.evaluatorBlindFraction);
  return Number.isFinite(guided)
    && Number.isFinite(blind)
    && blind >= 0.15
    && blind <= 0.25
    && Math.abs(guided + blind - 1) <= 1e-9;
}

export function createActionEvidenceSeedCommitment(
  manifest,
  options = {}
) {
  if (!validActionEvidenceProtocolManifest(manifest)) {
    throw new Error("A valid precommitted evidence protocol is required.");
  }
  const seedBanks = {
    pilot: normalizeSeeds(options.pilotSeeds),
    selection: normalizeSeeds(options.selectionSeeds),
    final: normalizeSeeds(options.finalSeeds)
  };
  if (seedBanks.pilot.length !== 8
    || seedBanks.selection.length !== 32
    || seedBanks.final.length !== 128
    || !isPrefix(seedBanks.pilot, seedBanks.selection)
    || !mutuallyDisjoint([
      seedBanks.selection,
      seedBanks.final,
      normalizeSeeds(options.excludedSeeds)
    ])) {
    throw new Error("Action evidence seed banks violate the 8/32/128 contract.");
  }
  const commitment = {
    version: 1,
    contract: ACTION_EVIDENCE_SEED_COMMITMENT_CONTRACT,
    protocolHash: manifest.protocolHash,
    auditKey: String(options.auditKey || ""),
    informationSetHash: String(options.informationSetHash || ""),
    seedBanks,
    continuationIds: [...new Set(
      (options.continuationIds || manifest.continuationPool.members.map(
        (member) => member.id
      )).map(String)
    )].sort(),
    opponentIds: [...new Set(
      (options.opponentIds || manifest.opponentPool.members.map(
        (member) => member.id
      )).map(String)
    )].sort(),
    committedBeforeFirstRollout: options.rolloutsStarted !== true
  };
  commitment.commitmentHash = stableProtocolDigest(commitment);
  if (!validActionEvidenceSeedCommitment(commitment, manifest)) {
    throw new Error("Action evidence seed commitment is incomplete.");
  }
  return deepFreeze(commitment);
}

export function validActionEvidenceSeedCommitment(commitment, manifest) {
  if (!validActionEvidenceProtocolManifest(manifest)
    || commitment?.version !== 1
    || commitment?.contract !== ACTION_EVIDENCE_SEED_COMMITMENT_CONTRACT
    || commitment?.protocolHash !== manifest.protocolHash
    || !commitment?.auditKey
    || !commitment?.informationSetHash
    || commitment?.committedBeforeFirstRollout !== true
    || commitment?.commitmentHash !== stableProtocolDigest({
      ...commitment,
      commitmentHash: undefined
    })) return false;
  const pilot = normalizeSeeds(commitment.seedBanks?.pilot);
  const selection = normalizeSeeds(commitment.seedBanks?.selection);
  const final = normalizeSeeds(commitment.seedBanks?.final);
  const expectedContinuationIds = sortedUniqueStrings(
    manifest.continuationPool.members.map((member) => member.id)
  );
  const expectedOpponentIds = sortedUniqueStrings(
    manifest.opponentPool.members.map((member) => member.id)
  );
  const rawContinuationIds = Array.from(
    commitment.continuationIds || [],
    String
  );
  const rawOpponentIds = Array.from(commitment.opponentIds || [], String);
  return pilot.length === 8
    && selection.length === 32
    && final.length === 128
    && isPrefix(pilot, selection)
    && mutuallyDisjoint([selection, final])
    && new Set(rawContinuationIds).size === rawContinuationIds.length
    && new Set(rawOpponentIds).size === rawOpponentIds.length
    && sameStringArray(
      [...rawContinuationIds].sort(),
      expectedContinuationIds
    )
    && sameStringArray(
      [...rawOpponentIds].sort(),
      expectedOpponentIds
    );
}

export function classifyPrecommittedActionEvidence(options = {}) {
  const manifest = options.manifest;
  const commitment = options.commitment;
  if (!validActionEvidenceProtocolManifest(manifest)
    || !validActionEvidenceSeedCommitment(commitment, manifest)) {
    return evidenceClassification(
      ACTION_EVIDENCE_GRADES.policyConditioned,
      ["precommitment-missing-or-invalid"]
    );
  }
  const rawResults = Array.isArray(options.continuationResults)
    ? options.continuationResults
    : [];
  const rawIds = rawResults.map((result) => String(result?.id || ""));
  if (rawIds.some((id) => !id)
    || new Set(rawIds).size !== rawIds.length) {
    return evidenceClassification(
      ACTION_EVIDENCE_GRADES.inconclusive,
      ["continuation-result-ids-invalid-or-duplicated"]
    );
  }
  const manifestMembers = manifest.continuationPool.members || [];
  const manifestIds = manifestMembers.map((member) => member.id);
  if (!sameStringArray(
    [...rawIds].sort(),
    [...manifestIds].sort()
  )) {
    return evidenceClassification(
      ACTION_EVIDENCE_GRADES.inconclusive,
      ["continuation-pool-not-exact"],
      { observedContinuationIds: [...rawIds].sort() }
    );
  }
  const results = normalizeContinuationResults(
    rawResults,
    manifestMembers,
    manifest.continuationPool.minimumStrength
  );
  if (!results.length) {
    return evidenceClassification(
      ACTION_EVIDENCE_GRADES.inconclusive,
      ["continuation-results-missing"]
    );
  }
  const requiredContinuationIds = sortedUniqueStrings(
    commitment.continuationIds
  );
  const observedContinuationIds = results.map((result) => result.id).sort();
  if (!sameStringArray(requiredContinuationIds, observedContinuationIds)) {
    return evidenceClassification(
      ACTION_EVIDENCE_GRADES.inconclusive,
      ["continuation-pool-incomplete"],
      { continuationResults: results }
    );
  }
  if (results.some((result) =>
    result.samples < 2 || !(result.standardError > 0))) {
    return evidenceClassification(
      ACTION_EVIDENCE_GRADES.inconclusive,
      ["continuation-standard-errors-missing"],
      { continuationResults: results }
    );
  }
  const correctedResults = applyHolmSimultaneousBounds(results, {
    confidenceLevel: manifest.statistics.confidenceLevel,
    nullValue: 0
  });
  const mixture = simultaneousMixtureInterval(correctedResults);
  const strongDelta = Number(manifest.statistics.minimumStrongEffect);
  const trainingDelta = Number(manifest.statistics.minimumTrainingEffect);
  const epsilon = Number(manifest.statistics.sensitivityEpsilon);
  const equivalent = Number(manifest.statistics.nearEquivalentMargin);
  const behaviorallyIndependent = correctedResults.filter((result) =>
    Boolean(manifest.continuationPool.diversityProbeDigest)
      &&
    result.behaviorallyIndependent === true
      && result.strengthEligible === true);
  const positiveIndependent = behaviorallyIndependent.filter((result) =>
    result.mean > 0);
  const positiveIndependentBehaviorHashes = new Set(
    positiveIndependent.map((result) => result.behaviorHash)
  );
  const clearNegative = correctedResults.filter(
    (result) => result.upperBound < 0
  );
  const positive = correctedResults.filter(
    (result) => result.lowerBound > 0
  );
  const simultaneousAdjusted = correctedResults.every((result) =>
    result.simultaneousCorrection === "holm-fwer"
      && Number.isFinite(result.holmAdjustedPValue));
  if (positive.length > 0 && clearNegative.length > 0) {
    return evidenceClassification(ACTION_EVIDENCE_GRADES.conflicted, [
      "continuation-directions-conflict"
    ], { mixture, continuationResults: correctedResults });
  }
  if (mixture.lowerBound >= -equivalent
    && mixture.upperBound <= equivalent) {
    return evidenceClassification(ACTION_EVIDENCE_GRADES.nearEquivalent, [], {
      mixture,
      continuationResults: correctedResults
    });
  }
  const robust = mixture.lowerBound > strongDelta
    && simultaneousAdjusted
    && positiveIndependentBehaviorHashes.size >= Math.max(
      2,
      Number(manifest.continuationPool.minimumBehaviorallyIndependent) || 2
    )
    && correctedResults.every((result) => result.lowerBound > -epsilon)
    && clearNegative.length === 0;
  if (robust) {
    return evidenceClassification(ACTION_EVIDENCE_GRADES.terminalRobust, [], {
      mixture,
      continuationResults: correctedResults
    });
  }
  const distinctContinuationIds = new Set(
    correctedResults.map((result) => result.id)
  ).size;
  const distinctBehaviorHashes = new Set(
    correctedResults.map((result) => result.behaviorHash).filter(Boolean)
  ).size;
  const strengthEligibleBehaviorHashes = new Set(
    correctedResults
      .filter((result) => result.strengthEligible === true)
      .map((result) => result.behaviorHash)
      .filter(Boolean)
  );
  const consistentDirection = mixture.lowerBound > trainingDelta
    && correctedResults.every((result) => result.mean > 0)
    && clearNegative.length === 0;
  if (consistentDirection) {
    if (distinctContinuationIds < 2
      || distinctBehaviorHashes < 2
      || strengthEligibleBehaviorHashes.size < 2) {
      return evidenceClassification(
        ACTION_EVIDENCE_GRADES.policyConditioned,
        [distinctContinuationIds < 2 || distinctBehaviorHashes < 2
          ? "single-or-behaviorally-equivalent-continuation"
          : "insufficient-strong-behaviorally-distinct-continuations"],
        { mixture, continuationResults: correctedResults }
      );
    }
    const consistentReasons = [];
    if (!simultaneousAdjusted) {
      consistentReasons.push(
        "continuation-bounds-not-simultaneously-corrected"
      );
    }
    if (positiveIndependentBehaviorHashes.size < Math.max(
      2,
      Number(manifest.continuationPool.minimumBehaviorallyIndependent) || 2
    )) {
      consistentReasons.push(
        "insufficient-behaviorally-independent-continuations"
      );
    }
    return evidenceClassification(
      ACTION_EVIDENCE_GRADES.continuationConsistent,
      consistentReasons,
      { mixture, continuationResults: correctedResults }
    );
  }
  return evidenceClassification(ACTION_EVIDENCE_GRADES.inconclusive, [
    mixture.mean <= 0 ? "nonpositive-mixture" : "confidence-bound-insufficient"
  ], { mixture, continuationResults: correctedResults });
}

export function actionEvidenceGrade(reference) {
  if (VALID_GRADES.has(reference?.evidenceGrade)
    && validActionEvidenceProtocolManifest(reference?.evidenceProtocol)
    && validActionEvidenceSeedCommitment(
      reference?.evidenceCommitment,
      reference.evidenceProtocol
    )) return reference.evidenceGrade;
  if (reference?.source === "independent-terminal-action-audit"
    && Number(reference?.final?.attemptedPairs) >= 64) {
    return ACTION_EVIDENCE_GRADES.legacyTerminalConditioned;
  }
  if (reference?.policyCorrectionIndependent === true) {
    return ACTION_EVIDENCE_GRADES.policyConditioned;
  }
  return ACTION_EVIDENCE_GRADES.proposalOnly;
}

export function actionEvidenceUse(reference) {
  return ACTION_EVIDENCE_GRADE_USAGE[actionEvidenceGrade(reference)]
    || ACTION_EVIDENCE_GRADE_USAGE[ACTION_EVIDENCE_GRADES.proposalOnly];
}

/**
 * Assess evidence on independent axes. This never mutates or upgrades the raw
 * reference grade: old 32->64 terminal audits remain legacy records while
 * still receiving their earned statistical weight as Q^pi evidence.
 */
export function assessActionEvidence(reference, options = {}) {
  const rawGrade = actionEvidenceGrade(reference);
  const statistical = actionEvidenceStatisticalAssessment(reference, rawGrade, options);
  const continuationScope = actionEvidenceContinuationScope(rawGrade, reference);
  const interpretation = actionEvidencePairwiseInterpretation(
    reference,
    rawGrade,
    options
  );
  const provenance = actionEvidenceProvenance(reference, {
    ...options,
    rawGrade
  });
  return {
    version: ACTION_EVIDENCE_ASSESSMENT_VERSION,
    contract: ACTION_EVIDENCE_ASSESSMENT_CONTRACT,
    rawGrade,
    statisticalStrength: statistical.strength,
    continuationScope,
    disposition: interpretation.disposition,
    effectEstimate: interpretation.effectEstimate,
    effectLowerBound: interpretation.effectLowerBound,
    effectUpperBound: interpretation.effectUpperBound,
    decisiveEffectThreshold: interpretation.decisiveEffectThreshold,
    observedPairGap: interpretation.observedPairGap,
    observedPairGapScope: interpretation.observedPairGapScope,
    // Kept as a compatibility alias. This is a selected-pair outcome gap,
    // not population or evaluator regret.
    pairwiseRegret: interpretation.pairwiseRegret,
    pairwiseRegretScope: interpretation.pairwiseRegretScope,
    provenanceStatus: provenance.status,
    continuationModelHash: provenance.continuationModelHash,
    continuationPoolDigest: provenance.continuationPoolDigest,
    continuationModelHashes: provenance.continuationModelHashes,
    reasons: [...new Set([...statistical.reasons, ...provenance.reasons])],
    sampleWeight: actionEvidenceSampleWeight(
      statistical.strength,
      continuationScope
    ),
    authorizedUses: actionEvidenceAuthorization({
      rawGrade,
      statisticalStrength: statistical.strength,
      continuationScope,
      provenanceStatus: provenance.status,
      continuationModelHash: provenance.continuationModelHash,
      continuationPoolDigest: provenance.continuationPoolDigest,
      continuationModelHashes: provenance.continuationModelHashes
    }, options)
  };
}

function actionEvidencePairwiseInterpretation(reference, rawGrade, options = {}) {
  const classificationMixture = reference?.evidenceClassification?.mixture;
  const final = reference?.final || {};
  const effectEstimate = finiteOrNull(
    classificationMixture?.mean,
    final?.mean,
    reference?.evaluatorTarget?.meanOutcomeDelta,
    meanTerminalOutcomeDelta(final?.terminalOutcomePairs)
  );
  const effectLowerBound = finiteOrNull(
    classificationMixture?.lowerBound,
    final?.lowerBound
  );
  const effectUpperBound = finiteOrNull(
    classificationMixture?.upperBound,
    final?.upperBound
  );
  const equivalentMargin = Math.max(
    0,
    Number(
      reference?.evidenceProtocol?.statistics?.nearEquivalentMargin
        ?? options.nearEquivalentMargin
        ?? 0.01
    ) || 0
  );
  const decisiveEffectThreshold = Math.max(
    0,
    Number(
      reference?.evidenceProtocol?.statistics?.minimumTrainingEffect
        ?? options.minimumDecisiveEffect
        ?? options.minimumHighConfidenceEffect
        ?? 0.01
    ) || 0
  );
  let disposition = ACTION_EVIDENCE_DISPOSITIONS.inconclusive;
  if (rawGrade === ACTION_EVIDENCE_GRADES.conflicted) {
    disposition = ACTION_EVIDENCE_DISPOSITIONS.conflicted;
  } else if (rawGrade === ACTION_EVIDENCE_GRADES.nearEquivalent
    || (effectLowerBound != null
      && effectUpperBound != null
      && effectLowerBound >= -equivalentMargin
      && effectUpperBound <= equivalentMargin)) {
    disposition = ACTION_EVIDENCE_DISPOSITIONS.nearEquivalent;
  } else if (effectLowerBound != null
    && effectLowerBound > decisiveEffectThreshold) {
    disposition = ACTION_EVIDENCE_DISPOSITIONS.decisive;
  }
  const naturalDistribution = reference?.samplingFrame?.distribution
    === "natural-distribution";
  return {
    disposition,
    effectEstimate,
    effectLowerBound,
    effectUpperBound,
    decisiveEffectThreshold,
    observedPairGap: disposition === ACTION_EVIDENCE_DISPOSITIONS.decisive
      && effectEstimate != null
      ? Math.max(0, effectEstimate)
      : disposition === ACTION_EVIDENCE_DISPOSITIONS.nearEquivalent
        ? 0
        : null,
    observedPairGapScope: naturalDistribution
      ? "natural-state-selected-pair"
      : "targeted-selected-pair",
    pairwiseRegret: disposition === ACTION_EVIDENCE_DISPOSITIONS.decisive
      && effectEstimate != null
      ? Math.max(0, effectEstimate)
      : disposition === ACTION_EVIDENCE_DISPOSITIONS.nearEquivalent
        ? 0
        : null,
    pairwiseRegretScope: naturalDistribution
      ? "natural-state-selected-pair"
      : "targeted-selected-pair"
  };
}

function meanTerminalOutcomeDelta(pairs) {
  const deltas = (pairs || []).flatMap((pair) => {
    const recommended = Number(pair?.recommendedOutcome);
    const selected = Number(pair?.selectedOutcome);
    return Number.isFinite(recommended) && Number.isFinite(selected)
      ? [recommended - selected]
      : [];
  });
  return deltas.length > 0
    ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
    : null;
}

export function actionEvidenceTrainingAuthorization(reference, options = {}) {
  return assessActionEvidence(reference, options).authorizedUses;
}

function actionEvidenceStatisticalAssessment(reference, rawGrade, options) {
  if ([
    ACTION_EVIDENCE_GRADES.terminalRobust,
    ACTION_EVIDENCE_GRADES.continuationConsistent,
    ACTION_EVIDENCE_GRADES.policyConditioned,
    ACTION_EVIDENCE_GRADES.nearEquivalent,
    ACTION_EVIDENCE_GRADES.conflicted
  ].includes(rawGrade)
    && validActionEvidenceProtocolManifest(reference?.evidenceProtocol)
    && validActionEvidenceSeedCommitment(
      reference?.evidenceCommitment,
      reference.evidenceProtocol
    )) {
    return { strength: ACTION_EVIDENCE_STATISTICAL_STRENGTHS.high, reasons: [] };
  }
  if (rawGrade !== ACTION_EVIDENCE_GRADES.legacyTerminalConditioned) {
    return {
      strength: ACTION_EVIDENCE_STATISTICAL_STRENGTHS.low,
      reasons: ["no-independent-terminal-confidence-contract"]
    };
  }
  const selection = reference?.selection || {};
  const final = reference?.final || {};
  const selectionPairs = Number(selection.attemptedPairs) || 0;
  const finalPairs = Number(final.attemptedPairs) || 0;
  const finalCompleteMinimum = Math.ceil(finalPairs * 0.75);
  const finalUsableMinimum = Math.ceil(finalPairs * 0.5);
  const structuralReasons = [];
  if (reference?.policyCorrectionIndependent !== true) {
    structuralReasons.push("terminal-audit-not-independent");
  }
  if (reference?.determinizationAudit?.complete !== true) {
    structuralReasons.push("determinization-incomplete");
  }
  if (reference?.seedBanks?.disjoint !== true
    || !legacySeedBanksDisjoint(reference?.seedBanks)) {
    structuralReasons.push("seed-banks-not-disjoint");
  }
  if (selectionPairs < 32 || !(Number(selection.lowerBound) > 0)) {
    structuralReasons.push("selection-confidence-insufficient");
  }
  if (finalPairs < 64
    || Number(final.samples) < finalUsableMinimum
    || Number(final.terminalPairs) < finalUsableMinimum
    || !(Number(final.lowerBound) > 0)) {
    structuralReasons.push("final-confidence-insufficient");
  }
  if (!legacyTerminalOutcomeSeedsUnique(selection)
    || !legacyTerminalOutcomeSeedsUnique(final)) {
    structuralReasons.push("terminal-outcome-seeds-invalid");
  }
  if (structuralReasons.length) {
    return {
      strength: ACTION_EVIDENCE_STATISTICAL_STRENGTHS.invalid,
      reasons: structuralReasons
    };
  }
  const minimumHighConfidenceEffect = Math.max(
    0,
    Number(options.minimumHighConfidenceEffect) || 0.01
  );
  const rateLowerBounds = [
    final?.validRateLowerBound,
    final?.terminalRateLowerBound,
    final?.pairedValidRateLowerBound,
    final?.pairedTerminalRateLowerBound,
    final?.rates?.valid?.paired?.lowerBound,
    final?.rates?.terminal?.paired?.lowerBound
  ].map(Number).filter(Number.isFinite);
  const ratesSufficient = rateLowerBounds.length === 0
    || Math.min(...rateLowerBounds) >= 0.3;
  if (Number(final.lowerBound) >= minimumHighConfidenceEffect
    && ratesSufficient
    && Number(final.samples) >= finalCompleteMinimum
    && Number(final.terminalPairs) >= finalCompleteMinimum) {
    return { strength: ACTION_EVIDENCE_STATISTICAL_STRENGTHS.high, reasons: [] };
  }
  return {
    strength: ACTION_EVIDENCE_STATISTICAL_STRENGTHS.medium,
    reasons: ratesSufficient
      ? ["positive-but-small-final-effect"]
      : ["positive-final-effect-with-lower-completion-rate"]
  };
}

function actionEvidenceContinuationScope(rawGrade, reference = null) {
  if (rawGrade === ACTION_EVIDENCE_GRADES.terminalRobust) {
    return ACTION_EVIDENCE_CONTINUATION_SCOPES.terminalRobust;
  }
  if (rawGrade === ACTION_EVIDENCE_GRADES.continuationConsistent) {
    return ACTION_EVIDENCE_CONTINUATION_SCOPES.continuationConsistent;
  }
  if (rawGrade === ACTION_EVIDENCE_GRADES.nearEquivalent) {
    return ACTION_EVIDENCE_CONTINUATION_SCOPES.nearEquivalent;
  }
  if (rawGrade === ACTION_EVIDENCE_GRADES.conflicted) {
    return ACTION_EVIDENCE_CONTINUATION_SCOPES.conflicted;
  }
  if ([
    ACTION_EVIDENCE_GRADES.legacyTerminalConditioned,
    ACTION_EVIDENCE_GRADES.policyConditioned
  ].includes(rawGrade)) {
    const protocolMembers = reference?.evidenceProtocol?.continuationPool
      ?.members || [];
    if (rawGrade === ACTION_EVIDENCE_GRADES.policyConditioned
      && protocolMembers.length > 1) {
      return ACTION_EVIDENCE_CONTINUATION_SCOPES.poolConditioned;
    }
    return ACTION_EVIDENCE_CONTINUATION_SCOPES.policyConditioned;
  }
  return ACTION_EVIDENCE_CONTINUATION_SCOPES.proposalOnly;
}

function actionEvidenceProvenance(reference, options = {}) {
  const protocolMembers = reference?.evidenceProtocol?.continuationPool?.members || [];
  const protocolHashes = protocolMembers
    .map((member) => String(member?.modelHash || ""))
    .filter(Boolean);
  if (protocolHashes.length > 1) {
    return {
      status: ACTION_EVIDENCE_PROVENANCE_STATUSES.exact,
      continuationModelHash: null,
      continuationPoolDigest:
        String(reference?.evidenceProtocol?.protocolHash || "") || null,
      continuationModelHashes: [...protocolHashes].sort(),
      reasons: []
    };
  }
  const explicitHash = String(
    reference?.continuationModelHash
      || reference?.continuationPolicyHash
      || (protocolHashes.length === 1 ? protocolHashes[0] : "")
  );
  const expectedArtifactHash = String(
    options.continuationModelHash
      || options.currentPolicyArtifactHash
      || ""
  );
  if (explicitHash) {
    return {
      status: ACTION_EVIDENCE_PROVENANCE_STATUSES.exact,
      continuationModelHash: explicitHash,
      continuationPoolDigest: null,
      continuationModelHashes: [explicitHash],
      reasons: expectedArtifactHash && explicitHash !== expectedArtifactHash
        ? ["current-policy-artifact-mismatch"]
        : []
    };
  }
  const recoverableHash = String(
    options.datasetContinuationPolicyHash
      || options.continuationLineage?.artifactHash
      || ""
  );
  if (options.rawGrade === ACTION_EVIDENCE_GRADES.legacyTerminalConditioned
    && recoverableHash
    && reference?.source === "independent-terminal-action-audit") {
    return {
      status: ACTION_EVIDENCE_PROVENANCE_STATUSES.datasetRecoverable,
      continuationModelHash: recoverableHash,
      continuationPoolDigest: null,
      continuationModelHashes: [recoverableHash],
      reasons: []
    };
  }
  return {
    status: ACTION_EVIDENCE_PROVENANCE_STATUSES.unknown,
    continuationModelHash: explicitHash || null,
    continuationPoolDigest: null,
    continuationModelHashes: explicitHash ? [explicitHash] : [],
    reasons: ["continuation-lineage-unresolved"]
  };
}

function actionEvidenceAuthorization(assessment, options = {}) {
  const statisticallyUsable = [
    ACTION_EVIDENCE_STATISTICAL_STRENGTHS.high,
    ACTION_EVIDENCE_STATISTICAL_STRENGTHS.medium
  ].includes(assessment.statisticalStrength);
  const directedQScope = [
    ACTION_EVIDENCE_CONTINUATION_SCOPES.terminalRobust,
    ACTION_EVIDENCE_CONTINUATION_SCOPES.continuationConsistent,
    ACTION_EVIDENCE_CONTINUATION_SCOPES.policyConditioned,
    ACTION_EVIDENCE_CONTINUATION_SCOPES.poolConditioned
  ].includes(assessment.continuationScope);
  const trainingRole = String(options.role || options.certificationRole || "training")
    === "training";
  const currentPolicyHashes = assessment.rawGrade
    === ACTION_EVIDENCE_GRADES.legacyTerminalConditioned
    ? [
      String(options.currentPolicyArtifactHash || ""),
      String(options.currentPolicyHash || "")
    ].filter(Boolean)
    : [String(options.currentPolicyArtifactHash || "")].filter(Boolean);
  const lineageMatches = Boolean(
    assessment.continuationModelHash
      && currentPolicyHashes.includes(assessment.continuationModelHash)
  );
  const localActorCorrection = trainingRole
    && statisticallyUsable
    && assessment.statisticalStrength === ACTION_EVIDENCE_STATISTICAL_STRENGTHS.high
    && assessment.continuationScope === ACTION_EVIDENCE_CONTINUATION_SCOPES.policyConditioned
    && [
      ACTION_EVIDENCE_PROVENANCE_STATUSES.exact,
      ACTION_EVIDENCE_PROVENANCE_STATUSES.datasetRecoverable
    ].includes(assessment.provenanceStatus)
    && lineageMatches
    && options.allowPolicyConditionedActorCorrection === true;
  return {
    policyQTraining: statisticallyUsable && directedQScope,
    mulliganQTraining: statisticallyUsable && directedQScope,
    searchPriorTraining: statisticallyUsable && directedQScope,
    actorPreferenceTraining: assessment.continuationScope
      === ACTION_EVIDENCE_CONTINUATION_SCOPES.terminalRobust
      ? statisticallyUsable && trainingRole
      : localActorCorrection,
    actorCorrectionMode: localActorCorrection
      ? "pi5-local-trust-region"
      : assessment.continuationScope
          === ACTION_EVIDENCE_CONTINUATION_SCOPES.terminalRobust
        ? "robust"
        : false,
    maximumActorWeight: localActorCorrection
      ? 0.35
      : assessment.continuationScope
          === ACTION_EVIDENCE_CONTINUATION_SCOPES.terminalRobust
        && statisticallyUsable
        && trainingRole
        ? 1
        : 0,
    requireAnchorKl: localActorCorrection,
    robustActionTraining: statisticallyUsable && [
      ACTION_EVIDENCE_CONTINUATION_SCOPES.terminalRobust,
      ACTION_EVIDENCE_CONTINUATION_SCOPES.continuationConsistent
    ].includes(assessment.continuationScope),
    formalActionCertification: assessment.statisticalStrength
      === ACTION_EVIDENCE_STATISTICAL_STRENGTHS.high
      && assessment.continuationScope
        === ACTION_EVIDENCE_CONTINUATION_SCOPES.terminalRobust
  };
}

function actionEvidenceSampleWeight(strength, scope) {
  if (strength === ACTION_EVIDENCE_STATISTICAL_STRENGTHS.invalid) return 0;
  const base = strength === ACTION_EVIDENCE_STATISTICAL_STRENGTHS.high
    ? 1
    : strength === ACTION_EVIDENCE_STATISTICAL_STRENGTHS.medium
      ? 0.5
      : 0.15;
  return scope === ACTION_EVIDENCE_CONTINUATION_SCOPES.conflicted
    || scope === ACTION_EVIDENCE_CONTINUATION_SCOPES.proposalOnly
    ? 0
    : base;
}

function legacySeedBanksDisjoint(seedBanks = {}) {
  const banks = Object.values(seedBanks || {})
    .filter(Array.isArray)
    .map((bank) => bank.map(Number).filter(Number.isFinite));
  const seen = new Set();
  for (const bank of banks) {
    if (new Set(bank).size !== bank.length) return false;
    for (const seed of bank) {
      if (seen.has(seed)) return false;
      seen.add(seed);
    }
  }
  return banks.length >= 2;
}

function legacyTerminalOutcomeSeedsUnique(summary = {}) {
  const pairs = Array.isArray(summary.terminalOutcomePairs)
    ? summary.terminalOutcomePairs
    : [];
  if (!pairs.length) return true;
  const seeds = pairs.map((pair) => Number(pair?.simulationSeed));
  return seeds.every(Number.isFinite) && new Set(seeds).size === seeds.length;
}

export function summarizeNaturalDistributionActionAudit(items = []) {
  const normalized = (items || []).map(normalizeNaturalAuditItem);
  const decisive = normalized.filter((item) => item.disposition === "decisive");
  const nearEquivalent = normalized.filter(
    (item) => item.disposition === "near-equivalent"
  );
  const inconclusive = normalized.filter(
    (item) => item.disposition === "inconclusive"
  );
  const decidedPredictions = decisive.filter((item) =>
    typeof item.correct === "boolean");
  const measuredRegret = normalized.filter((item) => item.regret != null);
  const measuredPairGaps = normalized.filter((item) =>
    item.observedPairGap != null);
  const byStratum = {};
  for (const item of normalized) {
    const keys = [
      `deck:${item.deckId}`,
      `seat:${item.seat}`,
      `deck-seat:${item.deckId}:${item.seat}`,
      `matchup:${item.matchup}`
    ];
    for (const key of keys) {
      const bucket = byStratum[key] || {
        states: 0,
        decisive: 0,
        correct: 0,
        predictions: 0,
        measuredRegretStates: 0,
        regret: 0,
        regrets: []
      };
      bucket.states += 1;
      if (item.disposition === "decisive") bucket.decisive += 1;
      if (typeof item.correct === "boolean") {
        bucket.predictions += 1;
        if (item.correct) bucket.correct += 1;
      }
      if (item.regret != null) {
        bucket.measuredRegretStates += 1;
        bucket.regret += item.regret;
        bucket.regrets.push(item.regret);
      }
      byStratum[key] = bucket;
    }
  }
  const strata = Object.fromEntries(Object.entries(byStratum).map(
    ([key, value]) => [key, {
      ...value,
      decisiveCoverage: ratio(value.decisive, value.states),
      conditionalAccuracy: ratio(value.correct, value.predictions),
      observedRegretCoverage: ratio(value.measuredRegretStates, value.states),
      conditionalExpectedRegret: ratio(
        value.regret,
        value.measuredRegretStates
      ),
      expectedRegret: value.measuredRegretStates === value.states
        ? ratio(value.regret, value.states)
        : null,
      conservativePopulationRegretLowerBound: ratio(
        value.regret,
        value.states
      ),
      conservativePopulationRegretUpperBound: ratio(
        value.regret + value.states - value.measuredRegretStates,
        value.states
      ),
      regretTailRisk: summarizeRegretTail(value.regrets)
    }]
  ));
  const rankedWeak = Object.entries(strata)
    .filter(([, value]) => value.predictions > 0)
    .sort((left, right) =>
      left[1].conditionalAccuracy - right[1].conditionalAccuracy
        || finiteSortValue(right[1].conditionalExpectedRegret)
          - finiteSortValue(left[1].conditionalExpectedRegret));
  const totalObservedRegret = measuredRegret.reduce(
    (sum, item) => sum + item.regret,
    0
  );
  const regretInterval = boundedMeanHoeffdingInterval(
    measuredRegret.map((item) => item.regret)
  );
  return {
    version: 2,
    contract: "natural-distribution-action-audit-summary-v2",
    states: normalized.length,
    independentOpeningStates: new Set(
      normalized.map((item) => item.openingStateId).filter(Boolean)
    ).size,
    decisive: decisive.length,
    decisiveCoverage: ratio(decisive.length, normalized.length),
    predictions: decidedPredictions.length,
    correctPredictions:
      decidedPredictions.filter((item) => item.correct).length,
    conditionalAccuracy: ratio(
      decidedPredictions.filter((item) => item.correct).length,
      decidedPredictions.length
    ),
    nearEquivalent: nearEquivalent.length,
    nearEquivalentRate: ratio(nearEquivalent.length, normalized.length),
    inconclusive: inconclusive.length,
    inconclusiveRate: ratio(inconclusive.length, normalized.length),
    measuredRegretStates: measuredRegret.length,
    measuredRegretValues: measuredRegret.map((item) => item.regret),
    observedRegretCoverage: ratio(measuredRegret.length, normalized.length),
    conditionalExpectedRegret: ratio(
      totalObservedRegret,
      measuredRegret.length
    ),
    conditionalExpectedRegretInterval: regretInterval,
    expectedRegret: measuredRegret.length === normalized.length
      ? ratio(totalObservedRegret, normalized.length)
      : null,
    conservativePopulationRegretLowerBound: ratio(
      totalObservedRegret,
      normalized.length
    ),
    conservativePopulationRegretUpperBound: ratio(
      totalObservedRegret + normalized.length - measuredRegret.length,
      normalized.length
    ),
    regretTailRisk: summarizeRegretTail(
      measuredRegret.map((item) => item.regret)
    ),
    measuredObservedPairGapStates: measuredPairGaps.length,
    observedPairGapCoverage: ratio(
      measuredPairGaps.length,
      normalized.length
    ),
    conditionalMeanObservedPairGap: ratio(
      measuredPairGaps.reduce((sum, item) => sum + item.observedPairGap, 0),
      measuredPairGaps.length
    ),
    observedPairGapPopulationEstimate: false,
    strata,
    weakestStrata: rankedWeak.slice(0, 10).map(([key, value]) => ({
      key,
      ...value
    }))
  };
}

export function summarizeActionEvidenceEfficiency(options = {}) {
  const evidence = Math.max(
    0,
    Number(options.validIndependentEvidence) || 0
  );
  const cpuSeconds = Math.max(0, Number(options.cpuMilliseconds) || 0) / 1000;
  const gpuSeconds = Math.max(0, Number(options.gpuMilliseconds) || 0) / 1000;
  const wallSeconds = Math.max(0, Number(options.wallMilliseconds) || 0) / 1000;
  const computeSeconds = cpuSeconds + gpuSeconds;
  return {
    version: 1,
    contract: "action-evidence-compute-efficiency-v1",
    validIndependentEvidence: evidence,
    cpuSeconds,
    gpuSeconds,
    wallSeconds,
    evidencePerCpuHour: cpuSeconds > 0 ? evidence * 3600 / cpuSeconds : null,
    evidencePerGpuHour: gpuSeconds > 0 ? evidence * 3600 / gpuSeconds : null,
    evidencePerComputeHour:
      computeSeconds > 0 ? evidence * 3600 / computeSeconds : null,
    evidencePerWallHour: wallSeconds > 0 ? evidence * 3600 / wallSeconds : null
  };
}

export function actionEvidenceRequirement(role, manifest = null) {
  const requirements = validActionEvidenceProtocolManifest(manifest)
    ? manifest.requirements
    : DEFAULT_ACTION_EVIDENCE_REQUIREMENTS;
  return structuredClone(
    requirements?.[role] || DEFAULT_ACTION_EVIDENCE_REQUIREMENTS[role] || {}
  );
}

export function validActionEvidenceGrade(value) {
  return VALID_GRADES.has(value);
}

export function actionEvidenceProtocolCoversPhase(manifest, phaseBand) {
  if (!validActionEvidenceProtocolManifest(manifest)) return false;
  if (manifest.scope === "opening-and-mulligan") {
    return phaseBand === "mulligan" || phaseBand === "early";
  }
  return true;
}

export function stableProtocolDigest(value) {
  const text = stableStringify(value);
  const states = [2166136261, 2246822519, 3266489917, 668265263];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    for (let slot = 0; slot < states.length; slot += 1) {
      states[slot] ^= (code + slot * 131) & 0xffff;
      states[slot] = Math.imul(
        states[slot],
        [16777619, 3266489917, 668265263, 374761393][slot]
      ) >>> 0;
    }
  }
  return `protocol-${states.map((state) =>
    state.toString(16).padStart(8, "0")).join("")}`;
}

function normalizePoolMembers(members) {
  const normalized = (members || []).map((member, index) => ({
    id: String(member?.id || `member-${index}`),
    modelHash: String(member?.modelHash || ""),
    behaviorHash: String(member?.behaviorHash || ""),
    weight: Math.max(0, finiteOr(member?.weight, 1)),
    generation: Math.max(0, Number(member?.generation) || 0),
    strength: finiteOr(member?.strength, null),
    searchEnabled: member?.searchEnabled === true,
    behaviorallyIndependent: member?.behaviorallyIndependent === true
  })).filter((member) => member.modelHash && member.behaviorHash);
  const total = normalized.reduce((sum, member) => sum + member.weight, 0);
  return normalized.map((member) => ({
    ...member,
    weight: total > 0 ? member.weight / total : 1 / normalized.length
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeContinuationResults(
  results,
  manifestMembers = [],
  minimumStrength = 0
) {
  const memberById = new Map(
    (manifestMembers || []).map((member) => [String(member.id), member])
  );
  const normalized = (results || []).flatMap((result) => {
    const member = memberById.get(String(result?.id || ""));
    const mean = Number(result?.mean);
    const lowerBound = Number(result?.lowerBound);
    const upperBound = Number(result?.upperBound);
    if (!member
      || !Number.isFinite(mean)
      || !Number.isFinite(lowerBound)
      || !Number.isFinite(upperBound)
      || lowerBound > mean
      || mean > upperBound) return [];
    return [{
      id: String(member.id),
      modelHash: String(member.modelHash),
      behaviorHash: String(member.behaviorHash),
      weight: Math.max(0, finiteOr(member.weight, 1)),
      samples: Math.max(0, Number(result.samples) || 0),
      mean,
      lowerBound,
      upperBound,
      standardError: Math.max(0, Number(result.standardError) || 0),
      behaviorallyIndependent: member.behaviorallyIndependent === true,
      strengthEligible: Number(member.strength) >= Number(minimumStrength),
      simultaneousCorrection: result.simultaneousCorrection || null,
      holmAdjustedPValue: result.holmAdjustedPValue == null
        ? null
        : finiteOr(result.holmAdjustedPValue, null),
      holmRejected: result.holmRejected === true
    }];
  });
  const total = normalized.reduce((sum, result) => sum + result.weight, 0);
  return normalized.map((result) => ({
    ...result,
    weight: total > 0 ? result.weight / total : 1 / normalized.length
  }));
}

export function oneSidedNormalPValue(mean, standardError, nullValue = 0) {
  const estimate = Number(mean);
  const error = Number(standardError);
  const boundary = Number(nullValue) || 0;
  if (!Number.isFinite(estimate) || !Number.isFinite(error) || error < 0) {
    return null;
  }
  if (error === 0) return estimate > boundary ? 0 : 1;
  return clamp01(1 - normalCdf((estimate - boundary) / error));
}

export function benjaminiHochbergCorrection(items = [], q = 0.05) {
  const normalized = normalizeHypotheses(items);
  const rate = clamp(finiteOr(q, 0.05), 0.001, 0.25);
  if (!normalized.length) return [];
  const ranked = [...normalized].sort((left, right) =>
    left.pValue - right.pValue || left.id.localeCompare(right.id));
  let maximumRejectedRank = 0;
  for (let index = 0; index < ranked.length; index += 1) {
    if (ranked[index].pValue <= rate * (index + 1) / ranked.length) {
      maximumRejectedRank = index + 1;
    }
  }
  let runningAdjusted = 1;
  for (let index = ranked.length - 1; index >= 0; index -= 1) {
    runningAdjusted = Math.min(
      runningAdjusted,
      ranked[index].pValue * ranked.length / (index + 1)
    );
    ranked[index].adjustedPValue = clamp01(runningAdjusted);
    ranked[index].rejected = index < maximumRejectedRank;
    ranked[index].correction = "benjamini-hochberg-fdr";
    ranked[index].familySize = ranked.length;
  }
  return restoreHypothesisOrder(normalized, ranked);
}

export function holmBonferroniCorrection(items = [], alpha = 0.01) {
  const normalized = normalizeHypotheses(items);
  const familyAlpha = clamp(finiteOr(alpha, 0.01), 0.0001, 0.25);
  if (!normalized.length) return [];
  const ranked = [...normalized].sort((left, right) =>
    left.pValue - right.pValue || left.id.localeCompare(right.id));
  let runningAdjusted = 0;
  let rejectionOpen = true;
  for (let index = 0; index < ranked.length; index += 1) {
    const multiplier = ranked.length - index;
    runningAdjusted = Math.max(
      runningAdjusted,
      ranked[index].pValue * multiplier
    );
    ranked[index].adjustedPValue = clamp01(runningAdjusted);
    const threshold = familyAlpha / multiplier;
    ranked[index].rejected = rejectionOpen
      && ranked[index].pValue <= threshold;
    if (!ranked[index].rejected) rejectionOpen = false;
    ranked[index].correction = "holm-fwer";
    ranked[index].familySize = ranked.length;
  }
  return restoreHypothesisOrder(normalized, ranked);
}

export function applyHolmSimultaneousBounds(results = [], options = {}) {
  const confidenceLevel = clamp(
    finiteOr(options.confidenceLevel, 0.99),
    0.9,
    0.9999
  );
  const alpha = 1 - confidenceLevel;
  const hypotheses = (results || []).map((result) => ({
    id: String(result?.id || ""),
    pValue: oneSidedNormalPValue(
      result?.mean,
      result?.standardError,
      Number(options.nullValue) || 0
    )
  }));
  if (hypotheses.some((item) => !item.id || item.pValue === null)) return [];
  const correction = holmBonferroniCorrection(hypotheses, alpha);
  const correctedById = new Map(correction.map((item) => [item.id, item]));
  // A Bonferroni envelope is at least as conservative as the Holm family
  // decision and gives component bounds that can safely be mixed.
  const critical = inverseNormalCdf(1 - alpha / (2 * results.length));
  return results.map((result) => {
    const corrected = correctedById.get(String(result.id));
    const standardError = Math.max(0, Number(result.standardError) || 0);
    return {
      ...result,
      lowerBound: Number(result.mean) - critical * standardError,
      upperBound: Number(result.mean) + critical * standardError,
      simultaneousCorrection: "holm-fwer",
      simultaneousBoundMethod: "bonferroni-envelope-for-holm-family-v1",
      pValue: corrected?.pValue ?? null,
      holmAdjustedPValue: corrected?.adjustedPValue ?? null,
      holmRejected: corrected?.rejected === true,
      familySize: results.length
    };
  });
}

function simultaneousMixtureInterval(results) {
  return {
    mean: results.reduce((sum, result) =>
      sum + result.weight * result.mean, 0),
    lowerBound: results.reduce((sum, result) =>
      sum + result.weight * result.lowerBound, 0),
    upperBound: results.reduce((sum, result) =>
      sum + result.weight * result.upperBound, 0),
    simultaneousCorrection: results.every((result) =>
      result.simultaneousCorrection === "holm-fwer")
      ? "holm-fwer-component-bounds"
      : "unadjusted-component-bounds"
  };
}

function evidenceClassification(grade, reasons = [], extra = {}) {
  return {
    version: 1,
    contract: "action-evidence-grade-decision-v1",
    grade,
    reasons: [...new Set(reasons)],
    usage: structuredClone(ACTION_EVIDENCE_GRADE_USAGE[grade]),
    ...extra
  };
}

function normalizeNaturalAuditItem(item = {}) {
  const disposition = ["decisive", "near-equivalent", "inconclusive"]
    .includes(item.disposition)
    ? item.disposition
    : "inconclusive";
  return {
    openingStateId: item.openingStateId || null,
    disposition,
    correct: typeof item.correct === "boolean" ? item.correct : null,
    regret: item.regret == null || !Number.isFinite(Number(item.regret))
      ? null
      : Math.max(0, Math.min(1, Number(item.regret))),
    observedPairGap: item.observedPairGap == null
      || !Number.isFinite(Number(item.observedPairGap))
      ? null
      : Math.max(0, Math.min(1, Number(item.observedPairGap))),
    deckId: String(item.deckId || "unknown"),
    seat: String(item.seat || "unknown"),
    matchup: String(item.matchup || "unknown")
  };
}

function summarizeRegretTail(values = []) {
  const finite = values.map(Number).filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(1, value)));
  if (!finite.length) {
    return {
      measuredStates: 0,
      aboveThreePercentRate: null,
      aboveFivePercentRate: null,
      worstTenPercentCvar: null
    };
  }
  const descending = [...finite].sort((left, right) => right - left);
  const tailCount = Math.max(1, Math.ceil(descending.length * 0.1));
  return {
    measuredStates: finite.length,
    aboveThreePercentRate: finite.filter((value) => value >= 0.03).length
      / finite.length,
    aboveFivePercentRate: finite.filter((value) => value >= 0.05).length
      / finite.length,
    worstTenPercentCvar: descending.slice(0, tailCount)
      .reduce((sum, value) => sum + value, 0) / tailCount
  };
}

function boundedMeanHoeffdingInterval(values = [], confidence = 0.95) {
  const finite = values.map(Number).filter(Number.isFinite)
    .map((value) => Math.max(0, Math.min(1, value)));
  if (!finite.length) {
    return {
      method: "opening-state-hoeffding-v1",
      confidence,
      states: 0,
      mean: null,
      lowerBound: null,
      upperBound: null
    };
  }
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const alpha = Math.max(1e-9, 1 - confidence);
  const radius = Math.sqrt(Math.log(2 / alpha) / (2 * finite.length));
  return {
    method: "opening-state-hoeffding-v1",
    confidence,
    states: finite.length,
    mean,
    lowerBound: Math.max(0, mean - radius),
    upperBound: Math.min(1, mean + radius)
  };
}

function finiteSortValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : -Infinity;
}

function normalizeRequirements(requirements) {
  return Object.fromEntries(Object.entries(requirements || {}).map(
    ([role, requirement]) => [role, {
      terminalRobustMinimum: Math.max(
        0,
        Number(requirement?.terminalRobustMinimum) || 0
      ),
      continuationConsistentMinimum: Math.max(
        0,
        Number(requirement?.continuationConsistentMinimum) || 0
      ),
      independentOpeningStateMinimum: Math.max(
        0,
        Number(requirement?.independentOpeningStateMinimum) || 0
      ),
      naturalDistributionAuditMinimum: Math.max(
        0,
        Number(requirement?.naturalDistributionAuditMinimum) || 0
      ),
      decisiveCoverageMinimum: clamp01(
        Number(requirement?.decisiveCoverageMinimum) || 0
      ),
      minimumDeckSeatCoverage: Math.max(
        0,
        Number(requirement?.minimumDeckSeatCoverage) || 0
      ),
      nearEquivalentMinimum: Math.max(
        0,
        Number(requirement?.nearEquivalentMinimum) || 0
      )
    }]
  ));
}

function normalizeSeeds(values) {
  return [...new Set(Array.from(values || [], (seed) => Number(seed) >>> 0))];
}

function mutuallyDisjoint(banks) {
  const seen = new Set();
  for (const bank of banks || []) {
    for (const seed of bank || []) {
      if (seen.has(seed)) return false;
      seen.add(seed);
    }
  }
  return true;
}

function isPrefix(prefix, values) {
  return prefix.every((value, index) => values[index] === value);
}

function sortedUniqueStrings(values = []) {
  return [...new Set(Array.from(values || [], String))].sort();
}

function sameStringArray(left = [], right = []) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizeHypotheses(items = []) {
  const normalized = (items || []).map((item) => ({
    ...item,
    id: String(item?.id || ""),
    pValue: Number(item?.pValue)
  }));
  if (normalized.some((item) =>
    !item.id
      || !Number.isFinite(item.pValue)
      || item.pValue < 0
      || item.pValue > 1)) {
    throw new Error("Multiple-testing hypotheses are incomplete.");
  }
  if (new Set(normalized.map((item) => item.id)).size
    !== normalized.length) {
    throw new Error("Multiple-testing hypothesis IDs must be unique.");
  }
  return normalized;
}

function restoreHypothesisOrder(original, corrected) {
  const byId = new Map(corrected.map((item) => [item.id, item]));
  return original.map((item) => ({ ...item, ...byId.get(item.id) }));
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t)
    + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return clamp01(0.5 * (1 + erf));
}

function inverseNormalCdf(probability) {
  const target = clamp(Number(probability), 1e-12, 1 - 1e-12);
  let low = -8;
  let high = 8;
  for (let index = 0; index < 80; index += 1) {
    const middle = (low + high) / 2;
    if (normalCdf(middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value).filter((key) => value[key] !== undefined)
    .sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function finiteOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function finiteOrNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}
