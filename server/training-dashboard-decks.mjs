import { cards } from "../src/cards.mjs";
import { translateCardName, translateCardTags } from "../src/i18n.mjs";
import { trainingDeckRecord, validateTrainingDeck } from "../src/ai/legal-decks.mjs";

const byNumber = new Map(Object.values(cards).map(card => [card.cardNumber, card]));
const cardLabel = number => translateCardName(byNumber.get(number), "ko") || number;
const legendLabel = number => {
  const identity = translateCardTags(byNumber.get(number), "ko").slice(1).join(" · ");
  return identity ? `${identity}, ${cardLabel(number)}` : cardLabel(number);
};
const modes = { anchor: "기준 덱", local: "소규모 변경", broad: "넓은 탐색" };

export function dashboardDeck(deck) {
  const record = deck.legend?.cardNumber ? trainingDeckRecord(deck) : deck.deck || deck;
  const main = record.main || [];
  const mainCount = main.reduce((sum, [, count]) => sum + count, 0);
  const meanEnergy = mainCount ? main.reduce((sum, [number, count]) => sum + (byNumber.get(number)?.energy || 0) * count, 0) / mainCount : null;
  const auroraCount = main.reduce((sum, [number, count]) => sum + (byNumber.get(number)?.name === "Dazzling Aurora" ? count : 0), 0);
  const legendName = legendLabel(record.legend);
  const mode = deck.searchMode || deck.mode || "anchor";
  const quality = deck.seedQuality || null;
  const zones = Object.fromEntries(["main", "sideboard", "runes", "battlefields"].map(zone => [zone,
    (zone === "battlefields" ? (record[zone] || []).map(number => [number, 1]) : record[zone] || [])
      .map(([number, count]) => ({ number, name: cardLabel(number), count }))]));
  const shortName = legendName.split(",")[0];
  return { id: deck.id, legendId: record.legend, legendName, mode, modeName: modes[mode] || mode,
    name: `${shortName} · ${mode === "anchor" ? quality === "repaired-main-unverified" ? "보정 초안" : "기준" : modes[mode] || mode}${mode === "anchor" ? "" : ` ${String(deck.id).slice(-6)}`}`,
    originalName: deck.playerName || deck.name || null, quality,
    auroraCount, averageEnergy: meanEnergy, highCostCount: main.reduce((sum, [number, count]) => sum + ((byNumber.get(number)?.energy || 0) >= 6 ? count : 0), 0),
    mainCount, zones, seedAnchorId: deck.seedAnchorId || null,
    legal: deck.legend?.cardNumber ? validateTrainingDeck(deck, "origins-era").playable : null };
}

// Keep only display data in the dashboard cache; never load trajectories or tensors.
export function dashboardSearchPlan(plan) {
  if (!plan?.deckSearch) return null;
  const search = plan.deckSearch;
  return { iteration: plan.iteration, games: plan.games, poolId: search.poolId,
    decks: search.population.map(dashboardDeck),
    assignments: search.assignments.map(item => ({ mode: item.mode, testedDeckId: item.testedDeckId })),
    heldOutGames: plan.utility?.validationGameIndexes?.length || 0 };
}

export function summarizeDashboardDeckSearch({ protocol, state, plan, report, history = [], currentGames = 0 }) {
  if (!protocol) return { enabled: false };
  const anchors = protocol.anchors.map(dashboardDeck);
  const candidates = (state.deckSearch?.candidates || []).map(dashboardDeck);
  const descriptors = new Map([...anchors, ...candidates, ...(plan?.decks || []), ...(report?.decks || []).map(dashboardDeck)]
    .map(deck => [deck.id, deck]));
  // Prefer the manifest's provenance/legality and exact saved zone names.
  for (const deck of [...anchors, ...candidates, ...(plan?.decks || [])]) descriptors.set(deck.id, deck);
  const scores = new Map((report?.decks || []).map(deck => [deck.id, deck]));
  const committedIteration = state.deckSearch?.iteration ?? protocol.afterIteration;
  const records = (state.freshEvidence || []).filter(entry => {
    const iteration = Number(String(entry.archivePath || "").replaceAll("\\", "/").match(/\/iterations\/(\d+)\/games\//)?.[1]);
    return iteration > protocol.afterIteration && iteration <= committedIteration;
  });
  const decks = [...descriptors.values()].map(deck => {
    const score = scores.get(deck.id);
    const baseline = anchors.find(anchor => anchor.id === deck.seedAnchorId);
    const stat = state.deckSearch?.stats?.[deck.id];
    return { ...deck, quality: baseline?.quality || deck.quality,
      games: score?.games || 0, wins: stat?.wins ?? null,
      score: score?.games > 0 ? score.winRate : null, opponentsSeen: score?.opponentsSeen || 0,
      certified: false, pending: !score,
      opponents: Object.entries(stat?.opponents || {}).map(([id, value]) => ({ legend: legendLabel(id), games: value.games, wins: value.wins })) };
  }).sort((a, b) => a.legendName.localeCompare(b.legendName, "ko") || Number(b.mode === "anchor") - Number(a.mode === "anchor")
    || (b.score ?? -1) - (a.score ?? -1));
  const planned = { anchor: 0, local: 0, broad: 0 };
  for (const item of plan?.assignments || []) planned[item.mode] = (planned[item.mode] || 0) + 1;
  const legends = [...new Map(anchors.map(deck => [deck.legendId, { id: deck.legendId, name: deck.legendName }])).values()];
  return { enabled: true, poolId: protocol.poolId, poolName: "오리진 · Proving Grounds", afterIteration: protocol.afterIteration,
    firstIteration: protocol.afterIteration + 1, committedIteration, scoreIteration: report?.iteration ?? null,
    completedIterations: Math.max(0, committedIteration - protocol.afterIteration),
    committedGames: records.length, trainingGames: records.filter(entry => entry.role !== "validation").length,
    heldOutGames: records.filter(entry => entry.role === "validation").length,
    anchors: anchors.length, variants: state.deckSearch?.candidates?.length || 0, legends,
    mixture: protocol.mixture, planned, currentIteration: plan?.iteration ?? null,
    currentGames, targetGames: plan?.games ?? null, currentHeldOutGames: plan?.heldOutGames ?? null,
    decks, history: history.map(item => ({ iteration: item.iteration,
      points: item.decks.map(deck => ({ id: deck.id, score: deck.games > 0 ? deck.winRate : null, games: deck.games })) })),
    reportPending: committedIteration > protocol.afterIteration && report?.iteration !== committedIteration };
}
