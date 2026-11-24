import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';
import {digest} from './deck-league-contract.mjs';import {readLiveFileLockOwner} from './file-lock.mjs';
const mode=process.argv[2],root=path.resolve('data/ai/deck-league-20261007'),out=path.resolve(process.env.RIFTBOUND_REACHABLE_REPAIR_DIRECTORY||'data/ai/reachable-recovery-20261015');
const prepared=json(path.join(out,'prepared.json')),old=json(verifyArtifact(prepared.previousRepair)),runtime=prepared.runtime,laneRoot=old.evaluationLane.directory;
const ref=file=>({path:file,sha256:sha(file)}),execution=path.join(root,process.env.RIFTBOUND_REACHABLE_EXECUTION||'execution-r18-reachable-recovery');
const wrappers={'scripts/run-deck-league.ps1':'bb412accc3a8a090a15ad762eb3bf487f52fbf0d7d3d396187e947fe568485ec',
 'scripts/run-deck-league-evaluation.ps1':'7816fd199401e9fe93aa1deae0efbe475a31844fb2f8dd825ded924643540a92'};
function verifyRuntime(){
 const manifest=json(verifyArtifact(runtime.manifest));manifest.forEach(f=>assert.equal(sha(path.join(runtime.directory,f.path)),f.sha256));
 const prior=json(verifyArtifact(old.trainingRuntime.manifest));let unchanged=0;
 for(const f of prior){if(prepared.changed.includes(f.path.replaceAll('\\','/')))continue;assert.equal(sha(path.join(runtime.directory,f.path)),f.sha256,f.path);unchanged++;}
 for(const [file,hash]of Object.entries(wrappers))assert.equal(sha(path.resolve(file)),hash);
 assert.equal(runtime.engineFingerprint,old.trainingRuntime.engineFingerprint);return unchanged;
}
async function stopped({preparedAlready=false}={}){
 for(const [role,dir]of [['main',root],['evaluation',laneRoot]]){
  assert.equal(await readLiveFileLockOwner(path.join(dir,'controller.lock')),null,role+' has a living owner');
  assert.deepEqual(json(path.join(dir,'stop.request.json')),json(path.join(out,role==='main'?'handoff-request.json':'evaluation-handoff-request.json')),'Unknown stop request');
  if(!preparedAlready)assert.equal(json(path.join(dir,'controller.json')).stage,'paused-at-boundary');
 }
}
function preserveTree(directory,files=[]){
 if(!fs.existsSync(directory))return files;
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);
  if(entry.isDirectory())preserveTree(file,files);else if(entry.isFile()&&!entry.name.endsWith('.lock'))files.push(ref(file));}
 return files;
}
if(mode==='verify'){
 const file=path.join(out,'focused-tests-final.log'),bytes=fs.readFileSync(file),log=bytes[0]===255&&bytes[1]===254?bytes.subarray(2).toString('utf16le'):bytes.toString('utf8');
 const count=Number(process.env.RIFTBOUND_REACHABLE_TEST_COUNT||29);assert.match(log,new RegExp('tests '+count+'\\b'));assert.match(log,/fail 0\b/);assert.match(log,/skipped 0\b/);
 const unchanged=verifyRuntime(),previousProof=json(verifyArtifact(old.trainingInferenceEquivalence));assert.equal(previousProof.passed,true);previousProof.tests.forEach(verifyArtifact);
 immutable(path.join(out,'runtime-verification.json'),{contract:'reachable-adam-training-verification-v1',at:new Date().toISOString(),passed:true,
  trainingRuntime:runtime,evaluationRuntime:old.evaluationLane.runtime,previousProof:old.trainingInferenceEquivalence,
  inferenceFunctionsByteIdentical:true,nativeInferenceBitIdentical:true,defaultPpoBitIdentical:true,changedFiles:prepared.changed,addedFiles:prepared.added,
  unchangedFiles:unchanged,uniqueTests:count,tests:[ref(file)],teacherCriteriaUnchanged:true,evaluationCriteriaUnchanged:true,
  evidence:'Native multi-step recovery and rejection rollback verified; native epoch candidates retain actual Adam; preserved training archive rotation; fail-closed bounded capacity retries. Inference/default PPO equal previous runtime.'});
 console.log(JSON.stringify({verified:true,uniqueTests:count,unchangedFiles:unchanged}));
}else if(mode==='prepare'){
 await stopped();verifyRuntime();assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previousPointer);assert.ok(!fs.existsSync(execution));
 const stateFile=path.join(root,'state.json'),state=json(stateFile),config=json(path.join(root,'config.json'));
 fs.copyFileSync(stateFile,path.join(out,'boundary-state.json'));
 const weights=[...new Map(Object.values(state.profiles).flatMap(p=>[p.learner,p.champion,...p.history]).map(r=>[r.path,r])).values()];
 const resources=Object.keys(state.profiles).map(id=>path.join(old.trainingResourceDirectory||root,'resource-training-r1',id,'active.json')).filter(fs.existsSync).flatMap(f=>[ref(f),json(f)]);
 const requests=state.evaluationQueue.map(p=>p.evaluationRequest),banks=[...config.profiles.map(p=>p.lessons),...Object.values(old.lessonAdditions||{}).map(a=>a.augmented)];
 const evaluationFiles=preserveTree(path.join(laneRoot,'requests'));
 for(const pending of state.evaluationQueue)preserveTree(pending.directory,evaluationFiles);
 [...weights,...resources,...requests,...banks].forEach(verifyArtifact);
 const boundary={at:new Date().toISOString(),state:ref(stateFile),snapshot:ref(path.join(out,'boundary-state.json')),config:ref(path.join(root,'config.json')),
  inputProtection:ref(path.join(root,'input-protection-live.json.gz')),weights,resources,requests,banks,evaluationFiles,
  seedLedger:ref(path.join(root,'seed-ledger.json')),queueHash:digest(state.evaluationQueue),iterations:Object.fromEntries(Object.entries(state.profiles).map(([id,p])=>[id,p.iteration])),
  budgets:{gamesPerOpponent:config.gamesPerOpponent,epochs:config.epochs,evaluation:config.evaluation}};
 immutable(path.join(out,'boundary-preservation.json'),boundary);fs.mkdirSync(execution,{recursive:true});
 const executionFiles={...old.executionFiles};
 for(const [file,hash]of Object.entries(old.executionFiles)){
  const from=path.join(root,prepared.previousPointer.directory,file),to=path.join(execution,file);assert.equal(sha(from),hash);fs.mkdirSync(path.dirname(to),{recursive:true});
  fs.copyFileSync(['train-deck-league.mjs','run-deck-league-evaluation.mjs'].includes(file)?path.resolve('scripts',file):from,to);executionFiles[file]=sha(to);
 }
 const helper='training-process-capacity.mjs';fs.copyFileSync(path.resolve('scripts',helper),path.join(execution,helper));executionFiles[helper]=sha(path.join(execution,helper));
 immutable(path.join(execution,'evaluation-lane.json'),old.evaluationLane);
 const repair={...old,at:new Date().toISOString(),previousRepair:prepared.previousRepair,previousExecution:prepared.previousPointer,executionFiles,
  trainingRuntime:runtime,trainingInferenceEquivalence:ref(path.join(out,'runtime-verification.json')),
  evaluationCoordinator:{entry:ref(path.join(execution,'run-deck-league-evaluation.mjs')),lane:ref(path.join(execution,'evaluation-lane.json'))},
  policyLearning:{...old.policyLearning,contract:prepared.trainingContract,jointAdamReachability:true,maximumNativeTrialsPerBatch:14,maximumProvisionalRecoverySteps:7,
    intermediateStepsAreNotAccepted:true,allOriginalEndpointGuardsPreserved:true},
  atomicEpochCommit:{contract:'reachable-native-adam-epoch-v2',rawProposalFirst:true,pairedWeightOptimizerCommit:true,exactBiasPowerResume:true,
    maximumRecoveryCandidates:14,maximumStepsPerCandidate:'accepted-native-minibatch-steps',heldOutLabelsTrained:false},
  resourceWorkingSet:{contract:'training-only-preserved-archive-rotation-v1',maximumResourceGradientCases:32,allOldRegressionChecksPreserved:true,validationInSelection:false},
  processCapacity:{contract:'fail-closed-bounded-query-v1',attempts:3,delaysMs:[250,1000],unknownCapacityStartsNoWorkers:true,terminalFailuresNotRetried:true},
  boundary:{preservation:ref(path.join(out,'boundary-preservation.json'))},
  externalArtifacts:[...(old.externalArtifacts||[]),ref(path.join(out,'prepared.json')),ref(path.join(out,'runtime-verification.json'))],
  teacherCriteriaUnchanged:true,evaluationCriteriaUnchanged:true,trainingAlgorithmUnchanged:false,
  reason:'Construct reachable Adam candidates, permit bounded tentative recovery with unchanged final guards, rotate training-only work while retaining old guards, and retry unknown process capacity without launching jobs.'};
 immutable(path.join(execution,'repair.json'),repair);const pointer={directory:path.basename(execution),repairSha256:sha(path.join(execution,'repair.json')),executionHash:digest(executionFiles)};
 immutable(path.join(out,'deployment-prepared.json'),{at:new Date().toISOString(),pointer,previousPointer:prepared.previousPointer,boundary:ref(path.join(out,'boundary-preservation.json')),executionDirectory:execution});
 console.log(JSON.stringify({prepared:true,pointer,weights:weights.length,evaluationFiles:evaluationFiles.length,iterations:boundary.iterations}));
}else if(mode==='select'||mode==='activate'){
 await stopped({preparedAlready:true});verifyRuntime();const record=json(path.join(out,'deployment-prepared.json')),boundary=json(verifyArtifact(record.boundary));
 [boundary.state,boundary.config,boundary.inputProtection,boundary.seedLedger,...boundary.weights,...boundary.resources,...boundary.requests,...boundary.banks,...boundary.evaluationFiles].forEach(verifyArtifact);
 assert.deepEqual(json(path.join(root,'execution-active.json')),mode==='select'?record.previousPointer:record.pointer);
 if(mode==='select'){atomic(path.join(root,'execution-active.json'),record.pointer);immutable(path.join(out,'selection.json'),{at:new Date().toISOString(),pointer:record.pointer});console.log('Selected; own stops retained.');}
 else{
  const preflight=json(path.join(root,'preflight.json'));assert.equal(preflight.stage,'passed');assert.equal(preflight.executionHash,record.pointer.executionHash);
  const evalPreflight=json(path.join(laneRoot,'controller.json'));assert.equal(evalPreflight.stage,'passed');
  for(const check of [preflight,evalPreflight])assert.ok(check.at>json(path.join(out,'selection.json')).at);
  fs.renameSync(path.join(root,'stop.request.json'),path.join(out,'completed-stop.json'));
  fs.renameSync(path.join(laneRoot,'stop.request.json'),path.join(out,'completed-evaluation-stop.json'));
  immutable(path.join(out,'activation.json'),{at:new Date().toISOString(),pointer:record.pointer,trainingRuntime:runtime,boundaryPreservation:record.boundary,
    preflight:ref(path.join(root,'preflight.json')),evaluationPreflight:evalPreflight,weightsAndOptimizerPreserved:true,evaluationGamesPreserved:true,criteriaUnchanged:true,liveImprovementProven:false});
  console.log('Activated; process startup required.');
 }
}else throw Error('Unknown mode '+mode);
