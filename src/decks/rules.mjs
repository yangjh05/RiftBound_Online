export const DECK_RULES = Object.freeze({
  mainExact: 40,
  sideboardMax: 8,
  runeExact: 12,
  battlefieldsExact: 3,
  maxCopies: 3,
  signatureTotalMax: 3
});

const NON_IDENTITY_TAGS = Object.freeze(new Set([
  "Champion", "Signature", "Signature Spell", "Action", "Reaction", "Unit", "Spell", "Gear"
]));

export function validateDeckRecord(deck, cardByNumber) {
  if (!deck) return { playable: false, messages: ["No deck was selected."] };
  const messages = [];
  const mainCount = mainDeckCount(deck);
  const sideCount = sideboardCount(deck);
  const runeCountValue = runeDeckCount(deck);
  const mainEntries = Array.isArray(deck.main) ? deck.main : [];
  const sideboardEntries = Array.isArray(deck.sideboard) ? deck.sideboard : [];
  const registeredEntries = [...mainEntries, ...sideboardEntries];
  const legend = cardByNumber(deck.legend);
  const legendDomains = new Set((legend?.domains || []).filter((domain) => domain && domain !== "Any"));
  const legendChampionTags = new Set((legend?.tags || []).filter((tag) => !NON_IDENTITY_TAGS.has(tag)));
  const championCount = registeredEntries.reduce((total, [number, count]) => total + (isChampionDeckCard(cardByNumber(number)) ? count : 0), 0);

  if (!legend || legend.type !== "legend") messages.push("A Legend card is required.");
  if (!Array.isArray(deck.battlefields) || deck.battlefields.length !== DECK_RULES.battlefieldsExact) messages.push(`Exactly ${DECK_RULES.battlefieldsExact} Battlefields are required.`);
  if (mainCount !== DECK_RULES.mainExact) messages.push(`Main Deck must contain exactly ${DECK_RULES.mainExact} cards. It currently contains ${mainCount}.`);
  if (sideCount > DECK_RULES.sideboardMax) messages.push(`Sideboard can contain at most ${DECK_RULES.sideboardMax} cards. It currently contains ${sideCount}.`);
  if (runeCountValue !== DECK_RULES.runeExact) messages.push(`Rune Deck must contain exactly ${DECK_RULES.runeExact} cards. It currently contains ${runeCountValue}.`);
  if (championCount < 1) messages.push("At least one 실제 Champion Unit is required across the Main Deck and Sideboard.");

  let signatureTotal = 0;
  const copiesByName = new Map();
  for (const [number, count] of registeredEntries) {
    const card = cardByNumber(number);
    if (!card) { messages.push(`Unknown registered card number: ${number}`); continue; }
    if (!["unit", "spell", "gear"].includes(card.type)) messages.push(`${card.name} cannot be included in the Main Deck or Sideboard.`);
    if (!Number.isInteger(count) || count <= 0) messages.push(`${card.name} has an invalid copy count.`);
    copiesByName.set(card.name, (copiesByName.get(card.name) || 0) + count);
    if (isSignatureCard(card)) {
      signatureTotal += count;
      const signatureIdentity = (card.tags || []).filter((tag) => !NON_IDENTITY_TAGS.has(tag));
      if (!signatureIdentity.some((tag) => legendChampionTags.has(tag))) {
        messages.push(`${card.name} does not share a 챔피언 태그 with ${legend?.name || "the Legend"}.`);
      }
    }
  }
  for (const [name, count] of copiesByName) {
    if (count > DECK_RULES.maxCopies) messages.push(`${name} can have at most ${DECK_RULES.maxCopies} registered copies across the Main Deck and Sideboard. It currently has ${count}.`);
  }
  if (signatureTotal > DECK_RULES.signatureTotalMax) messages.push(`At most ${DECK_RULES.signatureTotalMax} Signature cards may be registered in 합계. It currently has ${signatureTotal}.`);

  for (const number of deck.battlefields || []) {
    const card = cardByNumber(number);
    if (!card) messages.push(`Unknown Battlefield card number: ${number}`);
    else if (card.type !== "battlefield") messages.push(`${card.name} is not a Battlefield card.`);
  }
  for (const [domain, count] of deck.runes || []) {
    if (!Number.isInteger(count) || count < 0) messages.push(`${domain} Rune has an invalid copy count.`);
    if (count > 0 && !legendDomains.has(domain)) messages.push(`${domain} is outside ${legend?.name || "the Legend"}'s Domain Identity.`);
  }
  return { playable: messages.length === 0, messages };
}

export function isChampionDeckCard(card) { return Boolean(card?.isChampion || card?.tags?.includes("Champion")); }
export function isSignatureCard(card) { return Boolean(card?.tags?.includes("Signature") || card?.tags?.includes("Signature Spell")); }
export function mainDeckCount(deck) { return deck?.main?.reduce((total, [, count]) => total + count, 0) || 0; }
export function sideboardCount(deck) { return deck?.sideboard?.reduce((total, [, count]) => total + count, 0) || 0; }
export function runeDeckCount(deck) { return deck?.runes?.reduce((total, [, count]) => total + count, 0) || 0; }
export function runeCount(deck, domain) { return deck?.runes?.find(([candidate]) => candidate === domain)?.[1] || 0; }
export function cardCount(entries, cardNumber) { return entries?.find(([number]) => number === cardNumber)?.[1] || 0; }
export function normalizeCountEntries(entries) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const [key, rawCount] = entry;
    const count = Number(rawCount) || 0;
    if (!key || count <= 0) continue;
    counts.set(key, (counts.get(key) || 0) + count);
  }
  return [...counts.entries()];
}
