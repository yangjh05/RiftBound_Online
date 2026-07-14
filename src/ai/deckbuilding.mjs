import { cards } from "../cards.mjs";
import { profileDeck } from "./belief.mjs";
import { cardAllowedInPool } from "../card-pools.mjs";

const ALL_MAIN_CARDS = Object.values(cards).filter((card) => ["unit", "spell", "gear"].includes(card.type));
const ALL_BATTLEFIELDS = Object.values(cards).filter((card) => card.type === "battlefield");
const NON_IDENTITY_TAGS = new Set(["Champion", "Signature", "Signature Spell", "Action", "Reaction", "Unit", "Spell", "Gear"]);

export function mutateDeck(deck, model, random = Math.random) {
  const roll = random();
  if (roll < 0.15) return mutateRuneDistribution(deck, model, random);
  if (roll < 0.27) return mutateBattlefieldSuite(deck, model, random);
  if (roll < 0.42) return mutateSideboardPackage(deck, model, random);
  return mutateCardPackage(deck, model, random, roll > 0.82 ? 3 : roll > 0.62 ? 2 : 1);
}

export function mutateSideboardPackage(deck, model, random = Math.random) {
  const next = structuredClone(deck);
  next.sideboard ||= [];
  const domains = new Set((next.legend?.domains || []).filter((domain) => domain !== "Any"));
  const legendTags = new Set((next.legend?.tags || []).filter((tag) => !NON_IDENTITY_TAGS.has(tag)));
  const registered = [...next.main, ...next.sideboard];
  const counts = countCards(registered);
  const nameCounts = countCardNames(registered);
  const signatureTotal = registered.filter(isSignature).length;
  const candidates = ALL_MAIN_CARDS.filter((card) =>
    cardAllowed(card, domains, legendTags)
    && cardAllowedForModel(card, model)
    && (counts.get(card.cardNumber) || 0) < 3
    && (nameCounts.get(card.name) || 0) < 3
    && (!isSignature(card) || signatureTotal < 3)
  ).sort((left, right) => learnedSideboardScore(model, right) - learnedSideboardScore(model, left));
  if (!candidates.length) return next;
  const added = candidates[Math.floor(random() * Math.min(12, candidates.length))];
  let removed = null;
  if (next.sideboard.length >= 8) {
    const removable = [...next.sideboard].sort((left, right) => learnedSideboardScore(model, left) - learnedSideboardScore(model, right));
    removed = removable[Math.floor(random() * Math.min(6, removable.length))];
    const index = next.sideboard.findIndex((card) => card.cardNumber === removed.cardNumber);
    next.sideboard[index] = added;
  } else {
    next.sideboard.push(added);
  }
  next.id = `${deck.id}-sideboard-${Date.now().toString(36)}`;
  next.playerName = `${deck.playerName || deck.id} Meta Sideboard`;
  next.evolution = { parentId: deck.id, kind: "sideboard", removed: removed?.cardNumber || null, added: added.cardNumber };
  return next;
}

export function mutateCardPackage(deck, model, random = Math.random, packageSize = 1) {
  const next = structuredClone(deck);
  const domains = new Set((next.legend?.domains || []).filter((domain) => domain !== "Any"));
  const legendTags = new Set((next.legend?.tags || []).filter((tag) => !NON_IDENTITY_TAGS.has(tag)));
  const candidates = ALL_MAIN_CARDS.filter((card) => cardAllowed(card, domains, legendTags) && cardAllowedForModel(card, model));
  const removable = next.main.map((card, index) => ({ card, index }))
    .filter(({ card }) => !isOnlyChampion(next.main, card));
  if (!removable.length || !candidates.length) return next;
  removable.sort((left, right) => learnedCardScore(model, left.card) - learnedCardScore(model, right.card));
  const removePool = removable.slice(0, Math.max(1, Math.ceil(removable.length * 0.35)));
  const changes = [];
  const changedIndices = new Set();
  for (let changeIndex = 0; changeIndex < Math.min(3, packageSize); changeIndex += 1) {
    const availableRemovals = removePool.filter(({ index }) => !changedIndices.has(index));
    if (!availableRemovals.length) break;
    const removed = availableRemovals[Math.floor(random() * availableRemovals.length)];
    const registeredAfterRemoval = [...next.main.filter((card, index) => index !== removed.index), ...(next.sideboard || [])];
    const currentCounts = countCards(registeredAfterRemoval);
    const signatureAfterRemoval = registeredAfterRemoval.filter(isSignature).length;
    const additions = candidates.filter((card) =>
      (currentCounts.get(card.cardNumber) || 0) < 3
      && (!isSignature(card) || signatureAfterRemoval < 3)
    );
    additions.sort((left, right) => packageAdditionScore(model, next.main, right) - packageAdditionScore(model, next.main, left));
    const addPool = additions.slice(0, Math.max(8, Math.ceil(additions.length * 0.2)));
    const added = addPool[Math.floor(random() * addPool.length)];
    if (!added) break;
    next.main[removed.index] = added;
    changedIndices.add(removed.index);
    changes.push({ removed: removed.card.cardNumber, added: added.cardNumber });
  }
  if (!changes.length) return next;
  next.id = `${deck.id}-evolved-${Date.now().toString(36)}`;
  next.playerName = `${deck.playerName || deck.id} Evolved`;
  next.evolution = { parentId: deck.id, kind: "cardPackage", changes };
  return next;
}

