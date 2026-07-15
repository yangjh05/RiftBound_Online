import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EFFECT_TIMINGS, effectDefinition } from "../src/effects/registry.mjs";
import { cards } from "../src/cards.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cardsDir = path.join(root, "src", "cards");
const cardsIndexPath = path.join(root, "src", "cards.mjs");

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args.dryRun || args["dry-run"]);

if (args.help || !args.name || !args.number || !args.type) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const key = args.key || camelCase(args.name);
const fileName = `${key}.mjs`;
const filePath = path.join(cardsDir, fileName);

if (!/^[a-z][A-Za-z0-9]*$/.test(key)) {
  throw new Error(`Invalid key '${key}'. Use lower camelCase, for example masterYiTempered.`);
}
if (fs.existsSync(filePath) && !args.force) {
  throw new Error(`Card file already exists: ${path.relative(root, filePath)}. Pass --force to overwrite.`);
}
if ((args.timing && !args.kind) || (!args.timing && args.kind)) {
  throw new Error("Pass both --timing and --kind, or neither.");
}
if (args.timing && !EFFECT_TIMINGS.includes(args.timing)) {
  throw new Error(`Unknown effect timing '${args.timing}'. Supported timings: ${EFFECT_TIMINGS.join(", ")}`);
}
if (args.timing && args.kind && !effectDefinition({ timing: args.timing, kind: args.kind })) {
  throw new Error(`Unsupported effect '${args.timing}:${args.kind}'. Add it to src/effects/registry.mjs and src/engine.mjs before scaffolding this card.`);
}

const explicitReference = args.reference ? findReferenceCard(args.reference) : null;
if (args.reference && !explicitReference) {
  throw new Error(`Unknown reference card '${args.reference}'. Use a cards registry key, card number, collector number, or exact card name.`);
}
if (explicitReference && explicitReference.type !== args.type) {
  throw new Error(`Reference card ${explicitReference.name} is a ${explicitReference.type}, not ${args.type}.`);
}
const automaticReference = !explicitReference && args.timing && args.kind
  ? Object.values(cards).find((candidate) => candidate.type === args.type
    && candidate.effects?.some((effect) => effect.timing === args.timing && effect.kind === args.kind))
  : null;
const referenceCard = explicitReference || automaticReference;
const scaffoldEffects = explicitReference && !args.timing
  ? structuredClone(explicitReference.effects || [])
  : args.timing && args.kind
    ? [{ timing: args.timing, kind: args.kind, ...(args["text-section"] ? { textSection: args["text-section"] } : {}) }]
    : [];

const cardSource = buildCardSource({
  id: args.id || String(args.number).split("/")[0],
  collectorNumber: args.number,
  name: args.name,
  type: args.type,
  set: args.set || "TODO",
  rarity: args.rarity || "TODO",
  domains: listArg(args.domain || args.domains),
  tags: listArg(args.tag || args.tags),
  keywords: listArg(args.keyword || args.keywords),
  energy: args.energy,
  power: parsePower(args.power),
  might: args.might,
  image: args.image || "",
  text: args.text || "TODO: paste exact card text.",
  effects: scaffoldEffects,
  implementationReferences: referenceCard
    ? Object.fromEntries(scaffoldEffects.map((effect) => [`${effect.timing}:${effect.kind}`, referenceCard.cardNumber]))
    : {}
});

if (dryRun) {
  console.log(`Would write ${path.relative(root, filePath)}:\n`);
  console.log(cardSource);
  console.log(`\nWould register '${key}' in src/cards.mjs.`);
  process.exit(0);
}

fs.writeFileSync(filePath, cardSource, "utf8");
registerCard(key, fileName);
console.log(`Created ${path.relative(root, filePath)} and registered '${key}' in src/cards.mjs.`);
console.log("Next: fill exact text/effects, add focused engine tests, then run `npm run check`.");
if (args.timing === "onMove") {
  console.log("This card will automatically join the movement interaction matrix in `npm run interactions` (also included by `npm run check`).");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const raw = token.slice(2);
    const [name, inlineValue] = raw.split(/=(.*)/s);
    const value = inlineValue !== undefined ? inlineValue : argv[index + 1]?.startsWith("--") ? true : argv[++index] ?? true;
    if (result[name] === undefined) result[name] = value;
    else result[name] = `${result[name]},${value}`;
  }
  return result;
}

