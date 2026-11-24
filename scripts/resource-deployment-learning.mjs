import {activeActorId,actionKey,enumerateAiPolicyActions} from '../src/ai/actions.mjs';
import {previewPublicContinuation} from '../src/ai/public-continuation.mjs';
import {conservativeGrowthProjection} from '../src/ai/growth-development.mjs';
import {currentMight} from '../src/engine.mjs';

export const RESOURCE_DEPLOYMENT_TEACHER='public-resource-deployment-timing-v1';
const player=(g,id)=>g.players.find(p=>p.id===id);
const main=(g,id)=>g?.phase==='action'&&activeActorId(g)===id&&!g.pendingPayment&&!g.pendingChoice
  &&!g.actionChain&&!g.showdown&&!g.combat&&!g.stagedEvents?.length;
const power=c=>(c?.power||[]).reduce((n,r)=>n+Number(r.amount||0),0);

// Match effect semantics, never a card/legend name. Restricted, destructive,
// conditional or multi-purpose producers require a different analysis.
export function isReusablePowerGear(c){
  return c?.type==='gear'&&c.energy===0&&power(c)>0&&c.effects?.length===1
    &&c.effects.every(e=>e.timing==='activated'&&e.kind==='addPower'&&e.amount===1&&e.exhaust
      &&e.nonReactive&&(e.abilityKeywords||[]).includes('Reaction')&&!e.restriction
      &&Object.keys(e).every(k=>['timing','kind','amount','domain','exhaust','nonReactive','abilityKeywords','restriction'].includes(k)));
}
export function resourceDeploymentDecision(game,actorId,action){
  if(action?.kind!=='beginPlayCard'||!main(game,actorId))return false;
  const hand=player(game,actorId).hand,c=hand.find(c=>c.instanceId===action.cardId);
  return isReusablePowerGear(c)||power(c)>0&&hand.some(isReusablePowerGear);
}

