import assert from 'node:assert/strict';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {STATE_DIM,NEURAL_HIDDEN_SIZE} from '../src/ai/neural/encoding.mjs';

// Call INSIDE variableGrads. A dataSync/cached Float32 memory would detach the
// prefix from the GRU weights and differentiate a different function than the
// full-history acceptance check. Chunking bounds inputs, not the gradient.
export function differentiableLessonMemory(model,sample){
  const context=sample.memoryContext;
  if(!context)return tf.tensor2d(Array.from(sample.steps[0].initialMemory),[1,NEURAL_HIDDEN_SIZE]);
  assert.equal(context.contract,'complete-actor-observation-prefix-v1');
  assert.equal(context.playerId,sample.playerId);assert.equal(context.fromReset,true);
  assert.ok(Array.isArray(context.states));
  let memory=tf.zeros([1,NEURAL_HIDDEN_SIZE]);
  for(let start=0;start<context.states.length;start+=32){
    const part=context.states.slice(start,start+32),states=new Float32Array(part.length*STATE_DIM);
    part.forEach((s,i)=>{assert.equal(s.length,STATE_DIM);assert.ok(s.every(Number.isFinite));states.set(s,i*STATE_DIM);});
    const output=model.layers.gru.apply(tf.tensor3d(states,[1,part.length,STATE_DIM]),{initialState:[memory]});
    assert.ok(Array.isArray(output)&&output[1]);memory=output[1];
  }
  return memory;
}

export function differentiableLessonMemories(model,samples){
  return tf.concat(samples.map(s=>differentiableLessonMemory(model,s)),0);
}

// The private training runtime invokes this within its loss closure. Evaluation
// uses the already reconstructed exact memory and does not build another tape.
export function trainingInitialMemories(model,batch,fallback,{evaluateOnly=false}={}){
  if(evaluateOnly||!batch.memoryContexts?.some(Boolean))return fallback;
  assert.equal(batch.memoryContexts.length,batch.shape[0]);
  return tf.concat(batch.memoryContexts.map((context,i)=>context
    ?differentiableLessonMemory(model,{playerId:context.playerId,memoryContext:context})
    :fallback.slice([i,0],[1,NEURAL_HIDDEN_SIZE])),0);
}
