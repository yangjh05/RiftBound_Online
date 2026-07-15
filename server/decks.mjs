import { cards, makeRune } from "../src/cards.mjs";
import { validateDeckRecord } from "../src/decks/rules.mjs";

const CARD_BY_NUMBER = new Map(
  Object.values(cards).flatMap((card) => [
    [card.cardNumber, card],
    [card.collectorNumber, card],
    [card.id, card]
  ].filter(([key]) => Boolean(key)))
);

export function cardByNumber(number) {
  return CARD_BY_NUMBER.get(number) || null;
}

export function normalizeSubmittedDeck(deck) {
  return {
    id: String(deck?.id || `deck-${Date.now()}`),
    name: String(deck?.name || "Online Deck").slice(0, 48),
    source: String(deck?.source || ""),
    legend: String(deck?.legend || ""),
    battlefields: Array.isArray(deck?.battlefields) ? deck.battlefields.map(String) : [],
    main: normalizeEntries(deck?.main),
    sideboard: normalizeEntries(deck?.sideboard),
    runes: normalizeRuneEntries(deck?.runes),
    createdAt: Number(deck?.createdAt) || Date.now(),
    updatedAt: Date.now()
  };
}

export function validateSubmittedDeck(deck) {
  return validateDeckRecord(deck, cardByNumber);
}

export function resolveDeckRecord(deck) {
  return {
    id: deck.id,
    playerName: deck.name,
    source: deck.source || "",
    legend: cardByNumber(deck.legend),
    battlefields: deck.battlefields.map(cardByNumber).filter(Boolean),
    main: deck.main
      .flatMap(([number, count]) => Array.from({ length: count }, () => cardByNumber(number)))
      .filter(Boolean),
    sideboard: deck.sideboard
      .flatMap(([number, count]) => Array.from({ length: count }, () => cardByNumber(number)))
      .filter(Boolean),
    runes: deck.runes.flatMap(([runeKey, count]) => Array.from({ length: count }, () => makeRune(runeKey)))
  };
}

function normalizeRuneEntries(entries) {
  const migrated = normalizeEntries(entries).map(([key, count]) => {
    const card = cardByNumber(key);
    if (card?.type === "rune") return [card.cardNumber, count];
    if (["Body", "Calm", "Chaos", "Fury", "Mind", "Order"].includes(key)) return [makeRune(key).cardNumber, count];
    return [key, count];
  });
  return normalizeEntries(migrated);
}

function normalizeEntries(entries) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = String(entry?.[0] || "");
    const count = Math.max(0, Math.floor(Number(entry?.[1]) || 0));
    if (!key || count <= 0) continue;
    counts.set(key, (counts.get(key) || 0) + count);
  }
  return [...counts.entries()];
}
