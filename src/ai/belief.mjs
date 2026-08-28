import { cards, decklists } from "../cards.mjs";
import { isInherentReaction } from "../rules/keywords.mjs";
import { observeGame } from "./observation.mjs";

const CARD_BY_NUMBER = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));

const DEFAULT_DECK_PROFILES = Object.freeze(Object.fromEntries(
  Object.values(decklists).map((deck) => [deck.id, Object.freeze(profileDeck(deck))])
));

export function inferOpponentDeckBelief(game, viewerId, model = {}) {
  const observation = observeGame(game, viewerId);
  if (!observation) return emptyBelief();
  const profiles = Object.values(model.deckProfiles || defaultDeckProfiles());
  const observed = observedOpponentCards(observation);
  const responseEvidence = opponentResponseEvidence(observation);
  const legendNumber = observation.opponent.legend?.cardNumber;
  const candidates = profiles.filter((profile) => !legendNumber || profile.legendCardNumber === legendNumber);
  const scored = (candidates.length ? candidates : profiles).map((profile) => ({
    profile,
    logProbability: logPosterior(profile, observed, model)
  }));
  const maximum = Math.max(...scored.map((item) => item.logProbability), -100);
  const weights = scored.map((item) => Math.exp(item.logProbability - maximum));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  const posterior = scored.map((item, index) => ({
    deckId: item.profile.id,
    name: item.profile.name,
    probability: weights[index] / total,
    profile: item.profile
  })).sort((left, right) => right.probability - left.probability);
  const cardProbabilities = conditionCardsOnResponsePasses(
    aggregateRemainingCards(posterior, observed, observation.opponent.handCount),
    responseEvidence,
    observation.turnSequence
  );
  return {
    posterior,
    cardProbabilities,
    observedCards: Object.fromEntries(observed),
    entropy: -posterior.reduce((sum, item) => sum + item.probability * Math.log(Math.max(1e-9, item.probability)), 0),
    confidence: posterior[0]?.probability >= 0.75 ? "high" : posterior[0]?.probability >= 0.45 ? "medium" : "low",
    responseEvidence: summarizeResponseEvidence(responseEvidence, observation.turnSequence),
    aggregate: aggregateProfiles(posterior)
  };
}

export function publicOpponentPlan(game, viewerId, model = {}) {
  const belief = inferOpponentDeckBelief(game, viewerId, model);
  const self = game.players.find((player) => player.id === viewerId);
  const opponent = game.players.find((player) => player.id !== viewerId);
  const publicProfile = opponent?.legend?.cardNumber ? model.archetypeStats?.[opponent.legend.cardNumber] : null;
  if (publicProfile?.games > 0) {
    belief.aggregate = {
      ...belief.aggregate,
      unitRatio: publicProfile.unitRatio ?? belief.aggregate.unitRatio,
      spellRatio: publicProfile.spellRatio ?? belief.aggregate.spellRatio,
      gearRatio: publicProfile.gearRatio ?? belief.aggregate.gearRatio,
      reactionRatio: publicProfile.reactionRatio ?? belief.aggregate.reactionRatio,
      averageEnergy: publicProfile.averageEnergy ?? belief.aggregate.averageEnergy
    };
  }
  const scoreLead = (self?.score || 0) - (opponent?.score || 0);
  if (scoreLead <= -2) return { kind: "pressure", belief, reason: "점수 열세를 만회하기 위해 득점 속도를 높입니다." };
  if (scoreLead >= 3) return { kind: "protectLead", belief, reason: "점수 우위를 지키기 위해 반응 자원과 방어를 보존합니다." };
  if (belief.aggregate.unitRatio >= 0.62 && belief.aggregate.averageEnergy <= 3.2) {
    return { kind: "stabilize", belief, reason: "공개 카드로 추정한 상대 덱이 저비용 유닛 중심이므로 초반 교환과 안정화를 우선합니다." };
  }
  if (belief.aggregate.averageEnergy >= 4 || belief.aggregate.spellRatio >= 0.38) {
    return { kind: "pressure", belief, reason: "공개 카드로 추정한 상대 덱이 느린 자원전 성향이므로 핵심 턴 전에 압박합니다." };
  }
  if (belief.aggregate.reactionRatio >= 0.2) {
    return { kind: "probe", belief, reason: "상대의 반응 카드 확률이 높아 낮은 가치의 행동으로 반응을 먼저 확인합니다." };
  }
  return { kind: "flexible", belief, reason: "상대 덱 posterior가 분산되어 있어 공개 정보가 늘어날 때까지 유연하게 운영합니다." };
}

