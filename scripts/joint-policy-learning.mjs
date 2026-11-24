import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {inferStep,forwardNeural} from '../src/ai/neural/model.mjs';
import {STATE_DIM,ACTION_DIM} from '../src/ai/neural/encoding.mjs';
import {packPpoBatch} from '../src/ai/neural/trainer.mjs';
import {resolveLessonMemory,contextualLessonSamples} from './lesson-memory-context.mjs';
import {assertLessonSample,LESSON_FLAGS,lessonTypes,lessonInputKey,tacticalLessonDigest,measureLessonTypes,tacticalLessonGuard} from './tactical-lesson-learning.mjs';
import {commonLessonStep,measureLessonRetention,lessonSafetyGuard} from './lesson-maintenance.mjs';

export const JOINT_POLICY_LEARNING='prospective-joint-ppo-verified-lessons-v1';
export function validateJointPolicyLearning(p){
  assert.equal(p.contract,JOINT_POLICY_LEARNING);assert.ok(Number.isSafeInteger(p.afterIteration)&&p.afterIteration>=0);
  assert.match(p.maintenanceHash,/^[a-f0-9]{64}$/);
  assert.equal(p.rehearsalCoefficient,.25);assert.equal(p.examplesPerType,2);
  assert.equal(p.maximumRetentionPasses,8);assert.equal(p.maximumRetentionStep,.0003);
  assert.deepEqual(p.updateFractions,[1,.5,.25,.125,.0625,.03125,.015625]);return p;
}
export async function readJointPolicyLearning(root){
  let p;try{p=JSON.parse(await readFile(path.join(root,'joint-policy-learning-protocol.json'),'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}return validateJointPolicyLearning(p);
}
export function commitJointPolicyLearning(state,p){
  const hash=p?tacticalLessonDigest(validateJointPolicyLearning(p)):null;
  if(state.jointPolicyLearningHash)assert.equal(hash,state.jointPolicyLearningHash,'Joint learning protocol changed or removed.');
  else if(p){assert.ok(p.afterIteration>=state.iteration,'Joint learning must start prospectively.');
    assert.equal(p.maintenanceHash,state.lessonMaintenanceHash);state.jointPolicyLearningHash=hash;}
}
export function policyRehearsalSchedule(bank,p,model=null){
  validateJointPolicyLearning(p);
  for(const s of bank.training)assertLessonSample(s,'training');
  for(const s of bank.validation)assertLessonSample(s,'validation');
  const held=new Set([...(bank.protectedValidationKeys||[]),...bank.validation.map(lessonInputKey)]);
  assert.ok(bank.training.every(s=>!held.has(lessonInputKey(s))),'Training replay overlaps held-out inputs.');
  const groups=Object.keys(LESSON_FLAGS).map(t=>bank.training.filter(s=>lessonTypes(s).includes(t))).filter(a=>a.length);
  assert.ok(groups.length,'Joint learning requires verified training lessons.');
  return ({epoch,batch})=>{
    assert.ok(Number.isInteger(epoch)&&epoch>=1&&Number.isInteger(batch)&&batch>=0);
    const offset=((epoch-1)*104729+batch)*p.examplesPerType;
    const samples=groups.flatMap(a=>Array.from({length:p.examplesPerType},(_,i)=>a[(offset+i)%a.length]));
    return {contract:'verified-training-policy-rehearsal-v1',coefficient:p.rehearsalCoefficient,
      batch:packPpoBatch(model?contextualLessonSamples(model,samples):samples)};
  };
}
const snapshot=model=>Object.fromEntries(Object.entries(model.layers).map(([name,layer])=>[name,layer.getWeights().map(w=>w.clone())]));
const dispose=s=>Object.values(s).flat().forEach(w=>w.dispose());
function margin(model,sample){
  const s=sample.steps[0],logits=inferStep(model,s.state,s.actions,s.legalCount,resolveLessonMemory(model,sample)).logits;
  assert.ok(logits.every(Number.isFinite));
  let competitor=-1;
  for(let i=0;i<logits.length;i++)if(i!==s.selectedIndex&&(competitor<0||logits[i]>logits[competitor]))competitor=i;
  return {correct:logits.indexOf(Math.max(...logits))===s.selectedIndex,competitor,
    margin:competitor<0?Infinity:logits[s.selectedIndex]-logits[competitor]};
}
export function trainingMarginReferences(model,bank){
  const held=new Set([...(bank.protectedValidationKeys||[]),...bank.validation.map(lessonInputKey)]);
  return bank.training.map(s=>{assertLessonSample(s,'training');assert.ok(!held.has(lessonInputKey(s)),'Retention overlaps held-out inputs.');
    return {key:lessonInputKey(s),...margin(model,s)};});
}
// Repair only forgotten or fragile VERIFIED TRAINING choices, using the
// smallest first-order policy-head correction that restores their margin.
// Held-out targets never participate in this projection. The unchanged final
// guards still reject interference with another type or validation choice.
export function restoreTrainingChoiceMargins(model,bank,references,p){
  validateJointPolicyLearning(p);assert.equal(references.length,bank.training.length);
  const currentReferences=trainingMarginReferences(model,bank);
  for(let i=0;i<references.length;i++)assert.equal(references[i].key,currentReferences[i].key);
  const variables=['stateProjection','actionProjection','actionBias'].flatMap(n=>model.layers[n].trainableWeights.map(w=>w.val));
  let steps=0,passes=0;
  const target=r=>Math.min(.05,Math.max(.0001,r.margin*.5));
  for(let pass=0;pass<p.maximumRetentionPasses;pass++){
    let violations=0;passes++;
    for(let i=0;i<references.length;i++){
      const ref=references[i];if(!ref.correct||!Number.isFinite(ref.margin))continue;
      const sample=bank.training[i],s=sample.steps[0],now=margin(model,sample),wanted=target(ref);
      if(now.margin>=wanted)continue;violations++;
      const memory=resolveLessonMemory(model,sample);
      const {value,grads}=tf.variableGrads(()=>tf.tidy(()=>{
        const output=forwardNeural(model,tf.tensor3d(s.state,[1,1,STATE_DIM]),
          tf.tensor4d(s.actions.slice(0,s.legalCount*ACTION_DIM),[1,1,s.legalCount,ACTION_DIM]),tf.tensor2d(memory,[1,memory.length]),
          {teacherProposal:false,diagnostic:false,belief:false});
        return tf.sub(output.logits.slice([0,0,s.selectedIndex],[1,1,1]),output.logits.slice([0,0,now.competitor],[1,1,1])).asScalar();
      }),variables);
      try{
        let norm=0,maximum=0;
        for(const g of Object.values(grads))for(const x of g.dataSync()){assert.ok(Number.isFinite(x));norm+=x*x;maximum=Math.max(maximum,Math.abs(x));}
        if(norm<1e-14)continue;
        const rate=Math.min((wanted-now.margin+.0001)*1.05/norm,p.maximumRetentionStep/Math.max(1e-12,maximum));
        for(const v of variables)tf.tidy(()=>v.assign(tf.add(v,tf.mul(grads[v.name],rate))));steps++;
      }finally{value.dispose();Object.values(grads).forEach(g=>g.dispose());}
    }
    if(!violations)break;
  }
  const lost=bank.training.filter((s,i)=>references[i].correct&&!margin(model,s).correct).length;
  return {passes,steps,lostTrainingChoices:lost,heldOutLabelsTrained:false};
}
export function interpolateEpochWeights(model,base,proposal,fraction){
  assert.ok(fraction>0&&fraction<=1);
  assert.deepEqual(Object.keys(base).sort(),Object.keys(proposal).sort());
  for(const [name,weights] of Object.entries(base)){
    assert.equal(weights.length,proposal[name].length);
    tf.tidy(()=>model.layers[name].setWeights(weights.map((w,i)=>{
      assert.deepEqual(w.shape,proposal[name][i].shape);
      return fraction===1?proposal[name][i]:tf.add(w,tf.mul(tf.sub(proposal[name][i],w),fraction));
    })));
  }
}

// Evaluate every bounded proposal against the same complete acceptance
// contract. External retention checks supply no gradients or training labels.
export function additionalAcceptance(internal,additionalGuard){
  if(!additionalGuard)return internal;
  const external=additionalGuard();assert.equal(typeof external?.passed,'boolean');
  return {...internal,passed:internal.passed&&external.passed,additionalGuard:external};
}
export function jointPpoLessonRetention(model,sourceModel,frozen,maintenance,p,{additionalGuard=null}={}){
  validateJointPolicyLearning(p);assert.equal(p.maintenanceHash,tacticalLessonDigest(maintenance));assert.ok(frozen);
  const bank=frozen.bank,rehearsal=policyRehearsalSchedule(bank,p,model);
  const trainingReferences=trainingMarginReferences(sourceModel,bank);
  const before=measureLessonRetention(sourceModel,bank.validation),trainingBefore=measureLessonTypes(sourceModel,bank.training);
  let report=null;
  const measure=()=>{
    const after=measureLessonRetention(model,bank.validation),trainingAfter=measureLessonTypes(model,bank.training);
    const validation=lessonSafetyGuard(before,after),training=tacticalLessonGuard(trainingBefore,trainingAfter);
    return additionalAcceptance({after,trainingAfter,validation,training,passed:validation.passed&&training.passed},additionalGuard);
  };
  return {
    policyRehearsalForBatch:rehearsal,
    beforeEpochGuard({epochStartWeights}){
      assert.ok(epochStartWeights,'Joint recovery requires an atomic epoch snapshot.');
      // Rehearsal is part of the proposal. Shrink the WHOLE update; applying
      // a fixed-size rehearsal after every smaller PPO trial defeats the
      // trust region and can keep flipping marginally correct decisions.
      const rounds=[];for(let i=0;i<maintenance.roundsPerEpoch;i++)rounds.push(commonLessonStep(model,bank,maintenance));
      const marginRetention=restoreTrainingChoiceMargins(model,bank,trainingReferences,p);
      const proposal=snapshot(model),attempts=[];
      try{
        for(const fraction of p.updateFractions){
          // Each attempt starts from the SAME PPO proposal and epoch start.
          // No rejected rehearsal or weight interpolation accumulates.
          interpolateEpochWeights(model,epochStartWeights,proposal,fraction);
          const result=measure();attempts.push({fraction,passed:result.passed,validation:result.validation,training:result.training,
            ...(additionalGuard?{additionalGuard:result.additionalGuard}:{})});
          report={contract:JOINT_POLICY_LEARNING,protocolHash:tacticalLessonDigest(p),source:frozen.source,sourceSha256:frozen.sourceSha256,
            before,trainingBefore,...result,rounds,marginRetention,attempts,appliedPpoFraction:result.passed?fraction:0,heldOutLabelsTrained:false,
            rehearsalCoefficient:p.rehearsalCoefficient};
          if(result.passed)break;
        }
      }finally{dispose(proposal);}
      // A failed final attempt is intentionally left to the trainer's atomic
      // weight + optimizer + RNG rollback, identical to ordinary rejection.
    },
    epochGuard(){assert.ok(report);return {passed:report.passed,validation:report.validation,training:report.training,
      ...(additionalGuard?{additionalGuard:report.additionalGuard}:{}),report};}
  };
}
