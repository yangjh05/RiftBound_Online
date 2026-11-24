import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import os from "node:os";
import path from "node:path";
import { cards } from "../src/cards.mjs";
import { activeActorId, applyAiAction, actionKey, planPaymentActions } from "../src/ai/actions.mjs";
import { tacticalPosition } from "./fixtures/ai-tactical-position.mjs";
import { captureGameReferences, restoreGameReferences } from "../scripts/game-state-references.mjs";
import { replaySubmittedGame } from "../scripts/live-game-replay.mjs";
import { liveGameDecisionComparisons, buildLiveGameArchive, importLiveGame, loadLiveGameEvidence,
  liveGameRole, assertLiveGameEvidence, evaluateLiveGameRegressions, auditLiveGames, assessLiveGameChoice,
  collectLiveTacticalDemonstrations } from "../scripts/live-game-curriculum.mjs";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { prepareDetachedLeafAuditJobs } from "../scripts/detached-leaf-audit.mjs";
import { applyDetachedLeafEvidence } from "../scripts/detached-leaf-audit.mjs";
import { evaluatorValueTrainingSamples } from "../src/ai/neural/trainer.mjs";
import { initializeLiveGameEvaluator } from "../scripts/train-adaptive-policy-q.mjs";
import { createNeuralModel, disposeNeuralModel } from "../src/ai/neural/model.mjs";
import {tf} from '../src/ai/neural/tf-runtime.mjs';

const fingerprint = "sha256:live-game-test";
const copyCard = (card, id, owner = "p1") => ({ ...structuredClone(card), instanceId: id,
  ownerId: owner, controllerId: owner, damage: 0, buffs: 0, mightModifier: 0, attachments: [], exhausted: false });

function reportFixture(privateName = null, variant = 0, attackerMight = 4) {
  const { game, actor } = tacticalPosition({ attacker: true });
  actor.base[0].might = attackerMight;
  game.turnNumber += variant;
  // Both alternatives can win immediately after paying and moving. No
  // unknown draws are needed to test the real terminal-evidence pipeline.
  for (const p of game.players) { p.mainDeck = []; p.runeDeck = []; }
  if (privateName) game.players[1].hand = [{ ...copyCard(cards.lonelyPoro, "private-card", "p2"), name: privateName }];
  actor.score = 7;
  actor.hand.push({ ...copyCard(cards.hextechRay, "expensive-removal"), energy: 3, power: [] });
  const initial = structuredClone(game), commands = [], frames = [];
  function act(command) {
    const actorId = activeActorId(game), result = applyAiAction(game, command, actorId);
    assert.ok(result.ok, JSON.stringify({ command, result }));
    const sequence = commands.length + 1;
    commands.push({ sequence, command, context: { actorId, ai: actorId === "p1" }, result });
    frames.push({ label: "command", commandSequence: sequence, state: structuredClone(game) });
  }
  act({ kind: "beginPlayCard", cardId: "expensive-removal", destination: "base" });
  act({ kind: "chooseEffectOption", optionId: "enemy" });
  for (const command of planPaymentActions(game)) act(command);
  for (let i = 0; i < 20 && game.actionChain; i++) act({ kind: "passShowdown" });
  act({ kind: "moveUnit", unitId: "attacker", destinationId: "field" });
  for (let i = 0; i < 20 && game.showdown; i++) act({ kind: "passShowdown" });
  assert.equal(game.winnerId, "p1");
  return { id: "report-a", description: "User text must not enter the curriculum", log: {
    logId: "test-log", metadata: { mode: "ai" }, initialState: { state: initial },
    latestState: { state: structuredClone(game) }, commands, frames, droppedCommands: 0 } };
}

test("submitted games replay every command and reject gaps, failed commands and divergent final boards", () => {
  const report = reportFixture();
  assert.equal(replaySubmittedGame(report).validation.finalMatched, true);
  for (const mutate of [r => r.log.droppedCommands++, r => r.log.commands[0].sequence++,
    r => r.log.commands[0].result.ok = false, r => r.log.latestState.state.players[0].score--,
    r => r.log.latestState.state.phase = "action", r => r.log.frames = [],
    r => r.log.initialState.state.decisionSafety = { violations: [{ kind: "unsafe-choice" }] }]) {
    const changed = structuredClone(report); mutate(changed);
    assert.throws(() => replaySubmittedGame(changed));
  }
});

