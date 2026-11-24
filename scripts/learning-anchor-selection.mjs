import assert from 'node:assert/strict';
import {digest} from './adaptive-policy-q-contract.mjs';
import {inferStep} from '../src/ai/neural/model.mjs';
import {resolveLessonMemory} from './lesson-memory-context.mjs';
import {leagueEvaluationJobs} from './league-policy-experiment.mjs';
import {evaluationConditionSchedule,scheduledEvaluationMatrixPair} from '../src/ai/neural/selfplay.mjs';
import {evaluationReviewHash} from './evaluation-decision-review.mjs';

const won=s=>Number(s.winnerId===`p${s.candidateSeat+1}`);
export function assertSelectionRows(rows){
  assert.ok(rows.length>0);
  for(const s of rows)assert.ok(s.completed&&!s.invalid&&!s.adjudicated&&s.counted!==false
    &&['p1','p2'].includes(s.winnerId)&&[0,1].includes(s.candidateSeat));
}
export function assertAnchorEvaluationSchedule(config,rows,stage='confirmation'){
  assertSelectionRows(rows);const jobs=leagueEvaluationJobs(config,stage);
  assert.equal(rows.length,jobs.reduce((n,j)=>n+j.games,0));let cursor=0;
  for(const job of jobs)for(let i=0;i<job.games;i++){
    const s=rows[cursor++],mirror=job.evaluationMode==='same-deck-mirror-v3';
    const condition=evaluationConditionSchedule(i),pair=mirror?[job.decks[0],job.decks[0]]:scheduledEvaluationMatrixPair(job.decks,Math.floor(i/4),job.seed);
    assert.equal(s.gameSeed,(job.seed+(mirror?0:Math.floor(i/4)*104729))>>>0);
    assert.equal(s.candidateSeat,condition.candidateSeat);assert.equal(s.firstPlayerId,condition.firstPlayerId);
    assert.equal(s.evaluationMode,job.evaluationMode);assert.equal(s.streamAssignment,mirror?Math.floor(i/4):0);
    assert.deepEqual(s.deckIds,(condition.candidateSeat?[pair[1],pair[0]]:pair).map(d=>d.id));
    assert.equal(s.decisionReviewHash,evaluationReviewHash(config.evaluationReview));
  }
}
export function pairedAnchorComparison(candidate,reference){
  assertSelectionRows(candidate);assertSelectionRows(reference);assert.equal(candidate.length,reference.length);
  const clusters=new Map();let wins=0,referenceWins=0;
  candidate.forEach((s,i)=>{
    const t=reference[i];for(const k of ['gameSeed','candidateSeat','firstPlayerId','evaluationMode','decisionReviewHash'])assert.equal(s[k],t[k]);
    assert.deepEqual(s.deckIds,t.deckIds);wins+=won(s);referenceWins+=won(t);
    // Seat/first-player swaps from one seed are correlated, not four
    // independent draws. Keep their average as one statistical cluster.
    assert.equal(s.streamAssignment,t.streamAssignment);
    const key=JSON.stringify([s.gameSeed,[...s.deckIds].sort(),s.evaluationMode]);
    const cluster=clusters.get(key)||{values:[],size:s.evaluationMode==='same-deck-mirror-v3'?8:4};
    cluster.values.push(won(s)-won(t));clusters.set(key,cluster);
  });
  assert.ok([...clusters.values()].every(c=>c.values.length===c.size),'Incomplete paired seed block.');
  const n=clusters.size,mean=(wins-referenceWins)/candidate.length;
  const residuals=[...clusters.values()].map(c=>c.values.reduce((a,b)=>a+b,0)-mean*c.size);
  const standardError=n>1?Math.sqrt(n/(n-1)*residuals.reduce((a,b)=>a+b*b,0)/candidate.length**2):Infinity;
  return {games:candidate.length,wins,referenceWins,winRate:wins/candidate.length,
    referenceWinRate:referenceWins/candidate.length,clusters:n,difference:mean,standardError,
    approximateLowerBound:mean-2*standardError,approximateUpperBound:mean+2*standardError,
    promotionEligible:false};
}
export function selectScreenCandidate(arms,rows,changes,minimumChange){
  return arms.filter(arm=>changes[arm]?.acceptedEpochs>0&&changes[arm]?.meanTotalVariation>=minimumChange)
    .map(arm=>({arm,comparison:pairedAnchorComparison(rows[arm],rows[`${arm}-initial`])}))
    .filter(x=>x.comparison.difference>0&&x.comparison.winRate>=.5)
    .sort((a,b)=>b.comparison.winRate-a.comparison.winRate||a.arm.localeCompare(b.arm))[0]||null;
}
export function confirmLearningAnchor(candidate,reference){
  const comparison=pairedAnchorComparison(candidate,reference);
  // This is a continuation decision, never a champion promotion. The final
  // promotion procedure keeps its separate games, error budget and rules.
  return {...comparison,accepted:comparison.clusters>=28&&comparison.difference>0
    &&comparison.approximateLowerBound>0&&comparison.winRate>=.5};
}
export function measurePolicyChange(before,after,samples){
  assert.ok(samples.length>0);let total=0,changedChoices=0;
  const distribution=logits=>{const max=Math.max(...logits),a=logits.map(x=>Math.exp(x-max)),sum=a.reduce((x,y)=>x+y,0);return a.map(x=>x/sum);};
  for(const sample of samples){
    const s=sample.steps[0];
    const infer=m=>inferStep(m,s.state,s.actions,s.legalCount,resolveLessonMemory(m,sample)).logits;
    const a=infer(before),b=infer(after);assert.ok([...a,...b].every(Number.isFinite));
    const p=distribution(a),q=distribution(b);total+=p.reduce((v,x,i)=>v+Math.abs(x-q[i]),0)/2;
    changedChoices+=Number(a.indexOf(Math.max(...a))!==b.indexOf(Math.max(...b)));
  }
  return {samples:samples.length,changedChoices,meanTotalVariation:total/samples.length,probeHash:digest(samples),labelsUsed:false};
}
