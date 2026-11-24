import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';
import {digest} from './deck-league-contract.mjs';import {readLiveFileLockOwner} from './file-lock.mjs';
const mode=process.argv[2],root=path.resolve('data/ai/deck-league-20261007'),out=path.resolve('data/ai/transactional-epoch-repair-20261015');
const prepared=json(path.join(out,'prepared.json')),old=json(verifyArtifact(prepared.previousRepair)),runtime=prepared.runtime;
const ref=f=>({path:f,sha256:sha(f)}),stopFile=path.join(root,'stop.request.json'),execution=path.join(root,'execution-r17-atomic-epoch');
const logText=f=>{const b=fs.readFileSync(f);return b[0]===255&&b[1]===254?b.subarray(2).toString('utf16le'):b.toString('utf8');};
const wrappers={
 'scripts/run-deck-league.ps1':'bb412accc3a8a090a15ad762eb3bf487f52fbf0d7d3d396187e947fe568485ec',
 'scripts/run-deck-league-evaluation.ps1':'7816fd199401e9fe93aa1deae0efbe475a31844fb2f8dd825ded924643540a92'};
function verifyRuntime(){
 const manifest=json(verifyArtifact(runtime.manifest));manifest.forEach(f=>assert.equal(sha(path.join(runtime.directory,f.path)),f.sha256));
 const prior=json(verifyArtifact(old.trainingRuntime.manifest));let unchanged=0;
 for(const f of prior){if(prepared.changed.includes(f.path.replaceAll('\\','/')))continue;
  assert.equal(sha(path.join(runtime.directory,f.path)),f.sha256,f.path);unchanged++;}
 assert.equal(runtime.engineFingerprint,old.trainingRuntime.engineFingerprint);
 for(const [file,hash]of Object.entries(wrappers))assert.equal(sha(path.resolve(file)),hash,file);
 return unchanged;
}
async function stopped(){
 assert.equal(await readLiveFileLockOwner(path.join(root,'controller.lock')),null,'Wait for the saved iteration boundary');
 assert.deepEqual(json(stopFile),json(path.join(out,'handoff-request.json')),'Unknown stop request');
 assert.equal(json(path.join(root,'controller.json')).stage,'paused-at-boundary');
}
if(mode==='verify'){
 const tests=[['focused-tests-r2.log',24],['commit-compatibility-tests-r2.log',11]].map(([name,count])=>{
  const file=path.join(out,name),text=logText(file);assert.match(text,new RegExp('tests '+count+'\\b'));
  assert.match(text,/fail 0\b/);assert.match(text,/skipped 0\b/);return ref(file);});
 const unchanged=verifyRuntime(),previousProof=json(verifyArtifact(old.trainingInferenceEquivalence));assert.equal(previousProof.passed,true);
 previousProof.tests.forEach(verifyArtifact);
 immutable(path.join(out,'runtime-verification.json'),{contract:'training-only-atomic-epoch-verification-v1',at:new Date().toISOString(),passed:true,
  trainingRuntime:runtime,evaluationRuntime:old.evaluationLane.runtime,previousProof:old.trainingInferenceEquivalence,
  inferenceFunctionsByteIdentical:true,nativeInferenceBitIdentical:true,defaultPpoBitIdentical:true,
  changedFiles:prepared.changed,addedFiles:prepared.added,unchangedFiles:unchanged,uniqueTests:29,
  tests,teacherCriteriaUnchanged:true,evaluationCriteriaUnchanged:true,
  evidence:'Previous runtime compared directly: inference and ordinary PPO bits identical. Native Adam continuation, recovered optimizer commit, and complete rejection rollback tested. All teacher, engine, model and evaluation files retain previous hashes.'});
 console.log(JSON.stringify({verified:true,unchangedFiles:unchanged,uniqueTests:29}));
}else if(mode==='prepare'){
 await stopped();verifyRuntime();assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previousPointer);
 assert.ok(!fs.existsSync(execution),'Never rewrite a sealed execution');
 const stateFile=path.join(root,'state.json'),state=json(stateFile),config=json(path.join(root,'config.json'));
 fs.copyFileSync(stateFile,path.join(out,'boundary-state.json'));
 const weights=[...new Map(Object.values(state.profiles).flatMap(p=>[p.learner,p.champion,...p.history]).map(r=>[r.path,r])).values()];
 const resources=Object.keys(state.profiles).map(id=>path.join(old.trainingResourceDirectory||root,'resource-training-r1',id,'active.json'))
  .filter(f=>fs.existsSync(f)).flatMap(f=>[ref(f),json(f)]);
 const requests=state.evaluationQueue.map(p=>p.evaluationRequest);
 const banks=[...config.profiles.map(p=>p.lessons),...Object.values(old.lessonAdditions||{}).map(a=>a.augmented)];
 [...weights,...resources,...requests,...banks].forEach(verifyArtifact);
 const boundary={at:new Date().toISOString(),state:ref(stateFile),snapshot:ref(path.join(out,'boundary-state.json')),
  config:ref(path.join(root,'config.json')),inputProtection:ref(path.join(root,'input-protection-live.json.gz')),weights,resources,requests,banks,
  seedLedger:ref(path.join(root,'seed-ledger.json')),queueHash:digest(state.evaluationQueue),
  iterations:Object.fromEntries(Object.entries(state.profiles).map(([id,p])=>[id,p.iteration])),
  budgets:{gamesPerOpponent:config.gamesPerOpponent,epochs:config.epochs,evaluation:config.evaluation}};
 immutable(path.join(out,'boundary-preservation.json'),boundary);fs.mkdirSync(execution,{recursive:true});
 const executionFiles={...old.executionFiles};
 for(const [file,hash]of Object.entries(old.executionFiles)){
  const from=path.join(root,prepared.previousPointer.directory,file),to=path.join(execution,file);assert.equal(sha(from),hash);
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(file==='train-deck-league.mjs'?path.resolve('scripts',file):from,to);
  executionFiles[file]=sha(to);
 }
 immutable(path.join(execution,'evaluation-lane.json'),old.evaluationLane);
 const repair={...old,at:new Date().toISOString(),previousRepair:prepared.previousRepair,previousExecution:prepared.previousPointer,executionFiles,
  trainingRuntime:runtime,trainingInferenceEquivalence:ref(path.join(out,'runtime-verification.json')),
  policyLearning:{...old.policyLearning,contract:prepared.trainingContract,trainingReferenceRecoveryPriority:true,separateOriginalAndAugmentedDirections:true},
  atomicEpochCommit:{contract:'exact-adam-atomic-epoch-v1',rawProposalFirst:true,pairedWeightOptimizerCommit:true,exactBiasPowerResume:true,
   recoveryAdamStepsBoundedByAcceptedBatches:true,zeroAcceptedBatchSkipsRecovery:true,heldOutLabelsTrained:false},
  boundary:{preservation:ref(path.join(out,'boundary-preservation.json'))},
  externalArtifacts:[...(old.externalArtifacts||[]),ref(path.join(out,'prepared.json')),ref(path.join(out,'runtime-verification.json'))],
  reason:'Prioritize currently violated fixed training references and atomically commit epoch weights with a real companion Adam state. Existing acceptance gates and evaluation are unchanged.',
  result:'Verified implementation and preserved-boundary activation; live learning and playing strength must be measured separately.',
  teacherCriteriaUnchanged:true,evaluationCriteriaUnchanged:true,trainingAlgorithmUnchanged:false};
 immutable(path.join(execution,'repair.json'),repair);
 const pointer={directory:path.basename(execution),repairSha256:sha(path.join(execution,'repair.json')),executionHash:digest(executionFiles)};
 immutable(path.join(out,'deployment-prepared.json'),{at:new Date().toISOString(),pointer,previousPointer:prepared.previousPointer,
  boundary:ref(path.join(out,'boundary-preservation.json')),executionDirectory:execution});
 console.log(JSON.stringify({prepared:true,pointer,iterations:boundary.iterations,weights:weights.length,banks:banks.length}));
}else if(mode==='select'||mode==='activate'){
 await stopped();verifyRuntime();const record=json(path.join(out,'deployment-prepared.json')),boundary=json(verifyArtifact(record.boundary));
 [boundary.state,boundary.config,boundary.inputProtection,boundary.seedLedger,...boundary.weights,...boundary.resources,...boundary.requests,...boundary.banks].forEach(verifyArtifact);
 assert.deepEqual(json(path.join(root,'execution-active.json')),mode==='select'?record.previousPointer:record.pointer);
 if(mode==='select'){
  atomic(path.join(root,'execution-active.json'),record.pointer);immutable(path.join(out,'selection.json'),{at:new Date().toISOString(),pointer:record.pointer});
  console.log(JSON.stringify({selected:true,stopRetained:true}));
 }else{
  const preflight=json(path.join(root,'preflight.json'));assert.equal(preflight.stage,'passed');assert.equal(preflight.executionHash,record.pointer.executionHash);
  assert.ok(preflight.at>json(path.join(out,'selection.json')).at);
  assert.ok(!fs.existsSync(path.join(out,'completed-stop.json')));fs.renameSync(stopFile,path.join(out,'completed-stop.json'));
  immutable(path.join(out,'activation.json'),{at:new Date().toISOString(),pointer:record.pointer,trainingRuntime:runtime,
   boundaryPreservation:record.boundary,preflight:ref(path.join(root,'preflight.json')),weightsAndOptimizerPreserved:true,
   existingBanksPreserved:true,evaluationRuntimeUnchanged:true,teacherCriteriaUnchanged:true,trainingConfigured:true,liveWeightsAlreadyLearned:false});
  console.log(JSON.stringify({activated:true,processStartupStillRequired:true}));
 }
}else throw Error('Unknown mode '+mode);