test('an explicitly rejected no-op is verified without discarding the rest of a submitted game',()=>{
  const report=reportFixture();
  for(const entry of report.log.commands)entry.sequence++;
  for(const frame of report.log.frames)frame.commandSequence++;
  report.log.commands.unshift({sequence:1,status:'rejected',result:{ok:false},
    command:{kind:'chooseFirstPlayer',playerId:'p1'},context:{actorId:'p1',ai:false}});
  const result=replaySubmittedGame(report);
  assert.equal(result.validation.finalMatched,true);
  assert.deepEqual(result.validation.rejectedNoStateChange,[1]);
  report.log.commands[0].command=structuredClone(report.log.commands[1].command);
  assert.throws(()=>replaySubmittedGame(report),/Previously rejected command succeeded/);
});

test('provisional live imitation keeps game roles isolated and never supplies win or correction labels',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'riftbound-live-imitation-'));
  const model=createNeuralModel({seed:317});
  try {
    const entries={};
    for(let variant=0;variant<40 && Object.keys(entries).length<2;variant++){
      const report=reportFixture(null,variant,3),archive=buildLiveGameArchive(report,{engineFingerprint:fingerprint});
      if(!entries[archive.role])entries[archive.role]=await importLiveGame(root,report,{engineFingerprint:fingerprint});
    }
    assert.ok(entries.training&&entries.validation);
    // A uniform policy keeps the first legal mulligan (all cards). The actual
    // curve lesson has a definite correction, independent of random weights
    // or an older combat example whose bounded search is now inconclusive.
    tf.tidy(()=>{for(const name of ['actionProjection','actionBias'])
      model.layers[name].setWeights(model.layers[name].getWeights().map(t=>tf.zerosLike(t)));});
    const fixtures=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/ai-deck-development-20260927.json.gz',import.meta.url))));
    const fixture=fixtures.find(f=>f.gameIndex===23&&f.n===3);
    const index=await readTrajectoryArchive(path.join(root,'manifest.json.gz'));
    for(const entry of index.entries){
      const archive=await readTrajectoryArchive(entry.archivePath);
      archive.pendingLeafAudit.candidates=[{game:fixture.game,gameReferences:captureGameReferences(fixture.game),actorId:fixture.actorId,
        descriptor:{selectionContext:{commandSequence:3}}}];
      await writeTrajectoryArchive(entry.archivePath,archive);
      entry.archiveHash=createHash('sha256').update(await readFile(entry.archivePath)).digest('hex');
    }
    await writeTrajectoryArchive(path.join(root,'manifest.json.gz'),index);
    const result=await collectLiveTacticalDemonstrations(root,fingerprint,model);
    assert.ok(result.samples.length>0);
    assert.deepEqual(result.sourceGames.map(e=>e.sourceGameId),[entries.training.sourceGameId]);
    for(const sample of result.samples)for(const step of sample.steps){
      assert.equal(step.sourceGameId,entries.training.sourceGameId);
      assert.equal(step.winProbabilityLabel,false);assert.equal(step.teacherCorrectionEligible,false);
      assert.equal(step.mulliganLesson,true);
      assert.ok(step.advantage>0&&step.advantage<=0.5);
    }
    await assert.rejects(collectLiveTacticalDemonstrations(root,'other-engine',model),/engine changed/);
  }finally{disposeNeuralModel(model);await rm(root,{recursive:true,force:true});}
});

