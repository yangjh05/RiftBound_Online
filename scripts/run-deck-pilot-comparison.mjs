import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {COMPARISON_CONTRACT,comparisonHash,assertComparisonRecord,summarizeComparison,comparisonJobAssigned,specialistLessonReviewGate,releaseComparisonReservation} from './deck-pilot-comparison.mjs';

const [planFile, mode='report', shardText='0'] = process.argv.slice(2);
const plan=JSON.parse(fs.readFileSync(planFile,'utf8')), root=path.dirname(path.resolve(planFile));
assert.equal(plan.contract,COMPARISON_CONTRACT);
for(const [name,sha] of Object.entries(plan.executionFiles))
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),name))).digest('hex'),sha,
    'Frozen comparison runner changed');
const planHash=comparisonHash(plan), shard=Number(shardText);
const load=relative=>import(pathToFileURL(path.join(plan.runtimeDirectory,relative)).href);
const {renameWithRetrySync}=await load('scripts/file-replace.mjs');
const write=(file,value)=>{const tmp=`${file}.tmp-${process.pid}`;fs.writeFileSync(tmp,JSON.stringify(value,null,2));renameWithRetrySync(tmp,file);};
const readRecords=()=>plan.schedule.flatMap(job=>Array.from({length:8},(_,index)=>{
  const file=path.join(root,'games',`${job.id}-${index}.json`);
  return fs.existsSync(file)?assertComparisonRecord(JSON.parse(fs.readFileSync(file,'utf8')),plan,job,index):null;
}).filter(Boolean));
const report=()=>{
  const result=summarizeComparison(plan,readRecords());
  if(plan.lessonReview)result.lessonReview=specialistLessonReviewGate(result);
  write(path.join(root,'report.json'),result);
  return result;
};
if(mode==='report') {
  console.log(JSON.stringify(report()));
} else {
  assert.ok(['worker','serial','preflight'].includes(mode)); assert.ok([0,1].includes(shard));
  if(mode!=='preflight')comparisonJobAssigned(plan,mode,shard,0);
  const {withFileLock,readLiveFileLockOwner}=await load('scripts/file-lock.mjs');
  const workerName=mode==='serial'?'controller':`worker-${shard}`;
  const status=(stage,extra={})=>write(path.join(root,`${workerName}.json`),
    {planHash,pid:process.pid,shard,at:new Date().toISOString(),stage,...extra});
  await withFileLock(path.join(root,`${workerName}.lock`),async()=>{
    const models={};
    try {
      const {computeEngineFingerprint,computeRawEngineFingerprint}=await load('scripts/training-safety.mjs');
      assert.equal(computeEngineFingerprint(),plan.engineFingerprint);
      assert.equal(computeRawEngineFingerprint(),plan.rawEngineFingerprint);
      if(plan.runtimeManifest){
        const bytes=fs.readFileSync(plan.runtimeManifest.path);
        assert.equal(createHash('sha256').update(bytes).digest('hex'),plan.runtimeManifest.sha256);
        for(const item of JSON.parse(bytes))assert.equal(createHash('sha256')
          .update(fs.readFileSync(path.join(plan.runtimeDirectory,item.path))).digest('hex'),item.sha256,
          `Frozen runtime changed: ${item.path}`);
      }
      const {makeEvaluationReview,evaluationReviewOptions}=await load('scripts/evaluation-decision-review.mjs');
      assert.deepEqual(makeEvaluationReview(),plan.review);
      const review=evaluationReviewOptions(plan.review);
      assert.equal(review.decisionReviewHash,plan.reviewHash);
      const {readTrajectoryArchive}=await load('src/ai/neural/archive.mjs');
      const {deserializeNeuralModel,disposeNeuralModel}=await load('src/ai/neural/model.mjs');
      const {assertAdaptiveCheckpoint}=await load('scripts/adaptive-policy-q-evidence.mjs');
      const {evaluateNeuralModels}=await load('src/ai/neural/selfplay.mjs');
      const {assertLegalTrainingDeck}=await load('src/ai/legal-decks.mjs');
      for(const job of plan.schedule)for(const deck of job.decks)assertLegalTrainingDeck(deck);
      try {
        for(const [name,identity] of Object.entries(plan.models)) {
          const file=path.join(root,identity.file);
          assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),identity.sha256);
          const payload=await readTrajectoryArchive(file), checkpoint=payload.candidateCheckpoint||payload.checkpoint||payload;
          assertAdaptiveCheckpoint(checkpoint);models[name]=deserializeNeuralModel(checkpoint);
          assert.equal(models[name].generation,identity.generation);
        }
        if(mode==='preflight') {status('preflight-completed');return;}
        fs.mkdirSync(path.join(root,'games'),{recursive:true});
        const reservationPath=path.join(plan.mainRunDirectory,'side-training-reservation.json');
        for(const [jobIndex,job] of plan.schedule.entries()) {
          if(!comparisonJobAssigned(plan,mode,shard,jobIndex))continue;
          if(fs.existsSync(path.join(root,'stop.request.json'))) {status('paused');return;}
          assert.equal(comparisonHash(JSON.parse(fs.readFileSync(reservationPath,'utf8'))),plan.reservationHash,
            'Comparison capacity reservation changed');
          const files=Array.from({length:8},(_,i)=>path.join(root,'games',`${job.id}-${i}.json`));
          const resumed=files.map((file,index)=>fs.existsSync(file)?
            assertComparisonRecord(JSON.parse(fs.readFileSync(file,'utf8')),plan,job,index).summary:null);
          status('evaluating',{job:job.id,subject:job.subject});
          evaluateNeuralModels(models[job.subject],models.main,job.decks,{games:8,seed:job.seed,
            evaluationMode:job.mode,greedy:true,maxActions:2400,...review,resumedSummaries:resumed,
            onGameComplete:({game,summary,resumed:reused})=>{
              const record={planHash,jobId:job.id,index:game-1,summary};
              assertComparisonRecord(record,plan,job,game-1);
              if(!reused)write(files[game-1],record);
              status('game-saved',{job:job.id,subject:job.subject,game});
              if(plan.executionMode==='serial')report();
            }});
          globalThis.gc?.();
        }
        report();status('completed');
      } finally {for(const model of Object.values(models))disposeNeuralModel(model);}
    } catch(error) {status('failed',{error:error.stack||String(error)});throw error;}
    finally {
      if(mode==='serial'){
        const file=path.join(plan.mainRunDirectory,'side-training-reservation.json');
        const current=JSON.parse(fs.readFileSync(file,'utf8'));
        // Do not overwrite a newer owner's reservation. An unchanged reservation
        // can release this process and finished experiments that could not release
        // themselves while this additional reservation was active.
        if(comparisonHash(current)===plan.reservationHash){
          const {readTrajectoryArchive}=await load('src/ai/neural/archive.mjs');
          const finished=[];
          for(const item of current.additionalReservations||[]){
            if(!['isolated-paired-league-policy-v1','paired-champion-current-learning-v1'].includes(item.contract))continue;
            const saved=await readTrajectoryArchive(path.join(item.directory,'state.json.gz'));
            if(saved.completed===true&&!await readLiveFileLockOwner(path.join(item.directory,'controller.lock')))finished.push(item.directory);
          }
          if(comparisonHash(JSON.parse(fs.readFileSync(file,'utf8')))===plan.reservationHash)
            write(file,releaseComparisonReservation(current,root,finished));
        }
      }
    }
  },{timeoutMs:1000});
}
