import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addAiPerformance, configureAiPerformance, measureAiPerformance,
  observeAiProgress, snapshotAiPerformance
} from "../src/ai/performance.mjs";
import {
  acceptSelfPlayProgress, readSelfPlayProgress, selfPlayProgressPath,
  selfPlayProgressStatus, startSelfPlayProgressReporting
} from "../scripts/ai-selfplay-progress.mjs";

test("synchronous progress is visible without timing instrumentation or event-loop timers", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "riftbound-progress-test-"));
  let clock = 0;
  configureAiPerformance(false);
  const stop = startSelfPlayProgressReporting({ directory, processId: 123, token: "task-a", clock: () => clock, intervalMs: 5000 });
  try {
    addAiPerformance("applyCalls");
    const filename = selfPlayProgressPath(directory, 123);
    const first = readSelfPlayProgress(filename);
    assert.equal(first.counters.applyCalls, 1);
    // Still in the same synchronous call stack; no timer has had a chance.
    clock = 4000;
    addAiPerformance("applyCalls");
    assert.deepEqual(readSelfPlayProgress(filename), first);
    clock = 5000;
    addAiPerformance("rolloutSteps", 17);
    const next = readSelfPlayProgress(filename);
    assert.equal(next.counters.applyCalls, 2);
    assert.equal(next.counters.rolloutSteps, 17);
    assert.equal(next.sequence, 3);
    assert.equal(snapshotAiPerformance(), null);
    stop();
    clock = 10000;
    addAiPerformance("applyCalls");
    assert.deepEqual(readSelfPlayProgress(filename), next);
  } finally {
    stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("telemetry failures do not change returned values or computational errors", () => {
  configureAiPerformance(true);
  const stop = observeAiProgress(() => { throw Error("telemetry unavailable"); }, { intervalMs: 0 });
  try {
    assert.equal(measureAiPerformance("applyMs", () => { addAiPerformance("applyCalls"); return 42; }), 42);
    assert.equal(snapshotAiPerformance().applyCalls, 1);
    assert.throws(() => measureAiPerformance("applyMs", () => { addAiPerformance("applyCalls"); throw Error("actual failure"); }), /actual failure/);
  } finally { stop(); configureAiPerformance(false); }
});

test("only increasing computation counters for the current task count as progress", () => {
  const slot = { task: {}, startedAt: 0, progressToken: "new" };
  const sample = { token: "new", sequence: 1, counters: { applyCalls: 12 } };
  assert.equal(acceptSelfPlayProgress(slot, { ...sample, token: "old" }, 1000), false);
  assert.equal(acceptSelfPlayProgress(slot, sample, 2000), true);
  assert.equal(acceptSelfPlayProgress(slot, sample, 3000), false);
  assert.equal(acceptSelfPlayProgress(slot, { ...sample, sequence: 2 }, 4000), false);
  assert.equal(acceptSelfPlayProgress(slot, { ...sample, sequence: 2, counters: { applyCalls: 11 } }, 4000), false);
  assert.equal(slot.lastProgressAt, 2000);
  assert.equal(selfPlayProgressStatus(slot, 2000 + 5 * 60_000).state, "no-recent-progress");
  assert.ok(slot.task, "stale telemetry must not discard the task");
  slot.progressWarningEmitted = true;
  assert.equal(acceptSelfPlayProgress(slot, { ...sample, sequence: 2, counters: { applyCalls: 13 } }, 400000), true);
  assert.equal(selfPlayProgressStatus(slot, 400000).state, "advancing");
  assert.equal(slot.progressWarningEmitted, false);
});

test("missing or unreadable telemetry is diagnostic uncertainty rather than worker failure", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "riftbound-progress-read-test-"));
  try {
    const filename = path.join(directory, "sample.json");
    assert.equal(readSelfPlayProgress(filename), null);
    writeFileSync(filename, "{partial");
    assert.equal(readSelfPlayProgress(filename), null);
    const slot = { task: {}, startedAt: 0 };
    assert.equal(selfPlayProgressStatus(slot, 1000).state, "awaiting-first-progress");
    assert.equal(selfPlayProgressStatus(slot, 300000).state, "no-recent-progress");
    assert.equal(selfPlayProgressStatus({}), null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
