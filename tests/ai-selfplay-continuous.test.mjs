import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { evaluatorBootstrapPrecisionCollectionWindow as planWindow }
  from "../scripts/evaluator-bootstrap-collection-window.mjs";
import { evaluatorBootstrapResumeTaskLimit } from "../scripts/evaluator-bootstrap.mjs";
import { buildSelfPlayTaskQueue, collectProcessPoolSelfPlay, selfPlayDynamicCapacityLimit }
  from "../scripts/ai-selfplay-process-pool.mjs";
import { createNeuralModel } from "../src/ai/neural/model.mjs";
import { decklists } from "../src/cards.mjs";

const options = { activeEvidenceRoles: ["training"], continueUntilComplete: true,
  stopWhenEvidenceCheckpoint: { role: "training", requirement: {
    minimumGames: 1850,
    shadowActionEffectDemand: { requestedGames: 256, precisionPlanning: true }
  } } };
const input = { options, allocation: { allocatedGames: 1904, expansions: 12,
  activeCollectionWindow: { version: 1, samplingMode: "leaf-audit",
    startCompletedLogical: 1840, targetCompletedLogical: 1872 } },
  completedLogical: 1871, samplingMode: "leaf-audit",
  audit: { acceptedGames: 1871, certificationPartitions: { training: { acceptedGames: 1656 } } } };

test("shared capacity can grow after another lane releases its workers", () => {
  let available = 1;
  const options = { dynamicProcessLimit: () => available };
  assert.equal(selfPlayDynamicCapacityLimit(options, 8), 1);
  available = 6;
  assert.equal(selfPlayDynamicCapacityLimit(options, 8), 6);
  available = 20;
  assert.equal(selfPlayDynamicCapacityLimit(options, 8), 8);
  available = NaN;
  assert.equal(selfPlayDynamicCapacityLimit(options, 8), 0);
});

test("precision resume extends the old barrier through the Training checkpoint", () => {
  const plan = planWindow(input);
  assert.equal(plan.remainingGames, 194);
  assert.equal(plan.allocation.allocatedGames, 2065);
  assert.equal(plan.allocation.activeCollectionWindow.startCompletedLogical, 1840);
  assert.equal(plan.allocation.activeCollectionWindow.targetCompletedLogical, 2065);
  assert.equal(evaluatorBootstrapResumeTaskLimit(194, plan.allocation, 1871, "leaf-audit"), 194);
  assert.equal(input.allocation.allocatedGames, 1904);
  const resumed = planWindow({ ...input, allocation: plan.allocation });
  assert.equal(resumed.allocation.expansions, plan.allocation.expansions);
  assert.equal(resumed.remainingGames, 194);
});

test("continuous capacity respects scope, checkpoint and configured total limits", () => {
  for (const patch of [{ activeEvidenceRoles: ["training", "development"] },
    { activeEvidenceRoles: ["development"] },
    { stopWhenEvidenceCheckpoint: { role: "development", requirement: options.stopWhenEvidenceCheckpoint.requirement } }]) {
    assert.equal(planWindow({ ...input, options: { ...options, ...patch } }), null);
  }
  assert.equal(planWindow({ ...input, samplingMode: "action-audit" }), null);
  assert.equal(planWindow({ ...input, audit: { certificationPartitions: { training: { acceptedGames: 1850 } } } }), null);
  const capped = planWindow({ ...input, options: { ...options, continueUntilComplete: false, maximumTotalGames: 1920 } });
  assert.equal(capped.remainingGames, 49);
  assert.equal(capped.allocation.allocatedGames, 1920);
});

test("a straggler stays alive while idle processes pass the former 32-game barrier", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "riftbound-continuous-"));
  const release = path.join(directory, "release");
  const completedGameIndexes = new Map([[0, new Set([0])], [1, new Set([0])]]);
  const expected = buildSelfPlayTaskQueue(66, 4, completedGameIndexes).tasks;
  const key = task => `${task.workerIndex}:${task.gameIndex}`;
  const first = key(expected[0]);
  let crossed = false, stragglerPid;
  const results = [];
  const timer = setTimeout(() => writeFileSync(release, "timeout"), 20000);
  try {
    const collected = await collectProcessPoolSelfPlay({
      games: 66, workers: 4, processes: 2, maximumProcesses: 2,
      taskLimit: 64, completedGameIndexes, seed: 123,
      minimumFreeMemoryBytes: 0, dynamicScaling: true,
      workerPath: path.resolve("tests/fixtures/ai-selfplay-straggler-worker.mjs"),
      workerEnvironment: { RIFTBOUND_STRAGGLER_RELEASE: release, RIFTBOUND_STRAGGLER_TASK: first },
      decks: Object.values(decklists).slice(0, 2), model: createNeuralModel(),
      maximumGamesPerProcess: 100,
      resolveTaskOptions: ({ taskIndex }) => ({ taskContext: { taskIndex, certificationRole: "training" } }),
      onGameComplete: ({ result }) => results.push(result.summaries[0].task),
      onWorkerHeartbeat: snapshot => {
        assert.ok(snapshot.processCount <= 2);
        assert.equal(snapshot.totalTasks, 64);
        const active = snapshot.active.find(task => key(task) === first);
        if (active) {
          stragglerPid ??= active.processId;
          assert.equal(active.processId, stragglerPid);
        }
        if (!crossed && snapshot.completedTasks >= 33) {
          assert.ok(active, "the original long game must still be running");
          crossed = true;
          writeFileSync(release, "crossed");
        }
      }
    });
    assert.equal(crossed, true);
    assert.equal(collected.workerStats.collectedGames, 64);
    assert.equal(results.length, 64);
    assert.deepEqual(new Set(results.map(key)), new Set(expected.map(key)));
    for (const task of results) {
      assert.equal(task.seed, 123 + task.workerIndex * 100003);
      assert.equal(task.taskContext.certificationRole, "training");
      assert.equal(key(expected[task.taskContext.taskIndex]), key(task));
    }
  } finally {
    clearTimeout(timer);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("handoff releases a finished process while preserving the running game", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "riftbound-drain-"));
  const release = path.join(directory, "release");
  const stop = path.join(directory, "stop.json");
  let released = false;
  const timeout = setTimeout(() => writeFileSync(release, "timeout"), 20000);
  try {
    const collected = await collectProcessPoolSelfPlay({ games: 4, workers: 2, processes: 2,
      maximumProcesses: 2, releaseIdleOnStop: true, stopRequestPath: stop, workerHeartbeatMs: 5000,
      minimumFreeMemoryBytes: 0, maximumGamesPerProcess: 100,
      workerPath: path.resolve("tests/fixtures/ai-selfplay-straggler-worker.mjs"),
      workerEnvironment: { RIFTBOUND_STRAGGLER_RELEASE: release, RIFTBOUND_STRAGGLER_TASK: "0:0" },
      decks: Object.values(decklists).slice(0, 2), model: createNeuralModel(),
      onGameComplete: ({ workerIndex }) => { if (workerIndex === 1) writeFileSync(stop, "{}"); },
      onWorkerHeartbeat: snapshot => {
        if (snapshot.draining && snapshot.processCount === 1 && snapshot.active.length === 1) {
          released = true; writeFileSync(release, "finished worker released");
        }
      }
    });
    assert.equal(released, true);
    assert.equal(collected.workerStats.collectedGames, 2);
    assert.equal(collected.workerStats.stoppedAtGameBoundary, true);
  } finally { clearTimeout(timeout); rmSync(directory, { recursive: true, force: true }); }
});