export function mutateRuneDistribution(deck, model, random = Math.random) {
  const next = structuredClone(deck);
  const domains = [...new Set((next.legend?.domains || []).filter((domain) => domain !== "Any"))];
  if (domains.length < 2 || !next.runes?.length) return mutateCardPackage(deck, model, random, 1);
  const from = domains[Math.floor(random() * domains.length)];
  const to = domains.find((domain) => domain !== from) || from;
  const fromRuneIndex = next.runes.findIndex((rune) => rune.domain === from);
  const toRune = next.runes.find((rune) => rune.domain === to);
  if (fromRuneIndex < 0 || !toRune) return next;
  next.runes[fromRuneIndex] = structuredClone(toRune);
  next.id = `${deck.id}-runes-${Date.now().toString(36)}`;
  next.playerName = `${deck.playerName || deck.id} Rune Test`;
  next.evolution = { parentId: deck.id, kind: "runes", from, to };
  return next;
}

export function mutateBattlefieldSuite(deck, model, random = Math.random) {
  const next = structuredClone(deck);
  if (!next.battlefields?.length) return next;
  const current = new Set(next.battlefields.map((field) => field.cardNumber));
  const candidates = ALL_BATTLEFIELDS.filter((field) => !current.has(field.cardNumber) && cardAllowedForModel(field, model));

  if (!candidates.length) return next;
  candidates.sort((left, right) => learnedConfigurationScore(model.battlefieldStats, right.cardNumber) - learnedConfigurationScore(model.battlefieldStats, left.cardNumber));
  const replaceIndex = Math.floor(random() * next.battlefields.length);
  const added = candidates[Math.floor(random() * Math.min(8, candidates.length))];
  const removed = next.battlefields[replaceIndex];
  next.battlefields[replaceIndex] = added;
  next.id = `${deck.id}-fields-${Date.now().toString(36)}`;
  next.playerName = `${deck.playerName || deck.id} Battlefield Test`;
  next.evolution = { parentId: deck.id, kind: "battlefields", removed: removed.cardNumber, added: added.cardNumber };
  return next;
}

