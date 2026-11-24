import path from 'node:path';import assert from 'node:assert/strict';
import {json,atomic,verifyArtifact,exists} from './deck-league-io.mjs';
import {readLiveFileLockOwner,withFileLock} from './file-lock.mjs';
import {assertLaneResult} from './deck-league-evaluation-lane.mjs';
import {readIndividualExecution} from './individual-study-execution.mjs';
import {assertFixedChampionReferences} from './fixed-champion-reference.mjs';

// Consume only finished, independently computed fixed-budget results. No
// TensorFlow model, training step, seed reservation or game is created here.
const [directory='data/ai/deck-league-individual-20261011-r2']=process.argv.slice(2),root=path.resolve(directory);
const execution=readIndividualExecution(root),config=json(path.join(root,'config.json')),plan=json(verifyArtifact(execution.plan));
const candidates=exists(path.join(root,'replay-progress.json'))?json(path.join(root,'replay-progress.json')).candidates:[];
const completed=[];
for(const item of candidates){
 const file=path.join(root,'profiles',item.profileId,'result.json'),lock=path.join(root,'profiles',item.profileId,'evaluation.lock');
 if(exists(file)){assert.equal(json(file).candidate.sha256,item.candidate.sha256);continue;}
 const requestFile=path.join(execution.evaluationLane.directory,'requests',`${item.profileId}-000001.request.json`);
 const resultFile=requestFile.replace('.request.json','.result.json');
 if(!exists(resultFile)||await readLiveFileLockOwner(lock))continue;
 await withFileLock(lock,async()=>{
  if(exists(file)){assert.equal(json(file).candidate.sha256,item.candidate.sha256);return;}
  const profile=config.profiles.find(p=>p.id===item.profileId);assert.ok(profile);assert.ok(item.changed&&item.acceptedEpochs>0&&item.finalGuard.passed);
  verifyArtifact(item.candidate);const request=json(requestFile);
  assert.deepEqual(request.pending.candidate,item.candidate);assert.deepEqual(request.runtime,execution.evaluationLane.runtime);
  assert.deepEqual(request.config,execution.evaluationLane.config);assert.equal(request.pending.profileId,profile.id);assert.equal(request.pending.iteration,1);
  assertFixedChampionReferences(plan.evaluationConfig,profile,request.pending.incumbent,request.pending.opponents);
  [request.pending.incumbent,...request.pending.opponents].forEach(verifyArtifact);
  const evaluation=assertLaneResult(request,json(resultFile));
  atomic(file,{...item,evaluation,appliedToLeague:false,servingEnabled:false});
  completed.push({profileId:item.profileId,phase:evaluation.phase,games:evaluation.completedGames,promoted:evaluation.promoted,
   mean:evaluation.mean,lower:evaluation.lower,upper:evaluation.upper});
 },{timeoutMs:1000});
}
console.log(JSON.stringify({at:new Date().toISOString(),completed}));
