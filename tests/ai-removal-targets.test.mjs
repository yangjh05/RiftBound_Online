import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {applyAiAction,enumerateAiPolicyActions,activeActorId} from '../src/ai/actions.mjs';
import {previewTacticalAction,recommendPublicTacticalAction,previewTacticalResponse} from '../src/ai/tactical-baseline.mjs';
import {criticalTacticalDecisionProfile} from '../src/ai/neural/selfplay.mjs';
import {tacticalActionProfile} from '../src/ai/action-tactics.mjs';
import {targetResponseContext} from '../src/ai/damage-context.mjs';
import {encodeAction,ACTION_DIM,ACTION_OUTCOME_CONTEXT_DIM} from '../src/ai/neural/encoding.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
import {choosePaymentPlan} from '../src/ai/payment-planner.mjs';

function position(){
  const {game,actor,opponent,field}=tacticalPosition({attacker:true});
  const unit=(card,id,owner)=>({...structuredClone(card),instanceId:id,ownerId:owner,controllerId:owner,
    damage:0,buffs:0,mightModifier:0,exhausted:false,attachments:[]});
  actor.score=1;opponent.score=6;
  actor.legend=unit(cards.settTheBoss,'legend',actor.id);
  field.effects=structuredClone(cards.targonsPeak.effects);
  field.units=[unit(cards.kaiSaSurvivor,'kaisa',opponent.id),unit(cards.ravenbloomStudent,'student',opponent.id)];
  actor.base=[unit(cards.leonaDetermined,'leona',actor.id)];
  actor.hand=[unit(cards.hiddenBlade,'blade',actor.id)];
  actor.runes=actor.runes.map(r=>({...r,domain:'Order'}));
  assert.ok(applyAiAction(game,{kind:'moveUnit',unitId:'leona',destinationId:field.instanceId},actor.id).ok);
  assert.equal(game.pendingChoice?.effect,'stunUnit');
  assert.ok(applyAiAction(game,{kind:'chooseEffectOption',optionId:'student'},actor.id).ok);
  for(let i=0;i<10&&(activeActorId(game)!==actor.id||game.showdown?.chain?.length||game.actionChain);i++)
    assert.ok(applyAiAction(game,{kind:'passShowdown'},activeActorId(game)).ok);
  const play=applyAiAction(game,{kind:'beginPlayCard',cardId:'blade',destination:'base'},actor.id);
  assert.ok(play.ok,JSON.stringify({play,phase:game.phase,choice:game.pendingChoice,showdown:game.showdown}));
  return {game,actor,opponent,field};
}

test('removal targets compare through combat and mandatory conquer trigger ordering',()=>{
  const {game,actor}=position(),before=structuredClone(game);
  const kill=previewTacticalAction(game,actor.id,{kind:'chooseEffectOption',optionId:'kaisa'},
    {returnGame:true,maximumStates:96});
  const waste=previewTacticalAction(game,actor.id,{kind:'chooseEffectOption',optionId:'student'},
    {returnGame:true,maximumStates:96});
  assert.ok(kill,'a winning target must not disappear at mandatory trigger ordering');
  assert.ok(kill.score>waste.score);
  assert.equal(kill.game.players[0].score,2);
  assert.deepEqual(kill.game.battlefields[0].units.map(c=>c.instanceId),['leona']);
  const legal=enumerateAiPolicyActions(game,actor.id);
  const advice=recommendPublicTacticalAction(game,actor.id,legal);
  assert.equal(advice?.action.optionId,'kaisa');
  assert.equal(advice.comparison,'removal-targets');
  assert.equal(advice.correctionEligible,false);
  assert.deepEqual(game,before);
});

test('enemy-versus-enemy removal targets reach the response-aware simulation teacher',()=>{
  const {game,actor}=position(),legal=enumerateAiPolicyActions(game,actor.id);
  const selected=legal.find(a=>a.optionId==='student');
  const review=criticalTacticalDecisionProfile(game,actor.id,{action:selected,legalActions:legal,legalCount:legal.length});
  assert.ok(review.types.includes('enemy-target-opportunity-comparison'));
  assert.ok(review.requiredActions.some(a=>a.optionId==='kaisa'));
});

test('target facts distinguish current combat contribution from permanent body value',()=>{
  const {game,actor}=position();
  const stunned=tacticalActionProfile(game,actor.id,{kind:'chooseEffectOption',optionId:'student'});
  const active=tacticalActionProfile(game,actor.id,{kind:'chooseEffectOption',optionId:'kaisa'});
  assert.equal(stunned.targetContext.stunned,true);
  assert.equal(stunned.targetContext.combatDamage,0);
  assert.equal(active.targetContext.combatDamage,4);
  assert.equal(stunned.targetContext.drawController,2);
  const before=encodeAction(game,actor.id,{kind:'chooseEffectOption',optionId:'student'});
  game.battlefields[0].units.find(u=>u.instanceId==='student').stunned=false;
  const after=encodeAction(game,actor.id,{kind:'chooseEffectOption',optionId:'student'});
  assert.notDeepEqual(before.slice(ACTION_DIM-ACTION_OUTCOME_CONTEXT_DIM),after.slice(ACTION_DIM-ACTION_OUTCOME_CONTEXT_DIM));
});

