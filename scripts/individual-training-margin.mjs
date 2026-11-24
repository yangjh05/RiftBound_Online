import assert from 'node:assert/strict';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {forwardNeural,inferStep} from '../src/ai/neural/model.mjs';
import {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE} from '../src/ai/neural/encoding.mjs';
import {resolveLessonMemory} from './lesson-memory-context.mjs';
import {differentiableLessonMemory,differentiableLessonMemories} from './training-history-gradient.mjs';
import {assertLessonSample,lessonInputKey} from './tactical-lesson-learning.mjs';

export const INDIVIDUAL_MARGIN = Object.freeze({floor:.05,coefficient:.25,tolerance:1e-7});
export function choiceMargin(logits,target){
  assert.ok(logits.length>1&&logits.every(Number.isFinite));
  assert.ok(Number.isInteger(target)&&target>=0&&target<logits.length);
  const rival=Math.max(...logits.filter((_,i)=>i!==target));
  return {correct:logits.indexOf(Math.max(...logits))===target,margin:logits[target]-rival};
}
export function individualMarginGuard(before,after,config=INDIVIDUAL_MARGIN){
  assert.equal(before.length,after.length);
  const failures=[];
  before.forEach((b,i)=>{
    assert.equal(b.key,after[i].key,'Training case order changed');
    const a=after[i];
    if(!Number.isFinite(a.margin))failures.push({key:b.key,reason:'nonfinite'});
    if(b.correct&&!a.correct)failures.push({key:b.key,reason:'lost-correct-choice'});
    // Once a correct TRAINING choice has a useful buffer, allow movement
    // within it. A fragile choice cannot be sacrificed to a category mean.
    if(b.correct&&a.margin+config.tolerance<Math.min(config.floor,b.margin))
      failures.push({key:b.key,reason:'individual-training-margin'});
  });
  return {passed:!failures.length,failures};
}
export function measureIndividualTraining(model,samples){
  return samples.map(s=>{
    assertLessonSample(s,'training');const t=s.steps[0];
    const {logits}=inferStep(model,t.state,t.actions,t.legalCount,resolveLessonMemory(model,s));
    return {key:lessonInputKey(s),...choiceMargin(logits,t.selectedIndex)};
  });
}
// Only independently verified TRAINING labels enter this objective. All
// observation prefixes are recomputed at the current model before each trial.
// The existing held-out guard remains outside proposal construction.
export function individualMarginDirections(model,samples,variables,config=INDIVIDUAL_MARGIN,snapshot=null,requiredChoices=new Set()){
  const directions=[];
  for(const s of samples){
    assertLessonSample(s,'training');const t=s.steps[0],cached=snapshot?.get(s);
    if(snapshot)assert.ok(cached,'Training snapshot is incomplete');
    const memory=cached?.memory||resolveLessonMemory(model,s);
    const measured=cached||choiceMargin(inferStep(model,t.state,t.actions,t.legalCount,memory).logits,t.selectedIndex);
    if(measured.margin>=config.floor)continue;
    const {value,grads}=tf.variableGrads(()=>tf.tidy(()=>{
      const out=forwardNeural(model,tf.tensor3d(Array.from(t.state),[1,1,STATE_DIM]),
        tf.tensor4d(Array.from(t.actions).slice(0,t.legalCount*ACTION_DIM),[1,1,t.legalCount,ACTION_DIM]),
        differentiableLessonMemory(model,s),{teacherProposal:false,diagnostic:false,belief:false});
      const scores=out.logits.reshape([t.legalCount]),one=tf.oneHot(tf.scalar(t.selectedIndex,'int32'),t.legalCount);
      const selected=tf.sum(tf.mul(scores,one)),rival=tf.max(tf.sub(scores,tf.mul(one,1e9)));
      return tf.relu(tf.add(tf.sub(rival,selected),config.floor));
    }),variables);
    try{
      const values=variables.map(v=>Float64Array.from(grads[v.name]?.dataSync()||new Float32Array(v.size)));
      assert.ok(values.every(a=>a.every(Number.isFinite)));
      const norm=Math.sqrt(values.reduce((n,a)=>n+a.reduce((s,x)=>s+x*x,0),0));
      if(norm>1e-12){
        const recovery=requiredChoices.has(lessonInputKey(s))&&!measured.correct;
        directions.push({type:'individual:'+lessonInputKey(s),values,norm,loss:value.dataSync()[0],
          ...(recovery?{requiredRecovery:true,minimumDescent:(Math.max(0,-measured.margin)+config.tolerance)/norm}: {})});
      }
    }finally{value.dispose();Object.values(grads).forEach(g=>g.dispose());}
  }
  return directions;
}

