import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {digest} from '../scripts/deck-league-contract.mjs';
import {sha} from '../scripts/deck-league-io.mjs';
import {assertLeagueRuntimeResume,assertLeagueGameEngine} from '../scripts/deck-league-runtime-transition.mjs';

test('engine repair admits only the pinned unfinished plan and byte-identical legacy games', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'league-transition-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const old={directory:'old'},next={directory:'new',engineFingerprint:'new-fingerprint'};
  const plan={trainingRuntime:old,iteration:66,seed:18},file=path.join(dir,'18.json');
  const planFile=path.join(dir,'plan.json');fs.writeFileSync(planFile,JSON.stringify(plan));fs.writeFileSync(file,'original');
  const transition={contract:'deck-league-engine-transition-v1',previousRuntime:old,nextRuntime:next,
    planHash:digest(plan),plan:{path:planFile,sha256:sha(planFile)},previousFingerprint:'old-fingerprint',
    savedGames:[{path:file,sha256:sha(file)}]};
  const result=fp=>({trajectories:[{engineFingerprint:fp}]});
  assert.doesNotThrow(()=>assertLeagueRuntimeResume(plan,next,transition));
  assert.throws(()=>assertLeagueRuntimeResume({...plan,iteration:67},next,transition));
  assert.throws(()=>assertLeagueRuntimeResume(plan,{directory:'unreviewed'},transition));
  assert.throws(()=>assertLeagueRuntimeResume(plan,next,null));
  assert.equal(assertLeagueGameEngine(result('old-fingerprint'),file,plan,'new-fingerprint',transition),'old-fingerprint');
  assert.equal(assertLeagueGameEngine(result('new-fingerprint'),path.join(dir,'new.json'),plan,'new-fingerprint',transition),'new-fingerprint');
  assert.throws(()=>assertLeagueGameEngine(result('old-fingerprint'),path.join(dir,'new.json'),plan,'new-fingerprint',transition));
  assert.throws(()=>assertLeagueGameEngine(result('new-fingerprint'),file,plan,'new-fingerprint',transition));
  fs.writeFileSync(file,'modified');
  assert.throws(()=>assertLeagueGameEngine(result('old-fingerprint'),file,plan,'new-fingerprint',transition));
});

test('subsequent plans require the exact new runtime without a legacy exception',()=>{
  const runtime={directory:'new',engineFingerprint:'new-fingerprint'};
  assert.doesNotThrow(()=>assertLeagueRuntimeResume({trainingRuntime:runtime},runtime,null));
  assert.throws(()=>assertLeagueRuntimeResume({trainingRuntime:{directory:'new'}},runtime,null));
});
