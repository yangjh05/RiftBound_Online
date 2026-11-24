import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;const load=file=>import(pathToFileURL(path.join(runtime,file)));
test('inverse-projected steps are produced by native Adam with true moments and deterministic resume',{skip:!runtime},async()=>{
 const {tf,tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
 const {serializeOptimizer,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
 const {readAdamGeometry,gradientsForAdamDelta}=await load('scripts/adam-update-geometry.mjs');
 const variable=tf.variable(tf.tensor1d([.02,-.03]),true,'geometry_parameter'),name=variable.name;
 let optimizer=tf.train.adam(.0001),resumed=null;
 try{
  const g=tf.tensor1d([.2,-.1]);optimizer.applyGradients({[name]:g});g.dispose();
  const state=await serializeOptimizer(optimizer,1),base=Float32Array.from(variable.dataSync()),geometry=readAdamGeometry(optimizer,[name],[variable]);
  const desired=[Float64Array.from([-.00002,.00001])],inverse=gradientsForAdamDelta(desired,[Float64Array.from([.1,-.2])],[name],[variable],geometry,.0001);
  assert.equal(inverse.feasible,true);const gradient=tf.tensor1d(Float32Array.from(inverse.values[0]));optimizer.applyGradients({[name]:gradient});gradient.dispose();
  const after=Float32Array.from(variable.dataSync()),moments=await serializeOptimizer(optimizer,1);
  after.forEach((v,i)=>assert.ok(Math.abs(v-base[i]-desired[0][i])<5e-9));
  assert.equal(moments.weights[0].values[0],state.weights[0].values[0]+1);
  const first=moments.weights[1].values,second=moments.weights[2].values;
  for(let i=0;i<2;i++){
   const value=inverse.values[0][i];assert.ok(Math.abs(first[i]-(.9*state.weights[1].values[i]+.1*value))<1e-7);
   assert.ok(Math.abs(second[i]-(.999*state.weights[2].values[i]+.001*value*value))<1e-8);
  }
  tf.tidy(()=>variable.assign(tf.tensor1d(base)));resumed=await restoreAdamOptimizer(state,.0001);
  const again=tf.tensor1d(Float32Array.from(inverse.values[0]));resumed.applyGradients({[name]:again});again.dispose();
  assert.deepEqual(Float32Array.from(variable.dataSync()),after);
  assert.deepEqual((await serializeOptimizer(resumed,1)).weights,moments.weights);
 }finally{optimizer.dispose();resumed?.dispose();variable.dispose();}
});

test('an unreachable full Adam projection becomes reachable by shortening displacement at fixed learning rate',{skip:!runtime},async()=>{
 const {tf,tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
 const {serializeOptimizer,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
 const {readAdamGeometry,gradientsForAdamFraction}=await load('scripts/adam-update-geometry.mjs');
 const initial=tf.tensor1d([0,0]),variable=tf.variable(initial,true,'reachable_parameter');initial.dispose();
 const name=variable.name,optimizer=tf.train.adam(.0001);let resumed;
 try{
  const state=await serializeOptimizer(optimizer,1),geometry=readAdamGeometry(optimizer,[name],[variable]);
  const desired=[Float64Array.from([.00015,-.00015])],reference=[Float64Array.from([.2,-.1])];
  assert.equal(gradientsForAdamFraction(desired,1,reference,[name],[variable],geometry,.0001).feasible,false);
  // Reducing both displacement and LR leaves the old infeasibility intact.
  assert.equal(gradientsForAdamFraction(desired,.5,reference,[name],[variable],geometry,.00005).feasible,false);
  const inverse=gradientsForAdamFraction(desired,.5,reference,[name],[variable],geometry,.0001);assert.equal(inverse.feasible,true);
  const gradient=tf.tensor1d(Float32Array.from(inverse.values[0]));optimizer.applyGradients({[name]:gradient});gradient.dispose();
  const after=Float32Array.from(variable.dataSync()),moments=await serializeOptimizer(optimizer,1);
  after.forEach((v,i)=>assert.ok(Math.abs(v-desired[0][i]*.5)<1e-9));
  for(let i=0;i<2;i++){
   const g=inverse.values[0][i];assert.ok(Math.abs(moments.weights[1].values[i]-.1*g)<1e-12);
   assert.ok(Math.abs(moments.weights[2].values[i]-.001*g*g)<1e-18);
  }
  tf.tidy(()=>variable.assign(tf.zeros([2])));resumed=await restoreAdamOptimizer(state,.0001);
  const again=tf.tensor1d(Float32Array.from(inverse.values[0]));resumed.applyGradients({[name]:again});again.dispose();
  assert.deepEqual(Float32Array.from(variable.dataSync()),after);
  assert.deepEqual((await serializeOptimizer(resumed,1)).weights,moments.weights);
 }finally{optimizer.dispose();resumed?.dispose();variable.dispose();}
});
