import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;
test('one frozen training snapshot exactly reproduces recurrent group guards and individual margins',{skip:!runtime},async()=>{
 const load=file=>import(pathToFileURL(path.join(runtime,file)));
 const {createNeuralModel,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
 const {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE}=await load('src/ai/neural/encoding.mjs');
 const {lessonMemoryContext}=await load('scripts/lesson-memory-context.mjs');
 const {measureLessonRetention}=await load('scripts/lesson-maintenance.mjs');
 const {snapshotIndividualTraining,snapshotTrainingRetention,snapshotTrainingMargins}=await load('scripts/individual-training-snapshot.mjs');
 const {measureIndividualTraining,streamedIndividualMargins}=await load('scripts/individual-training-margin.mjs');
 const model=createNeuralModel();
 try{
  const samples=Array.from({length:7},(_,i)=>{
   const state=Float32Array.from({length:STATE_DIM},(_,j)=>Math.sin(i+j)*.02),count=2+i%3,actions=new Float32Array(count*ACTION_DIM);
   for(let a=0;a<count;a++)actions[a*ACTION_DIM+(i+a)%ACTION_DIM]=1;
   return {lessonRole:'training',imitation:true,playerId:'p1',memoryContext:lessonMemoryContext('p1',[state,Array.from(state,x=>x/2)]),
    steps:[{state,actions,legalCount:count,selectedIndex:i%count,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),
     value:0,return:0,advantage:1,imitation:true,winProbabilityLabel:false,
     responsePolicyLesson:i%2===0,localResourceLesson:i%2===1,mulliganLesson:i===0,
     legalActionKeys:Array.from({length:count},(_,j)=>String(j)),selectedActionKey:String(i%count)}]};
  });
  const snapshot=snapshotIndividualTraining(model,samples);
  for(const group of [samples,samples.slice(0,3),[samples[4],samples[0],samples[4]]]){
   assert.deepEqual(snapshotTrainingRetention(snapshot,group),measureLessonRetention(model,group));
   assert.deepEqual(snapshotTrainingMargins(snapshot,group),measureIndividualTraining(model,group));
  }
  const variables=Object.values(model.layers).flatMap(l=>l.trainableWeights.map(w=>w.val));
  const old=streamedIndividualMargins(model,samples,variables,{batchSize:3,maximumDirections:2});
  const reused=streamedIndividualMargins(model,samples,variables,{batchSize:3,maximumDirections:2,snapshot});
  assert.deepEqual(reused,old);
  const bad={...samples[0],steps:[{...samples[0].steps[0],selectedIndex:1,selectedActionKey:'1'}]};
  assert.throws(()=>snapshotTrainingRetention(snapshot,[bad]),/Conflicting/);
  assert.throws(()=>snapshotIndividualTraining(model,[samples[0],bad]),/Conflicting/);
 }finally{dispose(model);}
});
