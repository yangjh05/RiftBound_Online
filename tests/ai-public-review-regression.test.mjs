import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {previewPublicContinuation} from '../src/ai/public-continuation.mjs';
import {reviewRuntimeTacticalAction} from '../src/ai/runtime-tactical-review.mjs';
import {createAiDecisionCycleGuard} from '../src/ai/actions.mjs';
const read=name=>JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/'+name,import.meta.url))));
const saved=read('ai-public-review-eval77-20260929.json.gz');
const fixture=(index,n)=>structuredClone(saved.find(r=>r.index===index&&r.n===n));
const review=r=>reviewRuntimeTacticalAction(r.game,r.actorId,{action:r.action},null,{now:()=>0});

test('a mandatory own discard does not hide an Annie spell with no public benefit',()=>{
 const fixture=read('ai-discard-review-eval83-20260930.json.gz'),before=structuredClone(fixture.game);
 const result=review(fixture);
 assert.equal(result.review.applied,true);assert.equal(result.selection.action.kind,'endTurn');
 assert.equal(result.review.reason,'same-result-less-spending');assert.ok(result.review.previews<=48);
 assert.deepEqual(fixture.game,before);
 const masked=structuredClone(fixture);
 for(const p of masked.game.players){
   for(const c of p.mainDeck){c.name='unseen';c.effects=[];}
   if(p.id!==masked.actorId)for(const c of p.hand){c.name='unseen';c.effects=[];}
 }
 assert.deepEqual(review(masked).selection.action,result.selection.action);
});

test('Sett public death replacement branches no longer hide a winning combat spell',()=>{
 const r=fixture(24,47),before=structuredClone(r.game),result=review(r);
 assert.equal(result.review.applied,true);
 assert.ok(['c26','c28','c24'].includes(result.selection.action.cardId));
 const p=previewPublicContinuation(r.game,r.actorId,result.selection.action,{maximumStates:192,returnGame:true});
 assert.equal(p.searchComplete,true);assert.ok(p.opponentChoicesCompared>0);
 assert.equal(p.game.players[0].score,1);
 assert.ok(p.game.battlefields[0].units.some(c=>c.instanceId==='c42'));
 assert.deepEqual(r.game,before);
 assert.equal(result.review.correctionEligible,false);assert.equal(result.review.winProbabilityLabel,false);
});

test('a buff that still loses the later Sett fight is not forced',()=>{
 const r=fixture(24,68),result=review(r);
 assert.equal(result.selection.action.kind,'passShowdown');
});

test('completed response comparison survives exhaustion on a later optional candidate',()=>{
 const r=fixture(24,47);
 const v=reviewRuntimeTacticalAction(r.game,r.actorId,{action:r.action},null,{now:()=>0,maximumPreviews:3});
 assert.equal(v.review.budgetExceeded,true);assert.equal(v.review.applied,true);
 assert.equal(v.selection.action.cardId,'c26');
 const insufficient=reviewRuntimeTacticalAction(r.game,r.actorId,{action:r.action},null,{now:()=>0,maximumPreviews:1});
 assert.equal(insufficient.review.applied,false);
});

test('a hold-denial bounce is not forced when the opponent can reconquer and score the other field',()=>{
 const r=fixture(61,78),v=review(r);
 const hold=v.review.comparisons.find(c=>c.action.kind==='endTurn');
 const charm=v.review.comparisons.find(c=>c.action.cardId==='c64');
 assert.equal(hold.searchComplete,true);assert.equal(charm.searchComplete,true);
 assert.equal(charm.attacks,2);assert.ok(charm.score<hold.score);
 assert.equal(v.review.applied,false);assert.equal(v.selection.action.kind,'endTurn');
});

test('Annie retains the public defenders within the unchanged 48-preview budget',()=>{
 const r=fixture(81,131),result=review(r);
 assert.equal(result.selection.action.kind,'endTurn');
 assert.equal(result.review.applied,true);assert.ok(result.review.previews<=48);
 assert.ok(result.review.comparisons.every(c=>c.searchComplete));
});

test('actual long trigger chain makes progress instead of reporting a false cycle',()=>{
 const history=read('ai-long-chain-20260929.json.gz'),guard=createAiDecisionCycleGuard();
 for(const g of history)assert.equal(guard.inspect(g),null);
 const last=history.at(-1);let found;
 for(let i=0;i<9;i++)found=guard.inspect(last)||found;
 assert.equal(found?.kind,'ai-decision-cycle','real unchanged-state detection is preserved');
});

test('cycle progress is semantic, not a random chain id or log timestamp',()=>{
 const g=read('ai-long-chain-20260929.json.gz').at(-1),guard=createAiDecisionCycleGuard(2);
 assert.equal(guard.inspect(g),null);
 for(const [i,item] of g.showdown.chain.entries()){item.id='changed-'+i;if(item.trigger)item.trigger.id='changed-'+i;}
 g.log.push('a new log entry');assert.equal(guard.inspect(g),null);
 assert.equal(guard.inspect(g)?.kind,'ai-decision-cycle');
});

test('public combat/defense corrections do not depend on private hands or deck order',()=>{
 for(const [index,n] of [[24,47],[81,131]]){
  const r=fixture(index,n),s=fixture(index,n);
  for(const p of s.game.players){p.mainDeck.reverse();for(const c of p.mainDeck){c.name='private';c.effects=[];}
   if(p.id!==s.actorId)for(const c of p.hand){c.name='private';c.effects=[];c.energy=999;}}
  assert.deepEqual(review(s).selection.action,review(r).selection.action);
 }
});
