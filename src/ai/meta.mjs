import { cards } from "../cards.mjs";

const CARD_BY_NUMBER = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));

export function normalizeMetaSnapshot(payload, options = {}) {
  const decks = [];
  for (const source of payload?.decks || []) {
    const mainEntries = normalizeEntries(source.main);
    const unknown = mainEntries.filter(([cardNumber]) => !CARD_BY_NUMBER.has(cardNumber));
    if (unknown.length) throw new Error(`Unknown meta card numbers in ${source.id || source.name}: ${unknown.map(([number]) => number).join(", ")}`);
    const games = Math.max(0, Number(source.games) || 0);
    const wins = source.wins == null ? null : Math.max(0, Number(source.wins) || 0);
    const share = Math.max(0, Number(source.share ?? source.playRate) || 0);
    const total = Math.max(1, mainEntries.reduce((sum, [, count]) => sum + count, 0));
    const cardCounts = Object.fromEntries(mainEntries);
    const resolved = mainEntries.flatMap(([number, count]) => Array.from({ length: count }, () => CARD_BY_NUMBER.get(number)));
    decks.push({
      id: String(source.id || source.name || `meta-${decks.length + 1}`),
      name: String(source.name || source.id || `Meta deck ${decks.length + 1}`),
      legendCardNumber: source.legendCardNumber || source.legend || null,
      games,
      wins,
      winRate: source.winRate != null ? Number(source.winRate) : games && wins != null ? wins / games : null,
      share,
      cardCounts,
      sideboardCounts: Object.fromEntries(normalizeEntries(source.sideboard)),
      mainSize: total,
      unitRatio: resolved.filter((card) => card.type === "unit").length / total,
      spellRatio: resolved.filter((card) => card.type === "spell").length / total,
      gearRatio: resolved.filter((card) => card.type === "gear").length / total,
      reactionRatio: resolved.filter((card) => card.tags?.includes("Reaction") || card.keywords?.includes("Reaction")).length / total,
      averageEnergy: resolved.reduce((sum, card) => sum + (card.energy || 0), 0) / total
    });
  }
  const shareTotal = decks.reduce((sum, deck) => sum + deck.share, 0);
  const deckWeights = Object.fromEntries(decks.map((deck) => [deck.id, shareTotal ? deck.share / shareTotal : 1 / Math.max(1, decks.length)]));
  const cardStats = {};
  for (const deck of decks) {
    const weight = deckWeights[deck.id] || 0;
    for (const cardNumber of Object.keys(deck.cardCounts)) {
      const stat = cardStats[cardNumber] ||= { inclusionRate: 0, winRateSum: 0, weight: 0 };
      stat.inclusionRate += weight;
      if (deck.winRate != null) { stat.winRateSum += deck.winRate * weight; stat.weight += weight; }
    }
  }
  for (const stat of Object.values(cardStats)) stat.winRate = stat.weight ? stat.winRateSum / stat.weight : null;
  return {
    version: 1,
    source: options.source || payload?.source || "import",
    observedAt: options.observedAt || payload?.observedAt || new Date().toISOString(),
    games: decks.reduce((sum, deck) => sum + deck.games, 0),
    decks,
    deckWeights,
    cardStats,
    matchupStats: structuredClone(payload?.matchups || {})
  };
}

export function applyMetaSnapshot(knowledge, snapshot) {
  knowledge.externalMeta = structuredClone(snapshot);
  knowledge.deckProfiles ||= {};
  for (const deck of snapshot.decks || []) knowledge.deckProfiles[deck.id] = structuredClone(deck);
  return knowledge;
}

function normalizeEntries(entries) {
  const counts = new Map();
  for (const entry of entries || []) {
    const cardNumber = Array.isArray(entry) ? entry[0] : entry.cardNumber;
    const count = Number(Array.isArray(entry) ? entry[1] : entry.count) || 0;
    if (cardNumber && count > 0) counts.set(cardNumber, (counts.get(cardNumber) || 0) + count);
  }
  return [...counts.entries()];
}
