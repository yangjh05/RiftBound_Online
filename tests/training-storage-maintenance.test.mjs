import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes, symlink, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { maintainTrainingStorage } from "../scripts/training-storage-maintenance.mjs";
import { confinedStorageStat, removeUnchangedStorageFile, storageProcessIsGone } from "../scripts/training-storage-files.mjs";
import { TRAINING_TEMP_OWNER } from "../scripts/training-temporary-directory.mjs";
import { writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";

const exitedPid = spawnSync(process.execPath, ["-e", ""], { windowsHide: true }).pid;
const old = new Date(Date.now() - 2 * 60 * 60 * 1000);

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "storage-maintenance-test-"));
  t.after(async () => { await confinedStorageStat(root, root); await rm(root, { recursive: true, force: true }); });
  const data = path.join(root, "data"), temp = path.join(root, "temp");
  await mkdir(data); await mkdir(temp);
  return { root, data, temp, options: { trainingRoots: [data], temporaryRoot: temp, dryRun: false } };
}

async function put(filename, content = "{}", aged = true) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content);
  if (aged) await utimes(filename, old, old);
  return filename;
}

async function managed(f, extraOwner = {}) {
  const dir = path.join(f.temp, "riftbound-ai-selfplay-pool-ABC123");
  await put(path.join(dir, TRAINING_TEMP_OWNER), JSON.stringify({ version: 1, pid: exitedPid, hostname: hostname(), ...extraOwner }));
  await put(path.join(dir, `result-${exitedPid}-abc.json.gz`), "handoff bytes");
  await utimes(dir, old, old);
  return dir;
}

test("dry run and apply target only old atomic writes with a dead owner and a retained destination", async t => {
  assert.equal(storageProcessIsGone(exitedPid), true);
  const f = await fixture(t);
  await put(path.join(f.data, "state.json"));
  const orphan = await put(path.join(f.data, `state.json.tmp-${exitedPid}`), "discard");
  const preserved = [
    await put(path.join(f.data, `state.json.tmp-${process.pid}`)),
    await put(path.join(f.data, `state.json.tmp-${exitedPid}-123`), "recent", false),
    await put(path.join(f.data, `only-copy.json.tmp-${exitedPid}`)),
    await put(path.join(f.data, "state.json.incoming-123")),
    await put(path.join(f.data, "games", "1.json.gz")),
    await put(path.join(f.data, "candidate.json.gz")),
    await put(path.join(f.data, "notes.tmp"))
  ];
  const preview = await maintainTrainingStorage({ ...f.options, dryRun: true });
  assert.equal(preview.candidateFiles, 1); assert.equal(preview.removedFiles, 0);
  assert.equal(await readFile(orphan, "utf8"), "discard");
  const result = await maintainTrainingStorage(f.options);
  assert.equal(result.removedFiles, 1); assert.equal(result.freedBytes, 7);
  await assert.rejects(readFile(orphan), { code: "ENOENT" });
  for (const file of preserved) await readFile(file);
  assert.equal((await maintainTrainingStorage(f.options)).removedFiles, 0);
});

test("orphaned managed pools are removed while unowned legacy directories are preserved", async t => {
  const f = await fixture(t), dir = await managed(f);
  const legacy = await put(path.join(f.temp, "riftbound-ai-selfplay-pool-LEGACY", "result.json"));
  const report = await maintainTrainingStorage(f.options);
  assert.equal(report.removedFiles, 2); assert.equal(report.errorCount, 0);
  await assert.rejects(readdir(dir), { code: "ENOENT" });
  await readFile(legacy);
});

test("a corrupt committed destination preserves its potentially recoverable temporary copy", async t => {
  const f = await fixture(t);
  await put(path.join(f.data, "state.json"), "broken");
  const temporary = await put(path.join(f.data, `state.json.tmp-${exitedPid}`), '{"recoverable":true}');
  const result = await maintainTrainingStorage(f.options);
  assert.equal(result.removedFiles, 0); assert.equal(result.errorCount, 1);
  assert.equal(JSON.parse(await readFile(temporary, "utf8")).recoverable, true);
});

test("concurrent controllers serialize sweeps and account for each removed file once", async t => {
  const f = await fixture(t);
  await put(path.join(f.data, "state.json"));
  await put(path.join(f.data, `state.json.tmp-${exitedPid}`));
  const results = await Promise.all([maintainTrainingStorage(f.options), maintainTrainingStorage(f.options)]);
  assert.equal(results.reduce((sum, result) => sum + result.removedFiles, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.errorCount, 0), 0);
  await assert.rejects(readFile(path.join(f.temp, ".riftbound-training-storage-sweep.lock")), { code: "ENOENT" });
});

for (const scenario of ["live-parent", "foreign-host", "live-worker", "recent-file", "junction"]) {
  test(`managed temporary cleanup preserves ${scenario}`, async t => {
    const f = await fixture(t);
    const dir = await managed(f, scenario === "live-parent" ? { pid: process.pid }
      : scenario === "foreign-host" ? { hostname: "another-machine" } : {});
    if (scenario === "live-worker") await put(path.join(dir, `.worker-${process.pid}.json`));
    if (scenario === "recent-file") await put(path.join(dir, "new.json"), "busy", false);
    if (scenario === "junction") await symlink(f.data, path.join(dir, "outside"), "junction");
    await utimes(dir, old, old);
    assert.equal((await maintainTrainingStorage(f.options)).removedFiles, 0);
    await readFile(path.join(dir, TRAINING_TEMP_OWNER));
  });
}