export function updateDeckLearning(model, decks, winnerId, players) {
  model.deckStats ||= {};
  model.cardStats ||= {};
  model.matchupStats ||= {};
  model.metaStats ||= { games: 0, cardAppearances: {} };
  model.archetypeStats ||= {};
  model.deckProfiles ||= {};
  model.synergyStats ||= {};
  model.runeStats ||= {};
  model.battlefieldStats ||= {};
  model.mutationStats ||= {};
  model.metaStats.games += 1;
  for (let index = 0; index < decks.length; index += 1) {
    const deck = decks[index];
    const player = players[index];
    const reward = player.id === winnerId ? 1 : -1;
    model.deckProfiles[deck.id] = profileDeck(deck);
    const stat = model.deckStats[deck.id] ||= { games: 0, wins: 0, returnSum: 0 };
    stat.games += 1;
    stat.wins += reward > 0 ? 1 : 0;
    stat.returnSum += reward;
    for (const card of deck.main) {
      const cardStat = model.cardStats[card.cardNumber] ||= { games: 0, returnSum: 0, meanReturn: 0 };
      cardStat.games += 1;
      cardStat.returnSum += reward;
      cardStat.meanReturn = cardStat.returnSum / cardStat.games;
    }
    for (const card of new Map(deck.main.map((item) => [item.cardNumber, item])).values()) {
      const meta = model.metaStats.cardAppearances[card.cardNumber] ||= { decks: 0, wins: 0, name: card.name };
      meta.decks += 1;
      meta.wins += reward > 0 ? 1 : 0;
    }
    updateArchetype(model, deck, reward);
    updateSynergies(model, deck, reward);
    updateConfigurationStats(model.runeStats, runeConfigurationKey(deck), reward);
    for (const battlefield of deck.battlefields || []) updateConfigurationStats(model.battlefieldStats, battlefield.cardNumber, reward);
    if (deck.evolution) updateConfigurationStats(model.mutationStats, mutationKey(deck.evolution), reward);
  }
  updateMatchup(model, decks[0], decks[1], players[0].id === winnerId);
  updateMatchup(model, decks[1], decks[0], players[1].id === winnerId);
}

export function deckLeaderboard(model) {
  return Object.entries(model.deckStats || {}).map(([deckId, stat]) => ({
    deckId,
    games: stat.games,
    wins: stat.wins,
    winRate: stat.games ? stat.wins / stat.games : 0
  })).sort((left, right) => right.winRate - left.winRate || right.games - left.games);
}

export function recommendDeckChanges(deck, model, limit = 3) {
  if (!deck?.legend || !deck?.main?.length) return [];
  const domains = new Set((deck.legend.domains || []).filter((domain) => domain !== "Any"));
  const legendTags = new Set((deck.legend.tags || []).filter((tag) => !NON_IDENTITY_TAGS.has(tag)));
  const counts = countCards(deck.main);
  const signatureTotal = deck.main.filter(isSignature).length;
  const removable = [...new Map(deck.main.map((card) => [card.cardNumber, card])).values()]
    .filter((card) => !isOnlyChampion(deck.main, card))
    .sort((left, right) => learnedCardScore(model, left) - learnedCardScore(model, right));
  const additions = ALL_MAIN_CARDS.filter((card) => cardAllowed(card, domains, legendTags) && cardAllowedForModel(card, model) && (counts.get(card.cardNumber) || 0) < 3
      && (!isSignature(card) || signatureTotal < 3))
    .sort((left, right) => learnedCardScore(model, right) - learnedCardScore(model, left));
  const output = [];
  const reservedAdditions = new Set();
  for (const remove of removable) {
    const add = additions.find((candidate) => !reservedAdditions.has(candidate.cardNumber)
      && candidate.cardNumber !== remove.cardNumber
      && learnedCardScore(model, candidate) > learnedCardScore(model, remove));
    if (!add) continue;
    reservedAdditions.add(add.cardNumber);
    output.push({
      remove: { name: remove.name, cardNumber: remove.cardNumber, score: learnedCardScore(model, remove) },
      add: { name: add.name, cardNumber: add.cardNumber, score: learnedCardScore(model, add) }
    });
    if (output.length >= limit) break;
  }
  return output;
}

export function recommendDeckForPool(deck, model, poolId = "origins-era", limit = 8) {
  if (!deck?.legend || !cardAllowedInPool(deck.legend, poolId)) {
    return { poolId, compatible: false, reason: "선택한 카드풀에 현재 전설이 포함되지 않습니다.", changes: [], sideboard: [] };
  }
  const scopedModel = { ...model, cardPoolId: poolId };
  const changes = recommendDeckChanges(deck, scopedModel, limit);
  const sideboard = buildSideboardPlan(deck, scopedModel, Math.min(8, limit));
  const stat = model.deckStats?.[deck.id];
  return {
    poolId,
    compatible: true,
    changes,
    sideboard,
    generation: model.generation || 0,
    sampleGames: stat?.games || 0,
    confidence: stat?.games >= 100 ? "high" : stat?.games >= 20 ? "medium" : "low"
  };
}

