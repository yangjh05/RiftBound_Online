import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {cards,decklists} from '../src/cards.mjs';
import {profileDeck,inferOpponentDeckBelief} from '../src/ai/belief.mjs';
import {observeGame} from '../src/ai/observation.mjs';
import {isInherentReaction} from '../src/rules/keywords.mjs';
import {isActionResponse} from '../src/ai/resource-strategy.mjs';
import {activeActorId,actionKey,applyAiAction,cloneGame,enumerateAiPolicyActions} from '../src/ai/actions.mjs';
import {hiddenCardIsControlledBy} from '../src/rules/zones.mjs';
import {choosePaymentPlan} from '../src/ai/payment-planner.mjs';
import {needsPaymentOptionDecision} from '../src/ai/payment-options.mjs';
import {publicTacticalValue} from '../src/ai/tactical-baseline.mjs';
import {turnCandidatePriority} from '../src/ai/turn-planner.mjs';
import {actionHasDeferredDevelopment} from '../src/ai/opening-development.mjs';
import {conservativeGrowthProjection,createGrowthHorizonEvaluator} from '../src/ai/growth-development.mjs';
import {previewPublicContinuation} from '../src/ai/public-continuation.mjs';

export const RESPONSE_POLICY_CONTRACT='prospective-public-response-learning-v1';
export const responsePolicyDigest=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
const byNumber=new Map(Object.values(cards).map(c=>[c.cardNumber,c]));
const choices=new Set(['combatDamage','modifyMight','giveKeyword','dealDamageUnit','damageUnit','killUnit','buffUnit',
  'heal','readyUnit','declareOptionalTrigger','triggerOrder','spendBuffDraw','stunEnemyHere','stunUnit','draw','drawCards',
  'readyRune','readyUnitAny','discard','discardCard','discardCards','deathReplacementSource','declareMoveDestination']);

