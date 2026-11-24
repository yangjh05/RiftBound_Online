import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

export function assertReviewedTeacherLesson(sample,targetDeckId,teacher){
  const source=sample.lessonSource,proof=source.proof,step=sample.steps[0],transfer=sample.transfer;
  assert.equal(sample.contract,'reviewed-matchup-policy-curriculum-v1');
  assert.equal(proof.kind,'reviewed-public-teacher-v1');assert.equal(proof.thresholdsUnchanged,true);
  assert.equal(proof.globalOptimalityClaim,false);assert.equal(proof.completeLegalReplay,true);
  assert.equal(proof.publicInputsOnly,true);assert.equal(proof.manualChoiceIsNotLabel,true);
  assert.equal(source.allBranchesTrainingOnly,true);assert.equal(source.role,'training');
  assert.equal(transfer.targetDeckId,targetDeckId);
  assert.equal(transfer.sourceLegend,transfer.targetLegend);assert.equal(transfer.sourceDeck.legend,transfer.sourceLegend);
  assert.equal(sample.deckId,'conversation-deck-'+digest(transfer.sourceDeck),'Never relabel the recorded deck as the target deck');
  assert.ok(teacher&&typeof teacher.approve==='function'&&typeof teacher.actionKey==='function');
  assert.equal(transfer.targetLegend,teacher.targetLegend,'The destination profile must really use the recorded legend');
  assert.equal(teacher.approve(proof.advice,teacher.actionKey(proof.baseline),teacher.actionKey),true,'Unchanged independent teacher must approve');
  assert.equal(teacher.actionKey(proof.advice.action),step.selectedActionKey);
  assert.equal(step.advantage,proof.advice.weight);
  const flags=['mulliganLesson','growthLesson','localResourceLesson','responsePolicyLesson'];
  assert.ok(flags.some(k=>step[k]));for(const k of flags)assert.equal(Boolean(step[k]),Boolean(proof.advice[k]));
  assert.equal(step.return,0);assert.equal(step.value,0);assert.equal(step.winProbabilityLabel,false);
}

export function assertRulesRuntimeLaneTransition(previous,next,previousHash,context){
  assert.equal(digest(previous),previousHash,'Previous lane identity changed');
  const {runtime:oldRuntime,config:oldConfig,inputProtocol:oldProtocol,legacyBindings:oldLegacy=[],...oldCore}=previous;
  const {runtime:newRuntime,config:newConfig,inputProtocol:newProtocol,legacyBindings:newLegacy,...newCore}=next;
  assert.deepEqual(newCore,oldCore,'Rules transition changed dispatch, capacity or protected inputs');
  assert.notEqual(newRuntime.engineFingerprint,oldRuntime.engineFingerprint,'Semantic rule fixes require a distinct identity');
  assert.deepEqual(newLegacy,[...oldLegacy,{runtime:oldRuntime,config:oldConfig,inputProtocol:oldProtocol}]);
  const strip=c=>{const {runtimeDirectory,runtimeManifest,engineFingerprint,...rest}=c;return rest;};
  assert.deepEqual(strip(context.nextConfig),strip(context.previousConfig),'Rules transition changed evaluation criteria or seeds');
  for(const [config,runtime]of [[context.previousConfig,oldRuntime],[context.nextConfig,newRuntime]]){
    assert.equal(config.runtimeDirectory,runtime.directory);assert.deepEqual(config.runtimeManifest,runtime.manifest);
    assert.equal(config.engineFingerprint,runtime.engineFingerprint);
  }
  const {configHash:oldHash,afterIterations:oldAfter,...oldProtocolCore}=context.previousProtocol;
  const {configHash:newHash,afterIterations:newAfter,...newProtocolCore}=context.nextProtocol;
  assert.equal(oldHash,digest(context.previousConfig));assert.equal(newHash,digest(context.nextConfig));
  assert.deepEqual(newProtocolCore,oldProtocolCore);assert.deepEqual(newAfter,context.boundaryIterations);
  assert.ok(Object.entries(newAfter).every(([id,n])=>Number.isInteger(n)&&n>=oldAfter[id]));
  assert.equal(digest(context.queue),context.boundaryQueueHash,'Existing requests must remain in their original queue');
  return digest(next);
}

export function assertApprovedEvaluationBinding(lane,request){
  const allowed=[{runtime:lane.runtime,config:lane.config,inputProtocol:lane.inputProtocol},...(lane.legacyBindings||[])];
  assert.ok(allowed.some(b=>digest(b.runtime)===digest(request.runtime)&&digest(b.config)===digest(request.config)
    &&digest(b.inputProtocol)===digest(request.pending.inputProtocol)),'Unregistered evaluation runtime/config/protocol combination');
  assert.equal(request.workers,lane.workers);
}

export function evaluationRuleScope(evaluationFingerprint,trainingFingerprint){
  assert.ok(typeof evaluationFingerprint==='string'&&evaluationFingerprint.length);
  assert.ok(typeof trainingFingerprint==='string'&&trainingFingerprint.length);
  return {evaluationEngineFingerprint:evaluationFingerprint,currentRuleEvidence:evaluationFingerprint===trainingFingerprint};
}
