import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cards as existingCards } from "../src/cards.mjs";
import {
  buildCardSource,
  camelCase,
  existingCardImports,
  normalizeCardInput,
  parseArgs,
  registerCards,
  uniqueKey,
  validateImportCard
} from "./card-script-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cardsDir = path.join(root, "src", "cards");
const cardsIndexPath = path.join(root, "src", "cards.mjs");
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.input) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const dryRun = Boolean(args.dryRun || args["dry-run"]);
const updateExisting = Boolean(args.update || args["update-existing"]);
const allowUnsupportedEffects = Boolean(args.allowUnsupportedEffects || args["allow-unsupported-effects"]);
const inputPath = path.resolve(root, String(args.input));
const inputCards = loadInputCards(inputPath).map(normalizeCardInput);
const existingByNumber = new Map(Object.values(existingCards).map((card) => [card.cardNumber, card]));
const existingImports = existingCardImports(cardsIndexPath);
const usedKeys = new Set(existingImports.keys());
const planned = [];
const errors = [];
const skipped = [];

for (const card of inputCards) {
  if (!card.implementationReference && !Object.keys(card.implementationReferences || {}).length) {
    card.implementationReferences = inferImplementationReferences(card);
  }
  const validationErrors = validateImportCard(card, { allowUnsupportedEffects });
  if (validationErrors.length) {
    errors.push(...validationErrors.map((error) => `${card.cardNumber || card.name}: ${error}`));
    continue;
  }

  const existing = existingByNumber.get(card.cardNumber);
  if (existing && !updateExisting) {
    skipped.push(`${card.cardNumber} ${card.name} already exists`);
    continue;
  }

  const baseKey = camelCase(card.name || card.cardNumber);
  const key = existing
    ? [...existingImports.entries()].find(([importKey]) => existingCards[importKey]?.cardNumber === card.cardNumber)?.[0] || uniqueKey(baseKey, usedKeys)
    : uniqueKey(baseKey, usedKeys);
  const fileName = `${key}.mjs`;
  planned.push({ key, fileName, card, existing: Boolean(existing) });
}

if (errors.length) {
  console.error(`Import validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

if (dryRun) {
  console.log(JSON.stringify({
    input: path.relative(root, inputPath),
    totalInput: inputCards.length,
    create: planned.filter((item) => !item.existing).length,
    update: planned.filter((item) => item.existing).length,
    skipped,
    planned: planned.map((item) => ({
      cardNumber: item.card.cardNumber,
      name: item.card.name,
      key: item.key,
      file: `src/cards/${item.fileName}`,
      mode: item.existing ? "update" : "create"
    }))
  }, null, 2));
  process.exit(0);
}

for (const item of planned) {
  fs.writeFileSync(path.join(cardsDir, item.fileName), buildCardSource(item.card), "utf8");
}
registerCards(cardsIndexPath, planned);

console.log(`Imported ${planned.length} card(s): ${planned.filter((item) => !item.existing).length} created, ${planned.filter((item) => item.existing).length} updated, ${skipped.length} skipped.`);
if (skipped.length) {
  console.log("Skipped:");
  for (const item of skipped) console.log(`- ${item}`);
}
console.log("Next: run `npm run check`.");

function inferImplementationReferences(card) {
  const references = {};
  for (const effect of card.effects || []) {
    const pair = `${effect.timing}:${effect.kind}`;
    const reference = Object.values(existingCards).find((candidate) => candidate.type === card.type
      && candidate.effects?.some((existingEffect) => existingEffect.timing === effect.timing && existingEffect.kind === effect.kind));
    if (reference) references[pair] = reference.cardNumber;
  }
  return references;
}

function loadInputCards(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, "utf8");
  if (ext === ".json") {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.cards)) return parsed.cards;
    throw new Error("JSON input must be an array or an object with a cards array.");
  }
  if (ext === ".csv" || ext === ".tsv") return parseDelimited(raw, ext === ".tsv" ? "\t" : ",");
  throw new Error("Supported input formats: .json, .csv, .tsv");
}

function parseDelimited(raw, delimiter) {
  const rows = parseRows(raw, delimiter).filter((row) => row.some((cell) => cell.trim()));
  const [headers, ...body] = rows;
  if (!headers?.length) return [];
  return body.map((row) => Object.fromEntries(headers.map((header, index) => [header.trim(), row[index] ?? ""])));
}

function parseRows(raw, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function printHelp() {
  console.log(`
Import many Riftbound cards from JSON, CSV, or TSV.

Required:
  --input data/cards.json

Options:
  --dry-run
  --update-existing
  --allow-unsupported-effects

JSON input can be either an array or { "cards": [...] }.
Recommended fields:
  collectorNumber, cardNumber, id, name, type, set, rarity, domains, tags,
  keywords, energy, power, might, image, text, effects, isChampion

Power can be [{ "domain": "Calm", "amount": 1 }] or "Calm:1,Any:1".
Effects must be valid registry specs unless --allow-unsupported-effects is passed.
`.trim());
}
