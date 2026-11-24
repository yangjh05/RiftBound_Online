import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readTrajectoryArchive as read,writeTrajectoryArchive as write} from '../src/ai/neural/archive.mjs';
import {deserializeNeuralModel,serializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {neuralBehaviorHash} from '../src/ai/neural/evaluator-certification.mjs';
import {trainRecurrentPpo,restoreAdamOptimizer} from '../src/ai/neural/trainer.mjs';
import {seededRandom} from '../src/ai/neural/selfplay.mjs';
import {withFileLock,readLiveFileLockOwner} from './file-lock.mjs';
import {renameWithRetry,renameWithRetrySync} from './file-replace.mjs';
import {digest} from './adaptive-policy-q-contract.mjs';
import {collectAdaptiveSelfPlay} from './adaptive-selfplay-collection.mjs';
import {assertAdaptiveGame,assertAdaptiveCheckpoint,adaptiveFiniteEpochGuard} from './adaptive-policy-q-evidence.mjs';
import {deckSearchTaskOptions} from './adaptive-deck-search.mjs';
import {computeEngineFingerprint,assertTrainingTrajectories} from './training-safety.mjs';
import {phasePpoLessonRetention} from './phase-policy-learning.mjs';
import {maintenanceEvaluationRuntime} from './lesson-maintenance.mjs';
import {ARMS,STARTING_POINT_EXPERIMENT,experimentArms,experimentInitial,validateLeagueExperiment,leagueExperimentPlan,leagueEvaluationJobs,runLeagueEvaluationJob,leagueWorkerReservation,summarizeLeagueExperiment} from './league-policy-experiment.mjs';
import {prepareStartingPointLessons,evaluateStartingPointLearning} from './starting-point-learning.mjs';
import {readSideTrainingReservation} from './side-training-reservation.mjs';
import {createTrainingStatusJournal} from './training-status-journal.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const optional=async f=>read(f).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const unwrap=p=>p.candidateCheckpoint||p.checkpoint||p;
async function verifiedArtifact(item){const b=await fs.readFile(item.path);assert.equal(sha(b),item.sha256,item.path);return read(item.path);}
async function atomicJson(file,value){const tmp=`${file}.tmp-${process.pid}`;await fs.writeFile(tmp,JSON.stringify(value,null,2));await renameWithRetry(tmp,file);}

export async function trainLeaguePolicyExperiment(config){
  validateLeagueExperiment(config);
  const root=path.resolve(config.directory),main=path.resolve(config.mainRunDirectory);
  assert.notEqual(root,main);assert.equal(computeEngineFingerprint(),config.engineFingerprint);
  await fs.mkdir(root,{recursive:true});
  return withFileLock(path.join(root,'controller.lock'),async()=>{
    let state=await optional(path.join(root,'state.json.gz'))||{configHash:digest(config),arms:{}};
    assert.equal(state.configHash,digest(config));
    const expectedReservation=leagueWorkerReservation(config,state);let reservationHash=digest(expectedReservation);
    const reservedSlots=expectedReservation.slots-config.previousReservation.slots;
    const reservation=readSideTrainingReservation(main);
    assert.equal(digest(reservation),reservationHash,'Experiment capacity is not reserved.');
    const acquired=JSON.parse(await fs.readFile(path.join(root,'capacity-ready.json'),'utf8'));
    assert.equal(acquired.reservationHash,reservationHash);assert.ok(acquired.otherTrainingProcesses<=16-reservedSlots);
    assert.ok(acquired.mainProcesses<=16-expectedReservation.slots,'The main pools have not released the reserved slots.');
    const status=createTrainingStatusJournal(root,{contract:config.contract,configHash:digest(config),
      promotionEligible:false,mainTrainingWeightsUpdated:false});
    const persist=()=>write(path.join(root,'state.json.gz'),state);
    const startingPoints=config.contract===STARTING_POINT_EXPERIMENT;
    const initials={};for(const arm of experimentArms(config))initials[arm]=await verifiedArtifact(experimentInitial(config,arm));
    const initial=initials[experimentArms(config)[0]];let lessonBank=await verifiedArtifact(config.lessons);
    const protocols=await verifiedArtifact(config.protocols);
    const opponents=[];
    try{
      for(const item of config.opponents)opponents.push(deserializeNeuralModel(unwrap(await verifiedArtifact(item))));
      // Verify the exact evaluation executable already used by main training.
      await maintenanceEvaluationRuntime(protocols.maintenance);
      if(startingPoints)lessonBank=await prepareStartingPointLessons(config,lessonBank,opponents[0],status);
      for(let iteration=1;iteration<=config.iterations;iteration++)for(const arm of experimentArms(config)){
        if((state.arms[arm]?.iteration||0)>=iteration)continue;
        if(await fs.stat(path.join(root,'stop.request.json')).catch(()=>null)){await status('paused',state);return;}
        assert.equal(digest(readSideTrainingReservation(main)),reservationHash);
        const disk=await fs.statfs(root);assert.ok(disk.bavail*disk.bsize>=2*1024**3,'Insufficient free disk space.');
        const dir=path.join(root,arm,'iterations',String(iteration).padStart(6,'0'));
        await fs.mkdir(dir,{recursive:true});
        const initialPath=experimentInitial(config,arm).path;
        const sourcePath=state.arms[arm]?.learnerPath||initialPath;
        const payload=sourcePath===initialPath?initials[arm]:await read(sourcePath);
        const source=deserializeNeuralModel(unwrap(payload));let candidate,trained;
        try{
          const expected=leagueExperimentPlan(config,arm,iteration,sourcePath,neuralBehaviorHash(source),opponents.map(neuralBehaviorHash));
          const planFile=path.join(dir,'plan.json.gz'),saved=await optional(planFile);
          if(saved)assert.equal(digest(saved),digest(expected));else await write(planFile,expected);
          const plan=saved||expected,finalFile=path.join(dir,'candidate.json.gz');
          let final=await optional(finalFile);
          if(!final){
            await status('collection',{arm,iteration,target:plan.games});let last=0;
            await collectAdaptiveSelfPlay({directory:dir,plan,model:source,league:[source,...opponents],decks:config.decks,
              workers:1,processes:2,initialProcesses:1,maximumProcesses:2,memoryAwareInitialProcesses:true,
              dynamicScaling:true,minimumFreeMemoryBytes:4*1024**3,releaseIdleOnStop:true,awaitWorkerExit:true,
              maxActions:2400,maximumTaskDurationMs:0,bestOfThreeFraction:0,mirrorFraction:.5,
              teacherFraction:0,teacherCriticalBudget:0,teacherUrgentBudget:0,teacherEvaluatorMode:'heuristic-only',
              captureIndependentLeafAudit:false,captureProductionLeafAudit:false,
              engineFingerprint:config.engineFingerprint,
              resolveTaskOptions:({task})=>({optionOverrides:{...deckSearchTaskOptions(plan.deckSearch,task.gameIndex),
                learnFirstPlayerChoice:[0,7].includes(task.gameIndex%8)}}),
              onWorkerHeartbeat:async pool=>{if(Date.now()-last>15000){last=Date.now();await status('collection',{arm,iteration,workerPool:pool});}},
              onGameComplete:async({gameIndex})=>status('game-saved',{arm,iteration,gameIndex}),
              onRejectedGame:async failure=>status('game-rejected',{arm,iteration,...failure})});
            const trajectories=[];
            for(let g=0;g<plan.games;g++){
              const result=await read(path.join(dir,'games',`${g}.json.gz`));assertAdaptiveGame(result,plan,g);
              trajectories.push(...result.trajectories);
            }
            assert.equal(trajectories.length,plan.games);assertTrainingTrajectories(trajectories,config.engineFingerprint);
            const epochFile=path.join(dir,'epoch.json.gz'),resume=await optional(epochFile);
            if(resume)assert.equal(resume.planHash,digest(plan));
            candidate=deserializeNeuralModel(unwrap(resume||payload));
            const random=seededRandom(plan.epochSeed);if(resume?.randomState!=null)random.setState(resume.randomState);
            const optimizer=resume?await restoreAdamOptimizer(resume.optimizerState,.0001):undefined;
            const {maintenance,joint,recovery,efficient,phase}=protocols;
            const retention=phasePpoLessonRetention(candidate,source,lessonBank,maintenance,joint,recovery,efficient,phase,
              config.sourceIteration+iteration);
            assert.ok(retention,'Verified correction retention is required.');
            const finite=adaptiveFiniteEpochGuard();
            await status('policy-training',{arm,iteration,games:plan.games,trajectories:trajectories.length});
            trained=await trainRecurrentPpo(candidate,trajectories,{epochs:config.epochs,batchSize:16,learningRate:.0001,
              random,optimizer,resumeState:resume?.selectionState,teacherConsumptionPolicy:'record-only-v1',
              beliefCoefficient:config.beliefCoefficient,anchorModels:[{model:source,weight:1}],anchorCoefficient:.05,
              ...finite,policyRehearsalForBatch:retention.policyRehearsalForBatch,beforeEpochGuard:retention.beforeEpochGuard,
              epochGuard:args=>{const numeric=finite.epochGuard(args),lessons=retention.epochGuard();
                return {passed:numeric.passed&&lessons.passed,finitePassed:numeric.passed,lessonRetention:lessons};},
              selectBestEpoch:false,gamesObserved:plan.games,
              onEpochCheckpoint:item=>write(epochFile,{...item,planHash:digest(plan),checkpoint:serializeNeuralModel(candidate)}),
              onEpoch:metrics=>status('policy-training',{arm,iteration,...metrics})});
            assert.ok(trained.epochGuards.length);assert.ok(trained.epochGuards.every(g=>g.finitePassed!==false));
            candidate.metadata={...candidate.metadata,experimentalLearner:true,promotionEligible:false,evaluatorCertification:null,
              leagueExperiment:{configHash:digest(config),arm,iteration,trainingGames:iteration*plan.games,
                learnerOnly:true,correctLessonsPreserved:true,mainTrainingWeightsUpdated:false}};
            final={checkpoint:serializeNeuralModel(candidate),planHash:digest(plan),promotionEligible:false,
              beforeBehaviorHash:plan.sourceBehaviorHash,afterBehaviorHash:neuralBehaviorHash(candidate),epochGuards:trained.epochGuards};
            assertAdaptiveCheckpoint(final.checkpoint);await write(finalFile,final);
          }
          assert.equal(final.planHash,digest(plan));assertAdaptiveCheckpoint(final.checkpoint);
          state.arms[arm]={iteration,learnerPath:finalFile,behaviorHash:final.afterBehaviorHash};await persist();
          await status('candidate-saved',{arm,...state.arms[arm],changed:final.beforeBehaviorHash!==final.afterBehaviorHash});
        }finally{trained?.optimizer.dispose();if(candidate)disposeNeuralModel(candidate);disposeNeuralModel(source);}
        globalThis.gc?.();
      }
      // Freeze one endpoint, then evaluate every committed job once. Results
      // never feed gradients, change the opponent mix, or trigger auto-promotion.
      const evalRuntime=protocols.maintenance.evaluationRuntime;
      if(startingPoints){
        const evaluationReservation=leagueWorkerReservation(config,state);
        assert.equal(digest(readSideTrainingReservation(main)),reservationHash);
        await atomicJson(path.join(main,'side-training-reservation.json'),evaluationReservation);
        reservationHash=digest(evaluationReservation);
        const result=await evaluateStartingPointLearning({config,state,opponents,protocols,status});
        await atomicJson(path.join(root,'result.json'),result);state.completed=true;state.resultStatus=result.status;await persist();
        await status(result.status,{selected:result.selected,confirmation:result.confirmation});return result;
      }
      const {evaluateNeuralModels}=await import(pathToFileURL(path.join(evalRuntime,'src/ai/neural/selfplay.mjs')));
      const {evaluationReviewOptions}=await import(pathToFileURL(path.join(evalRuntime,'scripts/evaluation-decision-review.mjs')));
      const evaluationOptions=evaluationReviewOptions(config.evaluationReview),results={};
      for(const arm of ['baseline',...ARMS]){
        const candidate=deserializeNeuralModel(unwrap(arm==='baseline'?initial:await read(state.arms[arm].learnerPath)));
        try{
          const binding={configHash:digest(config),arm,candidateHash:neuralBehaviorHash(candidate),
            opponentHash:neuralBehaviorHash(opponents[0]),role:'evaluation',jobs:leagueEvaluationJobs(config)};
          const evalDir=path.join(root,'evaluation',arm);await fs.mkdir(evalDir,{recursive:true});
          const manifest=path.join(evalDir,'plan.json.gz'),saved=await optional(manifest);
          if(saved)assert.equal(digest(saved),digest(binding));else await write(manifest,binding);
          const summaries=[];
          for(const job of binding.jobs){
            const file=path.join(evalDir,`${job.index}.json.gz`),prior=await optional(file);
            if(prior)assert.equal(prior.planHash,digest(binding));
            const partial=path.join(evalDir,`${job.index}.partial.json`);
            const progress=await fs.readFile(partial,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
            if(progress)assert.equal(progress.planHash,digest(binding));
            const rows=prior?.summaries||progress?.summaries||[];
            await status('held-out-evaluation',{arm,job:job.index,jobs:binding.jobs.length,savedGames:rows.length});
            const outcome=runLeagueEvaluationJob(evaluateNeuralModels,candidate,opponents[0],job,{
              greedy:true,maxActions:2400,engineFingerprint:config.engineFingerprint,
              resumedSummaries:rows,...evaluationOptions,
              onGameComplete:({game,summary})=>{rows[game-1]=summary;
                const tmp=`${partial}.tmp-${process.pid}`;
                writeFileSync(tmp,JSON.stringify({planHash:digest(binding),summaries:rows}));renameWithRetrySync(tmp,partial);}});
            assert.ok(outcome.summaries.every(s=>s.completed&&!s.invalid&&!s.adjudicated&&s.counted!==false));
            await write(file,{planHash:digest(binding),summaries:outcome.summaries});summaries.push(...outcome.summaries);
          }
          results[arm]=summaries;
        }finally{disposeNeuralModel(candidate);}
      }
      const result=summarizeLeagueExperiment(config,results);await atomicJson(path.join(root,'result.json'),result);
      state.completed=true;await persist();await status(result.status,{result:result.comparison});
    }catch(error){await status('failed',{error:error.message});throw error;}
    finally{
      opponents.forEach(disposeNeuralModel);
      // A different owner/configuration is never released by this experiment.
      // Collection waits for child exit before returning or throwing.
      if(digest(readSideTrainingReservation(main))===reservationHash){
        const previous=structuredClone(config.previousReservation);
        if(startingPoints&&previous.additionalReservations){
          const keep=[];
          for(const item of previous.additionalReservations){
            const finished=item.contract==='isolated-paired-league-policy-v1'
              &&!await readLiveFileLockOwner(path.join(item.directory,'controller.lock'))
              &&(await optional(path.join(item.directory,'state.json.gz')))?.completed===true;
            if(finished)previous.slots-=item.slots;else keep.push(item);
          }
          if(keep.length)previous.additionalReservations=keep;else delete previous.additionalReservations;
        }
        await atomicJson(path.join(main,'side-training-reservation.json'),previous);
      }
    }
  },{timeoutMs:1000});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await trainLeaguePolicyExperiment(JSON.parse(await fs.readFile(process.argv[2],'utf8')));
}
