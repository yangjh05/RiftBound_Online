import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,atomic,exists,verifyArtifact} from './deck-league-io.mjs';
import {digest,unwrap,inputKey,assertEvaluationRows,evaluationDecision} from './deck-league-contract.mjs';
const root=path.resolve(process.argv[2]||'data/ai/deck-league-transactional-20261008'),c=json(path.join(root,'config.json'));
const execution=json(path.join(root,'execution.json'));assert.equal(execution.configHash,digest(c));
for(const r of execution.files)verifyArtifact(r);
const plan=json(verifyArtifact(execution.plan));assert.equal(plan.configHash,digest(c));
for(const r of json(verifyArtifact(c.runtimeManifest)))assert.equal(sha(path.join(c.runtimeDirectory,r.path)),r.sha256);
const load=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f)));
const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
const {assertLessonSample,lessonTypes}=await load('scripts/tactical-lesson-learning.mjs');
const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
const {resolveLessonMemory}=await load('scripts/lesson-memory-context.mjs');
const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
const {evaluationReviewHash}=await load('scripts/evaluation-decision-review.mjs');
const roles=await read(verifyArtifact(c.inputRoles)),held=new Set(roles.protected),profiles=[];
for(const p of c.profiles){
  const records=[],categories={},source=deserialize(unwrap(await read(verifyArtifact(p.champion))));
  try{
    for(const job of plan.corrections.filter(j=>j.profileId===p.id)){
      const file=path.join(root,'profiles',p.id,'lessons',job.id+'.json.gz');if(!exists(file))continue;
      const r=await read(file);assert.equal(r.configHash,digest(c));assert.deepEqual(r.job,job);assert.equal(r.failure,null);
      assert.equal(r.summary.completed,true);assert.ok(['p1','p2'].includes(r.summary.winnerId));
      const keys=new Set(r.inputKeys),excluded={protected:0};
      for(const s of r.samples){assertLessonSample(s,'training');assert.equal(s.deckId,p.deck.id);assert.ok(lessonTypes(s).includes(job.target));
        assert.equal(s.lessonSource.proof.thresholdsUnchanged,true);assert.equal(s.lessonSource.role,'training');
        assert.equal(s.memoryContext.fromReset,true);assert.equal(s.memoryContext.playerId,s.playerId);
        const key=inputKey(s);assert.ok(keys.has(key),'Sample input missing from full collection role ledger');
        if(held.has(key))excluded.protected++;
        const step=s.steps[0],logits=inferStep(source,step.state,step.actions,step.legalCount,resolveLessonMemory(source,s)).logits;
        assert.equal(logits.indexOf(Math.max(...logits)),s.correctionProof.parentChoice);
        assert.notEqual(s.correctionProof.parentChoice,step.selectedIndex);assert.equal(s.correctionProof.verifiedTarget,step.selectedIndex);
        categories[job.target]=(categories[job.target]||0)+1;
      }
      records.push({path:file,sha256:sha(file),target:job.target,rawSamples:r.samples.length,excluded,diagnostics:r.diagnostics});
    }
  }finally{dispose(source);}
  const bankFile=path.join(root,'profiles',p.id,'lessons.json.gz');let bank=null,admittedNew=0;
  if(exists(bankFile)){
    bank=await read(bankFile);const before=await read(verifyArtifact(p.lessons));
    assert.deepEqual(bank.bank.validation,before.bank.validation);assert.deepEqual(bank.bank.training.slice(0,before.bank.training.length),before.bank.training);
    assert.ok(bank.bank.training.every(s=>!held.has(inputKey(s))));admittedNew=bank.bank.training.length-before.bank.training.length;
  }
  const candidateFile=path.join(root,'profiles',p.id,'replay/candidate.json.gz');let replay=null;
  if(exists(candidateFile)){
    const r=await read(candidateFile);assert.equal(r.configHash,digest(c));assert.equal(r.lessonBank.sha256,sha(bankFile));
    for(const f of r.originalGames)verifyArtifact(f);assert.deepEqual(r.originalGames,p.replay.games);
    const model=deserialize(unwrap(r));try{assert.equal(neuralBehaviorHash(model),r.afterBehaviorHash);}finally{dispose(model);}
    const acceptedEpochs=r.epochGuards.filter(g=>g.passed).length,changed=r.beforeBehaviorHash!==r.afterBehaviorHash;
    assert.equal(changed,acceptedEpochs>0);assert.equal(r.finalGuard.passed,true);
    for(const b of r.batchReports){assert.equal(b.heldOutInputsUsed,false);assert.equal(b.optimizerCommitted,b.accepted);
      if(b.accepted){const a=b.attempts.find(a=>a.passed);assert.ok(a?.objectivePassed);assert.ok(a.retention.every(c=>c.passed));}}
    replay={path:candidateFile,sha256:sha(candidateFile),reusedTrainingGames:r.reusedTrainingGames,admitted:r.trainingGames,
      acceptedEpochs,changed,acceptedBatches:r.batchReports.filter(b=>b.accepted).length,guardFailures:r.epochGuards.filter(g=>!g.passed),optimizerStored:!!r.optimizerState};
  }
  const evaluations=[];
  for(const phase of ['screen','confirmation']){
    const dir=path.join(root,'profiles',p.id,'evaluations/000001',phase),file=path.join(dir,'result.json');if(!exists(file))continue;
    const result=json(file),binding=json(path.join(dir,'plan.json'));assert.equal(digest(binding),result.bindingHash);
    const records=result.gameFiles.map(ref=>json(verifyArtifact(ref)));
    assert.equal(records.length,binding.jobs.length);
    records.forEach((r,i)=>{assert.equal(r.bindingHash,result.bindingHash);assert.deepEqual(r.job,binding.jobs[i]);assert.equal(r.dataRole,'evaluation-only');
      assertEvaluationRows(r.rows,r.job,evaluationReviewHash(binding.review));});
    const recalculated=evaluationDecision(plan.evaluationConfig,phase,records);
    for(const [key,value] of Object.entries(recalculated))assert.deepEqual(result[key],value,key);
    evaluations.push({phase,path:file,sha256:sha(file),games:result.completedGames,decision:recalculated});
  }
  profiles.push({id:p.id,completedCorrectionGames:records.length,expectedCorrectionGames:c.correctionGames[p.id],categories,admittedNew,records,replay,evaluations});
}
const report={at:new Date().toISOString(),configHash:digest(c),executionSha256:sha(path.join(root,'execution.json')),
  controller:exists(path.join(root,'controller.json'))?json(path.join(root,'controller.json')):null,profiles,
  frozenFilesValid:true,liveLeagueModified:false,complete:exists(path.join(root,'result.json'))};
atomic(path.join(root,'audit.json'),report);
console.log(JSON.stringify({...report,profiles:profiles.map(({records,...p})=>p)}));
