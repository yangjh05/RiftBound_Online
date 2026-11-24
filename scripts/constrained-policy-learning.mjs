import assert from 'node:assert/strict';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {trainPpoBatch} from '../src/ai/neural/model.mjs';
import {serializeOptimizer, restoreAdamOptimizer} from '../src/ai/neural/trainer.mjs';
import {resolveLessonMemory} from './lesson-memory-context.mjs';
import {NEURAL_HIDDEN_SIZE} from '../src/ai/neural/encoding.mjs';
import {projectTrainingDelta} from './ppo-training-projection.mjs';

export const CONSTRAINED_POLICY = 'training-only-minibatch-policy-and-rehearsal-v1';
export const CONSTRAINED_DEFAULTS = Object.freeze({
  fractions: [1, .5, .25, .125, .0625, .03125, .015625],
  maximumProjectionNormRatio: 2, minimumDescentRatio: .01,
  maximumChampionKl: .01, learningRate: .0001, tolerance: 1e-7
});
const dot = (a, b) => a.reduce((sum, x, k) => sum + x.reduce((s, v, i) => s + v * b[k][i], 0), 0);
const snapshot = variables => variables.map(v => v.clone());
const assign = (variables, base, delta = null, fraction = 0) => tf.tidy(() => variables.forEach((v, i) =>
  v.assign(delta ? tf.add(base[i], tf.mul(tf.tensor(Float32Array.from(delta[i]), v.shape), fraction)) : base[i])));
const release = values => values.forEach(v => v.dispose());
export function acceptTrainingStep(before, after, config = CONSTRAINED_DEFAULTS) {
  if (![...Object.values(before), ...Object.values(after)].every(Number.isFinite)) return false;
  return after.policyObjective < before.policyObjective - config.tolerance
    && after.rehearsalLoss <= before.rehearsalLoss + config.tolerance
    && after.championKl <= Math.max(config.maximumChampionKl, before.championKl) + config.tolerance;
}

// Construct histories from admitted learner observations only. No opponent
// trajectory, outcome, validation example or teacher label is in a prefix.
export function trajectoryContexts(trajectories) {
  const map = new WeakMap();
  for (const trajectory of trajectories) {
    assert.ok(trajectory.steps.length && trajectory.playerId);
    trajectory.steps.forEach((step, index) => map.set(step, {
      playerId: trajectory.playerId, steps: [step],
      memoryContext: {contract: 'complete-actor-observation-prefix-v1', fromReset: true,
        playerId: trajectory.playerId, states: trajectory.steps.slice(0, index).map(s => s.state)}
    }));
  }
  return map;
}
export function reconstructedBatchMemories(model, chunks, contexts) {
  const memories = new Float32Array(chunks.length * NEURAL_HIDDEN_SIZE);
  chunks.forEach((chunk, i) => {
    const sample = contexts.get(chunk.steps[0]);
    assert.ok(sample, 'Missing complete actor prefix');
    assert.equal(sample.playerId, chunk.playerId);
    memories.set(resolveLessonMemory(model, sample), i * NEURAL_HIDDEN_SIZE);
  });
  return memories;
}

