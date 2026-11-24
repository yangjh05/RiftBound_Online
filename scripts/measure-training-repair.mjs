import fs from 'node:fs';import path from 'node:path';import {gunzipSync} from 'node:zlib';
import {json,atomic,verifyArtifact} from './deck-league-io.mjs';
const audit=path.resolve('data/ai/training-repair-20261013'),root=path.resolve('data/ai/deck-league-20261007');
const before=json(path.join(audit,'deck-league-20261007','sealed-before','state.json')),after=json(path.join(root,'state.json'));
const archive=file=>JSON.parse(gunzipSync(fs.readFileSync(file)));
const brief=(p,i)=>{const f=path.join(root,'profiles',p,'iterations',String(i).padStart(6,'0'),'candidate.json.gz'),c=archive(f);
 return {profileId:p,iteration:i,at:c.at,changed:c.beforeBehaviorHash!==c.afterBehaviorHash,
  finalAdamStep:c.optimizerState?.weights?.find(w=>w.name==='iter')?.values?.[0]??null,
  exactAdamBiasPowersSaved:!!c.optimizerState?.adamBiasPowers,
  atomicEpochs:c.epochGuards.filter(g=>g.lessonRetention?.report?.atomicEpoch).map(g=>({epoch:g.epoch,committed:g.passed,
    mode:g.lessonRetention.report.atomicEpoch.mode,steps:g.lessonRetention.report.atomicEpoch.steps??g.lessonRetention.report.atomicEpoch.acceptedSteps??null})),
  policyContract:c.policyLearning?.contract||'original-main-ppo',acceptedBatches:c.batchReports?.filter(b=>b.accepted).length??null,
  batches:c.batchReports?.length??null,resourceCollection:c.resourceCollection||null,
  nativeStepsApprovedBeforeEpochGuard:c.batchReports?.filter(b=>b.accepted).reduce((n,b)=>n+(b.nativeStepsCommitted??1),0)??null,
  nativeStepsRetainedByEpochs:c.epochGuards.filter(g=>g.passed&&g.lessonRetention?.report?.atomicEpoch).reduce((n,g)=>{
    const a=g.lessonRetention.report.atomicEpoch;return n+(a.steps??a.acceptedSteps??0);},0),
  provisionalRecoverySteps:c.batchReports?.reduce((n,b)=>n+(b.attempts?.filter(a=>a.provisional).length||0),0)??null,
  batchComputationMs:c.batchReports?.reduce((n,b)=>n+(b.computation?.elapsedMs||0),0)??null,
  projectedAdamBatches:c.batchReports?.filter(b=>b.attempts?.some(a=>a.proposal==='actual-adam-delta-projection')).length??null,
  projectedAcceptedBatches:c.batchReports?.filter(b=>b.accepted&&b.attempts?.at(-1)?.proposal==='actual-adam-delta-projection').length??null,
  unreachableProjectionBatches:c.batchReports?.filter(b=>b.projection?.unavailableReason==='unreachable-adam-delta').length??null,
  acceptedEpochs:c.epochGuards.filter(g=>g.passed).length,attemptedEpochs:c.epochGuards.length,collectedGames:c.collectedGames,trainingGames:c.trainingGames,
  rejectedEpochs:c.epochGuards.filter(g=>!g.passed).map(g=>({epoch:g.epoch,finitePassed:g.finitePassed,
   trainingFailures:g.lessonRetention?.training?.failures||[],validationFailures:g.lessonRetention?.validation?.failures||[],
   additionalFailures:g.lessonRetention?.additionalGuard?.failures||[]}))};};
