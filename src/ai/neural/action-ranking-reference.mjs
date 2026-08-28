import { createHash } from "node:crypto";
import { STATE_DIM } from "./encoding.mjs";
import { validPublicStructuredEvidenceSnapshot } from "./structured-evidence.mjs";
import {
  ACTION_EVIDENCE_GRADES,
  actionEvidenceGrade,
  validActionEvidenceGrade,
  validActionEvidenceProtocolManifest,
  validActionEvidenceSeedCommitment
} from "./evidence-protocol.mjs";
import {
  pairedBinaryDifferenceInterval,
  PAIRED_ACTION_EFFECT_ASSESSMENT_VERSION,
  PAIRED_ACTION_EFFECT_CONFIDENCE_METHOD
} from "./paired-action-effect-statistics.mjs";

export const ACTION_RANKING_REFERENCE_VERSION = 4;
export const ACTION_RANKING_REFERENCE_CONTRACT =
  "independent-engine-terminal-action-ranking-v4";
export const ACTION_RANKING_AUDIT_REFERENCE_VERSION = 3;
export const ACTION_RANKING_AUDIT_REFERENCE_CONTRACT =
  "independent-terminal-action-audit-reference-v3";
export const LEAF_VALUE_REFERENCE_VERSION = 3;
export const LEAF_VALUE_REFERENCE_CONTRACT =
  "production-cutoff-terminal-audit-reference-v3";

const ALLOWED_EVIDENCE_KINDS = new Set([
  "engine-proof",
  "confirmed-terminal-rollout-dominance",
  "terminal-postmortem-dominance",
  "independent-engine-search"
]);

export function createActionRankingReference(options = {}) {
  const correctIndex = Number(options.correctIndex);
  const comparedIndex = Number(options.comparedIndex);
  const correctActionKey = options.correctActionKey || null;
  const comparedActionKey = options.comparedActionKey || null;
  const evidenceKind = options.evidenceKind || null;
  if (!Number.isInteger(correctIndex) || correctIndex < 0
    || !Number.isInteger(comparedIndex) || comparedIndex < 0
    || correctIndex === comparedIndex
    || !correctActionKey
    || !comparedActionKey
    || correctActionKey === comparedActionKey
    || !ALLOWED_EVIDENCE_KINDS.has(evidenceKind)) return null;
  const validSamples = normalizeSamplePair(options.validSamples);
  const terminalSamples = normalizeSamplePair(options.terminalSamples);
  const pairedSamples = Math.max(0, Number(options.pairedSamples) || 0);
  const minimumCompleteSamples = Math.ceil(pairedSamples * 0.75);
  const pairedLowerBound = finiteOrNull(options.pairedLowerBound);
  const engineProof = evidenceKind === "engine-proof";
  const leafValuePairs = normalizeLeafValuePairs(options.leafValuePairs);
  if (!engineProof && (
    pairedSamples < 16
    || validSamples.correct < minimumCompleteSamples
    || validSamples.compared < minimumCompleteSamples
    || terminalSamples.correct < minimumCompleteSamples
    || terminalSamples.compared < minimumCompleteSamples
    || !(pairedLowerBound > 0)
    || options.seedBanks?.disjoint !== true
    || options.determinizationAudit?.complete !== true
  )) return null;
  const modelHashes = [...new Set(options.modelHashes || [])].filter(Boolean).sort();
  // References used to bootstrap the first evaluator may not depend on a leaf
  // value model. Terminal-only evidence and direct engine proofs therefore
  // carry an empty model lineage by contract.
  if (modelHashes.length) return null;
  return {
    version: ACTION_RANKING_REFERENCE_VERSION,
    contract: ACTION_RANKING_REFERENCE_CONTRACT,
    informationSetHash: options.informationSetHash || null,
    informationSetHashVersion: Number(options.informationSetHashVersion) || 1,
    correctIndex,
    comparedIndex,
    correctActionKey,
    comparedActionKey,
    evidenceKind,
    validSamples,
    terminalSamples,
    pairedSamples: engineProof ? Math.max(1, pairedSamples) : pairedSamples,
    pairedLowerBound: engineProof ? 1 : pairedLowerBound,
    pairedUpperBound: engineProof ? 1 : finiteOrNull(options.pairedUpperBound),
    seedBanks: engineProof
      ? { screening: [], confirmation: [], disjoint: true }
      : structuredClone(options.seedBanks),
    determinizationAudit: engineProof
      ? { version: 1, complete: true, source: "direct-engine-transition" }
      : structuredClone(options.determinizationAudit),
    leafValueReference: engineProof || leafValuePairs.length === 0
      ? null
      : {
        version: LEAF_VALUE_REFERENCE_VERSION,
        contract: LEAF_VALUE_REFERENCE_CONTRACT,
        pairs: leafValuePairs
      },
    modelHashes,
    proofKind: options.proofKind || null
  };
}

