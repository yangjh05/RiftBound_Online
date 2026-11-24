import assert from 'node:assert/strict';
import path from 'node:path';
import {digest,unwrap,evaluationJobs,assertEvaluationRows,evaluationDecision,inputKey,isEvaluationChoice,protectEvaluationInputs,validateMatchProtocol,evaluationOverlapDecision,MATCH_INDEPENDENCE} from './deck-league-contract.mjs';
import {atomic,json,exists,verifyArtifact,sha,immutable,reserveSeeds} from './deck-league-io.mjs';

export function freezeEvaluation(config,profile,iteration,candidate,incumbent,opponents,inputProtocol=null){
  if(inputProtocol)validateMatchProtocol(json(verifyArtifact(inputProtocol)),config,profile.id,iteration);
  return {profileId:profile.id,iteration,candidate,incumbent,opponents,phase:'screen',
    ...(inputProtocol?{inputProtocol}:{}),
    directory:path.join(config.directory,'profiles',profile.id,'evaluations',String(iteration).padStart(6,'0'))};
}

// One fixed seed block per visit, interleaved with training other decks. Saved
// game summaries and model bindings are reusable after a controller restart.
export async function evaluationStep({config,pending,load,protectedInputs,trainedInputs,saveProtection,status,maximumNewJobs=2,precommittedSeeds=false}){
  const profile=config.profiles.find(p=>p.id===pending.profileId);
  const protocol=pending.inputProtocol?validateMatchProtocol(json(verifyArtifact(pending.inputProtocol)),config,profile.id,pending.iteration):null;
  const recordRole=protocol?{dataRole:'evaluation-only',inputRoleContract:MATCH_INDEPENDENCE,protocolSha256:pending.inputProtocol.sha256}:{};
  const protect=keys=>{if(!protocol)protectEvaluationInputs(keys,protectedInputs,trainedInputs);};
  [pending.candidate,pending.incumbent,...pending.opponents].forEach(verifyArtifact);
  const {deserializeNeuralModel:deserialize,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
  const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
  const {evaluateNeuralModels}=await load('src/ai/neural/selfplay.mjs');
  const {evaluationReviewOptions,evaluationReviewHash}=await load('scripts/evaluation-decision-review.mjs');
  const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
  const jobs=evaluationJobs(config,profile,pending.iteration,pending.phase,pending.opponents);
  const seedOwner=`evaluation:${profile.id}:${pending.iteration}:${pending.phase}`;
  if(precommittedSeeds){const ledger=json(path.join(config.directory,'seed-ledger.json'));
    for(const job of jobs)assert.equal(ledger[job.seed],seedOwner,'Evaluation seed was not precommitted');
  }else reserveSeeds(config.directory,seedOwner,jobs.map(j=>j.seed),config.protectedSeeds);
  const binding={configHash:digest(config),profileId:profile.id,iteration:pending.iteration,
    candidate:pending.candidate,incumbent:pending.incumbent,opponents:pending.opponents,phase:pending.phase,
    jobs,review:config.evaluationReview,criteria:config.evaluation,...(protocol?{inputProtocol:pending.inputProtocol}:{}),
    ...(pending.evaluationRuntime?{evaluationRuntime:pending.evaluationRuntime}: {})};
  const dir=path.join(pending.directory,pending.phase);immutable(path.join(dir,'plan.json'),binding);
  const bindingHash=digest(binding),reviewHash=evaluationReviewHash(config.evaluationReview);
  const records=[];let newlyComputed=0;
  for(const job of jobs){
    const file=path.join(dir,job.id+'.json');let record=exists(file)?json(file):null;
    if(record){assert.equal(record.bindingHash,bindingHash);assert.deepEqual(record.job,job);
      // Preserve the first role even when restoring pre-repair records. The
      // saved overlap evidence below still rejects contaminated evaluations.
      if(protocol){assert.equal(record.dataRole,'evaluation-only');assert.equal(record.protocolSha256,pending.inputProtocol.sha256);}
      protect(record.inputKeys||[]);
      if(record.rows.length===4){assertEvaluationRows(record.rows,job,reviewHash);records.push(record);continue;}}
    if(newlyComputed>=maximumNewJobs)return {done:false,phase:pending.phase,completed:records.length*4,total:jobs.length*4};
    const subject=pending[job.subject],opponent=job.opponent;
    const a=deserialize(unwrap(await read(verifyArtifact(subject)))),b=deserialize(unwrap(await read(verifyArtifact(opponent))));
    try{
      const rows=record?.rows||[],keys=new Set(record?.inputKeys||[]),overlaps=new Set(record?.previouslyTrainedInputs||[]);
      status('evaluation',{profileId:profile.id,phase:pending.phase,completed:records.length*4+rows.length,total:jobs.length*4});
      const result=evaluateNeuralModels(a,b,config.profiles.map(p=>p.deck),{
        games:4,seed:job.seed,evaluationMode:'fixed-subject-deck-v1',subjectDeckId:job.subjectDeckId,opponentDeckId:job.opponentDeckId,
        greedy:true,maxActions:2400,resumedSummaries:rows,...evaluationReviewOptions(config.evaluationReview),
        onEncodedDecision:selected=>{
          if(!isEvaluationChoice(selected))return;
          const key=inputKey({steps:[{state:selected.stateEncoding,actions:Array.from(selected.actionEncoding).slice(0,selected.legalCount*ACTION_DIM),legalCount:selected.legalCount}]});
          keys.add(key);if(trainedInputs.has(key))overlaps.add(key);
        },
        onGameComplete:({game,summary})=>{rows[game-1]=summary;
          atomic(file,{bindingHash,job,rows,inputKeys:[...keys],previouslyTrainedInputs:[...overlaps],...recordRole});}
      });
      assertEvaluationRows(result.summaries,job,reviewHash);
      record={bindingHash,job,rows:result.summaries,inputKeys:[...keys],previouslyTrainedInputs:[...overlaps],...recordRole};atomic(file,record);
      protect(keys);
      // Independent matches cannot acquire training roles. Do not rewrite the
      // multi-million-key training ledger after every evaluation block.
      if(!protocol)await saveProtection();records.push(record);newlyComputed++;
    }finally{dispose(a);dispose(b);}
  }
  const overlapCount=new Set(records.flatMap(r=>r.previouslyTrainedInputs)).size;
  // Old plans retain exact-state separation. New precommitted plans measure
  // independent matches, where recurring observations are not reused outcomes.
  const decision=evaluationOverlapDecision(evaluationDecision(config,pending.phase,records),overlapCount,protocol);
  const result={bindingHash,...decision,overlapCount,completedGames:records.length*4,
    inputRoleContract:protocol?MATCH_INDEPENDENCE:'public-policy-choices-more-than-one-legal-action-v1',
    ...(protocol?{protocolSha256:pending.inputProtocol.sha256,matchEvidenceEligible:true,stateGeneralizationEstablished:false}:{}),
    gameFiles:jobs.map(j=>({path:path.join(dir,j.id+'.json'),sha256:sha(path.join(dir,j.id+'.json'))})),at:new Date().toISOString()};
  const resultFile=path.join(dir,'result.json');
  if(exists(resultFile)){const old=json(resultFile);assert.deepEqual({...old,at:null},{...result,at:null});result.at=old.at;}
  immutable(resultFile,result);
  if(pending.phase==='screen'&&decision.eligible)return {done:false,nextPhase:'confirmation',result};
  return {done:true,result};
}
