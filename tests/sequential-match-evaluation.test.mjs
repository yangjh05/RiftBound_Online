import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {sequentialMatchPlan, frozenMatchExpectedGame, frozenMatchDecision, assertFrozenMatchPlan, digest}
  from '../scripts/adaptive-policy-q-contract.mjs';
import {BET_FRACTIONS, bettingLogEvidence, bettingMeanBounds, sequentialBlockDecision, SEQUENTIAL_MATCH_CONTRACT,NEUTRAL_FUTILITY_POLICY}
  from '../scripts/sequential-match-statistics.mjs';
import {decideFrozenEvaluation, evaluateFrozenRounds, reserveAdaptiveEvaluation, verifyFrozenEvaluationResult,
  EVALUATION_ROLLOUT_CONTRACT,readEvaluationRollout} from '../scripts/adaptive-policy-q-evaluation.mjs';
import {writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {evaluateNeuralModels} from '../src/ai/neural/selfplay.mjs';

const makePlan = (overrides = {}) => sequentialMatchPlan({candidateHash:'new', opponentHash:'old', ordinal:9,
  deckIds:['a','b','c','d','e'], maximumBlocks:500, randomSeed:41, ...overrides});
const fixture = (plan, count = plan.blocks * 8, wins = () => 5) => Array.from({length:count}, (_, i) => {
  const schedule = frozenMatchExpectedGame(plan, i), win = i % 8 < wins(Math.floor(i / 8), schedule.deckIds[0]);
  return {...schedule, completed:true, invalid:false, adjudicated:false,
    winnerId:`p${win ? schedule.candidateSeat + 1 : 2 - schedule.candidateSeat}`};
});
const requestFor = (plan, purpose='champion-promotion') => ({plan, purpose, candidatePath:'candidate',
  opponentPath:'opponent', incumbentPath:'old'});

test('new plans freeze bets, balanced looks, minimum coverage and alpha without resetting candidate spending', () => {
  const plan = makePlan({maximumBlocks:128});
  assert.equal(plan.blocks,130);
  assert.equal(plan.promotionLooks[0],40);
  assert.equal(plan.promotionLooks.at(-1),130);
  assert.equal(plan.alpha,0.05/(9*10));
  assertFrozenMatchPlan(plan);
  for (const patch of [{alpha:0.05},{betFractions:[0.95]},{minimumBlocksPerDeck:1},
    {promotionLooks:[1]},{minimumObservedWinRate:0.5},{regressionFloor:0.1},{version:1}]) {
    assert.throws(()=>assertFrozenMatchPlan({...plan,...patch}),/commitment/);
  }
});

test('equal means with lower observed variability give more evidence', () => {
  const low = Array(100).fill(0.6), high = [...Array(60).fill(1),...Array(40).fill(0)];
  assert.ok(bettingLogEvidence(low) > bettingLogEvidence(high) + 5);
  const stable = bettingMeanBounds(low,0.001), variable = bettingMeanBounds(high,0.001);
  assert.ok(stable.lowerBound > variable.lowerBound);
  assert.ok(stable.lowerBound > 0.5);
  assert.ok(stable.lowerBound <= 0.6 && stable.upperBound >= 0.6);
  assert.throws(()=>bettingLogEvidence([NaN]),/Invalid/);
  assert.throws(()=>bettingMeanBounds([0.5],0),/budget/);
});

test('balanced strata have expected capital at most one even with unequal deck strengths', () => {
  // Exact enumeration of one balanced null round. A block can be entirely
  // correlated (all eight mirrors win or lose); it still counts only once.
  for (const means of [[0.8,0.7,0.5,0.3,0.2],[1,1,0.5,0,0],[0.5,0.5,0.5,0.5,0.5]]) {
    for (const c of BET_FRACTIONS) {
      let expected=0;
      for(let mask=0;mask<32;mask++) {
        let probability=1,capital=1;
        for(let d=0;d<5;d++) {const x=(mask>>d)&1;probability*=x?means[d]:1-means[d];capital*=1+c*(x/0.5-1);}
        expected+=probability*capital;
      }
      assert.ok(expected<=1+1e-12);
    }
  }
});

test('repeated-look null simulation does not mistake mirrors for independent evidence', () => {
  let state=923741;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const means=[0.8,0.7,0.5,0.3,0.2], runs=2000, threshold=Math.log(20);
  let falsePasses=0;
  for(let run=0;run<runs;run++) {
    const logs=BET_FRACTIONS.map(()=>0);
    for(let round=0;round<40;round++) {
      for(let d=0;d<5;d++) {
        const x=Number(random()<means[d]);
        BET_FRACTIONS.forEach((c,k)=>{logs[k]+=Math.log1p(c*(2*x-1));});
      }
      const max=Math.max(...logs), evidence=max+Math.log(logs.reduce((s,x)=>s+Math.exp(x-max),0)/logs.length);
      if(evidence>=threshold){falsePasses++;break;}
    }
  }
  assert.ok(falsePasses/runs<0.075,`False pass rate ${falsePasses/runs}`);
});

test('consistent 62.5 percent wins can stop early while neutral evidence waits for its cap', () => {
  const plan=makePlan(), games=fixture(plan);
  const result=frozenMatchDecision(plan,games);
  assert.equal(result.promoted,true);
  assert.ok(result.evaluatedGames>=320 && result.evaluatedGames<1024);
  assert.ok(result.lowerBound>0.5);
  assert.equal(result.score,0.625);
  const exact=frozenMatchDecision(plan,games.slice(0,result.evaluatedGames));
  assert.equal(exact.evaluatedGames,result.evaluatedGames);
  assert.equal(frozenMatchDecision(plan,games.slice(0,319)).stopped,false);
  const neutral=frozenMatchDecision(plan,fixture(plan,400,()=>4));
  assert.equal(neutral.outcome,'running');
  assert.equal(frozenMatchDecision(plan,fixture(plan,plan.blocks*8,()=>4)).outcome,'inconclusive');
  assert.equal(frozenMatchDecision(plan,fixture(plan,plan.blocks*8,()=>2)).outcome,'inferior');
});

test('prospective low-promise rule saves neutral evaluation budget without a false inferiority claim',()=>{
 const plan=makePlan({futilityPolicy:NEUTRAL_FUTILITY_POLICY});
 assertFrozenMatchPlan(plan);
 const neutral=fixture(plan,4000,()=>4);
 assert.equal(frozenMatchDecision(plan,neutral.slice(0,800)).outcome,'running');
 assert.equal(frozenMatchDecision(plan,neutral.slice(0,1199)).outcome,'running');
 const stopped=frozenMatchDecision(plan,neutral);
 assert.equal(stopped.outcome,'low-promise');assert.equal(stopped.evaluatedGames,1200);
 assert.equal(stopped.promoted,false);assert.equal(stopped.futility.inferiorityProven,false);
 assert.deepEqual(stopped.futility.checks.map(c=>c.games),[800,1200]);
 assert.equal(frozenMatchDecision(plan,neutral.slice(0,1200)).outcome,'low-promise');
 assert.equal(frozenMatchDecision(makePlan(),neutral).outcome,'inconclusive','older plans retain their cap');
 assert.throws(()=>assertFrozenMatchPlan({...plan,futilityPolicy:{...NEUTRAL_FUTILITY_POLICY,minimumGames:320}}),/futility commitment/);
 assert.equal(frozenMatchDecision(plan,fixture(plan)).promoted,true);
});

test('a recovering recent window is not discarded because of its slow start',()=>{
 const plan=makePlan({futilityPolicy:NEUTRAL_FUTILITY_POLICY});
 const games=fixture(plan,1200,b=>b>=100 && b%5===0?5:4);
 assert.equal(frozenMatchDecision(plan,games).outcome,'running');
});

test('futility attaches only to a new reservation after its precommitted ordinal',()=>{
 const protocol={contract:EVALUATION_ROLLOUT_CONTRACT,statisticalContract:SEQUENTIAL_MATCH_CONTRACT,
   afterOrdinal:8,maximumBlocks:500,growthMaximumBlocks:250,growthBaselinePath:'baseline',growthBaselineSha256:'a'.repeat(64)};
 const efficiency={contract:'prospective-evaluation-efficiency-v1',afterOrdinal:9,futilityPolicy:NEUTRAL_FUTILITY_POLICY};
 const state={evaluationOrdinal:8,evaluationQueue:[],pendingEvaluationCandidate:'candidate',championPath:'old'};
 const old=reserveAdaptiveEvaluation(state,41,protocol,efficiency);
 assert.equal(old.ordinal,9);assert.equal(old.efficiency,undefined);
 assert.equal(reserveAdaptiveEvaluation(state,42,protocol,efficiency),old);
 state.evaluationReservation=null;state.pendingEvaluationCandidate='next';
 const next=reserveAdaptiveEvaluation(state,43,protocol,efficiency);
 assert.deepEqual(next.efficiency,efficiency);
 assert.notEqual(next.efficiency,efficiency);
});

test('large global wins do not waive deck or seat regression guards', () => {
  const plan=makePlan({maximumBlocks:100});
  const collapsed=frozenMatchDecision(plan,fixture(plan,800,(_,id)=>id==='a'?0:8));
  assert.equal(collapsed.promoted,false);
  assert.equal(collapsed.observedRegressionGuardsPassed,false);
  const games=fixture(plan,800);
  // Candidate p1 wins all four; p2 only one => one seat is 25 percent.
  games.forEach((s,i)=>{const win=s.candidateSeat===0 || i%8===1;s.winnerId=`p${win?s.candidateSeat+1:2-s.candidateSeat}`;});
  assert.equal(frozenMatchDecision(plan,games).promoted,false);
});

test('unbalanced rounds, sparse prefixes, wrong identities and invalid games fail closed', () => {
  const plan=makePlan(),games=fixture(plan,320);
  const bad=[...games];delete bad[2];
  assert.throws(()=>frozenMatchDecision(plan,bad),/identity/);
  assert.throws(()=>frozenMatchDecision(plan,games.slice(1)),/identity/);
  const altered=structuredClone(games);altered[8].gameSeed=altered[0].gameSeed;
  assert.throws(()=>frozenMatchDecision(plan,altered),/identity/);
  const invalid=structuredClone(games);invalid[0].invalid=true;
  assert.equal(frozenMatchDecision(plan,invalid).outcome,'invalid-or-unfinished-evaluation');
  assert.throws(()=>sequentialBlockDecision(plan,Array(5).fill({deckId:'a',score:1,seats:[1,1]})),/balanced/);
});

test('engine rounds resume the exact prefix and stop without scheduling the remaining cap', async () => {
  const plan=makePlan(), request=requestFor(plan), all=fixture(plan), calls=[];
  const saved=all.slice(0,53);
  const result=await evaluateFrozenRounds(request,saved,({targetGames,resumedSummaries})=>{
    calls.push({targetGames,resumed:resumedSummaries.length});return all.slice(0,targetGames);
  });
  assert.deepEqual(calls[0],{targetGames:80,resumed:53});
  assert.equal(result.decision.promoted,true);
  assert.equal(result.summaries.length,result.decision.evaluatedGames);
  const repeated=await evaluateFrozenRounds(request,result.summaries,()=>{throw new Error('Must not rerun a stopped evaluation');});
  assert.deepEqual(repeated,result);
  await assert.rejects(evaluateFrozenRounds(request,saved,({targetGames})=>{
    const changed=structuredClone(all.slice(0,targetGames));changed[0].winnerId='p2';return changed;
  }),/rewrote/);
});

test('the actual engine evaluation adapter preserves replayed summary bytes across rounds', async () => {
  const plan=makePlan({maximumBlocks:40}),request=requestFor(plan);
  const cached=fixture(plan).map(s=>({...s,scores:[8,5],actions:100,aiSeats:[{role:'candidate'},{role:'champion'}]}));
  let callbacks=0;
  const result=await evaluateFrozenRounds(request,cached.slice(0,53),({targetGames})=>{
    // Synthetic fixtures exercise the production replay adapter only. Every
    // game must be reused; no model or old real match is passed to this test.
    return evaluateNeuralModels(null,null,plan.deckIds.map(id=>({id})),{
      games:targetGames,seed:plan.seed,evaluationMode:plan.evaluationMode,resumedSummaries:cached,
      onGameComplete:({resumed})=>{assert.equal(resumed,true);callbacks++;}
    }).summaries;
  });
  assert.ok(callbacks>320);
  assert.deepEqual(result.summaries,cached);
});

test('growth comparisons alternate in the same lane and can never promote a champion', () => {
  const protocol={contract:EVALUATION_ROLLOUT_CONTRACT,statisticalContract:SEQUENTIAL_MATCH_CONTRACT,
    afterOrdinal:8,maximumBlocks:500,growthMaximumBlocks:250,growthBaselinePath:'baseline',growthBaselineSha256:'a'.repeat(64)};
  const state={evaluationQueue:[],evaluationOrdinal:8,pendingEvaluationCandidate:'latest',championPath:'champion'};
  const first=reserveAdaptiveEvaluation(state,1,protocol);
  assert.equal(first.ordinal,9);assert.equal(first.purpose,'champion-promotion');
  assert.deepEqual(reserveAdaptiveEvaluation(state,2,protocol),first);
  state.evaluationReservation=null;state.pendingEvaluationCandidate='newer';
  const second=reserveAdaptiveEvaluation(state,3,protocol);
  assert.equal(second.ordinal,10);assert.equal(second.incumbentPath,'baseline');
  const plan=makePlan();const decision=decideFrozenEvaluation(requestFor(plan,'tactical-baseline-progress'),fixture(plan));
  assert.equal(decision.superior,true);assert.equal(decision.promoted,false);
  assert.throws(()=>decideFrozenEvaluation(requestFor(plan,'unknown'),fixture(plan)),/purpose/);
});

test('rollout configuration is ordinary JSON and malformed configurations fail closed', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'riftbound-rollout-json-'));
  try {
    assert.equal(await readEvaluationRollout(root),null);
    const protocol={contract:EVALUATION_ROLLOUT_CONTRACT,statisticalContract:SEQUENTIAL_MATCH_CONTRACT,
      afterOrdinal:8,maximumBlocks:500,growthMaximumBlocks:250,growthBaselinePath:'baseline',growthBaselineSha256:'a'.repeat(64)};
    await writeFile(path.join(root,'evaluation-protocol.json'),'\uFEFF'+JSON.stringify(protocol));
    assert.deepEqual(await readEvaluationRollout(root),protocol);
    await writeFile(path.join(root,'evaluation-protocol.json'),'{}');
    await assert.rejects(readEvaluationRollout(root),/rollout/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('saved sequential results are reconstructed from their partial completed prefix', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'riftbound-sequential-'));
  try {
    const request=requestFor(makePlan()), all=fixture(request.plan);
    const first=decideFrozenEvaluation(request,all), games=all.slice(0,first.evaluatedGames);
    games.forEach(s=>{s.evaluationRequestHash=digest(request);});
    const decision=decideFrozenEvaluation(request,games),file=path.join(root,'request.json.gz');
    await mkdir(path.join(root,'games'));
    await writeTrajectoryArchive(file,request);
    await Promise.all(games.map((s,i)=>writeFile(path.join(root,'games',`${i}.json`),JSON.stringify(s))));
    const payload={plan:request.plan,decision,summaryDigest:digest(games)};
    await writeTrajectoryArchive(path.join(root,'result.json.gz'),payload);
    assert.equal((await verifyFrozenEvaluationResult(file)).result.decision.promoted,true);
    await writeTrajectoryArchive(path.join(root,'result.json.gz'),{...payload,decision:{...decision,lowerBound:0.99}});
    await assert.rejects(verifyFrozenEvaluationResult(file),/disagrees/);
  } finally {await rm(root,{recursive:true,force:true});}
});
