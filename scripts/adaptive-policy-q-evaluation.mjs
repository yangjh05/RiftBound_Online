import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readTrajectoryArchive, writeTrajectoryArchive } from "../src/ai/neural/archive.mjs";
import {withFileLock} from './file-lock.mjs';
import {assertEvaluationReviewSummary} from './evaluation-decision-review.mjs';
import { digest, assertFrozenMatchPlan, assertFrozenMatchGame, frozenMatchDecision }
  from "./adaptive-policy-q-contract.mjs";
import {SEQUENTIAL_MATCH_CONTRACT,BOUNDED_MATCH_CONTRACT,isSequentialMatchPlan,assertFutilityPolicy} from './sequential-match-statistics.mjs';
import {MIXED_MATCH_CONTRACT,isMixedMatchPlan,evaluationRoundGames} from './mixed-match-schedule.mjs';
import {assertParallelEvaluationProtocol} from './parallel-evaluation.mjs';

export const MIXED_ROLLOUT_CONTRACT = 'prospective-balanced-matchup-rollout-v1';
export function assertMixedEvaluationRollout(protocol) {
  if (protocol?.contract !== MIXED_ROLLOUT_CONTRACT || protocol.statisticalContract !== MIXED_MATCH_CONTRACT
    || !Number.isInteger(protocol.afterOrdinal) || protocol.afterOrdinal < 0
    || !Array.isArray(protocol.deckIds) || ![5,6].includes(protocol.deckIds.length)
    || protocol.deckIds.some(id => typeof id !== 'string' || !id) || new Set(protocol.deckIds).size !== protocol.deckIds.length) {
    throw new Error('Invalid mixed evaluation rollout.');
  }
}
export async function readMixedEvaluationRollout(directory) {
  let protocol;
  try {protocol=JSON.parse((await readFile(path.join(directory,'mixed-evaluation-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  assertMixedEvaluationRollout(protocol);
  return protocol;
}
export function commitMixedEvaluationRollout(state, protocol) {
  if (state.mixedEvaluationProtocolHash && !protocol) throw new Error('Mixed evaluation protocol removed.');
  if (!protocol) return;
  assertMixedEvaluationRollout(protocol);
  if (state.mixedEvaluationProtocolHash && state.mixedEvaluationProtocolHash !== digest(protocol)) throw new Error('Active mixed evaluation rollout changed.');
  if (!state.mixedEvaluationProtocolHash && protocol.afterOrdinal < state.evaluationOrdinal) throw new Error('Mixed evaluation must start prospectively.');
  state.mixedEvaluationProtocolHash=digest(protocol);
}

export const BOUNDED_ROLLOUT_CONTRACT = 'prospective-bounded-evaluation-rollout-v1';
export function assertBoundedEvaluationRollout(protocol) {
  if (protocol?.contract !== BOUNDED_ROLLOUT_CONTRACT || protocol.statisticalContract !== BOUNDED_MATCH_CONTRACT
    || !Number.isInteger(protocol.afterOrdinal) || protocol.afterOrdinal < 0
    || protocol.championEvaluationsPerGrowth !== 4) throw new Error('Invalid bounded evaluation rollout.');
}
export async function readBoundedEvaluationRollout(directory) {
  let protocol;
  try {protocol=JSON.parse((await readFile(path.join(directory,'bounded-evaluation-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  assertBoundedEvaluationRollout(protocol);
  return protocol;
}
export function commitBoundedEvaluationRollout(state, protocol) {
  if (state.boundedEvaluationProtocolHash && !protocol) throw new Error('Bounded evaluation protocol removed.');
  if (!protocol) return;
  assertBoundedEvaluationRollout(protocol);
  if (state.boundedEvaluationProtocolHash && state.boundedEvaluationProtocolHash !== digest(protocol)) {
    throw new Error('Active bounded evaluation rollout changed.');
  }
  state.boundedEvaluationProtocolHash = digest(protocol);
}

export async function readEvaluationEfficiency(directory) {
  let protocol;
  try {protocol=JSON.parse((await readFile(path.join(directory,'evaluation-efficiency-protocol.json'),'utf8')).replace(/^\uFEFF/,''));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  assertEvaluationEfficiency(protocol);
  return protocol;
}

export function assertEvaluationEfficiency(protocol) {
  if(protocol?.contract!=='prospective-evaluation-efficiency-v1'
    || !Number.isInteger(protocol.afterOrdinal) || protocol.afterOrdinal<0) throw new Error('Invalid evaluation efficiency rollout.');
  assertFutilityPolicy(protocol.futilityPolicy);
}

export const EVALUATION_ROLLOUT_CONTRACT = 'prospective-sequential-evaluation-rollout-v1';
export function assertEvaluationRollout(protocol) {
  if (!protocol || protocol.contract !== EVALUATION_ROLLOUT_CONTRACT
    || protocol.statisticalContract !== SEQUENTIAL_MATCH_CONTRACT
    || !Number.isInteger(protocol.afterOrdinal) || protocol.afterOrdinal < 0
    || protocol.maximumBlocks !== 500 || protocol.growthMaximumBlocks !== 250
    || !protocol.growthBaselinePath || !/^[0-9a-f]{64}$/.test(protocol.growthBaselineSha256 || '')) {
    throw new Error('Invalid prospective evaluation rollout.');
  }
}

export async function readEvaluationRollout(directory) {
  let protocol;
  try { protocol = JSON.parse((await readFile(path.join(directory, 'evaluation-protocol.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  assertEvaluationRollout(protocol);
  return protocol;
}

export async function readFrozenEvaluationGames(requestFile, request) {
  assertFrozenMatchPlan(request.plan);
  const root = path.dirname(requestFile), identity = digest(request);
  let adoption = null;
  try { adoption = JSON.parse(await readFile(path.join(root, "legacy-result-adoption.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const allowLegacy = adoption?.requestHash === identity;
  let names;
  try { names = await readdir(path.join(root, "games")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const summaries = [];
  for (const name of names.filter(name => name.endsWith(".json"))) {
    const index = Number(name.slice(0, -5));
    if (!Number.isInteger(index) || index < 0 || index >= request.plan.blocks * 8 || name !== `${index}.json`) {
      throw new Error("Unexpected frozen evaluation game filename.");
    }
    const contents = await readFile(path.join(root, "games", name), "utf8");
    const summary = JSON.parse(contents);
    assertEvaluationReviewSummary(request,summary);
    assertFrozenMatchGame(request.plan, summary, index);
    const adopted = allowLegacy && summary.evaluationRequestHash == null
      && adoption.prefix?.[name] === createHash("sha256").update(contents).digest("hex");
    if (summary.evaluationRequestHash !== identity && !adopted) {
      throw new Error("Evaluation game belongs to another frozen request.");
    }
    summaries[index] = summary;
  }
  return summaries;
}

export function decideFrozenEvaluation(request, summaries) {
  if (isSequentialMatchPlan(request.plan)) {
    if ((request.plan.contract === BOUNDED_MATCH_CONTRACT || isMixedMatchPlan(request.plan)) && request.plan.purpose !== request.purpose) {
      throw new Error('Bounded evaluation purpose changed.');
    }
    const decision = frozenMatchDecision(request.plan, summaries);
    if (request.purpose === 'tactical-baseline-progress') {
      return {...decision, superior: decision.promoted, promoted: false, promotionEligible: false};
    }
    if (request.purpose !== 'champion-promotion') throw new Error('Unknown sequential evaluation purpose.');
    return decision;
  }
  if (summaries.some(s => s && (s.invalid || !s.completed || s.adjudicated))) {
    return { promoted: false, outcome: "invalid-or-unfinished-evaluation" };
  }
  if (summaries.filter(Boolean).length !== request.plan.blocks * 8) {
    return { promoted: false, outcome: "inconclusive", expectedGames: request.plan.blocks * 8 };
  }
  return frozenMatchDecision(request.plan, summaries);
}

export async function verifyFrozenEvaluationResult(requestFile) {
  const request = await readTrajectoryArchive(requestFile);
  const result = await readTrajectoryArchive(path.join(path.dirname(requestFile), "result.json.gz"));
  if (digest(result.plan) !== digest(request.plan)) throw new Error("Frozen result plan changed.");
  const summaries = await readFrozenEvaluationGames(requestFile, request);
  const statisticalDecision = decideFrozenEvaluation(request, summaries);
  let decision = statisticalDecision;
  if (result.operationalStop) {
    if (digest(result.statisticalDecision) !== digest(statisticalDecision)) throw new Error('Operational stop statistical evidence changed.');
    decision = operationalStopDecision(request, summaries, statisticalDecision, result.operationalStop);
  }
  if (digest(decision) !== digest(result.decision)) throw new Error("Frozen result disagrees with saved games.");
  if (result.summaryDigest && result.summaryDigest !== digest(summaries)) throw new Error("Frozen saved game digest changed.");
  return { request, result: { ...result, decision } };
}

function operationalStopDecision(request, summaries, statisticalDecision, stop) {
  if (statisticalDecision.stopped || statisticalDecision.outcome !== 'running'
    || stop.contract !== 'frozen-evaluation-budget-closure-v1'
    || stop.requestHash !== digest(request) || stop.summaryDigest !== digest(summaries)
    || stop.statisticalDecisionHash !== digest(statisticalDecision)
    || typeof stop.reason !== 'string' || !stop.reason.trim() || !Number.isFinite(Date.parse(stop.at))) {
    throw new Error('Invalid operational evaluation stop.');
  }
  return {...statisticalDecision, promoted:false, stopped:true, outcome:'budget-closed-unproven',
    savedGames:summaries.length, inferiorityProven:false, operationalStop:stop};
}

// Run only after pausing the controller. The evaluator lock prevents a writer
// from extending the prefix while its administrative closure is committed.
export async function closeFrozenEvaluationForBudget(requestFile, reason) {
  return withFileLock(path.join(path.dirname(requestFile),'evaluation.lock'), async () => {
    const output = path.join(path.dirname(requestFile),'result.json.gz');
    try {await readFile(output); return (await verifyFrozenEvaluationResult(requestFile)).result;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const request = await readTrajectoryArchive(requestFile);
    const summaries = await readFrozenEvaluationGames(requestFile, request);
    const statisticalDecision = decideFrozenEvaluation(request, summaries);
    const operationalStop = {contract:'frozen-evaluation-budget-closure-v1',at:new Date().toISOString(),reason,
      requestHash:digest(request),summaryDigest:digest(summaries),statisticalDecisionHash:digest(statisticalDecision)};
    const decision = operationalStopDecision(request,summaries,statisticalDecision,operationalStop);
    const result = {plan:request.plan,decision,statisticalDecision,operationalStop,summaryDigest:digest(summaries)};
    await writeTrajectoryArchive(output,result);
    return result;
  },{timeoutMs:1000});
}

export async function evaluateFrozenRounds(request, savedSummaries, runRound, onRoundComplete = async () => {}) {
  assertFrozenMatchPlan(request.plan);
  const sequential = isSequentialMatchPlan(request.plan);
  const roundGames = evaluationRoundGames(request.plan), cap = request.plan.blocks * 8;
  let summaries = savedSummaries, decision = decideFrozenEvaluation(request, summaries);
  while (sequential ? !decision.stopped : summaries.filter(Boolean).length < cap) {
    const targetGames = sequential ? Math.min(cap, (Math.floor(summaries.length / roundGames) + 1) * roundGames) : cap;
    const prefixLength = summaries.length, prefixHash = digest(summaries);
    const next = await runRound({targetGames, resumedSummaries: summaries});
    if (next.length !== targetGames) throw new Error('Frozen evaluation round did not finish its scheduled prefix.');
    if (sequential && digest(next.slice(0, prefixLength)) !== prefixHash) throw new Error('Frozen evaluation rewrote a saved prefix.');
    summaries = next;
    decision = decideFrozenEvaluation(request, summaries);
    await onRoundComplete({summaries, decision});
    if (!sequential) break;
  }
  return {summaries, decision};
}

// Reserve before I/O and retain the reservation across crashes. New candidates
// arriving while this request is being frozen remain in the pending slot.
export function reserveAdaptiveEvaluation(state, randomSeed, protocol = null, efficiency = null, bounded = null, mixed = null, parallel = null) {
  if (state.evaluationReservation) return state.evaluationReservation;
  if (state.evaluationQueue.length || !state.pendingEvaluationCandidate) return null;
  if (protocol) assertEvaluationRollout(protocol);
  if (efficiency) assertEvaluationEfficiency(efficiency);
  if (bounded) assertBoundedEvaluationRollout(bounded);
  if (mixed) assertMixedEvaluationRollout(mixed);
  if (parallel) assertParallelEvaluationProtocol(parallel);
  const ordinal = state.evaluationOrdinal + 1;
  const sequential = protocol && ordinal > protocol.afterOrdinal;
  const useBounded = sequential && bounded && ordinal > bounded.afterOrdinal;
  if (mixed && ordinal > mixed.afterOrdinal && !useBounded) throw new Error('Mixed evaluation requires the bounded rollout.');
  const purpose = parallel && ordinal > parallel.afterOrdinal ? 'champion-promotion' : useBounded
    ? ((ordinal - bounded.afterOrdinal) % (bounded.championEvaluationsPerGrowth + 1) === 0
      ? 'tactical-baseline-progress' : 'champion-promotion')
    : sequential ? (state.nextSequentialEvaluationPurpose || 'champion-promotion') : null;
  if (purpose && !['champion-promotion', 'tactical-baseline-progress'].includes(purpose)) throw new Error('Invalid next evaluation purpose.');
  const reservation = { ordinal, candidatePath: state.pendingEvaluationCandidate,
    incumbentPath: purpose === 'tactical-baseline-progress' ? protocol.growthBaselinePath : state.championPath, seed: randomSeed,
    ...(sequential ? {purpose, protocol: structuredClone(protocol)} : {}),
    ...(useBounded ? {bounded:structuredClone(bounded)} : {}),
    ...(useBounded && mixed && ordinal > mixed.afterOrdinal ? {mixed:structuredClone(mixed)} : {}),
    ...(parallel && ordinal > parallel.afterOrdinal ? {parallel:structuredClone(parallel)} : {}),
    ...(!useBounded && sequential && efficiency && ordinal>efficiency.afterOrdinal ? {efficiency:structuredClone(efficiency)} : {}) };
  state.evaluationOrdinal = ordinal;
  if (sequential) state.nextSequentialEvaluationPurpose = purpose === 'champion-promotion'
    ? 'tactical-baseline-progress' : 'champion-promotion';
  state.pendingEvaluationCandidate = null;
  state.evaluationReservation = reservation;
  return reservation;
}

export function promotionWriteAction(currentHash, plan) {
  if (currentHash === plan.candidateHash) return "already-applied";
  if (currentHash === plan.opponentHash) return "write";
  throw new Error("Deployed champion changed outside this frozen evaluation.");
}
