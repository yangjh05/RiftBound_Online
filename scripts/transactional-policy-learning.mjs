import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {trainPpoBatch} from '../src/ai/neural/model.mjs';
import {packPpoBatch, serializeOptimizer, restoreAdamOptimizer} from '../src/ai/neural/trainer.mjs';
import {contextualLessonSamples} from './lesson-memory-context.mjs';
import {assertLessonSample, lessonInputKey, lessonTypes, LESSON_FLAGS} from './tactical-lesson-learning.mjs';
import {measureLessonRetention, lessonSafetyGuard} from './lesson-maintenance.mjs';
import {trajectoryContexts, reconstructedBatchMemories, acceptTrainingStep, CONSTRAINED_DEFAULTS} from './constrained-policy-learning.mjs';
import {projectTrainingDelta} from './ppo-training-projection.mjs';

export const TRANSACTIONAL_POLICY = 'training-only-individual-retention-adam-transaction-v1';
const dot=(a,b)=>a.reduce((sum,x,k)=>sum+x.reduce((s,v,i)=>s+v*b[k][i],0),0);
const release=values=>values.forEach(v=>v.dispose());
const policyInputKey=s=>createHash('sha256').update(JSON.stringify(s.steps.map(t=>[Array.from(t.state),Array.from(t.actions),t.legalCount]))).digest('hex');

// Every old correct decision matters, even when its category's mean improves.
// These are TRAINING constraints. Held-out labels are never directions or
// minibatch acceptance inputs; the unchanged outer validation guard owns them.
export function trainingRetentionGuard(before, after) {
  const guard=lessonSafetyGuard(before,after),failures=[...guard.failures];
  for(const [type,a] of Object.entries(before.types)) {
    const b=after.types[type];
    if(a.decisions && b && b.policyLoss>a.policyLoss+1e-7) failures.push(`${type}:training-descent`);
  }
  return {passed:!failures.length,failures};
}

