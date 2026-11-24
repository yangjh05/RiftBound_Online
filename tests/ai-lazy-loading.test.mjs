import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.mjs", import.meta.url), "utf8");
const coachSource = await readFile(new URL("../src/ai/coach.mjs", import.meta.url), "utf8");

test("desktop startup does not eagerly load the trained neural checkpoint", () => {
  assert.doesNotMatch(appSource, /^loadNeuralAiCheckpoint\(\);$/m);
  assert.match(appSource, /async function ensureNeuralAiLoaded\(\)/);
  assert.match(appSource, /await ensureNeuralAiLoaded\(\)/);
  assert.match(appSource, /const AI_TURN_DECISION_TIMEOUT_MS = 120_000/);
  assert.match(appSource, /const AI_TURN_NEURAL_CONFIGURATION_TIMEOUT_MS = 180_000/);
});

test("AI match loading configures only the Worker and retains lightweight checkpoint metadata", () => {
  const loadStart = appSource.indexOf("async function ensureNeuralAiLoaded()");
  const loadEnd = appSource.indexOf("\nasync function ensureNeuralAiModelForDeepReview", loadStart);
  const loadSource = appSource.slice(loadStart, loadEnd);

  assert.match(loadSource, /await fetchNeuralAiCheckpointBuffer\(generation, loadController\.signal\)/);
  assert.match(loadSource, /await configureAiTurnWorkerNeural\(\s*checkpointBuffer,\s*descriptorKey,\s*generation\.generation,\s*generation\.checkpointSha256\s*\)/);
  assert.match(loadSource, /!aiTurnWorker \|\| aiTurnWorkerConfiguredNeuralKey !== descriptorKey/);
  assert.match(loadSource, /neuralAiCheckpointMetadata = checkpointMetadata/);
  assert.doesNotMatch(loadSource, /import\("\.\/ai\/neural\/model\.mjs"\)/);
  assert.doesNotMatch(loadSource, /deserializeNeuralModel|neuralAiModel\s*=/);
  assert.doesNotMatch(loadSource, /response\.json\(\)|JSON\.parse/);
  assert.match(loadSource, /loadController\.signal\.aborted/);
  assert.match(loadSource, /!sameAiModelSelection\(selectedAiGenerationDescriptor\(\),generation\)/);
  assert.doesNotMatch(loadSource, /neuralAiDescriptorKey\(selectedAiGenerationDescriptor\(\)\) !== descriptorKey/);
  assert.match(loadSource, /neuralAiLoadedDescriptorKey === descriptorKey/);
});

test("a same-generation catalog refresh cannot cancel an in-flight AI start", () => {
  const loadStart = appSource.indexOf("async function ensureNeuralAiLoaded()");
  const loadEnd = appSource.indexOf("\nasync function ensureNeuralAiModelForDeepReview", loadStart);
  const loadSource = appSource.slice(loadStart, loadEnd);

  assert.match(loadSource, /sameAiModelSelection\(selectedAiGenerationDescriptor\(\),generation\)/);
  assert.doesNotMatch(loadSource, /loadIsStale[\s\S]*neuralAiDescriptorKey\(selectedAiGenerationDescriptor\(\)\)/);
});

test("gameplay transfers the raw checkpoint to the Worker without cloning or parsing it", () => {
  const configureStart = appSource.indexOf("function configureAiTurnWorkerNeural");
  const configureEnd = appSource.indexOf("\nfunction ensureAiTurnWorker", configureStart);
  const configureSource = appSource.slice(configureStart, configureEnd);
  const rawFetchStart = appSource.indexOf("async function fetchNeuralAiCheckpointBuffer");
  const rawFetchEnd = appSource.indexOf("\nfunction lightweightNeuralAiCheckpointMetadata", rawFetchStart);
  const rawFetchSource = appSource.slice(rawFetchStart, rawFetchEnd);

  assert.match(configureSource, /checkpointBuffer/);
  assert.match(configureSource, /worker\.postMessage\([\s\S]*\[checkpointBuffer\]\)/);
  assert.match(configureSource, /AI_TURN_NEURAL_CONFIGURATION_TIMEOUT_MS/);
  assert.doesNotMatch(configureSource, /structuredClone|JSON\.parse|response\.json/);
  assert.match(rawFetchSource, /fetchAiGenerationCheckpointBuffer/);
  assert.match(rawFetchSource, /return response\.arrayBuffer\(\)/);
  assert.doesNotMatch(rawFetchSource, /response\.json\(\)|JSON\.parse/);
});

