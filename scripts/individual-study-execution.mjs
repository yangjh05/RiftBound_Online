import path from 'node:path';import assert from 'node:assert/strict';
import {json,exists,verifyArtifact} from './deck-league-io.mjs';
export function readIndividualExecution(root){
  const pointer=path.join(root,'execution-active.json');
  const execution=json(exists(pointer)?verifyArtifact(json(pointer)):path.join(root,'execution.json'));
  if(execution.repair){
    const repair=json(verifyArtifact(execution.repair));
    assert.ok(['local-resource-teacher-routing-repair-v1','local-resource-teacher-routing-quarantine-v2'].includes(repair.contract));
    assert.equal(repair.configHash,execution.configHash);
    [...repair.frozen,repair.unchangedTeacher,...repair.originalRecords,repair.priorAudit,repair.previousPreflight].forEach(verifyArtifact);
  }
  return execution;
}
export function collectionRecordPath(root,profileId,job,execution){
  const corrected=job.target==='resource'&&Boolean(execution.repair);
  return path.join(root,'profiles',profileId,corrected?'lessons-resource-r3':'lessons',job.id+'.json.gz');
}
export function assertResourceReplay(original,replacement){
  assert.equal(original.job.target,'resource');assert.equal(original.failure,null);assert.equal(original.samples.length,0);
  assert.equal(replacement.failure,null);assert.equal(replacement.resourceTeacherContract,'existing-local-resource-demonstration-v1');
  assert.equal(replacement.configHash,original.configHash);assert.deepEqual(replacement.job,original.job);
  assert.deepEqual(replacement.summary,original.summary,'Teacher repair changed the played game');
  assert.deepEqual(replacement.inputKeys,original.inputKeys,'Teacher repair changed the policy observations');
  return {summaryIdentical:true,inputKeysIdentical:true,noNewSeeds:true};
}
export function quarantinedResourceReference(repair,job){
  const item=repair?.quarantinedResourceJobs?.find(q=>q.jobId===job.id);
  if(!item)return null;
  assert.equal(repair.contract,'local-resource-teacher-routing-quarantine-v2');
  assert.equal(job.target,'resource');assert.equal(item.profileId,job.profileId);
  return item.original;
}
export function assertQuarantinedResource(record,job,configHash){
  assert.deepEqual(record.job,job);assert.equal(record.job.target,'resource');
  assert.equal(record.configHash,configHash);assert.equal(record.failure,null);assert.equal(record.samples.length,0);
  assert.equal(record.summary.completed,true);
}
