import assert from 'node:assert/strict';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {restoreAdamOptimizer} from '../src/ai/neural/trainer.mjs';
import {readAdamGeometry,gradientsForAdamDelta} from './adam-update-geometry.mjs';
import {measureLessonRetention,lessonSafetyGuard} from './lesson-maintenance.mjs';
import {tacticalLessonGuard} from './tactical-lesson-learning.mjs';
import {nativeEpochRecovery} from './native-epoch-recovery.mjs';

export const ATOMIC_EPOCH='exact-adam-atomic-epoch-v1';
const snapshot=m=>Object.fromEntries(Object.entries(m.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));
const restore=(m,s)=>{for(const[n,w]of Object.entries(s))m.layers[n].setWeights(w);};
const release=s=>Object.values(s).flat().forEach(w=>w.dispose());

// Reproduce an already selected, training-derived target through actual Adam
// steps from the epoch snapshot. No lessons, gradients or trials are added.
// The number of algebraic replay steps cannot exceed accepted batch updates.
// On any unreachable coordinate, leave the target intact for atomic rejection.
export async function rebindEpochAdam({model,epochStartWeights,optimizerSnapshot,names,steps,learningRate=.0001}){
  assert.ok(Number.isSafeInteger(steps)&&steps>0);assert.ok(Array.isArray(names)&&names.length);
  const variables=Object.values(model.layers).flatMap(l=>l.trainableWeights.map(w=>w.val));
  const target=variables.map(v=>Float64Array.from(v.dataSync())),targetWeights=snapshot(model);
  const indexes=new Map(variables.map((v,i)=>[v.name,i])),active=new Set(names);
  let optimizer=null,committed=false;
  try{
    restore(model,epochStartWeights);
    for(let k=0;k<variables.length;k++)if(!active.has(variables[k].name)){
      const base=variables[k].dataSync();assert.ok(target[k].every((x,i)=>x===base[i]),'Recovery changed a variable outside the actual Adam order');
    }
    optimizer=await restoreAdamOptimizer(optimizerSnapshot,learningRate);
    const reference=variables.map(v=>new Float64Array(v.size));
    for(let step=0;step<steps;step++){
      const delta=variables.map((v,k)=>{const now=v.dataSync();return Float64Array.from(target[k],(x,i)=>(x-now[i])/(steps-step));});
      const geometry=readAdamGeometry(optimizer,names,variables),inverse=gradientsForAdamDelta(delta,reference,names,variables,geometry,learningRate);
      if(!inverse.feasible)return {passed:false,reason:inverse.reason,step,steps};
      const gradients=Object.fromEntries(names.map(name=>{const k=indexes.get(name);assert.ok(k!==undefined);
        return [name,tf.tensor(Float32Array.from(inverse.values[k]),variables[k].shape)];}));
      try{optimizer.applyGradients(gradients);}finally{Object.values(gradients).forEach(v=>v.dispose());}
    }
    let maximumError=0;
    variables.forEach((v,k)=>{const actual=v.dataSync();actual.forEach((x,i)=>{maximumError=Math.max(maximumError,Math.abs(x-target[k][i]));});});
    if(!Number.isFinite(maximumError)||maximumError>2e-7)return {passed:false,reason:'adam-target-reconstruction-error',maximumError,steps};
    committed=true;return {passed:true,optimizer,steps,maximumError};
  }finally{
    if(!committed){optimizer?.dispose();restore(model,targetWeights);}
    release(targetWeights);
  }
}

