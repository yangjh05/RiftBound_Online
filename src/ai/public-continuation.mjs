import {activeActorId,applyAiAction,cloneGame,enumerateAiPolicyActions} from './actions.mjs';
import {needsPaymentOptionDecision} from './payment-options.mjs';
import {choosePaymentPlan} from './payment-planner.mjs';
import {hiddenCardIsControlledBy} from '../rules/zones.mjs';
import {publicTacticalValue} from './tactical-baseline.mjs';

const OWN_CHOICES=new Set(['combatDamage','modifyMight','giveKeyword','dealDamageUnit','damageUnit',
  'killUnit','buffUnit','heal','readyUnit','readyUnitAny','declareOptionalTrigger','triggerOrder',
  'spendBuffDraw','stunEnemyHere','stunUnit','draw','drawCards','readyRune','discard','discardCard',
  'discardCards','discardEnergyDamage','deathReplacementSource','declareMoveDestination','moveFriendlyUnitsToBase','returnUnitToBase']);

// A paused beginning-phase choice is comparable only when both its public
// options AND its remaining continuation agree. Ignore the generated UI id.
export function publicContinuationBoundary(game,actorId){
  const c=game.pendingChoice;
  if(!c||c.playerId===actorId||!['recycleTopDeck','recycleTrashCards'].includes(c.effect))return null;
  const card=c.card&&{instanceId:c.card.instanceId,cardNumber:c.card.cardNumber,zoneChangeCounter:c.card.zoneChangeCounter};
  return JSON.stringify({choice:{...c,id:undefined,card},chain:game.actionChain,
    staged:game.stagedEvents,combat:game.combat,showdown:game.showdown});
}

