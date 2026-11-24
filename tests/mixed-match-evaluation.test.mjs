import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {mixedMatchPlan,prospectiveMixedMatchPlan,boundedMatchPlan,assertFrozenMatchPlan,frozenMatchExpectedGame,
  frozenMatchDecision,digest} from '../scripts/adaptive-policy-q-contract.mjs';
import {MIXED_MATCH_CONTRACT,evaluationBlock,evaluationRoundGames} from '../scripts/mixed-match-schedule.mjs';
import {evaluateMixedNeuralModels} from '../scripts/mixed-match-evaluation.mjs';
import {SEQUENTIAL_MATCH_CONTRACT,BOUNDED_MATCH_CONTRACT,sequentialBlockDecision} from '../scripts/sequential-match-statistics.mjs';
import {MIXED_ROLLOUT_CONTRACT,EVALUATION_ROLLOUT_CONTRACT,BOUNDED_ROLLOUT_CONTRACT,
  commitMixedEvaluationRollout,readMixedEvaluationRollout,reserveAdaptiveEvaluation,
  readFrozenEvaluationGames,evaluateFrozenRounds,decideFrozenEvaluation,verifyFrozenEvaluationResult} from '../scripts/adaptive-policy-q-evaluation.mjs';
import {writeTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {summarizeGames} from '../server/training-dashboard-data.mjs';
import {forecastEvaluation} from '../server/training-dashboard-forecast.mjs';

const options={candidateHash:'candidate',opponentHash:'opponent',ordinal:65,deckIds:['e','c','a','d','b'],randomSeed:126,purpose:'champion-promotion'};
const planFor=(extra={})=>mixedMatchPlan({...options,...extra});
const fixtures=(plan,count,win=(_,i)=>i%8<4)=>Array.from({length:count},(_,i)=>{
  const expected=frozenMatchExpectedGame(plan,i),won=win(expected,i);
  return {...expected,completed:true,invalid:false,adjudicated:false,counted:true,scores:won?[8,4]:[4,8],
    aiSeats:[],winnerId:`p${won?expected.candidateSeat+1:2-expected.candidateSeat}`};
});
const rollout={contract:EVALUATION_ROLLOUT_CONTRACT,statisticalContract:SEQUENTIAL_MATCH_CONTRACT,
  afterOrdinal:59,maximumBlocks:500,growthMaximumBlocks:250,growthBaselinePath:'baseline',growthBaselineSha256:'a'.repeat(64)};
const bounded={contract:BOUNDED_ROLLOUT_CONTRACT,statisticalContract:BOUNDED_MATCH_CONTRACT,afterOrdinal:59,championEvaluationsPerGrowth:4};
const mixed={contract:MIXED_ROLLOUT_CONTRACT,statisticalContract:MIXED_MATCH_CONTRACT,afterOrdinal:64,deckIds:options.deckIds};

test('mixed plans freeze all 15 pairs, balanced stopping budgets, and keep historical plans unchanged',()=>{
  const p=planFor();assertFrozenMatchPlan(p);
  assert.equal(p.matchups.length,15);assert.equal(p.matchups.filter(m=>m.kind==='cross').length,10);
  assert.equal(evaluationRoundGames(p),120);assert.equal(p.blocks*8,2400);
  assert.equal(p.promotionLooks[0]*8,480);assert.equal(p.promotionLooks.at(-1)*8,2400);
  for(const n of [840,1200,1560,2040,2400])assert.ok(p.promotionLooks.includes(n/8));
  assert.equal(planFor({purpose:'tactical-baseline-progress'}).blocks*8,840);
  const old=boundedMatchPlan(options);assert.equal(old.evaluationMode,'same-deck-mirror-v3');assertFrozenMatchPlan(old);
  for(const patch of [{alpha:.05},{minimumGroupScore:.4},{minimumBlocksPerDeck:1},{matchups:p.matchups.slice(1)},
    {blocks:500},{evaluationMode:'same-deck-mirror-v3'},{budgetPolicy:{...p.budgetPolicy,ordinaryGames:800}}]){
    assert.throws(()=>assertFrozenMatchPlan({...p,...patch}));
  }
  assert.throws(()=>planFor({deckIds:['a','b','c','d']}));
});

test('every pair balances deck ownership, seat and first player; seeds do not overlap across blocks',()=>{
  for(const seed of [0,1,2,126,0xffffffff]){
    const p=planFor({randomSeed:seed}),games=fixtures(p,2400),seeds=new Set();
    for(let start=0;start<games.length;start+=8){
      const group=games.slice(start,start+8),ids=[...new Set(group.flatMap(g=>g.deckIds))];
      assert.equal(seeds.has(group[0].gameSeed),false);assert.equal(seeds.has(group[4].gameSeed),false);
      seeds.add(group[0].gameSeed);seeds.add(group[4].gameSeed);
      for(const id of ids)for(const seat of [0,1])for(const first of [true,false]){
        assert.equal(group.filter(g=>g.deckIds[g.candidateSeat]===id && g.candidateSeat===seat
          && (g.firstPlayerId===`p${seat+1}`)===first).length,ids.length===1?2:1);
      }
    }
    for(let start=0;start<games.length;start+=120){
      assert.equal(new Set(Array.from({length:15},(_,i)=>evaluationBlock(p,games.slice(start+i*8,start+i*8+8)).deckId)).size,15);
    }
  }
});

test('both Yi lists are separate decks: all 21 pairs fit inside the existing evaluation budget',()=>{
  const p=planFor({deckIds:[...options.deckIds,'yi-no-aurora']});assertFrozenMatchPlan(p);
  assert.equal(p.matchups.length,21);assert.equal(evaluationRoundGames(p),168);
  assert.equal(p.blocks*8,2352);assert.equal(p.promotionLooks[0]*8,672);
  for(const n of [840,1176,1512,2016,2352])assert.ok(p.promotionLooks.includes(n/8));
  const saved=fixtures(p,2352),before=digest(saved);
  const result=evaluateMixedNeuralModels(null,null,p.deckIds.map(id=>({id})),{plan:p,games:2352,
    resumedSummaries:saved,onGameComplete:({resumed})=>assert.equal(resumed,true)});
  assert.equal(digest(result.summaries),before);
  const stats=summarizeGames(saved.slice(0,168));
  assert.equal(stats.groups.mirror.games,48);assert.equal(stats.groups.cross.games,120);
  assert.equal(stats.decks.length,6);assert.ok(stats.decks.every(d=>d.games===28));
  const strong=frozenMatchDecision(p,fixtures(p,2352,()=>true));
  assert.equal(strong.promoted,true);assert.equal(strong.evaluatedGames,672);
  assert.equal(frozenMatchDecision(p,saved).evaluatedGames,840);
  assert.equal(forecastEvaluation(p,saved.slice(0,840),{simulations:4}).status,'awaiting-result');
  commitMixedEvaluationRollout({evaluationOrdinal:64},{...mixed,deckIds:p.deckIds});
});

test('existing neural matrix runner reuses every scheduled mirror/cross game without a changed identity',()=>{
  for(const seed of [126,0xffffffff]){
    const p=planFor({randomSeed:seed}),saved=fixtures(p,2400),before=digest(saved),indices=[];
    const result=evaluateMixedNeuralModels(null,null,p.deckIds.map(id=>({id})),{plan:p,games:2400,
      resumedSummaries:saved,onGameComplete:({game,resumed})=>{assert.equal(resumed,true);indices.push(game);}});
    assert.equal(digest(saved),before);assert.deepEqual(result.summaries,saved);
    assert.deepEqual(indices,Array.from({length:2400},(_,i)=>i+1));
  }
});

test('a stronger deck alone gives 50% and cannot promote either model',()=>{
  const p=planFor();
  const games=fixtures(p,2400,(g,i)=>g.deckIds[0]===g.deckIds[1]?i%8<4:
    g.deckIds[g.candidateSeat]<g.deckIds[1-g.candidateSeat]);
  const d=frozenMatchDecision(p,games);
  assert.equal(d.promoted,false);assert.equal(d.score,.5);assert.equal(d.evaluatedGames,840);
  assert.equal(d.outcome,'low-promise');assert.equal(d.futility.inferiorityProven,false);
});

test('prospective deck guard compares both models on the same deck and preserves legacy rules',()=>{
  const legacy=planFor(),relative=planFor({deckRegressionMetric:'paired-model-relative-v1'});
  assert.equal(legacy.deckRegressionMetric,undefined);assertFrozenMatchPlan(relative);
  assert.notEqual(digest(relative),digest(legacy));
  assert.throws(()=>planFor({deckRegressionMetric:'arbitrary'}));
  // Deck strength alone: deck e loses every cross game on BOTH models.
  const games=fixtures(relative,480,(g,i)=>g.deckIds[0]===g.deckIds[1]?i%8<4:
    g.deckIds[g.candidateSeat]<g.deckIds[1-g.candidateSeat]);
  const d=frozenMatchDecision(relative,games);
  assert.ok(d.perDeck.e.score<.4);
  assert.equal(d.perDeck.e.score,d.perDeck.e.opponentScore);
  assert.equal(d.perDeck.e.relativeScore,.5);
  assert.equal(d.observedRegressionGuardsPassed,true);assert.equal(d.promoted,false);
  const old=frozenMatchDecision(legacy,fixtures(legacy,480,(g,i)=>g.deckIds[0]===g.deckIds[1]?i%8<4:
    g.deckIds[g.candidateSeat]<g.deckIds[1-g.candidateSeat]));
  assert.equal(old.observedRegressionGuardsPassed,false);
  // An actual same-deck regression must still fail the new guard even when
  // other strata, first-player and seat summaries pass.
  const strong=fixtures(relative,480,()=>true);
  const blocks=Array.from({length:60},(_,i)=>evaluationBlock(relative,strong.slice(i*8,i*8+8)));
  for(const b of blocks)if(b.decks.e){b.decks.e.wins=0;b.decks.e.opponentWins=b.decks.e.opponentGames;}
  assert.equal(sequentialBlockDecision(relative,blocks).observedRegressionGuardsPassed,false);
  const invalid=structuredClone(blocks);invalid.find(b=>b.decks.e).decks.e.opponentGames++;
  assert.throws(()=>sequentialBlockDecision(relative,invalid),/balanced model assignments/);
});

test('new mixed evaluations always use relative deck safety regardless of reviewer version',()=>{
  const legacy=planFor(),before=digest(legacy);
  const fresh=prospectiveMixedMatchPlan(options);
  assertFrozenMatchPlan(fresh);
  assert.equal(fresh.deckRegressionMetric,'paired-model-relative-v1');
  for(const runtimeContract of [null,'bounded-public-runtime-review-v2','bounded-public-runtime-review-v3',
    'bounded-public-runtime-review-v4','bounded-public-runtime-review-v5','future-review-version']) {
    assert.deepEqual(prospectiveMixedMatchPlan({...options,decisionReview:runtimeContract?{runtimeContract}:null}),fresh);
  }
  assert.throws(()=>prospectiveMixedMatchPlan({...options,deckRegressionMetric:'absolute-score'}));
  assert.equal(digest(legacy),before);assert.equal(legacy.deckRegressionMetric,undefined);
  assertFrozenMatchPlan(legacy);
  for(const [candidateWeakWins,opponentWeakWins,passes] of [[1,1,true],[1,0,true],[0,4,false]]) {
    const strong=fixtures(fresh,480,()=>true);
    const blocks=Array.from({length:60},(_,i)=>evaluationBlock(fresh,strong.slice(i*8,i*8+8)));
    for(const block of blocks)if(block.decks.e){
      const d=block.decks.e;
      d.wins=d.games*candidateWeakWins/4;
      d.opponentWins=d.opponentGames*opponentWeakWins/4;
    }
    const result=sequentialBlockDecision(fresh,blocks);
    assert.equal(result.observedRegressionGuardsPassed,passes);
    if(!passes)assert.equal(result.promoted,false);
  }
});

test('mirror gains cannot hide cross-deck regression, and cross gains cannot hide mirror regression',()=>{
  const p=planFor();
  for(const weak of ['mirror','cross']){
    const games=fixtures(p,2400,(g,i)=>{
      const kind=g.deckIds[0]===g.deckIds[1]?'mirror':'cross';
      return i%8<(kind===weak ? (Math.floor(i/120)%2?4:3) : 8);
    });
    const d=frozenMatchDecision(p,games);
    assert.ok(d.score>.52);assert.equal(d.promoted,false);assert.equal(d.observedRegressionGuardsPassed,false);
    assert.ok(d.perGroup[weak].score<.5);
    assert.ok(Object.values(d.perMatchup).every(x=>x.score>=.4));
  }
});

test('decisions wait for full rounds, apply per-deck/seat/first guards, and replay the first stop',()=>{
  const p=planFor(),strong=fixtures(p,2400,()=>true);
  assert.equal(frozenMatchDecision(p,strong.slice(0,479)).stopped,false);
  const passed=frozenMatchDecision(p,strong);assert.equal(passed.promoted,true);assert.equal(passed.evaluatedGames,480);
  assert.deepEqual(frozenMatchDecision(p,strong.slice(0,480)),{...passed,observedGames:480});
  const neutral=fixtures(p,840),later=fixtures(p,2400,()=>true);
  later.splice(0,840,...neutral);assert.equal(frozenMatchDecision(p,later).evaluatedGames,840);
  const blocks=Array.from({length:300},(_,i)=>evaluationBlock(p,strong.slice(i*8,i*8+8)));
  for(const field of ['seats','first']){
    const fail=structuredClone(blocks);fail.forEach(b=>b[field]=[.3,1]);
    assert.equal(sequentialBlockDecision(p,fail).promoted,false);
  }
  assert.throws(()=>frozenMatchDecision(p,[...strong.slice(1,481)]),/identity/);
  const invalid=strong.slice(0,480);invalid[10]={...invalid[10],invalid:true};
  assert.equal(frozenMatchDecision(p,invalid).outcome,'invalid-or-unfinished-evaluation');
  const growth=planFor({purpose:'tactical-baseline-progress'});
  const d=decideFrozenEvaluation({plan:growth,purpose:growth.purpose},fixtures(growth,480,()=>true));
  assert.equal(d.superior,true);assert.equal(d.promoted,false);
  assert.throws(()=>decideFrozenEvaluation({plan:p,purpose:'tactical-baseline-progress'},strong),/purpose/);
});

test('prospective rollout preserves current requests and reservations and rejects retroactive changes',async()=>{
  const state={evaluationOrdinal:64,evaluationQueue:['active'],pendingEvaluationCandidate:'next',championPath:'champion'};
  commitMixedEvaluationRollout(state,mixed);
  assert.equal(reserveAdaptiveEvaluation(state,51,rollout,null,bounded,mixed),null);
  state.evaluationQueue=[];
  const reservation=reserveAdaptiveEvaluation(state,51,rollout,null,bounded,mixed);
  assert.equal(reservation.ordinal,65);assert.equal(reservation.mixed.afterOrdinal,64);
  assert.deepEqual(reserveAdaptiveEvaluation(state,89,rollout,null,bounded,null),reservation);
  assert.throws(()=>commitMixedEvaluationRollout(state,{...mixed,afterOrdinal:65}),/changed/);
  assert.throws(()=>commitMixedEvaluationRollout(state,null),/removed/);
  assert.throws(()=>commitMixedEvaluationRollout({evaluationOrdinal:65},mixed),/prospectively/);
  const oldState={evaluationOrdinal:63,evaluationQueue:[],pendingEvaluationCandidate:'old',championPath:'champion'};
  const old=reserveAdaptiveEvaluation(oldState,10,rollout,null,bounded);
  assert.equal(reserveAdaptiveEvaluation(oldState,20,rollout,null,bounded,mixed),old);assert.equal(old.mixed,undefined);
  const dir=await mkdtemp(path.join(tmpdir(),'mixed-eval-protocol-'));
  try{assert.equal(await readMixedEvaluationRollout(dir),null);
    await writeFile(path.join(dir,'mixed-evaluation-protocol.json'),JSON.stringify(mixed));
    assert.deepEqual(await readMixedEvaluationRollout(dir),mixed);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('partial saved cross round resumes its prefix and verifies the persisted decision',async()=>{
  const plan=planFor(),request={plan,purpose:plan.purpose},all=fixtures(plan,2400,()=>true),targets=[];
  const result=await evaluateFrozenRounds(request,all.slice(0,127),async({targetGames,resumedSummaries})=>{
    targets.push(targetGames);assert.deepEqual(resumedSummaries,all.slice(0,resumedSummaries.length));
    return all.slice(0,targetGames);
  });
  assert.deepEqual(targets,[240,360,480]);assert.equal(result.decision.promoted,true);
  const dir=await mkdtemp(path.join(tmpdir(),'mixed-eval-result-'));
  try{
    const file=path.join(dir,'request.json.gz');await mkdir(path.join(dir,'games'));
    await writeTrajectoryArchive(file,request);
    result.summaries.forEach(g=>g.evaluationRequestHash=digest(request));
    await Promise.all(result.summaries.map((g,i)=>writeFile(path.join(dir,'games',`${i}.json`),JSON.stringify(g))));
    await writeTrajectoryArchive(path.join(dir,'result.json.gz'),{plan,decision:result.decision,summaryDigest:digest(result.summaries)});
    assert.equal((await verifyFrozenEvaluationResult(file)).result.decision.promoted,true);
    const bad={...result.summaries[11],deckIds:['a','a']};
    await writeFile(path.join(dir,'games','11.json'),JSON.stringify(bad));
    await assert.rejects(readFrozenEvaluationGames(file,request),/identity/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('dashboard separates cross/mirror data and forecasts keep complete matchup rounds',()=>{
  const p=planFor(),games=fixtures(p,600),stats=summarizeGames(games);
  assert.equal(stats.groups.mirror.games,200);assert.equal(stats.groups.cross.games,400);
  assert.equal(stats.matchups.length,15);assert.equal(stats.decks.length,5);
  assert.ok(stats.decks.every(d=>d.games===120));
  const forecast=forecastEvaluation(p,games,{simulations:4});
  assert.equal(forecast.method,'matchup-stratified-eight-game-bayesian-bootstrap');
  assert.equal(forecast.targetGames,840);assert.equal(forecast.passedPaths,0);
});
