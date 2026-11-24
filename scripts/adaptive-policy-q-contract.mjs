import { createHash } from "node:crypto";
import {SEQUENTIAL_MATCH_CONTRACT, BOUNDED_MATCH_CONTRACT, BOUNDED_BUDGET_POLICY, BOUNDED_EVALUATION_ALPHA,
  isSequentialMatchPlan, BET_FRACTIONS, sequentialBlockDecision,assertFutilityPolicy} from './sequential-match-statistics.mjs';
import {MIXED_MATCH_CONTRACT, MIXED_EVALUATION_MODE, isMixedMatchPlan, mixedMatchups,
  mixedExpectedGame, evaluationBlock} from './mixed-match-schedule.mjs';

export const ADAPTIVE_POLICY_Q_CONTRACT = "continuous-policy-q-experiments-v1";
export const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Precision quotas justify claims about particular strata. They are never a
// prerequisite for a training-only gradient update.
export function adaptiveTrainingReadiness({ games = 0, samples = 0, invalid = 0 } = {}) {
  return { ready: invalid === 0 && games >= 16 && samples >= 32,
    promotionEligible: false, precisionQuotasRequired: false };
}

export function adaptiveEvidenceWindow(entries, iteration, limit = 128) {
  if (!entries.length) return [];
  const count = Math.min(entries.length, limit);
  const start = ((Math.max(1, iteration) - 1) * count) % entries.length;
  return Array.from({ length: count }, (_, index) => entries[(start + index) % entries.length]);
}

export function adaptiveWorkerBudget(legacyWorkers = 0, maximum = 16) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 16) throw new Error("Worker cap must be 1–16.");
  const legacy = Number.isFinite(legacyWorkers) ? Math.max(0, Math.ceil(legacyWorkers)) : maximum;
  const available = Math.max(0, maximum - legacy);
  const trainer = available > 0 ? 1 : 0;
  const evaluation = available >= 3 ? 1 : 0;
  // Start every lane as soon as four slots are free, then grow collection
  // to eight and audit to six. Every allocation is monotone as legacy games
  // finish: enabling a lane never borrows a still-running worker's slot.
  const audit = available >= 4 ? Math.min(6, Math.max(1, available - 10)) : 0;
  const selfplay = Math.min(8, Math.max(0, available - trainer - audit - evaluation));
  return { trainer, audit, evaluation, selfplay, maximum };
}

export function frozenMatchPlan({ candidateHash, opponentHash, ordinal, deckIds,
  maximumBlocks = 128, randomSeed }) {
  if (!candidateHash || !opponentHash || !Number.isInteger(ordinal) || ordinal < 1
    || !Array.isArray(deckIds) || !deckIds.length || deckIds.some(id => typeof id !== "string" || !id)
    || new Set(deckIds).size !== deckIds.length || !Number.isInteger(maximumBlocks) || maximumBlocks < 1
    || !Number.isInteger(randomSeed) || randomSeed < 0 || randomSeed > 0xffffffff) {
    throw new Error("Invalid frozen match commitment.");
  }
  const blocks = Math.max(deckIds.length * 8, maximumBlocks);
  return { version: 1, contract: "frozen-policy-block-evaluation-v1", candidateHash,
    opponentHash, ordinal, deckIds: [...deckIds], blocks,
    seed: (randomSeed >>> 0) || 1, evaluationMode: "same-deck-mirror-v3",
    // Sum over all future candidates is <= .05. Blocks, not mirrored games,
    // are the independent bounded observations. Exactly one promotion look.
    alpha: 0.05 / (ordinal * (ordinal + 1)),
    inferentialUnit: "independent-eight-game-seed-block", promotionLooks: [blocks] };
}

