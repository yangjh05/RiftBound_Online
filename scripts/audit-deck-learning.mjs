import path from 'node:path';import assert from 'node:assert/strict';
import {json,verifyArtifact,sha} from './deck-league-io.mjs';
import {digest,unwrap} from './deck-league-contract.mjs';

export async function auditDeckLearning({config:c,load,onProgress=()=>{}}){
  const {readTrajectoryArchive:read}=await load('src/ai/neural/archive.mjs');
  const {deserializeNeuralModel:deserialize,serializeNeuralModel:serialize,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
  const {neuralBehaviorHash}=await load('src/ai/neural/evaluator-certification.mjs');
  const {measureLessonRetention,lessonSafetyGuard}=await load('scripts/lesson-maintenance.mjs');
  const state=json(verifyArtifact(c.auditState)),base=json(verifyArtifact(c.sourceConfig)),profiles=[];
  for(const p of c.profiles){
    onProgress('auditing-deck',{profileId:p.id});
    const history=[],failures={},modes={};
    for(let i=Math.max(1,p.auditIteration-14);i<=p.auditIteration;i++){
      const dir=path.join(base.directory,'profiles',p.id,'iterations',String(i).padStart(6,'0'));
      const file=path.join(dir,'candidate.json.gz'),plan=json(path.join(dir,'plan.json')),r=await read(file);
      assert.equal(r.planHash,digest(plan));assert.equal(r.beforeBehaviorHash,plan.sourceBehaviorHash);
      const accepted=r.epochGuards.filter(g=>g.passed).length,changed=r.beforeBehaviorHash!==r.afterBehaviorHash;
      const source=unwrap(await read(verifyArtifact({path:plan.sourcePath,sha256:plan.sourceSha256})));
      const actualWeightsChanged=digest(source.weights)!==digest(r.checkpoint.weights);
      assert.equal(actualWeightsChanged,changed,'Weight change accounting mismatch');
      if(!accepted)assert.equal(changed,false,'Rejected update persisted weights');
      for(const g of r.epochGuards){
        for(const f of g.lessonRetention?.validation?.failures||[])failures[f]=(failures[f]||0)+1;
        if(g.passed){const mode=g.lessonRetention?.report?.phaseLearning?.mode||'other';modes[mode]=(modes[mode]||0)+1;}
      }
      history.push({iteration:i,path:file,sha256:sha(file),acceptedEpochs:accepted,changed,actualWeightsChanged,trainingGames:r.trainingGames,collectedGames:r.collectedGames});
    }
    const bank=await read(verifyArtifact(p.originalLessons)),checks=[];let championHeld,championTraining;
    for(const [role,reference]of [['champion',p.champion],['learner',p.auditLearner]]){
      const model=deserialize(unwrap(await read(verifyArtifact(reference))));let clone;
      try{
        assert.equal(neuralBehaviorHash(model),reference.behaviorHash);
        const a=measureLessonRetention(model,bank.bank.validation),b=measureLessonRetention(model,bank.bank.validation);
        assert.deepEqual(a,b,'Repeated inference changed retention decisions');
        clone=deserialize(serialize(model));const cloned=measureLessonRetention(clone,bank.bank.validation);
        assert.deepEqual(a,cloned,'Serialization changed retention decisions');
        assert.equal(lessonSafetyGuard(a,b).passed,true,'Zero update rejected by guard');
        const training=measureLessonRetention(model,bank.bank.training);
        if(role==='champion'){championHeld=a;championTraining=training;}
        checks.push({role,sha256:reference.sha256,repeatedInferenceIdentical:true,serializationIdentical:true,zeroStepPassed:true,
          againstFixedChampion:{validation:lessonSafetyGuard(championHeld,a),training:lessonSafetyGuard(championTraining,training)},
          training:training.types,validation:a.types});
      }finally{dispose(model);if(clone)dispose(clone);}
    }
    profiles.push({profileId:p.id,iteration:p.auditIteration,history,failures,modes,checks,
      acceptedEpochs:history.reduce((s,x)=>s+x.acceptedEpochs,0),changedIterations:history.filter(x=>x.changed).length,
      fixedChampionSha256:p.champion.sha256,liveChampionUnchanged:state.profiles[p.id].champion.sha256===p.champion.sha256});
  }
  return {at:new Date().toISOString(),passed:true,profiles,scope:'All seven current deck models and their latest15 saved iterations; zero-update/repeated/serialized inference checks. No training or evaluation modification.'};
}
