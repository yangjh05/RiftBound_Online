import test from 'node:test';
import assert from 'node:assert/strict';
import {projectTrainingDelta,trainingLossDirections,applyTrainingProjection,ACTOR_LAYERS} from '../scripts/ppo-training-projection.mjs';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {createNeuralModel,disposeNeuralModel,inferStep} from '../src/ai/neural/model.mjs';
import {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS} from '../src/ai/neural/encoding.mjs';
import {measureLessonTypes,lessonInputKey} from '../scripts/tactical-lesson-learning.mjs';
import {measureLessonRetention} from '../scripts/lesson-maintenance.mjs';
const dir=a=>({type:'test',values:[Float64Array.from(a)]});
test('actual Adam deltas are projected into all training half-spaces without discarding safe components',()=>{
 const a=projectTrainingDelta([Float64Array.from([1,-2])],[dir([1,0]),dir([0,1])]);
 assert.equal(a.feasible,true);assert.deepEqual(Array.from(a.delta[0]),[0,-2]);
 const s=Math.SQRT1_2,b=projectTrainingDelta([Float64Array.from([0,2])],[dir([s,s]),dir([s,-s])]);
 assert.ok(Math.abs(b.delta[0][0]+1)<1e-7);assert.ok(Math.abs(b.delta[0][1]-1)<1e-7);assert.equal(b.feasible,true);
 const c=projectTrainingDelta([Float64Array.from([2,3])],[dir([1,0]),dir([-1,0])]);
 assert.deepEqual(Array.from(c.delta[0]),[0,3]);
 const impossible=projectTrainingDelta([Float64Array.from([2,3])],[dir([1,0]),dir([-1,0])],{minimumDescent:.01});
 assert.equal(impossible.feasible,false);
});
const sample=()=>{const actions=new Float32Array(ACTION_DIM*2);actions[0]=1;const state=new Float32Array(STATE_DIM);state[1]=1;return {gameId:'projection',playerId:'p1',imitation:true,lessonRole:'training',steps:[{
 state,actions,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),beliefTarget:new Float32Array(CARD_BINS),legalCount:2,
 selectedIndex:0,legalActionKeys:['correct','wrong'],selectedActionKey:'correct',imitation:true,winProbabilityLabel:false,return:0,value:0,advantage:1,localResourceLesson:true}]};};
test('training gradients include shared memory and exclude protected inputs; projection leaks no tensors',()=>{
 const m=createNeuralModel();let base,proposal;
 try{
  const s=sample(),bank={training:[s],validation:[]},count=tf.memory().numTensors,d=trainingLossDirections(m,bank);
  assert.equal(tf.memory().numTensors,count);assert.deepEqual(d.map(g=>g.type),['resource']);
  assert.ok(d[0].values[0].some(x=>Math.abs(x)>1e-12));
  const snap=()=>Object.fromEntries(Object.entries(m.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));base=snap();
  // A deliberately ascending real training step must be removed.
  let k=0;for(const n of ACTOR_LAYERS)tf.tidy(()=>m.layers[n].setWeights(base[n].map(w=>tf.add(w,tf.mul(tf.tensor(Float32Array.from(d[0].values[k++]),w.shape),.0001)))));
  proposal=snap();const before=measureLessonTypes(m,bank.training).resource.policyLoss;
  const result=applyTrainingProjection(m,base,proposal,d);assert.equal(result.feasible,true);
  assert.ok(measureLessonTypes(m,bank.training).resource.policyLoss<before);
  assert.throws(()=>trainingLossDirections(m,{...bank,protectedValidationKeys:[lessonInputKey(s)]}),/held-out/);
  assert.throws(()=>trainingLossDirections(m,{training:[{...s,lessonRole:'validation'}],validation:[]}));
 }finally{for(const x of [base,proposal])if(x)Object.values(x).flat().forEach(w=>w.dispose());disposeNeuralModel(m);}
});
test('shared retention inference preserves the exact previous metrics and choices',()=>{
 const m=createNeuralModel();try{
  const a=sample(),b=sample();b.steps[0].state[1]=2;b.steps[0].selectedIndex=1;b.steps[0].selectedActionKey='wrong';
  const samples=[a,b,a],before=tf.memory().numTensors;
  const expected={types:measureLessonTypes(m,samples),correct:samples.map(s=>{const x=s.steps[0],v=inferStep(m,x.state,x.actions,x.legalCount,x.initialMemory).logits;return v.indexOf(Math.max(...v))===x.selectedIndex;})};
  assert.deepEqual(measureLessonRetention(m,samples),expected);assert.equal(tf.memory().numTensors,before);
 }finally{disposeNeuralModel(m);}
});
