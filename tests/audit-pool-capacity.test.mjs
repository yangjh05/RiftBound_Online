import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAuditPool } from "../scripts/detached-action-audit-coordinator.mjs";

async function until(predicate, description) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, description);
    await delay(25);
  }
}

test("audit capacity grows during legacy drain and shrinks only at shard boundaries", { timeout: 45000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "riftbound-audit-capacity-"));
  const eventsPath = path.join(directory, "events.jsonl");
  const events = () => existsSync(eventsPath)
    ? readFileSync(eventsPath, "utf8").trim().split(/\r?\n/).map(JSON.parse) : [];
  const release = id => writeFileSync(path.join(directory, `release-${id}`), "ready");
  let limit = 0, pool, work;
  try {
    pool = await createAuditPool({ processes: 3, initialProcesses: 3,
      dynamicProcessLimit: () => limit, dynamicScaleIntervalMs: 1000, dynamicScaleHealthySamples: 1,
      minimumFreeMemoryBytes: 0, freeMemoryProvider: () => 16 * 1024 ** 3,
      teacherEvaluatorMode: "heuristic-only", workerPath: path.resolve("tests/fixtures/ai-audit-capacity-worker.mjs"),
      workerEnvironment: { RIFTBOUND_AUDIT_CAPACITY_FIXTURE: directory } });
    assert.equal(pool.processCount, 0, "zero shared capacity must not create the initial workers");
    const tasks = Array.from({ length: 8 }, (_, i) => ({ taskId: String(i), candidateId: String(i),
      candidatePath: path.join(directory, "candidate"), outputPath: path.join(directory, `${i}.json`),
      bank: "final-leaf-v1", maximumSteps: 1, seeds: [i] }));
    work = pool.run(tasks);
    await delay(1100);
    assert.equal(events().length, 0, "queued work must wait for a slot");
    limit = 1;
    await until(() => events().length === 1, "first released slot should start work");
    const longTask = events()[0];
    assert.equal(pool.processCount, 1);
    limit = 3;
    await until(() => events().length === 3, "the same pool must grow beyond its initial allocation");
    const others = events().slice(1);
    limit = 1;
    await until(() => pool.desiredProcessCount === 1, "capacity reduction must retire excess workers");
    assert.equal(pool.processCount, 3, "busy shards must finish before workers exit");
    others.forEach(e => release(e.taskId));
    await until(() => pool.processCount === 1, "finished excess workers should exit");
    assert.equal(events().length, 3, "retiring workers must not take another shard");
    assert.doesNotThrow(() => process.kill(longTask.pid, 0), "the original long shard must survive scaling");
    release(longTask.taskId);
    await until(() => events().length === 4, "the retained worker must continue the queue");
    assert.equal(events()[3].pid, longTask.pid);
    limit = 0;
    await until(() => pool.desiredProcessCount === 0, "all shared slots can be reclaimed");
    release(events()[3].taskId);
    await until(() => pool.processCount === 0, "zero capacity must drain the final worker");
    await delay(1100);
    assert.equal(events().length, 4);
    limit = 2;
    await until(() => events().length === 6, "a fully drained pool must recover without losing pending work");
    tasks.forEach(task => release(task.taskId));
    const result = await work;
    assert.equal(result.length, 8);
    assert.deepEqual(events().map(e => e.taskId).sort(), tasks.map(t => t.taskId).sort());
    assert.ok(pool.processCount <= 2);
  } finally {
    for (let i = 0; i < 8; i++) release(String(i));
    await pool?.close();
    await work?.catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pausing saves active shards and leaves queued shards for resume", { timeout: 20000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "riftbound-audit-pause-"));
  let pool, work, closing;
  const release = () => writeFileSync(path.join(directory, "release-0"), "ready");
  try {
    pool = await createAuditPool({ processes: 1, initialProcesses: 1,
      minimumFreeMemoryBytes: 0, teacherEvaluatorMode: "heuristic-only",
      workerPath: path.resolve("tests/fixtures/ai-audit-capacity-worker.mjs"),
      workerEnvironment: { RIFTBOUND_AUDIT_CAPACITY_FIXTURE: directory } });
    const tasks = [0, 1, 2].map(i => ({ taskId: String(i), candidateId: String(i),
      candidatePath: path.join(directory, "candidate"), outputPath: path.join(directory, `${i}.json`),
      bank: "final-leaf-v1", maximumSteps: 1, seeds: [i] }));
    work = pool.run(tasks).then(() => null, error => error);
    await until(() => existsSync(path.join(directory, "events.jsonl")), "first shard should start");
    let closed = false;
    closing = pool.close({ pause: true }).then(() => { closed = true; });
    assert.equal((await work).code, "AUDIT_POOL_PAUSED");
    await delay(50);
    assert.equal(closed, false, "pause must wait for the active shard to save");
    release();
    await closing;
    assert.equal(existsSync(tasks[0].outputPath), true);
    assert.equal(existsSync(tasks[1].outputPath), false);
    assert.equal(existsSync(tasks[2].outputPath), false);
    assert.equal(readFileSync(path.join(directory, "events.jsonl"), "utf8").trim().split(/\r?\n/).length, 1);
    assert.equal(pool.processCount, 0);
  } finally {
    release();
    await closing;
    await pool?.close();
    await work;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('pause during asynchronous cache validation cannot enqueue an orphaned request',{timeout:10000},async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'riftbound-audit-cache-pause-'));
  let pool,closing;
  try{
    pool=await createAuditPool({processes:1,minimumFreeMemoryBytes:0,teacherEvaluatorMode:'heuristic-only',
      workerPath:path.resolve('tests/fixtures/ai-audit-capacity-worker.mjs'),
      workerEnvironment:{RIFTBOUND_AUDIT_CAPACITY_FIXTURE:directory}});
    const task={taskId:'cached',candidateId:'cached',candidatePath:path.join(directory,'candidate'),
      outputPath:path.join(directory,'cached.json.gz'),bank:'selection',maximumSteps:1,seeds:[1]};
    writeFileSync(task.outputPath,'partial prior write');
    const work=pool.run([task]).then(()=>null,error=>error);
    closing=pool.close({pause:true});
    const result=await Promise.race([work,delay(1000).then(()=>new Error('orphaned request after pause'))]);
    assert.equal(result?.code,'AUDIT_POOL_PAUSED');
    await closing;
    assert.equal(existsSync(path.join(directory,'events.jsonl')),false);
  }finally{
    await closing;await pool?.close();
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('riftbound-audit-cache-pause-'));
    rmSync(directory,{recursive:true,force:true});
  }
});