// Training-only counterfactuals. No action filter, inference override, future
// draw identity, or outcome label. The opponent's voluntary responses are not
// predicted; the proof concerns these explicitly conditional engine lines.
export function recommendResourceDeployment(game,actorId,decision,{maximumPreviews=32,preview=previewPublicContinuation}={}){
  if(!resourceDeploymentDecision(game,actorId,decision.action))return null;
  const legal=decision.legalActions||enumerateAiPolicyActions(game,actorId),original=legal.find(a=>actionKey(a)===actionKey(decision.action));
  if(!original)return null;
  const actor=player(game,actorId),card=actor.hand.find(c=>c.instanceId===original.cardId);
  if(actor.runes.some(r=>r.keywords?.length||r.effects?.some(e=>e.timing!=='activated'
    ||!['addEnergy','addPower'].includes(e.kind)||e.amount!==1||e.restriction||e.requiresLegion)))return null;
  let previews=0;
  const step=(g,a,id=actorId)=>{
    if(++previews>maximumPreviews)return null;
    const r=preview(g,actorId,a,{returnGame:true,maximumStates:48,firstActorId:id});
    return r?.searchComplete&&main(r.game,actorId)?r.game:null;
  };
  const line=(g,actions)=>{for(const a of actions){g=step(g,a);if(!g)return null;}return g;};
  const recommend=(action,reason,before,after,lines,extra={})=>{
    const gain=resourceGain(after,before,actorId);
    if(!(gain>0)||boardSignature(before,actorId)!==boardSignature(after,actorId))return null;
    const review={applied:true,reason,contract:RESOURCE_DEPLOYMENT_TEACHER,searchComplete:true,partialSearch:false,
      resourceDeploymentProof:{sameNonResourcePosition:true,resourceDominance:true,scope:extra.scope||'same-turn-pair',
        baseline:resourceSnapshot(before,actorId),alternative:resourceSnapshot(after,actorId),lines,...extra},
      comparisons:[{action:original,score:0},{action,score:gain}],previews,
      assumptions:['opponent-passes-voluntary-response-windows','standard-engine-payment-planner','no-known-future-draws'],
      globalOptimalityClaim:false};
    return {action,continuation:[action],weight:.5,comparison:reason,localResourceLesson:true,resourceDeploymentLesson:true,
      review,correctionEligible:false,winProbabilityLabel:false,opponentResponsesCompared:false};
  };
  // Pay energy before recycling a ready rune; or install a reusable source
  // before spending power. Compare BOTH complete engine executions, including
  // Legion and public triggers, and accept only equal non-resource positions.
  const others=legal.filter(a=>a.kind==='beginPlayCard'&&a.cardId!==original.cardId&&a.destination==='base'
    &&actor.hand.some(c=>c.instanceId===a.cardId&&(isReusablePowerGear(card)?c.type==='unit':isReusablePowerGear(c))));
  for(const other of others.slice(0,4)){
    const before=line(game,[original,other]),after=line(game,[other,original]);
    if(!before||!after)continue;
    const advice=recommend(other,'verified-resource-deployment-order',before,after,[[original,other],[other,original]]);
    if(advice)return advice;
  }
  if(!isReusablePowerGear(card))return null;
  const hold=legal.find(a=>a.kind==='endTurn');
  // Delaying installation across a turn must not disable a known power use,
  // an off-turn response, a Legion payoff, or current unit/movement development.
  if(!hold||legal.some(a=>['moveUnit','moveUnits','beginPlayChampion'].includes(a.kind)
    ||a.kind==='beginPlayCard'&&a.cardId!==original.cardId))return null;
  const ownCards=[actor.legend,actor.champion,...actor.hand,...actor.base,
    ...game.battlefields.flatMap(f=>f.units.filter(c=>c.controllerId===actorId))].filter(Boolean);
  if(ownCards.some(c=>c.instanceId!==card.instanceId&&(power(c)>0||(c.effects||[]).some(e=>
    e.requiresLegion||e.powerCost?.length||e.costPower?.length||e.optionalPowerCost?.length))))return null;
  const projected=conservativeGrowthProjection(game);if(!projected)return null;
  const opponent=game.players.find(p=>p.id!==actorId).id;
  const nextOwn=g=>{
    if(++previews>maximumPreviews)return null;
    const end=preview(g,actorId,hold,{returnGame:true,maximumStates:48});
    if(!end?.searchComplete||!main(end.game,opponent))return null;
    if(++previews>maximumPreviews)return null;
    const next=preview(end.game,actorId,hold,{returnGame:true,maximumStates:48,firstActorId:opponent});
    return next?.searchComplete&&main(next.game,actorId)?next.game:null;
  };
  const installed=step(projected,original);
  // A second source paid with existing generated power did not consume a rune.
  if(!installed||player(installed,actorId).runes.length>=actor.runes.length)return null;
  const early=nextOwn(installed),late=nextOwn(projected);if(!early||!late)return null;
  // Both forecasts deploy the SAME originally known energy-only unit and end
  // with the SAME installed source. Only the timing of the rune recycle differs.
  const known=new Set(actor.hand.filter(c=>c.type==='unit'&&power(c)===0).map(c=>c.instanceId));
  for(const a of enumerateAiPolicyActions(late,actorId).filter(a=>a.kind==='beginPlayCard'&&a.destination==='base'&&known.has(a.cardId)).slice(0,3)){
    const before=line(early,[a]),after=line(late,[a,original]);
    if(!before||!after)continue;
    const advice=recommend(hold,'verified-idle-power-source-delay',before,after,
      [[original,hold,{...hold,actorId:opponent},a],[hold,{...hold,actorId:opponent},a,original]],
      {scope:'next-own-turn-known-energy-deployment',noKnownPowerDemand:true,unknownBasicRuneDomains:true});
    if(advice)return advice;
  }
  return null;
}

