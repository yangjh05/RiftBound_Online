import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL,fileURLToPath} from 'node:url';
import {json,sha,atomic,immutable,verifyArtifact,exists,reserveSeeds} from './deck-league-io.mjs';
import {digest,unwrap,inputKey,seedFor,trainingPlan,partitionTrainingTrajectories} from './deck-league-contract.mjs';
import {freezeEvaluation,evaluationStep} from './deck-league-evaluation.mjs';
import {collectVerifiedDeckLessons} from './collect-verified-deck-lessons.mjs';
import {listNodeProcesses,selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';

const [directory,mode='run']=process.argv.slice(2),c=json(path.join(directory,'config.json')),root=c.directory;
assert.ok(['preflight','run'].includes(mode));assert.equal(c.contract,'bounded-constrained-deck-study-v1');
const repairFile=path.join(root,'implementation-repair.json'),repair=exists(repairFile)?json(repairFile):null;
if(repair){assert.equal(repair.configHash,digest(c));verifyArtifact(repair.original);verifyArtifact(repair.replacement);}
const runtime=repair?.directory||c.runtimeDirectory;
const load=f=>import(pathToFileURL(path.join(runtime,f))),base=json(verifyArtifact(c.sourceConfig));
const evaluationLoad=f=>import(pathToFileURL(path.join(base.runtimeDirectory,f)));
const {tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow','Native backend is required.');
const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
const {withFileLock}=await load('scripts/file-lock.mjs');
const {deserializeNeuralModel:deserialize,serializeNeuralModel:serialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
const {trainRecurrentPpo,serializeOptimizer,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
const {seededRandom}=await load('src/ai/neural/selfplay.mjs');const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
const {collectAdaptiveSelfPlay}=await load('scripts/adaptive-selfplay-collection.mjs');const {deckSearchTaskOptions}=await load('scripts/adaptive-deck-search.mjs');
const {assertAdaptiveGame,adaptiveFiniteEpochGuard}=await load('scripts/adaptive-policy-q-evidence.mjs');
const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
const {constrainedPolicyUpdater}=await load('scripts/constrained-policy-learning.mjs');
const {rotatingPolicyRehearsal}=await load('scripts/phase-policy-learning.mjs');
const {measureLessonRetention,lessonSafetyGuard}=await load('scripts/lesson-maintenance.mjs');
const {assertLessonSample,tacticalLessonGuard}=await load('scripts/tactical-lesson-learning.mjs');
const {resolveLessonMemory}=await load('scripts/lesson-memory-context.mjs');
const progress=(stage,more={})=>atomic(path.join(root,mode==='preflight'?'preflight.json':'controller.json'),{at:new Date().toISOString(),pid:process.pid,stage,configHash:digest(c),...more});
const waitCapacity=async()=>{
  for(;;){const processes=selectTrainingProcesses(await listNodeProcesses(),c.projectDirectory);
    const normal=processes.every(p=>{try{return os.getPriority(p.pid)===os.constants.priority.PRIORITY_NORMAL;}catch{return true;}});
    if(normal&&processes.length+2<=16)return;
    progress('waiting-capacity',{processes:processes.length,normal});await new Promise(r=>setTimeout(r,10000));}
};
await withFileLock(path.join(root,'controller.lock'),async()=>{
 try{
  progress('preflight');assert.equal(os.getPriority(0),os.constants.priority.PRIORITY_NORMAL);
  for(const item of json(verifyArtifact(c.runtimeManifest)))assert.equal(sha(path.join(c.runtimeDirectory,item.path)),item.sha256);
  for(const item of c.implementation){if(repair&&item.sha256===repair.original.sha256)verifyArtifact(repair.original);else verifyArtifact(item);}
  if(repair)for(const item of json(verifyArtifact(repair.manifest)))assert.equal(sha(path.join(runtime,item.path)),item.sha256);
  const execution=json(path.join(root,repair?'execution-r2.json':'execution.json'));
  for(const ref of execution.files)verifyArtifact(ref);
  const plan=json(verifyArtifact(execution.plan));assert.equal(plan.configHash,digest(c));
  const roles=await read(verifyArtifact(c.inputRoles)),held=new Set(roles.protected),seen=new Set(roles.trained);
  assert.ok([...held].every(k=>!seen.has(k)));
  const protocols=await read(verifyArtifact(base.protocols));
  const response=json(verifyArtifact(plan.responseConfig)).responseContext;assert.ok(response);
  const evaluationConfig=plan.evaluationConfig;const inputProtocol=plan.inputProtocol;
  verifyArtifact(inputProtocol);
  for(const p of c.profiles){
    verifyArtifact(p.champion);verifyArtifact(p.lessons);verifyArtifact(p.originalLessons);
    const m=deserialize(unwrap(await read(p.champion.path)));try{
      const bank=await read(p.lessons.path),s=bank.bank.validation[0];
      assert.ok(inferStep(m,s.steps[0].state,s.steps[0].actions,s.steps[0].legalCount,resolveLessonMemory(m,s)).logits.every(Number.isFinite));
    }finally{dispose(m);}
  }
  if(mode==='preflight'){progress('passed',{profiles:3,runtimeFiles:json(c.runtimeManifest.path).length});return;}
  assert.ok(!exists(path.join(root,'result.json')),'Completed experiment cannot repeat.');
  const results=[];
  for(const p of c.profiles){
    await waitCapacity();
    const original=await read(p.originalLessons.path),frozen=await read(p.lessons.path),bank=structuredClone(frozen),duplicates=new Set(bank.bank.training.map(inputKey));
    const profileDir=path.join(root,'profiles',p.id),records=[];fs.mkdirSync(profileDir,{recursive:true});
    const collector=deserialize(unwrap(await read(p.champion.path)));
    try{
      for(const job of plan.corrections.filter(j=>j.profileId===p.id)){
        const file=path.join(profileDir,'lessons',job.id+'.json.gz');let record;
        if(exists(file)){record=await read(file);assert.deepEqual(record.job,job);assert.equal(record.configHash,digest(c));}
        else{
          progress('correction-collection',{profileId:p.id,job:job.id});
          const opponent=deserialize(unwrap(await read(verifyArtifact(job.opponent))));
          try{record={...await collectVerifiedDeckLessons({load,job,model:collector,opponent,config:{...c,deckId:p.deck.id,
            decks:base.profiles.map(p=>p.deck),engineFingerprint:base.engineFingerprint,responseContext:response}}),configHash:digest(c)};
            await write(file,record);
          }finally{dispose(opponent);}
        }
        assert.equal(record.failure,null,`Collector failure is not a shortage: ${record.failure}`);
        const countBefore=bank.bank.training.length;
        for(const s of record.samples){assertLessonSample(s,'training');assert.equal(s.deckId,p.deck.id);assert.equal(s.memoryContext.fromReset,true);
          assert.equal(s.lessonSource.proof.thresholdsUnchanged,true);const key=inputKey(s);
          if(!held.has(key)&&!duplicates.has(key)){duplicates.add(key);seen.add(key);bank.bank.training.push(s);}}
        records.push({path:file,sha256:sha(file),raw:record.samples.length,accepted:bank.bank.training.length-countBefore});
      }
    }finally{dispose(collector);}
    const bankPath=path.join(profileDir,'lessons.json.gz');
    if(exists(bankPath))assert.equal(digest(await read(bankPath)),digest(bank));else await write(bankPath,bank);
    let learner=p.champion;const iterations=[];
    for(let iteration=1;iteration<=c.iterations;iteration++){
      await waitCapacity();const dir=path.join(profileDir,'iterations',String(iteration).padStart(6,'0'));
      const tp=trainingPlan(evaluationConfig,p,iteration,learner,c.opponents);
      immutable(path.join(dir,'plan.json'),tp);
      const file=path.join(dir,'candidate.json.gz');let final;
      if(exists(file)){final=await read(file);assert.equal(final.planHash,digest(tp));}
      else{
        const payload=await read(verifyArtifact(learner)),source=deserialize(unwrap(payload)),candidate=deserialize(unwrap(payload)),champion=deserialize(unwrap(await read(p.champion.path))),opponents=[];let trained,optimizer;
        try{
          for(const o of c.opponents)opponents.push(deserialize(unwrap(await read(verifyArtifact(o)))));
          progress('collecting',{profileId:p.id,iteration});
          await collectAdaptiveSelfPlay({directory:dir,plan:tp,model:source,league:opponents,decks:base.profiles.map(p=>p.deck),
            workers:1,processes:2,initialProcesses:2,maximumProcesses:2,dynamicScaling:false,memoryAwareInitialProcesses:true,
            minimumFreeMemoryBytes:4*1024**3,releaseIdleOnStop:true,awaitWorkerExit:true,maxActions:2400,maximumTaskDurationMs:0,
            bestOfThreeFraction:0,teacherFraction:0,teacherBudget:0,teacherCriticalBudget:0,teacherUrgentBudget:0,
            teacherEvaluatorMode:'heuristic-only',captureIndependentLeafAudit:false,captureProductionLeafAudit:false,engineFingerprint:base.engineFingerprint,
            resolveTaskOptions:({task})=>({optionOverrides:{...deckSearchTaskOptions(tp.deckSearch,task.gameIndex)}})});
          const trajectories=[];
          for(let g=0;g<28;g++){const r=await read(path.join(dir,'games',g+'.json.gz'));assertAdaptiveGame(r,tp,g);assert.equal(r.trajectories[0].deckId,p.deck.id);trajectories.push(...r.trajectories);}
          const partition=partitionTrainingTrajectories(trajectories,held,ACTION_DIM);
          const {eligible,excluded,used,overlaps}=partition;bank.bank.training.forEach(s=>used.add(inputKey(s)));for(const key of used){assert.ok(!held.has(key));seen.add(key);}
          await write(path.join(dir,'trained-input-keys.json.gz'),{planHash:digest(tp),keys:[...used].sort(),excluded,overlaps});
          const start=measureLessonRetention(source,bank.bank.validation),startTraining=measureLessonRetention(source,bank.bank.training);
          const beforeOriginal=measureLessonRetention(source,original.bank.training),parentHeld=measureLessonRetention(champion,original.bank.validation),parentTrain=measureLessonRetention(champion,original.bank.training),parentAdded=measureLessonRetention(champion,bank.bank.training);
          const guard=()=>{
            const after=measureLessonRetention(candidate,bank.bank.validation),afterTrain=measureLessonRetention(candidate,bank.bank.training),afterOriginal=measureLessonRetention(candidate,original.bank.training);
            const checks={validation:lessonSafetyGuard(start,after),training:tacticalLessonGuard(startTraining.types,afterTrain.types),
              originalLocal:tacticalLessonGuard(beforeOriginal.types,afterOriginal.types),parentHeld:lessonSafetyGuard(parentHeld,after),
              parentTrain:lessonSafetyGuard(parentTrain,afterOriginal),parentAdded:lessonSafetyGuard(parentAdded,afterTrain)};
            const lostTraining=startTraining.correct.filter((v,i)=>v&&!afterTrain.correct[i]).length,lostOriginal=beforeOriginal.correct.filter((v,i)=>v&&!afterOriginal.correct[i]).length;
            return {passed:Object.values(checks).every(v=>v.passed)&&!lostTraining&&!lostOriginal,checks,lostTraining,lostOriginal};
          };
          const batchReports=[],rehearsal=rotatingPolicyRehearsal(bank.bank,protocols.joint,base.sourceIteration+iteration,protocols.phase,candidate);
          const finite=adaptiveFiniteEpochGuard();optimizer=payload.optimizerState?await restoreAdamOptimizer(payload.optimizerState,.0001):undefined;
          if(eligible.length){
            progress('training',{profileId:p.id,iteration,admitted:eligible.length});
            trained=await trainRecurrentPpo(candidate,eligible,{epochs:4,batchSize:16,learningRate:.0001,optimizer,random:seededRandom(tp.epochSeed),
              teacherConsumptionPolicy:'record-only-v1',beliefCoefficient:0,anchorModels:[{model:source,weight:1}],anchorCoefficient:.05,...finite,
              policyRehearsalForBatch:rehearsal,ppoBatchUpdate:constrainedPolicyUpdater({trajectories:eligible,source,champion,rehearsalForBatch:rehearsal,onBatch:r=>batchReports.push(r)}),
              epochGuard:args=>{const g=guard();return {...g,passed:g.passed&&finite.epochGuard(args).passed};},selectBestEpoch:false,gamesObserved:eligible.length,
              onEpoch:r=>progress('training',{profileId:p.id,iteration,epoch:r.epoch,accepted:r.accepted})});
          }
          final={checkpoint:serialize(candidate),optimizerState:trained?await serializeOptimizer(trained.optimizer,candidate.generation):payload.optimizerState,
            planHash:digest(tp),beforeBehaviorHash:neuralBehaviorHash(source),afterBehaviorHash:neuralBehaviorHash(candidate),
            epochGuards:trained?.epochGuards||[],collectedGames:28,trainingGames:eligible.length,excluded,batchReports,finalGuard:guard(),
            lessonBank:{path:bankPath,sha256:sha(bankPath)},at:new Date().toISOString()};
          await write(file,final);
        }finally{(trained?.optimizer||optimizer)?.dispose();[source,candidate,champion,...opponents].forEach(dispose);}
      }
      learner={path:file,sha256:sha(file),behaviorHash:final.afterBehaviorHash,generation:final.checkpoint.generation};
      iterations.push({iteration,acceptedEpochs:final.epochGuards.filter(g=>g.passed).length,changed:final.beforeBehaviorHash!==final.afterBehaviorHash,candidate:learner});
    }
    // Freeze ONLY the predeclared final candidate; no selection by score.
    let evaluation={skipped:'unchanged-final-candidate',promoted:false};
    if(learner.behaviorHash!==p.champion.behaviorHash){
      const pending=freezeEvaluation(evaluationConfig,p,c.iterations,learner,p.champion,c.opponents,inputProtocol);
      for(;;){await waitCapacity();const result=await evaluationStep({config:evaluationConfig,pending,load:evaluationLoad,
        protectedInputs:held,trainedInputs:seen,saveProtection:async()=>{},status:progress});
        if(result.nextPhase)pending.phase=result.nextPhase;
        if(result.done){evaluation=result.result;break;}}
    }
    const result={profileId:p.id,records,addedLessons:bank.bank.training.length-frozen.bank.training.length,iterations,evaluation,
      appliedToLeague:false,servingEnabled:false};results.push(result);atomic(path.join(profileDir,'result.json'),result);
  }
  atomic(path.join(root,'result.json'),{at:new Date().toISOString(),configHash:digest(c),results,liveLeagueModified:false,automaticIntegration:false});
  progress('completed',{profiles:3});
 }catch(error){progress('failed',{error:error.stack});throw error;}
},{timeoutMs:1000});