export function assertFrozenMatchPlan(plan) {
  const factory = isMixedMatchPlan(plan) ? mixedMatchPlan : plan?.contract === BOUNDED_MATCH_CONTRACT ? boundedMatchPlan
    : plan?.contract === SEQUENTIAL_MATCH_CONTRACT ? sequentialMatchPlan : frozenMatchPlan;
  const expected = factory({ candidateHash: plan?.candidateHash, opponentHash: plan?.opponentHash,
    ordinal: plan?.ordinal, deckIds: plan?.deckIds, maximumBlocks: plan?.blocks, randomSeed: plan?.seed,
    ...(plan?.contract === BOUNDED_MATCH_CONTRACT || isMixedMatchPlan(plan) ? {purpose:plan.purpose} : {}),
    ...(Object.hasOwn(plan||{},'futilityPolicy') ? {futilityPolicy:plan.futilityPolicy} : {}) });
  if (Object.hasOwn(plan||{},'futilityPolicy') && plan.contract !== SEQUENTIAL_MATCH_CONTRACT) throw new Error('Legacy evaluation cannot adopt futility.');
  if (Object.entries(expected).some(([key, value]) => JSON.stringify(plan[key]) !== JSON.stringify(value))) {
    throw new Error("Frozen match statistical commitment changed.");
  }
}

export function mixedMatchPlan({candidateHash, opponentHash, ordinal, deckIds, randomSeed, purpose}) {
  if (!['champion-promotion','tactical-baseline-progress'].includes(purpose)) throw new Error('Invalid mixed evaluation purpose.');
  // Five legends, optionally with both distinct Yi lists. Every unordered pair
  // has equal weight. Round-aligned caps remain at or below 2,400 games.
  if (![5,6].includes(deckIds?.length)) throw new Error('Mixed evaluation requires five or six fixed decks.');
  const base = sequentialMatchPlan({candidateHash,opponentHash,ordinal,deckIds,randomSeed,maximumBlocks:300});
  const matchups = mixedMatchups(deckIds), round = matchups.length;
  const budgetPolicy={...BOUNDED_BUDGET_POLICY, contract:'balanced-matchup-candidate-budget-v1',
    screeningGames:840, screeningPreviousGames:480, recentGames:360,
    ordinaryGames:1560, extensionCheckGames:2040,
    ...(deckIds.length===6 ? {screeningPreviousGames:504,recentGames:336,lowPromiseGames:1176,
      ordinaryGames:1512,extensionCheckGames:2016,maximumGames:2352} : {})};
  const blocks = (purpose === 'champion-promotion' ? budgetPolicy.maximumGames : 840)/8;
  return {...base, version:4, contract:MIXED_MATCH_CONTRACT, purpose, blocks, matchups,
    evaluationMode:MIXED_EVALUATION_MODE, alpha:BOUNDED_EVALUATION_ALPHA,
    errorControl:'per-comparison-anytime-two-sided-not-familywise',
    inferentialUnit:'eight-game-deck-seat-first-player-block-with-balanced-matchup-round-looks',
    minimumBlocksPerDeck:4, minimumGroupScore:0.5,
    promotionLooks:Array.from({length:blocks / round - 3}, (_,i)=>(i+4)*round),
    budgetPolicy};
}

export function boundedMatchPlan({candidateHash, opponentHash, ordinal, deckIds, randomSeed, purpose}) {
  if (!['champion-promotion','tactical-baseline-progress'].includes(purpose)) throw new Error('Invalid bounded evaluation purpose.');
  const maximumGames = purpose === 'champion-promotion' ? BOUNDED_BUDGET_POLICY.maximumGames : 800;
  // Every scheduled screen/extension must end at a complete deck rotation.
  if (!deckIds?.length || 400 / (deckIds.length * 8) < 8
    || [400,800,1200,1600,2000,2400].some(n => n % (deckIds.length * 8))) {
    throw new Error('Bounded evaluation budgets must balance every deck.');
  }
  const base = sequentialMatchPlan({candidateHash,opponentHash,ordinal,deckIds,randomSeed,maximumBlocks:maximumGames/8});
  return {...base, version:3, contract:BOUNDED_MATCH_CONTRACT, purpose,
    alpha:BOUNDED_EVALUATION_ALPHA, errorControl:'per-comparison-anytime-two-sided-not-familywise',
    minimumBlocksPerDeck:400 / (deckIds.length * 8),
    promotionLooks:Array.from({length:(maximumGames-400)/(deckIds.length*8)+1},(_,i)=>50+i*deckIds.length),
    budgetPolicy:{...BOUNDED_BUDGET_POLICY}};
}

