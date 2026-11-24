import assert from 'node:assert/strict';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {STATE_DIM,NEURAL_HIDDEN_SIZE} from '../src/ai/neural/encoding.mjs';

export const LESSON_MEMORY_CONTEXT='complete-actor-observation-prefix-v1';
const modelCaches=new WeakMap();

// Only the acting player's encoded observations belong in its recurrent
// history. Do not substitute a truncated prefix or another model's memory.
export function lessonMemoryContext(playerId,states){
  return {contract:LESSON_MEMORY_CONTEXT,playerId,fromReset:true,
    states:states.map(state=>Array.from(state))};
}
export function resolveLessonMemory(model,sample){
  const context=sample.memoryContext;
  if(!context)return sample.steps[0].initialMemory; // Explicit legacy coverage, never claimed as reconstructed.
  assert.equal(context.contract,LESSON_MEMORY_CONTEXT);
  assert.equal(context.playerId,sample.playerId);assert.equal(context.fromReset,true);
  assert.ok(Array.isArray(context.states));
  // TF Variable.assign replaces the backing dataId even when its variable
  // name is unchanged. Reuse burn-in only while EVERY GRU weight is identical.
  // Policy-head-only line searches need not replay the same prefix repeatedly.
  const ids=model.layers.gru.trainableWeights.map(w=>w.val.dataId);
  const cacheable=ids.length>0&&ids.every(id=>id&&typeof id==='object');
  let cache=cacheable?modelCaches.get(model):null;
  if(cacheable&&(!cache||cache.ids.some((id,i)=>id!==ids[i]))){cache={ids,memories:new WeakMap()};modelCaches.set(model,cache);}
  if(cache?.memories.has(context))return cache.memories.get(context).slice();
  let memory=new Float32Array(NEURAL_HIDDEN_SIZE);
  for(let start=0;start<context.states.length;start+=32){
    const states=context.states.slice(start,start+32),data=new Float32Array(states.length*STATE_DIM);
    states.forEach((s,i)=>{assert.equal(s.length,STATE_DIM);assert.ok(s.every(Number.isFinite));data.set(s,i*STATE_DIM);});
    memory=tf.tidy(()=>{
      const result=model.layers.gru.apply(tf.tensor3d(data,[1,states.length,STATE_DIM]),
        {initialState:[tf.tensor2d(memory,[1,NEURAL_HIDDEN_SIZE])]});
      assert.ok(Array.isArray(result)&&result[1]);
      return Float32Array.from(result[1].dataSync());
    });
  }
  assert.ok(memory.every(Number.isFinite));
  if(cache){
    // Archived contexts are immutable evidence; freeze the nested plain arrays
    // before caching so a mutated history cannot reuse an old result.
    for(const state of context.states)if(Array.isArray(state))Object.freeze(state);
    Object.freeze(context.states);Object.freeze(context);cache.memories.set(context,memory.slice());
  }
  return memory;
}
export function contextualLessonSamples(model,samples){
  return samples.map(sample=>sample.memoryContext?{...sample,steps:sample.steps.map((step,index)=>{
    assert.equal(index,0,'Contextual lessons must be one-step targets.');
    return {...step,initialMemory:resolveLessonMemory(model,sample)};
  })}:sample);
}
export function lessonMemoryCoverage(samples){
  const contextual=samples.filter(s=>s.memoryContext).length;
  return {total:samples.length,reconstructed:contextual,legacyStoredMemory:samples.length-contextual};
}
