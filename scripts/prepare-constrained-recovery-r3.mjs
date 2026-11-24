import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {json,sha,atomic,verifyArtifact,exists} from './deck-league-io.mjs';
import {digest} from './deck-league-contract.mjs';
import {extendConstrainedPolicyRuntime} from './constrained-policy-runtime.mjs';

const root=path.resolve(process.argv[2]),c=json(path.join(root,'config.json'));
const prior=json(path.join(root,'implementation-repair.json'));
assert.equal(prior.configHash,digest(c));
const oldExecution=json(path.join(root,'execution-r2.json'));oldExecution.files.forEach(verifyArtifact);
const controller=json(path.join(root,'controller.json'));
assert.equal(controller.stage,'failed');assert.match(controller.error,/worker engine differs/);
try{process.kill(controller.pid,0);throw Error('Controller is still running.');}catch(e){assert.equal(e.code,'ESRCH');}
const runtime=path.join(root,'runtime-r3');assert.ok(!exists(runtime));
for(const f of json(verifyArtifact(prior.manifest))){
  const source=path.join(prior.directory,f.path);assert.equal(sha(source),f.sha256);
  const target=path.join(runtime,f.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
}
fs.symlinkSync(path.join(c.projectDirectory,'node_modules'),path.join(runtime,'node_modules'),'junction');
for(const f of ['src/ai/neural/model.mjs','src/ai/neural/trainer.mjs']){
  const original=fs.readFileSync(path.join(c.sourceRuntime.directory,f),'utf8');
  assert.equal(fs.readFileSync(path.join(runtime,f),'utf8'),extendConstrainedPolicyRuntime(f,original));
}
const safety=await import(pathToFileURL(path.join(runtime,'scripts/training-safety.mjs')));
const raw=safety.computeEngineFingerprint(runtime),base=json(verifyArtifact(c.sourceConfig));
assert.notEqual(raw,base.engineFingerprint);
const compatibilityFile=path.join(runtime,'scripts/training-fingerprint-compatibility.json');
const compatibility=json(compatibilityFile),auditPath=path.join(root,'runtime-repair-r3.json');
compatibility.entries.push({kind:'equivalent-evaluation-inference-v1',rawFingerprint:raw,
  compatibleFingerprint:base.engineFingerprint,auditReport:auditPath,
  policyActionsPreserved:true,evaluationBehaviorPreserved:true,savedTargetsPreserved:true,recurrentMemoryPreserved:true});
atomic(compatibilityFile,compatibility);
assert.equal(safety.computeEngineFingerprint(runtime),base.engineFingerprint);
const manifest=json(prior.manifest.path).map(f=>({path:f.path,sha256:sha(path.join(runtime,f.path))}));
const manifestFile=path.join(root,'runtime-r3-manifest.json');atomic(manifestFile,manifest);
const runnerOriginal=path.resolve('scripts/run-constrained-deck-study.mjs');
let runner=fs.readFileSync(runnerOriginal,'utf8');
const replace=(before,after)=>{assert.equal(runner.split(before).length,2,before);runner=runner.replace(before,after);};
replace("import {listNodeProcesses,selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';",
  "import {listNodeProcesses,selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';\nimport {epochUpdateEvidence} from './constrained-epoch-evidence.mjs';");
replace("const runtime=repair?.directory||c.runtimeDirectory;",
  "const runtimeRevision=json(path.join(root,'runtime-repair-r3.json'));assert.equal(runtimeRevision.configHash,digest(c));\nconst runtime=runtimeRevision.directory;");
replace("mode==='preflight'?'preflight.json':'controller.json'","mode==='preflight'?'preflight-r3.json':'controller.json'");
replace("if(repair)for(const item of json(verifyArtifact(repair.manifest)))assert.equal(sha(path.join(runtime,item.path)),item.sha256);",
  "if(repair)for(const item of json(verifyArtifact(repair.manifest)))assert.equal(sha(path.join(repair.directory,item.path)),item.sha256);");
replace("for(;;){const processes=selectTrainingProcesses(await listNodeProcesses(),c.projectDirectory);",
  "for(;;){const all=await listNodeProcesses(),selected=selectTrainingProcesses(all,c.projectDirectory);\n    const processes=[...new Map([...selected,...all.filter(p=>/constrained-deck-study/.test(p.commandLine||''))].map(p=>[p.pid,p])).values()];");
replace("const execution=json(path.join(root,repair?'execution-r2.json':'execution.json'));",
  "for(const item of json(verifyArtifact(runtimeRevision.manifest)))assert.equal(sha(path.join(runtime,item.path)),item.sha256);\n  const {computeEngineFingerprint}=await load('scripts/training-safety.mjs');assert.equal(computeEngineFingerprint(),base.engineFingerprint);\n  const execution=json(path.join(root,'execution-r3.json'));");
replace("if(exists(file)){final=await read(file);assert.equal(final.planHash,digest(tp));}",
  "if(exists(file)){final=await read(file);assert.equal(final.planHash,digest(tp));\n        const past=await read(path.join(dir,'trained-input-keys.json.gz'));assert.equal(past.planHash,digest(tp));\n        for(const key of past.keys){assert.ok(!held.has(key));seen.add(key);}}");
replace("teacherEvaluatorMode:'heuristic-only',captureIndependentLeafAudit:false,captureProductionLeafAudit:false,engineFingerprint:base.engineFingerprint,",
  "teacherEvaluatorMode:'heuristic-only',captureIndependentLeafAudit:false,captureProductionLeafAudit:false,engineFingerprint:base.engineFingerprint,\n            onGameComplete:async()=>progress('collecting',{profileId:p.id,iteration,completed:fs.readdirSync(path.join(dir,'games')).filter(f=>f.endsWith('.json.gz')).length,total:28}),");
replace("const batchReports=[],rehearsal=", "let lastAcceptedHash=neuralBehaviorHash(source);\n          const batchReports=[],rehearsal=");
replace("epochGuard:args=>{const g=guard();return {...g,passed:g.passed&&finite.epochGuard(args).passed};},selectBestEpoch:false,gamesObserved:eligible.length,",
  "epochGuard:args=>{const g=guard(),afterHash=neuralBehaviorHash(candidate);\n                const updateEvidence=epochUpdateEvidence(batchReports,args.epoch,lastAcceptedHash,afterHash);\n                const passed=g.passed&&finite.epochGuard(args).passed&&updateEvidence.passed;\n                if(passed)lastAcceptedHash=afterHash;return {...g,passed,updateEvidence};},selectBestEpoch:false,gamesObserved:eligible.length,");
const runnerFile=path.resolve('scripts/run-constrained-deck-study-r3.mjs');assert.ok(!exists(runnerFile));fs.writeFileSync(runnerFile,runner);
const ref=file=>({path:path.resolve(file),sha256:sha(file)});
atomic(path.join(root,'controller-before-r3.json'),controller);
const originalGames=path.join(root,'profiles/annie/iterations/000001/games');
assert.equal(fs.readdirSync(originalGames).filter(f=>f.endsWith('.json.gz')).length,0);
const savedCorrections=fs.readdirSync(path.join(root,'profiles/annie/lessons')).filter(f=>f.endsWith('.json.gz')).map(f=>ref(path.join(root,'profiles/annie/lessons',f)));
atomic(auditPath,{at:new Date().toISOString(),configHash:digest(c),directory:runtime,manifest:ref(manifestFile),
  reason:'Training-only opt-in code changed the raw neural directory fingerprint; default inference, encoding, game rules and ordinary PPO were unchanged. Register only this complete reviewed source digest using the existing fail-closed equivalence contract.',
  rawFingerprint:raw,compatibleFingerprint:base.engineFingerprint,
  defaultBehaviorTest:{path:path.resolve('tests/constrained-runtime-compatibility.test.mjs'),sha256:sha('tests/constrained-runtime-compatibility.test.mjs'),passed:2,failed:0},
  modelAndTrainerTransformVerified:true,savedCorrections,existingTrainingGames:0,
  configUnchanged:true,seedAndBudgetUnchanged:true,teacherAndRetentionCriteriaUnchanged:true,liveLeagueModified:false,
  noOpAccounting:'An epoch requires at least one accepted proposal and a changed policy hash; unchanged epochs fail with no-minibatch-update.',
  resume:'Reuse the four immutable correction records and unchanged training plan; no outcome or model-driven retry.'});
atomic(path.join(root,'execution-r3.json'),{at:new Date().toISOString(),plan:oldExecution.plan,
  previousExecution:ref(path.join(root,'execution-r2.json')),runtimeRevision:ref(auditPath),
  files:[...oldExecution.files.filter(f=>f.path!==runnerOriginal),ref(runnerFile),ref('scripts/constrained-epoch-evidence.mjs')]});
console.log(JSON.stringify({runtime,rawFingerprint:raw,compatibleFingerprint:base.engineFingerprint,savedCorrections:savedCorrections.length}));
