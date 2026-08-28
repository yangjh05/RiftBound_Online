import test from "node:test";
import assert from "node:assert/strict";
import {
  addAiPerformance,
  configureAiPerformance,
  measureAiPerformance,
  resetAiPerformance,
  snapshotAiPerformance
} from "../src/ai/performance.mjs";
import { buildSelfPlayTaskQueue } from "../scripts/ai-selfplay-process-pool.mjs";

test("AI performance counters are opt-in and reset between games", () => {
  configureAiPerformance(false);
  addAiPerformance("cloneCalls", 3);
  assert.equal(snapshotAiPerformance(), null);

  configureAiPerformance(true);
  addAiPerformance("cloneCalls", 2);
  assert.equal(measureAiPerformance("cloneMs", () => 42), 42);
  const first = snapshotAiPerformance();
  assert.equal(first.cloneCalls, 2);
  assert.equal(first.cloneMs >= 0, true);
  assert.equal(first.version, 1);

  resetAiPerformance();
  const second = snapshotAiPerformance();
  assert.equal(second.cloneCalls, 0);
  assert.equal(second.rolloutSteps, 0);
});

test("logical self-play assignments stay stable when physical process count changes", () => {
  const queue = buildSelfPlayTaskQueue(80, 4);
  assert.deepEqual(queue.assignments, [20, 20, 20, 20]);
  assert.equal(queue.tasks.length, 80);
  assert.deepEqual(queue.tasks.slice(0, 4).map(({ workerIndex, gameIndex }) => [workerIndex, gameIndex]), [
    [0, 0], [1, 0], [2, 0], [3, 0]
  ]);
});
