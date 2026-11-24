import {leagueDeckPairs,leagueEvaluationJobs} from './league-evaluation-schedule.mjs';
export {leagueDeckPairs,leagueEvaluationJobs} from './league-evaluation-schedule.mjs';
import assert from 'node:assert/strict';
import {digest} from './adaptive-policy-q-contract.mjs';
import {LEAGUE_COLLECTION} from './league-selfplay-contract.mjs';
import {assertLegalTrainingDeck} from '../src/ai/legal-decks.mjs';

export const LEAGUE_EXPERIMENT='isolated-paired-league-policy-v1';
export const ARMS=['league','selfplay'];
export const STARTING_POINT_EXPERIMENT='paired-champion-current-learning-v1';
export const experimentArms=c=>c.contract===STARTING_POINT_EXPERIMENT?['champion-start','current-start']:ARMS;
export const experimentInitial=(c,arm)=>c.contract===STARTING_POINT_EXPERIMENT?c.initials[arm]:c.initial;

// Worker capacity is operational state, separate from the frozen experiment.
// Once both arms have finished, the serial evaluator needs no collection pool.
export function leagueWorkerReservation(config,state){
  if(state)assert.equal(state.configHash,digest(config));
  const evaluationOnly=experimentArms(config).every(arm=>state?.arms?.[arm]?.iteration===config.iterations);
  const slots=evaluationOnly?1:config.reservedSlots;
  return {...config.previousReservation,slots:config.previousReservation.slots+slots,
    additionalReservations:[...(config.previousReservation.additionalReservations||[]),{directory:config.directory,slots,contract:config.contract}]};
}

export function validateLeagueExperiment(c){
  assert.ok([LEAGUE_EXPERIMENT,STARTING_POINT_EXPERIMENT].includes(c.contract));
  if(c.contract===STARTING_POINT_EXPERIMENT){
    assert.deepEqual(Object.keys(c.initials).sort(),['champion-start','current-start']);
    assert.equal(c.screenGamesPerPair,8);assert.equal(c.confirmationGamesPerPair,8);
    assert.ok(Number.isSafeInteger(c.confirmationSeed)&&c.confirmationSeed>0);
    assert.notEqual(c.confirmationSeed,c.evaluationSeed);
    assert.equal(c.minimumMeanPolicyChange,.001);
  }
  assert.equal(c.iterations,4);assert.equal(c.gamesPerIteration,32);assert.equal(c.epochs,4);
  assert.equal(c.reservedSlots,3);assert.equal(c.workerProcesses,2);
  assert.equal(c.promotionEligible,false);
  assert.ok(c.decks.length>=2);assert.equal(new Set(c.decks.map(d=>d.id)).size,c.decks.length);
  for(const d of c.decks)assertLegalTrainingDeck(d);
  assert.deepEqual(c.opponents.map(o=>o.role),['champion','historical-champion']);
  assert.deepEqual(c.opponentCycle,[1,1,2,0]);
  assert.ok(Number.isSafeInteger(c.seed)&&c.seed>0);
  // Separate namespaces for training games and all three evaluation arms.
  const train=new Set();for(let i=1;i<=c.iterations;i++)for(let g=0;g<c.gamesPerIteration;g++)
    train.add(((c.seed+i*10000019)+g*130363)>>>0);
  const evalSeeds=new Set();
  for(const job of [...leagueEvaluationJobs(c),...(c.contract===STARTING_POINT_EXPERIMENT?leagueEvaluationJobs(c,'confirmation'):[])])for(let i=0;i<job.games;i+=job.evaluationMode==='same-deck-mirror-v3'?8:4){
    const seed=(job.seed+Math.floor(i/(job.evaluationMode==='same-deck-mirror-v3'?8:4))*104729)>>>0;
    assert.ok(!train.has(seed),'Training/evaluation seed overlap.');
    assert.ok(!evalSeeds.has(seed),'Screen/confirmation seed overlap.');evalSeeds.add(seed);
  }
  return c;
}


