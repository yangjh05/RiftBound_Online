import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {restoreGameReferences} from '../scripts/game-state-references.mjs';
import * as api from '../src/ai/actions.mjs';
import {publicTacticalValue,recommendPublicTacticalAction} from '../src/ai/tactical-baseline.mjs';
import {reviewCombatContinuations} from '../src/ai/combat-safety.mjs';
import {reactionReserveProfile} from '../src/ai/resource-strategy.mjs';
import {tacticalActionProfile} from '../src/ai/action-tactics.mjs';
import {liveGameDecisionComparisons} from '../scripts/live-game-curriculum.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
import {cards} from '../src/cards.mjs';
import {previewPublicReserveHorizon} from '../scripts/response-aware-demonstration.mjs';
import {recordExecutedReplayAction,persistableAiReplay} from '../src/ai/replay.mjs';
import {recordablePaymentCommand,resolveRecordedPaymentCommand} from '../src/ai/replay-command.mjs';

const samples=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/ai-live-behavior-20260924.json.gz',import.meta.url))));
const fixture=id=>{const s=structuredClone(samples.find(s=>s.id===id));return restoreGameReferences(s.game,s.references);};
const has=(g,a)=>api.enumerateAiPolicyActions(g,'p2').some(b=>api.actionKey(b)===api.actionKey(a));
function settle(g,targets=[]){
 for(let i=0;i<80;i++){
  const id=api.activeActorId(g);
  if(g.pendingPayment){for(const a of api.planPaymentActions(g))assert.ok(api.applyAiAction(g,a,id).ok);continue;}
  if(g.pendingChoice){const legal=api.enumerateAiPolicyActions(g,id);
   const a=targets.map(t=>legal.find(a=>a.optionId===t)).find(Boolean)
    ||legal.find(a=>a.optionId==='confirm-trigger-order')||(legal.length===1?legal[0]:null);
   assert.ok(a,JSON.stringify({choice:g.pendingChoice.effect,legal}));assert.ok(api.applyAiAction(g,a,id).ok);continue;}
  if(g.showdown||g.actionChain){assert.ok(api.applyAiAction(g,{kind:'passShowdown'},id).ok);continue;}
  return;
 }throw new Error('unresolved branch');
}

test('live Sett death replacement source remains selectable and really saves Brawler',()=>{
 const g=fixture('sett-146'),a={kind:'chooseEffectOption',optionId:'card:c57'};
 assert.ok(has(g,a));assert.ok(api.applyAiAction(g,a,'p2').ok);settle(g);
 assert.ok(g.players[1].base.some(c=>c.instanceId==='c99'&&c.damage===0));
 assert.ok(liveGameDecisionComparisons(fixture('sett-146'),'p2',{kind:'chooseEffectOption',optionId:'decline'}).some(c=>c.alternative.optionId==='card:c57'));
});

test('live Annie Assault support is available and wins the no-response combat',()=>{
 const g=fixture('annie-68'),a={kind:'beginPlayCard',cardId:'c63',destination:'base'};
 assert.ok(has(g,a));assert.ok(api.applyAiAction(g,a,'p2').ok);settle(g,['c76','c19','c67']);
 assert.equal(g.battlefields.find(f=>f.instanceId==='c59').controlledBy,'p2');
 assert.ok(g.battlefields.flatMap(f=>f.units).some(c=>c.instanceId==='c76'));
 assert.equal(g.players[1].score,3);
});

test('live Darius second-card ready combo is preserved and denies the next hold',()=>{
 const g=fixture('annie-173'),a={kind:'beginPlayCard',cardId:'c63',destination:'base'};
 assert.ok(has(g,a));assert.ok(api.applyAiAction(g,a,'p2').ok);settle(g,['c100']);
 assert.equal(g.players[1].base.find(c=>c.instanceId==='c100').exhausted,false);
 const move={kind:'moveUnit',unitId:'c100',destinationId:'c4'};assert.ok(has(g,move));
 assert.ok(api.applyAiAction(g,move,'p2').ok);settle(g,['g100002','c20','c100']);
 assert.deepEqual(g.players.map(p=>p.score),[7,5]);
 assert.ok(g.battlefields.every(f=>f.controlledBy==='p2'));
 const source=fixture('annie-173');const advice=recommendPublicTacticalAction(source,'p2',api.enumerateAiPolicyActions(source,'p2'));
 assert.equal(advice?.action.cardId,'c63');
});

test('defensive hidden recall is reviewed and losing the hidden asset has a cost',()=>{
 const g=fixture('annie-47'),before=publicTacticalValue(g,'p2');
 const review=reviewCombatContinuations(g,'p2',api.enumerateAiPolicyActions(g,'p2'),api);
 assert.ok(review?.comparisons.some(c=>c.action.cardId==='c70'));
 assert.equal(review.hardExclusionEligible,false);
 const f=g.battlefields.find(f=>f.hidden.length);g.players[1].trash.push(f.hidden.pop().card);
 assert.ok(publicTacticalValue(g,'p2')<before-1);
});

