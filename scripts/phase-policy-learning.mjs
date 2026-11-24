import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {packPpoBatch} from '../src/ai/neural/trainer.mjs';
import {contextualLessonSamples} from './lesson-memory-context.mjs';
import {LESSON_FLAGS,lessonTypes,lessonInputKey,assertLessonSample,tacticalLessonDigest,tacticalLessonGuard} from './tactical-lesson-learning.mjs';
import {measureLessonRetention,lessonSafetyGuard} from './lesson-maintenance.mjs';
import {efficientPpoLessonRetention} from './efficient-policy-learning.mjs';
import {blockPpoLessonRetention} from './ppo-block-recovery.mjs';
import {ACTOR_LAYERS,trainingLossDirections,projectTrainingDelta} from './ppo-training-projection.mjs';
import {interpolateEpochWeights} from './joint-policy-learning.mjs';

export const PHASE_POLICY_LEARNING='prospective-phase-preserving-policy-v1';
// Only these ACTION_KIND_INDEX one-hot rows are nonzero during play and zero
// for EVERY mulligan action. No card/hash/context feature is assumed to be zero.
// Shared GRU, state projection, Q, all biases and other kernel rows stay fixed.
export const PLAY_ONLY_ACTION_ROWS=Object.freeze([...Array.from({length:15},(_,i)=>i+6),67]);
export function validatePhasePolicyLearning(p){
 assert.equal(p.contract,PHASE_POLICY_LEARNING);assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
 assert.match(p.efficientLearningHash,/^[a-f0-9]{64}$/);
 assert.deepEqual(p.fractions,[1,.5,.25,.125,.0625,.03125,.015625]);
 assert.equal(p.replayIterationStride,17);assert.equal(p.minimumDescentRatio,.01);assert.equal(p.maximumProjectionNormRatio,2);return p;
}
export async function readPhasePolicyLearning(root){
 try{return validatePhasePolicyLearning(JSON.parse(await readFile(path.join(root,'phase-policy-learning-protocol.json'),'utf8')));}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function commitPhasePolicyLearning(state,p){
 const hash=p?tacticalLessonDigest(validatePhasePolicyLearning(p)):null;
 if(state.phasePolicyLearningHash)assert.equal(hash,state.phasePolicyLearningHash,'Phase learning changed or removed.');
 else if(p){assert.ok(p.afterIteration>=state.iteration,'Phase learning must start prospectively.');
  assert.equal(p.efficientLearningHash,state.efficientPolicyLearningHash);state.phasePolicyLearningHash=hash;}
}
export function rotatingPolicyRehearsal(bank,joint,iteration,p,model=null){
 validatePhasePolicyLearning(p);assert.ok(Number.isSafeInteger(iteration)&&iteration>p.afterIteration);
 const held=new Set([...(bank.protectedValidationKeys||[]),...bank.validation.map(lessonInputKey)]);
 for(const sample of bank.training){assertLessonSample(sample,'training');assert.ok(!held.has(lessonInputKey(sample)),'Replay overlaps held-out inputs.');}
 for(const sample of bank.validation)assertLessonSample(sample,'validation');
 const groups=Object.keys(LESSON_FLAGS).map(type=>bank.training.filter(s=>lessonTypes(s).includes(type))).filter(a=>a.length);
 assert.ok(groups.length);assert.equal(joint.examplesPerType,2);assert.equal(joint.rehearsalCoefficient,.25);
 // Iterate by an odd stride rather than restarting at case zero after every
 // rejected epoch. Deterministic iteration/epoch/batch coordinates survive a
 // restart without a mutable cursor or dependence on validation outcomes.
 return ({epoch,batch})=>{
  assert.ok(Number.isSafeInteger(epoch)&&epoch>=1&&Number.isSafeInteger(batch)&&batch>=0);
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  const samples=groups.flatMap(a=>{
   let stride=p.replayIterationStride;while(gcd(stride,a.length)!==1)stride++;
   const offset=(iteration-p.afterIteration-1)*stride+(epoch-1)*104729+batch*joint.examplesPerType;
   return Array.from({length:joint.examplesPerType},(_,i)=>a[(offset+i)%a.length]);
  });
  return {contract:'verified-training-policy-rehearsal-v1',coefficient:joint.rehearsalCoefficient,batch:packPpoBatch(model?contextualLessonSamples(model,samples):samples)};
 };
}
const snapshot=m=>Object.fromEntries(Object.entries(m.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));
const restore=(m,s)=>{for(const[n,w]of Object.entries(s))m.layers[n].setWeights(w);};
const release=s=>Object.values(s).flat().forEach(w=>w.dispose());
const norm=a=>Math.sqrt(a.reduce((v,x)=>v+x.reduce((s,y)=>s+y*y,0),0));
export function playOnlyMasks(base){
 return ACTOR_LAYERS.flatMap(n=>base[n].map((w,index)=>{
  const mask=new Uint8Array(w.size);
  if(['actionProjection','actionBias'].includes(n)&&index===0){
   assert.equal(w.shape.length,2);
   for(const row of PLAY_ONLY_ACTION_ROWS){assert.ok(row<w.shape[0]);mask.fill(1,row*w.shape[1],(row+1)*w.shape[1]);}
  }
  return mask;
 }));
}
export function applyPlayOnlyProjection(model,base,raw,directions){
 const masks=playOnlyMasks(base),weights=ACTOR_LAYERS.flatMap(n=>base[n]),proposal=ACTOR_LAYERS.flatMap(n=>raw[n]);
 const delta=weights.map((w,k)=>{const a=w.dataSync(),b=proposal[k].dataSync();return Float64Array.from(a,(x,i)=>masks[k][i]?(b[i]-x):0);});
 const restricted=directions.map(g=>{
  const values=g.values.map((a,k)=>Float64Array.from(a,(x,i)=>masks[k][i]?x:0)),length=norm(values);
  if(length>1e-12)for(const a of values)for(let i=0;i<a.length;i++)a[i]/=length;
  return {type:g.type,values,norm:length};
 }).filter(g=>g.norm>1e-12);
 const stepNorm=norm(delta),minimumDescent=.01*stepNorm,result=projectTrainingDelta(delta,restricted,{minimumDescent});
 const projectedNorm=norm(result.delta),feasible=result.feasible&&stepNorm>1e-12&&projectedNorm>1e-12&&projectedNorm<=2*stepNorm;
 restore(model,base);
 if(feasible){let k=0;for(const name of ACTOR_LAYERS)tf.tidy(()=>model.layers[name].setWeights(base[name].map(w=>{
  const d=result.delta[k++];return tf.add(w,tf.tensor(Float32Array.from(d),w.shape));
 })));}
 return {feasible,stepNorm,projectedNorm,minimumDescent,types:restricted.map(g=>g.type),before:result.before,after:result.after,rows:PLAY_ONLY_ACTION_ROWS};
}
export const PHASE_ADDITIONAL_GUARD='phase-additional-acceptance-guard-v1';
export function phasePpoLessonRetention(model,source,frozen,maintenance,joint,block,efficient,p,iteration,{additionalGuard=null}={}){
 validatePhasePolicyLearning(p);assert.equal(p.efficientLearningHash,tacticalLessonDigest(efficient));
 assert.ok(additionalGuard===null||typeof additionalGuard==='function');
 // A fixed-parent check is an acceptance constraint, never a source of
 // gradients. Apply it before accepting any route, so its failure can reach
 // the existing bounded alternatives instead of bypassing all recovery.
 const accept=internal=>{
  if(!additionalGuard)return internal;
  const external=additionalGuard();assert.equal(typeof external?.passed,'boolean');
  const passed=internal.passed&&external.passed;
  return {...internal,passed,additionalGuard:external,report:{...internal.report,passed,additionalGuard:external}};
 };
 const normal=efficientPpoLessonRetention(model,source,frozen,maintenance,joint,block,efficient,{legacyRecovery:false,maximumProjectionNormRatio:p.maximumProjectionNormRatio,additionalGuard}),bank=frozen.bank;
 const before=measureLessonRetention(source,bank.validation),trainingBefore=measureLessonRetention(source,bank.training);
 let result=null;
 return {
  policyRehearsalForBatch:rotatingPolicyRehearsal(bank,joint,iteration,p,model),
  beforeEpochGuard(args){
   const raw=snapshot(model),attempts=[];let projected;
   try{
    const optimizer=normal.beforeEpochGuard(args),ordinary=accept(normal.epochGuard());result=ordinary;
    if(ordinary.passed){result={...ordinary,report:{...ordinary.report,phaseLearning:{contract:p.contract,protocolHash:tacticalLessonDigest(p),iteration,mode:'full-policy'}}};return optimizer;}
    restore(model,args.epochStartWeights);
    const directions=trainingLossDirections(model,bank),projection=applyPlayOnlyProjection(model,args.epochStartWeights,raw,directions);
    if(projection.feasible){
     projected=snapshot(model);
     for(const fraction of p.fractions){
      interpolateEpochWeights(model,args.epochStartWeights,projected,fraction);
      const trainingAfter=measureLessonRetention(model,bank.training),training=tacticalLessonGuard(trainingBefore.types,trainingAfter.types);
      const lostTrainingChoices=trainingBefore.correct.filter((v,i)=>v&&!trainingAfter.correct[i]).length;
      if(!training.passed||lostTrainingChoices){attempts.push({fraction,passed:false,training,lostTrainingChoices,validation:null});continue;}
      const after=measureLessonRetention(model,bank.validation),validation=lessonSafetyGuard(before,after),passed=validation.passed;
      result=accept({passed,training,validation,report:{...ordinary.report,before,after,trainingBefore:trainingBefore.types,trainingAfter:trainingAfter.types,
       passed,training,validation,heldOutLabelsTrained:false,appliedPpoFraction:null,
       phaseLearning:{contract:p.contract,protocolHash:tacticalLessonDigest(p),iteration,mode:'play-only-action-rows',fraction,projection,attempts,optimizerRestored:true}}});
      attempts.push({fraction,passed:result.passed,training,lostTrainingChoices,validation,
       ...(additionalGuard?{additionalGuard:result.additionalGuard}:{})});
      if(result.passed)return {restoreEpochOptimizer:true};
     }
    }
    // Try the older memory/lesson repair only when the cheaper phase-safe
    // path fails. Restore the original Adam proposal, not a rejected trial.
    restore(model,raw);
    const legacy=blockPpoLessonRetention(model,source,frozen,maintenance,joint,block,{additionalGuard});
    const legacyOptimizer=legacy.beforeEpochGuard(args),legacyResult=accept(legacy.epochGuard());
    if(legacyResult.passed){result={...legacyResult,report:{...legacyResult.report,phaseLearning:{contract:p.contract,protocolHash:tacticalLessonDigest(p),iteration,mode:'legacy-recovery',projection,attempts}}};return legacyOptimizer;}
    // Report the actual final attempted weights, even if the training check
    // failed before validation. The trainer owns full model/Adam/RNG rollback.
    const after=measureLessonRetention(model,bank.validation),trainingAfter=measureLessonRetention(model,bank.training);
    const validation=lessonSafetyGuard(before,after),training=tacticalLessonGuard(trainingBefore.types,trainingAfter.types);
    result=accept({...result,passed:false,validation,training,report:{...result.report,passed:false,after,trainingAfter:trainingAfter.types,validation,training,
     phaseLearning:{contract:p.contract,protocolHash:tacticalLessonDigest(p),iteration,mode:'rejected',projection,attempts,optimizerRestored:false}}});
    return {restoreEpochOptimizer:false};
   }finally{release(raw);if(projected)release(projected);}
  },
  epochGuard(){assert.ok(result);return result;}
 };
}
