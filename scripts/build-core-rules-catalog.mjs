import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "spec", "rules", "core-rules-catalog-2026-03-30.json");
const RULE_LINE = /^\s*(\d{3}(?:(?:\.\d+)|(?:\.[a-z]))*)\.\s+(.*)$/;
const IGNORED_LINES = [/^Riftbound Core Rules$/i, /^Last Updated:/i];

const args = parseArgs(process.argv.slice(2));
const input = path.resolve(args.input || "");
const output = path.resolve(args.output || DEFAULT_OUTPUT);
if (!args.input || !fs.existsSync(input)) {
  console.error("Usage: node scripts/build-core-rules-catalog.mjs --input <clean-pages.json> [--output <catalog.json>]");
  process.exit(1);
}

const pages = JSON.parse(fs.readFileSync(input, "utf8"));
const clauses = parseClauses(pages);
const ids = new Set(clauses.map((clause) => clause.id));
for (const clause of clauses) {
  clause.leaf = !clauses.some((candidate) => candidate.id.startsWith(`${clause.id}.`));
  clause.chapter = chapterFor(clause.id);
  clause.modeScope = modeScopeFor(clause.id);
}

const duplicates = clauses.filter((clause, index) => clauses.findIndex((candidate) => candidate.id === clause.id) !== index);
if (duplicates.length || ids.size !== clauses.length) {
  throw new Error(`Core Rules extraction contains duplicate IDs: ${[...new Set(duplicates.map((entry) => entry.id))].join(", ")}`);
}

const normalizedText = clauses.map((clause) => `${clause.id}\t${clause.text}`).join("\n");
const catalog = {
  schemaVersion: 1,
  rulesVersion: "2026-03-30",
  source: {
    authority: "Riot Games / Riftbound",
    title: "Riftbound Core Rules",
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/861747d1d4d505b7c14d73aba9749d1c3a209a67.pdf",
    rulesHub: "https://playriftbound.com/en-us/rules-hub/",
    sha256: "3733EAFFA8B412CE37458D62E7CD22AA93D59F0A6925241BCE5B0B5FD5ED1878",
    pageCount: pages.length,
    normalizedTextSha256: crypto.createHash("sha256").update(normalizedText).digest("hex").toUpperCase()
  },
  inventory: {
    clauseCount: clauses.length,
    leafClauseCount: clauses.filter((clause) => clause.leaf).length,
    duelApplicableClauseCount: clauses.filter((clause) => clause.modeScope !== "other-mode").length,
    duelApplicableLeafClauseCount: clauses.filter((clause) => clause.leaf && clause.modeScope !== "other-mode").length
  },
  clauses
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${clauses.length} unique Core Rules clauses (${catalog.inventory.leafClauseCount} leaves) to ${path.relative(ROOT, output)}.`);

function parseClauses(pages) {
  const clauses = [];
  for (const page of pages) {
    for (const rawLine of String(page.text || "").split(/\r?\n/)) {
      const line = normalizeText(rawLine);
      if (!line || IGNORED_LINES.some((pattern) => pattern.test(line))) continue;
      const match = RULE_LINE.exec(line);
      if (match) {
        clauses.push({ id: match[1], page: page.page, text: normalizeText(match[2]) });
      } else if (clauses.length) {
        clauses.at(-1).text = normalizeText(`${clauses.at(-1).text} ${line}`);
      }
    }
  }
  return clauses;
}

function normalizeText(value) {
  return String(value)
    .replace(/[\uFB00-\uFB06]/g, (character) => ({
      "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"
    })[character] || character)
    .replace(/\s+/g, " ")
    .trim();
}

function chapterFor(id) {
  const numeric = Number(id.slice(0, 3));
  if (numeric < 100) return "interpretation";
  if (numeric < 300) return "game-concepts";
  if (numeric < 468) return "gameplay-and-actions";
  if (numeric < 700) return "layers-modes-and-ending";
  if (numeric < 800) return "additional-rules";
  return "keywords";
}

function modeScopeFor(id) {
  const numeric = Number(id.slice(0, 3));
  if (["315.2.b.3", "316.2.b.1"].includes(id)) return "other-mode";
  if (numeric >= 482 && numeric <= 484) return "other-mode";
  if (numeric === 480 || numeric === 481) return "duel-mode";
  return "general";
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) continue;
    parsed[values[index].slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}
