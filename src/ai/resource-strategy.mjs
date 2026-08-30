import { isInherentReaction } from "../rules/keywords.mjs";
import { cards } from "../cards.mjs";
import { inferOpponentDeckBelief } from "./belief.mjs";

const RESOURCE_KINDS = new Set(["addEnergy", "addPower"]);
const DOMAINS = ["Body", "Calm", "Chaos", "Fury", "Mind", "Order"];
const CARD_BY_NUMBER = new Map(Object.values(cards).map((card) => [card.cardNumber, card]));

export function isPureResourceAbilitySpecs(specs) {
  return Boolean(specs?.length) && specs.every((spec) => RESOURCE_KINDS.has(spec?.kind));
}

export function activatedEffectGroups(card) {
  const groups = new Map();
  for (const [index, effect] of (card?.effects || []).entries()) {
    if (effect?.timing !== "activated") continue;
    const key = effect.abilityId || `effect-${index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(effect);
  }
  return [...groups.values()];
}

export function reactionReserveProfile(game, playerId) {
  const player = game?.players?.find((candidate) => candidate.id === playerId);
  const opponent = game?.players?.find((candidate) => candidate.id !== playerId);
  if (!player) return emptyReserveProfile();
  const reactions = (player.hand || []).filter(isInherentReaction);
  const assessed = reactions.map((card) => assessReactionReserve(game, player, card));
  const affordable = assessed.filter((item) => item.payable);
  const partial = assessed.reduce((sum, item) => sum + item.coverage, 0);
  const readyRunes = player.runes.filter((rune) => !rune.exhausted);
  const runeDomains = Object.fromEntries(DOMAINS.map((domain) => [domain, player.runes.filter((rune) => sameDomain(rune.domain, domain)).length]));
  const readyRuneDomains = Object.fromEntries(DOMAINS.map((domain) => [domain, readyRunes.filter((rune) => sameDomain(rune.domain, domain)).length]));
  const threat = opponentThreat(game, opponent, playerId);
  const best = assessed.sort((left, right) => right.reserveValue - left.reserveValue)[0] || null;
  return {
    reactionCards: reactions.length,
    affordableReactions: affordable.length,
    coverage: reactions.length ? partial / reactions.length : 0,
    reserveValue: assessed.map((item) => item.reserveValue).sort((a, b) => b - a).slice(0, 2).reduce((sum, value) => sum + value, 0),
    minimumEnergy: reactions.length ? Math.min(...reactions.map((card) => Math.max(0, Number(card.energy) || 0))) : 0,
    maximumEnergy: reactions.length ? Math.max(...reactions.map((card) => Math.max(0, Number(card.energy) || 0))) : 0,
    requiredPowerDomains: unique(reactions.flatMap((card) => powerRequirements(card).map((requirement) => requirement.domain))),
    readyRunes: readyRunes.length,
    runeDomains,
    readyRuneDomains,
    generatedEnergy: player.runePool?.energy?.length || 0,
    generatedPower: player.runePool?.power?.length || 0,
    readyResourceSources: resourceSources(game, player).filter((source) => source.ready).length,
    threat,
    bestReactionCardNumber: best?.cardNumber || null
  };
}

export function opponentResponseProfile(game, viewerId, model = {}) {
  const opponent = game?.players?.find((player) => player.id !== viewerId);
  if (!opponent) return emptyOpponentResponseProfile();
  const belief = inferOpponentDeckBelief(game, viewerId, model?.knowledge || model);
  const candidates = belief.cardProbabilities
    .map((item) => {
      const card = CARD_BY_NUMBER.get(item.cardNumber);
      if (!card || !isInherentReaction(card)) return null;
      const affordability = publicCardAffordability(game, opponent, card);
      const probability = affordability.payable ? clamp01(item.probability) : 0;
      return {
        cardNumber: item.cardNumber,
        probability,
        handProbability: clamp01(item.probability),
        payable: affordability.payable,
        energyCost: affordability.energyCost,
        powerCost: affordability.powerCost,
        severity: responseSeverity(card),
        requiredPowerDomains: affordability.requiredPowerDomains
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.probability * right.severity - left.probability * left.severity
      || left.cardNumber.localeCompare(right.cardNumber));
  const affordable = candidates.filter((item) => item.payable && item.probability > 0);
  const responseProbability = clamp01(1 - affordable.reduce((none, item) => none * (1 - item.probability), 1));
  const expectedSeverity = affordable.reduce((sum, item) => sum + item.probability * item.severity, 0);
  return {
    responseProbability,
    expectedSeverity,
    expectedThreat: responseProbability * Math.min(2, expectedSeverity),
    affordableResponses: affordable.length,
    candidateResponses: candidates.length,
    confidence: belief.confidence,
    observedPasses: belief.responseEvidence?.observedPasses || 0,
    recentPasses: belief.responseEvidence?.recentPasses || 0,
    passEvidenceStrength: belief.responseEvidence?.strength || 0,
    topResponses: candidates.slice(0, 5)
  };
}

export function cardResourceAffordability(game, playerId, card) {
  const player = game?.players?.find((candidate) => candidate.id === playerId);
  if (!player || !card) return {
    payable: false,
    energyCost: 0,
    energyCapacity: 0,
    powerCost: 0,
    powerMatched: 0,
    coverage: 0,
    requiredPowerDomains: []
  };
  return publicCardAffordability(game, player, card);
}

export function strategicResourceCommitment(before, after, playerId) {
  const beforePlayer = before?.players?.find((player) => player.id === playerId);
  const afterPlayer = after?.players?.find((player) => player.id === playerId);
  if (!beforePlayer || !afterPlayer) return emptyCommitmentProfile();
  const readyBefore = beforePlayer.runes.filter((rune) => !rune.exhausted).length;
  const readyAfter = afterPlayer.runes.filter((rune) => !rune.exhausted).length;
  const poolBefore = (beforePlayer.runePool?.energy?.length || 0) + (beforePlayer.runePool?.power?.length || 0);
  const poolAfter = (afterPlayer.runePool?.energy?.length || 0) + (afterPlayer.runePool?.power?.length || 0);
  const reserveBefore = reactionReserveProfile(before, playerId);
  const reserveAfter = reactionReserveProfile(after, playerId);
  const spentReadyRunes = Math.max(0, readyBefore - readyAfter);
  const spentGenerated = Math.max(0, poolBefore - poolAfter);
  const reserveLoss = Math.max(0, reserveBefore.reserveValue - reserveAfter.reserveValue);
  const commitment = clamp01(
    spentReadyRunes / Math.max(1, readyBefore)
    + spentGenerated / Math.max(2, poolBefore + 1) * 0.35
    + reserveLoss / Math.max(1, reserveBefore.reserveValue) * 0.45
  );
  return {
    commitment,
    posture: commitment >= 0.75 || (readyBefore > 0 && readyAfter === 0) ? "commit" : commitment <= 0.2 ? "reserve" : "balanced",
    allIn: readyBefore > 0 && readyAfter === 0,
    readyRunesBefore: readyBefore,
    readyRunesAfter: readyAfter,
    spentReadyRunes,
    spentGenerated,
    reserveValueBefore: reserveBefore.reserveValue,
    reserveValueAfter: reserveAfter.reserveValue,
    reserveCoverageAfter: reserveAfter.coverage,
    affordableReactionsAfter: reserveAfter.affordableReactions
  };
}

export function resourceSourceOpportunityCost(before, after, playerId) {
  const beforePlayer = before?.players?.find((player) => player.id === playerId);
  const afterPlayer = after?.players?.find((player) => player.id === playerId);
  if (!beforePlayer || !afterPlayer) return 0;
  const beforeSources = resourceSources(before, beforePlayer);
  const afterCards = new Map(activeControlledCards(after, afterPlayer).map((card) => [card.instanceId, card]));
  let cost = 0;
  for (const source of beforeSources) {
    if (!source.ready) continue;
    const afterCard = afterCards.get(source.card.instanceId);
    if (!afterCard) {
      cost += 0.24 + permanentValue(source.card);
      continue;
    }
    if (!source.card.exhausted && afterCard.exhausted) {
      cost += 0.05;
      if (source.card.type === "legend") cost += 0.04;
      if (source.hasAlternativeAbility) cost += 0.18;
    }
  }
  const afterIds = new Set(activeControlledCards(after, afterPlayer).map((card) => card.instanceId));
  for (const card of activeControlledCards(before, beforePlayer)) {
    if (afterIds.has(card.instanceId) || beforeSources.some((source) => source.card.instanceId === card.instanceId)) continue;
    cost += permanentValue(card);
  }
  return cost;
}

function assessReactionReserve(game, player, card) {
  const energyCost = Math.max(0, Number(card.energy) || 0);
  const requirements = powerRequirements(card);
  const sources = resourceSources(game, player, card).filter((source) => source.ready);
  const readyRunes = player.runes.filter((rune) => !rune.exhausted);
  const powerResources = [
    ...player.runes.map((rune) => ({ domain: rune.domain || "Any", usesReadyRune: !rune.exhausted })),
    ...sources.flatMap((source) => source.power.map((resource) => ({ ...resource, usesReadyRune: false })))
  ];
  const powerMatch = matchPower(powerResources, requirements);
  // A ready Basic Rune can become either Energy or Power for this payment,
  // never both. Power allocated from a ready Rune therefore reduces the
  // remaining Energy capacity; generated resources and exhausted Runes do not.
  const energyCapacity = sources.reduce((sum, source) => sum + source.energy, 0)
    + Math.max(0, readyRunes.length - powerMatch.readyRunesUsed);
  const powerCost = requirements.reduce((sum, requirement) => sum + requirement.amount, 0);
  const energyCoverage = energyCost ? Math.min(1, energyCapacity / energyCost) : 1;
  const powerCoverage = powerCost ? Math.min(1, powerMatch.matched / powerCost) : 1;
  const coverage = Math.min(energyCoverage, powerCoverage);
  return {
    cardNumber: card.cardNumber || null,
    payable: coverage >= 1,
    coverage,
    reserveValue: coverage * (1 + Math.min(0.5, energyCost * 0.06 + powerCost * 0.1))
  };
}

function publicCardAffordability(game, player, card) {
  const energyCost = Math.max(0, Number(card.energy) || 0);
  const requirements = powerRequirements(card);
  const sources = resourceSources(game, player, card).filter((source) => source.ready);
  const readyRunes = player.runes.filter((rune) => !rune.exhausted);
  const energyPool = player.runePool?.energy;
  const pooledEnergy = Array.isArray(energyPool)
    ? energyPool.filter((resource) => resourceRestrictionAllows(game, resource?.restriction, card)).length
    : Number.isInteger(energyPool) && energyPool >= 0 ? energyPool : 0;
  const powerResources = [
    ...player.runes.map((rune) => ({ domain: rune.domain || "Any", usesReadyRune: !rune.exhausted })),
    ...(player.runePool?.power || [])
      .filter((resource) => resourceRestrictionAllows(game, resource?.restriction, card))
      .map((resource) => ({
        domain: resource.domain || "Any",
        restriction: resource.restriction ?? null,
        usesReadyRune: false
      })),
    ...sources.flatMap((source) => source.power.map((resource) => ({ ...resource, usesReadyRune: false })))
  ];
  const powerMatch = matchPower(powerResources, requirements);
  const energyCapacity = pooledEnergy + sources.reduce((sum, source) => sum + source.energy, 0)
    + Math.max(0, readyRunes.length - powerMatch.readyRunesUsed);
  const powerCost = requirements.reduce((sum, requirement) => sum + requirement.amount, 0);
  const energyCoverage = energyCost ? Math.min(1, energyCapacity / energyCost) : 1;
  const powerCoverage = powerCost ? Math.min(1, powerMatch.matched / powerCost) : 1;
  return {
    payable: energyCapacity >= energyCost && powerMatch.matched >= powerCost,
    energyCost,
    energyCapacity,
    powerCost,
    powerMatched: powerMatch.matched,
    coverage: Math.min(energyCoverage, powerCoverage),
    requiredPowerDomains: unique(requirements.map((requirement) => requirement.domain))
  };
}

function responseSeverity(card) {
  let severity = 0.35;
  for (const effect of card?.effects || []) {
    const kind = String(effect?.kind || "").toLowerCase();
    const amount = Math.max(1, Math.abs(Number(effect?.amount || effect?.damage || effect?.might || 1)));
    if (/kill|destroy|banish|steal|capture/.test(kind)) severity += 0.65;
    else if (/damage|stun|exhaust|return|recall|move/.test(kind)) severity += 0.35 + Math.min(0.3, amount * 0.06);
    else if (/might|buff|prevent|shield|barrier|ready/.test(kind)) severity += 0.25 + Math.min(0.25, amount * 0.05);
    else severity += 0.08;
  }
  return Math.min(2, severity);
}

function resourceSources(game, player, paidCard = null) {
  return activeControlledCards(game, player).flatMap((card) => {
    const groups = activatedEffectGroups(card);
    const resourceGroups = groups.filter(isPureResourceAbilitySpecs);
    if (!resourceGroups.length) return [];
    const hasAlternativeAbility = groups.some((specs) => !isPureResourceAbilitySpecs(specs));
    return resourceGroups.map((specs) => {
      const reaction = specs.every((spec) => (spec.abilityKeywords || []).some((keyword) => String(keyword).toLowerCase() === "reaction"));
      const destructive = specs.some((spec) => spec.killSelfCost || spec.recycleSelfCost || spec.killFriendlyPermanentCost
        || spec.discardCost || spec.recycleTrashCost || spec.energyCost || spec.powerCost);
      const compatible = specs.every((spec) => resourceRestrictionAllows(game, spec.restriction, paidCard));
      const requiresUnavailableCondition = specs.some((spec) => spec.requiresLegion);
      const exhausts = specs.some((spec) => spec.exhaust || spec.exhaustSelf);
      return {
        card,
        specs,
        hasAlternativeAbility,
        ready: reaction && compatible && !destructive && !requiresUnavailableCondition && (!exhausts || !card.exhausted),
        energy: specs.filter((spec) => spec.kind === "addEnergy").reduce((sum, spec) => sum + Math.max(0, Number(spec.amount) || 0), 0),
        power: specs.filter((spec) => spec.kind === "addPower").flatMap((spec) => Array.from(
          { length: Math.max(0, Number(spec.amount) || 0) },
          () => ({ domain: spec.domain || "Any", restriction: spec.restriction ?? null })
        ))
      };
    });
  });
}

function activeControlledCards(game, player) {
  const cards = [
    player.legend,
    player.champion?.zone === "played" ? player.champion : null,
    ...(player.base || []),
    ...(game?.battlefields || []).flatMap((field) => (field.units || []).filter((card) => card.controllerId === player.id))
  ].filter(Boolean);
  return uniqueCards(cards.flatMap((card) => [card, ...(card.attachments || [])]));
}

function powerRequirements(card) {
  return (card?.power || []).map((requirement) => ({
    domain: requirement.domain || requirement.color || requirement.type || "Any",
    amount: Math.max(0, Number(requirement.amount) || 0)
  })).filter((requirement) => requirement.amount > 0);
}

function matchPower(resources, requirements) {
  const exactRequirements = new Map();
  let anyRequirements = 0;
  for (const requirement of requirements) {
    if (isAny(requirement.domain)) anyRequirements += requirement.amount;
    else exactRequirements.set(normalizedDomain(requirement.domain), (exactRequirements.get(normalizedDomain(requirement.domain)) || 0) + requirement.amount);
  }
  const exactResources = new Map();
  const anyResources = { ready: 0, other: 0 };
  for (const resource of resources) {
    const bucket = resource.usesReadyRune ? "ready" : "other";
    if (isAny(resource.domain)) anyResources[bucket] += 1;
    else {
      const domain = normalizedDomain(resource.domain);
      if (!exactResources.has(domain)) exactResources.set(domain, { ready: 0, other: 0 });
      exactResources.get(domain)[bucket] += 1;
    }
  }

  let matched = 0;
  let readyRunesUsed = 0;
  let exactShortfall = 0;
  for (const [domain, needed] of exactRequirements) {
    const available = exactResources.get(domain) || { ready: 0, other: 0 };
    const otherUsed = Math.min(needed, available.other);
    const readyUsed = Math.min(needed - otherUsed, available.ready);
    available.other -= otherUsed;
    available.ready -= readyUsed;
    matched += otherUsed + readyUsed;
    readyRunesUsed += readyUsed;
    exactShortfall += needed - otherUsed - readyUsed;
  }
  const wildcardOtherUsed = Math.min(exactShortfall, anyResources.other);
  const wildcardReadyUsed = Math.min(exactShortfall - wildcardOtherUsed, anyResources.ready);
  anyResources.other -= wildcardOtherUsed;
  anyResources.ready -= wildcardReadyUsed;
  matched += wildcardOtherUsed + wildcardReadyUsed;
  readyRunesUsed += wildcardReadyUsed;

  const remainingOther = anyResources.other + [...exactResources.values()].reduce((sum, value) => sum + value.other, 0);
  const remainingReady = anyResources.ready + [...exactResources.values()].reduce((sum, value) => sum + value.ready, 0);
  const anyOtherUsed = Math.min(anyRequirements, remainingOther);
  const anyReadyUsed = Math.min(anyRequirements - anyOtherUsed, remainingReady);
  matched += anyOtherUsed + anyReadyUsed;
  readyRunesUsed += anyReadyUsed;
  return { matched, readyRunesUsed };
}

function resourceRestrictionAllows(game, restriction, paidCard) {
  if (!restriction) return true;
  if (restriction === "showdown") return game?.phase === "showdown";
  if (restriction === "spell") return cardIncludesType(paidCard, "spell");
  if (restriction === "unitOrUnitAbility") return cardIncludesType(paidCard, "unit");
  if (restriction === "gear") return cardIncludesType(paidCard, "gear");
  return false;
}

function cardIncludesType(card, type) {
  return Boolean(card && (card.type === type || (card.types || []).includes(type)));
}

function opponentThreat(game, opponent, playerId) {
  if (!opponent) return 0;
  const units = (game?.battlefields || []).flatMap((field) => (field.units || []).filter((unit) => unit.controllerId === opponent.id));
  const might = units.reduce((sum, unit) => sum + Math.max(0, Number(unit.might || 0) + Number(unit.mightModifier || 0) + Number(unit.buffs || 0) - Number(unit.damage || 0)), 0);
  const controlled = (game?.battlefields || []).filter((field) => field.controlledBy === opponent.id).length;
  const victoryPressure = (opponent.score || 0) >= (game?.victoryScore || 8) - 2 ? 0.5 : 0;
  const activePressure = game?.currentPlayerId === opponent.id && opponent.id !== playerId ? 0.15 : 0;
  return Math.min(1.5, might / 20 + controlled * 0.12 + victoryPressure + activePressure);
}

function permanentValue(card) {
  if (!card) return 0;
  if (card.type === "unit") return 0.08 + Math.max(0, Number(card.might) || 0) * 0.025;
  if (card.type === "gear") return 0.12;
  if (card.type === "legend") return 0.18;
  return 0.06;
}

function sameDomain(left, right) {
  return String(left || "Any").toLowerCase() === String(right || "Any").toLowerCase();
}

function normalizedDomain(domain) {
  return String(domain || "Any").toLowerCase();
}

function isAny(domain) {
  return ["", "any", "generic"].includes(String(domain || "Any").toLowerCase());
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueCards(cards) {
  return [...new Map(cards.filter(Boolean).map((card) => [card.instanceId, card])).values()];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function emptyReserveProfile() {
  return {
    reactionCards: 0, affordableReactions: 0, coverage: 0, reserveValue: 0,
    minimumEnergy: 0, maximumEnergy: 0, requiredPowerDomains: [], readyRunes: 0,
    runeDomains: {}, readyRuneDomains: {}, generatedEnergy: 0, generatedPower: 0,
    readyResourceSources: 0, threat: 0, bestReactionCardNumber: null
  };
}

function emptyOpponentResponseProfile() {
  return {
    responseProbability: 0, expectedSeverity: 0, expectedThreat: 0,
    affordableResponses: 0, candidateResponses: 0, confidence: "low",
    observedPasses: 0, recentPasses: 0, passEvidenceStrength: 0, topResponses: []
  };
}

function emptyCommitmentProfile() {
  return {
    commitment: 0, posture: "reserve", allIn: false,
    readyRunesBefore: 0, readyRunesAfter: 0, spentReadyRunes: 0, spentGenerated: 0,
    reserveValueBefore: 0, reserveValueAfter: 0, reserveCoverageAfter: 0, affordableReactionsAfter: 0
  };
}
