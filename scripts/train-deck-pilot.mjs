import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readTrajectoryArchive,writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {deserializeNeuralModel,serializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {neuralBehaviorHash} from '../src/ai/neural/evaluator-certification.mjs';
import {trainRecurrentPpo,restoreAdamOptimizer} from '../src/ai/neural/trainer.mjs';
import {seededRandom,evaluateNeuralModels} from '../src/ai/neural/selfplay.mjs';
import {assertLegalTrainingDeck,trainingDeckKey} from '../src/ai/legal-decks.mjs';
import {collectAdaptiveSelfPlay} from './adaptive-selfplay-collection.mjs';
import {assertAdaptiveGame,assertAdaptiveCheckpoint,adaptiveFiniteEpochGuard} from './adaptive-policy-q-evidence.mjs';
import {deckSearchTaskOptions} from './adaptive-deck-search.mjs';
import {digest} from './adaptive-policy-q-contract.mjs';
import {computeEngineFingerprint,assertTrainingTrajectories} from './training-safety.mjs';
import {readLiveFileLockOwner,withFileLock} from './file-lock.mjs';
import {readSideTrainingReservation} from './side-training-reservation.mjs';
import {makeEvaluationReview,evaluationReviewOptions} from './evaluation-decision-review.mjs';
import {renameWithRetrySync} from './file-replace.mjs';
import {validatePilotContinuation,pilotEvaluationSpec} from './deck-pilot-continuation.mjs';
import {withTrainingStorageMaintenance} from './training-storage-maintenance.mjs';

const CONTRACT='isolated-fixed-deck-pilot-v1';
const unwrap=p=>p.candidateCheckpoint||p.checkpoint||p;
const modelFrom=p=>{const c=unwrap(p);assertAdaptiveCheckpoint(c);return deserializeNeuralModel(c);};
const optional=async file=>{try{return await readTrajectoryArchive(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');

export function pilotPlan(config,iteration,sourcePath,sourceBehaviorHash,continuation=null) {
  assert.equal(config.contract,CONTRACT);
  assert.equal(config.iterations,4);assert.equal(config.gamesPerIteration,32);
  if(continuation)validatePilotContinuation(config,continuation);
  assert.ok(Number.isSafeInteger(iteration)&&iteration>=1&&(continuation||iteration<=config.iterations));
  assertLegalTrainingDeck(config.deck);
  return {contract:CONTRACT,configHash:digest(config),iteration,sourcePath,sourceBehaviorHash,
    ...(iteration>config.iterations?{continuationHash:digest(continuation)}:{}),
    games:32,seed:(config.seed+iteration*130363)>>>0,epochSeed:(config.seed+iteration*104729)>>>0,
    gameRandomnessContract:'seeded-engine-game-v1',
    deckSearch:{contract:'legal-seeded-deck-search-v1',poolId:'origins-era',sourceBehaviorHash,
      population:[config.deck],assignments:Array.from({length:32},(_,gameIndex)=>({gameIndex,
        pairIds:[config.deck.id,config.deck.id],mode:'fixed-pilot',testedDeckId:config.deck.id}))}};
}

export function pilotEvaluationSchedule(config,{full=true}={}) {
  // Each cross block uses the existing odd-seed two-deck matrix: A/B then
  // B/A, both model seats and first players. No mirror dilution in cross tests.
  const jobs=Array.from({length:8},(_,i)=>({id:`mirror-${i}`,decks:[config.deck],
    seed:((config.evaluationSeed+i*209458)|1)>>>0,mode:'same-deck-mirror-v3',kind:'mirror',baseline:false}));
  for(const [index,deck] of (full?config.opponentDecks:[]).entries())for(let block=0;block<4;block++){
    const common={decks:[config.deck,deck].sort((a,b)=>a.id.localeCompare(b.id)),
      seed:((config.evaluationSeed+10000019+index*1000033+block*209458)|1)>>>0,
      mode:'cross-deck-matrix-v1',kind:'cross',opponentId:deck.id};
    for(const baseline of [true,false])jobs.push({...common,id:`cross-${index}-${block}-${baseline?'before':'after'}`,baseline});
  }
  return jobs;
}

async function evaluatePilotCheckpoint(config,state,baseline,continuation,status) {
  const spec=pilotEvaluationSpec(config,state.iteration,continuation);
  if(!spec)return true;
  const root=path.resolve(config.directory),evaluationDirectory=path.join(root,spec.directory);
  const resultFile=path.join(spec.initial?root:evaluationDirectory,'result.json.gz');
  const saved=await optional(resultFile);
  if(saved){
    assert.equal(saved.configHash,digest(config));
    assert.equal(saved.candidatePath,state.learnerPath);
    assert.equal(saved.trainingGames,state.iteration*32);
    if(!spec.initial)assert.equal(saved.continuationHash,digest(continuation));
    assert.equal(saved.summaries.length,(spec.full?8+config.opponentDecks.length*8:8)*8);
    assert.ok(saved.summaries.every(s=>s.completed&&!s.invalid&&!s.adjudicated&&s.counted!==false));
    return true;
  }
  const candidate=modelFrom(await readTrajectoryArchive(state.learnerPath));
  try{
    const review=makeEvaluationReview(),evaluationOptions=evaluationReviewOptions(review);
    const schedule=pilotEvaluationSchedule({...config,evaluationSeed:spec.evaluationSeed},{full:spec.full}),summaries=[];
    await fs.mkdir(evaluationDirectory,{recursive:true});
    const commitment={configHash:digest(config),candidateHash:neuralBehaviorHash(candidate),
      baselineHash:neuralBehaviorHash(baseline),review,schedule,
      ...(!spec.initial?{iteration:state.iteration,continuationHash:digest(continuation)}:{})};
    const frozen=await optional(path.join(evaluationDirectory,'plan.json.gz'));
    if(frozen)assert.equal(digest(frozen),digest(commitment));
    else await writeTrajectoryArchive(path.join(evaluationDirectory,'plan.json.gz'),commitment);
    for(const job of schedule){
      if(existsSync(path.join(root,'stop.request.json'))){status('paused',state);return false;}
      const files=Array.from({length:8},(_,i)=>path.join(evaluationDirectory,`${job.id}-${i}.json`));
      const resumed=files.map(file=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null);
      const progress={iteration:state.iteration,evaluationDirectory:spec.directory,
        job:job.id,totalGames:schedule.length*8};
      status('evaluation',{...progress,completedGames:summaries.length});
      const result=evaluateNeuralModels(job.baseline?baseline:candidate,baseline,job.decks,{
        games:8,seed:job.seed,evaluationMode:job.mode,greedy:true,maxActions:2400,
        ...evaluationOptions,resumedSummaries:resumed,
        onGameComplete:({game,summary})=>{
          assert.ok(summary.completed&&!summary.invalid&&!summary.adjudicated,'Invalid evaluation game; pilot not accepted.');
          if(!resumed[game-1])writeFileSync(files[game-1],JSON.stringify(summary));
          status('evaluation',{...progress,completedGames:summaries.length+game});
        }});
      summaries.push(...result.summaries.map(summary=>({...summary,pilotKind:job.kind,
        beforeTraining:job.baseline,opponentId:job.opponentId||null})));
    }
    await writeTrajectoryArchive(resultFile,{
      contract:CONTRACT,configHash:digest(config),candidatePath:state.learnerPath,
      ...(!spec.initial?{continuationHash:digest(continuation)}:{}),
      trainingGames:state.iteration*32,promotionEligible:false,mainTrainingWeightsUpdated:false,
      status:spec.initial?'diagnostic-complete-awaiting-review':'periodic-evaluation-complete',summaries});
    status(continuation?'periodic-evaluation-complete':'diagnostic-complete-awaiting-review',
      {...state,trainingGames:state.iteration*32,evaluationGames:summaries.length});
    return true;
  }finally{disposeNeuralModel(candidate);}
}

export async function runDeckPilot(config) {
  const root=path.resolve(config.directory),main=path.resolve(config.mainRunDirectory);
  assert.notEqual(root,main);assert.equal(config.contract,CONTRACT);
  assert.equal(config.workerProcesses,2);assert.equal(config.reservedSlots,3);
  assert.equal(computeEngineFingerprint(),config.engineFingerprint);
  assert.equal(bytesHash(await fs.readFile(config.initialPath)),config.initialSha256);
  assertLegalTrainingDeck(config.deck);
  for(const deck of config.opponentDecks)assertLegalTrainingDeck(deck);
  await fs.mkdir(root,{recursive:true});
  return withTrainingStorageMaintenance(root,()=>withFileLock(path.join(root,'controller.lock'),async()=>{
    const reservation=readSideTrainingReservation(main);
    assert.equal(reservation?.directory,root);assert.equal(reservation?.slots,3);
    const ack=JSON.parse(await fs.readFile(path.join(main,'side-training-reservation-ack.json'),'utf8'));
    const owner=await readLiveFileLockOwner(path.join(main,'controller.lock'));
    assert.equal(ack.reservationHash,digest(reservation));assert.equal(owner?.pid,ack.pid);
    const status=(stage,detail={})=>{
      const value={contract:CONTRACT,pid:process.pid,at:new Date().toISOString(),stage,
        mainRunDirectory:main,trainingDeckId:config.deck.id,promotionEligible:false,...detail};
      const file=path.join(root,'status.json'),tmp=`${file}.tmp-${process.pid}`;
      writeFileSync(tmp,JSON.stringify(value,null,2));renameWithRetrySync(tmp,file);
    };
    let state=await optional(path.join(root,'state.json.gz'));
    if(!state)state={configHash:digest(config),iteration:0,learnerPath:config.initialPath};
    assert.equal(state.configHash,digest(config));
    const continuation=validatePilotContinuation(config,
      await fs.readFile(path.join(root,'continuous-training-protocol.json'),'utf8')
        .then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;}),state);
    const baseline=modelFrom(await readTrajectoryArchive(config.initialPath));
    try{
      if(continuation&&!state.continuationHash){
        state={...state,continuationHash:digest(continuation)};
        await writeTrajectoryArchive(path.join(root,'state.json.gz'),state);
      }
      // Finish an interrupted frozen evaluation before advancing its candidate.
      if(!await evaluatePilotCheckpoint(config,state,baseline,continuation,status))return;
      for(let iteration=state.iteration+1;continuation||iteration<=config.iterations;iteration++){
        if(existsSync(path.join(root,'stop.request.json'))){status('paused',state);return;}
        const storage=await fs.statfs(root);
        assert.ok(storage.bavail*storage.bsize>=1.5*1024**3,'Insufficient free space for the next pilot iteration.');
        const directory=path.join(root,'iterations',String(iteration).padStart(6,'0'));
        await fs.mkdir(directory,{recursive:true});
        const source=modelFrom(await readTrajectoryArchive(state.learnerPath));
        let candidate=null;
        try{
          const expected=pilotPlan(config,iteration,state.learnerPath,neuralBehaviorHash(source),continuation);
          let plan=await optional(path.join(directory,'plan.json.gz'));
          if(plan)assert.equal(digest(plan),digest(expected));
          else{plan=expected;await writeTrajectoryArchive(path.join(directory,'plan.json.gz'),plan);}
          const candidatePath=path.join(directory,'candidate.json.gz');
          if(!await optional(candidatePath)){
            status('mirror-collection',{iteration,target:32});let lastStatus=0;
            await collectAdaptiveSelfPlay({directory,plan,model:source,decks:[config.deck],workers:1,
              processes:2,initialProcesses:1,maximumProcesses:2,memoryAwareInitialProcesses:true,
              dynamicScaling:true,minimumFreeMemoryBytes:4*1024**3,releaseIdleOnStop:true,awaitWorkerExit:true,
              maxActions:2400,maximumTaskDurationMs:0,bestOfThreeFraction:0,mirrorFraction:1,
              teacherFraction:0,teacherEvaluatorMode:'heuristic-only',teacherCriticalBudget:0,teacherUrgentBudget:0,
              captureProductionLeafAudit:false,captureIndependentLeafAudit:false,
              engineFingerprint:config.engineFingerprint,retainResults:false,
              resolveTaskOptions:({task})=>({optionOverrides:{...deckSearchTaskOptions(plan.deckSearch,task.gameIndex),
                learnFirstPlayerChoice:[0,7].includes(task.gameIndex%8)}}),
              onWorkerHeartbeat:pool=>{if(Date.now()-lastStatus>10000){lastStatus=Date.now();status('mirror-collection',{iteration,workerPool:pool});}},
              onGameComplete:({gameIndex})=>status('mirror-game-saved',{iteration,gameIndex}),
              onRejectedGame:failure=>status('mirror-game-rejected',{iteration,...failure})});
            const trajectories=[];
            for(let i=0;i<32;i++){
              const game=await readTrajectoryArchive(path.join(directory,'games',`${i}.json.gz`));
              assertAdaptiveGame(game,plan,i);trajectories.push(...game.trajectories);
            }
            assertTrainingTrajectories(trajectories,config.engineFingerprint);
            assert.equal(new Set(trajectories.map(t=>t.gameId)).size,32);
            const epochFile=path.join(directory,'epoch.json.gz'),resume=await optional(epochFile);
            candidate=modelFrom(resume||await readTrajectoryArchive(plan.sourcePath));
            const random=seededRandom(plan.epochSeed);
            if(resume?.randomState!=null)random.setState(resume.randomState);
            const optimizer=resume?await restoreAdamOptimizer(resume.optimizerState,0.0001):undefined;
            status('policy-training',{iteration});
            const trained=await trainRecurrentPpo(candidate,trajectories,{
              epochs:4,batchSize:16,learningRate:0.0001,random,optimizer,resumeState:resume?.selectionState,
              teacherConsumptionPolicy:'record-only-v1',beliefCoefficient:0,
              anchorModels:[{model:baseline,weight:1}],anchorCoefficient:0.05,
              ...adaptiveFiniteEpochGuard(),selectBestEpoch:false,gamesObserved:32,
              onEpochCheckpoint:item=>writeTrajectoryArchive(epochFile,{...item,checkpoint:serializeNeuralModel(candidate)}),
              onEpoch:metrics=>status('policy-training',{iteration,metrics})});
            trained.optimizer.dispose();
            assert.ok(trained.epochGuards.length&&trained.epochGuards.every(g=>g.passed));
            candidate.metadata={...candidate.metadata,experimentalLearner:true,promotionEligible:false,
              evaluatorCertification:null,isolatedDeckPilot:{contract:CONTRACT,iteration,trainingGames:iteration*32,
                initialSha256:config.initialSha256,deckKey:trainingDeckKey(config.deck),
                mainTrainingWeightsUpdated:false},
              trainingDeckIds:[...new Set([...(candidate.metadata?.trainingDeckIds||[]),config.presetId])]};
            const checkpoint=serializeNeuralModel(candidate);assertAdaptiveCheckpoint(checkpoint);
            await writeTrajectoryArchive(candidatePath,{checkpoint,planHash:digest(plan)});
            trajectories.length=0;
          }
          const saved=await readTrajectoryArchive(candidatePath);
          assert.equal(saved.planHash,digest(plan));assertAdaptiveCheckpoint(unwrap(saved));
          state={...state,iteration,learnerPath:candidatePath};
          await writeTrajectoryArchive(path.join(root,'state.json.gz'),state);
          // The verified final checkpoint and durable cursor supersede only
          // this iteration's restart file. Preserve models and all games.
          const epochPath=path.join(directory,'epoch.json.gz');
          const details=await fs.lstat(epochPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
          if(details?.isFile()&&!details.isSymbolicLink())await fs.unlink(epochPath);
          status('candidate-saved',{...state,trainingGames:iteration*32});
        }finally{disposeNeuralModel(source);if(candidate)disposeNeuralModel(candidate);}
        globalThis.gc?.();
        if(!await evaluatePilotCheckpoint(config,state,baseline,continuation,status))return;
      }
    }catch(error){status('failed',{...state,error:error.message});throw error;}
    finally{
      disposeNeuralModel(baseline);
      // All collection children are drained before this point. Only release
      // the reservation owned by this exact pilot, never another experiment.
      if(digest(readSideTrainingReservation(main))===digest(reservation))
        await fs.unlink(path.join(main,'side-training-reservation.json'));
    }
  },{timeoutMs:1000}));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config=JSON.parse(await fs.readFile(path.resolve(process.argv[2]),'utf8'));
  await runDeckPilot(config);
}
