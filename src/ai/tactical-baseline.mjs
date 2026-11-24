import {currentMight} from '../engine.mjs';
import {activeActorId,actionKey,applyAiAction,cloneGame,enumerateAiPolicyActions} from './actions.mjs';
import {tacticalActionProfile} from './action-tactics.mjs';
import {hiddenCardIsControlledBy} from '../rules/zones.mjs';
import {choosePaymentPlan} from './payment-planner.mjs';
import {actionUnit} from './ready-entry-order.mjs';
import {needsPaymentOptionDecision} from './payment-options.mjs';
import {scoreRaceContext} from './score-race.mjs';
import {planPublicTurn,turnCandidatePriority} from './turn-planner.mjs';
import {cards} from '../cards.mjs';
import {opponentResponseProfile,reactionReserveProfile} from './resource-strategy.mjs';

const CARD_BY_NUMBER=new Map(Object.values(cards).map(card=>[card.cardNumber,card]));

export const TACTICAL_BASELINE_CONTRACT='public-tactical-policy-initialization-v1';
const CHOICES=new Set(['declarePlayTarget','combatDamage','modifyMight','giveKeyword',
  'dealDamageUnit','damageUnit','killUnit','buffUnit','heal','readyUnit',
  'declareOptionalTrigger','triggerOrder','spendBuffDraw','stunEnemyHere','stunUnit','draw','drawCards',
  'readyRune','readyUnitAny','discard','discardCard','discardCards','deathReplacementSource']);

// These weights define a provisional demonstrator, never win probabilities or
// proof labels. Card expenditure, payment and lost control are charged here.
export function publicTacticalValue(game,actorId){
  if(game.phase==='complete')return game.winnerId===actorId?1000:-1000;
  const race=scoreRaceContext(game,actorId);
  const unitValue=card=>card.type==='unit'
    ? 1+0.65*Math.max(0,Number(card.energy)||0)+0.22*Math.max(0,currentMight(game,card))
      +(card.attachments||[]).reduce((sum,c)=>sum+0.6+0.3*(Number(c.energy)||0),0)
      -(card.exhausted?0.15:0)
    : 0.7+0.4*(Number(card.energy)||0);
  const material=p=>12*(p.score||0)+1.3*(p.hand?.length||0)
    +0.65*(p.runes||[]).length
    +0.45*(p.runes||[]).filter(r=>!r.exhausted).length
    +0.45*(p.runePool?.energy||[]).length
    +(p.base||[]).reduce((sum,c)=>sum+unitValue(c)
      *(p.id===actorId && c.type==='unit' && (c.exhausted||game.currentPlayerId!==actorId)
        ? 1-0.55*race.pressure : 1),0)
    +game.battlefields.flatMap(f=>f.units.filter(c=>c.controllerId===p.id)).reduce((sum,c)=>sum+unitValue(c),0)
    // Hidden cards are committed material that disappears with control.
    // Opponent identities are private: value their count, not their contents.
    +game.battlefields.reduce((sum,f)=>sum+(f.hidden||[]).filter(h=>hiddenCardIsControlledBy(h,p.id)).length*1.3,0)
    +game.battlefields.filter(f=>f.controlledBy===p.id).length*2.5;
  const reserve=reactionReserveProfile(game,actorId);
  return game.players.reduce((sum,p)=>sum+(p.id===actorId?1:-1)*material(p),0)
    +0.6*reserve.reserveValue*reserve.threat
    -(race.exposedFinish?6*race.pressure:0);
}

function publicPreview(source,actorId){
  const game=cloneGame(source);
  const unknown=(id)=>({instanceId:id,type:'unknown',effects:[],keywords:[]});
  for(const p of game.players){
    p.mainDeck=(p.mainDeck||[]).map((_,i)=>unknown(`unseen-deck-${p.id}-${i}`));
    if(p.id!==actorId)p.hand=(p.hand||[]).map((_,i)=>unknown(`unseen-hand-${p.id}-${i}`));
  }
  for(const f of game.battlefields)f.hidden=(f.hidden||[]).map((h,i)=>hiddenCardIsControlledBy(h,actorId)
    ? h:{...h,card:unknown(`unseen-hidden-${f.instanceId}-${i}`)});
  return game;
}

