import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { deserializeNeuralModel } from "../src/ai/neural/model.mjs";
import { assertTrainingPreflight } from "./training-safety.mjs";
import { FOCUSED_TRAINING_DECK_IDS, parseTrainingDeckIds } from "../src/ai/training-decks.mjs";

const trainingPreflight = assertTrainingPreflight();

const args = parseArgs(process.argv.slice(2));
if (!args.input) throw new Error("Usage: npm run ai:bootstrap:apply -- --input <artifact directory or neural-champion.json>");
const input = path.resolve(args.input);
const source = await findModel(input);
const modelContent = await readFile(source, "utf8");
const checkpoint = JSON.parse(modelContent);
const model = deserializeNeuralModel(checkpoint);
const reportSource = path.resolve(args.report || await findReport((await stat(input)).isDirectory() ? input : path.dirname(input)));
const report = JSON.parse(await readFile(reportSource, "utf8"));
const expectedDeckIds = parseTrainingDeckIds(args["deck-ids"] || FOCUSED_TRAINING_DECK_IDS);
if (model.metadata?.stage !== "bootstrap-complete") throw new Error(`Artifact is not a completed bootstrap checkpoint: ${model.metadata?.stage || "unknown stage"}`);
if (model.generation !== 0) throw new Error(`Bootstrap checkpoint must be generation 0, received ${model.generation}`);
if (model.knowledge?.cardPoolId !== "origins-era") throw new Error(`Expected origins-era card pool, received ${model.knowledge?.cardPoolId || "unknown"}`);
if (JSON.stringify(model.metadata?.trainingDeckIds) !== JSON.stringify(expectedDeckIds)) throw new Error("Artifact model does not match the requested training deck scope.");
if (JSON.stringify(report.configuration?.deckIds) !== JSON.stringify(expectedDeckIds)) throw new Error("Artifact report does not match the requested training deck scope.");
if (report.state !== "complete" || !report.qualityGate?.passed || !report.datasetGate?.passed) throw new Error(`Artifact report did not pass all quality gates: ${report.state || "unknown state"}`);
if (report.modelSha256 !== sha256(modelContent)) throw new Error("Artifact model checksum does not match run-report.json.");
if (model.metadata?.datasetFingerprint !== report.datasetGate?.metrics?.fingerprint) throw new Error("Artifact dataset fingerprint does not match its report.");
if (model.metadata?.engineFingerprint !== trainingPreflight.engineFingerprint) throw new Error("Artifact was trained against a different engine/card rules fingerprint.");
if (report.configuration?.engineFingerprint !== trainingPreflight.engineFingerprint) throw new Error("Artifact report engine fingerprint does not match the current project.");
if (model.metadata?.decisionSafetyVersion !== trainingPreflight.version) throw new Error("Artifact does not contain the current decision-safety contract.");
if (!model.metadata?.qualityGate?.passed) throw new Error("Checkpoint metadata does not contain a passing model quality gate.");
assertFiniteWeights(checkpoint.weights);

if (args["verify-only"] === "true") {
  console.log(JSON.stringify({ verified: true, source, report: reportSource, modelSha256: report.modelSha256, engineFingerprint: trainingPreflight.engineFingerprint, qualityGate: report.qualityGate }, null, 2));
  process.exit(0);
}

const destination = path.resolve(args.output || "src/ai/checkpoints/neural-champion.json");
await mkdir(path.dirname(destination), { recursive: true });
let backup = null;
try {
  await stat(destination);
  backup = path.resolve("data/ai/backups", `neural-champion-${timestamp()}.json`);
  await mkdir(path.dirname(backup), { recursive: true });
  await copyFile(destination, backup);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, "utf8");
await rename(temporary, destination);
console.log(JSON.stringify({
  applied: true, source, report: reportSource, destination, backup,
  generation: model.generation, gamesTrained: model.gamesTrained,
  cardPoolId: model.knowledge.cardPoolId,
  validation: model.metadata.validation || null
}, null, 2));

async function findModel(target) {
  const details = await stat(target);
  if (details.isFile()) return target;
  const names = await readdir(target, { recursive: true });
  const candidates = names.filter((name) => path.basename(name) === "neural-champion.json");
  if (candidates.length !== 1) throw new Error(`Expected exactly one neural-champion.json in ${target}, found ${candidates.length}`);
  return path.join(target, candidates[0]);
}

async function findReport(target) {
  const names = await readdir(target, { recursive: true });
  const candidates = names.filter((name) => path.basename(name) === "run-report.json");
  if (candidates.length !== 1) throw new Error(`Expected exactly one run-report.json in ${target}, found ${candidates.length}`);
  return path.join(target, candidates[0]);
}

function assertFiniteWeights(weights) {
  for (const [layer, tensors] of Object.entries(weights || {})) {
    for (const [index, tensor] of tensors.entries()) {
      if (!Array.isArray(tensor.values) || !tensor.values.every(Number.isFinite)) throw new Error(`Checkpoint contains non-finite weights at ${layer}[${index}].`);
      const expected = tensor.shape.reduce((product, value) => product * value, 1);
      if (tensor.values.length !== expected) throw new Error(`Checkpoint weight shape mismatch at ${layer}[${index}].`);
    }
  }
}

function sha256(content) { return `sha256:${createHash("sha256").update(content).digest("hex")}`; }

function parseArgs(values) { const parsed = {}; for (let index = 0; index < values.length; index += 1) if (values[index].startsWith("--")) parsed[values[index].slice(2)] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : "true"; return parsed; }
function timestamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
