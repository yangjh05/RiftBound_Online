import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {applyAiAction,enumerateAiPolicyActions,enumerateLegalActions} from '../src/ai/actions.mjs';
import {tacticalActionProfile} from '../src/ai/action-tactics.mjs';
import {previewPublicContinuation} from '../src/ai/public-continuation.mjs';
import {reviewRuntimeTacticalAction} from '../src/ai/runtime-tactical-review.mjs';

const fixture=()=>JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/ai-annie-movement-eval76-20260928.json.gz',import.meta.url))));
const spell={kind:'beginPlayCard',cardId:'c19',destination:'base'};
const choose=id=>({kind:'chooseEffectOption',optionId:id});
const apply=(g,a)=>assert.ok(applyAiAction(g,a,'p1',{skipCombatPlan:true}).ok);
function destinations(g){
 apply(g,spell);apply(g,choose('c16'));
 assert.equal(g.pendingChoice.effect,'declareMoveDestination');
 return g;
}

for(const owners of [['p1','p2'],['p2','p1'],['p1','p1'],['p2','p2'],[null,null]]){
 test(`spell destinations ignore battlefield card ownership: ${owners.join('/')}`,()=>{
  const g=fixture();g.battlefields.forEach((f,i)=>{f.ownerId=owners[i];f.controllerId=owners[i];});
  destinations(g);const before=structuredClone(g);
  const legal=enumerateLegalActions(g,'p1'),policy=enumerateAiPolicyActions(g,'p1');
  assert.deepEqual(policy,legal);
  assert.deepEqual(policy.map(a=>a.optionId).sort(),['c3','c61']);
  for(const action of policy){
   const profile=tacticalActionProfile(g,'p1',action);
   assert.equal(profile.targetCardNumber,'OGN-185/298');
   assert.equal(profile.targetRelation,'friendly');
   assert.equal(profile.targetAlignment,0,'a destination is not a recipient of a ready effect');
  }
  assert.deepEqual(g,before);
 });
}

test('actual Annie loss retains the spell and compares the survival destination through combat and next-turn scoring',()=>{
 const g=fixture(),before=structuredClone(g);
 const hold=previewPublicContinuation(g,'p1',{kind:'endTurn'},{maximumStates:2048,returnGame:true});
 assert.equal(hold.game.winnerId,'p2');assert.equal(hold.game.players[1].score,8);
 const review=reviewRuntimeTacticalAction(g,'p1',{action:spell},null,{now:()=>0});
 assert.notEqual(review.selection.action.kind,'endTurn');
 assert.deepEqual(g,before);
 destinations(g);
 const decision=reviewRuntimeTacticalAction(g,'p1',{action:choose('c3')},null,{now:()=>0});
 assert.equal(decision.selection.action.optionId,'c61');
 const moved=previewPublicContinuation(g,'p1',choose('c61'),{maximumStates:2048,returnGame:true});
 assert.equal(moved.searchComplete,true);
 assert.equal(moved.game.battlefields.find(f=>f.instanceId==='c61').units.length,0);
 assert.equal(moved.game.battlefields.find(f=>f.instanceId==='c61').controlledBy,null);
 const end=previewPublicContinuation(moved.game,'p1',{kind:'endTurn'},{maximumStates:2048,returnGame:true});
 assert.equal(end.searchComplete,true);assert.equal(end.game.phase,'action');
 assert.deepEqual(end.game.players.map(p=>p.score),[1,7]);
 assert.equal(decision.review.correctionEligible,false);
 assert.equal(decision.review.winProbabilityLabel,false);
});

test('destination classification also handles resolution/hidden choices, base and enemy movers without inventing a recipient',()=>{
 for(const effect of ['moveUnitSpellDestination','declareHiddenMoveDestination','declareMoveDestination']){
  const g=destinations(fixture());
  g.pendingChoice.effect=effect;
  g.pendingChoice.data.unitId='c90';delete g.pendingChoice.data.targetId;
  g.pendingChoice.options.push({id:'base',destination:'base',cardId:null});
  for(const id of ['base','c61','c3']){
   const profile=tacticalActionProfile(g,'p1',choose(id));
   assert.equal(profile.targetCardNumber,'OGN-027/298');
   assert.equal(profile.targetAlignment,0);
  }
  delete g.pendingChoice.data.unitId;
  assert.equal(tacticalActionProfile(g,'p1',choose('c61')).targetRelation,'none');
 }
});

test('renamed cards and unseen hand/deck identities do not change the public survival choice',()=>{
 const g=destinations(fixture());
 for(const p of g.players){
  for(const c of p.mainDeck){c.name='Unknown';c.effects=[];}
  for(const c of p.hand){c.name='Renamed';if(p.id!=='p1')c.effects=[];}
 }
 g.pendingChoice.card.name='Generic move and ready';
 const decision=reviewRuntimeTacticalAction(g,'p1',{action:choose('c3')},null,{now:()=>0});
 assert.equal(decision.selection.action.optionId,'c61');
});