export function previewTacticalAction(source,actorId,first,{maximumStates=40,followupMoves=false,followupPlays=false,
  finishTurn=false,returnGame=false,returnOutcomes=false,skipReadyEntryOrdering=false,skipTemporaryPurpose=false,
  pauseAtOpponentDeckChoice=false}={}){
  const initial=publicPreview(source,actorId);
  if(!applyAiAction(initial,first,actorId)?.ok)return null;
  const queue=[{game:initial,steps:[first],depth:0}],outcomes=[];
  let visited=0,unresolvedBranches=0;
  while(queue.length){
    if(++visited>maximumStates){unresolvedBranches+=queue.length;break;}
    const {game,steps,depth,moved=false,played=false,ended=first.kind==='endTurn'}=queue.shift();
    if(depth>48){unresolvedBranches++;continue;}
    if(game.phase==='complete'){outcomes.push({score:publicTacticalValue(game,actorId),steps,...(returnGame?{game}:{})});continue;}
    if(game.pendingPayment){
      if(game.pendingPayment.playerId!==actorId){unresolvedBranches++;continue;}
      if(needsPaymentOptionDecision(game)){
        for(const action of enumerateAiPolicyActions(game,actorId)){
          if(action.kind!=='choosePaymentOptions')continue;
          const branch=cloneGame(game);
          if(applyAiAction(branch,action,actorId)?.ok)
            queue.push({game:branch,steps:[...steps,action],depth:depth+1,moved,played,ended});
        }
        continue;
      }
      const plan=choosePaymentPlan(game)?.actions;
      if(!plan?.length){unresolvedBranches++;continue;}
      if(!plan.every(a=>applyAiAction(game,a,activeActorId(game))?.ok)){unresolvedBranches++;continue;}
      queue.push({game,steps,depth:depth+1,moved,played,ended});continue;
    }
    if(game.pendingChoice){
      const choice=game.pendingChoice;
      // Runtime defense comparisons may end at the same public deck-order
      // boundary. Do not choose or inspect the opponent's private top cards.
      // Callers must compare matching boundaries, not a finished continuation
      // against a stopped one. Training previews keep their original horizon.
      if(pauseAtOpponentDeckChoice && choice.playerId!==actorId && choice.effect==='recycleTopDeck'){
        outcomes.push({score:publicTacticalValue(game,actorId),steps,
          opponentChoiceBoundary:JSON.stringify([choice.playerId,choice.effect,choice.sourceCardId||null,choice.battlefieldId||null]),
          ...(returnGame?{game}:{})});continue;
      }
      let actions=enumerateAiPolicyActions(game,choice.playerId,{skipReadyEntryOrdering,skipTemporaryPurpose});
      if(choice.effect==='triggerOrder'){
        // Only extend a partial permutation. Selecting an already selected
        // trigger toggles it off and creates cycles that consume the budget.
        const confirm=actions.find(a=>a.optionId==='confirm-trigger-order');
        actions=confirm?[confirm]:actions.filter(a=>!choice.options.find(o=>o.id===a.optionId)?.selected);
      }
      // Basic runes with identical public properties are interchangeable for
      // this choice. Keep special runes separate and preserve the real id of
      // each selected representative in the executable continuation.
      if(choice.effect==='readyRune'){
        const seen=new Set(),runes=game.players.find(p=>p.id===choice.playerId)?.runes||[];
        actions=actions.filter(a=>{
          const rune=runes.find(r=>r.instanceId===a.optionId);
          if(!rune || rune.effects?.length || rune.keywords?.length)return true;
          const key=JSON.stringify([rune.domain,rune.exhausted,rune.cardNumber]);
          if(seen.has(key))return false;seen.add(key);return true;
        });
      }
      // An optional trigger can always be declined through the engine's real
      // continuation. Opponent mandatory choices remain unresolved: never
      // choose the opponent's most convenient target for this actor.
      if((choice.playerId!==actorId && !(choice.effect==='combatDamage' && actions.length===1))
        || !(CHOICES.has(choice.effect)||/^declare(?:Play|HiddenPlay|Activated).*Target$/u.test(choice.effect))){
        actions=actions.filter(a=>choice.effect==='declareOptionalTrigger' && a.optionId==='decline-optional-trigger');
      }
      if(!actions.length||actions.length>8){unresolvedBranches++;continue;}
      // Visit the decline branch first so optional bonus effects cannot use
      // the whole bounded budget before the already earned capture is seen.
      actions.sort((a,b)=>Number(b.optionId==='decline-optional-trigger')-Number(a.optionId==='decline-optional-trigger'));
      for(const a of actions){
        const branch=cloneGame(game);
        if(!applyAiAction(branch,a,choice.playerId)?.ok){unresolvedBranches++;continue;}
        queue.push({game:branch,steps:choice.playerId===actorId?[...steps,a]:steps,depth:depth+1,moved,played,ended});
      }
      continue;
    }
    if(game.showdown||game.actionChain){
      const id=activeActorId(game);
      const actions=id===actorId&&game.aiCombatCommitment
        ? enumerateAiPolicyActions(game,id,{skipReadyEntryOrdering}):[{kind:'passShowdown'}];
      if(!actions.length||actions.length>6){unresolvedBranches++;continue;}
      for(const a of actions){
        const branch=actions.length===1?game:cloneGame(game);
        if(!applyAiAction(branch,a,id)?.ok){unresolvedBranches++;continue;}
        queue.push({game:branch,steps:id===actorId?[...steps,a]:steps,depth:depth+1,moved,played,ended});
      }
      continue;
    }
    if(game.stagedEvents?.length||game.combat||game.phase!=='action'){unresolvedBranches++;continue;}
    if(!ended && activeActorId(game)===actorId){
      if(followupPlays&&!played&&!moved){
        const plays=enumerateAiPolicyActions(game,actorId,{skipReadyEntryOrdering})
          .filter(a=>actionUnit(game,actorId,a)).slice(0,6);
        for(const action of plays){
          const branch=cloneGame(game);
          if(applyAiAction(branch,action,actorId)?.ok)queue.push({game:branch,steps:[...steps,action],depth:depth+1,played:true,moved:false,ended:false});
        }
      }
      if(followupMoves&&!moved){
        const moves=enumerateAiPolicyActions(game,actorId,{skipReadyEntryOrdering}).filter(a=>['moveUnit','moveUnits'].includes(a.kind)).slice(0,8);
        for(const action of moves){
          const branch=cloneGame(game);
          if(applyAiAction(branch,action,actorId)?.ok)queue.push({game:branch,steps:[...steps,action],depth:depth+1,moved:true,played,ended:false});
        }
      }
      if(finishTurn){
        const branch=cloneGame(game),action={kind:'endTurn'};
        if(applyAiAction(branch,action,actorId)?.ok)queue.push({game:branch,steps:[...steps,action],depth:depth+1,moved:true,ended:true});
        else unresolvedBranches++;
        continue;
      }
    }
    outcomes.push({score:publicTacticalValue(game,actorId),steps,...(returnGame?{game}:{})});
  }
  const best=outcomes.sort((a,b)=>b.score-a.score)[0];
  return best ? {...best,unresolvedBranches,searchComplete:unresolvedBranches===0,
    ...(returnOutcomes?{outcomes}: {})} : null;
}