export function validActionRankingReference(reference, options = {}) {
  if (reference?.version !== ACTION_RANKING_REFERENCE_VERSION
    || reference?.contract !== ACTION_RANKING_REFERENCE_CONTRACT
    || !ALLOWED_EVIDENCE_KINDS.has(reference?.evidenceKind)
    || !Number.isInteger(reference?.correctIndex)
    || !Number.isInteger(reference?.comparedIndex)
    || reference.correctIndex === reference.comparedIndex
    || !reference.correctActionKey
    || !reference.comparedActionKey
    || reference.correctActionKey === reference.comparedActionKey
    || !reference.informationSetHash
    || reference.seedBanks?.disjoint !== true
    || reference.determinizationAudit?.complete !== true
    || (reference.modelHashes || []).length > 0) return false;
  if (options.informationSetHash
    && reference.informationSetHash !== options.informationSetHash) return false;
  const legalActionKeys = options.legalActionKeys;
  if (legalActionKeys) {
    if (!(Array.isArray(legalActionKeys) || ArrayBuffer.isView(legalActionKeys))
      || legalActionKeys[reference.correctIndex] !== reference.correctActionKey
      || legalActionKeys[reference.comparedIndex] !== reference.comparedActionKey) {
      return false;
    }
  }
  if (reference.evidenceKind === "engine-proof") return true;
  const pairedSamples = Number(reference.pairedSamples);
  const minimumCompleteSamples = Math.ceil(pairedSamples * 0.75);
  return pairedSamples >= 16
    && Number(reference.validSamples?.correct) >= minimumCompleteSamples
    && Number(reference.validSamples?.compared) >= minimumCompleteSamples
    && Number(reference.terminalSamples?.correct) >= minimumCompleteSamples
    && Number(reference.terminalSamples?.compared) >= minimumCompleteSamples
    && Number(reference.pairedLowerBound) > 0
    && (reference.leafValueReference == null
      || validLeafValueReference(reference.leafValueReference));
}

export function createActionRankingAuditReference(options = {}) {
  const audit = options.audit;
  const protocolContext = actionAuditProtocolContext(audit);
  const correctIndex = Number(options.correctIndex);
  const comparedIndex = Number(options.comparedIndex);
  const correctActionKey = options.correctActionKey || null;
  const comparedActionKey = options.comparedActionKey || null;
  const evaluatorStatePairs = normalizeEvaluatorStatePairs(
    audit?.evaluatorStatePairs
  );
  const evaluatorTarget =
    summarizeEvaluatorStatePairTarget(evaluatorStatePairs);
  if (!protocolContext.valid
    || audit?.source !== "independent-terminal-action-audit"
    || audit?.policyCorrectionIndependent !== true
    || audit?.determinizationAudit?.complete !== true
    || audit?.seedBanks?.disjoint !== true
    || Number(audit?.selection?.attemptedPairs) !== 32
    || Number(audit?.selection?.samples) < 16
    || Number(audit?.selection?.terminalPairs) < 16
    || !(Number(audit?.selection?.lowerBound) > 0)
    || !validTerminalOutcomePairs(audit.selection)
    || minimumAuditRateLowerBound(audit.selection) < 0.3
    || Number(audit?.final?.attemptedPairs) !== protocolContext.finalPairs
    || Number(audit?.final?.terminalPairs)
      < protocolContext.minimumFinalTerminalPairs
    || Number(audit?.final?.samples) < protocolContext.minimumFinalTerminalPairs
    || !(Number(audit?.final?.lowerBound) > 0)
    || !validTerminalOutcomePairs(audit.final)
    || minimumAuditRateLowerBound(audit.final) < 0.3
    || evaluatorStatePairs.length === 0
    || evaluatorTarget.direction === "tie"
    || !uniqueEvaluatorStatePairSeeds(evaluatorStatePairs)
    || !structuredEvaluatorPairsMatchReference(
      evaluatorStatePairs,
      options.informationSetHash,
      {
        requireStructuredV2: options.requireStructuredV2 === true,
        engineFingerprint: options.engineFingerprint
      }
    )
    || !evaluatorPairsCoverTerminalOutcomes(
      evaluatorStatePairs,
      audit.final.terminalOutcomePairs
    )
    || !seedBanksAreMutuallyDisjoint(
      audit.seedBanks,
      protocolContext.finalPairs
    )
    || !Number.isInteger(correctIndex)
    || !Number.isInteger(comparedIndex)
    || correctIndex < 0
    || comparedIndex < 0
    || correctIndex === comparedIndex
    || !correctActionKey
    || !comparedActionKey
    || correctActionKey === comparedActionKey) return null;
  return {
    version: ACTION_RANKING_AUDIT_REFERENCE_VERSION,
    contract: ACTION_RANKING_AUDIT_REFERENCE_CONTRACT,
    source: "independent-terminal-action-audit",
    policyCorrectionIndependent: true,
    informationSetHash: options.informationSetHash || null,
    informationSetHashVersion:
      Number(options.informationSetHashVersion) || 1,
    auditKey: audit.auditKey || null,
    correctIndex,
    comparedIndex,
    correctActionKey,
    comparedActionKey,
    selection: structuredClone(audit.selection),
    final: structuredClone(audit.final),
    evaluatorStatePairs,
    evaluatorTarget,
    evidenceGrade: protocolContext.grade,
    evidenceProtocol: protocolContext.manifest
      ? structuredClone(protocolContext.manifest)
      : null,
    evidenceCommitment: protocolContext.commitment
      ? structuredClone(protocolContext.commitment)
      : null,
    evidenceClassification: protocolContext.classification
      ? structuredClone(protocolContext.classification)
      : null,
    continuationEvidence:
      structuredClone(audit.continuationEvidence || null),
    samplingFrame: structuredClone(audit.samplingFrame || null),
    computeUsage: structuredClone(audit.computeUsage || null),
    auditStratum: structuredClone(audit.auditStratum || null),
    seedBanks: structuredClone(audit.seedBanks),
    determinizationAudit: structuredClone(audit.determinizationAudit),
    modelHashes: [],
    excludedFrom: [
      "policy-loss",
      "preference-loss",
      "action-value-loss",
      "proposal-value-loss",
      "epoch-selection"
    ],
    usedFor: ["evaluator-action-ranking-certification"]
  };
}

