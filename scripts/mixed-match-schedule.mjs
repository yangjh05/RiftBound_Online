// Script-only evaluation scheduling. The existing game/inference code is reused
// unchanged, so saved training trajectories retain their original semantics.
export const MIXED_MATCH_CONTRACT = 'bounded-balanced-matchup-evaluation-v4';
export const MIXED_EVALUATION_MODE = 'cross-deck-matrix-v1';
export const isMixedMatchPlan = plan => plan?.contract === MIXED_MATCH_CONTRACT;
export const evaluationStrata = plan => isMixedMatchPlan(plan) ? plan.matchups.map(p => p.id) : plan.deckIds;
export const evaluationRoundGames = plan => evaluationStrata(plan).length * 8;

export function mixedMatchups(deckIds) {
  const ids = [...deckIds].sort((a, b) => a.localeCompare(b));
  return ids.flatMap((a, i) => ids.slice(i).map(b => ({id: JSON.stringify([a, b]), deckIds: [a, b],
    kind: a === b ? 'mirror' : 'cross'})));
}

export function mixedExpectedGame(plan, index) {
  const block = Math.floor(index / 8), offset = index % 8;
  const matchup = plan.matchups[(block + plan.seed % plan.matchups.length) % plan.matchups.length];
  const candidateSeat = offset % 2, assignment = Math.floor(offset / 4);
  const ordered = assignment ? [...matchup.deckIds].reverse() : matchup.deckIds;
  // An odd seed makes the existing two-deck matrix runner play A/B then B/A.
  // Two four-game halves use distinct seeds; the pair is one bounded observation.
  const baseSeed = ((plan.seed + block * 2 * 104729) | 1) >>> 0;
  return {candidateSeat, firstPlayerId: Math.floor(offset / 2) % 2 ? 'p2' : 'p1',
    gameSeed: (baseSeed + assignment * 104729) >>> 0, streamAssignment: 0,
    evaluationMode: MIXED_EVALUATION_MODE,
    deckIds: candidateSeat ? [...ordered].reverse() : [...ordered]};
}

export function evaluationBlock(plan, group) {
  const won = s => s.winnerId === `p${s.candidateSeat + 1}`;
  const block = {deckId: group[0].deckIds[0], score: group.filter(won).length / 8,
    seats: [0, 1].map(seat => group.filter(s => s.candidateSeat === seat && won(s)).length / 4)};
  if (!isMixedMatchPlan(plan)) return block;
  const ids = [...group[0].deckIds].sort((a, b) => a.localeCompare(b));
  block.deckId = JSON.stringify(ids); // statistical stratum, not candidate deck
  block.kind = ids[0] === ids[1] ? 'mirror' : 'cross';
  block.first = [true, false].map(first => group.filter(s =>
    (s.firstPlayerId === `p${s.candidateSeat + 1}`) === first && won(s)).length / 4);
  block.decks = Object.fromEntries([...new Set(ids)].map(id => {
    const games = group.filter(s => s.deckIds[s.candidateSeat] === id);
    return [id, {games: games.length, wins: games.filter(won).length}];
  }));
  return block;
}
