import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readTrajectoryArchive as read} from '../src/ai/neural/archive.mjs';
import {digest,validateCandidateConfig,fullLessonSchedule,candidateTrainingPlan,inheritedCandidateTrainingKeys} from './viktor-candidate-learning.mjs';
import {listNodeProcesses,selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';
const root=path.resolve(process.argv[2]||'data/ai/viktor-main-candidate-20261005');
const json=f=>JSON.parse(fs.readFileSync(f,'utf8')),sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const c=validateCandidateConfig(json(path.join(root,'config.json'))),configHash=digest(c);
const load=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f)).href);
const {assertAdaptiveGame,assertAdaptiveCheckpoint}=await load('scripts/adaptive-policy-q-evidence.mjs');
const {expectedDeckSearchPair}=await load('scripts/adaptive-deck-search.mjs');
for(const item of [c.parent,c.specialist,c.lessons,c.openingLessons,c.protocols])assert.equal(sha(item.path),item.sha256);
if(c.priorStage){
  assert.ok(c.priorTrainingInputs);assert.equal(sha(c.priorTrainingInputs.path),c.priorTrainingInputs.sha256);
  inheritedCandidateTrainingKeys(await read(c.priorTrainingInputs.path),(await read(c.lessons.path)).bank.validation);
}
for(const [name,hash]of Object.entries(c.executionFiles))assert.equal(sha(path.join(root,'execution',name)),hash);
const stateFile=path.join(root,'state.json.gz'),state=fs.existsSync(stateFile)?await read(stateFile):null;
if(state)assert.equal(state.configHash,configHash);
const controller=json(path.join(root,'controller.json'));assert.equal(controller.configHash,configHash);
const lessons=[];
for(const job of fullLessonSchedule(c)){
  const file=path.join(root,'lessons',`${job.id}.json.gz`);if(!fs.existsSync(file))continue;
  const r=await read(file),{recordHash,...body}=r;assert.equal(recordHash,digest(body));
  assert.equal(r.configHash,configHash);assert.deepEqual(r.job,job);assert.equal(sha(r.sourcePath),r.sourceSha256);
  if(r.failure)assert.equal(r.samples.length,0);
  for(const s of r.samples){
    assert.equal(s.lessonRole,job.role);assert.equal(s.lessonSource.role,job.role);assert.equal(s.deckId,c.deckId);
    assert.equal(s.memoryContext.contract,'complete-actor-observation-prefix-v1');
    assert.equal(s.memoryContext.playerId,s.playerId);assert.equal(s.memoryContext.fromReset,true);
    assert.equal(s.transferProof.specialistSha256,c.specialist.sha256);
    assert.equal(s.transferProof.specialistChoice,s.steps[0].selectedIndex);
    assert.equal(s.lessonSource.proof.thresholdsUnchanged,true);
  }
  lessons.push({id:job.id,role:job.role,failure:r.failure,actions:r.summary.actions,completed:r.summary.completed,
    accepted:r.samples.length,kinds:r.samples.map(s=>Object.keys(s.steps[0]).filter(k=>k.endsWith('Lesson')&&s.steps[0][k])),diagnostics:r.diagnostics});
}
const iterations=[];
for(let iteration=1;iteration<=4;iteration++){
  const dir=path.join(root,'iterations',String(iteration).padStart(6,'0')),planFile=path.join(dir,'plan.json.gz');
  if(!fs.existsSync(planFile))continue;
  const plan=await read(planFile);assert.equal(plan.configHash,configHash);
  assert.equal(digest(plan),digest(candidateTrainingPlan(c,iteration,plan.sourcePath,plan.sourceBehaviorHash,plan.leagueCollection.behaviorHashes.slice(1),expectedDeckSearchPair)));
  const saved=[];
  for(let index=0;index<64;index++){
    const file=path.join(dir,'games',`${index}.json.gz`);if(!fs.existsSync(file))continue;
    const game=await read(file);assertAdaptiveGame(game,plan,index);saved.push(index);
  }
  const finalFile=path.join(dir,'candidate.json.gz'),final=fs.existsSync(finalFile)?await read(finalFile):null;
  if(final){assert.equal(final.planHash,digest(plan));assertAdaptiveCheckpoint(final.checkpoint);assert.equal(final.sourceSha256,sha(plan.sourcePath));}
  iterations.push({iteration,savedGames:saved.length,completed:!!final,changed:final?final.beforeBehaviorHash!==final.afterBehaviorHash:null,
    trainingGames:final?.trainingGames,acceptedEpochs:final?.epochGuards.filter(g=>g.passed).length,newLessons:final?.verifiedLessons});
}
const processes=selectTrainingProcesses(await listNodeProcesses(),process.cwd());
const live=processes.find(p=>p.pid===controller.pid&&p.commandLine.includes('train-viktor-main-candidate.mjs'));
const result={checkedAt:new Date().toISOString(),configHash,controller,live:!!live,committedIterations:state?.iteration||0,
  lessons,iterations,resources:{count:processes.length,maximum:16,allNormal:processes.every(p=>{try{return os.getPriority(p.pid)===0;}catch(e){if(e.code==='ESRCH'||e.info?.code==='ESRCH')return true;throw e;}})},
  originalMainAndPilotAlive:[32116,37944].map(pid=>({pid,alive:processes.some(p=>p.pid===pid)})),mainWeightsChanged:false,parityEstablished:false};
assert.ok(result.resources.count<=16);assert.ok(result.resources.allNormal);
const file=path.join(root,'live-inspection.json'),tmp=`${file}.${process.pid}.tmp`;
fs.writeFileSync(tmp,JSON.stringify(result,null,2));fs.renameSync(tmp,file);
console.log(JSON.stringify(result));