test('a Might buff cannot protect against kill while a recall can relocate the target',()=>{
  const {game,actor,field}=position(),target=field.units[0];
  const responses={responses:[{cardNumber:cards.discipline.cardNumber,probability:0.75},
    {cardNumber:cards.retreat.cardNumber,probability:0.5}]};
  const kill=targetResponseContext(game,actor.id,target,{kind:'kill',fieldId:field.instanceId},{responses});
  const damage=targetResponseContext(game,actor.id,target,{kind:'damage',fieldId:field.instanceId,
    damage:4,remainingBeforeHit:4},{responses});
  assert.equal(kill.protection,0);assert.equal(kill.relocation,0.5);
  assert.equal(damage.protection,0.75);
});

test('real response branches pay costs and compare recalls through combat without reading the hidden hand',()=>{
  const {game,actor,opponent}=position();
  opponent.hand=[structuredClone(cards.hextechRay)];
  opponent.runes=actor.runes.slice(0,4).map((r,i)=>({...r,instanceId:`opponent-rune-${i}`,ownerId:opponent.id,controllerId:opponent.id,domain:'Mind'}));
  const before=structuredClone(game),action={kind:'chooseEffectOption',optionId:'kaisa'};
  const response=previewTacticalResponse(game,actor.id,action,cards.retreat);
  const wasted=previewTacticalResponse(game,actor.id,{...action,optionId:'student'},cards.retreat);
  assert.ok(response&&wasted);
  assert.ok(response.score>wasted.score);
  assert.equal(response.game.battlefields[0].controlledBy,actor.id,'a recalled defender still concedes the field');
  const alternate=structuredClone(game);alternate.players[1].hand=[structuredClone(cards.discipline)];
  const other=previewTacticalResponse(alternate,actor.id,action,cards.retreat);
  assert.equal(other.score,response.score);
  assert.deepEqual(game,before);
  const exhausted=structuredClone(game);exhausted.players[1].runes.forEach(r=>r.exhausted=true);
  const unpaid=previewTacticalResponse(exhausted,actor.id,action,cards.retreat);
  const pass=previewTacticalAction(exhausted,actor.id,action,{maximumStates:96});
  assert.equal(unpaid.score,pass.score,'an unaffordable response cannot be invented');
  const incomplete=previewTacticalResponse(game,actor.id,action,cards.retreat,{maximumStates:1,returnDiagnostics:true});
  assert.equal(incomplete.searchComplete,false);assert.equal(incomplete.score,undefined);
});

test('equal captures prefer removal alone, but paying for stun remains worthwhile when it saves the attacker',()=>{
  for(const smallMight of [1,2]){
    const {game,actor,field}=tacticalPosition({attacker:true,enemyMight:5});
    field.units.push(...[0,1].map(i=>({...structuredClone(field.units[0]),instanceId:`small-${i}`,might:smallMight,energy:1})));
    actor.hand=[cards.hiddenBlade,cards.runePrison].map((card,i)=>({...structuredClone(card),instanceId:i?'stun':'kill',
      ownerId:actor.id,controllerId:actor.id,zone:'hand'}));
    actor.runes=actor.runes.map((r,i)=>({...r,domain:i%2?'Calm':'Order'}));
    assert.ok(applyAiAction(game,{kind:'moveUnit',unitId:'attacker',destinationId:'field'},actor.id).ok);
    const direct=previewTacticalAction(game,actor.id,{kind:'beginPlayCard',cardId:'kill',destination:'base'},
      {returnGame:true,maximumStates:192});
    assert.ok(direct);
    if(smallMight===1){
      const advice=recommendPublicTacticalAction(game,actor.id,enumerateAiPolicyActions(game,actor.id));
      assert.equal(advice?.action.cardId,'kill');
    }
    assert.ok(applyAiAction(game,{kind:'beginPlayCard',cardId:'stun',destination:'base'},actor.id).ok);
    assert.ok(applyAiAction(game,{kind:'chooseEffectOption',optionId:'small-0'},actor.id).ok);
    for(let i=0;i<30;i++){
      if(game.pendingPayment){for(const a of choosePaymentPlan(game).actions)assert.ok(applyAiAction(game,a,actor.id).ok);continue;}
      if(game.showdown?.chain?.length||game.actionChain){assert.ok(applyAiAction(game,{kind:'passShowdown'},activeActorId(game)).ok);continue;}
      if(game.showdown&&activeActorId(game)!==actor.id){assert.ok(applyAiAction(game,{kind:'passShowdown'},activeActorId(game)).ok);continue;}
      break;
    }
    const combination=previewTacticalAction(game,actor.id,{kind:'beginPlayCard',cardId:'kill',destination:'base'},
      {returnGame:true,maximumStates:192});
    assert.ok(combination);
    if(smallMight===1){
      assert.equal(direct.game.players[0].score,combination.game.players[0].score);
      assert.deepEqual(direct.game.battlefields[0].units.map(u=>u.instanceId),combination.game.battlefields[0].units.map(u=>u.instanceId));
      assert.ok(direct.score>combination.score,'an extra card and payment must reduce the value of an equal outcome');
    }else assert.ok(combination.score>direct.score,'stun is allowed when its extra cost prevents a real loss');
  }
});
