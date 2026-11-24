import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createTrainingStatusJournal} from '../scripts/training-status-journal.mjs';
test('overlapping completion and heartbeat callbacks preserve every event and the last snapshot',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'training-journal-'));
  try{
    const report=createTrainingStatusJournal(directory,{contract:'test'});
    await Promise.all(Array.from({length:128},(_,index)=>report(index%2?'game-saved':'collection',{index})));
    const snapshot=JSON.parse(await fs.readFile(path.join(directory,'status.json'),'utf8'));
    const events=(await fs.readFile(path.join(directory,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(snapshot.index,127);assert.deepEqual(events.map(e=>e.index),Array.from({length:128},(_,i)=>i));
    assert.equal((await fs.readdir(directory)).filter(f=>f.includes('.tmp-')).length,0);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
