import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {gunzipSync} from 'node:zlib';
import {json,atomic,verifyArtifact} from './deck-league-io.mjs';
import {evaluationJobs,assertEvaluationRows,digest} from './deck-league-contract.mjs';
const audit=path.resolve('data/ai/training-repair-20261013'),targets=json(path.join(audit,'verification-targets.json'));
const config=json(path.join(targets.mainDirectory,'config.json'));
const pointer=json(path.join(targets.mainDirectory,'execution-active.json'));
const repair=json(path.join(targets.mainDirectory,pointer.directory,'repair.json'));
const oldSeeds=json(path.join(audit,'deck-league-20261007/sealed-before/seed-ledger.json'));
let completeBlocks=0,partialGames=0;
const details=[];
for(const requestRef of targets.mainRequests){
 const request=json(verifyArtifact(requestRef)),evaluation=json(verifyArtifact(request.config));
 // Keep historical training provenance separate from the current evaluation
 // environment. Two frozen targets are explicitly older-engine weight models;
 // reevaluating their weights must never relabel their old trajectories.
 const candidate=JSON.parse(gunzipSync(fs.readFileSync(verifyArtifact(request.pending.candidate))));
 const trainingPlan=json(path.join(path.dirname(request.pending.candidate.path),'plan.json'));
 assert.equal(candidate.planHash,digest(trainingPlan));
 const historicalRuntime=candidate.trainingRuntime||trainingPlan.trainingRuntime;
 verifyArtifact(historicalRuntime.manifest);
 const historicalFingerprint=candidate.checkpoint.metadata.engineFingerprint;
 assert.deepEqual(request.runtime,repair.evaluationLane.runtime);
 assert.deepEqual(evaluation.evaluation,config.evaluation);
 assert.deepEqual(evaluation.evaluationReview,config.evaluationReview);assert.equal(evaluation.engineFingerprint,repair.trainingRuntime.engineFingerprint);
 const profile=config.profiles.find(p=>p.id===request.pending.profileId),seeds=new Set();
 for(const phase of ['screen','confirmation']){
  const jobs=evaluationJobs(evaluation,profile,request.pending.iteration,phase,request.pending.opponents);
  for(const job of jobs){assert.equal(oldSeeds[job.seed],undefined,'A corrected environment reused an old evaluation or training seed');seeds.add(job.seed);}
  const dir=path.join(request.pending.directory,phase),planFile=path.join(dir,'plan.json');if(!fs.existsSync(planFile))continue;
  const plan=json(planFile);assert.deepEqual(plan.evaluationRuntime,request.runtime);assert.deepEqual(plan.jobs,jobs);
  for(const job of jobs){const file=path.join(dir,job.id+'.json');if(!fs.existsSync(file))continue;
   const record=json(file);assert.equal(record.bindingHash,digest(plan));
   if(record.rows.length===4){assertEvaluationRows(record.rows,job,digest(config.evaluationReview));completeBlocks++;}else partialGames+=record.rows.length;
  }
 }
 details.push({profileId:profile.id,iteration:request.pending.iteration,freshSeedBlocks:seeds.size,
  historicalTrainingFingerprint:historicalFingerprint,evaluationFingerprint:request.runtime.engineFingerprint,
  historicalTrainingEngineMatchesEvaluation:historicalFingerprint===request.runtime.engineFingerprint});
}
const report={at:new Date().toISOString(),passed:true,criteriaAndReviewUnchanged:true,evaluationMatchesTrainingRuntime:true,
 noPreviouslyReservedSeedReuse:true,completeBlocksChecked:completeBlocks,partialGamesPresent:partialGames,requests:details};
atomic(path.join(audit,'evaluation-binding-verification.json'),report);console.log(JSON.stringify(report));
