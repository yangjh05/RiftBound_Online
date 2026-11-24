import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,immutable,verifyArtifact} from './deck-league-io.mjs';
const root=path.resolve('data/ai/deck-league-20261007'),out=path.resolve(process.argv[2]||'data/ai/resource-timing-20261014');
const pointer=json(path.join(root,'execution-active.json')),repairFile=path.join(root,pointer.directory,'repair.json');
assert.equal(sha(repairFile),pointer.repairSha256);const old=json(repairFile),directory=path.join(out,'runtime');
assert.ok(!fs.existsSync(directory),'Do not rewrite a sealed runtime');
const previous=json(verifyArtifact(old.trainingRuntime.manifest)).map(f=>({...f,path:f.path.replaceAll('\\','/')}));
const changed=['scripts/local-policy-learning.mjs','scripts/viktor-candidate-learning.mjs','scripts/on-policy-resource-lessons.mjs','scripts/on-policy-resource-bank.mjs'];
const added=['scripts/resource-deployment-learning.mjs','tests/resource-deployment-learning.test.mjs'];
for(const f of previous){const from=path.join(old.trainingRuntime.directory,f.path),to=path.join(directory,f.path);
  assert.equal(sha(from),f.sha256,f.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(changed.includes(f.path)?path.resolve(f.path):from,to);}
for(const f of added){assert.ok(!previous.some(p=>p.path===f));fs.copyFileSync(path.resolve(f),path.join(directory,f));}
fs.symlinkSync(path.resolve('node_modules'),path.join(directory,'node_modules'),'junction');
const manifest=[...previous.map(f=>({...f,sha256:sha(path.join(directory,f.path))})),...added.map(f=>({path:f,sha256:sha(path.join(directory,f))}))];
assert.deepEqual(previous.filter((f,i)=>f.sha256!==manifest[i].sha256).map(f=>f.path).sort(),changed.sort());
const manifestFile=path.join(out,'runtime-manifest.json');immutable(manifestFile,manifest);
const safety=await import(pathToFileURL(path.join(directory,'scripts/training-safety.mjs')));
const engineFingerprint=safety.computeRawEngineFingerprint(directory);assert.equal(engineFingerprint,old.trainingRuntime.engineFingerprint);
const runtime={directory,manifest:{path:manifestFile,sha256:sha(manifestFile)},engineFingerprint};
immutable(path.join(out,'prepared.json'),{at:new Date().toISOString(),runtime,previousRuntime:old.trainingRuntime,previousPointer:pointer,
  previousRepair:{path:repairFile,sha256:sha(repairFile)},changed,added,unchangedFiles:previous.length-changed.length,
  engineAndInferenceByteIdentical:true,teacherCriteriaUnchanged:false,liveTrainingActivated:false,
  purpose:'Prospective completed-on-policy resource timing lessons; keep neural choices, optimizer, evaluation runtime and existing banks unchanged.'});
console.log(JSON.stringify({prepared:true,runtime,changed,added}));
