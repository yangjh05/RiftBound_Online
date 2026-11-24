import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {evaluationStep,freezeEvaluation} from '../scripts/deck-league-evaluation.mjs';
import {digest,inputKey,MATCH_INDEPENDENCE} from '../scripts/deck-league-contract.mjs';
import {sha,json} from '../scripts/deck-league-io.mjs';

for(const prospective of [false,true])test(`saved/resumed evaluation preserves its committed role protocol (prospective=${prospective})`,async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'deck-league-eval-'));
 try{
  const ref=name=>{const file=path.join(directory,name+'.json');fs.writeFileSync(file,JSON.stringify({name}));return {path:file,sha256:sha(file)};};
  const candidate=ref('candidate'),incumbent=ref('incumbent');
  const profiles=Array.from({length:7},(_,i)=>({id:'deck-'+i,deck:{id:'own-'+i}}));
  const opponents=profiles.map(p=>({...ref(p.id),profileId:p.id,deckId:p.deck.id}));
  const config={directory,seed:15,profiles,evaluationReview:{tag:'fixed'},evaluation:{everyIterations:4,screenBlocks:2,confirmationBlocks:16,alpha:.05,maximumMatchupRegression:.1,minimumMeanImprovement:.02}};
  const protocolFile=path.join(directory,'match-protocol.json');
  fs.writeFileSync(protocolFile,JSON.stringify({contract:MATCH_INDEPENDENCE,configHash:digest(config),afterIterations:{'deck-0':3},
   unit:'fresh-seed-blocks-and-frozen-models',stateOverlap:'diagnostic-only',evaluationDataTraining:false,
   existingProtectedInputsPreserved:true,correctionCriteriaUnchanged:true,criteria:config.evaluation}));
  const protocol={path:protocolFile,sha256:sha(protocolFile)};
  assert.throws(()=>freezeEvaluation(config,profiles[0],3,candidate,incumbent,opponents,protocol),/prospective/);
  const pending=freezeEvaluation(config,profiles[0],4,candidate,incumbent,opponents,prospective?protocol:null);
  const oldKey=inputKey({steps:[{state:[42],actions:[1,2],legalCount:2}]});
  let protectedInputs=new Set(['original-held']),trainedInputs=new Set([oldKey]),snapshot,calls=0;
  const load=async file=>{
   if(file.endsWith('model.mjs'))return {deserializeNeuralModel:x=>x,disposeNeuralModel:()=>{}};
   if(file.endsWith('archive.mjs'))return {readTrajectoryArchive:async file=>json(file)};
   if(file.endsWith('encoding.mjs'))return {ACTION_DIM:1};
   if(file.endsWith('evaluation-decision-review.mjs'))return {evaluationReviewOptions:()=>({}),evaluationReviewHash:digest};
   if(file.endsWith('selfplay.mjs'))return {evaluateNeuralModels:(a,b,decks,o)=>{
    calls++;const summaries=[...o.resumedSummaries];
    for(let i=summaries.length;i<4;i++){
     o.onEncodedDecision({stateEncoding:[42],actionEncoding:[1,2,0,0],legalCount:2});
     o.onEncodedDecision({stateEncoding:[o.seed],actionEncoding:[3,4,0,0],legalCount:2});
     const summary={candidateSeat:i%2,firstPlayerId:i<2?'p1':'p2',gameSeed:o.seed,evaluationMode:o.evaluationMode,
      deckIds:i%2?[o.opponentDeckId,o.subjectDeckId]:[o.subjectDeckId,o.opponentDeckId],decisionReviewHash:digest(config.evaluationReview),completed:true,
      winnerId:`p${a.name==='candidate'?i%2+1:2-i%2}`};
     summaries.push(summary);o.onGameComplete({game:i+1,summary});
    }return {summaries};
   }};
   throw new Error(file);
  };
  const run=()=>evaluationStep({config,pending,load,protectedInputs,trainedInputs,
   saveProtection:async()=>{snapshot={protected:[...protectedInputs],trained:[...trainedInputs]};},status:()=>{}});
  let result=await run();assert.equal(result.done,false);assert.equal(result.completed,8);assert.equal(calls,2);
  const firstFile=path.join(pending.directory,'screen','0-0-candidate.json'),firstHash=sha(firstFile);
  // Simulate a fresh process loading its durable role sets and partial phase.
  if(prospective)assert.equal(snapshot,undefined,'Independent evaluations must not rewrite the training ledger');
  else {protectedInputs=new Set(snapshot.protected);trainedInputs=new Set(snapshot.trained);}
  for(let visits=1;!result.done&&!result.nextPhase;visits++){assert.ok(visits<20);result=await run();}
  assert.equal(calls,28);assert.equal(sha(firstFile),firstHash);assert.equal(result.result.completedGames,112);
  assert.equal(result.result.mean,1);assert.equal(result.result.overlapCount,1);
  assert.equal(result.result.promoted,false);
  if(prospective){assert.equal(result.result.eligible,true);assert.equal(result.nextPhase,'confirmation');assert.equal(protectedInputs.size,1);
   assert.equal(result.result.stateGeneralizationEstablished,false);assert.equal(json(firstFile).dataRole,'evaluation-only');}
  else {assert.equal(result.result.reason,'training-input-overlap');assert.equal(result.result.eligible,false);assert.ok(protectedInputs.size>1);}
  assert.equal(protectedInputs.has(oldKey),false);assert.ok(protectedInputs.has('original-held'));
  const completed=await run();assert.deepEqual(completed,result);assert.equal(calls,28);
  if(prospective){
   pending.phase='confirmation';let confirm;
   for(let visits=0;!confirm?.done;visits++){assert.ok(visits<120);confirm=await run();}
   assert.equal(confirm.result.completedGames,896);assert.equal(confirm.result.promoted,true);
   assert.equal(confirm.result.matchEvidenceEligible,true);assert.equal(confirm.result.overlapCount,1);
   assert.equal(protectedInputs.size,1);assert.equal(sha(firstFile),firstHash);
   const screen=json(path.join(pending.directory,'screen/plan.json')),confirmation=json(path.join(pending.directory,'confirmation/plan.json'));
   const oldSeeds=new Set(screen.jobs.map(j=>j.seed));assert.ok(confirmation.jobs.every(j=>!oldSeeds.has(j.seed)));
  }
  fs.writeFileSync(candidate.path,'tampered');await assert.rejects(run,/Artifact changed/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