test("generic failure selection covers reserve, full-turn setup and scoring targets without card-name branches", () => {
  const { game, actor, field } = tacticalPosition({ attacker: true });
  const expensive = { ...copyCard(cards.hextechRay, "costly"), energy: 3, power: [] };
  actor.hand.push(expensive);
  assert.equal(liveGameDecisionComparisons(game, "p1", { kind: "beginPlayCard", cardId: "costly", destination: "base" })[0].category, "reaction-reserve");
  const second = { ...structuredClone(field), instanceId: "second", units: [copyCard(field.units[0], "second-enemy", "p2")] };
  game.battlefields.push(second);
  assert.ok(applyAiAction(game, { kind: "beginPlayCard", cardId: "costly", destination: "base" }, "p1").ok);
  assert.ok(liveGameDecisionComparisons(game, "p1", { kind: "chooseEffectOption", optionId: "enemy" })
    .some(c => c.category === "score-denial-target" && c.alternative.optionId === "second-enemy"));
  const empty = tacticalPosition({ enemy: false });
  empty.actor.hand = [copyCard(cards.lonelyPoro, "large"), copyCard(cards.lonelyPoro, "setup")];
  empty.actor.hand[0].energy = 7; empty.actor.hand[0].power = [];
  empty.actor.hand[1].energy = 2; empty.actor.hand[1].power = [];
  assert.equal(liveGameDecisionComparisons(empty.game, "p1", { kind: "beginPlayCard", cardId: "large", destination: "base" })[0].category, "turn-sequence");
});

test("combat reassessment includes responses, but a forced pass without resources is not a mistake sample", () => {
  const { game, actor, field } = tacticalPosition({ attacker: true, enemyMight: 4 });
  actor.base[0].might = 3;
  actor.hand.push({ ...copyCard(cards.smokeScreen, "smoke"), power: [] });
  assert.ok(applyAiAction(game, { kind: "moveUnit", unitId: "attacker", destinationId: field.instanceId }, "p1").ok);
  const selected = { kind: "passShowdown" };
  const comparisons = liveGameDecisionComparisons(game, "p1", selected);
  assert.ok(comparisons.some(c => c.category === "combat-reassessment" && c.alternative.cardId === "smoke"));
  actor.runes.forEach(r => r.exhausted = true);
  assert.deepEqual(liveGameDecisionComparisons(game, "p1", selected), []);
});

test("JSON snapshot round trips restore live champion aliases and reject unsafe reference paths", () => {
  const unit = { instanceId: "champ", damage: 0 };
  const game = { players: [{ champion: unit }], battlefields: [{ units: [unit] }] };
  const references = captureGameReferences(game);
  const decoded = JSON.parse(JSON.stringify(game));
  assert.notEqual(decoded.players[0].champion, decoded.battlefields[0].units[0]);
  restoreGameReferences(decoded, references);
  decoded.players[0].champion.damage = 4;
  assert.equal(decoded.battlefields[0].units[0].damage, 4);
  assert.throws(() => restoreGameReferences(decoded, [[["__proto__", "polluted"], []]]), /Unsafe/);
  assert.equal({}.polluted, undefined);
});

test("live-game archives are audit-only, redact private hands, and retain roles across report copies", () => {
  const report = reportFixture("PRIVATE-CARD-MARKER");
  const archive = buildLiveGameArchive(report, { engineFingerprint: fingerprint });
  assert.equal(archive.policyTrainingEligible, false);
  assert.equal(archive.trajectories[0].onPolicy, false);
  assert.deepEqual(evaluatorValueTrainingSamples(archive.trajectories, {
    engineFingerprint: fingerprint, certificationRole: "training", trainFixedContinuationShadowQ: true
  }), [], "unaudited hypotheses cannot produce any Q or value target");
  assert.ok(archive.trajectories[0].steps.every(s => s.teacherCorrectionEligible === false && !Object.hasOwn(s, "oldLogProbability")));
  assert.equal(archive.role, liveGameRole(archive.sourceGameId));
  const copy = structuredClone(report); copy.id = "another-report"; copy.description = "different";
  assert.equal(buildLiveGameArchive(copy, { engineFingerprint: fingerprint }).sourceGameId, archive.sourceGameId);
  assert.equal(JSON.stringify(archive).includes(report.description), false);
  assert.equal(JSON.stringify(archive).includes("PRIVATE-CARD-MARKER"), false);
  for (const candidate of archive.pendingLeafAudit.candidates) {
    assert.ok(candidate.game.players[1].hand.every(c => c.type === "unknown"));
    assert.ok(candidate.game.players[1].mainDeck.every(c => c.type === "unknown"));
    assert.equal(candidate.descriptor.search.minimumTurnTransitions, 2);
    assert.equal(candidate.descriptor.maximumSimulations, 32);
  }
});

