import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const coachSource = await readFile(new URL("../src/ai/coach.mjs", import.meta.url), "utf8");

test("desktop startup does not eagerly load the trained neural checkpoint", () => {
  assert.doesNotMatch(appSource, /^loadNeuralAiCheckpoint\(\);$/m);
  assert.match(appSource, /async function ensureNeuralAiLoaded\(\)/);
  assert.match(appSource, /await ensureNeuralAiLoaded\(\)/);
});

test("AI features retain the baseline-policy fallback when no trained model is available", () => {
  assert.match(appSource, /await ensureNeuralAiLoaded\(\);\s+localMatch = createMatchState/);
  assert.doesNotMatch(appSource, /if \(!await ensureNeuralAiLoaded\(\)\) return/);
  assert.match(appSource, /완성 모델을 사용할 수 없어 기본 AI로 실행합니다/);
});

test("TensorFlow rollout code stays behind the deep-review dynamic import", () => {
  assert.doesNotMatch(coachSource, /^import .*rollout\.mjs/m);
  assert.match(coachSource, /await import\("\.\/rollout\.mjs"\)/);
});
