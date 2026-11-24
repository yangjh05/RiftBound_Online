import assert from 'node:assert/strict';
// Adaptive archives bind the engine on each trajectory, not on the envelope.
// Require every learner trajectory to carry the exact committed identity.
export function assertIndividualGameEngine(game,expected){
  assert.ok(game.trajectories?.length,'Missing individual training trajectories');
  if(game.engineFingerprint!==undefined)assert.equal(game.engineFingerprint,expected);
  for(const trajectory of game.trajectories)assert.equal(trajectory.engineFingerprint,expected,'Individual trajectory engine changed');
}
