export function enumerateMulliganPlans(game, actorId) {
  if (game?.phase !== "mulligan" || game.mulligan?.playerId !== actorId) return [];
  const player = game.players.find((candidate) => candidate.id === actorId);
  if (!player) return [];
  const plans = [{ kind: "submitMulligan", cardIds: [] }];
  for (let first = 0; first < player.hand.length; first += 1) {
    plans.push({ kind: "submitMulligan", cardIds: [player.hand[first].instanceId] });
    for (let second = first + 1; second < player.hand.length; second += 1) {
      plans.push({ kind: "submitMulligan", cardIds: [player.hand[first].instanceId, player.hand[second].instanceId] });
    }
  }
  const unique = new Map();
  for (const plan of plans) {
    const signature = plan.cardIds.map((id) => player.hand.find((card) => card.instanceId === id)?.cardNumber || id).sort().join("|");
    if (!unique.has(signature)) unique.set(signature, plan);
  }
  return [...unique.values()];
}

export function mulliganPlanProfile(game, actorId, action) {
  const player = game?.players?.find((candidate) => candidate.id === actorId);
  if (!player || action?.kind !== "submitMulligan") return emptyProfile();
  const selectedIds = new Set(action.cardIds || []);
  const selected = player.hand.filter((card) => selectedIds.has(card.instanceId));
  const kept = player.hand.filter((card) => !selectedIds.has(card.instanceId));
  const deck = player.mainDeck || [];
  const deckProfile = openingDeckProfile(player);
  const before = openingHandQuality(player.hand, deckProfile);
  const expectedDrawValue = deck.length
    ? deck.reduce((sum, card) => sum + openingCardValue(card, deckProfile), 0) / deck.length
    : 0;
  const expectedEarlyDraws = selected.length * deckProfile.earlyRatio;
  const expectedAfter = kept.reduce((sum, card) => sum + openingCardValue(card, deckProfile), 0)
    + selected.length * expectedDrawValue
    + curveFit(kept.filter(isEarlyCard).length + expectedEarlyDraws, player.hand.length)
    - duplicatePenalty(kept);
  const expectedDelta = clamp((expectedAfter - before) / 2.5, -1, 1);
  return {
    selectedCount: selected.length,
    averageSelectedEnergy: selected.length ? selected.reduce((sum, card) => sum + energy(card), 0) / selected.length : 0,
    selectedHighCostRatio: selected.length ? selected.filter((card) => energy(card) >= 5).length / selected.length : 0,
    selectedEarlyRatio: selected.length ? selected.filter(isEarlyCard).length / selected.length : 0,
    keptEarlyCards: kept.filter(isEarlyCard).length,
    keptDuplicatePenalty: duplicatePenalty(kept),
    expectedDelta,
    selectedCardNumbers: selected.map((card) => card.cardNumber).filter(Boolean).sort()
  };
}

function openingDeckProfile(player) {
  const cards = [...(player.hand || []), ...(player.mainDeck || [])];
  const runes = [...(player.runes || []), ...(player.runeDeck || [])];
  const averageEnergy = cards.length ? cards.reduce((sum, card) => sum + energy(card), 0) / cards.length : 3;
  return {
    averageEnergy,
    earlyRatio: cards.length ? cards.filter(isEarlyCard).length / cards.length : 0,
    runeDomains: new Set(runes.map((rune) => normalizeDomain(rune.domain)))
  };
}

function openingHandQuality(hand, profile) {
  return hand.reduce((sum, card) => sum + openingCardValue(card, profile), 0)
    + curveFit(hand.filter(isEarlyCard).length, hand.length)
    - duplicatePenalty(hand);
}

function openingCardValue(card, profile) {
  const cost = energy(card);
  const target = clamp(2.35 + (profile.averageEnergy - 3) * 0.12, 2.1, 2.8);
  let value = 1.1 - Math.abs(cost - target) * 0.3;
  if (cost >= 6) value -= 0.35 + (cost - 6) * 0.08;
  if (card.type === "unit" && cost <= 3) value += 0.18;
  if (hasDevelopmentEffect(card)) value += 0.22;
  if (hasInteraction(card) && cost <= 3) value += 0.1;
  const requiredDomains = (card.power || []).map((requirement) => normalizeDomain(requirement.domain || requirement.color || requirement.type));
  if (requiredDomains.some((domain) => domain !== "any" && !profile.runeDomains.has(domain))) value -= 0.8;
  return value;
}

function curveFit(earlyCards, handSize) {
  const target = Math.min(2, Math.max(1, handSize / 2));
  if (earlyCards < target) return -(target - earlyCards) * 0.45;
  return Math.min(0.25, (earlyCards - target) * 0.08);
}

function duplicatePenalty(cards) {
  const counts = new Map();
  for (const card of cards) counts.set(card.cardNumber || card.name, (counts.get(card.cardNumber || card.name) || 0) + 1);
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1) * 0.16, 0);
}

function hasDevelopmentEffect(card) {
  return (card.effects || []).some((effect) => /channel|addenergy|addpower|draw|predict|search/.test(String(effect.kind || "").toLowerCase()));
}

function hasInteraction(card) {
  return (card.effects || []).some((effect) => /damage|stun|kill|return|recall|move|buff|might|shield|prevent/.test(String(effect.kind || "").toLowerCase()));
}

function isEarlyCard(card) {
  return energy(card) <= 3;
}

function energy(card) {
  return Math.max(0, Number(card?.energy) || 0);
}

function normalizeDomain(domain) {
  return String(domain || "Any").toLowerCase();
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function emptyProfile() {
  return {
    selectedCount: 0, averageSelectedEnergy: 0, selectedHighCostRatio: 0,
    selectedEarlyRatio: 0, keptEarlyCards: 0, keptDuplicatePenalty: 0,
    expectedDelta: 0, selectedCardNumbers: []
  };
}