// Stress-test one public belief hypothesis through real costs, target choices,
// chains and combat. The opponent chooses its best response/target, including
// passing. This is bounded local search, not an optimal-play or win label.
export function previewTacticalResponse(source,actorId,first,responseCard,{maximumStates=256,returnDiagnostics=false}={}){
  const initial=publicPreview(source,actorId);
  const opponent=initial.players.find(p=>p.id!==actorId);
  if(!opponent?.hand.length||!responseCard)return null;
  const responseId='hypothetical-public-response';
  opponent.hand[0]={...structuredClone(responseCard),instanceId:responseId,ownerId:opponent.id,
    controllerId:opponent.id,zone:'hand',exhausted:false};
  if(!applyAiAction(initial,first,actorId)?.ok)return null;
  let visited=0,unresolvedReason=null;
  const unresolved=reason=>{unresolvedReason=reason;return null;};
  function search(game,depth=0,responseDecided=false){
    if(++visited>maximumStates||depth>48)return unresolved('search-budget');
    if(game.phase==='complete')return {score:publicTacticalValue(game,actorId),game};
    const id=activeActorId(game);
    if(game.pendingPayment&&!needsPaymentOptionDecision(game)){
      const plan=choosePaymentPlan(game)?.actions;
      if(!plan?.length||!plan.every(a=>applyAiAction(game,a,activeActorId(game))?.ok))return unresolved('payment');
      return search(game,depth+1,responseDecided);
    }
    let actions,decidingResponse=false;
    if(game.pendingChoice){
      const choice=game.pendingChoice;
      if(!(CHOICES.has(choice.effect)||/^declare(?:Play|HiddenPlay|Activated).*Target$/u.test(choice.effect)))return unresolved(`choice:${choice.effect}`);
      actions=enumerateAiPolicyActions(game,id,{skipReadyEntryOrdering:true});
      if(choice.effect==='triggerOrder'){
        const confirm=actions.find(a=>a.optionId==='confirm-trigger-order');
        actions=confirm?[confirm]:actions.filter(a=>!choice.options.find(o=>o.id===a.optionId)?.selected);
      }
    }else if(game.pendingPayment){
      actions=enumerateAiPolicyActions(game,id).filter(a=>a.kind==='choosePaymentOptions');
    }else if(game.showdown||game.actionChain){
      actions=[{kind:'passShowdown'}];
      const chain=game.showdown?.chain||game.actionChain?.chain||[];
      if(!responseDecided&&id===opponent.id&&chain.length){
        decidingResponse=true;
        actions.push(...enumerateAiPolicyActions(game,id,{skipReadyEntryOrdering:true})
          .filter(a=>a.kind==='beginPlayCard'&&a.cardId===responseId));
      }
    }else if(game.stagedEvents?.length||game.combat||game.phase!=='action')return unresolved(`phase:${game.phase}`);
    else return {score:publicTacticalValue(game,actorId),game};
    if(!actions?.length||actions.length>8)return unresolved(`branch-count:${actions?.length}`);
    let best=null;
    for(const action of actions){
      const branch=cloneGame(game);
      if(!applyAiAction(branch,action,id)?.ok)return unresolved(`action:${action.kind}`);
      const result=search(branch,depth+1,responseDecided||decidingResponse);
      // An unresolved adversarial branch cannot silently become a pass.
      if(!result)return null;
      if(!best||(id===actorId?result.score>best.score:result.score<best.score))best=result;
    }
    return best;
  }
  const result=search(initial);
  return result?{...result,visited,searchComplete:true,opponentResponsesCompared:true,
    assumptions:['one-hypothesized-reaction','other-voluntary-actions-pass','current-combat-only'],
    correctionEligible:false,winProbabilityLabel:false}:returnDiagnostics?{visited,searchComplete:false,unresolvedReason}:null;
}

