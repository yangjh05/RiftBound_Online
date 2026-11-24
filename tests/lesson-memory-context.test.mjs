import test from 'node:test';
import assert from 'node:assert/strict';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {createNeuralModel,createNeuralSession,disposeNeuralModel,inferStep} from '../src/ai/neural/model.mjs';
import {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE} from '../src/ai/neural/encoding.mjs';
import {lessonMemoryContext,resolveLessonMemory,contextualLessonSamples,lessonMemoryCoverage} from '../scripts/lesson-memory-context.mjs';
import {measureLessonTypes} from '../scripts/tactical-lesson-learning.mjs';

test('complete actor prefix reconstructs the live session at every model, including across chunk boundaries',()=>{
  const model=createNeuralModel(),states=Array.from({length:35},(_,i)=>Float32Array.from({length:STATE_DIM},(_,j)=>Math.sin(i+j)*.1));
  const actions=new Float32Array(ACTION_DIM*2);actions[6]=1;actions[ACTION_DIM+20]=1;
  const sample={playerId:'p1',memoryContext:lessonMemoryContext('p1',states),steps:[{state:states[0],actions,legalCount:2,
    initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE).fill(99),selectedIndex:0,mulliganLesson:true}]};
  const original=JSON.stringify(sample);
  try{
    let previous;
    for(let round=0;round<2;round++){
      const session=createNeuralSession(model);
      for(const state of states){
        session.decideEncoded('p1',{stateEncoding:state,actions:[{},{}],actionEncoding:actions,legalCount:2},{greedy:true});
        session.decideEncoded('p2',{stateEncoding:states[1],actions:[{},{}],actionEncoding:actions,legalCount:2},{greedy:true});
      }
      const count=tf.memory().numTensors,memory=resolveLessonMemory(model,sample);
      memory.forEach((x,i)=>assert.ok(Math.abs(x-session.memory('p1')[i])<1e-5));
      if(previous)assert.ok(memory.some((x,i)=>Math.abs(x-previous[i])>1e-4));previous=memory;
      const measured=measureLessonTypes(model,[sample]),logits=inferStep(model,sample.steps[0].state,actions,2,memory).logits;
      const target=1/(1+Math.exp(logits[1]-logits[0]));assert.ok(Math.abs(measured.mulligan.meanTargetProbability-target)<1e-6);
      assert.deepEqual(contextualLessonSamples(model,[sample])[0].steps[0].initialMemory,memory);
      assert.equal(tf.memory().numTensors,count);assert.equal(JSON.stringify(sample),original);
      tf.tidy(()=>model.layers.gru.setWeights(model.layers.gru.getWeights().map(w=>tf.add(w,.003))));
    }
    for(const change of [c=>c.playerId='p2',c=>c.fromReset=false,c=>c.states[0]=[0]]){
      const bad=structuredClone(sample);change(bad.memoryContext);assert.throws(()=>resolveLessonMemory(model,bad));
    }
  }finally{disposeNeuralModel(model);}
});
test('legacy memory is explicitly preserved, never fabricated from an incomplete history',()=>{
  const sample={steps:[{initialMemory:[1,2,3]}]};assert.equal(resolveLessonMemory(null,sample),sample.steps[0].initialMemory);
  assert.deepEqual(lessonMemoryCoverage([sample]),{total:1,reconstructed:0,legacyStoredMemory:1});
});
