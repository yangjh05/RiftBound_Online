import { cards, makeRune } from "../cards.mjs";
import { CARD_POOL_FORMATS, cardAllowedInPool } from "../card-pools.mjs";
import { isCardBanned } from "../decks/legality.mjs";
import { validateDeckRecord } from "../decks/rules.mjs";
import { sha256Hex } from "./neural/sha256.mjs";

const zones = ["main", "sideboard", "runes", "battlefields"];
const byNumber = new Map(Object.values(cards).map(card => [card.cardNumber, card]));
const cardByNumber = number => byNumber.get(number);
const count = values => [...values.reduce((map, card) => {
  map.set(card.cardNumber, (map.get(card.cardNumber) || 0) + 1); return map;
}, new Map())].sort(([a], [b]) => a.localeCompare(b));

export function trainingDeckRecord(deck) {
  return { legend: deck.legend?.cardNumber, main: count(deck.main || []),
    sideboard: count(deck.sideboard || []), runes: count(deck.runes || []),
    battlefields: (deck.battlefields || []).map(card => card.cardNumber).sort() };
}

export function trainingDeckKey(deck) {
  return sha256Hex(JSON.stringify(trainingDeckRecord(deck)));
}

export function validateTrainingDeck(deck, poolId = "origins-era") {
  const messages = [];
  if (!CARD_POOL_FORMATS.some(pool => pool.id === poolId)) messages.push(`Unknown training card pool: ${poolId}`);
  messages.push(...validateDeckRecord(trainingDeckRecord(deck), cardByNumber).messages);
  // Training has no default-deck exemption. Check every printing in every zone.
  for (const card of [deck.legend, ...zones.flatMap(zone => deck[zone] || [])]) {
    if (!card || isCardBanned(cardByNumber(card.cardNumber))) messages.push(`Banned training card: ${card?.name}`);
    if (!cardAllowedInPool(cardByNumber(card?.cardNumber), poolId)) messages.push(`Training card outside pool: ${card?.cardNumber}`);
  }
  return { playable: !messages.length, messages };
}

export function assertLegalTrainingDeck(deck, poolId = "origins-era") {
  const validation = validateTrainingDeck(deck, poolId);
  if (!validation.playable) throw new Error(`Illegal training deck ${deck?.id}: ${validation.messages.join(" ")}`);
  return deck;
}

function legalCards(deck, poolId, type) {
  const domains = new Set(deck.legend.domains);
  // One candidate per name prevents alternate printings from biasing exploration.
  return [...new Map(Object.values(cards).filter(card =>
    (type === "main" ? ["unit", "spell", "gear"].includes(card.type) : card.type === type)
    && !isCardBanned(card) && cardAllowedInPool(card, poolId)
    && (card.domains || []).every(domain => domain === "Any" || domains.has(domain)))
    .sort((a, b) => a.cardNumber.localeCompare(b.cardNumber))
    .map(card => [card.name, card])).values()];
}

function identify(deck, parent, kind) {
  const key = trainingDeckKey(deck);
  if (key === trainingDeckKey(parent)) return structuredClone(parent);
  deck.id = `search-${key}`;
  deck.playerName = `${parent.playerName || parent.id} / ${kind}`;
  deck.evolution = { parentId: parent.id, rootId: parent.evolution?.rootId || parent.id, kind };
  return deck;
}

