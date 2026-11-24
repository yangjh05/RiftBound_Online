import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {SPECIALIST_LESSONS, lessonHash, publicInputKey, selectVerifiedSpecialistLessons, assertLessonRecord, splitVerifiedLessons} from '../scripts/verified-specialist-lessons.mjs';
import {selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';

const job = {id:'fresh-0',role:'training',seed:123,deckIds:['v','other'],chooser:'p1'};
const plan = {contract:SPECIALIST_LESSONS,deckId:'v',engineFingerprint:'engine',teachingRevision:'teacher',models:{parent:{sha256:'p'},specialist:{sha256:'s'}}};
const sample = () => ({gameId:job.id,lessonRole:'training',playerId:'p1',deckId:'v',engineFingerprint:'engine',
  lessonSource:{familyId:job.id,role:'training',actionCount:1,proof:{thresholdsUnchanged:true}},
  memoryContext:{contract:'complete-actor-observation-prefix-v1',playerId:'p1',fromReset:true,states:[[1,2]]},
  steps:[{imitation:true,winProbabilityLabel:false,mulliganLesson:true,selectedIndex:1,legalCount:2,state:[3,4],actions:[5,6]}]});
const prefix = (samples=[sample()]) => ({familyId:job.id,role:job.role,terminalLabels:false,policyOnly:true,teachingRevision:'teacher',failure:null,samples});

test('specialist choices require an independent correction and must differ from the parent',()=>{
  assert.equal(selectVerifiedSpecialistLessons(prefix(),job,plan,()=>({parent:0,specialist:1})).samples.length,1);
  assert.equal(selectVerifiedSpecialistLessons(prefix(),job,plan,()=>({parent:0,specialist:0})).samples.length,0);
  assert.equal(selectVerifiedSpecialistLessons(prefix(),job,plan,()=>({parent:1,specialist:1})).samples.length,0);
  const unproven=sample();unproven.lessonSource.proof.thresholdsUnchanged=false;
  assert.throws(()=>selectVerifiedSpecialistLessons(prefix([unproven]),job,plan,()=>({parent:0,specialist:1})));
});
test('failed games discard even earlier labels and absent or foreign actor histories fail closed',()=>{
  assert.throws(()=>selectVerifiedSpecialistLessons({...prefix(),failure:'illegal-transition'},job,plan,()=>({parent:0,specialist:1})));
  assert.deepEqual(selectVerifiedSpecialistLessons({...prefix([]),failure:'illegal-transition'},job,plan,()=>assert.fail()).samples,[]);
  for(const change of [s=>delete s.memoryContext,s=>s.memoryContext.playerId='p2',s=>s.memoryContext.fromReset=false]){
    const s=sample();change(s);assert.throws(()=>selectVerifiedSpecialistLessons(prefix([s]),job,plan,()=>assert.fail()));
  }
});
test('resuming a record rejects different model, seed, role or changed sample contents',()=>{
  const selected=selectVerifiedSpecialistLessons(prefix(),job,plan,()=>({parent:0,specialist:1}));
  const record={planHash:lessonHash(plan),job,teachingRevision:'teacher',failure:null,samples:selected.samples};record.recordHash=lessonHash(record);
  assert.equal(assertLessonRecord(record,plan,job),record);
  assert.throws(()=>assertLessonRecord(record,{...plan,models:{...plan.models,parent:{sha256:'new'}}},job));
  assert.throws(()=>assertLessonRecord(record,plan,{...job,seed:124}));
  assert.throws(()=>assertLessonRecord(record,plan,{...job,role:'validation'}));
  const altered=structuredClone(record);altered.samples[0].steps[0].selectedIndex=0;
  assert.throws(()=>assertLessonRecord(altered,plan,job));
});
test('validation owns identical public inputs despite a different seat, label or memory',()=>{
  const train=sample(), validation=structuredClone(train);validation.lessonRole='validation';validation.playerId='p2';
  validation.steps[0].selectedIndex=0;validation.steps[0].initialMemory=[99];
  assert.equal(publicInputKey(train),publicInputKey(validation));
  const split=splitVerifiedLessons([{samples:[train,validation,train]}]);
  assert.equal(split.training.length,0);assert.equal(split.validation.length,1);assert.equal(split.excluded,2);
  assert.equal(splitVerifiedLessons([{samples:[train]}],[publicInputKey(train)]).training.length,0);
});
test('a serial lesson collector counts toward the shared worker cap without selecting another checkout',()=>{
  const root=path.resolve('project');
  assert.deepEqual(selectTrainingProcesses([
    {pid:1,commandLine:`node ${root}/execution/run-viktor-transfer-lessons.mjs plan.json run`},
    {pid:2,commandLine:`node ${root}-other/execution/run-viktor-transfer-lessons.mjs plan.json run`}
  ],root).map(p=>p.pid),[1]);
});
