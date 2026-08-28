import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ACTION_EVIDENCE_GRADES,
  ACTION_EVIDENCE_CONTINUATION_SCOPES,
  ACTION_EVIDENCE_PROVENANCE_STATUSES,
  ACTION_EVIDENCE_STATISTICAL_STRENGTHS,
  ACTION_EVIDENCE_PROTOCOL_CONTRACT,
  applyHolmSimultaneousBounds,
  actionEvidenceGrade,
  assessActionEvidence,
  benjaminiHochbergCorrection,
  classifyPrecommittedActionEvidence,
  createActionEvidenceProtocolManifest,
  createActionEvidenceSeedCommitment,
  summarizeActionEvidenceEfficiency,
  summarizeNaturalDistributionActionAudit,
  validActionEvidenceProtocolManifest
} from "../src/ai/neural/evidence-protocol.mjs";
import {
  selectBalancedEvaluatorBootstrapRecords,
  summarizeEvaluatorBootstrap
} from "../scripts/evaluator-bootstrap.mjs";
import {
  selectIndependentActionAuditCandidatePool
} from "../src/ai/neural/selfplay.mjs";
import { createNeuralModel } from "../src/ai/neural/model.mjs";
import {
  neuralArtifactHash,
  neuralBehaviorHash
} from "../src/ai/neural/evaluator-certification.mjs";
import {
  hydrateAuditPolicyPairs
} from "../scripts/ai-action-audit-worker-process.mjs";
import {
  createEvaluatorBootstrapResultIndex,
  EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION
} from "../scripts/evaluator-bootstrap-index.mjs";
import {
  restoreExistingActionAuditSeedBatches,
  seedBatchTaskId
} from "../scripts/detached-action-audit-coordinator.mjs";
import { writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import {
  independentActionAuditEvidenceFromBatches,
  independentActionAuditProtocolMixtureEvidence,
  independentActionAuditStageFailureReasons
} from "../src/ai/neural/teacher.mjs";

function member(id, options = {}) {
  return {
    id,
    modelHash: `model-${id}`,
    behaviorHash: `behavior-${id}`,
    strength: 1,
    weight: 1,
    behaviorallyIndependent: options.independent === true,
    searchEnabled: options.searchEnabled === true
  };
}

function protocol(options = {}) {
  const continuationPool = options.continuationPool || [member("one")];
  return createActionEvidenceProtocolManifest({
    continuationPool,
    opponentPool: [member("opponent")],
    diversityProbeDigest: continuationPool.some((item) =>
      item.behaviorallyIndependent) ? "diversity-probe" : null,
    searchContractHash: "search-contract",
    searchTriggerRuleHash: "symmetric-trigger",
    chanceScheduleVersion: "chance-v1",
    minimumStrongEffect: 0.02,
    sensitivityEpsilon: 0.02
  });
}

function commitment(manifest) {
  return createActionEvidenceSeedCommitment(manifest, {
    auditKey: "audit-1",
    informationSetHash: "information-set-1",
    pilotSeeds: Array.from({ length: 8 }, (_, index) => index + 1),
    selectionSeeds: Array.from({ length: 32 }, (_, index) => index + 1),
    finalSeeds: Array.from({ length: 128 }, (_, index) => index + 1000),
    continuationIds: manifest.continuationPool.members.map((item) => item.id),
    opponentIds: manifest.opponentPool.members.map((item) => item.id)
  });
}

test("protocol freezes pilot, candidate selection, statistics, and 8/32/128 banks", () => {
  const manifest = protocol();
  assert.equal(manifest.contract, ACTION_EVIDENCE_PROTOCOL_CONTRACT);
  assert.equal(validActionEvidenceProtocolManifest(manifest), true);
  assert.equal(manifest.seedBanks.pilotPairs, 8);
  assert.equal(manifest.seedBanks.selectionPairs, 32);
  assert.equal(manifest.seedBanks.finalPairs, 128);
  assert.equal(manifest.candidateSelection.evaluatorBlindFraction, 0.2);
  assert.equal(manifest.statistics.policyCorrection, "holm-fwer");
  assert.equal(manifest.pilot.stratifiedOpeningStates, 100);
  assert.equal(manifest.pilot.naturalOpeningStates, 100);
  assert.equal(Object.isFrozen(manifest), true);
});

test("protocol stage gates use the frozen pool mixture instead of the first pair", () => {
  const manifest = createActionEvidenceProtocolManifest({
    continuationPool: [member("a"), member("b")],
    opponentPool: [member("opponent")],
    searchContractHash: "search-contract",
    searchTriggerRuleHash: "symmetric-trigger",
    chanceScheduleVersion: "chance-v1"
  });
  const recommendedAction = { kind: "endTurn" };
  const selectedAction = { kind: "passShowdown" };
  const seeds = Array.from({ length: 32 }, (_, index) => index + 1);
  const actionResult = (action, terminalOutcome) => ({
    version: 1,
    action,
    simulationSeeds: seeds,
    samples: seeds.map((simulationSeed) => ({
      simulationSeed,
      invalid: false,
      terminal: true,
      terminalOutcome
    }))
  });
  const neutral = [
    actionResult(recommendedAction, 0),
    actionResult(selectedAction, 0)
  ];
  const positive = [
    actionResult(recommendedAction, 1),
    actionResult(selectedAction, 0)
  ];
  const candidate = {
    descriptor: {
      evidenceProtocolManifest: manifest,
      recommendedAction,
      selectedAction
    }
  };
  const protocolResults = [
    {
      continuationId: "a",
      opponentId: "opponent",
      results: neutral
    },
    {
      continuationId: "b",
      opponentId: "opponent",
      results: positive
    }
  ];
  const firstPair = independentActionAuditEvidenceFromBatches(
    candidate,
    neutral
  );
  const mixture = independentActionAuditProtocolMixtureEvidence(
    candidate,
    protocolResults
  );
  assert.equal(firstPair.terminalEvidence.lowerBound < 0, true);
  assert.equal(firstPair.terminalEvidence.upperBound > 0, true);
  assert.equal(mixture.terminalEvidence.attemptedPairs, 32);
  assert.equal(mixture.terminalEvidence.mean, 0.5);
  assert.equal(mixture.terminalEvidence.lowerBound > 0, true);
  assert.deepEqual(independentActionAuditStageFailureReasons(mixture, {
    attemptedPairs: 32,
    minimumTerminalPairs: 16,
    seedBanksDisjoint: true,
    minimumEffect: 0
  }), []);
  assert.equal(
    independentActionAuditProtocolMixtureEvidence(
      candidate,
      protocolResults.slice(0, 1)
    ),
    null
  );
});

test("pair-sharded protocol batches resume into one exact mixture barrier", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-pair-shards-"));
  const manifest = createActionEvidenceProtocolManifest({
    continuationPool: [member("a"), member("b")],
    opponentPool: [member("opponent")],
    searchContractHash: "search-contract",
    searchTriggerRuleHash: "symmetric-trigger",
    chanceScheduleVersion: "chance-v1"
  });
  const candidateId = "pair-sharded-candidate";
  const seeds = [11, 22, 33, 44];
  const recommendedAction = { kind: "endTurn" };
  const selectedAction = { kind: "passShowdown" };
  const result = (action, terminalOutcome) => ({
    version: 1,
    action,
    simulationSeeds: seeds,
    samples: seeds.map((simulationSeed) => ({
      simulationSeed,
      invalid: false,
      terminal: true,
      terminalOutcome
    }))
  });
  const entry = {
    root: directory,
    candidateId,
    candidatePath: path.join(directory, "candidate.json.gz"),
    candidate: {
      descriptor: {
        evidenceProtocolManifest: manifest,
        recommendedAction,
        selectedAction,
        search: { maximumSteps: 192 }
      }
    },
    selectionSeeds: seeds,
    finalSeeds: [],
    rescueFinalSeeds: [],
    selectionResults: [],
    selectionProtocolResults: [],
    finalResults: [],
    finalProtocolResults: [],
    rescueFinalResults: [],
    rescueFinalProtocolResults: []
  };
  try {
    for (const [continuationId, terminalOutcome] of [["a", 0], ["b", 1]]) {
      const pairId = `${continuationId}::opponent`;
      const taskId = seedBatchTaskId(
        candidateId,
        "selection",
        seeds,
        [pairId]
      );
      await writeTrajectoryArchive(
        path.join(directory, `${taskId}.seed-batch.json.gz`),
        {
          version: 1,
          contract: "independent-action-audit-seed-batch-v1",
          taskId,
          candidateId,
          bank: "selection",
          seeds,
          results: [],
          evidenceProtocolHash: manifest.protocolHash,
          protocolResults: [{
            continuationId,
            opponentId: "opponent",
            results: [
              result(recommendedAction, terminalOutcome),
              result(selectedAction, 0)
            ]
          }]
        }
      );
    }
    assert.equal(
      await restoreExistingActionAuditSeedBatches(directory, [entry]),
      2
    );
    assert.equal(entry.selectionProtocolResults.length, 2);
    assert.equal(entry.selectionResults.length, 2);
    assert.equal(entry.selectionEvidence.terminalEvidence.attemptedPairs, 4);
    assert.equal(entry.selectionEvidence.terminalEvidence.mean, 0.5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("candidate selection executes the frozen guided/blind mixture and records propensity", () => {
  const manifest = createActionEvidenceProtocolManifest({
    continuationPool: [member("one")],
    opponentPool: [member("opponent")],
    searchContractHash: "search-contract",
    searchTriggerRuleHash: "symmetric-trigger",
    chanceScheduleVersion: "chance-v1",
    evaluatorGuidedFraction: 0.75,
    evaluatorBlindFraction: 0.25
  });
  const candidates = Array.from({ length: 8 }, (_, index) => ({
    descriptor: {
      auditKey: `candidate-${index}`,
      priority: {
        confirmationLowerBound: index / 100,
        confirmationMean: index / 100
      }
    },
    stratum: { key: index === 0 ? "rare" : "common" }
  }));
  const selected = selectIndependentActionAuditCandidatePool(candidates, 5, {
    evidenceProtocolManifest: manifest
  });
  assert.equal(selected.filter((item) =>
    item.selectionSource === "priority").length, 3);
  assert.equal(selected.filter((item) =>
    item.selectionSource === "stratified-exploration").length, 2);
  assert.equal(selected.every((item) =>
    item.samplingPropensity?.contract
      === "action-evidence-candidate-sampling-propensity-v1"), true);
});

test("worker resolves every frozen continuation-opponent pair by exact model hashes", () => {
  const first = createNeuralModel();
  const second = createNeuralModel();
  const poolMember = (model, id) => ({
    id,
    modelHash: neuralArtifactHash(model),
    behaviorHash: neuralBehaviorHash(model),
    weight: 1,
    strength: 1
  });
  const manifest = createActionEvidenceProtocolManifest({
    continuationPool: [
      poolMember(first, "continuation-a"),
      poolMember(second, "continuation-b")
    ],
    opponentPool: [
      poolMember(first, "opponent-a"),
      poolMember(second, "opponent-b")
    ],
    searchContractHash: "search-contract",
    searchTriggerRuleHash: "symmetric-trigger",
    chanceScheduleVersion: "chance-v1"
  });
  const snapshot = {
    actorId: "p1",
    game: { players: [{ id: "p1" }, { id: "p2" }] },
    descriptor: { evidenceProtocolManifest: manifest }
  };
  const pairs = hydrateAuditPolicyPairs(snapshot, first, [second]);
  assert.equal(pairs.length, 4);
  assert.deepEqual(
    new Set(pairs.map((item) => item.continuationId)),
    new Set(["continuation-a", "continuation-b"])
  );
  assert.throws(() => hydrateAuditPolicyPairs(snapshot, first, []));
});

test("seed commitment rejects post-rollout commitment and overlapping final seeds", () => {
  const manifest = protocol();
  assert.throws(() => createActionEvidenceSeedCommitment(manifest, {
    auditKey: "late",
    informationSetHash: "state",
    pilotSeeds: Array.from({ length: 8 }, (_, index) => index),
    selectionSeeds: Array.from({ length: 32 }, (_, index) => index),
    finalSeeds: Array.from({ length: 128 }, (_, index) => index + 100),
    rolloutsStarted: true
  }));
  assert.throws(() => createActionEvidenceSeedCommitment(manifest, {
    auditKey: "overlap",
    informationSetHash: "state",
    pilotSeeds: Array.from({ length: 8 }, (_, index) => index),
    selectionSeeds: Array.from({ length: 32 }, (_, index) => index),
    finalSeeds: Array.from({ length: 128 }, (_, index) => index + 31)
  }));
});

test("legacy terminal audit can never be retroactively promoted", () => {
  const oldReference = {
    source: "independent-terminal-action-audit",
    policyCorrectionIndependent: true,
    final: { attemptedPairs: 64, lowerBound: 0.2 }
  };
  assert.equal(
    actionEvidenceGrade(oldReference),
    ACTION_EVIDENCE_GRADES.legacyTerminalConditioned
  );
  const forged = {
    ...oldReference,
    evidenceGrade: ACTION_EVIDENCE_GRADES.continuationConsistent
  };
  assert.equal(
    actionEvidenceGrade(forged),
    ACTION_EVIDENCE_GRADES.legacyTerminalConditioned
  );
});

test("robust requires two independent positive continuations and no clear negative", () => {
  const manifest = protocol({
    continuationPool: [
      member("a", { independent: true }),
      member("b", { independent: true })
    ]
  });
  const frozen = commitment(manifest);
  const robust = classifyPrecommittedActionEvidence({
    manifest,
    commitment: frozen,
    continuationResults: applyHolmSimultaneousBounds([
      {
        id: "a",
        weight: 0.5,
        samples: 128,
        mean: 0.09,
        standardError: 0.01
      },
      {
        id: "b",
        weight: 0.5,
        samples: 128,
        mean: 0.07,
        standardError: 0.01
      }
    ], { confidenceLevel: 0.99 })
  });
  assert.equal(robust.grade, ACTION_EVIDENCE_GRADES.terminalRobust);

  const conflicted = classifyPrecommittedActionEvidence({
    manifest,
    commitment: frozen,
    continuationResults: [
      {
        id: "a",
        samples: 128,
        mean: 0.1,
        standardError: 0.02,
        lowerBound: 0.04,
        upperBound: 0.16,
        behaviorallyIndependent: true,
        strengthEligible: true,
        simultaneousCorrection: "holm-fwer",
        holmAdjustedPValue: 0.001
      },
      {
        id: "b",
        samples: 128,
        mean: -0.08,
        standardError: 0.02,
        lowerBound: -0.14,
        upperBound: -0.02,
        behaviorallyIndependent: true,
        strengthEligible: true,
        simultaneousCorrection: "holm-fwer",
        holmAdjustedPValue: 0.001
      }
    ]
  });
  assert.equal(conflicted.grade, ACTION_EVIDENCE_GRADES.conflicted);
});

test("one frozen continuation remains policy conditioned", () => {
  const manifest = protocol();
  const result = classifyPrecommittedActionEvidence({
    manifest,
    commitment: commitment(manifest),
    continuationResults: [{
      id: "one",
      samples: 128,
      mean: 0.08,
      standardError: 0.01,
      lowerBound: 0.03,
      upperBound: 0.13,
      behaviorallyIndependent: false,
      strengthEligible: true,
      simultaneousCorrection: "holm-fwer",
      holmAdjustedPValue: 0.001
    }]
  });
  assert.equal(
    result.grade,
    ACTION_EVIDENCE_GRADES.policyConditioned
  );
  assert.ok(result.reasons.includes(
    "single-or-behaviorally-equivalent-continuation"
  ));
});

test("high-confidence legacy terminal evidence is strong pi-conditioned Policy-Q data", () => {
  const selectionSeeds = Array.from({ length: 32 }, (_, index) => index + 1);
  const finalSeeds = Array.from({ length: 64 }, (_, index) => index + 1000);
  const reference = {
    source: "independent-terminal-action-audit",
    policyCorrectionIndependent: true,
    determinizationAudit: { complete: true },
    seedBanks: {
      selection: selectionSeeds,
      final: finalSeeds,
      disjoint: true
    },
    selection: {
      attemptedPairs: 32,
      samples: 32,
      terminalPairs: 32,
      lowerBound: 0.04,
      terminalOutcomePairs: selectionSeeds.map((simulationSeed) => ({
        simulationSeed,
        recommendedOutcome: 1,
        selectedOutcome: 0
      }))
    },
    final: {
      attemptedPairs: 64,
      samples: 64,
      terminalPairs: 64,
      lowerBound: 0.06,
      pairedValidRateLowerBound: 0.9,
      pairedTerminalRateLowerBound: 0.9,
      terminalOutcomePairs: finalSeeds.map((simulationSeed) => ({
        simulationSeed,
        recommendedOutcome: 1,
        selectedOutcome: 0
      }))
    }
  };
  const assessment = assessActionEvidence(reference, {
    datasetContinuationPolicyHash: "pi5-artifact",
    currentPolicyHash: "pi5-artifact",
    role: "training",
    allowPolicyConditionedActorCorrection: true
  });
  assert.equal(
    assessment.rawGrade,
    ACTION_EVIDENCE_GRADES.legacyTerminalConditioned
  );
  assert.equal(
    assessment.statisticalStrength,
    ACTION_EVIDENCE_STATISTICAL_STRENGTHS.high
  );
  assert.equal(
    assessment.continuationScope,
    ACTION_EVIDENCE_CONTINUATION_SCOPES.policyConditioned
  );
  assert.equal(
    assessment.provenanceStatus,
    ACTION_EVIDENCE_PROVENANCE_STATUSES.datasetRecoverable
  );
  assert.equal(assessment.authorizedUses.policyQTraining, true);
  assert.equal(assessment.authorizedUses.mulliganQTraining, true);
  assert.equal(assessment.authorizedUses.actorPreferenceTraining, true);
  assert.equal(assessment.authorizedUses.requireAnchorKl, true);
  assert.equal(assessment.authorizedUses.formalActionCertification, false);
  assert.equal(assessment.disposition, "decisive");
  assert.equal(assessment.effectEstimate, 1);
  assert.equal(assessment.pairwiseRegret, 1);
  assert.equal(assessment.pairwiseRegretScope, "targeted-selected-pair");
  assert.equal(assessment.observedPairGap, 1);
  assert.equal(assessment.decisiveEffectThreshold, 0.01);

  const belowPracticalEffect = assessActionEvidence({
    ...reference,
    final: {
      ...reference.final,
      mean: 0.005,
      lowerBound: 0.002,
      upperBound: 0.008
    }
  });
  assert.equal(belowPracticalEffect.disposition, "near-equivalent");
  assert.equal(belowPracticalEffect.observedPairGap, 0);

  const exactArtifact = assessActionEvidence({
    ...reference,
    continuationModelHash: "pi5-exact-artifact"
  }, {
    datasetContinuationPolicyHash: "pi5-lineage-digest",
    currentPolicyHash: "pi5-lineage-digest",
    currentPolicyArtifactHash: "pi5-exact-artifact",
    role: "training",
    allowPolicyConditionedActorCorrection: true
  });
  assert.equal(exactArtifact.provenanceStatus,
    ACTION_EVIDENCE_PROVENANCE_STATUSES.exact);
  assert.equal(exactArtifact.authorizedUses.actorPreferenceTraining, true);

  const holdout = assessActionEvidence(reference, {
    datasetContinuationPolicyHash: "pi5-artifact",
    currentPolicyHash: "pi5-artifact",
    role: "confirmation",
    allowPolicyConditionedActorCorrection: true
  });
  assert.equal(holdout.authorizedUses.actorPreferenceTraining, false);
});

test("multiple-testing helpers perform real BH discovery and Holm correction", () => {
  const bh = benjaminiHochbergCorrection([
    { id: "a", pValue: 0.001 },
    { id: "b", pValue: 0.02 },
    { id: "c", pValue: 0.4 }
  ], 0.05);
  assert.deepEqual(
    bh.filter((item) => item.rejected).map((item) => item.id),
    ["a", "b"]
  );
  const holm = applyHolmSimultaneousBounds([
    { id: "a", samples: 128, mean: 0.1, standardError: 0.01 },
    { id: "b", samples: 128, mean: 0.08, standardError: 0.01 }
  ], { confidenceLevel: 0.99 });
  assert.equal(holm.every((item) =>
    item.simultaneousCorrection === "holm-fwer"), true);
  assert.equal(holm.every((item) =>
    Number.isFinite(item.holmAdjustedPValue)), true);
});

test("single continuation uses its artifact while a pool can never impersonate pi5", () => {
  const singleManifest = protocol({
    continuationPool: [member("one")]
  });
  const single = assessActionEvidence({
    source: "independent-terminal-action-audit",
    evidenceGrade: ACTION_EVIDENCE_GRADES.policyConditioned,
    evidenceProtocol: singleManifest,
    evidenceCommitment: commitment(singleManifest)
  }, {
    role: "training",
    currentPolicyArtifactHash: "model-one",
    allowPolicyConditionedActorCorrection: true
  });
  assert.equal(
    single.continuationScope,
    ACTION_EVIDENCE_CONTINUATION_SCOPES.policyConditioned
  );
  assert.equal(single.continuationModelHash, "model-one");
  assert.equal(single.authorizedUses.actorPreferenceTraining, true);

  const poolManifest = protocol({
    continuationPool: [member("one"), member("two")]
  });
  const pooled = assessActionEvidence({
    source: "independent-terminal-action-audit",
    evidenceGrade: ACTION_EVIDENCE_GRADES.policyConditioned,
    evidenceProtocol: poolManifest,
    evidenceCommitment: commitment(poolManifest)
  }, {
    role: "training",
    currentPolicyArtifactHash: "model-one",
    datasetContinuationPolicyHash: "model-one",
    allowPolicyConditionedActorCorrection: true
  });
  assert.equal(
    pooled.continuationScope,
    ACTION_EVIDENCE_CONTINUATION_SCOPES.poolConditioned
  );
  assert.equal(pooled.continuationModelHash, null);
  assert.equal(pooled.provenanceStatus, ACTION_EVIDENCE_PROVENANCE_STATUSES.exact);
  assert.equal(pooled.authorizedUses.policyQTraining, true);
  assert.equal(pooled.authorizedUses.actorPreferenceTraining, false);
});

test("classifier rejects extra, duplicate, and payload-controlled pool metadata", () => {
  const manifest = protocol({
    continuationPool: [
      member("a", { independent: true }),
      member("b", { independent: false })
    ]
  });
  const frozen = commitment(manifest);
  const base = applyHolmSimultaneousBounds([
    { id: "a", samples: 128, mean: 0.1, standardError: 0.01 },
    { id: "b", samples: 128, mean: 0.08, standardError: 0.01 }
  ], { confidenceLevel: 0.99 });
  const extra = classifyPrecommittedActionEvidence({
    manifest,
    commitment: frozen,
    continuationResults: [...base, { ...base[0], id: "forged" }]
  });
  assert.equal(extra.grade, ACTION_EVIDENCE_GRADES.inconclusive);
  assert.ok(extra.reasons.includes("continuation-pool-not-exact"));
  const duplicate = classifyPrecommittedActionEvidence({
    manifest,
    commitment: frozen,
    continuationResults: [base[0], { ...base[0] }]
  });
  assert.ok(duplicate.reasons.includes(
    "continuation-result-ids-invalid-or-duplicated"
  ));
  const forgedMetadata = classifyPrecommittedActionEvidence({
    manifest,
    commitment: frozen,
    continuationResults: base.map((item) => ({
      ...item,
      weight: item.id === "a" ? 0 : 1,
      behaviorallyIndependent: true,
      strengthEligible: true
    }))
  });
  assert.equal(
    forgedMetadata.grade,
    ACTION_EVIDENCE_GRADES.continuationConsistent
  );
  assert.ok(forgedMetadata.reasons.includes(
    "insufficient-behaviorally-independent-continuations"
  ));
});

test("natural audit reports coverage, conditional accuracy, equivalence, regret, and weak strata", () => {
  const summary = summarizeNaturalDistributionActionAudit([
    {
      openingStateId: "a",
      disposition: "decisive",
      correct: true,
      regret: 0,
      deckId: "annie",
      seat: "p1",
      matchup: "annie-vi"
    },
    {
      openingStateId: "b",
      disposition: "decisive",
      correct: false,
      regret: 0.2,
      deckId: "annie",
      seat: "p2",
      matchup: "annie-vi"
    },
    {
      openingStateId: "c",
      disposition: "near-equivalent",
      deckId: "vi",
      seat: "p1",
      matchup: "annie-vi"
    },
    {
      openingStateId: "d",
      disposition: "inconclusive",
      deckId: "vi",
      seat: "p2",
      matchup: "annie-vi"
    }
  ]);
  assert.equal(summary.states, 4);
  assert.equal(summary.decisiveCoverage, 0.5);
  assert.equal(summary.conditionalAccuracy, 0.5);
  assert.equal(summary.nearEquivalentRate, 0.25);
  assert.equal(summary.inconclusiveRate, 0.25);
  assert.equal(summary.expectedRegret, null);
  assert.equal(summary.measuredRegretStates, 2);
  assert.equal(summary.observedRegretCoverage, 0.5);
  assert.equal(summary.conditionalExpectedRegret, 0.1);
  assert.equal(summary.conservativePopulationRegretLowerBound, 0.05);
  assert.equal(summary.conservativePopulationRegretUpperBound, 0.55);
  assert.equal(summary.regretTailRisk.aboveThreePercentRate, 0.5);
  assert.equal(summary.regretTailRisk.aboveFivePercentRate, 0.5);
  assert.equal(summary.regretTailRisk.worstTenPercentCvar, 0.2);
  assert.equal(summary.independentOpeningStates, 4);
  assert.ok(summary.weakestStrata.length > 0);
});

test("natural audit denominator includes eligible states with no selected candidate", () => {
  const index = createEvaluatorBootstrapResultIndex({
    summaries: [{ completed: true, invalid: false, naturallyCompleted: true }],
    trajectories: [{
      playerId: "p1",
      deckId: "annie",
      seat: 0,
      steps: [{
        informationSetHash: "natural-opening-state",
        state: [],
        selectedActionKey: "confirmMulligan",
        legalActionKeys: ["confirmMulligan"],
        evidenceSamplingFrame: {
          distribution: "natural-distribution",
          scope: "opening-and-mulligan"
        }
      }]
    }]
  });
  assert.equal(index.naturalDistributionActionAudit.states, 1);
  assert.equal(index.naturalDistributionActionAudit.inconclusive, 1);
  assert.equal(
    index.naturalDistributionActionAudit.independentOpeningStates,
    1
  );
});

test("bootstrap summary reads nested legacy reclassification without treating targeted regret as population regret", () => {
  const identity = {
    identity: "legacy-reference",
    openingStateId: "opening-state",
    deckId: "annie",
    coverageKey: "annie:p1",
    phaseBand: "early",
    actionClass: "card-play",
    evidenceGrade: ACTION_EVIDENCE_GRADES.legacyTerminalConditioned,
    evidenceAssessment: {
      statisticalStrength: ACTION_EVIDENCE_STATISTICAL_STRENGTHS.high,
      continuationScope: ACTION_EVIDENCE_CONTINUATION_SCOPES.policyConditioned,
      provenanceStatus: ACTION_EVIDENCE_PROVENANCE_STATUSES.datasetRecoverable,
      disposition: "decisive",
      observedPairGap: 0.125,
      observedPairGapScope: "targeted-selected-pair",
      pairwiseRegret: 0.125,
      pairwiseRegretScope: "targeted-selected-pair"
    },
    inProtocolScope: true
  };
  const audit = summarizeEvaluatorBootstrap({
    records: [{
      workerIndex: 0,
      gameIndex: 0,
      resultIndex: {
        version: EVALUATOR_BOOTSTRAP_RESULT_INDEX_VERSION,
        valid: true,
        stratumVersion: 2,
        gameCoverage: { "annie:p1": 1 },
        actionReferenceCoverage: { "annie:p1": 1 },
        leafValueCoverage: {},
        actionReferencePhaseCoverage: { early: 1 },
        actionReferenceActionClassCoverage: { "card-play": 1 },
        actionReferenceDeckPhaseCoverage: { "annie::early": 1 },
        leafValuePhaseCoverage: {},
        leafValueDeckPhaseCoverage: {},
        structuredV2ActionReferenceCoverage: {},
        structuredV2ActionReferencePhaseCoverage: {},
        structuredV2ActionReferenceActionClassCoverage: {},
        structuredV2ActionReferenceDeckPhaseCoverage: {},
        structuredV2LeafValueCoverage: {},
        structuredV2LeafValuePhaseCoverage: {},
        structuredV2LeafValueDeckPhaseCoverage: {},
        actionReferenceIdentities: [identity],
        structuredV2ActionReferenceIdentities: [],
        actionEvidenceGradeCounts: {
          [ACTION_EVIDENCE_GRADES.legacyTerminalConditioned]: 1
        },
        actionEvidenceStatisticalStrengthCounts: { high: 1 },
        actionEvidenceContinuationScopeCounts: {
          [ACTION_EVIDENCE_CONTINUATION_SCOPES.policyConditioned]: 1
        },
        actionEvidenceDispositionCounts: { decisive: 1 },
        actionEvidenceProvenanceStatusCounts: {
          [ACTION_EVIDENCE_PROVENANCE_STATUSES.datasetRecoverable]: 1
        },
        actionEvidenceObservedPairGap: {},
        actionEvidencePairwiseRegret: {},
        actionEvidenceIndependentOpeningStates: {},
        actionEvidenceIndependentOpeningStateCount: 0,
        naturalDistributionActionAudit: { states: 0, strata: {} },
        leafActionEffectAudit: { comparisons: 0, phaseBands: {} },
        actionEvidenceComputeEfficiency: {},
        leafValuePairCount: 0,
        structuredV2LeafValuePairCount: 0,
        actionAuditRacing: {},
        logicalGames: 1,
        physicalGames: 1
      }
    }]
  }, {
    deckIds: [],
    includeCertificationPartitions: false,
    minimumGamesFloor: 0,
    minimumReferenceFloor: 0,
    minimumReferenceGamesFloor: 0,
    minimumCalibrationFloor: 0
  });
  assert.equal(audit.actionEvidenceStatisticalStrengthCounts.high, 1);
  assert.equal(
    audit.actionEvidenceContinuationScopeCounts["policy-conditioned"],
    1
  );
  assert.equal(audit.actionEvidenceDispositionCounts.decisive, 1);
  assert.equal(audit.actionEvidencePairwiseRegret.meanObservedPairwiseRegret, 0.125);
  assert.equal(audit.actionEvidencePairwiseRegret.populationEstimate, false);
  assert.equal(audit.naturalDistributionActionAudit.expectedRegret, null);
});

test("efficiency is measured per compute hour and not per game", () => {
  const summary = summarizeActionEvidenceEfficiency({
    validIndependentEvidence: 12,
    cpuMilliseconds: 2 * 60 * 60 * 1000,
    gpuMilliseconds: 60 * 60 * 1000,
    wallMilliseconds: 60 * 60 * 1000
  });
  assert.equal(summary.evidencePerComputeHour, 4);
  assert.equal(summary.evidencePerWallHour, 12);
});

test("dataset selection preserves formal grades before dense legacy records", () => {
  const record = (gameIndex, identities, natural = null) => ({
    workerIndex: 0,
    gameIndex,
    resultIndex: {
      actionReferenceIdentities: identities,
      structuredV2ActionReferenceIdentities: identities.map(
        (item) => item.identity
      ),
      leafValuePairCount: 0,
      structuredV2LeafValuePairCount: 0,
      leafValueCoverage: {},
      leafValuePhaseCoverage: {},
      leafValueDeckPhaseCoverage: {},
      naturalDistributionActionAudit: natural || {
        states: 0,
        nearEquivalent: 0,
        strata: {}
      }
    }
  });
  const denseLegacy = record(0, Array.from({ length: 20 }, (_, index) => ({
    identity: `legacy-${index}`,
    openingStateId: `legacy-state-${index}`,
    evidenceGrade: ACTION_EVIDENCE_GRADES.legacyTerminalConditioned,
    inProtocolScope: true,
    deckId: "annie",
    coverageKey: "annie:p1",
    phaseBand: "mulligan",
    actionClass: "mulligan"
  })));
  const formal = record(1, [{
    identity: "formal",
    openingStateId: "formal-state",
    evidenceGrade: ACTION_EVIDENCE_GRADES.continuationConsistent,
    inProtocolScope: true,
    deckId: "annie",
    coverageKey: "annie:p1",
    phaseBand: "mulligan",
    actionClass: "mulligan"
  }], {
    states: 1,
    nearEquivalent: 1,
    strata: {
      "deck-seat:annie:p1": { states: 1 }
    }
  });
  const selected = selectBalancedEvaluatorBootstrapRecords(
    [denseLegacy, formal],
    {
      maximumRecords: 1,
      deckIds: ["annie"],
      evidenceRequirement: {
        minimumActionReferences: 1,
        continuationConsistentMinimum: 1,
        independentOpeningStateMinimum: 1,
        naturalDistributionAuditMinimum: 1,
        nearEquivalentMinimum: 1,
        minimumDeckSeatCoverage: 1,
        minimumActionReferencesPerDeckSeat: 0,
        minimumActionReferencesByPhase: {},
        minimumActionReferenceGamesByPhase: {},
        minimumActionReferencesPerCoreClass: 0,
        minimumActionReferenceGamesPerCoreClass: 0,
        minimumActionReferencesPerDeckPhase: 0,
        minimumActionReferenceGamesPerDeckPhase: 0
      }
    }
  );
  assert.deepEqual(selected.map((item) => item.gameIndex), [1]);
});
