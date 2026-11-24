import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonSchedule,expectedComparisonGame,assertComparisonRecord,summarizeComparison,comparisonHash,
  comparisonJobAssigned,specialistLessonReviewGate,releaseComparisonReservation,COMPARISON_CONTRACT} from '../scripts/deck-pilot-comparison.mjs';
import {scheduledEvaluationMatrixPair,evaluationConditionSchedule} from '../src/ai/neural/selfplay.mjs';

const deck={id:'viktor'},opponents=['a','b','x','z'].map(id=>({id}));
const schedule=comparisonSchedule(deck,opponents,39291051);
const plan={schedule,deckId:'viktor',reviewHash:'review',models:{pilot:{generation:1510},main:{generation:1542}}};
const record=(job,index,win)=>{
  const expected=expectedComparisonGame(job,index), candidateId=`p${expected.candidateSeat+1}`;
  const seats=[];seats[expected.candidateSeat]={generation:plan.models[job.subject].generation};
  seats[1-expected.candidateSeat]={generation:1542};
  return {planHash:comparisonHash(plan),jobId:job.id,index,summary:{...expected,completed:true,
    invalid:false,adjudicated:false,counted:true,decisionReviewHash:'review',aiSeats:seats,
    winnerId:win?candidateId:(candidateId==='p1'?'p2':'p1')}};
};
test('comparison balances seats and initiative for each deck role and pairs both subjects exactly',()=>{
  assert.equal(schedule.length*8,320);
  assert.equal(schedule.filter(j=>j.kind==='mirror').length*8,64);
  for(const job of schedule){
    const conditions=new Set();
    for(let i=0;i<8;i++){
      const e=expectedComparisonGame(job,i),c=evaluationConditionSchedule(i);
      assert.equal(e.candidateSeat,c.candidateSeat);assert.equal(e.firstPlayerId,c.firstPlayerId);
      if(job.kind==='cross'){
        const matchup=scheduledEvaluationMatrixPair(job.decks,Math.floor(i/4),job.seed);
        assert.deepEqual(e.deckIds,(c.candidateSeat?[...matchup].reverse():matchup).map(d=>d.id));
        conditions.add(`${e.deckIds[c.candidateSeat]}:${c.candidateSeat}:${c.firstPlayerId}`);
        const other=schedule.find(j=>j.kind==='cross'&&j.opponentId===job.opponentId&&j.round===job.round&&j.subject!==job.subject);
        assert.deepEqual(e,expectedComparisonGame(other,i));
      } else conditions.add(`${c.candidateSeat}:${c.firstPlayerId}:${e.streamAssignment}`);
    }
    assert.equal(conditions.size,8);
  }
});
test('resume rejects different model, plan, deck, seed, reviewer and invalid outcomes',()=>{
  const job=schedule[0],good=record(job,0,true);
  assertComparisonRecord(good,plan,job,0);
  for(const mutate of [r=>r.planHash='bad',r=>r.summary.gameSeed++,r=>r.summary.deckIds.reverse().push('bad'),
    r=>r.summary.aiSeats[0].generation++,r=>r.summary.decisionReviewHash='bad',r=>r.summary.completed=false,
    r=>r.summary.adjudicated=true,r=>r.summary.invalid=true,r=>r.summary.counted=false,r=>r.summary.winnerId=null]){
    const changed=structuredClone(good);mutate(changed);
    assert.throws(()=>assertComparisonRecord(changed,plan,job,0));
  }
});
test('unmatched games never define a paired improvement and deck roles remain separate',()=>{
  const job=schedule.find(j=>j.kind==='cross'&&j.subject==='pilot'),before=schedule.find(j=>j.id===job.id.replace('-pilot','-main'));
  const one=summarizeComparison(plan,[record(job,0,true)]);
  assert.equal(one.rows[0].pairedGames,0);assert.equal(one.rows[0].pairedDelta,null);
  const records=Array.from({length:8},(_,i)=>[record(job,i,i<4),record(before,i,i>=4)]).flat();
  const result=summarizeComparison(plan,records);
  assert.equal(result.rows.length,2);
  for(const row of result.rows){assert.equal(row.pairedGames,4);assert.equal(row.completedBlockDeltas.length,1);}
  assert.deepEqual(result.rows.map(r=>r.pairedDelta).sort(),[-1,1]);
  assert.equal(result.automaticIntegration,false);assert.equal(result.promotionEligible,false);
  assert.throws(()=>summarizeComparison(plan,[records[0],records[0]]));
});

test('one reserved serial process covers every job and rejects mixed serial/sharded launches',()=>{
  const serial={...plan,executionMode:'serial'};
  assert.equal(schedule.filter((_,i)=>comparisonJobAssigned(serial,'serial',0,i)).length,40);
  assert.throws(()=>comparisonJobAssigned(serial,'worker',0,0));
  assert.throws(()=>comparisonJobAssigned(plan,'serial',0,0));
  for(let i=0;i<schedule.length;i++)assert.equal(Number(comparisonJobAssigned(plan,'worker',0,i))
    +Number(comparisonJobAssigned(plan,'worker',1,i)),1);
});

test('capacity release preserves the pilot, active peers, and unrelated reservations',()=>{
  const r={slots:6,directory:'pilot',additionalReservations:[
    {directory:'finished',slots:1,contract:'isolated-paired-league-policy-v1'},
    {directory:'running',slots:1,contract:'paired-champion-current-learning-v1'},
    {directory:'comparison',slots:1,contract:COMPARISON_CONTRACT}]};
  const next=releaseComparisonReservation(r,'comparison',['finished']);
  assert.equal(next.slots,4);assert.equal(next.directory,'pilot');
  assert.deepEqual(next.additionalReservations,[r.additionalReservations[1]]);
  assert.equal(r.slots,6);assert.throws(()=>releaseComparisonReservation(r,'other'));
});

test('specialist gate needs complete paired improvement; even success never authorizes model changes',()=>{
  const all=[];
  for(const job of schedule)for(let i=0;i<8;i++)all.push(record(job,i,job.subject==='pilot'));
  const full=summarizeComparison(plan,all),gate=specialistLessonReviewGate(full);
  assert.equal(gate.eligibleForLessonReview,true);
  assert.equal(gate.pairedSeedBlocks,16);
  assert.equal(gate.mainWeightsMayChange,false);
  assert.equal(gate.individualLessonsRequireVerification,true);
  assert.equal(specialistLessonReviewGate(summarizeComparison(plan,all.slice(1))).eligibleForLessonReview,false);
  const unchanged=structuredClone(full);
  for(const row of unchanged.rows)if(row.role==='viktor')row.completedBlockDeltas.fill(0);
  assert.equal(specialistLessonReviewGate(unchanged).eligibleForLessonReview,false);
  const weakMirror=structuredClone(full);weakMirror.mirror.winRate=.49;
  assert.equal(specialistLessonReviewGate(weakMirror).eligibleForLessonReview,false);
  const uncertain=structuredClone(full);
  for(const row of uncertain.rows)if(row.role==='viktor')row.completedBlockDeltas=[1,-1,1,-.75];
  assert.equal(specialistLessonReviewGate(uncertain).eligibleForLessonReview,false);
});
