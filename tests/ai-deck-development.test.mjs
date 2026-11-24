import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {previewPublicContinuation,publicContinuationBoundary} from '../src/ai/public-continuation.mjs';
import {reviewRuntimeTacticalAction} from '../src/ai/runtime-tactical-review.mjs';
import {openingDevelopmentAdvice} from '../src/ai/opening-development.mjs';
import {enumerateAiPolicyActions,actionKey} from '../src/ai/actions.mjs';
import {recommendSafeTacticalAction} from '../scripts/response-aware-demonstration.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
const rows=JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/ai-deck-development-20260927.json.gz',import.meta.url))));
const fixture=(i,n)=>structuredClone(rows.find(r=>r.gameIndex===i&&r.n===n));

test('opponent allocates forced combat damage to kill the more valuable attacker',()=>{
  const {game,actor}=tacticalPosition({enemyMight:3,attacker:true});
  actor.hand=[];actor.base[0].might=3;actor.base[0].energy=8;
  actor.base.push({...structuredClone(actor.base[0]),instanceId:'cheap',might:1,energy:1});
  const p=previewPublicContinuation(game,'p1',{kind:'moveUnits',unitIds:['attacker','cheap'],destinationId:'field'},
    {maximumStates:256,returnGame:true});
  assert.ok(p?.searchComplete);assert.ok(p.opponentChoicesCompared>0);
  assert.ok(p.game.players[0].trash.some(c=>c.instanceId==='attacker'));
  assert.ok(p.game.battlefields[0].units.some(c=>c.instanceId==='cheap'));
});

test('group attack resolves every opposing public damage allocation without mutating the source',()=>{
  const {game,actorId}=fixture(23,54),before=JSON.stringify(game);
  const action={kind:'moveUnits',unitIds:['c73','c82','c94'],destinationId:'c59'};
  const p=previewPublicContinuation(game,actorId,action,{maximumStates:512,returnGame:true});
  assert.ok(p?.searchComplete);assert.ok(p.opponentChoicesCompared>0);
  assert.equal(p.game.pendingChoice,null);
  assert.equal(p.game.phase,'action');
  assert.ok(p.game.log.some(s=>s.includes('assigns')&&s.includes('combat damage')));
  assert.equal(JSON.stringify(game),before);
  assert.equal(previewPublicContinuation(game,actorId,action,{maximumStates:1})?.searchComplete===true,false);
});

test('incomplete own-turn searches cannot force a different action',()=>{
  const {game,actorId,selected}=fixture(23,69);
  const r=reviewRuntimeTacticalAction(game,actorId,{action:selected},null,{now:()=>0});
  if(r.review.applied){
    const original=r.review.comparisons.find(c=>actionKey(c.action)===actionKey(selected));
    const chosen=r.review.comparisons.find(c=>actionKey(c.action)===actionKey(r.selection.action));
    assert.ok(original.searchComplete&&chosen.searchComplete);
  }else assert.deepEqual(r.selection.action,selected);
  assert.notEqual(r.selection.action.kind,'endTurn');
});

test('early rune growth is not replaced by repeated idle turns',()=>{
  for(const n of [5,11,19]){
    const {game,actorId,selected}=fixture(132,n);
    const r=reviewRuntimeTacticalAction(game,actorId,{action:selected},null,{now:()=>0});
    assert.notEqual(r.selection.action.kind,'endTurn');
  }
});

test('unit-curve mulligan replaces the two late threats and is invariant to private order',()=>{
  const {game,actorId,selected}=fixture(23,3),legal=enumerateAiPolicyActions(game,actorId);
  const a=openingDevelopmentAdvice(game,actorId,legal,selected);
  assert.deepEqual([...a.action.cardIds].sort(),['c96','c98']);
  const changed=structuredClone(game);changed.players.forEach(p=>p.mainDeck.reverse());
  changed.players.find(p=>p.id!==actorId).hand=[];
  assert.deepEqual(openingDevelopmentAdvice(changed,actorId,legal,selected).action,a.action);
  const review=reviewRuntimeTacticalAction(game,actorId,{action:selected},legal,{now:()=>0});
  assert.deepEqual(review.selection.action,a.action);
  assert.equal(recommendSafeTacticalAction(game,actorId,legal,{selectedAction:selected}).mulliganLesson,true);
});

test('unsupported or private opposing choices are not assumed harmless',()=>{
  const {game,actorId}=fixture(23,54);
  const unknown=structuredClone(game);unknown.pendingChoice={playerId:'p1',effect:'recycleTopDeck',options:[]};
  assert.equal(previewPublicContinuation(unknown,actorId,{kind:'endTurn'}),null);
});

test('movement destination continuation can be compared through the actual combat outcome',()=>{
  const {game,actorId,selected}=fixture(140,150);
  const p=previewPublicContinuation(game,actorId,selected,{maximumStates:128,pauseAtOpponentDeckChoice:true});
  assert.ok(p?.searchComplete);
  assert.notEqual(reviewRuntimeTacticalAction(game,actorId,{action:selected},null,{now:()=>0}).review.reason,
    'unresolved-model-choice');
});

test('empty-board movement spell has a completed no-response comparison',()=>{
  const {game,actorId,selected}=fixture(140,175);
  const p=previewPublicContinuation(game,actorId,selected,{maximumStates:128,returnGame:true});
  assert.ok(p?.searchComplete);
  const r=reviewRuntimeTacticalAction(game,actorId,{action:selected},null,{now:()=>0});
  assert.notEqual(actionKey(r.selection.action),actionKey(selected));
});

test('paused public boundaries distinguish remaining choices and trigger continuations',()=>{
  const {game,actorId}=fixture(140,175);
  const p=previewPublicContinuation(game,actorId,{kind:'endTurn'},
    {returnGame:true,pauseAtOpponentDeckChoice:true});
  const other=structuredClone(p.game),key=publicContinuationBoundary(p.game,actorId);
  assert.ok(key);other.pendingChoice.id='different-ui-id';
  assert.equal(publicContinuationBoundary(other,actorId),key);
  other.pendingChoice.data.remaining++;
  assert.notEqual(publicContinuationBoundary(other,actorId),key);
  other.pendingChoice.data.remaining--;
  other.actionChain.continuation.playerId=actorId;
  assert.notEqual(publicContinuationBoundary(other,actorId),key);
});