// Explicit review/teaching path. The historical action-filter preview remains
// unchanged, so saved on-policy actions, encodings and probabilities stay valid.
export function previewPublicContinuation(source,actorId,first,{maximumStates=96,returnGame=false,
  returnOutcomes=false,finishTurn=false,pauseAtOpponentDeckChoice=false,firstActorId=actorId}={}){
  const initial=cloneGame(source),unknown=id=>({instanceId:id,type:'unknown',effects:[],keywords:[]});
  for(const p of initial.players){
    p.mainDeck=p.mainDeck.map((_,i)=>unknown(`unseen-deck-${p.id}-${i}`));
    if(p.id!==actorId)p.hand=p.hand.map((_,i)=>unknown(`unseen-hand-${p.id}-${i}`));
  }
  for(const f of initial.battlefields)f.hidden=(f.hidden||[]).map((h,i)=>hiddenCardIsControlledBy(h,actorId)
    ?h:{...h,card:unknown(`unseen-hidden-${f.instanceId}-${i}`)});
  let visited=0,unresolved=0,opponentChoicesCompared=0;
  const apply=(g,a,id)=>applyAiAction(g,a,id,{skipCombatPlan:true}).ok;
  if(!apply(initial,first,firstActorId))return null;
  const fail=()=>{unresolved++;return [];};
  const leaf=(game,steps,extra={})=>[{score:publicTacticalValue(game,actorId),steps,...extra,...(returnGame?{game}:{})}];
  function solve(game,steps,depth,ended){
    if(++visited>maximumStates||depth>48)return fail();
    if(game.phase==='complete')return leaf(game,steps);
    if(game.pendingPayment){
      if(game.pendingPayment.playerId!==actorId)return fail();
      if(!needsPaymentOptionDecision(game)){
        const plan=choosePaymentPlan(game)?.actions;
        if(!plan?.length||!plan.every(a=>apply(game,a,activeActorId(game))))return fail();
        return solve(game,steps,depth+1,ended);
      }
      return branch(game,steps,depth,ended,actorId,enumerateAiPolicyActions(game,actorId).filter(a=>a.kind==='choosePaymentOptions'));
    }
    if(game.pendingChoice){
      const c=game.pendingChoice;
      const boundary=pauseAtOpponentDeckChoice&&publicContinuationBoundary(game,actorId);
      if(boundary)return leaf(game,steps,{opponentChoiceBoundary:boundary});
      let actions=enumerateAiPolicyActions(game,c.playerId,{skipReadyEntryOrdering:true,skipTemporaryPurpose:true});
      if(c.effect==='triggerOrder'){
        const confirm=actions.find(a=>a.optionId==='confirm-trigger-order');
        actions=confirm?[confirm]:actions.filter(a=>!c.options.find(o=>o.id===a.optionId)?.selected);
      }
      if(c.effect==='readyRune'){
        const seen=new Set(),p=game.players.find(p=>p.id===c.playerId);
        actions=actions.filter(a=>{const r=p.runes.find(r=>r.instanceId===a.optionId);if(!r||!interchangeableBasicRune(r))return true;
          const k=JSON.stringify([r.domain,r.exhausted,r.cardNumber]);if(seen.has(k))return false;seen.add(k);return true;});
      }
      const publicOpponentChoice=c.playerId!==actorId&&['combatDamage','deathReplacementSource'].includes(c.effect);
      if((c.playerId!==actorId&&!publicOpponentChoice)||!(OWN_CHOICES.has(c.effect)||/^declare(?:Play|HiddenPlay|Activated).*Target$/u.test(c.effect)))
        actions=actions.filter(a=>c.effect==='declareOptionalTrigger'&&a.optionId==='decline-optional-trigger');
      return branch(game,steps,depth,ended,c.playerId,actions);
    }
    if(game.showdown||game.actionChain){
      // Voluntary spell responses are handled by the separate public belief
      // search. This preview only assumes passes at voluntary windows.
      const id=activeActorId(game),a={kind:'passShowdown'};
      if(!apply(game,a,id))return fail();
      return solve(game,id===actorId?[...steps,a]:steps,depth+1,ended);
    }
    if(game.stagedEvents?.length||game.combat||game.phase!=='action')return fail();
    if(finishTurn&&!ended&&activeActorId(game)===actorId){
      const a={kind:'endTurn'};if(!apply(game,a,actorId))return fail();
      return solve(game,[...steps,a],depth+1,true);
    }
    return leaf(game,steps);
  }
  function branch(game,steps,depth,ended,id,actions){
    if(!actions.length||actions.length>8)return fail();
    actions.sort((a,b)=>Number(b.optionId==='decline-optional-trigger')-Number(a.optionId==='decline-optional-trigger'));
    const results=[];let missing=false;
    for(const a of actions){
      const g=cloneGame(game),before=unresolved;
      if(!apply(g,a,id)){fail();missing=true;continue;}
      const options=solve(g,id===actorId?[...steps,a]:steps,depth+1,ended);
      if(!options.length||unresolved!==before)missing=true;
      results.push(options);
    }
    if(id===actorId)return results.flat();
    opponentChoicesCompared++;
    // Each opposing public choice includes the actor's best subsequent
    // choice. Never silently drop an unsearched opposing branch.
    if(missing)return [];
    return results.map(xs=>xs.sort((a,b)=>b.score-a.score)[0]).sort((a,b)=>a.score-b.score).slice(0,1);
  }
  const outcomes=solve(initial,[first],0,first.kind==='endTurn');
  const best=[...outcomes].sort((a,b)=>b.score-a.score)[0];
  return best?{...best,visited,unresolvedBranches:unresolved,searchComplete:unresolved===0,opponentChoicesCompared,
    ...(returnOutcomes?{outcomes}: {})}:null;
}

function interchangeableBasicRune(rune){
  if(rune.keywords?.length)return false;
  if(!rune.effects?.length)return true;
  return rune.tags?.includes('Basic Rune') && rune.effects.every(e=>e.timing==='activated'
    && ['addEnergy','addPower'].includes(e.kind) && e.amount===1
    && (e.kind==='addEnergy'?e.exhaust===true:e.recycleSelfCost===true));
}
