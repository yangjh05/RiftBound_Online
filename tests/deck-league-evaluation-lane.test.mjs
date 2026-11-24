import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {registerLeagueEvaluation,assertLaneResult} from '../scripts/deck-league-evaluation-lane.mjs';
import {digest,MATCH_INDEPENDENCE,evaluationJobs,evaluationDecision} from '../scripts/deck-league-contract.mjs';
import {atomic,sha,json} from '../scripts/deck-league-io.mjs';
import {selectTrainingProcesses} from '../server/training-dashboard-priority.mjs';
test('independent evaluator has frozen engines, unchanged criteria and both phase seeds reserved by the controller',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'league-lane-'));
 try{
  const ref=(name,value)=>{const file=path.join(directory,name+'.json');atomic(file,value);return {path:file,sha256:sha(file)};};
  const profiles=Array.from({length:7},(_,i)=>({id:'deck-'+i,deck:{id:'own-'+i}}));
  const config={directory,profiles,seed:1,protectedSeeds:[],evaluationReview:{fixed:48},evaluation:{screenBlocks:2,confirmationBlocks:16,alpha:.05,minimumMeanImprovement:.02,maximumMatchupRegression:.1}};
  const corrected={...config,seed:2},runtime={directory:'pinned',engineFingerprint:'new',manifest:ref('manifest',[])};
  const protocol=ref('protocol',{contract:MATCH_INDEPENDENCE,configHash:digest(corrected),afterIterations:{'deck-0':0},
   unit:'fresh-seed-blocks-and-frozen-models',stateOverlap:'diagnostic-only',evaluationDataTraining:false,
   existingProtectedInputsPreserved:true,correctionCriteriaUnchanged:true,criteria:config.evaluation});
  const lane={directory:path.join(directory,'lane'),config:ref('config',corrected),runtime,workers:3,diagnosticInputs:ref('inputs',{})};
  const opponents=profiles.map(p=>({...ref(p.id,{}),profileId:p.id,deckId:p.deck.id}));
  const pending={profileId:'deck-0',iteration:4,phase:'screen',directory:path.join(directory,'evaluation'),candidate:opponents[0],incumbent:opponents[1],opponents,inputProtocol:protocol,evaluationRuntime:runtime};
  const request=registerLeagueEvaluation(config,pending,lane),ledger=json(path.join(directory,'seed-ledger.json'));
  for(const phase of ['screen','confirmation'])for(const job of evaluationJobs(corrected,profiles[0],4,phase,opponents))
   assert.equal(ledger[job.seed],`evaluation:deck-0:4:${phase}`);
  assert.deepEqual(registerLeagueEvaluation(config,pending,lane),request);
  const changed={...corrected,evaluation:{...corrected.evaluation,minimumMeanImprovement:0}};
  assert.throws(()=>registerLeagueEvaluation(config,pending,{...lane,config:ref('weakened',changed)}),/criteria changed/);
  const r=json(request.path),result={requestHash:digest(r),profileId:'deck-0',iteration:4,evaluationRuntime:runtime,final:{promoted:true,phase:'screen',gameFiles:[]}};
  assert.throws(()=>assertLaneResult(r,result));result.final.phase='confirmation';assert.throws(()=>assertLaneResult(r,result),/budget changed/);
  assert.throws(()=>assertLaneResult(r,{...result,evaluationRuntime:{...runtime,engineFingerprint:'old'}}));
  const jobs=evaluationJobs(corrected,profiles[0],4,'screen',opponents),binding={configHash:digest(corrected),evaluationRuntime:runtime,
   candidate:pending.candidate,incumbent:pending.incumbent,opponents,jobs,criteria:config.evaluation,review:config.evaluationReview};
  atomic(path.join(pending.directory,'screen','plan.json'),binding);
  const records=jobs.map(job=>({bindingHash:digest(binding),job,dataRole:'evaluation-only',protocolSha256:protocol.sha256,
   rows:Array.from({length:4},(_,i)=>({candidateSeat:i%2,firstPlayerId:i<2?'p1':'p2',gameSeed:job.seed,evaluationMode:'fixed-subject-deck-v1',
    deckIds:i%2?[job.opponentDeckId,job.subjectDeckId]:[job.subjectDeckId,job.opponentDeckId],decisionReviewHash:digest(config.evaluationReview),
    completed:true,winnerId:`p${job.subject==='candidate'?i%2+1:2-i%2}`}))}));
  const gameFiles=records.map(record=>{const f=path.join(pending.directory,'screen',record.job.id+'.json');atomic(f,record);return {path:f,sha256:sha(f)};});
  const full={...result,final:{...evaluationDecision(corrected,'screen',records),gameFiles,completedGames:112,matchEvidenceEligible:true}};
  assert.equal(assertLaneResult(r,full).eligible,true);
  assert.throws(()=>assertLaneResult(r,{...full,final:{...full.final,mean:0}}),/decision changed/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('capacity includes isolated study and evaluator processes without adopting unrelated Node applications',()=>{
 const root=path.resolve('example-checkout'),processes=['run-individual-deck-study','run-deck-league-evaluation','deck-league-evaluation-worker','train-deck-league']
  .map((name,i)=>({pid:i+1,parentPid:0,commandLine:`node "${root}/scripts/${name}.mjs"`}));
 processes.push({pid:9,parentPid:0,commandLine:`node "${root}/scripts/server.mjs"`},{pid:10,parentPid:0,commandLine:'node elsewhere/run-individual-deck-study.mjs'});
 assert.deepEqual(selectTrainingProcesses(processes,root).map(p=>p.pid),[1,2,3,4]);
});
