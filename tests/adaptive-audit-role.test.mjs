import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { adaptiveAuditSamplingRole, compatibleLeafAuditSamplingFrame } from '../scripts/adaptive-audit-role.mjs';
import { validLeafAuditSamplingFrame } from '../src/ai/neural/action-ranking-reference.mjs';
import { naturalLeafMixtureSamplingFrame, naturalLeafSamplingChannel } from '../src/ai/neural/natural-leaf-sampling.mjs';
import { freshUtilityEvidence, assertUtilityEvidenceDisjoint } from '../scripts/policy-q-utility.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(role) {
  const parent = { datasetKey: 'production-role-test', taskIndex: 3, certificationRole: role,
    plannedFinalSimulations: 32, taskManifestHash: 'committed-parent' };
  const channel = naturalLeafSamplingChannel(parent.taskManifestHash);
  return naturalLeafMixtureSamplingFrame(parent, { mulligan: 2, early: 4, mid: 8, late: 4, unknown: 1 },
    channel === 'population' ? 'mid' : channel);
}

test('prospective adaptive validation uses the accepted development role without changing the game split', () => {
  assert.equal(adaptiveAuditSamplingRole('training'), 'training');
  assert.equal(adaptiveAuditSamplingRole('validation'), 'development');
  assert.throws(() => adaptiveAuditSamplingRole('typo'), /Unknown/);
  assert.equal(validLeafAuditSamplingFrame(fixture(adaptiveAuditSamplingRole('validation'))), true);
  const held = { archivePath: 'held-game', role: 'validation', usableAuditCount: 1 };
  const split = freshUtilityEvidence([held]);
  assert.deepEqual(split.training, []); assert.deepEqual(split.validation, [held]);
  assert.throws(() => assertUtilityEvidenceDisjoint([held], []), /Held-out/);
});

test('committed legacy validation frames normalize only their role and preserve sampling, source commitment, and immutability', () => {
  const original = fixture('validation'), before = structuredClone(original);
  assert.equal(validLeafAuditSamplingFrame(original), false, 'reproduces the production rejection');
  const { frame, compatibility } = compatibleLeafAuditSamplingFrame(original);
  assert.equal(validLeafAuditSamplingFrame(frame), true);
  assert.equal(frame.certificationRole, 'development');
  assert.equal(compatibility.originalTaskManifestHash, original.taskManifestHash);
  assert.deepEqual(original, before);
  for (const key of Object.keys(original).filter(k => !['certificationRole', 'taskManifestHash'].includes(k))) {
    assert.deepEqual(frame[key], original[key], key);
  }
  assert.equal(compatibleLeafAuditSamplingFrame(frame).compatibility, null);
  assert.equal(compatibleLeafAuditSamplingFrame(null).frame, null);
});

test('normalization cannot launder changed commitments, invalid populations, or unknown roles', () => {
  const frame = fixture('validation');
  assert.throws(() => compatibleLeafAuditSamplingFrame({ ...frame, taskIndex: 99 }), /commitment changed/);
  const bad = { ...frame, selectionProbability: 1 }; delete bad.taskManifestHash;
  bad.taskManifestHash = digest(bad);
  assert.throws(() => compatibleLeafAuditSamplingFrame(bad), /sampling population/);
  assert.throws(() => compatibleLeafAuditSamplingFrame(fixture('typo')), /Invalid audit/);
  const training = fixture('training');
  assert.equal(compatibleLeafAuditSamplingFrame(training).frame, training);
});