export function transactionalPolicyUpdater({trajectories,source,champion,trainingGroups,protectedKeys,
  rehearsalForBatch,onBatch=()=>{},config=CONSTRAINED_DEFAULTS}) {
  assert.ok(Array.isArray(trainingGroups)&&trainingGroups.length);
  assert.ok(protectedKeys instanceof Set);
  for(const group of trainingGroups) for(const sample of group.samples) {
    assertLessonSample(sample,'training');
    assert.ok(!protectedKeys.has(lessonInputKey(sample)),'Protected input in minibatch constraints');
    assert.ok(!protectedKeys.has(policyInputKey(sample)),'Protected policy input in minibatch constraints');
  }
  const contexts=trajectoryContexts(trajectories);
  const unique=[...new Map(trainingGroups.flatMap(g=>g.samples).map(s=>[lessonInputKey(s),s])).values()];
  const types=Object.keys(LESSON_FLAGS).map(type=>({type,samples:unique.filter(s=>lessonTypes(s).includes(type))})).filter(g=>g.samples.length);
  const references=trainingGroups.map(g=>({...g,source:measureLessonRetention(source,g.samples),champion:measureLessonRetention(champion,g.samples)}));
  return async({model,batch,chunks,optimizer,options,epoch,batchIndex})=>{
    assert.equal(options.teacherCoefficient,0);
    const variables=Object.values(model.layers).flatMap(l=>l.trainableWeights.map(w=>w.val));
    const base=variables.map(v=>v.clone()),state=await serializeOptimizer(optimizer,model.generation);
    const reset=()=>variables.forEach((v,i)=>v.assign(base[i]));
    const anchorInitialMemories=new Map([source,champion].map(m=>[m,reconstructedBatchMemories(m,chunks,contexts)]));
    const settings=()=>({...options,anchorModels:[{model:source,weight:1},{model:champion,weight:1}],
      anchorInitialMemories,policyRehearsal:rehearsalForBatch({epoch,batch:batchIndex})});
    const current=()=>({...batch,initialMemories:reconstructedBatchMemories(model,chunks,contexts)});
    const evaluate=()=>{
      const opts=settings(),b=current(),metrics=trainPpoBatch(model,b,null,{...opts,evaluateOnly:true});
      const anchored=trainPpoBatch(model,b,null,{...opts,evaluateOnly:true,anchorModels:[{model:champion,weight:1}],policyRehearsal:null});
      return {metrics,objective:{policyObjective:metrics.policyLoss+opts.anchorCoefficient*metrics.anchorKl-(opts.entropyCoefficient??.01)*metrics.entropy,
        rehearsalLoss:metrics.policyRehearsalLoss??0,championKl:anchored.anchorKl}};
    };
    const starting=references.map(g=>measureLessonRetention(model,g.samples));
    const retention=()=>references.map((g,i)=>{
      const after=measureLessonRetention(model,g.samples);
      const checks={batch:trainingRetentionGuard(starting[i],after),source:lessonSafetyGuard(g.source,after),champion:lessonSafetyGuard(g.champion,after)};
      return {group:g.id,passed:Object.values(checks).every(c=>c.passed),checks};
    });
    const components={},orders={},capture=(name,overrides)=>{
      trainPpoBatch(model,current(),{applyGradients(grads){orders[name]=Object.keys(grads);
        components[name]=variables.map(v=>Float64Array.from(grads[v.name]?.dataSync()||new Float32Array(v.size)));}},
      {...settings(),...overrides});
    };
    let accepted=false,trial=null,after,before;const attempts=[];let report;
    try{
      before=evaluate();after=before;
      capture('policy',{valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,beliefCoefficient:0,policyRehearsal:null});
      // Use the COMPLETE training category, not a rotating two-example average.
      for(const group of types)capture(group.type,{policyCoefficient:0,valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,
        beliefCoefficient:0,anchorCoefficient:0,entropyCoefficient:0,policyRehearsal:{contract:'verified-training-policy-rehearsal-v1',coefficient:.25,
          batch:packPpoBatch(contextualLessonSamples(model,group.samples))}});
      capture('combined',{});
      const raw=components.combined.map(a=>Float64Array.from(a,x=>-x)),norm=Math.sqrt(dot(raw,raw));
      const directions=['policy',...types.map(g=>g.type)].map(type=>({type,norm:Math.sqrt(dot(components[type],components[type]))})).filter(g=>g.norm>1e-12)
        .map(g=>({type:g.type,values:components[g.type].map(a=>Float64Array.from(a,x=>x/g.norm))}));
      const projected=projectTrainingDelta(raw,directions,{minimumDescent:config.minimumDescentRatio*norm});
      const projectedNorm=Math.sqrt(dot(projected.delta,projected.delta));
      const proposals=[{kind:'original-gradient',values:components.combined}];
      if(projected.feasible&&norm>1e-12&&projectedNorm<=config.maximumProjectionNormRatio*norm)
        proposals.push({kind:'category-projected-gradient',values:projected.delta.map(a=>Float64Array.from(a,x=>-x))});
      const indexes=new Map(variables.map((v,i)=>[v.name,i]));
      // Each attempt is a real Adam update from the SAME snapshot. We never
      // project a weight delta and then pretend its raw moments generated it.
      outer:for(const proposal of proposals)for(const fraction of config.fractions){
        reset();trial=await restoreAdamOptimizer(state,config.learningRate*fraction);
        const grads=Object.fromEntries(orders.combined.map(name=>{
          const i=indexes.get(name);return [name,tf.tensor(Float32Array.from(proposal.values[i]),variables[i].shape)];}));
        try{trial.applyGradients(grads);}finally{release(Object.values(grads));}
        after=evaluate();const objectivePassed=acceptTrainingStep(before.objective,after.objective,config);
        const checks=objectivePassed?retention():[];
        const passed=objectivePassed&&checks.every(g=>g.passed);
        attempts.push({proposal:proposal.kind,fraction,passed,objectivePassed,after:after.objective,retention:checks});
        if(passed){accepted=true;break outer;}
        trial.dispose();trial=null;
      }
      if(accepted){
        // Next batch starts at the configured rate, with accepted moments and
        // iteration count. Learning rate is not an Adam moment/checkpoint field.
        trial.learningRate=config.learningRate;
      }else{reset();after=before;}
      report={contract:TRANSACTIONAL_POLICY,epoch,batch:batchIndex,accepted,before:before.objective,after:after.objective,attempts,
        categories:types.map(g=>({type:g.type,count:g.samples.length})),individualTrainingCases:unique.length,
        projection:{feasible:projected.feasible,norm,projectedNorm},optimizerCommitted:accepted,optimizerRestored:!accepted,heldOutInputsUsed:false};
      onBatch(report);
      if(accepted)optimizer.dispose();
      return {optimizer:accepted?trial:optimizer,metrics:{...after.metrics,optimizerStepApplied:accepted,transactionalPolicy:report}};
    }catch(error){reset();trial?.dispose();throw error;}
    finally{release(base);}
  };
}
