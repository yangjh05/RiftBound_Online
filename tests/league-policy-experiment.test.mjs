import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {LEAGUE_COLLECTION,leagueGameAssignment,attestLeagueGame} from '../scripts/league-selfplay-contract.mjs';
import {assertAdaptiveGame} from '../scripts/adaptive-policy-q-evidence.mjs';
import {collectAdaptiveSelfPlay} from '../scripts/adaptive-selfplay-collection.mjs';
import {selfPlayTaskOptions} from '../scripts/ai-selfplay-task-options.mjs';
import {STATE_DIM,ACTION_DIM} from '../src/ai/neural/encoding.mjs';
import {readTrajectoryArchive} from '../src/ai/neural/archive.mjs';
import {LEAGUE_EXPERIMENT,leagueExperimentPlan,leagueEvaluationJobs,summarizeLeagueExperiment} from '../scripts/league-policy-experiment.mjs';
import {authoredTrainingDecks} from '../scripts/authored-training-decks.mjs';
import {deckSearchTaskOptions,expectedDeckSearchPair} from '../scripts/adaptive-deck-search.mjs';

const plan={iteration:1,games:4,seed:1337,sourceBehaviorHash:'learner',gameRandomnessContract:'seeded-engine-game-v1',
  leagueCollection:{contract:LEAGUE_COLLECTION,behaviorHashes:['learner','champion'],opponentIndexes:[1,1,1,1]}};
const result=i=>({summaries:[{completed:true,winnerId:'p1',learnerSeat:i%2,learnerPlayerId:`p${i%2+1}`,
  aiSeats:i%2?[{role:'league',generation:11},{role:'learner',generation:22}]:[{role:'learner',generation:22},{role:'league',generation:11}]}],
  trajectories:[{gameId:`adaptive:1:${i}`,playerId:`p${i%2+1}`,sourcePolicyBehaviorHash:'learner',
    steps:[{state:new Float32Array(STATE_DIM),actions:new Float32Array(ACTION_DIM),legalCount:1}]}],
  leagueBehavior:leagueGameAssignment(plan,i)});

test('both seats accept only actual learner trajectories and frozen opponent identity',()=>{
  for(let i=0;i<4;i++){
    assertAdaptiveGame(result(i),plan,i);
    for(const mutate of [r=>r.trajectories.push({...r.trajectories[0],playerId:`p${2-i%2}`}),
      r=>r.trajectories[0].sourcePolicyBehaviorHash='opponent',r=>r.leagueBehavior.opponentBehaviorHash='changed',
      r=>r.summaries[0].learnerSeat=1-i%2]){
      const bad=result(i);mutate(bad);assert.throws(()=>assertAdaptiveGame(bad,plan,i));
    }
  }
});
test('worker attestation validates weights rather than trusting generation numbers',()=>{
  const learner={generation:22,hash:'learner'},league=[learner,{generation:11,hash:'champion'}];
  attestLeagueGame(result(0),leagueGameAssignment(plan,0),learner,league,m=>m.hash);
  assert.throws(()=>attestLeagueGame(result(0),leagueGameAssignment(plan,0),learner,[learner,{generation:11,hash:'wrong'}],m=>m.hash));
  const bad=result(0);bad.trajectories[0].playerId='p2';assert.throws(()=>attestLeagueGame(bad,leagueGameAssignment(plan,0),learner,league,m=>m.hash));
});
test('task assignment freezes a single opponent and cannot filter it via curriculum',()=>{
  const options=selfPlayTaskOptions({league:[{},{}],deckCurriculum:{focusOpponentGenerations:[999]}},
    {optionOverrides:{leagueGameAssignment:leagueGameAssignment(plan,0)}});
  assert.deepEqual(options.leagueSamplingWeights,[0,1]);assert.equal(options.deckCurriculum,null);
  assert.throws(()=>selfPlayTaskOptions({league:[{}]},{optionOverrides:{leagueGameAssignment:leagueGameAssignment(plan,0)}}));
});
test('collector does not overwrite enemy behavior hashes; resumed saved games reject pool edits',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'league-contract-'));
  try{
    const one={...plan,games:1,leagueCollection:{...plan.leagueCollection,opponentIndexes:[1]}};
    await collectAdaptiveSelfPlay({directory,plan:one,collect:async options=>{
      const task=options.resolveTaskOptions({task:{gameIndex:0}});
      assert.equal(task.optionOverrides.leagueGameAssignment.opponentBehaviorHash,'champion');
      await options.onGameComplete({gameIndex:0,result:result(0)});
    }});
    assert.equal((await readTrajectoryArchive(path.join(directory,'games/0.json.gz'))).trajectories.length,1);
    const changed={...one,leagueCollection:{...one.leagueCollection,behaviorHashes:['learner','different']}};
    await assert.rejects(collectAdaptiveSelfPlay({directory,plan:changed,collect:()=>assert.fail('must reject saved identity')}));
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('corrupt learner lineage is quarantined, never restamped as candidate data',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'league-invalid-'));
  try{await assert.rejects(collectAdaptiveSelfPlay({directory,plan:{...plan,games:1,
    leagueCollection:{...plan.leagueCollection,opponentIndexes:[1]}},collect:async options=>{
      const bad=result(0);bad.trajectories[0].sourcePolicyBehaviorHash='enemy';await options.onGameComplete({gameIndex:0,result:bad});
    }}),e=>e.code==='ADAPTIVE_GAME_REJECTED');
  }finally{await rm(directory,{recursive:true,force:true});}
});

