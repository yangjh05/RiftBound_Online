import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {DECK_LEAGUE,digest,unwrap,validateLeague,trainingPlan,inputKey,protectEvaluationInputs,partitionTrainingTrajectories,skippedTrainingCheckpoint,validateMatchProtocol,assertLessonAugmentation} from './deck-league-contract.mjs';
import {freezeEvaluation,evaluationStep} from './deck-league-evaluation.mjs';
import {json,sha,atomic,immutable,verifyArtifact,exists,reserveSeeds} from './deck-league-io.mjs';
import {assertLeagueRuntimeResume,assertLeagueGameEngine} from './deck-league-runtime-transition.mjs';
import {registerLeagueEvaluation,assertLaneResult} from './deck-league-evaluation-lane.mjs';
import {evaluationAdmission,assertDispatchOnlyLaneTransition} from './league-evaluation-admission.mjs';
import {epochUpdateEvidence} from './constrained-epoch-evidence.mjs';
import {assertRulesRuntimeLaneTransition,assertApprovedEvaluationBinding,evaluationRuleScope} from './reviewed-training-contract.mjs';
import {queryTrainingCapacity} from './training-process-capacity.mjs';

export async function runDeckLeague(configFile,mode='run'){
  const c=validateLeague(json(configFile)),root=c.directory,configHash=digest(c);
  const executionDirectory=path.dirname(fileURLToPath(import.meta.url));
  const repairFile=path.join(executionDirectory,'repair.json'),repair=exists(repairFile)?json(repairFile):null;
  if(repair){
    assert.equal(repair.configHash,configHash);assert.equal(repair.contract,'deck-league-compatible-execution-repair-v1');
    const pointer=json(path.join(root,'execution-active.json'));
    assert.equal(path.resolve(root,pointer.directory),executionDirectory);assert.equal(sha(repairFile),pointer.repairSha256);
  }
  const executionFiles=repair?.executionFiles||c.executionFiles,executionHash=digest(executionFiles);
  const trainingRuntime=repair?.trainingRuntime||{directory:c.runtimeDirectory,manifest:c.runtimeManifest};
  const trainingFingerprint=trainingRuntime.engineFingerprint||c.engineFingerprint;
  const load=f=>import(pathToFileURL(path.join(trainingRuntime.directory,f)).href);
  const evaluationLoad=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f)).href);
  const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
  const {withFileLock,readLiveFileLockOwner}=await load('scripts/file-lock.mjs');
  const {deserializeNeuralModel:deserialize,serializeNeuralModel:serialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
  const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
  const {assertAdaptiveGame,assertAdaptiveCheckpoint,adaptiveFiniteEpochGuard}=await load('scripts/adaptive-policy-q-evidence.mjs');
  const {computeEngineFingerprint,assertTrainingTrajectories}=await load('scripts/training-safety.mjs');
  const {collectAdaptiveSelfPlay}=await load('scripts/adaptive-selfplay-collection.mjs');
  const {deckSearchTaskOptions,expectedDeckSearchPair}=await load('scripts/adaptive-deck-search.mjs');
  const {trainRecurrentPpo,serializeOptimizer,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
  const {seededRandom}=await load('src/ai/neural/selfplay.mjs');
  const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
  const {phasePpoLessonRetention}=await load('scripts/phase-policy-learning.mjs');
  const transactionalUpdater=repair?.policyLearning
    ?(await load('scripts/individual-transactional-policy.mjs')).individualTransactionalPolicyUpdater:null;
  const atomicEpoch=repair?.atomicEpochCommit
    ?(await load('scripts/transactional-epoch-commit.mjs')).atomicPpoEpochRetention:null;
  const retainResourceBank=repair?.resourceCollection
    ?(await load('scripts/on-policy-resource-bank.mjs')).retainOnPolicyResourceBank:null;
  const {measureLessonRetention,lessonSafetyGuard}=await load('scripts/lesson-maintenance.mjs');
  const {tacticalLessonGuard,assertLessonSample}=await load('scripts/tactical-lesson-learning.mjs');
  const reviewedTeacher={approve:(await load('scripts/viktor-candidate-learning.mjs')).approvedTeacherAdvice,
    actionKey:(await load('src/ai/actions.mjs')).actionKey};
  const checkLaneTransition=(previous,next,saved)=>{
    const transition=repair.evaluationLaneTransition;
    if(transition?.contract==='queue-preserving-rules-runtime-transition-v1')return assertRulesRuntimeLaneTransition(previous,next,saved.evaluationLaneHash,{
      previousConfig:json(verifyArtifact(previous.config)),nextConfig:json(verifyArtifact(next.config)),
      previousProtocol:json(verifyArtifact(previous.inputProtocol)),nextProtocol:json(verifyArtifact(next.inputProtocol)),
      boundaryIterations:transition.boundaryIterations,boundaryQueueHash:transition.boundaryQueueHash,queue:saved.evaluationQueue});
    assert.equal(transition?.contract,'queue-preserving-dispatch-only-transition-v1');
    return assertDispatchOnlyLaneTransition(previous,next,saved.evaluationLaneHash);
  };
  const {selectTrainingProcesses,listNodeProcesses}=await import(pathToFileURL(path.join(c.projectDirectory,'server/training-dashboard-priority.mjs')));
  const optional=async f=>exists(f)?read(f):null;
  const status=(stage,extra={})=>atomic(path.join(root,mode==='preflight'?'preflight.json':'controller.json'),{
    contract:DECK_LEAGUE,configHash,executionHash,pid:process.pid,at:new Date().toISOString(),stage,...extra});
  await withFileLock(path.join(root,'controller.lock'),async()=>{
    try{
      status('preflight');
      verifyArtifact(c.runtimeManifest);
      for(const item of json(c.runtimeManifest.path))assert.equal(sha(path.join(c.runtimeDirectory,item.path)),item.sha256,item.path);
      verifyArtifact(trainingRuntime.manifest);
      for(const item of json(trainingRuntime.manifest.path))assert.equal(sha(path.join(trainingRuntime.directory,item.path)),item.sha256,item.path);
      if(repair?.policyLearning){
        const proof=json(verifyArtifact(repair.trainingInferenceEquivalence));assert.equal(proof.passed,true);
        assert.deepEqual(proof.trainingRuntime,trainingRuntime);assert.deepEqual(proof.evaluationRuntime,repair.evaluationLane.runtime);
        assert.equal(proof.inferenceFunctionsByteIdentical,true);assert.equal(proof.nativeInferenceBitIdentical,true);assert.equal(proof.defaultPpoBitIdentical,true);
        proof.tests.forEach(verifyArtifact);
        assert.equal((await load('scripts/individual-transactional-policy.mjs')).TRANSACTIONAL_POLICY,repair.policyLearning.contract);
      }
      if(repair?.futureEvaluationProtocol)verifyArtifact(repair.futureEvaluationProtocol);
      for(const [name,hash]of Object.entries(executionFiles))assert.equal(sha(path.join(executionDirectory,name)),hash,name);
      for(const item of repair?.externalArtifacts||[])verifyArtifact(item);
      assert.equal(computeEngineFingerprint(),trainingFingerprint);assert.equal(os.getPriority(0),os.constants.priority.PRIORITY_NORMAL);
      if(repair?.engineTransition){
        verifyArtifact(repair.engineTransition.plan);
        repair.engineTransition.savedGames.forEach(verifyArtifact);
        assert.deepEqual(repair.engineTransition.nextRuntime,trainingRuntime);
      }
      const protocols=await read(verifyArtifact(c.protocols));
      let protection=exists(path.join(root,'input-protection-live.json.gz'))?await read(path.join(root,'input-protection-live.json.gz')):await read(verifyArtifact(c.inputProtection));
      const protectedInputs=new Set(protection.protected),trainedInputs=new Set(protection.trained);
      assert.ok([...protectedInputs].every(k=>!trainedInputs.has(k)),'Input roles conflict; verify provenance before repairing the ledger.');
      const saveProtection=()=>write(path.join(root,'input-protection-live.json.gz'),{contract:protection.contract,protected:[...protectedInputs].sort(),trained:[...trainedInputs].sort()});
      // A crash can occur after an evaluation game is saved but before its
      // input ledger is flushed. Restore every saved evaluation before PPO.
      for(const p of c.profiles){
        const evaluations=path.join(root,'profiles',p.id,'evaluations');
        if(!exists(evaluations))continue;
        for(const iteration of fs.readdirSync(evaluations))for(const phase of ['screen','confirmation']){
          const dir=path.join(evaluations,iteration,phase);if(!exists(dir))continue;
          const binding=json(path.join(dir,'plan.json'));
          if(binding.inputProtocol){validateMatchProtocol(json(verifyArtifact(binding.inputProtocol)),c,p.id,Number(iteration));continue;}
          for(const file of fs.readdirSync(dir).filter(n=>/^\d+-\d+-(candidate|incumbent)\.json$/.test(n))){
            protectEvaluationInputs(json(path.join(dir,file)).inputKeys||[],protectedInputs,trainedInputs);
          }
        }
      }
      const banks={},originalBanks={};
      for(const p of c.profiles){
        const model=deserialize(unwrap(await read(verifyArtifact(p.initial))));
        try{originalBanks[p.id]=await read(verifyArtifact(p.lessons));banks[p.id]=originalBanks[p.id];
          const addition=repair?.lessonAdditions?.[p.id];
          if(addition){assert.equal(addition.originalSha256,p.lessons.sha256);verifyArtifact(addition.audit);
            const audit=json(addition.audit.path);assert.equal(audit.completed,true);assert.equal(audit.modelWeightsChanged,false);
            banks[p.id]=await read(verifyArtifact(addition.augmented));
            assert.equal(assertLessonAugmentation(originalBanks[p.id],banks[p.id],p.deck.id,protectedInputs,{...reviewedTeacher,targetLegend:p.deck.legend.name}),audit.acceptedTraining);
            banks[p.id].bank.training.forEach(s=>assertLessonSample(s,'training'));
          }
          const s=banks[p.id].bank.validation[0].steps[0];
          assert.ok(inferStep(model,s.state,s.actions,s.legalCount,s.initialMemory).logits.every(Number.isFinite));
          assert.equal(neuralBehaviorHash(model),p.initial.behaviorHash);
          assert.ok(banks[p.id].bank.training.every(s=>!protectedInputs.has(inputKey(s))));
        }finally{dispose(model);}
      }
      if(mode==='preflight'){
        const saved=exists(path.join(root,'state.json'))?json(path.join(root,'state.json')):null;
        if(saved?.evaluationLaneHash&&repair?.evaluationLane&&saved.evaluationLaneHash!==digest(repair.evaluationLane)){
          checkLaneTransition(json(verifyArtifact(repair.evaluationLaneTransition.previousLane)),repair.evaluationLane,saved);
        }
        status('passed',{profiles:7,nativeBackend:process.env.RIFTBOUND_TF_BACKEND,runtimeFiles:json(c.runtimeManifest.path).length,
          trainingFingerprint,conversationCurriculum:repair?.conversationCurriculum||null,
          reviewedLessonCounts:Object.fromEntries(Object.entries(banks).map(([id,b])=>[id,b.bank.training.filter(s=>s.contract==='reviewed-matchup-policy-curriculum-v1').length]))});return;
      }
      const stateFile=path.join(root,'state.json');
      const state=exists(stateFile)?json(stateFile):{contract:DECK_LEAGUE,configHash,cursor:0,tasks:0,evaluationQueue:[],profiles:Object.fromEntries(c.profiles.map(p=>[p.id,{
        iteration:0,learner:p.initial,champion:p.initial,history:[p.initial],games:0,acceptedEpochs:0,changedIterations:0}]))};
      assert.equal(state.configHash,configHash);
      const lane=repair?.evaluationLane||null;
      const freezeNext=(profile,iteration,candidate,incumbent,opponents)=>{
        if(!lane)return freezeEvaluation(c,profile,iteration,candidate,incumbent,opponents,repair?.futureEvaluationProtocol);
        const evalConfig=json(verifyArtifact(lane.config));
        const pending=freezeEvaluation(evalConfig,profile,iteration,candidate,incumbent,opponents,lane.inputProtocol);
        pending.directory=path.join(lane.directory,'profiles',profile.id,String(iteration).padStart(6,'0'));
        pending.evaluationRuntime=lane.runtime;
        pending.evaluationRequest=registerLeagueEvaluation(c,pending,lane);
        return pending;
      };
      if(lane&&state.evaluationLaneHash!==digest(lane)){
        if(state.evaluationLaneHash){
          const previous=json(verifyArtifact(repair.evaluationLaneTransition.previousLane)),before=digest(state.evaluationQueue);
          checkLaneTransition(previous,lane,state);
          for(const pending of state.evaluationQueue){const request=json(verifyArtifact(pending.evaluationRequest));
            assertApprovedEvaluationBinding(previous,request);}
          state.evaluationLaneHash=digest(lane);assert.equal(digest(state.evaluationQueue),before);
          immutable(path.join(executionDirectory,'preserved-evaluation-queue-transition.json'),{previousHash:digest(previous),nextHash:digest(lane),queueHash:before,requests:state.evaluationQueue.map(p=>p.evaluationRequest)});
        }else{
        immutable(path.join(executionDirectory,'retired-evaluation-queue.json'),{
          reason:'Previous evaluation engine differed from the training engine; retain old evidence and restart on fresh committed seeds',queue:state.evaluationQueue});
        state.evaluationQueue=state.evaluationQueue.map(p=>freezeNext(c.profiles.find(x=>x.id===p.profileId),p.iteration,p.candidate,p.incumbent,p.opponents));
        state.evaluationLaneHash=digest(lane);
        }
      }
      const save=()=>atomic(stateFile,state);
      const reference=(p,r)=>({...r,profileId:p.id,deckId:p.deck.id,deckHash:p.deckHash});
      const opponentsFor=(iteration)=>c.profiles.map(p=>{
        const s=state.profiles[p.id],history=s.history;
        // Three visits use the incumbent, one replays an archived champion.
        const selected=iteration%4===0?history[Math.floor(iteration/4)%history.length]:s.champion;
        return reference(p,selected);
      });
      const publish=async()=>{
        const profiles=[];
        for(const p of c.profiles){
          const s=state.profiles[p.id],checkpoint=unwrap(await read(verifyArtifact(s.champion)));
          const modelId=`${p.id}-${s.champion.sha256.slice(0,20)}`;
          const file=path.join(root,'serving',modelId+'.json');
          if(!exists(file))atomic(file,checkpoint);
          const descriptor={id:p.id,label:p.label,deckId:p.deck.id,deckRecord:p.deckRecord,deckHash:p.deckHash,
            modelId,checkpointPath:file,checkpointSha256:sha(file),generation:checkpoint.generation,
            trainingIteration:s.iteration,engineFingerprint:s.lastPromotion?.evaluationEngineFingerprint||c.engineFingerprint,sourceEngineFingerprint:c.sourceEngineFingerprint,
            promotion:s.lastPromotion||null,origin:s.lastPromotion?'deck-league-promotion':'validated-migration-baseline',learner:s.learner,champion:s.champion};
          // Retain the descriptor of retired champions for already bound games.
          const catalogFile=path.join(root,'serving',modelId+'.descriptor.json');
          if(!exists(catalogFile))atomic(catalogFile,descriptor);
          profiles.push(descriptor);
        }
        atomic(path.join(root,'registry.json'),{contract:DECK_LEAGUE,configHash,updatedAt:new Date().toISOString(),profiles});
      };
      save();await publish();
      const waitCapacity=async()=>{
        for(;;){
          if(exists(path.join(root,'stop.request.json')))return false;
          const capacity=await queryTrainingCapacity(listNodeProcesses,p=>selectTrainingProcesses(p,c.projectDirectory));
          if(!capacity.known){status('waiting-process-query',{attempts:capacity.attempts,errors:capacity.errors});await new Promise(r=>setTimeout(r,2000));continue;}
          const active=capacity.active;
          const oldOwners=await Promise.all(c.legacyRuns.map(r=>readLiveFileLockOwner(path.join(r,'controller.lock'))));
          const normal=active.every(p=>{try{return os.getPriority(p.pid)===os.constants.priority.PRIORITY_NORMAL;}catch{return true;}});
          if(!oldOwners.some(Boolean)&&normal&&active.length+c.workerProcesses<=c.maximumProcesses)return true;
          status('waiting-capacity',{processes:active.length,maximum:c.maximumProcesses,legacyOwners:oldOwners.filter(Boolean).map(p=>p.pid),normal});
          await new Promise(resolve=>setTimeout(resolve,10000));
        }
      };
      const train=async(profile)=>{
        const entry=state.profiles[profile.id],iteration=entry.iteration+1;
        const dir=path.join(root,'profiles',profile.id,'iterations',String(iteration).padStart(6,'0'));
        fs.mkdirSync(dir,{recursive:true});
        assert.ok(fs.statfsSync(root).bavail*fs.statfsSync(root).bsize>4*1024**3,'Disk space below 4 GiB.');
        const payload=await read(verifyArtifact(entry.learner)),source=deserialize(unwrap(payload));
        let candidate,trained,optimizer,policyChampion,iterationResourceBank=null;const league=[];
        try{
          const planFile=path.join(dir,'plan.json'),plan=exists(planFile)?json(planFile):trainingPlan(c,profile,iteration,entry.learner,opponentsFor(iteration));
          if(!exists(planFile))plan.trainingRuntime=trainingRuntime;
          if(!exists(planFile))plan.trainingLessons=repair?.lessonAdditions?.[profile.id]?.augmented||profile.lessons;
          if(!exists(planFile)&&repair?.resourceCollection)plan.resourceCollection=repair.resourceCollection;
          if(plan.trainingRuntime)assertLeagueRuntimeResume(plan,trainingRuntime,repair?.engineTransition);
          if(plan.trainingLessons)assert.deepEqual(plan.trainingLessons,repair?.lessonAdditions?.[profile.id]?.augmented||profile.lessons);
          assert.equal(plan.role,'training');
          assert.equal(plan.configHash,configHash);assert.equal(plan.sourceSha256,entry.learner.sha256);assert.equal(plan.profileId,profile.id);
          immutable(planFile,plan);
          reserveSeeds(root,`training:${profile.id}:${iteration}`,Array.from({length:plan.games},(_,g)=>(plan.seed+g*130363)>>>0),c.protectedSeeds);
          for(let g=0;g<plan.games;g++)assert.equal(expectedDeckSearchPair(plan.deckSearch,g,plan.seed)[g%2].id,profile.deck.id);
          for(const item of plan.opponents)league.push(deserialize(unwrap(await read(verifyArtifact(item)))));
          const candidateFile=path.join(dir,'candidate.json.gz');let final=await optional(candidateFile);
          if(!final){
            status('collecting',{profileId:profile.id,iteration,completed:0,total:plan.games});
            await collectAdaptiveSelfPlay({directory:dir,plan,model:source,league,decks:c.profiles.map(p=>p.deck),
              workers:1,processes:c.workerProcesses,initialProcesses:c.workerProcesses,maximumProcesses:c.workerProcesses,
              dynamicScaling:false,memoryAwareInitialProcesses:true,minimumFreeMemoryBytes:4*1024**3,releaseIdleOnStop:true,awaitWorkerExit:true,
              maxActions:2400,maximumTaskDurationMs:0,bestOfThreeFraction:0,teacherFraction:0,teacherBudget:0,teacherCriticalBudget:0,teacherUrgentBudget:0,
              teacherEvaluatorMode:'heuristic-only',captureIndependentLeafAudit:false,captureProductionLeafAudit:false,engineFingerprint:trainingFingerprint,
              resolveTaskOptions:({task})=>({optionOverrides:{...deckSearchTaskOptions(plan.deckSearch,task.gameIndex),
                ...(plan.resourceCollection?{trainingResourceCollection:{contract:'on-policy-resource-collection-v1',role:'training',
                  maximumReviews:plan.resourceCollection.maximumReviewsPerGame,gameId:`${profile.id}:${iteration}:${task.gameIndex}`,
                  learnerSeat:task.gameIndex%2,deckId:profile.deck.id,engineFingerprint:trainingFingerprint}}:{})}}),
              onGameComplete:async({gameIndex})=>status('collecting',{profileId:profile.id,iteration,lastGame:gameIndex,
                completed:fs.readdirSync(path.join(dir,'games')).filter(n=>n.endsWith('.json.gz')).length,total:plan.games}),
              onRejectedGame:async failure=>status('collection-rejected',{profileId:profile.id,iteration,failure})});
            const trajectories=[],resourceRecords=[];
            for(let g=0;g<plan.games;g++){const file=path.join(dir,'games',g+'.json.gz'),result=await read(file);assertAdaptiveGame(result,plan,g);
              const fingerprint=assertLeagueGameEngine(result,file,plan,trainingFingerprint,repair?.engineTransition);
              assertTrainingTrajectories(result.trajectories,fingerprint);
              resourceRecords.push({path:file,sha256:sha(file),result});
              assert.equal(result.trajectories[0].deckId,profile.deck.id);trajectories.push(...result.trajectories);}
            const {eligible,excluded,used,overlaps}=partitionTrainingTrajectories(trajectories,protectedInputs,ACTION_DIM);
            const epochFile=path.join(dir,'epoch.json.gz'),resume=await optional(epochFile);
            if(!eligible.length){
              // This is a completed collection with no admissible update, not
              // a reason to kill the fleet or silently replay a different seed.
              assert.ok(!resume,'A resumed epoch lost its admissible inputs.');
              await write(path.join(dir,'trained-input-keys.json.gz'),{planHash:digest(plan),keys:[],excluded,overlaps,collected:plan.games,eligible:0});
              final=skippedTrainingCheckpoint(payload,plan,entry.learner.behaviorHash,excluded);
              assertAdaptiveCheckpoint(final.checkpoint);await write(candidateFile,final);
            }else{
            if(retainResourceBank&&plan.resourceCollection)iterationResourceBank=await retainResourceBank({directory:repair?.trainingResourceDirectory||root,profileId:profile.id,iteration,
              base:banks[profile.id],records:resourceRecords,source:entry.learner,planHash:digest(plan),deckId:profile.deck.id,
              engineFingerprint:trainingFingerprint,protectedKeys:protectedInputs,maximumActive:plan.resourceCollection.maximumActiveLessons,
              rotateWorkingSet:repair?.resourceWorkingSet?.contract==='training-only-preserved-archive-rotation-v1'});
            const trainingBank=iterationResourceBank?.payload||banks[profile.id];
            for(const sample of trainingBank.bank.training)used.add(inputKey(sample));
            assert.ok([...used].every(k=>!protectedInputs.has(k)),'Protected input entered PPO or rehearsal.');
            await write(path.join(dir,'trained-input-keys.json.gz'),{planHash:digest(plan),keys:[...used].sort(),excluded,overlaps,collected:plan.games,eligible:eligible.length});
            for(const key of used)trainedInputs.add(key);await saveProtection();
            if(resume)assert.equal(resume.planHash,digest(plan));
            candidate=deserialize(unwrap(resume||payload));
            const random=seededRandom(plan.epochSeed);if(resume?.randomState!=null)random.setState(resume.randomState);
            optimizer=(resume?.optimizerState||payload.optimizerState)?await restoreAdamOptimizer(resume?.optimizerState||payload.optimizerState,.0001):undefined;
            const baseline=deserialize(unwrap(await read(verifyArtifact(profile.initial))));
            const bank=trainingBank,original=originalBanks[profile.id],augmented=bank!==original;
            const permanentTraining=iterationResourceBank?.permanentTraining||bank.bank.training;
            const workingTraining=iterationResourceBank?.workingTraining||bank.bank.training;
            const workingBank={...bank,bank:{...bank.bank,training:workingTraining}};
            const reviewedExamples=bank.bank.training.filter(s=>s.contract==='reviewed-matchup-policy-curriculum-v1');
            const reviewedCurriculum=reviewedExamples.length?{manifest:repair.conversationCurriculum,
              examples:reviewedExamples.map(s=>({inputKey:inputKey(s),sourceDeckId:s.deckId,positionKey:s.lessonSource.positionKey})),
              lessonBank:plan.trainingLessons,policyOnly:true}:null;
            const beforeHeld=measureLessonRetention(baseline,original.bank.validation),beforeTrain=measureLessonRetention(baseline,original.bank.training);
            const beforeAdded=augmented?measureLessonRetention(baseline,bank.bank.training):null;
            const beforeLocalOriginal=augmented?measureLessonRetention(source,original.bank.training):null;
            const beforePermanent=measureLessonRetention(baseline,permanentTraining),beforeLocalPermanent=measureLessonRetention(source,permanentTraining);
            dispose(baseline);
            const additionalGuard=()=>{const validation=lessonSafetyGuard(beforeHeld,measureLessonRetention(candidate,original.bank.validation)),
              originalAfter=measureLessonRetention(candidate,original.bank.training),training=lessonSafetyGuard(beforeTrain,originalAfter);
              if(!augmented)return {passed:validation.passed&&training.passed,validation,training};
              // Additional examples cannot dilute any original type average
              // or hide the loss of a previously correct original choice.
              const added=lessonSafetyGuard(beforeAdded,measureLessonRetention(candidate,bank.bank.training));
              const localOriginal=tacticalLessonGuard(beforeLocalOriginal.types,originalAfter.types);
              const lostOriginalChoices=beforeLocalOriginal.correct.filter((v,i)=>v&&!originalAfter.correct[i]).length;
              const permanentAfter=measureLessonRetention(candidate,permanentTraining),permanent=lessonSafetyGuard(beforePermanent,permanentAfter),
                localPermanent=lessonSafetyGuard(beforeLocalPermanent,permanentAfter);
              return {passed:validation.passed&&training.passed&&added.passed&&localOriginal.passed&&!lostOriginalChoices&&permanent.passed&&localPermanent.passed,
                validation,training,added,localOriginal,lostOriginalChoices,permanent,localPermanent};};
            const {maintenance,joint,recovery,efficient,phase}=protocols;
            const legacyRetention=phasePpoLessonRetention(candidate,source,workingBank,maintenance,joint,recovery,efficient,phase,c.sourceIteration+iteration,{additionalGuard});
            const finite=adaptiveFiniteEpochGuard();
            const batchReports=resume?.batchReports||[];
            const retention=atomicEpoch?atomicEpoch({model:candidate,source,bank:bank.bank,legacy:legacyRetention,additionalGuard,batchReports,
              workingBank:workingBank.bank,reachableRecovery:repair?.atomicEpochCommit?.contract==='reachable-native-adam-epoch-v2'}):legacyRetention;
            let lastAcceptedHash=resume?.lastAcceptedHash||entry.learner.behaviorHash;
            if(transactionalUpdater)policyChampion=deserialize(unwrap(await read(verifyArtifact(entry.champion))));
            const batchUpdate=transactionalUpdater?transactionalUpdater({trajectories:eligible,source,champion:policyChampion,
              trainingGroups:[{id:'original',samples:original.bank.training},{id:'permanent',samples:permanentTraining},{id:'augmented',samples:bank.bank.training}],
              workingGroups:[{id:'original',samples:original.bank.training},{id:'working',samples:workingTraining}],
              protectedKeys:protectedInputs,rehearsalForBatch:retention.policyRehearsalForBatch,
              onBatch:r=>{batchReports.push(r);status('training-batch',{profileId:profile.id,iteration,epoch:r.epoch,batch:r.batch,accepted:r.accepted});}}):null;
            status('training',{profileId:profile.id,iteration,games:eligible.length,excluded:excluded.length,reviewedLessons:reviewedExamples.length});
            trained=await trainRecurrentPpo(candidate,eligible,{epochs:c.epochs,batchSize:16,learningRate:.0001,random,optimizer,
              resumeState:resume?.selectionState,teacherConsumptionPolicy:'record-only-v1',beliefCoefficient:0,
              anchorModels:[{model:source,weight:1}],anchorCoefficient:.05,...finite,
              ...(batchUpdate?{ppoBatchUpdate:batchUpdate}:{}),
              policyRehearsalForBatch:retention.policyRehearsalForBatch,beforeEpochGuard:retention.beforeEpochGuard,
              epochGuard:args=>{const numeric=finite.epochGuard(args),lessons=retention.epochGuard();
                const afterHash=neuralBehaviorHash(candidate),updateEvidence=batchUpdate?epochUpdateEvidence(batchReports,args.epoch,lastAcceptedHash,afterHash):null;
                const passed=numeric.passed&&lessons.passed&&(!updateEvidence||updateEvidence.passed);
                if(passed)lastAcceptedHash=afterHash;
                return {passed,finitePassed:numeric.passed,lessonRetention:lessons,...(updateEvidence?{updateEvidence}: {})};},selectBestEpoch:false,gamesObserved:eligible.length,
              onEpochCheckpoint:item=>write(epochFile,{...item,planHash:digest(plan),checkpoint:serialize(candidate),
                ...(batchUpdate?{batchReports,lastAcceptedHash,policyLearning:repair.policyLearning}:{}),
                ...(iterationResourceBank?{trainingCorrections:iterationResourceBank.reference}: {})}),
              onEpoch:metrics=>status('training',{profileId:profile.id,iteration,metrics})});
            candidate.metadata={...candidate.metadata,engineFingerprint:trainingFingerprint,trainingDeckIds:[profile.deck.id],
              ...(reviewedCurriculum?{reviewedCurriculum}:{}),
              evaluatorCertification:null,deckSpecialist:{contract:DECK_LEAGUE,profileId:profile.id,deckHash:profile.deckHash,
                configHash,iteration,parent:profile.initial.sha256,ownPolicyOnly:true}};
            final={checkpoint:serialize(candidate),optimizerState:await serializeOptimizer(trained.optimizer,candidate.generation),planHash:digest(plan),
              beforeBehaviorHash:entry.learner.behaviorHash,afterBehaviorHash:neuralBehaviorHash(candidate),epochGuards:trained.epochGuards,
              collectedGames:plan.games,trainingGames:eligible.length,excluded,trainingRuntime,
              sourceGameEngineFingerprints:[...new Set(trajectories.map(t=>t.engineFingerprint))],at:new Date().toISOString(),
              ...(reviewedCurriculum?{reviewedCurriculum}:{}),
              ...(batchUpdate?{batchReports,policyLearning:repair.policyLearning}: {}),
              ...(iterationResourceBank?{trainingCorrections:iterationResourceBank.reference,resourceCollection:iterationResourceBank.report}: {})};
            assertAdaptiveCheckpoint(final.checkpoint);await write(candidateFile,final);
            }
          }
          assert.equal(final.planHash,digest(plan));assertAdaptiveCheckpoint(final.checkpoint);
          entry.iteration=iteration;entry.games+=final.collectedGames;
          entry.acceptedEpochs+=final.epochGuards.filter(g=>g.passed).length;
          entry.changedIterations+=Number(final.beforeBehaviorHash!==final.afterBehaviorHash);
          entry.lastTraining={acceptedEpochs:final.epochGuards.filter(g=>g.passed).length,changed:final.beforeBehaviorHash!==final.afterBehaviorHash,
            collectedGames:final.collectedGames,trainingGames:final.trainingGames,excluded:final.excluded.length,skippedReason:final.skippedReason||null,at:final.at};
          entry.learner={path:candidateFile,sha256:sha(candidateFile),behaviorHash:final.afterBehaviorHash,generation:final.checkpoint.generation};
          const admission=evaluationAdmission({iteration,everyIterations:c.evaluation.everyIterations,pending:state.evaluationQueue,
            profileId:profile.id,changed:entry.learner.behaviorHash!==entry.champion.behaviorHash,
            maximumPending:repair?.evaluationAdmission?.maximumPending||7});
          entry.lastEvaluationAdmission={...admission,iteration,pendingRequests:state.evaluationQueue.length};
          if(admission.admit)state.evaluationQueue.push(freezeNext(profile,iteration,entry.learner,entry.champion,c.profiles.map(p=>reference(p,state.profiles[p.id].champion))));
          state.cursor++;state.tasks++;save();await publish();status('iteration-saved',{profileId:profile.id,iteration,...entry.lastTraining});
        }finally{
          (trained?.optimizer||optimizer)?.dispose();if(candidate)dispose(candidate);if(policyChampion)dispose(policyChampion);dispose(source);league.forEach(dispose);globalThis.gc?.();
        }
      };
      while(await waitCapacity()){
        const p=c.profiles.find(p=>p.id===c.rotation[state.cursor%c.rotation.length]);
        await train(p);
        if(state.evaluationQueue.length&&!exists(path.join(root,'stop.request.json'))){
          const ready=lane?state.evaluationQueue.findIndex(p=>['.result.json','.failure.json'].some(suffix=>exists(p.evaluationRequest.path.replace('.request.json',suffix)))):0;
          if(ready<0)continue;
          if(ready>0)state.evaluationQueue.unshift(state.evaluationQueue.splice(ready,1)[0]);
          const pending=state.evaluationQueue[0];
          let result,evaluationFingerprint=c.engineFingerprint;
          if(lane){
            const request=json(verifyArtifact(pending.evaluationRequest));
            assertApprovedEvaluationBinding(lane,request);evaluationFingerprint=request.runtime.engineFingerprint;
            const failureFile=pending.evaluationRequest.path.replace('.request.json','.failure.json');
            if(exists(failureFile)){
              const failure=json(failureFile);assert.equal(failure.requestHash,digest(request));assert.deepEqual(failure.evaluationRuntime,request.runtime);
              result={done:true,result:{promoted:false,eligible:false,executionFailed:true,reason:'evaluation-execution-failure',failure:{path:failureFile,sha256:sha(failureFile)}}};
            }else result={done:true,result:assertLaneResult(request,json(pending.evaluationRequest.path.replace('.request.json','.result.json')))};
          }else result=await evaluationStep({config:c,pending,load:evaluationLoad,protectedInputs,trainedInputs,saveProtection,status});
          if(result.nextPhase)pending.phase=result.nextPhase;
          if(result.done){
            const entry=state.profiles[pending.profileId],ruleScope=evaluationRuleScope(evaluationFingerprint,trainingFingerprint);
            const previousEvaluationFingerprint=entry.lastEvaluation?.evaluationEngineFingerprint||c.engineFingerprint;
            entry.lastEvaluation={...result.result,...ruleScope};
            // A learner can drift within its own deck too. Keep the existing
            // 32-iteration / two clear losses safeguard local to that deck.
            if(ruleScope.currentRuleEvidence&&(result.result.overlapCount===0||result.result.matchEvidenceEligible===true)){
              entry.clearInferiorityStreak=result.result.upper<0?(previousEvaluationFingerprint===evaluationFingerprint?(entry.clearInferiorityStreak||0):0)+1:0;
            }
            if(ruleScope.currentRuleEvidence&&result.result.promoted&&entry.champion.sha256===pending.incumbent.sha256){
              entry.champion=pending.candidate;entry.history.push(pending.candidate);
              entry.lastPromotion={at:new Date().toISOString(),evaluation:pending.directory,candidateSha256:pending.candidate.sha256,
                evaluationEngineFingerprint:evaluationFingerprint};
              entry.anchorIteration=entry.iteration;entry.clearInferiorityStreak=0;
            }else if(ruleScope.currentRuleEvidence&&entry.iteration-(entry.anchorIteration||0)>=32&&(entry.clearInferiorityStreak||0)>=2){
              entry.lastRecovery={at:new Date().toISOString(),iteration:entry.iteration,from:entry.learner,to:entry.champion};
              atomic(path.join(root,'profiles',pending.profileId,'recovery',`${entry.iteration}.json`),entry.lastRecovery);
              entry.learner=entry.champion;entry.anchorIteration=entry.iteration;entry.clearInferiorityStreak=0;
            }
            state.evaluationQueue.shift();
          }else{state.evaluationQueue.push(state.evaluationQueue.shift());}
          save();await publish();
        }
      }
      status('paused-at-boundary',{profiles:Object.fromEntries(Object.entries(state.profiles).map(([k,s])=>[k,s.iteration]))});
    }catch(error){status('failed',{error:error.stack||String(error)});throw error;}
  },{timeoutMs:1000});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runDeckLeague(process.argv[2],process.argv[3]||'run');
