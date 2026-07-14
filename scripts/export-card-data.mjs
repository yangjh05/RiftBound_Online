import path from "node:path";
import { fileURLToPath } from "node:url";
import { cards } from "../src/cards.mjs";
import { parseArgs, writeJson } from "./card-script-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const output = path.resolve(root, String(args.output || "tmp/card-export.json"));

const exported = Object.values(cards)
  .sort((left, right) => left.cardNumber.localeCompare(right.cardNumber, "en", { numeric: true }))
  .map((card) => ({
    id: card.id,
    collectorNumber: card.collectorNumber,
    cardNumber: card.cardNumber,
    name: card.name,
    type: card.type,
    set: card.set,
    rarity: card.rarity,
    domains: card.domains || [],
    tags: card.tags || [],
    keywords: card.keywords || [],
    energy: card.energy,
    power: card.power || [],
    might: card.might,
    isChampion: card.isChampion || undefined,
    image: card.image || "",
    text: card.text || "",
    effects: card.effects || []
  }));

writeJson(output, { cards: exported });
console.log(`Exported ${exported.length} card(s) to ${path.relative(root, output)}.`);
