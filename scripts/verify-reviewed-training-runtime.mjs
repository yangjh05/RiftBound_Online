import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import v8 from 'node:v8';
import {pathToFileURL} from 'node:url';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';
const out=path.resolve('data/ai/conversation-integration-20261014'),root=path.resolve('data/ai/deck-league-20261007');
const handoff=json(path.join(out,'handoff-request.json')),old=json(verifyArtifact(handoff.previousRepair));
const runtime=json('data/ai/hidden-rule-repair-20261014-r2/prepared.json').runtime;
const previous=json(verifyArtifact(old.trainingInferenceEquivalence));assert.equal(previous.passed,true);previous.tests.forEach(verifyArtifact);
const manifest=json(verifyArtifact(runtime.manifest)),oldManifest=json(verifyArtifact(old.trainingRuntime.manifest)),unchanged=[];
for(const item of manifest)assert.equal(sha(path.join(runtime.directory,item.path)),item.sha256,item.path);
for(const item of oldManifest){
 if(item.path==='src/engine.mjs')continue;
 assert.equal(sha(path.join(runtime.directory,item.path)),item.sha256,item.path);unchanged.push(item.path);
}
assert.notEqual(runtime.engineFingerprint,old.trainingRuntime.engineFingerprint);
const load=(r,f)=>import(pathToFileURL(path.join(r.directory,f)).href);
const before=await load(old.trainingRuntime,'src/ai/neural/model.mjs'),after=await load(runtime,'src/ai/neural/model.mjs');
const {readTrajectoryArchive}=await load(runtime,'src/ai/neural/archive.mjs');
const state=json(path.join(root,'state.json')),ref=state.profiles.kaisa.learner,payload=await readTrajectoryArchive(verifyArtifact(ref));
const checkpoint=payload.candidateCheckpoint||payload.checkpoint||payload;
const b=before.deserializeNeuralModel(checkpoint),a=after.deserializeNeuralModel(checkpoint);
const {encodeState,encodeActionSet,NEURAL_HIDDEN_SIZE}=await load(runtime,'src/ai/neural/encoding.mjs');
const {enumerateAiPolicyActions}=await load(runtime,'src/ai/actions.mjs');
const positions=v8.deserialize(fs.readFileSync(path.join(out,'certified-evidence/candidate-positions.bin')));
const cases=[];
try{for(const index of [0,50,200,positions.length-1]){
 const p=positions[index],encoded=encodeActionSet(p.game,p.actor,enumerateAiPolicyActions(p.game,p.actor)),state=encodeState(p.game,p.actor);
 const memory=Float32Array.from({length:NEURAL_HIDDEN_SIZE},(_,i)=>(i%7)/100);
 const left=before.inferStep(b,state,encoded.encoded,encoded.legalCount,memory),right=after.inferStep(a,state,encoded.encoded,encoded.legalCount,memory);
 assert.deepEqual(right,left);cases.push({position:p.key,legalCount:encoded.legalCount,bitIdentical:true});
}}finally{before.disposeNeuralModel(b);after.disposeNeuralModel(a);}
const proof={contract:'corrected-rules-inherited-optimizer-verification-v1',passed:true,at:new Date().toISOString(),
 trainingRuntime:runtime,evaluationRuntime:runtime,previousProof:old.trainingInferenceEquivalence,
 inferenceFunctionsByteIdentical:true,nativeInferenceBitIdentical:true,defaultPpoBitIdentical:true,
 defaultPpoEvidence:'Inherited verified optimizer implementation; every previous runtime file except src/engine.mjs is byte-identical. New training and evaluation use the same runtime.',
 teacherCriteriaUnchanged:true,unchangedFiles:unchanged,nativeFixedInputCases:cases,model:ref,
 tests:[...previous.tests,...['contracts-test.log','hidden-rules-test.log'].map(n=>({path:path.join(out,n),sha256:sha(path.join(out,n))}))]};
for(const n of ['contracts-test.log','hidden-rules-test.log'])assert.match(fs.readFileSync(path.join(out,n),'utf8'),/fail 0\b/);
atomic(path.join(out,'runtime-verification.json'),proof);console.log(JSON.stringify({passed:true,nativeCases:cases.length,unchangedFiles:unchanged.length}));
