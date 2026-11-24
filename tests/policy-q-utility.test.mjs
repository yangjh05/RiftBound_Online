import { trainingTestDirectory } from "./helpers/training-temp.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { POLICY_Q_UTILITY_CONTRACT, commitPolicyQUtilityProtocol, utilityPlan, adaptiveGameRole,
  freshUtilityEvidence, assertUtilityEvidenceDisjoint, utilityAuditRecords, shadowProposalReadiness } from '../scripts/policy-q-utility.mjs';
import { responseMixtureScore, recommendResponseAwareAction } from '../scripts/response-aware-demonstration.mjs';
import { summarizeShadowUtility, evaluateShadowUtility, selectShadowQProposals } from '../scripts/shadow-q-utility.mjs';
import { createNeuralModel, disposeNeuralModel, serializeNeuralModel, trainPpoBatch } from '../src/ai/neural/model.mjs';
import { tf } from '../src/ai/neural/tf-runtime.mjs';
import { packPpoBatch } from '../src/ai/neural/trainer.mjs';
import { ACTION_DIM, STATE_DIM, CARD_BINS, NEURAL_HIDDEN_SIZE } from '../src/ai/neural/encoding.mjs';
import { tacticalPosition } from './fixtures/ai-tactical-position.mjs';
import { applyAiAction, enumerateAiPolicyActions, actionKey } from '../src/ai/actions.mjs';
import { cards } from '../src/cards.mjs';
import { createGame } from '../src/engine.mjs';
import { decklists } from '../src/cards.mjs';
import { resolveTrainingDecks } from '../src/ai/training-decks.mjs';
import { enumerateMulliganPlans } from '../src/ai/mulligan.mjs';
import { runIndependentActionAuditSeedBatch } from '../src/ai/neural/teacher.mjs';
import { finalizeDetachedLeafEvidence, detachedLeafSeedBatchTasks, rebuildHeldOutLeafEvidence } from '../scripts/detached-leaf-audit.mjs';
import { leafAuditSchedule } from '../src/ai/neural/leaf-audit-schedule.mjs';
import { takePreferredActionAuditTask } from '../scripts/detached-action-audit-coordinator.mjs';
import { naturalLeafMixtureSamplingFrame, naturalLeafSamplingChannel } from '../src/ai/neural/natural-leaf-sampling.mjs';
import { readTrajectoryArchive, writeTrajectoryArchive } from '../src/ai/neural/archive.mjs';

const protocol = { contract: POLICY_Q_UTILITY_CONTRACT, afterIteration: 12, beliefCoefficient: 0,
  validationEveryGames: 8, validationAuditSimulations: 32, minimumValidationGames: 32, maximumQProposals: 8 };

test('utility activates prospectively and protects both seats of whole games without relabeling old data', () => {
  const state = { iteration: 12 }; commitPolicyQUtilityProtocol(state, protocol);
  assert.throws(() => commitPolicyQUtilityProtocol(state, null));
  assert.throws(() => commitPolicyQUtilityProtocol({ iteration: 13 }, protocol));
  assert.equal(utilityPlan(protocol, 12, 32), null);
  const reserved = [];
  for (let iteration = 13; iteration <= 20; iteration++) {
    const plan = { utility: utilityPlan(protocol, iteration, 32) };
    const held = Array.from({ length: 32 }, (_, i) => i).filter(i => adaptiveGameRole(plan, i) === 'validation');
    assert.equal(held.length, 4); reserved.push(...held);
    assert.deepEqual(held, plan.utility.validationGameIndexes);
  }
  assert.equal(new Set(reserved).size, 32);
  assert.equal(adaptiveGameRole({}, 5), 'training');
  const old = { archivePath: path.resolve('old'), usableAuditCount: 1 };
  const held = { archivePath: path.resolve('held'), usableAuditCount: 1, role: 'validation' };
  const parts = freshUtilityEvidence([old, held]);
  assert.deepEqual(parts.training, [old]); assert.deepEqual(parts.validation, [held]);
  assertUtilityEvidenceDisjoint(parts.training, parts.validation);
  assert.throws(() => assertUtilityEvidenceDisjoint([held], []), /Held-out/);
  assert.throws(() => assertUtilityEvidenceDisjoint([old], [old]), /overlap/);
  assert.equal(utilityAuditRecords([old, held])[0], held, 'old audit backlog cannot starve new holdouts');
});

