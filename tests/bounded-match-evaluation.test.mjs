import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {boundedMatchPlan, sequentialMatchPlan, assertFrozenMatchPlan, frozenMatchExpectedGame,
  frozenMatchDecision, digest} from '../scripts/adaptive-policy-q-contract.mjs';
import {BOUNDED_MATCH_CONTRACT, SEQUENTIAL_MATCH_CONTRACT, sequentialBlockDecision}
  from '../scripts/sequential-match-statistics.mjs';
import {BOUNDED_ROLLOUT_CONTRACT, EVALUATION_ROLLOUT_CONTRACT, readBoundedEvaluationRollout,
  commitBoundedEvaluationRollout, reserveAdaptiveEvaluation, evaluateFrozenRounds, decideFrozenEvaluation,
  closeFrozenEvaluationForBudget, verifyFrozenEvaluationResult} from '../scripts/adaptive-policy-q-evaluation.mjs';
import {writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {withFileLock} from '../scripts/file-lock.mjs';

const options={candidateHash:'candidate',opponentHash:'champion',ordinal:23,deckIds:['a','b','c','d','e'],
  randomSeed:918,purpose:'champion-promotion'};
const planFor=(overrides={})=>boundedMatchPlan({...options,...overrides});
const rollout={contract:EVALUATION_ROLLOUT_CONTRACT,statisticalContract:SEQUENTIAL_MATCH_CONTRACT,
  afterOrdinal:17,maximumBlocks:500,growthMaximumBlocks:250,growthBaselinePath:'baseline',growthBaselineSha256:'a'.repeat(64)};
const bounded={contract:BOUNDED_ROLLOUT_CONTRACT,statisticalContract:BOUNDED_MATCH_CONTRACT,afterOrdinal:22,championEvaluationsPerGrowth:4};
const fixture=(plan,count,wins=()=>4)=>Array.from({length:count},(_,i)=>{
  const schedule=frozenMatchExpectedGame(plan,i),win=i%8<wins(Math.floor(i/8),schedule.deckIds[0]);
  return {...schedule,completed:true,invalid:false,adjudicated:false,winnerId:`p${win?schedule.candidateSeat+1:2-schedule.candidateSeat}`};
});
const requestFor=plan=>({plan,purpose:plan.purpose||'champion-promotion',candidatePath:'candidate',opponentPath:'opponent'});
const blocksFor=(plan,count,score)=>Array.from({length:count},(_,i)=>({deckId:plan.deckIds[i%5],
  score:typeof score==='function'?score(i):score,seats:[0.55,0.55]}));

test('new commitments freeze budgets and per-comparison alpha without changing historical plans',()=>{
  const plan=planFor();assertFrozenMatchPlan(plan);
  assert.equal(plan.blocks*8,2400);assert.equal(plan.alpha,0.02);
  assert.equal(plan.promotionLooks[0]*8,400);
  assert.equal(plan.promotionLooks.at(-1)*8,2400);
  assert.equal(planFor({ordinal:500}).alpha,plan.alpha);
  const old=sequentialMatchPlan({...options,maximumBlocks:500});
  assert.equal(old.alpha,0.05/(23*24));assertFrozenMatchPlan(old);
  for(const patch of [{alpha:0.05},{blocks:500},{errorControl:'familywise'},
    {minimumBlocksPerDeck:1},{budgetPolicy:{...plan.budgetPolicy,ordinaryGames:400}},
    {purpose:'tactical-baseline-progress'},{futilityPolicy:{}}]){
    assert.throws(()=>assertFrozenMatchPlan({...plan,...patch}));
  }
  assert.throws(()=>planFor({deckIds:['a','b','c']}),/balance/);
  assert.throws(()=>planFor({deckIds:Array.from({length:10},(_,i)=>String(i))}),/balance/);
});

test('neutral candidates stop at 800, weak candidates at 1200, recovering candidates are not cut at 800',()=>{
  const p=planFor(),neutral=fixture(p,2400);
  assert.equal(frozenMatchDecision(p,neutral.slice(0,799)).stopped,false);
  const d=frozenMatchDecision(p,neutral);assert.equal(d.evaluatedGames,800);
  assert.equal(d.outcome,'low-promise');assert.equal(d.futility.inferiorityProven,false);
  const weak=fixture(p,2400,b=>b%10===0?5:4);
  assert.equal(frozenMatchDecision(p,weak).evaluatedGames,1200);
  const recovering=fixture(p,800,b=>b%10===0?(b<50?3:5):4);
  assert.equal(frozenMatchDecision(p,recovering).stopped,false);
});

test('ordinary budget stops unproven candidates despite modest global advantage',()=>{
  const p=planFor(),blocks=blocksFor(p,300,i=>0.55+(i%2?0.25:-0.25));
  const d=sequentialBlockDecision(p,blocks);
  assert.equal(d.evaluatedGames,1600);assert.equal(d.outcome,'low-promise');
  assert.equal(d.futility.reason,'extension-not-justified');assert.equal(d.promoted,false);
});

test('only evidence close to promotion earns extensions and stopping replays exactly',()=>{
  const p=planFor(),blocks=blocksFor(p,300,i=>0.55+(i%2?0.24:-0.24));
  assert.equal(sequentialBlockDecision(p,blocks.slice(0,200)).outcome,'running');
  assert.equal(sequentialBlockDecision(p,blocks.slice(0,250)).outcome,'running');
  const d=sequentialBlockDecision(p,blocks);
  assert.equal(d.promoted,true);assert.equal(d.evaluatedGames,2080);
  const faded=[...blocks.slice(0,200),...blocksFor(p,100,0.5)];
  assert.equal(sequentialBlockDecision(p,faded).evaluatedGames,2000);
  assert.equal(sequentialBlockDecision(p,faded).outcome,'low-promise');
  const capped=[...blocks.slice(0,250),...blocksFor(p,50,0.5)];
  const atCap=sequentialBlockDecision(p,capped);
  assert.equal(atCap.evaluatedGames,2400);assert.equal(atCap.outcome,'inconclusive');
  const stopped=frozenMatchDecision(p,fixture(p,800));
  const recovered=[...fixture(p,800),...fixture(p,2400,()=>8).slice(800)];
  assert.equal(frozenMatchDecision(p,recovered).evaluatedGames,stopped.evaluatedGames);
  assert.equal(frozenMatchDecision(p,recovered).promoted,false);
});

test('small observed advantages and failing deck or seat guards cannot earn an extension',()=>{
  const p=planFor();
  const low=blocksFor(p,200,i=>0.535+(i%2?0.19:-0.19));
  const d=sequentialBlockDecision(p,low);
  assert.equal(d.evaluatedGames,1600);assert.equal(d.promoted,false);
  const badDeck=fixture(p,2400,(_,id)=>id==='a'?0:8);
  assert.equal(frozenMatchDecision(p,badDeck).promoted,false);
  assert.equal(frozenMatchDecision(p,badDeck).evaluatedGames,1600);
  const badSeat=fixture(p,2400,()=>8);
  badSeat.forEach(s=>{if(s.candidateSeat===1)s.winnerId='p1';});
  assert.equal(frozenMatchDecision(p,badSeat).promoted,false);
});

test('strong candidates can pass at 400; baseline comparisons cap at 800 and cannot promote',()=>{
  const p=planFor();assert.equal(frozenMatchDecision(p,fixture(p,399,()=>7)).promoted,false);
  assert.equal(frozenMatchDecision(p,fixture(p,400,()=>7)).promoted,true);
  const growth=planFor({purpose:'tactical-baseline-progress'}),request=requestFor(growth);
  assert.equal(growth.blocks*8,800);
  const d=decideFrozenEvaluation(request,fixture(growth,800,()=>7));
  assert.equal(d.superior,true);assert.equal(d.promoted,false);
  assert.equal(decideFrozenEvaluation(request,fixture(growth,800)).outcome,'inconclusive');
  assert.throws(()=>decideFrozenEvaluation({...request,purpose:'champion-promotion'},[]),/purpose/);
});

test('round execution stops at the new budget and resumes partial prefixes without new games after closure',async()=>{
  const p=planFor(),all=fixture(p,2400),calls=[];
  const r=await evaluateFrozenRounds(requestFor(p),all.slice(0,53),({targetGames,resumedSummaries})=>{
    calls.push([resumedSummaries.length,targetGames]);return all.slice(0,targetGames);
  });
  assert.deepEqual(calls[0],[53,80]);assert.equal(r.summaries.length,800);
  assert.equal(calls.at(-1)[1],800);
  assert.deepEqual(await evaluateFrozenRounds(requestFor(p),r.summaries,()=>assert.fail('rerun')),r);
});

test('latest pending candidate gets four champion comparisons per baseline; reservations survive crashes',()=>{
  const state={evaluationOrdinal:21,evaluationQueue:[],pendingEvaluationCandidate:'old',championPath:'champion'};
  const old=reserveAdaptiveEvaluation(state,1,rollout,null,bounded);
  assert.equal(old.bounded,undefined);
  assert.equal(reserveAdaptiveEvaluation(state,2,rollout,null,bounded),old);
  for(let i=1;i<=6;i++){
    state.evaluationReservation=null;state.pendingEvaluationCandidate=`latest-${i}`;
    const r=reserveAdaptiveEvaluation(state,100+i,rollout,null,bounded);
    assert.equal(r.ordinal,22+i);assert.equal(r.candidatePath,`latest-${i}`);
    assert.equal(r.purpose,i===5?'tactical-baseline-progress':'champion-promotion');
    assert.equal(r.incumbentPath,i===5?'baseline':'champion');
    assert.equal(r.efficiency,undefined);assert.deepEqual(r.bounded,bounded);
    state.pendingEvaluationCandidate='arrived-after-reservation';
    assert.deepEqual(reserveAdaptiveEvaluation(state,999,rollout,null,bounded),r);
    assert.equal(state.pendingEvaluationCandidate,'arrived-after-reservation');
  }
});

test('rollout hash and saved JSON fail closed if removed or edited',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'bounded-rollout-'));
  try{
    assert.equal(await readBoundedEvaluationRollout(root),null);
    await writeFile(path.join(root,'bounded-evaluation-protocol.json'),'\uFEFF'+JSON.stringify(bounded));
    const loaded=await readBoundedEvaluationRollout(root),state={};
    commitBoundedEvaluationRollout(state,loaded);assert.equal(state.boundedEvaluationProtocolHash,digest(bounded));
    assert.throws(()=>commitBoundedEvaluationRollout(state,null),/removed/);
    assert.throws(()=>commitBoundedEvaluationRollout(state,{...loaded,afterOrdinal:23}),/changed/);
    await writeFile(path.join(root,'bounded-evaluation-protocol.json'),'{}');
    await assert.rejects(readBoundedEvaluationRollout(root),/rollout/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('administrative closure preserves original evidence and cannot fabricate a statistical result',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'bounded-closure-'));
  try{
    const p=sequentialMatchPlan({...options,maximumBlocks:500}),request=requestFor(p),games=fixture(p,413);
    games.forEach(s=>s.evaluationRequestHash=digest(request));
    const requestFile=path.join(root,'request.json.gz'),output=path.join(root,'result.json.gz');
    await mkdir(path.join(root,'games'));await writeTrajectoryArchive(requestFile,request);
    await Promise.all(games.map((s,i)=>writeFile(path.join(root,'games',`${i}.json`),JSON.stringify(s))));
    const bytes=await readFile(requestFile),before=decideFrozenEvaluation(request,games);
    await withFileLock(path.join(root,'evaluation.lock'),async()=>{
      await assert.rejects(closeFrozenEvaluationForBudget(requestFile,'Stop old evaluation'),/Timed out/);
    });
    const result=await closeFrozenEvaluationForBudget(requestFile,'User-authorized evaluation budget change');
    assert.deepEqual(await readFile(requestFile),bytes);
    assert.deepEqual(result.statisticalDecision,before);assert.equal(before.outcome,'running');
    assert.equal(result.decision.outcome,'budget-closed-unproven');assert.equal(result.decision.savedGames,413);
    assert.equal(result.decision.promoted,false);assert.equal(result.decision.inferiorityProven,false);
    assert.deepEqual((await verifyFrozenEvaluationResult(requestFile)).result,result);
    assert.deepEqual(await closeFrozenEvaluationForBudget(requestFile,'retry'),result);
    await writeTrajectoryArchive(output,{...result,decision:{...result.decision,promoted:true}});
    await assert.rejects(verifyFrozenEvaluationResult(requestFile),/disagrees/);
    await writeTrajectoryArchive(output,{...result,operationalStop:{...result.operationalStop,requestHash:'wrong'}});
    await assert.rejects(verifyFrozenEvaluationResult(requestFile),/Invalid operational/);
    await writeTrajectoryArchive(output,{...result,statisticalDecision:{...before,lowerBound:1}});
    await assert.rejects(verifyFrozenEvaluationResult(requestFile),/statistical evidence/);
    await writeTrajectoryArchive(output,result);
    await writeFile(path.join(root,'games','413.json'),JSON.stringify({...fixture(p,414)[413],evaluationRequestHash:digest(request)}));
    await assert.rejects(verifyFrozenEvaluationResult(requestFile));
  }finally{await rm(root,{recursive:true,force:true});}
});
