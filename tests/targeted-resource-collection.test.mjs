import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import zlib from 'node:zlib';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {collectTargetedDeckLessons} from '../scripts/collect-targeted-deck-lessons.mjs';
import {approvedTeacherAdvice} from '../scripts/viktor-candidate-learning.mjs';
import {assertResourceReplay,collectionRecordPath,quarantinedResourceReference,assertQuarantinedResource} from '../scripts/individual-study-execution.mjs';

test('resource collection reaches its existing teacher and admits only unchanged proof, with complete own history',async()=>{
  for(const condition of ['proved','partial','terminal','throw']){
    const game={phase:'action',players:[{id:'p1',hand:[]}],currentPlayerId:'p1'};let position=0,reviews=0;
    const actions=[{kind:'beginPlayCard',cardId:'spell'},{kind:'endTurn'}];
    const modules={
      'scripts/tactical-lesson-supply.mjs':{createSupplyGame:()=>game},
      'src/ai/neural/model.mjs':{createNeuralSession:()=>({decide:()=>({action:position?actions[0]:{kind:'moveUnit'},legalActions:actions,selectedIndex:0,legalCount:2,stateEncoding:[position],actionEncoding:[0,1],initialMemory:[]})}),inferStep:()=>({logits:[1,0]})},
      'src/ai/neural/encoding.mjs':{ACTION_DIM:1,CARD_BINS:1},
      'src/ai/actions.mjs':{activeActorId:()=> 'p1',enumerateAiPolicyActions:()=>actions,actionKey:a=>a.kind,
        applyAiAction:()=>{position++;if(position===2){game.phase='complete';game.winnerId='p1';}return {ok:true};}},
      'src/ai/payment-options.mjs':{needsPaymentOptionDecision:()=>false},'src/ai/payment-planner.mjs':{},
      'scripts/response-aware-demonstration.mjs':{TACTICAL_TEACHING_REVISION:'fixture',recommendSafeTacticalAction:()=>{throw Error('wrong-safe-teacher');},recommendResponseAwareAction:()=>{throw Error('wrong-response-teacher');}},
      'scripts/local-policy-learning.mjs':{localResourceDecision:(_g,_p,a)=>a.kind==='beginPlayCard',recommendLocalResourceDemonstration:()=>{
        reviews++;if(condition==='throw')throw Error('resource-teacher-error');
        return {action:actions[1],weight:.5,localResourceLesson:true,comparison:'same-result-less-spending',review:{applied:true,partialSearch:condition==='partial',comparisons:[{score:condition==='terminal'?1000:1}]}};
      }},
      'scripts/lesson-memory-context.mjs':{lessonMemoryContext:(actor,prefix)=>({actor,prefix,fromReset:true}),resolveLessonMemory:()=>[]},
      'scripts/tactical-lesson-learning.mjs':{assertLessonSample:(s,role)=>assert.equal(s.lessonRole,role)}
    };
    const result=await collectTargetedDeckLessons({load:async f=>modules[f],config:{deckId:'sett',decks:[{id:'sett'},{id:'annie'}],maxLessonActions:4,maximumVerifiedPerGame:12,maximumTeacherReviews:1},
      job:{id:'resource-fixture',target:'resource',role:'training',seed:1,chooser:'p1',deckIds:['sett','annie']},model:{},opponent:{}});
    assert.equal(reviews,1);assert.equal(result.diagnostics.teacherReviews,1);assert.equal(result.diagnostics.resourceReviews,1);
    assert.equal(result.resourceTeacherContract,'existing-local-resource-demonstration-v1');
    assert.equal(result.failure,condition==='throw'?'resource-teacher-error':null);
    assert.equal(result.samples.length,condition==='proved'?1:0);
    if(condition==='proved'){
      assert.deepEqual(result.samples[0].memoryContext.prefix,[[0]]);
      assert.equal(result.samples[0].steps[0].localResourceLesson,true);
      assert.equal(result.samples[0].lessonSource.proof.thresholdsUnchanged,true);
    }
  }
});

