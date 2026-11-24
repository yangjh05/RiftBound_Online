import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { STATE_DIM } from "../src/ai/neural/encoding.mjs";
import { pairedBinaryDifferenceIntervalFromCounts as interval } from "../src/ai/neural/paired-action-effect-statistics.mjs";
import { createLeafValueReference, validLeafActionEffectComparison } from "../src/ai/neural/action-ranking-reference.mjs";
import { collectPolicyQEvidenceInventory, policyQShadowEvidencePreflight, policyQLeafAuditPrecision, mixNaturalPolicyQFocuses } from "../scripts/evaluator-policy-q-evidence.mjs";
import { evaluatorBootstrapDiagnosticFocus, evaluatorBootstrapDiagnosticTaskFocus } from "../scripts/evaluator-bootstrap.mjs";
import { splitEvaluatorEarlyDiagnosticRecords } from "../scripts/evaluator-early-diagnostic.mjs";

test("large paired intervals match independent 60-digit Decimal binomial inversion", () => {
  // Direct PMF summation with Decimal arithmetic; no mode normalization.
  const fixtures = [
    [512, 512, 0, -0.08850123413602322, 0.08850123413602322],
    [800, 120, 104, 0.5950015045323782, 0.7257418365862807],
    [1500, 400, 148, 0.48313513356859294, 0.5881187653757984],
    [30, 20, 974, -0.01843555265533587, 0.037813169525035085]
  ];
  for (const [w, l, t, lower, upper] of fixtures) {
    const value = interval(w, l, t, 0.99);
    assert.ok(Math.abs(value.lowerBound - lower) < 1e-12);
    assert.ok(Math.abs(value.upperBound - upper) < 1e-12);
    const reversed = interval(l, w, t, 0.99);
    assert.ok(Math.abs(value.lowerBound + reversed.upperBound) < 1e-12);
  }
});

test("99% equivalence at a one-percent margin needs more than 512 all-tie pairs", () => {
  assert.ok(interval(0, 0, 128, 0.99).upperBound > 0.01);
  assert.ok(interval(0, 0, 512, 0.99).upperBound > 0.01);
  assert.ok(interval(0, 0, 1024, 0.99).upperBound < 0.01);
});

test("precision assignment is repeatable and spends the large bank on a minority", () => {
  const values = Array.from({ length: 1000 }, (_, i) => policyQLeafAuditPrecision("dataset", `0:${i}`));
  assert.deepEqual(values, values.map((_, i) => policyQLeafAuditPrecision("dataset", `0:${i}`)));
  assert.ok(values.every((n) => n === 128 || n === 1024));
  const high = values.filter((n) => n === 1024).length;
  assert.ok(high > 180 && high < 320);
  assert.ok(values.every((_, i) => policyQLeafAuditPrecision("dataset", i, 0) === 0));
});

test("initial natural mix preserves targeted phases and never inherits a phase or deck focus", () => {
  const focuses = ["mulligan", "early", "mid", "late"].flatMap((phaseBand) =>
    Array.from({ length: 4 }, () => ({ phaseBand, deckId: "a" })));
  const result = mixNaturalPolicyQFocuses(focuses);
  assert.equal(result.filter((f) => f.naturalDistribution).length, 8);
  assert.deepEqual(new Set(result.filter((f) => !f.naturalDistribution).map((f) => f.phaseBand)),
    new Set(["mulligan", "early", "mid", "late"]));
  assert.ok(result.filter((f) => f.naturalDistribution).every((f) => Object.keys(f).length === 1));
  assert.equal(mixNaturalPolicyQFocuses([{ phaseBand: "late" }], 0)[0].naturalDistribution, true);
  assert.equal(mixNaturalPolicyQFocuses([{ phaseBand: "late" }], 1)[0].phaseBand, "late");
});

test("long and unfocused collection queues start both natural and targeted jobs immediately", () => {
  for (const focuses of [
    Array.from({ length: 160 }, () => null),
    Array.from({ length: 109 }, (_, i) => ({ phaseBand: ["mulligan", "early", "mid", "late"][i % 4] }))
  ]) {
    const before = structuredClone(focuses);
    const mixed = mixNaturalPolicyQFocuses(focuses);
    assert.equal(mixed.length, focuses.length);
    assert.equal(mixed.filter(f => f?.naturalDistribution).length, Math.floor(focuses.length / 2));
    assert.equal(mixed.slice(0, 16).filter(f => f?.naturalDistribution).length, 8);
    assert.deepEqual(focuses, before);
  }
});

