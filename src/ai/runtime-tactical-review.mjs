import {activeActorId,actionKey,applyAiAction,cloneGame,enumerateAiPolicyActions,enumerateLegalActions} from './actions.mjs';
import {publicTacticalValue} from './tactical-baseline.mjs';
import {previewPublicContinuation as previewTacticalAction,publicContinuationBoundary} from './public-continuation.mjs';
import {openingDevelopmentAdvice,actionHasDeferredDevelopment} from './opening-development.mjs';
import {recommendGrowthDevelopment} from './growth-development.mjs';
import {planPublicTurn,turnCandidatePriority} from './turn-planner.mjs';
import {currentMight} from '../engine.mjs';

export const RUNTIME_TACTICAL_REVIEW_CONTRACT='bounded-public-runtime-review-v5';

// This is a gameplay guard, not a new checkpoint or a win-probability label.
// It runs only in the turn Worker, on redacted engine previews, and never
// carries a no-response plan across the opponent's next action.
export function reviewRuntimeTacticalAction(game,actorId,selected,legalActions=null,options={}) {
  try{return review(game,actorId,selected,legalActions,options);}
  catch(error){return {selection:selected,review:{contract:RUNTIME_TACTICAL_REVIEW_CONTRACT,applied:false,
    originalAction:selected?.action||null,reason:'review-error',error:String(error?.message||error).slice(0,160),
    correctionEligible:false,winProbabilityLabel:false}};}
}

