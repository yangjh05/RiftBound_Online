import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,atomic,immutable,verifyArtifact,reserveSeeds} from './deck-league-io.mjs';
import {digest,inputKey,seedFor,evaluationJobs,MATCH_INDEPENDENCE} from './deck-league-contract.mjs';
const root=path.resolve(process.argv[2]||'data/ai/deck-league-transactional-20261008'),previous=path.resolve('data/ai/deck-league-constrained-20261008');
assert.ok(!fs.existsSync(path.join(root,'config.json')),'Never replace a frozen study.');
const old=json(path.join(previous,'config.json')),base=json(verifyArtifact(old.sourceConfig));
const revision=json(path.join(previous,'runtime-repair-r3.json')),runtime=path.join(root,'runtime'),ref=p=>({path:path.resolve(p),sha256:sha(p)});
const manifest=json(verifyArtifact(revision.manifest));
for(const item of manifest){assert.equal(sha(path.join(revision.directory,item.path)),item.sha256);assert.equal(sha(path.join(runtime,item.path)),item.sha256);}
fs.copyFileSync('scripts/transactional-policy-learning.mjs',path.join(runtime,'scripts/transactional-policy-learning.mjs'));
manifest.push({path:'scripts/transactional-policy-learning.mjs',sha256:sha(path.join(runtime,'scripts/transactional-policy-learning.mjs'))});
atomic(path.join(root,'runtime-manifest.json'),manifest);
const load=f=>import(pathToFileURL(path.join(runtime,f)));
const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
const inputs=path.join(root,'inputs');fs.mkdirSync(inputs,{recursive:true});
fs.copyFileSync(path.join(base.directory,'input-protection-live.json.gz'),path.join(inputs,'league-roles.json.gz'));
const live=await read(path.join(inputs,'league-roles.json.gz')),prior=await read(verifyArtifact(old.inputRoles));
const held=new Set([...live.protected,...prior.protected]),trained=new Set([...live.trained,...prior.trained]);
const profiles=old.profiles.map(p=>{
  const dir=path.join(previous,'profiles',p.id,'iterations','000001');
  return {...p,lessons:ref(path.join(previous,'profiles',p.id,'lessons.json.gz')),
    replay:{plan:ref(path.join(dir,'plan.json')),admission:ref(path.join(dir,'trained-input-keys.json.gz')),
      games:Array.from({length:28},(_,i)=>ref(path.join(dir,'games',i+'.json.gz')))}};
});
for(const p of profiles){
  const bank=await read(verifyArtifact(p.lessons));
  for(const s of bank.bank.validation)held.add(inputKey(s));
  for(const s of bank.bank.training)trained.add(inputKey(s));
  for(let n=1;n<=2;n++)for(const k of (await read(path.join(previous,'profiles',p.id,'iterations',String(n).padStart(6,'0'),'trained-input-keys.json.gz'))).keys)trained.add(k);
}
assert.ok([...held].every(k=>!trained.has(k)),'Input roles conflict; do not reassign either role.');
await write(path.join(inputs,'input-roles.json.gz'),{protected:[...held].sort(),trained:[...trained].sort(),at:new Date().toISOString()});
const ledgerFiles=[path.join(base.directory,'seed-ledger.json'),path.join(previous,'seed-ledger.json')];
const forbidden=new Set(base.protectedSeeds||[]);
for(const [i,f] of ledgerFiles.entries()){
  const copy=path.join(inputs,`seed-ledger-${i}.json`);fs.copyFileSync(f,copy);for(const k of Object.keys(json(copy)))forbidden.add(Number(k));
}
// Both earlier independent growth collections' entire candidate-seed budgets
// were reserved in these source ledgers, including unused natural deals.
const c={contract:'bounded-transactional-deck-study-v1',createdAt:new Date().toISOString(),directory:root,projectDirectory:process.cwd(),
  sourceConfig:old.sourceConfig,previousResult:ref(path.join(previous,'completed-review.json')),runtimeDirectory:runtime,runtimeManifest:ref(path.join(root,'runtime-manifest.json')),
  inputRoles:ref(path.join(inputs,'input-roles.json.gz')),profiles,opponents:old.opponents,seed:Math.floor(Date.now()/1000)>>>0,
  epochs:4,replayGamesPerProfile:28,maxLessonActions:2400,maximumVerifiedPerGame:12,correctionGames:{annie:8,'master-yi-aurora':8,leona:0},
  maximumProcesses:16,priority:'normal',ownPolicyOnly:true,automaticIntegration:false,liveLeagueModified:false,
  bounds:'One saved first-iteration replay per profile, at most four epochs. Final changed, retained candidate only; no intermediate selection or retries after completed rejection.',
  retention:'Original and augmented training groups separately; individual correct choices and all categories before each batch; unchanged held-out/source/champion epoch guards.',
  optimizer:'Each proposal is a real Adam update from one weight/moment snapshot. Accept both, reject both.',
  corrections:'Separate response and growth review budgets; unchanged public teachers; permanent training only; exclude protected inputs.',
  evaluation:'Fresh independent 112-game screen, only if eligible then 896-game confirmation. Existing thresholds, opponents and public review. Never automatically integrate.'};