function comparison(n = 1024, distribution = "prespecified-stratified") {
  const stats = interval(n, 0, 0, 0.99);
  const natural = distribution === "natural-distribution";
  const frame = {
    version: 1, contract: "leaf-audit-sampling-frame-v1", datasetKey: "test", taskIndex: 0,
    certificationRole: "training", distribution,
    candidateSelection: natural ? "precommitted-bernoulli-policy-decision-v1" : "teacher-selected-policy-decision-pair-v1",
    selectionProbability: natural ? 0.02 : null, targeted: !natural, plannedFinalSimulations: n
  };
  frame.taskManifestHash = createHash("sha256").update(JSON.stringify(frame)).digest("hex");
  const seeds = Array.from({ length: n }, (_, i) => i + 1);
  const rate = { successes: n, attempts: n, rate: 1, lowerBound: 0.9 };
  return {
    version: 1, contract: "paired-action-effect-leaf-audit-v1", recommendedActionKey: "endTurn",
    comparedActionKey: "passShowdown", decisiveEffectThreshold: 0.01, nearEquivalentMargin: 0.01,
    minimumNearEquivalentSamples: 32, samplingFrame: frame,
    provenance: {
      version: 1, informationSetHash: "info", engineFingerprint: "engine", independentSeedContract: true,
      determinizationRequired: true, sequentialAuditContract: {
        version: n === 128 ? 3 : 4, finalSimulations: n, completedStage: n,
        evidenceSeedUse: "single-fixed-final-bank-v1", confidenceSpending: "single-precommitted-final-look-v1", perStageConfidence: 0.99
      }
    },
    pairedAudit: {
      ...stats, confidenceMethod: stats.method, attemptedPairs: n, validPairs: n, terminalPairs: n,
      assessmentVersion: stats.version, pairedOutcomeCounts: { wins: n, losses: 0, ties: 0 },
      standardError: 0, positiveRate: 1, terminalSeeds: seeds,
      outcomePairs: seeds.map((simulationSeed) => ({ simulationSeed, leftOutcome: 1, rightOutcome: 0 })),
      pairingContract: { version: 1, exactSeedPairing: true, duplicateSeeds: [], uniqueSeeds: true, terminalSeedsMatchOutcomePairs: true },
      determinizationAudit: { recommendedComplete: true, selectedComplete: true, complete: true },
      rates: Object.fromEntries(["valid", "terminal"].map((key) => [key, { recommended: rate, selected: rate, paired: rate }]))
    },
    evaluatorStatePairs: [{
      simulationSeed: 1, recommendedState: new Float32Array(STATE_DIM), selectedState: new Float32Array(STATE_DIM),
      recommendedOutcome: 1, selectedOutcome: 0, recommendedHeuristicValue: 0.7, selectedHeuristicValue: 0.3,
      recommendedCaptureStep: 4, selectedCaptureStep: 4, recommendedDepthBin: "0-7", selectedDepthBin: "0-7",
      auditContinuationSteps: { recommended: 12, selected: 12 }
    }]
  };
}

test("128 and 1024 fixed banks are accepted while a changed final budget is rejected", () => {
  assert.equal(validLeafActionEffectComparison(comparison(128)), true);
  const value = comparison();
  assert.equal(validLeafActionEffectComparison(value), true);
  value.provenance.sequentialAuditContract.finalSimulations = 512;
  assert.equal(validLeafActionEffectComparison(value), false);
});

test("preflight distinguishes missing natural data and counts game clusters once", async () => {
  const reference = createLeafValueReference([], {
    source: "teacher-independent-production-cutoff-audit",
    actionEffectComparison: comparison(), auditStratum: { phaseBand: "late" }
  });
  assert.ok(reference);
  const trajectories = Array.from({ length: 20 }, () => ({ gameId: "same-game", steps: [{ leafValueAuditReference: reference }] }));
  const inventory = await collectPolicyQEvidenceInventory([trajectories, trajectories]);
  assert.equal(inventory.overall.targeted.comparisons, 1);
  assert.equal(inventory.overall.targeted.contributingGames, 1);
  assert.equal(inventory.overall.targeted.effectiveGames, 1);
  assert.equal(inventory.overall.targeted.decisiveEffectiveGames, 1);
  assert.equal(inventory.overall.natural.comparisons, 0);
  const result = policyQShadowEvidencePreflight(inventory);
  assert.equal(result.sufficient, false);
  assert.equal(result.performanceAssessed, false);
  const focus = evaluatorBootstrapDiagnosticFocus(result.diagnosticDemand, "training", "leaf-audit");
  assert.ok(focus.items.some((item) => item.auditDistribution === "natural-distribution"));
  assert.ok(evaluatorBootstrapDiagnosticTaskFocus(focus, 0));
});

