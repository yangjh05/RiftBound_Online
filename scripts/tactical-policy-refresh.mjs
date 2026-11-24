import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readTrajectoryArchive,writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {deserializeNeuralModel,serializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {trainBehaviorCloning,evaluateBehaviorCloning} from '../src/ai/neural/trainer.mjs';
import {seededRandom} from '../src/ai/neural/selfplay.mjs';
import {contextualLessonSamples} from './lesson-memory-context.mjs';
import {collectTacticalDemonstrationGame} from './tactical-baseline-bootstrap.mjs';
import {collectProcessPoolSelfPlay} from './ai-selfplay-process-pool.mjs';
import {readPolicyQUtilityProtocol,utilityDigest} from './policy-q-utility.mjs';
import {collectLiveTacticalDemonstrations} from './live-game-curriculum.mjs';
import {readLocalPolicyLearning,localPolicyDigest,localPolicyRefreshSchedule,tacticalSelectionGuard} from './local-policy-learning.mjs';
import {readDeckSearchProtocol} from './adaptive-deck-search.mjs';
import {readResponsePolicy,responsePolicyDigest,responseProfileCatalog} from './response-policy-learning.mjs';
import {TACTICAL_TEACHING_REVISION} from './response-aware-demonstration.mjs';
import {readTacticalLessonProtocol,tacticalLessonDigest,freezeTacticalLessonBank,trainBalancedTacticalLessons,
  readLessonReplayProtocol,lessonReplayCommitment} from './tactical-lesson-learning.mjs';
import {readLessonSupplyProtocol,collectLessonSupply} from './tactical-lesson-supply.mjs';
import {decideSupplementalRefresh} from './efficient-policy-learning.mjs';

export const TACTICAL_REFRESH_CONTRACT='prospective-public-tactical-refresh-v1';
export const TEACHING_REPAIR_CONTRACT='prospective-public-teaching-repair-v1';
export async function readTeachingRepairProtocol(directory){
  let p;
  try{p=JSON.parse((await readFile(path.join(directory,'teaching-repair-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(p?.contract!==TEACHING_REPAIR_CONTRACT||p.revision!==TACTICAL_TEACHING_REVISION
    ||!Number.isSafeInteger(p.afterIteration)||p.afterIteration<0)throw new Error('Invalid teaching repair protocol.');
  return p;
}
export function commitTeachingRepairProtocol(state,p){
  const hash=p?responsePolicyDigest(p):null;
  if(state.teachingRepairHash){
    if(hash!==state.teachingRepairHash)throw new Error('Teaching repair commitment changed or removed.');
  }else if(p){
    if(p.afterIteration<state.iteration)throw new Error('Teaching repair must be prospective.');
    state.teachingRepairHash=hash;
  }
}
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
      || Boolean(game.localResourceLessons)!==Boolean(item.localResourceLessons)
      || (item.teachingRevision&&game.teachingRevision!==item.teachingRevision)
      || (game.responseCatalogHash||null)!==(item.responseContext?.catalogHash||null)
      || (game.responsePolicyContract||null)!==(item.responseContext?.contract||null)
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
          seed:item.seed,gameIndex:item.index,engineFingerprint,responseAware:item.responseAware,localResourceLessons:item.localResourceLessons,
          responseContext:item.responseContext}));
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
  const {readLessonMaintenance}=await import('./lesson-maintenance.mjs');
  const maintenanceProtocol=await readLessonMaintenance(config.directory);
  const maintenance=maintenanceProtocol&&iteration>maintenanceProtocol.afterIteration?maintenanceProtocol:null;
  const supplyProtocol=await readLessonSupplyProtocol(config.directory);
  if(runtime.tacticalLessonSupplyHash&&(!supplyProtocol||tacticalLessonDigest(supplyProtocol)!==runtime.tacticalLessonSupplyHash))
    throw new Error('Lesson supply commitment changed.');
  const activeSupply=supplyProtocol&&iteration>supplyProtocol.afterIteration;
  const lessonProtocol=await readTacticalLessonProtocol(config.directory);
  if(runtime.tacticalLessonLearningHash&&(!lessonProtocol||tacticalLessonDigest(lessonProtocol)!==runtime.tacticalLessonLearningHash))
    throw new Error('Tactical lesson commitment changed.');
  const activeLessons=lessonProtocol&&iteration>lessonProtocol.afterIteration;
  const repair=await readTeachingRepairProtocol(config.directory);
  if(runtime.teachingRepairHash&&responsePolicyDigest(repair)!==runtime.teachingRepairHash)throw new Error('Teaching repair commitment changed.');
  const activeRepair=repair&&iteration>repair.afterIteration;
  const replayProtocol=await readLessonReplayProtocol(config.directory,lessonProtocol);
  if(runtime.tacticalLessonReplayHash&&tacticalLessonDigest(replayProtocol)!==runtime.tacticalLessonReplayHash)
    throw new Error('Lesson replay commitment changed or removed.');
  const replay=lessonProtocol?lessonReplayCommitment(lessonProtocol,replayProtocol,
    {iteration,engineFingerprint:config.engineFingerprint,revision:repair?.revision}):null;
  const protocol=await readTacticalRefreshProtocol(config.directory);
  const originalHash=protocol ? createHash('sha256').update(JSON.stringify(protocol)).digest('hex') : null;
  if(expectedProtocolHash && expectedProtocolHash!==originalHash)throw new Error('Active tactical refresh protocol changed.');
  const utility=await readPolicyQUtilityProtocol(config.directory);
  const local=await readLocalPolicyLearning(config.directory);
  const responseProtocol=await readResponsePolicy(config.directory);
  if(runtime.responsePolicyLearningHash&&(!responseProtocol||responsePolicyDigest(responseProtocol)!==runtime.responsePolicyLearningHash))
    throw new Error('Active response policy changed.');
  let responseContext=responseProtocol&&iteration>responseProtocol.afterIteration?responseProtocol:null;
  if(runtime.localPolicyLearningHash&&(!local||localPolicyDigest(local)!==runtime.localPolicyLearningHash))
    throw new Error('Active local policy learning changed.');
  const activeLocal=Boolean(local&&iteration>local.afterIteration);
  if(activeLocal){
    const search=await readDeckSearchProtocol(config.directory);
    if(search)decks=search.anchors;
  }
  if(responseContext){
    // Refresh the COMMON catalogue from all public training candidates. This
    // does not tell either seat which hidden list was assigned to its opponent.
    const profiles=responseProfileCatalog([...decks,...(runtime.responseCatalogDecks||[])]);
    responseContext={...responseContext,profiles,catalogHash:responsePolicyDigest(profiles)};
  }
  let schedule=activeLocal?localPolicyRefreshSchedule(protocol,local,iteration,decks.map(d=>d.id))
    :tacticalRefreshSchedule(protocol,iteration,config.deckIds)
    || (protocol && utility && iteration===utility.afterIteration+1
      ? tacticalRefreshSchedule({...protocol,afterIteration:utility.afterIteration},iteration,config.deckIds) : null);
  if(!schedule&&responseContext&&iteration===responseContext.afterIteration+1&&activeLocal)
    schedule=localPolicyRefreshSchedule(protocol,{...local,afterIteration:responseContext.afterIteration},iteration,decks.map(d=>d.id));
  if(!schedule&&activeRepair&&iteration===repair.afterIteration+1&&activeLocal)
    schedule=localPolicyRefreshSchedule(protocol,{...local,afterIteration:repair.afterIteration},iteration,decks.map(d=>d.id));
  if(!schedule&&activeLessons&&iteration===lessonProtocol.afterIteration+1&&activeLocal)
    schedule=localPolicyRefreshSchedule(protocol,{...local,afterIteration:lessonProtocol.afterIteration},iteration,decks.map(d=>d.id));
  if(!schedule&&activeSupply&&iteration===supplyProtocol.afterIteration+1&&activeLocal)
    schedule=localPolicyRefreshSchedule(protocol,{...local,afterIteration:supplyProtocol.afterIteration},iteration,decks.map(d=>d.id));
  if(!schedule)return inputPath;
  if(activeSupply&&!activeLessons)throw new Error('Lesson supply requires balanced learning and its validation guards.');
  if(activeLessons&&(!activeLocal||!activeRepair))throw new Error('Balanced lessons require committed local learning and repaired teaching.');
  if(runtime.efficientLearning){
    const mandatory=[protocol,utility,local,responseProtocol,repair,lessonProtocol,supplyProtocol].some(p=>p&&iteration===p.afterIteration+1);
    const decision=await decideSupplementalRefresh(config.directory,iteration,inputPath,runtime.efficientLearning,{mandatory});
    if(!decision.collect){await status('tactical-refresh-reused',{iteration,reason:decision.reason,previous:decision.recent.map(r=>r.iteration)});return inputPath;}
  }
  const responseAware=Boolean(utility && iteration>utility.afterIteration);
  if(responseAware)for(const item of schedule)item.responseAware=true;
  if(responseContext)for(const item of schedule)item.responseContext=responseContext;
  if(activeRepair)for(const item of schedule)item.teachingRevision=repair.revision;
  const baselineHash=responseAware?utilityDigest([originalHash,utility]):originalHash;
  const localHash=activeLocal?localPolicyDigest([baselineHash,local]):baselineHash;
  const priorProtocolHash=responseContext?responsePolicyDigest([localHash,responseContext]):localHash;
  const repairedHash=activeRepair?responsePolicyDigest([priorProtocolHash,repair]):priorProtocolHash;
  const lessonHash=activeLessons?tacticalLessonDigest([repairedHash,lessonProtocol]):repairedHash;
  const supplyHash=activeSupply?tacticalLessonDigest([lessonHash,supplyProtocol]):lessonHash;
  const replayHash=replay?.replayProtocolHash?tacticalLessonDigest([supplyHash,replay.replayProtocolHash]):supplyHash;
  const protocolHash=maintenance?tacticalLessonDigest([replayHash,maintenance]):replayHash;
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
    for(const game of games)if(game.summary.completed)(game.partition==='training'?training:validation)
      .push(...game.samples.map(sample=>activeLocal?{...sample,deckId:game.summary.deckIds[0]}:sample));
    const liveRound=activeLocal?Math.floor((iteration-local.afterIteration-1)/local.everyIterations)+1:tacticalRefreshRound(protocol,iteration);
    const live=await collectLiveTacticalDemonstrations(config.liveGameCurriculumDirectory,config.engineFingerprint,model,
      {iteration:liveRound,localResourceLessons:activeLocal,responseContext});
    training.push(...live.samples);
    const originalValidation=[...validation];
    const supply=activeSupply?await collectLessonSupply({runDirectory:config.directory,refreshDirectory:root,iteration,model,decks,
      sourceSha256,engineFingerprint:config.engineFingerprint,protocol:supplyProtocol,responseContext,status}):null;
    if(supply){training.push(...supply.training);validation.push(...supply.validation);}
    const localSamples=training.filter(t=>t.steps.some(s=>s.localResourceLesson));
    const measure=samples=>{
      const m=evaluateBehaviorCloning(model,contextualLessonSamples(model,samples),{sequenceLength:1,batchSize:16,skipCalibration:true});
      return {policyLoss:m.policyLoss,decisionAccuracy:m.decisionAccuracy,decisions:m.decisionSteps};
    };
    const metrics=()=>{
      const m=measure(originalValidation);
      if(activeLocal)m.perDeck=Object.fromEntries(decks.map(deck=>[deck.id,measure(originalValidation.filter(t=>t.deckId===deck.id))]));
      return m;
    };
    let best=serializeNeuralModel(model),bestEpoch=0,before=null,after=null;
    const localBefore=activeLocal&&localSamples.length?measure(localSamples):null;
    let localAfter=localBefore;
    let history=[],lessonLearning=null;
    if(activeLessons&&training.length>=32&&validation.length>=8){
      const bank=await freezeTacticalLessonBank({runDirectory:config.directory,refreshDirectory:root,iteration,sourceSha256,
        engineFingerprint:config.engineFingerprint,revision:repair.revision,protocol:lessonProtocol,training,validation,replayProtocol});
      const result=await trainBalancedTacticalLessons({model,bank,training:training.map(s=>({...s,lessonRole:'training'})),validation:originalValidation,
        additionalValidation:supply?.validation||[],
        protocol:lessonProtocol,iteration,maintenance,measureGlobal:metrics,measureLocal:localSamples.length?()=>measure(localSamples):undefined,
        onRound:r=>status('tactical-refresh-training',{iteration,epoch:r.round,epochs:r.rounds,bestEpoch:r.bestRound})});
      ({best,bestEpoch,before,after,localAfter,history,lessonLearning}=result);
    }else if(training.length>=32 && validation.length>=8){
      before=metrics();after=before;
      if(!Number.isFinite(before.policyLoss))throw new Error('Non-finite refresh validation loss.');
      const random=seededRandom(protocol.seed+iteration);
      for(let epoch=1;epoch<=protocol.epochs;epoch++){
        const fit=trainBehaviorCloning(model,contextualLessonSamples(model,training),{epochs:1,batchSize:16,sequenceLength:1,
          learningRate:protocol.learningRate,optimizer,random,auxiliary:true,policyInitializationOnly:true,
          valueCoefficient:0,beliefCoefficient:0,entropyCoefficient:0.01});
        optimizer=fit.optimizer;
        // Rehearse bounded local savings without creating PPO probabilities,
        // victory labels, or training the value/belief/GRU heads.
        if(activeLocal&&localSamples.length){
          const focused=trainBehaviorCloning(model,contextualLessonSamples(model,localSamples),{epochs:1,batchSize:8,sequenceLength:1,
            learningRate:protocol.learningRate,optimizer,random,auxiliary:true,policyInitializationOnly:true,
            valueCoefficient:0,beliefCoefficient:0,entropyCoefficient:0.01});
          if(focused.history.some(m=>!Number.isFinite(m.loss)))throw new Error('Non-finite local resource update.');
        }
        const score=metrics();
        if(!Number.isFinite(score.policyLoss)||fit.history.some(m=>!Number.isFinite(m.loss)))throw new Error('Non-finite tactical refresh update.');
        const guard=activeLocal?tacticalSelectionGuard(before,score):null;
        const localScore=activeLocal&&localSamples.length?measure(localSamples):null;
        const localImproved=!localBefore||localScore.policyLoss<localBefore.policyLoss
          &&localScore.decisionAccuracy+1e-8>=localBefore.decisionAccuracy;
        history.push({epoch,...score,...(activeLocal?{selectionGuard:guard,localResourceMetrics:localScore}:{} )});
        if(score.policyLoss<after.policyLoss&&(!activeLocal||guard.passed&&localImproved)){
          best=serializeNeuralModel(model);bestEpoch=epoch;after=score;localAfter=localScore;
        }
        await status('tactical-refresh-training',{iteration,epoch,epochs:protocol.epochs,before,current:score,bestEpoch});
      }
    }
      const report={contract:TACTICAL_REFRESH_CONTRACT,protocolHash,sourceSha256,engineFingerprint:config.engineFingerprint,
        ...(activeRepair?{teachingRevision:repair.revision,mulliganLearning:{
          trainingDecisions:training.filter(t=>t.steps.some(s=>s.mulliganLesson)).length,
          validationDecisions:validation.filter(t=>t.steps.some(s=>s.mulliganLesson)).length},growthLearning:{
          trainingDecisions:training.filter(t=>t.steps.some(s=>s.growthLesson)).length,
          validationDecisions:validation.filter(t=>t.steps.some(s=>s.growthLesson)).length}}:{}),
      iteration,bestEpoch,before,after,trainingDecisions:training.length,validationDecisions:validation.length,history,
      policyInitializationOnly:true,winProbabilityLabels:false,promotionEligible:false,
      outcome:bestEpoch?'updated':training.length<32||validation.length<8?'insufficient-demonstrations':'no-held-out-fit-improvement'};
    if(lessonLearning)report.lessonLearning=lessonLearning;
    if(supply)report.lessonSupply={contract:supply.contract,protocolHash:supply.protocolHash,
      trainingCounts:supply.trainingCounts,validationCounts:supply.validationCounts,games:supply.games,
      failed:supply.failed,samplesHash:supply.samplesHash,thresholdsUnchanged:true,policyOnly:true,terminalLabels:false};
    if(activeLocal)report.localResourceLearning={contract:local.contract,protocolHash:localPolicyDigest(local),
      trainingDecisions:localSamples.length,before:localBefore,after:localAfter,
      allDecks:decks.map(d=>d.id),selectionGuard:before&&after?tacticalSelectionGuard(before,after):null,
      policyOnly:true,winProbabilityLabels:false,heldOutLabelsTrained:false};
    if(responseContext)report.responsePolicyLearning={contract:responseContext.contract,catalogHash:responseContext.catalogHash,
      protocolHash:responsePolicyDigest(responseProtocol),
      trainingDecisions:training.filter(t=>t.steps.some(s=>s.responsePolicyLesson)).length,
      validationDecisions:validation.filter(t=>t.steps.some(s=>s.responsePolicyLesson)).length,
      responseWindows:games.reduce((n,g)=>n+(g.responseReviews||0),0),
      policyOnly:true,winProbabilityLabels:false,heldOutLabelsTrained:false};
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
