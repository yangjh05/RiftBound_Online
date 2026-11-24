import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,atomic,immutable,verifyArtifact,reserveSeeds,exists} from './deck-league-io.mjs';
import {digest,inputKey,seedFor,trainingPlan,evaluationJobs,MATCH_INDEPENDENCE} from './deck-league-contract.mjs';
import {extendConstrainedPolicyRuntime} from './constrained-policy-runtime.mjs';
import {FIXED_CHAMPION_REFERENCE,assertFixedChampionReferences} from './fixed-champion-reference.mjs';
import {COVERAGE_BUDGET} from './lesson-coverage-budget.mjs';

const root=path.resolve(process.argv[2]||'data/ai/deck-league-individual-20261011-r2'),league=path.resolve('data/ai/deck-league-20261007');
assert.ok(!exists(root),'Never overwrite a prepared or completed experiment');
const base=json(path.join(league,'config.json')),pointer=json(path.join(league,'execution-active.json'));
const repair=json(verifyArtifact({path:path.join(league,pointer.directory,'repair.json'),sha256:pointer.repairSha256}));
const runtime=path.join(root,'runtime'),ref=p=>({path:path.resolve(p),sha256:sha(p)}),source=repair.trainingRuntime;
const manifest=json(verifyArtifact(source.manifest));
for(const item of manifest){const from=path.join(source.directory,item.path),to=path.join(runtime,item.path);assert.equal(sha(from),item.sha256);
  fs.mkdirSync(path.dirname(to),{recursive:true});
  if(['src/ai/neural/model.mjs','src/ai/neural/trainer.mjs'].includes(item.path))
    fs.writeFileSync(to,extendConstrainedPolicyRuntime(item.path,fs.readFileSync(from,'utf8').replace(/\r\n/g,'\n')));
  else fs.copyFileSync(from,to);
}
for(const name of ['constrained-policy-learning.mjs','transactional-policy-learning.mjs','individual-transactional-policy.mjs','individual-training-margin.mjs']){
  const file='scripts/'+name,to=path.join(runtime,file);fs.copyFileSync(file,to);if(!manifest.some(x=>x.path===file))manifest.push({path:file});
}
for(const item of manifest)item.sha256=sha(path.join(runtime,item.path));
atomic(path.join(root,'runtime-manifest.json'),manifest);
fs.symlinkSync(path.resolve('node_modules'),path.join(runtime,'node_modules'),'junction');
const load=f=>import(pathToFileURL(path.join(runtime,f)));
const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
const {computeEngineFingerprint}=await load('scripts/training-safety.mjs');
const fingerprint=computeEngineFingerprint(runtime);
// No inference-equivalence alias: collection and both evaluation subjects run
// this identical corrected runtime with its actual fingerprint.
const inputs=path.join(root,'inputs');fs.mkdirSync(inputs,{recursive:true});
const state=json(path.join(league,'state.json'));atomic(path.join(inputs,'live-state.json'),state);
const roleFiles=[path.join(league,'input-protection-live.json.gz'),
  'data/ai/deck-league-constrained-20261008/inputs/input-roles.json.gz',
  'data/ai/deck-league-transactional-20261008/inputs/input-roles.json.gz'];