const config=()=>({contract:LEAGUE_EXPERIMENT,iterations:4,gamesPerIteration:32,epochs:4,reservedSlots:3,workerProcesses:2,
  promotionEligible:false,decks:authoredTrainingDecks().slice(0,2),opponents:[{role:'champion'},{role:'historical-champion'}],
  opponentCycle:[1,1,2,0],seed:192783,evaluationSeed:73189123});
test('paired control has the same decks, seats, seeds and one-seat data budget',()=>{
  const c=config();
  for(let i=1;i<=4;i++){
    const control=leagueExperimentPlan(c,'selfplay',i,'a','learner',['champion','old']);
    const league=leagueExperimentPlan(c,'league',i,'b','learner',['champion','old']);
    assert.equal(control.seed,league.seed);assert.deepEqual(control.deckSearch,league.deckSearch);
    assert.deepEqual(control.leagueCollection.opponentIndexes,Array(32).fill(0));
    assert.deepEqual([0,1,2].map(n=>league.leagueCollection.opponentIndexes.filter(x=>x===n).length),[8,16,8]);
    for(let g=0;g<32;g++){
      assert.equal(leagueGameAssignment(league,g).learnerSeat,g%2);
      assert.ok(deckSearchTaskOptions(league.deckSearch,g));assert.equal(expectedDeckSearchPair(league.deckSearch,g,league.seed).length,2);
    }
  }
});
test('screen reports actual wins and paired regressions without granting promotion',()=>{
  const c=config(),rows=leagueEvaluationJobs(c).flatMap((job)=>Array.from({length:8},(_,i)=>({
    completed:true,winnerId:i%2?'p1':'p2',candidateSeat:i%2,firstPlayerId:'p1',gameSeed:job.seed+i,
    evaluationMode:job.evaluationMode,decisionReviewHash:'review',deckIds:[job.decks[0].id,(job.decks[1]||job.decks[0]).id]})));
  const result=summarizeLeagueExperiment(c,{baseline:rows,selfplay:rows,league:rows});
  assert.equal(result.promotionEligible,false);assert.equal(result.comparison.selfplay.observedWinRateDifference,0);
  const wrong=structuredClone(rows);wrong[0].gameSeed++;
  assert.throws(()=>summarizeLeagueExperiment(c,{baseline:rows,selfplay:wrong,league:rows}));
});
