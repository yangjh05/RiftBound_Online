import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {enumerateAiPolicyActions,applyAiAction,activeActorId,planPaymentActions,cloneGame} from '../src/ai/actions.mjs';
import {recommendPublicTacticalAction,previewTacticalAction} from '../src/ai/tactical-baseline.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
import {resolvePlannedPayment} from '../src/ai/payment-planner.mjs';

const recommend=game=>recommendPublicTacticalAction(game,'p1',enumerateAiPolicyActions(game,'p1'));

test('imminent hold defeat compares a weakening spell followed by a clearing attack',()=>{
 const {game,actor,opponent,field}=tacticalPosition({enemyMight:2,attacker:true});
 opponent.score=6;actor.score=2;
 const instantiate=(card,id,owner)=>({...structuredClone(card),instanceId:id,ownerId:owner,controllerId:owner,
   damage:0,buffs:0,mightModifier:0,attachments:[],exhausted:false});
 actor.base=[instantiate(cards.ravenbloomStudent,'attacker','p1')];
 field.units.push(instantiate(cards.lecturingYordle,'tank','p2'));
 field.units[1].keywords=['Tank'];
 game.battlefields.push({...structuredClone(field),instanceId:'other',units:[{...structuredClone(field.units[0]),instanceId:'large',might:12}]});
 actor.hand=[{...instantiate(cards.smokeScreen,'weaken','p1')},
   {...instantiate(cards.lonelyPoro,'develop','p1'),energy:5,power:[{domain:'Fury',amount:1}]}];
 actor.runes=actor.runes.slice(0,6);
 actor.legend=instantiate(cards.kaiSaDaughterOfTheVoid,'legend','p1');
 const before=JSON.stringify(game),advice=recommend(game);
 assert.equal(advice?.action.cardId,'weaken');
 assert.equal(advice.imminentHoldLoss,true);
 assert.ok(advice.continuation.some(a=>a.kind==='moveUnit'||a.kind==='moveUnits'));
 assert.equal(JSON.stringify(game),before);
 const actual=cloneGame(game),steps=[...advice.continuation];
 for(let i=0;i<80&&steps.length;i++){
   if(actual.pendingPayment){assert.ok(resolvePlannedPayment(actual).ok);continue;}
   const id=activeActorId(actual);
   const action=id==='p1'?steps.shift():actual.pendingChoice
     ?enumerateAiPolicyActions(actual,id)[0]:{kind:'passShowdown'};
   assert.ok(applyAiAction(actual,action,id).ok);
 }
 assert.equal(steps.length,0);
 assert.equal(actual.players[1].score,7);
 assert.notEqual(actual.phase,'complete');
});
function supportedCapture(){
 const position=tacticalPosition({enemyMight:6,attacker:true});
 const {game,actor,field}=position;
 actor.base[0].buffs=1;
 field.units[0].stunned=true;
 field.effects=[{timing:'conquerHere',kind:'spendBuffDraw',draw:1,optional:true}];
 actor.hand=[{...structuredClone(cards.discipline),instanceId:'support',ownerId:'p1',controllerId:'p1',power:[]}];
 assert.ok(applyAiAction(game,{kind:'moveUnit',unitId:'attacker',destinationId:'field'},'p1').ok);
 return position;
}

test('combat support retains a winning capture through an optional post-combat trigger',()=>{
 const {game}=supportedCapture();
 const before=JSON.stringify(game),advice=recommend(game);
 assert.equal(advice?.action.cardId,'support');
 assert.ok(advice.continuation.some(a=>a.optionId==='attacker'));
 assert.ok(advice.continuation.some(a=>a.optionId==='decline-optional-trigger'||a.optionId==='use-optional-trigger'));
 assert.equal(advice.opponentResponsesCompared,false);
 assert.equal(JSON.stringify(game),before);
 const actual=cloneGame(game),steps=[...advice.continuation];
 for(let i=0;i<40 && (steps.length||actual.pendingPayment||actual.showdown||actual.actionChain||actual.pendingChoice);i++){
   if(actual.pendingPayment){for(const a of planPaymentActions(actual))assert.ok(applyAiAction(actual,a,activeActorId(actual)).ok);continue;}
   const actorId=activeActorId(actual),a=actorId==='p1'?steps.shift():{kind:'passShowdown'};
   assert.ok(a&&applyAiAction(actual,a,actorId).ok);
 }
 assert.equal(actual.battlefields[0].controlledBy,'p1');
 assert.ok(actual.players[0].score>game.players[0].score);
 assert.ok(!actual.battlefields[0].units.some(u=>u.instanceId==='enemy'));
});

test('an unsupported optional bonus branch cannot erase a completed capture branch',()=>{
 const {game,field}=supportedCapture();
 field.effects=[{timing:'conquerHere',kind:'spendBuffDraw',draw:1,optional:true},
   {timing:'conquerHere',kind:'spendBuffDraw',draw:1,optional:true}];
 const advice=recommend(game);
 assert.equal(advice?.action.cardId,'support');
});

