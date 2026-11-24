import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { naturalLeafSamplingChannel, naturalLeafMixtureSamplingFrame,
  NATURAL_MIXTURE_SELECTION } from "../src/ai/neural/natural-leaf-sampling.mjs";
import { validLeafAuditSamplingFrame } from "../src/ai/neural/action-ranking-reference.mjs";
import { collectPolicyQEvidenceInventory, policyQShadowEvidencePreflight } from "../scripts/evaluator-policy-q-evidence.mjs";
import { createNeuralModel, disposeNeuralModel } from "../src/ai/neural/model.mjs";
import { evaluateLeafValueRankingAudit } from "../src/ai/neural/trainer.mjs";

const counts = { mulligan: 1, early: 10, mid: 40, late: 28, unknown: 0 };
const parent = (hash) => ({ taskManifestHash: hash, datasetKey: "mixture-test",
  taskIndex: 0, certificationRole: "training", candidateSelection: NATURAL_MIXTURE_SELECTION });
const hashFor = channel => Array.from({ length: 100 }, (_, i) => `task-${i}`)
  .find(hash => naturalLeafSamplingChannel(hash) === channel);
const reseal = frame => { const { taskManifestHash, ...rest } = frame;
  return { ...rest, taskManifestHash: createHash("sha256").update(JSON.stringify(rest)).digest("hex") }; };

test("precommitted channels spend half the jobs on mulligan and retain population sampling", () => {
  const tally = { population: 0, mulligan: 0, early: 0 };
  for (let i = 0; i < 10000; i++) tally[naturalLeafSamplingChannel(`task-${i}`)]++;
  assert.ok(tally.mulligan > 4700 && tally.mulligan < 5300);
  assert.ok(tally.population > 2200 && tally.early > 2200);
  assert.equal(naturalLeafSamplingChannel("stable"), naturalLeafSamplingChannel("stable"));
});

test("marginal inclusion probabilities and inverse weights recover the original population", () => {
  let mass = 0, represented = 0, representedMulligan = 0;
  for (const [phase, count] of Object.entries(counts).filter(([, n]) => n)) {
    const frame = naturalLeafMixtureSamplingFrame(parent(hashFor("population")), counts, phase);
    assert.equal(validLeafAuditSamplingFrame(frame), true);
    const p = 0.25 / 79 + (phase === "mulligan" ? 0.5 : phase === "early" ? 0.25 / 10 : 0);
    assert.equal(frame.selectionProbability, p);
    mass += count * p;
    represented += count * p / frame.selectionProbability;
    if (phase === "mulligan") representedMulligan += count * p / frame.selectionProbability;
  }
  assert.ok(Math.abs(mass - 1) < 1e-12);
  assert.ok(Math.abs(represented - 79) < 1e-12);
  assert.ok(Math.abs(representedMulligan / represented - 1 / 79) < 1e-12);
});

test("re-signed probability, population, and channel substitutions are rejected", () => {
  const frame = naturalLeafMixtureSamplingFrame(parent(hashFor("mulligan")), counts, "mulligan");
  for (const bad of [
    { ...frame, selectionProbability: 1 },
    { ...frame, eligibleDecisions: 80 },
    { ...frame, phaseDecisionCounts: { ...counts, mulligan: 2 } },
    { ...frame, samplingChannel: "population" },
    { ...frame, channelProbabilities: { population: 0, mulligan: 1, early: 0 } }
  ]) assert.equal(validLeafAuditSamplingFrame(reseal(bad)), false);
  const legacy = { version: 2, contract: "natural-leaf-audit-sampling-frame-v2",
    datasetKey: "old", taskIndex: 0, certificationRole: "training", distribution: "natural-distribution",
    candidateSelection: "hash-priority-reservoir-policy-decision-v1", parentTaskManifestHash: "old",
    eligibleDecisions: 79, selectionProbability: 1 / 79, weighting: "inverse-propensity-per-decision-v1" };
  assert.equal(validLeafAuditSamplingFrame(reseal(legacy)), true);
});

