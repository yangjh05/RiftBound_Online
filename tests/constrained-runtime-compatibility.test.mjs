import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {epochUpdateEvidence} from '../scripts/constrained-epoch-evidence.mjs';

test('an unchanged epoch cannot be counted as a successful update',()=>{
  assert.equal(epochUpdateEvidence([{epoch:1,accepted:false}],1,'a','a').passed,false);
  assert.equal(epochUpdateEvidence([{epoch:1,accepted:true}],1,'a','a').passed,false);
  assert.equal(epochUpdateEvidence([{epoch:1,accepted:true}],2,'a','b').passed,false);
  assert.equal(epochUpdateEvidence([{epoch:1,accepted:true}],1,'a','b').passed,true);
});

test('private runtime preserves default inference and ordinary PPO',{skip:!process.env.RIFTBOUND_CONSTRAINED_RUNTIME},async()=>{
  const baseline=path.resolve(process.env.RIFTBOUND_BASELINE_RUNTIME||'data/ai/deck-league-20261007/runtime-r4');
  const experimental=path.resolve(process.env.RIFTBOUND_CONSTRAINED_RUNTIME);
  const load=(root,file)=>import(pathToFileURL(path.join(root,file)));
  const b=await load(baseline,'src/ai/neural/model.mjs'),n=await load(experimental,'src/ai/neural/model.mjs');
  const {tf,tfBackend}=await load(experimental,'src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
  const {packPpoBatch}=await load(experimental,'src/ai/neural/trainer.mjs');
  const {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS}=await load(experimental,'src/ai/neural/encoding.mjs');
  const source=b.createNeuralModel(),a=b.deserializeNeuralModel(b.serializeNeuralModel(source)),c=n.deserializeNeuralModel(b.serializeNeuralModel(source));
  const oa=tf.train.adam(.0001),oc=tf.train.adam(.0001);
  try{
    const state=Float32Array.from({length:STATE_DIM},(_,i)=>Math.cos(i)*.03),actions=new Float32Array(2*ACTION_DIM);
    actions[6]=1;actions[ACTION_DIM+20]=1;
    const first=b.inferStep(a,state,actions,2,new Float32Array(NEURAL_HIDDEN_SIZE));
    const other=n.inferStep(c,state,actions,2,new Float32Array(NEURAL_HIDDEN_SIZE));
    assert.deepEqual(first,other);
    const step={state,actions,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),legalCount:2,selectedIndex:0,
      oldLogProbability:-Math.log(2),behaviorTemperature:1,advantage:1,return:.5,value:0,
      beliefTarget:new Float32Array(CARD_BINS),imitation:false,winProbabilityLabel:true};
    const batch=packPpoBatch([{playerId:'p1',gameId:'compatibility-fixture',steps:[step]}],{ignoreCorrectionSignals:true});
    const options={teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,beliefCoefficient:0,
      anchorModels:[{model:source,weight:1}],anchorCoefficient:.05};
    for(let i=0;i<2;i++){
      assert.deepEqual(b.trainPpoBatch(a,batch,oa,options),n.trainPpoBatch(c,batch,oc,options));
      assert.deepEqual(b.serializeNeuralModel(a).weights,n.serializeNeuralModel(c).weights);
    }
  }finally{oa.dispose();oc.dispose();[source,a].forEach(b.disposeNeuralModel);n.disposeNeuralModel(c);}
});