const held=new Set(),seen=new Set();
for(const f of roleFiles){const r=await read(f);for(const k of r.protected)held.add(k);for(const k of r.trained)seen.add(k);}
// Include all actually used side-study inputs, not merely their starting ledger.
for(const study of ['deck-league-constrained-20261008','deck-league-transactional-20261008']){
  const walk=async dir=>{for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.name==='runtime'||ent.name.startsWith('runtime-')||ent.name==='node_modules')continue;
    const f=path.join(dir,ent.name);if(ent.isDirectory())await walk(f);else if(ent.name==='trained-input-keys.json.gz')for(const k of (await read(f)).keys)seen.add(k);}};
  await walk(path.resolve('data/ai',study));
}
const profiles=[];
for(const p of base.profiles){
  verifyArtifact(p.initial);assert.equal(state.profiles[p.id].champion.sha256,p.initial.sha256,'New official champion needs an explicit reference freeze');
  assert.equal(p.initial.sha256,p.id==='viktor'?'bfa4e8b0400fa09c65aa2ae1c2e21b1f50ffa8ac558e16713d7c4661e5d82301':'f462f722a252bdd2ae9b2c4dd66c9b593206b49c1b64f450aaf05508d86ad6af',
    'Only the previously verified official champion sources are authorized as references');
  const original=await read(verifyArtifact(p.lessons)),bank=structuredClone(original),keys=new Set(bank.bank.training.map(inputKey));
  const additions=[repair.lessonAdditions?.[p.id]?.augmented?.path,
    path.resolve('data/ai/deck-league-transactional-20261008/profiles',p.id,'lessons.json.gz')].filter(f=>f&&exists(f));
  for(const f of additions){const prior=await read(f);assert.deepEqual(prior.bank.validation,original.bank.validation);
    for(const s of prior.bank.training){const key=inputKey(s);if(keys.has(key))continue;
      assert.equal(s.lessonRole,'training');assert.equal(s.deckId,p.deck.id);assert.equal(s.lessonSource.proof.thresholdsUnchanged,true);
      assert.equal(s.memoryContext.fromReset,true);assert.ok(!held.has(key));keys.add(key);seen.add(key);bank.bank.training.push(s);
    }
  }
  for(const s of bank.bank.training)seen.add(inputKey(s));for(const s of bank.bank.validation)held.add(inputKey(s));
  const f=path.join(inputs,p.id+'-lessons.json.gz');await write(f,bank);
  profiles.push({...p,champion:p.initial,originalLessons:p.lessons,lessons:ref(f),lessonSources:additions.map(ref),auditLearner:state.profiles[p.id].learner,auditIteration:state.profiles[p.id].iteration});
}
assert.ok([...held].every(k=>!seen.has(k)),'Conflicting original roles must not be relabelled');
await write(path.join(inputs,'input-roles.json.gz'),{protected:[...held].sort(),trained:[...seen].sort()});
const forbidden=new Set(base.protectedSeeds||[]),ledgerSources=[];
for(const name of fs.readdirSync(path.resolve('data/ai'))){if(!/^(deck-league|viktor|champion-start)/.test(name))continue;
  const file=path.resolve('data/ai',name,'seed-ledger.json');if(exists(file)){for(const k of Object.keys(json(file)))forbidden.add(Number(k));ledgerSources.push(ref(file));}}
const opponents=profiles.map(p=>({...p.champion,profileId:p.id,deckId:p.deck.id,deckHash:p.deckHash}));
const referencePolicy={contract:FIXED_CHAMPION_REFERENCE,learnerBaselineAllowed:false,sameEngineAndReview:true,references:opponents,
  origin:'Six original official champion weight copies (1833/official1163), and fixed Viktor specialist1814. No learner substituted.'};
const c={contract:'bounded-individual-deck-study-v2',createdAt:new Date().toISOString(),directory:root,projectDirectory:process.cwd(),
  sourceConfig:ref(path.join(league,'config.json')),sourceRuntime:source,runtimeDirectory:runtime,runtimeManifest:ref(path.join(root,'runtime-manifest.json')),
  engineFingerprint:fingerprint,inputRoles:ref(path.join(inputs,'input-roles.json.gz')),auditState:ref(path.join(inputs,'live-state.json')),
  profiles,opponents,referencePolicy,seed:2110261012,coverageBudget:COVERAGE_BUDGET,epochs:4,gamesPerProfile:28,iterations:1,
  maxLessonActions:2400,maximumVerifiedPerGame:12,maximumProcesses:16,workerProcesses:2,priority:'normal',
  ownPolicyOnly:true,automaticIntegration:false,criteriaUnchanged:true,liveLeagueModified:false,
  margin:{floor:.05,coefficient:.25,tolerance:1e-7},
  bounds:'One new 28-game on-policy batch per deck, at most four epochs. Final candidate only. No extension or repeat-until-pass.',
  evaluation:'Original 112-game screen and independent896 confirmation, fixed official champion baseline and opponent panel, equal runtime/review.'};
