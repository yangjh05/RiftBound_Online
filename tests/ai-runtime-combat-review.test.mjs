import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {restoreGameReferences} from '../scripts/game-state-references.mjs';
import {reviewRuntimeTacticalAction} from '../src/ai/runtime-tactical-review.mjs';
import {enumerateAiPolicyActions} from '../src/ai/actions.mjs';
import {publicTacticalValue,previewTacticalAction} from '../src/ai/tactical-baseline.mjs';

const saved=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/ai-live-kaisa-20260926.json.gz',import.meta.url))));
const fixture=n=>{const s=structuredClone(saved.states.find(s=>s.n===n));return {...s,game:restoreGameReferences(s.state,s.references)};};
const review=(s,options={})=>reviewRuntimeTacticalAction(s.game,'p2',{action:s.action},null,{now:()=>0,...options});

test('finished attack: compare hold first and keep a verified saving after optional search exhausts its budget',()=>{
 const s=fixture(178),before=JSON.stringify(s.game);
 const full=review(s);
 assert.equal(full.selection.action.kind,'endTurn');
 assert.equal(full.review.comparisons[0].action.kind,'endTurn');
 let checked=0;
 for(const maximumPreviews of [4,8,12,20,32]){
  const result=review(s,{maximumPreviews});
  if(result.review.budgetExceeded&&result.review.applied){
   assert.equal(result.selection.action.kind,'endTurn');
   assert.equal(result.review.reason,'same-result-less-spending');checked++;
  }
 }
 assert.ok(checked>0,'A completed preservation comparison must survive later budget exhaustion');
 assert.equal(JSON.stringify(s.game),before);
});

test('4 versus 4 combat: preserve Ray when its damage changes no casualty or control outcome',()=>{
 const result=review(fixture(206));
 assert.equal(result.selection.action.kind,'passShowdown');
 assert.equal(result.review.applied,true);
 assert.ok(result.review.previews>0);
 assert.equal(result.review.comparisons[0].action.kind,'passShowdown');
});

test('combat: replace a pass with affordable lethal damage that saves the defender',()=>{
 const s=fixture(206);s.action={kind:'passShowdown'};
 s.game.battlefields.flatMap(f=>f.units).find(c=>c.instanceId==='c21').might=3;
 s.game.battlefields.flatMap(f=>f.units).find(c=>c.instanceId==='c98').might=6;
 const result=review(s);
 assert.equal(result.selection.action.cardId,'c70');
 assert.equal(result.review.applied,true);
});

test('combat: preserve a beneficial damage spell instead of indiscriminately banning damage',()=>{
 const s=fixture(206);
 s.game.battlefields.flatMap(f=>f.units).find(c=>c.instanceId==='c21').might=3;
 s.game.battlefields.flatMap(f=>f.units).find(c=>c.instanceId==='c98').might=6;
 const result=review(s);
 assert.equal(result.selection.action.cardId,'c70');
});

test('combat: a cantrip weakening spell remains available and is used to win the fight',()=>{
 const s=fixture(206),actor=s.game.players[1];
 const index=actor.trash.findIndex(c=>c.instanceId==='c68');
 assert.ok(index>=0);
 const spell=actor.trash.splice(index,1)[0];spell.zone='hand';actor.hand.push(spell);
 s.action={kind:'passShowdown'};
 const result=review(s);
 assert.equal(result.selection.action.cardId,'c68');
 assert.equal(result.review.applied,true);
 const preview=previewTacticalAction(s.game,'p2',result.selection.action,{returnGame:true,maximumStates:96});
 assert.ok(preview.game.players[1].hand.some(c=>c.type==='unknown'),'The public preview accounts for the draw without peeking');
 assert.ok(preview.game.battlefields.flatMap(f=>f.units).some(c=>c.instanceId==='c98'));
 assert.ok(!preview.game.battlefields.flatMap(f=>f.units).some(c=>c.instanceId==='c21'));
});

test('combat rescue is compared at the same opponent deck-choice boundary without deciding private choices',()=>{
 const s=fixture(99),before=JSON.stringify(s.game),result=review(s);
 assert.equal(result.selection.action.cardId,'c65');
 const baseline=result.review.comparisons.find(x=>x.action.kind==='passShowdown');
 const rescue=result.review.comparisons.find(x=>x.action.cardId==='c65');
 assert.ok(baseline.opponentChoiceBoundary);
 assert.equal(rescue.opponentChoiceBoundary,baseline.opponentChoiceBoundary);
 assert.equal(JSON.stringify(s.game),before);
});

test('terminal ties: do not bounce a just-played unit for a rune that cannot be used before defeat',()=>{
 const s=fixture(307),result=review(s);
 assert.equal(result.selection.action.kind,'endTurn');
 const comparisons=result.review.comparisons;
 assert.ok(comparisons.every(c=>c.score===-1000));
 assert.ok(comparisons.find(c=>c.action.kind==='endTurn').secondary>
  comparisons.find(c=>c.action.kind==='beginPlayCard').secondary);
 const end=previewTacticalAction(s.game,'p2',{kind:'endTurn'},{returnGame:true});
 assert.equal(publicTacticalValue(end.game,'p2'),-1000,'Training terminal targets must not change');
});

test('last turn: avoid redundant Ray when cheaper continuation or holding gives the same result',()=>{
 const result=review(fixture(292));
 assert.notEqual(result.selection.action.cardId,'c72');
 assert.ok(['endTurn','beginPlayCard'].includes(result.selection.action.kind));
 assert.equal(result.review.applied,true);
});

test('response review ignores opponent hidden card identities and returns only legal actions',()=>{
 for(const n of [99,178,206,292,307]){
  const a=fixture(n),b=fixture(n);
  for(const p of b.game.players){
   for(const c of p.mainDeck){c.name='Unknown';c.effects=[];c.energy=999;}
   if(p.id!=='p2')for(const c of p.hand){c.name='Unknown';c.effects=[];c.energy=999;}
  }
  const x=review(a),y=review(b);
  assert.deepEqual(x.selection.action,y.selection.action);
  const legal=enumerateAiPolicyActions(a.game,'p2');
  assert.ok(legal.some(action=>JSON.stringify(action)===JSON.stringify(x.selection.action)));
  assert.equal(x.review.correctionEligible,false);
  assert.equal(x.review.winProbabilityLabel,false);
 }
});

test('unresolved or exhausted combat budgets preserve the original model action',()=>{
 for(const maximumPreviews of [0,1]){
  const s=fixture(206),result=review(s,{maximumPreviews});
  assert.deepEqual(result.selection.action,s.action);
  assert.equal(result.review.applied,false);
 }
});
