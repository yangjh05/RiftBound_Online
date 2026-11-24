import test from 'node:test';import assert from 'node:assert/strict';
import {individualEpochResumeState,finalizeIndividualEpochResume} from '../scripts/individual-epoch-resume.mjs';
test('a rejected finite epoch resumes finalization without retrying the rejected update',()=>{
 const state={startEpoch:0,acceptedEpochs:0,epochGuards:[{passed:false}]};
 const rejected={accepted:false,guard:{passed:false},selectionState:state};
 assert.equal(individualEpochResumeState(rejected,4).startEpoch,4);assert.equal(state.startEpoch,0);
 assert.equal(individualEpochResumeState(rejected,4).bestEpoch,0);
 assert.deepEqual(individualEpochResumeState(rejected,4).epochGuards,[{passed:false}]);
 assert.equal(individualEpochResumeState({accepted:true,selectionState:state},4),state);
 assert.equal(individualEpochResumeState(null,4),undefined);
 assert.throws(()=>individualEpochResumeState({...rejected,guard:{passed:true}},4));
 assert.throws(()=>individualEpochResumeState({...rejected,selectionState:{...state,acceptedEpochs:1}},4));
 const model={metadata:{selectedEpoch:0,acceptedEpochs:4}};finalizeIndividualEpochResume(model,rejected);
 assert.equal(model.metadata.acceptedEpochs,0);
});
