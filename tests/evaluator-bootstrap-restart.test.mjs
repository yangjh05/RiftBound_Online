import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import { evaluatorBootstrapDatasetKey } from "../scripts/evaluator-bootstrap.mjs";
import { commitEvaluatorBootstrapSummary } from "../scripts/evaluator-bootstrap-transaction.mjs";
import { inspectEvaluatorBootstrapRestart, persistEvaluatorBootstrapRestartContract }
  from "../scripts/evaluator-bootstrap-restart-preflight.mjs";

async function fixture(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "riftbound-evaluator-restart-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const options = {
    dataRoot, engineFingerprint: "sha256:old", learningTargetVersion: 9,
    teacherLabelVersion: 1, deckIds: ["origins-sett"],
    continuationLineage: { version: 1, continuationPolicyHash: "policy",
      opponentPoolHash: "opponents", teacherEvaluatorPoolHash: "teacher", deckConfigurationHash: "decks" },
    collection: { seed: 42, maxActions: 1200, temperature: 0.85 }
  };
  const sourceDatasetKey = evaluatorBootstrapDatasetKey(options);
  const directory = path.join(dataRoot, "evaluator-bootstrap", sourceDatasetKey);
  await mkdir(directory, { recursive: true });
  const archivePath = path.join(directory, "worker-00-game-000.json.gz");
  const summaryPath = path.join(directory, "worker-00-game-000.summary.json");
  await writeTrajectoryArchive(archivePath, {
    trajectories: [{ engineFingerprint: options.engineFingerprint }]
  });
  await commitEvaluatorBootstrapSummary({ archivePath, summaryPath, summary: { valid: true } });
  const inspect = () => inspectEvaluatorBootstrapRestart({
    dataRoot, sourceDatasetKey, targetEngineFingerprint: "sha256:new", parentProcessId: 123
  });
  return { options, directory, dataRoot, sourceDatasetKey, inspect };
}

test("clean stage cleanup leaves a durable contract that reproduces both dataset keys", async (t) => {
  const f = await fixture(t);
  const requests = path.join(f.dataRoot, "resume", "evaluator-bootstrap-stage");
  await mkdir(requests, { recursive: true });
  const requestPath = path.join(requests, "bootstrap-123.request.json");
  await writeFile(requestPath, JSON.stringify({ options: f.options, metadata: { parentProcessId: 123 } }));
  const live = await f.inspect();
  await persistEvaluatorBootstrapRestartContract(f.options, { parentProcessId: 123, stageId: "stage-1" });
  await rm(requestPath);
  const stopped = await f.inspect();
  assert.equal(stopped.targetDatasetKey, live.targetDatasetKey);
  assert.equal(stopped.targetDatasetKey, evaluatorBootstrapDatasetKey({ ...f.options, engineFingerprint: "sha256:new" }));
  assert.equal(stopped.sourceCommittedGames, 1);
  assert.equal(stopped.requestPath, null);
  assert.ok(stopped.restartContractPath.endsWith("restart-contract.json"));
  assert.equal(stopped.requestStageId, "stage-1");
  assert.equal(stopped.requestParentMatched, true);
});

test("durable restart refuses altered collection settings or another data root", async (t) => {
  const f = await fixture(t);
  await persistEvaluatorBootstrapRestartContract(f.options);
  const filename = path.join(f.directory, "restart-contract.json");
  const original = JSON.parse(await readFile(filename, "utf8"));
  const changed = structuredClone(original);
  changed.descriptor.temperature = 0.3;
  await writeFile(filename, JSON.stringify(changed));
  await assert.rejects(f.inspect, /exactly reproduces/);
  await writeFile(filename, JSON.stringify({ ...original, dataRoot: path.join(f.dataRoot, "another") }));
  await assert.rejects(f.inspect, /exactly reproduces/);
});

test("restart verifies the committed archive fingerprint after request cleanup", async (t) => {
  const f = await fixture(t);
  await persistEvaluatorBootstrapRestartContract(f.options);
  const archivePath = path.join(f.directory, "worker-00-game-000.json.gz");
  const summaryPath = path.join(f.directory, "worker-00-game-000.summary.json");
  await writeTrajectoryArchive(archivePath, { trajectories: [{ engineFingerprint: "sha256:wrong" }] });
  await commitEvaluatorBootstrapSummary({ archivePath, summaryPath, summary: { valid: true } });
  await assert.rejects(f.inspect, /fingerprints differ/);
});

test("restart counts only complete archive transactions", async (t) => {
  const f = await fixture(t);
  await persistEvaluatorBootstrapRestartContract(f.options);
  await writeFile(path.join(f.directory, "worker-01-game-000.summary.json"), "{}");
  assert.equal((await f.inspect()).sourceCommittedGames, 1);
  await rm(path.join(f.directory, "worker-00-game-000.commit.json"));
  await assert.rejects(f.inspect, /no committed games/);
});
