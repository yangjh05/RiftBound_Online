import assert from 'node:assert/strict';
export function individualEpochResumeState(resume,maximumEpochs){
  if(!resume)return undefined;
  assert.ok(resume.selectionState);
  // The shared trainer stops after a rejected epoch. Its checkpoint cursor
  // points to the rejected epoch for general retry workflows. This finite
  // experiment must finalize that recorded rejection, never retry its budget.
  if(resume.accepted===false){
    assert.equal(resume.guard.passed,false);
    const accepted=resume.selectionState.epochGuards.filter(g=>g.passed).length;
    assert.equal(resume.selectionState.acceptedEpochs,accepted);
    // The generic trainer treats its cursor as a lower bound on accepted
    // epochs. Pin final selection to the ACTUAL accepted count so skipping
    // the loop cannot invent a generation or games-trained increment.
    return {...resume.selectionState,startEpoch:maximumEpochs,bestEpoch:accepted};
  }
  return resume.selectionState;
}
export function finalizeIndividualEpochResume(model,resume){
  if(resume?.accepted!==false)return;
  const accepted=resume.selectionState.acceptedEpochs;
  assert.equal(model.metadata.selectedEpoch,accepted);
  model.metadata={...model.metadata,acceptedEpochs:accepted};
}
