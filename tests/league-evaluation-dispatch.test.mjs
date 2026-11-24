import test from 'node:test';
import assert from 'node:assert/strict';
import {runLeagueEvaluationJob,leagueWorkerReservation} from '../scripts/league-policy-experiment.mjs';
import {digest} from '../scripts/adaptive-policy-q-contract.mjs';
import {evaluateNeuralModels,evaluationConditionSchedule,scheduledEvaluationMatrixPair} from '../src/ai/neural/selfplay.mjs';

for(const mode of ['same-deck-mirror-v3','cross-deck-matrix-v1'])test(`league evaluator dispatch and restart preserve all frozen conditions for ${mode}`,()=>{
  const decks=mode==='same-deck-mirror-v3'?[{id:'deck-a'}]:[{id:'deck-a'},{id:'deck-b'}];
  const job={decks,games:8,seed:238917,evaluationMode:mode};
  const resumed=Array.from({length:8},(_,i)=>{
    const {candidateSeat,firstPlayerId}=evaluationConditionSchedule(i);
    const matrix=mode==='same-deck-mirror-v3'?[decks[0],decks[0]]:scheduledEvaluationMatrixPair(decks,Math.floor(i/4),job.seed);
    const pair=mode==='cross-deck-matrix-v1'&&candidateSeat===1?[matrix[1],matrix[0]]:matrix;
    return {completed:true,invalid:false,adjudicated:false,counted:true,winnerId:'p1',candidateSeat,firstPlayerId,
      gameSeed:job.seed+(mode==='same-deck-mirror-v3'?0:Math.floor(i/4)*104729),evaluationMode:mode,
      streamAssignment:mode==='same-deck-mirror-v3'?Math.floor(i/4):0,deckIds:pair.map(d=>d.id),scores:[8,4],actions:52,
      decisionReviewHash:'frozen-review'};
  });
  const events=[];
  // Null models and ID-only decks are intentional: the actual engine must
  // reuse all saved games. Any lost seed/review/deck option tries a new game
  // and fails instead of allowing the original argument bug to go unnoticed.
  const result=runLeagueEvaluationJob(evaluateNeuralModels,null,null,job,{
    resumedSummaries:resumed,decisionReviewHash:'frozen-review',reviewDecision:()=>assert.fail('replayed a completed game'),
    onGameComplete:e=>events.push(e)});
  assert.equal(result.games,8);assert.equal(result.completed,8);assert.equal(result.candidateWins,4);
  assert.deepEqual(events.map(e=>e.game),[1,2,3,4,5,6,7,8]);assert.ok(events.every(e=>e.resumed));
  for(let i=0;i<8;i++)for(const key of ['gameSeed','candidateSeat','firstPlayerId','evaluationMode','streamAssignment','deckIds','decisionReviewHash'])
    assert.deepEqual(result.summaries[i][key],resumed[i][key]);
});
test('league dispatch rejects missing decks before entering the evaluator',()=>{
  assert.throws(()=>runLeagueEvaluationJob(()=>assert.fail('must not execute'),null,null,{decks:[],games:8,seed:1}),/Missing/);
});
test('only fully trained experiment arms can reduce their reservation to one evaluator slot',()=>{
  const c={contract:'test',directory:'experiment',previousReservation:{slots:3,directory:'pilot'},reservedSlots:3,iterations:4};
  const state={configHash:digest(c),arms:{league:{iteration:4},selfplay:{iteration:3}}};
  assert.equal(leagueWorkerReservation(c,state).slots,6);
  state.arms.selfplay.iteration=4;
  assert.equal(leagueWorkerReservation(c,state).slots,4);
  assert.equal(leagueWorkerReservation(c,state).additionalReservations[0].slots,1);
  state.configHash='changed';assert.throws(()=>leagueWorkerReservation(c,state));
});
