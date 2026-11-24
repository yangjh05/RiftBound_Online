import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import zlib from 'node:zlib';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';import {readLiveFileLockOwner} from './file-lock.mjs';
const root=path.resolve('data/ai/deck-league-20261007'),out=path.resolve('data/ai/resource-timing-20261014-r3');
const activation=json(path.join(out,'activation.json')),pointer=json(path.join(root,'execution-active.json'));
assert.deepEqual(pointer,activation.pointer);assert.ok(!fs.existsSync(path.join(root,'stop.request.json')));
const controller=json(path.join(root,'controller.json')),lock=await readLiveFileLockOwner(path.join(root,'controller.lock'));
assert.equal(lock?.pid,controller.pid);assert.ok(['collecting','training','training-batch','iteration-saved'].includes(controller.stage));
const repair=json(verifyArtifact({path:path.join(root,pointer.directory,'repair.json'),sha256:pointer.repairSha256}));
assert.deepEqual(repair.trainingRuntime,activation.trainingRuntime);
const directory=path.join(root,'profiles',controller.profileId,'iterations',String(controller.iteration).padStart(6,'0'));
const planFile=path.join(directory,'plan.json'),plan=json(planFile);assert.deepEqual(plan.trainingRuntime,repair.trainingRuntime);
assert.equal(plan.resourceCollection.maximumReviewsPerGame,2);
const saved=[];
for(const file of fs.readdirSync(path.join(directory,'games')).filter(f=>f.endsWith('.json.gz'))){
  const f=path.join(directory,'games',file),g=JSON.parse(zlib.gunzipSync(fs.readFileSync(f))),capture=g.verifiedTrainingLessons;
  assert.equal(capture?.teacherContract,'local-resource-with-deployment-v2');assert.equal(capture.teacherCriteriaUnchanged,false);
  assert.equal(capture.policyActionsModified,false);assert.equal(capture.extraGames,0);
  assert.ok(g.trajectories.every(t=>t.engineFingerprint===repair.trainingRuntime.engineFingerprint));
  saved.push({path:f,sha256:sha(f),diagnostics:capture.diagnostics});
}
const evaluator=json(path.join(root,'evaluation-r6/controller.json'));process.kill(evaluator.pid,0);
const record={at:new Date().toISOString(),pointer,controller,plan:{path:planFile,sha256:sha(planFile)},
  trainingProcessLive:true,newTeacherLoadedByCommittedPlan:true,savedGames:saved,
  evaluator:{pid:evaluator.pid,stage:evaluator.stage,interrupted:false,runtimeUnchanged:true},
  liveWeightImprovementVerified:false,servingModelPromotionClaim:false};
atomic(path.join(out,'live-verification.json'),record);
console.log(JSON.stringify({live:true,profileId:controller.profileId,iteration:controller.iteration,savedGames:saved.length,
  teacherContract:'local-resource-with-deployment-v2',evaluatorPid:evaluator.pid}));
