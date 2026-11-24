import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;
assert.ok(runtime,'Run against the prepared private runtime');
const load=f=>import(pathToFileURL(path.join(runtime,f)));
const {tf,tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
const {createNeuralModel,deserializeNeuralModel:deserialize,serializeNeuralModel:serialize,disposeNeuralModel:dispose,inferStep}=await load('src/ai/neural/model.mjs');
const {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS}=await load('src/ai/neural/encoding.mjs');
const {serializeOptimizer,restoreAdamOptimizer,trainRecurrentPpo}=await load('src/ai/neural/trainer.mjs');
const {projectTrainingDelta,trainingLossDirections}=await load('scripts/ppo-training-projection.mjs');
const {groupedTrainingLossDirections}=await load('scripts/training-group-directions.mjs');
const {streamedIndividualMargins}=await load('scripts/individual-training-margin.mjs');
const {lessonInputKey}=await load('scripts/tactical-lesson-learning.mjs');
const {atomicPpoEpochRetention,rebindEpochAdam}=await load('scripts/transactional-epoch-commit.mjs');
const {seededRandom}=await load('src/ai/neural/selfplay.mjs');
const snapshot=m=>Object.fromEntries(Object.entries(m.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));
const release=s=>Object.values(s).flat().forEach(v=>v.dispose());
function sample(model,index,wrong=false){
 const state=Float32Array.from({length:STATE_DIM},(_,j)=>Math.sin(j+index)*.02),actions=new Float32Array(2*ACTION_DIM);
 actions[6+index]=1;actions[ACTION_DIM+25+index]=1;const memory=new Float32Array(NEURAL_HIDDEN_SIZE);
 const logits=inferStep(model,state,actions,2,memory).logits,best=logits.indexOf(Math.max(...logits)),target=wrong?1-best:best;
 return {playerId:'p1',gameId:'fixture-'+index,lessonRole:'training',imitation:true,completed:true,steps:[{state,actions,initialMemory:memory,
  legalCount:2,selectedIndex:target,legalActionKeys:['a','b'],selectedActionKey:['a','b'][target],imitation:true,winProbabilityLabel:false,
  responsePolicyLesson:true,advantage:1,value:0,return:0,oldLogProbability:logits[target]-Math.log(Math.exp(logits[0])+Math.exp(logits[1])),beliefTarget:new Float32Array(CARD_BINS)}]};
}
test('absolute training recovery gap survives backtracking without relaxing any constraint',()=>{
 const directions=[{type:'recover',values:[Float64Array.from([1,0])],minimumDescent:.3},{type:'ppo',values:[Float64Array.from([0,1])]}];
 for(const fraction of [1,.5,1/64]){
  const result=projectTrainingDelta([Float64Array.from([-.1*fraction,-.1*fraction])],directions,{minimumDescent:.001*fraction});
  assert.equal(result.feasible,true);assert.ok(result.delta[0][0]<=-.3+1e-8);assert.ok(result.delta[0][1]<=-.001*fraction+1e-8);
 }
});
test('a reference-correct but currently wrong training choice receives a bounded working slot',()=>{
 const model=createNeuralModel();try{
  const samples=Array.from({length:12},(_,i)=>sample(model,i,i===11)),required=new Set([lessonInputKey(samples[11])]);
  const variables=Object.values(model.layers).flatMap(l=>l.trainableWeights.map(w=>w.val));
  const r=streamedIndividualMargins(model,samples,variables,{maximumDirections:2,config:{floor:100,coefficient:.25,tolerance:1e-7},requiredChoices:required});
  assert.equal(r.requiredRecoveryCases,1);assert.equal(r.directions.length,2);
  assert.equal(r.directions[0].type,'individual:'+lessonInputKey(samples[11]));assert.ok(r.directions[0].minimumDescent>0);
 }finally{dispose(model);}
});
test('partitioned group gradients equal complete original and augmented losses',()=>{
 const model=createNeuralModel();try{
  const samples=Array.from({length:4},(_,i)=>sample(model,i)),groups=[{id:'original',samples:samples.slice(0,2)},{id:'augmented',samples}];
  const actual=groupedTrainingLossDirections(model,groups,new Set());
  for(const g of groups){const expected=trainingLossDirections(model,{training:g.samples,validation:[]})[0],d=actual.find(x=>x.group===g.id);
   let error=0;d.values.forEach((a,k)=>a.forEach((x,i)=>{error=Math.max(error,Math.abs(x*d.norm-expected.values[k][i]*expected.norm));}));assert.ok(error<1e-6,error);
  }
 }finally{dispose(model);}
});
test('recovered epoch target has real Adam moments, bounded step count and deterministic resume',async()=>{
 const initial=tf.tensor1d([.02,-.03]),v=tf.variable(initial,true,'epoch_fixture');initial.dispose();
 const layer={trainableWeights:[{val:v}],getWeights:()=>[v],setWeights:w=>v.assign(w[0])},model={layers:{fixture:layer}};
 const old=tf.train.adam(.0001),start=snapshot(model),state=await serializeOptimizer(old,1);let a,b;
 try{
  tf.tidy(()=>v.assign(tf.tensor1d([.02012,-.03008])));const target=Array.from(v.dataSync());
  a=await rebindEpochAdam({model,epochStartWeights:start,optimizerSnapshot:state,names:[v.name],steps:2});
  assert.equal(a.passed,true);const saved=await serializeOptimizer(a.optimizer,1);assert.equal(saved.weights[0].values[0],2);assert.equal(saved.weights.length,3);
  const achieved=Array.from(v.dataSync());achieved.forEach((x,i)=>assert.ok(Math.abs(x-target[i])<2e-7));
  tf.tidy(()=>v.assign(tf.tensor1d(target)));b=await rebindEpochAdam({model,epochStartWeights:start,optimizerSnapshot:state,names:[v.name],steps:2});
  assert.equal(b.passed,true);assert.deepEqual(Array.from(v.dataSync()),achieved);assert.deepEqual((await serializeOptimizer(b.optimizer,1)).weights,saved.weights);
  const resumed=await restoreAdamOptimizer(saved,.0001);try{const gradient=tf.tensor1d([.02,-.03]);a.optimizer.applyGradients({[v.name]:gradient});
   const expected=Array.from(v.dataSync());tf.tidy(()=>v.assign(tf.tensor1d(achieved)));resumed.applyGradients({[v.name]:gradient});gradient.dispose();
   assert.deepEqual(Array.from(v.dataSync()),expected);
  }finally{resumed.dispose();}
  tf.tidy(()=>v.assign(tf.tensor1d([1,1])));const fail=await rebindEpochAdam({model,epochStartWeights:start,optimizerSnapshot:state,names:[v.name],steps:2});
  assert.equal(fail.passed,false);assert.deepEqual(Array.from(v.dataSync()),[1,1]);assert.deepEqual(await serializeOptimizer(old,1),state);
 }finally{a?.optimizer?.dispose();b?.optimizer?.dispose();old.dispose();release(start);v.dispose();}
});
test('raw passing epochs retain Adam through trainer checkpoint and deterministic continuation',async()=>{
 const source=createNeuralModel();let full,first,resumed,a,b,c,saved;
 try{
  const lesson=sample(source,0),trajectory=structuredClone(lesson);delete trajectory.imitation;trajectory.steps[0].imitation=false;trajectory.steps[0].winProbabilityLabel=true;trajectory.steps[0].return=1;
  const options=model=>{
   const reports=[],legacy={policyRehearsalForBatch:()=>null,beforeEpochGuard(){throw Error('Raw passing epoch must not run recovery');}},bank={training:[],validation:[]};
   const retention=atomicPpoEpochRetention({model,source,bank,legacy,additionalGuard:()=>({passed:true}),batchReports:reports});
   return {...retention,epochs:2,batchSize:1,learningRate:.0001,random:seededRandom(79),teacherConsumptionPolicy:'record-only-v1',selectBestEpoch:false,
    async ppoBatchUpdate({optimizer,epoch}){
     const variable=model.layers.actionBias.trainableWeights[0].val,gradient=tf.ones(variable.shape);
     optimizer.applyGradients({[variable.name]:gradient});gradient.dispose();reports.push({epoch,accepted:true,optimizerVariableOrder:[variable.name]});
     return {optimizer,metrics:{loss:0,policyLoss:0,valueLoss:0,entropy:0,approxKl:0,clipFraction:0,optimizerStepApplied:true}};
    }};
  };
  full=deserialize(serialize(source));first=deserialize(serialize(source));const fullOptions=options(full);
  a=await trainRecurrentPpo(full,[trajectory],fullOptions);assert.equal(a.epochGuards.filter(x=>x.passed).length,2);
  assert.ok(a.epochGuards.every(x=>x.report.atomicEpoch.mode==='raw-adam'));assert.equal((await serializeOptimizer(a.optimizer,full.generation)).weights[0].values[0],2);
  b=await trainRecurrentPpo(first,[trajectory],{...options(first),epochs:1,onEpochCheckpoint(x){saved={...x,checkpoint:serialize(first)};}});
  resumed=deserialize(saved.checkpoint);const resumeOptions=options(resumed);resumeOptions.random.setState(saved.randomState);
  c=await trainRecurrentPpo(resumed,[trajectory],{...resumeOptions,optimizer:await restoreAdamOptimizer(saved.optimizerState,.0001),resumeState:JSON.parse(JSON.stringify(saved.selectionState))});
  assert.deepEqual(serialize(full).weights,serialize(resumed).weights);
  const normalized=r=>r.weights.map(x=>[x.shape,x.values]);assert.deepEqual(normalized(await serializeOptimizer(a.optimizer,full.generation)),normalized(await serializeOptimizer(c.optimizer,resumed.generation)));
  assert.equal(fullOptions.random.getState(),resumeOptions.random.getState());
 }finally{for(const r of [a,b,c])r?.optimizer.dispose();for(const m of [source,full,first,resumed])if(m)dispose(m);}
});
test('no accepted minibatch skips legacy correction and cannot become an accepted epoch',async()=>{
 const source=createNeuralModel(),model=deserialize(serialize(source)),optimizer=tf.train.adam(.0001);try{
  const base=serialize(model).weights,retention=atomicPpoEpochRetention({model,source,bank:{training:[],validation:[]},batchReports:[],
   legacy:{beforeEpochGuard(){throw Error('Forbidden wasted correction');}},additionalGuard:()=>({passed:true})});
  await retention.beforeEpochGuard({epoch:1,optimizer});assert.equal(retention.epochGuard().passed,false);assert.deepEqual(serialize(model).weights,base);
 }finally{optimizer.dispose();dispose(source);dispose(model);}
});

for(const reject of [false,true])test(`reconstructed epoch optimizer is ${reject?'atomically rejected':'committed'} by the trainer`,async()=>{
 const source=createNeuralModel(),model=deserialize(serialize(source)),initial=serialize(model).weights;
 const reports=[],random=seededRandom(813),initialRandom=random.getState();let result,checks=0,checkpoint;
 try{
  const trajectory=sample(source,0);delete trajectory.imitation;trajectory.steps[0].imitation=false;trajectory.steps[0].return=1;
  const legacy={policyRehearsalForBatch:()=>null,beforeEpochGuard({epochStartWeights}){
   tf.tidy(()=>model.layers.actionBias.trainableWeights[0].val.assign(tf.add(epochStartWeights.actionBias[0],-.00005)));return {restoreEpochOptimizer:true};
  },epochGuard:()=>({passed:true,report:{passed:true}})};
  const retention=atomicPpoEpochRetention({model,source,bank:{training:[],validation:[]},legacy,batchReports:reports,
   additionalGuard:()=>({passed:++checks>1&&!reject})});
  result=await trainRecurrentPpo(model,[trajectory],{...retention,epochs:1,batchSize:1,learningRate:.0001,random,
   teacherConsumptionPolicy:'record-only-v1',selectBestEpoch:false,onEpochCheckpoint(x){checkpoint=x;},
   async ppoBatchUpdate({optimizer,epoch}){
    const v=model.layers.actionBias.trainableWeights[0].val,g=tf.ones(v.shape);optimizer.applyGradients({[v.name]:g});g.dispose();
    reports.push({epoch,accepted:true,optimizerVariableOrder:[v.name]});
    return {optimizer,metrics:{loss:0,policyLoss:0,valueLoss:0,entropy:0,approxKl:0,clipFraction:0,optimizerStepApplied:true}};
   }});
  assert.equal(result.epochGuards[0].passed,!reject);assert.equal(result.epochGuards[0].report.atomicEpoch.mode,'rebound-adam');
  assert.equal(checkpoint.accepted,!reject);assert.equal(checkpoint.optimizerState.weights[0].values[0],reject?0:1);
  if(reject){assert.deepEqual(serialize(model).weights,initial);assert.equal(random.getState(),initialRandom);}
  else {assert.notDeepEqual(serialize(model).weights,initial);assert.equal(checkpoint.optimizerState.weights.length,3);
   const before=snapshot(model),restored=await restoreAdamOptimizer(checkpoint.optimizerState,.0001);
   try{const v=model.layers.actionBias.trainableWeights[0].val,g=tf.ones(v.shape);
    result.optimizer.applyGradients({[v.name]:g});const expected=serialize(model).weights;
    for(const [name,weights]of Object.entries(before))model.layers[name].setWeights(weights);
    restored.applyGradients({[v.name]:g});g.dispose();assert.deepEqual(serialize(model).weights,expected);
   }finally{restored.dispose();release(before);}
  }
 }finally{result?.optimizer.dispose();dispose(source);dispose(model);}
});

test('ordinary trainer without repair hooks remains bit-identical to the previous runtime',async()=>{
 const baseline=process.env.RIFTBOUND_BASELINE_RUNTIME;assert.ok(baseline);
 const old=await import(pathToFileURL(path.join(baseline,'src/ai/neural/trainer.mjs')));
 const source=createNeuralModel(),a=deserialize(serialize(source)),b=deserialize(serialize(source));let ar,br;
 try{
  const trajectory=sample(source,0);delete trajectory.imitation;trajectory.steps[0].imitation=false;trajectory.steps[0].return=1;
  const ra=seededRandom(948),rb=seededRandom(948),opts={epochs:2,batchSize:1,learningRate:.0001,teacherConsumptionPolicy:'record-only-v1',selectBestEpoch:false};
  ar=await old.trainRecurrentPpo(a,[trajectory],{...opts,random:ra});br=await trainRecurrentPpo(b,[trajectory],{...opts,random:rb});
  assert.deepEqual(serialize(a).weights,serialize(b).weights);assert.equal(ra.getState(),rb.getState());
  const normalize=s=>s.weights.map(w=>[w.shape,w.values]);assert.deepEqual(normalize(await old.serializeOptimizer(ar.optimizer,a.generation)),normalize(await serializeOptimizer(br.optimizer,b.generation)));
 }finally{ar?.optimizer.dispose();br?.optimizer.dispose();[source,a,b].forEach(dispose);}
});
