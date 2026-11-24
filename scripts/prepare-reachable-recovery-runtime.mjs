import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,immutable,verifyArtifact} from './deck-league-io.mjs';
const mode=process.argv[2]||'build',root=path.resolve('data/ai/deck-league-20261007'),out=path.resolve(process.env.RIFTBOUND_REACHABLE_REPAIR_DIRECTORY||'data/ai/reachable-recovery-20261015');
const handoff=json(path.join(out,'handoff-request.json')),pointer=json(path.join(root,'execution-active.json'));assert.deepEqual(pointer,handoff.previousPointer);
const repairFile=path.join(root,pointer.directory,'repair.json'),old=json(verifyArtifact({path:repairFile,sha256:pointer.repairSha256}));
const directory=path.join(out,'runtime'),manifestFile=path.join(out,'runtime-manifest.json');assert.ok(!fs.existsSync(manifestFile),'Do not overwrite a sealed runtime');
const previous=json(verifyArtifact(old.trainingRuntime.manifest)).map(x=>({...x,path:x.path.replaceAll('\\','/')}));
const overlay=['scripts/individual-transactional-policy.mjs','scripts/transactional-epoch-commit.mjs','scripts/on-policy-resource-bank.mjs','scripts/reachable-adam-projection.mjs','scripts/native-epoch-recovery.mjs'];
const changed=overlay.filter(f=>previous.some(p=>p.path===f)),added=overlay.filter(f=>!changed.includes(f));
if(mode==='build'){
 for(const f of previous){const source=path.join(old.trainingRuntime.directory,f.path),target=path.join(directory,f.path);
  assert.equal(sha(source),f.sha256);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(changed.includes(f.path)?path.resolve(f.path):source,target);}
 for(const file of added)fs.copyFileSync(path.resolve(file),path.join(directory,file));
 if(!fs.existsSync(path.join(directory,'node_modules')))fs.symlinkSync(path.resolve('node_modules'),path.join(directory,'node_modules'),'junction');
 console.log(JSON.stringify({built:true,directory}));
}else{
 assert.equal(mode,'seal');for(const name of [...changed,...added])assert.equal(sha(path.join(directory,name)),sha(path.resolve(name)));
 const safety=await import(pathToFileURL(path.join(directory,'scripts/training-safety.mjs')));assert.equal(safety.computeEngineFingerprint(directory),old.trainingRuntime.engineFingerprint);
 const names=[...new Set([...previous.map(x=>x.path),...added])];immutable(manifestFile,names.map(name=>({path:name,sha256:sha(path.join(directory,name))})));
 const runtime={directory,manifest:{path:manifestFile,sha256:sha(manifestFile)},engineFingerprint:old.trainingRuntime.engineFingerprint};
 immutable(path.join(out,'prepared.json'),{at:new Date().toISOString(),runtime,previousRuntime:old.trainingRuntime,previousPointer:pointer,previousRepair:{path:repairFile,sha256:sha(repairFile)},
  changed,added,teacherCriteriaUnchanged:true,evaluationUnchanged:true,trainingContract:'training-only-current-constraint-recovery-v11'});
 console.log(JSON.stringify({sealed:true,runtime}));
}
