import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const POLICY_Q_UTILITY_CONTRACT = 'prospective-response-policy-q-utility-v1';
export const utilityDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function readPolicyQUtilityProtocol(root) {
  let value;
  try { value = JSON.parse((await readFile(path.join(root, 'policy-q-utility-protocol.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  assert.equal(value.contract, POLICY_Q_UTILITY_CONTRACT);
  assert.ok(Number.isInteger(value.afterIteration) && value.afterIteration >= 0);
  assert.equal(value.beliefCoefficient, 0);
  assert.equal(value.validationEveryGames, 8);
  assert.equal(value.validationAuditSimulations, 32);
  assert.equal(value.minimumValidationGames, 32);
  assert.equal(value.maximumQProposals, 8);
  return value;
}

export function commitPolicyQUtilityProtocol(state, protocol) {
  const hash = protocol && utilityDigest(protocol);
  if (state.policyQUtilityProtocolHash) assert.equal(hash, state.policyQUtilityProtocolHash, 'Active policy-Q utility protocol changed.');
  else if (protocol) {
    assert.ok(protocol.afterIteration >= state.iteration, 'Policy-Q utility must start prospectively.');
    state.policyQUtilityProtocolHash = hash;
  }
}

export function utilityPlan(protocol, iteration, games) {
  if (!protocol || iteration <= protocol.afterIteration) return null;
  const validationGameIndexes = Array.from({ length: games }, (_, i) => i)
    .filter(i => i % protocol.validationEveryGames === iteration % protocol.validationEveryGames);
  assert.ok(games - validationGameIndexes.length >= 16, 'Too few PPO training games after holdout.');
  return { ...protocol, protocolHash: utilityDigest(protocol), validationGameIndexes };
}

export function adaptiveGameRole(plan, gameIndex) {
  return plan.utility?.validationGameIndexes.includes(gameIndex) ? 'validation' : 'training';
}

export function assertUtilityEvidenceDisjoint(training, validation) {
  const held = new Set(validation.map(e => path.resolve(e.archivePath)));
  for (const entry of training) {
    assert.notEqual(entry.role, 'validation', 'Held-out game reached training.');
    assert.ok(!held.has(path.resolve(entry.archivePath)), 'Policy-Q holdout/train overlap.');
  }
}

// Before scores or terminal outcomes are inspected, split whole games and
// both seats together. Old games without a role remain training forever.
export function freshUtilityEvidence(records) {
  return {
    training: records.filter(e => e.role !== 'validation' && e.usableAuditCount > 0),
    validation: records.filter(e => e.role === 'validation' && e.usableAuditCount > 0)
  };
}

export function utilityAuditRecords(records) {
  const held = records.filter(e => e.role === 'validation');
  const training = records.filter(e => e.role !== 'validation');
  const output = [];
  for (let i = 0; i < Math.max(held.length, training.length); i++) {
    if (held[i]) output.push(held[i]);
    if (training[i]) output.push(training[i]);
  }
  return output;
}

// This permits proposal triage only. It never certifies a policy correction
// or promotion; independent current-policy rollouts must still confirm it.
export function shadowProposalReadiness(report, protocol) {
  return Boolean(protocol && report?.independentGames >= protocol.minimumValidationGames
    && Number.isFinite(report.meanSquaredError) && Number.isFinite(report.zeroBaselineSquaredError)
    && report.meanSquaredError < report.zeroBaselineSquaredError
    && report.sourceRole === 'validation' && report.actorCorrectionsAuthorized === false);
}
