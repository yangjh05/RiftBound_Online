import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createGame} from '../src/engine.mjs';
import {activeActorId,actionKey,applyAiAction,enumerateAiPolicyActions,cloneGame} from '../src/ai/actions.mjs';
import {needsPaymentOptionDecision} from '../src/ai/payment-options.mjs';
import {resolvePlannedPayment} from '../src/ai/payment-planner.mjs';
import {DEFAULT_AI_MODEL} from '../src/ai/policy.mjs';
import {ACTION_DIM,CARD_BINS,encodeState,encodeActionSet} from '../src/ai/neural/encoding.mjs';
import {createNeuralSession,deserializeNeuralModel,disposeNeuralModel,estimateNeuralValue} from '../src/ai/neural/model.mjs';
import {readTrajectoryArchive,writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {adaptiveGameRole} from './policy-q-utility.mjs';
import {assertAdaptiveGame} from './adaptive-policy-q-evidence.mjs';
import {recommendSafeTacticalAction,recommendResponseAwareAction,TACTICAL_TEACHING_REVISION} from './response-aware-demonstration.mjs';
import {assertLessonSample,tacticalLessonDigest} from './tactical-lesson-learning.mjs';
import {lessonMemoryContext} from './lesson-memory-context.mjs';

export const LESSON_SUPPLY_CONTRACT='prospective-verified-opening-growth-supply-v1';
export const LESSON_SUPPLY_LIMITS=Object.freeze({sourceIterations:8,sourceGamesPerIteration:4,
  openingGamesPerDeck:4,growthGamesPerDeck:8,growthSeedAttempts:64,maximumPrefixActions:96,maximumGrowthReviews:8});
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const optional=async file=>{try{return await readTrajectoryArchive(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const ramp=c=>c?.effects?.some(e=>e.timing==='spell'&&['channelRunes','channelRunesOrDraw'].includes(e.kind));
const equalEncoding=(a,b)=>a.length===b.length&&Array.from(a).every((v,i)=>Number.isFinite(v)&&Math.abs(v-b[i])<=1e-6);
const checkpoint=p=>p.candidateCheckpoint||p.checkpoint||p;

export function validateLessonSupplyProtocol(p){
  assert.equal(p.contract,LESSON_SUPPLY_CONTRACT);assert.equal(p.teachingRevision,TACTICAL_TEACHING_REVISION);
  assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.ok(Number.isSafeInteger(p.seed)&&p.seed>0&&p.seed<=0xffffffff);
  for(const [key,value] of Object.entries(LESSON_SUPPLY_LIMITS))assert.equal(p[key],value,key);
  return p;
}
export async function readLessonSupplyProtocol(root){
  let p;try{p=JSON.parse((await readFile(path.join(root,'tactical-lesson-supply-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}return validateLessonSupplyProtocol(p);
}
export function commitLessonSupplyProtocol(state,p){
  const digest=p?tacticalLessonDigest(p):null;
  if(state.tacticalLessonSupplyHash)assert.equal(digest,state.tacticalLessonSupplyHash,'Lesson supply protocol changed or removed.');
  else if(p){assert.ok(p.afterIteration>=state.iteration,'Lesson supply must start prospectively.');state.tacticalLessonSupplyHash=digest;}
}

// This is a SUPPLY change, not a weaker teacher. In particular we do not remove
// the existing immediate-deployment, score-race, reserve or incomplete-search
// exclusions to hit a sample quota. A seed/position never constitutes a label.
export function acceptedSupplyAdvice(game,actorId,decision,{responseContext=null,teacher=recommendSafeTacticalAction,
  responseTeacher=recommendResponseAwareAction}={}){
  const advice=teacher(game,actorId,decision.legalActions,{selectedAction:decision.action});
  if(!advice?.searchComplete||!(advice.mulliganLesson||advice.growthLesson)||!(advice.weight>0))return null;
  if(advice.mulliganLesson&&!(advice.gain>=0.75))return null;
  if(advice.growthLesson&&(!advice.review?.applied||!(advice.review.gain>=0.5)
    ||!advice.review.comparisons?.every(c=>c.searchComplete)))return null;
  let selected=advice;
  if(advice.growthLesson&&responseContext){
    const response=responseTeacher(game,actorId,decision,advice,{responseContext});
    // An opposing response assessment must not silently become the original
    // no-response recommendation when it contradicts the growth comparison.
    if(response){
      if(!response.growthLesson||actionKey(response.action)!==actionKey(advice.action))return null;
      const compared=response.responseReview?.comparisons;
      const best=compared?.find(c=>actionKey(c.action)===actionKey(response.action));
      const original=compared?.find(c=>actionKey(c.action)===actionKey(decision.action));
      if(!best||!original||!(best.score-original.score>=0.5))return null;
      selected=response;
    }
    else{
      const opponent=game.players.find(p=>p.id!==actorId);
      const publicCards=[opponent.legend,opponent.champion,...opponent.base,
        ...game.battlefields.flatMap(f=>f.units).filter(c=>c.controllerId===opponent.id)].filter(Boolean);
      if(opponent.runes.some(r=>!r.exhausted)||publicCards.some(c=>c.effects?.some(e=>e.timing==='activated')))return null;
    }
  }
  if(actionKey(selected.action)===actionKey(decision.action)
    ||!decision.legalActions.some(a=>actionKey(a)===actionKey(selected.action)))return null;
  return {...selected,supplyProof:{revision:TACTICAL_TEACHING_REVISION,
    kind:advice.mulliganLesson?'mulligan':'growth',gain:advice.gain??advice.review.gain,
    comparisons:advice.comparisons??advice.review.comparisons,
    assumptions:advice.review?.assumptions||[],responseReview:selected.responseReview||null,
    scope:advice.mulliganLesson?'expected-opening-development':'next-own-turn-known-deployment',
    thresholdsUnchanged:true,globalOptimalityClaim:false}};
}

export function supplySample(decision,advice,{familyId,role,deckId,actorId,engineFingerprint,actionCount,origin}){
  const selectedIndex=decision.legalActions.findIndex(a=>actionKey(a)===actionKey(advice.action));
  assert.ok(selectedIndex>=0);assert.ok(advice.supplyProof);
  const sample={gameId:familyId,playerId:actorId,deckId,lessonRole:role,imitation:true,engineFingerprint,
    contract:LESSON_SUPPLY_CONTRACT,lessonSource:{familyId,role,actionCount,origin,proof:advice.supplyProof},steps:[{
      state:Array.from(decision.stateEncoding),actions:Array.from(decision.actionEncoding.slice(0,decision.legalCount*ACTION_DIM)),
      initialMemory:Array.from(decision.initialMemory),selectedIndex,legalCount:decision.legalCount,
      oldLogProbability:0,behaviorTemperature:1,advantage:advice.weight,return:0,value:0,
      beliefTarget:Array.from(new Float32Array(CARD_BINS)),selectedActionKey:actionKey(advice.action),
      legalActionKeys:decision.legalActions.map(actionKey),imitation:true,winProbabilityLabel:false,
      opponentResponsesCompared:Boolean(advice.opponentResponsesCompared),
      ...(advice.mulliganLesson?{mulliganLesson:true}:{}),
      ...(advice.growthLesson?{growthLesson:true,developmentHorizon:advice.developmentHorizon}:{}),
      ...(advice.responsePolicyLesson?{responsePolicyLesson:true,responsePolicyReview:advice.responseReview}:{})}]};
  assertLessonSample(sample,role);return sample;
}

const randomFor=seed=>{let state=seed>>>0||1;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/0x100000000);
  random.getState=()=>state;return random;};
export function createSupplyGame(decks,seed,chooser='p1',firstPlayerId=null){
  return createGame({decks,...(firstPlayerId?{firstPlayerId}:{firstPlayerChooserId:chooser}),interactive:true,manualActionChainPriority:true,
    decisionSafety:'strict',random:randomFor(seed),randomSeed:seed});
}
export function hasGrowthOpening(source){
  const game=cloneGame(source);
  for(let i=0;i<16&&game.phase!=='mulligan';i++){
    const id=activeActorId(game),legal=enumerateAiPolicyActions(game,id);
    const action=legal.find(a=>a.kind==='chooseFirstPlayer'&&a.playerId===id)||legal[0];
    if(!action||!applyAiAction(game,action,id)?.ok||game.decisionSafety?.violations?.length)return false;
  }
  return game.phase==='mulligan'&&game.players.some(p=>p.hand.some(ramp));
}

// Engine trigger tokens contain wall-clock/random IDs. Normalize identifiers
// only when ordered choices, the full encoded action set and encoded state all
// agree with the saved game. Never guess a choice from its selected index.
export function alignReplayTriggerIds(source,actorId,recorded){
  if(source.pendingChoice?.effect!=='triggerOrder')return null;
  const current=enumerateAiPolicyActions(source,actorId),original=recorded.originalLegalActionKeys?.map(k=>JSON.parse(k));
  if(!original||current.length!==original.length||original.length!==recorded.legalCount)return null;
  const withoutId=a=>{const {optionId,...rest}=a;return actionKey(rest);};
  if(current.some((a,i)=>a.kind!=='chooseEffectOption'||!a.optionId?.startsWith('trigger-')
    ||!original[i].optionId?.startsWith('trigger-')||withoutId(a)!==withoutId(original[i])))return null;
  const mapping=new Map(current.map((a,i)=>[a.optionId,original[i].optionId]));
  if(mapping.size!==current.length||new Set(mapping.values()).size!==current.length)return null;
  const game=cloneGame(source),seen=new WeakSet();
  const normalize=o=>{if(!o||typeof o!=='object'||seen.has(o))return;seen.add(o);
    for(const k of Object.keys(o)){if(typeof o[k]==='string'&&mapping.has(o[k]))o[k]=mapping.get(o[k]);else normalize(o[k]);}};
  normalize(game);
  if(!equalEncoding(encodeState(game,actorId),recorded.state))return null;
  const generated=encodeActionSet(game,actorId,enumerateAiPolicyActions(game,actorId));
  if(generated.legalCount!==recorded.legalCount)return null;
  for(let n=0;n<recorded.legalCount;n++){
    const index=generated.actions.findIndex(a=>actionKey(a)===recorded.legalActionKeys[n]);
    if(index<0||!equalEncoding(generated.encoded.slice(index*ACTION_DIM,(index+1)*ACTION_DIM),
      recorded.actions.slice(n*ACTION_DIM,(n+1)*ACTION_DIM)))return null;
  }
  return game;
}

// Partial games give local imitation examples, never terminal/reward evidence.
// Replay failures discard the whole prefix, even labels preceding the mismatch.
export function collectSupplyPrefix({game,model,steps=null,paymentModel=null,role,familyId,deckIds,
  engineFingerprint,origin,openingOnly=false,protocol=LESSON_SUPPLY_LIMITS,responseContext=null}){
  const session=createNeuralSession(model),samples=[],memoryHistories=new Map(),diagnostics={positions:0,reviewed:0,accepted:0,rejected:0,growthReviews:0};
  const payments=paymentModel?{model:DEFAULT_AI_MODEL,learnedCandidateLimit:3,
    valueEstimator:(g,id)=>estimateNeuralValue(paymentModel,g,id)}:{};
  let failure=null;
  try{
    for(let n=0;n<Math.min(protocol.maximumPrefixActions,steps?.length??Infinity)&&game.phase!=='complete';n++){
      if(openingOnly&&['action','showdown','complete'].includes(game.phase))break;
      for(let tries=0;game.pendingPayment&&!needsPaymentOptionDecision(game);tries++)
        if(tries>=10||!resolvePlannedPayment(game,payments)?.ok)throw new Error('unresolved-payment');
      const actorId=activeActorId(game);let legal=enumerateAiPolicyActions(game,actorId);
      if(!actorId||!legal.length)throw new Error('no-legal-action');
      const recorded=steps?.[n];
      if(recorded&&(actorId!==recorded.actorId||!equalEncoding(encodeState(game,actorId),recorded.state)))
        throw new Error(`replay-state-mismatch:${n}`);
      if(recorded&&game.pendingChoice?.effect==='triggerOrder'&&!legal.some(a=>actionKey(a)===recorded.selectedActionKey)){
        const aligned=alignReplayTriggerIds(game,actorId,recorded);
        if(!aligned)throw new Error(`unverified-trigger-identities:${n}`);
        game=aligned;legal=enumerateAiPolicyActions(game,actorId);
        diagnostics.normalizedTriggerChoices=(diagnostics.normalizedTriggerChoices||0)+1;
      }
      const decision=session.decide(game,actorId,legal,{greedy:true,temperature:0.8});
      const memoryPrefix=memoryHistories.get(actorId)||[];
      const action=recorded?JSON.parse(recorded.selectedActionKey):decision.action;
      if(!decision.legalActions.some(a=>actionKey(a)===actionKey(action)))throw new Error(`replay-action-mismatch:${n}`);
      if(recorded){
        const i=decision.legalActions.findIndex(a=>actionKey(a)===actionKey(action));
        if(!equalEncoding(decision.actionEncoding.slice(i*ACTION_DIM,(i+1)*ACTION_DIM),
          recorded.actions.slice(recorded.selectedIndex*ACTION_DIM,(recorded.selectedIndex+1)*ACTION_DIM)))
          throw new Error(`replay-action-encoding:${n}`);
      }
      diagnostics.positions++;
      const growth=game.phase==='action'&&game.currentPlayerId===actorId&&!game.pendingChoice&&!game.pendingPayment
        &&!game.showdown&&!game.actionChain&&game.players.find(p=>p.id===actorId).hand.some(ramp)
        &&(action.kind==='endTurn'||ramp(game.players.find(p=>p.id===actorId).hand.find(c=>c.instanceId===action.cardId)))
        &&!legal.some(a=>['moveUnit','moveUnits','beginPlayChampion'].includes(a.kind)
          ||a.kind==='beginPlayCard'&&game.players.find(p=>p.id===actorId).hand.some(c=>c.instanceId===a.cardId&&c.type==='unit'))
        &&diagnostics.growthReviews<protocol.maximumGrowthReviews;
      if(game.phase==='mulligan'||growth){
        diagnostics.reviewed++;if(growth)diagnostics.growthReviews++;
        const advice=acceptedSupplyAdvice(game,actorId,{...decision,action},{responseContext});
        if(advice){samples.push({...supplySample(decision,advice,{familyId,role,actorId,engineFingerprint,actionCount:n,origin,
          deckId:deckIds[game.players.findIndex(p=>p.id===actorId)]}),memoryContext:lessonMemoryContext(actorId,memoryPrefix)});diagnostics.accepted++;}
        else diagnostics.rejected++;
      }
      // Keep the actual source policy path. Teacher advice never manufactures
      // a different recorded board or forces a hand/rune/turn into existence.
      memoryHistories.set(actorId,[...memoryPrefix,Array.from(decision.stateEncoding)]);
      if(!applyAiAction(game,action,actorId)?.ok)throw new Error(`illegal-transition:${n}`);
      for(let tries=0;game.pendingPayment&&!needsPaymentOptionDecision(game);tries++){
        if(tries>=10||!resolvePlannedPayment(game,payments)?.ok)throw new Error('unresolved-payment');
      }
      if(game.decisionSafety?.violations?.length)throw new Error('decision-safety-violation');
    }
  }catch(e){failure=e.message;}
  return {familyId,role,origin,deckIds,diagnostics,failure,samples:failure?[]:samples,
    terminalLabels:false,policyOnly:true,teachingRevision:TACTICAL_TEACHING_REVISION};
}

export function selectSourceGameIndexes(plan){
  assert.ok(Array.isArray(plan.utility?.validationGameIndexes),'Need the original whole-game split.');
  const indices=Array.from({length:plan.games},(_,i)=>i),training=indices.filter(i=>adaptiveGameRole(plan,i)==='training'),
    validation=indices.filter(i=>adaptiveGameRole(plan,i)==='validation');
  assert.ok(training.length>=3&&validation.length);
  return [...Array.from({length:3},(_,n)=>training[(plan.iteration*3+n)%training.length]),validation[plan.iteration%validation.length]];
}

export function supplySeed(protocol,iteration,deckId,kind,index){
  return parseInt(tacticalLessonDigest([LESSON_SUPPLY_CONTRACT,protocol.seed,iteration,deckId,kind,index]).slice(0,8),16)>>>0;
}
export async function collectLessonSupply({runDirectory,refreshDirectory,iteration,model,decks,sourceSha256,
  engineFingerprint,protocol,responseContext=null,status=async()=>{}}){
  validateLessonSupplyProtocol(protocol);
  const identity={contract:LESSON_SUPPLY_CONTRACT,iteration,sourceSha256,engineFingerprint,
    implementationHash:await hash(fileURLToPath(import.meta.url)),
    teachingRevision:TACTICAL_TEACHING_REVISION,protocolHash:tacticalLessonDigest(protocol),
    responseCatalogHash:responseContext?.catalogHash||null,decksHash:tacticalLessonDigest(decks)};
  const directory=path.join(refreshDirectory,'supply');await mkdir(directory,{recursive:true});
  const records=[],sources=[];
  const collect=async(id,source,run)=>{
    const file=path.join(directory,`${id}.json.gz`),expected={...identity,source};
    let result=await optional(file);
    if(result){
      assert.equal(tacticalLessonDigest(result.identity),tacticalLessonDigest(expected),'Frozen supply source changed.');
      const {recordHash,...body}=result;assert.equal(recordHash,tacticalLessonDigest(body),'Frozen supply record changed.');
    }
    else{result={identity:expected,...run()};result.recordHash=tacticalLessonDigest(result);await writeTrajectoryArchive(file,result);}
    assert.equal(result.role,source.role);
    if(result.failure)assert.equal(result.samples.length,0);
    for(const sample of result.samples){assertLessonSample(sample,result.role);assert.equal(sample.gameId,result.familyId);
      assert.equal(sample.lessonSource.role,result.role);assert.equal(sample.lessonSource.proof.thresholdsUnchanged,true);}
    records.push(result);sources.push({path:file,sha256:await hash(file)});
    await status('tactical-lesson-supply',{iteration,games:records.length,
      accepted:records.reduce((n,r)=>n+r.samples.length,0),failed:records.filter(r=>r.failure).length,source:id});
  };
  const folders=(await readdir(path.join(runDirectory,'iterations'))).filter(n=>/^\d{6}$/.test(n)&&Number(n)<iteration)
    .sort().reverse().slice(0,protocol.sourceIterations);
  for(const folder of folders){
    const base=path.join(runDirectory,'iterations',folder),planFile=path.join(base,'plan.json.gz');
    const plan=await optional(planFile);
    if(!plan||plan.gameRandomnessContract!=='seeded-engine-game-v1'||!plan.utility)continue;
    const original=await readTrajectoryArchive(plan.sourcePath),paymentModel=deserializeNeuralModel(checkpoint(original));
    try{
      const catalog=new Map([...plan.deckSearch.population,...plan.deckSearch.assignments.flatMap(a=>a.decks||[])].map(d=>[d.id,d]));
      for(const index of selectSourceGameIndexes(plan)){
        const file=path.join(base,'games',`${index}.json.gz`),saved=await optional(file);if(!saved)continue;
        assertAdaptiveGame(saved,plan,index);
        for(const t of saved.trajectories)assert.equal(t.engineFingerprint,engineFingerprint);
        const summary=saved.summaries[0],steps=saved.trajectories.flatMap(t=>t.steps.map(s=>({...s,actorId:t.playerId})))
          .sort((a,b)=>a.actionCount-b.actionCount),role=adaptiveGameRole(plan,index);
        assert.ok(steps.every((s,i)=>s.actionCount===i));
        const firstKind=JSON.parse(steps[0].selectedActionKey).kind;
        assert.ok(['chooseFirstPlayer','confirmFirstPlayer'].includes(firstKind));
        const pair=summary.deckIds.map(id=>catalog.get(id));assert.ok(pair.every(Boolean));
        const source={kind:'ordinary-selfplay',plan:path.resolve(planFile),planSha256:await hash(planFile),
          game:path.resolve(file),gameSha256:await hash(file),policySha256:await hash(plan.sourcePath),index,role};
        await collect(`replay-${folder}-${index}`,source,()=>collectSupplyPrefix({
          game:createSupplyGame(pair,summary.gameSeed,steps[0].actorId,firstKind==='confirmFirstPlayer'?summary.firstPlayerId:null),model,paymentModel,steps,protocol,responseContext,
          familyId:`adaptive:${plan.iteration}:${index}`,role,deckIds:summary.deckIds,engineFingerprint,origin:source.kind}));
      }
    }finally{disposeNeuralModel(paymentModel);}
  }
  for(const deck of decks)for(const kind of ['opening','growth']){
    if(kind==='growth'&&!deck.main.some(ramp))continue;
    const count=kind==='opening'?protocol.openingGamesPerDeck:protocol.growthGamesPerDeck;
    for(let index=0;index<count;index++){
      // Both seats and every possible variant of this game keep this role.
      // Role is assigned before observing hands, advice or model fit.
      const role=index%2?'validation':'training';let game=null,seed,attempt;
      for(attempt=0;attempt<(kind==='opening'?1:protocol.growthSeedAttempts);attempt++){
        seed=(supplySeed(protocol,iteration,deck.id,kind,index*protocol.growthSeedAttempts+attempt)&0xfffffffe)>>>0;
        seed=(seed+(index%2))>>>0; // A generated seed can never cross its whole-game role.
        game=createSupplyGame([deck,deck],seed,index%2?'p2':'p1');
        if(kind==='opening'||hasGrowthOpening(game))break;
        game=null;
      }
      const familyId=`supply:${iteration}:${deck.id}:${kind}:${index}`;
      const source={kind,deckId:deck.id,index,role,seed,attempt,generatedFromLegalDeal:true};
      await collect(`${kind}-${decks.indexOf(deck)}-${index}`,source,()=>game?collectSupplyPrefix({game,model,protocol,responseContext,
        familyId,role,deckIds:[deck.id,deck.id],engineFingerprint,origin:kind,openingOnly:kind==='opening'})
        :{familyId,role,origin:kind,deckIds:[deck.id,deck.id],failure:'no-eligible-deal',samples:[]});
    }
  }
  const training=records.filter(r=>r.role==='training').flatMap(r=>r.samples),validation=records.filter(r=>r.role==='validation').flatMap(r=>r.samples);
  const counts=items=>({mulligan:items.filter(s=>s.steps[0].mulliganLesson).length,growth:items.filter(s=>s.steps[0].growthLesson).length});
  const report={...identity,sources,training,validation,trainingCounts:counts(training),validationCounts:counts(validation),
    games:records.length,failed:records.filter(r=>r.failure).map(r=>({familyId:r.familyId,reason:r.failure})),
    diagnostics:records.map(({familyId,role,origin,diagnostics,failure})=>({familyId,role,origin,diagnostics,failure})),
    policyOnly:true,terminalLabels:false,thresholdsUnchanged:true,promotionEligible:false};
  report.samplesHash=tacticalLessonDigest([training,validation]);
  await writeTrajectoryArchive(path.join(refreshDirectory,'lesson-supply.json.gz'),report);return report;
}
