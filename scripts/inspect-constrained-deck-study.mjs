import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {json,sha,atomic,verifyArtifact,exists} from './deck-league-io.mjs';
import {digest,inputKey,unwrap,partitionTrainingTrajectories,trainingPlan,evaluationJobs} from './deck-league-contract.mjs';
import {listNodeProcesses,selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';

const root=path.resolve(process.argv[2]),c=json(path.join(root,'config.json'));
const repair=json(path.join(root,'implementation-repair.json'));
const runtimeRevision=exists(path.join(root,'runtime-repair-r3.json'))?json(path.join(root,'runtime-repair-r3.json')):repair;
assert.equal(repair.configHash,digest(c));
verifyArtifact(repair.original);verifyArtifact(repair.replacement);
for(const [directory,manifest] of [[c.runtimeDirectory,c.runtimeManifest],[repair.directory,repair.manifest]]){
  for(const f of json(verifyArtifact(manifest)))assert.equal(sha(path.join(directory,f.path)),f.sha256,f.path);
}
assert.equal(runtimeRevision.configHash,digest(c));
for(const f of json(verifyArtifact(runtimeRevision.manifest)))assert.equal(sha(path.join(runtimeRevision.directory,f.path)),f.sha256,f.path);
const execution=json(path.join(root,runtimeRevision===repair?'execution-r2.json':'execution-r3.json'));
if(execution.runtimeRevision)verifyArtifact(execution.runtimeRevision);
execution.files.forEach(verifyArtifact);
const plan=json(verifyArtifact(execution.plan));assert.equal(plan.configHash,digest(c));
const reservationRepair=json(path.join(root,'seed-reservation-repair.json'));
verifyArtifact(reservationRepair.original);verifyArtifact(reservationRepair.replacement);
assert.equal(reservationRepair.original.sha256,plan.seedLedger.sha256);
const ledger=json(reservationRepair.replacement.path),originalLedger=json(reservationRepair.original.path);
assert.deepEqual(Object.keys(ledger).sort(),Object.keys(originalLedger).sort());
for(const change of reservationRepair.changes){assert.equal(originalLedger[change.seed],change.from);assert.equal(ledger[change.seed],change.to);}
const load=f=>import(pathToFileURL(path.join(runtimeRevision.directory,f)));
const {tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
const {resolveLessonMemory}=await load('scripts/lesson-memory-context.mjs');
const {assertLessonSample}=await load('scripts/tactical-lesson-learning.mjs');
const {assertAdaptiveGame}=await load('scripts/adaptive-policy-q-evidence.mjs');
const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
const roles=await read(verifyArtifact(c.inputRoles)),held=new Set(roles.protected),seen=new Set(roles.trained);
assert.ok([...held].every(k=>!seen.has(k)));
const liveSeeds=json(path.join(path.dirname(c.sourceConfig.path),'seed-ledger.json'));
assert.ok(Object.keys(ledger).every(s=>!Object.hasOwn(liveSeeds,s)),'Live and experimental seed reservations collided.');
const profiles=[];
for(const p of c.profiles){
  const dir=path.join(root,'profiles',p.id),frozen=await read(verifyArtifact(p.lessons));
  const expected=structuredClone(frozen),duplicates=new Set(expected.bank.training.map(inputKey));
  const model=deserialize(unwrap(await read(verifyArtifact(p.champion))));
  assert.equal(neuralBehaviorHash(model),p.champion.behaviorHash);
  const records=[];
  try{
    for(const job of plan.corrections.filter(j=>j.profileId===p.id)){
      const file=path.join(dir,'lessons',job.id+'.json.gz');if(!exists(file))continue;
      const r=await read(file);assert.deepEqual(r.job,job);assert.equal(r.configHash,digest(c));
      assert.equal(r.failure,null);assert.equal(r.summary.completed,true);assert.equal(r.policyOnly,true);assert.equal(r.terminalLabels,false);
      let accepted=0;const kinds={};
      for(const s of r.samples){
        assertLessonSample(s,'training');assert.equal(s.deckId,p.deck.id);assert.equal(s.lessonSource.proof.thresholdsUnchanged,true);
        assert.equal(s.memoryContext.fromReset,true);assert.equal(s.memoryContext.playerId,s.playerId);
        assert.ok(s.memoryContext.states.length<=s.lessonSource.actionCount);
        const step=s.steps[0],memory=resolveLessonMemory(model,s);
        const {logits}=inferStep(model,step.state,step.actions,step.legalCount,memory);
        assert.ok(logits.every(Number.isFinite));
        assert.equal(logits.indexOf(Math.max(...logits)),s.correctionProof.parentChoice);
        assert.equal(step.selectedIndex,s.correctionProof.verifiedTarget);
        assert.notEqual(step.selectedIndex,s.correctionProof.parentChoice);
        const type=['mulliganLesson','growthLesson','localResourceLesson','responsePolicyLesson'].filter(k=>step[k]).join('+');
        kinds[type]=(kinds[type]||0)+1;
        const key=inputKey(s);if(!held.has(key)&&!duplicates.has(key)){duplicates.add(key);expected.bank.training.push(s);accepted++;}
      }
      records.push({path:file,sha256:sha(file),raw:r.samples.length,accepted,kinds,actions:r.summary.actions});
    }
  }finally{dispose(model);}
  const bankFile=path.join(dir,'lessons.json.gz');
  if(exists(bankFile))assert.equal(digest(await read(bankFile)),digest(expected));
  const iterations=[];let source=p.champion;
  for(let iteration=1;iteration<=c.iterations;iteration++){
    const it=path.join(dir,'iterations',String(iteration).padStart(6,'0'));
    if(!exists(path.join(it,'plan.json')))break;
    const tp=json(path.join(it,'plan.json'));
    assert.deepEqual(tp,trainingPlan(plan.evaluationConfig,p,iteration,source,c.opponents));
    const files=exists(path.join(it,'games'))?fs.readdirSync(path.join(it,'games')).filter(f=>/^\d+\.json\.gz$/.test(f)).sort((a,b)=>parseInt(a)-parseInt(b)):[];
    const trajectories=[],artifacts=[];
    for(const name of files){
      const index=parseInt(name),file=path.join(it,'games',name),g=await read(file);assertAdaptiveGame(g,tp,index);
      assert.equal(g.trajectories.length,1);assert.equal(g.trajectories[0].deckId,p.deck.id);
      const summary=g.summaries?.[0]||g.summary;
      assert.equal(summary.gameSeed,(tp.seed+index*130363)>>>0);
      assert.equal(summary.firstPlayerId,Math.floor(index/2)%2?'p2':'p1');
      assert.equal(summary.deckIds[summary.learnerSeat],p.deck.id);
      assert.equal(summary.deckIds[1-summary.learnerSeat],tp.opponents[Math.floor(index/4)].deckId);
      trajectories.push(g.trajectories[0]);artifacts.push({path:file,sha256:sha(file)});
    }
    const file=path.join(it,'candidate.json.gz');let finished=null;
    if(exists(file)&&files.length===28){
      assert.equal(files.length,28);const final=await read(file);assert.equal(final.planHash,digest(tp));
      const admission=partitionTrainingTrajectories(trajectories,held,ACTION_DIM);
      expected.bank.training.forEach(s=>admission.used.add(inputKey(s)));
      const keys=await read(path.join(it,'trained-input-keys.json.gz'));
      assert.deepEqual(keys.keys,[...admission.used].sort());assert.deepEqual(final.excluded,admission.excluded);
      assert.equal(final.trainingGames,admission.eligible.length);assert.ok(keys.keys.every(k=>!held.has(k)));
      const checkpoint=deserialize(unwrap(final));try{assert.equal(neuralBehaviorHash(checkpoint),final.afterBehaviorHash);}finally{dispose(checkpoint);}
      assert.equal(final.finalGuard.passed,true);
      const acceptedEpochs=final.epochGuards.filter(g=>g.passed).length;
      if(!acceptedEpochs)assert.equal(final.beforeBehaviorHash,final.afterBehaviorHash);
      for(const b of final.batchReports.filter(b=>b.accepted)){
        assert.ok(b.after.policyObjective<b.before.policyObjective-1e-7);
        assert.ok(b.after.rehearsalLoss<=b.before.rehearsalLoss+1e-7);
        assert.equal(b.heldOutInputsUsed,false);assert.equal(b.optimizerRestored,true);
      }
      source={path:file,sha256:sha(file),behaviorHash:final.afterBehaviorHash,generation:final.checkpoint.generation};
      finished={acceptedEpochs,changed:final.beforeBehaviorHash!==final.afterBehaviorHash,admitted:final.trainingGames,candidate:source};
    }
    iterations.push({iteration,games:files.length,artifacts,finished});
    if(!finished)break;
  }
  for(const phase of ['screen','confirmation'])for(const j of evaluationJobs(plan.evaluationConfig,p,c.iterations,phase,c.opponents))
    assert.equal(ledger[j.seed],`evaluation:${p.id}:${c.iterations}:${phase}`);
  profiles.push({id:p.id,records,addedLessons:expected.bank.training.length-frozen.bank.training.length,iterations});
}
const all=await listNodeProcesses(),selected=selectTrainingProcesses(all,c.projectDirectory);
const processes=[...new Map([...selected,...all.filter(p=>/constrained-deck-study/.test(p.commandLine||''))].map(p=>[p.pid,p])).values()];
const priority=processes.map(p=>({pid:p.pid,priority:os.getPriority(p.pid)}));
assert.ok(processes.length<=16);assert.ok(priority.every(p=>p.priority===os.constants.priority.PRIORITY_NORMAL));
const controller=json(path.join(root,'controller.json'));
const report={at:new Date().toISOString(),configHash:digest(c),passed:true,executionHealthy:controller.stage!=='failed',controller,
  nativeBackend:tfBackend,protectedInputs:held.size,initialTrainedInputs:seen.size,reservedSeeds:Object.keys(ledger).length,
  profiles,processes:priority,liveLeagueController:json(path.join(path.dirname(c.sourceConfig.path),'controller.json')),
  evaluationStrengthNotYetEstablished:true,servingEnabled:false};
atomic(path.join(root,'audit.json'),report);
console.log(JSON.stringify({...report,profiles:profiles.map(p=>({...p,iterations:p.iterations.map(i=>({...i,artifacts:undefined}))}))}));
