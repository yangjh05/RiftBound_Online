import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OFFICIAL_GALLERY_URL = "https://playriftbound.com/en-us/card-gallery/";
const DEFAULT_ERRATA_URL = "https://github.com/LouisCourrian/riftbound-cards/releases/download/v2026-08-11/cards.json";
const args = parseArgs(process.argv.slice(2));
const setId = String(args.set || "SFD").toUpperCase();
const outputPath = path.resolve(ROOT, String(args.output || `spec/cards/${setId.toLowerCase()}-official-${today()}.json`));
const errataUrl = String(args.errata || DEFAULT_ERRATA_URL);

const [galleryResponse, errataResponse] = await Promise.all([
  fetch(OFFICIAL_GALLERY_URL, { headers: { "user-agent": "Riftbound-Online-Set-Source/1.0" } }),
  fetch(errataUrl, { headers: { "user-agent": "Riftbound-Online-Set-Source/1.0" } })
]);
if (!galleryResponse.ok) throw new Error(`Official card gallery returned HTTP ${galleryResponse.status}.`);
if (!errataResponse.ok) throw new Error(`Errata overlay returned HTTP ${errataResponse.status}.`);

const galleryHtml = await galleryResponse.text();
const marker = '<script id="__NEXT_DATA__" type="application/json">';
const sourcePayload = galleryHtml.split(marker)[1]?.split("</script>")[0];
if (!sourcePayload) throw new Error("Official card gallery did not contain __NEXT_DATA__.");
const payload = JSON.parse(sourcePayload);
const page = payload?.props?.pageProps?.page;
const gallery = page?.blades?.find((blade) => blade.type === "riftboundCardGallery");
const setRecord = gallery?.sets?.items?.find((set) => String(set.id).toUpperCase() === setId);
if (!setRecord) throw new Error(`Official gallery has no set '${setId}'.`);

const errataCards = await errataResponse.json();
const errataByCode = new Map((Array.isArray(errataCards) ? errataCards : [])
  .filter((card) => String(card.setCode || "").toUpperCase() === setId)
  .map((card) => [`${setId}-${card.cardNumber.replace("-", "/")}`.toUpperCase(), card]));
const exactNumber = new RegExp(`^${escapeRegExp(setId)}-(\\d{3})/${Number(setRecord.collectorNumberMax)}$`);
const numberedByCode = new Map();
for (const card of gallery.cards.items) {
  const match = String(card.publicCode || "").match(exactNumber);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(setRecord.collectorNumberMax)) continue;
  if (!numberedByCode.has(card.publicCode)) numberedByCode.set(card.publicCode, card);
}
const cards = [...numberedByCode.values()]
  .sort((left, right) => left.collectorNumber - right.collectorNumber)
  .map((card) => normalizeCard(card, errataByCode.get(String(card.publicCode).toUpperCase())));

if (cards.length !== Number(setRecord.collectorNumberMax)) {
  throw new Error(`Expected ${setRecord.collectorNumberMax} numbered ${setId} cards, found ${cards.length}.`);
}

