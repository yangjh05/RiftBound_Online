import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;
const load=file=>import(pathToFileURL(path.join(runtime,file)));
test('full-history GRU derivative agrees with finite differences and exact recurrent memory',{skip:!runtime},async()=>{
 const {tf,tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
 const {createNeuralModel,disposeNeuralModel}=await load('src/ai/neural/model.mjs');
 const {STATE_DIM}=await load('src/ai/neural/encoding.mjs');
 const {differentiableLessonMemory}=await load('scripts/training-history-gradient.mjs');
 const {resolveLessonMemory,lessonMemoryContext}=await load('scripts/lesson-memory-context.mjs');
 const model=createNeuralModel();
 try{
  const states=Array.from({length:3},(_,i)=>Float32Array.from({length:STATE_DIM},(_,j)=>Math.sin(j+i)*.03));
  const sample={playerId:'p1',memoryContext:lessonMemoryContext('p1',states)},variable=model.layers.gru.trainableWeights[0].val;
  const memory=tf.tidy(()=>differentiableLessonMemory(model,sample).dataSync().slice());assert.deepEqual(Array.from(memory),Array.from(resolveLessonMemory(model,sample)));
  const {value,grads}=tf.variableGrads(()=>tf.tidy(()=>tf.sum(differentiableLessonMemory(model,sample))),[variable]);
  const gradient=grads[variable.name].dataSync();let index=0;for(let i=1;i<gradient.length;i++)if(Math.abs(gradient[i])>Math.abs(gradient[index]))index=i;
  const expected=gradient[index],base=Float32Array.from(variable.dataSync()),epsilon=.0005;
  const evaluate=offset=>{const changed=base.slice();changed[index]+=offset;tf.tidy(()=>variable.assign(tf.tensor(changed,variable.shape)));return tf.tidy(()=>tf.sum(differentiableLessonMemory(model,sample)).dataSync()[0]);};
  const finite=(evaluate(epsilon)-evaluate(-epsilon))/(2*epsilon);tf.tidy(()=>variable.assign(tf.tensor(base,variable.shape)));
  assert.ok(Math.abs(expected)>.001);assert.ok(Math.abs(finite-expected)<.003*Math.max(1,Math.abs(expected)),`${finite} != ${expected}`);
  value.dispose();Object.values(grads).forEach(g=>g.dispose());
 }finally{disposeNeuralModel(model);}
});

test('champion KL constraint uses the exact full-history training derivative without other objectives',{skip:!runtime},async()=>{
 const {tf}=await load('src/ai/neural/tf-runtime.mjs');
 const {createNeuralModel,serializeNeuralModel,deserializeNeuralModel,disposeNeuralModel,trainPpoBatch}=await load('src/ai/neural/model.mjs');
 const {packPpoBatch}=await load('src/ai/neural/trainer.mjs');
 const {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS}=await load('src/ai/neural/encoding.mjs');
 const {lessonMemoryContext,contextualLessonSamples,resolveLessonMemory}=await load('scripts/lesson-memory-context.mjs');
 const {trainingInitialMemories}=await load('scripts/training-history-gradient.mjs');
 const champion=createNeuralModel(),model=deserializeNeuralModel(serializeNeuralModel(champion));
 try{
  const bias=model.layers.actionBias.trainableWeights[0].val,biasValues=Float32Array.from(bias.dataSync());biasValues[6]+=.4;
  tf.tidy(()=>bias.assign(tf.tensor(biasValues,bias.shape)));
  const state=Float32Array.from({length:STATE_DIM},(_,i)=>Math.sin(i)*.03),actions=new Float32Array(2*ACTION_DIM);actions[6]=1;actions[ACTION_DIM+20]=1;
  const sample={playerId:'p1',gameId:'kl-fixture',memoryContext:lessonMemoryContext('p1',[state,state,state]),steps:[{
   state,actions,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),legalCount:2,selectedIndex:0,oldLogProbability:-Math.log(2),behaviorTemperature:1,
   advantage:1,return:0,value:0,beliefTarget:new Float32Array(CARD_BINS),imitation:false,winProbabilityLabel:true}]};
  const batch=()=>packPpoBatch(contextualLessonSamples(model,[sample]));
  const options={anchorOnly:true,anchorModels:[{model:champion,weight:1}],anchorInitialMemories:new Map([[champion,resolveLessonMemory(champion,sample)]]),anchorCoefficient:1,
   policyCoefficient:0,valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,beliefCoefficient:0,entropyCoefficient:0,
   teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,trainingInitialMemories};
  assert.equal(trainPpoBatch(model,batch(),null,{...options,anchorOnly:false,evaluateOnly:true}).optimizerStepApplied,false);
  const variable=model.layers.gru.trainableWeights[0].val;let gradient;
  const measured=trainPpoBatch(model,batch(),{applyGradients:g=>{gradient=Float32Array.from(g[variable.name].dataSync());}},options);
  assert.ok(measured.anchorKl>0);assert.equal(measured.loss,measured.anchorKl);
  let index=0;for(let i=1;i<gradient.length;i++)if(Math.abs(gradient[i])>Math.abs(gradient[index]))index=i;
  const base=Float32Array.from(variable.dataSync()),epsilon=.005;
  const evaluate=offset=>{const changed=base.slice();changed[index]+=offset;tf.tidy(()=>variable.assign(tf.tensor(changed,variable.shape)));
   return trainPpoBatch(model,batch(),null,{...options,evaluateOnly:true}).anchorKl;};
  const finite=(evaluate(epsilon)-evaluate(-epsilon))/(2*epsilon);tf.tidy(()=>variable.assign(tf.tensor(base,variable.shape)));
  assert.ok(Math.abs(gradient[index])>1e-7);assert.ok(Math.abs(finite-gradient[index])<Math.max(1e-5,Math.abs(gradient[index])*.03));
  const downhill=evaluate(-Math.sign(gradient[index])*.001);assert.ok(downhill<measured.anchorKl);
 }finally{disposeNeuralModel(model);disposeNeuralModel(champion);}
});
test('training runtime preserves every exported inference function and numerical result',{skip:!runtime},async()=>{
 const old=await import(pathToFileURL(path.resolve('data/ai/deck-league-20261007/runtime-r5-chain/src/ai/neural/model.mjs'))),next=await load('src/ai/neural/model.mjs');
 for(const [name,fn]of Object.entries(old))if(typeof fn==='function'&&name!=='trainPpoBatch')assert.equal(fn.toString(),next[name].toString(),name+' changed');
 const {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE}=await load('src/ai/neural/encoding.mjs');
 const a=old.createNeuralModel(),b=next.deserializeNeuralModel(old.serializeNeuralModel(a));
 try{
  for(let i=0;i<4;i++){
   const state=Float32Array.from({length:STATE_DIM},(_,j)=>Math.sin(i+j)*.03),actions=new Float32Array(3*ACTION_DIM),memory=Float32Array.from({length:NEURAL_HIDDEN_SIZE},(_,j)=>Math.cos(i+j)*.02);
   actions[i]=1;actions[ACTION_DIM+i+1]=1;actions[2*ACTION_DIM+i+2]=1;
   assert.deepEqual(old.inferStep(a,state,actions,3,memory),next.inferStep(b,state,actions,3,memory));
  }
 }finally{old.disposeNeuralModel(a);next.disposeNeuralModel(b);}
});
test('PPO rehearsal differentiates the same full-history loss checked after an update',{skip:!runtime},async()=>{
 const {tf}=await load('src/ai/neural/tf-runtime.mjs'),{createNeuralModel,disposeNeuralModel,trainPpoBatch}=await load('src/ai/neural/model.mjs');
 const {packPpoBatch}=await load('src/ai/neural/trainer.mjs'),{STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS}=await load('src/ai/neural/encoding.mjs');
 const {lessonMemoryContext,contextualLessonSamples}=await load('scripts/lesson-memory-context.mjs'),{trainingInitialMemories}=await load('scripts/training-history-gradient.mjs');
 const model=createNeuralModel();
 try{
  const state=Float32Array.from({length:STATE_DIM},(_,i)=>Math.sin(i)*.03),actions=new Float32Array(2*ACTION_DIM);actions[6]=1;actions[ACTION_DIM+20]=1;
  const sample={playerId:'p1',gameId:'fixture',lessonRole:'training',imitation:true,memoryContext:lessonMemoryContext('p1',[state,state,state]),steps:[{
   state,actions,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),legalCount:2,selectedIndex:0,selectedActionKey:'a',legalActionKeys:['a','b'],
   oldLogProbability:0,behaviorTemperature:1,advantage:1,return:0,value:0,beliefTarget:new Float32Array(CARD_BINS),imitation:true,winProbabilityLabel:false,responsePolicyLesson:true}]};
  const settings=()=>({teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,policyCoefficient:0,valueCoefficient:0,actionValueCoefficient:0,
   diagnosticCoefficient:0,beliefCoefficient:0,entropyCoefficient:0,anchorCoefficient:0,trainingInitialMemories,
   policyRehearsal:{contract:'verified-training-policy-rehearsal-v1',coefficient:.25,batch:packPpoBatch(contextualLessonSamples(model,[sample]))}});
  const variable=model.layers.gru.trainableWeights[0].val;let gradient;
  trainPpoBatch(model,packPpoBatch([sample]),{applyGradients:g=>{gradient=Float32Array.from(g[variable.name].dataSync());}},settings());
  let index=0;for(let i=1;i<gradient.length;i++)if(Math.abs(gradient[i])>Math.abs(gradient[index]))index=i;
  const base=Float32Array.from(variable.dataSync()),epsilon=.001;
  const evaluate=offset=>{const changed=base.slice();changed[index]+=offset;tf.tidy(()=>variable.assign(tf.tensor(changed,variable.shape)));
   return trainPpoBatch(model,packPpoBatch([sample]),null,{...settings(),evaluateOnly:true}).loss;};
  const finite=(evaluate(epsilon)-evaluate(-epsilon))/(2*epsilon);tf.tidy(()=>variable.assign(tf.tensor(base,variable.shape)));
  assert.ok(Math.abs(gradient[index])>1e-5);assert.ok(Math.abs(finite-gradient[index])<Math.max(1e-4,Math.abs(gradient[index])*.01),`${finite} != ${gradient[index]}`);
 }finally{disposeNeuralModel(model);}
});