test('resource repair preserves original results and refuses different seeds, observations or existing nonempty labels',()=>{
  const old={job:{id:'x',target:'resource',seed:7},configHash:'same',failure:null,samples:[],summary:{completed:true,winnerId:'p1',actions:3},inputKeys:['a','b']};
  const fixed={...structuredClone(old),resourceTeacherContract:'existing-local-resource-demonstration-v1',samples:[{proved:true}]};
  assert.equal(assertResourceReplay(old,fixed).noNewSeeds,true);
  for(const change of [x=>x.job.seed++,x=>x.summary.winnerId='p2',x=>x.inputKeys.reverse(),x=>x.failure='teacher-error']){
    const bad=structuredClone(fixed);change(bad);assert.throws(()=>assertResourceReplay(old,bad));
  }
  assert.throws(()=>assertResourceReplay({...old,samples:[{}]},fixed));
  assert.match(collectionRecordPath('study','sett',old.job,{repair:{}}),/lessons-resource-r3/);
  assert.match(collectionRecordPath('study','sett',{id:'x',target:'response'},{repair:{}}),/lessons[\\/]x/);
});

const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;
test('only manifest-listed faulty resource jobs can be quarantined and cannot supply labels',()=>{
  const job={id:'r1',profileId:'sett',target:'resource'},ref={path:'original.gz',sha256:'hash'};
  const repair={contract:'local-resource-teacher-routing-quarantine-v2',quarantinedResourceJobs:[{jobId:'r1',profileId:'sett',original:ref}]};
  assert.deepEqual(quarantinedResourceReference(repair,job),ref);
  assert.equal(quarantinedResourceReference(repair,{...job,id:'next'}),null);
  assert.throws(()=>quarantinedResourceReference(repair,{...job,target:'response'}));
  const record={job,configHash:'config',failure:null,samples:[],summary:{completed:true}};
  assert.doesNotThrow(()=>assertQuarantinedResource(record,job,'config'));
  assert.throws(()=>assertQuarantinedResource({...record,samples:[{}]},job,'config'));
  assert.throws(()=>assertQuarantinedResource(record,job,'different'));
});
test('frozen real teacher retains verified savings and rejects useful spend and terminal shortcuts',{skip:!runtime},async()=>{
  const load=f=>import(pathToFileURL(path.join(runtime,f)));
  const {recommendLocalResourceDemonstration}=await load('scripts/local-policy-learning.mjs');
  const {restoreGameReferences}=await load('scripts/game-state-references.mjs');
  const {enumerateAiPolicyActions,actionKey}=await load('src/ai/actions.mjs');
  const states=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/ai-live-kaisa-20260926.json.gz',import.meta.url)))).states;
  const fixture=n=>{const s=structuredClone(states.find(x=>x.n===n));return {...s,game:restoreGameReferences(s.state,s.references)};};
  const review=s=>recommendLocalResourceDemonstration(s.game,'p2',{action:s.action,legalActions:enumerateAiPolicyActions(s.game,'p2')});
  for(const n of [178,206]){const s=fixture(n),before=JSON.stringify(s.game),advice=review(s);
    assert.equal(advice.localResourceLesson,true);
    // The old178 fixture has incomplete search. The unchanged stricter
    // collection gate must reject it even though the advisory teacher emits it.
    assert.equal(advice.review.partialSearch,n===178);
    assert.equal(approvedTeacherAdvice(advice,actionKey(s.action),actionKey),n===206);assert.equal(JSON.stringify(s.game),before);}
  const useful=fixture(206);useful.game.battlefields.flatMap(f=>f.units).find(c=>c.instanceId==='c21').might=3;
  useful.game.battlefields.flatMap(f=>f.units).find(c=>c.instanceId==='c98').might=6;
  assert.equal(review(useful),null);assert.equal(review(fixture(307)),null);
});
