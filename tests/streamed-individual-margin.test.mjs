import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;
test('streamed hinge matches every original active-case gradient, with bounded projection storage',{skip:!runtime},async()=>{
  const load=f=>import(pathToFileURL(path.join(runtime,f)));
  const {createNeuralModel,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
  const {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE}=await load('src/ai/neural/encoding.mjs');
  const {individualMarginDirections,streamedIndividualMargins,measureIndividualTraining,individualMarginGuard}=await load('scripts/individual-training-margin.mjs');
  const model=createNeuralModel();
  try{
    const samples=Array.from({length:11},(_,i)=>{
      const state=Float32Array.from({length:STATE_DIM},(_,j)=>Math.sin(j+i)*.02),count=2+i%3,actions=new Float32Array(count*ACTION_DIM);
      for(let a=0;a<count;a++)actions[a*ACTION_DIM+(i+a)%ACTION_DIM]=1;
      return {lessonRole:'training',imitation:true,playerId:'p1',steps:[{state,actions,legalCount:count,selectedIndex:i%count,
        initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),value:0,return:0,advantage:1,imitation:true,winProbabilityLabel:false,responsePolicyLesson:true,
        legalActionKeys:Array.from({length:count},(_,j)=>String(j)),selectedActionKey:String(i%count)}]};
    });
    const variables=Object.values(model.layers).flatMap(l=>l.trainableWeights.map(w=>w.val));
    const old=individualMarginDirections(model,samples,variables),stream=streamedIndividualMargins(model,samples,variables,{batchSize:3,maximumDirections:2});
    assert.ok(old.length>2);assert.equal(stream.activeCases,old.length);assert.equal(stream.directions.length,2);
    let maximumError=0,maximumValue=0;
    for(let k=0;k<variables.length;k++)for(let i=0;i<variables[k].size;i++){
      const expected=old.reduce((s,d)=>s+d.values[k][i]/old.length,0);
      maximumError=Math.max(maximumError,Math.abs(expected-stream.gradient[k][i]));maximumValue=Math.max(maximumValue,Math.abs(expected));
    }
    assert.ok(maximumError<1e-5*Math.max(1,maximumValue),`Gradient error ${maximumError}`);
    // An omitted projection case is still protected by the complete guard.
    const before=measureIndividualTraining(model,samples),after=structuredClone(before);
    const omitted=before.findIndex(b=>!stream.directions.some(d=>d.type==='individual:'+b.key));assert.ok(omitted>=0);
    before[omitted]={...before[omitted],correct:true,margin:.01};after[omitted]={...after[omitted],correct:false,margin:-.1};
    assert.equal(individualMarginGuard(before,after).passed,false);
  }finally{dispose(model);}
});
