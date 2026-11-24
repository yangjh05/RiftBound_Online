import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { obsoleteAdaptiveEpochs, pruneCommittedAdaptiveEpochs } from "../scripts/adaptive-storage-maintenance.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "adaptive-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeTrajectoryArchive(path.join(root, "state.json.gz"), { contract: "continuous-policy-q-experiments-v1", iteration: 2 });
  for (const name of ["000001", "000002", "000003"]) {
    const directory = path.join(root, "iterations", name);
    await mkdir(path.join(directory, "games"), { recursive: true });
    await writeTrajectoryArchive(path.join(directory, "epoch.json.gz"), { optimizer: [1, 2] });
    await writeTrajectoryArchive(path.join(directory, "candidate.json.gz"), { checkpoint: { generation: Number(name), weights: [1, 2] } });
    await writeFile(path.join(directory, "games", "0.json.gz"), "original game");
  }
  return root;
}

test("only committed intermediate checkpoints are removed, preserving models, games and unfinished work", async t => {
  const root = await fixture(t);
  const keep = ["state.json.gz", "iterations/000001/candidate.json.gz", "iterations/000001/games/0.json.gz", "iterations/000003/epoch.json.gz"];
  const before = await Promise.all(keep.map(f => readFile(path.join(root, f))));
  assert.equal((await obsoleteAdaptiveEpochs(root)).length, 2);
  assert.equal((await pruneCommittedAdaptiveEpochs(root)).removedFiles, 2);
  assert.equal((await pruneCommittedAdaptiveEpochs(root)).removedFiles, 0);
  for (let i = 0; i < keep.length; i++) assert.deepEqual(await readFile(path.join(root, keep[i])), before[i]);
});

test("missing final candidates retain their restart checkpoint", async t => {
  const root = await fixture(t);
  await rm(path.join(root, "iterations/000002/candidate.json.gz"));
  assert.equal((await pruneCommittedAdaptiveEpochs(root)).removedFiles, 1);
  await readFile(path.join(root, "iterations/000002/epoch.json.gz"));
});

test("corrupt final archives fail closed before any cleanup", async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, "iterations/000002/candidate.json.gz"), "broken");
  await assert.rejects(pruneCommittedAdaptiveEpochs(root));
  await readFile(path.join(root, "iterations/000001/epoch.json.gz"));
  await readFile(path.join(root, "iterations/000002/epoch.json.gz"));
});

test("redirected iterations cannot authorize removal outside the run", async t => {
  const root = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "adaptive-storage-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(path.join(outside, "000001"));
  await writeFile(path.join(outside, "000001/epoch.json.gz"), "keep");
  await rm(path.join(root, "iterations"), { recursive: true });
  await symlink(outside, path.join(root, "iterations"), "junction");
  await assert.rejects(pruneCommittedAdaptiveEpochs(root), /redirected/);
  assert.equal(await readFile(path.join(outside, "000001/epoch.json.gz"), "utf8"), "keep");
});
