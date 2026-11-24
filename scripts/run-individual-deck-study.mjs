import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,atomic,immutable,verifyArtifact,exists} from './deck-league-io.mjs';
import {digest,unwrap,inputKey,partitionTrainingTrajectories} from './deck-league-contract.mjs';
import {freezeEvaluation,evaluationStep} from './deck-league-evaluation.mjs';
import {collectTargetedDeckLessons} from './collect-targeted-deck-lessons.mjs';
import {listNodeProcesses,selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';
import {epochUpdateEvidence} from './constrained-epoch-evidence.mjs';
import {auditDeckLearning} from './audit-deck-learning.mjs';
import {assertFixedChampionReferences} from './fixed-champion-reference.mjs';
import {correctionCoverage,useSecondCollectionStage} from './lesson-coverage-budget.mjs';
import {readIndividualExecution,collectionRecordPath,assertResourceReplay,quarantinedResourceReference,assertQuarantinedResource} from './individual-study-execution.mjs';
import {assertIndividualGameEngine} from './individual-game-evidence.mjs';
import {individualEpochResumeState,finalizeIndividualEpochResume} from './individual-epoch-resume.mjs';
import {registerLeagueEvaluation,assertLaneResult} from './deck-league-evaluation-lane.mjs';

const [directory,mode='run',readyProfile]=process.argv.slice(2),c=json(path.join(directory,'config.json')),root=c.directory;
assert.ok(['preflight','run','replay-ready'].includes(mode));assert.equal(c.contract,'bounded-individual-deck-study-v2');
if(readyProfile)assert.ok(mode==='replay-ready'&&c.profiles.some(p=>p.id===readyProfile));
const load=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f))),base=json(verifyArtifact(c.sourceConfig));
const evaluationLoad=load;
const {tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
const {withFileLock}=await load('scripts/file-lock.mjs');
const {deserializeNeuralModel:deserialize,serializeNeuralModel:serialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
const {trainRecurrentPpo,serializeOptimizer,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
const {seededRandom}=await load('src/ai/neural/selfplay.mjs');
const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
const {assertAdaptiveGame,adaptiveFiniteEpochGuard}=await load('scripts/adaptive-policy-q-evidence.mjs');
const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
const {collectAdaptiveSelfPlay}=await load('scripts/adaptive-selfplay-collection.mjs');
const {deckSearchTaskOptions}=await load('scripts/adaptive-deck-search.mjs');
const {rotatingPolicyRehearsal}=await load('scripts/phase-policy-learning.mjs');
const {measureLessonRetention,lessonSafetyGuard}=await load('scripts/lesson-maintenance.mjs');
const {assertLessonSample,tacticalLessonGuard,lessonTypes}=await load('scripts/tactical-lesson-learning.mjs');
const {resolveLessonMemory}=await load('scripts/lesson-memory-context.mjs');
const progress=(stage,more={})=>atomic(path.join(root,mode==='preflight'?'preflight.json':mode==='replay-ready'?'ready-controller.json':'controller.json'),{at:new Date().toISOString(),pid:process.pid,stage,configHash:digest(c),...more});
async function capacity(){
  for(;;){if(exists(path.join(root,'stop.request.json')))throw Object.assign(Error('Preserved boundary stop'),{code:'BOUNDARY_STOP'});
    const all=await listNodeProcesses(),selected=selectTrainingProcesses(all,c.projectDirectory);
    const processes=[...new Map([...selected,...all.filter(p=>/individual-deck-study|transactional-deck-study|constrained-deck-study/.test(p.commandLine||''))].map(p=>[p.pid,p])).values()];
    const normal=processes.every(p=>{try{return os.getPriority(p.pid)===os.constants.priority.PRIORITY_NORMAL;}catch{return true;}});
    if(normal&&processes.length+base.workerProcesses+2<=16)return;
    progress('waiting-capacity',{processes:processes.length,normal});await new Promise(r=>setTimeout(r,10000));
  }
}
await withFileLock(path.join(root,mode==='replay-ready'?'ready-controller.lock':'controller.lock'),async()=>{
try{
  progress('preflight');await capacity();assert.equal(os.getPriority(0),os.constants.priority.PRIORITY_NORMAL);
  const execution=readIndividualExecution(root);assert.equal(execution.configHash,digest(c));
  const policyRuntime=execution.policyRuntime;
  if(policyRuntime){verifyArtifact(policyRuntime.manifest);
    for(const item of json(policyRuntime.manifest.path))assert.equal(sha(path.join(policyRuntime.directory,item.path)),item.sha256,item.path);
    assert.equal(policyRuntime.engineFingerprint,c.engineFingerprint);
  }
  const policyLoad=policyRuntime?f=>import(pathToFileURL(path.join(policyRuntime.directory,f))):load;
  const {individualTransactionalPolicyUpdater:transactionalPolicyUpdater}=await policyLoad('scripts/individual-transactional-policy.mjs');
  const collectionRepair=execution.repair?json(verifyArtifact(execution.repair)):null;
  for(const ref of execution.files)verifyArtifact(ref);
  for(const ref of execution.evaluationExecutionFiles||[])verifyArtifact(ref);
  for(const item of json(verifyArtifact(c.runtimeManifest)))assert.equal(sha(path.join(c.runtimeDirectory,item.path)),item.sha256,item.path);
  const {computeEngineFingerprint}=await load('scripts/training-safety.mjs');assert.equal(computeEngineFingerprint(),c.engineFingerprint);
  const plan=json(verifyArtifact(execution.plan));assert.equal(plan.configHash,digest(c));
  const roles=await read(verifyArtifact(c.inputRoles)),held=new Set(roles.protected),seen=new Set(roles.trained);
  assert.ok([...held].every(k=>!seen.has(k)),'Ambiguous original input roles');
  const protocols=await read(verifyArtifact(base.protocols));
  const response=json(verifyArtifact(plan.responseConfig)).responseContext;assert.ok(response);verifyArtifact(plan.inputProtocol);
  for(const p of c.profiles){
    [p.champion,p.lessons,p.originalLessons,p.auditLearner].forEach(verifyArtifact);
    const tp=json(verifyArtifact(plan.trainingPlans.find(t=>t.profileId===p.id)));
    assert.equal(tp.sourceSha256,p.champion.sha256);assert.equal(tp.sourcePath,p.champion.path);
    assertFixedChampionReferences(plan.evaluationConfig,p,p.champion,c.opponents);
    const m=deserialize(unwrap(await read(p.champion.path)));
    try{const bank=await read(p.lessons.path),original=await read(p.originalLessons.path);
      assert.deepEqual(bank.bank.validation,original.bank.validation);
      assert.deepEqual(bank.bank.training.slice(0,original.bank.training.length),original.bank.training);
      for(const s of bank.bank.training){assertLessonSample(s,'training');assert.equal(s.deckId,p.deck.id);assert.ok(!held.has(inputKey(s)));}
      const s=bank.bank.validation[0];assert.ok(inferStep(m,s.steps[0].state,s.steps[0].actions,s.steps[0].legalCount,resolveLessonMemory(m,s)).logits.every(Number.isFinite));
    }finally{dispose(m);}
  }
  if(mode==='preflight'){
    if(execution.repair){
      const repair=json(verifyArtifact(execution.repair)),prior=json(verifyArtifact(repair.previousPreflight));
      assert.equal(prior.stage,'passed');assert.equal(prior.configHash,digest(c));
      assert.equal(prior.auditSha256,repair.priorAudit.sha256);
      assert.equal(json(verifyArtifact(repair.priorAudit)).passed,true);
    }else{
      const audit=await auditDeckLearning({config:c,load,onProgress:progress});atomic(path.join(root,'deck-audit.json'),audit);
    }
    progress('passed',{profiles:c.profiles.length,backend:tfBackend,executionHash:digest(execution),
      auditSha256:sha(path.join(root,'deck-audit.json')),reusedUnchangedModelAudit:Boolean(execution.repair)});return;
  }
  assert.equal(json(path.join(root,'preflight.json')).stage,'passed');
  if(execution.repair)assert.equal(json(path.join(root,'preflight.json')).executionHash,digest(execution));
  assert.equal(json(path.join(root,'deck-audit.json')).passed,true);
  assert.ok(!exists(path.join(root,'result.json')),'Completed experiment cannot repeat.');
  // Collect all predeclared training jobs before any diagnostic evaluation.
  const banks=new Map(),collection=[];
  for(const p of c.profiles){
    if(mode==='replay-ready'){
      if(readyProfile&&p.id!==readyProfile)continue;
      const file=path.join(root,'profiles',p.id,'lessons.json.gz');
      if(exists(file))banks.set(p.id,{bank:await read(file),path:file,sha256:sha(file)});
      continue;
    }
    const bank=await read(p.lessons.path),duplicates=new Set(bank.bank.training.map(inputKey));
    const collector=deserialize(unwrap(await read(p.champion.path)));
    try{for(const job of plan.corrections.filter(j=>j.profileId===p.id)){
      const targets=p.id==='master-yi-aurora'?['mulligan','resource','response','growth']:['mulligan','resource','response'];
      if(job.collectionStage===1&&!useSecondCollectionStage(collection,p.id,targets,c.coverageBudget)){
        collection.push({profileId:p.id,target:job.target,collectionStage:1,jobId:job.id,disposition:'skipped-coverage-sufficient'});continue;
      }
      const quarantined=quarantinedResourceReference(collectionRepair,job);
      if(quarantined){
        const record=await read(verifyArtifact(quarantined));assertQuarantinedResource(record,job,digest(c));
        for(const key of record.inputKeys||[])if(!held.has(key))seen.add(key);
        collection.push({...quarantined,profileId:p.id,target:job.target,collectionStage:job.collectionStage,jobId:job.id,
          disposition:'quarantined-resource-routing',accepted:0,protected:0,duplicate:0,diagnostics:record.diagnostics});
        atomic(path.join(root,'collection-progress.json'),{at:new Date().toISOString(),records:collection,
          quarantinedResourceGames:collection.filter(r=>r.disposition==='quarantined-resource-routing').length,
          coverage:correctionCoverage(collection,p.id,targets,c.coverageBudget)});
        continue;
      }
      if(exists(path.join(root,'stop.request.json')))throw Object.assign(Error('Preserved boundary stop'),{code:'BOUNDARY_STOP'});
      const file=collectionRecordPath(root,p.id,job,execution);
      const originalFile=path.join(root,'profiles',p.id,'lessons',job.id+'.json.gz');let record;
      if(exists(file)){record=await read(file);assert.deepEqual(record.job,job);assert.equal(record.configHash,digest(c));}
      else{await capacity();progress('targeted-correction-collection',{profileId:p.id,target:job.target,job:job.id});
        const opponent=deserialize(unwrap(await read(verifyArtifact(job.opponent))));
        try{record={...await collectTargetedDeckLessons({load,job,model:collector,opponent,config:{...c,deckId:p.deck.id,
          maximumTeacherReviews:job.target==='growth'?32:48,decks:base.profiles.map(p=>p.deck),engineFingerprint:c.engineFingerprint,responseContext:response}}),configHash:digest(c)};
          if(file!==originalFile&&exists(originalFile)){
            record.repairReplay={original:{path:originalFile,sha256:sha(originalFile)},...assertResourceReplay(await read(originalFile),record)};
          }
          await write(file,record);
        }finally{dispose(opponent);}
      }
      assert.equal(record.failure,null,`Collector failure is not a shortage: ${record.failure}`);
      if(file!==originalFile){
        assert.equal(record.resourceTeacherContract,'existing-local-resource-demonstration-v1');
        if(exists(originalFile)){
          assert.equal(record.repairReplay.original.path,originalFile);verifyArtifact(record.repairReplay.original);
          assertResourceReplay(await read(originalFile),record);
        }
      }
      const counts={accepted:0,protected:0,duplicate:0};
      for(const s of record.samples){assertLessonSample(s,'training');assert.equal(s.deckId,p.deck.id);assert.equal(s.memoryContext.fromReset,true);
        assert.equal(s.lessonSource.proof.thresholdsUnchanged,true);assert.ok(lessonTypes(s).includes(job.target));const key=inputKey(s);
        if(held.has(key)){counts.protected++;continue;}if(duplicates.has(key)){counts.duplicate++;continue;}
        duplicates.add(key);seen.add(key);bank.bank.training.push(s);counts.accepted++;
      }
      for(const key of record.inputKeys||[])if(!held.has(key))seen.add(key);
      collection.push({path:file,sha256:sha(file),profileId:p.id,target:job.target,collectionStage:job.collectionStage,diagnostics:record.diagnostics,...counts});
      atomic(path.join(root,'collection-progress.json'),{at:new Date().toISOString(),records:collection,
        quarantinedResourceGames:collection.filter(r=>r.disposition==='quarantined-resource-routing').length,
        coverage:correctionCoverage(collection,p.id,targets,c.coverageBudget)});
    }}finally{dispose(collector);}
    const bankPath=path.join(root,'profiles',p.id,'lessons.json.gz');
    if(exists(bankPath))assert.equal(digest(await read(bankPath)),digest(bank));else await write(bankPath,bank);
    banks.set(p.id,{bank,path:bankPath,sha256:sha(bankPath)});
  }
  if(mode!=='replay-ready')atomic(path.join(root,'collection-result.json'),{at:new Date().toISOString(),records:collection,criteriaUnchanged:true});
  const candidates=[];
  for(const p of c.profiles){
    if(!banks.has(p.id))continue;
    await withFileLock(path.join(root,'profiles',p.id,'replay.lock'),async()=>{
    await capacity();const dir=path.join(root,'profiles',p.id,'replay'),file=path.join(dir,'candidate.json.gz'),planRef=plan.trainingPlans.find(t=>t.profileId===p.id),tp=json(verifyArtifact(planRef)),original=await read(p.originalLessons.path),b=banks.get(p.id),bank=b.bank;
    const collector=deserialize(unwrap(await read(verifyArtifact(p.champion)))),opponentModels=[];
    try{
      for(const o of c.opponents)opponentModels.push(deserialize(unwrap(await read(verifyArtifact(o)))));
      progress('collecting-own-policy',{profileId:p.id,total:28});
      await collectAdaptiveSelfPlay({directory:dir,plan:tp,model:collector,league:opponentModels,decks:base.profiles.map(p=>p.deck),
        workers:1,processes:2,initialProcesses:2,maximumProcesses:2,dynamicScaling:false,memoryAwareInitialProcesses:true,
        minimumFreeMemoryBytes:4*1024**3,releaseIdleOnStop:true,awaitWorkerExit:true,maxActions:2400,maximumTaskDurationMs:0,
        bestOfThreeFraction:0,teacherFraction:0,teacherBudget:0,teacherCriticalBudget:0,teacherUrgentBudget:0,
        teacherEvaluatorMode:'heuristic-only',captureIndependentLeafAudit:false,captureProductionLeafAudit:false,engineFingerprint:c.engineFingerprint,
        onGameComplete:async()=>progress('collecting-own-policy',{profileId:p.id,completed:fs.readdirSync(path.join(dir,'games')).filter(f=>f.endsWith('.json.gz')).length,total:28}),
        resolveTaskOptions:({task})=>({optionOverrides:{...deckSearchTaskOptions(tp.deckSearch,task.gameIndex)}})});
    }finally{dispose(collector);opponentModels.forEach(dispose);}
    const originalGames=Array.from({length:28},(_,i)=>{const file=path.join(dir,'games',i+'.json.gz');return {path:file,sha256:sha(file)};});
    const raw=[];for(let i=0;i<28;i++){const g=await read(verifyArtifact(originalGames[i]));assertAdaptiveGame(g,tp,i);
      assertIndividualGameEngine(g,c.engineFingerprint);
      for(const t of g.trajectories){assert.equal(t.deckId,p.deck.id);raw.push(t);}}
    const partition=partitionTrainingTrajectories(raw,held,ACTION_DIM);
    for(const key of partition.used)seen.add(key);for(const s of bank.bank.training)seen.add(inputKey(s));
    let final;
    if(exists(file)){final=await read(file);assert.equal(final.configHash,digest(c));assert.equal(final.lessonBank.sha256,b.sha256);}
    else{
      const payload=await read(p.champion.path),epochFile=path.join(dir,'epoch.json.gz'),resume=exists(epochFile)?await read(epochFile):null;
      if(resume){assert.equal(resume.configHash,digest(c));assert.equal(resume.planHash,digest(tp));assert.equal(resume.lessonBankHash,b.sha256);}
      const source=deserialize(unwrap(payload)),candidate=deserialize(unwrap(resume||payload)),champion=deserialize(unwrap(payload));let trained,optimizer;
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
        let lastAcceptedHash=resume?.lastAcceptedHash||neuralBehaviorHash(source);const batchReports=resume?.batchReports||[];
        const rehearsal=rotatingPolicyRehearsal(bank.bank,protocols.joint,base.sourceIteration+1,protocols.phase,candidate),finite=adaptiveFiniteEpochGuard();
        const optimizerState=resume?.optimizerState||payload.optimizerState;
        optimizer=optimizerState?await restoreAdamOptimizer(optimizerState,.0001):undefined;
        const random=seededRandom(tp.epochSeed);if(resume?.randomState!=null)random.setState(resume.randomState);
        if(partition.eligible.length){
          progress('individual-policy-training',{profileId:p.id,admitted:partition.eligible.length});
          trained=await trainRecurrentPpo(candidate,partition.eligible,{epochs:4,batchSize:16,learningRate:.0001,optimizer,random,resumeState:individualEpochResumeState(resume,4),
            teacherConsumptionPolicy:'record-only-v1',beliefCoefficient:0,anchorModels:[{model:source,weight:1}],anchorCoefficient:.05,...finite,
            policyRehearsalForBatch:rehearsal,ppoBatchUpdate:transactionalPolicyUpdater({trajectories:partition.eligible,source,champion,protectedKeys:held,rehearsalForBatch:rehearsal,
              trainingGroups:[{id:'original',samples:original.bank.training},{id:'augmented',samples:bank.bank.training}],onBatch:r=>{batchReports.push(r);progress('individual-policy-training',{profileId:p.id,epoch:r.epoch,batch:r.batch,accepted:r.accepted});}}),
            epochGuard:args=>{const g=guard(),afterHash=neuralBehaviorHash(candidate),updateEvidence=epochUpdateEvidence(batchReports,args.epoch,lastAcceptedHash,afterHash);
              const passed=g.passed&&finite.epochGuard(args).passed&&updateEvidence.passed;if(passed)lastAcceptedHash=afterHash;return {...g,passed,updateEvidence};},
            selectBestEpoch:false,gamesObserved:partition.eligible.length,
            onEpochCheckpoint:item=>write(epochFile,{...item,checkpoint:serialize(candidate),configHash:digest(c),planHash:digest(tp),
              lessonBankHash:b.sha256,lastAcceptedHash,batchReports}),
            onEpoch:r=>progress('individual-policy-training',{profileId:p.id,epoch:r.epoch,acceptedEpoch:r.accepted})});
          finalizeIndividualEpochResume(candidate,resume);
        }
        final={configHash:digest(c),checkpoint:serialize(candidate),optimizerState:trained?await serializeOptimizer(trained.optimizer,candidate.generation):payload.optimizerState,
          source:p.champion,plan:planRef,originalGames,beforeBehaviorHash:neuralBehaviorHash(source),afterBehaviorHash:neuralBehaviorHash(candidate),
          epochGuards:trained?.epochGuards||[],collectedGames:28,reusedTrainingGames:0,trainingGames:partition.eligible.length,excluded:partition.excluded,
          batchReports,policyRuntime:policyRuntime||null,finalGuard:guard(),lessonBank:{path:b.path,sha256:b.sha256},at:new Date().toISOString()};
        await write(file,final);
      }finally{(trained?.optimizer||optimizer)?.dispose();[source,candidate,champion].forEach(dispose);}
    }
    await write(path.join(dir,'trained-input-keys.json.gz'),{planHash:digest(tp),keys:[...partition.used].sort(),excluded:partition.excluded,overlaps:partition.overlaps});
    candidates.push({profileId:p.id,candidate:{path:file,sha256:sha(file),behaviorHash:final.afterBehaviorHash,generation:final.checkpoint.generation},
      changed:final.beforeBehaviorHash!==final.afterBehaviorHash,acceptedEpochs:final.epochGuards.filter(g=>g.passed).length,finalGuard:final.finalGuard});
    const progressFile=path.join(root,'replay-progress.json'),previous=exists(progressFile)?json(progressFile).candidates:[];
    atomic(progressFile,{at:new Date().toISOString(),candidates:[...new Map([...previous,...candidates].map(item=>[item.profileId,item])).values()]});
    },{timeoutMs:24*60*60*1000});
  }
  const results=[];
  for(const item of candidates){
    await withFileLock(path.join(root,'profiles',item.profileId,'evaluation.lock'),async()=>{
    const p=c.profiles.find(p=>p.id===item.profileId);let evaluation={skipped:'unchanged-or-unverified-candidate',promoted:false};
    const savedFile=path.join(root,'profiles',p.id,'result.json');
    if(exists(savedFile)){const saved=json(savedFile);assert.equal(saved.candidate.sha256,item.candidate.sha256);results.push(saved);return;}
    if(item.changed&&item.acceptedEpochs>0&&item.finalGuard.passed){
      assertFixedChampionReferences(plan.evaluationConfig,p,p.champion,c.opponents);
      const pending=freezeEvaluation(plan.evaluationConfig,p,1,item.candidate,p.champion,c.opponents,plan.inputProtocol);
      if(execution.evaluationLane){
        pending.evaluationRuntime=execution.evaluationLane.runtime;
        const request=registerLeagueEvaluation(plan.evaluationConfig,pending,execution.evaluationLane);
        for(;;){
          await capacity();const resultFile=request.path.replace('.request.json','.result.json'),failureFile=request.path.replace('.request.json','.failure.json');
          if(exists(failureFile))throw Error(`Fixed-budget evaluation failed: ${failureFile}`);
          if(exists(resultFile)){evaluation=assertLaneResult(json(verifyArtifact(request)),json(resultFile));break;}
          progress('waiting-independent-evaluation',{profileId:p.id,request});await new Promise(r=>setTimeout(r,2000));
        }
      }else{
      for(;;){await capacity();assertFixedChampionReferences(plan.evaluationConfig,p,pending.incumbent,pending.opponents);const result=await evaluationStep({config:plan.evaluationConfig,pending,load:evaluationLoad,
        protectedInputs:held,trainedInputs:seen,saveProtection:async()=>{},status:progress});
        if(result.nextPhase)pending.phase=result.nextPhase;if(result.done){evaluation=result.result;break;}}
      }
    }
    const result={...item,evaluation,appliedToLeague:false,servingEnabled:false};results.push(result);atomic(path.join(root,'profiles',p.id,'result.json'),result);
    },{timeoutMs:24*60*60*1000});
  }
  atomic(path.join(root,mode==='replay-ready'?'ready-result.json':'result.json'),{at:new Date().toISOString(),configHash:digest(c),results,collection,referencePolicy:c.referencePolicy,liveLeagueModified:false,automaticIntegration:false});
  progress('completed',{profiles:results.length});
}catch(error){if(error.code==='BOUNDARY_STOP'){progress('paused-at-boundary');return;}progress('failed',{error:error.stack});throw error;}
},{timeoutMs:1000});
