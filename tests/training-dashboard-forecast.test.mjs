import test from "node:test";
import assert from "node:assert/strict";
import { boundedMatchPlan, frozenMatchExpectedGame } from "../scripts/adaptive-policy-q-contract.mjs";
import { forecastEvaluation, estimateEvaluationEnd, estimateTrainingEnd } from "../server/training-dashboard-forecast.mjs";

const plan = boundedMatchPlan({ candidateHash: "candidate", opponentHash: "opponent", ordinal: 1,
  deckIds: ["sett", "annie", "kaisa", "yi", "leona"], randomSeed: 42, purpose: "champion-promotion" });
const games = (count, wins = 8) => Array.from({ length: count }, (_, index) => {
  const expected = frozenMatchExpectedGame(plan, index);
  const won = index % 8 < wins;
  return { ...expected, completed: true, invalid: false, adjudicated: false,
    winnerId: `p${won ? expected.candidateSeat + 1 : 2 - expected.candidateSeat}` };
});

test("forecasts preserve the real earliest promotion boundary and never mutate observations", () => {
  const observed = games(200), before = JSON.stringify(observed);
  const result = forecastEvaluation(plan, observed, { simulations: 12 });
  assert.equal(result.status, "estimated"); assert.equal(result.outlook, "favorable");
  assert.equal(result.targetGames, 400); assert.equal(result.passedPaths, 12);
  assert.deepEqual(result.gamesRange, [400, 400]); assert.equal(JSON.stringify(observed), before);
  assert.deepEqual(forecastEvaluation(plan, observed, { simulations: 12 }), result);
  assert.equal(forecastEvaluation(plan, games(400), { simulations: 12 }).status, "awaiting-result");
});

test("neutral and losing forecasts reuse budget closure and inferiority rules", () => {
  const neutral = forecastEvaluation(plan, games(200, 4), { simulations: 12 });
  assert.equal(neutral.targetGames, 800); assert.equal(neutral.passedPaths, 0);
  assert.equal(neutral.outcomes["low-promise"], 12);
  const losing = forecastEvaluation(plan, games(200, 0), { simulations: 12 });
  assert.equal(losing.targetGames, 400); assert.equal(losing.outcomes.inferior, 12);
});

test("forecasts withhold unsupported, sparse, invalid and out-of-order evidence", () => {
  assert.equal(forecastEvaluation({}, []).status, "unsupported");
  assert.equal(forecastEvaluation(plan, games(199)).status, "collecting");
  const invalid = games(200); invalid[30].invalid = true;
  assert.equal(forecastEvaluation(plan, invalid).status, "invalid");
  const shuffled = games(200); [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  assert.equal(forecastEvaluation(plan, shuffled).status, "invalid");
});

test("ETA uses recorded completions and does not drift on repeated heartbeat refreshes", () => {
  const start = Date.parse("2026-09-16T10:00:00Z"), completionTimes = Array.from({ length: 81 }, (_, i) => start + i * 10000);
  const input = { completionTimes, played: 100, running: true, forecast: { status: "estimated", targetGames: 400, gamesRange: [400, 800] }, ordinaryGames: 1600, maximumGames: 2400 };
  const first = estimateEvaluationEnd({ ...input, now: start + 805000 });
  const next = estimateEvaluationEnd({ ...input, now: start + 810000 });
  assert.equal(first.secondsPerGame, 10); assert.equal(first.estimatedAt, next.estimatedAt);
  assert.equal(first.secondsRemaining - next.secondsRemaining, 5);
  assert.equal(first.estimatedAt, new Date(start + 3800000).toISOString());
  assert.equal(estimateEvaluationEnd({ ...input, now: start + 2000000 }).status, "stale");
  assert.equal(estimateEvaluationEnd({ ...input, running: false }).status, "paused");
  assert.equal(estimateEvaluationEnd({ ...input, finished: true }).status, "completed");
  assert.equal(estimateEvaluationEnd({ ...input, completionTimes: completionTimes.slice(0, 5) }).status, "collecting");
});

test("training ETA uses the remaining phases of prior completed cycles and reports overrun", () => {
  const completed = [1, 2, 3].map(iteration => ({ iteration, phases: { "fast-selfplay": 1000, "candidate-policy-training": 11000 }, end: 31000 }));
  const current = { iteration: 4, phases: { "fast-selfplay": 100000, "candidate-policy-training": 120000 } };
  const base = { current, completed, stage: "candidate-policy-training", running: true, committed: false };
  const prediction = estimateTrainingEnd({ ...base, now: 125000 });
  assert.equal(prediction.secondsRemaining, 15); assert.equal(prediction.samples, 3);
  assert.equal(estimateTrainingEnd({ ...base, now: 150000 }).status, "overdue");
  assert.equal(estimateTrainingEnd({ ...base, completed: completed.slice(0, 2) }).status, "collecting");
  assert.equal(estimateTrainingEnd({ ...base, running: false }).status, "paused");
  assert.equal(estimateTrainingEnd({ ...base, committed: true }).status, "completed");
});

test('parallel sparse results wait for the missing prefix instead of regrouping later games',()=>{
  const observed=games(240);delete observed[1];
  assert.deepEqual(forecastEvaluation(plan,observed),{status:'collecting',sourceGames:0,minimumGames:200});
  observed[1]=games(2)[1];
  assert.equal(forecastEvaluation(plan,observed,{simulations:2}).sourceGames,240);
});

test('parallel ETA uses chronological completions including simultaneous arrivals',()=>{
  const start=Date.parse('2026-09-28T12:00:00Z');
  const times=[8,0,6,2,4,1,7,3,5,8].map(n=>start+n*10000);
  const before=[...times];
  const result=estimateEvaluationEnd({completionTimes:times,played:10,ordinaryGames:100,maximumGames:200,running:true,now:start+81000});
  assert.equal(result.secondsPerGame,80/9);assert.equal(result.sampledGames,9);
  assert.equal(result.lastCompletedAt,new Date(start+80000).toISOString());assert.deepEqual(times,before);
});