export function validActionRankingAuditReference(reference, options = {}) {
  const protocolContext = actionAuditProtocolContext(reference);
  const evaluatorStatePairs = normalizeEvaluatorStatePairs(
    reference?.evaluatorStatePairs
  );
  const evaluatorTarget =
    summarizeEvaluatorStatePairTarget(evaluatorStatePairs);
  if (reference?.version !== ACTION_RANKING_AUDIT_REFERENCE_VERSION
    || reference?.contract !== ACTION_RANKING_AUDIT_REFERENCE_CONTRACT
    || reference?.source !== "independent-terminal-action-audit"
    || reference?.policyCorrectionIndependent !== true
    || reference?.determinizationAudit?.complete !== true
    || reference?.seedBanks?.disjoint !== true
    || (reference?.modelHashes || []).length > 0
    || !seedBanksAreMutuallyDisjoint(
      reference.seedBanks,
      protocolContext.finalPairs
    )
    || !Number.isInteger(reference?.correctIndex)
    || !Number.isInteger(reference?.comparedIndex)
    || reference.correctIndex === reference.comparedIndex
    || !reference.correctActionKey
    || !reference.comparedActionKey
    || reference.correctActionKey === reference.comparedActionKey
    || Number(reference?.selection?.attemptedPairs) !== 32
    || Number(reference?.selection?.samples) < 16
    || Number(reference?.selection?.terminalPairs) < 16
    || !(Number(reference?.selection?.lowerBound) > 0)
    || !validTerminalOutcomePairs(reference.selection)
    || minimumAuditRateLowerBound(reference.selection) < 0.3
    || !protocolContext.valid
    || Number(reference?.final?.attemptedPairs) !== protocolContext.finalPairs
    || Number(reference?.final?.terminalPairs)
      < protocolContext.minimumFinalTerminalPairs
    || Number(reference?.final?.samples)
      < protocolContext.minimumFinalTerminalPairs
    || !(Number(reference?.final?.lowerBound) > 0)
    || !validTerminalOutcomePairs(reference.final)
    || minimumAuditRateLowerBound(reference.final) < 0.3
    || evaluatorStatePairs.length === 0
    || evaluatorTarget.direction === "tie"
    || !uniqueEvaluatorStatePairSeeds(evaluatorStatePairs)
    || !evaluatorPairsCoverTerminalOutcomes(
      evaluatorStatePairs,
      reference.final.terminalOutcomePairs
    )
    || reference?.evaluatorTarget?.direction !== evaluatorTarget.direction
    || Math.abs(
      Number(reference?.evaluatorTarget?.meanOutcomeDelta)
        - evaluatorTarget.meanOutcomeDelta
    ) > 1e-12
    || !reference.informationSetHash
    || !structuredEvaluatorPairsMatchReference(
      evaluatorStatePairs,
      reference.informationSetHash,
      {
        requireStructuredV2: options.requireStructuredV2 === true,
        engineFingerprint: options.engineFingerprint
      }
    )) return false;
  if (options.informationSetHash
    && reference.informationSetHash !== options.informationSetHash) {
    return false;
  }
  const legalActionKeys = options.legalActionKeys;
  if (legalActionKeys
    && (!(Array.isArray(legalActionKeys)
      || ArrayBuffer.isView(legalActionKeys))
      || legalActionKeys[reference.correctIndex]
        !== reference.correctActionKey
      || legalActionKeys[reference.comparedIndex]
        !== reference.comparedActionKey)) {
    return false;
  }
  return true;
}

export function actionRankingAuditEvidenceGrade(reference) {
  return actionEvidenceGrade(reference);
}

export function validLeafValueReference(reference) {
  return reference?.version === LEAF_VALUE_REFERENCE_VERSION
    && reference?.contract === LEAF_VALUE_REFERENCE_CONTRACT
    && Array.isArray(reference?.pairs)
    && reference.pairs.every(validLeafValuePair)
    && (reference.pairs.length > 0
      || validLeafActionEffectComparison(reference.actionEffectComparison));
}

export function createLeafValueReference(pairs = [], options = {}) {
  const normalized = normalizeLeafValuePairs(pairs);
  const actionEffectComparison = normalizeLeafActionEffectComparison(
    options.actionEffectComparison
  );
  if (!normalized.length && !actionEffectComparison) return null;
  return {
    version: LEAF_VALUE_REFERENCE_VERSION,
    contract: LEAF_VALUE_REFERENCE_CONTRACT,
    source: options.source || "production-cutoff-independent-terminal-audit",
    policyCorrectionIndependent:
      options.policyCorrectionIndependent !== false,
    auditStratum: options.auditStratum
      ? structuredClone(options.auditStratum)
      : null,
    pairs: normalized,
    actionEffectComparison
  };
}

