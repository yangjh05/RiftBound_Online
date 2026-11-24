import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,atomic,immutable,verifyArtifact,exists} from './deck-league-io.mjs';
import {digest,unwrap,inputKey,partitionTrainingTrajectories} from './deck-league-contract.mjs';
import {freezeEvaluation,evaluationStep} from './deck-league-evaluation.mjs';
import {collectTargetedDeckLessons} from './collect-targeted-deck-lessons.mjs';
import {listNodeProcesses,selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';
import {epochUpdateEvidence} from './constrained-epoch-evidence.mjs';

const [directory,mode='run']=process.argv.slice(2),c=json(path.join(directory,'config.json')),root=c.directory;
assert.ok(['preflight','run'].includes(mode));assert.equal(c.contract,'bounded-transactional-deck-study-v1');
const load=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f))),base=json(verifyArtifact(c.sourceConfig));
const evaluationLoad=f=>import(pathToFileURL(path.join(base.runtimeDirectory,f)));
const {tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
const {withFileLock}=await load('scripts/file-lock.mjs');
const {deserializeNeuralModel:deserialize,serializeNeuralModel:serialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
const {trainRecurrentPpo,serializeOptimizer,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
const {seededRandom}=await load('src/ai/neural/selfplay.mjs');
const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
const {assertAdaptiveGame,adaptiveFiniteEpochGuard}=await load('scripts/adaptive-policy-q-evidence.mjs');
const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
const {transactionalPolicyUpdater}=await load('scripts/transactional-policy-learning.mjs');
const {rotatingPolicyRehearsal}=await load('scripts/phase-policy-learning.mjs');
const {measureLessonRetention,lessonSafetyGuard}=await load('scripts/lesson-maintenance.mjs');
const {assertLessonSample,tacticalLessonGuard,lessonTypes}=await load('scripts/tactical-lesson-learning.mjs');
const {resolveLessonMemory}=await load('scripts/lesson-memory-context.mjs');
const progress=(stage,more={})=>atomic(path.join(root,mode==='preflight'?'preflight.json':'controller.json'),{at:new Date().toISOString(),pid:process.pid,stage,configHash:digest(c),...more});
async function capacity(){
  for(;;){const all=await listNodeProcesses(),selected=selectTrainingProcesses(all,c.projectDirectory);
    const processes=[...new Map([...selected,...all.filter(p=>/transactional-deck-study|constrained-deck-study/.test(p.commandLine||''))].map(p=>[p.pid,p])).values()];
    const normal=processes.every(p=>{try{return os.getPriority(p.pid)===os.constants.priority.PRIORITY_NORMAL;}catch{return true;}});
    if(normal&&processes.length<=16)return;
    progress('waiting-capacity',{processes:processes.length,normal});await new Promise(r=>setTimeout(r,10000));
  }
}
await withFileLock(path.join(root,'controller.lock'),async()=>{
try{
  progress('preflight');await capacity();assert.equal(os.getPriority(0),os.constants.priority.PRIORITY_NORMAL);
  const execution=json(path.join(root,'execution.json'));assert.equal(execution.configHash,digest(c));
  for(const ref of execution.files)verifyArtifact(ref);
  for(const item of json(verifyArtifact(c.runtimeManifest)))assert.equal(sha(path.join(c.runtimeDirectory,item.path)),item.sha256,item.path);
  const {computeEngineFingerprint}=await load('scripts/training-safety.mjs');assert.equal(computeEngineFingerprint(),base.engineFingerprint);
  const plan=json(verifyArtifact(execution.plan));assert.equal(plan.configHash,digest(c));
  const roles=await read(verifyArtifact(c.inputRoles)),held=new Set(roles.protected),seen=new Set(roles.trained);
  assert.ok([...held].every(k=>!seen.has(k)),'Ambiguous original input roles');
  const protocols=await read(verifyArtifact(base.protocols));
  const response=json(verifyArtifact(plan.responseConfig)).responseContext;assert.ok(response);verifyArtifact(plan.inputProtocol);
  for(const p of c.profiles){
    [p.champion,p.lessons,p.originalLessons,p.replay.plan,p.replay.admission,...p.replay.games].forEach(verifyArtifact);
    const tp=json(p.replay.plan.path);assert.equal(tp.sourceSha256,p.champion.sha256);assert.equal(tp.sourcePath,p.champion.path);
    const m=deserialize(unwrap(await read(p.champion.path)));
    try{const bank=await read(p.lessons.path),original=await read(p.originalLessons.path);
      assert.deepEqual(bank.bank.validation,original.bank.validation);
      assert.deepEqual(bank.bank.training.slice(0,original.bank.training.length),original.bank.training);
      for(const s of bank.bank.training){assertLessonSample(s,'training');assert.equal(s.deckId,p.deck.id);assert.ok(!held.has(inputKey(s)));}
      const s=bank.bank.validation[0];assert.ok(inferStep(m,s.steps[0].state,s.steps[0].actions,s.steps[0].legalCount,resolveLessonMemory(m,s)).logits.every(Number.isFinite));
    }finally{dispose(m);}
  }
  if(mode==='preflight'){progress('passed',{profiles:c.profiles.length,backend:tfBackend});return;}
  assert.ok(!exists(path.join(root,'result.json')),'Completed experiment cannot repeat.');
  // Collect all predeclared training jobs before any diagnostic evaluation.
  const banks=new Map(),collection=[];
  for(const p of c.profiles){
    const bank=await read(p.lessons.path),duplicates=new Set(bank.bank.training.map(inputKey));
    const collector=deserialize(unwrap(await read(p.champion.path)));
    try{for(const job of plan.corrections.filter(j=>j.profileId===p.id)){
      await capacity();const file=path.join(root,'profiles',p.id,'lessons',job.id+'.json.gz');let record;
      if(exists(file)){record=await read(file);assert.deepEqual(record.job,job);assert.equal(record.configHash,digest(c));}
      else{progress('targeted-correction-collection',{profileId:p.id,target:job.target,job:job.id});
        const opponent=deserialize(unwrap(await read(verifyArtifact(job.opponent))));
        try{record={...await collectTargetedDeckLessons({load,job,model:collector,opponent,config:{...c,deckId:p.deck.id,
          maximumTeacherReviews:job.target==='growth'?32:48,decks:base.profiles.map(p=>p.deck),engineFingerprint:base.engineFingerprint,responseContext:response}}),configHash:digest(c)};
          await write(file,record);
        }finally{dispose(opponent);}
      }
      assert.equal(record.failure,null,`Collector failure is not a shortage: ${record.failure}`);
      const counts={accepted:0,protected:0,duplicate:0};
      for(const s of record.samples){assertLessonSample(s,'training');assert.equal(s.deckId,p.deck.id);assert.equal(s.memoryContext.fromReset,true);
        assert.equal(s.lessonSource.proof.thresholdsUnchanged,true);assert.ok(lessonTypes(s).includes(job.target));const key=inputKey(s);
        if(held.has(key)){counts.protected++;continue;}if(duplicates.has(key)){counts.duplicate++;continue;}
        duplicates.add(key);seen.add(key);bank.bank.training.push(s);counts.accepted++;
      }
      for(const key of record.inputKeys||[])if(!held.has(key))seen.add(key);
      collection.push({path:file,sha256:sha(file),profileId:p.id,target:job.target,diagnostics:record.diagnostics,...counts});
      atomic(path.join(root,'collection-progress.json'),{at:new Date().toISOString(),records:collection});
    }}finally{dispose(collector);}
    const bankPath=path.join(root,'profiles',p.id,'lessons.json.gz');
    if(exists(bankPath))assert.equal(digest(await read(bankPath)),digest(bank));else await write(bankPath,bank);
    banks.set(p.id,{bank,path:bankPath,sha256:sha(bankPath)});
  }
  atomic(path.join(root,'collection-result.json'),{at:new Date().toISOString(),records:collection,criteriaUnchanged:true});
  const candidates=[];
  for(const p of c.profiles){
    await capacity();const dir=path.join(root,'profiles',p.id,'replay'),file=path.join(dir,'candidate.json.gz'),tp=json(p.replay.plan.path),original=await read(p.originalLessons.path),b=banks.get(p.id),bank=b.bank;
    const oldAdmission=await read(p.replay.admission.path);assert.equal(oldAdmission.planHash,digest(tp));
    const raw=[];for(let i=0;i<p.replay.games.length;i++){const g=await read(p.replay.games[i].path);assertAdaptiveGame(g,tp,i);
      for(const t of g.trajectories){assert.equal(t.deckId,p.deck.id);raw.push(t);}}
    const partition=partitionTrainingTrajectories(raw,held,ACTION_DIM),allowed=new Set(oldAdmission.keys);
    // Replaying frozen training games is permitted; changing their original
    // policy source, labels or admission role is not.
    assert.ok([...partition.used].every(k=>allowed.has(k)),'Replay admitted a formerly excluded input');
    for(const key of partition.used)seen.add(key);for(const s of bank.bank.training)seen.add(inputKey(s));
    let final;
    if(exists(file)){final=await read(file);assert.equal(final.configHash,digest(c));assert.equal(final.lessonBank.sha256,b.sha256);}
    else{
      const payload=await read(p.champion.path),source=deserialize(unwrap(payload)),candidate=deserialize(unwrap(payload)),champion=deserialize(unwrap(payload));let trained,optimizer;
      try{
        const start=measureLessonRetention(source,bank.bank.validation),startTraining=measureLessonRetention(source,bank.bank.training),beforeOriginal=measureLessonRetention(source,original.bank.training);
        const parentHeld=measureLessonRetention(champion,original.bank.validation),parentTrain=measureLessonRetention(champion,original.bank.training),parentAdded=measureLessonRetention(champion,bank.bank.training);
        const guard=()=>{
          const after=measureLessonRetention(candidate,bank.bank.validation),afterTrain=measureLessonRetention(candidate,bank.bank.training),afterOriginal=measureLessonRetention(candidate,original.bank.training);
          const checks={validation:lessonSafetyGuard(start,after),training:tacticalLessonGuard(startTraining.types,afterTrain.types),originalLocal:tacticalLessonGuard(beforeOriginal.types,afterOriginal.types),
            parentHeld:lessonSafetyGuard(parentHeld,after),parentTrain:lessonSafetyGuard(parentTrain,afterOriginal),parentAdded:lessonSafetyGuard(parentAdded,afterTrain)};
          const lostTraining=startTraining.correct.filter((v,i)=>v&&!afterTrain.correct[i]).length,lostOriginal=beforeOriginal.correct.filter((v,i)=>v&&!afterOriginal.correct[i]).length;
          return {passed:Object.values(checks).every(v=>v.passed)&&!lostTraining&&!lostOriginal,checks,lostTraining,lostOriginal};
        };
        let lastAcceptedHash=neuralBehaviorHash(source);const batchReports=[];
        const rehearsal=rotatingPolicyRehearsal(bank.bank,protocols.joint,base.sourceIteration+1,protocols.phase,candidate),finite=adaptiveFiniteEpochGuard();
        optimizer=payload.optimizerState?await restoreAdamOptimizer(payload.optimizerState,.0001):undefined;
        if(partition.eligible.length){
          progress('saved-training-replay',{profileId:p.id,admitted:partition.eligible.length});
          trained=await trainRecurrentPpo(candidate,partition.eligible,{epochs:4,batchSize:16,learningRate:.0001,optimizer,random:seededRandom(tp.epochSeed),
            teacherConsumptionPolicy:'record-only-v1',beliefCoefficient:0,anchorModels:[{model:source,weight:1}],anchorCoefficient:.05,...finite,
            policyRehearsalForBatch:rehearsal,ppoBatchUpdate:transactionalPolicyUpdater({trajectories:partition.eligible,source,champion,protectedKeys:held,rehearsalForBatch:rehearsal,
              trainingGroups:[{id:'original',samples:original.bank.training},{id:'augmented',samples:bank.bank.training}],onBatch:r=>{batchReports.push(r);progress('saved-training-replay',{profileId:p.id,epoch:r.epoch,batch:r.batch,accepted:r.accepted});}}),
            epochGuard:args=>{const g=guard(),afterHash=neuralBehaviorHash(candidate),updateEvidence=epochUpdateEvidence(batchReports,args.epoch,lastAcceptedHash,afterHash);
              const passed=g.passed&&finite.epochGuard(args).passed&&updateEvidence.passed;if(passed)lastAcceptedHash=afterHash;return {...g,passed,updateEvidence};},
            selectBestEpoch:false,gamesObserved:partition.eligible.length,onEpoch:r=>progress('saved-training-replay',{profileId:p.id,epoch:r.epoch,acceptedEpoch:r.accepted})});
        }
        final={configHash:digest(c),checkpoint:serialize(candidate),optimizerState:trained?await serializeOptimizer(trained.optimizer,candidate.generation):payload.optimizerState,
          source:p.champion,plan:p.replay.plan,originalGames:p.replay.games,beforeBehaviorHash:neuralBehaviorHash(source),afterBehaviorHash:neuralBehaviorHash(candidate),
          epochGuards:trained?.epochGuards||[],collectedGames:0,reusedTrainingGames:raw.length,trainingGames:partition.eligible.length,excluded:partition.excluded,
          batchReports,finalGuard:guard(),lessonBank:{path:b.path,sha256:b.sha256},at:new Date().toISOString()};
        await write(file,final);
      }finally{(trained?.optimizer||optimizer)?.dispose();[source,candidate,champion].forEach(dispose);}
    }
    await write(path.join(dir,'trained-input-keys.json.gz'),{planHash:digest(tp),keys:[...partition.used].sort(),excluded:partition.excluded,overlaps:partition.overlaps});
    candidates.push({profileId:p.id,candidate:{path:file,sha256:sha(file),behaviorHash:final.afterBehaviorHash,generation:final.checkpoint.generation},
      changed:final.beforeBehaviorHash!==final.afterBehaviorHash,acceptedEpochs:final.epochGuards.filter(g=>g.passed).length,finalGuard:final.finalGuard});
    atomic(path.join(root,'replay-progress.json'),{at:new Date().toISOString(),candidates});
  }
  const results=[];
  for(const item of candidates){
    const p=c.profiles.find(p=>p.id===item.profileId);let evaluation={skipped:'unchanged-or-unverified-candidate',promoted:false};
    if(item.changed&&item.acceptedEpochs>0&&item.finalGuard.passed){
      const pending=freezeEvaluation(plan.evaluationConfig,p,1,item.candidate,p.champion,c.opponents,plan.inputProtocol);
      for(;;){await capacity();const result=await evaluationStep({config:plan.evaluationConfig,pending,load:evaluationLoad,
        protectedInputs:held,trainedInputs:seen,saveProtection:async()=>{},status:progress});
        if(result.nextPhase)pending.phase=result.nextPhase;if(result.done){evaluation=result.result;break;}}
    }
    const result={...item,evaluation,appliedToLeague:false,servingEnabled:false};results.push(result);atomic(path.join(root,'profiles',p.id,'result.json'),result);
  }
  atomic(path.join(root,'result.json'),{at:new Date().toISOString(),configHash:digest(c),results,collection,liveLeagueModified:false,automaticIntegration:false});
  progress('completed',{profiles:c.profiles.length});
}catch(error){progress('failed',{error:error.stack});throw error;}
},{timeoutMs:1000});