test("preflight and evaluator count unavailable samples conservatively with mixture weights", async () => {
  const frame = naturalLeafMixtureSamplingFrame(parent(hashFor("mulligan")), counts, "mulligan");
  const trajectories = ["identical-action-zero-regret", "audit-unavailable", "audited"].map((status, i) => ({
    gameId: `game-${i}`, deckId: "deck", playerSeat: 0,
    steps: [{ informationSetHash: `info-${i}`, legalActionKeys: ["submitMulligan"],
      naturalLeafAuditSamplingObservation: { version: 3,
        contract: "natural-leaf-audit-sampling-observation-v3", samplingFrame: frame, status } }]
  }));
  const inventory = await collectPolicyQEvidenceInventory([trajectories, trajectories]);
  assert.equal(inventory.mulligan.natural.comparisons, 3);
  assert.equal(inventory.mulligan.natural.riskAssessedComparisons, 1);
  const model = createNeuralModel();
  try {
    const audit = evaluateLeafValueRankingAudit(model, trajectories, {
      certificationRole: "training", datasetKey: "mixture-test", bootstrapSamples: 100,
      populationRiskBootstrapSamples: 500
    }).actionEffectRanking.naturalDistributionAudit;
    assert.equal(audit.comparisons, 3);
    assert.equal(audit.riskAssessedComparisons, 1);
    assert.equal(audit.unavailableComparisons, 2);
    assert.ok(Math.abs(audit.populationRiskBootstrap.totalPopulationWeight
      - 3 / frame.selectionProbability) < 1e-10);
  } finally { disposeNeuralModel(model); }
  assert.equal(policyQShadowEvidencePreflight(inventory).sufficient, false);
});

test("raw sample counts cannot hide insufficient risk assessments", () => {
  const inventory = Object.fromEntries(["overall", "mulligan", "early", "mid", "late"].map(phase => [phase,
    Object.fromEntries(["natural", "targeted"].map(distribution => [distribution, {
      comparisons: 200, contributingGames: 200, decisiveComparisons: 200,
      decisiveContributingGames: 200, riskAssessedComparisons: 200, riskAssessedContributingGames: 200,
      effectiveGames: 200, decisiveEffectiveGames: 200
    }]))]));
  assert.equal(policyQShadowEvidencePreflight(inventory).sufficient, true);
  inventory.mulligan.natural.riskAssessedComparisons = 3;
  inventory.mulligan.natural.riskAssessedContributingGames = 2;
  const check = policyQShadowEvidencePreflight(inventory);
  assert.equal(check.sufficient, false);
  const deficit = check.diagnosticDemand.items.find(item => item.phaseBand === "mulligan").deficits;
  assert.ok(deficit.riskAssessedComparisons > 0);
  assert.ok(deficit.riskAssessedGames > 0);
  assert.ok(deficit.riskCoverageComparisons > 0);
});

test("legacy unavailable records prove zero regret only with a complete single-action manifest", async () => {
  const frame = naturalLeafMixtureSamplingFrame(parent(hashFor("population")), counts, "mid");
  const base = { legalCount: 1, originalLegalCount: 1, selectedIndex: 0,
    legalActionKeys: ["endTurn"], selectedActionKey: "endTurn", state: Array(32).fill(0),
    naturalLeafAuditSamplingObservation: { version: 3,
      contract: "natural-leaf-audit-sampling-observation-v3", status: "audit-unavailable", samplingFrame: frame } };
  base.state[17] = 4 / 20;
  const trajectories = [base, { ...base, originalLegalCount: 2 },
    { ...base, selectedActionKey: "passShowdown" }].map((step, i) => ({
    gameId: `forced-${i}`, deckId: "deck", playerSeat: 0, steps: [step]
  }));
  const inventory = await collectPolicyQEvidenceInventory([trajectories]);
  assert.equal(inventory.mid.natural.comparisons, 3);
  assert.equal(inventory.mid.natural.knownZeroComparisons, 1);
  assert.equal(inventory.mid.natural.riskAssessedComparisons, 1);
  const model = createNeuralModel();
  try {
    const natural = evaluateLeafValueRankingAudit(model, trajectories, {
      certificationRole: "training", datasetKey: "mixture-test",
      bootstrapSamples: 100, populationRiskBootstrapSamples: 500
    }).actionEffectRanking.naturalDistributionAudit;
    assert.equal(natural.comparisons, 3);
    assert.equal(natural.knownZeroComparisons, 1);
    assert.equal(natural.unavailableComparisons, 2);
  } finally { disposeNeuralModel(model); }
});
