import test from 'node:test';
import assert from 'node:assert/strict';
import {PPO_BLOCK_RECOVERY,validatePpoBlockRecovery,commitPpoBlockRecovery,blockPpoLessonRetention} from '../scripts/ppo-block-recovery.mjs';
import {JOINT_POLICY_LEARNING} from '../scripts/joint-policy-learning.mjs';
import {tacticalLessonDigest,lessonInputKey} from '../scripts/tactical-lesson-learning.mjs';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {createNeuralModel,deserializeNeuralModel,serializeNeuralModel,disposeNeuralModel,inferStep} from '../src/ai/neural/model.mjs';
import {trainRecurrentPpo,restoreAdamOptimizer,serializeOptimizer} from '../src/ai/neural/trainer.mjs';
import {ACTION_DIM,STATE_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS} from '../src/ai/neural/encoding.mjs';
import {seededRandom} from '../src/ai/neural/selfplay.mjs';
const maintenance={roundsPerEpoch:2,maximumStep:.0003,backtracks:6};
const joint={contract:JOINT_POLICY_LEARNING,afterIteration:200,maintenanceHash:tacticalLessonDigest(maintenance),rehearsalCoefficient:.25,examplesPerType:2,maximumRetentionPasses:8,maximumRetentionStep:.0003,updateFractions:[1,.5,.25,.125,.0625,.03125,.015625]};
const protocol=()=>({contract:PPO_BLOCK_RECOVERY,afterIteration:209,jointLearningHash:tacticalLessonDigest(joint),repairFractions:[0,.125,.25,.5,1],optimizerPolicy:'restore-epoch-start-on-projection'});
const sample=()=>{const actions=new Float32Array(2*ACTION_DIM);actions[0]=1;return {gameId:'recovery',completed:true,imitation:true,lessonRole:'training',steps:[{
 state:new Float32Array(STATE_DIM),actions,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),beliefTarget:new Float32Array(CARD_BINS),legalCount:2,selectedIndex:0,
 legalActionKeys:['correct','wrong'],selectedActionKey:'correct',imitation:true,winProbabilityLabel:false,return:0,value:0,advantage:1,localResourceLesson:true,oldLogProbability:-Math.log(2)}]};};
test('block recovery is prospective, immutable and bound to the joint training contract',()=>{
 const p=protocol(),state={iteration:209,jointPolicyLearningHash:p.jointLearningHash};commitPpoBlockRecovery(state,p);
 assert.throws(()=>commitPpoBlockRecovery(state,null));assert.throws(()=>commitPpoBlockRecovery(state,{...p,afterIteration:210}));
 assert.throws(()=>commitPpoBlockRecovery({iteration:210,jointPolicyLearningHash:p.jointLearningHash},p));
 assert.throws(()=>commitPpoBlockRecovery({iteration:209,jointPolicyLearningHash:'a'.repeat(64)},p));
 assert.throws(()=>validatePpoBlockRecovery({...p,repairFractions:[0,1]}));
});
test('a harmful action-head proposal can preserve a real memory update without changing held-out labels',()=>{
 const source=createNeuralModel();let model,base;
 try{
  for(const n of ['stateProjection','actionProjection','actionBias','actionValue'])tf.tidy(()=>source.layers[n].setWeights(source.layers[n].getWeights().map(w=>tf.zeros(w.shape))));
  const bias=(m,x)=>tf.tidy(()=>{const w=m.layers.actionBias.getWeights(),v=new Float32Array(w[0].size);v[0]=x;m.layers.actionBias.setWeights([tf.tensor(v,w[0].shape),tf.zeros(w[1].shape)]);});
  bias(source,.001);model=deserializeNeuralModel(serializeNeuralModel(source));
  base=Object.fromEntries(Object.entries(model.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));
  const training=sample(),held=sample();held.lessonRole='validation';held.steps[0].state[1]=1;
  const bank={training:[training],validation:[held]},frozen={bank,source:'fixture',sourceSha256:'a'.repeat(64)},copy=structuredClone(bank);
  const retention=blockPpoLessonRetention(model,source,frozen,maintenance,joint,protocol());
  bias(model,-.1);tf.tidy(()=>model.layers.gru.setWeights(model.layers.gru.getWeights().map(w=>tf.add(w,.0001))));
  const rawMemory=model.layers.gru.getWeights().map(w=>Array.from(w.dataSync())),count=tf.memory().numTensors;
  const projection=retention.beforeEpochGuard({epochStartWeights:base}),guard=retention.epochGuard();
  assert.equal(guard.passed,true);assert.equal(guard.report.blockRecovery.mode,'memory-with-training-repair');
  assert.equal(guard.report.blockRecovery.repairFraction,0);assert.equal(projection.restoreEpochOptimizer,true);
  assert.deepEqual(model.layers.gru.getWeights().map(w=>Array.from(w.dataSync())),rawMemory);
  for(const n of ['stateProjection','actionProjection','actionBias','actionValue'])assert.deepEqual(serializeNeuralModel(model).weights[n],serializeNeuralModel(source).weights[n]);
  assert.deepEqual(bank,copy);assert.equal(guard.report.heldOutLabelsTrained,false);assert.equal(tf.memory().numTensors,count);
  assert.throws(()=>blockPpoLessonRetention(model,source,{...frozen,bank:{...bank,protectedValidationKeys:[lessonInputKey(training)]}},maintenance,joint,protocol()),/overlap/);
 }finally{if(base)Object.values(base).flat().forEach(t=>t.dispose());if(model)disposeNeuralModel(model);disposeNeuralModel(source);}
});
test('projected epochs restore Adam history and resume exactly while keeping accepted weights',async()=>{
 const source=createNeuralModel(),full=deserializeNeuralModel(serializeNeuralModel(source)),first=deserializeNeuralModel(serializeNeuralModel(source));
 let resumed,a,b,c,saved;
 try{
  const trajectory=sample();delete trajectory.imitation;delete trajectory.steps[0].imitation;trajectory.steps[0].return=1;
  const step=trajectory.steps[0],logits=inferStep(source,step.state,step.actions,step.legalCount,step.initialMemory).logits;
  step.oldLogProbability=logits[0]-Math.log(logits.reduce((s,x)=>s+Math.exp(x),0));
  const options=()=>({epochs:2,batchSize:1,learningRate:.0001,random:seededRandom(42),teacherConsumptionPolicy:'record-only-v1',
   beforeEpochGuard:()=>({restoreEpochOptimizer:true}),epochGuard:()=>({passed:true}),selectBestEpoch:false});
  a=await trainRecurrentPpo(full,[trajectory],options());
  b=await trainRecurrentPpo(first,[trajectory],{...options(),epochs:1,onEpochCheckpoint(x){saved={...x,checkpoint:serializeNeuralModel(first)};}});
  const fresh=tf.train.adam(.0001);try{assert.deepEqual(saved.optimizerState,await serializeOptimizer(fresh,saved.optimizerState.modelGeneration));}finally{fresh.dispose();}
  assert.notDeepEqual(saved.checkpoint.weights,serializeNeuralModel(source).weights);
  resumed=deserializeNeuralModel(saved.checkpoint);const opts=options();opts.random.setState(saved.randomState);
  c=await trainRecurrentPpo(resumed,[trajectory],{...opts,optimizer:await restoreAdamOptimizer(saved.optimizerState,.0001),resumeState:saved.selectionState});
  assert.deepEqual(serializeNeuralModel(resumed).weights,serializeNeuralModel(full).weights);
 }finally{for(const t of [a,b,c])t?.optimizer.dispose();for(const m of [source,full,first,resumed])if(m)disposeNeuralModel(m);}
});
