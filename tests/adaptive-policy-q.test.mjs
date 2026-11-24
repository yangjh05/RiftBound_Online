import test from "node:test";
import assert from "node:assert/strict";
import { leafAuditSchedule, validLeafAuditSchedule, leafAuditStoppingDecision }
  from "../src/ai/neural/leaf-audit-schedule.mjs";
import { adaptiveTrainingReadiness, adaptiveWorkerBudget, adaptiveEvidenceWindow, frozenMatchPlan,
  frozenMatchDecision, frozenMatchExpectedGame, selectSavedStateJobs } from "../scripts/adaptive-policy-q-contract.mjs";

test("training can start on small valid data but never grants promotion", () => {
  assert.deepEqual(adaptiveTrainingReadiness({ games: 16, samples: 32 }),
    { ready: true, promotionEligible: false, precisionQuotasRequired: false });
  assert.equal(adaptiveTrainingReadiness({ games: 100, samples: 1000, invalid: 1 }).ready, false);
});

test("bounded evidence replay rotates through old games without duplicating a batch", () => {
  const entries = Array.from({ length: 1938 }, (_, i) => i);
  const seen = new Set();
  for (let iteration = 1; iteration <= 21; iteration++) {
    const batch = adaptiveEvidenceWindow(entries, iteration, 96);
    assert.equal(new Set(batch).size, 96);
    batch.forEach(entry => seen.add(entry));
  }
  assert.equal(seen.size, entries.length);
});

test("old games and all new lanes share a hard 16-worker ceiling", () => {
  for (let maximum = 1; maximum <= 16; maximum++) {
    let previous = adaptiveWorkerBudget(maximum, maximum);
    for (let old = maximum; old >= 0; old--) {
      const b = adaptiveWorkerBudget(old, maximum);
      assert.equal(old + b.selfplay + b.audit + b.trainer + b.evaluation, maximum);
      for (const lane of ["trainer", "selfplay", "audit", "evaluation"]) {
        assert.ok(b[lane] >= previous[lane], `${lane} must never borrow an occupied slot during drain`);
      }
      if (maximum - old >= 4) assert.ok(b.audit > 0 && b.evaluation > 0 && b.selfplay > 0);
      previous = b;
    }
  }
  assert.deepEqual(adaptiveWorkerBudget(0), { trainer: 1, audit: 6, evaluation: 1, selfplay: 8, maximum: 16 });
  assert.deepEqual(adaptiveWorkerBudget(3), { trainer: 1, audit: 3, evaluation: 1, selfplay: 8, maximum: 16 });
  assert.deepEqual(adaptiveWorkerBudget(1), { trainer: 1, audit: 5, evaluation: 1, selfplay: 8, maximum: 16 });
  assert.equal(adaptiveWorkerBudget(NaN).selfplay, 0);
});

function matchFixture(plan, win = true) {
  return Array.from({ length: plan.blocks * 8 }, (_, i) => ({
    completed: true, invalid: false, adjudicated: false,
    ...frozenMatchExpectedGame(plan, i),
    winnerId: `p${win ? i % 2 + 1 : 2 - i % 2}`
  }));
}

test("frozen promotion uses independent blocks and never counts unfinished games as wins", () => {
  const plan = frozenMatchPlan({ candidateHash: "new", opponentHash: "old", ordinal: 1,
    deckIds: ["a"], maximumBlocks: 64, randomSeed: 10 });
  const games = matchFixture(plan);
  const result = frozenMatchDecision(plan, games);
  assert.equal(result.promoted, true);
  assert.equal(result.independentBlocks, 64);
  assert.equal(frozenMatchDecision(plan, games.slice(1)).outcome, "inconclusive");
  games[0].adjudicated = true;
  assert.equal(frozenMatchDecision(plan, games).promoted, false);
  games[0].adjudicated = false;
  games[8].gameSeed = games[0].gameSeed;
  assert.throws(() => frozenMatchDecision(plan, games), /identity/);
  const alpha = Array.from({ length: 1000 }, (_, i) => 0.05 / ((i + 1) * (i + 2))).reduce((a, b) => a + b, 0);
  assert.ok(alpha <= 0.05);
});

test("state clones do not become new independent games", () => {
  const jobs = ["same", "same", "other"].map((game, i) => ({ plan: { sourceGameId: game, candidateId: String(i) },
    snapshot: { deckId: "deck", descriptor: {}, stratum: { phaseBand: "early" } } }));
  assert.equal(selectSavedStateJobs(jobs).length, 2);
  assert.deepEqual(selectSavedStateJobs(jobs, 0), []);
});

test("frozen decisions reject altered alpha, schedules, conditions and missing deck identities", () => {
  const plan = frozenMatchPlan({ candidateHash: "new", opponentHash: "old", ordinal: 1,
    deckIds: ["a", "b"], maximumBlocks: 32, randomSeed: 17 });
  assert.throws(() => frozenMatchDecision({ ...plan, alpha: 0.99 }, matchFixture(plan)), /commitment/);
  for (const mutation of [s => { s.gameSeed++; }, s => { s.candidateSeat = 2; },
    s => { s.deckIds = []; }, s => { s.streamAssignment = 2; }, s => { s.winnerId = "p3"; },
    s => { delete s.invalid; }]) {
    const summaries = matchFixture(plan);
    mutation(summaries[0]);
    assert.throws(() => frozenMatchDecision(plan, summaries), /identity|flags/);
  }
  assert.throws(() => frozenMatchPlan({ candidateHash: "a", opponentHash: "b", ordinal: 1,
    deckIds: ["a", "a"], randomSeed: 1 }), /commitment/);
});

test("audit confidence is spent over only the precommitted looks", () => {
  const schedule = leafAuditSchedule(128);
  assert.deepEqual(schedule.stages, [32, 64, 128]);
  assert.ok(Math.abs(schedule.stages.length * (1 - schedule.perStageConfidence) - 0.01) < 1e-12);
  assert.equal(validLeafAuditSchedule({ ...schedule, completedStage: 64 }, 64), true);
  assert.equal(validLeafAuditSchedule({ ...schedule, completedStage: 48 }, 48), false);
  assert.equal(validLeafAuditSchedule({ ...schedule, completedStage: 64, perStageConfidence: 0.95 }, 64), false);
});

test("small observed differences stay uncertain unless the whole interval is equivalent", () => {
  const schedule = leafAuditSchedule(128);
  const audit = { attemptedPairs: 32, samples: 32, confidence: schedule.perStageConfidence,
    determinizationAudit: { complete: true }, mean: 0, lowerBound: -0.2, upperBound: 0.2 };
  assert.deepEqual(leafAuditStoppingDecision(audit, schedule), { stop: false, outcome: "continue" });
  assert.equal(leafAuditStoppingDecision({ ...audit, lowerBound: -0.005, upperBound: 0.005 }, schedule).outcome, "equivalent");
  assert.equal(leafAuditStoppingDecision({ ...audit, lowerBound: 0.1, upperBound: 0.5 }, schedule).outcome, "decisive");
  assert.equal(leafAuditStoppingDecision({ ...audit, attemptedPairs: 128, samples: 128 }, schedule).outcome, "budget-exhausted-uncertain");
  assert.equal(leafAuditStoppingDecision({ ...audit, samples: 20, lowerBound: 0.1, upperBound: 0.5 }, schedule).outcome, "continue");
  assert.throws(() => leafAuditStoppingDecision({ ...audit, attemptedPairs: 33 }, schedule), /outside/);
});
