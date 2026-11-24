import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
import {json,atomic,verifyArtifact} from './deck-league-io.mjs';import {unwrap} from './deck-league-contract.mjs';
const [directory,output,profileId='sett']=process.argv.slice(2),config=json(path.join(directory,'config.json'));
const load=f=>import(pathToFileURL(path.join(directory,'runtime-r6-shared-inference',f)));
const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
const {measureLessonRetention}=await load('scripts/lesson-maintenance.mjs');
const {measureIndividualTraining,streamedIndividualMargins}=await load('scripts/individual-training-margin.mjs');
const {snapshotIndividualTraining,snapshotTrainingRetention,snapshotTrainingMargins}=await load('scripts/individual-training-snapshot.mjs');
const {lessonInputKey}=await load('scripts/tactical-lesson-learning.mjs');
const profile=config.profiles.find(p=>p.id===profileId),bank=await read(path.join(directory,'profiles',profileId,'lessons.json.gz')),original=await read(verifyArtifact(profile.originalLessons));
const groups=[original.bank.training,bank.bank.training],all=groups.flat(),unique=[...new Map(all.map(s=>[lessonInputKey(s),s])).values()];
const model=deserialize(unwrap(await read(verifyArtifact(profile.champion))));
try{
 const variables=Object.values(model.layers).flatMap(l=>l.trainableWeights.map(w=>w.val)),base=variables.map(v=>v.clone());
 const reset=()=>variables.forEach((v,i)=>v.assign(base[i]));
 try{
  reset();let start=performance.now();const oldGuards=groups.map(g=>measureLessonRetention(model,g)),oldChoices=measureIndividualTraining(model,unique),oldHinge=streamedIndividualMargins(model,unique,variables);
  const beforeMs=performance.now()-start;
  reset();start=performance.now();const snapshot=snapshotIndividualTraining(model,all),guards=groups.map(g=>snapshotTrainingRetention(snapshot,g)),choices=snapshotTrainingMargins(snapshot,unique),hinge=streamedIndividualMargins(model,unique,variables,{snapshot});
  const afterMs=performance.now()-start;
  assert.deepEqual(guards,oldGuards);assert.deepEqual(choices,oldChoices);assert.deepEqual(hinge,oldHinge);
  const report={at:new Date().toISOString(),profileId,trainingCases:unique.length,groupCases:all.length,snapshotCases:snapshot.size,beforeMs,afterMs,speedup:beforeMs/afterMs,
   scope:'one batch starting training guards, individual margins and streamed hinge; not complete Adam transaction',exactGuards:true,exactGradient:true,criteriaUnchanged:true};
  atomic(output,report);console.log(JSON.stringify(report));
 }finally{base.forEach(v=>v.dispose());}
}finally{dispose(model);}
