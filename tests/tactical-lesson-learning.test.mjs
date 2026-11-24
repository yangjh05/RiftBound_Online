import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {TACTICAL_LESSON_CONTRACT,LESSON_FLAGS,validateTacticalLessonProtocol,commitTacticalLessonProtocol,
  readTacticalLessonProtocol,buildLessonBank,lessonInputKey,lessonTypes,balancedLessonRound,tacticalLessonGuard,
  freezeTacticalLessonBank,trainBalancedTacticalLessons,retentionLessonRound} from '../scripts/tactical-lesson-learning.mjs';
import {tacticalLessonDigest} from '../scripts/tactical-lesson-learning.mjs';
import {writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';

const protocol={contract:TACTICAL_LESSON_CONTRACT,afterIteration:199,minimumSourceIteration:165,replayRefreshes:8,
  maximumPerType:64,examplesPerTypePerRound:8,retentionPerTypePerRound:8,maximumRounds:12,learningRate:.0003,seed:2026092801};
const sample=(id,type='mulligan',role='training',deckId='a')=>({playerId:'p1',deckId,lessonRole:role,imitation:true,
  steps:[{state:new Float32Array([id]),actions:new Float32Array([0,1]),initialMemory:new Float32Array([0]),
    legalCount:2,legalActionKeys:['hold','play'],selectedIndex:1,selectedActionKey:'play',imitation:true,
    winProbabilityLabel:false,return:0,value:0,advantage:.5,[LESSON_FLAGS[type]]:true}]});
const metric=(p=.3,loss=1.5,accuracy=.2,decisions=10)=>({decisions,policyLoss:loss,meanTargetProbability:p,decisionAccuracy:accuracy});
const metrics=()=>Object.fromEntries(Object.keys(LESSON_FLAGS).map(t=>[t,metric()]));

test('lesson protocol is optional, prospective, immutable and bounded',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'tactical-lessons-'));
  try{
    assert.equal(await readTacticalLessonProtocol(root),null);
    await writeFile(path.join(root,'tactical-lesson-learning-protocol.json'),JSON.stringify(protocol));
    assert.deepEqual(await readTacticalLessonProtocol(root),protocol);
    const s={iteration:199};commitTacticalLessonProtocol(s,protocol);commitTacticalLessonProtocol(s,protocol);
    assert.throws(()=>commitTacticalLessonProtocol(s,null));
    assert.throws(()=>commitTacticalLessonProtocol(s,{...protocol,afterIteration:200}));
    assert.throws(()=>commitTacticalLessonProtocol({iteration:200},protocol));
    for(const invalid of [{maximumRounds:100},{learningRate:1},{replayRefreshes:999},{afterIteration:-1}])
      assert.throws(()=>validateTacticalLessonProtocol({...protocol,...invalid}));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('category regression cannot hide behind unchanged accuracy or better other lessons',()=>{
  const before=metrics(),after=metrics();
  after.mulligan=metric(.5,.8,.3);after.growth=metric(.25,1.7,.2);
  assert.deepEqual(tacticalLessonGuard(before,after).failures,['growth:loss']);
  after.growth=metric(.31,1.4,.2);assert.equal(tacticalLessonGuard(before,after).passed,true);
  after.response=metric(.29,1.4,.2);assert.equal(tacticalLessonGuard(before,after).passed,true);
  after.resource.decisionAccuracy=.1;assert.equal(tacticalLessonGuard(before,after).passed,false);
  after.resource=metric();after.response.policyLoss=NaN;assert.equal(tacticalLessonGuard(before,after).passed,false);
  after.response=metric();after.response.decisions--;assert.equal(tacticalLessonGuard(before,after).passed,false);
  after.response.decisions=NaN;assert.equal(tacticalLessonGuard(after,after).passed,false);
});
test('validation excludes conflicting training labels; newest input wins without modifying labels',()=>{
  const newest=sample(1),old=sample(1);old.steps[0].selectedIndex=0;old.steps[0].selectedActionKey='hold';
  const protectedPosition=sample(2,'growth','validation'),colliding=sample(2,'resource');
  const bank=buildLessonBank([newest,old,colliding],[protectedPosition]);
  assert.equal(bank.training.length,1);assert.equal(bank.training[0],newest);
  assert.equal(bank.droppedTrainingOverlap,1);
  assert.equal(lessonInputKey(protectedPosition),lessonInputKey(colliding));
  assert.throws(()=>buildLessonBank([protectedPosition],[]),/boundary/);
});
test('replay caps each type, balances decks, and repeats rare training lessons without training held-out positions',()=>{
  const train=Array.from({length:150},(_,i)=>sample(i,'mulligan','training',i%2?'a':'b'));
  const growth=sample(999,'growth');train.push(growth);
  const held=[sample(1000,'mulligan','validation'),sample(1001,'growth','validation')];
  const bank=buildLessonBank(train,held,64);
  assert.equal(bank.training.filter(s=>lessonTypes(s).includes('mulligan')).length,64);
  assert.equal(bank.training.filter(s=>s.deckId==='b').length,32);
  const batch=balancedLessonRound(bank,1);
  assert.equal(batch.length,16);assert.equal(batch.filter(s=>s===growth).length,8);
  assert.ok(batch.every(s=>s.lessonRole==='training'));
  assert.notDeepEqual(balancedLessonRound(bank,2),batch);
  assert.deepEqual(bank.validation,held);
  const overlapping=Array.from({length:150},(_,i)=>{const s=sample(2000+i);s.steps[0].growthLesson=true;return s;});
  const capped=buildLessonBank([...train,...overlapping],held);
  for(const t of Object.keys(LESSON_FLAGS))assert.ok(capped.training.filter(s=>lessonTypes(s).includes(t)).length<=64);
});
test('frozen replay preserves game partition, excludes old revisions, verifies source hashes and resumes exactly',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lesson-bank-'));
  try{
    const old=path.join(root,'tactical-refresh','000197'),current=path.join(root,'tactical-refresh','000200');
    await mkdir(path.join(old,'games'),{recursive:true});await mkdir(current,{recursive:true});
    const supplied={training:[sample(70,'mulligan')],validation:[sample(71,'mulligan','validation')]};
    const suppliedHash=tacticalLessonDigest([supplied.training,supplied.validation]);
    await writeTrajectoryArchive(path.join(old,'lesson-supply.json.gz'),{...supplied,samplesHash:suppliedHash,
      contract:'prospective-verified-opening-growth-supply-v1',sourceSha256:'source',engineFingerprint:'fp',teachingRevision:'v4'});
    await writeTrajectoryArchive(path.join(old,'checkpoint.json.gz'),{teachingRevision:'v4',engineFingerprint:'fp',sourceSha256:'source',protocolHash:'old',
      lessonSupply:{samplesHash:suppliedHash}});
    for(let i=0;i<2;i++)await writeTrajectoryArchive(path.join(old,'games',`${i}.json.gz`),{
      refreshContract:'prospective-public-tactical-refresh-v1',teachingRevision:'v4',engineFingerprint:'fp',sourceSha256:'source',protocolHash:'old',
      gameIndex:i,partition:i?'validation':'training',seed:123+i,summary:{completed:true,deckIds:['deck','deck']},
      samples:[sample(30+i,'growth',i?'validation':'training')]});
    const args={runDirectory:root,refreshDirectory:current,iteration:200,sourceSha256:'current',engineFingerprint:'fp',revision:'v4',protocol,
      training:[sample(1)],validation:[sample(2,'mulligan','validation')]};
    const bank=await freezeTacticalLessonBank(args),resumed=await freezeTacticalLessonBank(args);
    assert.deepEqual(resumed,bank);assert.equal(bank.sources.length,3);
    assert.ok(bank.training.some(s=>s.steps[0].state[0]===70));assert.ok(bank.validation.some(s=>s.steps[0].state[0]===71));
    assert.equal(bank.training.find(s=>s.steps[0].growthLesson).steps[0].state[0],30);
    assert.equal(bank.validation.find(s=>s.steps[0].growthLesson).steps[0].state[0],31);
    await writeFile(path.join(old,'games','0.json.gz'),'modified');
    await assert.rejects(freezeTacticalLessonBank(args),/source changed/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('optimizer refuses a held-out example in any training input before touching a model',async()=>{
  const held=sample(4,'growth','validation');
  await assert.rejects(trainBalancedTacticalLessons({model:null,protocol,bank:{training:[],validation:[held]},training:[held]}),/boundary/);
  await assert.rejects(trainBalancedTacticalLessons({model:null,protocol,bank:{training:[sample(4,'growth')],validation:[held]},training:[]}),/overlaps/);
  await assert.rejects(trainBalancedTacticalLessons({model:null,protocol,bank:{training:[sample(4,'growth')],validation:[]},
    training:[],additionalValidation:[held]}),/overlaps/);
  await assert.rejects(trainBalancedTacticalLessons({model:null,protocol,bank:{training:[sample(4,'growth')],validation:[]},
    training:[],validation:[held]}),/overlaps/);
});
test('forgetting rehearsal uses individual training regressions even if the category average improves',()=>{
  const bank={training:[sample(1,'response'),sample(2,'response'),sample(3,'growth')],validation:[sample(4,'growth','validation')]};
  const rehearsal=retentionLessonRound(bank,[.9,.2,.3],[.8,.5,.2]);
  assert.deepEqual(rehearsal,[bank.training[2],bank.training[0]]);
  assert.deepEqual(retentionLessonRound(bank,[.9,.2,.3],[.9,.3,.3]),[]);
});
