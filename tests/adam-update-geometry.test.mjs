import test from 'node:test';import assert from 'node:assert/strict';
import {adamScalarDelta,adamGradientForDelta} from '../scripts/adam-update-geometry.mjs';
test('Adam inversion reproduces desired steps with nonzero momentum and second moments',()=>{
  for(const t of [0,1,8,100])for(let i=0;i<100;i++){
    const state={m:t?Math.sin(i)*.03:0,v:t?.001+i*.00001:0,beta1:.9,beta2:.999,bias1:1-.9**(t+1),bias2:1-.999**(t+1),epsilon:1e-7,learningRate:.0001};
    const gradient=Math.cos(i)*.3,delta=adamScalarDelta(gradient,state),inverse=adamGradientForDelta(delta,state,gradient);
    assert.notEqual(inverse,null);assert.ok(Math.abs(adamScalarDelta(inverse,state)-delta)<1e-11);
    const zero=adamGradientForDelta(0,state,gradient);assert.ok(Math.abs(adamScalarDelta(zero,state))<1e-12);
  }
});
test('unattainable Adam steps are rejected without inventing optimizer moments',()=>{
  const state={m:0,v:0,beta1:.9,beta2:.999,bias1:.1,bias2:.001,epsilon:1e-7,learningRate:.0001};
  assert.equal(adamGradientForDelta(.1,state),null);
});
test('small reachable steps with saved momentum survive quadratic discriminant cancellation',()=>{
  const state={m:-0.00006284839764703065,v:1.0778832937319294e-8,bias1:1,bias2:1,learningRate:.0001};
  const gradient=.0005656361444588546,delta=adamScalarDelta(gradient,state);
  const inverse=adamGradientForDelta(delta,state,gradient);
  assert.notEqual(inverse,null);
  assert.ok(Math.abs(adamScalarDelta(inverse,state)-delta)<=Math.abs(delta)*1e-7);
});