test('response likelihood changes preferences only through actual loss, and does not force avoidance', () => {
  assert.equal(responseMixtureScore(8, []), 8);
  assert.equal(responseMixtureScore(8, [{ probability: 0, score: -10 }]), 8);
  assert.equal(responseMixtureScore(8, [{ probability: 1, score: 5 }]), 5, 'profitable response remains profitable');
  assert.ok(responseMixtureScore(8, [{ probability: 0.8, score: -6 }]) < 2);
  assert.equal(responseMixtureScore(8, [{ probability: 1, score: 20 }]), 8, 'opponent can pass');
  assert.equal(responseMixtureScore(8, [{ probability: 0.5, score: NaN }]), null);
  assert.equal(responseMixtureScore(8, [{ probability: 2, score: 0 }]), null);
});

test('response-aware teaching reads public beliefs and real costs, without mutating hidden hands or masking actions', () => {
  const { game, actor, opponent, field } = tacticalPosition({ attacker: true });
  opponent.legend = structuredClone(cards.kaiSaDaughterOfTheVoid);
  field.units.push({ ...structuredClone(field.units[0]), instanceId: 'small-enemy', energy: 1, might: 1 });
  opponent.hand = [{ ...structuredClone(cards.retreat), instanceId: 'private-a', ownerId: opponent.id }];
  opponent.runes = actor.runes.slice(0, 4).map((r, i) => ({ ...r, instanceId: `opp-${i}`, ownerId: opponent.id, domain: 'Mind' }));
  assert.ok(applyAiAction(game, { kind: 'beginPlayCard', cardId: 'removal', destination: 'base' }, actor.id).ok);
  const actions = enumerateAiPolicyActions(game, actor.id);
  const decision = { legalCount: actions.length, legalActions: actions, action: actions[0], probabilities: actions.map(() => 1 / actions.length) };
  const original = structuredClone(game);
  const first = recommendResponseAwareAction(game, actor.id, decision);
  assert.ok(first, 'the real response search must produce a demonstration');
  assert.equal(first.winProbabilityLabel, false);
  assert.equal(first.opponentResponsesCompared, true);
  const changed = structuredClone(game);
  changed.players[1].hand = [{ ...structuredClone(cards.discipline), instanceId: 'private-b', ownerId: opponent.id }];
  const second = recommendResponseAwareAction(changed, actor.id, decision);
  assert.deepEqual(second, first); assert.deepEqual(game, original);
  assert.deepEqual(enumerateAiPolicyActions(game, actor.id).map(actionKey), actions.map(actionKey));
});

test('Q evidence is weighted by independent games, not by seed counts, and never directly authorizes corrections', () => {
  const report = summarizeShadowUtility(new Map([
    ['a', { pairs: 100, squaredError: 10, baselineSquaredError: 50 }],
    ['b', { pairs: 1, squaredError: 0.3, baselineSquaredError: 0.5 }]
  ]));
  assert.equal(report.independentGames, 2); assert.equal(report.pairs, 101);
  assert.equal(report.meanSquaredError, 0.2);
  assert.equal(report.actorCorrectionsAuthorized, false);
  assert.equal(shadowProposalReadiness(report, protocol), false);
  assert.equal(shadowProposalReadiness({ ...report, independentGames: 32 }, protocol), true);
  assert.equal(shadowProposalReadiness({ ...report, independentGames: 32, sourceRole: 'training' }, protocol), false);
  assert.equal(shadowProposalReadiness({ ...report, independentGames: 32, meanSquaredError: 0.6 }, protocol), false);
});

