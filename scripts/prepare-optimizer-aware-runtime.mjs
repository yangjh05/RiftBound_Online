import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';
import {extendOptimizerAwareRuntime} from './optimizer-aware-runtime.mjs';
const [revision='r6']=process.argv.slice(2);assert.match(revision,/^r(?:[6-9]|[1-9]\d+)$/);
const root=path.resolve('data/ai/deck-league-20261007'),audit=path.resolve('data/ai/optimizer-repair-20261013',revision==='r6'?'.':revision);
const pointer=json(path.join(root,'execution-active.json')),repairFile=path.join(root,pointer.directory,'repair.json'),repair=json(repairFile);
const runtime=path.join(root,`runtime-${revision}-optimizer-aware`);assert.ok(!fs.existsSync(runtime),'Runtime already exists; never replace a sealed runtime');
const old=repair.policyLearning?json(verifyArtifact(repair.trainingInferenceEquivalence)).evaluationRuntime:repair.trainingRuntime;
const manifest=json(verifyArtifact(old.manifest));
const added=['scripts/individual-transactional-policy.mjs','scripts/individual-training-margin.mjs','scripts/individual-training-snapshot.mjs',
  'scripts/constrained-policy-learning.mjs','scripts/ppo-training-projection.mjs','scripts/training-history-gradient.mjs','scripts/adam-update-geometry.mjs','scripts/on-policy-resource-lessons.mjs','scripts/on-policy-resource-bank.mjs'];
fs.mkdirSync(audit,{recursive:true});
for(const item of manifest){
 const file=path.join(old.directory,item.path),destination=path.join(runtime,item.path);assert.equal(sha(file),item.sha256);
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 if(['src/ai/neural/model.mjs','src/ai/neural/trainer.mjs','src/ai/neural/selfplay.mjs','scripts/ai-selfplay-task-options.mjs'].includes(item.path))fs.writeFileSync(destination,extendOptimizerAwareRuntime(item.path,fs.readFileSync(file,'utf8')));
 else fs.copyFileSync(file,destination);
}
for(const name of added)fs.copyFileSync(path.resolve(name),path.join(runtime,name));
// Include the static closure of NEW training helpers, without taking mutable
// workspace engine/model files over the old frozen runtime.
for(let i=0;i<added.length;i++){
 const name=added[i],source=fs.readFileSync(path.resolve(name),'utf8');
 for(const match of source.matchAll(/from\s*['"](\.[^'"]+)['"]/g)){
  const dependency=path.normalize(path.join(path.dirname(name),match[1])),destination=path.join(runtime,dependency);
  if(fs.existsSync(destination))continue;
  assert.ok(dependency.replaceAll('\\','/').startsWith('scripts/'),'Unexpected missing engine dependency: '+dependency);
  assert.ok(fs.existsSync(path.resolve(dependency)),dependency);
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.resolve(dependency),destination);added.push(dependency);
 }
}
fs.symlinkSync(path.resolve('node_modules'),path.join(runtime,'node_modules'),'junction');
const safety=await import(pathToFileURL(path.join(runtime,'scripts/training-safety.mjs')));
const raw=safety.computeRawEngineFingerprint(runtime),compatibilityFile=path.join(runtime,'scripts/training-fingerprint-compatibility.json');
const compatibility=json(compatibilityFile);
compatibility.entries.push({kind:'equivalent-evaluation-inference-v1',rawFingerprint:raw,compatibleFingerprint:old.engineFingerprint,
 policyActionsPreserved:true,evaluationBehaviorPreserved:true,savedTargetsPreserved:true,recurrentMemoryPreserved:true,
 auditReport:path.join(audit,'native-optimizer-verification.json'),scope:'Only opt-in trainPpoBatch loss memory and ppoBatchUpdate hooks; no inference or game function changes'});
atomic(compatibilityFile,compatibility);
assert.equal(safety.computeEngineFingerprint(runtime),old.engineFingerprint);
const names=[...new Set([...manifest.map(i=>i.path),...added])],runtimeManifest=path.join(audit,'runtime-manifest.json');
immutable(runtimeManifest,names.map(name=>({path:name,sha256:sha(path.join(runtime,name))})));
const record={at:new Date().toISOString(),previousPointer:pointer,previousRepair:{path:repairFile,sha256:sha(repairFile)},previousRuntime:old,
 runtime:{directory:runtime,manifest:{path:runtimeManifest,sha256:sha(runtimeManifest)},engineFingerprint:old.engineFingerprint},rawFingerprint:raw,
 trainingContract:'training-only-full-history-adam-complete-constraints-v8',deployed:false,completedStudyMustNotRepeat:true,
 unchangedBudgets:{gamesPerIteration:28,maximumEpochs:4,screen:112,confirmation:896},validationAndEvaluationLabelsNeverConstructDirections:true};
immutable(path.join(audit,'runtime-prepared.json'),record);console.log(JSON.stringify(record));
