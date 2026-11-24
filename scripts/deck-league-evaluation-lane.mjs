import assert from 'node:assert/strict';
import path from 'node:path';
import {digest,evaluationJobs,evaluationDecision,assertEvaluationRows,validateMatchProtocol} from './deck-league-contract.mjs';
import {json,sha,immutable,verifyArtifact,reserveSeeds} from './deck-league-io.mjs';

export function registerLeagueEvaluation(config,pending,lane){
  const evaluationConfig=json(verifyArtifact(lane.config));
  assert.deepEqual(evaluationConfig.evaluation,config.evaluation,'Promotion criteria changed');
  assert.deepEqual(evaluationConfig.profiles,config.profiles,'Evaluation decks changed');
  assert.deepEqual(evaluationConfig.evaluationReview,config.evaluationReview,'Review budget changed');
  assert.equal(evaluationConfig.directory,config.directory);
  assert.deepEqual(pending.evaluationRuntime,lane.runtime);
  validateMatchProtocol(json(verifyArtifact(pending.inputProtocol)),evaluationConfig,pending.profileId,pending.iteration);
  const profile=config.profiles.find(p=>p.id===pending.profileId);
  // Only the training controller owns the seed ledger. Both phases are fixed
  // before dispatch; the independent evaluator can only consume reservations.
  for(const phase of ['screen','confirmation']){
    const jobs=evaluationJobs(evaluationConfig,profile,pending.iteration,phase,pending.opponents);
    reserveSeeds(config.directory,`evaluation:${profile.id}:${pending.iteration}:${phase}`,jobs.map(j=>j.seed),config.protectedSeeds);
  }
  const request={contract:'frozen-deck-league-evaluation-request-v1',config:lane.config,
    pending:{...pending,phase:'screen'},runtime:lane.runtime,diagnosticInputs:lane.diagnosticInputs,workers:lane.workers};
  const file=path.join(lane.directory,'requests',`${profile.id}-${String(pending.iteration).padStart(6,'0')}.request.json`);
  immutable(file,request);
  return {path:file,sha256:sha(file),requestHash:digest(request)};
}

export function assertLaneResult(request,result){
  assert.equal(result.requestHash,digest(request));
  assert.deepEqual(result.evaluationRuntime,request.runtime);
  assert.equal(result.profileId,request.pending.profileId);
  assert.equal(result.iteration,request.pending.iteration);
  assert.ok(result.final);
  // A worker is not authorized to promote a screened-only candidate.
  assert.ok(!result.final.promoted||result.final.phase==='confirmation');
  const config=json(verifyArtifact(request.config)),profile=config.profiles.find(p=>p.id===request.pending.profileId);
  validateMatchProtocol(json(verifyArtifact(request.pending.inputProtocol)),config,profile.id,request.pending.iteration);
  const jobs=evaluationJobs(config,profile,request.pending.iteration,result.final.phase,request.pending.opponents);
  assert.equal(result.final.gameFiles.length,jobs.length,'Evaluation budget changed');
  const binding=json(path.join(request.pending.directory,result.final.phase,'plan.json'));
  assert.equal(binding.configHash,digest(config));assert.deepEqual(binding.evaluationRuntime,request.runtime);
  assert.deepEqual(binding.candidate,request.pending.candidate);assert.deepEqual(binding.incumbent,request.pending.incumbent);
  assert.deepEqual(binding.opponents,request.pending.opponents);assert.deepEqual(binding.jobs,jobs);
  assert.deepEqual(binding.criteria,config.evaluation);assert.deepEqual(binding.review,config.evaluationReview);
  const records=result.final.gameFiles.map((ref,i)=>{
    assert.equal(path.resolve(ref.path),path.resolve(request.pending.directory,result.final.phase,jobs[i].id+'.json'));
    const record=json(verifyArtifact(ref));assert.deepEqual(record.job,jobs[i]);
    assert.equal(record.bindingHash,digest(binding));
    assert.equal(record.protocolSha256,request.pending.inputProtocol.sha256);assert.equal(record.dataRole,'evaluation-only');
    assertEvaluationRows(record.rows,jobs[i],config.evaluationReview?digest(config.evaluationReview):null);
    return record;
  });
  const expected=evaluationDecision(config,result.final.phase,records);
  for(const [key,value]of Object.entries(expected))assert.deepEqual(result.final[key],value,`Worker evaluation decision changed: ${key}`);
  assert.equal(result.final.completedGames,jobs.length*4);
  assert.equal(result.final.matchEvidenceEligible,true);
  return result.final;
}
