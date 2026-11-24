import test from 'node:test';
import assert from 'node:assert/strict';
import {cards} from '../src/cards.mjs';
import {applyAiAction,enumerateAiPolicyActions} from '../src/ai/actions.mjs';
import {createNeuralModel,serializeNeuralModel,deserializeNeuralModel,disposeNeuralModel,
 createNeuralSession,evaluatePpoBatchPolicyRatios} from '../src/ai/neural/model.mjs';
import {packPpoBatch} from '../src/ai/neural/trainer.mjs';
import {ACTION_DIM} from '../src/ai/neural/encoding.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';

test('480-input checkpoints preserve learned weights and zero-initialize new strategic-cost rows',()=>{
 const original=createNeuralModel();let restored;
 try{
  const old=serializeNeuralModel(original);old.architecture.actionDim=480;
  for(const name of ['actionProjection','actionBias']){
   const kernel=old.weights[name][0],width=kernel.shape[1];
   kernel.shape[0]=480;kernel.values=kernel.values.slice(0,480*width);
  }
  restored=deserializeNeuralModel(old);const migrated=serializeNeuralModel(restored);
  assert.equal(migrated.architecture.actionDim,ACTION_DIM);
  for(const [name,weights] of Object.entries(old.weights))for(const [i,w] of weights.entries()){
   assert.deepEqual(migrated.weights[name][i].values.slice(0,w.values.length),w.values);
   assert.ok(migrated.weights[name][i].values.slice(w.values.length).every(v=>v===0));
  }
 }finally{disposeNeuralModel(original);if(restored)disposeNeuralModel(restored);}
});

test('optional-cost policy probabilities are normalized and reproduce exact PPO behavior ratios',()=>{
 const {game,actor}=tacticalPosition({enemy:false});
 actor.hand=[{...structuredClone(cards.thousandTailedWatcher),instanceId:'watcher',ownerId:'p1',controllerId:'p1'}];
 actor.runes.forEach(r=>r.domain='Mind');
 assert.ok(applyAiAction(game,{kind:'beginPlayCard',cardId:'watcher',destination:'base'},'p1').ok);
 const model=createNeuralModel();
 try{
  const decision=createNeuralSession(model).decide(game,'p1',enumerateAiPolicyActions(game,'p1'),{temperature:0.7,random:()=>0.4});
  assert.equal(decision.legalCount,2);
  assert.ok(Math.abs(decision.probabilities.reduce((a,b)=>a+b,0)-1)<1e-6);
  const batch=packPpoBatch([{steps:[{state:decision.stateEncoding,actions:decision.actionEncoding,
   initialMemory:decision.initialMemory,selectedIndex:decision.selectedIndex,legalCount:decision.legalCount,
   oldLogProbability:decision.logProbability,behaviorTemperature:0.7,advantage:1,return:0,value:decision.value,
   beliefTarget:new Float32Array(decision.belief.length)}]}]);
  assert.ok(Math.abs(evaluatePpoBatchPolicyRatios(model,batch)[0]-1)<1e-5);
 }finally{disposeNeuralModel(model);}
});