test("the main-thread neural model is allocated only for deep review and always disposed", () => {
  const loadStart = appSource.indexOf("async function ensureNeuralAiModelForDeepReview()");
  const loadEnd = appSource.indexOf("\nasync function fetchNeuralAiCheckpoint", loadStart);
  const loadSource = appSource.slice(loadStart, loadEnd);
  const dynamicImport = loadSource.indexOf('await import("./ai/neural/model.mjs")');
  const staleGuard = loadSource.indexOf("if (loadIsStale()) return null;", dynamicImport);
  const deserialize = loadSource.indexOf("loadedModel = deserializeNeuralModel(checkpoint)");
  const deepReviewStart = appSource.indexOf("async function runDeepAiReview()");
  const deepReviewEnd = appSource.indexOf("\nfunction coachSummaryCard", deepReviewStart);
  const deepReviewSource = appSource.slice(deepReviewStart, deepReviewEnd);

  assert.ok(dynamicImport >= 0);
  assert.ok(staleGuard > dynamicImport);
  assert.ok(deserialize > staleGuard);
  assert.match(loadSource, /disposeLoadedModel\(loadedModel\)/);
  assert.match(loadSource, /loadController\.signal\.aborted/);
  assert.match(deepReviewSource, /reviewModel = await ensureNeuralAiModelForDeepReview\(\)/);
  assert.match(deepReviewSource, /neuralModel: reviewModel/);
  assert.match(deepReviewSource, /finally \{[\s\S]*disposeNeuralAiReviewModel\(reviewModel\)/);
});

test("generation changes abort both checkpoint loads and keep coach metadata without tensors", () => {
  const clearStart = appSource.indexOf("function clearNeuralAiModel");
  const clearEnd = appSource.indexOf("\nfunction selectAiGeneration", clearStart);
  const clearSource = appSource.slice(clearStart, clearEnd);
  const metadataStart = appSource.indexOf("function lightweightNeuralAiCheckpointMetadata");
  const metadataEnd = appSource.indexOf("\nfunction disposeNeuralAiReviewModel", metadataStart);
  const metadataSource = appSource.slice(metadataStart, metadataEnd);
  const coachStart = appSource.indexOf("function activeCoachModel()");
  const coachEnd = appSource.indexOf("\n// Browser smoke tests", coachStart);
  const coachSource = appSource.slice(coachStart, coachEnd);

  assert.match(clearSource, /neuralAiLoadController\?\.abort\(\)/);
  assert.match(clearSource, /neuralAiReviewLoadController\?\.abort\(\)/);
  assert.match(clearSource, /disposeNeuralAiReviewModel\(\)/);
  assert.match(metadataSource, /metadata: structuredClone\(checkpoint\?\.metadata \|\| \{\}\)/);
  assert.match(metadataSource, /knowledge: structuredClone\(checkpoint\?\.knowledge \|\| \{\}\)/);
  assert.doesNotMatch(metadataSource, /weights|architecture|calibration/);
  assert.match(coachSource, /neuralAiCheckpointMetadata\.knowledge/);
  assert.match(coachSource, /neuralAiCheckpointMetadata\?\.generation/);
  assert.match(coachSource, /neuralAiCheckpointMetadata\?\.gamesTrained/);
});

test("AI matches require the selected trained generation to load", () => {
  assert.match(appSource, /if \(!await ensureNeuralAiLoaded\(\)(?: \|\| diagnosticNavigationBlocked\(\))?\) return/);
  assert.match(appSource, /async function startAiGameFromMenu\(\)[\s\S]*?appView = "game";\s+render\(\);/);
  assert.match(appSource, /AI 대전을 시작할 수 없습니다/);
  assert.match(appSource, /trainingDeckIdForGeneration\(pair\[1\], generation\)/);
});

test("TensorFlow rollout code stays behind the deep-review dynamic import", () => {
  assert.doesNotMatch(coachSource, /^import .*rollout\.mjs/m);
  assert.match(coachSource, /await import\("\.\/rollout\.mjs"\)/);
});
