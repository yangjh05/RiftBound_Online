import test from 'node:test';
import assert from 'node:assert/strict';
import { cards } from '../src/cards.mjs';
import { applyAiAction } from '../src/ai/actions.mjs';
import { choosePaymentPlan, resolvePlannedPayment, paymentOutcomeKey } from '../src/ai/payment-planner.mjs';
import { tacticalPosition } from './fixtures/ai-tactical-position.mjs';

function paymentPosition({unit=false,power=1}={}) {
  const { game, actor } = tacticalPosition();
  actor.legend={...structuredClone(cards.kaiSaDaughterOfTheVoid),instanceId:'legend',ownerId:'p1',controllerId:'p1',exhausted:false};
  actor.hand=[{...structuredClone(unit?cards.lonelyPoro:cards.fallingStar),instanceId:'pay',
    ownerId:'p1',controllerId:'p1',energy:2,power:power?[{domain:'Fury',amount:power}]:[],effects:[]}];
  actor.runes=actor.runes.slice(0,4);
  assert.ok(applyAiAction(game,{kind:'beginPlayCard',cardId:'pay',destination:'base'},'p1').ok);
  return {game,actor};
}

test('a payable spell uses a reusable power source to preserve a durable rune',()=>{
 const {game,actor}=paymentPosition(),before=JSON.stringify(game);
 assert.equal(choosePaymentPlan(game).actions[0].kind,'activateCard');
 assert.equal(JSON.stringify(game),before);
 assert.ok(resolvePlannedPayment(game).ok);
 assert.equal(actor.runes.length,4);
 assert.equal(actor.legend.exhausted,true);
});

test('restricted or unnecessary generated power is not activated',()=>{
 for(const options of [{unit:true},{power:0}]){
   const {game,actor}=paymentPosition(options);
   assert.notEqual(choosePaymentPlan(game).actions[0].kind,'activateCard');
   assert.ok(resolvePlannedPayment(game).ok);
   assert.equal(actor.legend.exhausted,false);
 }
});

test('a spent resource source falls back to direct rune payment without loops',()=>{
 const {game,actor}=paymentPosition();actor.legend.exhausted=true;
 const result=resolvePlannedPayment(game);
 assert.ok(result.ok);assert.equal(actor.runes.length,3);
 assert.equal(result.plans.length,1);
});

test('payment outcome keys preserve trees and distinguish cyclic continuation outcomes',()=>{
 const {game}=paymentPosition();
 const tree=structuredClone(game);
 for(const k of ['log','aiDecisionContext','aiDeclinedIntents','random','updatedAt'])delete tree[k];
 assert.equal(paymentOutcomeKey(game,'p1'),`p1:${JSON.stringify(tree)}`);
 const continuation={payment:game.pendingPayment};
 game.pendingPayment.continuation=continuation;
 const before=structuredClone(game),key=paymentOutcomeKey(game,'p1');
 assert.equal(paymentOutcomeKey(structuredClone(game),'p1'),key);
 assert.deepEqual(game,before);
 const changed=structuredClone(game);changed.pendingPayment.energyCost++;
 assert.notEqual(paymentOutcomeKey(changed,'p1'),key);
 changed.pendingPayment.continuation.payment={...changed.pendingPayment,continuation:null};
 assert.notEqual(paymentOutcomeKey(changed,'p1'),key);
});
