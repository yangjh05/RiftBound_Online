import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {trainPpoBatch} from '../src/ai/neural/model.mjs';
import {packPpoBatch, serializeOptimizer, restoreAdamOptimizer} from '../src/ai/neural/trainer.mjs';
import {contextualLessonSamples} from './lesson-memory-context.mjs';
import {assertLessonSample, lessonInputKey, lessonTypes, LESSON_FLAGS} from './tactical-lesson-learning.mjs';
import {lessonSafetyGuard} from './lesson-maintenance.mjs';
import {trajectoryContexts, reconstructedBatchMemories, acceptTrainingStep, CONSTRAINED_DEFAULTS} from './constrained-policy-learning.mjs';
import {projectTrainingDelta,trainingLossDirections,ACTOR_LAYERS} from './ppo-training-projection.mjs';
import {readAdamGeometry,gradientsForAdamFraction} from './adam-update-geometry.mjs';
import {trainingInitialMemories} from './training-history-gradient.mjs';
import {groupedTrainingLossDirections} from './training-group-directions.mjs';
import {adamReachableBounds,adamDeltaForGradients,projectReachableAdamDelta} from './reachable-adam-projection.mjs';

import {streamedIndividualMargins,individualMarginGuard,INDIVIDUAL_MARGIN} from './individual-training-margin.mjs';
import {snapshotIndividualTraining,snapshotTrainingRetention,snapshotTrainingMargins} from './individual-training-snapshot.mjs';
export const TRANSACTIONAL_POLICY = 'training-only-current-constraint-recovery-v11';
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

