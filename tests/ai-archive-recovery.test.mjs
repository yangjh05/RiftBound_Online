import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "riftbound-archive-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, "state.json.gz") };
}

function interceptRename(t, callback) {
  const rename = fs.rename;
  const mock = t.mock.method(fs, "rename", (from, to) => callback(from, to, rename));
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
}

test("archive replacement survives transient Windows locks without removing the saved state", async t => {
  const { directory, file } = await fixture(t);
  const previous = { iteration: 9 };
  await writeTrajectoryArchive(file, previous);
  const payload = { iteration: 10, trajectories: [{ values: new Float32Array([0.25, -2]), ids: new Uint32Array([3, 7]) }] };
  let attempts = 0;
  interceptRename(t, async (from, to, rename) => {
    assert.deepEqual(await readTrajectoryArchive(file), previous);
    if (++attempts < 3) throw Object.assign(new Error("locked"), { code: attempts === 1 ? "EPERM" : "EBUSY" });
    return rename(from, to);
  });
  await writeTrajectoryArchive(file, payload);
  assert.equal(attempts, 3);
  assert.deepEqual(await readTrajectoryArchive(file), payload);
  const expected = JSON.stringify(payload, (_key, value) => ArrayBuffer.isView(value)
    ? { __typedArray: value.constructor.name, base64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") } : value);
  assert.equal(gunzipSync(await fs.readFile(file)).toString(), expected);
  assert.deepEqual(await fs.readdir(directory), ["state.json.gz"]);
});

for (const code of ["EPERM", "ENOSPC"]) {
  test(`archive replacement preserves the old file and cleans temporary data on ${code}`, async t => {
    const { directory, file } = await fixture(t);
    await writeTrajectoryArchive(file, { iteration: 9 });
    const before = await fs.readFile(file);
    let attempts = 0;
    interceptRename(t, async () => { attempts += 1; throw Object.assign(new Error(code), { code }); });
    await assert.rejects(writeTrajectoryArchive(file, { iteration: 10 }), { code });
    assert.equal(attempts, code === "EPERM" ? 8 : 1);
    assert.deepEqual(await fs.readFile(file), before);
    assert.deepEqual(await fs.readdir(directory), ["state.json.gz"]);
  });
}

test("concurrent archive writes use distinct temporary files even in the same millisecond", async t => {
  const { directory, file } = await fixture(t);
  t.mock.method(Date, "now", () => 1234);
  const payloads = Array.from({ length: 4 }, (_, index) => ({ iteration: index, values: new Int32Array([index, -index]) }));
  await Promise.all(payloads.map(payload => writeTrajectoryArchive(file, payload)));
  const result = await readTrajectoryArchive(file);
  assert.deepEqual(result, payloads[result.iteration]);
  assert.deepEqual(await fs.readdir(directory), ["state.json.gz"]);
});
