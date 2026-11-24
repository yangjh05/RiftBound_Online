import assert from 'node:assert/strict';
import {inferStep} from '../src/ai/neural/model.mjs';
import {resolveLessonMemory} from './lesson-memory-context.mjs';
import {assertLessonSample,lessonInputKey,lessonTypes,tacticalLessonDigest,LESSON_FLAGS} from './tactical-lesson-learning.mjs';
import {choiceMargin} from './individual-training-margin.mjs';

// A snapshot belongs to one unchanged set of weights. Callers must rebuild it
// after every actual Adam trial; recurrent prefixes are recomputed here.
export function snapshotIndividualTraining(model,samples){
 const cases=new Map(),bySample=new WeakMap();
 const identity=sample=>lessonInputKey(sample)+':'+tacticalLessonDigest(sample.memoryContext||null);
 for(const sample of samples){
  assertLessonSample(sample,'training');assert.equal(sample.steps.length,1);
  const key=lessonInputKey(sample),id=identity(sample);if(cases.has(id)){
   const item=cases.get(id);assert.equal(item.target,sample.steps[0].selectedIndex,'Conflicting training labels');bySample.set(sample,item);continue;
  }
  const step=sample.steps[0],memory=resolveLessonMemory(model,sample);
  const {logits}=inferStep(model,step.state,step.actions,step.legalCount,memory);
  const maximum=Math.max(...logits),weights=logits.map(x=>Math.exp(x-maximum)),total=weights.reduce((a,b)=>a+b,0);
  const logProbability=logits[step.selectedIndex]-maximum-Math.log(total);
  const item={key,target:step.selectedIndex,...choiceMargin(logits,step.selectedIndex),memory,policyLoss:-logProbability,
   probability:Math.exp(logProbability),types:lessonTypes(sample)};
  cases.set(id,item);bySample.set(sample,item);
 }
 return {size:cases.size,get:sample=>bySample.get(sample)||cases.get(identity(sample))};
}
export function snapshotTrainingRetention(snapshot,samples){
 const types=Object.fromEntries(Object.keys(LESSON_FLAGS).map(type=>[type,{decisions:0,policyLoss:0,meanTargetProbability:0,decisionAccuracy:0}]));
 const correct=samples.map(sample=>{
  const item=snapshot.get(sample);assert.ok(item,'Training snapshot is incomplete');
  assert.equal(item.target,sample.steps[0].selectedIndex,'Conflicting training labels');
  for(const type of lessonTypes(sample)){
   const metric=types[type];metric.decisions++;metric.policyLoss+=item.policyLoss;
   metric.meanTargetProbability+=item.probability;metric.decisionAccuracy+=Number(item.correct);
  }
  return item.correct;
 });
 for(const metric of Object.values(types))if(metric.decisions)for(const key of ['policyLoss','meanTargetProbability','decisionAccuracy'])metric[key]/=metric.decisions;
 return {types,correct};
}
export function snapshotTrainingMargins(snapshot,samples){
 return samples.map(sample=>{
  const item=snapshot.get(sample);assert.ok(item,'Training snapshot is incomplete');
  assert.equal(item.target,sample.steps[0].selectedIndex,'Conflicting training labels');
  return {key:item.key,correct:item.correct,margin:item.margin};
 });
}
