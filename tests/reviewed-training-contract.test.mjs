import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,assertLessonAugmentation} from '../scripts/deck-league-contract.mjs';
import {assertRulesRuntimeLaneTransition,assertApprovedEvaluationBinding,evaluationRuleScope} from '../scripts/reviewed-training-contract.mjs';

function lanes(){
 const runtime={directory:'old',manifest:{path:'old-manifest',sha256:'a'},engineFingerprint:'old-rules'};
 const nextRuntime={directory:'new',manifest:{path:'new-manifest',sha256:'b'},engineFingerprint:'new-rules'};
 const previous={directory:'evaluation',workers:3,runtime,config:{path:'old-config',sha256:'c'},inputProtocol:{path:'old-protocol',sha256:'d'},diagnosticInputs:{path:'protected',sha256:'e'}};
 const next={...previous,runtime:nextRuntime,config:{path:'new-config',sha256:'f'},inputProtocol:{path:'new-protocol',sha256:'g'},
  legacyBindings:[{runtime,config:previous.config,inputProtocol:previous.inputProtocol}]};
 const previousConfig={runtimeDirectory:'old',runtimeManifest:runtime.manifest,engineFingerprint:'old-rules',evaluation:{alpha:.05},seed:123};
 const nextConfig={...previousConfig,runtimeDirectory:'new',runtimeManifest:nextRuntime.manifest,engineFingerprint:'new-rules'};
 const queue=[{profileId:'kaisa',iteration:40,evaluationRequest:{path:'old-request',sha256:'h'}}];
 const context={previousConfig,nextConfig,previousProtocol:{configHash:digest(previousConfig),afterIterations:{kaisa:0},evaluationDataTraining:false},
  nextProtocol:{configHash:digest(nextConfig),afterIterations:{kaisa:134},evaluationDataTraining:false},boundaryIterations:{kaisa:134},queue,boundaryQueueHash:digest(queue)};
 return {previous,next,context};
}
test('rules transition preserves queue, budgets, seeds and old runtime binding',()=>{
 const {previous,next,context}=lanes();assert.equal(assertRulesRuntimeLaneTransition(previous,next,digest(previous),context),digest(next));
 for(const b of [{runtime:next.runtime,config:next.config,inputProtocol:next.inputProtocol},...next.legacyBindings])
  assertApprovedEvaluationBinding(next,{runtime:b.runtime,config:b.config,pending:{inputProtocol:b.inputProtocol},workers:3});
});
for(const [name,change]of Object.entries({budget:x=>x.context.nextConfig.evaluation={alpha:.5},seed:x=>x.context.nextConfig.seed=124,
 queue:x=>x.context.queue.push({iteration:44}),legacy:x=>x.next.legacyBindings=[],sameFingerprint:x=>x.next.runtime.engineFingerprint='old-rules',
 workerCount:x=>x.next.workers=4,protocol:x=>x.context.nextProtocol.evaluationDataTraining=true}))
 test('rules transition rejects '+name,()=>{const x=lanes();change(x);assert.throws(()=>assertRulesRuntimeLaneTransition(x.previous,x.next,digest(x.previous),x.context));});
test('old requests cannot silently use new rules or a different protocol',()=>{
 const {previous,next}=lanes();
 assert.throws(()=>assertApprovedEvaluationBinding(next,{runtime:next.runtime,config:previous.config,pending:{inputProtocol:previous.inputProtocol},workers:3}));
 assert.throws(()=>assertApprovedEvaluationBinding(next,{runtime:previous.runtime,config:previous.config,pending:{inputProtocol:next.inputProtocol},workers:3}));
});
test('old-rule results retain their real identity and cannot promote or reset current-rule learners',()=>{
 assert.deepEqual(evaluationRuleScope('old-rules','new-rules'),{evaluationEngineFingerprint:'old-rules',currentRuleEvidence:false});
 assert.deepEqual(evaluationRuleScope('new-rules','new-rules'),{evaluationEngineFingerprint:'new-rules',currentRuleEvidence:true});
});
const key=JSON.stringify;
function lesson(){const sourceDeck={legend:'KaiSa',main:['one']},advice={action:{kind:'pass'},weight:.5,localResourceLesson:true};
 return {contract:'reviewed-matchup-policy-curriculum-v1',deckId:'conversation-deck-'+digest(sourceDeck),lessonRole:'training',
 transfer:{targetDeckId:'target',sourceDeck,sourceLegend:'KaiSa',targetLegend:'KaiSa'},
 lessonSource:{role:'training',allBranchesTrainingOnly:true,proof:{kind:'reviewed-public-teacher-v1',thresholdsUnchanged:true,globalOptimalityClaim:false,
  completeLegalReplay:true,publicInputsOnly:true,manualChoiceIsNotLabel:true,baseline:{kind:'endTurn'},advice}},
 memoryContext:{contract:'complete-actor-observation-prefix-v1',fromReset:true},steps:[{state:[1],actions:[2],legalCount:2,selectedActionKey:key(advice.action),
  advantage:.5,return:0,value:0,winProbabilityLabel:false,localResourceLesson:true}]};}
const teacher={approve:(a,current,k)=>a.weight===.5&&k(a.action)!==current,actionKey:key,targetLegend:'KaiSa'};
test('reviewed augmentation retains original bank and source deck identity',()=>{
 const original={bank:{training:[],validation:[{protected:true}]}},s=lesson(),augmented={bank:{training:[s],validation:original.bank.validation}};
 assert.equal(assertLessonAugmentation(original,augmented,'target',new Set(),teacher),1);
});
for(const [name,change]of Object.entries({unverified:s=>s.lessonSource.proof.advice.weight=0,private:s=>s.lessonSource.proof.publicInputsOnly=false,
 relabel:s=>s.deckId='target',otherLegend:s=>s.transfer.targetLegend='Viktor',fakeLabel:s=>s.steps[0].selectedActionKey=key({kind:'endTurn'}),
 terminal:s=>s.steps[0].winProbabilityLabel=true,truncatedMemory:s=>s.memoryContext.fromReset=false}))
 test('reviewed augmentation rejects '+name,()=>{const s=lesson();change(s);assert.throws(()=>assertLessonAugmentation({bank:{training:[],validation:[]}},
  {bank:{training:[s],validation:[]}},'target',new Set(),teacher));});
