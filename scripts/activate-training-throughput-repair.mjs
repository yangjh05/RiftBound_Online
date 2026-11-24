import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';import {digest} from './deck-league-contract.mjs';
import {readLiveFileLockOwner} from './file-lock.mjs';
const audit=path.resolve('data/ai/training-repair-20261013'),prepared=json(path.join(audit,'prepared.json'));
const main=path.resolve('data/ai/deck-league-20261007'),study=path.resolve('data/ai/deck-league-individual-20261011-r2');
assert.ok(!await readLiveFileLockOwner(path.join(main,'controller.lock')),'Main controller still alive');
assert.ok(!await readLiveFileLockOwner(path.join(study,'controller.lock')),'Study controller still alive');
assert.deepEqual(json(path.join(main,'execution-active.json')),prepared.oldPointers.main);
assert.deepEqual(json(path.join(study,'execution-active.json')),prepared.oldPointers.study);
const log=fs.readFileSync(path.join(audit,'tests-final.log'),'utf8');
assert.match(log,/pass 27\b/);assert.match(log,/fail 0\b/);assert.match(log,/skipped 0\b/);
assert.equal(json(path.join(audit,'sett-cost-benchmark.json')).gradientEquivalent,true);
const ref=file=>({path:file,sha256:sha(file)}),dir=prepared.main.directory,repairFile=path.join(dir,'repair.json'),repair=json(repairFile);
fs.copyFileSync(repairFile,path.join(dir,'repair.draft.json'));
for(const name of Object.keys(repair.executionFiles))fs.copyFileSync(path.join('scripts',name),path.join(dir,name));
repair.executionFiles=Object.fromEntries(Object.keys(repair.executionFiles).map(name=>[name,sha(path.join(dir,name))]));
repair.externalArtifacts=[ref(path.resolve('server/training-dashboard-priority.mjs'))];repair.tests=ref(path.join(audit,'tests-final.log'));
atomic(repairFile,repair);
const executionFile=prepared.study.pointer.path,execution=json(executionFile);
fs.copyFileSync(executionFile,path.join(prepared.study.directory,'execution.draft.json'));
execution.files=execution.files.map(item=>ref(item.path));
execution.files.push(ref(path.resolve('server/training-dashboard-priority.mjs')));
execution.tests=ref(path.join(audit,'tests-final.log'));execution.costBenchmark=ref(path.join(audit,'sett-cost-benchmark.json'));
atomic(executionFile,execution);
const originals=[];
for(const p of json(path.join(study,'config.json')).profiles){
 const directory=path.join(study,'profiles',p.id);
 const visit=folder=>{if(!fs.existsSync(folder))return;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
  const f=path.join(folder,entry.name);if(entry.isDirectory())visit(f);else if(entry.name.endsWith('.json.gz'))originals.push(ref(f));}};
 visit(directory);
}
immutable(path.join(audit,'preserved-study-archives.json'),originals);
json(path.join(audit,'preserved-weights.json')).forEach(verifyArtifact);
const record={at:new Date().toISOString(),mainPointer:{directory:path.basename(dir),repairSha256:sha(repairFile),executionHash:digest(repair.executionFiles)},
 studyPointer:ref(executionFile),criteriaUnchanged:true,weightsPreserved:true,studyArchivesPreserved:originals.length};
immutable(path.join(audit,'activation.json'),record);
atomic(path.join(main,'execution-active.json'),record.mainPointer);atomic(path.join(study,'execution-active.json'),record.studyPointer);
const stop=path.join(main,'stop.request.json');assert.match(json(stop).reason,/User-authorized preserved/);
fs.renameSync(stop,path.join(audit,'completed-boundary-stop.json'));
console.log(JSON.stringify(record));