// The hinge objective still includes EVERY active training case. Accumulate
// small batches instead of retaining one model-sized gradient per example.
// The bounded working set below proposes a direction; it is never an
// acceptance criterion. individualMarginGuard still checks the complete bank.
export function streamedIndividualMargins(model,samples,variables,{batchSize=8,maximumDirections=8,config=INDIVIDUAL_MARGIN,snapshot=null,requiredChoices=new Set()}={}){
  assert.ok(Number.isInteger(batchSize)&&batchSize>0);
  assert.ok(Number.isInteger(maximumDirections)&&maximumDirections>=0);
  const measured=snapshot?samples.map(s=>{
    const item=snapshot.get(s);assert.ok(item,'Training snapshot is incomplete');return item;
  }):measureIndividualTraining(model,samples);
  const active=samples.map((sample,i)=>({sample,...measured[i],index:i})).filter(s=>s.margin<config.floor);
  const sums=variables.map(v=>new Float64Array(v.size));
  for(let start=0;start<active.length;start+=batchSize){
    const part=active.slice(start,start+batchSize),n=part.length;
    const maximum=Math.max(...part.map(s=>s.sample.steps[0].legalCount));
    const states=new Float32Array(n*STATE_DIM),actions=new Float32Array(n*maximum*ACTION_DIM);
    const memories=new Float32Array(n*NEURAL_HIDDEN_SIZE),mask=new Float32Array(n*maximum),selected=new Int32Array(n);
    part.forEach(({sample},i)=>{assertLessonSample(sample,'training');const t=sample.steps[0];
      assert.equal(sample.steps.length,1);states.set(t.state,i*STATE_DIM);
      actions.set(Array.from(t.actions).slice(0,t.legalCount*ACTION_DIM),i*maximum*ACTION_DIM);
      memories.set(snapshot?.get(sample).memory||resolveLessonMemory(model,sample),i*NEURAL_HIDDEN_SIZE);
      mask.fill(1,i*maximum,i*maximum+t.legalCount);selected[i]=t.selectedIndex;
    });
    const {value,grads}=tf.variableGrads(()=>tf.tidy(()=>{
      const out=forwardNeural(model,tf.tensor3d(states,[n,1,STATE_DIM]),
        tf.tensor4d(actions,[n,1,maximum,ACTION_DIM]),differentiableLessonMemories(model,part.map(s=>s.sample)),
        {teacherProposal:false,diagnostic:false,belief:false});
      const scores=out.logits.reshape([n,maximum]),one=tf.oneHot(tf.tensor1d(selected,'int32'),maximum);
      const target=tf.sum(tf.mul(scores,one),-1);
      const rival=tf.max(tf.add(tf.sub(scores,tf.mul(one,1e9)),tf.mul(tf.sub(1,tf.tensor2d(mask,[n,maximum])),-1e9)),-1);
      return tf.mean(tf.relu(tf.add(tf.sub(rival,target),config.floor)));
    }),variables);
    try{variables.forEach((v,k)=>{const gradient=grads[v.name]?.dataSync();if(!gradient)return;
      assert.ok(gradient.every(Number.isFinite));for(let i=0;i<gradient.length;i++)sums[k][i]+=gradient[i]*n/active.length;
    });}finally{value.dispose();Object.values(grads).forEach(g=>g.dispose());}
  }
  // A fixed-reference correct choice may ALREADY be wrong at the starting
  // weights. Repair that infeasibility before filling slots with other cases.
  // All labels and references here belong exclusively to the training bank.
  const priority=x=>requiredChoices.has(lessonInputKey(x.sample))&&!x.correct?2:x.correct?1:0;
  const working=active.slice().sort((a,b)=>priority(b)-priority(a)||a.margin-b.margin||a.index-b.index)
    .slice(0,maximumDirections).map(s=>s.sample);
  return {gradient:sums,directions:individualMarginDirections(model,working,variables,config,snapshot,requiredChoices),
    cases:samples.length,activeCases:active.length,maximumDirections,batchSize,
    requiredRecoveryCases:active.filter(x=>priority(x)===2).length};
}