export function validLeafActionEffectComparison(value) {
  const audit = value?.pairedAudit;
  const outcomePairs = Array.isArray(audit?.outcomePairs)
    ? audit.outcomePairs
    : [];
  const terminalSeeds = Array.isArray(audit?.terminalSeeds)
    ? audit.terminalSeeds.map((seed) => Number(seed) >>> 0)
    : [];
  const outcomeSeeds = outcomePairs.map(
    (pair) => Number(pair?.simulationSeed) >>> 0
  );
  const outcomeBySeed = new Map(outcomePairs.map((pair) => [
    Number(pair?.simulationSeed) >>> 0,
    pair
  ]));
  const samples = Number(audit?.samples);
  const attemptedPairs = Number(audit?.attemptedPairs);
  const validPairs = Number(audit?.validPairs);
  const terminalPairs = Number(audit?.terminalPairs);
  const rawDifferences = outcomePairs.map((pair) =>
    Number(pair?.leftOutcome) - Number(pair?.rightOutcome));
  const rawMean = rawDifferences.length
    ? rawDifferences.reduce((sum, difference) => sum + difference, 0)
      / rawDifferences.length
    : null;
  const rawVariance = rawDifferences.length > 1
    ? rawDifferences.reduce(
      (sum, difference) => sum + (difference - rawMean) ** 2,
      0
    ) / (rawDifferences.length - 1)
    : 1;
  const rawStandardError = rawDifferences.length
    ? Math.sqrt(Math.max(0, rawVariance) / rawDifferences.length)
    : null;
  const rawPositiveRate = rawDifferences.length
    ? rawDifferences.filter((difference) => difference > 0).length
      / rawDifferences.length
    : null;
  const evaluatorSeeds = Array.isArray(value?.evaluatorStatePairs)
    ? value.evaluatorStatePairs.map((pair) =>
      Number(pair?.simulationSeed) >>> 0)
    : [];
  const sequential = value?.provenance?.sequentialAuditContract;
  return value?.version === 1
    && value?.contract === "paired-action-effect-leaf-audit-v1"
    && typeof value?.recommendedActionKey === "string"
    && value.recommendedActionKey.length > 0
    && typeof value?.comparedActionKey === "string"
    && value.comparedActionKey.length > 0
    && value.recommendedActionKey !== value.comparedActionKey
    && validLeafAuditSamplingFrame(value.samplingFrame)
    && Number.isInteger(Number(value?.minimumNearEquivalentSamples))
    && Number(value.minimumNearEquivalentSamples) >= 32
    && validBoundedAuditNumber(audit?.mean, -1, 1)
    && validBoundedAuditNumber(audit?.lowerBound, -1, 1)
    && validBoundedAuditNumber(audit?.upperBound, -1, 1)
    && Number(audit.lowerBound) <= Number(audit.mean)
    && Number(audit.mean) <= Number(audit.upperBound)
    && validActionEffectAuditInterval(audit, outcomePairs)
    && Number(audit?.confidence) >= 0.95
    && Number(audit?.confidence) < 1
    && Number.isInteger(samples) && samples > 0
    && Number.isInteger(terminalPairs) && terminalPairs === samples
    && Number.isInteger(validPairs) && validPairs >= terminalPairs
    && Number.isInteger(attemptedPairs) && attemptedPairs >= validPairs
    && outcomePairs.length === samples
    && terminalSeeds.length === samples
    && uniqueSeeds(outcomeSeeds)
    && uniqueSeeds(terminalSeeds)
    && sameSeeds(outcomeSeeds, terminalSeeds)
    && outcomePairs.every(validTerminalOutcomePair)
    && approximatelyEqual(audit.mean, rawMean)
    && approximatelyEqual(audit.standardError, rawStandardError)
    && approximatelyEqual(audit.positiveRate, rawPositiveRate)
    && audit?.pairingContract?.version === 1
    && audit.pairingContract.exactSeedPairing === true
    && audit.pairingContract.uniqueSeeds === true
    && Array.isArray(audit.pairingContract.duplicateSeeds)
    && audit.pairingContract.duplicateSeeds.length === 0
    && audit.pairingContract.terminalSeedsMatchOutcomePairs === true
    && audit?.determinizationAudit?.complete === true
    && audit.determinizationAudit.recommendedComplete === true
    && audit.determinizationAudit.selectedComplete === true
    && validAuditRates(audit?.rates, attemptedPairs, validPairs, terminalPairs)
    && value?.provenance?.version === 1
    && typeof value.provenance.informationSetHash === "string"
    && value.provenance.informationSetHash.length > 0
    && typeof value.provenance.engineFingerprint === "string"
    && value.provenance.engineFingerprint.length > 0
    && value.provenance.independentSeedContract === true
    && value.provenance.determinizationRequired === true
    && validSequentialLeafAuditContract(sequential, attemptedPairs)
    && approximatelyEqual(
      sequential.perStageConfidence,
      audit.confidence
    )
    && Array.isArray(value?.evaluatorStatePairs)
    && value.evaluatorStatePairs.length > 0
    && value.evaluatorStatePairs.length <= samples
    && uniqueSeeds(evaluatorSeeds)
    && value.evaluatorStatePairs.every((pair) => {
      if (!validEvaluatorStatePair(pair)) return false;
      const outcome = outcomeBySeed.get(Number(pair.simulationSeed) >>> 0);
      return outcome
        && Number(pair.recommendedOutcome) === Number(outcome.leftOutcome)
        && Number(pair.selectedOutcome) === Number(outcome.rightOutcome);
    });
}

