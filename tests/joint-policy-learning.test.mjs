import test from 'node:test';
import assert from 'node:assert/strict';
import {JOINT_POLICY_LEARNING,validateJointPolicyLearning,commitJointPolicyLearning,policyRehearsalSchedule,interpolateEpochWeights,jointPpoLessonRetention,trainingMarginReferences,restoreTrainingChoiceMargins} from '../scripts/joint-policy-learning.mjs';
import {ACTION_DIM,STATE_DIM,NEURAL_HIDDEN_SIZE} from '../src/ai/neural/encoding.mjs';
import {createNeuralModel,createNeuralSession,serializeNeuralModel,deserializeNeuralModel,disposeNeuralModel,trainPpoBatch,inferStep} from '../src/ai/neural/model.mjs';
import {packPpoBatch,trainRecurrentPpo,restoreAdamOptimizer} from '../src/ai/neural/trainer.mjs';
import {enumerateLegalActions} from '../src/ai/actions.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
import {lessonInputKey,tacticalLessonDigest} from '../scripts/tactical-lesson-learning.mjs';
import {seededRandom} from '../src/ai/neural/selfplay.mjs';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
const maintenance={roundsPerEpoch:2,maximumStep:.0003,backtracks:6};
const protocol=()=>({contract:JOINT_POLICY_LEARNING,afterIteration:200,maintenanceHash:tacticalLessonDigest(maintenance),rehearsalCoefficient:.25,examplesPerType:2,maximumRetentionPasses:8,maximumRetentionStep:.0003,updateFractions:[1,.5,.25,.125,.0625,.03125,.015625]});
function sample(model){
 const {game}=tacticalPosition(),d=createNeuralSession(model).decide(game,'p1',enumerateLegalActions(game,'p1'),{greedy:true});
 return {gameId:'joint',playerId:'p1',completed:true,imitation:true,lessonRole:'training',steps:[{state:d.stateEncoding,actions:d.actionEncoding,initialMemory:d.initialMemory,legalCount:d.legalCount,
 legalActionKeys:Array.from({length:d.legalCount},(_,i)=>`a-${i}`),selectedActionKey:`a-${d.selectedIndex}`,selectedIndex:d.selectedIndex,oldLogProbability:d.logProbability,
 beliefTarget:new Float32Array(d.belief.length),imitation:true,winProbabilityLabel:false,return:0,value:0,advantage:1,localResourceLesson:true}]};
}
const weights=m=>Object.fromEntries(Object.entries(m.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));
const release=w=>Object.values(w).flat().forEach(t=>t.dispose());
test('joint protocol is immutable, prospective and bound to existing maintenance',()=>{
 const p=protocol(),s={iteration:200,lessonMaintenanceHash:p.maintenanceHash};commitJointPolicyLearning(s,p);
 assert.throws(()=>commitJointPolicyLearning(s,null));assert.throws(()=>commitJointPolicyLearning(s,{...p,afterIteration:201}));
 assert.throws(()=>commitJointPolicyLearning({iteration:201,lessonMaintenanceHash:p.maintenanceHash},p));
 assert.throws(()=>commitJointPolicyLearning({iteration:200,lessonMaintenanceHash:'b'.repeat(64)},p));
 assert.throws(()=>validateJointPolicyLearning({...p,updateFractions:[1,0]}));
});
test('replay rotates deterministically and excludes all protected validation inputs',()=>{
 const m=createNeuralModel();try{
  const a=sample(m),b=structuredClone(a);b.steps[0].state[0]+=.5;
  const c=structuredClone(a);c.steps[0].state[0]+=.25;
  const bank={training:[a,b,c],validation:[]},schedule=policyRehearsalSchedule(bank,protocol());
  assert.deepEqual(schedule({epoch:2,batch:3}),policyRehearsalSchedule(bank,protocol())({epoch:2,batch:3}));
  assert.notDeepEqual(schedule({epoch:1,batch:0}).batch.states,schedule({epoch:1,batch:1}).batch.states);
  const held=structuredClone(a);held.lessonRole='validation';
  assert.throws(()=>policyRehearsalSchedule({training:[held],validation:[]},protocol()));
  assert.throws(()=>policyRehearsalSchedule({training:[a],validation:[held]},protocol()),/overlap/);
  assert.throws(()=>policyRehearsalSchedule({training:[a],validation:[],protectedValidationKeys:[lessonInputKey(a)]},protocol()),/overlap/);
 }finally{disposeNeuralModel(m);}
});
test('verified replay trains real policy preference without synthetic value or belief labels',()=>{
 const m=createNeuralModel(),optimizer=tf.train.sgd(.001);try{
  const s=sample(m),step=s.steps[0],bank={training:[s],validation:[]},before=serializeNeuralModel(m).weights;
  const target=()=>{const a=inferStep(m,step.state,step.actions,step.legalCount,step.initialMemory).logits;return a[step.selectedIndex]-Math.log(a.reduce((v,x)=>v+Math.exp(x-Math.max(...a)),0))-Math.max(...a);};
  const prior=target(),count=tf.memory().numTensors;
  const r=trainPpoBatch(m,packPpoBatch([s]),optimizer,{policyCoefficient:0,valueCoefficient:0,actionValueCoefficient:0,diagnosticCoefficient:0,beliefCoefficient:0,entropyCoefficient:0,teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,anchorCoefficient:0,
   policyRehearsal:policyRehearsalSchedule(bank,protocol())({epoch:1,batch:0})});
  assert.ok(Number.isFinite(r.policyRehearsalLoss));assert.ok(target()>prior);
  assert.ok(Math.abs(r.loss-r.baseLoss-r.policyRehearsalContribution)<1e-7);
  assert.equal(r.policyRehearsalContribution,.25*r.policyRehearsalLoss);
  const after=serializeNeuralModel(m).weights;
  for(const n of ['value','belief'])assert.deepEqual(after[n],before[n]);
  assert.equal(tf.memory().numTensors,count);
 }finally{optimizer.dispose();disposeNeuralModel(m);}
});
test('fractional recovery always starts from the original proposal and epoch baseline',()=>{
 const m=createNeuralModel(),base=weights(m);let proposed;
 try{
  for(const [n,w]of Object.entries(base))tf.tidy(()=>m.layers[n].setWeights(w.map(t=>tf.add(t,.01))));
  proposed=weights(m);interpolateEpochWeights(m,base,proposed,.5);interpolateEpochWeights(m,base,proposed,.25);
  for(const [n,w]of Object.entries(base))for(let i=0;i<w.length;i++){
   const a=w[i].dataSync(),b=m.layers[n].getWeights()[i].dataSync();
   assert.ok(b.every((v,j)=>Math.abs(v-a[j]-.0025)<1e-6));
  }
 }finally{release(base);if(proposed)release(proposed);disposeNeuralModel(m);}
});

