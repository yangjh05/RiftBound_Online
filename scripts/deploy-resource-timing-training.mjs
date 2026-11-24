import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';
import {digest} from './deck-league-contract.mjs';import {readLiveFileLockOwner} from './file-lock.mjs';
const [mode='request']=process.argv.slice(2),root=path.resolve('data/ai/deck-league-20261007'),out=path.resolve('data/ai/resource-timing-20261014-r3');
const prepared=json(path.join(out,'prepared.json')),old=json(verifyArtifact(prepared.previousRepair)),runtime=prepared.runtime;
const ref=f=>({path:f,sha256:sha(f)}),stopFile=path.join(root,'stop.request.json'),execution=path.join(root,'execution-r16-resource-timing');
const logText=f=>{const b=fs.readFileSync(f);return b[0]===255&&b[1]===254?b.subarray(2).toString('utf16le'):b.toString('utf8');};
async function stopped(){
  assert.equal(await readLiveFileLockOwner(path.join(root,'controller.lock')),null,'Wait for a complete saved iteration');
  assert.equal(json(stopFile).requestId,json(path.join(out,'handoff-request.json')).requestId,'Unknown stop request');
}
if(mode==='request'){
  assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previousPointer);
  assert.ok(!fs.existsSync(stopFile),'An existing stop request is owned by another operation');
  const tests=path.join(out,'focused-tests.log');assert.match(logText(tests),/tests 30\b/);assert.match(logText(tests),/fail 0\b/);
  const previousProof=json(verifyArtifact(old.trainingInferenceEquivalence));assert.equal(previousProof.passed,true);previousProof.tests.forEach(verifyArtifact);
  const manifest=json(verifyArtifact(runtime.manifest));manifest.forEach(f=>assert.equal(sha(path.join(runtime.directory,f.path)),f.sha256));
  const oldManifest=json(verifyArtifact(old.trainingRuntime.manifest));let unchanged=0;
  for(const f of oldManifest){if(prepared.changed.includes(f.path.replaceAll('\\','/')))continue;
    assert.equal(sha(path.join(runtime.directory,f.path)),f.sha256,f.path);unchanged++;}
  assert.equal(runtime.engineFingerprint,old.trainingRuntime.engineFingerprint);
  immutable(path.join(out,'runtime-verification.json'),{contract:'training-only-teacher-extension-v1',at:new Date().toISOString(),passed:true,
    trainingRuntime:runtime,evaluationRuntime:old.evaluationLane.runtime,previousProof:old.trainingInferenceEquivalence,
    inferenceFunctionsByteIdentical:true,nativeInferenceBitIdentical:true,defaultPpoBitIdentical:true,
    evidence:'All existing engine, neural, optimizer, inference and evaluation files are byte-identical; inherited native verification remains applicable.',
    unchangedFiles:unchanged,changedFiles:prepared.changed,teacherCriteriaUnchanged:false,tests:[...previousProof.tests,ref(tests)]});
  const handoff={at:new Date().toISOString(),requestId:randomUUID(),previousPointer:prepared.previousPointer,previousRepair:prepared.previousRepair,
    reason:'Install verified resource deployment timing teacher after the current iteration is saved; keep the evaluator running.'};
  immutable(path.join(out,'handoff-request.json'),handoff);immutable(stopFile,{requestId:handoff.requestId,at:handoff.at,reason:handoff.reason});
  console.log(JSON.stringify({requested:true,requestId:handoff.requestId,evaluationInterrupted:false}));
}else if(mode==='prepare'){
  await stopped();assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previousPointer);
  assert.ok(!fs.existsSync(execution),'Never rewrite an execution');fs.mkdirSync(execution,{recursive:true});
  const stateFile=path.join(root,'state.json'),state=json(stateFile);
  fs.copyFileSync(stateFile,path.join(out,'boundary-state.json'));
  const weights=[...new Map(Object.values(state.profiles).flatMap(p=>[p.learner,p.champion,...p.history]).map(r=>[r.path,r])).values()];weights.forEach(verifyArtifact);
  const resources=Object.keys(state.profiles).map(id=>path.join(old.trainingResourceDirectory||root,'resource-training-r1',id,'active.json'))
    .filter(f=>fs.existsSync(f)).flatMap(f=>[ref(f),json(f)]);resources.forEach(verifyArtifact);
  const requests=state.evaluationQueue.map(p=>p.evaluationRequest);requests.forEach(verifyArtifact);
  const boundary={at:new Date().toISOString(),state:ref(stateFile),snapshot:ref(path.join(out,'boundary-state.json')),
    config:ref(path.join(root,'config.json')),inputProtection:ref(path.join(root,'input-protection-live.json.gz')),weights,resources,requests,
    queueHash:digest(state.evaluationQueue),iterations:Object.fromEntries(Object.entries(state.profiles).map(([id,p])=>[id,p.iteration]))};
  immutable(path.join(out,'boundary-preservation.json'),boundary);
  for(const [file,hash] of Object.entries(old.executionFiles)){const from=path.join(root,prepared.previousPointer.directory,file);
    assert.equal(sha(from),hash);fs.mkdirSync(path.dirname(path.join(execution,file)),{recursive:true});fs.copyFileSync(from,path.join(execution,file));}
  immutable(path.join(execution,'evaluation-lane.json'),old.evaluationLane);
  const repair={...old,at:new Date().toISOString(),previousRepair:prepared.previousRepair,previousExecution:prepared.previousPointer,
    trainingRuntime:runtime,trainingInferenceEquivalence:ref(path.join(out,'runtime-verification.json')),
    resourceTimingTeacher:{contract:'local-resource-with-deployment-v2',afterIterations:boundary.iterations,
      maximumReviewsPerGame:old.resourceCollection.maximumReviewsPerGame,reservedTimingSlots:1,
      completedOwnPolicyGamesOnly:true,liveActionsOverridden:false,teacherCriteriaUnchanged:false},
    boundary:{preservation:ref(path.join(out,'boundary-preservation.json'))},
    externalArtifacts:[...(old.externalArtifacts||[]),ref(path.join(out,'prepared.json')),ref(path.join(out,'runtime-verification.json'))],
    reason:'Teach engine-verified energy/power deployment order and conditional idle-source delay from completed own-policy games.',
    teacherCriteriaUnchanged:false,evaluationCriteriaUnchanged:true,trainingAlgorithmUnchanged:true};
  immutable(path.join(execution,'repair.json'),repair);
  const pointer={directory:path.basename(execution),repairSha256:sha(path.join(execution,'repair.json')),executionHash:digest(repair.executionFiles)};
  immutable(path.join(out,'deployment-prepared.json'),{at:new Date().toISOString(),pointer,previousPointer:prepared.previousPointer,
    boundary:ref(path.join(out,'boundary-preservation.json')),executionDirectory:execution});
  console.log(JSON.stringify({prepared:true,pointer,iterations:boundary.iterations}));
}else if(mode==='select'||mode==='activate'){
  await stopped();const record=json(path.join(out,'deployment-prepared.json')),boundary=json(verifyArtifact(record.boundary));
  [boundary.state,boundary.config,boundary.inputProtection,...boundary.weights,...boundary.resources,...boundary.requests].forEach(verifyArtifact);
  assert.deepEqual(json(path.join(root,'execution-active.json')),mode==='select'?record.previousPointer:record.pointer);
  if(mode==='select'){atomic(path.join(root,'execution-active.json'),record.pointer);
    immutable(path.join(out,'selection.json'),{at:new Date().toISOString(),pointer:record.pointer});
    console.log(JSON.stringify({selected:true,stopRetained:true}));
  }else{
    const preflight=json(path.join(root,'preflight.json'));assert.equal(preflight.stage,'passed');
    assert.equal(preflight.executionHash,record.pointer.executionHash);assert.ok(preflight.at>json(path.join(out,'selection.json')).at);
    fs.renameSync(stopFile,path.join(out,'completed-stop.json'));
    immutable(path.join(out,'activation.json'),{at:new Date().toISOString(),pointer:record.pointer,trainingRuntime:runtime,
      boundaryPreservation:record.boundary,preflight:ref(path.join(root,'preflight.json')),weightsAndOptimizerPreserved:true,
      existingBanksPreserved:true,evaluationRuntimeUnchanged:true,teacherCriteriaUnchanged:false,trainingConfigured:true,
      liveWeightsAlreadyLearned:false});
    console.log(JSON.stringify({activated:true,processStartupStillRequired:true}));
  }
}else throw Error('Unknown mode '+mode);