test('response reserve includes showdown Actions, free hidden cards and floating energy',()=>{
 assert.ok(reactionReserveProfile(fixture('sett-167'),'p2').affordableReactions>0);
 const g=fixture('annie-47');g.players[1].hand=[];g.players[1].runes=[];
 assert.equal(reactionReserveProfile(g,'p2').affordableReactions,1);
 const {game,actor}=tacticalPosition();actor.hand=[{...structuredClone(cards.discipline),instanceId:'reserve',energy:2,power:[]}];
 actor.runes=[];actor.runePool={energy:[{},{}],power:[]};
 assert.equal(reactionReserveProfile(game,'p1').affordableReactions,1);
});

test('a negative Might target can remove a damaged unit without damage from the spell',()=>{
 const {game,field}=tacticalPosition({enemyMight:4});field.units[0].damage=3;
 game.pendingChoice={playerId:'p1',effect:'declarePlayTarget',card:cards.stupefy,
  options:[{id:'enemy',cardId:'enemy'}],data:{currentDeclaration:{spec:{kind:'modifyMight',amount:-1,temporary:true}}}};
 const result=tacticalActionProfile(game,'p1',{kind:'chooseEffectOption',optionId:'enemy'});
 assert.equal(result.targetContext.kind,'weakening');assert.equal(result.canRemoveEnemyNoResponse,true);
 field.units[0].damage=0;
 assert.equal(tacticalActionProfile(game,'p1',{kind:'chooseEffectOption',optionId:'enemy'}).canRemoveEnemyNoResponse,false);
});

test('opening preference is seat-relative and does not ban choosing the opponent',()=>{
 for(const id of ['p1','p2']){const {game}=tacticalPosition();const actions=['p1','p2'].map(playerId=>({kind:'chooseFirstPlayer',playerId}));
  const advice=recommendPublicTacticalAction(game,id,actions);assert.equal(advice.action.playerId,id);assert.equal(advice.winProbabilityLabel,false);}
});

test('next-turn comparison values runes that actually change a defensive combat',()=>{
 const {game,actor,opponent,field}=tacticalPosition({attacker:true,enemy:false});
 field.units=actor.base;actor.base=[];field.units[0].might=3;field.controlledBy='p1';
 opponent.base=[{...structuredClone(field.units[0]),instanceId:'enemy-attacker',ownerId:'p2',controllerId:'p2',might:4}];
 game.currentPlayerId='p2';game.turnPlayerId='p2';
 opponent.hand=[{...structuredClone(cards.discipline),instanceId:'unknown'}];
 actor.hand=[{...structuredClone(cards.discipline),instanceId:'protect',ownerId:'p1',controllerId:'p1',energy:1,power:[]}];
 const withReserve=previewPublicReserveHorizon(game,'p1');
 actor.runes.forEach(r=>r.exhausted=true);
 const without=previewPublicReserveHorizon(game,'p1');
 assert.ok(withReserve.attacks>0&&without.attacks>0);
 assert.ok(withReserve.score>without.score+2);
 opponent.hand=[{...structuredClone(cards.hextechRay),instanceId:'secret'}];
 assert.deepEqual(previewPublicReserveHorizon(game,'p1'),without);
});

test('AI execution is retained without fabricating human coaching samples',()=>{
 const replay={aiPlayerId:'p2',decisions:[]},before={phase:'action',turnNumber:3};
 recordExecutedReplayAction(replay,before,'p2',{kind:'passShowdown'},{ok:true});
 recordExecutedReplayAction(replay,before,'p2',{kind:'bad'},{ok:false});
 const saved=persistableAiReplay(replay);
 assert.equal(saved.executedActions.length,1);assert.equal(saved.executedActions[0].ai,true);
 assert.deepEqual(saved.decisions,[]);
});

test('generated payment IDs replay exactly without guessing between different pool resources',()=>{
 const game={players:[{id:'p2',runePool:{power:[{id:'old-1',domain:'Mind',sourceCardId:'legend'},
   {id:'old-2',domain:'Fury',sourceCardId:'unit'}]}}]};
 const record=recordablePaymentCommand(game,'p2',{kind:'togglePaymentPoolPower',powerId:'old-2'});
 game.players[0].runePool.power.forEach((item,i)=>item.id=`new-${i}`);
 assert.deepEqual(resolveRecordedPaymentCommand(game,'p2',record),{kind:'togglePaymentPoolPower',powerId:'new-1'});
 assert.throws(()=>resolveRecordedPaymentCommand(game,'p2',{kind:'togglePaymentPoolPower',powerId:'lost'}),/Ambiguous/);
 game.players[0].runePool.power[1].domain='Body';
 assert.throws(()=>resolveRecordedPaymentCommand(game,'p2',record),/identity changed/);
});