export function atomicPpoEpochRetention({model,source,bank,legacy,additionalGuard,batchReports,reachableRecovery=false,workingBank=bank}){
  const before=measureLessonRetention(source,bank.validation),trainingBefore=measureLessonRetention(source,bank.training);
  let result=null;
  const measure=()=>{
    const after=measureLessonRetention(model,bank.validation),trainingAfter=measureLessonRetention(model,bank.training);
    const validation=lessonSafetyGuard(before,after),training=tacticalLessonGuard(trainingBefore.types,trainingAfter.types);
    const lostTrainingChoices=trainingBefore.correct.filter((v,i)=>v&&!trainingAfter.correct[i]).length;
    const extra=additionalGuard?.()||{passed:true};
    const passed=validation.passed&&training.passed&&!lostTrainingChoices&&extra.passed;
    return {passed,validation,training,additionalGuard:extra,lostTrainingChoices,
      report:{contract:ATOMIC_EPOCH,passed,before,after,trainingBefore:trainingBefore.types,trainingAfter:trainingAfter.types,
        validation,training,additionalGuard:extra,lostTrainingChoices,heldOutLabelsTrained:false}};
  };
  return {
    policyRehearsalForBatch:legacy.policyRehearsalForBatch,
    async beforeEpochGuard(args){
      const accepted=batchReports.filter(b=>b.epoch===args.epoch&&b.accepted);
      // No PPO update can be committed by the caller in this case. Avoid
      // running a costly, inevitably rejected legacy correction afterward.
      if(!accepted.length){result=measure();result.passed=false;result.report.passed=false;
        result.report.atomicEpoch={contract:ATOMIC_EPOCH,mode:'no-minibatch-update',optimizerPreserved:true};
        return {restoreEpochOptimizer:false};}
      const raw=measure();
      if(raw.passed){result=raw;result.report.atomicEpoch={contract:ATOMIC_EPOCH,mode:'raw-adam',optimizerPreserved:true,acceptedMinibatches:accepted.length,
        acceptedSteps:accepted.reduce((sum,b)=>sum+(b.nativeStepsCommitted??1),0)};
        return {restoreEpochOptimizer:false};}
      if(reachableRecovery){
        const steps=accepted.reduce((sum,b)=>sum+(b.nativeStepsCommitted??1),0);
        const recovery=await nativeEpochRecovery({model,bank:workingBank,args,names:accepted.at(-1).optimizerVariableOrder,steps,measure});
        result=recovery.result||raw;
        result={...result,passed:recovery.passed,report:{...result.report,passed:recovery.passed,
          atomicEpoch:{contract:'reachable-native-adam-epoch-v2',mode:recovery.passed?'native-adam-recovery':'native-recovery-rejected',
            acceptedMinibatches:accepted.length,maximumStepsPerCandidate:steps,maximumCandidates:14,steps:recovery.steps||0,
            attempts:recovery.attempts,rawGuard:raw,optimizerPreserved:true,heldOutLabelsTrained:false}}};
        return {restoreEpochOptimizer:false,...(recovery.passed?{optimizer:recovery.optimizer}:{})};
      }
      const rawWeights=snapshot(model);
      try{
        const legacyAction=await legacy.beforeEpochGuard(args),recovered=legacy.epochGuard();result=recovered;
        result.report.atomicEpoch={contract:ATOMIC_EPOCH,mode:'recovery-rejected',rawGuard:raw,acceptedSteps:accepted.length};
        if(!recovered.passed)return {restoreEpochOptimizer:false};
        // Legacy recovery's reset flag is not a valid optimizer companion for
        // changed weights. Reconstruct matching moments instead of dropping them.
        const names=accepted.at(-1).optimizerVariableOrder;
        const rebound=await rebindEpochAdam({model,epochStartWeights:args.epochStartWeights,optimizerSnapshot:args.optimizerSnapshot,
          names,steps:accepted.length});
        if(!rebound.passed){
          restore(model,rawWeights);result=raw;result.passed=false;result.report.passed=false;
          result.report.atomicEpoch={contract:ATOMIC_EPOCH,mode:'unreachable-recovery',rebind:rebound,acceptedSteps:accepted.length};
          return {restoreEpochOptimizer:false};
        }
        try{
          result=measure();
          result.report.atomicEpoch={contract:ATOMIC_EPOCH,mode:'rebound-adam',steps:rebound.steps,maximumError:rebound.maximumError,
            optimizerPreserved:true,rawGuard:raw,legacyReport:recovered.report,legacyRequestedReset:legacyAction?.restoreEpochOptimizer===true};
          if(result.passed)return {restoreEpochOptimizer:false,optimizer:rebound.optimizer};
        }catch(error){rebound.optimizer.dispose();throw error;}
        rebound.optimizer.dispose();return {restoreEpochOptimizer:false};
      }finally{release(rawWeights);}
    },
    epochGuard(){assert.ok(result);return result;}
  };
}