export function leagueExperimentPlan(c,arm,iteration,sourcePath,sourceBehaviorHash,opponentHashes){
  validateLeagueExperiment(c);assert.ok(experimentArms(c).includes(arm));
  assert.ok(Number.isInteger(iteration)&&iteration>=1&&iteration<=c.iterations);
  const pool=[sourceBehaviorHash,...opponentHashes],pairs=leagueDeckPairs(c.decks);
  assert.equal(pool.length,3);
  const assignments=Array.from({length:c.gamesPerIteration},(_,g)=>{
    const block=(iteration-1)*8+Math.floor(g/4),pair=pairs[block%pairs.length];
    return {gameIndex:g,mode:pair[0].id===pair[1].id?'mirror':'cross',
      pairIds:pair.map(d=>d.id),testedDeckId:pair[0].id};
  });
  const seed=(c.seed+iteration*10000019)>>>0;
  return {contract:c.contract,configHash:digest(c),arm,iteration,sourcePath,sourceBehaviorHash,
    games:c.gamesPerIteration,seed,epochSeed:(seed+7000001)>>>0,gameRandomnessContract:'seeded-engine-game-v1',
    role:'training',promotionEligible:false,
    leagueCollection:{contract:LEAGUE_COLLECTION,behaviorHashes:pool,
      opponentIndexes:assignments.map((_,g)=>arm==='selfplay'?0:c.opponentCycle[(Math.floor(g/4)+iteration-1)%4])},
    deckSearch:{contract:'legal-seeded-deck-search-v1',poolId:'origins-era',protocolHash:digest(c.decks),
      sourceBehaviorHash,population:c.decks,candidates:c.decks,assignments}};
}


// Keep the engine's positional deck argument distinct from evaluation options.
// A wrongly placed deck list otherwise falls through to the default 20 games.
export function runLeagueEvaluationJob(evaluate,candidate,opponent,job,options={}){
  assert.ok(Array.isArray(job.decks)&&job.decks.length>0,'Missing committed evaluation decks.');
  assert.ok([4,8].includes(job.games));assert.ok(Number.isInteger(job.seed)&&job.seed>0);
  return evaluate(candidate,opponent,job.decks,{...options,games:job.games,seed:job.seed,evaluationMode:job.evaluationMode});
}

// Descriptive paired outcomes only: these runs are a bounded screen, not a
// replacement for the unchanged promotion test. Report mirror/cross separately.
export function summarizeLeagueExperiment(config,results){
  const out={contract:LEAGUE_EXPERIMENT,configHash:digest(config),promotionEligible:false,
    status:'screen-complete-awaiting-review',arms:{},comparison:{}};
  for(const arm of ['baseline',...ARMS]){
    const rows=results[arm];assert.equal(rows.length,leagueEvaluationJobs(config).length*8);
    let wins=0;const perDeck={},groups={mirror:{games:0,wins:0},cross:{games:0,wins:0}};
    for(const s of rows){
      assert.ok(s.completed&&!s.invalid&&!s.adjudicated&&['p1','p2'].includes(s.winnerId));
      const won=Number(s.winnerId===`p${s.candidateSeat+1}`),deck=s.deckIds[s.candidateSeat];wins+=won;
      const item=perDeck[deck]||={games:0,wins:0};item.games++;item.wins+=won;
      const group=groups[s.deckIds[0]===s.deckIds[1]?'mirror':'cross'];group.games++;group.wins+=won;
    }
    out.arms[arm]={games:rows.length,wins,winRate:wins/rows.length,perDeck,groups};
  }
  for(const other of ['baseline','selfplay']){
    let better=0,worse=0;
    results.league.forEach((s,i)=>{
      const t=results[other][i];
      for(const k of ['gameSeed','candidateSeat','firstPlayerId','evaluationMode','decisionReviewHash'])assert.equal(s[k],t[k]);
      assert.deepEqual(s.deckIds,t.deckIds);
      const a=Number(s.winnerId===`p${s.candidateSeat+1}`),b=Number(t.winnerId===`p${t.candidateSeat+1}`);
      if(a>b)better++;if(a<b)worse++;
    });
    out.comparison[other]={better,worse,tied:results.league.length-better-worse,
      observedWinRateDifference:(better-worse)/results.league.length};
  }
  return out;
}
