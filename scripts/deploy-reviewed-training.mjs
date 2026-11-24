import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';
import {digest} from './deck-league-contract.mjs';
import {readLiveFileLockOwner} from './file-lock.mjs';
import {assertRulesRuntimeLaneTransition,assertApprovedEvaluationBinding} from './reviewed-training-contract.mjs';
const [mode='prepare']=process.argv.slice(2),root=path.resolve('data/ai/deck-league-20261007'),out=path.resolve('data/ai/conversation-integration-20261014');
const execution=path.join(root,'execution-r15-conversation-rules'),handoff=json(path.join(out,'handoff-request.json'));
const ref=f=>({path:f,sha256:sha(f)}),evalRoot=path.join(root,'evaluation-r6');
async function stopped(){
 for(const dir of [root,evalRoot]){
  assert.equal(await readLiveFileLockOwner(path.join(dir,'controller.lock')),null,'Wait for the committed save boundary');
  assert.equal(json(path.join(dir,'stop.request.json')).requestId,handoff.requestId,'Unknown stop request');
 }
}
if(mode==='prepare'){
 await stopped();assert.deepEqual(json(path.join(root,'execution-active.json')),handoff.previousPointer);
 const old=json(verifyArtifact(handoff.previousRepair)),runtime=json('data/ai/hidden-rule-repair-20261014-r2/prepared.json').runtime;
 const proofFile=path.join(out,'runtime-verification.json'),proof=json(proofFile);assert.equal(proof.passed,true);assert.deepEqual(proof.trainingRuntime,runtime);proof.tests.forEach(verifyArtifact);
 const curriculumFile=path.join(out,'curriculum.json'),curriculum=json(curriculumFile);assert.equal(curriculum.completed,true);
 assert.equal(curriculum.allCasesAccountedFor,true);assert.equal(curriculum.terminalLabels,false);assert.deepEqual(curriculum.runtime,runtime);
 for(const id of ['kaisa','viktor'])assert.ok(curriculum.accepted[id]>0,'No independently certified correction for '+id);
 const additions=json(path.join(out,'lesson-additions.json'));for(const a of Object.values(additions)){verifyArtifact(a.audit);verifyArtifact(a.augmented);}
 assert.ok(!fs.existsSync(path.join(execution,'repair.json')),'Never rewrite a sealed execution');fs.mkdirSync(execution,{recursive:true});
 const stateFile=path.join(root,'state.json'),state=json(stateFile),boundaryIterations=Object.fromEntries(Object.entries(state.profiles).map(([id,p])=>[id,p.iteration]));
 fs.copyFileSync(stateFile,path.join(out,'boundary-state.json'));
 fs.copyFileSync(path.join(root,'input-protection-live.json.gz'),path.join(out,'boundary-input-protection.json.gz'));
 const weights=[...new Map(Object.values(state.profiles).flatMap(p=>[p.learner,p.champion,...p.history]).map(r=>[r.path,r])).values()];weights.forEach(verifyArtifact);
 const requests=fs.readdirSync(path.join(evalRoot,'requests')).filter(n=>n.endsWith('.request.json')).map(n=>ref(path.join(evalRoot,'requests',n)));
 const previousResourcePointers=Object.keys(state.profiles).map(id=>path.join(old.trainingResourceDirectory||root,'resource-training-r1',id,'active.json'))
  .filter(f=>fs.existsSync(f)).map(ref);
 const boundary={at:new Date().toISOString(),state:ref(path.join(out,'boundary-state.json')),liveState:ref(stateFile),
  inputProtection:ref(path.join(out,'boundary-input-protection.json.gz')),liveInputProtection:ref(path.join(root,'input-protection-live.json.gz')),
  weights,requests,previousResourcePointers,config:ref(path.join(root,'config.json')),iterations:boundaryIterations,queueHash:digest(state.evaluationQueue)};
 immutable(path.join(out,'boundary-preservation.json'),boundary);
 const previousLaneFile=path.join(execution,'previous-evaluation-lane.json');immutable(previousLaneFile,old.evaluationLane);
 const previousConfig=json(verifyArtifact(old.evaluationLane.config)),previousProtocol=json(verifyArtifact(old.evaluationLane.inputProtocol));
 const nextConfig={...previousConfig,runtimeDirectory:runtime.directory,runtimeManifest:runtime.manifest,engineFingerprint:runtime.engineFingerprint};
 const nextProtocol={...previousProtocol,configHash:digest(nextConfig),afterIterations:boundaryIterations};
 const configFile=path.join(execution,'evaluation-config.json'),protocolFile=path.join(execution,'evaluation-protocol.json');
 immutable(configFile,nextConfig);immutable(protocolFile,nextProtocol);
 const lane={...old.evaluationLane,runtime,config:ref(configFile),inputProtocol:ref(protocolFile),
  legacyBindings:[...(old.evaluationLane.legacyBindings||[]),{runtime:old.evaluationLane.runtime,config:old.evaluationLane.config,inputProtocol:old.evaluationLane.inputProtocol}]};
 assertRulesRuntimeLaneTransition(old.evaluationLane,lane,state.evaluationLaneHash,{previousConfig,nextConfig,previousProtocol,nextProtocol,
  boundaryIterations,boundaryQueueHash:boundary.queueHash,queue:state.evaluationQueue});
 for(const p of state.evaluationQueue)assertApprovedEvaluationBinding(lane,json(verifyArtifact(p.evaluationRequest)));
 const changed=new Set(['train-deck-league.mjs','deck-league-contract.mjs','run-deck-league-evaluation.mjs','reviewed-training-contract.mjs']);
 const names=[...new Set([...Object.keys(old.executionFiles),...changed])];
 for(const name of names){
  const source=changed.has(name)?path.resolve('scripts',name):path.join(root,handoff.previousPointer.directory,name);
  if(!changed.has(name))assert.equal(sha(source),old.executionFiles[name]);
  fs.copyFileSync(source,path.join(execution,name));
 }
 const repair={...old,at:new Date().toISOString(),previousRepair:handoff.previousRepair,previousExecution:handoff.previousPointer,
  executionFiles:Object.fromEntries(names.map(n=>[n,sha(path.join(execution,n))])),trainingRuntime:runtime,evaluationLane:lane,
  trainingInferenceEquivalence:ref(proofFile),lessonAdditions:{...old.lessonAdditions,...additions},conversationCurriculum:ref(curriculumFile),
  trainingResourceDirectory:path.join(root,'corrected-rules-resource-curriculum-20261014'),
  resourceBankTransition:{previousDirectory:old.trainingResourceDirectory||root,previousArtifactsPreserved:true,
    reason:'New rule identity and augmented base bank; collect new on-policy resource lessons without relabelling or rewriting previous banks.'},
  evaluationLaneTransition:{contract:'queue-preserving-rules-runtime-transition-v1',previousLane:ref(previousLaneFile),boundaryIterations,boundaryQueueHash:boundary.queueHash,
    legacyResultsDiagnosticOnly:true,legacyResultsCannotPromoteOrRecoverCurrentRuleLearners:true},
  boundary:{preservation:ref(path.join(out,'boundary-preservation.json'))},
  externalArtifacts:[...(old.externalArtifacts||[]),ref(curriculumFile),ref(path.join(out,'lesson-additions.json')),
    curriculum.evidence,curriculum.rawReviews,curriculum.positionReviews,curriculum.publicResponseCatalog,curriculum.analysisLedger,curriculum.acceptanceAudit],
  reason:'Correct Hidden Reaction rules; train on independently verified public corrections from the user-reviewed KaiSa/Viktor branches. Preserve Adam state, original lesson banks, queue, evaluation criteria and all evidence.',
  trainingAlgorithmUnchanged:true,criteriaUnchanged:true};
 delete repair.engineTransition;
 immutable(path.join(execution,'evaluation-lane.json'),lane);
 repair.evaluationCoordinator={entry:ref(path.join(execution,'run-deck-league-evaluation.mjs')),lane:ref(path.join(execution,'evaluation-lane.json'))};
 immutable(path.join(execution,'repair.json'),repair);
 const pointer={directory:path.basename(execution),repairSha256:sha(path.join(execution,'repair.json')),executionHash:digest(repair.executionFiles)};
 immutable(path.join(out,'deployment-prepared.json'),{at:new Date().toISOString(),previousPointer:handoff.previousPointer,nextPointer:pointer,
  boundary:ref(path.join(out,'boundary-preservation.json')),accepted:curriculum.accepted,executionDirectory:execution,
  wrappers:['run-deck-league.ps1','run-deck-league-evaluation.ps1'].map(n=>ref(path.resolve('scripts',n)))});
 console.log(JSON.stringify({prepared:true,pointer,accepted:curriculum.accepted}));
}else if(mode==='select'){
 await stopped();const record=json(path.join(out,'deployment-prepared.json'));assert.deepEqual(json(path.join(root,'execution-active.json')),record.previousPointer);
 const boundary=json(verifyArtifact(record.boundary));[boundary.liveState,boundary.liveInputProtection,boundary.config,...boundary.weights,...boundary.requests,...boundary.previousResourcePointers,...record.wrappers].forEach(verifyArtifact);
 atomic(path.join(root,'execution-active.json'),record.nextPointer);console.log(JSON.stringify({selected:true,stopsRemain:true}));
}else if(mode==='activate'){
 await stopped();const record=json(path.join(out,'deployment-prepared.json'));assert.deepEqual(json(path.join(root,'execution-active.json')),record.nextPointer);
 assert.equal(json(path.join(root,'preflight.json')).stage,'passed');assert.equal(json(path.join(root,'preflight.json')).executionHash,record.nextPointer.executionHash);
 assert.equal(json(path.join(evalRoot,'controller.json')).stage,'passed');
 const boundary=json(verifyArtifact(record.boundary));[boundary.liveState,boundary.liveInputProtection,boundary.config,...boundary.weights,...boundary.requests,...boundary.previousResourcePointers,...record.wrappers].forEach(verifyArtifact);
 fs.renameSync(path.join(root,'stop.request.json'),path.join(out,'completed-main-stop.json'));
 fs.renameSync(path.join(evalRoot,'stop.request.json'),path.join(out,'completed-evaluation-stop.json'));
 immutable(path.join(out,'activation.json'),{at:new Date().toISOString(),pointer:record.nextPointer,boundaryPreservation:record.boundary,
  acceptedLessons:record.accepted,existingWeightsAndAdamStatePreserved:true,criteriaUnchanged:true,liveTrainingActivated:true,
  means:'New training execution selected and both startup preflights passed; process startup/lesson consumption recorded separately.'});
 console.log(JSON.stringify({activated:true,pointer:record.nextPointer,acceptedLessons:record.accepted}));
}else throw Error('Unknown mode '+mode);
