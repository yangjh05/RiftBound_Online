import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';
import {readLiveFileLockOwner} from './file-lock.mjs';
const root=path.resolve('data/ai/deck-league-individual-20261011-r2'),audit=path.resolve('data/ai/training-repair-20261013');
const [mode='runtime']=process.argv.slice(2),dir=path.join(root,'execution-r9-shared-inference'),runtime=path.join(root,'runtime-r6-shared-inference');
const ref=file=>({path:file,sha256:sha(file)});
if(mode==='runtime'){
 assert.ok(!fs.existsSync(runtime));const previous=json(path.join(root,'execution-active.json')),old=json(verifyArtifact(previous)),config=json(path.join(root,'config.json'));
 const items=json(verifyArtifact(old.policyRuntime.manifest));
 for(const item of items){const source=path.join(old.policyRuntime.directory,item.path),destination=path.join(runtime,item.path);
  assert.equal(sha(source),item.sha256);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
 fs.symlinkSync(path.resolve('node_modules'),path.join(runtime,'node_modules'),'junction');
 for(const name of ['individual-training-margin.mjs','individual-transactional-policy.mjs','individual-training-snapshot.mjs'])fs.copyFileSync(path.resolve('scripts',name),path.join(runtime,'scripts',name));
 const names=[...new Set([...items.map(i=>i.path),'scripts/individual-training-snapshot.mjs'])];
 fs.mkdirSync(dir,{recursive:true});immutable(path.join(dir,'policy-runtime-manifest.json'),names.map(p=>({path:p,sha256:sha(path.join(runtime,p))})));
 const {computeEngineFingerprint}=await import(pathToFileURL(path.join(runtime,'scripts/training-safety.mjs')));assert.equal(computeEngineFingerprint(),config.engineFingerprint);
 immutable(path.join(audit,'shared-inference-runtime.json'),{previous,policyRuntime:{directory:runtime,manifest:ref(path.join(dir,'policy-runtime-manifest.json')),engineFingerprint:config.engineFingerprint}});
 console.log('Frozen shared inference runtime prepared');
}else if(mode==='prepare'){
 const prepared=json(path.join(audit,'shared-inference-runtime.json'));assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previous);
 const log=fs.readFileSync(path.join(audit,'shared-inference-tests.log'),'utf8');assert.match(log,/pass 31\b/);assert.match(log,/fail 0\b/);assert.match(log,/skipped 0\b/);
 const benchmark=json(path.join(audit,'shared-inference-benchmark.json'));assert.equal(benchmark.exactGuards,true);assert.equal(benchmark.exactGradient,true);
 const old=json(verifyArtifact(prepared.previous)),files=old.files.map(r=>ref(r.path));
 const execution={...old,files,previousExecution:prepared.previous,policyRuntime:prepared.policyRuntime,policyContract:'training-only-streamed-individual-margin-adam-transaction-v4',
  tests:ref(path.join(audit,'shared-inference-tests.log')),sharedInferenceBenchmark:ref(path.join(audit,'shared-inference-benchmark.json')),
  allTrainingGuardsUnchanged:true,fullRecurrentPrefixesPreserved:true};
 execution.sourceCopies=files.map(r=>{const file=path.join(dir,'source',path.relative(process.cwd(),r.path));fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(r.path,file);return ref(file);});
 immutable(path.join(dir,'execution.json'),execution);immutable(path.join(audit,'shared-inference-prepared.json'),{previous:prepared.previous,pointer:ref(path.join(dir,'execution.json'))});
 const stop=path.join(root,'stop.request.json');assert.ok(!fs.existsSync(stop));atomic(stop,{at:new Date().toISOString(),reason:'User-authorized shared training inference handoff',preserveArtifacts:true});
 console.log('Shared inference execution sealed; boundary stop requested');
}else{
 assert.equal(mode,'activate');assert.ok(!await readLiveFileLockOwner(path.join(root,'controller.lock')));assert.ok(!await readLiveFileLockOwner(path.join(root,'ready-controller.lock')));
 const prepared=json(path.join(audit,'shared-inference-prepared.json'));assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previous);
 const stop=path.join(root,'stop.request.json');assert.match(json(stop).reason,/User-authorized shared training inference/);
 atomic(path.join(root,'execution-active.json'),prepared.pointer);fs.renameSync(stop,path.join(audit,'completed-shared-inference-stop.json'));
 immutable(path.join(audit,'shared-inference-activation.json'),{at:new Date().toISOString(),pointer:prepared.pointer,criteriaUnchanged:true});console.log('Shared inference execution activated');
}
