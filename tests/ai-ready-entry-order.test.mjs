import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {applyAiAction,activeActorId,enumerateAiPolicyActions,cloneGame} from '../src/ai/actions.mjs';
import {resolvePlannedPayment} from '../src/ai/payment-planner.mjs';
import {previewTacticalAction,recommendPublicTacticalAction} from '../src/ai/tactical-baseline.mjs';
import {encodeState} from '../src/ai/neural/encoding.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';

function position({runes=6,trigger=false,alreadyReady=false}={}){
 const p=tacticalPosition({enemy:false});
 const {game,actor}=p;
 actor.hand=[{...structuredClone(cards.confront),instanceId:'setup',ownerId:'p1',controllerId:'p1'},
   {...structuredClone(cards.lonelyPoro),instanceId:'unit',ownerId:'p1',controllerId:'p1',might:4,energy:2,power:[],
     effects:trigger?[{timing:'spellPlayed',kind:'selfBuff',amount:1,temporary:true,...(typeof trigger==='object'?trigger:{})}]:[],keywords:[],exhausted:false}];
 actor.runes=actor.runes.slice(0,runes);actor.unitsEnterReadyThisTurn=alreadyReady;
 return p;
}
const setup={kind:'beginPlayCard',cardId:'setup',destination:'base'};
const unit={kind:'beginPlayCard',cardId:'unit',destination:'base'};
const has=(actions,id)=>actions.some(a=>a.kind==='beginPlayCard'&&a.cardId===id);

test('public readiness flags reach the state encoder independently for both players',()=>{
 const {game,actor,opponent}=position(),before=encodeState(game,'p1');
 actor.unitsEnterReadyThisTurn=true;
 assert.notDeepEqual(encodeState(game,'p1'),before);
 const actorFlag=encodeState(game,'p1');actor.unitsEnterReadyThisTurn=false;opponent.unitsEnterReadyThisTurn=true;
 assert.notDeepEqual(encodeState(game,'p1'),actorFlag);
 opponent.unitsEnterReadyThisTurn=false;actor.nextUnitEnterReady=true;
 assert.notDeepEqual(encodeState(game,'p1'),before);
});

test('the same paid cards prefer setup then unit when only its readiness improves',()=>{
 const {game}=position(),before=JSON.stringify(game),legal=enumerateAiPolicyActions(game,'p1');
 assert.ok(has(legal,'setup'));assert.ok(!has(legal,'unit'));
 assert.equal(JSON.stringify(game),before);
 const first=previewTacticalAction(game,'p1',setup,{returnGame:true,skipReadyEntryOrdering:true});
 const second=previewTacticalAction(first.game,'p1',unit,{returnGame:true,skipReadyEntryOrdering:true});
 assert.equal(second.game.players[0].base.find(c=>c.instanceId==='unit').exhausted,false);
 const reverse1=previewTacticalAction(game,'p1',unit,{returnGame:true,skipReadyEntryOrdering:true});
 const reverse2=previewTacticalAction(reverse1.game,'p1',setup,{returnGame:true,skipReadyEntryOrdering:true});
 assert.equal(reverse2.game.players[0].base.find(c=>c.instanceId==='unit').exhausted,true);
});

test('an unused temporary spell trigger does not outweigh immediate ready-entry scoring',()=>{
 const {game}=position({trigger:true}),legal=enumerateAiPolicyActions(game,'p1');
 assert.ok(has(legal,'setup'));assert.ok(!has(legal,'unit'));
});

test('even a lasting trigger bonus must exceed the ready unit scoring opportunity',()=>{
 const {game}=position({trigger:{amount:2,temporary:false}});
 assert.ok(!has(enumerateAiPolicyActions(game,'p1'),'unit'));
});

test('unit-first stays available when its lasting benefit exceeds unusable readiness',()=>{
 const {game,field,opponent}=position({trigger:{amount:2,temporary:false}});
 field.controlledBy=opponent.id;
 field.units=[{...structuredClone(game.players[0].hand[1]),instanceId:'enemy',
   ownerId:opponent.id,controllerId:opponent.id,might:20,effects:[],energy:5}];
 const legal=enumerateAiPolicyActions(game,'p1');
 assert.ok(has(legal,'setup'));assert.ok(has(legal,'unit'));
});

test('even a large temporary bonus that expires unused cannot outweigh immediate scoring',()=>{
 const {game}=position({trigger:{amount:100,temporary:true}});
 assert.ok(!has(enumerateAiPolicyActions(game,'p1'),'unit'));
});

test('a reverse-order benefit larger than immediate ready-entry scoring preserves unit-first',()=>{
 const {game}=position({trigger:{amount:80,temporary:false}});
 assert.ok(has(enumerateAiPolicyActions(game,'p1'),'unit'));
});

test('holding the setup never forces its cost when playing only the unit is better',()=>{
 const {game,field,opponent}=position();
 field.controlledBy=opponent.id;
 field.units=[{...structuredClone(game.players[0].hand[1]),instanceId:'enemy',
   ownerId:opponent.id,controllerId:opponent.id,might:20,effects:[],energy:5}];
 assert.ok(has(enumerateAiPolicyActions(game,'p1'),'unit'));
});

test('drawing without a follow-up stays legal and unaffordable combined payments do not suppress the unit',()=>{
 const {game,actor}=position();actor.hand=actor.hand.filter(c=>c.instanceId==='setup');
 assert.ok(has(enumerateAiPolicyActions(game,'p1'),'setup'));
 const limited=position({runes:2});
 assert.ok(has(enumerateAiPolicyActions(limited.game,'p1'),'unit'));
 const active=position({alreadyReady:true});
 assert.ok(has(enumerateAiPolicyActions(active.game,'p1'),'unit'));
});

test('the demonstrator carries setup through a unit play and immediate scoring move',()=>{
 const {game}=position(),advice=recommendPublicTacticalAction(game,'p1',enumerateAiPolicyActions(game,'p1'));
 assert.equal(advice?.action.cardId,'setup');
 assert.ok(advice.continuation.some(a=>a.cardId==='unit'));
 assert.ok(advice.continuation.some(a=>['moveUnit','moveUnits'].includes(a.kind)));
 const live=cloneGame(game),steps=[...advice.continuation];
 for(let i=0;i<80&&(steps.length||live.pendingPayment||live.showdown||live.actionChain);i++){
   if(live.pendingPayment){assert.ok(resolvePlannedPayment(live).ok);continue;}
   const id=activeActorId(live),action=id==='p1'&&steps.length?steps.shift():{kind:'passShowdown'};
   assert.ok(applyAiAction(live,action,id).ok);
 }
 assert.equal(steps.length,0);assert.equal(live.battlefields[0].controlledBy,'p1');
 assert.ok(live.players[0].score>game.players[0].score);
});

test('order comparisons cannot inspect future draws or the opponent hidden hand',()=>{
 const {game}=position(),other=cloneGame(game);
 game.players[1].hand=[structuredClone(cards.stupefy)];other.players[1].hand=[structuredClone(cards.discipline)];
 other.players[0].mainDeck.reverse();other.players[1].mainDeck.reverse();
 assert.deepEqual(enumerateAiPolicyActions(game,'p1'),enumerateAiPolicyActions(other,'p1'));
});
