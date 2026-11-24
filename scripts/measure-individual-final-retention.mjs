import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {json,atomic,sha,verifyArtifact} from './deck-league-io.mjs';
import {unwrap} from './deck-league-contract.mjs';

// Read-only final diagnostics. These measurements never generate a gradient,
// choose an epoch, change a candidate, or add a training example.
const [directory,output,...profileIds]=process.argv.slice(2),config=json(path.join(directory,'config.json'));
verifyArtifact(config.runtimeManifest);
for(const entry of json(config.runtimeManifest.path))assert.equal(sha(path.join(config.runtimeDirectory,entry.path)),entry.sha256);
const load=file=>import(pathToFileURL(path.join(config.runtimeDirectory,file)));
const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
const {measureLessonRetention,lessonSafetyGuard}=await load('scripts/lesson-maintenance.mjs');
const results=[];
for(const profileId of profileIds){
 const profile=config.profiles.find(p=>p.id===profileId);assert.ok(profile);
 const file=path.join(directory,'profiles',profileId,'replay/candidate.json.gz');
 const candidate=await read(file),bank=await read(verifyArtifact(candidate.lessonBank));
 const beforeModel=deserialize(unwrap(await read(verifyArtifact(profile.champion)))),afterModel=deserialize(unwrap(candidate));
 try{
  const result={profileId,candidate:{path:file,sha256:sha(file)},beforeBehaviorHash:candidate.beforeBehaviorHash,afterBehaviorHash:candidate.afterBehaviorHash};
  for(const role of ['training','validation']){
   const before=measureLessonRetention(beforeModel,bank.bank[role]),after=measureLessonRetention(afterModel,bank.bank[role]);
   result[role]={cases:before.correct.length,before:before.types,after:after.types,
    correctBefore:before.correct.filter(Boolean).length,correctAfter:after.correct.filter(Boolean).length,
    newlyCorrect:before.correct.filter((v,i)=>!v&&after.correct[i]).length,
    lostCorrect:before.correct.filter((v,i)=>v&&!after.correct[i]).length,
    unchangedSafetyGuard:lessonSafetyGuard(before,after)};
  }
  results.push(result);
 }finally{dispose(beforeModel);dispose(afterModel);}
}
const report={at:new Date().toISOString(),diagnosticOnly:true,matchStrengthEstablished:false,results};
atomic(output,report);
console.log(JSON.stringify(report));
