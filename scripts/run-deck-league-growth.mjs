import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL,fileURLToPath} from 'node:url';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';import {digest,unwrap} from './deck-league-contract.mjs';
import {selectGrowthTraining,inputKey} from './growth-coverage.mjs';
const [configFile,mode='run']=process.argv.slice(2),c=json(configFile),root=c.directory,configHash=digest(c);
assert.ok(['preflight','run'].includes(mode));assert.equal(c.contract,'bounded-deck-growth-coverage-v1');assert.equal(c.jobs.length,32);
for(const [f,h]of Object.entries(c.executionFiles))assert.equal(sha(path.join(path.dirname(fileURLToPath(import.meta.url)),f)),h);
const load=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f)));
const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
const {withFileLock}=await load('scripts/file-lock.mjs');
const status=(stage,extra={})=>atomic(path.join(root,mode==='preflight'?'preflight.json':'controller.json'),{at:new Date().toISOString(),pid:process.pid,stage,configHash,...extra});
await withFileLock(path.join(root,'controller.lock'),async()=>{
 let model,dispose;try{
  assert.equal(os.getPriority(0),os.constants.priority.PRIORITY_NORMAL);status('preflight');
  for(const ref of [c.runtimeManifest,c.parent,c.sourceConfig,c.responseConfig,c.bank,c.inputRoles,c.priorCollection])verifyArtifact(ref);
  for(const f of json(c.runtimeManifest.path))assert.equal(sha(path.join(c.runtimeDirectory,f.path)),f.sha256);
  const source=json(c.sourceConfig.path),response=json(c.responseConfig.path).responseContext;assert.ok(response);
  const {deserializeNeuralModel,disposeNeuralModel,inferStep}=await load('src/ai/neural/model.mjs');dispose=disposeNeuralModel;
  const {createSupplyGame,hasGrowthOpening,collectSupplyPrefix,LESSON_SUPPLY_LIMITS}=await load('scripts/tactical-lesson-supply.mjs');
  const {computeEngineFingerprint}=await load('scripts/training-safety.mjs');assert.equal(computeEngineFingerprint(),c.engineFingerprint);
  const {resolveLessonMemory}=await load('scripts/lesson-memory-context.mjs');const {assertLessonSample}=await load('scripts/tactical-lesson-learning.mjs');
  assert.deepEqual(c.limits,LESSON_SUPPLY_LIMITS);model=deserializeNeuralModel(unwrap(await read(c.parent.path)));
  const bank=(await read(c.bank.path)).bank,roles=await read(c.inputRoles.path),held=new Set(roles.protected),seen=new Set([...roles.trained,...bank.training.map(inputKey)]);
  const s=bank.validation[0];assert.ok(inferStep(model,s.steps[0].state,s.steps[0].actions,s.steps[0].legalCount,resolveLessonMemory(model,s)).logits.every(Number.isFinite));
  if(mode==='preflight'){status('passed',{jobs:32,runtimeFiles:json(c.runtimeManifest.path).length});return;}
  assert.ok(!fs.existsSync(path.join(root,'result.json')),'Completed batch cannot be repeated.');
  const samples=[],records=[];
  for(const job of c.jobs){
   assert.ok(job.deckIds.every(id=>id===c.deckId),'The specialist must play only its fixed deck.');
   const file=path.join(root,'records',job.id+'.json.gz');let record;
   if(fs.existsSync(file)){record=await read(file);const {recordHash,...body}=record;assert.equal(recordHash,digest(body));assert.equal(record.configHash,configHash);assert.deepEqual(record.job,job);}
   else{
    status('collecting',{completed:records.length,total:32,accepted:samples.length});let game=null,seed=null,attempts=0;
    const decks=job.deckIds.map(id=>source.profiles.find(p=>p.deck.id===id).deck);
    for(const candidateSeed of job.seeds){attempts++;const candidate=createSupplyGame(decks,candidateSeed,job.chooser);if(hasGrowthOpening(candidate)){game=candidate;seed=candidateSeed;break;}}
    const prefix=game?collectSupplyPrefix({game,model,role:'training',familyId:job.id,deckIds:job.deckIds,engineFingerprint:c.engineFingerprint,
     origin:'independent-deck-growth-20261007',protocol:c.limits,responseContext:response}):{role:'training',samples:[],failure:null,diagnostics:{positions:0,reviewed:0,accepted:0},policyOnly:true,terminalLabels:false};
    const body={...prefix,job,configHash,seed,attempts,noEligibleDeal:!game};record={...body,recordHash:digest(body)};await write(file,record);
   }
   assert.ok(record.attempts>0&&record.attempts<=64);assert.ok(record.diagnostics.positions<=96);assert.ok((record.diagnostics.growthReviews||0)<=8);
   const selected=selectGrowthTraining(record,{deckId:c.deckId,protectedKeys:held,seen});
   for(const sample of selected.accepted){
    assertLessonSample(sample,'training');assert.equal(sample.engineFingerprint,c.engineFingerprint);
    const memory=resolveLessonMemory(model,sample),s=sample.steps[0];assert.ok(memory.every((v,i)=>Math.abs(v-s.initialMemory[i])<1e-4));
    const logits=inferStep(model,s.state,s.actions,s.legalCount,memory).logits;assert.ok(logits.every(Number.isFinite));assert.notEqual(logits.indexOf(Math.max(...logits)),s.selectedIndex);
    samples.push(sample);
   }
   records.push({job:job.id,path:file,sha256:sha(file),recordHash:record.recordHash,selected:selected.accepted.length,excluded:selected.counts,diagnostics:record.diagnostics});
  }
  const lessons={contract:c.contract,configHash,training:samples,validation:[],samplesHash:digest(samples),policyOnly:true,terminalLabels:false,criteriaUnchanged:true};
  await write(path.join(root,'lessons.json.gz'),lessons);
  const result={at:new Date().toISOString(),configHash,completed:32,acceptedTraining:samples.length,records,modelWeightsChanged:false,permanentRole:'training-only',
   lessons:{path:path.join(root,'lessons.json.gz'),sha256:sha(path.join(root,'lessons.json.gz'))}};
  atomic(path.join(root,'result.json'),result);status('completed',{completed:32,acceptedTraining:samples.length});
 }catch(e){status('failed',{error:e.stack});throw e;}
 finally{if(model)dispose(model);if(mode==='run')atomic(path.join(root,'reservation-release.json'),{released:true,at:new Date().toISOString()});}
},{timeoutMs:1000});