export function sequentialMatchPlan({candidateHash, opponentHash, ordinal, deckIds, maximumBlocks = 500, randomSeed,futilityPolicy}) {
  const base = frozenMatchPlan({candidateHash, opponentHash, ordinal, deckIds, maximumBlocks, randomSeed});
  if(futilityPolicy!==undefined){
    assertFutilityPolicy(futilityPolicy);
    if(futilityPolicy.checkEveryGames%(deckIds.length*8)) throw new Error('Futility checks must balance every deck.');
  }
  const blocks = Math.ceil(base.blocks / deckIds.length) * deckIds.length;
  return {...base, version: 2, contract: SEQUENTIAL_MATCH_CONTRACT, blocks,
    minimumBlocksPerDeck: 8, minimumObservedWinRate: 0.52, regressionFloor: 0.4,
    betFractions: [...BET_FRACTIONS], alphaAllocation: 'equal-two-sided-betting',
    inferentialUnit: 'eight-game-seed-block-with-balanced-deck-round-looks',
    promotionLooks: Array.from({length: blocks / deckIds.length - 7}, (_, i) => (i + 8) * deckIds.length),
    ...(futilityPolicy ? {futilityPolicy:{...futilityPolicy}} : {})};
}

export function frozenMatchExpectedGame(plan, index) {
  if (isMixedMatchPlan(plan)) return mixedExpectedGame(plan, index);
  const block = Math.floor(index / 8);
  const decks = [...plan.deckIds].sort((a, b) => a.localeCompare(b));
  const deck = decks[(block + plan.seed % decks.length) % decks.length];
  return { candidateSeat: index % 2, firstPlayerId: Math.floor(index / 2) % 2 ? "p2" : "p1",
    gameSeed: (plan.seed + block * 104729) >>> 0, streamAssignment: Math.floor(index % 8 / 4),
    evaluationMode: plan.evaluationMode, deckIds: [deck, deck] };
}

export function assertFrozenMatchGame(plan, summary, index) {
  const expected = frozenMatchExpectedGame(plan, index);
  if (!summary || Object.entries(expected).some(([key, value]) => JSON.stringify(summary[key]) !== JSON.stringify(value))) {
    throw new Error("Evaluation game identity or precommitted schedule mismatch.");
  }
  if (typeof summary.completed !== "boolean" || typeof summary.invalid !== "boolean"
    || typeof summary.adjudicated !== "boolean" || (summary.completed && !["p1", "p2"].includes(summary.winnerId))) {
    throw new Error("Evaluation game completion flags or winner are invalid.");
  }
}