function logPosterior(profile, observed, model) {
  const stat = model.deckStats?.[profile.id];
  const externalWeight = model.externalMeta?.deckWeights?.[profile.id] || 0;
  const prior = (stat?.games || 0) + 4 + externalWeight * Math.max(4, model.externalMeta?.games || 0);
  let value = Math.log(prior);
  for (const [cardNumber, count] of observed) {
    const copies = profile.cardCounts?.[cardNumber] || 0;
    if (copies < count) value += Math.log(1e-6) * (count - copies);
    value += count * Math.log((copies + 0.05) / Math.max(1, profile.mainSize));
  }
  return value;
}

function aggregateRemainingCards(posterior, observed, handCount) {
  const scores = new Map();
  for (const candidate of posterior) {
    for (const [cardNumber, copies] of Object.entries(candidate.profile.cardCounts || {})) {
      const remaining = Math.max(0, copies - (observed.get(cardNumber) || 0));
      if (!remaining) continue;
      const deckRemaining = Math.max(1, candidate.profile.mainSize - [...observed.values()].reduce((sum, value) => sum + value, 0));
      const chanceInHand = 1 - ((deckRemaining - remaining) / deckRemaining) ** Math.max(1, handCount);
      scores.set(cardNumber, (scores.get(cardNumber) || 0) + candidate.probability * chanceInHand);
    }
  }
  return [...scores.entries()].map(([cardNumber, probability]) => ({ cardNumber, probability }))
    .sort((left, right) => right.probability - left.probability);
}

function observedOpponentCards(observation) {
  const counts = new Map();
  const opponentId = observation.opponent.id;
  const observedCards = [
    ...observation.opponent.base,
    ...observation.opponent.trash,
    ...observation.opponent.banished,
    ...observation.opponent.hand,
    ...(observation.chainCards || []).filter((card) => card.controllerId === opponentId || card.ownerId === opponentId),
    ...observation.battlefields.flatMap((field) => field.units.filter((card) => card.controllerId === opponentId))
  ];
  for (const card of observedCards) if (card.cardNumber) counts.set(card.cardNumber, (counts.get(card.cardNumber) || 0) + 1);
  return counts;
}

function opponentResponseEvidence(observation) {
  return (observation.responseObservations || []).filter((event) =>
    event.outcome === "pass"
    && event.sourcePlayerId === observation.self.id
    && event.responderId === observation.opponent.id
  );
}

function conditionCardsOnResponsePasses(cardProbabilities, evidence, currentTurnSequence) {
  if (!evidence.length) return cardProbabilities;
  const recent = evidence.slice(-6);
  return cardProbabilities.map((item) => {
    const card = CARD_BY_NUMBER.get(item.cardNumber);
    if (!card || !isInherentReaction(card)) return item;
    let probability = clamp01(item.probability);
    let evidenceStrength = 0;
    for (const event of recent) {
      if (!reactionWasPubliclyAffordable(card, event)) continue;
      const age = Math.max(0, (currentTurnSequence || 0) - (event.turnSequence || 0));
      const freshness = Math.exp(-0.32 * age);
      const severity = reactionInformationValue(card);
      const useChance = Math.min(0.68, (0.16 + 0.36 * clamp01(event.probeStrength)) * severity * freshness);
      const denominator = Math.max(1e-6, 1 - probability * useChance);
      probability = clamp01(probability * (1 - useChance) / denominator);
      evidenceStrength += useChance;
    }
    return { ...item, probability, passEvidenceStrength: evidenceStrength };
  }).sort((left, right) => right.probability - left.probability);
}

