import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { deserializeNeuralModel } from "../src/ai/neural/model.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.input) throw new Error("Usage: npm run ai:bootstrap:apply -- --input <artifact directory or neural-champion.json>");
const input = path.resolve(args.input);
const source = await findModel(input);
const checkpoint = JSON.parse(await readFile(source, "utf8"));
const model = deserializeNeuralModel(checkpoint);
if (model.metadata?.stage !== "bootstrap-complete") throw new Error(`Artifact is not a completed bootstrap checkpoint: ${model.metadata?.stage || "unknown stage"}`);
if (model.generation !== 0) throw new Error(`Bootstrap checkpoint must be generation 0, received ${model.generation}`);
if (model.knowledge?.cardPoolId !== "origins-era") throw new Error(`Expected origins-era card pool, received ${model.knowledge?.cardPoolId || "unknown"}`);

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
  applied: true, source, destination, backup,
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

function parseArgs(values) { const parsed = {}; for (let index = 0; index < values.length; index += 1) if (values[index].startsWith("--")) parsed[values[index].slice(2)] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : "true"; return parsed; }
function timestamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