function printHelp() {
  console.log(`
Create and register a Riftbound card module.

Required:
  --name "Card Name"
  --number "OGN-001/298"
  --type unit|spell|gear|battlefield|legend

Common options:
  --key lowerCamelCaseName
  --set Origins
  --rarity Common
  --domain Calm,Body
  --tag Reaction,Equipment
  --keyword Hidden
  --energy 2
  --power Any:1,Body:1
  --might 3
  --image https://...
  --text "Exact card text"
  --timing spell
  --kind moveUnit
  --text-section rules|effect|mightBonus
  --reference "OGN-001/298"
  --dry-run
  --force

Example:
  npm run new:card -- --name "Example Spell" --number "OGN-001/298" --type spell --set Origins --rarity Common --domain Calm --energy 1 --power Any:1 --timing spell --kind moveUnit --dry-run

Tip:
  Supported effect timings and kinds are registered in src/effects/registry.mjs.
  --reference copies all effects from a same-type existing card when timing/kind are omitted.
  When timing/kind already match an existing card, the generator records that card as the implementation reference automatically.
`.trim());
}

function camelCase(value) {
  const words = String(value)
    .replace(/['’]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.charAt(0).toLowerCase() + word.slice(1);
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

function listArg(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePower(value) {
  return listArg(value).map((item) => {
    const [domain, amount = "1"] = item.split(":").map((part) => part.trim());
    return { domain, amount: Number(amount) };
  });
}

function buildCardSource(data) {
  const needsDomains = data.domains.length || data.power.length;
  const importLine = needsDomains ? `import { card, DOMAINS } from "./shared.mjs";` : `import { card } from "./shared.mjs";`;
  const fields = [
    jsField("id", data.id),
    jsField("collectorNumber", data.collectorNumber),
    jsField("name", data.name),
    jsField("type", data.type),
    jsField("set", data.set),
    jsField("rarity", data.rarity),
    jsField("domains", `[${data.domains.map(domainConstant).join(", ")}]`, true),
    jsField("tags", data.tags),
    jsField("keywords", data.keywords),
    Number.isFinite(Number(data.energy)) ? jsField("energy", Number(data.energy), true) : null,
    jsField("power", `[${data.power.map((cost) => `{ domain: ${domainConstant(cost.domain)}, amount: ${cost.amount} }`).join(", ")}]`, true),
    Number.isFinite(Number(data.might)) ? jsField("might", Number(data.might), true) : null,
    jsField("image", data.image),
    jsField("text", data.text),
    Object.keys(data.implementationReferences || {}).length ? jsField("implementationReferences", data.implementationReferences) : null,
    jsField("effects", buildEffects(data), true)
  ].filter(Boolean);

  return `${importLine}

export default card({
${fields.map((line) => `  ${line}`).join(",\n")}
});
`;
}

function buildEffects(data) {
  return JSON.stringify(data.effects || [], null, 2).replace(/^/gm, "  ").trimStart();
}

function findReferenceCard(reference) {
  const normalized = String(reference).trim().toLowerCase();
  const keyed = Object.entries(cards).find(([key]) => key.toLowerCase() === normalized)?.[1];
  if (keyed) return keyed;
  return Object.values(cards).find((candidate) => [candidate.cardNumber, candidate.collectorNumber, candidate.name]
    .some((value) => String(value || "").toLowerCase() === normalized)) || null;
}

function jsField(name, value, raw = false) {
  return `${name}: ${raw ? value : JSON.stringify(value)}`;
}

function domainConstant(domain) {
  const normalized = String(domain || "").trim().toUpperCase();
  if (!normalized) return "DOMAINS.ANY";
  return `DOMAINS.${normalized}`;
}

function registerCard(keyToRegister, fileToRegister) {
  let source = fs.readFileSync(cardsIndexPath, "utf8");
  const importLine = `import ${keyToRegister} from "./cards/${fileToRegister}";`;
  if (!source.includes(importLine)) {
    const lastImport = [...source.matchAll(/^import .+ from "\.\/cards\/.+\.mjs";$/gm)].at(-1);
    if (!lastImport) throw new Error("Could not find card import block in src/cards.mjs.");
    const insertAt = lastImport.index + lastImport[0].length;
    source = `${source.slice(0, insertAt)}\n${importLine}${source.slice(insertAt)}`;
  }

  const exportStart = source.indexOf("export const cards = {");
  const exportEnd = source.indexOf("\n};", exportStart);
  if (exportStart < 0 || exportEnd < 0) throw new Error("Could not find export const cards block in src/cards.mjs.");
  const block = source.slice(exportStart, exportEnd);
  if (!new RegExp(`\\b${keyToRegister}\\b`).test(block)) {
    const needsComma = /,\s*$/.test(block.trim());
    const prefix = needsComma ? "" : ",";
    source = `${source.slice(0, exportEnd)}${prefix}\n  ${keyToRegister}${source.slice(exportEnd)}`;
  }

  fs.writeFileSync(cardsIndexPath, source, "utf8");
}
