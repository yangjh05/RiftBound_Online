// Fixed-mixture betting e-process. References and the balanced-deck proof:
// docs/audits/ai-sequential-evaluation-2026-09-15.md.
// One observation is a complete eight-game seed block, never a single mirror.
import {MIXED_MATCH_CONTRACT, isMixedMatchPlan, evaluationStrata} from './mixed-match-schedule.mjs';
export const SEQUENTIAL_MATCH_CONTRACT = 'balanced-deck-betting-evaluation-v2';
export const BOUNDED_MATCH_CONTRACT = 'bounded-balanced-deck-betting-evaluation-v3';
export const isSequentialMatchPlan = plan => [SEQUENTIAL_MATCH_CONTRACT, BOUNDED_MATCH_CONTRACT, MIXED_MATCH_CONTRACT].includes(plan?.contract);
// Prospective per-comparison error control; NOT lifetime family-wise control.
export const BOUNDED_EVALUATION_ALPHA = 0.02; // 1% in each direction
export const BOUNDED_BUDGET_POLICY = Object.freeze({contract:'promising-candidate-budget-v1',
  screeningGames:800, screeningPreviousGames:400, screeningMaximumScore:0.5,
  lowPromiseGames:1200, lowPromiseMaximumScore:0.52, recentGames:400,
  ordinaryGames:1600, extensionCheckGames:2000, maximumGames:2400,
  extensionMinimumScore:0.54, extensionMinimumRecentScore:0.52,
  firstExtensionEvidenceFraction:0.25, secondExtensionEvidenceFraction:0.5});
export const BET_FRACTIONS = Object.freeze([0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.95]);
// Resource allocation only: stopping for low promise never certifies inferiority.
// Two scheduled checks require 1,200 games at the earliest, not just 320.
export const NEUTRAL_FUTILITY_POLICY = Object.freeze({contract:'neutral-candidate-budget-v1',
  minimumGames:800, checkEveryGames:400, recentGames:400, consecutiveLooks:2,
  maximumCumulativeScore:0.52, maximumRecentScore:0.52});

export function assertFutilityPolicy(policy) {
  if (!policy || Object.keys(policy).length !== Object.keys(NEUTRAL_FUTILITY_POLICY).length
    || Object.entries(NEUTRAL_FUTILITY_POLICY).some(([key,value])=>policy[key]!==value)) {
    throw new Error('Frozen futility commitment changed.');
  }
}

function lowPromiseDecision(plan, blocks, count) {
  const policy=plan.futilityPolicy;
  if (!policy) return null;
  assertFutilityPolicy(policy);
  const games=count*8;
  if (games<policy.minimumGames || (games-policy.minimumGames)%policy.checkEveryGames) return null;
  const checks=[];
  for(let offset=policy.consecutiveLooks-1;offset>=0;offset--){
    const end=count-offset*policy.checkEveryGames/8;
    if(end*8<policy.minimumGames) return null;
    const cumulative=blocks.slice(0,end),recent=blocks.slice(end-policy.recentGames/8,end);
    const mean=items=>items.reduce((sum,b)=>sum+b.score,0)/items.length;
    checks.push({games:end*8,cumulativeScore:mean(cumulative),recentScore:mean(recent)});
  }
  return checks.every(c=>c.cumulativeScore<=policy.maximumCumulativeScore && c.recentScore<=policy.maximumRecentScore)
    ? {contract:policy.contract,checks,inferiorityProven:false} : null;
}

const logMeanExp = values => {
  const largest = Math.max(...values);
  return largest + Math.log(values.reduce((sum, x) => sum + Math.exp(x - largest), 0) / values.length);
};

