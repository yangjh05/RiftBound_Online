import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decklists } from "../src/cards.mjs";
import { createNeuralModel } from "../src/ai/neural/model.mjs";
import { collectProcessPoolSelfPlay, selfPlayDynamicScaleDecision }
  from "../scripts/ai-selfplay-process-pool.mjs";

const gib = 1024 ** 3;
const limits = { maximumProcessCount: 16, minimumFreeMemoryBytes: 4 * gib,
  workerHeadroomBytes: gib };
const recovering = { processCount: 16, desiredProcessCount: 1,
  retiringProcesses: 15, recoverableRetiringProcesses: 15,
  freeMemoryBytes: 10 * gib, observedWorkerRssBytes: gib,
  queuedTasks: 20, idleProcesses: 0, dynamicScaling: true };

test("busy retirement can recover at the physical ceiling without exceeding 16", () => {
  assert.equal(selfPlayDynamicScaleDecision(recovering, limits).action, "scale-up");
  assert.equal(selfPlayDynamicScaleDecision(recovering, limits).desiredProcessCount, 2);
  assert.equal(selfPlayDynamicScaleDecision({ ...recovering,
    desiredProcessCount: 16 }, limits).action, "hold");
  assert.equal(selfPlayDynamicScaleDecision({ ...recovering,
    recoverableRetiringProcesses: 0 }, limits).action, "hold");
});

test("recovery still requires memory, demand and enabled balancing", () => {
  for (const override of [{ freeMemoryBytes: NaN }, { freeMemoryBytes: 4.5 * gib },
    { queuedTasks: 0 }, { dynamicScaling: false }]) {
    assert.equal(selfPlayDynamicScaleDecision({ ...recovering, ...override }, limits).action, "hold");
  }
  assert.equal(selfPlayDynamicScaleDecision({ ...recovering,
    desiredProcessCount: 5, freeMemoryBytes: 3 * gib }, limits).action, "scale-down");
  assert.equal(selfPlayDynamicScaleDecision({ ...recovering, processCount: 5,
    recoverableRetiringProcesses: 0 }, limits).action, "scale-up");
});

test("memory recovery keeps busy workers and their games before any task completes", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "riftbound-recovery-"));
  const release = path.join(directory, "release");
  let phase = "starting";
  let busyGames;
  let recovered = false;
  const releaseTimer = setTimeout(() => writeFileSync(release, "timeout"), 20000);
  try {
    const collected = await collectProcessPoolSelfPlay({
      games: 8, workers: 2, processes: 2, maximumProcesses: 2,
      dynamicScaling: true, dynamicScaleHealthySamples: 1,
      dynamicScaleIntervalMs: 1000, minimumFreeMemoryBytes: 100,
      freeMemoryBytes: () => phase === "pressure" ? 50 : 10 * gib,
      workerPath: path.resolve("tests/fixtures/ai-selfplay-recovery-worker.mjs"),
      workerEnvironment: { RIFTBOUND_RECOVERY_RELEASE: release },
      decks: Object.values(decklists).slice(0, 2), model: createNeuralModel(),
      maxActions: 1, teacherFraction: 0,
      onWorkerHeartbeat: snapshot => {
        assert.ok(snapshot.processCount <= 2);
        if (phase === "starting" && snapshot.active.length === 2) {
          busyGames = snapshot.active.map(x => [x.processId, x.workerIndex, x.gameIndex]);
          phase = "pressure";
        } else if (phase === "pressure" && snapshot.desiredProcessCount === 1
          && snapshot.recoverableRetiringProcessCount === 1) {
          phase = "recovery";
        } else if (phase === "recovery" && snapshot.desiredProcessCount === 2
          && snapshot.retiringProcessCount === 0) {
          assert.equal(snapshot.completedTasks, 0);
          assert.deepEqual(snapshot.active.map(x => [x.processId, x.workerIndex, x.gameIndex]), busyGames);
          recovered = true;
          phase = "done";
          writeFileSync(release, "recovered");
        }
      }
    });
    assert.equal(recovered, true);
    assert.equal(collected.workerStats.collectedGames, 8);
  } finally {
    clearTimeout(releaseTimer);
    rmSync(directory, { recursive: true, force: true });
  }
});
