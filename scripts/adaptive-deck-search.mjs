import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { decklists } from "../src/cards.mjs";
import { STANDARD_BAN_LIST } from "../src/decks/legality.mjs";
import { assertLegalTrainingDeck, repairTrainingDeck, mutateLegalTrainingDeck,
  trainingDeckKey, trainingDeckRecord } from "../src/ai/legal-decks.mjs";
import { seededRandom, scheduledTrainingDeckPair, selfPlayComparisonSchedule } from "../src/ai/neural/selfplay.mjs";
import { digest } from "./adaptive-policy-q-contract.mjs";
import { adaptiveGameRole } from "./policy-q-utility.mjs";
import {authoredTrainingDecks} from './authored-training-decks.mjs';

export const DECK_SEARCH_CONTRACT = "legal-seeded-deck-search-v1";

// Policy promotion compares one fixed legal representative per original legend.
// Additional controls belong to deck search, not to the five-deck statistical gate.
export function primaryDeckSearchAnchors(protocol, seedDecks) {
  const representatives = seedDecks.map(seed => protocol.anchors.find(deck =>
    (deck.evolution?.rootId || deck.id) === seed.id));
  assert.ok(representatives.every(Boolean), "A legal primary training anchor is missing.");
  assert.equal(new Set(representatives.map(deck => deck.legend.cardNumber)).size, seedDecks.length,
    "Policy evaluation requires one representative per legend.");
  for (const deck of representatives) assertLegalTrainingDeck(deck, protocol.poolId);
  return representatives;
}

