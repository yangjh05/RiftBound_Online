import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cards } from "../src/cards.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_URL = "https://playriftbound.com/en-us/card-gallery/";
const OUTPUT_PATH = path.join(ROOT, "spec", "cards", "official-gallery-2026-07-14.json");

const response = await fetch(SOURCE_URL, { headers: { "user-agent": "Riftbound-Online-Rules-Audit/1.0" } });
if (!response.ok) throw new Error(`Official card gallery returned HTTP ${response.status}.`);
const html = await response.text();
const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) throw new Error("Official card gallery did not contain __NEXT_DATA__.");

const sourcePayload = match[1];
const payload = JSON.parse(sourcePayload);
const page = payload?.props?.pageProps?.page;
const gallery = page?.blades?.find((blade) => blade.type === "riftboundCardGallery");
if (!gallery?.cards?.items?.length) throw new Error("Official card gallery contained no card records.");

const officialByNumber = new Map(gallery.cards.items
  .filter((card) => card.publicCode)
  .map((card) => [card.publicCode, card]));
const requestedNumbers = [...new Set(Object.values(cards).map((card) => card.cardNumber))]
  .sort(cardNumberSort);
const missingCardNumbers = requestedNumbers.filter((cardNumber) => !officialByNumber.has(cardNumber));
const records = requestedNumbers
  .filter((cardNumber) => officialByNumber.has(cardNumber))
  .map((cardNumber) => normalizeOfficialCard(officialByNumber.get(cardNumber)));

const snapshot = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  source: {
    authority: "Riot Games / Riftbound",
    title: page?.title || "Official Riftbound Card Gallery",
    url: SOURCE_URL,
    contentApiUrl: page?.pcsUrl || null,
    revision: page?.analytics?.rev || null,
    buildId: payload?.buildId || null,
    nextDataSha256: crypto.createHash("sha256").update(sourcePayload).digest("hex").toUpperCase()
  },
  scope: {
    officialGalleryCardCount: gallery.cards.items.length,
    requestedRegisteredCardCount: requestedNumbers.length,
    snapshottedCardCount: records.length,
    missingCardNumbers
  },
  knownSourceAnomalies: [{
    cardNumber: "OGN-235/298",
    field: "tags",
    ignoredValues: ["Vi"],
    printedValues: ["Karma", "Ionia"],
    evidenceUrl: officialByNumber.get("OGN-235/298")?.cardImage?.url || null,
    note: "The structured gallery tag says Vi, while the official card image visibly says Karma / Ionia."
  }],
  sets: (gallery.sets?.items || []).map((set) => ({
    id: set.id,
    name: set.name,
    collectorNumberMax: set.collectorNumberMax
  })),
  cards: records
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Snapshotted ${records.length}/${requestedNumbers.length} registered cards from ${gallery.cards.items.length} official gallery records.`);
if (missingCardNumbers.length) console.log(`Official gallery missing: ${missingCardNumbers.join(", ")}`);
console.log(`Source SHA-256: ${snapshot.source.nextDataSha256}`);
console.log(`Output: ${path.relative(ROOT, OUTPUT_PATH)}`);

function normalizeOfficialCard(card) {
  return {
    cardNumber: card.publicCode,
    name: card.name,
    type: card.cardType?.type?.[0]?.id || null,
    superTypes: (card.cardType?.superType || []).map((entry) => entry.label),
    domains: (card.domain?.values || [])
      .map((entry) => entry.label)
      .filter((domain) => domain && domain !== "Colorless"),
    energy: numberOrNull(card.energy?.value?.id),
    powerAmount: numberOrZero(card.power?.value?.id),
    might: numberOrNull(card.might?.value?.id),
    tags: [...(card.tags?.tags || [])],
    rarity: card.rarity?.value?.label || null,
    rulesText: htmlToText(card.text?.richText?.body || ""),
    rulesTextHtml: card.text?.richText?.body || "",
    imageUrl: card.cardImage?.url || null,
    imageAccessibilityText: card.cardImage?.accessibilityText || null
  };
}

function htmlToText(value) {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function numberOrNull(value) {
  return value == null || value === "" ? null : Number(value);
}

function numberOrZero(value) {
  return value == null || value === "" ? 0 : Number(value);
}

function cardNumberSort(left, right) {
  return left.localeCompare(right, "en", { numeric: true });
}