function boundedBudgetDecision(plan, blocks, count, evidence, safety) {
  if (![BOUNDED_MATCH_CONTRACT,MIXED_MATCH_CONTRACT].includes(plan.contract) || plan.purpose !== 'champion-promotion') return null;
  const p = plan.budgetPolicy, games = count * 8;
  const mean = items => items.reduce((sum, b) => sum + b.score, 0) / items.length;
  const cumulativeScore = mean(blocks.slice(0, count));
  const recentScore = mean(blocks.slice(count - p.recentGames / 8, count));
  let reason = null;
  if (games === p.screeningGames && cumulativeScore <= p.screeningMaximumScore
    && recentScore <= p.screeningMaximumScore
    && mean(blocks.slice(0, p.screeningPreviousGames / 8)) <= p.screeningMaximumScore) reason = 'neutral-screen';
  if (games === p.lowPromiseGames && cumulativeScore <= p.lowPromiseMaximumScore
    && recentScore <= p.lowPromiseMaximumScore) reason = 'low-promise-screen';
  if (games === p.ordinaryGames || games === p.extensionCheckGames) {
    const fraction = games === p.ordinaryGames ? p.firstExtensionEvidenceFraction : p.secondExtensionEvidenceFraction;
    if (!(safety && cumulativeScore >= p.extensionMinimumScore && recentScore >= p.extensionMinimumRecentScore
      && evidence.logEvidence >= evidence.logEvidenceThreshold + Math.log(fraction))) reason = 'extension-not-justified';
  }
  return reason ? {contract:p.contract, reason, games, cumulativeScore, recentScore, inferiorityProven:false} : null;
}

export function bettingLogEvidence(scores, nullMean = 0.5) {
  if (!(nullMean > 0 && nullMean <= 1)
    || scores.some(x => !Number.isFinite(x) || x < 0 || x > 1)) throw new Error('Invalid bounded betting observations.');
  return logMeanExp(BET_FRACTIONS.map(fraction => scores.reduce((sum, x) =>
    sum + Math.log1p(fraction * (x / nullMean - 1)), 0)));
}

// Valid at complete balanced-deck rounds. Fixed fractions are never selected
// by the currently inspected round. Under average deck mean <= m,
// E[product_d (1-c+c*X_d/m)] = product_d(1-c+c*mu_d/m) <= 1
// by independence across seed blocks and AM-GM. Mixing these nonnegative
// round-level supermartingales preserves Ville's anytime error bound.
export function bettingMeanBounds(scores, alpha) {
  if (!(alpha > 0 && alpha < 1)) throw new Error('Invalid betting error budget.');
  const threshold = Math.log(2 / alpha); // split between the two directions
  const lower = values => {
    if (!values.length || bettingLogEvidence(values, 1e-12) < threshold) return 0;
    let lo = 0, hi = 1;
    for (let i = 0; i < 42; i++) {
      const midpoint = (lo + hi) / 2;
      if (bettingLogEvidence(values, midpoint) >= threshold) lo = midpoint;
      else hi = midpoint;
    }
    return lo;
  };
  const inverse = scores.map(x => 1 - x);
  return {lowerBound: lower(scores), upperBound: 1 - lower(inverse),
    logEvidence: bettingLogEvidence(scores), logEvidenceAgainst: bettingLogEvidence(inverse),
    logEvidenceThreshold: threshold};
}

