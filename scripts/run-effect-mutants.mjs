import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cards } from "../src/cards.mjs";
import { effectKey } from "../src/effects/registry.mjs";
import { KEYWORD_BEHAVIOR_EFFECT_SPECS, keywordBehaviorEffectSpecs } from "../src/rules/keywords.mjs";
import { parseArgs, writeJson } from "./card-script-utils.mjs";
import { runCardRuleBehaviorProbes } from "./card-rules-probes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = path.join(ROOT, "scripts", "effect-mutant-probe-worker.mjs");
const BASELINE_PATH = path.join(ROOT, "spec", "cards", "effect-mutation-baseline.json");
const REPORT_PATH = path.join(ROOT, "artifacts", "effect-mutation-report.json");
const TEST_DIR = path.join(ROOT, "tests");
const args = parseArgs(process.argv.slice(2));
const concurrency = Math.max(1, Math.min(8, Number(args.concurrency) || 4));

const cardPool = Object.values(cards);
const usedEffectKeys = [...new Set([
  ...cardPool.flatMap((card) => cardBehaviorEffects(card).map(effectKey)),
  ...KEYWORD_BEHAVIOR_EFFECT_SPECS.map(effectKey)
])].sort();
const probeResults = await runCardRuleBehaviorProbes();
const independentKeys = new Set(probeResults.flatMap((probe) => probe.covers || []));
const testIndex = readTestIndex();
const focusedEvidence = focusedEvidenceByEffect(Object.entries(cards), testIndex);

const entries = usedEffectKeys.map((key) => ({
  effectKey: key,
  harness: independentKeys.has(key) ? "independent-probe" : focusedEvidence.has(key) ? "focused-tests" : "none",
  evidence: independentKeys.has(key)
    ? probeResults.filter((probe) => probe.covers?.includes(key)).map((probe) => probe.id)
    : [...(focusedEvidence.get(key) || [])].map((entry) => entry.name)
}));
const executable = entries.filter((entry) => entry.harness !== "none");
const results = [];
let completed = 0;

await runPool(executable, concurrency, async (entry) => {
  const result = entry.harness === "independent-probe"
    ? await runIndependentMutant(entry)
    : await runFocusedMutant(entry, focusedEvidence.get(entry.effectKey));
  results.push(result);
  completed += 1;
  if (completed % 20 === 0 || completed === executable.length) {
    console.log(`Effect mutation progress: ${completed}/${executable.length}`);
  }
});

for (const entry of entries.filter((candidate) => candidate.harness === "none")) {
  results.push({ ...entry, status: "no-evidence", durationMs: 0 });
}
results.sort((left, right) => left.effectKey.localeCompare(right.effectKey));

const summary = {
  total: results.length,
  executed: results.filter((result) => !["no-evidence", "invalid"].includes(result.status)).length,
  killed: results.filter((result) => result.status === "killed").length,
  survived: results.filter((result) => result.status === "survived").length,
  noEvidence: results.filter((result) => result.status === "no-evidence").length,
  invalid: results.filter((result) => result.status === "invalid").length
};
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), concurrency, summary, results };
writeJson(args.output ? path.resolve(ROOT, String(args.output)) : REPORT_PATH, report);

if (args.update || args["update-baseline"]) {
  if (summary.invalid) {
    console.error(`Refusing to update the effect mutation baseline with ${summary.invalid} invalid harness result(s).`);
    process.exitCode = 1;
  } else {
    writeJson(BASELINE_PATH, {
      schemaVersion: 1,
      policy: "A killed effect mutant may never regress; new effects must be killed by independent evidence.",
      results: results.map(({ effectKey: key, status, harness }) => ({ effectKey: key, status, harness }))
    });
    console.log(`Updated effect mutation baseline: ${summary.killed} killed, ${summary.survived} survived, ${summary.noEvidence} without executable evidence.`);
  }
} else {
  const errors = validateBaseline(results, readBaseline());
  if (summary.invalid) errors.push(`${summary.invalid} mutation harness result(s) were invalid.`);
  if (errors.length) {
    console.error(`Effect mutation regression (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Effect mutants: killed ${summary.killed}/${summary.executed} executed; ${summary.survived} survived and ${summary.noEvidence} lack executable evidence. Report: ${path.relative(ROOT, REPORT_PATH)}`);
  }
}