export function frozenMatchDecision(plan, summaries) {
  assertFrozenMatchPlan(plan);
  if (!Array.isArray(summaries)) throw new Error("Evaluation summaries must be an array.");
  if (isSequentialMatchPlan(plan)) return sequentialFrozenDecision(plan, summaries);
  const expected = plan.blocks * 8;
  if (summaries.length !== expected) return { promoted: false, outcome: "inconclusive", expectedGames: expected };
  summaries.forEach((summary, index) => assertFrozenMatchGame(plan, summary, index));
  if (summaries.some(s => s.invalid || !s.completed || s.adjudicated || !s.winnerId)) {
    return { promoted: false, outcome: "invalid-or-unfinished-evaluation" };
  }
  const blockScores = [], decks = {}, seats = [[], []];
  const seenSeeds = new Set();
  for (let i = 0; i < expected; i += 8) {
    const block = summaries.slice(i, i + 8);
    const seed = block[0].gameSeed;
    const deck = block[0].deckIds?.[0];
    const conditions = new Set(block.map(s => `${s.candidateSeat}:${s.firstPlayerId}:${s.streamAssignment}`));
    if (seenSeeds.has(seed) || conditions.size !== 8 || !plan.deckIds.includes(deck)
      || block.some(s => s.gameSeed !== seed || s.evaluationMode !== plan.evaluationMode
        || s.deckIds?.some(id => id !== deck))) throw new Error("Evaluation block identity or symmetry mismatch.");
    seenSeeds.add(seed);
    const score = block.filter(s => s.winnerId === `p${s.candidateSeat + 1}`).length / 8;
    blockScores.push(score);
    (decks[deck] ||= []).push(score);
    for (let seat = 0; seat < 2; seat++) {
      seats[seat].push(block.filter(s => s.candidateSeat === seat && s.winnerId === `p${seat + 1}`).length / 4);
    }
  }
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  const score = mean(blockScores);
  const lowerBound = Math.max(0, score - Math.sqrt(Math.log(1 / plan.alpha) / (2 * blockScores.length)));
  // These are explicit observed regression guards, not a claim of statistical
  // certainty for every rare state/phase. That remains the separate Q audit.
  const safety = plan.deckIds.every(id => decks[id]?.length >= 8 && mean(decks[id]) >= 0.4)
    && seats.every(values => mean(values) >= 0.4);
  return { promoted: lowerBound > 0.5 && safety,
    outcome: lowerBound > 0.5 && safety ? "passed" : "inconclusive",
    score, lowerBound, independentBlocks: blockScores.length,
    confidence: 1 - plan.alpha, observedRegressionGuardsPassed: safety,
    perDeck: Object.fromEntries(Object.entries(decks).map(([id, values]) => [id, { blocks: values.length, score: mean(values) }])) };
}

function sequentialFrozenDecision(plan, summaries) {
  if (summaries.length > plan.blocks * 8) throw new Error('Sequential evaluation exceeds its frozen cap.');
  for (let index = 0; index < summaries.length; index++) {
    assertFrozenMatchGame(plan, summaries[index], index); // rejects holes and an out-of-order prefix
  }
  if (summaries.some(s => s.invalid || !s.completed || s.adjudicated)) {
    return {promoted: false, outcome: 'invalid-or-unfinished-evaluation', stopped: true};
  }
  const blocks = [], seeds = new Set();
  for (let i = 0; i + 7 < summaries.length; i += 8) {
    const group = summaries.slice(i, i + 8), seed = group[0].gameSeed;
    if (seeds.has(seed)) throw new Error('Duplicate independent evaluation seed.');
    seeds.add(seed);
    blocks.push(evaluationBlock(plan, group));
  }
  return sequentialBlockDecision(plan, blocks);
}

// Fairness is by distinct original game. More clones/seeds never create more
// outer observations; natural samples are retained alongside targeted work.
export function selectSavedStateJobs(jobs, limit = 8) {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("Invalid saved-state job limit.");
  if (!limit) return [];
  const counts = new Map();
  for (const job of jobs) {
    const key = `${job.snapshot.deckId}:${job.snapshot.stratum?.phaseBand || job.snapshot.descriptor.samplingFrame?.selectedPhase || "unknown"}`;
    job.selectionStratum = key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...jobs].sort((a, b) => counts.get(a.selectionStratum) - counts.get(b.selectionStratum)
    || a.plan.candidateId.localeCompare(b.plan.candidateId));
  const selected = [], games = new Set();
  for (const job of sorted) {
    const game = job.plan.sourceGameId || job.plan.sourceHash;
    if (games.has(game)) continue;
    selected.push(job); games.add(game);
    if (selected.length >= limit) break;
  }
  return selected;
}
