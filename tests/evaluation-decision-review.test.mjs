import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {makeEvaluationReview,evaluationReviewOptions,evaluationReviewHash,assertEvaluationReviewSummary,
  commitEvaluationReviewRollout,EVALUATION_REVIEW_ROLLOUT} from '../scripts/evaluation-decision-review.mjs';
import {restoreGameReferences} from '../scripts/game-state-references.mjs';
import {evaluateNeuralModels} from '../src/ai/neural/selfplay.mjs';
import {createNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {decklists} from '../src/cards.mjs';
import {resolveTrainingDecks} from '../src/ai/training-decks.mjs';
import {canonicalTrainingFingerprint} from '../scripts/training-safety.mjs';

test('rollout is prospective, immutable, symmetric, and tied to the actual source',()=>{
 const review=makeEvaluationReview(),p={contract:EVALUATION_REVIEW_ROLLOUT,afterOrdinal:72,review},state={evaluationOrdinal:72};
 commitEvaluationReviewRollout(state,p);commitEvaluationReviewRollout(state,p);
 assert.throws(()=>commitEvaluationReviewRollout(state,null),/removed/);
 assert.throws(()=>commitEvaluationReviewRollout(state,{...p,afterOrdinal:73}),/changed/);
 assert.throws(()=>commitEvaluationReviewRollout({evaluationOrdinal:73},p),/rewrite/);
 assert.throws(()=>evaluationReviewOptions({...review,implementationHash:'a'.repeat(64)}),/changed/);
 assert.throws(()=>evaluationReviewOptions({...review,sides:'candidate'}),/symmetric/);
 assert.deepEqual(evaluationReviewOptions(null),{});
});

test('saved results cannot mix corrected and uncorrected decision paths',()=>{
 const decisionReview=makeEvaluationReview(),summary={decisionReviewHash:evaluationReviewHash(decisionReview),decisionReviewStats:[{},{}]};
 assertEvaluationReviewSummary({decisionReview},summary);assertEvaluationReviewSummary({},{});
 assert.throws(()=>assertEvaluationReviewSummary({decisionReview},{}),/different/);
 assert.throws(()=>assertEvaluationReviewSummary({},summary),/different/);
 const old={...decisionReview,runtimeContract:'bounded-public-runtime-review-v2',implementationHash:'a'.repeat(64)};
 assertEvaluationReviewSummary({decisionReview:old},{decisionReviewHash:evaluationReviewHash(old),decisionReviewStats:[{},{}]});
 assert.throws(()=>evaluationReviewOptions(old),/changed/);
 assert.throws(()=>assertEvaluationReviewSummary({decisionReview},
   {decisionReviewHash:evaluationReviewHash(old),decisionReviewStats:[{},{}]}),/different/);
 assert.throws(()=>assertEvaluationReviewSummary({decisionReview},{...summary,decisionReviewStats:[{}]}),/both-side/);
 assert.throws(()=>evaluateNeuralModels(null,null,[{id:'d'}],{resumedSummaries:[summary]}),/review changed/);
});

test('evaluation applies the live combat correction deterministically without changing the input',()=>{
 const states=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/ai-live-kaisa-20260926.json.gz',import.meta.url)))).states;
 const s=structuredClone(states.find(s=>s.n===206)),game=restoreGameReferences(s.state,s.references),before=JSON.stringify(game);
 const options=evaluationReviewOptions(makeEvaluationReview());
 const a=options.reviewDecision(game,'p2',{action:s.action},null),b=options.reviewDecision(game,'p2',{action:s.action},null);
 assert.equal(a.selection.action.kind,'passShowdown');assert.equal(a.review.applied,true);
 assert.deepEqual(a,b);assert.equal(JSON.stringify(game),before);
});

test('the shared game loop actually reviews both seats and records corrections',()=>{
 const model=createNeuralModel({seed:6123});const seen=new Set();
 try{
 const result=evaluateNeuralModels(model,model,resolveTrainingDecks(decklists,'origins-era',['origins-sett','origins-leona']),{games:4,maxActions:10,seed:152,
  decisionReviewHash:'test-identity',reviewDecision:(game,actorId,selection)=>{
   seen.add(actorId);return {selection,review:{reason:'retained',applied:false,previews:1}};
  }});
 assert.deepEqual([...seen].sort(),['p1','p2']);
 for(const game of result.summaries){
  assert.equal(game.decisionReviewHash,'test-identity');assert.equal(game.decisionReviewStats.length,2);
  assert.ok(game.decisionReviewStats.every(s=>s.decisions>0));
  assert.equal(game.decisionReviewStats.reduce((n,s)=>n+s.previews,0),game.decisionReviewStats.reduce((n,s)=>n+s.decisions,0));
 }
 }finally{disposeNeuralModel(model);}
});

test('reviewer failures invalidate evaluation rather than silently passing',()=>{
 const model=createNeuralModel({seed:6123});
 try{
 const result=evaluateNeuralModels(model,model,resolveTrainingDecks(decklists,'origins-era',['origins-sett','origins-leona']),{games:4,maxActions:10,seed:152,
  decisionReviewHash:'test-identity',reviewDecision:()=>({review:{reason:'review-error',error:'injected'}})});
 assert.equal(result.invalidGames,4);assert.ok(result.summaries.every(s=>s.invalidReason.kind==='evaluation-review-failed'));
 }finally{disposeNeuralModel(model);}
});

test('an additive evaluation rollout preserves training lineage only with an exact reviewed digest',()=>{
 const raw=`sha256:${'1'.repeat(64)}`,prior=`sha256:${'2'.repeat(64)}`;
 const entry={kind:'prospective-evaluation-review-v1',rawFingerprint:raw,compatibleFingerprint:prior,
  auditReport:'audit.md',onPolicyBehaviorPreserved:true,defaultEvaluationBehaviorPreserved:true,savedTargetsPreserved:true,explicitNewRequestIdentity:true};
 const manifest=e=>({version:1,entries:[e]});assert.equal(canonicalTrainingFingerprint(raw,manifest(entry)),prior);
 for(const key of ['onPolicyBehaviorPreserved','defaultEvaluationBehaviorPreserved','savedTargetsPreserved','explicitNewRequestIdentity'])
  assert.equal(canonicalTrainingFingerprint(raw,manifest({...entry,[key]:false})),raw);
 assert.equal(canonicalTrainingFingerprint(prior,manifest(entry)),prior);
});