// Preserve as much of an existing list as possible. Repairs are proposals, not
// evidence that the replacement is competitive. Refuse unrelated illegal lists.
export function repairTrainingDeck(deck, poolId = "origins-era") {
  const next = structuredClone(deck);
  const base = validateDeckRecord(trainingDeckRecord(next), cardByNumber);
  if (!base.playable) throw new Error(`Invalid seed ${deck.id}: ${base.messages.join(" ")}`);
  if (isCardBanned(next.legend) || !cardAllowedInPool(next.legend, poolId)) throw new Error(`Unavailable seed legend: ${deck.id}`);
  const missing = [];
  for (const zone of zones) {
    next[zone] ||= [];
    next[zone] = next[zone].filter(card => {
      if (!isCardBanned(card) && cardAllowedInPool(card, poolId)) return true;
      missing.push({ zone, card, reason: isCardBanned(card) ? "banned" : "outside-pool" }); return false;
    });
  }
  // Missing slots are temporarily filled to let the canonical validator check
  // all composition rules, without counting the other yet-unfilled slots.
  for (const { zone, card } of missing) {
    if (zone === "sideboard") continue;
    const candidates = zone === "runes" ? next.legend.domains.map(makeRune)
      : legalCards(next, poolId, zone === "battlefields" ? "battlefield" : "main");
    candidates.sort((a, b) => repairDistance(a, card) - repairDistance(b, card)
      || a.cardNumber.localeCompare(b.cardNumber));
    const added = candidates.find(candidate => {
      next[zone].push(candidate);
      const messages = validateDeckRecord(trainingDeckRecord(next), cardByNumber).messages;
      next[zone].pop();
      return messages.every(message => /exactly|Exactly/.test(message));
    });
    if (!added) throw new Error(`Cannot repair ${deck.id} ${zone}: ${card.name}`);
    next[zone].push(added);
  }
  assertLegalTrainingDeck(next, poolId);
  const output = identify(next, deck, "legal-seed");
  output.seedRepair = missing.map(({ zone, card, reason }) => ({ zone, removed: card.cardNumber, reason }));
  output.seedQuality = missing.some(item => item.zone === "main") ? "repaired-main-unverified" : "main-preserved";
  if (missing.some(item => item.reason === "outside-pool")) output.playerName = `${deck.playerName || deck.id} / Origins control draft`;
  return output;
}

function repairDistance(a, b) {
  return (a.type === b.type ? 0 : 20) + Math.abs((a.energy || 0) - (b.energy || 0));
}

export function mutateLegalTrainingDeck(deck, model = {}, random = Math.random, options = {}) {
  const poolId = options.poolId || model.cardPoolId || model.externalMeta?.cardPoolId || "origins-era";
  let next = repairTrainingDeck(deck, poolId);
  const parent = structuredClone(next);
  const kind = options.kind || "cardPackage";
  const zone = kind === "runes" ? "runes" : kind === "battlefields" ? "battlefields"
    : kind === "sideboard" ? "sideboard" : "main";
  const steps = zone === "main" ? Math.max(1, Math.min(12, options.packageSize || 1)) : 1;
  const changes = [];
  const changedIndices = new Set();
  const pick = values => values[Math.min(values.length - 1, Math.floor(random() * values.length))];
  for (let step = 0; step < steps; step++) {
    const append = zone === "sideboard" && next.sideboard.length < 10;
    const indices = append ? [next.sideboard.length] : next[zone].map((_, i) => i).filter(i => !changedIndices.has(i));
    // Uniform removal gives every slot a chance; learned outcomes rank additions.
    const start = Math.floor(random() * Math.max(1, indices.length));
    let changed = false;
    for (let offset = 0; offset < indices.length; offset++) {
      const index = indices[(start + offset) % indices.length];
      const removed = next[zone][index];
      const candidates = zone === "runes" ? next.legend.domains.map(makeRune)
        : legalCards(next, poolId, zone === "battlefields" ? "battlefield" : "main");
      const additions = candidates.filter(card => {
        if (card.name === removed?.name) return false;
        next[zone][index] = card;
        const valid = validateTrainingDeck(next, poolId).playable;
        if (append) next[zone].pop(); else next[zone][index] = removed;
        return valid;
      });
      if (!additions.length) continue;
      const score = card => {
        const stat = model.cardStats?.[card.cardNumber];
        const learned = stat?.games ? (stat.meanReturn ?? stat.returnSum / stat.games) * Math.min(1, stat.games / 20) : 0;
        return learned - (options.broad ? 0 : repairDistance(card, removed || card) * 0.05);
      };
      additions.sort((a, b) => score(b) - score(a) || a.cardNumber.localeCompare(b.cardNumber));
      // Every legal card remains reachable, including unseen and later-set cards.
      const pool = options.broad || random() < 0.25 ? additions : additions.slice(0, Math.max(8, Math.ceil(additions.length * 0.2)));
      next[zone][index] = pick(pool);
      changes.push({ removed: removed?.cardNumber || null, added: next[zone][index].cardNumber });
      changedIndices.add(index);
      changed = true; break;
    }
    if (!changed) break;
  }
  next = identify(next, parent, kind);
  if (changes.length && next.id !== parent.id) {
    next.evolution.changes = changes;
    if (kind === "runes") {
      next.evolution.from = cardByNumber(changes[0].removed)?.domains?.[0];
      next.evolution.to = cardByNumber(changes[0].added)?.domains?.[0];
    } else if (kind !== "cardPackage") Object.assign(next.evolution, changes[0]);
  }
  return assertLegalTrainingDeck(next, poolId);
}
