import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';
import {readLiveFileLockOwner} from './file-lock.mjs';
const root=path.resolve('data/ai/deck-league-individual-20261011-r2'),audit=path.resolve('data/ai/training-repair-20261013');
const [mode='prepare']=process.argv.slice(2),dir=path.join(root,'execution-r8-parallel-evaluation'),ref=f=>({path:f,sha256:sha(f)});
if(mode==='prepare'){
 assert.equal(json(path.join(audit,'finite-resume-native-verification.json')).passed,true);
 const log=fs.readFileSync(path.join(audit,'verification-tests.log'),'utf8');assert.match(log,/pass 30\b/);assert.match(log,/fail 0\b/);assert.match(log,/skipped 0\b/);
 const previous=json(path.join(root,'execution-active.json')),old=json(verifyArtifact(previous)),c=json(path.join(root,'config.json')),plan=json(verifyArtifact(old.plan));
 assert.ok(!fs.existsSync(path.join(dir,'execution.json')));fs.mkdirSync(dir,{recursive:true});
 immutable(path.join(dir,'evaluation-config.json'),plan.evaluationConfig);
 const lane={directory:path.join(root,'parallel-evaluation'),config:ref(path.join(dir,'evaluation-config.json')),inputProtocol:plan.inputProtocol,
  runtime:{directory:c.runtimeDirectory,manifest:c.runtimeManifest,engineFingerprint:c.engineFingerprint},diagnosticInputs:c.inputRoles,workers:2};
 immutable(path.join(dir,'evaluation-lane.json'),lane);
 const evaluationExecutionDirectory=path.join(dir,'evaluation');fs.mkdirSync(evaluationExecutionDirectory,{recursive:true});
 const names=['run-deck-league-evaluation.mjs','deck-league-evaluation-worker.mjs','deck-league-evaluation-dispatch.mjs','deck-league-evaluation-lane.mjs',
  'deck-league-evaluation.mjs','deck-league-contract.mjs','deck-league-io.mjs','file-lock.mjs','parallel-evaluation-pool.mjs'];
 for(const name of names)fs.copyFileSync(path.resolve('scripts',name),path.join(evaluationExecutionDirectory,name));
 const files=[...new Map([...old.files.map(r=>ref(r.path)),ref(path.resolve('scripts/deck-league-evaluation-lane.mjs'))].map(r=>[r.path,r])).values()];
 const execution={...old,files,previousExecution:previous,evaluationLane:lane,evaluationExecutionDirectory,
  evaluationExecutionFiles:names.map(n=>ref(path.join(evaluationExecutionDirectory,n))),
  nativeFiniteResumeVerification:ref(path.join(audit,'finite-resume-native-verification.json')),
  tests:ref(path.join(audit,'verification-tests.log')),evaluationCriteriaUnchanged:true,trainingBudgetUnchanged:true};
 execution.sourceCopies=files.map(r=>{const f=path.join(dir,'source',path.relative(process.cwd(),r.path));fs.mkdirSync(path.dirname(f),{recursive:true});fs.copyFileSync(r.path,f);return ref(f);});
 immutable(path.join(dir,'execution.json'),execution);immutable(path.join(audit,'individual-r8-prepared.json'),{previous,pointer:ref(path.join(dir,'execution.json'))});
 console.log('Individual parallel evaluation and native-verified resume prepared');
}else{
 assert.equal(mode,'activate');assert.ok(!await readLiveFileLockOwner(path.join(root,'controller.lock')));assert.ok(!await readLiveFileLockOwner(path.join(root,'ready-controller.lock')));
 const prepared=json(path.join(audit,'individual-r8-prepared.json'));assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previous);
 atomic(path.join(root,'execution-active.json'),prepared.pointer);
 const stop=path.join(root,'stop.request.json');assert.match(json(stop).reason,/User-authorized native-verified/);fs.renameSync(stop,path.join(audit,'completed-native-resume-stop.json'));
 immutable(path.join(audit,'individual-r8-activation.json'),{at:new Date().toISOString(),pointer:prepared.pointer,criteriaUnchanged:true});console.log('Individual parallel evaluator activated');
}
