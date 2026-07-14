import path from "node:path";
import { fileURLToPath } from "node:url";
import { cards } from "../src/cards.mjs";
import { effectDefinition, effectKey } from "../src/effects/registry.mjs";
import { parseArgs, writeJson } from "./card-script-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const output = args.output ? path.resolve(root, String(args.output)) : null;
const rows = [];
const summary = new Map();

for (const card of Object.values(cards).sort((left, right) => left.cardNumber.localeCompare(right.cardNumber, "en", { numeric: true }))) {
  if (!card.effects?.length) {
    rows.push(rowFor(card, null));
    increment("no-effect-spec");
    continue;
  }
  for (const effect of card.effects) {
    const key = effectKey(effect);
    rows.push(rowFor(card, effect));
    increment(effectDefinition(effect) ? key : `unsupported:${key}`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  cardCount: Object.keys(cards).length,
  rowCount: rows.length,
  summary: Object.fromEntries([...summary.entries()].sort(([left], [right]) => left.localeCompare(right))),
  rows
};

if (output) {
  writeJson(output, report);
  console.log(`Wrote effect audit for ${report.cardCount} card(s) to ${path.relative(root, output)}.`);
} else {
  console.log(JSON.stringify(report, null, 2));
}

function rowFor(card, effect) {
  const key = effect ? effectKey(effect) : "";
  return {
    cardNumber: card.cardNumber,
    name: card.name,
    type: card.type,
    set: card.set,
    rarity: card.rarity,
    domains: card.domains || [],
    tags: card.tags || [],
    keywords: card.keywords || [],
    timing: effect?.timing || "",
    kind: effect?.kind || "",
    effectKey: key,
    supported: effect ? Boolean(effectDefinition(effect)) : true,
    target: effect?.target || "",
    targetProvider: effect ? effectDefinition(effect)?.targetProvider || "" : "",
    targetless: effect ? Boolean(effectDefinition(effect)?.targetless) : false,
    status: effect ? "implemented-spec" : statusForNoEffect(card)
  };
}

function statusForNoEffect(card) {
  if (card.type === "rune") return "rune-resource";
  if (!card.text?.trim()) return "missing-text";
  if (card.text.trim() === "-") return "textless-card";
  if (isKeywordOnlyCard(card)) return "implemented-keyword";
  return "needs-review";
}

function isKeywordOnlyCard(card) {
  if (!card.keywords?.length) return false;
  let text = card.text
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(action|reaction)\b/gi, " ")
    .replace(/\bplay any time, even before spells and abilities resolve, including to a battlefield you control\b/gi, " ");

  for (const keyword of card.keywords) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
  }

  return !text.replace(/[^a-z0-9]+/gi, "").trim();
}

function increment(key) {
  summary.set(key, (summary.get(key) || 0) + 1);
}