function validSequentialLeafAuditContract(sequential, attemptedPairs) {
  if (sequential?.version === 1) {
    return validLeafAuditStageSchedule(sequential?.stages)
      && sequential.stages.includes(Number(sequential.completedStage))
      && attemptedPairs === Number(sequential.completedStage)
      && sequential.confidenceSpending === "bonferroni-three-look-v1";
  }
  return (sequential?.version === 2
    && Number.isInteger(Number(sequential.pilotSimulations))
    && Number(sequential.pilotSimulations) >= 4
    && Number(sequential.pilotSimulations) <= 16
    && Number(sequential.finalSimulations) === 128
    && Number(sequential.completedStage) === 128
    && attemptedPairs === 128
    && sequential.evidenceSeedUse
      === "pilot-selection-only-final-independent-v1"
    && sequential.confidenceSpending
      === "single-precommitted-final-look-v1")
    || (sequential?.version === 3
    && Number(sequential.finalSimulations) === 128
    && Number(sequential.completedStage) === 128
    && attemptedPairs === 128
    && sequential.evidenceSeedUse === "single-fixed-final-bank-v1"
    && sequential.confidenceSpending
      === "single-precommitted-final-look-v1");
}

export function validLeafAuditSamplingFrame(frame) {
  // Legacy evidence may omit a frame and remains valid for value/ranking
  // training, but it is never admitted to a formal distributional audit.
  if (frame == null) return true;
  const evidenceRoles = [
    "training", "development", "confirmation", "final-audit"
  ];
  const natural = frame.distribution === "natural-distribution";
  const targeted = frame.distribution === "prespecified-stratified";
  const probability = Number(frame.selectionProbability);
  const legacyNatural = frame.version === 1
    && frame.contract === "leaf-audit-sampling-frame-v1";
  const reservoirNatural = frame.version === 2
    && frame.contract === "natural-leaf-audit-sampling-frame-v2";
  if ((!legacyNatural && !reservoirNatural)
    || typeof frame.datasetKey !== "string" || !frame.datasetKey
    || !Number.isInteger(Number(frame.taskIndex))
    || Number(frame.taskIndex) < 0
    || !evidenceRoles.includes(frame.certificationRole)
    || (!natural && !targeted)
    || (natural && (
      !(
        (legacyNatural && frame.candidateSelection
          === "precommitted-bernoulli-policy-decision-v1")
        || (reservoirNatural && frame.candidateSelection
          === "hash-priority-reservoir-policy-decision-v1")
      )
      || !(probability > 0 && probability <= 1)
      || (legacyNatural && frame.targeted !== false)
      || (reservoirNatural && (
        !Number.isInteger(Number(frame.eligibleDecisions))
        || Number(frame.eligibleDecisions) < 1
        || Math.abs(probability
          - 1 / Number(frame.eligibleDecisions)) > 1e-12
        || frame.weighting !== "inverse-propensity-per-decision-v1"
        || typeof frame.parentTaskManifestHash !== "string"
      ))
    ))
    || (targeted && (
      !legacyNatural
      ||
      frame.candidateSelection
        !== "teacher-selected-policy-decision-pair-v1"
      || frame.selectionProbability != null
      || frame.targeted !== true
    ))) return false;
  const { taskManifestHash, ...committed } = frame;
  const expected = createHash("sha256")
    .update(JSON.stringify(committed))
    .digest("hex");
  return typeof taskManifestHash === "string"
    && taskManifestHash === expected;
}

function approximatelyEqual(left, right, tolerance = 1e-12) {
  return Number.isFinite(Number(left))
    && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) <= tolerance;
}

function validBoundedAuditNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function validConservativeAuditInterval(audit) {
  const samples = Number(audit?.samples);
  if (!Number.isInteger(samples) || samples <= 0) return false;
  const confidence = Number(audit?.confidence);
  if (!(confidence > 0 && confidence < 1)) return false;
  const mean = Number(audit.mean);
  const radius = 2 * Math.sqrt(
    Math.log(2 / (1 - confidence)) / (2 * samples)
  );
  const requiredLower = Math.max(-1, mean - radius);
  const requiredUpper = Math.min(1, mean + radius);
  return Number(audit.lowerBound) <= requiredLower + 1e-12
    && Number(audit.upperBound) >= requiredUpper - 1e-12;
}

function validActionEffectAuditInterval(audit, outcomePairs) {
  if (audit?.confidenceMethod === "bounded-hoeffding-mean-v1") {
    return validConservativeAuditInterval(audit);
  }
  if (audit?.confidenceMethod !== PAIRED_ACTION_EFFECT_CONFIDENCE_METHOD
    || Number(audit?.assessmentVersion)
      !== PAIRED_ACTION_EFFECT_ASSESSMENT_VERSION) return false;
  const interval = pairedBinaryDifferenceInterval(
    outcomePairs,
    audit.confidence
  );
  return interval != null
    && approximatelyEqual(audit.lowerBound, interval.lowerBound)
    && approximatelyEqual(audit.upperBound, interval.upperBound)
    && Number(audit?.pairedOutcomeCounts?.wins) === interval.wins
    && Number(audit?.pairedOutcomeCounts?.losses) === interval.losses
    && Number(audit?.pairedOutcomeCounts?.ties) === interval.ties;
}

