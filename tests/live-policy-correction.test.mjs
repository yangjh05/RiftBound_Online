import { trainingTestDirectory } from "./helpers/training-temp.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LIVE_POLICY_CONTRACT, commitLivePolicyProtocol, livePolicyScheduled, confirmedLivePolicyEffect,
  fitLivePolicyCorrections, livePolicyRegressionGuard, measureLivePolicy } from '../scripts/live-policy-correction.mjs';
import { createNeuralModel, deserializeNeuralModel, disposeNeuralModel } from '../src/ai/neural/model.mjs';
import { neuralBehaviorHash, neuralArtifactHash } from '../src/ai/neural/evaluator-certification.mjs';
import { createActionRankingAuditReference } from '../src/ai/neural/action-ranking-reference.mjs';
import { STATE_DIM, ACTION_DIM, NEURAL_HIDDEN_SIZE } from '../src/ai/neural/encoding.mjs';
import { createGame } from '../src/engine.mjs';
import { decklists } from '../src/cards.mjs';
import { enumerateMulliganPlans } from '../src/ai/mulligan.mjs';
import { createActionEvidenceProtocolManifest, createActionEvidenceSeedCommitment,
  classifyPrecommittedActionEvidence } from '../src/ai/neural/evidence-protocol.mjs';
import { mergeIndependentActionAuditProtocolBatches, independentActionAuditEvidenceFromBatches } from '../src/ai/neural/teacher.mjs';
import { createAuditPool } from '../scripts/detached-action-audit-coordinator.mjs';
import { readValidatedActionAuditSeedBatchOutput } from '../scripts/ai-action-audit-task-contract.mjs';
import { writeTrajectoryArchive } from '../src/ai/neural/archive.mjs';

const limits = { learningRate: 0.00005, batchSize: 8, maximumCorrections: 32,
  meanKlLimit: 0.01, maximumKlLimit: 0.05, accuracyDropLimit: 0.02, lossIncreaseLimit: 0.02 };
function evidence(seeds, wins = seeds.length) {
  return { determinizationAudit: { complete: true }, terminalEvidence: { attemptedPairs: seeds.length,
    terminalPairs: seeds.length, outcomePairs: seeds.map((simulationSeed, index) => ({ simulationSeed,
      leftOutcome: index < wins ? 1 : 0, rightOutcome: 0 })) } };
}

