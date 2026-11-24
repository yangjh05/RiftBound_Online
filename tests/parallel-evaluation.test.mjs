import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PARALLEL_EVALUATION_CONTRACT,commitParallelEvaluationProtocol,parallelEvaluationBudget,
  contiguousEvaluationPrefix,runParallelEvaluationRound} from '../scripts/parallel-evaluation.mjs';
import {reserveAdaptiveEvaluation,EVALUATION_ROLLOUT_CONTRACT,BOUNDED_ROLLOUT_CONTRACT} from '../scripts/adaptive-policy-q-evaluation.mjs';
import {SEQUENTIAL_MATCH_CONTRACT,BOUNDED_MATCH_CONTRACT} from '../scripts/sequential-match-statistics.mjs';
import {createParallelEvaluationPool} from '../scripts/parallel-evaluation-pool.mjs';
import {livePolicyAuditBudget} from '../scripts/live-policy-audit-scheduler.mjs';
const protocol={contract:PARALLEL_EVALUATION_CONTRACT,afterOrdinal:75,workers:4,priority:'champion-promotion',backgroundRequests:[]};

test('parallel execution is prospective and immutable; existing reservations stay untouched',()=>{
  const state={evaluationOrdinal:75};commitParallelEvaluationProtocol(state,protocol);
  assert.throws(()=>commitParallelEvaluationProtocol(state,null),/removed/);
  assert.throws(()=>commitParallelEvaluationProtocol(state,{...protocol,afterOrdinal:74}),/changed/);
  assert.throws(()=>commitParallelEvaluationProtocol({evaluationOrdinal:76},protocol),/prospectively/);
  const reserved={ordinal:75,purpose:'tactical-baseline-progress'};
  assert.equal(reserveAdaptiveEvaluation({evaluationReservation:reserved},1,null,null,null,null,protocol),reserved);
});

test('future evaluations select the latest candidate against champion, including old baseline cadence',()=>{
  const rollout={contract:EVALUATION_ROLLOUT_CONTRACT,statisticalContract:SEQUENTIAL_MATCH_CONTRACT,
    afterOrdinal:0,maximumBlocks:500,growthMaximumBlocks:250,growthBaselinePath:'baseline',growthBaselineSha256:'a'.repeat(64)};
  const bounded={contract:BOUNDED_ROLLOUT_CONTRACT,statisticalContract:BOUNDED_MATCH_CONTRACT,afterOrdinal:0,championEvaluationsPerGrowth:4};
  const state={evaluationOrdinal:79,evaluationQueue:[],backgroundEvaluationQueue:['old-baseline'],
    pendingEvaluationCandidate:'latest-model',championPath:'champion'};
  const result=reserveAdaptiveEvaluation(state,42,rollout,null,bounded,null,protocol);
  assert.equal(result.purpose,'champion-promotion');assert.equal(result.candidatePath,'latest-model');
  assert.equal(result.incumbentPath,'champion');assert.equal(state.pendingEvaluationCandidate,null);
});

test('coordinator, compute workers, background evaluator and audit borrowing fit the cap',()=>{
  for(let maximum=1;maximum<=16;maximum++)for(let external=0;external<=maximum;external++)for(let retained=0;retained<=Math.min(1,maximum-external);retained++){
    const b=parallelEvaluationBudget(external,maximum,retained);
    const total=b.trainer+b.evaluation+b.audit+b.selfplay+external+retained;
    assert.ok(total<=maximum,JSON.stringify(b));
    for(let occupied=0;occupied<=b.audit;occupied++){
      const f=livePolicyAuditBudget(b,{active:true,backgroundWorkers:occupied});
      assert.ok(f.trainer+f.evaluation+f.audit+f.selfplay+external+retained+occupied<=maximum);
    }
    if(external){const next=parallelEvaluationBudget(external-1,maximum,retained);
      for(const k of ['trainer','evaluation','audit','selfplay'])assert.ok(next[k]>=b[k]);}
  }
  assert.deepEqual(parallelEvaluationBudget(0,16,1),{trainer:1,evaluation:5,audit:3,selfplay:6,backgroundEvaluation:1,maximum:16});
});

test('out-of-order blocks reuse partial/sparse saved games and return exactly the scheduled round',async()=>{
  const saved=Array(24);saved[0]={index:0};saved[1]={index:1};saved[9]={index:9};saved[23]={index:23};
  const before=JSON.stringify(saved),committed=[],started=[];
  assert.equal(contiguousEvaluationPrefix(saved).length,2);
  const result=await runParallelEvaluationRound({targetGames:24,savedSummaries:saved,workers:3,
    async runBlock(slot,task,emit){started.push(task.start);await delay((2-slot)*10);
      for(let i=0;i<8;i++)if(!task.resumedSummaries[i])await emit(task.start+i,{index:task.start+i});return task.start;},
    async onGameComplete(index){committed.push(index);}});
  assert.deepEqual(result,Array.from({length:24},(_,index)=>({index})));
  assert.equal(JSON.stringify(saved),before);assert.equal(committed.length,20);
  assert.ok(committed[0]>=16);assert.deepEqual(started,[0,8,16]);
  let calls=0;await runParallelEvaluationRound({targetGames:24,savedSummaries:result,workers:3,runBlock(){calls++;},onGameComplete(){throw Error('rewrite');}});
  assert.equal(calls,0);
});

test('a failed lane drains other active blocks and cannot return a successful partial round',async()=>{
  let drained=false;
  await assert.rejects(runParallelEvaluationRound({targetGames:16,savedSummaries:[],workers:2,
    async runBlock(slot,task,emit){if(slot===0)throw new Error('worker failed');await delay(15);
      for(let i=0;i<8;i++)await emit(task.start+i,{index:task.start+i});drained=true;return task.start;},onGameComplete:async()=>{}}),/worker failed/);
  assert.equal(drained,true);
});

test('saved game rewrites and off-schedule output are rejected',async()=>{
  for(const rewrite of [true,false])await assert.rejects(runParallelEvaluationRound({targetGames:8,
    savedSummaries:[{index:0}],workers:1,async runBlock(slot,task,emit){await emit(rewrite?0:8,{index:999});},onGameComplete:async()=>{}}),/rewrote|unscheduled/);
});

test('real IPC pool commits game messages before done, closes cleanly, and propagates worker errors',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'parallel-eval-'));
  const workerFile=fileURLToPath(new URL('./fixtures/parallel-evaluation-worker.mjs',import.meta.url));
  try{
    const pool=await createParallelEvaluationPool(path.join(directory,'request.json.gz'),2,{workerFile});
    try{
      const result=await runParallelEvaluationRound({targetGames:16,savedSummaries:[],workers:2,runBlock:pool.runBlock,
        onGameComplete:async()=>{await delay(2);}});
      assert.equal(result.length,16);assert.equal(new Set(result.map(s=>s.pid)).size,2);
      await assert.rejects(pool.runBlock(0,{start:-1,resumedSummaries:[]},async()=>{}),/fixture failure/);
    }finally{await pool.close();}
  }finally{await rm(directory,{recursive:true,force:true});}
});