const snapshot = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  set: {
    id: setId,
    name: setRecord.name,
    collectorNumberMax: Number(setRecord.collectorNumberMax)
  },
  sources: {
    officialGallery: OFFICIAL_GALLERY_URL,
    officialBuildId: payload.buildId || null,
    officialNextDataSha256: crypto.createHash("sha256").update(sourcePayload).digest("hex").toUpperCase(),
    errataOverlay: errataUrl,
    errataOverlayRole: "Cross-check of cumulative Rules Hub errata; official structured fields remain authoritative."
  },
  cards
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Wrote ${cards.length} ${setId} cards to ${path.relative(ROOT, outputPath)}.`);
console.log(`Applied cumulative errata to ${cards.filter((card) => card.hasErrata).length} cards.`);

function normalizeCard(card, errata) {
  const domains = (card.domain?.values || []).map((entry) => entry.label).filter((value) => value && value !== "Colorless");
  const powerAmount = numberOrZero(card.power?.value?.id);
  const printedRulesText = htmlToText(card.text?.richText?.body || "");
  const primaryType = card.cardType?.type?.[0]?.id || null;
  const types = extractCardTypes(card, primaryType);
  return {
    id: String(card.publicCode).split("/")[0],
    collectorNumber: card.publicCode,
    cardNumber: card.publicCode,
    name: [card.name, card.subtitle].filter(Boolean).join(", "),
    type: primaryType,
    types,
    set: card.set?.value?.label || null,
    rarity: card.rarity?.value?.label || null,
    domains,
    tags: [...(card.tags?.tags || [])],
    keywords: extractKeywords(printedRulesText),
    isChampion: (card.cardType?.superType || []).some((entry) => entry.label === "Champion"),
    energy: numberOrNull(card.energy?.value?.id),
    power: powerAmount
      ? [{ domain: domains.length === 1 ? domains[0] : "Any", amount: powerAmount }]
      : [],
    might: numberOrNull(card.might?.value?.id),
    mightBonus: numberOrNull(card.mightBonus?.value?.id),
    printedText: printedRulesText,
    effectiveText: errata?.hasErrata
      ? normalizeErrataText(errata.abilityEffective || printedRulesText, domains)
      : printedRulesText,
    effectText: htmlToText(card.effect?.richText?.body || ""),
    hasErrata: Boolean(errata?.hasErrata),
    errataCode: errata?.matchedErrataCode || null,
    image: card.cardImage?.url || null,
    imageAccessibilityText: card.cardImage?.accessibilityText || null,
    sourceUrls: [
      `${OFFICIAL_GALLERY_URL}#card-gallery--${card.id}`,
      ...(errata?.hasErrata ? [errataUrl] : [])
    ]
  };
}

function extractCardTypes(card, primaryType) {
  const structured = (card.cardType?.type || []).map((entry) => entry.id).filter(Boolean);
  const accessibilityPrefix = String(card.cardImage?.accessibilityText || "")
    .match(/^Riftbound\s+([^:]+):/)?.[1] || "";
  const accessible = accessibilityPrefix
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => ["battlefield", "gear", "legend", "rune", "spell", "unit"].includes(value));
  return [...new Set([primaryType, ...structured, ...accessible].filter(Boolean))];
}

function extractKeywords(text) {
  const known = new Set([
    "Accelerate", "Action", "Ambush", "Assault", "Backline", "Deathknell", "Deflect", "Equip", "Ganking",
    "Hidden", "Hunt", "Quick-Draw", "Reaction", "Repeat", "Shield", "Tank", "Temporary", "Unique", "Vision", "Weaponmaster"
  ]);
  const keywords = [];
  for (const line of String(text).split("\n")) {
    const visibleAbility = line.replace(/\([^)]*\)/g, "").trim();
    if (/^\[Empowered\]/i.test(visibleAbility)) continue;
    const prefix = visibleAbility.match(/^(?:\[[^\]]+\](?:\s*,?\s*)?)+/)?.[0] || "";
    for (const match of prefix.matchAll(/\[([^\]]+)\]/g)) {
      const keyword = match[1].replace(/\s+\d+$/, "");
      if (known.has(keyword)) keywords.push(keyword);
    }
  }
  return [...new Set(keywords)];
}

function normalizeErrataText(value, domains = []) {
  const domain = domains.length === 1 ? domains[0] : "Any";
  return String(value)
    .replace(/\[M\]/g, "Might")
    .replace(/\[A\]/g, "Power")
    .replace(/\[C\]/g, `${domain} Power`);
}

function htmlToText(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/:rb_energy_(\d+):/g, "Energy $1 ")
    .replace(/:rb_exhaust:/g, "Exhaust ")
    .replace(/:rb_might:/g, "Might ")
    .replace(/:rb_rune_body:/g, "Body Power ")
    .replace(/:rb_rune_calm:/g, "Calm Power ")
    .replace(/:rb_rune_chaos:/g, "Chaos Power ")
    .replace(/:rb_rune_fury:/g, "Fury Power ")
    .replace(/:rb_rune_mind:/g, "Mind Power ")
    .replace(/:rb_rune_order:/g, "Order Power ")
    .replace(/:rb_rune_rainbow:/g, "Power ")
    .replace(/[ \t]+/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = values[index + 1];
    parsed[key] = !next || next.startsWith("--") ? true : next;
    if (parsed[key] !== true) index += 1;
  }
  return parsed;
}

function numberOrNull(value) {
  return value == null || value === "" ? null : Number(value);
}

function numberOrZero(value) {
  return numberOrNull(value) || 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
