import assert from 'node:assert/strict';
export const FIXED_CHAMPION_REFERENCE='fixed-official-champion-comparison-v1';
export function assertFixedChampionReferences(config,profile,incumbent,opponents){
  const p=config.referencePolicy;
  assert.equal(p?.contract,FIXED_CHAMPION_REFERENCE);
  assert.equal(p.learnerBaselineAllowed,false);
  assert.equal(p.sameEngineAndReview,true);
  assert.equal(p.references.length,config.profiles.length);
  const refs=new Map(p.references.map(r=>[r.profileId,r]));
  assert.equal(refs.size,config.profiles.length);
  const own=refs.get(profile.id);assert.ok(own);
  assert.equal(incumbent.sha256,own.sha256,'Weakened or unapproved baseline substitution');
  assert.equal(incumbent.behaviorHash,own.behaviorHash);
  assert.equal(opponents.length,refs.size);
  assert.equal(new Set(opponents.map(o=>o.profileId)).size,refs.size);
  for(const o of opponents){const r=refs.get(o.profileId);assert.ok(r);
    assert.equal(o.sha256,r.sha256,'Opponent substitution after reference freeze');
    assert.equal(o.behaviorHash,r.behaviorHash);assert.equal(o.deckHash,r.deckHash);
  }
  return true;
}
