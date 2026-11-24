import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {reviewRuntimeTacticalAction} from '../src/ai/runtime-tactical-review.mjs';
import {previewPublicContinuation} from '../src/ai/public-continuation.mjs';
const states=JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/ai-charm-live-20261001.json.gz',import.meta.url))));
function fixture(n){
 const s=structuredClone(states.find(s=>s.n===n)),get=keys=>keys.reduce((v,k)=>v[k],s.state);
 for(const [destination,source] of s.references)get(destination.slice(0,-1))[destination.at(-1)]=get(source);
 s.state.log=[];return s;
}
test('actual Charm destination gives no free capture when Yi can defend and kill the moved enemy',()=>{
 const s=fixture(33),before=structuredClone(s.state);
 assert.equal(s.state.players[0].runes.filter(r=>!r.exhausted).length,0);
 const r=reviewRuntimeTacticalAction(s.state,'p2',{action:s.action},null,{now:()=>0});
 assert.equal(r.review.applied,true);assert.equal(r.selection.action.optionId,'c4');
 assert.equal(r.review.budgetExceeded,false);assert.equal(r.review.previews,2);
 assert.equal(r.review.correctionEligible,false);assert.equal(r.review.winProbabilityLabel,false);
 const preview=action=>previewPublicContinuation(s.state,'p2',action,{maximumStates:96,returnGame:true,finishTurn:true,pauseAtOpponentDeckChoice:true});
 const good=preview(r.selection.action),bad=preview(s.action);
 assert.equal(good.searchComplete,true);assert.equal(bad.searchComplete,true);
 assert.deepEqual(good.game.players.map(p=>p.score),[0,1]);
 assert.deepEqual(bad.game.players.map(p=>p.score),[2,1]);
 assert.ok(good.game.players[0].trash.some(c=>c.instanceId==='c19'));
 assert.ok(good.game.battlefields.find(f=>f.instanceId==='c4').units.some(c=>c.instanceId==='c80'));
 assert.deepEqual(s.state,before);
});
test('the profitable Charm remains available and the correction uses no private hand or deck identity',()=>{
 const s=fixture(31),r=reviewRuntimeTacticalAction(s.state,'p2',{action:s.action},null,{now:()=>0});
 assert.deepEqual(r.selection.action,s.action);assert.equal(r.review.reason,'model-choice-retained');
 const t=fixture(33);
 for(const p of t.state.players){for(const c of p.mainDeck){c.name='unknown';c.effects=[];}if(p.id==='p1')for(const c of p.hand){c.name='unknown';c.effects=[];c.energy=999;}}
 assert.equal(reviewRuntimeTacticalAction(t.state,'p2',{action:t.action},null,{now:()=>0}).selection.action.optionId,'c4');
});