// A common, committed hypothesis catalogue. Never select a profile using the
// opponent's private deckId, hand, deck order or the actual matchup assignment.
export function responseProfileCatalog(decks){
  // The caller supplies the whole legal training catalogue, not the actual
  // opponent list. Do not reintroduce older, out-of-pool starter cards.
  const profiles=(decks?.length?decks:Object.values(decklists)).map(profileDeck);
  const unique=new Map();
  for(const p of profiles){
    const key=JSON.stringify([p.legendCardNumber,Object.entries(p.cardCounts).sort()]);
    unique.set(key,p);
  }
  return [...unique.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export async function readResponsePolicy(root){
  let p;try{p=JSON.parse((await readFile(path.join(root,'response-policy-learning-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  assert.equal(p.contract,RESPONSE_POLICY_CONTRACT);assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.equal(p.maximumReviewsPerGame,8);assert.equal(p.maximumCandidates,4);assert.equal(p.maximumResponses,3);
  assert.equal(p.maximumStates,192);assert.ok(p.profiles?.length);
  assert.equal(p.catalogHash,responsePolicyDigest(p.profiles));return p;
}
export function commitResponsePolicy(state,p){
  const hash=p?responsePolicyDigest(p):null;
  if(state.responsePolicyLearningHash)assert.equal(hash,state.responsePolicyLearningHash,'Response policy changed or removed.');
  else if(p){assert.ok(p.afterIteration>=state.iteration);state.responsePolicyLearningHash=hash;}
}
export function publicResponseBelief(game,actorId,context){
  assert.ok(context?.profiles?.length,'Public response catalogue required.');
  const observation=observeGame(game,actorId);
  const model={deckProfiles:Object.fromEntries(context.profiles.map((p,i)=>[`${i}:${p.id}`,p]))};
  const belief=inferOpponentDeckBelief(game,actorId,model);
  const observed=Object.entries(belief.observedCards||{});
  const consistent=belief.posterior.filter(({profile})=>observed.every(([n,k])=>(profile.cardCounts[n]||0)>=k));
  const unsupported=observed.filter(([n,k])=>!belief.posterior.some(({profile})=>(profile.cardCounts[n]||0)>=k));
  const candidates=belief.cardProbabilities.map(item=>({ ...item,card:byNumber.get(item.cardNumber)}))
    .filter(item=>item.probability>0&&item.card&&(isInherentReaction(item.card)||isActionResponse(item.card)))
    .sort((a,b)=>b.probability-a.probability||a.cardNumber.localeCompare(b.cardNumber));
  return {candidates,handCount:observation.opponent.handCount,handVisible:observation.opponent.handVisible,
    posterior:belief.posterior.map(({deckId,probability})=>({deckId,probability})),
    // A single surviving catalogue entry is not evidence of certainty about
    // the real list. Unlisted cards are unknown, not proven absent.
    scope:'conditional-on-public-catalogue',catalogComplete:false,
    consistentProfiles:consistent.length,unsupportedObservedCards:unsupported.map(([n])=>n),
    confidence:unsupported.length||!consistent.length?'low':consistent.length===1?'catalogue-conditional':belief.confidence};
}

function publicHypothesis(source,actorId,responseCard){
  const game=cloneGame(source),observation=observeGame(source,actorId);
  const unknown=id=>({instanceId:id,type:'unknown',effects:[],keywords:[]});
  for(const p of game.players){
    p.mainDeck=(p.mainDeck||[]).map((_,i)=>unknown(`unknown-deck-${p.id}-${i}`));
    if(p.id!==actorId&&!observation.opponent.handVisible)p.hand=p.hand.map((_,i)=>unknown(`unknown-hand-${p.id}-${i}`));
  }
  for(const f of game.battlefields)f.hidden=(f.hidden||[]).map((h,i)=>hiddenCardIsControlledBy(h,actorId)
    ?h:{...h,card:unknown(`unknown-hidden-${f.instanceId}-${i}`)});
  const opponent=game.players.find(p=>p.id!==actorId);
  let responseId=null;
  if(responseCard){
    if(!opponent.hand.length)return null;
    if(observation.opponent.handVisible){
      responseId=opponent.hand.find(c=>c.cardNumber===responseCard.cardNumber)?.instanceId;
      if(!responseId)return null;
    }else{
      responseId='public-response-hypothesis';
      opponent.hand[0]={...structuredClone(responseCard),instanceId:responseId,ownerId:opponent.id,controllerId:opponent.id,
        zone:'hand',exhausted:false};
    }
  }
  return {game,opponentId:opponent.id,responseId};
}

// One opponent response and one own counter-response, including actual costs,
// legal target choices and passing. The engine checks timing AFTER first.
export function previewResponseExchange(source,actorId,first,responseCard=null,{maximumStates=192,allowCounter=true,evaluateLeaf=null}={}){
  const prepared=publicHypothesis(source,actorId,responseCard);if(!prepared)return null;
  const {game:initial,opponentId,responseId}=prepared;
  const apply=(game,action,id)=>applyAiAction(game,action,id,{skipCombatPlan:true})?.ok;
  if(!apply(initial,first,actorId))return null;
  let visited=0,unresolvedReason=null,available=false,availableWindow=null,countersConsidered=0;
  const fail=reason=>{unresolvedReason=reason;return null;};
  function search(game,depth=0,responded=false,replied=false,trace=[]){
    if(++visited>maximumStates||depth>48)return fail('search-budget');
    if(game.phase==='complete')return {score:publicTacticalValue(game,actorId),trace};
    const id=activeActorId(game);let actions,kind=null;
    if(game.pendingPayment&&!needsPaymentOptionDecision(game)){
      const plan=choosePaymentPlan(game)?.actions;
      if(!plan?.length||!plan.every(a=>apply(game,a,activeActorId(game))))return fail('payment');
      return search(game,depth+1,responded,replied,trace);
    }
    if(game.pendingChoice){
      const choice=game.pendingChoice;
      if(!(choices.has(choice.effect)||/^declare(?:Play|HiddenPlay|Activated).*Target$/u.test(choice.effect)))return fail(`choice:${choice.effect}`);
      actions=enumerateAiPolicyActions(game,id,{skipReadyEntryOrdering:true});
      if(choice.effect==='triggerOrder'){
        const confirm=actions.find(a=>a.optionId==='confirm-trigger-order');
        actions=confirm?[confirm]:actions.filter(a=>!choice.options.find(o=>o.id===a.optionId)?.selected);
      }
    }else if(game.pendingPayment){
      actions=enumerateAiPolicyActions(game,id).filter(a=>a.kind==='choosePaymentOptions');
    }else if(game.showdown||game.actionChain){
      actions=[{kind:'passShowdown'}];
      if(id===opponentId&&!responded){
        const legal=enumerateAiPolicyActions(game,id,{skipReadyEntryOrdering:true});
        const responses=legal.filter(a=>(a.kind==='beginPlayCard'&&a.cardId===responseId)||a.kind==='activateCard');
        if(responses.some(a=>a.cardId===responseId)){available=true;availableWindow=game.showdown?.chain?.length===0?'open-combat':'reaction-chain';}
        actions.push(...responses);kind='opponent';
      }else if(id===actorId&&responded&&!replied&&allowCounter){
        const legal=enumerateAiPolicyActions(game,id,{skipReadyEntryOrdering:true});
        const replies=legal.filter(a=>['beginPlayCard','activateCard'].includes(a.kind))
          .sort((a,b)=>turnCandidatePriority(game,id,b)-turnCandidatePriority(game,id,a)).slice(0,2);
        actions.push(...replies);countersConsidered+=replies.length;kind='self';
      }
    }else if(game.stagedEvents?.length||game.combat||game.phase!=='action')return fail(`phase:${game.phase}`);
    else {
      const score=evaluateLeaf?evaluateLeaf(game):publicTacticalValue(game,actorId);
      return Number.isFinite(score)?{score,trace}:fail('future-horizon');
    }
    if(!actions?.length||actions.length>8)return fail(`branch-count:${actions?.length}`);
    let best=null;
    for(const action of actions){
      const branch=cloneGame(game);if(!apply(branch,action,id))return fail(`action:${action.kind}`);
      const spend=action.kind!=='passShowdown';
      const result=search(branch,depth+1,responded||(kind==='opponent'&&spend),replied||(kind==='self'&&spend),
        kind&&spend?[...trace,{playerId:id,action}]:trace);
      if(!result)return null;
      if(!best||(id===actorId?result.score>best.score:result.score<best.score))best=result;
    }
    return best;
  }
  const result=search(initial);
  return {searchComplete:Boolean(result),score:result?.score??null,visited,unresolvedReason,available,availableWindow,countersConsidered,
    opponentUsesCard:Boolean(result?.trace.some(t=>t.playerId===opponentId&&t.action.cardId===responseId)),
    opponentUsesAbility:Boolean(result?.trace.some(t=>t.playerId===opponentId&&t.action.kind==='activateCard')),
    ownCounterUsed:Boolean(result?.trace.some(t=>t.playerId===actorId)),
    assumptions:['catalogue-conditional-hand','one-opponent-response','up-to-two-own-counter-candidates',
      evaluateLeaf?'conditional-next-own-turn-horizon':'bounded-current-exchange'],
    winProbabilityLabel:false};
}

export function recommendPublicResponseAction(game,actorId,decision,fallback,context){
  if(!context||!['action','showdown'].includes(game.phase)||decision.legalCount<2||game.pendingPayment)return null;
  const belief=publicResponseBelief(game,actorId,context);
  const responses=belief.candidates.slice(0,context.maximumResponses);
  const hold=decision.legalActions.find(a=>['passShowdown','endTurn','declineEffectChoice'].includes(a.kind));
  const ranked=decision.legalActions.map((action,i)=>({action,p:decision.probabilities?.[i]||0})).sort((a,b)=>b.p-a.p);
  const growth=Boolean(fallback?.growthLesson);
  const candidates=growth?fallback.review?.comparisons?.map(c=>c.action):
    [decision.action,fallback?.action,hold,...ranked.map(a=>a.action)];
  const actions=[...new Map((candidates||[]).filter(a=>a&&decision.legalActions.some(b=>actionKey(a)===actionKey(b)))
    .map(a=>[actionKey(a),a])).values()].slice(0,context.maximumCandidates);
  if(actions.length<2)return null;
  const source=growth?conservativeGrowthProjection(game):game;
  if(!source)return null;
  let horizonPreviews=0;
  const horizon=growth?createGrowthHorizonEvaluator(game,actorId,(g,id,action,options)=>{
    if(++horizonPreviews>48)return null;
    return previewPublicContinuation(g,id,action,{maximumStates:48,pauseAtOpponentDeckChoice:true,...options});
  }):null;
  const exchangeOptions=horizon?{...context,evaluateLeaf:g=>horizon(g)?.score}:context;
  const comparisons=[];let meaningful=false;
  for(const action of actions){
    const base=previewResponseExchange(source,actorId,action,null,exchangeOptions);
    if(!base?.searchComplete)return null;
    meaningful ||= base.opponentUsesAbility;
    const outcomes=[];
    for(const response of responses){
      const result=previewResponseExchange(source,actorId,action,response.card,exchangeOptions);
      if(!result?.searchComplete)return null;
      meaningful ||= result.available;
      outcomes.push({cardNumber:response.cardNumber,handProbability:response.probability,
        playableAfterAction:result.available,opponentChoosesUse:result.opponentUsesCard,
        ownCounterUsed:result.ownCounterUsed,window:result.availableWindow,score:result.score});
    }
    // Marginals overlap. Keep this explicitly approximate; no calibrated win
    // claim, no multiplying a guessed use probability into a measured one.
    const active=outcomes.filter(o=>o.playableAfterAction),mass=active.reduce((n,o)=>n+o.handProbability,0);
    const any=1-active.reduce((n,o)=>n*(1-o.handProbability),1);
    const score=mass?(1-any)*base.score+any*active.reduce((n,o)=>n+o.handProbability/mass*Math.min(base.score,o.score),0):base.score;
    comparisons.push({action,noHandResponseScore:base.score,publicAbilityUsed:base.opponentUsesAbility,score,responses:outcomes});
  }
  if(!meaningful)return null;
  comparisons.sort((a,b)=>b.score-a.score||actionKey(a.action).localeCompare(actionKey(b.action)));
  const best=comparisons[0],worst=comparisons.at(-1);
  if(best.score-worst.score<0.25)return null;
  if(!growth&&best.action.kind==='endTurn'&&actionHasDeferredDevelopment(game,actorId,decision.action))return null;
  const confidenceWeight=belief.confidence==='low'?0.5:1;
  return {action:best.action,continuation:[best.action],weight:confidenceWeight*Math.min(0.5,0.15+(best.score-worst.score)/16),
    opponentResponsesCompared:true,responsePolicyLesson:true,correctionEligible:false,winProbabilityLabel:false,
    ...(growth?{growthLesson:true,developmentHorizon:'next-own-turn-known-deployment'}:{}),
    responseReview:{contract:context.contract,catalogHash:context.catalogHash,comparisons,
      belief:{scope:belief.scope,confidence:belief.confidence,consistentProfiles:belief.consistentProfiles,
        unsupportedObservedCards:belief.unsupportedObservedCards,catalogComplete:false},
      probabilityModel:'approximate-hand-marginals-with-opponent-choice',
      searchScope:growth?'post-action-response-and-next-own-turn':'post-action-exchange-and-counter',
      ...(growth?{horizonPreviews,assumptions:['passive-opponent-resource-projection','unknown-future-main-deck-draws','no-assumed-new-colored-runes']}:{}),
      candidateCoverage:actions.length/decision.legalCount,responseCoverage:responses.length/Math.max(1,belief.candidates.length)}};
}