export function sequentialBlockDecision(plan, blocks) {
  const strata = evaluationStrata(plan), mixed = isMixedMatchPlan(plan);
  const deckCount = strata.length;
  const complete = Math.floor(blocks.length / deckCount) * deckCount;
  const minimum = plan.minimumBlocksPerDeck * deckCount;
  for (let start = 0; start < complete; start += deckCount) {
    const ids = blocks.slice(start, start + deckCount).map(b => b.deckId);
    if (new Set(ids).size !== deckCount || ids.some(id => !strata.includes(id))) {
      throw new Error('Sequential evidence requires balanced complete deck rounds.');
    }
  }
  // Replay the first stopping decision exactly after a crash. Later data
  // cannot erase an earlier crossing, nor manufacture a different result.
  for (let count = minimum; count <= complete; count += deckCount) {
    const prefix = blocks.slice(0, count), scores = prefix.map(b => b.score);
    const evidence = {logEvidence: bettingLogEvidence(scores),
      logEvidenceAgainst: bettingLogEvidence(scores.map(x => 1 - x)), logEvidenceThreshold: Math.log(2 / plan.alpha)};
    const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
    const score = mean(scores);
    const perStratum = Object.fromEntries(strata.map(id => {
      const values = prefix.filter(b => b.deckId === id).map(b => b.score);
      return [id, {blocks: values.length, score: mean(values)}];
    }));
    const perDeck = mixed ? Object.fromEntries(plan.deckIds.map(id => {
      const values = prefix.map(b => b.decks?.[id]).filter(Boolean);
      const games = values.reduce((sum,b)=>sum+b.games,0), wins=values.reduce((sum,b)=>sum+b.wins,0);
      return [id,{blocks:values.length,games,score:games ? wins/games : NaN}];
    })) : perStratum;
    const perGroup = mixed ? Object.fromEntries(['mirror','cross'].map(kind => {
      const values=prefix.filter(b=>b.kind===kind).map(b=>b.score);
      return [kind,{blocks:values.length,games:values.length*8,score:mean(values)}];
    })) : null;
    const perFirst = mixed ? [0,1].map(first=>mean(prefix.map(b=>b.first?.[first]))) : null;
    const perSeat = [0, 1].map(seat => mean(prefix.map(b => b.seats[seat])));
    const safety = Object.values(perStratum).every(d => d.blocks >= plan.minimumBlocksPerDeck && d.score >= plan.regressionFloor)
      && perSeat.every(x => x >= plan.regressionFloor)
      && (!mixed || (Object.values(perDeck).every(d=>d.score>=plan.regressionFloor)
        && Object.values(perGroup).every(d=>d.score>=plan.minimumGroupScore)
        && perFirst.every(x=>x>=plan.regressionFloor)));
    const promoted = evidence.logEvidence >= evidence.logEvidenceThreshold
      && score >= plan.minimumObservedWinRate && safety;
    const inferior = evidence.logEvidenceAgainst >= evidence.logEvidenceThreshold;
    const capped = count === plan.blocks;
    const futility = !promoted && !inferior && !capped
      ? (boundedBudgetDecision(plan, blocks, count, evidence, safety) || lowPromiseDecision(plan,blocks,count)) : null;
    if (promoted || inferior || futility || capped || count === complete) {
      const result = {promoted, outcome: promoted ? 'passed' : inferior ? 'inferior' : futility ? 'low-promise' : capped ? 'inconclusive' : 'running',
        stopped: Boolean(promoted || inferior || futility || capped), score, ...bettingMeanBounds(scores, plan.alpha),
        independentBlocks: count, balancedRounds: count / deckCount,
        evaluatedGames: count * 8, observedGames: blocks.length * 8, maximumGames: plan.blocks * 8,
        confidence: 1 - plan.alpha, observedRegressionGuardsPassed: safety, perDeck, perSeat,
        ...(mixed ? {perMatchup:perStratum,perGroup,perFirst} : {}),
        method: plan.contract, ...([BOUNDED_MATCH_CONTRACT,MIXED_MATCH_CONTRACT].includes(plan.contract) ? {errorControl:plan.errorControl,
          ordinaryGames:plan.purpose === 'champion-promotion' ? plan.budgetPolicy.ordinaryGames : plan.blocks * 8} : {}),
        ...(futility ? {futility} : {})};
      if (result.stopped || count === complete) return result;
    }
  }
  return {promoted: false, outcome: 'running', stopped: false, independentBlocks: complete,
    evaluatedGames: complete * 8, maximumGames: plan.blocks * 8, minimumGames: minimum * 8,
    method: plan.contract, ...([BOUNDED_MATCH_CONTRACT,MIXED_MATCH_CONTRACT].includes(plan.contract) ? {errorControl:plan.errorControl,
      ordinaryGames:plan.purpose === 'champion-promotion' ? plan.budgetPolicy.ordinaryGames : plan.blocks * 8} : {})};
}
