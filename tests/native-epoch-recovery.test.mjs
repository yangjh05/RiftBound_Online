import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;assert.ok(runtime);
const load=f=>import(pathToFileURL(path.join(runtime,f)));
const {tf,tfBackend}=await load('src/ai/neural/tf-runtime.mjs');assert.equal(tfBackend,'tensorflow');
const {createNeuralModel,serializeNeuralModel:serialize,deserializeNeuralModel:deserialize,disposeNeuralModel:dispose}=await load('src/ai/neural/model.mjs');
const {serializeOptimizer,restoreAdamOptimizer}=await load('src/ai/neural/trainer.mjs');
const {atomicPpoEpochRetention}=await load('scripts/transactional-epoch-commit.mjs');
const {individualTransactionalPolicyUpdater}=await load('scripts/individual-transactional-policy.mjs');
const {packPpoBatch}=await load('src/ai/neural/trainer.mjs');
const {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS}=await load('src/ai/neural/encoding.mjs');
const {CONSTRAINED_DEFAULTS}=await load('scripts/constrained-policy-learning.mjs');
const snapshot=m=>Object.fromEntries(Object.entries(m.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));
for(const reject of [false,true])test(`native epoch recovery ${reject?'rejects without weakening gates':'commits reachable weights and matching Adam'}`,async()=>{
 const source=createNeuralModel(),model=deserialize(serialize(source)),optimizer=tf.train.adam(.0001),base=snapshot(model),state=await serializeOptimizer(optimizer,1);
 let replacement=null,calls=0;
 try{
  const v=model.layers.actionBias.trainableWeights[0].val;
  tf.tidy(()=>v.assign(tf.add(v,.002))); // Far beyond a single Adam displacement.
  const retention=atomicPpoEpochRetention({model,source,bank:{training:[],validation:[]},reachableRecovery:true,
    legacy:{beforeEpochGuard(){throw Error('Legacy arbitrary-weight recovery is forbidden');}},
    additionalGuard:()=>({passed:++calls>1&&!reject}),batchReports:[{epoch:1,accepted:true,nativeStepsCommitted:2,optimizerVariableOrder:[v.name]}]});
  const action=await retention.beforeEpochGuard({epoch:1,epochStartWeights:base,optimizerSnapshot:state,optimizer});replacement=action.optimizer;
  const result=retention.epochGuard();assert.equal(result.passed,!reject);assert.ok(result.report.atomicEpoch.attempts.length<=14);
  assert.ok(result.report.atomicEpoch.attempts.every(a=>a.steps<=2));assert.deepEqual(await serializeOptimizer(optimizer,1),state);
  if(reject){assert.equal(replacement,undefined);assert.deepEqual(serialize(model).weights,serialize(source).weights);}
  else{
   assert.ok(replacement);const saved=await serializeOptimizer(replacement,1);assert.equal(saved.weights[0].values[0],2);
   const weights=snapshot(model),resumed=await restoreAdamOptimizer(saved,.0001),g=tf.ones(v.shape);
   try{replacement.applyGradients({[v.name]:g});const expected=Array.from(v.dataSync());model.layers.actionBias.setWeights(weights.actionBias);
    resumed.applyGradients({[v.name]:g});assert.deepEqual(Array.from(v.dataSync()),expected);
   }finally{resumed.dispose();g.dispose();Object.values(weights).flat().forEach(w=>w.dispose());}
  }
 }finally{replacement?.dispose();optimizer.dispose();Object.values(base).flat().forEach(w=>w.dispose());dispose(source);dispose(model);}
});
test('a reference violation can cross several provisional native steps with one atomic minibatch commit',async()=>{
 const champion=createNeuralModel();for(const layer of Object.values(champion.layers))for(const weight of layer.trainableWeights)tf.tidy(()=>weight.val.assign(tf.zeros(weight.val.shape)));
 const source=deserialize(serialize(champion));tf.tidy(()=>{const v=source.layers.actionBias.trainableWeights[0].val,a=Float32Array.from(v.dataSync());a[20]=.0008;v.assign(tf.tensor(a,v.shape));});
 const model=deserialize(serialize(source));let optimizer=tf.train.adam(.0001);
 try{
  const state=new Float32Array(STATE_DIM),actions=new Float32Array(2*ACTION_DIM);actions[6]=1;actions[ACTION_DIM+20]=1;
  const make=(selected,advantage)=>({state,actions,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),legalCount:2,selectedIndex:selected,
   oldLogProbability:-Math.log(2),behaviorTemperature:1,advantage,return:0,value:0,beliefTarget:new Float32Array(CARD_BINS),imitation:false,winProbabilityLabel:true});
  const trajectory={playerId:'p1',gameId:'fixture',steps:[make(0,1),make(1,-1)]};
  const sample={lessonRole:'training',imitation:true,playerId:'p1',steps:[{...make(0,1),imitation:true,winProbabilityLabel:false,responsePolicyLesson:true,
    legalActionKeys:['a','b'],selectedActionKey:'a'}]};
  const reports=[],setup={trajectories:[trajectory],source,champion,trainingGroups:[{id:'test',samples:[sample]}],config:{...CONSTRAINED_DEFAULTS,maximumChampionKl:0},
    protectedKeys:new Set(),rehearsalForBatch:()=>null,onBatch:r=>reports.push(r)},update=individualTransactionalPolicyUpdater(setup);
  optimizer=(await update({model,batch:packPpoBatch([trajectory],{ignoreCorrectionSignals:true}),chunks:[trajectory],optimizer,epoch:1,batchIndex:0,
    options:{teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,beliefCoefficient:0,anchorCoefficient:.05}})).optimizer;
  const r=reports[0];assert.equal(r.requiredRecoveryCases,1);assert.equal(r.accepted,true,JSON.stringify(r));
  assert.ok(r.nativeStepsCommitted>1&&r.nativeStepsCommitted<=7);assert.ok(r.nativeTrialSteps<=14);
  assert.equal((await serializeOptimizer(optimizer,model.generation)).weights[0].values[0],r.nativeStepsCommitted);
  assert.ok(r.attempts.some(a=>a.provisional));assert.ok(r.attempts.at(-1).retention.every(g=>g.passed));
  assert.ok(r.attempts.some(a=>a.currentConstraintTypes?.includes('recovery-champion-kl')));
  assert.ok(r.attempts.filter(a=>a.recoveryStep).every(a=>a.currentConstraintTypes.includes('recovery-policy')));
  // A deliberately stricter endpoint objective must reject even after a real
  // provisional update, restoring both tensors and optimizer bits exactly.
  for(const [name,layer]of Object.entries(source.layers))model.layers[name].setWeights(layer.getWeights());
  optimizer.dispose();optimizer=tf.train.adam(.0001);const before=await serializeOptimizer(optimizer,model.generation);
  const reject=individualTransactionalPolicyUpdater({...setup,config:{...CONSTRAINED_DEFAULTS,tolerance:1}});
  optimizer=(await reject({model,batch:packPpoBatch([trajectory],{ignoreCorrectionSignals:true}),chunks:[trajectory],optimizer,epoch:2,batchIndex:0,
    options:{teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,beliefCoefficient:0,anchorCoefficient:.05}})).optimizer;
  assert.equal(reports[1].accepted,false);assert.equal(reports[1].nativeStepsCommitted,0);assert.ok(reports[1].attempts.some(a=>a.provisional));
  assert.deepEqual(serialize(model).weights,serialize(source).weights);assert.deepEqual(await serializeOptimizer(optimizer,model.generation),before);
 }finally{optimizer.dispose();[champion,source,model].forEach(dispose);}
});