export async function readDeckSearchProtocol(root) {
  let protocol;
  try { protocol = JSON.parse((await readFile(path.join(root, "deck-search-protocol.json"), "utf8")).replace(/^\uFEFF/, "")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  assert.equal(protocol.contract, DECK_SEARCH_CONTRACT);
  assert.ok(Number.isInteger(protocol.afterIteration) && protocol.afterIteration >= 0);
  assert.equal(protocol.poolId, "origins-era");
  assert.equal(protocol.banListHash, digest(STANDARD_BAN_LIST));
  assert.deepEqual(protocol.mixture, { anchor: 0.5, local: 0.25, broad: 0.25 });
  assert.equal(protocol.priorGames, 12);
  assert.equal(protocol.maximumCandidatesPerLegend, 6);
  assert.equal(protocol.minimumExplorationGames, 40);
  assert.ok(Array.isArray(protocol.anchors) && protocol.anchors.length >= 2);
  assert.equal(new Set(protocol.anchors.map(deck => deck.id)).size, protocol.anchors.length);
  for (const deck of protocol.anchors) assertLegalTrainingDeck(deck, protocol.poolId);
  return protocol;
}

export function createDeckSearchProtocol(seedDecks, afterIteration) {
  const legends = new Set(seedDecks.map(deck => deck.legend.cardNumber));
  // Use existing alternatives of the same legends, including the non-Aurora
  // Yi list. Later-set lists become explicitly unverified Origins control drafts.
  const authored=authoredTrainingDecks().filter(deck=>legends.has(deck.legend.cardNumber));
  const replaced=new Set(authored.map(deck=>deck.authoredPreset.replacesSeedDeckId));
  const available = [...seedDecks, ...Object.values(decklists).filter(deck => legends.has(deck.legend.cardNumber)
    && !replaced.has(deck.id))];
  for(const deck of authored){
    const index=available.findIndex(other=>other.legend.cardNumber===deck.legend.cardNumber);
    available.splice(index<0?available.length:index,0,deck);
  }
  const anchors = [...new Map(available.map(deck => {
    const repaired = deck.authoredPreset ? assertLegalTrainingDeck(structuredClone(deck),"origins-era")
      : repairTrainingDeck(deck, "origins-era"); return [trainingDeckKey(repaired), repaired];
  })).values()];
  return { contract: DECK_SEARCH_CONTRACT, afterIteration, poolId: "origins-era",
    banListHash: digest(STANDARD_BAN_LIST), anchors,
    mixture: { anchor: 0.5, local: 0.25, broad: 0.25 }, priorGames: 12,
    maximumCandidatesPerLegend: 6, minimumExplorationGames: 40,
    scoreRole: "exploratory-only-not-independent-deck-certification" };
}

export function commitDeckSearchProtocol(state, protocol) {
  const hash = protocol && digest(protocol);
  if (state.deckSearchProtocolHash) assert.equal(hash, state.deckSearchProtocolHash, "Active deck search protocol changed.");
  else if (protocol) {
    assert.ok(protocol.afterIteration >= state.iteration, "Deck search must start prospectively.");
    state.deckSearchProtocolHash = hash;
  }
}

export function deckSearchScore(stat, opponentLegends, priorGames = 12) {
  // Equal opponent weight, neutral shrinkage and a sample count: never rank a
  // 1/1 deck above an established list merely because its raw win rate is 100%.
  const cells = opponentLegends.map(legend => stat?.opponents?.[legend]);
  const cellScore = cell => {
    if (!cell?.conditions) return ((cell?.wins || 0) + priorGames / 2) / ((cell?.games || 0) + priorGames);
    return ["0:p1", "0:p2", "1:p1", "1:p2"].reduce((sum, key) => {
      const condition = cell.conditions[key];
      return sum + ((condition?.wins || 0) + priorGames / 8) / ((condition?.games || 0) + priorGames / 4);
    }, 0) / 4;
  };
  const winRate = cells.reduce((sum, cell) => sum + cellScore(cell), 0) / Math.max(1, cells.length);
  return { winRate, games: stat?.games || 0,
    opponentsSeen: cells.filter(cell => cell?.games > 0).length, certified: false };
}

export function createDeckSearchPlan(protocol, state, { iteration, games, seed, sourceBehaviorHash }) {
  if (!protocol || iteration <= protocol.afterIteration) return null;
  assert.ok(games >= 16 && games % 8 === 0, "Deck search requires complete eight-game blocks.");
  const random = seededRandom(seed || 1);
  const legends = [...new Set(protocol.anchors.map(deck => deck.legend.cardNumber))].sort();
  const previous = state || { candidates: [], stats: {} };
  const candidates = structuredClone(previous.candidates);
  const stats = previous.stats || {};
  const anchors = protocol.anchors;
  const blocks = games / 8;
  const assignments = [];
  const assignedDecks = new Map();
  const plannedAppearances = {};
  const score = deck => deckSearchScore(stats[deck.id], legends, protocol.priorGames).winRate;
  for (let block = 0; block < blocks; block++) {
    const ordinal = (iteration - protocol.afterIteration - 1) * blocks + block;
    const legend = legends[ordinal % legends.length];
    const familyAnchors = anchors.filter(deck => deck.legend.cardNumber === legend);
    const cycle = Math.floor(ordinal / (legends.length * 4));
    const anchor = familyAnchors[cycle % familyAnchors.length];
    const mode = ["anchor", "local", "anchor", "broad"][ordinal % 4];
    let selected = anchor;
    if (mode !== "anchor") {
      let family = candidates.filter(deck => deck.legend.cardNumber === legend && deck.searchMode === mode);
      const explored = family.every(deck => (stats[deck.id]?.games || 0) >= protocol.minimumExplorationGames);
      if (!family.length || explored) {
        const parents = [anchor, ...family].sort((a, b) => score(b) - score(a));
        const parent = random() < 0.5 ? anchor : parents[0];
        // Sideboards have no outcome signal in this BO1 curriculum. Preserve
        // legal sideboards and explore main cards, runes and fields instead.
        const roll = random();
        const kind = roll < 0.1 ? "runes" : roll < 0.2 ? "battlefields" : "cardPackage";
        const variant = mutateLegalTrainingDeck(parent, {}, random, { poolId: protocol.poolId,
          kind, broad: mode === "broad", packageSize: mode === "broad" ? 6 + Math.floor(random() * 7) : 1 + Math.floor(random() * 3) });
        if (![...anchors, ...candidates].some(deck => trainingDeckKey(deck) === trainingDeckKey(variant))) {
          variant.searchMode = mode;
          variant.seedAnchorId = anchor.id;
          candidates.push(variant);
          const limit = protocol.maximumCandidatesPerLegend / 2;
          if (family.length >= limit) {
            const weakest = [...family].sort((a, b) => score(a) - score(b))[0];
            candidates.splice(candidates.findIndex(deck => deck.id === weakest.id), 1);
          }
          family = candidates.filter(deck => deck.legend.cardNumber === legend && deck.searchMode === mode);
        }
      }
      selected = [...family].sort((a, b) => (stats[a.id]?.games || 0) - (stats[b.id]?.games || 0)
        || score(b) - score(a))[0] || anchor;
    }
    // Rotate opponents separately for each tested list, including own-legend
    // alternatives. Eight games cross seat and first-player positions.
    const seen = (stats[selected.id]?.appearances || 0) + (plannedAppearances[selected.id] || 0);
    const opponentLegend = legends[(Math.floor(seen / 8) + ordinal % legends.length) % legends.length];
    const opponentAnchors = anchors.filter(deck => deck.legend.cardNumber === opponentLegend);
    const opponent = opponentAnchors[Math.floor(seen / (8 * legends.length)) % opponentAnchors.length];
    assignedDecks.set(selected.id, selected);
    assignedDecks.set(opponent.id, opponent);
    plannedAppearances[selected.id] = (plannedAppearances[selected.id] || 0) + 8;
    for (let offset = 0; offset < 8; offset++) assignments.push({ gameIndex: block * 8 + offset,
      mode, testedDeckId: selected.id, pairIds: [selected.id, opponent.id], sourceBehaviorHash });
  }
  const population = [...new Map([...anchors, ...candidates, ...assignedDecks.values()].map(deck => [deck.id, deck])).values()];
  for (const deck of population) assertLegalTrainingDeck(deck, protocol.poolId);
  return { contract: DECK_SEARCH_CONTRACT, protocolHash: digest(protocol), poolId: protocol.poolId,
    sourceBehaviorHash, population, candidates, assignments,
    priorStateHash: digest(previous), legends, priorGames: protocol.priorGames };
}

export function deckSearchTaskOptions(search, gameIndex) {
  if (!search) return {};
  const item = search.assignments[gameIndex];
  assert.equal(item?.gameIndex, gameIndex, "Missing frozen deck assignment.");
  const decks = item.pairIds.map(id => search.population.find(deck => deck.id === id));
  assert.ok(decks.every(Boolean), "Missing frozen deck configuration.");
  for (const deck of decks) assertLegalTrainingDeck(deck, search.poolId);
  return { deckSearchAssignment: { contract: search.contract, poolId: search.poolId,
    decks: [...new Map(decks.map(deck => [deck.id, deck])).values()],
    configurationKeys: [...new Map(decks.map(deck => [deck.id, trainingDeckKey(deck)])).values()] } };
}

export function expectedDeckSearchPair(search, gameIndex, seed) {
  const { decks } = deckSearchTaskOptions(search, gameIndex).deckSearchAssignment;
  return scheduledTrainingDeckPair(decks, selfPlayComparisonSchedule(gameIndex).comparisonBlock, seed,
    { mirrorFraction: decks.length === 1 ? 1 : 0, deckSeatScheduleVersion: "deck-seat-schedule-v2" }).decks;
}

export function assertDeckSearchGame(result, plan, gameIndex) {
  if (!plan.deckSearch) return;
  const search = plan.deckSearch;
  assert.equal(search.sourceBehaviorHash, plan.sourceBehaviorHash, "Deck search policy changed.");
  const pair = expectedDeckSearchPair(search, gameIndex, plan.seed);
  const summary = result.summaries?.[0] || result.summary;
  assert.deepEqual(summary.deckIds, pair.map(deck => deck.id), "Collected deck differs from frozen assignment.");
  assert.deepEqual(result.deckSearchConfigurationKeys, pair.map(trainingDeckKey), "Collected deck contents changed.");
  for (const trajectory of result.trajectories || []) {
    const seat = trajectory.playerId === "p2" ? 1 : 0;
    assert.equal(trajectory.deckId, pair[seat].id, "Trajectory deck differs from frozen assignment.");
  }
}

export function learnDeckSearch(previous, plan, results) {
  if (!plan.deckSearch) return previous;
  assert.equal(digest(previous || { candidates: [], stats: {} }), plan.deckSearch.priorStateHash, "Deck learning input changed.");
  const state = structuredClone(previous || { candidates: [], stats: {} });
  state.candidates = plan.deckSearch.candidates;
  assert.equal(results.length, plan.games);
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    assertDeckSearchGame(result, plan, index);
    const summary = result.summaries?.[0] || result.summary;
    assert.ok(summary.completed && !summary.invalid && !summary.adjudicated && ["p1", "p2"].includes(summary.winnerId));
    assert.ok(["p1", "p2"].includes(summary.firstPlayerId), "Missing first-player condition.");
    const pair = expectedDeckSearchPair(plan.deckSearch, index, plan.seed);
    // Appearances choose future opponents without reading held-out outcomes.
    const testedId = plan.deckSearch.assignments[index].testedDeckId;
    const tested = state.stats[testedId] ||= { games: 0, wins: 0, appearances: 0, opponents: {} };
    tested.appearances++;
    if (adaptiveGameRole(plan, index) === "validation") continue;
    if (pair[0].id === pair[1].id) continue; // An exact mirror says nothing about deck strength.
    for (let seat = 0; seat < 2; seat++) {
      const stat = state.stats[pair[seat].id] ||= { games: 0, wins: 0, appearances: 0, opponents: {} };
      const opponent = stat.opponents[pair[1 - seat].legend.cardNumber] ||= { games: 0, wins: 0 };
      const won = summary.winnerId === `p${seat + 1}` ? 1 : 0;
      stat.games++; stat.wins += won; opponent.games++; opponent.wins += won;
      opponent.conditions ||= {};
      const condition = opponent.conditions[`${seat}:${summary.firstPlayerId}`] ||= { games: 0, wins: 0 };
      condition.games++; condition.wins += won;
    }
  }
  state.iteration = plan.iteration;
  state.lastSourceBehaviorHash = plan.sourceBehaviorHash;
  return state;
}

export function deckSearchReport(state, search) {
  return { contract: DECK_SEARCH_CONTRACT, iteration: state.iteration,
    status: "exploratory rankings; independent fixed-policy confirmation required",
    decks: search.population.map(deck => ({ id: deck.id, name: deck.playerName,
      legend: deck.legend.name, mode: deck.searchMode || "anchor",
      seedQuality: deck.seedQuality,
      ...deckSearchScore(state.stats[deck.id], search.legends, search.priorGames),
      deck: trainingDeckRecord(deck) })).sort((a, b) => b.winRate - a.winRate) };
}