test('validation shards bypass the old training backlog at a safe shard boundary, then training continues', () => {
  const queue = [
    { candidateId: 'old', task: { auditRole: 'training', id: 1 } },
    { candidateId: 'old', task: { auditRole: 'training', id: 2 } },
    { candidateId: 'held', task: { auditRole: 'validation', id: 3 } }
  ];
  assert.equal(takePreferredActionAuditTask(queue, 'old').task.id, 3);
  assert.equal(takePreferredActionAuditTask(queue, 'old').task.id, 1);
  assert.equal(takePreferredActionAuditTask(queue, 'old').task.id, 2);
  assert.equal(takePreferredActionAuditTask(queue, 'old'), null);
});

test('empty holdouts and unverified Q stay inactive, while ordinary policy training works without deck-prediction loss', async t => {
  const model = createNeuralModel({ evaluatorArchitecture: 'structured-set-v2-128' });
  const optimizer = tf.train.adam(0.001);
  try {
    async function* empty() { yield []; }
    const report = await evaluateShadowUtility(model, empty(), 'test');
    assert.equal(report.independentGames, 0); assert.equal(report.meanSquaredError, null);
    assert.deepEqual(await selectShadowQProposals(model, [], protocol, 'test'), []);
    const state = new Float32Array(STATE_DIM); state[0] = 1;
    const actions = new Float32Array(ACTION_DIM * 2); actions[0] = 1; actions[ACTION_DIM + 1] = 1;
    const before = serializeNeuralModel(model);
    const batch = packPpoBatch([{ gameId: 'unit', playerId: 'p1', steps: [{ state, actions, legalCount: 2,
      selectedIndex: 1, oldLogProbability: Math.log(0.5), behaviorTemperature: 1, advantage: 1, return: 1,
      initialMemory: new Float32Array(NEURAL_HIDDEN_SIZE), beliefTarget: new Float32Array(CARD_BINS) }] }]);
    const metrics = trainPpoBatch(model, batch, optimizer, { beliefCoefficient: 0, teacherCoefficient: 0,
      teacherRankingCoefficient: 0, teacherActionValueCoefficient: 0 });
    assert.ok(Number.isFinite(metrics.loss));
    const after = serializeNeuralModel(model);
    assert.deepEqual(after.weights.belief, before.weights.belief);
    assert.notDeepEqual(after.weights.actionValue, before.weights.actionValue);
    assert.deepEqual(after.weights.evaluatorActionQ, before.weights.evaluatorActionQ);
  } finally { optimizer.dispose(); disposeNeuralModel(model); }
});

