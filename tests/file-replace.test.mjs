import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFileWithRetrySync,
  renameWithRetry,
  renameWithRetrySync
} from "../scripts/file-replace.mjs";

test("asynchronous file replacement retries transient Windows locks", async () => {
  let attempts = 0;
  const waits = [];
  await renameWithRetry("source", "destination", {
    delays: [10, 25],
    renameFile: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("locked"), { code: "EPERM" });
    },
    wait: async (delay) => waits.push(delay)
  });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [10, 25]);
});

test("synchronous file replacement retries transient Windows locks", () => {
  let attempts = 0;
  const waits = [];
  renameWithRetrySync("source", "destination", {
    delays: [10],
    renameFile: () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    },
    wait: (delay) => waits.push(delay)
  });
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [10]);
});

test("synchronous event-log append retries transient Windows locks", () => {
  let attempts = 0;
  const waits = [];
  appendFileWithRetrySync("events.jsonl", "event\n", {
    delays: [5, 10],
    appendFile: (file, data, encoding) => {
      attempts += 1;
      assert.equal(file, "events.jsonl");
      assert.equal(data, "event\n");
      assert.equal(encoding, "utf8");
      if (attempts < 3) {
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      }
    },
    wait: (delay) => waits.push(delay)
  });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [5, 10]);
});

test("file replacement does not hide non-locking failures", async () => {
  let attempts = 0;
  await assert.rejects(() => renameWithRetry("source", "destination", {
    renameFile: async () => {
      attempts += 1;
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    },
    wait: async () => assert.fail("non-locking errors must not be retried")
  }), /disk full/);
  assert.equal(attempts, 1);
});
