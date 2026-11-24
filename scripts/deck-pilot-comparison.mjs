import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const COMPARISON_CONTRACT = 'frozen-pilot-main-comparison-v1';
export const comparisonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function comparisonJobAssigned(plan, mode, shard, index) {
  if (plan.executionMode === 'serial') {
    assert.equal(mode, 'serial', 'A serial plan cannot also run sharded workers');
    return true;
  }
  assert.equal(mode, 'worker');
  assert.ok([0, 1].includes(shard));
  return index % 2 === shard;
}

export function releaseComparisonReservation(reservation, directory, completedDirectories = []) {
  const removed = (reservation.additionalReservations || []).filter(item =>
    (item.directory === directory && item.contract === COMPARISON_CONTRACT)
    || (completedDirectories.includes(item.directory)
      && ['isolated-paired-league-policy-v1','paired-champion-current-learning-v1'].includes(item.contract)));
  assert.equal(removed.filter(item => item.directory === directory).length, 1);
  const next = {...reservation, slots: reservation.slots - removed.reduce((sum, item) => sum + item.slots, 0),
    additionalReservations: reservation.additionalReservations.filter(item => !removed.includes(item))};
  assert.ok(next.slots >= 3, 'Preserve the independent pilot reservation');
  if (!next.additionalReservations.length) delete next.additionalReservations;
  return next;
}

// This only opens a review of specialist demonstrations. It never certifies
// individual moves, authorizes weight transfer, or changes promotion rules.
export function specialistLessonReviewGate(report) {
  const rows = report.rows.filter(row => row.role === 'viktor');
  const deltas = rows.flatMap(row => row.completedBlockDeltas);
  const mean = deltas.length ? deltas.reduce((sum, n) => sum + n, 0) / deltas.length : null;
  const standardError = deltas.length > 1
    ? Math.sqrt(deltas.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (deltas.length - 1) / deltas.length) : null;
  const lower = standardError === null ? null : mean - 2 * standardError;
  const reasons = [];
  if (!report.complete) reasons.push('comparison-incomplete');
  if (report.mirror.games !== 64 || report.mirror.winRate < 0.5) reasons.push('mirror-not-supported');
  if (rows.length !== 4 || rows.some(row => row.pairedGames !== 16 || row.completedBlockDeltas.length !== 4))
    reasons.push('paired-cross-coverage');
  if (!(mean > 0 && lower > 0)) reasons.push('cross-improvement-not-supported');
  return {eligibleForLessonReview: reasons.length === 0, reasons, pairedSeedBlocks: deltas.length,
    pairedDelta: mean, approximateTwoSELower: lower, individualLessonsRequireVerification: true,
    mainWeightsMayChange: false, promotionEligible: false};
}

// Subjects use identical game conditions against the same frozen main model.
// Keep all four seat/initiative conditions together, including both deck roles.
export function comparisonSchedule(deck, opponents, seed) {
  assert.equal(opponents.length, 4);
  assert.equal(new Set([deck.id, ...opponents.map(d => d.id)]).size, 5);
  const jobs = [];
  for (let round = 0; round < 8; round++) {
    jobs.push({id: `mirror-${round}`, kind: 'mirror', subject: 'pilot',
      decks: [deck], seed: ((seed + round * 209458) | 1) >>> 0,
      mode: 'same-deck-mirror-v3'});
    if (round >= 4) continue;
    for (const [index, opponent] of opponents.entries()) {
      const common = {kind: 'cross', opponentId: opponent.id, round,
        decks: [deck, opponent].sort((a,b) => a.id.localeCompare(b.id)),
        seed: ((seed + 10000019 + index * 1000033 + round * 209458) | 1) >>> 0,
        mode: 'cross-deck-matrix-v1'};
      for (const subject of ['main', 'pilot']) jobs.push({...common,
        id: `cross-${index}-${round}-${subject}`, subject});
    }
  }
  return jobs;
}

export function expectedComparisonGame(job, index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < 8);
  const candidateSeat = index % 2;
  const cross = job.kind === 'cross';
  const ordered = cross && index >= 4 ? [...job.decks].reverse() : job.decks;
  const pair = cross ? (candidateSeat ? [...ordered].reverse() : ordered)
    : [job.decks[0], job.decks[0]];
  return {candidateSeat, firstPlayerId: Math.floor(index / 2) % 2 ? 'p2' : 'p1',
    gameSeed: (job.seed + (cross ? Math.floor(index / 4) * 104729 : 0)) >>> 0,
    evaluationMode: job.mode, streamAssignment: cross ? 0 : Math.floor(index / 4),
    deckIds: pair.map(d => d.id)};
}

