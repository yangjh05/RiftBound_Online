import { assertFrozenMatchGame } from "../scripts/adaptive-policy-q-contract.mjs";
import { isSequentialMatchPlan, sequentialBlockDecision } from "../scripts/sequential-match-statistics.mjs";
import {evaluationRoundGames,evaluationStrata,evaluationBlock,isMixedMatchPlan} from '../scripts/mixed-match-schedule.mjs';

const quantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction, lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
};
const timestamp = value => typeof value === "number" ? value : Date.parse(value);
const iso = ms => Number.isFinite(ms) ? new Date(ms).toISOString() : null;
export function evaluationPrefixLength(games){
  let count=0;while(count<games.length&&games[count])count++;
  return count;
}

// A descriptive forecast, never an input to promotion or training. Resample
// entire independent eight-game blocks within each deck, retaining both seats.
// Per-path Bayesian bootstrap weights reflect uncertainty in the observed mix.
export function forecastEvaluation(plan, games, { simulations = 80 } = {}) {
  if (!isSequentialMatchPlan(plan) || !plan.deckIds?.length) return { status: "unsupported" };
  const strata = evaluationStrata(plan), roundSize = evaluationRoundGames(plan);
  const sourceGames = Math.floor(evaluationPrefixLength(games) / roundSize) * roundSize;
  if (sourceGames < roundSize * 5) return { status: "collecting", sourceGames, minimumGames: roundSize * 5 };
  const observed = games.slice(0, sourceGames), blocks = [];
  try {
    observed.forEach((game, index) => {
      assertFrozenMatchGame(plan, game, index);
      if (!game.completed || game.invalid || game.adjudicated || game.counted === false) throw new Error("Invalid observation");
    });
  } catch { return { status: "invalid", sourceGames }; }
  for (let i = 0; i < sourceGames; i += 8) {
    blocks.push(evaluationBlock(plan, observed.slice(i, i + 8)));
  }
  // If a terminal boundary already exists, do not forecast beyond it.
  const committed = sequentialBlockDecision(plan, blocks);
  if (committed.stopped) return { status: "awaiting-result", sourceGames, outcome: committed.outcome,
    targetGames: committed.evaluatedGames, winRate: committed.score };
  let randomState = ((plan.seed || 1) ^ sourceGames) >>> 0;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return (randomState + .5) / 4294967296; };
  const byDeck = Object.fromEntries(strata.map(id => [id, blocks.filter(b => b.deckId === id)]));
  const order = blocks.slice(0, strata.length).map(b => b.deckId);
  const paths = [], outcomes = {};
  for (let trial = 0; trial < simulations; trial++) {
    const pools = Object.fromEntries(strata.map(id => {
      const weights = byDeck[id].map(() => -Math.log(random()));
      return [id, { weights, total: weights.reduce((a, b) => a + b, 0) }];
    }));
    const future = [...blocks];
    while (future.length < plan.blocks) {
      const id = order[future.length % order.length], pool = pools[id];
      let weight = random() * pool.total, index = 0;
      while (index < pool.weights.length - 1 && (weight -= pool.weights[index]) > 0) index++;
      future.push(byDeck[id][index]);
    }
    // Reuse the exact stopping, evidence, regression and budget rules.
    const decision = sequentialBlockDecision(plan, future);
    paths.push({ games: decision.evaluatedGames, winRate: decision.score, outcome: decision.outcome });
    outcomes[decision.outcome] = (outcomes[decision.outcome] || 0) + 1;
  }
  const passed = outcomes.passed || 0;
  return { status: "estimated", sourceGames, simulations, passedPaths: passed, outcomes,
    outlook: passed / simulations >= .7 ? "favorable" : passed / simulations <= .3 ? "unlikely" : "uncertain",
    targetGames: Math.round(quantile(paths.map(p => p.games), .5)),
    gamesRange: [quantile(paths.map(p => p.games), .1), quantile(paths.map(p => p.games), .9)],
    winRate: quantile(paths.map(p => p.winRate), .5),
    winRateRange: [quantile(paths.map(p => p.winRate), .1), quantile(paths.map(p => p.winRate), .9)],
    method: isMixedMatchPlan(plan) ? 'matchup-stratified-eight-game-bayesian-bootstrap' : "deck-stratified-eight-game-bayesian-bootstrap", rangeLabel: "모의 경로 가운데 80% 범위" };
}

// File completion times survive dashboard restarts. Anchor the forecast to the
// last observed completion, so repeated heartbeats never push ETA backwards.
export function estimateEvaluationEnd({ completionTimes, played, forecast, ordinaryGames, maximumGames, running, finished, now = Date.now() }) {
  if (finished) return { status: "completed" };
  if (!running) return { status: "paused" };
  // Parallel jobs finish out of index order and can share one timestamp. Both
  // must count toward aggregate throughput; do not discard zero intervals.
  const times = completionTimes.map(timestamp).filter(Number.isFinite).sort((a,b)=>a-b).slice(-81);
  if (times.length < 9) return { status: "collecting" };
  const last = times.at(-1);
  const secondsPerGame = (last-times[0]) / (times.length-1) / 1000;
  if (!(secondsPerGame > .05)) return { status: "collecting" };
  if (now - last > Math.max(180000, secondsPerGame * 6000)) return { status: "stale", secondsPerGame };
  const at = target => last + Math.max(0, target - played) * secondsPerGame * 1000;
  const target = Math.max(played, forecast?.targetGames || ordinaryGames || maximumGames);
  const range = forecast?.gamesRange || [target, maximumGames];
  const estimate = at(target);
  return { status: estimate < now ? "awaiting-progress" : "estimated", targetGames: target,
    basis: forecast?.status === "estimated" ? "simulated-stop" : "scheduled-budget",
    estimatedAt: iso(estimate), secondsRemaining: Math.max(0, (estimate - now) / 1000),
    range: range.map(count => iso(at(Math.max(played, count)))),
    ordinaryAt: iso(at(Math.max(played, ordinaryGames))), maximumAt: iso(at(maximumGames)),
    secondsPerGame, sampledGames: times.length-1, lastCompletedAt: iso(last) };
}

export function estimateTrainingEnd({ current, completed, stage, running, committed, now = Date.now() }) {
  if (committed) return { status: "completed" };
  if (!running) return { status: "paused" };
  const normalized = normalizeTrainingStage(stage), start = current?.phases?.[normalized];
  const durations = completed.filter(item => item.iteration !== current?.iteration && item.end > item.phases?.[normalized])
    .slice(-8).map(item => item.end - item.phases[normalized]);
  if (!start || durations.length < 3) return { status: "collecting" };
  const estimated = start + quantile(durations, .5);
  return { status: estimated < now ? "overdue" : "estimated", estimatedAt: iso(estimated),
    secondsRemaining: Math.max(0, (estimated - now) / 1000), samples: durations.length,
    range: [.2, .8].map(q => iso(start + quantile(durations, q))) };
}

export function normalizeTrainingStage(stage) {
  if (["fast-selfplay-game-saved", "selfplay-action-budget-extended", "selfplay-game-rejected"].includes(stage)) return "fast-selfplay";
  if (stage === "tactical-refresh-ready") return "tactical-refresh-training";
  return stage;
}