export function individualTransactionalPolicyUpdater({trajectories,source,champion,trainingGroups,protectedKeys,
  workingGroups=trainingGroups,rehearsalForBatch,onBatch=()=>{},config=CONSTRAINED_DEFAULTS}) {
  assert.ok(Array.isArray(trainingGroups)&&trainingGroups.length);
  assert.ok(protectedKeys instanceof Set);
  for(const group of trainingGroups) for(const sample of group.samples) {
    assertLessonSample(sample,'training');
    assert.ok(!protectedKeys.has(lessonInputKey(sample)),'Protected input in minibatch constraints');
    assert.ok(!protectedKeys.has(policyInputKey(sample)),'Protected policy input in minibatch constraints');
  }
  const contexts=trajectoryContexts(trajectories);
  const unique=[...new Map(trainingGroups.flatMap(g=>g.samples).map(s=>[lessonInputKey(s),s])).values()];
  const workingKeys=new Set(workingGroups.flatMap(g=>g.samples).map(lessonInputKey));
  assert.ok([...workingKeys].every(key=>unique.some(s=>lessonInputKey(s)===key)),'Working sample outside guarded training bank');
  const types=Object.keys(LESSON_FLAGS).map(type=>({type,samples:unique.filter(s=>lessonTypes(s).includes(type))})).filter(g=>g.samples.length);
  const snapshotSamples=trainingGroups.flatMap(g=>g.samples);
  const sourceSnapshot=snapshotIndividualTraining(source,snapshotSamples),championSnapshot=snapshotIndividualTraining(champion,snapshotSamples);
  const references=trainingGroups.map(g=>({...g,source:snapshotTrainingRetention(sourceSnapshot,g.samples),champion:snapshotTrainingRetention(championSnapshot,g.samples)}));
  const requiredChoices=new Set(unique.filter(s=>sourceSnapshot.get(s).correct||championSnapshot.get(s).correct).map(lessonInputKey));
  return async({model,batch,chunks,optimizer,options,epoch,batchIndex})=>{
    const started=performance.now();
    assert.equal(options.teacherCoefficient,0);
    const variables=Object.values(model.layers).flatMap(l=>l.trainableWeights.map(w=>w.val));
    const base=variables.map(v=>v.clone()),state=await serializeOptimizer(optimizer,model.generation);
    const reset=()=>variables.forEach((v,i)=>v.assign(base[i]));
    const anchorInitialMemories=new Map([source,champion].map(m=>[m,reconstructedBatchMemories(m,chunks,contexts)]));
    const settings=()=>({...options,trainingInitialMemories,anchorModels:[{model:source,weight:1},{model:champion,weight:1}],
      anchorInitialMemories,policyRehearsal:rehearsalForBatch({epoch,batch:batchIndex})});
    const current=()=>({...batch,initialMemories:reconstructedBatchMemories(model,chunks,contexts),
      memoryContexts:chunks.map(chunk=>contexts.get(chunk.steps[0]).memoryContext)});
    const evaluate=()=>{
      const opts=settings(),b=current(),metrics=trainPpoBatch(model,b,null,{...opts,evaluateOnly:true});
      const anchored=trainPpoBatch(model,b,null,{...opts,evaluateOnly:true,anchorModels:[{model:champion,weight:1}],policyRehearsal:null});
      return {metrics,objective:{policyObjective:metrics.policyLoss+opts.anchorCoefficient*metrics.anchorKl-(opts.entropyCoefficient??.01)*metrics.entropy,
        rehearsalLoss:metrics.policyRehearsalLoss??0,championKl:anchored.anchorKl}};
    };
    const startingSnapshot=snapshotIndividualTraining(model,snapshotSamples);
    const starting=references.map(g=>snapshotTrainingRetention(startingSnapshot,g.samples));
    const startingChoices=snapshotTrainingMargins(startingSnapshot,unique);
    const retention=snapshot=>references.map((g,i)=>{
      const after=snapshotTrainingRetention(snapshot,g.samples);
      const checks={batch:trainingRetentionGuard(starting[i],after),source:lessonSafetyGuard(g.source,after),champion:lessonSafetyGuard(g.champion,after)};
      return {group:g.id,passed:Object.values(checks).every(c=>c.passed),checks};
    });
    const components={},orders={},capture=(name,overrides)=>{
      delete components[name];delete orders[name];
      trainPpoBatch(model,current(),{applyGradients(grads){orders[name]=Object.keys(grads);
        components[name]=variables.map(v=>Float64Array.from(grads[v.name]?.dataSync()||new Float32Array(v.size)));}},
      {...settings(),...overrides});
    };
    let accepted=false,trial=null,after,before,nativeStepsCommitted=0;const attempts=[],inverseAttempts=[];let report,projected=null,projectedNorm=null,actualAdamDelta=null,adamCorrection=null;
    try{
      before=evaluate();after=before;
      capture('policy',{valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,beliefCoefficient:0,policyRehearsal:null});
      // Use the COMPLETE training category, not a rotating two-example average.
      const actorVariables=ACTOR_LAYERS.flatMap(n=>model.layers[n].trainableWeights.map(w=>w.val));
      const actorIndexes=new Map(actorVariables.map((v,i)=>[v.name,i]));
      const groupDirections=groupedTrainingLossDirections(model,workingGroups,protectedKeys);
      for(const direction of groupDirections)
        components[direction.type]=variables.map(v=>actorIndexes.has(v.name)
          ?Float64Array.from(direction.values[actorIndexes.get(v.name)],x=>x*direction.norm*.25):new Float64Array(v.size));
      capture('combined',{});
      // Reference violations get working slots even when deterministic resource
      // rotation would otherwise omit them. Acceptance still checks ALL cases.
      const hingeSamples=unique.slice().sort((a,b)=>{
        const priority=s=>requiredChoices.has(lessonInputKey(s))&&!startingSnapshot.get(s).correct?2:workingKeys.has(lessonInputKey(s))?1:0;
        return priority(b)-priority(a);
      }).slice(0,workingKeys.size);
      const individual=streamedIndividualMargins(model,hingeSamples,variables,{snapshot:startingSnapshot,requiredChoices});
      for(let k=0;k<variables.length;k++)for(let i=0;i<components.combined[k].length;i++)
        components.combined[k][i]+=INDIVIDUAL_MARGIN.coefficient*individual.gradient[k][i];
      const raw=components.combined.map(a=>Float64Array.from(a,x=>-x)),norm=Math.sqrt(dot(raw,raw));
      const directions=['policy',...groupDirections.map(g=>g.type)].map(type=>({type,norm:Math.sqrt(dot(components[type],components[type]))})).filter(g=>g.norm>1e-12)
        .map(g=>({type:g.type,values:components[g.type].map(a=>Float64Array.from(a,x=>x/g.norm))}));
      directions.push(...individual.directions.map(d=>({type:d.type,values:d.values.map(a=>Float64Array.from(a,x=>x/d.norm)),
        ...(d.requiredRecovery?{minimumDescent:d.minimumDescent}: {})})));
      const geometry=readAdamGeometry(optimizer,orders.combined,variables);
      const bounds=adamReachableBounds(orders.combined,variables,geometry,config.learningRate);
      const proposals=[{kind:'original-gradient',values:components.combined},{kind:'actual-adam-delta-projection',values:null}];
      const indexes=new Map(variables.map((v,i)=>[v.name,i]));
      // Each attempt is a real Adam update from the SAME snapshot. We never
      // project a weight delta and then pretend its raw moments generated it.
      outer:for(const proposal of proposals){
       if(!proposal.values){
        if(!actualAdamDelta)continue;
        if(individual.requiredRecoveryCases)break;
        const captureConstraint=(name,extra)=>{
          reset();capture(name,{policyCoefficient:0,valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,beliefCoefficient:0,
            entropyCoefficient:0,teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,anchorCoefficient:0,...extra});
          const norm=Math.sqrt(dot(components[name],components[name]));
          if(norm>1e-12)directions.push({type:name,values:components[name].map(a=>Float64Array.from(a,x=>x/norm))});
        };
        // Complete-category constraints need not protect the current rotating
        // rehearsal subset. Include the exact loss tested by this batch gate.
        if(attempts.some(a=>a.after.rehearsalLoss>before.objective.rehearsalLoss+config.tolerance))
          captureConstraint('batch-rehearsal',{});
        // The unchanged acceptance gate also limits divergence from the fixed
        // champion. If it blocked an ordinary trial, construct its direction
        // from these TRAINING observations at the original weights.
        if(attempts.some(a=>a.after.championKl>Math.max(config.maximumChampionKl,before.objective.championKl)+config.tolerance)){
          captureConstraint('champion-kl',{anchorOnly:true,anchorModels:[{model:champion,weight:1}],anchorCoefficient:1,policyRehearsal:null});
        }
        const deltaNorm=Math.sqrt(dot(actualAdamDelta,actualAdamDelta));
        projected=projectReachableAdamDelta(actualAdamDelta,directions,bounds,{minimumDescent:config.minimumDescentRatio*deltaNorm,
          maximumNorm:config.maximumProjectionNormRatio*deltaNorm});
        projectedNorm=Math.sqrt(dot(projected.delta,projected.delta));
        if(deltaNorm<=1e-12)continue;
       }
       for(const fraction of config.fractions){
        let values=proposal.values,learningRate=config.learningRate*fraction;
        if(proposal.kind==='actual-adam-delta-projection'){
          // Backtracking must not shrink an absolute recovery obligation out
          // of existence. Shrink the PPO displacement, then re-project against
          // the SAME training-only gap, within the existing seven-trial budget.
          const deltaNorm=Math.sqrt(dot(actualAdamDelta,actualAdamDelta));
          const reachable=projectReachableAdamDelta(actualAdamDelta.map(a=>Float64Array.from(a,x=>x*fraction)),directions,bounds,
            {minimumDescent:config.minimumDescentRatio*deltaNorm*fraction,maximumNorm:config.maximumProjectionNormRatio*deltaNorm});
          if(!reachable.feasible){inverseAttempts.push({fraction,feasible:false,reason:'joint-training-adam-constraints-infeasible'});continue;}
          let target=reachable.delta,targetFraction=1;
          if(individual.requiredRecoveryCases){
            const deltaNorm=Math.sqrt(dot(actualAdamDelta,actualAdamDelta));
            const recovery=projectTrainingDelta(actualAdamDelta.map(a=>Float64Array.from(a,x=>x*fraction)),directions,
              {minimumDescent:config.minimumDescentRatio*deltaNorm*fraction});
            const recoveryNorm=Math.sqrt(dot(recovery.delta,recovery.delta));
            if(!recovery.feasible||recoveryNorm>config.maximumProjectionNormRatio*deltaNorm){
              inverseAttempts.push({fraction,feasible:false,reason:'training-recovery-outside-trust-region'});continue;
            }
            target=recovery.delta;targetFraction=1;
          }
          adamCorrection=gradientsForAdamFraction(target,targetFraction,components.combined,orders.combined,variables,geometry,config.learningRate);
          inverseAttempts.push({fraction,feasible:adamCorrection.feasible,maximumError:adamCorrection.maximumError??null,reason:adamCorrection.reason??null});
          if(!adamCorrection.feasible)continue;
          values=adamCorrection.values;learningRate=config.learningRate;
        }
        reset();trial=await restoreAdamOptimizer(state,learningRate);
        const grads=Object.fromEntries(orders.combined.map(name=>{
          const i=indexes.get(name);return [name,tf.tensor(Float32Array.from(values[i]),variables[i].shape)];}));
        try{trial.applyGradients(grads);}finally{release(Object.values(grads));}
        if(proposal.kind==='original-gradient'&&!actualAdamDelta)
          actualAdamDelta=variables.map((v,k)=>{const values=v.dataSync(),original=base[k].dataSync();return Float64Array.from(values,(x,i)=>(x-original[i])/fraction);});
        after=evaluate();const objectivePassed=acceptTrainingStep(before.objective,after.objective,config);
        const trialSnapshot=objectivePassed?snapshotIndividualTraining(model,snapshotSamples):null;
        const checks=objectivePassed?retention(trialSnapshot):[];
        const individualCheck=objectivePassed?individualMarginGuard(startingChoices,snapshotTrainingMargins(trialSnapshot,unique)):null;
        const passed=objectivePassed&&checks.every(g=>g.passed)&&individualCheck.passed;
        attempts.push({proposal:proposal.kind,fraction,passed,objectivePassed,after:after.objective,retention:checks,individualCheck});
        if(passed){accepted=true;nativeStepsCommitted=1;break outer;}
        trial.dispose();trial=null;
       }
      }
      // The seven projected alternatives become at most seven TENTATIVE Adam
      // steps when the starting policy already violates a fixed training choice.
      // Intermediate steps are never accepted minibatches. All original endpoint
      // guards, including source/champion checks, still have to pass together.
      if(!accepted&&individual.requiredRecoveryCases&&actualAdamDelta){
        reset();trial=await restoreAdamOptimizer(state,config.learningRate);
        let previousSnapshot=startingSnapshot;
        const deficit=snapshot=>unique.reduce((sum,s)=>sum+(requiredChoices.has(lessonInputKey(s))?Math.max(0,INDIVIDUAL_MARGIN.tolerance-snapshot.get(s).margin):0),0);
        const objectiveViolation=o=>Math.max(0,o.policyObjective-before.objective.policyObjective+config.tolerance)
          +Math.max(0,o.rehearsalLoss-before.objective.rehearsalLoss-config.tolerance)
          +Math.max(0,o.championKl-Math.max(config.maximumChampionKl,before.objective.championKl)-config.tolerance);
        let previousObjective=before.objective;
        for(let step=0;step<config.fractions.length;step++){
          const snapshot=snapshotIndividualTraining(model,snapshotSamples);
          // Re-linearize the actual objective at the CURRENT provisional
          // weights. A tangent at the transaction start cannot constrain the
          // nonlinear objective several Adam steps later.
          capture('recovery-policy',{valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,beliefCoefficient:0,policyRehearsal:null});
          const currentGroups=groupedTrainingLossDirections(model,workingGroups,protectedKeys);
          const currentDirections=currentGroups.map(d=>({type:d.type,values:variables.map(v=>actorIndexes.has(v.name)?d.values[actorIndexes.get(v.name)]:new Float64Array(v.size))}));
          const addDirection=name=>{if(!components[name])return;const n=Math.sqrt(dot(components[name],components[name]));if(n>1e-12)currentDirections.push({type:name,values:components[name].map(a=>Float64Array.from(a,x=>x/n))});};
          addDirection('recovery-policy');
          if(previousObjective.championKl>=.9*Math.max(config.maximumChampionKl,before.objective.championKl)){
            capture('recovery-champion-kl',{policyCoefficient:0,valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,beliefCoefficient:0,
              entropyCoefficient:0,teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,
              anchorOnly:true,anchorModels:[{model:champion,weight:1}],anchorCoefficient:1,policyRehearsal:null});
            addDirection('recovery-champion-kl');
          }
          capture('recovery-rehearsal',{policyCoefficient:0,valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,beliefCoefficient:0,
            entropyCoefficient:0,teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,anchorCoefficient:0});
          addDirection('recovery-rehearsal');
          capture('combined',{});
          const part=streamedIndividualMargins(model,hingeSamples,variables,{snapshot,requiredChoices});
          for(let k=0;k<variables.length;k++)for(let i=0;i<components.combined[k].length;i++)components.combined[k][i]+=INDIVIDUAL_MARGIN.coefficient*part.gradient[k][i];
          const g=readAdamGeometry(trial,orders.combined,variables),rawDelta=adamDeltaForGradients(components.combined,orders.combined,variables,g,config.learningRate);
          const rawNorm=Math.sqrt(dot(rawDelta,rawDelta));
          const constraints=[...currentDirections,
            ...part.directions.map(d=>({type:d.type,values:d.values.map(a=>Float64Array.from(a,x=>x/d.norm)),
              ...(d.requiredRecovery?{minimumDescent:d.minimumDescent/(config.fractions.length-step)}:{})}))];
          const reachable=projectReachableAdamDelta(rawDelta,constraints,adamReachableBounds(orders.combined,variables,g,config.learningRate),
            {minimumDescent:config.minimumDescentRatio*rawNorm,maximumNorm:config.maximumProjectionNormRatio*rawNorm});
          if(!reachable.feasible){inverseAttempts.push({recoveryStep:step+1,feasible:false,reason:'bounded-recovery-joint-constraints-infeasible'});break;}
          const inverse=gradientsForAdamFraction(reachable.delta,1,components.combined,orders.combined,variables,g,config.learningRate);
          if(!inverse.feasible){inverseAttempts.push({recoveryStep:step+1,feasible:false,reason:inverse.reason});break;}
          const grads=Object.fromEntries(orders.combined.map(name=>{const k=indexes.get(name);return [name,tf.tensor(Float32Array.from(inverse.values[k]),variables[k].shape)];}));
          try{trial.applyGradients(grads);}finally{release(Object.values(grads));}
          after=evaluate();const next=snapshotIndividualTraining(model,snapshotSamples),checks=retention(next);
          const individualCheck=individualMarginGuard(startingChoices,snapshotTrainingMargins(next,unique));
          const objectivePassed=acceptTrainingStep(before.objective,after.objective,config);
          const passed=objectivePassed&&checks.every(g=>g.passed)&&individualCheck.passed;
          // After choice recovery, use remaining ORIGINAL trial slots to
          // reduce endpoint objective violations while preserving that choice.
          const progress=deficit(previousSnapshot)>INDIVIDUAL_MARGIN.tolerance
            ?deficit(next)<deficit(previousSnapshot)-config.tolerance
            :objectiveViolation(after.objective)<objectiveViolation(previousObjective)-config.tolerance;
          const noRegression=references.every(g=>trainingRetentionGuard(snapshotTrainingRetention(previousSnapshot,g.samples),snapshotTrainingRetention(next,g.samples)).passed)
            &&individualMarginGuard(snapshotTrainingMargins(previousSnapshot,unique),snapshotTrainingMargins(next,unique)).passed;
          attempts.push({proposal:'bounded-native-adam-recovery',recoveryStep:step+1,passed,objectivePassed,after:after.objective,retention:checks,individualCheck,
            provisional:!passed,progress,noRegression,deficitBefore:deficit(previousSnapshot),deficitAfter:deficit(next),
            objectiveViolationBefore:objectiveViolation(previousObjective),objectiveViolationAfter:objectiveViolation(after.objective),
            currentConstraintTypes:currentDirections.map(d=>d.type)});
          if(passed){accepted=true;nativeStepsCommitted=step+1;break;}
          if(!progress||!noRegression)break;
          previousSnapshot=next;
          previousObjective=after.objective;
        }
        if(!accepted){trial.dispose();trial=null;}
      }
      if(accepted){
        // Next batch starts at the configured rate, with accepted moments and
        // iteration count. Learning rate is not an Adam moment/checkpoint field.
        trial.learningRate=config.learningRate;
      }else{reset();after=before;}
      report={contract:TRANSACTIONAL_POLICY,epoch,batch:batchIndex,accepted,before:before.objective,after:after.objective,attempts,
        optimizerVariableOrder:orders.combined,startingReferenceChecks:retention(startingSnapshot),
        requiredRecoveryCases:individual.requiredRecoveryCases,nativeStepsCommitted,maximumNativeTrialSteps:2*config.fractions.length,
        nativeTrialSteps:attempts.length,workingTrainingCases:hingeSamples.length,
        categories:types.map(g=>({type:g.type,count:g.samples.length})),individualTrainingCases:unique.length,individualMargin:INDIVIDUAL_MARGIN,
        computation:{elapsedMs:performance.now()-started,activeCases:individual.activeCases,
          projectionCases:individual.directions.length,maximumProjectionCases:individual.maximumDirections,
          hingeBatchSize:individual.batchSize,allCasesCheckedForAcceptance:true,sharedTrainingInference:true,fullHistoryGradients:true},
        projection:{feasible:projected?.feasible??null,norm,projectedNorm,space:'actual-adam-weight-delta',
          constraints:directions.map(d=>d.type),championKlUsesTrainingInputsOnly:true,
          inverseFeasible:adamCorrection?.feasible??null,inverseMaximumError:adamCorrection?.maximumError??null,
          inverseAttempts,reachableBacktracking:true,unavailableReason:adamCorrection?.reason??null},optimizerCommitted:accepted,optimizerRestored:!accepted,heldOutInputsUsed:false};
      onBatch(report);
      if(accepted)optimizer.dispose();
      return {optimizer:accepted?trial:optimizer,metrics:{...after.metrics,optimizerStepApplied:accepted,transactionalPolicy:report}};
    }catch(error){reset();trial?.dispose();throw error;}
    finally{release(base);}
  };
}