export function assertComparisonRecord(record, plan, job, index) {
  assert.equal(record.planHash, comparisonHash(plan), 'Comparison identity changed');
  assert.equal(record.jobId, job.id);
  assert.equal(record.index, index);
  const s = record.summary;
  assert.ok(s.completed && !s.invalid && !s.adjudicated && s.counted !== false,
    'Incomplete/invalid/adjudicated games cannot become comparison evidence');
  assert.ok(['p1','p2'].includes(s.winnerId), 'Missing natural winner');
  for (const [key, value] of Object.entries(expectedComparisonGame(job, index)))
    assert.deepEqual(s[key], value, `Wrong comparison condition: ${key}`);
  assert.equal(s.decisionReviewHash, plan.reviewHash);
  assert.equal(s.aiSeats?.[s.candidateSeat]?.generation, plan.models[job.subject].generation);
  assert.equal(s.aiSeats?.[1-s.candidateSeat]?.generation, plan.models.main.generation);
  return record;
}

const empty = () => ({games: 0, wins: 0, losses: 0, winRate: null});
const tally = (stats, summary) => {
  stats.games++;
  if (summary.winnerId === `p${summary.candidateSeat+1}`) stats.wins++; else stats.losses++;
  stats.winRate = stats.wins / stats.games;
};

export function summarizeComparison(plan, records) {
  const jobs = new Map(plan.schedule.map(j => [j.id,j])), seen = new Set();
  const mirror = empty(), rows = [], pairs = new Map();
  for (const record of records) {
    const job = jobs.get(record.jobId);
    assert.ok(job, 'Unknown comparison job');
    assertComparisonRecord(record, plan, job, record.index);
    const key = `${record.jobId}:${record.index}`;
    assert.ok(!seen.has(key), 'Duplicate comparison game'); seen.add(key);
    const s = record.summary;
    if (job.kind === 'mirror') {tally(mirror,s); continue;}
    const role = s.deckIds[s.candidateSeat] === plan.deckId ? 'viktor' : 'other-deck';
    let row = rows.find(r => r.opponentId === job.opponentId && r.role === role);
    if (!row) {row = {opponentId: job.opponentId, role, main: empty(), pilot: empty()}; rows.push(row);}
    tally(row[job.subject],s);
    const pairKey = `${job.opponentId}:${job.round}:${record.index}`;
    const pair = pairs.get(pairKey) || {opponentId:job.opponentId,role,round:job.round};
    pair[job.subject] = s.winnerId === `p${s.candidateSeat+1}` ? 1 : 0;
    pairs.set(pairKey,pair);
  }
  for (const row of rows) {
    const matched = [...pairs.values()].filter(p => p.opponentId === row.opponentId && p.role === row.role
      && p.main !== undefined && p.pilot !== undefined);
    row.pairedGames = matched.length;
    row.pairedDelta = matched.length ? matched.reduce((sum,p) => sum+p.pilot-p.main,0)/matched.length : null;
    row.pilotOnlyWins = matched.filter(p => p.pilot && !p.main).length;
    row.mainOnlyWins = matched.filter(p => p.main && !p.pilot).length;
    // Four correlated seat/initiative games share a seed. Report block values,
    // not a confidence interval pretending every game is independent.
    row.completedBlockDeltas = [...new Set(matched.map(p=>p.round))].flatMap(round => {
      const block=matched.filter(p=>p.round===round);
      return block.length===4 ? [block.reduce((sum,p)=>sum+p.pilot-p.main,0)/4] : [];
    });
  }
  return {contract:COMPARISON_CONTRACT,planHash:comparisonHash(plan),models:plan.models,
    completedGames:seen.size,targetGames:plan.schedule.length*8,complete:seen.size===plan.schedule.length*8,
    mirror,rows,promotionEligible:false,automaticIntegration:false,
    note:'Diagnostic comparison; cross rows are separate deck roles and only matched seeds define deltas.'};
}
