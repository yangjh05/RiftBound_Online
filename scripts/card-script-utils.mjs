import fs from "node:fs";
import path from "node:path";
import { DOMAINS } from "../src/cards.mjs";
import { effectDefinition } from "../src/effects/registry.mjs";

export const VALID_TYPES = new Set(["unit", "spell", "gear", "battlefield", "legend", "rune"]);
export const VALID_DOMAINS = new Set(Object.values(DOMAINS));

export function parseArgs(argv) {
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

export function camelCase(value) {
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

export function uniqueKey(baseKey, usedKeys) {
  let key = baseKey;
  let suffix = 2;
  while (usedKeys.has(key)) {
    key = `${baseKey}${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key);
  return key;
}

export function listArg(value) {
  if (!value || value === true) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeDomain(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return Object.values(DOMAINS).find((domain) => domain.toLowerCase() === normalized) || null;
}

export function normalizeDomains(values) {
  return listArg(values).map(normalizeDomain).filter(Boolean);
}

export function normalizePower(rawPower) {
  if (!rawPower) return [];
  if (Array.isArray(rawPower)) {
    return rawPower.map((item) => ({
      domain: normalizeDomain(item.domain) || item.domain,
      amount: Number(item.amount ?? 1)
    }));
  }
  return listArg(rawPower).map((item) => {
    const [domain, amount = "1"] = item.split(":").map((part) => part.trim());
    return { domain: normalizeDomain(domain) || domain, amount: Number(amount) };
  });
}

export function normalizeEffects(rawEffects) {
  if (!rawEffects) return [];
  if (Array.isArray(rawEffects)) return rawEffects;
  if (typeof rawEffects === "string") {
    const trimmed = rawEffects.trim();
    if (!trimmed) return [];
    return JSON.parse(trimmed);
  }
  return [];
}

export function normalizeCardInput(input) {
  const collectorNumber = String(input.collectorNumber || input.cardNumber || input.number || "").trim();
  const id = String(input.id || collectorNumber.split("/")[0] || "").trim();
  const type = normalizeType(input.type);
  const domains = normalizeDomains(input.domains || input.domain || input.colors || input.color);
  const power = normalizePower(input.power);
  const effects = normalizeEffects(input.effects);
  const card = {
    id,
    collectorNumber,
    cardNumber: String(input.cardNumber || collectorNumber).trim(),
    name: String(input.name || "").trim(),
    type,
    set: String(input.set || input.expansion || input.product || "TODO").trim(),
    rarity: String(input.rarity || "TODO").trim(),
    domains,
    tags: listArg(input.tags || input.tag || input.subtypes || input.subtype),
    keywords: listArg(input.keywords || input.keyword),
    power,
    image: String(input.image || input.imageUrl || input.image_url || "").trim(),
    text: String(input.text || input.oracleText || input.oracle_text || "").trim(),
    effects,
    implementationReference: String(input.implementationReference || input.referenceCard || "").trim(),
    implementationReferences: normalizeImplementationReferences(input.implementationReferences)
  };
  if (input.energy !== undefined && input.energy !== "") card.energy = Number(input.energy);
  if (input.might !== undefined && input.might !== "") card.might = Number(input.might);
  if (input.isChampion !== undefined) card.isChampion = Boolean(input.isChampion);
  return card;
}

export function validateImportCard(card, { allowUnsupportedEffects = false } = {}) {
  const errors = [];
  if (!card.name) errors.push("missing name");
  if (!card.collectorNumber) errors.push(`${card.name || "card"}: missing collectorNumber`);
  if (!card.cardNumber) errors.push(`${card.name || "card"}: missing cardNumber`);
  if (!VALID_TYPES.has(card.type)) errors.push(`${card.name || card.cardNumber}: invalid type '${card.type}'`);
  for (const domain of card.domains) {
    if (!VALID_DOMAINS.has(domain)) errors.push(`${card.name}: invalid domain '${domain}'`);
  }
  for (const [index, cost] of card.power.entries()) {
    if (!VALID_DOMAINS.has(cost.domain)) errors.push(`${card.name}: power[${index}] has invalid domain '${cost.domain}'`);
    if (!Number.isFinite(cost.amount) || cost.amount < 0) errors.push(`${card.name}: power[${index}] has invalid amount '${cost.amount}'`);
  }
  if (["unit", "spell", "gear"].includes(card.type) && !Number.isFinite(card.energy)) {
    errors.push(`${card.name}: ${card.type} card needs numeric energy`);
  }
  if (card.type === "unit" && !Number.isFinite(card.might)) errors.push(`${card.name}: unit card needs numeric might`);
  if (card.type !== "rune" && !card.image) errors.push(`${card.name}: non-rune card needs image`);
  for (const [index, effect] of card.effects.entries()) {
    if (!effect?.timing || !effect?.kind) {
      errors.push(`${card.name}: effects[${index}] needs timing and kind`);
      continue;
    }
    if (!allowUnsupportedEffects && !effectDefinition(effect)) {
      errors.push(`${card.name}: unsupported effect ${effect.timing}:${effect.kind}`);
    }
  }
  return errors;
}

export function buildCardSource(data) {
  const needsDomains = data.domains.length || data.power.length;
  const importLine = needsDomains ? `import { card, DOMAINS } from "./shared.mjs";` : `import { card } from "./shared.mjs";`;
  const fields = [
    jsField("id", data.id),
    jsField("collectorNumber", data.collectorNumber),
    data.cardNumber && data.cardNumber !== data.collectorNumber ? jsField("cardNumber", data.cardNumber) : null,
    jsField("name", data.name),
    jsField("type", data.type),
    jsField("set", data.set),
    jsField("rarity", data.rarity),
    jsField("domains", `[${data.domains.map(domainConstant).join(", ")}]`, true),
    jsField("tags", data.tags),
    jsField("keywords", data.keywords),
    Number.isFinite(data.energy) ? jsField("energy", data.energy, true) : null,
    jsField("power", `[${data.power.map((cost) => `{ domain: ${domainConstant(cost.domain)}, amount: ${cost.amount} }`).join(", ")}]`, true),
    Number.isFinite(data.might) ? jsField("might", data.might, true) : null,
    data.isChampion ? jsField("isChampion", true, true) : null,
    jsField("image", data.image),
    jsField("text", data.text),
    data.implementationReference ? jsField("implementationReference", data.implementationReference) : null,
    Object.keys(data.implementationReferences || {}).length ? jsField("implementationReferences", data.implementationReferences) : null,
    jsField("effects", JSON.stringify(data.effects, null, 2), true)
  ].filter(Boolean);

  return `${importLine}

export default card({
${fields.map((line) => `  ${line}`).join(",\n")}
});
`;
}

function normalizeImplementationReferences(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    return JSON.parse(trimmed);
  }
  return {};
}

export function registerCards(cardsIndexPath, registrations) {
  let source = fs.readFileSync(cardsIndexPath, "utf8");
  const imports = [...source.matchAll(/^import\s+(\w+)\s+from "\.\/cards\/([^"]+\.mjs)";$/gm)];
  const importedKeys = new Set(imports.map((match) => match[1]));
  const lastImport = imports.at(-1);
  if (!lastImport) throw new Error("Could not find card import block in src/cards.mjs.");
  let importInsertAt = lastImport.index + lastImport[0].length;
  for (const { key, fileName } of registrations) {
    if (importedKeys.has(key)) continue;
    const importLine = `import ${key} from "./cards/${fileName}";`;
    source = `${source.slice(0, importInsertAt)}\n${importLine}${source.slice(importInsertAt)}`;
    importInsertAt += importLine.length + 1;
    importedKeys.add(key);
  }

  const exportStart = source.indexOf("export const cards = {");
  const exportEnd = source.indexOf("\n};", exportStart);
  if (exportStart < 0 || exportEnd < 0) throw new Error("Could not find export const cards block in src/cards.mjs.");
  const block = source.slice(exportStart, exportEnd);
  const missingKeys = registrations.map((item) => item.key).filter((key) => !new RegExp(`\\b${key}\\b`).test(block));
  if (missingKeys.length) {
    const needsComma = /,\s*$/.test(block.trim());
    const prefix = needsComma ? "" : ",";
    source = `${source.slice(0, exportEnd)}${prefix}\n  ${missingKeys.join(",\n  ")}${source.slice(exportEnd)}`;
  }
  fs.writeFileSync(cardsIndexPath, source, "utf8");
}

export function existingCardImports(cardsIndexPath) {
  const source = fs.readFileSync(cardsIndexPath, "utf8");
  return new Map([...source.matchAll(/^import\s+(\w+)\s+from "\.\/cards\/([^"]+\.mjs)";$/gm)].map((match) => [match[1], match[2]]));
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (normalized === "battlefield" || normalized === "battlefields") return "battlefield";
  if (normalized === "legend") return "legend";
  if (normalized === "unit" || normalized === "champion") return "unit";
  if (normalized === "spell") return "spell";
  if (normalized === "gear" || normalized === "equipment") return "gear";
  if (normalized === "rune") return "rune";
  return normalized;
}

function jsField(name, value, raw = false) {
  return `${name}: ${raw ? value : JSON.stringify(value)}`;
}

function domainConstant(domain) {
  const normalized = String(domain || "").trim().toUpperCase();
  if (!normalized) return "DOMAINS.ANY";
  return `DOMAINS.${normalized}`;
}
