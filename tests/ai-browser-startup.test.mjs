import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const humanDataSource = await readFile(new URL("../src/ai/human-data.mjs", import.meta.url), "utf8");
const modelSource = await readFile(new URL("../src/ai/neural/model.mjs", import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("../src/ai/neural/tf-runtime.mjs", import.meta.url), "utf8");
const browserRuntimeUrl = new URL("../assets/vendor/tensorflow/tf.fesm.min.js", import.meta.url);

test("browser startup keeps TensorFlow behind the neural feature boundary", () => {
  assert.doesNotMatch(humanDataSource, /from "\.\/neural\/model\.mjs"/u);
  assert.match(humanDataSource, /NEURAL_HIDDEN_SIZE[\s\S]*?from "\.\/neural\/encoding\.mjs"/u);
});

test("the neural model retains its public hidden-size export", () => {
  assert.match(modelSource, /export \{ NEURAL_HIDDEN_SIZE \}/u);
});

test("the browser neural runtime is shipped as an application asset", async () => {
  assert.match(runtimeSource, /assets\/vendor\/tensorflow\/tf\.fesm\.min\.js/u);
  assert.doesNotMatch(runtimeSource, /node_modules\/@tensorflow\/tfjs\/dist\/tf\.fesm\.min\.js/u);
  const info = await stat(browserRuntimeUrl);
  assert.ok(info.isFile());
  assert.ok(info.size > 1_000_000);
});
