import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EFFICIENT_POLICY_LEARNING,commitEfficientPolicyLearning,validateEfficientPolicyLearning,efficientPpoLessonRetention,supplementalRefreshDecision,decideSupplementalRefresh} from '../scripts/efficient-policy-learning.mjs';
import {JOINT_POLICY_LEARNING} from '../scripts/joint-policy-learning.mjs';
import {PPO_BLOCK_RECOVERY} from '../scripts/ppo-block-recovery.mjs';
import {tacticalLessonDigest} from '../scripts/tactical-lesson-learning.mjs';
import {writeTrajectoryArchive as write} from '../src/ai/neural/archive.mjs';
import {createNeuralModel,deserializeNeuralModel,serializeNeuralModel,disposeNeuralModel,inferStep} from '../src/ai/neural/model.mjs';
import {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS} from '../src/ai/neural/encoding.mjs';
import {trainRecurrentPpo,restoreAdamOptimizer,serializeOptimizer} from '../src/ai/neural/trainer.mjs';
import {seededRandom} from '../src/ai/neural/selfplay.mjs';
const maintenance={roundsPerEpoch:2,maximumStep:.0003,backtracks:6};
const joint={contract:JOINT_POLICY_LEARNING,afterIteration:200,maintenanceHash:tacticalLessonDigest(maintenance),rehearsalCoefficient:.25,examplesPerType:2,maximumRetentionPasses:8,maximumRetentionStep:.0003,updateFractions:[1,.5,.25,.125,.0625,.03125,.015625]};
const block={contract:PPO_BLOCK_RECOVERY,afterIteration:209,jointLearningHash:tacticalLessonDigest(joint),repairFractions:[0,.125,.25,.5,1],optimizerPolicy:'restore-epoch-start-on-projection'};
const protocol=()=>({contract:EFFICIENT_POLICY_LEARNING,afterIteration:273,jointLearningHash:tacticalLessonDigest(joint),blockRecoveryHash:tacticalLessonDigest(block),minimumDescentRatio:.01,fractions:[1,.5,.25,.125,.0625,.03125,.015625],refreshFailuresBeforeSkip:2,maximumConsecutiveRefreshSkips:1});
test('efficiency is prospective and cannot silently alter committed behavior',()=>{
 const p=protocol(),state={iteration:273,jointPolicyLearningHash:p.jointLearningHash,ppoBlockRecoveryHash:p.blockRecoveryHash};
 commitEfficientPolicyLearning(state,p);assert.throws(()=>commitEfficientPolicyLearning(state,null));assert.throws(()=>commitEfficientPolicyLearning(state,{...p,afterIteration:274}));
 assert.throws(()=>commitEfficientPolicyLearning({...state,efficientPolicyLearningHash:null,iteration:274},p));
 assert.throws(()=>validateEfficientPolicyLearning({...p,minimumDescentRatio:0}));
});
test('only two completed no-benefit refreshes allow one skip; missing coverage, resumption and next slot stay mandatory',()=>{
 const no={outcome:'no-held-out-fit-improvement',bestEpoch:0},recent=[no,no];
 assert.equal(supplementalRefreshDecision({recent}).collect,false);
 for(const extra of [{mandatory:true},{started:true},{previousSkipped:true}])assert.equal(supplementalRefreshDecision({recent,...extra}).collect,true);
 for(const history of [[],[no],[{outcome:'updated',bestEpoch:1},no],[{outcome:'insufficient-demonstrations',bestEpoch:0},no]])assert.equal(supplementalRefreshDecision({recent:history}).collect,true);
});
test('cadence decisions are durable, source-bound and cannot skip twice across restart',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'riftbound-efficiency-'));
 try{
  const p=protocol(),input=path.join(root,'input.json.gz');await write(input,{immutable:'source'});
  for(const i of [257,265])await write(path.join(root,'tactical-refresh',String(i).padStart(6,'0'),'checkpoint.json.gz'),{outcome:'no-held-out-fit-improvement',bestEpoch:0});
  const first=await decideSupplementalRefresh(root,281,input,p);assert.equal(first.collect,false);
  assert.deepEqual(await decideSupplementalRefresh(root,281,input,p),first);
  assert.equal((await decideSupplementalRefresh(root,289,input,p)).collect,true);
  await write(input,{immutable:'changed'});await assert.rejects(decideSupplementalRefresh(root,281,input,p));
 }finally{const relative=path.relative(os.tmpdir(),root);assert.ok(relative.startsWith('riftbound-efficiency-')&&!relative.includes(path.sep));await fs.rm(root,{recursive:true,force:true});}
});
test('training-projected PPO resumes accepted model and optimizer exactly',async()=>{
 const source=createNeuralModel(),full=deserializeNeuralModel(serializeNeuralModel(source)),first=deserializeNeuralModel(serializeNeuralModel(source));let a,b,c,resumed,saved;
 try{
  const actions=new Float32Array(2*ACTION_DIM);actions[0]=1;const state=new Float32Array(STATE_DIM);state[1]=1;
  const step={state,actions,initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),beliefTarget:new Float32Array(CARD_BINS),legalCount:2,legalActionKeys:['a','b'],return:0,value:0,advantage:1,imitation:true,winProbabilityLabel:false,localResourceLesson:true};
  const logits=inferStep(source,state,actions,2,step.initialMemory).logits;step.selectedIndex=logits.indexOf(Math.max(...logits));step.selectedActionKey=step.legalActionKeys[step.selectedIndex];step.oldLogProbability=logits[step.selectedIndex]-Math.log(logits.reduce((s,x)=>s+Math.exp(x),0));
  const lesson={gameId:'efficient',completed:true,imitation:true,lessonRole:'training',steps:[step]},frozen={source:'fixture',sourceSha256:'a'.repeat(64),bank:{training:[lesson],validation:[]}};
  const trajectory=structuredClone(lesson);delete trajectory.imitation;delete trajectory.steps[0].imitation;trajectory.steps[0].return=1;
  const opts=model=>({...efficientPpoLessonRetention(model,source,frozen,maintenance,joint,block,protocol()),epochs:2,batchSize:1,learningRate:.0001,random:seededRandom(69),teacherConsumptionPolicy:'record-only-v1',selectBestEpoch:false});
  a=await trainRecurrentPpo(full,[trajectory],opts(full));assert.ok(full.metadata.acceptedEpochs>0);
  assert.ok(a.epochGuards.some(g=>g.report.efficiency.mode==='training-projected-adam'));
  b=await trainRecurrentPpo(first,[trajectory],{...opts(first),epochs:1,onEpochCheckpoint(x){saved={...x,checkpoint:serializeNeuralModel(first)};}});
  // Real archive persistence converts the uninitialized -Infinity scores
  // to null; preserve the same generation/selection after that round trip.
  saved.selectionState=JSON.parse(JSON.stringify(saved.selectionState));
  resumed=deserializeNeuralModel(saved.checkpoint);const options=opts(resumed);options.random.setState(saved.randomState);
  c=await trainRecurrentPpo(resumed,[trajectory],{...options,optimizer:await restoreAdamOptimizer(saved.optimizerState,.0001),resumeState:saved.selectionState});
  assert.deepEqual(serializeNeuralModel(full).weights,serializeNeuralModel(resumed).weights);
  assert.equal(full.generation,resumed.generation);assert.equal(full.gamesTrained,resumed.gamesTrained);
  assert.equal(full.metadata.selectedEpoch,resumed.metadata.selectedEpoch);
  assert.deepEqual(await serializeOptimizer(a.optimizer,full.generation),await serializeOptimizer(c.optimizer,resumed.generation));
 }finally{for(const r of [a,b,c])r?.optimizer.dispose();for(const m of [source,full,first,resumed])if(m)disposeNeuralModel(m);}
});
