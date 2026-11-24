import assert from 'node:assert/strict';
import {selfPlayComparisonSchedule} from '../src/ai/neural/selfplay.mjs';
import {neuralBehaviorHash} from '../src/ai/neural/evaluator-certification.mjs';

export const LEAGUE_COLLECTION='frozen-learner-only-league-v1';

export function leagueGameAssignment(plan,index){
  const p=plan.leagueCollection;
  assert.equal(p?.contract,LEAGUE_COLLECTION);
  assert.equal(p.opponentIndexes.length,plan.games);
  assert.ok(Number.isInteger(index)&&index>=0&&index<plan.games);
  const opponentIndex=p.opponentIndexes[index];
  assert.ok(Number.isInteger(opponentIndex)&&opponentIndex>=0&&opponentIndex<p.behaviorHashes.length);
  assert.ok(p.behaviorHashes.every(h=>typeof h==='string'&&h.length>0));
  return {contract:LEAGUE_COLLECTION,sourceBehaviorHash:plan.sourceBehaviorHash,
    opponentIndex,opponentBehaviorHash:p.behaviorHashes[opponentIndex],
    learnerSeat:selfPlayComparisonSchedule(index).learnerSeat};
}

// The worker verifies the actual hydrated weights. The collector must never
// turn an opponent trajectory into learner evidence by stamping a new hash.
export function attestLeagueGame(result,assignment,model,league,hash=neuralBehaviorHash){
  assert.equal(hash(model),assignment.sourceBehaviorHash,'Worker learner weights changed.');
  assert.equal(hash(league[assignment.opponentIndex]),assignment.opponentBehaviorHash,'Worker opponent weights changed.');
  const s=result.summaries?.[0]||result.summary;
  assert.equal(s.learnerSeat,assignment.learnerSeat);
  assert.deepEqual(s.aiSeats.map(x=>x.role),assignment.learnerSeat===0?['learner','league']:['league','learner']);
  assert.equal(s.aiSeats[1-assignment.learnerSeat].generation,league[assignment.opponentIndex].generation);
  for(const t of result.trajectories||[]){
    assert.equal(t.playerId,`p${assignment.learnerSeat+1}`,'Opponent actions reached learner evidence.');
    t.sourcePolicyBehaviorHash=assignment.sourceBehaviorHash;
  }
  result.leagueBehavior={...assignment};
}

export function assertLeagueGame(result,plan,index){
  const a=leagueGameAssignment(plan,index),s=result.summaries?.[0]||result.summary;
  assert.deepEqual(result.leagueBehavior,a,'Frozen league assignment changed.');
  assert.equal(s.learnerSeat,a.learnerSeat);
  assert.equal(s.learnerPlayerId,`p${a.learnerSeat+1}`);
  assert.deepEqual(s.aiSeats.map(x=>x.role),a.learnerSeat===0?['learner','league']:['league','learner']);
  assert.equal(result.trajectories?.length,1,'League PPO requires exactly the learner trajectory.');
  const t=result.trajectories[0];
  assert.equal(t.playerId,`p${a.learnerSeat+1}`);
  assert.equal(t.sourcePolicyBehaviorHash,plan.sourceBehaviorHash);
  assert.equal(t.gameId,`adaptive:${plan.iteration}:${index}`);
}
