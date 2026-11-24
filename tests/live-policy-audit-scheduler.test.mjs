import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {adaptiveWorkerBudget} from '../scripts/adaptive-policy-q-contract.mjs';
import {livePolicyAuditBudget,runLivePolicyAuditPipeline} from '../scripts/live-policy-audit-scheduler.mjs';
import {createAuditPool} from '../scripts/detached-action-audit-coordinator.mjs';

test('foreground audit borrows only actually drained background capacity within the global limit',()=>{
  for(let external=0;external<=16;external++){
    const base=adaptiveWorkerBudget(external,16);
    assert.deepEqual(livePolicyAuditBudget(base),base);
    for(let occupied=0;occupied<=base.audit;occupied++){
      const b=livePolicyAuditBudget(base,{active:true,backgroundWorkers:occupied});
      assert.equal(b.audit,0);assert.ok(b.trainer+b.evaluation+b.selfplay+occupied+external<=16);
      assert.equal(b.selfplay+occupied,base.audit+base.selfplay);
    }
  }
  const base=adaptiveWorkerBudget(0,16);
  assert.equal(livePolicyAuditBudget(base,{active:true,backgroundWorkers:6}).selfplay,8);
  assert.equal(livePolicyAuditBudget(base,{active:true,backgroundWorkers:0}).selfplay,14);
});

test('a slow first candidate cannot block later candidates, but final result order is stable',async()=>{
  let release;const blocked=new Promise(r=>release=r),started=[],finished=[];
  const work=runLivePolicyAuditPipeline([0,1,2,3,4],{concurrency:2,runJob:async j=>{
    started.push(j);if(j===0)await blocked;return {report:j,reference:j%2?null:j};
  },onCompleted:async(r,i)=>{finished.push(i);}});
  await delay(20);assert.deepEqual(started,[0,1,2,3,4]);assert.deepEqual(finished,[1,2,3,4]);
  release();const parallel=await work;
  const serial=await runLivePolicyAuditPipeline([0,1,2,3,4],{concurrency:1,runJob:async j=>({report:j,reference:j%2?null:j})});
  assert.deepEqual(parallel,serial);assert.equal(parallel.paused,false);
});

test('pause admits no new candidate and failure waits for in-flight jobs before propagating',async()=>{
  let stop=false,release;const blocked=new Promise(r=>release=r),started=[];
  const work=runLivePolicyAuditPipeline([0,1,2],{concurrency:2,shouldStop:()=>stop,runJob:async j=>{
    started.push(j);await blocked;return {report:j};
  }});
  stop=true;release();assert.equal((await work).paused,true);assert.deepEqual(started,[0,1]);
  let drained=false;
  await assert.rejects(runLivePolicyAuditPipeline([0,1,2],{concurrency:2,runJob:async j=>{
    if(j===0){await delay(1);throw new Error('invalid shard');}
    await delay(20);drained=true;return {report:j};
  }}),/invalid shard/);
  assert.equal(drained,true);
});

test('selection remains before confirmation for every candidate across interleaved execution',async()=>{
  const phases=[];
  const result=await runLivePolicyAuditPipeline([0,1,2,3],{concurrency:4,runJob:async j=>{
    phases.push([j,'selection']);await delay((4-j)*3);
    if(j===1)return {report:'selection-uncertain',reference:null};
    phases.push([j,'final']);await delay(j*2);return {report:'confirmed',reference:j};
  }});
  assert.equal(result.results[1].report,'selection-uncertain');
  assert.equal(phases.filter(([j])=>j===1).length,1);
  for(const j of [0,2,3])assert.deepEqual(phases.filter(([i])=>i===j).map(([,p])=>p),['selection','final']);
});

test('real worker pools hand capacity over at saved shard boundaries and recover background work',{timeout:45000},async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'riftbound-live-policy-capacity-'));
  const events=()=>existsSync(path.join(directory,'events.jsonl'))?readFileSync(path.join(directory,'events.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse):[];
  const release=id=>writeFileSync(path.join(directory,`release-${id}`),'ready');
  const task=id=>({taskId:id,candidateId:id,candidatePath:path.join(directory,'candidate'),
    outputPath:path.join(directory,`${id}.json`),bank:'final-leaf-v1',maximumSteps:1,seeds:[1]});
  const base=adaptiveWorkerBudget(0,16);let active=false,bg,fg,bgWork,fgWork;
  const budget=()=>livePolicyAuditBudget(base,{active,backgroundWorkers:bg?.processCount||0});
  const options={initialProcesses:1,minimumFreeMemoryBytes:0,freeMemoryProvider:()=>32*1024**3,
    dynamicScaleIntervalMs:1000,dynamicScaleHealthySamples:1,teacherEvaluatorMode:'heuristic-only',
    workerPath:path.resolve('tests/fixtures/ai-audit-capacity-worker.mjs'),
    workerEnvironment:{RIFTBOUND_AUDIT_CAPACITY_FIXTURE:directory}};
  const until=async(fn)=>{const deadline=Date.now()+20000;while(!fn()){
    assert.ok(Date.now()<deadline,'capacity transfer timed out');
    assert.ok((bg?.processCount||0)+(fg?.processCount||0)+2<=16,'global budget exceeded');await delay(25);
  }};
  try{
    bg=await createAuditPool({...options,processes:6,dynamicProcessLimit:()=>budget().audit});
    bgWork=bg.run(Array.from({length:8},(_,i)=>task(`b${i}`)));
    await until(()=>events().filter(e=>e.taskId[0]==='b').length===6);
    active=true;
    fg=await createAuditPool({...options,processes:16,dynamicProcessLimit:()=>budget().selfplay});
    fgWork=fg.run(Array.from({length:20},(_,i)=>task(`f${i}`)));
    await until(()=>fg.processCount===8);
    assert.equal(bg.processCount,6,'active background shards must not be killed to borrow slots');
    for(let i=0;i<6;i++)release(`b${i}`);
    await until(()=>bg.processCount===0&&fg.processCount===14);
    assert.equal(events().filter(e=>e.taskId[0]==='b').length,6,'queued background work must wait');
    for(let i=0;i<20;i++)release(`f${i}`);
    assert.equal((await fgWork).length,20);await fg.close();fg=null;active=false;
    for(let i=0;i<8;i++)release(`b${i}`);
    assert.equal((await bgWork).length,8);
    assert.equal(new Set(events().map(e=>e.taskId)).size,28);
  }finally{
    for(let i=0;i<20;i++)release(`f${i}`);for(let i=0;i<8;i++)release(`b${i}`);
    await fg?.close();await bg?.close();await Promise.allSettled([bgWork,fgWork]);
    rmSync(directory,{recursive:true,force:true});
  }
});