const baselineFile=path.join(audit,'baseline-rates.json');
if(!fs.existsSync(baselineFile)){
 const rows=Object.entries(before.profiles).flatMap(([id,p])=>Array.from({length:10},(_,n)=>brief(id,p.iteration-9+n))).sort((a,b)=>a.at.localeCompare(b.at));
 const seconds=(Date.parse(rows.at(-1).at)-Date.parse(rows[0].at))/1000;
 atomic(baselineFile,{at:new Date().toISOString(),rows,iterations:rows.length,changedIterations:rows.filter(r=>r.changed).length,
  acceptedEpochs:rows.reduce((s,r)=>s+r.acceptedEpochs,0),attemptedEpochs:rows.length*4,
  completedIterationsPerHour:(rows.length-1)*3600/seconds,seconds,window:'Last ten saved iterations per profile before repair'});
}
const baseline=json(baselineFile);
if(baseline.rows.some(r=>r.attemptedEpochs===undefined||r.rejectedEpochs===undefined)){
 baseline.rows=baseline.rows.map(r=>brief(r.profileId,r.iteration));
 baseline.attemptedEpochs=baseline.rows.reduce((s,r)=>s+r.attemptedEpochs,0);baseline.maximumEpochs=baseline.rows.length*4;
 delete baseline.activeObservationWindow;
}
if(!baseline.activeObservationWindow){
 const from='2026-10-12T14:21:26Z',rows=baseline.rows.filter(r=>Date.parse(r.at)>=Date.parse(from));
 const seconds=(Date.parse(rows.at(-1).at)-Date.parse(rows[0].at))/1000;
 baseline.activeObservationWindow={knownControllerStart:from,iterations:rows.length,changedIterations:rows.filter(r=>r.changed).length,
  acceptedEpochs:rows.reduce((s,r)=>s+r.acceptedEpochs,0),attemptedEpochs:rows.reduce((s,r)=>s+r.attemptedEpochs,0),maximumEpochs:rows.length*4,seconds,completedIterationsPerHour:(rows.length-1)*3600/seconds};
 baseline.wallRateIncludesInactivePeriods=true;atomic(baselineFile,baseline);
}
const rows=Object.entries(after.profiles).flatMap(([id,p])=>Array.from({length:Math.max(0,p.iteration-before.profiles[id].iteration)},(_,n)=>brief(id,before.profiles[id].iteration+n+1)));
const evaluationDirectory=path.join(root,'evaluation-r6'),requests=path.join(evaluationDirectory,'requests');
const evaluations=fs.existsSync(requests)?fs.readdirSync(requests).filter(f=>f.endsWith('.result.json')).map(f=>json(path.join(requests,f))):[];
const elapsedSeconds=(Date.now()-Date.parse(json(path.join(audit,'activation.json')).at))/1000;
const individuals=[];const study=path.resolve('data/ai/deck-league-individual-20261011-r2');
for(const profileId of Object.keys(before.profiles)){
 const candidate=path.join(study,'profiles',profileId,'replay/candidate.json.gz');if(!fs.existsSync(candidate))continue;
 const c=archive(candidate),accepted=c.batchReports.filter(r=>r.accepted).length;
 individuals.push({profileId,batches:c.batchReports.length,acceptedBatches:accepted,acceptedBatchRate:accepted/c.batchReports.length,
  committedEpochs:c.epochGuards.filter(g=>g.passed).length,attemptedEpochs:c.epochGuards.length,maximumEpochs:4,changed:c.beforeBehaviorHash!==c.afterBehaviorHash,
  finalGuard:c.finalGuard,meanBatchMs:c.batchReports.reduce((s,r)=>s+(r.computation?.elapsedMs||0),0)/c.batchReports.length,
  epochGuards:c.epochGuards,source:c.source,afterBehaviorHash:c.afterBehaviorHash,collectedGames:c.collectedGames,trainingGames:c.trainingGames});
}
const preservation={weights:json(path.join(audit,'preserved-weights.json')).length,
 studyArchives:json(path.join(audit,'preserved-study-archives.json')).length};
