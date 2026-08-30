import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TESTS_DIR = path.join(ROOT, "tests");
const AI_ONLY_FILES = new Set([
  "compatible-collection-restart.test.mjs",
  "continuation-certification.test.mjs",
  "evaluator-early-diagnostic.test.mjs",
  "evidence-protocol.test.mjs",
  "training-safety.test.mjs"
]);
// Node's test runner treats a matching file-suite ancestor as a match for all
// descendants. Requiring whitespace keeps the file path from satisfying this
// negative filter, so mixed suites can still skip their explicitly AI-named tests.
const AI_TEST_NAME_PATTERN = "^(?!.*\\bAI\\b)(?=.*\\s).*$";

const files = fs.readdirSync(TESTS_DIR)
  .filter((fileName) => fileName.endsWith(".test.mjs"))
  .filter((fileName) => !fileName.startsWith(".mutant-"))
  .filter((fileName) => !/^ai(?:-|\.test)/i.test(fileName))
  .filter((fileName) => !AI_ONLY_FILES.has(fileName))
  .sort()
  .map((fileName) => path.join("tests", fileName));

if (!files.length) throw new Error("No non-AI test files were found.");

console.log(`Running ${files.length} non-AI test files; AI-only suites and named AI checks are excluded.`);
const result = spawnSync(process.execPath, [
  "--test",
  `--test-name-pattern=${AI_TEST_NAME_PATTERN}`,
  ...files
], {
  cwd: ROOT,
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