function reactionWasPubliclyAffordable(card, event) {
  const requirements = (card.power || []).flatMap((requirement) => Array.from(
    { length: Math.max(0, Number(requirement.amount) || 0) },
    () => normalizedDomain(requirement.domain || requirement.color || requirement.type || "Any")
  ));
  const runes = (event.responderRunes || []).map((rune) => ({
    domain: normalizedDomain(rune.domain),
    ready: !rune.exhausted
  }));
  const pooledPower = (event.responderPoolPowerDomains || []).map((domain) => ({
    domain: normalizedDomain(domain),
    ready: false,
    pooled: true
  }));
  const resources = [...pooledPower, ...runes];
  let readyRunesUsedForPower = 0;
  for (const requirement of requirements) {
    let index = resources.findIndex((resource) => resource.domain === requirement && !resource.used);
    if (index < 0) index = resources.findIndex((resource) => isAnyDomain(resource.domain) && !resource.used);
    if (index < 0 && isAnyDomain(requirement)) index = resources.findIndex((resource) => !resource.used);
    if (index < 0) return false;
    resources[index].used = true;
    if (resources[index].ready) readyRunesUsedForPower += 1;
  }
  const readyRunes = runes.filter((rune) => rune.ready).length;
  const energyCapacity = Math.max(0, readyRunes - readyRunesUsedForPower) + (event.responderPoolEnergy || 0);
  return energyCapacity >= Math.max(0, Number(card.energy) || 0);
}

function reactionInformationValue(card) {
  const kinds = (card.effects || []).map((effect) => String(effect.kind || "").toLowerCase());
  if (kinds.some((kind) => /kill|destroy|banish|counter|prevent/.test(kind))) return 1;
  if (kinds.some((kind) => /damage|stun|return|recall|move|might|buff|shield/.test(kind))) return 0.82;
  return 0.62;
}

function summarizeResponseEvidence(evidence, currentTurnSequence) {
  const recent = evidence.filter((event) => (currentTurnSequence || 0) - (event.turnSequence || 0) <= 4);
  return {
    observedPasses: evidence.length,
    recentPasses: recent.length,
    strength: recent.reduce((sum, event) => sum + clamp01(event.probeStrength), 0),
    lastSourceCardNumber: evidence.at(-1)?.sourceCardNumber || null
  };
}

function normalizedDomain(domain) {
  return String(domain || "Any").toLowerCase();
}

function isAnyDomain(domain) {
  return ["", "any", "generic"].includes(normalizedDomain(domain));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function aggregateProfiles(posterior) {
  return posterior.reduce((output, item) => {
    output.unitRatio += item.probability * (item.profile.unitRatio || 0);
    output.spellRatio += item.probability * (item.profile.spellRatio || 0);
    output.gearRatio += item.probability * (item.profile.gearRatio || 0);
    output.reactionRatio += item.probability * (item.profile.reactionRatio || 0);
    output.averageEnergy += item.probability * (item.profile.averageEnergy || 0);
    return output;
  }, { unitRatio: 0, spellRatio: 0, gearRatio: 0, reactionRatio: 0, averageEnergy: 0 });
}

function defaultDeckProfiles() {
  return DEFAULT_DECK_PROFILES;
}

export function profileDeck(deck) {
  const cardCounts = {};
  for (const card of deck.main || []) cardCounts[card.cardNumber] = (cardCounts[card.cardNumber] || 0) + 1;
  const total = Math.max(1, deck.main?.length || 0);
  return {
    id: deck.id,
    name: deck.playerName || deck.id,
    legendCardNumber: deck.legend?.cardNumber,
    cardCounts,
    mainSize: total,
    unitRatio: deck.main.filter((card) => card.type === "unit").length / total,
    spellRatio: deck.main.filter((card) => card.type === "spell").length / total,
    gearRatio: deck.main.filter((card) => card.type === "gear").length / total,
    reactionRatio: deck.main.filter((card) => card.tags?.includes("Reaction") || card.keywords?.includes("Reaction")).length / total,
    averageEnergy: deck.main.reduce((sum, card) => sum + (card.energy || 0), 0) / total,
    runeDomains: [...new Set((deck.runes || []).map((rune) => rune.domain))],
    battlefields: (deck.battlefields || []).map((field) => field.cardNumber)
  };
}

function emptyBelief() { return { posterior: [], cardProbabilities: [], observedCards: {}, entropy: 0, confidence: "low", responseEvidence: { observedPasses: 0, recentPasses: 0, strength: 0, lastSourceCardNumber: null }, aggregate: { unitRatio: 0, spellRatio: 0, gearRatio: 0, reactionRatio: 0, averageEnergy: 0 } }; }