test('real terminal audit pairs produce finite Q holdout scores without optimizing any weights', async t => {
  const fingerprint = 'sha256:utility-test';
  const game = createGame({ decks: resolveTrainingDecks(decklists, 'origins-era').slice(0, 2), interactive: true,
    manualActionChainPriority: true, randomSeed: 16 });
  for (const player of game.players) {
    player.hand = player.mainDeck.splice(0, 4).map(card => ({ ...card, zone: 'hand' }));
    player.mainDeck = player.mainDeck.slice(0, 4); player.score = 7;
  }
  game.phase = 'mulligan'; game.currentPlayerId = 'p1'; game.mulligan = { playerId: 'p1', selectedCardIds: [] };
  const actions = enumerateMulliganPlans(game, 'p1').slice(0, 2);
  let parent = { datasetKey: 'test-held-out', taskIndex: 3, certificationRole: 'validation', plannedFinalSimulations: 32 };
  for (let i = 0; ; i++) {
    parent.taskManifestHash = `held-out-parent-${i}`;
    if (naturalLeafSamplingChannel(parent.taskManifestHash) === 'mulligan') break;
  }
  const samplingFrame = naturalLeafMixtureSamplingFrame(parent, { mulligan: 2, early: 2, mid: 1, late: 1, unknown: 1 }, 'mulligan');
  const candidate = { game, actorId: 'p1', deckId: game.players[0].deckId, seat: 0,
    legalActions: actions, engineFingerprint: fingerprint, descriptor: { recommendedAction: actions[0],
      selectedAction: actions[1], informationSetHash: 'utility-information', samplingFrame, search: { depth: 1 } } };
  const root = await trainingTestDirectory(t, 'held-out-recovery');
  const sourceArchivePath = path.join(root, 'source.json.gz');
  await writeTrajectoryArchive(sourceArchivePath, { gameId: 'held-out-game', candidate });
  const sourceBytes = await readFile(sourceArchivePath);
  const plan = { root, candidateId: 'held-out-candidate', candidatePath: path.join(root, 'candidate.json.gz'),
    sourceArchivePath, sourceHash: createHash('sha256').update(sourceBytes).digest('hex'), sourceGameId: 'held-out-game',
    datasetKey: parent.datasetKey, informationSetHash: 'utility-information', engineFingerprint: fingerprint,
    locator: { actorId: 'p1', stepIndex: 0 }, schedule: leafAuditSchedule(32), seeds: Array.from({ length: 32 }, (_, i) => 1000 + i) };
  const batches = [];
  for (const task of detachedLeafSeedBatchTasks(plan, 0, 32, 'validation')) {
    const batch = runIndependentActionAuditSeedBatch(candidate, { bank: task.bank, seeds: task.seeds, maximumSteps: 192 });
    batches.push(batch);
    await writeTrajectoryArchive(task.outputPath, { ...batch, taskId: task.taskId, candidateId: task.candidateId,
      datasetKey: task.datasetKey, informationSetHash: task.informationSetHash, engineFingerprint: fingerprint });
  }
  const assessed = finalizeDetachedLeafEvidence(candidate, batches, plan.schedule, 32);
  const { reference } = assessed;
  assert.ok(reference);
  assert.equal(reference.actionEffectComparison.samplingFrame.certificationRole, 'development');
  assert.equal(reference.auditStratum.phaseBand, 'mulligan');
  const oldEvidence = { version: 1, contract: 'detached-leaf-evidence-v1', candidateId: plan.candidateId,
    sourceHash: plan.sourceHash, sourceArchivePath, sourceGameId: plan.sourceGameId, locator: plan.locator,
    schedule: plan.schedule, completedStage: 32, reference: null, finished: true, outcome: assessed.stopping.outcome };
  const repaired = await rebuildHeldOutLeafEvidence(plan, candidate, oldEvidence);
  assert.equal(repaired.changed, true); assert.deepEqual(repaired.evidence.reference, reference);
  assert.equal(repaired.evidence.roleRecovery.newRollouts, 0);
  assert.deepEqual(await readFile(sourceArchivePath), sourceBytes);
  assert.equal((await rebuildHeldOutLeafEvidence(plan, candidate, repaired.evidence)).changed, false);
  await assert.rejects(rebuildHeldOutLeafEvidence({ ...plan, sourceHash: 'changed' }, candidate, oldEvidence), /sourceHash changed/);
  const task = detachedLeafSeedBatchTasks(plan, 0, 4)[0], stored = await readTrajectoryArchive(task.outputPath);
  await writeTrajectoryArchive(task.outputPath, { ...stored, seeds: [1, 2, 3, 4] });
  await assert.rejects(rebuildHeldOutLeafEvidence(plan, candidate, oldEvidence), /does not match/);
  await writeTrajectoryArchive(task.outputPath, stored);
  const model = createNeuralModel({ evaluatorArchitecture: 'structured-set-v2-128' });
  try {
    const before = serializeNeuralModel(model);
    async function* holdout() { yield [{ gameId: 'held-out-game', playerId: 'p1',
      steps: [{ leafValueAuditReference: reference }] }]; }
    const report = await evaluateShadowUtility(model, holdout(), fingerprint);
    assert.equal(report.independentGames, 1); assert.ok(report.pairs > 0);
    assert.ok(Number.isFinite(report.meanSquaredError));
    assert.equal(report.actorCorrectionsAuthorized, false);
    assert.deepEqual(serializeNeuralModel(model).weights, before.weights);
  } finally { disposeNeuralModel(model); }
});
