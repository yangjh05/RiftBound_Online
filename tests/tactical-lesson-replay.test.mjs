import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {TACTICAL_LESSON_CONTRACT,LESSON_REPLAY_CONTRACT,tacticalLessonDigest,validateLessonReplayProtocol,
  readLessonReplayProtocol,commitLessonReplayProtocol,lessonReplayCommitment,freezeTacticalLessonBank,
  lessonInputKey,lessonTypes,trainBalancedTacticalLessons} from '../scripts/tactical-lesson-learning.mjs';
import {writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';

const protocol={contract:TACTICAL_LESSON_CONTRACT,afterIteration:0,minimumSourceIteration:165,replayRefreshes:8,
  maximumPerType:64,examplesPerTypePerRound:8,retentionPerTypePerRound:8,maximumRounds:12,learningRate:.0003,seed:2026092801};
const replay={contract:LESSON_REPLAY_CONTRACT,afterIteration:19,minimumSourceIteration:1,
  lessonProtocolHash:tacticalLessonDigest(protocol),engineFingerprint:'fp',teachingRevision:'v4'};
const sample=(id,role='training')=>({playerId:'p1',deckId:'annie',lessonRole:role,imitation:true,
  steps:[{state:new Float32Array([id]),actions:new Float32Array([0,1]),initialMemory:new Float32Array([0]),
    legalCount:2,legalActionKeys:['hold','play'],selectedIndex:1,selectedActionKey:'play',imitation:true,
    winProbabilityLabel:false,return:0,value:0,advantage:.5,mulliganLesson:true}]});
async function source(root,i,{revision='v4',fingerprint='fp',complete=true}={}){
  const dir=path.join(root,'tactical-refresh',String(i).padStart(6,'0'));
  await mkdir(path.join(dir,'games'),{recursive:true});
  if(!complete)return;
  const common={teachingRevision:revision,engineFingerprint:fingerprint,sourceSha256:`source-${i}`,protocolHash:`old-${i}`};
  const supply={training:[sample(i*100)],validation:[sample(i*100+1,'validation')]};
  const samplesHash=tacticalLessonDigest([supply.training,supply.validation]);
  await writeTrajectoryArchive(path.join(dir,'lesson-supply.json.gz'),{...common,...supply,samplesHash,
    contract:'prospective-verified-opening-growth-supply-v1'});
  await writeTrajectoryArchive(path.join(dir,'checkpoint.json.gz'),{...common,iteration:i,
    contract:'prospective-public-tactical-refresh-v1',lessonSupply:{samplesHash}});
  for(let j=0;j<2;j++)await writeTrajectoryArchive(path.join(dir,'games',`${j}.json.gz`),{...common,
    refreshContract:'prospective-public-tactical-refresh-v1',gameIndex:j,partition:j?'validation':'training',
    seed:i*2+j,summary:{completed:true,deckIds:['annie','annie']},samples:[sample(i*100+2+j,j?'validation':'training')]});
}
const args=(root,iteration,replayProtocol=null)=>({runDirectory:root,
  refreshDirectory:path.join(root,'tactical-refresh',String(iteration).padStart(6,'0')),
  iteration,sourceSha256:'new',engineFingerprint:'fp',revision:'v4',protocol,training:[],validation:[],replayProtocol});

test('replay opt-in is immutable, bound to the existing lesson contract, and prospective',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lesson-replay-'));
  try{
    assert.equal(await readLessonReplayProtocol(root,protocol),null);
    await writeFile(path.join(root,'lesson-replay-protocol.json'),JSON.stringify(replay));
    assert.deepEqual(await readLessonReplayProtocol(root,protocol),replay);
    const state={iteration:19,tacticalLessonLearningHash:tacticalLessonDigest(protocol)};
    commitLessonReplayProtocol(state,replay);commitLessonReplayProtocol(state,replay);
    assert.throws(()=>commitLessonReplayProtocol(state,null),/removed/);
    assert.throws(()=>commitLessonReplayProtocol(state,{...replay,minimumSourceIteration:2}),/changed/);
    assert.throws(()=>commitLessonReplayProtocol({...state,tacticalLessonReplayHash:null,iteration:20},replay),/prospectively/);
    assert.throws(()=>commitLessonReplayProtocol({iteration:19},replay),/contract changed/);
    await assert.rejects(readLessonReplayProtocol(root,{...protocol,seed:1}),/contract changed/);
    for(const change of [{afterIteration:-1},{minimumSourceIteration:0},{minimumSourceIteration:21},{lessonProtocolHash:'bad'}])
      assert.throws(()=>validateLessonReplayProtocol({...replay,...change}));
    assert.deepEqual(lessonReplayCommitment(protocol,replay,{iteration:19,engineFingerprint:'fp',revision:'v4'}),
      {minimumSourceIteration:165,replayProtocolHash:null});
    assert.equal(lessonReplayCommitment(protocol,replay,{iteration:20,engineFingerprint:'fp',revision:'v4'}).minimumSourceIteration,1);
    assert.throws(()=>lessonReplayCommitment(protocol,replay,{iteration:20,engineFingerprint:'other',revision:'v4'}),/engine changed/);
    assert.throws(()=>lessonReplayCommitment(protocol,replay,{iteration:20,engineFingerprint:'fp',revision:'old'}),/revision changed/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('new run reuses eligible lessons below 165 without rewriting old banks or labels',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lesson-replay-'));
  try{
    await source(root,1);
    const old=await freezeTacticalLessonBank(args(root,19));assert.equal(old.sources.length,0);
    assert.deepEqual(await freezeTacticalLessonBank(args(root,19,replay)),old);
    const settings=args(root,20,replay);
    // A protected OLD position also excludes a matching fresh training input.
    settings.training=[sample(101),sample(999)];settings.validation=[sample(998,'validation')];
    const bank=await freezeTacticalLessonBank(settings);
    assert.deepEqual(bank.replayRefreshIterations,[1]);assert.equal(bank.sources.length,4);
    assert.ok(bank.training.some(s=>s.steps[0].state[0]===100));
    assert.ok(bank.training.some(s=>s.steps[0].state[0]===102));
    assert.ok(bank.validation.some(s=>s.steps[0].state[0]===101));
    const heldKeys=new Set(bank.validation.map(lessonInputKey));
    assert.ok(bank.training.every(s=>s.lessonRole==='training'&&!heldKeys.has(lessonInputKey(s))));
    assert.ok(bank.training.every(s=>s.steps[0].selectedActionKey==='play'&&s.steps[0].advantage===.5));
    assert.deepEqual(await freezeTacticalLessonBank(settings),bank);
    await assert.rejects(freezeTacticalLessonBank({...settings,replayProtocol:null}),/commitment changed/);
    await writeTrajectoryArchive(path.join(root,'tactical-refresh','000001','checkpoint.json.gz'),{changed:true});
    await assert.rejects(freezeTacticalLessonBank(settings),/source changed/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('recent replay counts eight compatible completed refreshes and excludes future or incompatible data',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lesson-replay-'));
  try{
    for(let i=1;i<=17;i++)await source(root,i);
    await source(root,18,{complete:false});await source(root,19,{fingerprint:'wrong'});await source(root,20,{revision:'old'});
    await source(root,22);
    const bank=await freezeTacticalLessonBank(args(root,21,replay));
    assert.deepEqual(bank.replayRefreshIterations,[17,16,15,14,13,12,11,10]);
    assert.equal(bank.sources.length,32);
    assert.ok(bank.sources.every(s=>s.iteration>=10&&s.iteration<=17));
    assert.equal(bank.training.length,16);assert.equal(bank.validation.length,16);
    for(const role of ['training','validation'])for(const type of ['mulligan','growth','resource','response'])
      assert.ok(bank[role].filter(s=>lessonTypes(s).includes(type)).length<=64);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('replay refuses corrupted game provenance or a validation sample relabeled as training',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lesson-replay-'));
  try{
    await source(root,1);
    const file=path.join(root,'tactical-refresh','000001','games','0.json.gz');
    const game={refreshContract:'prospective-public-tactical-refresh-v1',teachingRevision:'v4',engineFingerprint:'fp',
      sourceSha256:'source-1',protocolHash:'old-1',gameIndex:0,partition:'validation',seed:2,
      summary:{completed:true,deckIds:['annie','annie']},samples:[sample(102,'validation')]};
    await writeTrajectoryArchive(file,game);
    await assert.rejects(freezeTacticalLessonBank(args(root,20,replay)));
    game.partition='training';game.engineFingerprint='other';await writeTrajectoryArchive(file,game);
    await assert.rejects(freezeTacticalLessonBank(args(root,20,replay)));
    game.engineFingerprint='fp';await writeTrajectoryArchive(file,game);
    // A saved sample's protected role must not be overwritten by its container.
    await assert.rejects(freezeTacticalLessonBank(args(root,20,replay)),/boundary/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('held-out inputs remain protected when the measured validation bank is capped',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lesson-replay-'));
  try{
    await mkdir(path.join(root,'tactical-refresh'),{recursive:true});
    const validation=Array.from({length:80},(_,i)=>sample(i,'validation'));
    const bank=await freezeTacticalLessonBank({...args(root,20,replay),validation});
    assert.equal(bank.validation.length,64);assert.equal(bank.protectedValidationKeys.length,80);
    const capped=validation[79];assert.ok(!bank.validation.some(s=>lessonInputKey(s)===lessonInputKey(capped)));
    assert.ok(bank.protectedValidationKeys.includes(lessonInputKey(capped)));
    await assert.rejects(trainBalancedTacticalLessons({model:null,protocol,
      bank:{...bank,training:[sample(79)]},training:[]}),/overlaps/);
  }finally{await rm(root,{recursive:true,force:true});}
});