export function reviewPublicTargetResponses(game,actorId,actions,{maximumResponses=3}={}){
  if(!game.showdown||!game.pendingChoice||actions.length<2||actions.length>8)return null;
  if(!actions.every(a=>a.kind==='chooseEffectOption'&&tacticalActionProfile(game,actorId,a).targetContext))return null;
  const belief=opponentResponseProfile(game,actorId,{}, {includeCandidates:true});
  const possible=belief.responses.filter(r=>r.probability>0);
  if(!possible.length)return null;
  const candidates=possible.slice(0,maximumResponses);
  const probabilityAny=1-candidates.reduce((p,r)=>p*(1-r.probability),1);
  const mass=candidates.reduce((n,r)=>n+r.probability,0);
  const comparisons=[];
  const baselines=[];
  for(const action of actions){
    const baseline=previewTacticalAction(game,actorId,action,{maximumStates:96});
    if(!baseline?.searchComplete)return null;
    baselines.push({action,baseline});
  }
  baselines.sort((a,b)=>b.baseline.score-a.baseline.score);
  let securedScore=-Infinity;
  for(const {action,baseline} of baselines){
    // The opponent can always pass. If this optimistic upper bound is below
    // another target's worst tested response, further response enumeration
    // cannot change the preferred target within this search scope.
    if(baseline.score<securedScore-1e-8){
      comparisons.push({action,noResponseScore:baseline.score,score:baseline.score,
        scoreKind:'optimistic-upper-bound',worstResponseScore:null,responses:[],
        responseEvaluation:'dominated-by-tested-lower-bound'});
      continue;
    }
    const responses=[];
    for(const candidate of candidates){
      const outcome=previewTacticalResponse(game,actorId,action,CARD_BY_NUMBER.get(candidate.cardNumber));
      if(!outcome)return null;
      responses.push({cardNumber:candidate.cardNumber,probability:candidate.probability,score:outcome.score});
    }
    const worstResponseScore=Math.min(baseline.score,...responses.map(r=>r.score));
    securedScore=Math.max(securedScore,worstResponseScore);
    comparisons.push({action,noResponseScore:baseline.score,scoreKind:'approximate-expected-value',
      // Overlapping hand marginals are not disjoint worlds. Use a named,
      // provisional one-response mixture; never call this a win probability.
      score:(1-probabilityAny)*baseline.score+probabilityAny*responses.reduce((n,r)=>n+r.probability/mass*r.score,0),
      worstResponseScore,responses});
  }
  return {comparisons,opponentResponsesCompared:true,
    searchComplete:candidates.length===possible.length,
    probabilityModel:'approximate-single-response-mixture',beliefConfidence:belief.confidence,
    correctionEligible:false,winProbabilityLabel:false};
}

