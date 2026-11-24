import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readTrajectoryArchive } from '../src/ai/neural/archive.mjs';
import { estimateEvidenceNeuralValue, createNeuralSession } from '../src/ai/neural/model.mjs';
import { neuralEvaluatorCoreHash } from '../src/ai/neural/evaluator-certification.mjs';
import { validIndependentLeafValueReference, validLeafActionEffectComparison } from '../src/ai/neural/action-ranking-reference.mjs';
import { actionKey } from '../src/ai/actions.mjs';
import { ACTION_DIM } from '../src/ai/neural/encoding.mjs';
import { applyDetachedLeafEvidence } from './detached-leaf-audit.mjs';
import { shadowProposalReadiness } from './policy-q-utility.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const headFor = reference => reference.auditStratum?.phaseBand === 'mulligan' ? 'mulligan-q' : 'general-action-q';

function usablePairs(reference) {
  if (!validIndependentLeafValueReference(reference) || !validLeafActionEffectComparison(reference.actionEffectComparison)) return [];
  return reference.actionEffectComparison.evaluatorStatePairs.filter(pair =>
    pair.recommendedCaptureStep === 0 && pair.selectedCaptureStep === 0
    && pair.recommendedStructuredState && pair.selectedStructuredState
    && [0, 1].includes(pair.recommendedOutcome) && [0, 1].includes(pair.selectedOutcome));
}

function predictor(model, fingerprint) {
  const cache = new Map();
  return (pair, side, head) => {
    const state = pair[`${side}State`], structured = pair[`${side}StructuredState`];
    const key = digest([head, state, structured]);
    if (!cache.has(key)) cache.set(key, estimateEvidenceNeuralValue(model, state, structured,
      { engineFingerprint: fingerprint, targetHead: head }));
    return cache.get(key);
  };
}

export function summarizeShadowUtility(games, evaluatorHash = null) {
  const rows = [...games.values()].filter(row => row.pairs > 0);
  const average = key => rows.length ? rows.reduce((sum, row) => sum + row[key] / row.pairs, 0) / rows.length : null;
  return { contract: 'held-out-shadow-q-utility-v1', sourceRole: 'validation',
    independentGames: rows.length, pairs: rows.reduce((sum, row) => sum + row.pairs, 0),
    meanSquaredError: average('squaredError'), zeroBaselineSquaredError: average('baselineSquaredError'),
    evaluatorHash, actorCorrectionsAuthorized: false, promotionEligible: false,
    scope: 'fixed-heuristic-continuation-game-weighted-diagnostic',
    status: rows.length ? 'measured' : 'awaiting-prospective-held-out-audits' };
}

export async function evaluateShadowUtility(model, batches, fingerprint) {
  const predict = predictor(model, fingerprint), games = new Map();
  for await (const trajectories of batches) for (const trajectory of trajectories) {
    if (!trajectory.gameId) continue;
    const row = games.get(trajectory.gameId) || { pairs: 0, squaredError: 0, baselineSquaredError: 0 };
    for (const step of trajectory.steps || []) {
      const reference = step.leafValueAuditReference;
      for (const pair of usablePairs(reference)) {
        const predicted = (predict(pair, 'recommended', headFor(reference)) - predict(pair, 'selected', headFor(reference))) / 2;
        assert.ok(Number.isFinite(predicted), 'Non-finite held-out Q prediction.');
        const actual = pair.recommendedOutcome - pair.selectedOutcome;
        row.pairs++; row.squaredError += (predicted - actual) ** 2; row.baselineSquaredError += actual ** 2;
      }
    }
    games.set(trajectory.gameId, row);
  }
  return summarizeShadowUtility(games, neuralEvaluatorCoreHash(model));
}

// Q only proposes which training positions deserve expensive current-policy
// terminal confirmation. Its old heuristic outcomes never authorize an update.
export async function selectShadowQProposals(model, records, protocol, fingerprint) {
  const report = model.metadata?.shadowUtility;
  if (!shadowProposalReadiness(report, protocol) || report.evaluatorHash !== neuralEvaluatorCoreHash(model)) return [];
  const predict = predictor(model, fingerprint), selected = [];
  const sources = records.filter(r => r.role !== 'validation' && r.usableAuditCount > 0)
    .sort((a, b) => b.auditCompletedAt - a.auditCompletedAt).slice(0, 32);
  for (const record of sources) {
    assert.notEqual(record.role, 'validation');
    const raw = await readTrajectoryArchive(record.archivePath), result = raw.result || raw;
    for (const file of record.sidecars || []) {
      const evidence = await readTrajectoryArchive(file);
      assert.equal(evidence.sourceHash, await fileHash(record.archivePath), 'Q proposal source changed.');
      applyDetachedLeafEvidence(result, evidence);
    }
    for (const original of result.pendingLeafAudit?.candidates || []) {
      const trajectory = result.trajectories.find(t => t.playerId === original.recordedStepLocator.actorId);
      const step = trajectory?.steps[original.recordedStepLocator.stepIndex];
      const reference = step?.leafValueAuditReference, pairs = usablePairs(reference);
      if (!pairs.length) continue;
      const snapshot = structuredClone(original);
      const decision = createNeuralSession(model, { lean: true }).decide(snapshot.game, snapshot.actorId,
        snapshot.legalActions, { greedy: true });
      if (!decision) continue;
      const delta = pairs.reduce((sum, pair) => sum + predict(pair, 'recommended', headFor(reference))
        - predict(pair, 'selected', headFor(reference)), 0) / pairs.length;
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.1) continue;
      const recommended = delta > 0 ? original.descriptor.recommendedAction : original.descriptor.selectedAction;
      const compared = delta > 0 ? original.descriptor.selectedAction : original.descriptor.recommendedAction;
      if (actionKey(decision.action) !== actionKey(compared)) continue;
      const keys = decision.legalActions.map(actionKey);
      if (!keys.includes(actionKey(recommended))) continue;
      snapshot.descriptor.recommendedAction = recommended;
      snapshot.descriptor.selectedAction = decision.action;
      snapshot.recordedStepLocator = { ...snapshot.recordedStepLocator, selectedIndex: decision.selectedIndex };
      const freshStep = { ...step, state: decision.stateEncoding, actions: decision.actionEncoding.slice(0, decision.legalCount * ACTION_DIM),
        initialMemory: decision.initialMemory, selectedIndex: decision.selectedIndex,
        selectedActionKey: actionKey(decision.action), legalActionKeys: keys, legalCount: keys.length,
        leafValueAuditReference: null, actionRankingReference: null, actionRankingAuditReference: null };
      selected.push({ entry: { ...record, archiveHash: await fileHash(record.archivePath), role: 'training',
        sourceGameId: trajectory.gameId, proposalSource: 'validated-shadow-q' }, snapshot,
        trajectory: { ...trajectory, steps: [freshStep] }, qMargin: Math.abs(delta) });
    }
  }
  const usedGames = new Set();
  return selected.sort((a, b) => b.qMargin - a.qMargin).filter(item => {
    if (usedGames.has(item.entry.sourceGameId)) return false;
    usedGames.add(item.entry.sourceGameId); return true;
  }).slice(0, protocol.maximumQProposals);
}
