import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir, hostname, uptime } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { frozenMatchPlan, frozenMatchExpectedGame, frozenMatchDecision, digest } from "../scripts/adaptive-policy-q-contract.mjs";
import { readFrozenEvaluationGames, verifyFrozenEvaluationResult, reserveAdaptiveEvaluation,
  promotionWriteAction } from "../scripts/adaptive-policy-q-evaluation.mjs";
import { withFileLock, readLiveFileLockOwner } from "../scripts/file-lock.mjs";
import { writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";

test("pending evaluation follows the latest candidate without changing a started reservation", () => {
  const state = { evaluationQueue: ["running"], pendingEvaluationCandidate: "candidate-65", evaluationOrdinal: 2,
    championPath: "champion" };
  assert.equal(reserveAdaptiveEvaluation(state, 10), null);
  state.pendingEvaluationCandidate = "candidate-66";
  state.evaluationQueue.shift();
  const reservation = reserveAdaptiveEvaluation(state, 10);
  assert.equal(reservation.candidatePath, "candidate-66");
  assert.equal(reservation.ordinal, 3);
  state.pendingEvaluationCandidate = "candidate-67";
  assert.deepEqual(reserveAdaptiveEvaluation(JSON.parse(JSON.stringify(state)), 99), reservation);
  assert.equal(state.pendingEvaluationCandidate, "candidate-67");
});

test("promotion after a crash is idempotent and never overwrites an unrelated champion", () => {
  const plan = { candidateHash: "new", opponentHash: "old" };
  assert.equal(promotionWriteAction("old", plan), "write");
  assert.equal(promotionWriteAction("new", plan), "already-applied");
  assert.throws(() => promotionWriteAction("external", plan), /outside/);
});

test("saved games bind the frozen request and a forged pass cannot replace their actual decision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "riftbound-frozen-integrity-"));
  try {
    const request = { candidatePath: "candidate", opponentPath: "opponent", incumbentPath: "champion",
      plan: frozenMatchPlan({ candidateHash: "new", opponentHash: "old", ordinal: 1,
        deckIds: ["a"], maximumBlocks: 8, randomSeed: 7 }) };
    const file = path.join(root, "request.json.gz");
    await writeTrajectoryArchive(file, request);
    await mkdir(path.join(root, "games"));
    const summaries = Array.from({ length: 64 }, (_, index) => ({ ...frozenMatchExpectedGame(request.plan, index),
      completed: true, invalid: false, adjudicated: false, winnerId: index % 2 ? "p1" : "p2",
      evaluationRequestHash: digest(request) }));
    await Promise.all(summaries.map((s, i) => writeFile(path.join(root, "games", `${i}.json`), JSON.stringify(s))));
    const result = { plan: request.plan, decision: frozenMatchDecision(request.plan, summaries), summaryDigest: digest(summaries) };
    await writeTrajectoryArchive(path.join(root, "result.json.gz"), result);
    assert.equal((await verifyFrozenEvaluationResult(file)).result.decision.promoted, false);
    await writeTrajectoryArchive(path.join(root, "result.json.gz"), { ...result, decision: { ...result.decision, promoted: true } });
    await assert.rejects(verifyFrozenEvaluationResult(file), /disagrees/);
    await writeFile(path.join(root, "games", "0.json"), JSON.stringify({ ...summaries[0], evaluationRequestHash: "another" }));
    await assert.rejects(readFrozenEvaluationGames(file, request), /another frozen/);
    const legacy = { ...summaries[0] }; delete legacy.evaluationRequestHash;
    await writeFile(path.join(root, "games", "0.json"), JSON.stringify(legacy));
    await assert.rejects(readFrozenEvaluationGames(file, request), /another frozen/);
    await writeFile(path.join(root, "legacy-result-adoption.json"), JSON.stringify({ requestHash: digest(request),
      prefix: { "0.json": createHash("sha256").update(JSON.stringify(legacy)).digest("hex") } }));
    assert.equal((await readFrozenEvaluationGames(file, request)).length, 64);
    await writeFile(path.join(root, "games", "0.json"), JSON.stringify({ ...legacy, winnerId: "p1" }));
    await assert.rejects(readFrozenEvaluationGames(file, request), /another frozen/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a live evaluation lock is adopted and rebooted PID reuse cannot keep its stale lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "riftbound-eval-lock-"));
  const file = path.join(root, "evaluation.lock");
  try {
    await withFileLock(file, async () => {
      assert.equal((await readLiveFileLockOwner(file)).pid, process.pid);
      await assert.rejects(withFileLock(file, () => {}, { timeoutMs: 1000 }), /Timed out/);
    });
    await writeFile(file, JSON.stringify({ version: 2, pid: process.pid, hostname: hostname(), token: "previous-boot",
      bootTimeMs: Date.now() - uptime() * 1000 - 86400000, acquiredAt: new Date(0).toISOString() }));
    assert.equal(await readLiveFileLockOwner(file), null);
    await withFileLock(file, async () => {
      assert.notEqual(JSON.parse(await readFile(file, "utf8")).token, "previous-boot");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
