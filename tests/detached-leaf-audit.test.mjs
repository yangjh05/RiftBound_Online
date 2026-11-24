import { trainingTestDirectory } from "./helpers/training-temp.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createGame } from "../src/engine.mjs";
import { decklists } from "../src/cards.mjs";
import { resolveTrainingDecks } from "../src/ai/training-decks.mjs";
import { enumerateMulliganPlans } from "../src/ai/mulligan.mjs";
import { simulationTeacherDecision, runIndependentActionAuditSeedBatch } from "../src/ai/neural/teacher.mjs";
import { seededRandom } from "../src/ai/neural/selfplay.mjs";
import { writeTrajectoryArchive, readTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { prepareDetachedLeafAuditJobs, finalizeDetachedLeafEvidence, applyDetachedLeafEvidence }
  from "../scripts/detached-leaf-audit.mjs";
import { leafAuditSchedule } from "../src/ai/neural/leaf-audit-schedule.mjs";
import { evaluatorValueTrainingSamples } from "../src/ai/neural/trainer.mjs";
import { createAuditPool } from "../scripts/detached-action-audit-coordinator.mjs";
import { readValidatedActionAuditSeedBatchOutput } from "../scripts/ai-action-audit-task-contract.mjs";
import { validLeafActionEffectComparison, validIndependentLeafValueReference }
  from "../src/ai/neural/action-ranking-reference.mjs";

function fixture() {
  const game = createGame({ decks: resolveTrainingDecks(decklists, "origins-era").slice(0, 2), interactive: true,
    manualActionChainPriority: true, random: seededRandom(16), randomSeed: 16 });
  const player = game.players[0];
  // Keep a legal mulligan state, with short continuations for this test.
  for (const p of game.players) {
    p.hand = p.mainDeck.splice(0, 4).map(card => ({ ...card, zone: "hand" }));
    p.mainDeck = p.mainDeck.slice(0, 4); p.score = 7;
  }
  game.phase = "mulligan";
  game.currentPlayerId = player.id;
  game.mulligan = { playerId: player.id, selectedCardIds: [] };
  const actions = enumerateMulliganPlans(game, player.id).slice(0, 2);
  return { game, actions, actorId: player.id, engineFingerprint: "sha256:detached-leaf-test" };
}

test("deferred teacher freezes the same action pair without running its final bank", () => {
  const { game, actions, actorId, engineFingerprint } = fixture();
  const options = { screenSimulations: 1, confirmationSimulations: 1, confirmationMaxSimulations: 1,
    maxCandidates: 2, depth: 1, engineFingerprint, informationSetHash: "saved-leaf-information-set",
    captureProductionLeafAudit: true, captureIndependentLeafAudit: true,
    independentLeafPairLimit: 1, requiredAction: actions[0] };
  const baseline = simulationTeacherDecision(game, actorId, actions, { ...options, leafAuditSimulations: 0, random: seededRandom(17) });
  const deferred = simulationTeacherDecision(game, actorId, actions,
    { ...options, leafAuditSimulations: 128, detachedIndependentLeafAudit: true, random: seededRandom(17) });
  assert.deepEqual(deferred.action, baseline.action);
  assert.equal(deferred.independentLeafAuditAttempted, true);
  assert.equal(deferred.deferredLeafAuditCandidate.maximumSimulations, 128);
  assert.equal(deferred.independentLeafActionEffectComparison, null);
  assert.equal(deferred.independentLeafValuePairs.length, 0);
});

test("state-bank plans resume without rewriting source games or changing committed seeds", async t => {
  const f = fixture();
  const root = await trainingTestDirectory(t, "detached-leaf");
  const descriptor = { contract: "detached-leaf-audit-candidate-v1", auditKey: "leaf-a",
    informationSetHash: "saved-leaf-information-set", recommendedAction: f.actions[0],
    selectedAction: f.actions[1], maximumSimulations: 128, occupiedAuditSeeds: [1, 2] };
  const locator = { actorId: f.actorId, stepIndex: 0, informationSetHash: descriptor.informationSetHash, selectedIndex: 0 };
  const source = { trajectories: [{ playerId: f.actorId, gameId: "original", steps: [locator] }],
    pendingLeafAudit: { contract: "detached-leaf-audit-state-bank-v1", candidates: [{ ...f,
      descriptor, auditKey: descriptor.auditKey, recordedStepLocator: locator }] } };
  const archivePath = path.join(root, "source.json.gz");
  await writeTrajectoryArchive(archivePath, source);
  const before = await readFile(archivePath);
  const options = { directory: path.join(root, "bank"), engineFingerprint: f.engineFingerprint, continuationHash: "heuristic-only-v1" };
  const first = await prepareDetachedLeafAuditJobs({ archivePath, datasetKey: "test" }, options);
  const legacyPlan = { ...first[0].plan, root: path.relative(process.cwd(), first[0].plan.root),
    candidatePath: path.relative(process.cwd(), first[0].plan.candidatePath) };
  const planFile = path.join(first[0].plan.root, "plan.json.gz");
  await writeTrajectoryArchive(planFile, legacyPlan);
  const savedPlanBytes = await readFile(planFile);
  const second = await prepareDetachedLeafAuditJobs({ archivePath, datasetKey: "test" }, options);
  assert.deepEqual(first[0].plan, second[0].plan);
  assert.deepEqual(await readFile(planFile), savedPlanBytes, "equivalent absolute paths must not rewrite the committed plan");
  assert.equal(new Set(first[0].plan.seeds).size, 128);
  assert.equal(first[0].plan.seeds.some(n => n === 1 || n === 2), false);
  assert.deepEqual(await readFile(archivePath), before);
  const changed = structuredClone(first[0].plan); changed.seeds[0]++;
  await writeTrajectoryArchive(path.join(changed.root, "plan.json.gz"), changed);
  await assert.rejects(prepareDetachedLeafAuditJobs({ archivePath, datasetKey: "test" }, options), /commitment changed/);
  assert.throws(() => applyDetachedLeafEvidence(source, { locator, sourceGameId: "different" }), /source game/);
});

test("a detached label targets the original game as well as its player and step", () => {
  const locator = { actorId: "p1", stepIndex: 0, informationSetHash: "same", selectedIndex: 0 };
  const result = { trajectories: ["other", "source"].map(gameId => ({ gameId, playerId: "p1",
    steps: [{ informationSetHash: "same", selectedIndex: gameId === "source" ? 0 : 9 }] })) };
  assert.equal(applyDetachedLeafEvidence(result, { sourceGameId: "source", locator, reference: null }), false);
  result.trajectories.push(structuredClone(result.trajectories[1]));
  assert.throws(() => applyDetachedLeafEvidence(result, { sourceGameId: "source", locator }), /exactly one/);
});

test("real paired rollouts retain terminal evidence through the progressive contract", () => {
  const f = fixture();
  const candidate = { ...f, deckId: f.game.players[0].deckId, seat: 0, legalActions: f.actions,
    descriptor: { recommendedAction: f.actions[0], selectedAction: f.actions[1],
      informationSetHash: "paired-leaf-test", search: { depth: 1 } } };
  const batch = runIndependentActionAuditSeedBatch(candidate, {
    bank: "final-leaf-v1", seeds: Array.from({ length: 32 }, (_, i) => 1000 + i), maximumSteps: 192 });
  const result = finalizeDetachedLeafEvidence(candidate, [batch], leafAuditSchedule(32), 32);
  assert.equal(result.pairedAudit.attemptedPairs, 32);
  assert.equal(result.stopping.stop, true);
  assert.ok(result.pairedAudit.samples > 0, "fixture must reach terminal continuations");
  assert.equal(validIndependentLeafValueReference(result.reference), true);
  const trajectory = { gameId: "one-game", fixedShadowContinuation: "heuristic-only-v1",
    steps: [{ informationSetHash: "paired-leaf-test", leafValueAuditReference: result.reference }] };
  const options = { engineFingerprint: f.engineFingerprint, certificationRole: "training", trainFixedContinuationShadowQ: true };
  const samples = evaluatorValueTrainingSamples([trajectory], options);
  const q = samples.filter(sample => sample.source === "fixed-continuation-shadow-action-q");
  assert.ok(q.length > 0);
  assert.ok(q.every(sample => sample.rankingWeight === 0 && sample.targetHead === "mulligan-q"));
  assert.equal(evaluatorValueTrainingSamples([trajectory], { ...options, certificationRole: "final-audit" })
    .some(sample => sample.source === "fixed-continuation-shadow-action-q"), false);
  assert.equal(evaluatorValueTrainingSamples([{ ...trajectory, fixedShadowContinuation: null }], options)
    .some(sample => sample.source === "fixed-continuation-shadow-action-q"), false);
});

test("a completed seed shard is reused by a new real worker pool", async t => {
  const f = fixture();
  const root = await trainingTestDirectory(t, "leaf-resume");
  const candidatePath = path.join(root, "candidate.json.gz");
  const candidate = { ...f, descriptor: { recommendedAction: f.actions[0], selectedAction: f.actions[1],
    informationSetHash: "worker-resume", search: { depth: 1 } } };
  await writeTrajectoryArchive(candidatePath, { candidateId: "candidate-a", candidate });
  const task = { candidateId: "candidate-a", taskId: "task-a", candidatePath,
    outputPath: path.join(root, "batch.json.gz"), bank: "final-leaf-v1", maximumSteps: 192,
    informationSetHash: "worker-resume", engineFingerprint: f.engineFingerprint, seeds: [521, 522, 523, 524] };
  const options = { processes: 1, teacherEvaluatorMode: "heuristic-only", engineFingerprint: f.engineFingerprint };
  let before;
  for (let iteration = 0; iteration < 2; iteration++) {
    const pool = await createAuditPool(options);
    try { await pool.run([task], {}); } finally { await pool.close(); }
    await readValidatedActionAuditSeedBatchOutput(task, task.outputPath);
    const bytes = await readFile(task.outputPath);
    if (iteration === 0) before = bytes;
    else assert.deepEqual(bytes, before);
  }
  await assert.rejects(readValidatedActionAuditSeedBatchOutput({ ...task, seeds: [1, 2, 3, 4] }, task.outputPath), /does not match/);
});