export function recommendPublicTacticalAction(game,actorId,actions,{maximumCandidates=8,selectedAction=null}={}){
  const chooseSelf = actions.find(a=>a.kind==='chooseFirstPlayer' && a.playerId===actorId);
  if (chooseSelf && actions.some(a=>a.kind==='chooseFirstPlayer' && a.playerId!==actorId)) {
    // An opening default for imitation, not a rule or a win-probability label.
    // Both orders remain legal and ordinary self-play can learn an override.
    return {contract:TACTICAL_BASELINE_CONTRACT,action:chooseSelf,continuation:[chooseSelf],
      weight:0.5,comparison:'opening-default',gainOverHold:null,opponentResponsesCompared:false,
      correctionEligible:false,winProbabilityLabel:false,searchComplete:false};
  }
  if(actions.length<2||!['action','showdown'].includes(game.phase))return null;
  const before=publicTacticalValue(game,actorId);
  const hold=actions.find(a=>['endTurn','passShowdown','declineEffectChoice'].includes(a.kind)
    || (a.kind==='chooseEffectOption' && a.optionId==='decline'));
  const opponent=game.players.find(p=>p.id!==actorId);
  const held=game.battlefields.filter(f=>f.controlledBy===opponent?.id).length;
  const imminentHoldLoss=Boolean(hold?.kind==='endTurn'&&held>0
    && (opponent.score||0)+held>=(game.victoryScore||8));
  const candidates=actions.filter(a=>!['endTurn','passShowdown','declineEffectChoice'].includes(a.kind)
    && (!hold || actionKey(a)!==actionKey(hold)))
    .map(action=>({action,priority:turnCandidatePriority(game,actorId,action)}))
    .sort((a,b)=>b.priority-a.priority)
    .slice(0,maximumCandidates).map(c=>c.action);
  // A demonstration must compare the learner's actual choice, even if it
  // falls outside the heuristic shortlist. Never invent its outcome.
  if(selectedAction && actions.some(a=>actionKey(a)===actionKey(selectedAction))
    && (!hold||actionKey(selectedAction)!==actionKey(hold))
    && !candidates.some(a=>actionKey(a)===actionKey(selectedAction))) candidates.push(selectedAction);
  const evaluated=[];
  const wholeTurn=game.phase==='action'&&!game.showdown&&game.currentPlayerId===actorId
    && (!game.actionChain||game.pendingPayment||game.pendingChoice?.effect==='declarePlayTarget');
  for(const action of [...(hold?[hold]:[]),...candidates]){
    const preview=wholeTurn?planPublicTurn(game,actorId,action,{previewTacticalAction})
      :previewTacticalAction(game,actorId,action);
    if(preview)evaluated.push({action,key:actionKey(action),gain:preview.score-before,
      steps:preview.steps,searchComplete:preview.searchComplete});
  }
  const forcedDamageChoice=!hold&&Boolean(game.pendingChoice)&&actions.every(a=>
    a.kind==='chooseEffectOption'&&tacticalActionProfile(game,actorId,a).damageContext);
  const forcedTargetChoice=!hold&&Boolean(game.pendingChoice)&&actions.every(a=>
    a.kind==='chooseEffectOption'&&tacticalActionProfile(game,actorId,a).targetContext);
  const responseReview=forcedTargetChoice?reviewPublicTargetResponses(game,actorId,actions):null;
  if(responseReview)for(const entry of evaluated){
    const comparison=responseReview.comparisons.find(c=>actionKey(c.action)===entry.key);
    if(comparison)entry.gain=comparison.score-before;
  }
  const paymentOptions=actions.every(a=>a.kind==='choosePaymentOptions');
  let baseline=hold?evaluated.find(e=>e.key===actionKey(hold))
    :forcedDamageChoice||forcedTargetChoice||paymentOptions?[...evaluated].sort((a,b)=>a.gain-b.gain)[0]:null;
  const ranked=evaluated.sort((a,b)=>b.gain-a.gain||a.key.localeCompare(b.key));
  const best=ranked[0];
  const holdingIsBetter=Boolean(best && hold && best.key===actionKey(hold) && selectedAction
    && actionKey(selectedAction)!==best.key);
  if(holdingIsBetter)baseline=evaluated.find(e=>e.key===actionKey(selectedAction));
  // Unknown alternatives stay available to RL. Initialization only supplies
  // a preference when the explicit hold comparison has a material margin.
  if(!best||!baseline||best===baseline||best.gain-baseline.gain<0.25)return null;
  return {contract:TACTICAL_BASELINE_CONTRACT,action:best.action,continuation:best.steps,
    gain:best.gain,gainOverHold:holdingIsBetter?0:hold?best.gain-baseline.gain:null,
    gainOverAlternative:best.gain-baseline.gain,
    comparison:holdingIsBetter?'reserve-over-commitment':paymentOptions?'payment-options':forcedDamageChoice?'damage-targets':forcedTargetChoice?'removal-targets':'hold',
    comparedAction:baseline.action,
    weight:Math.min(1,0.3+(best.gain-baseline.gain)/8),hold:hold||null,
    comparedActions:evaluated.length,opponentResponsesCompared:Boolean(responseReview),responseReview,imminentHoldLoss,
    scoreRace:scoreRaceContext(game,actorId),searchScope:wholeTurn?'bounded-public-turn':'single-action',
    searchComplete:evaluated.every(e=>e.searchComplete)&&candidates.length===actions.length-(hold?1:0)
      && (!responseReview||responseReview.searchComplete),
    correctionEligible:false,winProbabilityLabel:false};
}
