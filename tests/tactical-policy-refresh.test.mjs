import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {tacticalRefreshSchedule,readTacticalRefreshProtocol,TACTICAL_REFRESH_CONTRACT,
  readTeachingRepairProtocol,commitTeachingRepairProtocol,TEACHING_REPAIR_CONTRACT} from '../scripts/tactical-policy-refresh.mjs';
import {TACTICAL_TEACHING_REVISION} from '../scripts/response-aware-demonstration.mjs';
const protocol={contract:TACTICAL_REFRESH_CONTRACT,afterIteration:26,everyIterations:8,games:10,epochs:2,learningRate:0.0001,seed:123456};
test('fresh tactical practice balances each deck across disjoint training and validation games',()=>{
 const decks=['a','b','c','d','e'];
 assert.equal(tacticalRefreshSchedule(protocol,26,decks),null);
 const first=tacticalRefreshSchedule(protocol,27,decks);
 assert.equal(first.length,10);assert.equal(new Set(first.map(g=>g.seed)).size,10);
 for(const id of decks)assert.deepEqual(first.filter(g=>g.deckId===id).map(g=>g.partition),['training','validation']);
 for(let i=28;i<35;i++)assert.equal(tacticalRefreshSchedule(protocol,i,decks),null);
 const next=tacticalRefreshSchedule(protocol,35,decks);
 assert.ok(next.every(g=>!first.some(h=>h.seed===g.seed)));
 assert.deepEqual(tacticalRefreshSchedule(protocol,27,decks),first);
});
test('refresh opt-in is explicit and malformed schedules cannot silently reset a learner',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'tactical-refresh-'));
 try{
   assert.equal(await readTacticalRefreshProtocol(root),null);
   const file=path.join(root,'tactical-refresh-protocol.json');
   await writeFile(file,'\uFEFF'+JSON.stringify(protocol));
   assert.deepEqual(await readTacticalRefreshProtocol(root),protocol);
   await writeFile(file,JSON.stringify({...protocol,everyIterations:1}));
   await assert.rejects(readTacticalRefreshProtocol(root),/Invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('new teaching revision is committed prospectively and cannot mix saved targets',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'teaching-repair-'));
 try{
   assert.equal(await readTeachingRepairProtocol(root),null);
   const p={contract:TEACHING_REPAIR_CONTRACT,revision:TACTICAL_TEACHING_REVISION,afterIteration:159};
   const file=path.join(root,'teaching-repair-protocol.json');await writeFile(file,JSON.stringify(p));
   assert.deepEqual(await readTeachingRepairProtocol(root),p);
   const state={iteration:159};commitTeachingRepairProtocol(state,p);commitTeachingRepairProtocol(state,p);
   assert.throws(()=>commitTeachingRepairProtocol(state,null),/removed/);
   assert.throws(()=>commitTeachingRepairProtocol(state,{...p,afterIteration:160}),/changed/);
   assert.throws(()=>commitTeachingRepairProtocol({iteration:160},p),/prospective/);
   await writeFile(file,JSON.stringify({...p,revision:'old-teacher'}));
   await assert.rejects(readTeachingRepairProtocol(root),/Invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
});