json(path.join(audit,'preserved-weights.json')).forEach(verifyArtifact);json(path.join(audit,'preserved-study-archives.json')).forEach(verifyArtifact);
const laneProgress=directory=>{
 const requestDirectory=path.join(directory,'requests');
 const requests=fs.existsSync(requestDirectory)?fs.readdirSync(requestDirectory).filter(f=>f.endsWith('.request.json')):[];
 return requests.map(name=>{
  const file=path.join(requestDirectory,name),request=json(file),pending=request.pending;
  const phases=['screen','confirmation'].map(phase=>{
   const dir=path.join(pending.directory,phase),plan=path.join(dir,'plan.json');
   if(!fs.existsSync(plan))return {phase,completedGames:0};
   const binding=json(plan),completedGames=binding.jobs.reduce((n,job)=>{
    const game=path.join(dir,job.id+'.json');return n+(fs.existsSync(game)?json(game).rows.length:0);
   },0);
   return {phase,completedGames,totalGames:binding.jobs.length*4};
  });
  const result=file.replace('.request.json','.result.json'),failure=file.replace('.request.json','.failure.json');
  return {profileId:pending.profileId,iteration:pending.iteration,engineFingerprint:request.runtime.engineFingerprint,
   phases,completed:fs.existsSync(result),failed:fs.existsSync(failure),result:fs.existsSync(result)?json(result).final:null};
 });
};
const mainEvaluationProgress=laneProgress(evaluationDirectory),individualEvaluationProgress=laneProgress(path.join(study,'parallel-evaluation'));
const savedEvaluationGames=mainEvaluationProgress.reduce((n,r)=>n+r.phases.reduce((s,p)=>s+p.completedGames,0),0);
const orderedRows=rows.slice().sort((a,b)=>a.at.localeCompare(b.at));
const observationSeconds=orderedRows.length>1?(Date.parse(orderedRows.at(-1).at)-Date.parse(orderedRows[0].at))/1000:0;
const rejectedReasons={};
for(const row of rows)for(const epoch of row.rejectedEpochs){
 const reasons=[...new Set([...epoch.trainingFailures.map(r=>'training:'+r),...epoch.validationFailures.map(r=>'validation:'+r),...epoch.additionalFailures.map(r=>'additional:'+r),
  ...(epoch.finitePassed===false?['nonfinite']:[])])];
 for(const reason of reasons)rejectedReasons[reason]=(rejectedReasons[reason]||0)+1;
}
const result={at:new Date().toISOString(),elapsedSeconds,baseline:json(baselineFile),main:{iterations:rows.length,changedIterations:rows.filter(r=>r.changed).length,
 acceptedEpochs:rows.reduce((s,r)=>s+r.acceptedEpochs,0),attemptedEpochs:rows.reduce((s,r)=>s+r.attemptedEpochs,0),maximumEpochs:rows.length*4,
 changedIterationRate:rows.length?rows.filter(r=>r.changed).length/rows.length:null,rejectedReasons,observationSeconds,
 completedIterationsPerHour:observationSeconds?(rows.length-1)*3600/observationSeconds:null,
 policyWindows:[...new Set(rows.map(r=>r.policyContract))].map(contract=>{const group=rows.filter(r=>r.policyContract===contract);return {
  contract,iterations:group.length,changedIterations:group.filter(r=>r.changed).length,acceptedBatches:group.reduce((n,r)=>n+(r.acceptedBatches||0),0),
  batches:group.reduce((n,r)=>n+(r.batches||0),0),committedEpochs:group.reduce((n,r)=>n+r.acceptedEpochs,0),attemptedEpochs:group.reduce((n,r)=>n+r.attemptedEpochs,0),
  nativeStepsApprovedBeforeEpochGuard:group.reduce((n,r)=>n+(r.nativeStepsApprovedBeforeEpochGuard||0),0),
  nativeStepsRetainedByEpochs:group.reduce((n,r)=>n+r.nativeStepsRetainedByEpochs,0),
  provisionalRecoverySteps:group.reduce((n,r)=>n+(r.provisionalRecoverySteps||0),0),
  actualPolicyChangeRate:group.filter(r=>r.changed).length/group.length,
  changedWithZeroAdamStep:group.filter(r=>r.changed&&r.finalAdamStep===0).length,
  changedWithNonzeroAdamStep:group.filter(r=>r.changed&&r.finalAdamStep>0).length,
  exactAdamResumeCheckpoints:group.filter(r=>r.exactAdamBiasPowersSaved).length,
  atomicEpochModes:Object.fromEntries([...new Set(group.flatMap(r=>r.atomicEpochs.map(e=>e.mode)))].map(mode=>[mode,{
    attempted:group.flatMap(r=>r.atomicEpochs).filter(e=>e.mode===mode).length,
    committed:group.flatMap(r=>r.atomicEpochs).filter(e=>e.mode===mode&&e.committed).length}])),
  meanBatchMs:group.reduce((n,r)=>n+(r.batches||0),0)?group.reduce((n,r)=>n+(r.batchComputationMs||0),0)/group.reduce((n,r)=>n+(r.batches||0),0):null,
  projectedAdamBatches:group.reduce((n,r)=>n+(r.projectedAdamBatches||0),0),
  projectedAcceptedBatches:group.reduce((n,r)=>n+(r.projectedAcceptedBatches||0),0),
  unreachableProjectionBatches:group.reduce((n,r)=>n+(r.unreachableProjectionBatches||0),0)};}),
 rateCaveat:'Observational wall time includes deployment pauses and changing concurrent work; not a controlled speed comparison.',rows},individuals,savedEvaluationGames,
 mainEvaluationProgress,individualEvaluationProgress,
 evaluations:evaluations.map(r=>({profileId:r.profileId,iteration:r.iteration,phase:r.final.phase,completedGames:r.final.completedGames,mean:r.final.mean,
 lower:r.final.lower,upper:r.final.upper,promoted:r.final.promoted,eligible:r.final.eligible,elapsedMs:r.elapsedMs,engineFingerprint:r.evaluationRuntime.engineFingerprint})),
 preservation,criteriaUnchanged:true};
atomic(path.join(audit,'measurement.json'),result);
console.log(JSON.stringify({...result,baseline:{...result.baseline,rows:undefined},main:{...result.main,rows:undefined}}));
