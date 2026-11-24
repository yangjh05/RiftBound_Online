import test from 'node:test';import assert from 'node:assert/strict';
import {assertIndividualGameEngine} from '../scripts/individual-game-evidence.mjs';
test('individual collection verifies every trajectory engine even when the archive envelope has no fingerprint',()=>{
 assert.doesNotThrow(()=>assertIndividualGameEngine({trajectories:[{engineFingerprint:'pinned'}]},'pinned'));
 assert.throws(()=>assertIndividualGameEngine({trajectories:[{engineFingerprint:'pinned'},{engineFingerprint:'other'}]},'pinned'));
 assert.throws(()=>assertIndividualGameEngine({trajectories:[{}]},'pinned'));
 assert.throws(()=>assertIndividualGameEngine({trajectories:[]},'pinned'));
 assert.throws(()=>assertIndividualGameEngine({engineFingerprint:'old',trajectories:[{engineFingerprint:'pinned'}]},'pinned'));
});
