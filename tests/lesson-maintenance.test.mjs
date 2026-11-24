import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LESSON_MAINTENANCE_CONTRACT,commonGradientWeights,commonLessonStep,readLessonMaintenance,commitLessonMaintenance,lessonSafetyGuard}
 from '../scripts/lesson-maintenance.mjs';
import {createNeuralModel,createNeuralSession,serializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {trainRecurrentPpo} from '../src/ai/neural/trainer.mjs';
import {enumerateLegalActions} from '../src/ai/actions.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
import {LESSON_FLAGS,measureLessonTypes,tacticalLessonGuard,lessonInputKey} from '../scripts/tactical-lesson-learning.mjs';
import {tf} from '../src/ai/neural/tf-runtime.mjs';

test('common gradient preserves every type instead of following a conflicting majority',()=>{
 for(const gram of [[[1,-.7],[-.7,1]],[[1,0,0],[0,1,0],[0,0,1]],[[1,-1],[-1,1]]]){
  const w=commonGradientWeights(gram);assert.ok(w);assert.ok(Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-10);
  for(const row of gram)assert.ok(row.reduce((s,x,i)=>s+x*w[i],0)>=-1e-8);
 }
 assert.throws(()=>commonGradientWeights([[NaN]]));
});

test('maintenance is optional, immutable and prospective',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lesson-maintenance-'));
 try{
  assert.equal(await readLessonMaintenance(root),null);
  const p={contract:LESSON_MAINTENANCE_CONTRACT,afterIteration:10,roundsPerEpoch:2,maximumStep:.0003,backtracks:6,validationProbabilityFloorRatio:.99,
   lessonProtocolHash:'a'.repeat(64),evaluationManifestSha256:'b'.repeat(64),evaluationRuntime:root,evaluationManifest:path.join(root,'manifest.json')};
  await writeFile(path.join(root,'lesson-maintenance-protocol.json'),JSON.stringify(p));
  assert.deepEqual(await readLessonMaintenance(root),p);
  const state={iteration:10,tacticalLessonLearningHash:p.lessonProtocolHash};commitLessonMaintenance(state,p);
  assert.throws(()=>commitLessonMaintenance(state,null));assert.throws(()=>commitLessonMaintenance(state,{...p,afterIteration:11}));
  assert.throws(()=>commitLessonMaintenance({iteration:11},p));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('confidence tolerance never permits forgetting an already correct held-out choice',()=>{
 const before={types:Object.fromEntries(Object.keys(LESSON_FLAGS).map(t=>[t,{decisions:2,policyLoss:1}])),correct:[true,false]};
 const after=structuredClone(before);after.types.resource.policyLoss=.9;after.types.growth.policyLoss=1.005;
 assert.equal(lessonSafetyGuard(before,after).passed,true);
 after.correct=[false,true];assert.equal(lessonSafetyGuard(before,after).passed,false);
 after.correct=[true,false];after.types.growth.policyLoss=1.1;assert.equal(lessonSafetyGuard(before,after).passed,false);
 after.types.growth.policyLoss=1.005;after.types.resource.policyLoss=1;assert.equal(lessonSafetyGuard(before,after).passed,false);
});

function example(model){
 const {game}=tacticalPosition();const d=createNeuralSession(model).decide(game,'p1',enumerateLegalActions(game,'p1'),{greedy:true});
 return {gameId:'maintenance',playerId:'p1',completed:true,imitation:true,lessonRole:'training',steps:[{
  state:d.stateEncoding,actions:d.actionEncoding,initialMemory:d.initialMemory,legalCount:d.legalCount,
  legalActionKeys:Array.from({length:d.legalCount},(_,i)=>`action-${i}`),selectedActionKey:`action-${d.selectedIndex}`,
  selectedIndex:d.selectedIndex,oldLogProbability:d.logProbability,beliefTarget:new Float32Array(d.belief.length),
  imitation:true,winProbabilityLabel:false,return:0,value:0,advantage:1,localResourceLesson:true}]};
}
test('real lesson gradients improve verified training targets without updating value, belief or recurrent weights',()=>{
 const model=createNeuralModel();
 try{
  const s=example(model),training=Object.keys(LESSON_FLAGS).map((t,i)=>{
   const a=structuredClone(s);a.steps[0].state[0]+=.01*i;
   delete a.steps[0].localResourceLesson;a.steps[0][LESSON_FLAGS[t]]=true;return a;
  });
  const bank={training,validation:[]},before=measureLessonTypes(model,training),weights=serializeNeuralModel(model).weights;
  const tensors=tf.memory().numTensors,result=commonLessonStep(model,bank),after=measureLessonTypes(model,training);
  assert.equal(result.applied,true);assert.equal(tacticalLessonGuard(before,after).passed,true);
  assert.ok(after.resource.policyLoss<before.resource.policyLoss);
  const updated=serializeNeuralModel(model).weights;
  for(const key of Object.keys(weights))if(!['stateProjection','actionProjection','actionBias'].includes(key))assert.deepEqual(updated[key],weights[key]);
  assert.equal(tf.memory().numTensors,tensors,'Gradient/snapshot tensors must be disposed');
  const held=structuredClone(s);held.lessonRole='validation';
  assert.throws(()=>commonLessonStep(model,{training:[held],validation:[]}),/boundary/);
  assert.throws(()=>commonLessonStep(model,{training:[s],validation:[held]}),/overlaps/);
  assert.throws(()=>commonLessonStep(model,{training:[s],validation:[],protectedValidationKeys:[lessonInputKey(s)]}),/overlaps/);
 }finally{disposeNeuralModel(model);}
});

test('PPO rejection atomically rolls back both ordinary training and pre-guard rehearsal',async()=>{
 const model=createNeuralModel();let trained;
 try{
  const s=example(model),before=serializeNeuralModel(model).weights;let called=0;
  const trajectory=structuredClone(s);delete trajectory.imitation;delete trajectory.steps[0].imitation;
  trajectory.steps[0].advantage=1;trajectory.steps[0].return=1;
  trained=await trainRecurrentPpo(model,[trajectory],{epochs:2,batchSize:1,learningRate:.001,
   beforeEpochGuard(){called++;commonLessonStep(model,{training:[s],validation:[]});},
   epochGuard(){return {passed:false,lessonRetention:{passed:false}};}});
  assert.equal(called,1);assert.equal(model.metadata.acceptedEpochs,0);
  assert.deepEqual(serializeNeuralModel(model).weights,before);
 }finally{trained?.optimizer.dispose();disposeNeuralModel(model);}
});