export function metaCardLeaderboard(model, limit = 10) {
  const denominator = Math.max(1, (model.metaStats?.games || 0) * 2);
  return Object.entries(model.metaStats?.cardAppearances || {}).map(([cardNumber, stat]) => ({
    cardNumber,
    name: stat.name,
    appearances: stat.decks,
    inclusionRate: stat.decks / denominator,
    winRate: stat.decks ? stat.wins / stat.decks : 0
  })).sort((left, right) => right.inclusionRate - left.inclusionRate || right.winRate - left.winRate).slice(0, limit);
}

export function buildMatchupDeckPlan(deck, opponentProfile, model, limit = 5) {
  const recommendations = recommendDeckChanges(deck, model, limit);
  const pressure = opponentProfile?.averageEnergy >= 4 || opponentProfile?.spellRatio >= 0.38;
  const stabilize = opponentProfile?.unitRatio >= 0.62 && opponentProfile?.averageEnergy <= 3.2;
  const sideboard = buildSideboardPlan(deck, model, limit);
  return {
    objective: pressure ? "pressure" : stabilize ? "stabilize" : "balanced",
    cardChanges: recommendations,
    runeConfiguration: bestConfiguration(model.runeStats, runeConfigurationKey(deck)),
    battlefieldCandidates: Object.entries(model.battlefieldStats || {}).map(([cardNumber, stat]) => ({ cardNumber, score: configurationMean(stat), games: stat.games }))
      .sort((left, right) => right.score - left.score).slice(0, 3),
    sideboard
  };
}

export function buildSideboardPlan(deck, model, limit = 5) {
  if (!deck?.sideboard?.length) return [];
  const main = [...new Map(deck.main.map((card) => [card.cardNumber, card])).values()]
    .filter((card) => !isOnlyChampion(deck.main, card))
    .sort((left, right) => packageAdditionScore(model, deck.main, left) - packageAdditionScore(model, deck.main, right));
  const side = [...new Map(deck.sideboard.map((card) => [card.cardNumber, card])).values()]
    .sort((left, right) => packageAdditionScore(model, deck.main, right) - packageAdditionScore(model, deck.main, left));
  const swaps = [];
  for (const incoming of side) {
    const outgoing = main.find((card) => packageAdditionScore(model, deck.main, incoming) > packageAdditionScore(model, deck.main, card));
    if (!outgoing) continue;
    swaps.push({ out: outgoing.cardNumber, outName: outgoing.name, in: incoming.cardNumber, inName: incoming.name });
    if (swaps.length >= limit) break;
  }
  return swaps;
}

function cardAllowed(card, domains, legendTags) {
  const cardDomains = (card.domains || []).filter((domain) => domain !== "Any");
  if (cardDomains.some((domain) => !domains.has(domain))) return false;
  if (card.tags?.includes("Signature") || card.tags?.includes("Signature Spell")) {
    return card.tags.some((tag) => legendTags.has(tag));
  }
  return true;
}

function cardAllowedForModel(card, model) {
  const poolId = model?.cardPoolId || model?.externalMeta?.cardPoolId;
  return !poolId || cardAllowedInPool(card, poolId);
}

function isSignature(card) {
  return Boolean(card?.tags?.includes("Signature") || card?.tags?.includes("Signature Spell"));
}

function isOnlyChampion(main, card) {
  if (!card.isChampion && !card.tags?.includes("Champion")) return false;
  return main.filter((candidate) => candidate.isChampion || candidate.tags?.includes("Champion")).length <= 1;
}

function countCards(cardsToCount) {
  const counts = new Map();
  for (const card of cardsToCount) counts.set(card.cardNumber, (counts.get(card.cardNumber) || 0) + 1);
  return counts;
}

function countCardNames(cardsToCount) {
  const counts = new Map();
  for (const card of cardsToCount) counts.set(card.name, (counts.get(card.name) || 0) + 1);
  return counts;
}

function learnedCardScore(model, card) {
  const stat = model.cardStats?.[card.cardNumber];
  return stat?.games ? stat.meanReturn * Math.min(1, stat.games / 20) : 0;
}

function packageAdditionScore(model, currentMain, candidate) {
  const base = learnedCardScore(model, candidate);
  const unique = [...new Set(currentMain.map((card) => card.cardNumber))];
  const synergy = unique.reduce((sum, number) => sum + synergyMean(model.synergyStats?.[pairKey(number, candidate.cardNumber)]), 0);
  return base + synergy / Math.max(1, unique.length);
}