test('combat support previews ignore unknown opponent responses and future draw identities',()=>{
 const {game}=supportedCapture(),other=cloneGame(game);
 other.players[1].hand=[{...structuredClone(cards.discipline),instanceId:'secret'}];
 game.players[1].hand=[{...structuredClone(cards.hextechRay),instanceId:'different-secret'}];
 other.players[0].mainDeck.reverse();other.players[1].mainDeck.reverse();
 assert.deepEqual(recommend(game),recommend(other));
});
test('public tactical default prefers payable removal but keeps hold as a legal override',()=>{
 const {game}=tacticalPosition();const before=JSON.stringify(game),result=recommend(game);
 assert.equal(result.action.kind,'beginPlayCard');assert.equal(result.action.cardId,'removal');
 assert.ok(result.gainOverHold>0);assert.equal(result.correctionEligible,false);assert.equal(result.winProbabilityLabel,false);
 assert.ok(enumerateAiPolicyActions(game).some(a=>a.kind==='endTurn'));
 assert.equal(JSON.stringify(game),before);
 assert.ok(result.continuation.some(a=>a.kind==='chooseEffectOption'&&a.optionId==='enemy'));
});
test('killing a small enemy in base with an expensive spell is not the tactical default',()=>{
 const {game,opponent,field}=tacticalPosition({spellCost:8,enemyCost:0,enemyMight:1});
 opponent.base.push(field.units.pop());field.controlledBy=null;
 assert.equal(recommend(game),null);
});

test('removal also values denying the opponent an actual hold point',()=>{
 const {game}=tacticalPosition({spellCost:8,enemyCost:0,enemyMight:1});
 assert.equal(recommend(game)?.action.cardId,'removal');
});
test('the lower-cost removal is preferred when both remove the same enemy',()=>{
 const {game,actor}=tacticalPosition({spellCost:1});
 actor.hand.push({...structuredClone(actor.hand[0]),instanceId:'expensive',energy:5});
 assert.equal(recommend(game).action.cardId,'removal');
});
test('a publicly unopposed capture is preferred with no permanent ban on holding',()=>{
 const {game,actor}=tacticalPosition({enemy:false,attacker:true});actor.hand=[];
 assert.equal(recommend(game).action.kind,'moveUnit');
 assert.ok(enumerateAiPolicyActions(game).some(a=>a.kind==='endTurn'));
});
test('unseen opponent cards and future deck order cannot alter a default preference',()=>{
 const {game,opponent}=tacticalPosition();opponent.hand=[structuredClone(cards.stupefy)];
 const other=cloneGame(game);other.players[1].hand=[structuredClone(cards.discipline)];
 other.players[0].mainDeck.reverse();other.players[1].mainDeck.reverse();
 assert.deepEqual(recommend(game),recommend(other));
});
test('unaffordable and unresolved actions do not become invented tactical wins',()=>{
 const {game,actor}=tacticalPosition();actor.runes=[];assert.equal(recommend(game),null);
 assert.equal(previewTacticalAction(game,'p1',{kind:'beginPlayCard',cardId:'removal',destination:'base'},{maximumStates:1}),null);
});
test('a real response can defeat a public removal recommendation without making it a proof label',()=>{
 const {game,opponent,field}=tacticalPosition();
 opponent.hand=[{...structuredClone(cards.discipline),instanceId:'response',ownerId:'p2',controllerId:'p2',energy:0,power:[]}];
 const advice=recommend(game);assert.ok(advice);
 assert.ok(applyAiAction(game,advice.action,'p1').ok);
 assert.ok(applyAiAction(game,{kind:'chooseEffectOption',optionId:'enemy'},'p1').ok);
 while(game.pendingPayment)for(const a of planPaymentActions(game))assert.ok(applyAiAction(game,a,activeActorId(game)).ok);
 if(activeActorId(game)==='p1')assert.ok(applyAiAction(game,{kind:'passShowdown'},'p1').ok);
 assert.ok(applyAiAction(game,{kind:'beginPlayCard',cardId:'response',destination:'base'},'p2').ok);
 assert.ok(applyAiAction(game,{kind:'chooseEffectOption',optionId:'enemy'},'p2').ok);
 for(let i=0;i<30&&(game.pendingPayment||game.actionChain||game.showdown);i++){
  if(game.pendingPayment){for(const a of planPaymentActions(game))assert.ok(applyAiAction(game,a,activeActorId(game)).ok);}
  else assert.ok(applyAiAction(game,{kind:'passShowdown'},activeActorId(game)).ok);
 }
 assert.ok(field.units.some(u=>u.instanceId==='enemy'));
 assert.equal(advice.opponentResponsesCompared,false);assert.equal(advice.correctionEligible,false);
});