function resourceSnapshot(game,id){
  const p=player(game,id),counts=items=>items.reduce((r,k)=>(r[k]=(r[k]||0)+1,r),{});
  return {runes:counts(p.runes.map(r=>r.domain)),readyRunes:counts(p.runes.filter(r=>!r.exhausted).map(r=>r.domain)),energy:p.runes.filter(r=>!r.exhausted).length+(p.runePool?.energy||[]).filter(r=>!r.restriction).length,
    power:counts([...(p.runePool?.power||[]).filter(r=>!r.restriction).map(r=>r.domain),
      ...p.base.filter(c=>isReusablePowerGear(c)&&!c.exhausted).map(c=>c.effects[0].domain)])};
}
function resourceGain(better,worse,id){
  const a=resourceSnapshot(better,id),b=resourceSnapshot(worse,id);
  if(Object.keys(b.runes).some(d=>(a.runes[d]||0)<b.runes[d]))return 0;
  let energy=a.energy;
  // A surplus durable rune can supply the power of a source that the other
  // order left ready. Charge its ready energy too, never count it twice.
  const extra=Object.fromEntries(Object.keys(a.runes).map(d=>[d,a.runes[d]-(b.runes[d]||0)]));
  for(const [domain,count] of Object.entries(b.power)){
    const missing=Math.max(0,count-(a.power[domain]||0));
    if((extra[domain]||0)<missing)return 0;
    const exhaustedSurplus=Math.max(0,(a.runes[domain]||0)-(a.readyRunes[domain]||0)
      -((b.runes[domain]||0)-(b.readyRunes[domain]||0)));
    energy-=Math.max(0,missing-exhaustedSurplus);extra[domain]-=missing;
  }
  if(energy<b.energy)return 0;
  return energy-b.energy+Object.keys(a.runes).reduce((n,d)=>n+a.runes[d]-(b.runes[d]||0),0);
}
function boardSignature(g,actorId){
  const card=c=>c&&{id:c.instanceId,number:c.cardNumber,type:c.type,owner:c.ownerId,controller:c.controllerId,
    exhausted:c.controllerId===actorId&&isReusablePowerGear(c)?undefined:c.exhausted,damage:c.damage,buffs:c.buffs,might:c.type==='unit'?currentMight(g,c):null,
    modifier:c.mightModifier,stunned:c.stunned,keywords:c.keywords,temporaryKeywords:c.temporaryKeywords,
    appendedKeywords:c.appendedKeywords,appendedEffects:c.appendedEffects,effects:c.effects,attachments:c.attachments?.map(card)};
  const sorted=cs=>cs.map(card).sort((a,b)=>a.id.localeCompare(b.id));
  return JSON.stringify({phase:g.phase,turn:g.turnSequence,actor:activeActorId(g),winner:g.winnerId,
    players:g.players.map(p=>({id:p.id,score:p.score,xp:p.xp,legend:card(p.legend),champion:card(p.champion),championPlayed:p.championPlayed,
      hand:sorted(p.hand),base:sorted(p.base),trash:sorted(p.trash),banished:sorted(p.banished),deck:p.mainDeck.length,
      drawn:p.drawCountThisTurn,scored:p.turnScoredBattlefields,readyEffect:p.unitsEnterReadyThisTurn,
      // The next-turn projection deliberately has one fewer previously played
      // gear this turn. Reject any known Legion demand before using that scope.
      opponentRunes:p.id!==actorId?p.runes.map(card):undefined,
      opponentResources:p.id!==actorId?resourceSnapshot(g,p.id):undefined,
      restrictedPools:['energy','power'].map(k=>(p.runePool?.[k]||[]).filter(r=>r.restriction).map(r=>[r.domain,r.restriction]))})),
    fields:g.battlefields.map(f=>({id:f.instanceId,control:f.controlledBy,units:sorted(f.units),hidden:f.hidden}))});
}

export function approvedResourceDeploymentReview(review,comparison){
  const proof=review?.resourceDeploymentProof,rows=review?.comparisons;
  return review?.contract===RESOURCE_DEPLOYMENT_TEACHER&&review.applied===true&&review.searchComplete===true&&!review.partialSearch
    &&['verified-resource-deployment-order','verified-idle-power-source-delay'].includes(comparison)
    &&proof?.sameNonResourcePosition===true&&proof.resourceDominance===true
    &&(comparison!=='verified-idle-power-source-delay'||proof.noKnownPowerDemand===true)
    &&rows?.length===2&&rows.every(r=>Number.isFinite(r.score))&&rows[1].score>rows[0].score;
}
