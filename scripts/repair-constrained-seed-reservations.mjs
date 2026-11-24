import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {json,sha,atomic,verifyArtifact,exists} from './deck-league-io.mjs';
import {digest,evaluationJobs} from './deck-league-contract.mjs';

// Correct reservation ownership before the first evaluation. The original
// precommitted seeds, experiment, roles and budgets remain unchanged.
const root=path.resolve(process.argv[2]),c=json(path.join(root,'config.json'));
const plan=json(path.join(root,'followup-plan.json'));
assert.equal(plan.configHash,digest(c));
const reportPath=path.join(root,'seed-reservation-repair.json');
assert.ok(!exists(reportPath),'Already repaired; do not repeat.');
const ledger=json(verifyArtifact(plan.seedLedger));
const beforeKeys=Object.keys(ledger).sort();
const changes=[];
for(const p of c.profiles){
  assert.ok(!exists(path.join(root,'profiles',p.id,'evaluations')),'An evaluation already started.');
  for(const phase of ['screen','confirmation']){
    const owner=`evaluation:${p.id}:${c.iterations}:${phase}`;
    for(const seed of new Set(evaluationJobs(plan.evaluationConfig,p,c.iterations,phase,c.opponents).map(j=>j.seed))){
      assert.equal(ledger[seed],'constrained-deck-study','Cannot modify another reservation owner.');
      changes.push({seed,from:ledger[seed],to:owner,role:'evaluation-only'});
      ledger[seed]=owner;
    }
  }
}
assert.deepEqual(Object.keys(ledger).sort(),beforeKeys);
assert.equal(changes.length,378);
const backup=path.join(root,'inputs','seed-ledger-original.json');
assert.ok(!exists(backup));fs.copyFileSync(plan.seedLedger.path,backup);
assert.equal(sha(backup),plan.seedLedger.sha256);
atomic(plan.seedLedger.path,ledger);
atomic(reportPath,{at:new Date().toISOString(),configHash:digest(c),
  reason:'The bounded-study umbrella owner conflicts with the shared evaluator per-phase owner. Correct the same experiment reservation bookkeeping before any evaluation runs.',
  original:{path:backup,sha256:sha(backup)},replacement:{path:plan.seedLedger.path,sha256:sha(plan.seedLedger.path)},
  changes,seedValuesUnchanged:true,rolesUnchanged:true,modelsUnchanged:true,budgetsUnchanged:true,
  sourceGamesModified:false,liveLeagueModified:false,criteriaUnchanged:true,
  implementation:{path:path.resolve('scripts/repair-constrained-seed-reservations.mjs'),sha256:sha('scripts/repair-constrained-seed-reservations.mjs')}});
console.log(JSON.stringify({correctedReservations:changes.length,reservedSeeds:beforeKeys.length,report:reportPath}));
