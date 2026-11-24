import assert from 'node:assert/strict';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {forwardNeural} from '../src/ai/neural/model.mjs';
import {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE} from '../src/ai/neural/encoding.mjs';
import {LESSON_FLAGS,lessonTypes,assertLessonSample,lessonInputKey} from './tactical-lesson-learning.mjs';
import {contextualLessonSamples} from './lesson-memory-context.mjs';
import {differentiableLessonMemories} from './training-history-gradient.mjs';

export const ACTOR_LAYERS=['gru','stateProjection','actionProjection','actionBias','actionValue'];
function assertTrainingBank(bank){
 const held=new Set([...(bank.protectedValidationKeys||[]),...bank.validation.map(lessonInputKey)]);
 for(const sample of bank.training){assertLessonSample(sample,'training');assert.ok(!held.has(lessonInputKey(sample)),'Projection overlaps held-out input.');}
 for(const sample of bank.validation)assertLessonSample(sample,'validation');
}
// Gradients use only verified TRAINING labels, including the GRU and the Q
// head that actually contributes to policy logits. Held-out labels are never
// used to construct, select or project a gradient.
export function trainingLossDirections(model,bank){
 assertTrainingBank(bank);
 const variables=ACTOR_LAYERS.flatMap(n=>model.layers[n].trainableWeights.map(w=>w.val));
 const groups=Object.keys(LESSON_FLAGS).map(type=>({type,samples:bank.training.filter(s=>lessonTypes(s).includes(type))})).filter(x=>x.samples.length);
 return groups.map(({type,samples})=>{
  const sums=variables.map(v=>new Float64Array(v.size));
  for(let start=0;start<samples.length;start+=8){
   // Prefix and target remain on the same tape as the full recurrent guard.
   const batch=contextualLessonSamples(model,samples.slice(start,start+8)),n=batch.length,max=Math.max(...batch.map(s=>s.steps[0].legalCount));
   const states=new Float32Array(n*STATE_DIM),actions=new Float32Array(n*max*ACTION_DIM),memory=new Float32Array(n*NEURAL_HIDDEN_SIZE),mask=new Float32Array(n*max),selected=new Int32Array(n);
   batch.forEach((sample,i)=>{const s=sample.steps[0];assert.equal(sample.steps.length,1);states.set(s.state,i*STATE_DIM);memory.set(s.initialMemory,i*NEURAL_HIDDEN_SIZE);
    actions.set(s.actions.slice(0,s.legalCount*ACTION_DIM),i*max*ACTION_DIM);mask.fill(1,i*max,i*max+s.legalCount);selected[i]=s.selectedIndex;});
   const {value,grads}=tf.variableGrads(()=>tf.tidy(()=>{
    const output=forwardNeural(model,tf.tensor3d(states,[n,1,STATE_DIM]),tf.tensor4d(actions,[n,1,max,ACTION_DIM]),differentiableLessonMemories(model,batch),{teacherProposal:false,diagnostic:false,belief:false});
    const logits=tf.add(output.logits.reshape([n,max]),tf.mul(tf.sub(1,tf.tensor2d(mask,[n,max])),-1e9));
    return tf.neg(tf.mean(tf.sum(tf.mul(tf.logSoftmax(logits,-1),tf.oneHot(tf.tensor1d(selected,'int32'),max)),-1)));
   }),variables);
   try{variables.forEach((v,k)=>{const a=grads[v.name].dataSync();assert.ok(a.every(Number.isFinite));for(let j=0;j<a.length;j++)sums[k][j]+=a[j]*n/samples.length;});}
   finally{value.dispose();Object.values(grads).forEach(g=>g.dispose());}
  }
  const norm=Math.sqrt(sums.reduce((s,a)=>s+a.reduce((p,x)=>p+x*x,0),0));
  if(norm>1e-12)for(const a of sums)for(let j=0;j<a.length;j++)a[j]/=norm;
  return {type,norm,values:sums};
 }).filter(g=>g.norm>1e-12);
}
const dot=(a,b)=>{let result=0;for(let k=0;k<a.length;k++)for(let i=0;i<a[k].length;i++)result+=a[k][i]*b[k][i];return result;};
// Dykstra projections find the nearest feasible step in the intersection of
// all training loss half-spaces. Project the actual Adam weight DELTA, since
// projecting its raw gradients would be undone by Adam's preconditioning.
export function projectTrainingDelta(delta,directions,{passes=64,minimumDescent=0}={}){
 assert.ok(Number.isFinite(minimumDescent)&&minimumDescent>=0);
 assert.ok(delta.every(a=>a.every(Number.isFinite)),'Nonfinite Adam delta.');
 for(const g of directions){assert.equal(g.values.length,delta.length);g.values.forEach((a,k)=>{assert.equal(a.length,delta[k].length);assert.ok(a.every(Number.isFinite));});
  if(g.minimumDescent!=null)assert.ok(Number.isFinite(g.minimumDescent)&&g.minimumDescent>=0);}
 const required=directions.map(g=>Math.max(minimumDescent,g.minimumDescent??0));
 const projected=delta.map(a=>Float64Array.from(a)),corrections=directions.map(()=>0);
 const before=directions.map(g=>dot(g.values,delta));
 for(let pass=0;pass<passes;pass++){
  let largest=0;
  directions.forEach((g,k)=>{
   const d=dot(g.values,projected)+corrections[k],amount=Math.max(0,d+required[k]),change=corrections[k]-amount;
   if(change)for(let j=0;j<projected.length;j++)for(let i=0;i<projected[j].length;i++)projected[j][i]+=g.values[j][i]*change;
   corrections[k]=amount;largest=Math.max(largest,Math.abs(change));
  });
  if(largest<1e-10)break;
 }
 const after=directions.map(g=>dot(g.values,projected));
 return {delta:projected,before,after,feasible:after.every((x,k)=>x<=-required[k]+1e-8)};
}
export function applyTrainingProjection(model,base,proposal,directions){
 const tensors=ACTOR_LAYERS.flatMap(n=>base[n]),other=ACTOR_LAYERS.flatMap(n=>proposal[n]);
 const delta=tensors.map((v,k)=>{const a=v.dataSync(),b=other[k].dataSync();return Float64Array.from(a,(x,i)=>b[i]-x);});
 // Leave a small first-order descent margin: exactly tangent directions
 // otherwise increase a convex loss at second order and never pass the
 // unchanged nonlinear training guard, even after many tiny retries.
 const stepNorm=Math.sqrt(dot(delta,delta)),minimumDescent=.01*stepNorm;
 const projected=projectTrainingDelta(delta,directions,{minimumDescent}),projectedNorm=Math.sqrt(dot(projected.delta,projected.delta));let k=0;
 const feasible=projected.feasible&&projectedNorm>1e-12;
 if(feasible)for(const name of ACTOR_LAYERS)tf.tidy(()=>model.layers[name].setWeights(base[name].map(v=>tf.add(v,tf.tensor(Float32Array.from(projected.delta[k++]),v.shape)))));
 return {types:directions.map(g=>g.type),before:projected.before,after:projected.after,feasible,stepNorm,projectedNorm,minimumDescent};
}