function review(game,actorId,selected,legalActions,{
  maximumMilliseconds=2000,maximumPreviews=48,maximumCandidates=4,now=()=>performance.now(),
  includeGrowthDemonstrations=false
}={}) {
  const started=now(),deadline=started+maximumMilliseconds;
  const diagnostic={contract:RUNTIME_TACTICAL_REVIEW_CONTRACT,applied:false,originalAction:selected?.action||null,
    correctionEligible:false,winProbabilityLabel:false,scope:'bounded-public-turn-and-defense'};
  let previews=0,budgetExceeded=false;
  const finish=(selection,extra={})=>({selection,review:{...diagnostic,...extra,previews,budgetExceeded,
    elapsedMilliseconds:Math.max(0,now()-started)}});
  if(!selected?.action || game.pendingPayment || game.phase==='complete' || activeActorId(game)!==actorId)
    return finish(selected,{reason:'not-reviewable'});
  if(game.phase==='mulligan'){
    const legal=legalActions||enumerateAiPolicyActions(game,actorId);
    const advice=openingDevelopmentAdvice(game,actorId,legal,selected.action);
    if(!advice)return finish(selected,{reason:'opening-choice-retained'});
    const index=legal.findIndex(a=>actionKey(a)===actionKey(advice.action));
    const probability=selected.probabilities?.[index]??null;
    return finish({...selected,action:advice.action,selectedIndex:index,probability,
      logProbability:probability>0?Math.log(probability):null},{applied:true,reason:'opening-development',
      comparisons:advice.comparisons,gain:advice.gain});
  }
  const ownTurn=game.phase==='action' && game.currentPlayerId===actorId && !game.showdown && !game.actionChain && !game.pendingChoice;
  const responseWindow=!!(game.showdown||game.actionChain) && !game.pendingChoice;
  const targetChoice=game.pendingChoice?.playerId===actorId
    && ['declarePlayTarget','damageUnit','dealDamageUnit','modifyMight','combatDamage','declareMoveDestination'].includes(game.pendingChoice.effect);
  if(!ownTurn && !targetChoice && !responseWindow)return finish(selected,{reason:'outside-review-scope'});
  if(ownTurn && !['beginPlayCard','beginPlayChampion','moveUnit','moveUnits','endTurn'].includes(selected.action.kind))
    return finish(selected,{reason:'outside-review-scope'});
  if(responseWindow && !['beginPlayCard','beginPlayCardFromTrash','activateCard','passShowdown'].includes(selected.action.kind))
    return finish(selected,{reason:'outside-review-scope'});
  const legal=legalActions||enumerateAiPolicyActions(game,actorId);
  const original=legal.find(a=>actionKey(a)===actionKey(selected.action));
  if(!original || legal.length<2)return finish(selected,{reason:'no-comparison'});
  const actor=game.players.find(p=>p.id===actorId);
  const card=actor.hand.find(c=>c.instanceId===original.cardId);
  const ready=actor.runes.filter(r=>!r.exhausted).length;
  const discounted=card?.effects?.some(e=>e.kind==='costModifier'&&e.requiresLegion&&e.energy<0) && !actor.cardsPlayedThisTurn;
  const responseHeld=actor.hand.some(c=>c.type==='spell' && c.instanceId!==original.cardId
    && (c.tags||[]).some(tag=>['Action','Reaction'].includes(tag)));
  const sensitive=responseWindow || targetChoice || discounted || card?.type==='spell' || original.kind==='endTurn'
    || (card?.type==='unit' && responseHeld && Number(card.energy)>=ready-1)
    || ['moveUnit','moveUnits'].includes(original.kind);
  if(!sensitive)return finish(selected,{reason:'ordinary-model-decision'});

  const available=()=>{
    if(previews>=maximumPreviews || now()>=deadline){budgetExceeded=true;return false;}
    return true;
  };
  const preview=(source,id,action,options={})=>{
    if(!available())return null;
    previews++;
    return previewTacticalAction(source,id,action,{...options,maximumStates:48,pauseAtOpponentDeckChoice:true});
  };
  // Every candidate uses the same public next-turn stress test. Opponent
  // spells and unseen draws are not treated as known future events.
  const endpoint=end=>{
    const base=publicTacticalValue(end,actorId);
    if(end.phase==='complete')return {score:base,secondary:terminalMaterial(end,actorId),attacks:0};
    if(end.pendingChoice?.playerId!==actorId&&['recycleTopDeck','recycleTrashCards'].includes(end.pendingChoice?.effect))
      return {score:base,attacks:0};
    const opponent=activeActorId(end);
    if(!opponent || opponent===actorId || end.pendingChoice || end.pendingPayment || end.showdown || end.actionChain)return null;
    // Follow two distinct scoring moves in sequence, spending actual movement.
    // Independent one-move branches would still overvalue a bounce when the
    // opponent can reconquer AND take the other empty field in the same turn.
    let worst=base,reviewed=0,stressState=end;
    const visitedFields=new Set();
    for(let step=0;step<2;step++){
      if(stressState.phase==='complete')break;
      if(activeActorId(stressState)!==opponent)return null;
      const attack=enumerateLegalActions(stressState,opponent).filter(a=>['moveUnit','moveUnits'].includes(a.kind)
        && !visitedFields.has(a.destinationId)
        && stressState.battlefields.some(f=>f.instanceId===a.destinationId && f.controlledBy!==opponent))
        .sort((a,b)=>turnCandidatePriority(stressState,opponent,b)-turnCandidatePriority(stressState,opponent,a))[0];
      if(!attack)break;
      visitedFields.add(attack.destinationId);
      if(!available())return null;
      const branch=cloneGame(stressState);
      if(!applyAiAction(branch,attack,opponent,{skipCombatPlan:true}).ok || branch.pendingChoice || branch.pendingPayment)return null;
      if(branch.showdown && activeActorId(branch)===opponent)applyAiAction(branch,{kind:'passShowdown'},opponent,{skipCombatPlan:true});
      if(!branch.showdown || activeActorId(branch)!==actorId || branch.pendingChoice || branch.pendingPayment || branch.showdown.chain?.length)return null;
      const defenses=enumerateAiPolicyActions(branch,actorId);
      const pass=defenses.find(a=>a.kind==='passShowdown');
      const choices=[pass,...defenses.filter(a=>a!==pass).sort((a,b)=>turnCandidatePriority(branch,actorId,b)-turnCandidatePriority(branch,actorId,a))].filter(Boolean).slice(0,3);
      const outcomes=choices.map(a=>preview(branch,actorId,a,{returnGame:true}));
      if(!outcomes.length || !outcomes.every(o=>o?.searchComplete&&o.game))return null;
      const defense=outcomes.sort((a,b)=>b.score-a.score)[0];
      reviewed++;worst=Math.min(worst,defense.score);stressState=defense.game;
    }
    return {score:worst,attacks:reviewed};
  };
  const replace=(action,reason,comparisons,gain,extra={})=>{
    const index=selected.legalActions?.findIndex(a=>actionKey(a)===actionKey(action));
    const probability=index>=0?selected.probabilities?.[index]:null;
    return finish({...selected,action,probability:probability??null,selectedIndex:index??-1,
      logProbability:probability>0?Math.log(probability):null},
      {applied:true,reason,selectedAction:action,gain,comparisons,...extra});
  };
  const line=actions=>{
    let state=game;
    for(const action of actions){
      const result=preview(state,actorId,action,{returnGame:true});
      if(!result?.searchComplete || !result.game || result.game.phase==='complete')return null;
      state=result.game;
    }
    const end=preview(state,actorId,{kind:'endTurn'},{finishTurn:true,returnGame:true});
    if(!end?.searchComplete || !end.game)return null;
    return {game:end.game,score:end.score,ready:end.game.players.find(p=>p.id===actorId).runes.filter(r=>!r.exhausted).length};
  };
  // Conditional future projections are soft teacher examples. Gameplay must
  // retain a learned decision to wait for an opponent response, rather than
  // overriding it with the assumption that the opponent passes next turn.
  if(ownTurn&&includeGrowthDemonstrations){
    const growth=recommendGrowthDevelopment(game,actorId,legal,original,{preview});
    if(growth)return replace(growth.action,'future-development',growth.comparisons,growth.gain,
      {growthLesson:true,developmentHorizon:growth.scope,assumptions:growth.assumptions});
  }
  // Compare the same pair in both orders before the wider turn search. The
  // board and remaining cards must agree; the engine, not printed costs,
  // proves that the setup order retains more usable resources.
  if(ownTurn && discounted){
    const setups=legal.filter(a=>a.kind==='beginPlayCard' && a.cardId!==original.cardId)
      .sort((a,b)=>turnCandidatePriority(game,actorId,b)-turnCandidatePriority(game,actorId,a)).slice(0,3);
    for(const setup of setups){
      if(!available())break;
      const normal=line([original,setup]),reversed=line([setup,original]);
      if(normal && reversed && publicBoardSignature(normal.game)===publicBoardSignature(reversed.game)
        && resourcesDominate(reversed.game,normal.game,actorId)
        && reversed.ready>normal.ready && reversed.score>normal.score+0.3){
        return replace(setup,'verified-card-order-savings',[
          {action:original,score:normal.score},{action:setup,score:reversed.score}],reversed.score-normal.score,
          {readyResourcesSaved:reversed.ready-normal.ready});
      }
    }
  }
  // Explicitly retain cheap two-unit development instead of letting a crowd
  // of movement branches consume the budget before reserve is compared.
  if(ownTurn && !discounted && card?.type==='unit' && responseHeld && card.energy>=ready-1){
    const baseline=line([original]);
    if(baseline && baseline.ready===0){
      const cheap=legal.filter(a=>a.kind==='beginPlayCard' && actor.hand.some(c=>c.instanceId===a.cardId && c.type==='unit' && c.energy<card.energy))
        .sort((a,b)=>actor.hand.find(c=>c.instanceId===a.cardId).energy-actor.hand.find(c=>c.instanceId===b.cardId).energy).slice(0,2);
      for(const setup of cheap){
        const first=preview(game,actorId,setup,{returnGame:true});
        if(!first?.searchComplete || !first.game)continue;
        const followers=enumerateAiPolicyActions(first.game,actorId).filter(a=>a.kind==='beginPlayCard'
          && actor.hand.some(c=>c.instanceId===a.cardId && c.type==='unit')).slice(0,2);
        for(const follow of followers){
          const alternative=line([setup,follow]);
          if(alternative && alternative.ready>0 && alternative.score>baseline.score+0.75)
            return replace(setup,'reserve-with-cheaper-development',[
              {action:original,score:baseline.score},{action:setup,score:alternative.score}],alternative.score-baseline.score,
              {readyResourcesSaved:alternative.ready});
        }
      }
    }
  }
  const hold=legal.find(a=>a.kind===(responseWindow?'passShowdown':'endTurn'));
  const alternatives=legal.filter(a=>actionKey(a)!==actionKey(original) && a!==hold
    && (targetChoice || (responseWindow?['beginPlayCard','beginPlayCardFromTrash','activateCard']:
      ['beginPlayCard','beginPlayChampion','moveUnit','moveUnits']).includes(a.kind)))
    .sort((a,b)=>turnCandidatePriority(game,actorId,b)-turnCandidatePriority(game,actorId,a));
  // Keep a cheap development candidate when all-in deployment would turn
  // response cards off. A crowd of scoring moves must not evict every setup.
  const cheapDevelopment=!discounted && card?.type==='unit' && responseHeld ? alternatives.filter(a=>{
    const unit=actor.hand.find(c=>c.instanceId===a.cardId);
    return a.kind==='beginPlayCard' && unit?.type==='unit' && unit.energy<card.energy;
  }).sort((a,b)=>actor.hand.find(c=>c.instanceId===a.cardId).energy-actor.hand.find(c=>c.instanceId===b.cardId).energy)[0]:null;
  const diverse=[...new Map([cheapDevelopment,...alternatives].filter(Boolean).map(a=>[actionKey(a),a])).values()];
  // Establish the zero-spend baseline before optional continuations can use
  // the budget. Keep the model action next, even when it ranks poorly.
  const required=[...(hold&&hold!==original?[hold]:[]),original];
  const candidates=[...required,...diverse.slice(0,Math.max(0,maximumCandidates-required.length))];
  const evaluated=[];
  const outcomes=new Map();
  let incompleteFollowup=false;
  try{
    // Finish one shallow comparison for every candidate before spending on
    // deeper follow-ups. A single elaborate line must not starve the others.
    for(const deepen of ownTurn?[false,true]:[false]){
    for(const action of candidates){
      if(!available())break;
      if(deepen&&action===hold)continue;
      const result=ownTurn?planPublicTurn(game,actorId,action,{previewTacticalAction:preview},{
        followupDepth:deepen?2:0,beamWidth:2,maximumFollowups:3,maximumExpansions:deepen?8:0,evaluateEndpoint:endpoint,
        compareEndpoints:(a,b)=>compareScores({score:a.score,secondary:a.endpointAssessment?.secondary},
          {score:b.score,secondary:b.endpointAssessment?.secondary})
      }):preview(game,actorId,action,{returnGame:true});
      if(deepen&&!result?.searchComplete)incompleteFollowup=true;
      if(result && (ownTurn || result.searchComplete) && Number.isFinite(result.score)){
        const value={action,score:result.score,secondary:result.game?.phase==='complete'?terminalMaterial(result.game,actorId):0,
          searchComplete:result.searchComplete,opponentChoiceBoundary:result.opponentChoiceBoundary||null,
          attacks:result.endpointAssessment?.attacks||0,
          followupComplete:!!result.searchComplete&&(!ownTurn||action===hold||deepen)};
        const index=evaluated.findIndex(e=>e.action===action);
        if(index<0||(value.searchComplete&&!evaluated[index].searchComplete)
          ||value.searchComplete===evaluated[index].searchComplete&&compareScores(value,evaluated[index])>=0){
          if(index<0)evaluated.push(value);else evaluated[index]=value;
          outcomes.set(action,result.game);
        }
      }
      if(action===original && !result && !outcomes.has(original))return finish(selected,{reason:'unresolved-model-choice'});
    }
    }
  }catch(error){
    return finish(selected,{reason:'review-error',error:String(error?.message||error).slice(0,160)});
  }
  const baseline=evaluated.find(e=>e.action===original);
  const comparable=evaluated.filter(e=>e.opponentChoiceBoundary===baseline?.opponentChoiceBoundary);
  const completed=comparable.filter(e=>e.searchComplete);
  const best=[...(baseline?.searchComplete?completed:comparable)].sort((a,b)=>compareScores(b,a))[0];
  const gain=best&&baseline?compareScores(best,baseline):0;
  // A completed, equal-position resource comparison remains useful even if
  // later optional search runs out. Other partial comparisons fail closed.
  const preserved=best&&baseline&&best!==baseline
    && preservesSamePosition(outcomes.get(best.action),outcomes.get(original),actorId);
  const terminalTie=best&&baseline&&best.score===baseline.score&&Math.abs(best.score)===1000
    && outcomes.get(best.action)?.phase==='complete'&&outcomes.get(original)?.phase==='complete';
  // A completed improvement over a fully searched baseline does not become
  // invalid when another optional candidate runs out. Never certify a
  // partially searched baseline, or discard an unsearched opposing choice.
  const completedImprovement=baseline?.followupComplete&&best?.searchComplete&&best!==baseline&&gain>=0.3;
  if(budgetExceeded && !preserved && !terminalTie&&!completedImprovement)return finish(selected,{reason:'review-budget',comparisons:evaluated});
  if((!baseline?.searchComplete||!best?.searchComplete)&&!preserved&&!terminalTie)
    return finish(selected,{reason:'incomplete-comparison',comparisons:evaluated,partialSearch:true});
  if(best?.action.kind==='endTurn'&&incompleteFollowup&&!preserved&&!terminalTie)
    return finish(selected,{reason:'incomplete-followup',comparisons:evaluated,partialSearch:true});
  if(!baseline || !best || best===baseline || gain<0.3)
    return finish(selected,{reason:budgetExceeded?'review-budget':'model-choice-retained',comparisons:evaluated});
  // A one-turn material estimate cannot prove that saving the price of a
  // draw/ramp spell beats developing future turns. Permit only a verified
  // same-position saving or a completed terminal outcome to override it.
  if(best.action.kind==='endTurn'&&actionHasDeferredDevelopment(game,actorId,original)
    &&!preserved&&!terminalTie&&Math.abs(best.score)!==1000)
    return finish(selected,{reason:'deferred-development-retained',comparisons:evaluated});
  // probability remains the model's probability of the executed action when
  // available, not the probability of the action we replaced.
  return replace(best.action,preserved?'same-result-less-spending':terminalTie?'terminal-resource-tie':responseWindow?'combat-response-comparison':
    discounted?'card-order-and-resources':best.action.kind==='endTurn'?'preserve-response-resources':'public-cost-and-continuation',
    evaluated,gain,{partialSearch:budgetExceeded});
}

