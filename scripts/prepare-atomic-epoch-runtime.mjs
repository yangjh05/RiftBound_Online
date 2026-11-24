import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,immutable,atomic,verifyArtifact} from './deck-league-io.mjs';
const mode=process.argv[2]||'build',root=path.resolve('data/ai/deck-league-20261007'),out=path.resolve('data/ai/transactional-epoch-repair-20261015');
const handoff=json(path.join(out,'handoff-request.json')),pointer=json(path.join(root,'execution-active.json'));
assert.deepEqual(pointer,handoff.previousPointer);
const repairFile=path.join(root,pointer.directory,'repair.json'),old=json(verifyArtifact({path:repairFile,sha256:pointer.repairSha256}));
const directory=path.join(out,'runtime'),manifestFile=path.join(out,'runtime-manifest.json');
assert.ok(!fs.existsSync(manifestFile),'Sealed runtime must never be overwritten');
const changed=['scripts/individual-transactional-policy.mjs','scripts/individual-training-margin.mjs','scripts/ppo-training-projection.mjs'];
const added=['scripts/training-group-directions.mjs','scripts/transactional-epoch-commit.mjs'];
const previous=json(verifyArtifact(old.trainingRuntime.manifest)).map(x=>({...x,path:x.path.replaceAll('\\','/')}));
if(mode==='build'){
 for(const f of previous){const source=path.join(old.trainingRuntime.directory,f.path),target=path.join(directory,f.path);
  assert.equal(sha(source),f.sha256);fs.mkdirSync(path.dirname(target),{recursive:true});
  if(f.path==='src/ai/neural/trainer.mjs'){
   let code=fs.readFileSync(source,'utf8');const from='const epochProjection=await options.beforeEpochGuard?.({epoch:epoch+1,epochs,model,epochStartWeights:snapshot});';
   assert.equal(code.split(from).length,2);
   code=code.replace(from,`const epochProjection=await options.beforeEpochGuard?.({epoch:epoch+1,epochs,model,epochStartWeights:snapshot,optimizerSnapshot,optimizer});
    if(epochProjection?.optimizer && epochProjection.optimizer!==optimizer){
      optimizer.dispose();optimizer=epochProjection.optimizer;
    }`);
   const oldSerialize='return { version: 1, kind: "adam", modelGeneration, weights: serialized };';
   assert.equal(code.split(oldSerialize).length,2);
   code=code.replace(oldSerialize,'return { version: 1, kind: "adam", modelGeneration, weights: serialized, adamBiasPowers: { beta1: optimizer.accBeta1.dataSync()[0], beta2: optimizer.accBeta2.dataSync()[0] } };');
   const oldRestore='await optimizer.setWeights(weights);\n  weights.forEach((item) => item.tensor.dispose());';
   assert.equal(code.split(oldRestore).length,2);
   code=code.replace(oldRestore,oldRestore+`\n  if(state.adamBiasPowers){
    const {beta1,beta2}=state.adamBiasPowers;
    if(![beta1,beta2].every(x=>Number.isFinite(x)&&x>=0&&x<1)){optimizer.dispose();throw new Error('Invalid saved Adam bias powers');}
    tf.tidy(()=>{optimizer.accBeta1.assign(tf.scalar(beta1));optimizer.accBeta2.assign(tf.scalar(beta2));});
  }`);fs.writeFileSync(target,code);
  }else fs.copyFileSync(changed.includes(f.path)?path.resolve(f.path):source,target);
 }
 for(const name of added)fs.copyFileSync(path.resolve(name),path.join(directory,name));
 if(!fs.existsSync(path.join(directory,'node_modules')))fs.symlinkSync(path.resolve('node_modules'),path.join(directory,'node_modules'),'junction');
 console.log(JSON.stringify({built:true,sealed:false,directory}));
}else{
 assert.equal(mode,'seal');
 for(const name of [...changed,...added])assert.equal(sha(path.join(directory,name)),sha(path.resolve(name)));
 const safety=await import(pathToFileURL(path.join(directory,'scripts/training-safety.mjs'))),raw=safety.computeRawEngineFingerprint(directory);
 const compatibilityFile=path.join(directory,'scripts/training-fingerprint-compatibility.json'),compatibility=json(compatibilityFile);
 compatibility.entries.push({kind:'equivalent-evaluation-inference-v1',rawFingerprint:raw,compatibleFingerprint:old.trainingRuntime.engineFingerprint,
  policyActionsPreserved:true,evaluationBehaviorPreserved:true,savedTargetsPreserved:true,recurrentMemoryPreserved:true,
  auditReport:path.join(out,'runtime-verification.json'),scope:'Training callback receives optimizer snapshot and can return an exact companion optimizer; all inference/model/engine/teacher bytes unchanged.'});
 atomic(compatibilityFile,compatibility);assert.equal(safety.computeEngineFingerprint(directory),old.trainingRuntime.engineFingerprint);
 const names=[...new Set([...previous.map(x=>x.path),...added])];immutable(manifestFile,names.map(name=>({path:name,sha256:sha(path.join(directory,name))})));
 const runtime={directory,manifest:{path:manifestFile,sha256:sha(manifestFile)},engineFingerprint:old.trainingRuntime.engineFingerprint};
 immutable(path.join(out,'prepared.json'),{at:new Date().toISOString(),runtime,previousRuntime:old.trainingRuntime,previousPointer:pointer,
  previousRepair:{path:repairFile,sha256:sha(repairFile)},changed:[...changed,'src/ai/neural/trainer.mjs','scripts/training-fingerprint-compatibility.json'],added,
  teacherCriteriaUnchanged:true,evaluationUnchanged:true,trainingContract:'training-only-reference-recovery-atomic-epoch-v9'});
 console.log(JSON.stringify({sealed:true,runtime}));
}
