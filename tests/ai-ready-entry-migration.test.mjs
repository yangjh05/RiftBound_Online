import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeuralModel,serializeNeuralModel,deserializeNeuralModel,disposeNeuralModel} from '../src/ai/neural/model.mjs';
import {STATE_DIM,CONTEXT_READY_FEATURES} from '../src/ai/neural/encoding.mjs';

test('pre-readiness checkpoints preserve every learned weight and zero-initialize only the new state rows',()=>{
 const source=createNeuralModel();
 let restored;
 try{
  const checkpoint=serializeNeuralModel(source);
  const oldRows=STATE_DIM-CONTEXT_READY_FEATURES;
  const kernel=checkpoint.weights.gru[0],width=kernel.shape[1];
  checkpoint.architecture.stateDim=oldRows;
  kernel.shape[0]=oldRows;
  kernel.values=kernel.values.slice(0,oldRows*width);
  restored=deserializeNeuralModel(checkpoint);
  const migrated=serializeNeuralModel(restored);
  assert.equal(migrated.architecture.stateDim,STATE_DIM);
  for(const [name,weights] of Object.entries(checkpoint.weights)){
   for(let i=0;i<weights.length;i++){
    if(name==='gru'&&i===0){
     assert.deepEqual(migrated.weights.gru[0].values.slice(0,oldRows*width),kernel.values);
     assert.ok(migrated.weights.gru[0].values.slice(oldRows*width).every(v=>v===0));
    }else assert.deepEqual(migrated.weights[name][i],weights[i]);
   }
  }
 }finally{disposeNeuralModel(source);if(restored)disposeNeuralModel(restored);}
});
