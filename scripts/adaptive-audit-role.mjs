import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validLeafAuditSamplingFrame } from '../src/ai/neural/action-ranking-reference.mjs';

export const AUDIT_ROLE_COMPATIBILITY = 'adaptive-validation-is-development-v1';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Adaptive whole-game roles and the evaluator's evidence-stage vocabulary
// are different contracts. Development is held out from optimization, but is
// not a final, untouched certification set.
export function adaptiveAuditSamplingRole(role) {
  assert.ok(['training', 'validation'].includes(role), 'Unknown adaptive game role.');
  return role === 'validation' ? 'development' : 'training';
}

export function compatibleLeafAuditSamplingFrame(original) {
  if (validLeafAuditSamplingFrame(original)) return { frame: original, compatibility: null };
  assert.equal(original?.certificationRole, 'validation', 'Invalid audit sampling frame.');
  const { taskManifestHash, ...committed } = original;
  assert.equal(taskManifestHash, digest(committed), 'Audit sampling commitment changed.');
  const normalized = { ...committed, certificationRole: adaptiveAuditSamplingRole('validation') };
  const frame = { ...normalized, taskManifestHash: digest(normalized) };
  assert.ok(validLeafAuditSamplingFrame(frame), 'Invalid held-out audit sampling population.');
  return { frame, compatibility: { contract: AUDIT_ROLE_COMPATIBILITY,
    originalRole: 'validation', originalTaskManifestHash: taskManifestHash,
    normalizedTaskManifestHash: frame.taskManifestHash } };
}
