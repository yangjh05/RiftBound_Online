import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readTrajectoryArchive,writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {deserializeNeuralModel,serializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {trainBehaviorCloning,evaluateBehaviorCloning} from '../src/ai/neural/trainer.mjs';
import {seededRandom} from '../src/ai/neural/selfplay.mjs';
import {collectTacticalDemonstrationGame} from './tactical-baseline-bootstrap.mjs';
import {collectProcessPoolSelfPlay} from './ai-selfplay-process-pool.mjs';
import {readPolicyQUtilityProtocol,utilityDigest} from './policy-q-utility.mjs';
import {collectLiveTacticalDemonstrations} from './live-game-curriculum.mjs';

export const TACTICAL_REFRESH_CONTRACT='prospective-public-tactical-refresh-v1';
const optional=async file=>{try{return await readTrajectoryArchive(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export async function readTacticalRefreshProtocol(directory){
  let p;
  try{p=JSON.parse((await readFile(path.join(directory,'tactical-refresh-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(p?.contract!==TACTICAL_REFRESH_CONTRACT || !Number.isInteger(p.afterIteration) || p.afterIteration<0
    || p.everyIterations!==8 || p.games!==10 || p.epochs!==2 || p.learningRate!==0.0001
    || !Number.isInteger(p.seed) || p.seed<1 || p.seed>0xffffffff) throw new Error('Invalid tactical refresh protocol.');
  return p;
}

export function tacticalRefreshSchedule(protocol,iteration,deckIds){
  if(!protocol || iteration<=protocol.afterIteration || (iteration-protocol.afterIteration-1)%protocol.everyIterations) return null;
  if(deckIds.length!==5 || new Set(deckIds).size!==5) throw new Error('Tactical refresh requires the committed five-deck coverage.');
  return Array.from({length:protocol.games},(_,index)=>({index,deckId:deckIds[Math.floor(index/2)],
    partition:index%2?'validation':'training',seed:(protocol.seed+Math.imul(iteration,104729)+Math.imul(index+1,13007))>>>0}));
}

export function tacticalRefreshRound(protocol,iteration){
  // Calls occur at iterations 1, 9, 17, ... . Using the raw iteration as a
  // window index can alias a 32/64-position bank and repeat the same slice.
  return Math.max(1,Math.floor((iteration-protocol.afterIteration-1)/protocol.everyIterations)+1);
}

// Fresh demonstration games only. Evaluation replays and protected Q evidence
// are never read here. The refresh precedes a new on-policy collection, so its
// new behavior hash is the source of all subsequent PPO log probabilities.
export async function collectTacticalRefreshGames({root,model,decks,schedule,engineFingerprint,protocolHash,sourceSha256,
  iteration,status=async()=>{},processes=1,dynamicProcessLimit,collect=collectProcessPoolSelfPlay}){
  if(schedule.some((item,index)=>item.index!==index))throw new Error('Invalid tactical refresh schedule order.');
  await mkdir(path.join(root,'games'),{recursive:true});
  const fileFor=index=>path.join(root,'games',`${index}.json.gz`);
  const check=(game,item)=>{
    if(game.refreshContract!==TACTICAL_REFRESH_CONTRACT || game.protocolHash!==protocolHash
      || game.sourceSha256!==sourceSha256 || game.seed!==item.seed || game.gameIndex!==item.index
      || game.partition!==item.partition || game.engineFingerprint!==engineFingerprint
      || Boolean(game.responseAware)!==Boolean(item.responseAware)
      || game.summary?.deckIds?.length!==2 || game.summary.deckIds.some(id=>id!==item.deckId)){
      throw new Error('Tactical refresh game identity changed.');
    }
  };
  const completed=new Set();
  for(const item of schedule){
    const existing=await optional(fileFor(item.index));
    if(existing){check(existing,item);completed.add(item.index);}
  }
  const saveGame=async(item,game)=>{
    Object.assign(game,{refreshContract:TACTICAL_REFRESH_CONTRACT,protocolHash,sourceSha256,partition:item.partition});
    check(game,item);
    if(completed.has(item.index))throw new Error('Duplicate tactical refresh result.');
    await writeTrajectoryArchive(fileFor(item.index),game);
    completed.add(item.index);
    await status('tactical-refresh-collection',{iteration,game:completed.size,games:schedule.length,
      gameIndex:item.index,deckId:item.deckId,partition:item.partition});
  };
  if(completed.size<schedule.length){
    const capacity=Math.max(1,Math.min(8,Math.floor(Number(processes)||1)));
    if(capacity===1){
      for(const item of schedule){
        if(completed.has(item.index))continue;
        const deck=decks.find(d=>d.id===item.deckId);
        if(!deck)throw new Error('Missing tactical refresh deck.');
        await saveGame(item,collectTacticalDemonstrationGame(model,[deck,deck],{
          seed:item.seed,gameIndex:item.index,engineFingerprint,responseAware:item.responseAware}));
      }
    }else{
      let lastPoolStatusAt=0;
      await collect({model,decks,games:schedule.length,workers:1,seed:1,
        processes:capacity,initialProcesses:capacity,maximumProcesses:capacity,
        memoryAwareInitialProcesses:true,dynamicProcessLimit,dynamicScaling:true,
        minimumFreeMemoryBytes:4*1024**3,awaitWorkerExit:true,
        maxActions:2400,maximumTaskDurationMs:0,engineFingerprint,
        tacticalRefreshSchedule:schedule,completedGameIndexes:new Map([[0,new Set(completed)]]),retainResults:false,
        onWorkerHeartbeat:workerPool=>{
          if(Date.now()-lastPoolStatusAt<10000)return;
          lastPoolStatusAt=Date.now();
          return status('tactical-refresh-collection',{iteration,game:completed.size,games:schedule.length,workerPool});
        },
        onGameComplete:({gameIndex,result})=>{
          if(!result.tacticalDemonstration || !schedule[gameIndex])throw new Error('Missing tactical demonstration result.');
          return saveGame(schedule[gameIndex],result.tacticalDemonstration);
        }});
    }
  }
  // Completion order must never become minibatch order or change the split.
  const games=[];
  for(const item of schedule){const game=await optional(fileFor(item.index));
    if(!game)throw new Error('Tactical refresh collection is incomplete.');
    check(game,item);games.push(game);}
  return games;
}

export async function ensureTacticalPolicyRefresh(config,inputPath,iteration,decks,status=async()=>{},expectedProtocolHash=null,runtime={}){
  const protocol=await readTacticalRefreshProtocol(config.directory);
  const originalHash=protocol ? createHash('sha256').update(JSON.stringify(protocol)).digest('hex') : null;
  if(expectedProtocolHash && expectedProtocolHash!==originalHash)throw new Error('Active tactical refresh protocol changed.');
  const utility=await readPolicyQUtilityProtocol(config.directory);
  const schedule=tacticalRefreshSchedule(protocol,iteration,config.deckIds)
    || (protocol && utility && iteration===utility.afterIteration+1
      ? tacticalRefreshSchedule({...protocol,afterIteration:utility.afterIteration},iteration,config.deckIds) : null);
  if(!schedule)return inputPath;
  const responseAware=Boolean(utility && iteration>utility.afterIteration);
  if(responseAware)for(const item of schedule)item.responseAware=true;
  const protocolHash=responseAware?utilityDigest([originalHash,utility]):originalHash;
  const sourceSha256=createHash('sha256').update(await readFile(inputPath)).digest('hex');
  const root=path.join(config.directory,'tactical-refresh',String(iteration).padStart(6,'0'));
  const output=path.join(root,'checkpoint.json.gz');
  const existing=await optional(output);
  const check=result=>{
    if(result.contract!==TACTICAL_REFRESH_CONTRACT || result.protocolHash!==protocolHash
      || result.sourceSha256!==sourceSha256 || result.engineFingerprint!==config.engineFingerprint) throw new Error('Tactical refresh provenance changed.');
  };
  if(existing){check(existing);return output;}
  await mkdir(path.join(root,'games'),{recursive:true});
  const payload=await readTrajectoryArchive(inputPath);
  const model=deserializeNeuralModel(payload.candidateCheckpoint||payload.checkpoint||payload);
  const training=[],validation=[];
  let optimizer;
  try{
    const games=await collectTacticalRefreshGames({...runtime,root,model,decks,schedule,
      engineFingerprint:config.engineFingerprint,protocolHash,sourceSha256,iteration,status});
    for(const game of games)if(game.summary.completed)(game.partition==='training'?training:validation).push(...game.samples);
    const liveRound=tacticalRefreshRound(protocol,iteration);
    const live=await collectLiveTacticalDemonstrations(config.liveGameCurriculumDirectory,config.engineFingerprint,model,{iteration:liveRound});
    training.push(...live.samples);
    const metrics=()=>{
      const m=evaluateBehaviorCloning(model,validation,{sequenceLength:1,batchSize:16,skipCalibration:true});
      return {policyLoss:m.policyLoss,decisionAccuracy:m.decisionAccuracy,decisions:m.decisionSteps};
    };
    let best=serializeNeuralModel(model),bestEpoch=0,before=null,after=null;
    const history=[];
    if(training.length>=32 && validation.length>=8){
      before=metrics();after=before;
      if(!Number.isFinite(before.policyLoss))throw new Error('Non-finite refresh validation loss.');
      const random=seededRandom(protocol.seed+iteration);
      for(let epoch=1;epoch<=protocol.epochs;epoch++){
        const fit=trainBehaviorCloning(model,training,{epochs:1,batchSize:16,sequenceLength:1,
          learningRate:protocol.learningRate,optimizer,random,auxiliary:true,policyInitializationOnly:true,
          valueCoefficient:0,beliefCoefficient:0,entropyCoefficient:0.01});
        optimizer=fit.optimizer;
        const score=metrics();
        if(!Number.isFinite(score.policyLoss)||fit.history.some(m=>!Number.isFinite(m.loss)))throw new Error('Non-finite tactical refresh update.');
        history.push({epoch,...score});
        if(score.policyLoss<after.policyLoss){best=serializeNeuralModel(model);bestEpoch=epoch;after=score;}
        await status('tactical-refresh-training',{iteration,epoch,epochs:protocol.epochs,before,current:score,bestEpoch});
      }
    }
    const report={contract:TACTICAL_REFRESH_CONTRACT,protocolHash,sourceSha256,engineFingerprint:config.engineFingerprint,
      iteration,bestEpoch,before,after,trainingDecisions:training.length,validationDecisions:validation.length,history,
      policyInitializationOnly:true,winProbabilityLabels:false,promotionEligible:false,
      outcome:bestEpoch?'updated':training.length<32||validation.length<8?'insufficient-demonstrations':'no-held-out-fit-improvement'};
    report.responseAware=responseAware;
    report.provisionalLiveDemonstrations={contract:live.contract,decisions:live.samples.length,sourceGames:live.sourceGames,
      iteration,rotationRound:liveRound,reviewedPositions:live.reviewedPositions||0,
      policyInitializationOnly:true,terminalWinLabels:false};
    report.responseDemonstrations=games.reduce((sum,game)=>sum+(game.summary.completed?game.responseDemonstrations||0:0),0);
    best.metadata={...best.metadata,tacticalRefresh:report,evaluatorCertification:null,evaluatorCertificate:null};
    await writeTrajectoryArchive(output,{checkpoint:best,...report});
    await status('tactical-refresh-ready',{iteration,bestEpoch,outcome:report.outcome,trainingDecisions:training.length,
      validationDecisions:validation.length,before,after,checkpointPath:output});
    return output;
  }finally{optimizer?.dispose();disposeNeuralModel(model);}
}
