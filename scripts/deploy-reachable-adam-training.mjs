import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';
import {digest} from './deck-league-contract.mjs';import {readLiveFileLockOwner} from './file-lock.mjs';
const mode=process.argv[2],revision=process.argv[3]||'r13';assert.ok(['r13','r14','r15','r16'].includes(revision));
const root=path.resolve('data/ai/deck-league-20261007'),audit=path.resolve('data/ai/optimizer-repair-20261013',revision);
const prepared=json(path.join(audit,'runtime-prepared.json')),stop=path.join(root,'stop.request.json'),execution=path.join(root,`execution-r${Number(revision.slice(1))-2}-optimizer-aware`);
const ref=file=>({path:file,sha256:sha(file)});
if(mode==='prepare'){
 assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previousPointer);verifyArtifact(prepared.previousRepair);
 assert.ok(!fs.existsSync(stop),'Existing stop request must not be removed');
 const old=json(prepared.previousRepair.path),oldProof=json(verifyArtifact(old.trainingInferenceEquivalence));
 const testFile=path.join(audit,'native-tests.log'),log=fs.readFileSync(testFile,'utf8');
 for(const expected of [new RegExp(`pass ${{r13:24,r14:25,r15:26,r16:26}[revision]}\\b`),/fail 0\b/,/skipped 0\b/])assert.match(log,expected);
 const unchangedHelpers=[...(['r15','r16'].includes(revision)?[]:['src/ai/neural/model.mjs']),'src/ai/neural/trainer.mjs','src/ai/neural/selfplay.mjs','scripts/ai-selfplay-task-options.mjs',
 'scripts/training-history-gradient.mjs','scripts/on-policy-resource-lessons.mjs','scripts/on-policy-resource-bank.mjs'];
 for(const name of unchangedHelpers)assert.equal(sha(path.join(prepared.runtime.directory,name)),sha(path.join(old.trainingRuntime.directory,name)));
 const tests=[...oldProof.tests,ref(testFile)];tests.forEach(verifyArtifact);
 const distinct=new Set(tests.flatMap(t=>fs.readFileSync(t.path,'utf8').split(/\r?\n/).filter(s=>s.startsWith('✔ ')).map(s=>s.replace(/^✔ /,'').replace(/ \([\d.]+ms\)$/,''))));
 const proof={...oldProof,at:new Date().toISOString(),trainingRuntime:prepared.runtime,tests,distinctNativeTestsPassed:distinct.size,
 reachableDisplacementBacktrackingVerified:true,stableQuadraticInverse:revision!=='r13',championKlDirectionVerified:['r15','r16'].includes(revision),unchangedHelpers,previousProof:old.trainingInferenceEquivalence};
 immutable(path.join(audit,'native-optimizer-verification.json'),proof);
 fs.mkdirSync(execution,{recursive:true});assert.ok(!fs.existsSync(path.join(execution,'repair.json')));
 for(const [name,hash]of Object.entries(old.executionFiles)){
  const source=path.join(root,prepared.previousPointer.directory,name);assert.equal(sha(source),hash);fs.copyFileSync(source,path.join(execution,name));
 }
 const repair={...old,previousRepair:prepared.previousRepair,trainingRuntime:prepared.runtime,
 trainingInferenceEquivalence:ref(path.join(audit,'native-optimizer-verification.json')),
 policyLearning:{...old.policyLearning,contract:prepared.trainingContract,reachableDisplacementBacktracking:true,stableQuadraticInverse:revision!=='r13',championKlProjectionConstraint:['r15','r16'].includes(revision),batchRehearsalProjectionConstraint:revision==='r16'},
 reason:'Stable Adam inverse and training-only champion KL projection direction; preserve exact moments, acceptance guards and original trial budget'};
 delete repair.engineTransition;
 immutable(path.join(execution,'repair.json'),repair);immutable(path.join(execution,'evaluation-lane.json'),repair.evaluationLane);
 const nextPointer={directory:path.basename(execution),repairSha256:sha(path.join(execution,'repair.json')),executionHash:digest(repair.executionFiles)};
 const wrapper=json(path.resolve('data/ai/optimizer-repair-20261013/r11/handoff-prepared.json')).wrappers[0];verifyArtifact(wrapper);verifyArtifact(wrapper.verifiedCopy);
 const owner=await readLiveFileLockOwner(path.join(root,'controller.lock'));assert.ok(owner);
 const requestId=randomUUID(),record={at:new Date().toISOString(),requestId,previousPointer:prepared.previousPointer,nextPointer,wrapper,owner,
 fixedBudgetsPreserved:true,evaluationContinues:true,completedExperimentsMustNotRepeat:true};
 immutable(path.join(audit,'handoff-prepared.json'),record);
 atomic(stop,{at:new Date().toISOString(),requestId,reason:'User-authorized reachable Adam save-boundary handoff',preserveArtifacts:true});
 console.log(JSON.stringify({prepared:true,nextPointer,requestId,mainPid:owner.pid,distinctTests:distinct.size,evaluationContinues:true}));
}else{
 assert.equal(mode,'activate');const record=json(path.join(audit,'handoff-prepared.json'));
 assert.equal(await readLiveFileLockOwner(path.join(root,'controller.lock')),null,'Main has not released its lock');
 assert.equal(json(path.join(root,'controller.json')).stage,'paused-at-boundary');
 assert.deepEqual(json(path.join(root,'execution-active.json')),record.previousPointer);assert.equal(json(stop).requestId,record.requestId,'Unknown stop request');
 const stateFile=path.join(root,'state.json'),state=json(stateFile),snapshot=path.join(audit,'boundary-state.json');fs.copyFileSync(stateFile,snapshot);
 for(const [profileId,p]of Object.entries(state.profiles))assert.ok(!fs.existsSync(path.join(root,'profiles',profileId,'iterations',String(p.iteration+1).padStart(6,'0'),'plan.json')),'Unfinished plan requires explicit preservation transition');
 const weights=[...new Map(Object.values(state.profiles).flatMap(p=>[p.learner,p.champion,...p.history]).map(r=>[r.path,r])).values()];weights.forEach(verifyArtifact);
 const requests=fs.readdirSync(path.join(root,'evaluation-r6/requests')).filter(n=>n.endsWith('.request.json')).map(n=>ref(path.join(root,'evaluation-r6/requests',n)));
 immutable(path.join(audit,'boundary-preservation.json'),{at:new Date().toISOString(),state:ref(snapshot),weights,requests,config:ref(path.join(root,'config.json')),
 iterations:Object.fromEntries(Object.entries(state.profiles).map(([id,p])=>[id,p.iteration])),queue:state.evaluationQueue});
 verifyArtifact(record.wrapper);verifyArtifact(record.wrapper.verifiedCopy);
 atomic(path.join(root,'execution-active.json'),record.nextPointer);fs.renameSync(stop,path.join(audit,'completed-main-handoff-stop.json'));
 immutable(path.join(audit,'activation.json'),{at:new Date().toISOString(),pointer:record.nextPointer,boundaryPreservation:ref(path.join(audit,'boundary-preservation.json')),evaluationContinued:true});
 console.log(JSON.stringify({activated:true,pointer:record.nextPointer,iterations:Object.fromEntries(Object.entries(state.profiles).map(([id,p])=>[id,p.iteration]))}));
}
