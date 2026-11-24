import assert from 'node:assert/strict';
import path from 'node:path';
import {digest} from './deck-league-contract.mjs';
import {verifyArtifact} from './deck-league-io.mjs';

// Engine rule repairs are not fingerprint equivalence. Keep each saved game's
// real engine identity, and allow only hash-pinned pre-repair archives to resume.
export function assertLeagueRuntimeResume(plan, current, transition) {
  if (JSON.stringify(plan.trainingRuntime) === JSON.stringify(current)) return;
  assert.ok(transition, 'Resume must use the committed training runtime.');
  assert.equal(transition.contract, 'deck-league-engine-transition-v1');
  assert.equal(digest(plan), transition.planHash, 'Engine transition is for a different plan.');
  assert.deepEqual(plan.trainingRuntime, transition.previousRuntime);
  assert.deepEqual(current, transition.nextRuntime);
  verifyArtifact(transition.plan);
}

export function assertLeagueGameEngine(result, file, plan, currentFingerprint, transition) {
  const pinned = transition?.savedGames?.find(item => path.resolve(item.path) === path.resolve(file));
  let fingerprint = currentFingerprint;
  if (pinned) {
    assert.equal(digest(plan), transition.planHash);
    verifyArtifact(pinned);
    fingerprint = transition.previousFingerprint;
  }
  assert.ok(result.trajectories?.length, 'Missing training trajectories.');
  for (const trajectory of result.trajectories) {
    assert.equal(trajectory.engineFingerprint, fingerprint, 'Uncommitted training engine identity.');
  }
  return fingerprint;
}
