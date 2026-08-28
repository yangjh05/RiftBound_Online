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

test("AI matches require the selected trained generation to load", () => {
  assert.match(appSource, /if \(!await ensureNeuralAiLoaded\(\)\) return/);
  assert.match(appSource, /async function startAiGameFromMenu\(\)[\s\S]*?appView = "game";\s+render\(\);/);
  assert.match(appSource, /AI 대전을 시작할 수 없습니다/);
  assert.match(appSource, /trainingDeckIdForGeneration\(pair\[1\], generation\)/);
});

test("TensorFlow rollout code stays behind the deep-review dynamic import", () => {
  assert.doesNotMatch(coachSource, /^import .*rollout\.mjs/m);
  assert.match(coachSource, /await import\("\.\/rollout\.mjs"\)/);
});
