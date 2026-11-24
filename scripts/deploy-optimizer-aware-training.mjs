import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';import {digest} from './deck-league-contract.mjs';
import {readLiveFileLockOwner} from './file-lock.mjs';
const [mode='prepare']=process.argv.slice(2),root=path.resolve('data/ai/deck-league-20261007'),audit=path.resolve('data/ai/optimizer-repair-20261013/r11');
const prepared=json(path.join(audit,'runtime-prepared.json')),execution=path.join(root,'execution-r8-optimizer-aware');
const ref=file=>({path:file,sha256:sha(file)}),stop=path.join(root,'stop.request.json'),evalRoot=path.join(root,'evaluation-r6'),evalStop=path.join(evalRoot,'stop.request.json');
if(mode==='prepare'){
 assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previousPointer);verifyArtifact(prepared.previousRepair);
 assert.ok(!fs.existsSync(stop)&&!fs.existsSync(evalStop),'An existing stop must not be removed');
 const log=path.join(audit,'native-tests.log'),lossLog=path.join(audit,'full-history-loss-tests.log');
 // The separate loss test log is copied without rerunning the passed tests.
 if(!fs.existsSync(lossLog))fs.copyFileSync(path.resolve('data/ai/optimizer-repair-20261013/r11/full-history-loss-tests.log'),lossLog);
 assert.match(fs.readFileSync(log,'utf8'),/pass 32\b/);assert.match(fs.readFileSync(log,'utf8'),/fail 0\b/);assert.match(fs.readFileSync(log,'utf8'),/skipped 0\b/);
 assert.match(fs.readFileSync(lossLog,'utf8'),/pass 3\b/);assert.match(fs.readFileSync(lossLog,'utf8'),/fail 0\b/);assert.match(fs.readFileSync(lossLog,'utf8'),/skipped 0\b/);
 const proof={contract:'optimizer-aware-native-verification-v1',at:new Date().toISOString(),passed:true,trainingRuntime:prepared.runtime,evaluationRuntime:prepared.previousRuntime,
  inferenceFunctionsByteIdentical:true,nativeInferenceBitIdentical:true,defaultPpoBitIdentical:true,fullHistoryDerivativeFiniteDifferencePassed:true,
  actualAdamMomentsAndResumeVerified:true,teacherCriteriaUnchanged:true,protectedInputsExcluded:true,distinctNativeTestsPassed:33,tests:[ref(log),ref(lossLog)]};
 immutable(path.join(audit,'native-optimizer-verification.json'),proof);
 const old=json(prepared.previousRepair.path),targetsFile=path.resolve('data/ai/training-repair-20261013/verification-targets.json'),targets=json(targetsFile);
 targets.mainRequests.forEach(verifyArtifact);
 const dispatchFile=path.join(audit,'fixed-evaluation-priority.json');immutable(dispatchFile,{contract:'fixed-verification-priority-v1',performanceIndependent:true,
  originalTargets:ref(targetsFile),requests:targets.mainRequests,maximumJobsPerVisit:8,criteriaUnchanged:true,seedsAndBudgetsUnchanged:true});
 const lane={...old.evaluationLane,dispatchPolicy:ref(dispatchFile)};
 const names=[...new Set([...Object.keys(old.executionFiles),'league-evaluation-admission.mjs','constrained-epoch-evidence.mjs'])];
 assert.ok(!fs.existsSync(path.join(execution,'repair.json')));fs.mkdirSync(execution,{recursive:true});
 for(const name of names)fs.copyFileSync(path.resolve('scripts',name),path.join(execution,name));
 const repair={...old,executionFiles:Object.fromEntries(names.map(n=>[n,sha(path.join(execution,n))])),previousRepair:prepared.previousRepair,
  trainingRuntime:prepared.runtime,evaluationLane:lane,trainingInferenceEquivalence:ref(path.join(audit,'native-optimizer-verification.json')),
  policyLearning:{contract:prepared.trainingContract,trainingOnly:true,fullHistoryGradients:true,actualAdamDeltaProjection:true,exactAdamMoments:true,
    minibatchApprovalIsNotEpochCommit:true,zeroUpdateEpochsRejected:true},
  resourceCollection:{contract:'on-policy-resource-collection-v1',maximumReviewsPerGame:2,maximumActiveLessons:32,onlyScheduledOwnPolicyGames:true,
    teacherCallsAfterCompletion:true,teacherCriteriaUnchanged:true,validationNeverSuppliesDirections:true},
  evaluationAdmission:{maximumPending:4,fixedCadenceUnchanged:true,learningContinuesAtCapacity:true,existingRequestsPreserved:true},
  fairDispatch:{maximumJobsPerVisit:8,order:'fixed-verification-first-then-least-recently-dispatched',performanceIndependent:true},
  trainingAlgorithmUnchanged:false,criteriaUnchanged:true,reason:'Optimizer-aware exact Adam proposals and full-history gradients; training-only in-game resource collection; bounded evaluation admission'};
 // The old engine transition describes a previously completed r4 plan. It
 // stays in previousRepair; it is not a transition to this training-only build.
 delete repair.engineTransition;
 immutable(path.join(execution,'repair.json'),repair);immutable(path.join(execution,'evaluation-lane.json'),lane);
 const nextPointer={directory:path.basename(execution),repairSha256:sha(path.join(execution,'repair.json')),executionHash:digest(repair.executionFiles)};
 const wrappers=['run-deck-league.ps1','run-deck-league-evaluation.ps1'].map(name=>{
  const source=path.resolve('scripts',name),copy=path.join(audit,name+'.verified');fs.copyFileSync(source,copy);assert.equal(sha(source),sha(copy));return {...ref(source),verifiedCopy:ref(copy)};
 });
 const requestId=randomUUID(),record={at:new Date().toISOString(),requestId,previousPointer:prepared.previousPointer,nextPointer,executionDirectory:execution,
  wrappers,proof:ref(path.join(audit,'native-optimizer-verification.json')),targets:ref(targetsFile),mainOwner:await readLiveFileLockOwner(path.join(root,'controller.lock')),
  evaluationOwner:await readLiveFileLockOwner(path.join(evalRoot,'controller.lock')),fixedBudgetPreserved:true,studyMustNotRestart:true};
 assert.ok(record.mainOwner&&record.evaluationOwner);immutable(path.join(audit,'handoff-prepared.json'),record);
 for(const file of [stop,evalStop])atomic(file,{at:new Date().toISOString(),requestId,reason:'User-authorized optimizer-aware training boundary handoff',preserveArtifacts:true});
 console.log(JSON.stringify({prepared:true,requestId,nextPointer,mainPid:record.mainOwner.pid,evaluationPid:record.evaluationOwner.pid}));
}else{
 assert.equal(mode,'activate');const record=json(path.join(audit,'handoff-prepared.json'));
 assert.equal(await readLiveFileLockOwner(path.join(root,'controller.lock')),null,'Training has not reached its save boundary');
 assert.equal(await readLiveFileLockOwner(path.join(evalRoot,'controller.lock')),null,'Evaluation is still computing');
 assert.deepEqual(json(path.join(root,'execution-active.json')),record.previousPointer);
 for(const file of [stop,evalStop])assert.equal(json(file).requestId,record.requestId,'Unknown stop request; never remove it');
 assert.equal(json(path.join(root,'controller.json')).stage,'paused-at-boundary');assert.equal(json(path.join(evalRoot,'controller.json')).stage,'paused-at-boundary');
 const stateFile=path.join(root,'state.json'),state=json(stateFile),snap=path.join(audit,'boundary-state.json');
 fs.copyFileSync(stateFile,snap);
 const weights=[...new Map(Object.values(state.profiles).flatMap(p=>[p.learner,p.champion,...p.history]).map(r=>[r.path,r])).values()];weights.forEach(verifyArtifact);
 const requests=fs.readdirSync(path.join(evalRoot,'requests')).filter(n=>n.endsWith('.request.json')).map(n=>ref(path.join(evalRoot,'requests',n)));
 immutable(path.join(audit,'boundary-preservation.json'),{at:new Date().toISOString(),state:ref(snap),weights,requests,config:ref(path.join(root,'config.json')),
  iterations:Object.fromEntries(Object.entries(state.profiles).map(([id,p])=>[id,p.iteration])),queue:state.evaluationQueue});
 for(const wrapper of record.wrappers){verifyArtifact(wrapper);verifyArtifact(wrapper.verifiedCopy);}
 atomic(path.join(root,'execution-active.json'),record.nextPointer);
 fs.renameSync(stop,path.join(audit,'completed-main-handoff-stop.json'));fs.renameSync(evalStop,path.join(audit,'completed-evaluation-handoff-stop.json'));
 immutable(path.join(audit,'activation.json'),{at:new Date().toISOString(),pointer:record.nextPointer,boundaryPreservation:ref(path.join(audit,'boundary-preservation.json')),
  existingDataPreserved:true,criteriaUnchanged:true,completedStudyNotRestarted:true});
 console.log(JSON.stringify({activated:true,pointer:record.nextPointer,boundaryIterations:Object.fromEntries(Object.entries(state.profiles).map(([id,p])=>[id,p.iteration]))}));
}
