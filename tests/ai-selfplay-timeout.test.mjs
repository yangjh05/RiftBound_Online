import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createNeuralModel, disposeNeuralModel } from "../src/ai/neural/model.mjs";
import {
  collectProcessPoolSelfPlay,
  selfPlayTaskDurationLimit,
  selfPlayTaskTimedOut
} from "../scripts/ai-selfplay-process-pool.mjs";

const minute = 60_000;
const matchPool = { decks: [{ sideboard: ["card"] }], bestOfThreeFraction: 0.25 };

test("self-play has no default wall-clock deadline for single games or matches", () => {
  for (const options of [{}, matchPool, { ...matchPool, bestOfThreeFraction: 0 }]) {
    assert.equal(selfPlayTaskDurationLimit(options), 0);
    for (const elapsed of [45 * minute, 135 * minute, 24 * 60 * minute]) {
      assert.equal(selfPlayTaskTimedOut({ task: {}, startedAt: 0 }, options, elapsed), false);
    }
  }
});

test("process pool observes a busy worker's synchronous progress without restarting it", async () => {
  const model = createNeuralModel();
  const observed = [];
  const retries = [];
  try {
    const result = await collectProcessPoolSelfPlay({
      games: 1, workers: 1, processes: 1, decks: [], model,
      workerPath: fileURLToPath(new URL("./fixtures/ai-selfplay-progress-worker.mjs", import.meta.url)),
      workerHeartbeatMs: 5000,
      onWorkerHeartbeat: (snapshot) => observed.push(snapshot),
      onTaskRetry: (retry) => retries.push(retry)
    });
    assert.equal(result.workerStats.collectedGames, 1);
    assert.equal(retries.length, 0);
    const busy = observed.find((snapshot) => snapshot.active.some((task) => task.progress?.counters?.rolloutSteps > 0));
    assert.ok(busy, "parent must read computation progress before the task completes");
    assert.equal(busy.maximumTaskDurationMs, 0);
    assert.equal(busy.active[0].progress.state, "advancing");
  } finally { disposeNeuralModel(model); }
});

test("self-play timeout retains a finite explicit whole-task deadline", () => {
  assert.equal(selfPlayTaskDurationLimit({ ...matchPool, maximumTaskDurationMs: 50 * minute }), 50 * minute);
  assert.equal(selfPlayTaskDurationLimit({ ...matchPool, maximumTaskDurationMs: 1 }), minute);
  for (const maximumTaskDurationMs of [0, -1, NaN, Infinity]) {
    assert.equal(selfPlayTaskDurationLimit({ ...matchPool, maximumTaskDurationMs }), 0);
  }
});

test("only an explicitly enabled deadline can time out a self-play task", () => {
  const slot = { task: { workerIndex: 2, gameIndex: 2 }, startedAt: 1_000 };
  assert.equal(selfPlayTaskTimedOut(slot, matchPool, 1_000 + 45 * minute), false);
  assert.equal(selfPlayTaskTimedOut(slot, matchPool, 1_000 + 135 * minute - 1), false);
  assert.equal(selfPlayTaskTimedOut(slot, matchPool, 1_000 + 135 * minute), false);
  const explicit = { maximumTaskDurationMs: 10 * minute };
  assert.equal(selfPlayTaskTimedOut(slot, explicit, 1_000 + 10 * minute - 1), false);
  assert.equal(selfPlayTaskTimedOut(slot, explicit, 1_000 + 10 * minute), true);
  assert.equal(selfPlayTaskTimedOut({}, matchPool, 1e12), false);
  assert.equal(selfPlayTaskTimedOut({ task: {}, startedAt: null }, matchPool, 1e12), false);
});
