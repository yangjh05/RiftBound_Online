import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';
import {digest} from './deck-league-contract.mjs';
import {extendConstrainedPolicyRuntime} from './constrained-policy-runtime.mjs';

const root=path.resolve(process.argv[2]||'data/ai/deck-league-constrained-20261008');
assert.ok(!fs.existsSync(path.join(root,'config.json')),'Already prepared; never replace a committed study.');
const league=path.resolve('data/ai/deck-league-20261007'),c=json(path.join(league,'config.json'));
const pointer=json(path.join(league,'execution-active.json')),repair=json(path.join(league,pointer.directory,'repair.json'));
assert.equal(sha(path.join(league,pointer.directory,'repair.json')),pointer.repairSha256);
const runtime=path.join(root,'runtime'),source=repair.trainingRuntime;
verifyArtifact(source.manifest);const manifest=json(source.manifest.path),changed=[];
fs.mkdirSync(root,{recursive:true});
for(const item of manifest){
  const from=path.join(source.directory,item.path),to=path.join(runtime,item.path);assert.equal(sha(from),item.sha256);
  fs.mkdirSync(path.dirname(to),{recursive:true});
  if(['src/ai/neural/trainer.mjs','src/ai/neural/model.mjs'].includes(item.path)){
    const before=fs.readFileSync(from,'utf8').replace(/\r\n/g,'\n'),after=extendConstrainedPolicyRuntime(item.path,before);
    fs.writeFileSync(to,after);changed.push({path:item.path,before:item.sha256,after:sha(to)});
  }else fs.copyFileSync(from,to);
}
for(const name of ['constrained-policy-learning.mjs']){
  const to=path.join(runtime,'scripts',name);fs.copyFileSync(path.join('scripts',name),to);
  manifest.push({path:'scripts/'+name,sha256:sha(to)});
}
for(const item of manifest)item.sha256=sha(path.join(runtime,item.path));
atomic(path.join(root,'runtime-manifest.json'),manifest);
if(!fs.existsSync(path.join(runtime,'node_modules')))fs.symlinkSync(path.join(process.cwd(),'node_modules'),path.join(runtime,'node_modules'),'junction');
const inputs=path.join(root,'inputs');fs.mkdirSync(inputs,{recursive:true});
const roleSource=path.join(league,'input-protection-live.json.gz');fs.copyFileSync(roleSource,path.join(inputs,'input-roles.json.gz'));
const ref=p=>({path:path.resolve(p),sha256:sha(p)}),state=json(path.join(league,'state.json'));
const ids=['annie','master-yi-aurora','leona'];
const profiles=ids.map(id=>{
  const p=c.profiles.find(x=>x.id===id),iteration=id==='leona'?30:31;
  const replay=path.join(league,'profiles',id,'iterations',String(iteration).padStart(6,'0'));
  return {...p,champion:state.profiles[id].champion,lessons:repair.lessonAdditions?.[id]?.augmented||p.lessons,
    originalLessons:p.lessons,replay:{iteration,plan:ref(path.join(replay,'plan.json')),result:ref(path.join(replay,'candidate.json.gz'))}};
});
const config={contract:'bounded-constrained-deck-study-v1',createdAt:new Date().toISOString(),directory:root,
  projectDirectory:process.cwd(),sourceConfig:ref(path.join(league,'config.json')),sourceRuntime:source,
  runtimeDirectory:runtime,runtimeManifest:ref(path.join(root,'runtime-manifest.json')),runtimeChanges:changed,
  inputRoles:ref(path.join(inputs,'input-roles.json.gz')),profiles,
  opponents:c.profiles.map(p=>({...state.profiles[p.id].champion,profileId:p.id,deckId:p.deck.id,deckHash:p.deckHash})),
  seed:Math.floor(Date.now()/1000)>>>0,iterations:2,gamesPerIteration:28,epochs:4,
  correctionGamesPerProfile:4,maxLessonActions:2400,maximumTeacherReviews:96,maximumVerifiedPerGame:12,
  ownPolicyOnly:true,criteriaUnchanged:true,maximumProcesses:16,workerProcesses:2,priority:'normal',
  promotionEligible:false,liveLeagueModified:false,automaticIntegration:false,
  evaluation:{...c.evaluation,screenGamesPerProfile:112,confirmationGamesPerProfile:896,
    interpretation:'Independent diagnostic; no direct promotion. Only a passing fresh confirmation can support later integration.'},
  stop:'One fixed run per profile, no extending budgets, no selecting intermediate checkpoints, no repeat-until-pass.',
  implementation: ['scripts/constrained-policy-runtime.mjs','scripts/constrained-policy-learning.mjs'].map(ref)};
atomic(path.join(root,'config.json'),config);
console.log(JSON.stringify({root,configHash:digest(config),files:manifest.length,profiles:ids,runtimeChanges:changed}));
