import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {json,sha,atomic,immutable,verifyArtifact} from './deck-league-io.mjs';
import {digest,MATCH_INDEPENDENCE} from './deck-league-contract.mjs';

const project=process.cwd(),audit=path.join(project,'data/ai/training-repair-20261013');
const main=path.join(project,'data/ai/deck-league-20261007'),study=path.join(project,'data/ai/deck-league-individual-20261011-r2');
const mainDir=path.join(main,'execution-r6-evaluation'),studyDir=path.join(study,'execution-r5-streamed');
const ref=file=>({path:file,sha256:sha(file)});
assert.ok(!fs.existsSync(path.join(mainDir,'repair.json')),'Repair already prepared');
fs.mkdirSync(audit,{recursive:true});
const c=json(path.join(main,'config.json')),oldPointer=json(path.join(main,'execution-active.json'));
const oldRepairFile=path.join(main,oldPointer.directory,'repair.json'),oldRepair=json(oldRepairFile);
assert.equal(json(path.join(main,'controller.json')).stage,'paused-at-boundary');
for(const root of [main,study]){
  const before=path.join(audit,path.basename(root),'sealed-before');fs.mkdirSync(before,{recursive:true});
  for(const name of ['config.json','state.json','controller.json','execution-active.json','seed-ledger.json','preflight.json','collection-progress.json'])
    if(fs.existsSync(path.join(root,name)))fs.copyFileSync(path.join(root,name),path.join(before,name));
}
const state=json(path.join(main,'state.json'));
const protectedArtifacts=[...new Map(Object.values(state.profiles).flatMap(p=>[p.learner,p.champion,...p.history]).map(r=>[r.path,r])).values()];
protectedArtifacts.forEach(verifyArtifact);
immutable(path.join(audit,'preserved-weights.json'),protectedArtifacts);
fs.mkdirSync(mainDir,{recursive:true});
const runtime=oldRepair.trainingRuntime,laneDirectory=path.join(main,'evaluation-r6');
const diagnosticFile=path.join(mainDir,'diagnostic-input-snapshot.json.gz');fs.copyFileSync(path.join(main,'input-protection-live.json.gz'),diagnosticFile);
const evaluationConfig={...c,seed:digest([c.seed,'corrected-engine-independent-evaluation-r6']),runtimeDirectory:runtime.directory,
  runtimeManifest:runtime.manifest,engineFingerprint:runtime.engineFingerprint};
immutable(path.join(mainDir,'evaluation-config.json'),evaluationConfig);
const inputProtocol={contract:MATCH_INDEPENDENCE,configHash:digest(evaluationConfig),afterIterations:Object.fromEntries(c.profiles.map(p=>[p.id,0])),
  unit:'fresh-seed-blocks-and-frozen-models',stateOverlap:'diagnostic-only',evaluationDataTraining:false,
  existingProtectedInputsPreserved:true,correctionCriteriaUnchanged:true,criteria:c.evaluation,
  namespace:'corrected-engine-independent-evaluation-r6',reason:'New environment and fresh seeds; old environment evidence retained separately'};
immutable(path.join(mainDir,'evaluation-protocol.json'),inputProtocol);
const lane={directory:laneDirectory,config:ref(path.join(mainDir,'evaluation-config.json')),inputProtocol:ref(path.join(mainDir,'evaluation-protocol.json')),
  runtime,diagnosticInputs:ref(diagnosticFile),workers:3};
immutable(path.join(mainDir,'evaluation-lane.json'),lane);
const names=['train-deck-league.mjs','deck-league-contract.mjs','deck-league-io.mjs','deck-league-evaluation.mjs','deck-league-runtime-transition.mjs',
  'deck-league-evaluation-lane.mjs','deck-league-evaluation-worker.mjs','run-deck-league-evaluation.mjs','parallel-evaluation-pool.mjs','file-lock.mjs'];
for(const name of names)fs.copyFileSync(path.join(project,'scripts',name),path.join(mainDir,name));
const executionFiles=Object.fromEntries(names.map(name=>[name,sha(path.join(mainDir,name))]));
immutable(path.join(mainDir,'repair.json'),{...oldRepair,executionFiles,evaluationLane:lane,previousRepair:ref(oldRepairFile),
  reason:'Pinned matching evaluation engine; independent three-worker evaluation lane; unchanged training and promotion criteria',
  trainingAlgorithmUnchanged:true,criteriaUnchanged:true,oldEvaluationEvidencePreserved:true});
const sc=json(path.join(study,'config.json')),oldExecutionRef=json(path.join(study,'execution-active.json')),oldExecution=json(verifyArtifact(oldExecutionRef));
fs.mkdirSync(studyDir,{recursive:true});
const policyDirectory=path.join(study,'runtime-r5-streamed');
assert.ok(!fs.existsSync(policyDirectory),'Policy runtime already prepared');
for(const item of json(verifyArtifact(sc.runtimeManifest))){const source=path.join(sc.runtimeDirectory,item.path),destination=path.join(policyDirectory,item.path);
  assert.equal(sha(source),item.sha256);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
fs.symlinkSync(path.join(project,'node_modules'),path.join(policyDirectory,'node_modules'),'junction');
for(const name of ['individual-training-margin.mjs','individual-transactional-policy.mjs'])fs.copyFileSync(path.join(project,'scripts',name),path.join(policyDirectory,'scripts',name));
const manifest=json(sc.runtimeManifest.path).map(item=>({...item,sha256:sha(path.join(policyDirectory,item.path))}));
immutable(path.join(studyDir,'policy-runtime-manifest.json'),manifest);
const {computeEngineFingerprint}=await import(pathToFileURL(path.join(policyDirectory,'scripts/training-safety.mjs')));
assert.equal(computeEngineFingerprint(),sc.engineFingerprint,'Rule/inference runtime must remain identical');
const policyRuntime={directory:policyDirectory,manifest:ref(path.join(studyDir,'policy-runtime-manifest.json')),engineFingerprint:sc.engineFingerprint};
const execution={...oldExecution,files:oldExecution.files.map(r=>ref(r.path)),policyRuntime,
  previousExecution:oldExecutionRef,policyContract:'training-only-streamed-individual-margin-adam-transaction-v3',
  policyCriteriaUnchanged:true,collectionPlanUnchanged:true,seedBudgetUnchanged:true};
immutable(path.join(studyDir,'execution.json'),execution);
immutable(path.join(audit,'prepared.json'),{at:new Date().toISOString(),main:{directory:mainDir,repair:ref(path.join(mainDir,'repair.json')),
  pointer:{directory:path.basename(mainDir),repairSha256:sha(path.join(mainDir,'repair.json')),executionHash:digest(executionFiles)},laneFile:path.join(mainDir,'evaluation-lane.json')},
  study:{directory:studyDir,pointer:ref(path.join(studyDir,'execution.json')),policyRuntime},oldPointers:{main:oldPointer,study:oldExecutionRef}});
console.log(JSON.stringify({prepared:true,mainExecution:mainDir,policyRuntime:policyDirectory,criteriaUnchanged:true}));