test("adequate counts pass only the data preflight, never a performance gate", () => {
  const inventory = Object.fromEntries(["overall", "mulligan", "early", "mid", "late"].map((phase) => [phase,
    Object.fromEntries(["targeted", "natural"].map((kind) => [kind, {
      comparisons: 200, contributingGames: 200, decisiveComparisons: 200, decisiveContributingGames: 200,
      riskAssessedComparisons: 200, riskAssessedContributingGames: 200,
      effectiveGames: 200, decisiveEffectiveGames: 200
    }]))
  ]));
  const result = policyQShadowEvidencePreflight(inventory);
  assert.equal(result.sufficient, true);
  assert.equal(result.performanceAssessed, false);
  assert.equal(result.passed, undefined);
  inventory.late.targeted.decisiveContributingGames = 1;
  assert.equal(policyQShadowEvidencePreflight(inventory).sufficient, false);
});

test("preflight excludes legacy natural sampling that the formal evaluator does not support", async () => {
  const reference = createLeafValueReference([], {
    source: "teacher-independent-production-cutoff-audit",
    actionEffectComparison: comparison(128, "natural-distribution"),
    auditStratum: { phaseBand: "late" }
  });
  assert.ok(reference);
  const inventory = await collectPolicyQEvidenceInventory([[{
    gameId: "legacy-training-still-valid", steps: [{ leafValueAuditReference: reference }]
  }]]);
  assert.equal(inventory.overall.natural.comparisons, 0);
});

test("an audited natural observation and its comparison count once across repeated batches", async () => {
  const frame = { version: 2, contract: "natural-leaf-audit-sampling-frame-v2",
    datasetKey: "test", taskIndex: 0, certificationRole: "training", distribution: "natural-distribution",
    candidateSelection: "hash-priority-reservoir-policy-decision-v1", parentTaskManifestHash: "parent",
    eligibleDecisions: 10, selectionProbability: 0.1, weighting: "inverse-propensity-per-decision-v1" };
  frame.taskManifestHash = createHash("sha256").update(JSON.stringify(frame)).digest("hex");
  const paired = comparison(128, "natural-distribution");paired.samplingFrame = frame;
  const reference = createLeafValueReference([], { source: "teacher-independent-production-cutoff-audit",
    actionEffectComparison: paired, auditStratum: { phaseBand: "late" } });
  assert.ok(reference);
  const batches = [{ gameId: "deduplicated", steps: [{ leafValueAuditReference: reference,
    naturalLeafAuditSamplingObservation: { version: 2, contract: "natural-leaf-audit-sampling-observation-v2",
      status: "audited", samplingFrame: frame } }] }];
  const inventory = await collectPolicyQEvidenceInventory([batches, batches]);
  assert.equal(inventory.overall.natural.comparisons, 1);
  assert.equal(inventory.overall.natural.riskAssessedComparisons, 1);
  assert.equal(inventory.overall.natural.effectiveGames, 1);
});

test("natural validation membership is independent of discordant outcomes and survives resume", () => {
  const records = Array.from({ length: 100 }, (_, i) => ({
    workerIndex: 0, gameIndex: i,
    resultIndex: { naturalLeafAuditCollection: true, leafValuePairCount: 0 }
  }));
  const before = splitEvaluatorEarlyDiagnosticRecords(records, { seed: "fixed" });
  assert.ok(before.validation.length > 8 && before.validation.length < 35);
  const after = splitEvaluatorEarlyDiagnosticRecords(records.map((record) => ({
    ...record, resultIndex: { ...record.resultIndex, leafValuePairCount: 100,
      structuredV2LeafValuePairCount: 100, leafActionEffectAudit: { natural: 100, decisive: 100 } }
  })), { seed: "fixed" });
  assert.deepEqual(before.validationRecordKeys, after.validationRecordKeys);
  const resumed = splitEvaluatorEarlyDiagnosticRecords([...records, ...records.map((record) => ({
    ...record, gameIndex: record.gameIndex + 100
  }))], { seed: "fixed", previousSplit: before });
  assert.ok(before.trainingRecordKeys.every((key) => resumed.trainingRecordKeys.includes(key)));
  assert.ok(before.validationRecordKeys.every((key) => resumed.validationRecordKeys.includes(key)));
});
