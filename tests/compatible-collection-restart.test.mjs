import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inspectCompatibleCollectionRestartSource
} from "../scripts/compatible-collection-restart-preflight.mjs";
import {
  requireCompatibleCollectionResume
} from "../scripts/migrate-compatible-ai-collection.mjs";

test("safe restart automatically binds an explicitly verified PPO collection", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ppo-restart-"));
  const manifestDirectory = path.join(
    directory,
    "resume",
    "generation-00006"
  );
  await mkdir(manifestDirectory, { recursive: true });
  await writeFile(path.join(manifestDirectory, "manifest.json"), JSON.stringify({
    generation: 6,
    collectionKey: "collection-old",
    engineFingerprint: "sha256:old"
  }), "utf8");
  try {
    const result = await inspectCompatibleCollectionRestartSource({
      dataRoot: directory,
      generation: 6,
      targetEngineFingerprint: "sha256:new",
      verifiedSourceFingerprint: "sha256:old"
    });
    assert.equal(result.compatible, true);
    assert.equal(result.attachCompatibilityArguments, true);
    assert.equal(result.sourceCollectionKey, "collection-old");
    assert.equal(result.sourceEngineFingerprint, "sha256:old");
    assert.equal(result.reason, "explicitly-verified-runtime-compatibility");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("safe restart refuses an old PPO collection without a compatibility proof", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "riftbound-ppo-restart-"));
  const manifestDirectory = path.join(
    directory,
    "resume",
    "generation-00006"
  );
  await mkdir(manifestDirectory, { recursive: true });
  await writeFile(path.join(manifestDirectory, "manifest.json"), JSON.stringify({
    generation: 6,
    collectionKey: "collection-old",
    engineFingerprint: "sha256:old"
  }), "utf8");
  try {
    const result = await inspectCompatibleCollectionRestartSource({
      dataRoot: directory,
      generation: 6,
      targetEngineFingerprint: "sha256:new"
    });
    assert.equal(result.compatible, false);
    assert.equal(result.attachCompatibilityArguments, false);
    assert.equal(result.reason, "source-engine-fingerprint-not-verified");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compatible PPO migration fails closed instead of silently recollecting", () => {
  assert.throws(
    () => requireCompatibleCollectionResume(null, { missing: true }),
    /Refusing to start a fresh collection/
  );
  const resume = { collectionKey: "current" };
  assert.equal(requireCompatibleCollectionResume(resume, {}), resume);
});