function uniqueSeeds(seeds = []) {
  return new Set(seeds).size === seeds.length;
}

function sameSeeds(left = [], right = []) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((seed, index) => seed === sortedRight[index]);
}

function validLeafAuditStageSchedule(stages) {
  if (!Array.isArray(stages) || stages.length !== 3) return false;
  const values = stages.map(Number);
  return Number.isInteger(values[0])
    && values[0] >= 4 && values[0] <= 16
    && values[1] === 32
    && values[2] === 64;
}

function validTerminalOutcomePair(pair) {
  return Number.isFinite(Number(pair?.simulationSeed))
    && validBoundedAuditNumber(pair?.leftOutcome, 0, 1)
    && validBoundedAuditNumber(pair?.rightOutcome, 0, 1);
}

function validAuditRate(value, attempts, expectedSuccesses) {
  return Number.isInteger(Number(value?.attempts))
    && Number(value?.attempts) === attempts
    && Number.isInteger(Number(value?.successes))
    && Number(value?.successes) >= 0
    && Number(value?.successes) <= attempts
    && Number(value?.successes) === expectedSuccesses
    && validBoundedAuditNumber(value?.rate, 0, 1)
    && validBoundedAuditNumber(value?.lowerBound, 0, 1)
    && Math.abs(Number(value.rate)
      - (attempts ? expectedSuccesses / attempts : 0)) <= 1e-12;
}

function validAuditRates(rates, attempted, valid, terminal) {
  const validRecommended = Number(rates?.valid?.recommended?.successes);
  const validSelected = Number(rates?.valid?.selected?.successes);
  const terminalRecommended = Number(rates?.terminal?.recommended?.successes);
  const terminalSelected = Number(rates?.terminal?.selected?.successes);
  return validRecommended >= valid && validSelected >= valid
    && terminalRecommended >= terminal && terminalSelected >= terminal
    && terminalRecommended <= validRecommended
    && terminalSelected <= validSelected
    && validAuditRate(rates?.valid?.recommended, attempted, validRecommended)
    && validAuditRate(rates?.valid?.selected, attempted,
      validSelected)
    && validAuditRate(rates?.valid?.paired, attempted, valid)
    && validAuditRate(rates?.terminal?.recommended, attempted,
      terminalRecommended)
    && validAuditRate(rates?.terminal?.selected, attempted,
      terminalSelected)
    && validAuditRate(rates?.terminal?.paired, attempted, terminal);
}

export function validIndependentLeafValueReference(reference) {
  return validLeafValueReference(reference)
    && reference.policyCorrectionIndependent === true
    && reference.source ===
      "teacher-independent-production-cutoff-audit";
}

export function validLeafValuePair(pair) {
  return Number.isFinite(Number(pair?.simulationSeed))
    && Number(pair?.correctOutcome) === 1
    && Number(pair?.comparedOutcome) === 0
    && validEncodedState(pair?.correctState)
    && validEncodedState(pair?.comparedState);
}

function normalizeSamplePair(value = {}) {
  return {
    correct: Math.max(0, Number(value.correct) || 0),
    compared: Math.max(0, Number(value.compared) || 0)
  };
}

function normalizeLeafValuePairs(pairs = []) {
  return (pairs || []).flatMap((pair) => validLeafValuePair(pair)
    ? [{
      simulationSeed: Number(pair.simulationSeed) >>> 0,
      correctState: Float32Array.from(pair.correctState),
      comparedState: Float32Array.from(pair.comparedState),
      correctStructuredState:
        cloneStructuredState(pair.correctStructuredState),
      comparedStructuredState:
        cloneStructuredState(pair.comparedStructuredState),
      correctOutcome: 1,
      comparedOutcome: 0,
      correctCaptureStep: Math.max(0, Number(pair.correctCaptureStep) || 0),
      comparedCaptureStep: Math.max(0, Number(pair.comparedCaptureStep) || 0),
      correctDepthBin: pair.correctDepthBin || "unknown",
      comparedDepthBin: pair.comparedDepthBin || "unknown",
      auditContinuationSteps: {
        correct: Math.max(0, Number(pair.auditContinuationSteps?.correct) || 0),
        compared: Math.max(0, Number(pair.auditContinuationSteps?.compared) || 0)
      }
    }]
    : []);
}

