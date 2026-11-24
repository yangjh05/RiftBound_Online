import { makeRune, rawDecklists } from "../cards.mjs";
import { CARD_POOL_FORMATS, cardAllowedInPool, cardPool } from "../card-pools.mjs";
import { normalizeCountEntries, validateDeckRecord } from "./rules.mjs";

// Current Standard (1v1) list, independent of the selected set pool.
// https://playriftbound.com/en-us/rules-hub/
export const STANDARD_BAN_LIST = Object.freeze({
  effectiveDate: "2026-09-18",
  sourceUrl: "https://playriftbound.com/en-us/rules-hub/",
  names: Object.freeze([
    "Called Shot", "Ekko, Recurrent", "Draven, Vanquisher", "Fight or Flight",
    "Scrapheap", "Stealthy Pursuer", "Stacked Deck", "The Arena's Greatest",
    "Aspirant's Climb", "The Dreaming Tree", "Obelisk of Power", "Reaver's Row"
  ])
});

export const DEFAULT_ROOM_POOL_ID = "vendetta-era";
const BANNED_NAMES = new Set(STANDARD_BAN_LIST.names);
const DEFAULT_DECKS = new Map(Object.entries(rawDecklists)
  .map(([key, deck]) => [`default-${deck.id || key}`, deck]));
const BASIC_RUNE_DOMAINS = new Set(["Body", "Calm", "Chaos", "Fury", "Mind", "Order"]);

export function normalizeRoomDeckOptions(options = {}) {
  return {
    poolId: CARD_POOL_FORMATS.some((pool) => pool.id === options.poolId)
      ? options.poolId : DEFAULT_ROOM_POOL_ID,
    banlistEnabled: options.banlistEnabled === true
  };
}

export function isCardBanned(card) {
  // Bans apply to every printing of the same card name.
  return BANNED_NAMES.has(card?.name);
}

export function isUnmodifiedDefaultDeck(deck, cardByNumber) {
  const original = DEFAULT_DECKS.get(deck?.id);
  if (!original) return false;
  const canonical = (key) => cardByNumber(key)?.cardNumber || key;
  const runeKey = (key) => BASIC_RUNE_DOMAINS.has(key) ? makeRune(key).cardNumber : canonical(key);
  const entries = (values, resolve = canonical) => JSON.stringify(normalizeCountEntries(
    (values || []).map(([key, count]) => [resolve(key), count])
  ).sort(([left], [right]) => String(left).localeCompare(String(right))));
  const fields = (values) => JSON.stringify((values || []).map(canonical).sort());
  return canonical(deck.legend) === canonical(original.legend)
    && fields(deck.battlefields) === fields(original.battlefields)
    && entries(deck.main) === entries(original.main)
    && entries(deck.sideboard) === entries(original.sideboard)
    && entries(deck.runes, runeKey) === entries(original.runes, runeKey);
}

export function deckRoomRestrictions(deck, cardByNumber, options = {}) {
  const { poolId, banlistEnabled } = normalizeRoomDeckOptions(options);
  const numbers = [deck?.legend, ...(deck?.battlefields || []),
    ...[...(deck?.main || []), ...(deck?.sideboard || []), ...(deck?.runes || [])]
      .filter(([, count]) => count > 0).map(([key]) => key)];
  const registeredCards = [...new Map(numbers.filter(Boolean).map((key) => {
    const card = cardByNumber(key) || (BASIC_RUNE_DOMAINS.has(key) ? makeRune(key) : null);
    return [card?.name, card];
  }).filter(([, card]) => card)).values()];
  // Inspect each printing for the pool: a later alternate art cannot hide behind
  // an earlier printing of the same name elsewhere in the submitted deck.
  const outOfPoolCards = [...new Map(numbers.filter(Boolean).map((key) => cardByNumber(key))
    .filter((card) => card && !cardAllowedInPool(card, poolId))
    .map((card) => [card.cardNumber, card])).values()];
  const bannedCards = registeredCards.filter(isCardBanned);
  const banExempt = isUnmodifiedDefaultDeck(deck, cardByNumber);
  const messages = [];
  if (outOfPoolCards.length) messages.push(`Cards outside the room card pool (${cardPool(poolId).name}): ${outOfPoolCards.map((card) => card.name).join(", ")}.`);
  if (banlistEnabled && !banExempt && bannedCards.length) messages.push(`Banned cards are not allowed in this room: ${bannedCards.map((card) => card.name).join(", ")}.`);
  return { playable: messages.length === 0, messages, poolId, banlistEnabled, banExempt, bannedCards, outOfPoolCards };
}

export function validateRoomDeck(deck, cardByNumber, options = {}) {
  const base = validateDeckRecord(deck, cardByNumber);
  const restrictions = deckRoomRestrictions(deck, cardByNumber, options);
  const messages = [...base.messages, ...restrictions.messages];
  return { ...restrictions, messages, playable: messages.length === 0 };
}