immutable(path.join(root,'config.json'),c);
const evaluationConfig={...base,directory:root,seed:c.seed,runtimeDirectory:runtime,runtimeManifest:c.runtimeManifest,engineFingerprint:fingerprint,
  protectedSeeds:[...forbidden].sort((a,b)=>a-b),referencePolicy};
for(const p of profiles)assertFixedChampionReferences(evaluationConfig,p,p.champion,opponents);
const protocol={contract:MATCH_INDEPENDENCE,configHash:digest(evaluationConfig),afterIterations:Object.fromEntries(profiles.map(p=>[p.id,0])),
  unit:'fresh-seed-blocks-and-frozen-models',stateOverlap:'diagnostic-only',evaluationDataTraining:false,existingProtectedInputsPreserved:true,correctionCriteriaUnchanged:true,criteria:base.evaluation};
immutable(path.join(root,'input-protocol.json'),protocol);
const corrections=profiles.flatMap(p=>Array.from({length:128},(_,i)=>{
  const types=p.id==='master-yi-aurora'?['mulligan','resource','response','growth']:['mulligan','resource','response','response'];
  const target=types[i%4];
  const opponent=opponents[(profiles.findIndex(x=>x.id===p.id)+i)%7];
  return {id:`${p.id}-${target}-${i}`,profileId:p.id,target,collectionStage:i<64?0:1,role:'training',seed:seedFor(evaluationConfig,p.id,'individual-correction',i),chooser:i%2?'p2':'p1',
    deckIds:i%2?[opponent.deckId,p.deck.id]:[p.deck.id,opponent.deckId],opponent};}));
reserveSeeds(root,'targeted-correction-training',corrections.map(j=>j.seed),[...forbidden]);
const trainingPlans=profiles.map(p=>{const tp=trainingPlan(evaluationConfig,p,1,p.champion,opponents),file=path.join(root,'profiles',p.id,'replay','plan.json');
  immutable(file,tp);reserveSeeds(root,`training:${p.id}:1`,Array.from({length:28},(_,i)=>(tp.seed+i*130363)>>>0),[...forbidden]);return {profileId:p.id,...ref(file)};});
for(const p of profiles)for(const phase of ['screen','confirmation'])reserveSeeds(root,`evaluation:${p.id}:1:${phase}`,evaluationJobs(evaluationConfig,p,1,phase,opponents).map(j=>j.seed),[...forbidden]);
const prior=json('data/ai/deck-league-transactional-20261008/followup-plan.json');
const plan={at:new Date().toISOString(),configHash:digest(c),corrections,responseConfig:prior.responseConfig,evaluationConfig,trainingPlans,
  inputProtocol:ref(path.join(root,'input-protocol.json')),reservedSeeds:ref(path.join(root,'seed-ledger.json')),pastLedgerSources:ledgerSources,
  freshTrainingGames:196,initialCorrectionGames:448,maximumCorrectionGames:896,coverageBudget:COVERAGE_BUDGET,maximumEpochsPerProfile:4,
  stopping:'Failure stops for investigation; no new seed retry. Unchanged or rejected final candidates skip evaluation. No automatic promotion/integration.',
  interpretation:'Training gains or victories over weaker learners never certify improvement. Fixed champion relative confirmation is required.'};
immutable(path.join(root,'followup-plan.json'),plan);
const files=['run-individual-deck-study.mjs','audit-deck-learning.mjs','lesson-coverage-budget.mjs','collect-targeted-deck-lessons.mjs','targeted-lesson-budget.mjs','viktor-candidate-learning.mjs',
  'fixed-champion-reference.mjs','constrained-epoch-evidence.mjs','deck-league-io.mjs','deck-league-contract.mjs','deck-league-evaluation.mjs'].map(f=>ref(path.join('scripts',f)));
immutable(path.join(root,'execution.json'),{configHash:digest(c),files,plan:ref(path.join(root,'followup-plan.json'))});
console.log(JSON.stringify({root,configHash:digest(c),runtimeFiles:manifest.length,engineFingerprint:fingerprint,profiles:profiles.length,protected:held.size,trained:seen.size}));
