import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
import {json,atomic,verifyArtifact} from './deck-league-io.mjs';import {unwrap} from './deck-league-contract.mjs';

// Inspect saved TRAINING-only rejection evidence at final retained weights.
// This creates no optimizer, gradient, training step, seed or game.
const [directory,profileId,output]=process.argv.slice(2),config=json(path.join(directory,'config.json'));
const base=file=>import(pathToFileURL(path.join(config.runtimeDirectory,file)));
const {readTrajectoryArchive:read}=await base('src/ai/neural/archive.mjs');
const candidate=await read(path.join(directory,'profiles',profileId,'replay/candidate.json.gz'));
const load=file=>import(pathToFileURL(path.join(candidate.policyRuntime.directory,file)));
const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
const {measureIndividualTraining,INDIVIDUAL_MARGIN}=await load('scripts/individual-training-margin.mjs');
const {lessonInputKey}=await load('scripts/tactical-lesson-learning.mjs');
const profile=config.profiles.find(p=>p.id===profileId),original=await read(verifyArtifact(profile.originalLessons)),bank=await read(verifyArtifact(candidate.lessonBank));
const unique=[...new Map([...original.bank.training,...bank.bank.training].map(s=>[lessonInputKey(s),s])).values()];
const last=candidate.epochGuards.at(-1);assert.equal(last.passed,false);assert.equal(last.updateEvidence.changed,false);
const model=deserialize(unwrap(candidate));
try{
 const measured=measureIndividualTraining(model,unique),active=measured.map((m,index)=>({...m,index})).filter(m=>m.margin<INDIVIDUAL_MARGIN.floor);
 const selected=active.slice().sort((a,b)=>Number(b.correct)-Number(a.correct)||a.margin-b.margin||a.index-b.index).slice(0,8);
 const keys=[...new Set(candidate.batchReports.filter(b=>b.epoch===last.epoch).flatMap(b=>b.attempts.flatMap(t=>t.individualCheck?.failures?.map(f=>f.key)||[])))];
 const report={at:new Date().toISOString(),profileId,trainingOnly:true,modelChanged:false,finalWeightsRepresentRejectedEpochStart:true,
  cases:measured.length,activeCases:active.length,fragileCorrectCases:active.filter(m=>m.correct).length,
  blockingCases:keys.map(key=>({...measured.find(m=>m.key===key),inProjectionWorkingSet:selected.some(m=>m.key===key)})),
  workingSet:selected,epoch:last.epoch,maximumDirections:8};
 atomic(output,report);console.log(JSON.stringify(report));
}finally{dispose(model);}
