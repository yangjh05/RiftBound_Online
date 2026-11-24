import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {json,sha,atomic,immutable} from './deck-league-io.mjs';import {digest} from './deck-league-contract.mjs';
import {readLiveFileLockOwner} from './file-lock.mjs';
const root=path.resolve('data/ai/deck-league-20261007'),audit=path.resolve('data/ai/training-repair-20261013');
const [mode='prepare']=process.argv.slice(2),dir=path.join(root,'execution-r7-fair-evaluation');
if(mode==='prepare'){
 const pointer=json(path.join(root,'execution-active.json')),oldFile=path.join(root,pointer.directory,'repair.json'),old=json(oldFile);
 assert.ok(!fs.existsSync(path.join(dir,'repair.json')));fs.mkdirSync(dir,{recursive:true});
 const names=[...Object.keys(old.executionFiles),'deck-league-evaluation-dispatch.mjs'];
 for(const name of names)fs.copyFileSync(path.resolve('scripts',name),path.join(dir,name));
 const ref=file=>({path:file,sha256:sha(file)});
 const repair={...old,executionFiles:Object.fromEntries(names.map(name=>[name,sha(path.join(dir,name))])),previousRepair:ref(oldFile),
  reason:'Fair fixed-budget evaluation visits, isolated request failures, matching engine and unchanged criteria',
  fairDispatch:{maximumJobsPerVisit:8,order:'least-recently-dispatched',performanceIndependent:true,tests:ref(path.join(audit,'fair-evaluation-tests.log'))}};
 immutable(path.join(dir,'repair.json'),repair);immutable(path.join(dir,'evaluation-lane.json'),old.evaluationLane);
 immutable(path.join(audit,'fair-evaluation-prepared.json'),{previousPointer:pointer,pointer:{directory:path.basename(dir),repairSha256:sha(path.join(dir,'repair.json')),executionHash:digest(repair.executionFiles)}});
 const stop=path.join(root,'stop.request.json');assert.ok(!fs.existsSync(stop));atomic(stop,{at:new Date().toISOString(),reason:'User-authorized fair evaluation handoff',preserveArtifacts:true});
 console.log('Fair evaluator prepared; controller boundary stop requested');
}else{
 assert.equal(mode,'activate');assert.ok(!await readLiveFileLockOwner(path.join(root,'controller.lock')));
 const prepared=json(path.join(audit,'fair-evaluation-prepared.json'));assert.deepEqual(json(path.join(root,'execution-active.json')),prepared.previousPointer);
 const stop=path.join(root,'stop.request.json');assert.match(json(stop).reason,/User-authorized fair evaluation/);
 atomic(path.join(root,'execution-active.json'),prepared.pointer);fs.renameSync(stop,path.join(audit,'completed-fair-evaluation-stop.json'));
 const lane=json(path.join(dir,'evaluation-lane.json')),status=json(path.join(lane.directory,'controller.json'));
 if(status.profileId){const file=`${status.profileId}-${String(status.iteration).padStart(6,'0')}.request.json`;
  atomic(path.join(lane.directory,'dispatch-journal.json'),{[file]:Date.now()});}
 immutable(path.join(audit,'fair-evaluation-activation.json'),{at:new Date().toISOString(),pointer:prepared.pointer,
  previousEvaluationController:status,completedRecordsPreserved:true,criteriaUnchanged:true});
 console.log('Fair evaluator activated');
}
