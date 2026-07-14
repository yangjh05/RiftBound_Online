import { decklists } from "../cards.mjs";
import { deckAllowedInPool } from "../card-pools.mjs";
import { normalizeMetaSnapshot } from "./meta.mjs";

// Day 1 field counts from the 1,129-player Houston Regional Qualifier,
// restricted to deck profiles currently registered in this project.
export const ORIGINS_HOUSTON_2025 = Object.freeze({
  id: "origins-houston-2025",
  name: "Origins · Houston RQ 2025",
  cardPoolId: "origins-era",
  observedAt: "2025-12-07T00:00:00.000Z",
  source: "https://playriftbound.com/en-us/news/announcements/from-garen-to-annie-rq-houstons-top-decks/",
  fieldSize: 1129,
  legendCounts: {
    "Kai'Sa, Daughter of the Void": 372,
    "Master Yi, Wuju Bladesman": 166,
    "Annie, Dark Child": 122,
    "Miss Fortune, Bounty Hunter": 59,
    "Teemo, Swift Scout": 64,
    "Viktor, Herald of the Arcane": 43,
    "Yasuo, Unforgiven": 25,
    "Darius, Hand of Noxus": 23,
    "Volibear, Relentless Storm": 20,
    "Ahri, Nine-Tailed Fox": 63,
    "Sett, The Boss": 56,
    "Leona, Radiant Dawn": 31,
    "Lux, Lady of Luminosity": 21,
    "Garen, Might of Demacia": 13
  },
  unrepresentedLegendCounts: { "Lee Sin, Blind Monk": 21, "Jinx, Loose Cannon": 24 }
});

export function buildMetaPreset(id = ORIGINS_HOUSTON_2025.id) {
  if (id !== ORIGINS_HOUSTON_2025.id) throw new Error(`Unknown meta preset: ${id}`);
  const preset = ORIGINS_HOUSTON_2025;
  const seenLegends = new Set();
  const decks = Object.values(decklists).filter((deck) => {
    if (!deckAllowedInPool(deck, preset.cardPoolId)) return false;
    if (!preset.legendCounts[deck.legend?.name] || seenLegends.has(deck.legend.name)) return false;
    seenLegends.add(deck.legend.name);
    return true;
  }).map((deck) => ({
    id: deck.id,
    name: deck.playerName,
    legend: deck.legend.cardNumber,
    games: preset.legendCounts[deck.legend.name],
    share: preset.legendCounts[deck.legend.name] / preset.fieldSize,
    main: countEntries(deck.main),
    sideboard: countEntries(deck.sideboard || [])
  }));
  const snapshot = normalizeMetaSnapshot({ source: preset.source, observedAt: preset.observedAt, decks });
  snapshot.id = preset.id;
  snapshot.name = preset.name;
  snapshot.cardPoolId = preset.cardPoolId;
  snapshot.fieldSize = preset.fieldSize;
  snapshot.unrepresentedLegendCounts = structuredClone(preset.unrepresentedLegendCounts);
  snapshot.historical = true;
  return snapshot;
}

function countEntries(cardList) {
  const counts = new Map();
  for (const card of cardList || []) counts.set(card.cardNumber, (counts.get(card.cardNumber) || 0) + 1);
  return [...counts.entries()];
}
