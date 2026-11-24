import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {json,sha,atomic,verifyArtifact,exists} from './deck-league-io.mjs';
import {digest,unwrap,evaluationJobs,assertEvaluationRows,evaluationDecision,validateMatchProtocol,evaluationOverlapDecision,assertLessonAugmentation} from './deck-league-contract.mjs';
import {listNodeProcesses,selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';

export async function inspectLeague(directory){
 const root=path.resolve(directory),c=json(path.join(root,'config.json')),state=json(path.join(root,'state.json'));
 assert.equal(state.configHash,digest(c));verifyArtifact(c.runtimeManifest);
 for(const f of json(c.runtimeManifest.path))assert.equal(sha(path.join(c.runtimeDirectory,f.path)),f.sha256,f.path);
 for(const [f,h] of Object.entries(c.executionFiles))assert.equal(sha(path.join(root,'execution',f)),h,f);
 let activeRepair=null;
 if(exists(path.join(root,'execution-active.json'))){
  const execution=path.resolve(root,json(path.join(root,'execution-active.json')).directory);
  assert.ok(execution.startsWith(root+path.sep));const repair=json(path.join(execution,'repair.json'));assert.equal(repair.configHash,digest(c));
  activeRepair=repair;
  assert.equal(sha(path.join(execution,'repair.json')),json(path.join(root,'execution-active.json')).repairSha256);
  for(const [f,h]of Object.entries(repair.executionFiles))assert.equal(sha(path.join(execution,f)),h,f);
  if(repair.trainingRuntime){verifyArtifact(repair.trainingRuntime.manifest);for(const f of json(repair.trainingRuntime.manifest.path))assert.equal(sha(path.join(repair.trainingRuntime.directory,f.path)),f.sha256,f.path);}
 }
 const load=f=>import(pathToFileURL(path.join(c.runtimeDirectory,f)));
 const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
 const {assertAdaptiveGame,assertAdaptiveCheckpoint}=await load('scripts/adaptive-policy-q-evidence.mjs');
 const protection=await read(path.join(root,'input-protection-live.json.gz')),held=new Set(protection.protected),trained=new Set(protection.trained);
 const original=await read(verifyArtifact(c.inputProtection));
 assert.ok(original.protected.every(k=>held.has(k)),'An original holdout disappeared.');
 assert.ok(original.trained.every(k=>trained.has(k)),'An original training input disappeared.');
 assert.ok([...held].every(k=>!trained.has(k)),'Input roles conflict.');
 const {evaluationReviewHash}=await load('scripts/evaluation-decision-review.mjs');
 const evaluations=[];
 const profiles=[];
 for(const p of c.profiles){
  verifyArtifact(p.initial);verifyArtifact(p.lessons);
  const s=state.profiles[p.id],originalBank=await read(p.lessons.path),addition=activeRepair?.lessonAdditions?.[p.id];
  const bank=addition?await read(verifyArtifact(addition.augmented)):originalBank,iterations=[];
  if(addition){verifyArtifact(addition.audit);assert.equal(assertLessonAugmentation(originalBank,bank,p.deck.id,held),json(addition.audit.path).acceptedTraining);}
  assert.ok([...bank.bank.training,...bank.bank.validation].every(x=>x.deckId===p.deck.id));
  for(const model of [s.learner,s.champion])assertAdaptiveCheckpoint(unwrap(await read(verifyArtifact(model))));
  const dir=path.join(root,'profiles',p.id,'iterations');
  if(exists(dir))for(const name of fs.readdirSync(dir)){
   const iterationDir=path.join(dir,name),plan=json(path.join(iterationDir,'plan.json'));
   assert.equal(plan.profileId,p.id);assert.equal(plan.configHash,digest(c));const ownRoles={},opponents={};let games=0,actions=0;
   if(plan.trainingLessons)verifyArtifact(plan.trainingLessons);
   const gameDir=path.join(iterationDir,'games');
   for(const f of exists(gameDir)?fs.readdirSync(gameDir).filter(f=>/^\d+\.json\.gz$/.test(f)):[]){
    const index=Number(f.split('.')[0]),g=await read(path.join(gameDir,f)),t=g.trajectories?.[0],summary=g.summaries?.[0]||g.summary;
    assertAdaptiveGame(g,plan,index);assert.equal(t.deckId,p.deck.id);assert.equal(summary.deckIds[summary.learnerSeat],p.deck.id);
    assert.equal(summary.firstPlayerId,Math.floor(index/2)%2?'p2':'p1');
    assert.equal(summary.gameSeed,(plan.seed+index*130363)>>>0);
    assert.equal(summary.deckIds[1-summary.learnerSeat],plan.opponents[Math.floor(index/4)].deckId);
    ownRoles[t.playerId]=(ownRoles[t.playerId]||0)+1;opponents[plan.opponents[Math.floor(index/4)].profileId]=(opponents[plan.opponents[Math.floor(index/4)].profileId]||0)+1;
    games++;actions+=t.steps.length;
   }
   const finalFile=path.join(iterationDir,'candidate.json.gz'),final=exists(finalFile)?await read(finalFile):null;
   if(final){assert.equal(games,28);assert.equal(final.planHash,digest(plan));assertAdaptiveCheckpoint(final.checkpoint);
    const admission=await read(path.join(iterationDir,'trained-input-keys.json.gz'));
    assert.equal(admission.planHash,digest(plan));assert.equal(admission.eligible,final.trainingGames);
    assert.deepEqual(admission.excluded,final.excluded);assert.equal(final.trainingGames+final.excluded.length,28);
    if(final.skippedReason){assert.equal(final.skippedReason,'all-trajectories-overlap-protected-inputs');
     assert.equal(final.trainingGames,0);assert.equal(admission.keys.length,0);assert.equal(final.epochGuards.length,0);
     assert.equal(final.beforeBehaviorHash,final.afterBehaviorHash);
     const source=await read(verifyArtifact({path:plan.sourcePath,sha256:plan.sourceSha256}));
     assert.deepEqual(final.checkpoint,unwrap(source));assert.deepEqual(final.optimizerState,source.optimizerState);
    }
   }
   iterations.push({iteration:Number(name),games,actions,ownRoles,opponents,saved:!!final,
     changed:final?final.beforeBehaviorHash!==final.afterBehaviorHash:null,acceptedEpochs:final?.epochGuards.filter(g=>g.passed).length??null,
     trainingGames:final?.trainingGames??null,excluded:final?.excluded.length??null,skippedReason:final?.skippedReason||null});
  }
  profiles.push({id:p.id,iteration:s.iteration,games:s.games,changedIterations:s.changedIterations,acceptedEpochs:s.acceptedEpochs,
    initialSha256:p.initial.sha256,learnerSha256:s.learner.sha256,championSha256:s.champion.sha256,
    ownTrainingLessons:bank.bank.training.length,ownValidationLessons:bank.bank.validation.length,iterations});
  const evaluationRoot=path.join(root,'profiles',p.id,'evaluations');
  if(exists(evaluationRoot))for(const name of fs.readdirSync(evaluationRoot))for(const phase of ['screen','confirmation']){
   const dir=path.join(evaluationRoot,name,phase),planFile=path.join(dir,'plan.json');if(!exists(planFile))continue;
   const binding=json(planFile);assert.equal(binding.configHash,digest(c));assert.equal(binding.profileId,p.id);
   const protocol=binding.inputProtocol?validateMatchProtocol(json(verifyArtifact(binding.inputProtocol)),c,p.id,Number(name)):null;
   assert.equal(binding.iteration,Number(name));assert.equal(binding.phase,phase);
   assert.deepEqual(binding.criteria,c.evaluation);assert.deepEqual(binding.review,c.evaluationReview);
   [binding.candidate,binding.incumbent,...binding.opponents].forEach(verifyArtifact);
   const jobs=evaluationJobs(c,p,Number(name),phase,binding.opponents);assert.deepEqual(binding.jobs,jobs);
   const records=[],gameFiles=[];let partialGames=0;
   for(const job of jobs){const file=path.join(dir,job.id+'.json');if(!exists(file))continue;
    const record=json(file);assert.equal(record.bindingHash,digest(binding));assert.deepEqual(record.job,job);
    if(protocol){assert.equal(record.dataRole,'evaluation-only');assert.equal(record.protocolSha256,binding.inputProtocol.sha256);}
    assert.ok(record.rows.length>0&&record.rows.length<=4);
    assert.ok(record.previouslyTrainedInputs.every(k=>record.inputKeys.includes(k)&&trained.has(k)));
    if(record.rows.length<4){partialGames+=record.rows.length;continue;}
    assertEvaluationRows(record.rows,job,evaluationReviewHash(c.evaluationReview));records.push(record);gameFiles.push({path:file,sha256:sha(file)});
   }
   const resultFile=path.join(dir,'result.json');let result=null;
   if(exists(resultFile)){
    assert.equal(records.length,jobs.length);const overlapCount=new Set(records.flatMap(r=>r.previouslyTrainedInputs)).size;
    const decision=evaluationOverlapDecision(evaluationDecision(c,phase,records),overlapCount,protocol);
    result=json(resultFile);assert.equal(result.bindingHash,digest(binding));assert.equal(result.completedGames,records.length*4);
    assert.equal(result.overlapCount,overlapCount);assert.deepEqual(result.gameFiles,gameFiles);
    for(const [key,value]of Object.entries(decision))assert.deepEqual(result[key],value,key);
   }
   evaluations.push({profileId:p.id,iteration:Number(name),phase,completedGames:records.length*4,partialGames,totalGames:jobs.length*4,
    overlapCount:new Set(records.flatMap(r=>r.previouslyTrainedInputs)).size,resultVerified:!!result,promoted:result?.promoted??null,
    bindingHash:digest(binding),gameFiles});
  }
 }
 const processes=selectTrainingProcesses(await listNodeProcesses(),c.projectDirectory).flatMap(p=>{try{return [{pid:p.pid,priority:os.getPriority(p.pid)}];}catch{return [];}});
 assert.ok(processes.length<=16);assert.ok(processes.every(p=>p.priority===os.constants.priority.PRIORITY_NORMAL));
 const report={at:new Date().toISOString(),configHash:digest(c),passed:true,controller:json(path.join(root,'controller.json')),profiles,
   inputRoles:{protected:held.size,trained:trained.size,disjoint:true,originalProtected:original.protected.length},evaluations,
   processes,processCount:processes.length,independentCheckpoints:new Set(c.profiles.map(p=>p.initial.path)).size,
   servingEnabled:json(path.join(c.projectDirectory,'data/ai/deck-league-active.json')).servingEnabled===true};
 atomic(path.join(root,'live-inspection.json'),report);return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=await inspectLeague(process.argv[2]||'data/ai/deck-league-20261007');
 console.log(JSON.stringify({...r,profiles:r.profiles.map(p=>({...p,iterations:p.iterations.slice(-1)}))}));
}
