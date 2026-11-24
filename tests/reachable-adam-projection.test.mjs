import test from 'node:test';import assert from 'node:assert/strict';
import {adamGradientForDelta,adamScalarDelta} from '../scripts/adam-update-geometry.mjs';
import {adamReachableInterval,projectReachableAdamDelta} from '../scripts/reachable-adam-projection.mjs';
import {queryTrainingCapacity} from '../scripts/training-process-capacity.mjs';
test('every interior bound has an actual inverse with zero and asymmetric old moments',()=>{
 for(const m of [0,-.003,.003,-.3,.3])for(const v of [0,.00001,.1])for(const step of [1,4,73]){
  const state={m,v,beta1:.9,beta2:.999,bias1:1-.9**step,bias2:1-.999**step,epsilon:1e-7,learningRate:.0001};
  const {lower,upper}=adamReachableInterval(state);
  for(const fraction of [0,.01,.25,.5,.75,.99,1]){const delta=lower+(upper-lower)*fraction,g=adamGradientForDelta(delta,state);
   assert.notEqual(g,null,JSON.stringify({state,delta}));assert.ok(Math.abs(adamScalarDelta(g,state)-delta)<1e-9);}
 }
});
test('joint projection finds a reachable choice that project-then-invert would miss',()=>{
 const delta=[Float64Array.from([1,0])],directions=[{values:[Float64Array.from([Math.SQRT1_2,-Math.SQRT1_2])]}];
 const bounds={lower:[Float64Array.from([0,0])],upper:[Float64Array.from([1,.1])]};
 const result=projectReachableAdamDelta(delta,directions,bounds,{maximumNorm:2});
 assert.equal(result.feasible,true);assert.ok(result.delta[0][0]<=.10000002);assert.ok(result.delta[0][1]<=.1);
 const impossible=projectReachableAdamDelta(delta,[{values:[Float64Array.from([-1,0])],minimumDescent:2}],bounds,{maximumNorm:2});
 assert.equal(impossible.feasible,false);
});
test('unavailable capacity is retried with bounded backoff and never reported as an empty host',async()=>{
 let calls=0;const sleeps=[];const failed=await queryTrainingCapacity(async()=>{calls++;throw Error('CIM unavailable');},x=>x,{sleep:async ms=>sleeps.push(ms)});
 assert.equal(calls,3);assert.equal(failed.known,false);assert.equal(failed.active,null);assert.deepEqual(sleeps,[250,1000]);
 calls=0;const recovered=await queryTrainingCapacity(async()=>{if(++calls<3)throw Error('transient');return [{pid:7}];},x=>x,{sleep:async()=>{}});
 assert.deepEqual(recovered.active,[{pid:7}]);assert.equal(recovered.known,true);assert.equal(calls,3);
});
test('exact-zero sparse calculation is numerically identical to dense projection including nonconvergence',()=>{
 const delta=[Float64Array.from({length:2048},(_,i)=>Math.sin(i)*.01),Float64Array.from({length:63},(_,i)=>Math.cos(i)*.02)];
 const bounds={lower:delta.map(a=>Float64Array.from(a,()=>-.008)),upper:delta.map(a=>Float64Array.from(a,()=>.013))};
 const directions=Array.from({length:7},(_,j)=>({values:delta.map(a=>Float64Array.from(a,(_,i)=>i%17===j?Math.sin(i+j):0)),minimumDescent:j*.0001}));
 for(const passes of [1,9,128]){
  const options={passes,maximumNorm:.1,minimumDescent:.001};
  const dense=projectReachableAdamDelta(delta,directions,bounds,{...options,sparse:false}),sparse=projectReachableAdamDelta(delta,directions,bounds,options);
  assert.deepEqual(sparse,dense);
 }
});