test('live actor protocol is prospective, immutable and scheduled before new PPO collection', async t => {
  const state = { iteration: 7 }, protocol = { contract: LIVE_POLICY_CONTRACT, afterIteration: 7, everyIterations: 32 };
  commitLivePolicyProtocol(state, protocol);
  commitLivePolicyProtocol(state, protocol);
  assert.throws(() => commitLivePolicyProtocol(state, null));
  assert.throws(() => commitLivePolicyProtocol(state, { ...protocol, everyIterations: 1 }));
  assert.throws(() => commitLivePolicyProtocol({ iteration: 8 }, protocol));
  assert.equal(livePolicyScheduled(protocol, 7), false);
  assert.equal(livePolicyScheduled(protocol, 8), true);
  assert.equal(livePolicyScheduled(protocol, 9), false);
  assert.equal(livePolicyScheduled(protocol, 40), true);
  const source = await readFile(new URL('../scripts/train-adaptive-policy-q.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('const input = await ensureLivePolicyCorrection') < source.indexOf('plan = { iteration, sourcePath: input'));
  assert.ok(source.includes('teacherConsumptionPolicy: "record-only-v1"'));
});

test('only complete independent terminal banks with a family-wise positive effect authorize correction', () => {
  const seeds = Array.from({ length: 128 }, (_, index) => index + 10);
  assert.equal(confirmedLivePolicyEffect(evidence(seeds), seeds, 32).eligible, true);
  assert.equal(confirmedLivePolicyEffect(evidence(seeds, 5), seeds, 8).eligible, false);
  assert.equal(confirmedLivePolicyEffect(evidence(seeds.slice(1)), seeds, 8).eligible, false);
  const repeated = evidence(seeds); repeated.terminalEvidence.outcomePairs[1].simulationSeed = seeds[0];
  assert.equal(confirmedLivePolicyEffect(repeated, seeds, 8).eligible, false);
  const incomplete = evidence(seeds); incomplete.determinizationAudit.complete = false;
  assert.equal(confirmedLivePolicyEffect(incomplete, seeds, 8).eligible, false);
  assert.equal(confirmedLivePolicyEffect(evidence(seeds), seeds, 33).eligible, false);
  const one = confirmedLivePolicyEffect(evidence(seeds, 40), seeds, 1);
  const many = confirmedLivePolicyEffect(evidence(seeds, 40), seeds, 32);
  assert.ok(many.interval.lowerBound < one.interval.lowerBound);
});

function authorizedFixture(model, protocolEvidence = false) {
  const bank = (count, offset) => Array.from({ length: count }, (_, index) => offset + index);
  const selectionSeeds = bank(32, 1), finalSeeds = bank(protocolEvidence ? 128 : 64, 1000);
  const pairs = seeds => seeds.map(simulationSeed => ({ simulationSeed, recommendedOutcome: 1, selectedOutcome: 0 }));
  const rate = { recommended: { lowerBound: 0.9 }, selected: { lowerBound: 0.9 }, paired: { lowerBound: 0.9 } };
  const rates = { valid: rate, terminal: rate };
  const stage = seeds => ({ attemptedPairs: seeds.length, samples: seeds.length, terminalPairs: seeds.length,
    mean: 1, lowerBound: 0.8, upperBound: 1, terminalOutcomePairs: pairs(seeds), rates });
  const informationSetHash = 'unit-test-independent-terminal-evidence';
  let envelope = { version: 3, contract: 'independent-terminal-action-audit-v3' };
  if (protocolEvidence) {
    const member = { id: 'current', modelHash: neuralArtifactHash(model), behaviorHash: neuralBehaviorHash(model),
      weight: 1, strength: 1, behaviorallyIndependent: false };
    const manifest = createActionEvidenceProtocolManifest({ continuationPool: [member], opponentPool: [member],
      searchContractHash: 'test-search', searchTriggerRuleHash: 'test-trigger', chanceScheduleVersion: 'test-chance' });
    const commitment = createActionEvidenceSeedCommitment(manifest, { auditKey: 'positive-fixture', informationSetHash,
      pilotSeeds: selectionSeeds.slice(0, 8), selectionSeeds, finalSeeds });
    const classification = classifyPrecommittedActionEvidence({ manifest, commitment, continuationResults: [{
      id: 'current', samples: 128, mean: 1, standardError: 0.001, lowerBound: 0.9, upperBound: 1,
      behaviorallyIndependent: false, strengthEligible: true, simultaneousCorrection: 'holm-fwer', holmAdjustedPValue: 0.001 }] });
    envelope = { version: 4, contract: 'precommitted-continuation-terminal-action-audit-v1',
      evidenceProtocol: manifest, evidenceCommitment: commitment, evidenceClassification: classification, evidenceGrade: classification.grade };
  }
  const reference = createActionRankingAuditReference({ informationSetHash,
    correctIndex: 1, comparedIndex: 0, correctActionKey: 'alternative', comparedActionKey: 'selected',
    audit: { ...envelope,
      source: 'independent-terminal-action-audit', policyCorrectionIndependent: true,
      determinizationAudit: { complete: true }, seedBanks: { selection: selectionSeeds, final: finalSeeds, disjoint: true },
      selection: stage(selectionSeeds), final: stage(finalSeeds),
      evaluatorStatePairs: pairs(finalSeeds).map(pair => ({ ...pair,
        recommendedHeuristicValue: 0.7, selectedHeuristicValue: 0.3,
        recommendedState: new Float32Array(STATE_DIM), selectedState: new Float32Array(STATE_DIM),
        recommendedCaptureStep: 4, selectedCaptureStep: 4, recommendedDepthBin: '0-7', selectedDepthBin: '0-7',
        auditContinuationSteps: { recommended: 12, selected: 12 } })) } });
  assert.ok(reference);
  if (!protocolEvidence) reference.continuationModelHash = neuralArtifactHash(model);
  const state = new Float32Array(STATE_DIM), actions = new Float32Array(2 * ACTION_DIM);
  state[0] = 1; actions[0] = 1; actions[ACTION_DIM + 1] = 1;
  const trajectory = { gameId: 'training-game', playerId: 'p1', steps: [{ state, actions, legalCount: 2,
    legalActionKeys: ['selected', 'alternative'], selectedIndex: 0, initialMemory: new Float32Array(NEURAL_HIDDEN_SIZE), informationSetHash,
    actionRankingAuditReference: reference, onPolicy: false }] };
  const holdout = Array.from({ length: 32 }, (_, index) => ({ gameId: `independent-${index}`, partition: 'validation',
    playerId: 'p1', steps: [{ ...trajectory.steps[0], selectedIndex: 1, actionRankingAuditReference: null }] }));
  return { trajectory, holdout };
}

test('verified matching-policy evidence changes real actor weights without mutating source or inventing logged PPO data', () => {
  const source = createNeuralModel({ seed: 331 }), beforeHash = neuralBehaviorHash(source);
  try {
    const { trajectory, holdout } = authorizedFixture(source, true);
    const before = measureLivePolicy(source, holdout)[0].probabilities[1];
    const fit = fitLivePolicyCorrections(source, [trajectory], holdout, limits);
    assert.equal(fit.outcome, 'actor-updated');
    assert.equal(fit.behaviorChanged, true);
    assert.equal(fit.corrections, 1);
    assert.equal(fit.guard.passed, true);
    assert.equal(neuralBehaviorHash(source), beforeHash);
    assert.equal(trajectory.steps[0].oldLogProbability, undefined);
    const trained = deserializeNeuralModel(fit.checkpoint);
    try { assert.ok(measureLivePolicy(trained, holdout)[0].probabilities[1] > before); }
    finally { disposeNeuralModel(trained); }
  } finally { disposeNeuralModel(source); }
});

test('wrong-policy evidence is skipped, overlapping holdout fails, and unsafe update is discarded', () => {
  const source = createNeuralModel({ seed: 332 });
  try {
    const { trajectory, holdout } = authorizedFixture(source);
    const bad = structuredClone(trajectory); bad.steps[0].actionRankingAuditReference.continuationModelHash = 'wrong-policy';
    assert.equal(fitLivePolicyCorrections(source, [bad], [], limits).outcome, 'no-authorized-corrections');
    assert.throws(() => fitLivePolicyCorrections(source, [trajectory], [], limits), /regression positions/);
    assert.throws(() => fitLivePolicyCorrections(source, [trajectory], holdout.map(item => ({ ...item, gameId: 'training-game' })), limits), /overlap/);
    const rejected = fitLivePolicyCorrections(source, [trajectory], holdout, { ...limits, meanKlLimit: -1 });
    assert.equal(rejected.outcome, 'rejected-by-regression-guard');
    const restored = deserializeNeuralModel(rejected.checkpoint);
    try { assert.equal(neuralBehaviorHash(restored), neuralBehaviorHash(source)); }
    finally { disposeNeuralModel(restored); }
  } finally { disposeNeuralModel(source); }
});

test('independent regression rejects excessive drift and lost tactical choices', () => {
  const before = [{ probabilities: [0.9, 0.1], selectedIndex: 0, expectedIndex: 0 }];
  assert.equal(livePolicyRegressionGuard(before, before, limits).passed, true);
  assert.equal(livePolicyRegressionGuard(before, [{ probabilities: [0.1, 0.9], selectedIndex: 1, expectedIndex: 0 }], limits).passed, false);
  assert.equal(livePolicyRegressionGuard([], [], limits).passed, false);
});

test('real worker uses frozen neural policies for both seats and resumes exact protocol shards', async t => {
  const model = createNeuralModel({ seed: 19 });
  const root = await trainingTestDirectory(t, 'live-policy-worker');
  const game = createGame({ decks: Object.values(decklists).slice(0, 2), interactive: true,
    manualActionChainPriority: true, randomSeed: 16 });
  for (const player of game.players) {
    player.hand = player.mainDeck.splice(0, 4).map(card => ({ ...card, zone: 'hand' }));
    player.mainDeck = player.mainDeck.slice(0, 4); player.score = 7;
  }
  game.phase = 'mulligan'; game.currentPlayerId = 'p1'; game.mulligan = { playerId: 'p1', selectedCardIds: [] };
  const actions = enumerateMulliganPlans(game, 'p1').slice(0, 2);
  const member = { id: 'current', modelHash: neuralArtifactHash(model), behaviorHash: neuralBehaviorHash(model), weight: 1, strength: 1 };
  const manifest = createActionEvidenceProtocolManifest({ continuationPool: [member], opponentPool: [member],
    searchContractHash: 'test-search', searchTriggerRuleHash: 'test-trigger', chanceScheduleVersion: 'test-chance' });
  const selectionSeeds = Array.from({ length: 32 }, (_, index) => 10 + index);
  const commitment = createActionEvidenceSeedCommitment(manifest, { auditKey: 'test-pair', informationSetHash: 'test-information',
    pilotSeeds: selectionSeeds.slice(0, 8), selectionSeeds, finalSeeds: Array.from({ length: 128 }, (_, index) => 1000 + index) });
  const candidate = { game, actorId: 'p1', engineFingerprint: 'test-engine', descriptor: {
    auditKey: 'test-pair', informationSetHash: 'test-information', recommendedAction: actions[0], selectedAction: actions[1],
    search: { depth: 1 }, evidenceProtocolManifest: manifest, evidenceCommitment: commitment } };
  const candidatePath = path.join(root, 'candidate.json.gz');
  await writeTrajectoryArchive(candidatePath, { candidateId: 'test-pair', candidate });
  const task = { taskId: 'test-shard', candidateId: 'test-pair', candidatePath,
    outputPath: path.join(root, 'batch.json.gz'), bank: 'selection', seeds: selectionSeeds.slice(0, 1),
    maximumSteps: 192, informationSetHash: 'test-information', engineFingerprint: 'test-engine',
    evidenceProtocolHash: manifest.protocolHash, protocolPairIds: ['current::current'] };
  let first;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const pool = await createAuditPool({ processes: 1, model, teacherEvaluatorMode: 'heuristic-only', evidenceProtocolManifest: manifest });
      try { await pool.run([task], {}); } finally { await pool.close(); }
      const batch = await readValidatedActionAuditSeedBatchOutput(task, task.outputPath);
      assert.deepEqual(batch.results, [], 'pair-sharded payload must be read from protocolResults');
      const merged = mergeIndependentActionAuditProtocolBatches([batch]);
      assert.equal(merged.length, 1);
      assert.equal(independentActionAuditEvidenceFromBatches(candidate, merged[0].results).terminalEvidence.attemptedPairs, 1);
      const bytes = await readFile(task.outputPath);
      if (first) assert.deepEqual(bytes, first); else first = bytes;
    }
  } finally { disposeNeuralModel(model); }
});
