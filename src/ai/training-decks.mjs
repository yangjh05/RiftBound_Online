import { deckAllowedInPool } from "../card-pools.mjs";

export const FOCUSED_TRAINING_DECK_IDS = Object.freeze([
  "origins-sett",
  "proving-grounds-annie",
  "origins-kaisa",
  "proving-grounds-master-yi",
  "origins-leona"
]);

export function resolveTrainingDecks(decklists, poolId, requested = FOCUSED_TRAINING_DECK_IDS) {
  const allDecks = Object.values(decklists);
  const poolDecks = allDecks.filter((deck) => deckAllowedInPool(deck, poolId));
  const requestedIds = parseTrainingDeckIds(requested);
  if (requestedIds === null) return poolDecks;
  const byId = new Map(poolDecks.map((deck) => [deck.id, deck]));
  const missing = requestedIds.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`Training deck IDs are unknown or outside ${poolId}: ${missing.join(", ")}`);
  const decks = requestedIds.map((id) => byId.get(id));
  if (decks.length < 2) throw new Error("AI training requires at least two distinct decks.");
  return decks;
}

export function parseTrainingDeckIds(value) {
  if (value === "all") return null;
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const ids = values.map((id) => String(id).trim()).filter(Boolean);
  if (!ids.length) return [...FOCUSED_TRAINING_DECK_IDS];
  if (new Set(ids).size !== ids.length) throw new Error("Training deck IDs must be unique.");
  return ids;
}

export function sameLegendIdentity(original, candidate) {
  const originalNumber = original?.legend?.cardNumber;
  const candidateNumber = candidate?.legend?.cardNumber;
  return Boolean(originalNumber && candidateNumber && originalNumber === candidateNumber);
}
