import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {VIKTOR_CANDIDATE,digest,validateCandidateConfig,candidateTrainingPlan,fullLessonSchedule,candidateScreenJobs,mergeCandidateLessons,candidateReservation,splitProtectedTrajectories,summarizeCandidateScreen,inheritedCandidateTrainingKeys} from './viktor-candidate-learning.mjs';
import {collectViktorFullLessons} from './viktor-full-lessons.mjs';
import {publicInputKey} from './verified-specialist-lessons.mjs';

const [configFile,mode='run']=process.argv.slice(2);
assert.ok(['preflight','run'].includes(mode));
const readJson=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const c=validateCandidateConfig(readJson(configFile)),configHash=digest(c),root=path.resolve(c.directory);
const load=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f)).href);
for(const [name,hash]of Object.entries(c.executionFiles))assert.equal(sha(path.join(path.dirname(fileURLToPath(import.meta.url)),name)),hash,'Candidate executable changed.');
const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
const {withFileLock}=await load('scripts/file-lock.mjs');
const {renameWithRetrySync}=await load('scripts/file-replace.mjs');
const atomic=(f,v)=>{const tmp=`${f}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(v,null,2));renameWithRetrySync(tmp,f);};
const optional=async f=>fs.existsSync(f)?read(f):null;
const status=(stage,extra={})=>atomic(path.join(root,mode==='preflight'?'preflight.json':'controller.json'),{configHash,pid:process.pid,at:new Date().toISOString(),stage,...extra});
const reservationFile=path.join(c.mainRunDirectory,'side-training-reservation.json');
await withFileLock(path.join(root,'controller.lock'),async()=>{
  let parent,specialist,state=await optional(path.join(root,'state.json.gz'));
  let reservationHash=digest(candidateReservation(c,state));
  const requireReservation=()=>assert.equal(digest(readJson(reservationFile)),reservationHash,'Another capacity owner changed the reservation.');
  const artifact=async item=>{assert.equal(sha(item.path),item.sha256,item.path);return read(item.path);};
  const {deserializeNeuralModel:deserialize,serializeNeuralModel:serialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
  const unwrap=p=>p.candidateCheckpoint||p.checkpoint||p;
  try{
    requireReservation();status('preflight');
    assert.equal(os.getPriority(process.pid),os.constants.priority.PRIORITY_NORMAL);
    assert.equal(sha(c.runtimeManifest.path),c.runtimeManifest.sha256);
    for(const item of readJson(c.runtimeManifest.path))assert.equal(sha(path.join(c.runtimeDirectory,item.path)),item.sha256,item.path);
    const {computeEngineFingerprint,assertTrainingTrajectories}=await load('scripts/training-safety.mjs');
    assert.equal(computeEngineFingerprint(),c.engineFingerprint);
    const {assertAdaptiveCheckpoint,assertAdaptiveGame,adaptiveFiniteEpochGuard}=await load('scripts/adaptive-policy-q-evidence.mjs');
    const {assertLegalTrainingDeck}=await load('src/ai/legal-decks.mjs');
    const {expectedDeckSearchPair,deckSearchTaskOptions}=await load('scripts/adaptive-deck-search.mjs');
    const {collectAdaptiveSelfPlay}=await load('scripts/adaptive-selfplay-collection.mjs');
    const {trainRecurrentPpo,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
    const {seededRandom,evaluateNeuralModels}=await load('src/ai/neural/selfplay.mjs');
    const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
    const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
    const {phasePpoLessonRetention,PHASE_ADDITIONAL_GUARD}=await load('scripts/phase-policy-learning.mjs');
    assert.equal(PHASE_ADDITIONAL_GUARD,'phase-additional-acceptance-guard-v1','Prospective candidate runtime must include the fixed-reference recovery hook.');
    const {maintenanceEvaluationRuntime,measureLessonRetention,lessonSafetyGuard}=await load('scripts/lesson-maintenance.mjs');
    const {lessonMemoryCoverage}=await load('scripts/lesson-memory-context.mjs');
    const {assertLessonSample}=await load('scripts/tactical-lesson-learning.mjs');
    const {makeEvaluationReview,evaluationReviewOptions}=await load('scripts/evaluation-decision-review.mjs');
    for(const d of c.decks)assertLegalTrainingDeck(d);
    const parentPayload=await artifact(c.parent),specialistPayload=await artifact(c.specialist);
    assertAdaptiveCheckpoint(unwrap(parentPayload));assertAdaptiveCheckpoint(unwrap(specialistPayload));
    parent=deserialize(unwrap(parentPayload));specialist=deserialize(unwrap(specialistPayload));
    assert.equal(parent.generation,c.parent.generation);assert.equal(specialist.generation,c.specialist.generation);
    const originalBank=await artifact(c.lessons),opening=await artifact(c.openingLessons),protocols=await artifact(c.protocols);
    if(c.priorStage)assert.ok(c.priorTrainingInputs,'A follow-up candidate must preserve prior training input identities.');
    const inheritedTrainingKeys=inheritedCandidateTrainingKeys(c.priorTrainingInputs?await artifact(c.priorTrainingInputs):null,
      [...originalBank.bank.validation,...opening.validation]);
    await maintenanceEvaluationRuntime(protocols.maintenance);
    const review=makeEvaluationReview();assert.deepEqual(review,c.evaluationReview);
    const reviewOptions=evaluationReviewOptions(review);
    const opponentHashes=[neuralBehaviorHash(parent),neuralBehaviorHash(specialist)];
    for(let i=1;i<=4;i++){
      const plan=candidateTrainingPlan(c,i,c.parent.path,opponentHashes[0],opponentHashes,expectedDeckSearchPair);
      const counts={};for(let g=0;g<64;g++){const pair=expectedDeckSearchPair(plan.deckSearch,g,plan.seed),deck=pair[g%2].id;counts[deck]=(counts[deck]||0)+1;
        if(plan.leagueCollection.opponentIndexes[g]===2)assert.equal(pair[1-g%2].id,c.deckId,'Specialist must only play its own deck.');}
      assert.equal(counts[c.deckId],32);for(const d of c.decks)assert.ok(counts[d.id]>=4);
    }
    const example=originalBank.bank.validation[0].steps[0];
    for(const model of [parent,specialist])assert.ok(inferStep(model,example.state,example.actions,example.legalCount,example.initialMemory).logits.every(Number.isFinite));
    if(mode==='preflight'){status('passed',{runtimeFilesVerified:readJson(c.runtimeManifest.path).length,cycles:4,games:256,screenGames:384,inheritedTrainingInputs:inheritedTrainingKeys.size});return;}
    state||={contract:VIKTOR_CANDIDATE,configHash,iteration:0,learnerPath:c.parent.path,completed:false};
    assert.equal(state.configHash,configHash);
    const persist=()=>write(path.join(root,'state.json.gz'),state);
    const readLessonRecords=async()=>{
      const records=[];
      for(const job of fullLessonSchedule(c)){
        const file=path.join(root,'lessons',`${job.id}.json.gz`),r=await optional(file);if(!r)continue;
        const {recordHash,...body}=r;assert.equal(recordHash,digest(body));assert.equal(r.configHash,configHash);assert.deepEqual(r.job,job);
        if(r.failure)assert.equal(r.samples.length,0);
        for(const s of r.samples){assertLessonSample(s,job.role);assert.equal(s.gameId,job.id);assert.equal(s.lessonSource.role,job.role);
          assert.equal(s.deckId,c.deckId);assert.equal(s.memoryContext.contract,'complete-actor-observation-prefix-v1');
          assert.equal(s.memoryContext.playerId,s.playerId);assert.equal(s.memoryContext.fromReset,true);
          assert.equal(s.transferProof.specialistSha256,c.specialist.sha256);assert.equal(s.transferProof.specialistChoice,s.steps[0].selectedIndex);
          assert.equal(s.lessonSource.proof.thresholdsUnchanged,true);}
        records.push(r);
      }
      return records;
    };
    const base=mergeCandidateLessons(originalBank,[...opening.training,...opening.validation],inheritedTrainingKeys);
    fs.mkdirSync(path.join(root,'lessons'),{recursive:true});
    for(let iteration=state.iteration+1;iteration<=c.iterations;iteration++){
      requireReservation();assert.ok(fs.statfsSync(root).bavail*fs.statfsSync(root).bsize>=4*1024**3,'Insufficient disk space.');
      const dir=path.join(root,'iterations',String(iteration).padStart(6,'0'));fs.mkdirSync(dir,{recursive:true});
      const payload=await read(state.learnerPath),source=deserialize(unwrap(payload));let candidate,trained;
      try{
        const sourceHash=neuralBehaviorHash(source),sourceSha256=sha(state.learnerPath);
        const expected=candidateTrainingPlan(c,iteration,state.learnerPath,sourceHash,opponentHashes,expectedDeckSearchPair);
        const planFile=path.join(dir,'plan.json.gz'),savedPlan=await optional(planFile);
        if(savedPlan)assert.equal(digest(savedPlan),digest(expected));else await write(planFile,expected);
        const plan=savedPlan||expected;
        for(const job of fullLessonSchedule(c).filter(j=>j.iteration===iteration)){
          const file=path.join(root,'lessons',`${job.id}.json.gz`),saved=await optional(file);
          if(saved){assert.equal(saved.sourceSha256,sourceSha256);continue;}
          status('full-game-lesson-collection',{iteration,family:job.id,role:job.role});
          const result=await collectViktorFullLessons({load,config:c,job,model:source,specialist});
          const body={...result,configHash,sourcePath:state.learnerPath,sourceSha256,sourceBehaviorHash:sourceHash};
          await write(file,{...body,recordHash:digest(body)});
          status('full-game-lesson-saved',{iteration,family:job.id,accepted:result.samples.length,failure:result.failure});
        }
        const records=await readLessonRecords();
        const previousTrainingKeys=new Set(inheritedTrainingKeys);
        for(let prior=1;prior<iteration;prior++){
          const usage=await read(path.join(root,'iterations',String(prior).padStart(6,'0'),'trained-input-keys.json.gz'));
          assert.equal(usage.configHash,configHash);assert.equal(usage.iteration,prior);
          assert.equal(usage.keysHash,digest(usage.keys));for(const key of usage.keys)previousTrainingKeys.add(key);
        }
        const merged=mergeCandidateLessons(base,records.flatMap(r=>r.samples),previousTrainingKeys);
        // Freeze this cycle's replay bank before PPO; later validation scenes
        // cannot retroactively enter earlier training or replace its guards.
        const bankFile=path.join(dir,'lesson-bank.json.gz');
        const oldBank=await optional(bankFile);if(oldBank)assert.equal(oldBank.bank.samplesHash,merged.bank.samplesHash);else await write(bankFile,merged);
        const protectedKeys=new Set(merged.bank.validation.map(publicInputKey));
        const finalFile=path.join(dir,'candidate.json.gz');let final=await optional(finalFile);
        if(!final){
          status('on-policy-collection',{iteration,games:64,newLessons:merged.freshCounts});let last=0;
          await collectAdaptiveSelfPlay({directory:dir,plan,model:source,league:[source,parent,specialist],decks:c.decks,
            workers:1,processes:2,initialProcesses:1,maximumProcesses:2,memoryAwareInitialProcesses:true,dynamicScaling:true,
            minimumFreeMemoryBytes:4*1024**3,releaseIdleOnStop:true,awaitWorkerExit:true,maxActions:2400,maximumTaskDurationMs:0,
            bestOfThreeFraction:0,mirrorFraction:.5,teacherFraction:0,teacherCriticalBudget:0,teacherUrgentBudget:0,teacherEvaluatorMode:'heuristic-only',
            captureIndependentLeafAudit:false,captureProductionLeafAudit:false,engineFingerprint:c.engineFingerprint,
            resolveTaskOptions:({task})=>({optionOverrides:{...deckSearchTaskOptions(plan.deckSearch,task.gameIndex),learnFirstPlayerChoice:[0,7].includes(task.gameIndex%8)}}),
            onWorkerHeartbeat:async workerPool=>{if(Date.now()-last>15000){last=Date.now();status('on-policy-collection',{iteration,workerPool});}},
            onGameComplete:async({gameIndex})=>status('on-policy-game-saved',{iteration,gameIndex}),
            onRejectedGame:async failure=>status('on-policy-game-rejected',{iteration,failure})});
          const trajectories=[];
          for(let g=0;g<64;g++){
            const result=await read(path.join(dir,'games',`${g}.json.gz`));assertAdaptiveGame(result,plan,g);
            trajectories.push(...result.trajectories);
          }
          assert.equal(trajectories.length,64);assertTrainingTrajectories(trajectories,c.engineFingerprint);
          // Keep the original games, but exclude the entire trajectory from
          // gradients if it overlaps a held-out decision. Do not splice its GAE.
          const split=splitProtectedTrajectories(trajectories,protectedKeys,ACTION_DIM);
          assert.ok(split.eligible.length,'No independent learner trajectories remain.');
          const usedKeys=[...new Set([...split.trainedKeys,...merged.bank.training.map(publicInputKey)])].sort();
          const usage={configHash,iteration,planHash:digest(plan),keys:usedKeys,keysHash:digest(usedKeys),
            collectedGames:64,trainingGames:split.eligible.length,excluded:split.excluded};
          const usageFile=path.join(dir,'trained-input-keys.json.gz'),savedUsage=await optional(usageFile);
          if(savedUsage)assert.equal(digest(savedUsage),digest(usage));else await write(usageFile,usage);
          const epochFile=path.join(dir,'epoch.json.gz'),resume=await optional(epochFile);
          if(resume)assert.equal(resume.planHash,digest(plan));
          candidate=deserialize(unwrap(resume||payload));
          const random=seededRandom(plan.epochSeed);if(resume?.randomState!=null)random.setState(resume.randomState);
          const optimizer=resume?await restoreAdamOptimizer(resume.optimizerState,.0001):undefined;
          const {maintenance,joint,recovery,efficient,phase}=protocols;
          // Guard against cumulative drift as well as each cycle's source.
          const parentGuard=measureLessonRetention(parent,originalBank.bank.validation);
          const parentTrainingGuard=measureLessonRetention(parent,originalBank.bank.training);
          const additionalGuard=()=>{
            const parentValidation=lessonSafetyGuard(parentGuard,measureLessonRetention(candidate,originalBank.bank.validation)),
              parentTraining=lessonSafetyGuard(parentTrainingGuard,measureLessonRetention(candidate,originalBank.bank.training));
            return {passed:parentValidation.passed&&parentTraining.passed,parentValidation,parentTraining};
          };
          const retention=phasePpoLessonRetention(candidate,source,merged,maintenance,joint,recovery,efficient,phase,c.sourceIteration+iteration,{additionalGuard});
          assert.ok(retention);const finite=adaptiveFiniteEpochGuard();
          status('policy-training',{iteration,collectedGames:64,trainingGames:split.eligible.length,excluded:split.excluded,newLessons:merged.freshCounts,
            memoryCoverage:{training:lessonMemoryCoverage(merged.bank.training),validation:lessonMemoryCoverage(merged.bank.validation)}});
          trained=await trainRecurrentPpo(candidate,split.eligible,{epochs:4,batchSize:16,learningRate:.0001,random,optimizer,
            resumeState:resume?.selectionState,teacherConsumptionPolicy:'record-only-v1',beliefCoefficient:0,
            anchorModels:[{model:source,weight:1}],anchorCoefficient:.05,...finite,
            policyRehearsalForBatch:retention.policyRehearsalForBatch,beforeEpochGuard:retention.beforeEpochGuard,
            epochGuard:args=>{const numeric=finite.epochGuard(args),lessons=retention.epochGuard();
              assert.ok(lessons.additionalGuard,'Fixed reference was not checked inside the recovery routes.');
              const {parentValidation,parentTraining}=lessons.additionalGuard;
              return {passed:numeric.passed&&lessons.passed&&parentValidation.passed&&parentTraining.passed,
                finitePassed:numeric.passed,lessonRetention:lessons,parentValidation,parentTraining};},
            selectBestEpoch:false,gamesObserved:split.eligible.length,
            onEpochCheckpoint:item=>write(epochFile,{...item,planHash:digest(plan),checkpoint:serialize(candidate)}),
            onEpoch:metrics=>status('policy-training',{iteration,...metrics})});
          assert.ok(trained.epochGuards.length&&trained.epochGuards.every(g=>g.finitePassed!==false));
          candidate.metadata={...candidate.metadata,experimentalLearner:true,promotionEligible:false,evaluatorCertification:null,
            viktorTransfer:{configHash,iteration,parent:c.parent.sha256,specialist:c.specialist.sha256,ownPolicyOnly:true,mainWeightsChanged:false}};
          final={checkpoint:serialize(candidate),planHash:digest(plan),sourceSha256,beforeBehaviorHash:sourceHash,
            afterBehaviorHash:neuralBehaviorHash(candidate),epochGuards:trained.epochGuards,
            verifiedLessons:merged.freshCounts,trainingGames:split.eligible.length,excluded:split.excluded,promotionEligible:false};
          assertAdaptiveCheckpoint(final.checkpoint);await write(finalFile,final);
        }
        assert.equal(final.planHash,digest(plan));assertAdaptiveCheckpoint(final.checkpoint);
        state.iteration=iteration;state.learnerPath=finalFile;await persist();
        status('candidate-saved',{iteration,changed:final.beforeBehaviorHash!==final.afterBehaviorHash,acceptedEpochs:final.epochGuards.filter(g=>g.passed).length});
      }finally{trained?.optimizer.dispose();if(candidate)dispose(candidate);dispose(source);}
      globalThis.gc?.();
    }
    if(state.completed){status(state.resultStatus,{iteration:state.iteration});return;}
    requireReservation();
    const evaluationReservation=candidateReservation(c,state);
    atomic(reservationFile,evaluationReservation);reservationHash=digest(evaluationReservation);
    const candidatePayload=await read(state.learnerPath),candidate=deserialize(unwrap(candidatePayload));
    try{
      const jobs=candidateScreenJobs(c),binding={configHash,candidatePath:state.learnerPath,candidateSha256:sha(state.learnerPath),
        parentSha256:c.parent.sha256,specialistSha256:c.specialist.sha256,jobs,review:c.evaluationReview,
        purpose:'bounded-diagnostic-only-not-parity-or-promotion',mainWeightsChanged:false};
      const evalDir=path.join(root,'screen');fs.mkdirSync(evalDir,{recursive:true});
      const frozen=path.join(evalDir,'plan.json'),old=fs.existsSync(frozen)?readJson(frozen):null;
      if(old)assert.equal(digest(old),digest(binding));else atomic(frozen,binding);
      const models={candidate,parent,specialist},all=[];
      for(const job of jobs){
        const file=path.join(evalDir,`${job.id}.json`),prior=fs.existsSync(file)?readJson(file):null;
        if(prior)assert.equal(prior.bindingHash,digest(binding));
        const summaries=prior?.summaries||[];
        status('independent-screen',{job:job.id,completed:all.length+summaries.length,total:384});
        const outcome=evaluateNeuralModels(models[job.subject],models[job.opponent],job.deckIds.map(id=>c.decks.find(d=>d.id===id)),{
          games:8,seed:job.seed,evaluationMode:job.mode,greedy:true,maxActions:2400,...reviewOptions,resumedSummaries:summaries,
          onGameComplete:({game,summary})=>{summaries[game-1]=summary;atomic(file,{bindingHash:digest(binding),job,summaries});
            status('independent-screen',{job:job.id,completed:all.length+game,total:384});}});
        assert.ok(outcome.summaries.every(s=>s.completed&&!s.invalid&&!s.adjudicated&&s.counted!==false));
        all.push(...outcome.summaries.map(s=>({job:job.id,group:job.group,subject:job.subject,...s})));
      }
      const result={...binding,completedGames:all.length,...summarizeCandidateScreen(all,c.deckId),status:'bounded-training-and-screen-complete',
        parityEstablished:false,integrationAllowed:false,requiresFreshPrecommittedConfirmation:true};
      atomic(path.join(root,'result.json'),result);state.completed=true;state.resultStatus=result.status;await persist();status(result.status,{completedGames:all.length});
    }finally{dispose(candidate);}
  }catch(error){status('failed',{error:error.stack||String(error),iteration:state?.iteration});throw error;}
  finally{
    if(parent)dispose(parent);if(specialist)dispose(specialist);
    if(mode==='run'){
      const current=readJson(reservationFile);
      if(digest(current)===reservationHash){atomic(reservationFile,c.previousReservation);atomic(path.join(root,'reservation-release.json'),{released:true,at:new Date().toISOString()});}
      else atomic(path.join(root,'reservation-release.json'),{released:false,reason:'Another owner changed the reservation; reconcile without overwriting.'});
    }
  }
},{timeoutMs:1000});
