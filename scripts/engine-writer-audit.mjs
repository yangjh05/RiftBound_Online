import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENGINE_WRITER_BASELINE_PATH = path.join(ROOT, "spec", "engine", "writer-baseline.json");

const WRITER_PATTERNS = Object.freeze({
  zone: [
    /\.(?:hand|base|trash|banished|mainDeck|runeDeck|runes|units|hidden)\s*=(?!=)\s*/g,
    /\.(?:hand|base|trash|banished|mainDeck|runeDeck|runes|units|hidden)\.(?:push|pop|shift|unshift|splice)\s*\(/g,
    /\.zone\s*=(?!=)\s*/g
  ],
  resource: [
    /\.(?:score|xp)\s*(?:\+=|-=|\*=|\/=|=(?!=))/g,
    /\.runePool(?:\.[A-Za-z_$][\w$]*)?\s*=(?!=)\s*/g,
    /\.runePool\.[A-Za-z_$][\w$]*\.(?:push|pop|shift|unshift|splice)\s*\(/g
  ],
  choice: [
    /game\.pendingChoice\s*=(?!=)\s*/g,
    /game\.pendingPayment\s*=(?!=)\s*/g
  ],
  trigger: [
    /game\.triggerQueue\s*=(?!=)\s*/g,
    /game\.triggerQueue\.(?:push|pop|shift|unshift|splice)\s*\(/g,
    /game\.triggerQueueContinuation\s*=(?!=)\s*/g
  ],
  operation: [
    /game\.operations\s*=(?!=)\s*/g,
    /game\.operations\.(?:push|pop|shift|unshift|splice)\s*\(/g,
    /\.status\s*=\s*["'](?:pending|completed|cancelled)["']/g
  ]
});

export function analyzeEngineWriterInventory(source) {
  const functions = sourceFunctions(source);
  const categories = {};
  for (const [category, patterns] of Object.entries(WRITER_PATTERNS)) {
    const signatures = {};
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const owner = enclosingFunction(functions, match.index)?.name || "<module>";
        const normalized = match[0].replace(/\s+/g, " ").trim();
        const signature = `${owner}|${normalized}`;
        signatures[signature] = (signatures[signature] || 0) + 1;
      }
    }
    categories[category] = Object.fromEntries(Object.entries(signatures).sort(([left], [right]) => left.localeCompare(right)));
  }
  return { schemaVersion: 1, categories };
}

export function validateEngineWriterBaseline(inventory, baseline = readEngineWriterBaseline()) {
  if (!baseline?.categories) return ["Engine writer baseline is missing."];
  const errors = [];
  for (const [category, signatures] of Object.entries(inventory.categories || {})) {
    const allowed = baseline.categories?.[category] || {};
    for (const [signature, count] of Object.entries(signatures)) {
      const allowedCount = allowed[signature] || 0;
      if (count > allowedCount) {
        errors.push(`${category} writer '${signature}' appears ${count} time(s), above the reviewed allowance of ${allowedCount}.`);
      }
    }
  }
  return errors;
}

export function buildEngineWriterBaseline(inventory) {
  return {
    schemaVersion: 1,
    policy: "New direct zone, resource, choice, trigger, and operation writers require explicit architecture review.",
    categories: inventory.categories
  };
}

export function readEngineWriterBaseline() {
  if (!fs.existsSync(ENGINE_WRITER_BASELINE_PATH)) return { schemaVersion: 1, categories: null };
  return JSON.parse(fs.readFileSync(ENGINE_WRITER_BASELINE_PATH, "utf8"));
}

function sourceFunctions(source) {
  const rows = [...source.matchAll(/(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)]
    .map((match) => ({ name: match[1], start: match.index + match[0].lastIndexOf("function") }));
  for (let index = 0; index < rows.length; index += 1) rows[index].end = rows[index + 1]?.start ?? source.length;
  return rows;
}

function enclosingFunction(functions, index) {
  return functions.find((item) => item.start <= index && index < item.end) || null;
}
