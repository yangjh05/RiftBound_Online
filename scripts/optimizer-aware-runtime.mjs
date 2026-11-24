import assert from 'node:assert/strict';
import {extendConstrainedPolicyRuntime} from './constrained-policy-runtime.mjs';

// Training-only extension of a private frozen runtime. The old runtime and
// default inference functions are never edited. Every replacement is checked.
export function extendOptimizerAwareRuntime(relative,original){
  let source=original;
  if(relative==='src/ai/neural/model.mjs'&&!source.includes('options.evaluateOnly === true'))source=extendConstrainedPolicyRuntime(relative,source);
  if(relative==='src/ai/neural/trainer.mjs'&&!source.includes('options.ppoBatchUpdate'))source=extendConstrainedPolicyRuntime(relative,source);
  const replace=(from,to)=>{assert.equal(source.split(from).length,2,`Unexpected source: ${relative}`);source=source.replace(from,to);};
  if(relative==='src/ai/neural/model.mjs'){
    replace('if (!rehearsal && !ppoBatchHasEffectiveSignal(batch, {',
      "if (!rehearsal && !(options.anchorOnly === true && anchorModels.length && anchorCoefficient > 0 && Array.from(batch.policyStepWeights || []).some(v=>v>0)) && !ppoBatchHasEffectiveSignal(batch, {");
    replace('const output = forwardNeural(model, tensors.states, tensors.actions, tensors.initialMemories, { teacherProposal: false, diagnostic: diagnosticCoefficient > 0, belief: beliefCoefficient > 0 });',
      'const candidateMemory = options.trainingInitialMemories?.(model, batch, tensors.initialMemories, {evaluateOnly: options.evaluateOnly === true}) ?? tensors.initialMemories;\n    const output = forwardNeural(model, tensors.states, tensors.actions, candidateMemory, { teacherProposal: false, diagnostic: diagnosticCoefficient > 0, belief: beliefCoefficient > 0 });');
    replace('const replay=forwardNeuralPolicy(model,replayTensors.states,replayTensors.actions,replayTensors.initialMemories);',
      'const replayMemory=options.trainingInitialMemories?.(model,rehearsal.batch,replayTensors.initialMemories,{evaluateOnly:options.evaluateOnly === true})??replayTensors.initialMemories;\n      const replay=forwardNeuralPolicy(model,replayTensors.states,replayTensors.actions,replayMemory);');
  }
  if(relative==='src/ai/neural/trainer.mjs')replace('actionCount, shape: [batchSize, sequenceLength], states, initialMemories, actions, selectedIndices, legalCounts,',
    'memoryContexts: chunks.map(chunk=>chunk.memoryContext||null),\n    actionCount, shape: [batchSize, sequenceLength], states, initialMemories, actions, selectedIndices, legalCounts,');
  if(relative==='src/ai/neural/selfplay.mjs'){
    source="import {createOnPolicyResourceCollector} from '../../../scripts/on-policy-resource-lessons.mjs';\n"+source;
    replace('const models = options.models || [model, model];',
      'const models = options.models || [model, model];\n  const resourceCollector=options.trainingResourceCollection?createOnPolicyResourceCollector(options.trainingResourceCollection):null;');
    replace('const decision = sessions[seat].decide(game, actorId, legal, { temperature: options.temperature || 0.8, random });',
      'const decision = sessions[seat].decide(game, actorId, legal, { temperature: options.temperature || 0.8, random });\n    if(resourceCollector&&trainableSeats.has(seat)&&seat===options.trainingResourceCollection.learnerSeat)resourceCollector.consider(game,actorId,decision,trajectories.get(actorId).map(step=>step.state));');
    replace('pendingLeafAudit: completed && deferredLeafAuditCandidates.length',
      '...(resourceCollector?{verifiedTrainingLessons:resourceCollector.finish(completed,models[options.trainingResourceCollection.learnerSeat])}:{}),\n    pendingLeafAudit: completed && deferredLeafAuditCandidates.length');
    replace('pendingLeafAudit: result.pendingLeafAudit || null\n',
      'pendingLeafAudit: result.pendingLeafAudit || null,\n        ...(result.verifiedTrainingLessons?{verifiedTrainingLessons:result.verifiedTrainingLessons}:{})\n');
  }
  if(relative==='scripts/ai-selfplay-task-options.mjs'){
    replace('  if (merged.maxActions != null &&',
      `  if (overrides?.trainingResourceCollection) {
    const c=overrides.trainingResourceCollection;
    if(c.contract!=='on-policy-resource-collection-v1'||c.role!=='training'
      ||!Number.isInteger(c.maximumReviews)||c.maximumReviews<1||c.maximumReviews>24
      ||!merged.leagueGameAssignment||c.learnerSeat!==merged.leagueGameAssignment.learnerSeat
      ||c.engineFingerprint!==baseOptions.engineFingerprint
      ||c.deckId!==(merged.deckSearchAssignment?.fixedLearnerDeckId??merged.decks[c.learnerSeat]?.id)||typeof c.gameId!=='string')
      throw new Error('Invalid committed learner resource collection');
    merged.trainingResourceCollection=Object.freeze({...c});
  }
  if (merged.maxActions != null &&`);
  }
  return source;
}