function learnedSideboardScore(model, card) {
  const learned = model.sideboardStats?.[card.cardNumber];
  const learnedMean = learned?.games ? learned.returnSum / learned.games * Math.min(1, learned.games / 20) : 0;
  const meta = model.externalMeta?.cardStats?.[card.cardNumber];
  const metaSignal = meta ? (meta.winRate || 0.5) * (meta.inclusionRate || 0) : 0;
  return learnedMean + metaSignal * 0.15 + learnedCardScore(model, card) * 0.25;
}

function updateSynergies(model, deck, reward) {
  const unique = [...new Set((deck.main || []).map((card) => card.cardNumber))].sort();
  for (let left = 0; left < unique.length; left += 1) {
    for (let right = left + 1; right < unique.length; right += 1) updateConfigurationStats(model.synergyStats, pairKey(unique[left], unique[right]), reward);
  }
}

function updateConfigurationStats(table, key, reward) {
  if (!key) return;
  const stat = table[key] ||= { games: 0, returnSum: 0, wins: 0 };
  stat.games += 1;
  stat.returnSum += reward;
  stat.wins += reward > 0 ? 1 : 0;
}

function runeConfigurationKey(deck) {
  const counts = new Map();
  for (const rune of deck.runes || []) counts.set(rune.domain, (counts.get(rune.domain) || 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([domain, count]) => `${domain}:${count}`).join("|");
}

function bestConfiguration(table, fallback) {
  const best = Object.entries(table || {}).map(([key, stat]) => ({ key, score: configurationMean(stat), games: stat.games }))
    .filter((item) => item.games >= 3).sort((left, right) => right.score - left.score)[0];
  return best || { key: fallback, score: 0, games: 0 };
}

function learnedConfigurationScore(table, key) { return configurationMean(table?.[key]); }
function configurationMean(stat) { return stat?.games ? stat.returnSum / stat.games : 0; }
function synergyMean(stat) { return stat?.games ? stat.returnSum / stat.games * Math.min(1, stat.games / 20) : 0; }
function pairKey(left, right) { return [left, right].sort().join("+"); }
function mutationKey(evolution) {
  if (evolution.kind === "cardPackage") return `cards:${(evolution.changes || []).map((change) => `${change.removed}>${change.added}`).sort().join(",")}`;
  if (evolution.kind === "runes") return `runes:${evolution.from}>${evolution.to}`;
  if (evolution.kind === "battlefields") return `fields:${evolution.removed}>${evolution.added}`;
  if (evolution.kind === "sideboard") return `sideboard:${evolution.removed || "empty"}>${evolution.added}`;
  return evolution.kind || "unknown";
}

function updateMatchup(model, deck, opponent, won) {
  const key = `${deck.id}::${opponent.id}`;
  const stat = model.matchupStats[key] ||= { games: 0, wins: 0 };
  stat.games += 1;
  stat.wins += won ? 1 : 0;
}

function updateArchetype(model, deck, reward) {
  const key = deck.legend?.cardNumber;
  if (!key) return;
  const stat = model.archetypeStats[key] ||= { games: 0, unitTotal: 0, spellTotal: 0, gearTotal: 0, energyTotal: 0, cardTotal: 0, wins: 0 };
  stat.games += 1;
  stat.wins += reward > 0 ? 1 : 0;
  stat.unitTotal += deck.main.filter((card) => card.type === "unit").length;
  stat.spellTotal += deck.main.filter((card) => card.type === "spell").length;
  stat.gearTotal += deck.main.filter((card) => card.type === "gear").length;
  stat.energyTotal += deck.main.reduce((sum, card) => sum + (card.energy || 0), 0);
  stat.cardTotal += deck.main.length;
  stat.unitRatio = stat.cardTotal ? stat.unitTotal / stat.cardTotal : 0;
  stat.spellRatio = stat.cardTotal ? stat.spellTotal / stat.cardTotal : 0;
  stat.gearRatio = stat.cardTotal ? stat.gearTotal / stat.cardTotal : 0;
  stat.averageEnergy = stat.cardTotal ? stat.energyTotal / stat.cardTotal : 0;
}
