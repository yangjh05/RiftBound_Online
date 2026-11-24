import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { collectAdaptiveSelfPlay } from "../scripts/adaptive-selfplay-collection.mjs";
import { STATE_DIM, ACTION_DIM } from "../src/ai/neural/encoding.mjs";

const plan = { iteration: 9, games: 2, seed: 7, sourcePath: "source", sourceBehaviorHash: "policy",
  gameRandomnessContract: "seeded-engine-game-v1" };
const valid = () => ({ summaries: [{ completed: true, winnerId: "p1", actions: 3 }],
  trajectories: ["p1", "p2"].map(playerId => ({ playerId,
    steps: [{state: new Float32Array(STATE_DIM), actions: new Float32Array(ACTION_DIM), legalCount: 1}] })) });
const truncated = actions => ({ summaries: [{ completed: false, winnerId: null, actions }], trajectories: [] });

test("a long game is saved then extended alone without replaying or training on rejected games", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adaptive-collection-retry-"));
  const accepted = [], passes = [], rejections = [];
  let original;
  try {
    await collectAdaptiveSelfPlay({ directory, plan, maxActions: 4,
      onGameComplete: ({ gameIndex }) => accepted.push(gameIndex), onRejectedGame: r => rejections.push(r),
      collect: async options => {
        const indexes = [0, 1].filter(i => !options.completedGameIndexes.get(0).has(i)); passes.push(indexes);
        for (const gameIndex of indexes) {
          const overrides = options.resolveTaskOptions({ task: { gameIndex } }).optionOverrides;
          assert.equal(overrides.deterministicGameRandomness, true);
          assert.equal(options.seed, plan.seed);
          const result = gameIndex === 0 && passes.length === 1 ? truncated(4) : valid();
          assert.equal(overrides.maxActions, gameIndex === 0 && passes.length === 2 ? 8 : 4);
          await options.onGameComplete({ gameIndex, seed: plan.seed, result });
        }
        if (passes.length === 1) original = await readFile(path.join(directory, "games", "1.json.gz"));
      } });
    assert.deepEqual(passes, [[0, 1], [0]]);
    assert.deepEqual(accepted, [1, 0]);
    assert.equal(rejections.length, 1);
    const rejected = await readTrajectoryArchive(rejections[0].archivePath);
    assert.equal(rejected.result.summaries[0].completed, false);
    assert.equal(rejected.failure.nextMaxActions, 8);
    assert.deepEqual(await readFile(path.join(directory, "games", "1.json.gz")), original);
    await assert.rejects(readdir(path.join(directory, "rejected-games", "1")), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a crash after saving an unfinished game resumes its larger committed action budget", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adaptive-collection-crash-"));
  const one = { ...plan, games: 1 };
  try {
    await assert.rejects(collectAdaptiveSelfPlay({ directory, plan: one, maxActions: 4, collect: async options => {
      await options.onGameComplete({ gameIndex: 0, seed: 7, result: truncated(4) });
      throw new Error("simulated process exit");
    } }), /simulated/);
    await collectAdaptiveSelfPlay({ directory, plan: one, maxActions: 4, collect: async options => {
      assert.equal(options.resolveTaskOptions({ task: { gameIndex: 0 } }).optionOverrides.maxActions, 8);
      await options.onGameComplete({ gameIndex: 0, seed: 7, result: valid() });
    } });
    assert.equal((await readdir(path.join(directory, "rejected-games", "0"))).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid games retain diagnostics and let peers save but never enter PPO or blind retry", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adaptive-collection-invalid-"));
  const accepted = [];
  try {
    await assert.rejects(collectAdaptiveSelfPlay({ directory, plan, maxActions: 4,
      onGameComplete: game => accepted.push(game.gameIndex), collect: async options => {
        const bad = truncated(4); bad.summaries[0].invalid = true;
        await options.onGameComplete({ gameIndex: 0, result: bad });
        await options.onGameComplete({ gameIndex: 1, result: valid() });
      } }), error => error.code === "ADAPTIVE_GAME_REJECTED" && error.diagnostic.archivePath.includes("rejected-games"));
    assert.deepEqual(accepted, [1]);
    assert.deepEqual(await readdir(path.join(directory, "games")), ["1.json.gz"]);
    await assert.rejects(collectAdaptiveSelfPlay({ directory, plan, collect: () => assert.fail("fatal rejection must be reviewed") }),
      error => error.code === "ADAPTIVE_GAME_REJECTED");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("action-budget exhaustion is finite and never fabricates a winner", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adaptive-collection-ceiling-"));
  let calls = 0;
  try {
    await assert.rejects(collectAdaptiveSelfPlay({ directory, plan: { ...plan, games: 1 }, maxActions: 4,
      maximumAdaptiveGameActions: 8, collect: async options => {
        calls++;
        const max = options.resolveTaskOptions({ task: { gameIndex: 0 } }).optionOverrides.maxActions;
        await options.onGameComplete({ gameIndex: 0, result: truncated(max) });
      } }), error => error.code === "ADAPTIVE_GAME_ACTION_LIMIT" && !error.diagnostic.recoverable);
    assert.equal(calls, 2);
    assert.deepEqual(await readdir(path.join(directory, "games")), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a completed game with a changed input layout is quarantined before the accepted callback", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adaptive-collection-layout-"));
  try {
    await assert.rejects(collectAdaptiveSelfPlay({ directory, plan: {...plan,games:1},
      onGameComplete: () => assert.fail("incompatible game must not enter the training evidence list"),
      collect: async options => {
        const result=valid();
        result.trajectories[1].steps[0].state=new Float32Array(STATE_DIM+4);
        await options.onGameComplete({gameIndex:0,result});
      } }),error=>error.code === "ADAPTIVE_GAME_REJECTED" && /representation mismatch/.test(error.diagnostic.message));
    assert.deepEqual(await readdir(path.join(directory,"games")),[]);
    const rejected=await readTrajectoryArchive(path.join(directory,"rejected-games","0","attempt-000001.json.gz"));
    assert.equal(rejected.result.trajectories[1].steps[0].state.length,STATE_DIM+4);
    assert.equal(rejected.failure.recoverable,false);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