test("invalid markers and broken run archives do not prevent independent safe cleanup", async t => {
  const f = await fixture(t);
  const dir = await managed(f);
  await put(path.join(dir, TRAINING_TEMP_OWNER), "not json"); await utimes(dir, old, old);
  await put(path.join(f.data, "broken", "state.json.gz"), "broken");
  await mkdir(path.join(f.data, "broken", "iterations"));
  await put(path.join(f.data, "latest.json"));
  await put(path.join(f.data, `latest.json.tmp-${exitedPid}`));
  const result = await maintainTrainingStorage(f.options);
  assert.equal(result.removedFiles, 1); assert.equal(result.errorCount, 2);
  await readFile(path.join(dir, TRAINING_TEMP_OWNER));
});

test("links at the scan root or within it cannot delete external files", async t => {
  if (process.platform === "win32") await assert.rejects(
    confinedStorageStat("\\\\server\\share", "\\\\server\\share\\data.json"), /local disk/);
  const f = await fixture(t);
  const external = path.join(f.root, "external"); await mkdir(external);
  await put(path.join(external, "latest.json"));
  const orphan = await put(path.join(external, `latest.json.tmp-${exitedPid}`));
  await symlink(external, path.join(f.data, "linked"), "junction");
  assert.equal((await maintainTrainingStorage(f.options)).removedFiles, 0);
  const result = await maintainTrainingStorage({ ...f.options, trainingRoots: [path.join(f.data, "linked")] });
  assert.equal(result.removedFiles, 0); assert.ok(result.errorCount > 0); await readFile(orphan);
});

test("a replaced file or redirected parent is rejected immediately before unlink", async t => {
  const f = await fixture(t), dir = path.join(f.data, "iteration");
  const file = await put(path.join(dir, "orphan.json"));
  const original = await lstat(file);
  await writeFile(file, "changed contents");
  assert.equal(await removeUnchangedStorageFile(f.data, file, original), false);
  const outside = path.join(f.root, "outside"); await mkdir(outside);
  await put(path.join(outside, "orphan.json"), "keep");
  await rm(dir, { recursive: true }); await symlink(outside, dir, "junction");
  await assert.rejects(removeUnchangedStorageFile(f.data, file, original), /redirected/);
  assert.equal(await readFile(path.join(outside, "orphan.json"), "utf8"), "keep");
  await assert.rejects(confinedStorageStat(f.data, outside), /escapes/);
});

test("committed epochs are previewed and removed, retaining uncommitted checkpoints and source games", async t => {
  const f = await fixture(t);
  await writeTrajectoryArchive(path.join(f.data, "state.json.gz"), { contract: "continuous-policy-q-experiments-v1", iteration: 1 });
  for (const iteration of ["000001", "000002"]) {
    await writeTrajectoryArchive(path.join(f.data, "iterations", iteration, "candidate.json.gz"), { checkpoint: { generation: 1, weights: [1, 2] } });
    await put(path.join(f.data, "iterations", iteration, "epoch.json.gz"), "optimizer");
  }
  assert.equal((await maintainTrainingStorage({ ...f.options, dryRun: true })).candidateFiles, 1);
  await readFile(path.join(f.data, "iterations/000001/epoch.json.gz"));
  assert.equal((await maintainTrainingStorage(f.options)).removedFiles, 1);
  await readFile(path.join(f.data, "iterations/000002/epoch.json.gz"));
  await readFile(path.join(f.data, "iterations/000001/candidate.json.gz"));
});

test("short or invalid retention periods are rejected and invalid PIDs are never considered dead", async t => {
  const f = await fixture(t);
  for (const minimumAgeMs of [0, -1, NaN, 1000]) await assert.rejects(maintainTrainingStorage({ ...f.options, minimumAgeMs }), /one hour/);
  for (const pid of [0, -1, NaN, "123", process.pid]) assert.equal(storageProcessIsGone(pid), false);
});

test("only old empty generated rejection directories are removed, with diagnostics and recent directories preserved", async t => {
  const f = await fixture(t);
  const root = path.join(f.data, "iterations/000001/rejected-games");
  for (const name of ["0", "1", "2", "notes"]) await mkdir(path.join(root, name), { recursive: true });
  await put(path.join(root, "1/attempt-000001.json.gz"), "diagnostic");
  for (const name of ["0", "1", "notes"]) await utimes(path.join(root, name), old, old);
  const preview = await maintainTrainingStorage({ ...f.options, dryRun: true });
  assert.equal(preview.candidateDirectories, 1); assert.equal(preview.removedDirectories, 0);
  await readdir(path.join(root, "0"));
  const result = await maintainTrainingStorage(f.options);
  assert.equal(result.removedDirectories, 1); assert.equal(result.removedFiles, 0);
  await assert.rejects(readdir(path.join(root, "0")), { code: "ENOENT" });
  for (const name of ["1", "2", "notes"]) await readdir(path.join(root, name));
});