function normalizeLeafActionEffectComparison(value) {
  if (!validLeafActionEffectComparison(value)) return null;
  const audit = value.pairedAudit;
  return {
    version: 1,
    contract: "paired-action-effect-leaf-audit-v1",
    recommendedActionKey: String(value.recommendedActionKey),
    comparedActionKey: String(value.comparedActionKey),
    decisiveEffectThreshold: Math.max(
      0,
      Number(value.decisiveEffectThreshold) || 0.01
    ),
    nearEquivalentMargin: Math.max(
      0,
      Number(value.nearEquivalentMargin) || 0.01
    ),
    minimumNearEquivalentSamples: Math.max(
      32,
      Number(value.minimumNearEquivalentSamples) || 32
    ),
    samplingFrame: structuredClone(value.samplingFrame || null),
    provenance: structuredClone(value.provenance),
    pairedAudit: {
      attemptedPairs: Math.max(0, Number(audit.attemptedPairs) || 0),
      validPairs: Math.max(0, Number(audit.validPairs) || 0),
      terminalPairs: Math.max(0, Number(audit.terminalPairs) || 0),
      samples: Math.max(0, Number(audit.samples) || 0),
      mean: Number(audit.mean),
      standardError: Math.max(0, Number(audit.standardError) || 0),
      lowerBound: Number(audit.lowerBound),
      upperBound: Number(audit.upperBound),
      assessmentVersion: Number(audit.assessmentVersion) || 1,
      confidenceMethod: audit.confidenceMethod,
      confidence: Number(audit.confidence),
      pairedOutcomeCounts: audit.pairedOutcomeCounts
        ? structuredClone(audit.pairedOutcomeCounts)
        : null,
      positiveRate: Math.max(0, Math.min(1, Number(audit.positiveRate) || 0)),
      outcomePairs: structuredClone(audit.outcomePairs || []),
      terminalSeeds: Array.from(audit.terminalSeeds || [],
        (seed) => Number(seed) >>> 0),
      pairingContract: structuredClone(audit.pairingContract),
      determinizationAudit: structuredClone(audit.determinizationAudit),
      rates: structuredClone(audit.rates || null),
      failureReasons: structuredClone(audit.failureReasons || {}),
      maximumStepCutoffs: Math.max(
        0,
        Number(audit.maximumStepCutoffs) || 0
      )
    },
    evaluatorStatePairs: normalizeEvaluatorStatePairs(
      value.evaluatorStatePairs
    )
  };
}

function normalizeEvaluatorStatePairs(pairs = []) {
  return (pairs || []).flatMap((pair) => validEvaluatorStatePair(pair)
    ? [{
      simulationSeed: Number(pair.simulationSeed) >>> 0,
      recommendedState: Float32Array.from(pair.recommendedState),
      selectedState: Float32Array.from(pair.selectedState),
      recommendedStructuredState:
        cloneStructuredState(pair.recommendedStructuredState),
      selectedStructuredState:
        cloneStructuredState(pair.selectedStructuredState),
      recommendedOutcome: Number(pair.recommendedOutcome),
      selectedOutcome: Number(pair.selectedOutcome),
      recommendedHeuristicValue:
        Number(pair.recommendedHeuristicValue),
      selectedHeuristicValue: Number(pair.selectedHeuristicValue),
      recommendedCaptureStep:
        Math.max(0, Number(pair.recommendedCaptureStep) || 0),
      selectedCaptureStep:
        Math.max(0, Number(pair.selectedCaptureStep) || 0),
      recommendedDepthBin: pair.recommendedDepthBin || "unknown",
      selectedDepthBin: pair.selectedDepthBin || "unknown",
      auditContinuationSteps: {
        recommended:
          Math.max(
            0,
            Number(pair.auditContinuationSteps?.recommended) || 0
          ),
        selected:
          Math.max(0, Number(pair.auditContinuationSteps?.selected) || 0)
      }
    }]
    : []);
}

function validEvaluatorStatePair(pair) {
  return Number.isFinite(Number(pair?.simulationSeed))
    && Number.isFinite(Number(pair?.recommendedOutcome))
    && Number.isFinite(Number(pair?.selectedOutcome))
    && Number.isFinite(Number(pair?.recommendedHeuristicValue))
    && Number.isFinite(Number(pair?.selectedHeuristicValue))
    && validEncodedState(pair?.recommendedState)
    && validEncodedState(pair?.selectedState);
}

function summarizeEvaluatorStatePairTarget(pairs = []) {
  const deltas = pairs.map((pair) =>
    Number(pair.recommendedOutcome) - Number(pair.selectedOutcome));
  const meanOutcomeDelta = deltas.length
    ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
    : 0;
  return {
    pairs: deltas.length,
    meanOutcomeDelta,
    positiveRate: deltas.length
      ? deltas.filter((value) => value > 0).length / deltas.length
      : 0,
    negativeRate: deltas.length
      ? deltas.filter((value) => value < 0).length / deltas.length
      : 0,
    direction: meanOutcomeDelta > 0
      ? "recommended"
      : meanOutcomeDelta < 0
        ? "selected"
        : "tie"
  };
}

function uniqueEvaluatorStatePairSeeds(pairs = []) {
  return new Set(pairs.map((pair) => Number(pair.simulationSeed) >>> 0))
    .size === pairs.length;
}

function evaluatorPairsCoverTerminalOutcomes(
  evaluatorPairs = [],
  terminalOutcomePairs = []
) {
  if (evaluatorPairs.length !== terminalOutcomePairs.length) return false;
  const evaluatorBySeed = new Map(evaluatorPairs.map((pair) => [
    Number(pair.simulationSeed) >>> 0,
    pair
  ]));
  return terminalOutcomePairs.every((outcomePair) => {
    const pair = evaluatorBySeed.get(
      Number(outcomePair.simulationSeed) >>> 0
    );
    return pair
      && Number(pair.recommendedOutcome)
        === Number(outcomePair.recommendedOutcome)
      && Number(pair.selectedOutcome)
        === Number(outcomePair.selectedOutcome);
  });
}