function compareScores(a,b){
  const delta=a.score-b.score;
  if(Math.abs(delta)>1e-8)return delta;
  // Preserve the primary win/loss ordering. Resource quality is only a
  // secondary ordering between equally terminal outcomes, never a win label.
  return Math.abs(a.score)===1000?(a.secondary||0)-(b.secondary||0):0;
}

function terminalMaterial(game,actorId){
  // Pure read-only material assessment; do not change the game's result or
  // the shared training value function's terminal targets.
  return publicTacticalValue({...game,phase:'action'},actorId);
}

function preservesSamePosition(better,worse,actorId){
  if(!better||!worse||better.pendingPayment||worse.pendingPayment||better.showdown||worse.showdown)return false;
  if(better.pendingChoice||worse.pendingChoice||better.actionChain||worse.actionChain){
    const boundary=publicContinuationBoundary(better,actorId);
    if(!boundary||boundary!==publicContinuationBoundary(worse,actorId))return false;
  }
  const signature=g=>{
    const c=x=>x&&[x.instanceId,x.controllerId,x.exhausted,x.damage||0,x.buffs||0,!!x.stunned,
      x.type==='unit'?currentMight(g,x):null,x.mightModifier||0,x.keywords||[],x.temporaryKeywords||[],x.appendedKeywords||[],
      x.temporaryKeywordValues||{},(x.attachments||[]).map(c)];
    return JSON.stringify({phase:g.phase,winner:g.winnerId,turn:g.turnSequence,current:g.currentPlayerId,
      players:g.players.map(p=>({id:p.id,score:p.score,base:p.base.map(c),deck:p.mainDeck.length,
        ...(p.id===actorId?{}:{hand:p.hand.map(c),trash:p.trash.map(c),runes:p.runes.map(c),legend:c(p.legend)})})),
      fields:g.battlefields.map(f=>({id:f.instanceId,control:f.controlledBy,units:f.units.map(c),hidden:f.hidden}))});
  };
  const a=better.players.find(p=>p.id===actorId),b=worse.players.find(p=>p.id===actorId);
  return signature(better)===signature(worse) && resourcesDominate(better,worse,actorId)
    && a.runes.length>=b.runes.length && (!a.legend.exhausted||b.legend.exhausted)
    && b.runes.every(r=>a.runes.some(other=>other.instanceId===r.instanceId
      && other.cardNumber===r.cardNumber && other.domain===r.domain && (r.exhausted||!other.exhausted)))
    && b.hand.every(c=>a.hand.some(other=>other.instanceId===c.instanceId));
}

