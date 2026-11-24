import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { STATE_DIM, ACTION_DIM } from "../src/ai/neural/encoding.mjs";
import { splitAdaptiveLegacyRecords, assertAdaptiveEvidenceSplit, assertAdaptiveTrainingEntries,
  assertAdaptiveGame, assertAdaptiveCheckpoint, adaptiveFiniteEpochGuard } from "../scripts/adaptive-policy-q-evidence.mjs";

const records = Array.from({ length: 20 }, (_, gameIndex) => ({ datasetKey: "set", workerIndex: 0,
  gameIndex, archivePath: path.resolve(`fixture/game-${gameIndex}.json.gz`), resultIndex: {} }));
const entry = record => ({ datasetKey: record.datasetKey, coordinate: `0:${record.gameIndex}`, archivePath: record.archivePath });
const options = { initialSplit: { validationFraction: 0.2 }, seed: "stable", engineFingerprint: "engine" };

test("late legacy games never reassign previously trained games or held-out anchors", () => {
  const previous = { engineFingerprint: "engine", training: records.slice(0, 8).map(entry),
    validation: records.slice(8, 10).map(entry), fixedAnchorKeys: ["set:0:8"], sourceSplitHash: "original" };
  const next = splitAdaptiveLegacyRecords(records, { ...options, previous });
  for (const role of ["training", "validation"]) {
    for (const old of previous[role]) assert.ok(next[role].some(e => e.archivePath === old.archivePath));
  }
  assert.equal(next.training.length + next.validation.length, 20);
  assert.deepEqual(next.fixedAnchorKeys, previous.fixedAnchorKeys);
  assert.equal(next.sourceSplitHash, "original");
  assert.deepEqual(splitAdaptiveLegacyRecords([...records].reverse(), { ...options, previous: next }).validation
    .map(e => e.archivePath).sort(), next.validation.map(e => e.archivePath).sort());
  assert.throws(() => splitAdaptiveLegacyRecords(records.slice(1), { ...options, previous }), /disappeared/);
});

test("NaN, JSON-null and malformed weights cannot become a saved or reloaded candidate", () => {
  const checkpoint = { weights: { policy: [{ shape: [2], values: [0.1, -0.2] }] } };
  assert.doesNotThrow(() => assertAdaptiveCheckpoint(checkpoint));
  for (const value of [NaN, Infinity, null, "0"]) {
    const bad = structuredClone(checkpoint); bad.weights.policy[0].values[0] = value;
    assert.throws(() => assertAdaptiveCheckpoint(bad), /non-finite/);
  }
  const bad = structuredClone(checkpoint); bad.weights.policy[0].shape = [3];
  assert.throws(() => assertAdaptiveCheckpoint(bad), /weights/);
});

test("training fails closed before a held-out or duplicate game reaches the trainer", () => {
  const legacy = splitAdaptiveLegacyRecords(records, options);
  assert.throws(() => assertAdaptiveTrainingEntries([legacy.validation[0]], legacy), /Held-out/);
  assert.throws(() => assertAdaptiveTrainingEntries([legacy.training[0], legacy.training[0]], legacy), /Duplicate/);
  assert.throws(() => assertAdaptiveEvidenceSplit({ ...legacy,
    validation: [...legacy.validation, legacy.training[0]] }), /overlap/);
});

test("PPO rejects incomplete, duplicated and off-policy saved games", () => {
  const plan = { iteration: 7, sourceBehaviorHash: "policy" };
  const game = { summaries: [{ completed: true, invalid: false, adjudicated: false, winnerId: "p1" }],
    trajectories: ["p1", "p2"].map(playerId => ({ playerId, gameId: "adaptive:7:4", sourcePolicyBehaviorHash: "policy",
      steps: [{state: new Float32Array(STATE_DIM), actions: new Float32Array(ACTION_DIM), legalCount: 1}] })) };
  assert.doesNotThrow(() => assertAdaptiveGame(game, plan, 4));
  for (const mutate of [g => { g.summaries[0].completed = false; },
    g => { g.trajectories[1].playerId = "p1"; }, g => { g.trajectories[0].sourcePolicyBehaviorHash = "old"; },
    g => { g.trajectories[0].gameId = "adaptive:6:4"; }]) {
    const changed = structuredClone(game); mutate(changed);
    assert.throws(() => assertAdaptiveGame(changed, plan, 4), /Adaptive PPO/);
  }
});

test("saved PPO games reject expanded or truncated inputs before optimizer work", () => {
  const plan = { iteration: 7, sourceBehaviorHash: "policy" };
  for (const size of [STATE_DIM - 4, STATE_DIM + 4]) {
    const game = { summaries: [{ completed: true, winnerId: "p1" }],
      trajectories: ["p1", "p2"].map(playerId => ({ playerId, gameId: "adaptive:7:4", sourcePolicyBehaviorHash: "policy",
        steps: [{state: new Float32Array(size), actions: new Float32Array(ACTION_DIM), legalCount: 1}] })) };
    assert.throws(() => assertAdaptiveGame(game, plan, 4), error => error.code === "AI_REPRESENTATION_MISMATCH"
      && error.diagnostic.expected === STATE_DIM && error.diagnostic.received === size);
  }
});

test("non-finite raw PPO batches cannot disappear behind finite aggregate metrics", () => {
  const guard = adaptiveFiniteEpochGuard();
  const metrics = { meanLoss: 1, meanPolicyLoss: 1, meanValueLoss: 1, meanActionValueLoss: 1, meanGradientNorm: 1 };
  guard.onBatch({ epoch: 1, metrics: { loss: 1, policyLoss: 0, gradientNorm: Infinity } });
  guard.onBatch({ epoch: 1, metrics: { loss: 1, policyLoss: 0, gradientNorm: 1 } });
  assert.equal(guard.epochGuard({ epoch: 1, metrics }).passed, false);
  guard.onBatch({ epoch: 2, metrics: { loss: 1, policyLoss: 0, gradientNorm: 1 } });
  assert.equal(guard.epochGuard({ epoch: 2, metrics }).passed, true);
  guard.onBatch({ epoch: 3, metrics: { loss: NaN } });
  assert.equal(guard.epochGuard({ epoch: 3, metrics }).passed, false);
});