function validTerminalOutcomePairs(stage = {}) {
  const pairs = stage?.terminalOutcomePairs;
  if (!Array.isArray(pairs)
    || pairs.length !== Number(stage?.terminalPairs)
    || new Set(pairs.map((pair) => Number(pair?.simulationSeed) >>> 0))
      .size !== pairs.length
    || pairs.some((pair) =>
      !Number.isFinite(Number(pair?.simulationSeed))
      || !Number.isFinite(Number(pair?.recommendedOutcome))
      || !Number.isFinite(Number(pair?.selectedOutcome)))) return false;
  const mean = pairs.length
    ? pairs.reduce((sum, pair) =>
      sum + Number(pair.recommendedOutcome)
        - Number(pair.selectedOutcome), 0) / pairs.length
    : 0;
  return Math.abs(mean - Number(stage?.mean)) <= 1e-12;
}

function minimumAuditRateLowerBound(stage = {}) {
  return Math.min(
    Number(stage?.rates?.valid?.recommended?.lowerBound) || 0,
    Number(stage?.rates?.valid?.selected?.lowerBound) || 0,
    Number(stage?.rates?.valid?.paired?.lowerBound) || 0,
    Number(stage?.rates?.terminal?.recommended?.lowerBound) || 0,
    Number(stage?.rates?.terminal?.selected?.lowerBound) || 0,
    Number(stage?.rates?.terminal?.paired?.lowerBound) || 0
  );
}

function validEncodedState(value) {
  return (Array.isArray(value) || ArrayBuffer.isView(value))
    && value.length === STATE_DIM
    && Array.from(value).every((item) => Number.isFinite(Number(item)));
}

function cloneStructuredState(value) {
  return validPublicStructuredEvidenceSnapshot(value)
    ? structuredClone(value)
    : null;
}

// Legacy v1 references legitimately contain no structured companion. Once a
// v2 companion is present, however, both branches must be bound to this exact
// information set and to the same engine. This prevents a valid-looking
// snapshot from another game or engine from being attached to an otherwise
// independent terminal reference.
function structuredEvaluatorPairsMatchReference(
  pairs,
  informationSetHash,
  options = {}
) {
  return (pairs || []).every((pair) => {
    const left = pair.recommendedStructuredState;
    const right = pair.selectedStructuredState;
    if (left == null && right == null) {
      return options.requireStructuredV2 !== true;
    }
    if (!left || !right) return false;
    if (!validPublicStructuredEvidenceSnapshot(left, {
      informationSetHash,
      engineFingerprint: options.engineFingerprint
    }) || !validPublicStructuredEvidenceSnapshot(right, {
      informationSetHash,
      engineFingerprint: options.engineFingerprint
    })) return false;
    return left.engineFingerprint === right.engineFingerprint;
  });
}

export function actionRankingAuditHasStructuredV2Companions(
  audit,
  options = {}
) {
  const pairs = normalizeEvaluatorStatePairs(audit?.evaluatorStatePairs);
  return pairs.length > 0 && structuredEvaluatorPairsMatchReference(
    pairs,
    options.informationSetHash,
    {
      requireStructuredV2: true,
      engineFingerprint: options.engineFingerprint
    }
  );
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function seedBanksAreMutuallyDisjoint(seedBanks = {}, finalPairs = 64) {
  const banks = [
    seedBanks.screening,
    seedBanks.confirmation,
    seedBanks.selection,
    seedBanks.final
  ].map((bank) => Array.from(bank || [], (seed) => Number(seed) >>> 0));
  const seen = new Set();
  for (const bank of banks) {
    for (const seed of bank) {
      if (seen.has(seed)) return false;
      seen.add(seed);
    }
  }
  return banks[2].length === 32
    && banks[3].length === Math.max(1, Number(finalPairs) || 64);
}

function actionAuditProtocolContext(value) {
  const manifest = value?.evidenceProtocol || null;
  const commitment = value?.evidenceCommitment || null;
  const classification = value?.evidenceClassification || null;
  const grade = value?.evidenceGrade || classification?.grade || null;
  const protocolEnvelope = value?.contract
    === "precommitted-continuation-terminal-action-audit-v1"
    || value?.contract === ACTION_RANKING_AUDIT_REFERENCE_CONTRACT;
  if (protocolEnvelope
    && validActionEvidenceProtocolManifest(manifest)
    && validActionEvidenceSeedCommitment(commitment, manifest)
    && validActionEvidenceGrade(grade)
    && classification?.grade === grade
    && [
      ACTION_EVIDENCE_GRADES.terminalRobust,
      ACTION_EVIDENCE_GRADES.continuationConsistent,
      ACTION_EVIDENCE_GRADES.policyConditioned
    ].includes(grade)) {
    return {
      valid: true,
      finalPairs: 128,
      minimumFinalTerminalPairs: 64,
      grade,
      manifest,
      commitment,
      classification
    };
  }
  const legacyEnvelope = (
    value?.version === 3
    && value?.contract === "independent-terminal-action-audit-v3"
  ) || (
    value?.version === ACTION_RANKING_AUDIT_REFERENCE_VERSION
    && value?.contract === ACTION_RANKING_AUDIT_REFERENCE_CONTRACT
    && !manifest
    && !commitment
    && !classification
  );
  return {
    valid: legacyEnvelope,
    finalPairs: 64,
    minimumFinalTerminalPairs: 32,
    grade: ACTION_EVIDENCE_GRADES.legacyTerminalConditioned,
    manifest: null,
    commitment: null,
    classification: null
  };
}
