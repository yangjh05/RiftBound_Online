import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {gunzipSync} from 'node:zlib';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';import {readLiveFileLockOwner} from './file-lock.mjs';
const root=path.resolve('data/ai/deck-league-20261007'),currentPointer=json(path.join(root,'execution-active.json'));
const currentRepair=json(verifyArtifact({path:path.join(root,currentPointer.directory,'repair.json'),sha256:currentPointer.repairSha256}));
const out=path.resolve(process.env.RIFTBOUND_REACHABLE_REPAIR_DIRECTORY||path.dirname(currentRepair.boundary.preservation.path));
const activation=json(path.join(out,'activation.json')),prepared=json(path.join(out,'prepared.json')),boundary=json(verifyArtifact(activation.boundaryPreservation));
assert.deepEqual(json(path.join(root,'execution-active.json')),activation.pointer);
json(verifyArtifact(prepared.runtime.manifest)).forEach(f=>assert.equal(sha(path.join(prepared.runtime.directory,f.path)),f.sha256));
const repair=json(verifyArtifact({path:path.join(root,activation.pointer.directory,'repair.json'),sha256:activation.pointer.repairSha256}));
for(const [file,hash]of Object.entries(repair.executionFiles))assert.equal(sha(path.join(root,activation.pointer.directory,file)),hash);
[boundary.config,...boundary.weights,...boundary.banks,...boundary.requests,...boundary.resources.filter(r=>!r.path.endsWith('active.json'))].forEach(verifyArtifact);
const owners={main:await readLiveFileLockOwner(path.join(root,'controller.lock')),evaluation:await readLiveFileLockOwner(path.join(repair.evaluationLane.directory,'controller.lock'))};
const processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
 "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024}));
for(const [role,file]of [['main','train-deck-league.mjs'],['evaluation','run-deck-league-evaluation.mjs']]){
 const full=path.join(root,activation.pointer.directory,file),found=processes.filter(p=>p.CommandLine?.includes(full));
 assert.equal(found.length,1,role+' must have exactly one coordinator');assert.equal(found[0].ProcessId,owners[role]?.pid);
}
const main=json(path.join(root,'controller.json')),evaluation=json(path.join(repair.evaluationLane.directory,'controller.json'));
assert.ok(!['failed','paused-at-boundary'].includes(main.stage));assert.ok(!['failed','paused-at-boundary'].includes(evaluation.stage));
const state=json(path.join(root,'state.json')),results=[];
const boundaryState=json(verifyArtifact(boundary.snapshot)),archive=file=>JSON.parse(gunzipSync(fs.readFileSync(file)));
for(const [id,p]of Object.entries(state.profiles))for(let iteration=boundary.iterations[id]+1;iteration<=p.iteration;iteration++){
 const file=path.join(root,'profiles',id,'iterations',String(iteration).padStart(6,'0'),'candidate.json.gz');
 const c=archive(file);assert.equal(c.policyLearning?.contract,prepared.trainingContract);
 const previousFile=iteration===boundary.iterations[id]+1?boundaryState.profiles[id].learner.path:path.join(root,'profiles',id,'iterations',String(iteration-1).padStart(6,'0'),'candidate.json.gz');
 const previousStep=archive(previousFile).optimizerState?.weights?.find(w=>w.name==='iter')?.values?.[0]??0;
 const attempts=c.batchReports||[];
 assert.ok(attempts.every(b=>b.nativeTrialSteps<=14&&b.nativeStepsCommitted<=7));
 results.push({profileId:id,iteration,file,sha256:sha(file),changed:c.beforeBehaviorHash!==c.afterBehaviorHash,
   acceptedMinibatches:attempts.filter(b=>b.accepted).length,minibatches:attempts.length,
   nativeStepsApprovedBeforeEpochGuard:attempts.reduce((n,b)=>n+b.nativeStepsCommitted,0),
   committedEpochs:c.epochGuards.filter(g=>g.passed).length,attemptedEpochs:c.epochGuards.length,
   initialAdamStep:previousStep,finalAdamStep:c.optimizerState.weights.find(w=>w.name==='iter').values[0],
   retainedAdamStepChange:c.optimizerState.weights.find(w=>w.name==='iter').values[0]-previousStep,requiredRecoveryCases:attempts.map(b=>b.requiredRecoveryCases),
   recoveryAttempts:attempts.map(b=>b.attempts.filter(a=>a.proposal==='bounded-native-adam-recovery').map(a=>({step:a.recoveryStep,passed:a.passed,provisional:a.provisional,progress:a.progress,noRegression:a.noRegression}))),
   projectionFailures:attempts.map(b=>b.projection.inverseAttempts.filter(a=>!a.feasible)),resourceCollection:c.resourceCollection,
   finalGuards:c.epochGuards.map(g=>({epoch:g.epoch,passed:g.passed,validation:g.lessonRetention?.validation,additional:g.lessonRetention?.additionalGuard,atomic:g.lessonRetention?.report?.atomicEpoch}))});
}
const record={at:new Date().toISOString(),passed:true,owners,main,evaluation,activation,results,
  preservedBoundaryWeights:boundary.weights.length,preservedBanks:boundary.banks.length,preservedEvaluationRequests:boundary.requests.length,
  policyContract:prepared.trainingContract,completedNewIterations:results.length,newPlayingStrengthProven:false};
atomic(path.join(out,'live-verification.json'),record);
const workFile=path.resolve('data/ai/optimizer-repair-20261013/work-state.json'),work=json(workFile);
const nextStatus='running-current-constraint-recovery-validation-in-progress';
if(work.status!==nextStatus)work.previousStatus=work.status;
work.status=nextStatus;work.updatedAt=record.at;
work.mainPid=owners.main.pid;work.evaluationPid=owners.evaluation.pid;work.reachableRecovery={directory:out,execution:activation.pointer.directory,verification:path.join(out,'live-verification.json'),completedIterations:results.length};
atomic(workFile,work);console.log(JSON.stringify({at:record.at,passed:true,main,evaluation,completedNewIterations:results.length,results}));