immutable(path.join(root,'config.json'),c);
const evaluationConfig={...base,directory:root,seed:c.seed,protectedSeeds:[...forbidden].sort((a,b)=>a-b)};
const protocol={contract:MATCH_INDEPENDENCE,configHash:digest(evaluationConfig),afterIterations:Object.fromEntries(base.profiles.map(p=>[p.id,0])),
  unit:'fresh-seed-blocks-and-frozen-models',stateOverlap:'diagnostic-only',evaluationDataTraining:false,existingProtectedInputsPreserved:true,correctionCriteriaUnchanged:true,criteria:base.evaluation};
immutable(path.join(root,'input-protocol.json'),protocol);
const corrections=profiles.flatMap(p=>Array.from({length:c.correctionGames[p.id]},(_,i)=>{
  const opponent=c.opponents.find(o=>o.profileId===[p.id,'sett','kaisa','master-yi-no-aurora'][i%4]);
  return {id:`${p.id}-${i}`,profileId:p.id,target:p.id==='annie'?'response':'growth',role:'training',seed:seedFor(evaluationConfig,p.id,'targeted-correction',i),
    chooser:i%2?'p2':'p1',deckIds:i%2?[opponent.deckId,p.deck.id]:[p.deck.id,opponent.deckId],opponent};
}));
reserveSeeds(root,'targeted-correction-training',corrections.map(j=>j.seed),[...forbidden]);
for(const p of profiles)for(const phase of ['screen','confirmation'])reserveSeeds(root,`evaluation:${p.id}:1:${phase}`,
  evaluationJobs(evaluationConfig,p,1,phase,c.opponents).map(j=>j.seed),[...forbidden]);
const priorPlan=json(path.join(previous,'followup-plan.json'));
const plan={at:new Date().toISOString(),configHash:digest(c),corrections,responseConfig:priorPlan.responseConfig,evaluationConfig,inputProtocol:ref(path.join(root,'input-protocol.json')),
  reservedSeeds:ref(path.join(root,'seed-ledger.json')),savedTrainingGames:84,freshCorrectionGames:16,maximumEpochsPerProfile:4,
  replaySource:'Exact frozen champion policy that generated first-iteration saved training games; own actions only. No evaluation game reuse.',
  stopping:'No model change or failed retention skips new match evaluation. Completed rejection ends this branch. No budget extension or retuning to protected labels.',
  deployment:'No live league modification, no promotion, serving remains disabled.'};
immutable(path.join(root,'followup-plan.json'),plan);
const files=['run-transactional-deck-study.mjs','collect-targeted-deck-lessons.mjs','targeted-lesson-budget.mjs','transactional-policy-learning.mjs',
  'constrained-epoch-evidence.mjs','viktor-candidate-learning.mjs','deck-league-io.mjs','deck-league-contract.mjs','deck-league-evaluation.mjs'].map(f=>ref(path.join('scripts',f)));
immutable(path.join(root,'execution.json'),{at:new Date().toISOString(),configHash:digest(c),files,plan:ref(path.join(root,'followup-plan.json'))});
console.log(JSON.stringify({root,configHash:digest(c),profiles:profiles.map(p=>p.id),trained:trained.size,protected:held.size,reservedSeeds:Object.keys(json(path.join(root,'seed-ledger.json'))).length}));
