import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listAiGenerations, readAiGenerationCheckpoint } from "../server/ai-data.mjs";
import { FOCUSED_TRAINING_DECK_IDS } from "../src/ai/training-decks.mjs";

test("AI generation server discovers bundled, promoted, learner, and in-progress candidate models", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "riftbound-ai-generations-"));
  const dataRoot = path.join(projectRoot, "data", "ai");
  try {
    await Promise.all([
      mkdir(path.join(projectRoot, "src", "ai", "checkpoints"), { recursive: true }),
      mkdir(path.join(dataRoot, "candidates"), { recursive: true }),
      mkdir(path.join(dataRoot, "learner"), { recursive: true }),
      mkdir(path.join(dataRoot, "resume"), { recursive: true })
    ]);
    await Promise.all([
      checkpoint(path.join(projectRoot, "src", "ai", "checkpoints", "neural-champion.json"), 0, "current", { gamesTrained: 256 }),
      checkpoint(path.join(dataRoot, "candidates", "iteration-00005-generation-00005.json"), 5, "old", { gamesTrained: 483, promoted: true }),
      checkpoint(path.join(dataRoot, "learner", "neural-learner.json"), 6, "current", { gamesTrained: 643, trainingIteration: 7 }),
      checkpoint(path.join(dataRoot, "candidates", "iteration-00007-generation-00007.json"), 7, "old", { gamesTrained: 723 }),
      writeFile(path.join(dataRoot, "status.json"), JSON.stringify({ state: "collecting", generation: 7 })),
      writeFile(path.join(dataRoot, "resume", "run.json"), JSON.stringify({ championGeneration: 0, learnerGeneration: 6 }))
    ]);

    const generations = await listAiGenerations({ root: dataRoot, projectRoot, engineFingerprint: "current" });
    assert.deepEqual(generations.map((entry) => entry.generation), [0, 5, 6, 7]);
    assert.equal(generations.find((entry) => entry.generation === 5).promoted, true);
    assert.equal(generations.find((entry) => entry.generation === 5).engineCompatible, false);
    assert.equal(generations.find((entry) => entry.generation === 6).kind, "learner");
    assert.equal(generations.find((entry) => entry.generation === 6).activeLearner, true);
    assert.equal(generations.find((entry) => entry.generation === 7).inProgress, true);
    assert.deepEqual(generations.find((entry) => entry.generation === 0).trainingDeckIds, FOCUSED_TRAINING_DECK_IDS);

    const learner = await readAiGenerationCheckpoint(6, { root: dataRoot, projectRoot, engineFingerprint: "current" });
    assert.equal(JSON.parse(learner.contents.toString("utf8")).generation, 6);
    assert.equal(await readAiGenerationCheckpoint(4, { root: dataRoot, projectRoot, engineFingerprint: "current" }), null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("an external AI data directory still discovers the bundled application checkpoint", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "riftbound-external-ai-data-"));
  try {
    await mkdir(path.join(dataRoot, "candidates"), { recursive: true });
    await checkpoint(path.join(dataRoot, "candidates", "generation-00009.json"), 9, "current", { gamesTrained: 900 });

    const generations = await listAiGenerations({ root: dataRoot, engineFingerprint: "current" });

    assert.deepEqual(generations.map((entry) => entry.generation), [0, 9]);
    assert.equal(generations[0].kind, "bundled");
    assert.equal(generations[1].kind, "candidate");
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

async function checkpoint(filename, generation, engineFingerprint, options = {}) {
  await writeFile(filename, JSON.stringify({
    generation,
    gamesTrained: options.gamesTrained || 0,
    metadata: {
      engineFingerprint,
      promoted: options.promoted === true,
      trainingIteration: options.trainingIteration,
      trainingDeckIds: FOCUSED_TRAINING_DECK_IDS
    }
  }));
}