// Preserve the fixed teacher and final retention checks. This changes only
// how a training-only proposal is constructed BEFORE those checks run.
export function constrainedPolicyUpdater({trajectories, source, champion, rehearsalForBatch,
  onBatch = () => {}, config = CONSTRAINED_DEFAULTS}) {
  const contexts = trajectoryContexts(trajectories);
  return async ({model, batch, chunks, optimizer, options, epoch, batchIndex}) => {
    assert.equal(options.teacherCoefficient, 0);
    const variables = Object.values(model.layers).flatMap(layer => layer.trainableWeights.map(w => w.val));
    const base = snapshot(variables), optimizerState = await serializeOptimizer(optimizer, model.generation);
    let nextOptimizer = optimizer, keepOptimizer = false, accepted = false;
    const anchorInitialMemories = new Map([source, champion].map(m => [m, reconstructedBatchMemories(m, chunks, contexts)]));
    const settings = () => ({...options, anchorModels: [{model:source,weight:1},{model:champion,weight:1}],
      anchorInitialMemories, policyRehearsal: rehearsalForBatch({epoch,batch:batchIndex})});
    const currentBatch = () => ({...batch, initialMemories: reconstructedBatchMemories(model, chunks, contexts)});
    const evaluate = () => {
      const opts = settings(), b = currentBatch();
      const metrics = trainPpoBatch(model, b, null, {...opts, evaluateOnly:true});
      const championMetrics = trainPpoBatch(model, b, null, {...opts, evaluateOnly:true,
        anchorModels:[{model:champion,weight:1}], policyRehearsal:null});
      return {metrics, objective:{policyObjective:metrics.policyLoss + opts.anchorCoefficient*metrics.anchorKl
        - (opts.entropyCoefficient??.01)*metrics.entropy,
        rehearsalLoss:metrics.policyRehearsalLoss??0, championKl:championMetrics.anchorKl}};
    };
    const components = {}, connected = {}, capture = (name, overrides) => {
      const holder = {applyGradients(grads) {
        connected[name] = Object.keys(grads);
        components[name] = variables.map(v => Float64Array.from(grads[v.name]?.dataSync() || new Float32Array(v.size)));
      }};
      return trainPpoBatch(model, currentBatch(), holder, {...settings(), ...overrides});
    };
    const attempts = [];
    let before, after, diagnostics;
    try {
      before = evaluate();
      capture('policy', {valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,beliefCoefficient:0,policyRehearsal:null});
      capture('rehearsal', {policyCoefficient:0,valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,
        beliefCoefficient:0,anchorCoefficient:0,entropyCoefficient:0});
      capture('auxiliary', {policyCoefficient:0,anchorCoefficient:0,entropyCoefficient:0,policyRehearsal:null});
      const names=Object.keys(components),norms=Object.fromEntries(names.map(n=>[n,Math.sqrt(dot(components[n],components[n]))]));
      diagnostics={norms,cosines:Object.fromEntries(names.flatMap((a,i)=>names.slice(i+1).map(b=>[
        `${a}:${b}`,norms[a]*norms[b]>1e-12?dot(components[a],components[b])/(norms[a]*norms[b]):null])))};
      // TFJS Adam restores moments by gradient iteration order, not by the
      // deserialized variable's new name. Match the exact connected variable
      // set/order of the original full objective; padding inactive heads with
      // zero gradients would attach old moments to a different layer.
      capture('combined',{});
      const indexes=new Map(variables.map((v,i)=>[v.name,i]));
      const grads=Object.fromEntries(connected.combined.map(name=>{
        const i=indexes.get(name),v=variables[i];
        return [name,tf.tensor(Float32Array.from(components.combined[i]),v.shape)];
      }));
      try{optimizer.applyGradients(grads);}finally{release(Object.values(grads));}
      const raw=variables.map((v,i)=>{const a=base[i].dataSync();return Float64Array.from(v.dataSync(),(x,j)=>x-a[j]);});
      const norm=Math.sqrt(dot(raw,raw));
      const directions=['policy','rehearsal'].filter(n=>norms[n]>1e-12).map(n=>({type:n,
        values:components[n].map(a=>Float64Array.from(a,x=>x/norms[n]))}));
      const projected=projectTrainingDelta(raw,directions,{minimumDescent:config.minimumDescentRatio*norm});
      const projectedNorm=Math.sqrt(dot(projected.delta,projected.delta));
      diagnostics.projection={feasible:projected.feasible,norm,projectedNorm,before:projected.before,after:projected.after};
      if(projected.feasible&&norm>1e-12&&projectedNorm<=config.maximumProjectionNormRatio*norm){
        for(const fraction of config.fractions){
          assign(variables,base,projected.delta,fraction);after=evaluate();
          const passed=acceptTrainingStep(before.objective,after.objective,config);
          attempts.push({fraction,passed,after:after.objective});
          if(passed){accepted=true;break;}
        }
      }
      if(!accepted){assign(variables,base);after=before;}
      // The projected proposal has different moments from raw Adam. Restore
      // the snapshot explicitly; neither rejected nor projected raw moments
      // silently leak into the next batch or a resumed checkpoint.
      nextOptimizer=await restoreAdamOptimizer(optimizerState,config.learningRate);
      optimizer.dispose();keepOptimizer=true;
      const report={contract:CONSTRAINED_POLICY,epoch,batch:batchIndex,accepted,before:before.objective,
        after:after.objective,diagnostics,attempts,optimizerRestored:true,heldOutInputsUsed:false};
      onBatch(report);
      return {optimizer:nextOptimizer,metrics:{...after.metrics,optimizerStepApplied:accepted,constrainedPolicy:report}};
    }catch(error){assign(variables,base);if(keepOptimizer)nextOptimizer.dispose();throw error;}
    finally{release(base);}
  };
}
