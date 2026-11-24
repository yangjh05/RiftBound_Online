import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {applyAiAction,enumerateAiPolicyActions,enumerateLegalActions,createAiDecisionCycleGuard,cloneGame} from '../src/ai/actions.mjs';
import {needsPaymentOptionDecision} from '../src/ai/payment-options.mjs';
import {resolvePlannedPayment} from '../src/ai/payment-planner.mjs';
import {recommendPublicTacticalAction,previewTacticalAction} from '../src/ai/tactical-baseline.mjs';
import {handleAiTurnWorkerRequest} from '../src/ai/turn-decision.mjs';
import {AI_TURN_WORKER_MESSAGE_TYPES} from '../src/ai/turn-protocol.mjs';
import {DEFAULT_AI_MODEL} from '../src/ai/policy.mjs';
import {encodeAction,ACTION_DIM} from '../src/ai/neural/encoding.mjs';
import {scoreRaceContext} from '../src/ai/score-race.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';

const card=(template,id,owner='p1')=>({...structuredClone(template),instanceId:id,ownerId:owner,
 controllerId:owner,damage:0,buffs:0,mightModifier:0,attachments:[],exhausted:false});
function position({runes=8,combo=false,alreadyReady=false}={}){
 const p=tacticalPosition({enemyMight:combo?11:7,enemyCost:7});
 const {game,actor,opponent}=p;
 actor.score=3;opponent.score=6;
 actor.hand=[card(cards.thousandTailedWatcher,'watcher')];
 actor.runes=Array.from({length:runes},(_,i)=>({...structuredClone(actor.runes[0]),instanceId:`r${i}`,domain:'Mind'}));
 actor.unitsEnterReadyThisTurn=alreadyReady;
 if(combo){actor.hand.push(card(cards.wallop,'ready'));
   actor.base=[{...card(cards.lonelyPoro,'ally'),energy:5,might:12,exhausted:true}];}
 assert.ok(applyAiAction(game,{kind:'beginPlayCard',cardId:'watcher',destination:'base'},'p1').ok);
 return p;
}
const advice=g=>recommendPublicTacticalAction(g,'p1',enumerateAiPolicyActions(g,'p1'));

test('optional costs are genuine neural decisions before mechanical rune payment',()=>{
 const {game}=position(),original=JSON.stringify(game);
 const options=enumerateAiPolicyActions(game,'p1');
 assert.equal(options.length,2);assert.ok(options.every(a=>a.kind==='choosePaymentOptions'));
 assert.equal(JSON.stringify(game),original);
 const guard=createAiDecisionCycleGuard(2);guard.inspect(game);guard.inspect(game);
 const worker=handleAiTurnWorkerRequest({type:AI_TURN_WORKER_MESSAGE_TYPES.decide,requestId:1,
   game,actorId:'p1',model:DEFAULT_AI_MODEL,selectionMode:'neural'});
 assert.equal(worker.ok,true);assert.equal(worker.decision.kind,'neural');assert.equal(worker.decision.legalCount,2);
 assert.notDeepEqual(encodeAction(game,'p1',options[0]),encodeAction(game,'p1',options[1]));
 assert.equal(encodeAction(game,'p1',options[0]).length,ACTION_DIM);
 assert.equal(resolvePlannedPayment(game).requiresStrategicChoice,true);
 assert.equal(JSON.stringify(game),original);
 assert.ok(applyAiAction(game,options[0],'p1').ok);
 assert.equal(guard.inspect(game),null);
 assert.equal(needsPaymentOptionDecision(game),false);
 const payment=handleAiTurnWorkerRequest({type:AI_TURN_WORKER_MESSAGE_TYPES.decide,requestId:2,
   game,actorId:'p1',model:DEFAULT_AI_MODEL,selectionMode:'neural'});
 assert.equal(payment.decision.kind,'payment');
 assert.ok(resolvePlannedPayment(game).complete);
 assert.equal(game.players[0].base.find(c=>c.instanceId==='watcher').exhausted,true);
});

test('payment options reject unknown or duplicate selections without mutation',()=>{
 for(const ids of [['missing'],['optional-watcher-accelerate','optional-watcher-accelerate']]){
  const {game}=position(),before=JSON.stringify(game);
  assert.equal(applyAiAction(game,{kind:'choosePaymentOptions',cardId:'watcher',effectIds:ids},'p1').ok,false);
  assert.equal(JSON.stringify(game),before);
 }
});

test('only affordable optional costs are offered and the full legal manifest includes them',()=>{
 const {game}=position({runes:7});
 const options=enumerateAiPolicyActions(game,'p1');
 assert.deepEqual(options.map(a=>a.effectIds),[[]]);
 assert.ok(enumerateLegalActions(game,'p1').some(a=>a.kind==='choosePaymentOptions'));
});

test('score pressure favors acceleration with a usable clearing attack',()=>{
 const {game}=position(),before=JSON.stringify(game),result=advice(game);
 assert.equal(result?.comparison,'payment-options');assert.ok(result.action.effectIds.length);
 assert.ok(result.continuation.some(a=>a.kind==='moveUnit'&&a.unitId==='watcher'));
 assert.equal(result.winProbabilityLabel,false);assert.equal(result.opponentResponsesCompared,false);
 assert.equal(JSON.stringify(game),before);
});

test('non-acceleration wins the comparison when saved energy enables a better real combo',()=>{
 const {game}=position({runes:9,combo:true}),result=advice(game);
 assert.deepEqual(result?.action.effectIds,[]);
 assert.ok(result.continuation.some(a=>a.cardId==='ready'));
 assert.ok(result.continuation.some(a=>a.optionId==='ally'));
 assert.ok(result.continuation.some(a=>a.kind==='moveUnit'&&a.unitId==='ally'));
});

test('acceleration is wasteful when another effect already grants readiness',()=>{
 const {game}=position({alreadyReady:true});
 assert.deepEqual(advice(game)?.action.effectIds,[]);
});

test('public race and optional-cost advice do not read the actual opponent hand or deck order',()=>{
 const {game,opponent}=position();opponent.hand=[card(cards.smokeScreen,'secret','p2')];
 const other=cloneGame(game);other.players[1].hand=[card(cards.fallingStar,'other-secret','p2')];
 other.players[0].mainDeck.reverse();other.players[1].mainDeck.reverse();
 assert.deepEqual(advice(game),advice(other));
 assert.deepEqual(scoreRaceContext(game,'p1'),scoreRaceContext(other,'p1'));
});

test('the same paid pair uses Legion savings and leaves two usable runes',()=>{
 const {game,actor}=tacticalPosition({enemy:false});
 actor.hand=[card(cards.noxusHopeful,'legion'),card(cards.lecturingYordle,'setup')];
 actor.runes=actor.runes.slice(0,7);actor.cardsPlayedThisTurn=0;
 const result=advice(game);assert.equal(result?.action.cardId,'setup');
 const first=previewTacticalAction(game,'p1',result.action,{returnGame:true});
 const second=previewTacticalAction(first.game,'p1',{kind:'beginPlayCard',cardId:'legion',destination:'base'},{returnGame:true});
 assert.equal(second.game.players[0].runes.filter(r=>!r.exhausted).length,2);
});