test('epoch loss components add up when only some batches carry rehearsal',async()=>{
 const m=createNeuralModel();let trained;
 try{
  const s=sample(m),schedule=policyRehearsalSchedule({training:[s],validation:[]},protocol());
  const trajectories=Array.from({length:3},(_,i)=>{const t=structuredClone(s);t.gameId=`loss-${i}`;delete t.imitation;delete t.steps[0].imitation;return t;});
  let checked=false;
  trained=await trainRecurrentPpo(m,trajectories,{epochs:1,batchSize:1,learningRate:.0001,random:seededRandom(23),teacherConsumptionPolicy:'record-only-v1',
   policyRehearsalForBatch:args=>args.batch===0?schedule(args):undefined,
   onEpoch({metrics}){checked=true;assert.ok(metrics.meanPolicyRehearsalContribution>0);
    assert.ok(Math.abs(metrics.meanLoss-metrics.meanBaseLoss-metrics.meanPolicyRehearsalContribution)<1e-7);}});
  assert.equal(checked,true);
 }finally{trained?.optimizer.dispose();disposeNeuralModel(m);}
});
test('training margin projection repairs a forgotten close choice without touching other heads or leaking tensors',()=>{
 const m=createNeuralModel();try{
  for(const n of ['stateProjection','actionProjection','actionBias'])tf.tidy(()=>m.layers[n].setWeights(m.layers[n].getWeights().map(w=>tf.zeros(w.shape))));
  const setBias=x=>tf.tidy(()=>{const w=m.layers.actionBias.getWeights(),values=new Float32Array(w[0].size);values[0]=x;m.layers.actionBias.setWeights([tf.tensor(values,w[0].shape),tf.zeros(w[1].shape)]);});
  setBias(.001);
  const actions=new Float32Array(2*ACTION_DIM);actions[0]=1;
  const s={gameId:'margin',imitation:true,lessonRole:'training',steps:[{state:new Float32Array(STATE_DIM),actions,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),
   legalCount:2,legalActionKeys:['correct','wrong'],selectedActionKey:'correct',selectedIndex:0,imitation:true,winProbabilityLabel:false,return:0,value:0,advantage:1,localResourceLesson:true}]};
  const bank={training:[s],validation:[]},references=trainingMarginReferences(m,bank);assert.equal(references[0].correct,true);
  setBias(-.0001);assert.equal(trainingMarginReferences(m,bank)[0].correct,false);
  const before=serializeNeuralModel(m).weights,tensors=tf.memory().numTensors,result=restoreTrainingChoiceMargins(m,bank,references,protocol());
  assert.ok(result.steps>0);assert.equal(result.lostTrainingChoices,0);assert.equal(trainingMarginReferences(m,bank)[0].correct,true);
  const after=serializeNeuralModel(m).weights;for(const n of Object.keys(before))if(!['stateProjection','actionProjection','actionBias'].includes(n))assert.deepEqual(after[n],before[n]);
  assert.equal(tf.memory().numTensors,tensors);
  assert.throws(()=>restoreTrainingChoiceMargins(m,{training:[s],validation:[],protectedValidationKeys:[lessonInputKey(s)]},references,protocol()),/held-out/);
 }finally{disposeNeuralModel(m);}
});
test('projected joint training resumes model, Adam and random state exactly; rejection stays atomic',async()=>{
 const source=createNeuralModel(),first=deserializeNeuralModel(serializeNeuralModel(source)),full=deserializeNeuralModel(serializeNeuralModel(source));
 let resumed,trained1,trained2,trainedFull,rejected,restore;
 try{
  const s=sample(source),trajectory=structuredClone(s);delete trajectory.imitation;delete trajectory.steps[0].imitation;
  trajectory.steps[0].return=1;const bank={training:[s],validation:[]},frozen={bank,source:'fixture',sourceSha256:'a'.repeat(64)};
  const options=m=>{const joint=jointPpoLessonRetention(m,source,frozen,maintenance,protocol());return {...joint,epochs:2,batchSize:1,learningRate:.0001,random:seededRandom(123),teacherConsumptionPolicy:'record-only-v1',beforeEpochGuard(args){
    // Exercise checkpointing after an actual fractional policy projection.
    const proposal=weights(m);try{interpolateEpochWeights(m,args.epochStartWeights,proposal,.5);}finally{release(proposal);}
    joint.beforeEpochGuard(args);
  }};};
  trainedFull=await trainRecurrentPpo(full,[trajectory],options(full));
  assert.ok(full.metadata.acceptedEpochs>0);
  trained1=await trainRecurrentPpo(first,[trajectory],{...options(first),epochs:1,onEpochCheckpoint(item){restore={...item,checkpoint:serializeNeuralModel(first)};}});
  resumed=deserializeNeuralModel(restore.checkpoint);const optimizer=await restoreAdamOptimizer(restore.optimizerState,.0001),opts=options(resumed);opts.random.setState(restore.randomState);
  trained2=await trainRecurrentPpo(resumed,[trajectory],{...opts,optimizer,resumeState:restore.selectionState});
  assert.deepEqual(serializeNeuralModel(resumed).weights,serializeNeuralModel(full).weights);
  const baseline=serializeNeuralModel(first).weights;
  rejected=await trainRecurrentPpo(first,[trajectory],{...options(first),epochGuard:()=>({passed:false})});
  assert.equal(first.metadata.acceptedEpochs,0);assert.deepEqual(serializeNeuralModel(first).weights,baseline);
 }finally{for(const t of [trained1,trained2,trainedFull,rejected])t?.optimizer.dispose();for(const m of [source,first,full,resumed])if(m)disposeNeuralModel(m);}
});