async function runIndependentMutant(entry) {
  const started = Date.now();
  const run = await runChild([WORKER, entry.effectKey], 30000, entry.effectKey);
  const parsed = lastJsonLine(run.stdout);
  if (!parsed || run.timedOut || run.status !== 0) {
    return { ...entry, status: "invalid", durationMs: Date.now() - started, detail: tail(`${run.stdout}\n${run.stderr}`) };
  }
  return { ...entry, status: parsed.status, durationMs: Date.now() - started, failedEvidence: parsed.failed || [] };
}

async function runFocusedMutant(entry, evidence) {
  const started = Date.now();
  const selected = [...evidence].slice(0, 32);
  const files = [...new Set(selected.map((item) => item.file))];
  const pattern = `^(?:${selected.map((item) => escapeRegex(item.name)).join("|")})$`;
  const run = await runChild(["--test", `--test-name-pattern=${pattern}`, ...files], 45000, entry.effectKey);
  const output = `${run.stdout}\n${run.stderr}`;
  const invalid = run.timedOut || /SyntaxError|ERR_MODULE_NOT_FOUND|ReferenceError/.test(output) || (run.status !== 0 && !/not ok/i.test(output));
  return {
    ...entry,
    evidence: selected.map((item) => item.name),
    status: invalid ? "invalid" : run.status === 0 ? "survived" : "killed",
    durationMs: Date.now() - started,
    detail: invalid ? tail(output) : undefined
  };
}

function runChild(childArgs, timeoutMs = 30000, mutationKey = "") {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: ROOT,
      env: {
        ...process.env,
        RIFTBOUND_EFFECT_MUTATION_MODE: "1",
        RIFTBOUND_EFFECT_MUTATION_KEY: mutationKey
      },
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

async function runPool(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function focusedEvidenceByEffect(cardEntries, index) {
  const result = new Map();
  for (const [cardKey, card] of cardEntries) {
    const matches = index.filter((entry) =>
      normalize(entry.name).includes(normalize(card.name))
      || entry.cardKeys?.has(cardKey)
    );
    if (!matches.length) continue;
    for (const effect of cardBehaviorEffects(card)) {
      const key = effectKey(effect);
      if (!result.has(key)) result.set(key, new Map());
      for (const match of matches) result.get(key).set(`${match.file}:${match.name}`, match);
    }
  }
  return new Map([...result].map(([key, matches]) => [key, new Set(matches.values())]));
}

function cardBehaviorEffects(card) {
  return [...(card.effects || []), ...keywordBehaviorEffectSpecs(card)];
}

function readTestIndex() {
  return fs.readdirSync(TEST_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .flatMap((entry) => {
      const file = path.join(TEST_DIR, entry.name);
      const source = fs.readFileSync(file, "utf8");
      const matches = [...source.matchAll(/\btest\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)/g)];
      return matches.map((match, index) => {
        const body = source.slice(match.index, matches[index + 1]?.index ?? source.length);
        return {
          name: match[1] ?? match[2] ?? match[3],
          file,
          cardKeys: new Set([...body.matchAll(/\bcards\.([A-Za-z0-9_$]+)/g)].map((reference) => reference[1]))
        };
      });
    });
}

function validateBaseline(current, baseline) {
  if (!baseline?.results?.length) return ["Effect mutation baseline is missing or empty."];
  const rank = { "no-evidence": 0, survived: 1, killed: 2 };
  const previous = new Map(baseline.results.map((entry) => [entry.effectKey, entry]));
  const errors = [];
  for (const result of current) {
    const expected = previous.get(result.effectKey);
    if (!expected) {
      if (result.status !== "killed") errors.push(`New effect ${result.effectKey} is not killed by executable evidence (${result.status}).`);
      continue;
    }
    if ((rank[result.status] ?? -1) < (rank[expected.status] ?? -1)) {
      errors.push(`${result.effectKey} regressed from ${expected.status} to ${result.status}.`);
    }
  }
  return errors;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { schemaVersion: 1, results: [] };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
}

function lastJsonLine(output) {
  for (const line of String(output).trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line); } catch { /* keep looking */ }
  }
  return null;
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tail(value) {
  return String(value).trim().split(/\r?\n/).slice(-16).join("\n");
}
