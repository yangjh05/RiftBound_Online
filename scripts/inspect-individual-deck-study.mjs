import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,verifyArtifact,atomic,exists} from './deck-league-io.mjs';
import {digest,inputKey,unwrap,assertEvaluationRows,evaluationDecision,partitionTrainingTrajectories} from './deck-league-contract.mjs';
import {assertFixedChampionReferences} from './fixed-champion-reference.mjs';
import {correctionCoverage} from './lesson-coverage-budget.mjs';
import {readIndividualExecution,collectionRecordPath,assertResourceReplay,quarantinedResourceReference,assertQuarantinedResource} from './individual-study-execution.mjs';
const root=path.resolve(process.argv[2]),c=json(path.join(root,'config.json')),execution=readIndividualExecution(root);
const collectionRepair=execution.repair?json(verifyArtifact(execution.repair)):null;
assert.equal(execution.configHash,digest(c));execution.files.forEach(verifyArtifact);
const plan=json(verifyArtifact(execution.plan)),load=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f)));
for(const m of json(verifyArtifact(c.runtimeManifest)))assert.equal(sha(path.join(c.runtimeDirectory,m.path)),m.sha256);
const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
const {assertAdaptiveGame}=await load('scripts/adaptive-policy-q-evidence.mjs');
const {assertLessonSample,lessonTypes}=await load('scripts/tactical-lesson-learning.mjs');
const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
const {evaluationReviewHash}=await load('scripts/evaluation-decision-review.mjs');
const {computeEngineFingerprint}=await load('scripts/training-safety.mjs');
assert.equal(computeEngineFingerprint(),c.engineFingerprint);
const roles=await read(verifyArtifact(c.inputRoles)),held=new Set(roles.protected),profiles=[];
const collection=exists(path.join(root,'collection-result.json'))?json(path.join(root,'collection-result.json')).records:
  exists(path.join(root,'collection-progress.json'))?json(path.join(root,'collection-progress.json')).records:[];
for(const p of c.profiles){
  assertFixedChampionReferences(plan.evaluationConfig,p,p.champion,c.opponents);verifyArtifact(p.champion);
  const duplicates=new Set((await read(verifyArtifact(p.lessons))).bank.training.map(inputKey));
  for(const entry of collection.filter(r=>r.profileId===p.id&&r.path)){
    const record=await read(verifyArtifact(entry));assert.equal(record.configHash,digest(c));assert.equal(record.failure,null);
    if(entry.disposition==='quarantined-resource-routing'){
      const ref=quarantinedResourceReference(collectionRepair,record.job);assert.deepEqual({path:entry.path,sha256:entry.sha256},ref);
      assertQuarantinedResource(record,plan.corrections.find(j=>j.id===record.job.id),digest(c));assert.equal(entry.accepted,0);continue;
    }
    assert.equal(entry.path,collectionRecordPath(root,p.id,record.job,execution));
    if(record.repairReplay){verifyArtifact(record.repairReplay.original);assertResourceReplay(await read(record.repairReplay.original.path),record);}
    assert.deepEqual(record.job,plan.corrections.find(j=>j.id===record.job.id));let accepted=0;
    for(const sample of record.samples){assertLessonSample(sample,'training');assert.equal(sample.deckId,p.deck.id);
      assert.equal(sample.lessonSource.proof.thresholdsUnchanged,true);assert.equal(sample.memoryContext.fromReset,true);
      assert.ok(lessonTypes(sample).includes(entry.target));const key=inputKey(sample);
      if(held.has(key)||duplicates.has(key))continue;duplicates.add(key);accepted++;
    }
    assert.equal(accepted,entry.accepted);
  }
  const dir=path.join(root,'profiles',p.id,'replay'),tp=json(verifyArtifact(plan.trainingPlans.find(t=>t.profileId===p.id)));
  const games=[];for(let i=0;i<28;i++){const file=path.join(dir,'games',i+'.json.gz');if(!exists(file))continue;
    const game=await read(file);assertAdaptiveGame(game,tp,i);assert.equal(game.engineFingerprint,c.engineFingerprint);
    for(const t of game.trajectories)assert.equal(t.deckId,p.deck.id);games.push(...game.trajectories);}
  let candidate=null;const file=path.join(dir,'candidate.json.gz');
  if(exists(file)){const final=await read(file);assert.equal(final.configHash,digest(c));verifyArtifact(final.lessonBank);
    const partition=partitionTrainingTrajectories(games,held,ACTION_DIM);
    assert.equal(final.trainingGames,partition.eligible.length);assert.deepEqual(final.excluded,partition.excluded);
    final.originalGames.forEach(verifyArtifact);
    const admitted=await read(path.join(dir,'trained-input-keys.json.gz'));
    assert.deepEqual(admitted.keys,[...partition.used].sort());
    const changed=digest(unwrap(await read(p.champion.path)).weights)!==digest(final.checkpoint.weights);
    assert.equal(changed,final.beforeBehaviorHash!==final.afterBehaviorHash);
    for(const g of final.epochGuards)if(g.passed){assert.equal(g.updateEvidence.passed,true);assert.ok(final.batchReports.some(r=>r.epoch===g.epoch&&r.accepted));}
    candidate={sha256:sha(file),changed,acceptedEpochs:final.epochGuards.filter(g=>g.passed).length,retentionPassed:final.finalGuard.passed};
  }
  const evaluations=[];
  for(const phase of ['screen','confirmation']){
    const dir=path.join(root,'profiles',p.id,'evaluations','000001',phase);if(!exists(path.join(dir,'plan.json')))continue;
    const binding=json(path.join(dir,'plan.json'));assert.equal(binding.configHash,digest(plan.evaluationConfig));
    assertFixedChampionReferences(plan.evaluationConfig,p,binding.incumbent,binding.opponents);
    [binding.candidate,binding.incumbent,...binding.opponents].forEach(verifyArtifact);
    const records=[];
    for(const job of binding.jobs){const file=path.join(dir,job.id+'.json');if(!exists(file))continue;const r=json(file);
      assert.equal(r.bindingHash,digest(binding));assert.deepEqual(r.job,job);assert.equal(r.dataRole,'evaluation-only');
      if(r.rows.length===4){assertEvaluationRows(r.rows,job,evaluationReviewHash(binding.review));records.push(r);}}
    let result=null;
    if(exists(path.join(dir,'result.json'))){result=json(path.join(dir,'result.json'));result.gameFiles.forEach(verifyArtifact);
      const recomputed=evaluationDecision(plan.evaluationConfig,phase,records);
      for(const k of ['mean','lower','upper','promoted','byOpponent','blocks'])assert.deepEqual(result[k],recomputed[k]);
    }
    evaluations.push({phase,completeBlocks:records.length,totalBlocks:binding.jobs.length,mean:result?.mean,promoted:result?.promoted});
  }
  profiles.push({profileId:p.id,coverage:correctionCoverage(collection,p.id,p.id==='master-yi-aurora'?['mulligan','resource','response','growth']:['mulligan','resource','response'],c.coverageBudget),trainingGames:games.length,candidate,evaluations});
}
const report={at:new Date().toISOString(),configHash:digest(c),passed:true,completed:exists(path.join(root,'result.json')),profiles,
  quarantinedResourceGames:collection.filter(r=>r.disposition==='quarantined-resource-routing').length,
  fixedOfficialReferences:true,sameEngineAndReview:true,liveLeagueModified:false,automaticIntegration:false};
atomic(path.join(root,'audit-live.json'),report);console.log(JSON.stringify(report));
