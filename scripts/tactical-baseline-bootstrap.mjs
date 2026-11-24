import {needsPaymentOptionDecision} from '../src/ai/payment-options.mjs';
import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createGame} from '../src/engine.mjs';
import {activeActorId,actionKey,applyAiAction,enumerateAiPolicyActions} from '../src/ai/actions.mjs';
import {resolvePlannedPayment} from '../src/ai/payment-planner.mjs';
import {recommendPublicTacticalAction,TACTICAL_BASELINE_CONTRACT} from '../src/ai/tactical-baseline.mjs';
import {ACTION_DIM,CARD_BINS} from '../src/ai/neural/encoding.mjs';
import {createNeuralSession,deserializeNeuralModel,serializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {trainBehaviorCloning,evaluateBehaviorCloning} from '../src/ai/neural/trainer.mjs';
import {readTrajectoryArchive,writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {seededRandom,evaluateNeuralModels} from '../src/ai/neural/selfplay.mjs';
import {readEvaluationRollout} from './adaptive-policy-q-evaluation.mjs';
import {recommendResponseAwareAction,recommendSafeTacticalAction,TACTICAL_TEACHING_REVISION} from './response-aware-demonstration.mjs';
import {recommendLocalResourceDemonstration,localResourceDecision} from './local-policy-learning.mjs';
import {lessonMemoryContext} from './lesson-memory-context.mjs';

const optional=async file=>{try{return await readTrajectoryArchive(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const checkpoint=payload=>payload.checkpoint||payload;

export function collectTacticalDemonstrationGame(model,decks,{seed,gameIndex,engineFingerprint,maxActions=2400,responseAware=false,localResourceLessons=false,responseContext=null}={}){
  const random=seededRandom(seed);
  const game=createGame({decks,firstPlayerChooserId:(gameIndex+Math.floor(gameIndex/2))%2?'p2':'p1',interactive:true,
    manualActionChainPriority:true,decisionSafety:'strict',randomSeed:seed});
  const session=createNeuralSession(model),plans=new Map(),samples=[],memoryHistories=new Map();
  let actionCount=0,responseReviews=0,responseDemonstrations=0,resourceReviews=0,resourceDemonstrations=0;
  for(;actionCount<maxActions&&game.phase!=='complete';actionCount++){
    if(game.pendingPayment&&!needsPaymentOptionDecision(game)){if(!resolvePlannedPayment(game)?.ok)break;continue;}
    const actorId=activeActorId(game),legal=enumerateAiPolicyActions(game,actorId);
    if(!actorId||!legal.length)break;
    // Keep complete actor-only observation prefixes for future model updates.
    const decision=session.decide(game,actorId,legal,{greedy:true,temperature:0.8,random});
    const memoryPrefix=memoryHistories.get(actorId)||[];
    let action=decision.action,weight=0,review=null;
    const planned=plans.get(actorId);
    let resourceAdvice=null;
    if(localResourceLessons&&resourceReviews<24&&localResourceDecision(game,actorId,decision.action)){
      resourceReviews++;resourceAdvice=recommendLocalResourceDemonstration(game,actorId,decision);
    }
    if(resourceAdvice){
      plans.delete(actorId);review=resourceAdvice;action=review.action;weight=review.weight;resourceDemonstrations++;
    }else if(planned?.steps.length&&decision.legalActions.some(a=>actionKey(a)===actionKey(planned.steps[0]))){
      action=planned.steps.shift();weight=planned.weight;
    }else{
      plans.delete(actorId);
      review=recommendSafeTacticalAction(game,actorId,decision.legalActions,{selectedAction:decision.action});
      if(responseAware && responseReviews<(responseContext?.maximumReviewsPerGame||6) && decision.legalCount>1 && (game.showdown || game.actionChain
        || decision.legalActions.some(a=>['moveUnit','moveUnits'].includes(a.kind))
        || decision.legalActions.some(a=>a.kind==='beginPlayCard' && game.players.find(p=>p.id===actorId)?.hand
          .some(c=>c.instanceId===a.cardId && c.type==='spell')))){
        responseReviews++;
        const response= recommendResponseAwareAction(game,actorId,decision,review,{responseContext});
        if(response){review=response;responseDemonstrations++;}
      }
      if(review){
        action=review.action;weight=review.weight;
        // Ending the turn is a common evaluation horizon, not an instruction
        // to stop playing after this bounded plan. Reconsider the real hand
        // and any newly drawn cards before deciding whether to end the turn.
        // A response comparison selects the current action only. Its
        // no-response continuation is not a commitment after a real exchange.
        const steps=review.opponentResponsesCompared?[]:review.continuation.slice(1),end=steps.findIndex(a=>a.kind==='endTurn');
        plans.set(actorId,{steps:end<0?steps:steps.slice(0,end),weight});
      }
    }
    const selectedIndex=decision.legalActions.findIndex(a=>actionKey(a)===actionKey(action));
    if(weight>0&&decision.legalCount>1){
      const sourceGameId=`tactical-demo-${seed}-${gameIndex}`;
      samples.push({gameId:sourceGameId,playerId:actorId,imitation:true,
        contract:TACTICAL_BASELINE_CONTRACT,engineFingerprint,memoryContext:lessonMemoryContext(actorId,memoryPrefix),steps:[{
          state:decision.stateEncoding,actions:decision.actionEncoding.slice(0,decision.legalCount*ACTION_DIM),
          initialMemory:decision.initialMemory,selectedIndex,legalCount:decision.legalCount,
          oldLogProbability:0,behaviorTemperature:1,advantage:weight,return:0,value:0,
          beliefTarget:new Float32Array(CARD_BINS),
          selectedActionKey:actionKey(action),legalActionKeys:decision.legalActions.map(actionKey),
          imitation:true,winProbabilityLabel:false,opponentResponsesCompared:Boolean(review?.opponentResponsesCompared),
          ...(review?.localResourceLesson?{localResourceLesson:true,localResourceReason:review.comparison}:{}),
          tacticalResponseModel:review?.responseReview?.probabilityModel||null,
          ...(review?.responsePolicyLesson?{responsePolicyLesson:true,responsePolicyReview:review.responseReview}:{}),
          ...(review?.mulliganLesson?{mulliganLesson:true}:{}),
          ...(review?.growthLesson?{growthLesson:true,developmentHorizon:review.developmentHorizon}:{}),
          tacticalGainOverHold:review?.gainOverHold??null
        }]});
    }
    memoryHistories.set(actorId,[...memoryPrefix,Array.from(decision.stateEncoding)]);
    if(!applyAiAction(game,action,actorId)?.ok)break;
    if(action.kind!=='passShowdown')for(const id of plans.keys())if(id!==actorId)plans.delete(id);
  }
  const completed=game.phase==='complete'&&Boolean(game.winnerId)&&!game.decisionSafety?.violations?.length;
  return {contract:TACTICAL_BASELINE_CONTRACT,teachingRevision:TACTICAL_TEACHING_REVISION,engineFingerprint,gameIndex,seed,
    ...(responseContext?{responseCatalogHash:responseContext.catalogHash,responsePolicyContract:responseContext.contract}:{}),
    ...(localResourceLessons?{localResourceLessons:true,resourceReviews,resourceDemonstrations}:{}),
    responseAware,responseReviews,responseDemonstrations,
    summary:{completed,winnerId:game.winnerId||null,actions:actionCount,deckIds:decks.map(d=>d.id),
      demonstratedDecisions:completed?samples.length:0},samples:completed?samples:[]};
}

export async function ensureTacticalBaseline(config,inputPath,decks,status=async()=>{}){
  if(!config.tacticalBaseline)return inputPath;
  const settings=config.tacticalBaseline,root=path.join(config.directory,'tactical-baseline');
  const output=path.join(root,'checkpoint.json.gz'),sourceSha256=await hash(inputPath);
  const existing=await optional(output);
  if(existing){
    if(existing.contract!==TACTICAL_BASELINE_CONTRACT||existing.engineFingerprint!==config.engineFingerprint
      ||existing.sourceSha256!==sourceSha256)throw new Error('Tactical baseline provenance changed.');
    return output;
  }
  await mkdir(path.join(root,'games'),{recursive:true});
  const source=deserializeNeuralModel(checkpoint(await readTrajectoryArchive(inputPath)));
  const training=[],validation=[];let collected=0;
  try{
    for(let index=0;index<settings.games;index++){
      const file=path.join(root,'games',`${index}.json.gz`);
      let result=await optional(file);
      if(!result){
        const seed=(settings.seed+Math.imul(index+1,104729))>>>0;
        const pair=[decks[index%decks.length],decks[(index+1+Math.floor(index/decks.length))%decks.length]];
        await status('tactical-baseline-collection',{game:index+1,games:settings.games,demonstratedDecisions:collected});
        result=collectTacticalDemonstrationGame(source,pair,{seed,gameIndex:index,engineFingerprint:config.engineFingerprint});
        result.sourceSha256=sourceSha256;
        await writeTrajectoryArchive(file,result);
      }
      if(result.engineFingerprint!==config.engineFingerprint||result.sourceSha256!==sourceSha256
        ||result.gameIndex!==index)throw new Error('Tactical demonstration provenance mismatch.');
      if(!result.summary.completed)continue;
      collected+=result.samples.length;
      (index%4===3?validation:training).push(...result.samples);
    }
    if(training.length<32||validation.length<8)throw new Error('Too few completed tactical demonstrations for a separate validation split.');
    const metrics=model=>{
      const result=evaluateBehaviorCloning(model,validation,{sequenceLength:1,batchSize:16,skipCalibration:true});
      return {policyLoss:result.policyLoss,decisionAccuracy:result.decisionAccuracy,decisions:result.decisionSteps};
    };
    const before=metrics(source),history=[];
    let best=serializeNeuralModel(source),bestMetrics=before,bestEpoch=0,optimizer;
    const random=seededRandom(settings.seed);
    try{
      for(let epoch=1;epoch<=settings.epochs;epoch++){
        const trained=trainBehaviorCloning(source,training,{epochs:1,batchSize:16,sequenceLength:1,
          learningRate:settings.learningRate||0.0003,optimizer,random,auxiliary:true,
          policyInitializationOnly:true,valueCoefficient:0,beliefCoefficient:0,entropyCoefficient:0.01});
        optimizer=trained.optimizer;
        const score=metrics(source);
        if(!Number.isFinite(score.policyLoss)||trained.history.some(m=>!Number.isFinite(m.loss)))throw new Error('Non-finite tactical baseline training.');
        history.push({epoch,...score});
        if(score.policyLoss<bestMetrics.policyLoss){best=serializeNeuralModel(source);bestMetrics=score;bestEpoch=epoch;}
        await status('tactical-baseline-training',{epoch,epochs:settings.epochs,trainingDecisions:training.length,
          validationDecisions:validation.length,before,current:score,bestEpoch});
      }
    }finally{optimizer?.dispose();}
    if(bestEpoch===0)throw new Error('Tactical initialization did not improve held-out demonstration fit.');
    best.metadata={...best.metadata,engineFingerprint:config.engineFingerprint,evaluatorCertificate:null,evaluatorCertification:null,
      tacticalBaseline:{contract:TACTICAL_BASELINE_CONTRACT,sourceSha256,bestEpoch,before,after:bestMetrics,
        trainingDecisions:training.length,validationDecisions:validation.length,
        initializationOnly:true,hardActionPreference:false,winProbabilityLabels:false}};
    const payload={checkpoint:best,contract:TACTICAL_BASELINE_CONTRACT,engineFingerprint:config.engineFingerprint,
      sourceSha256,history,trainingDecisions:training.length,validationDecisions:validation.length,
      before,after:bestMetrics,bestEpoch,promotionEligible:false};
    await writeTrajectoryArchive(output,payload);
    await status('tactical-baseline-ready',{checkpointPath:output,before,after:bestMetrics,bestEpoch});
    return output;
  }finally{disposeNeuralModel(source);}
}

// Diagnostic only: the normal frozen incumbent match remains the promotion
// gate. Run in the controller's reserved slot, never an extra worker pool.
export async function compareWithTacticalBaseline(config,candidatePath,baselinePath,decks,iteration,status){
  // The prospective rollout moves growth comparisons to the shared detached
  // evaluation slot. Preserve old diagnostics, and release the trainer slot.
  const protocol=await readEvaluationRollout(config.directory);
  if(protocol?.contract==='prospective-sequential-evaluation-rollout-v1')return null;
  const games=config.tacticalBaseline?.comparisonGames||0;
  if(!games||(iteration!==1&&iteration%(config.tacticalBaseline.comparisonEvery||8)!==0))return null;
  const file=path.join(path.dirname(candidatePath),'baseline-comparison.json.gz');
  const candidateSha256=await hash(candidatePath),baselineSha256=await hash(baselinePath);
  const existing=await optional(file);
  if(existing){if(existing.candidateSha256!==candidateSha256||existing.baselineSha256!==baselineSha256)throw new Error('Baseline diagnostic inputs changed.');return existing;}
  const candidate=deserializeNeuralModel(checkpoint(await readTrajectoryArchive(candidatePath)));
  const baseline=deserializeNeuralModel(checkpoint(await readTrajectoryArchive(baselinePath)));
  try{
    await status('tactical-baseline-comparison',{iteration,games});
    const result=evaluateNeuralModels(candidate,baseline,decks,{games,seed:config.tacticalBaseline.seed,
      maxActions:2400,evaluationMode:'same-deck-mirror-v3',greedy:true,temperature:0.05,
      onGameComplete:({game})=>{void status('tactical-baseline-comparison',{iteration,game,games});}});
    const valid=result.summaries.every(s=>s.completed&&!s.invalid&&!s.adjudicated);
    const wins=result.summaries.filter(s=>s.winnerId===`p${s.candidateSeat+1}`).length;
    const payload={contract:'fixed-tactical-baseline-diagnostic-v1',candidateSha256,baselineSha256,
      iteration,games:result.summaries.length,valid,wins,losses:result.summaries.length-wins,
      promotionEligible:false,summaries:result.summaries};
    await writeTrajectoryArchive(file,payload);return payload;
  }finally{disposeNeuralModel(candidate);disposeNeuralModel(baseline);}
}
