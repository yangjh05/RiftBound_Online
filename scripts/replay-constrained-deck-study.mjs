import path from 'node:path';import fs from 'node:fs';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {json,sha,atomic,verifyArtifact} from './deck-league-io.mjs';import {digest,unwrap,inputKey} from './deck-league-contract.mjs';
const [directory,profileId,arm='modified']=process.argv.slice(2),c=json(path.join(directory,'config.json'));
assert.ok(['baseline','modified'].includes(arm));const p=c.profiles.find(x=>x.id===profileId);assert.ok(p);
const output=path.join(c.directory,'replays',profileId+'-'+arm+'.json');assert.ok(!fs.existsSync(output),'Completed replay cannot be repeated.');
assert.equal(os.getPriority(0),os.constants.priority.PRIORITY_NORMAL);
const repairFile=path.join(c.directory,'implementation-repair.json'),repair=fs.existsSync(repairFile)?json(repairFile):null;
if(repair){assert.equal(repair.configHash,digest(c));verifyArtifact(repair.original);verifyArtifact(repair.replacement);
  for(const item of json(verifyArtifact(repair.manifest)))assert.equal(sha(path.join(repair.directory,item.path)),item.sha256);}
const runtime=arm==='baseline'?c.sourceRuntime.directory:(repair?.directory||c.runtimeDirectory),load=f=>import(pathToFileURL(path.join(runtime,f)));
const {tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow','Native backend required; never compare a silent JS fallback.');
const {readTrajectoryArchive:read,writeTrajectoryArchive:write}=await load('src/ai/neural/archive.mjs');
const {deserializeNeuralModel:deserialize,serializeNeuralModel:serialize,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
const {trainRecurrentPpo,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
const {seededRandom}=await load('src/ai/neural/selfplay.mjs');const {ACTION_DIM}=await load('src/ai/neural/encoding.mjs');
const {measureLessonRetention,lessonSafetyGuard}=await load('scripts/lesson-maintenance.mjs');
const {tacticalLessonGuard}=await load('scripts/tactical-lesson-learning.mjs');
const {phasePpoLessonRetention}=await load('scripts/phase-policy-learning.mjs');
const {adaptiveFiniteEpochGuard,assertAdaptiveGame}=await load('scripts/adaptive-policy-q-evidence.mjs');
const original=json(verifyArtifact(c.sourceConfig)),plan=json(verifyArtifact(p.replay.plan)),saved=await read(verifyArtifact(p.replay.result));
const dir=path.dirname(p.replay.plan.path),admission=await read(path.join(dir,'trained-input-keys.json.gz')),allowed=new Set(admission.keys);
const trajectories=[],artifacts=[];assert.equal(admission.planHash,digest(plan));
for(let i=0;i<plan.games;i++){
  const file=path.join(dir,'games',i+'.json.gz'),g=await read(file);assertAdaptiveGame(g,plan,i);artifacts.push({path:file,sha256:sha(file)});
  if(!admission.excluded.includes(i))for(const t of g.trajectories){assert.equal(t.deckId,p.deck.id);
    assert.ok(t.steps.every(s=>allowed.has(inputKey({steps:[{...s,actions:Array.from(s.actions).slice(0,s.legalCount*ACTION_DIM)}]}))));trajectories.push(t);}
}
const payload=await read(verifyArtifact({path:plan.sourcePath,sha256:plan.sourceSha256})),source=deserialize(unwrap(payload)),model=deserialize(unwrap(payload));
const champion=deserialize(unwrap(await read(verifyArtifact(p.champion)))),fixed=deserialize(unwrap(await read(verifyArtifact(p.initial))));
let trained,optimizer;const batchReports=[];
try{
  const bank=await read(verifyArtifact(p.lessons)),old=await read(verifyArtifact(p.originalLessons)),protocols=await read(verifyArtifact(original.protocols));
  const fixedHeld=measureLessonRetention(fixed,old.bank.validation),fixedTrain=measureLessonRetention(fixed,old.bank.training);
  const fixedAdded=measureLessonRetention(fixed,bank.bank.training),localOld=measureLessonRetention(source,old.bank.training);
  const localHeld=measureLessonRetention(source,bank.bank.validation),localTrain=measureLessonRetention(source,bank.bank.training);
  const additionalGuard=()=>{
    const validation=lessonSafetyGuard(fixedHeld,measureLessonRetention(model,old.bank.validation)),now=measureLessonRetention(model,old.bank.training),training=lessonSafetyGuard(fixedTrain,now);
    if(p.lessons.sha256===p.originalLessons.sha256)return {passed:validation.passed&&training.passed,validation,training};
    const added=lessonSafetyGuard(fixedAdded,measureLessonRetention(model,bank.bank.training)),localOriginal=tacticalLessonGuard(localOld.types,now.types),lostOriginalChoices=localOld.correct.filter((v,i)=>v&&!now.correct[i]).length;
    return {passed:validation.passed&&training.passed&&added.passed&&localOriginal.passed&&!lostOriginalChoices,validation,training,added,localOriginal,lostOriginalChoices};
  };
  const {maintenance,joint,recovery,efficient,phase}=protocols;
  const retention=phasePpoLessonRetention(model,source,bank,maintenance,joint,recovery,efficient,phase,original.sourceIteration+p.replay.iteration,{additionalGuard});
  optimizer=payload.optimizerState?await restoreAdamOptimizer(payload.optimizerState,.0001):undefined;
  let ppoBatchUpdate;
  if(arm==='modified'){
    const {constrainedPolicyUpdater}=await load('scripts/constrained-policy-learning.mjs');
    ppoBatchUpdate=constrainedPolicyUpdater({trajectories,source,champion,rehearsalForBatch:retention.policyRehearsalForBatch,
      onBatch:r=>{batchReports.push(r);atomic(output+'.progress',{profileId,arm,batches:batchReports.length,last:r});}});
  }
  const finite=adaptiveFiniteEpochGuard();
  trained=await trainRecurrentPpo(model,trajectories,{epochs:original.epochs,batchSize:16,learningRate:.0001,optimizer,random:seededRandom(plan.epochSeed),
    teacherConsumptionPolicy:'record-only-v1',beliefCoefficient:0,anchorModels:[{model:source,weight:1}],anchorCoefficient:.05,...finite,
    ppoBatchUpdate,policyRehearsalForBatch:retention.policyRehearsalForBatch,
    beforeEpochGuard:arm==='baseline'?retention.beforeEpochGuard:undefined,
    epochGuard:args=>{
      if(arm==='baseline'){const f=finite.epochGuard(args),r=retention.epochGuard();return {passed:f.passed&&r.passed,lessonRetention:r};}
      const after=measureLessonRetention(model,bank.bank.validation),trainAfter=measureLessonRetention(model,bank.bank.training);
      const validation=lessonSafetyGuard(localHeld,after),training=tacticalLessonGuard(localTrain.types,trainAfter.types);
      const lostChoices=localTrain.correct.filter((v,i)=>v&&!trainAfter.correct[i]).length,fixed=additionalGuard(),numeric=finite.epochGuard(args);
      return {passed:numeric.passed&&validation.passed&&training.passed&&!lostChoices&&fixed.passed,validation,training,lostChoices,fixed};
    },selectBestEpoch:false,gamesObserved:trajectories.length,onEpoch:r=>console.log(JSON.stringify({profileId,arm,epoch:r.epoch,accepted:r.accepted}))});
  const accepted=trained.epochGuards.filter(x=>x.passed).length,behaviorHash=neuralBehaviorHash(model);
  if(arm==='baseline'){assert.equal(behaviorHash,saved.afterBehaviorHash);assert.equal(accepted,saved.epochGuards.filter(x=>x.passed).length);}
  const report={at:new Date().toISOString(),configHash:digest(c),profileId,arm,planHash:digest(plan),sourceSha256:plan.sourceSha256,artifacts,
    originalAccepted:saved.epochGuards.filter(g=>g.passed).length,acceptedEpochs:accepted,behaviorHash,changed:behaviorHash!==neuralBehaviorHash(source),
    baselineReproduced:arm==='baseline',finalGuard:additionalGuard(),epochGuards:trained.epochGuards,batchReports,diagnosticOnly:true,liveModelsModified:false};
  atomic(output,report);await write(output.replace('.json','.checkpoint.json.gz'),{checkpoint:serialize(model),diagnosticOnly:true});
  console.log(JSON.stringify({profileId,arm,acceptedEpochs:accepted,changed:report.changed,batches:batchReports.length}));
}finally{(trained?.optimizer||optimizer)?.dispose();[source,model,champion,fixed].forEach(dispose);}