function publicBoardSignature(game){
  const card=c=>c&&[c.instanceId,c.cardNumber,c.controllerId,c.exhausted,c.damage,c.buffs,c.mightModifier,
    c.type==='unit'?currentMight(game,c):null,c.stunned,(c.attachments||[]).map(card)];
  return JSON.stringify({phase:game.phase,turn:game.turnSequence,actor:activeActorId(game),
    players:game.players.map(p=>({id:p.id,score:p.score,legend:card(p.legend),
      hand:p.hand.map(card).sort(),base:p.base.map(card).sort(),trash:p.trash.map(card).sort(),
      deck:p.mainDeck.length,totalRunes:p.runes.length})),
    fields:game.battlefields.map(f=>({id:f.instanceId,control:f.controlledBy,units:f.units.map(card).sort(),hidden:f.hidden}))});
}

function resourcesDominate(better,worse,actorId){
  const actor=g=>g.players.find(p=>p.id===actorId);
  const counts=g=>{
    const result=new Map();
    for(const r of actor(g).runes.filter(r=>!r.exhausted))
      result.set(r.domain,(result.get(r.domain)||0)+1);
    return result;
  };
  const a=counts(better),b=counts(worse);
  return [...b].every(([domain,count])=>(a.get(domain)||0)>=count)
    && JSON.stringify(actor(better).runePool)===JSON.stringify(actor(worse).runePool);
}
