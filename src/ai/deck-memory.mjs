export function remainingDeckProfile(game, playerId) {
  const player = game?.players?.find((candidate) => candidate.id === playerId);
  if (!player) return emptyProfile();
  const cards = player.mainDeck || [];
  const delayed = validMulliganBottomEntries(player);
  const firstBatchId = delayed[0]?.entry?.batchId || "legacy";
  const immediateKnownBatch = delayed.filter(({ entry }) => (entry.batchId || "legacy") === firstBatchId);
  const delayedIds = new Set(delayed.map(({ card }) => card.instanceId));
  const cardsAhead = delayed.length ? Math.min(...delayed.map(({ index }) => index)) : null;
  // Returned mulligan cards are known to be behind every card that was in the
  // deck at the time. Once those cards have all been drawn, the next card is
  // known to come from the returned group (although its order is not exposed).
  const immediatePool = cardsAhead == null
    ? cards
    : cardsAhead > 0
      ? cards.filter((card) => !delayedIds.has(card.instanceId))
      : immediateKnownBatch.map(({ card }) => card);
  const pool = immediatePool.length ? immediatePool : cards;
  const counts = new Map();
  for (const card of pool) counts.set(card.cardNumber || card.name, (counts.get(card.cardNumber || card.name) || 0) + 1);
  const topCards = [...counts].map(([cardNumber, count]) => {
    const card = pool.find((candidate) => (candidate.cardNumber || candidate.name) === cardNumber);
    return {
      cardNumber,
      count,
      nextDrawProbability: count / Math.max(1, pool.length),
      withinThreeProbability: probabilityWithinDraws(pool.length, count, 3),
      energy: energy(card),
      type: card?.type || "unknown"
    };
  }).sort((left, right) => right.nextDrawProbability - left.nextDrawProbability
    || left.energy - right.energy
    || left.cardNumber.localeCompare(right.cardNumber));
  return {
    deckCount: cards.length,
    immediatePoolCount: pool.length,
    expectedEnergy: average(pool.map(energy)),
    earlyProbability: ratio(pool, (card) => energy(card) <= 3),
    highCostProbability: ratio(pool, (card) => energy(card) >= 6),
    unitProbability: ratio(pool, (card) => card.type === "unit"),
    reactionProbability: ratio(pool, isReaction),
    developmentProbability: ratio(pool, hasDevelopmentEffect),
    mulliganBottomCount: delayed.length,
    mulliganBottomCardsAhead: cardsAhead,
    knownBottomCount: delayed.length,
    knownBottomBatchCount: new Set(delayed.map(({ entry }) => entry.batchId || "legacy")).size,
    topCards
  };
}

// The player knows the remaining multiset, not its authoritative hidden order.
// Preserve only explicitly known mulligan placement while sampling the rest.
export function randomizeUnknownOwnDeck(player, random = Math.random) {
  if (!player?.mainDeck?.length) return player?.mainDeck || [];
  const delayed = validMulliganBottomEntries(player);
  const delayedIds = new Set(delayed.map(({ card }) => card.instanceId));
  const unknown = player.mainDeck.filter((card) => !delayedIds.has(card.instanceId));
  const batches = [];
  for (const item of delayed) {
    const batchId = item.entry.batchId || "legacy";
    const batch = batches.find((candidate) => candidate.id === batchId);
    if (batch) batch.cards.push(item.card);
    else batches.push({ id: batchId, index: item.index, cards: [item.card] });
  }
  batches.sort((left, right) => left.index - right.index);
  shuffle(unknown, random);
  for (const batch of batches) shuffle(batch.cards, random);
  const cardsAhead = delayed.length ? Math.min(...delayed.map(({ index }) => index)) : unknown.length;
  const insertion = Math.max(0, Math.min(unknown.length, cardsAhead));
  player.mainDeck = [...unknown.slice(0, insertion), ...batches.flatMap((batch) => batch.cards), ...unknown.slice(insertion)];
  return player.mainDeck;
}

export function validMulliganBottomEntries(player) {
  const positions = new Map((player?.mainDeck || []).map((card, index) => [card.instanceId, { card, index }]));
  return (player?.mulliganBottomKnowledge || []).map((entry) => {
    const position = positions.get(entry.instanceId);
    if (!position || (position.card.zoneChangeCounter || 0) !== (entry.zoneChangeCounter || 0)) return null;
    return { ...position, entry };
  }).filter(Boolean).sort((left, right) => left.index - right.index);
}

function probabilityWithinDraws(deckSize, copies, draws) {
  const count = Math.min(deckSize, Math.max(0, Math.floor(draws)));
  if (!deckSize || !copies || !count) return 0;
  let miss = 1;
  for (let index = 0; index < count; index += 1) miss *= Math.max(0, deckSize - copies - index) / Math.max(1, deckSize - index);
  return 1 - miss;
}

function isReaction(card) {
  return [...(card?.tags || []), ...(card?.keywords || [])].some((item) => /reaction/i.test(String(item)))
    || (card?.effects || []).some((effect) => /reaction/i.test(`${effect.timing || ""}:${effect.kind || ""}`));
}

function hasDevelopmentEffect(card) {
  return (card?.effects || []).some((effect) => /channel|addenergy|addpower|draw|predict|search/i.test(String(effect.kind || "")));
}

function energy(card) { return Math.max(0, Number(card?.energy) || 0); }
function ratio(cards, predicate) { return cards.length ? cards.filter(predicate).length / cards.length : 0; }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function shuffle(items, random) { for (let index = items.length - 1; index > 0; index -= 1) { const target = Math.floor(random() * (index + 1)); [items[index], items[target]] = [items[target], items[index]]; } }
function emptyProfile() {
  return {
    deckCount: 0, immediatePoolCount: 0, expectedEnergy: 0,
    earlyProbability: 0, highCostProbability: 0, unitProbability: 0,
    reactionProbability: 0, developmentProbability: 0,
    mulliganBottomCount: 0, mulliganBottomCardsAhead: null,
    knownBottomCount: 0, knownBottomBatchCount: 0, topCards: []
  };
}