test("opponent private identities cannot change selected comparison actions or public encodings", () => {
  const first = buildLiveGameArchive(reportFixture("secret-a"), { engineFingerprint: fingerprint });
  const second = buildLiveGameArchive(reportFixture("secret-b"), { engineFingerprint: fingerprint });
  assert.deepEqual(first.trajectories[0].steps.map(s => s.informationSetHash), second.trajectories[0].steps.map(s => s.informationSetHash));
  assert.deepEqual(first.pendingLeafAudit.candidates.map(c => c.descriptor.recommendedAction),
    second.pendingLeafAudit.candidates.map(c => c.descriptor.recommendedAction));
});

test("imports are idempotent and unaudited or mismatched evidence never reaches training", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-live-game-test-"));
  try {
    const report = reportFixture();
    const first = await importLiveGame(root, report, { engineFingerprint: fingerprint });
    const before = await readFile(first.archivePath);
    assert.deepEqual(await importLiveGame(root, report, { engineFingerprint: fingerprint }), first);
    assert.deepEqual(await readFile(first.archivePath), before);
    assert.deepEqual(await loadLiveGameEvidence(root, fingerprint), { training: [], validation: [] });
    await assert.rejects(loadLiveGameEvidence(root, "different"), /engine changed/);
    const jobs = await prepareDetachedLeafAuditJobs(first, { directory: path.join(root, "audits"), engineFingerprint: fingerprint, continuationHash: "heuristic-only-v1" });
    assert.ok(jobs.length);
    const job = jobs[0];
    await writeTrajectoryArchive(path.join(job.plan.root, "evidence.json.gz"), { candidateId: job.plan.candidateId,
      sourceHash: "tampered", finished: true });
    await assert.rejects(loadLiveGameEvidence(root, fingerprint), /source changed/);
    const archive = await readTrajectoryArchive(first.archivePath);
    archive.role = archive.role === "training" ? "validation" : "training";
    await writeTrajectoryArchive(first.archivePath, archive);
    await assert.rejects(loadLiveGameEvidence(root, fingerprint), /source changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("held-out or unaudited data cannot bypass the training-entry guard", async () => {
  const role = liveGameRole("source");
  await assert.rejects(assertLiveGameEvidence({ role, sourceGameId: "source" }, role === "training" ? "validation" : "training", fingerprint), /Held-out/);
});

test("no independent held-out evidence reports unavailable, never a fabricated zero-error rate", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-live-eval-test-"));
  try {
    const result = await evaluateLiveGameRegressions(root, fingerprint, () => { throw new Error("must not run"); });
    assert.equal(result.independentGames, 0);
    assert.equal(result.status, "unavailable-no-held-out-audits");
    assert.equal(result.promotionEligible, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("regression metrics reverse disproven hypotheses and do not count unknown or uncertain choices as wins", () => {
  const proposed = { kind: "endTurn" }, recorded = { kind: "passShowdown" };
  const comparison = { recommendedActionKey: actionKey(proposed), comparedActionKey: actionKey(recorded),
    pairedAudit: { lowerBound: 0.1, upperBound: 0.5 } };
  assert.equal(assessLiveGameChoice(comparison, proposed), "better");
  assert.equal(assessLiveGameChoice(comparison, recorded), "worse");
  assert.equal(assessLiveGameChoice(comparison, { kind: "activateCard", cardId: "uncompared" }), "unmeasured");
  comparison.pairedAudit = { lowerBound: -0.5, upperBound: -0.1 };
  assert.equal(assessLiveGameChoice(comparison, proposed), "worse");
  assert.equal(assessLiveGameChoice(comparison, recorded), "better");
  comparison.pairedAudit = { lowerBound: -0.1, upperBound: 0.1 };
  assert.equal(assessLiveGameChoice(comparison, proposed), "unmeasured");
});

test("real paired audits connect submitted games to Q samples, never unaudited PPO labels", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-live-audit-test-"));
  try {
    let report;
    for (let variant = 0; variant < 40; variant++) {
      const candidate = reportFixture(null, variant);
      if (buildLiveGameArchive(candidate, { engineFingerprint: fingerprint }).role === "validation") { report = candidate; break; }
    }
    assert.ok(report, "fixture must exercise a held-out original game");
    const entry = await importLiveGame(root, report, { engineFingerprint: fingerprint });
    const results = await auditLiveGames(root, { engineFingerprint: fingerprint, processes: 1, maximumJobs: 1 });
    assert.equal(results.length, 1);
    assert.equal(results[0].finished, true);
    assert.ok(results[0].reference, "terminal comparisons must produce a valid reference");
    const eligible = await loadLiveGameEvidence(root, fingerprint);
    const ready = [...eligible.training, ...eligible.validation];
    assert.equal(ready.length, 1);
    assert.equal(ready[0].role, entry.role);
    assert.equal(eligible.training.length, 0);
    await assert.rejects(assertLiveGameEvidence(ready[0], "training", fingerprint), /Held-out/);
    await assertLiveGameEvidence(ready[0], entry.role, fingerprint);
    let evaluated = 0;
    const regression = await evaluateLiveGameRegressions(root, fingerprint, (_game, _actorId, actions) => {
      evaluated++; return actions[0];
    }, { entries: ready });
    assert.equal(evaluated, 1);
    assert.equal(regression.independentGames, 1);
    assert.equal(regression.categories["reaction-reserve"].comparisons, 1);
    assert.equal(regression.promotionEligible, false);
    const archive = await readTrajectoryArchive(entry.archivePath);
    assert.equal(applyDetachedLeafEvidence(archive, results[0]), true);
    const samples = evaluatorValueTrainingSamples(archive.trajectories, {
      engineFingerprint: fingerprint, certificationRole: "training", trainFixedContinuationShadowQ: true });
    assert.ok(samples.some(s => s.source === "fixed-continuation-shadow-action-q"));
    assert.equal(archive.policyTrainingEligible, false);
    const previousBytes = await readFile(ready[0].sidecars[0]);
    const repeated = await auditLiveGames(root, { engineFingerprint: fingerprint, processes: 1, maximumJobs: 1 });
    assert.equal(repeated.length, 0, "a completed final bank cannot get additional seeds");
    assert.deepEqual(await readFile(ready[0].sidecars[0]), previousBytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("new-run initialization trains the isolated evaluator from frozen live evidence without changing the actor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "riftbound-live-initialization-"));
  const model = createNeuralModel({ seed: 123, evaluatorArchitecture: "structured-set-v2-128" });
  try {
    const bank = path.join(root, "bank");
    let report;
    for (let variant = 0; variant < 40; variant++) {
      const candidate = reportFixture(null, variant);
      if (buildLiveGameArchive(candidate, { engineFingerprint: fingerprint }).role === "training") { report = candidate; break; }
    }
    assert.ok(report);
    await importLiveGame(bank, report, { engineFingerprint: fingerprint });
    await auditLiveGames(bank, { engineFingerprint: fingerprint, processes: 1, maximumJobs: 1 });
    const config = { directory: root, liveGameCurriculumDirectory: bank, engineFingerprint: fingerprint };
    const result = await initializeLiveGameEvaluator(config, model);
    assert.equal(result.status, "trained");
    assert.equal(result.policyWeightsUpdated, false);
    assert.equal(result.promotionEligible, false);
    assert.ok(result.training.samples > 0);
    assert.notEqual(result.sourceArtifactHash, result.candidateArtifactHash);
    const plan = await readTrajectoryArchive(path.join(root, "initial-live-game-plan.json.gz"));
    assert.equal(plan.training.length, 1);
    assert.equal(plan.validation.length, 0);
    await assert.rejects(initializeLiveGameEvaluator(config, model), /Initial live-game plan changed/);
    assert.equal(await initializeLiveGameEvaluator({}, model), null);
  } finally { disposeNeuralModel(model); await rm(root, { recursive: true, force: true }); }
});
