import { cards } from "./cards.mjs";

export const CARD_PACKS = Object.freeze([
  { id: "origins", name: "Origins", set: "Origins", prefix: "OGN", releaseOrder: 1 },
  { id: "proving-grounds", name: "Origins: Proving Grounds", set: "Proving Grounds", prefix: "OGS", releaseOrder: 1 },
  { id: "spiritforged", name: "Spiritforged", set: "Spiritforged", prefix: "SFD", releaseOrder: 2 },
  { id: "unleashed", name: "Unleashed", set: "Unleashed", prefix: "UNL", releaseOrder: 3 }
]);

export const CARD_POOL_FORMATS = Object.freeze([
  { id: "origins-era", name: "Origins 출시 환경", packIds: ["origins", "proving-grounds"], releaseOrder: 1 },
  { id: "spiritforged-era", name: "Spiritforged 출시 환경", packIds: ["origins", "proving-grounds", "spiritforged"], releaseOrder: 2 },
  { id: "unleashed-era", name: "Unleashed 출시 환경", packIds: ["origins", "proving-grounds", "spiritforged", "unleashed"], releaseOrder: 3 }
]);

const PACK_BY_SET = new Map(CARD_PACKS.map((pack) => [pack.set, pack]));
const PACK_BY_PREFIX = new Map(CARD_PACKS.map((pack) => [pack.prefix, pack]));
const CARD_BY_NUMBER = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));

export function packForCard(card) {
  if (!card) return null;
  return PACK_BY_SET.get(card.set) || PACK_BY_PREFIX.get(String(card.cardNumber || "").split("-")[0]) || null;
}

export function cardPool(poolId = "origins-era") {
  return CARD_POOL_FORMATS.find((pool) => pool.id === poolId) || CARD_POOL_FORMATS[0];
}

export function cardAllowedInPool(card, poolId = "origins-era") {
  const pack = packForCard(card);
  return Boolean(pack && cardPool(poolId).packIds.includes(pack.id));
}

export function cardNumbersForPool(poolId = "origins-era") {
  return new Set(Object.values(cards).filter((card) => cardAllowedInPool(card, poolId)).map((card) => card.cardNumber));
}

export function deckAllowedInPool(deck, poolId = "origins-era") {
  const entries = [deck?.legend, ...(deck?.main || []), ...(deck?.sideboard || []), ...(deck?.battlefields || [])];
  return entries.filter(Boolean).every((entry) => {
    const card = typeof entry === "string" ? CARD_BY_NUMBER.get(entry) : Array.isArray(entry) ? CARD_BY_NUMBER.get(entry[0]) : entry;
    return !card || cardAllowedInPool(card, poolId);
  });
}

export function availablePackIds() { return CARD_PACKS.map((pack) => pack.id); }
