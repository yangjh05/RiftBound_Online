import test from 'node:test';import assert from 'node:assert/strict';
import {evaluationAdmission,assertDispatchOnlyLaneTransition} from '../scripts/league-evaluation-admission.mjs';
import {digest} from '../scripts/deck-league-contract.mjs';
import {nextLeagueEvaluation} from '../scripts/deck-league-evaluation-dispatch.mjs';
test('frozen verification requests precede future candidates without consulting game outcomes',()=>{
 const files=['future','fixed-a','fixed-b'],visits={future:0,'fixed-a':100,'fixed-b':101};
 assert.equal(nextLeagueEvaluation(files,visits,()=>0,{priorityFiles:['fixed-a','fixed-b']}),'fixed-a');
 visits['fixed-a']=102;assert.equal(nextLeagueEvaluation(files,visits,()=>0,{priorityFiles:['fixed-a','fixed-b']}),'fixed-b');
 assert.equal(nextLeagueEvaluation(['future'],visits,()=>0,{priorityFiles:['fixed-a']}),'future');
});
test('dispatch migration preserves engine, worker count, config and evidence directory',()=>{
 const previous={directory:'same',runtime:{engineFingerprint:'same'},config:{path:'same',sha256:'same'},workers:3};
 const next={...previous,dispatchPolicy:{path:'policy',sha256:'policy'}};
 assert.equal(assertDispatchOnlyLaneTransition(previous,next,digest(previous)),digest(next));
 for(const changed of [{...next,workers:4},{...next,directory:'new'},{...next,runtime:{engineFingerprint:'other'}},{...next,config:{path:'other',sha256:'other'}}])
  assert.throws(()=>assertDispatchOnlyLaneTransition(previous,changed,digest(previous)));
 assert.throws(()=>assertDispatchOnlyLaneTransition(previous,next,'uncommitted'));
});
test('bounded admission retains existing requests and fixed cadence while learning continues',()=>{
 const pending=[{profileId:'a'},{profileId:'b'}],base={iteration:8,everyIterations:4,pending,profileId:'c',changed:true,maximumPending:2};
 assert.equal(evaluationAdmission(base).reason,'evaluation-capacity');assert.deepEqual(pending,[{profileId:'a'},{profileId:'b'}]);
 assert.equal(evaluationAdmission({...base,maximumPending:3}).admit,true);
 assert.equal(evaluationAdmission({...base,iteration:9,maximumPending:3}).admit,false);
 assert.equal(evaluationAdmission({...base,profileId:'a',maximumPending:3}).reason,'profile-evaluation-pending');
 assert.equal(evaluationAdmission({...base,changed:false,maximumPending:3}).admit,false);
});
