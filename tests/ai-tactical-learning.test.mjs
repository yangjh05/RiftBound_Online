import test from 'node:test';
import assert from 'node:assert/strict';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {createNeuralModel,createNeuralSession,serializeNeuralModel,deserializeNeuralModel,
  disposeNeuralModel,trainBehaviorCloningBatch,trainPpoBatch,evaluatePpoBatchPolicyRatios} from '../src/ai/neural/model.mjs';
import {packPpoBatch} from '../src/ai/neural/trainer.mjs';
import {criticalTacticalDecisionProfile} from '../src/ai/neural/selfplay.mjs';
import {enumerateAiPolicyActions,actionKey} from '../src/ai/actions.mjs';
import {recommendPublicTacticalAction} from '../src/ai/tactical-baseline.mjs';
import {ACTION_DIM,CARD_BINS} from '../src/ai/neural/encoding.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';

test('tactical initialization learns a preference without changing GRU, value, Q or belief head weights',()=>{
 const model=createNeuralModel(),optimizer=tf.train.adam(0.003);
 const {game}=tacticalPosition(),legal=enumerateAiPolicyActions(game);
 const advice=recommendPublicTacticalAction(game,'p1',legal);
 const read=()=>createNeuralSession(model).decide(game,'p1',legal,{greedy:true,temperature:1});
 const initial=read(),index=initial.legalActions.findIndex(a=>actionKey(a)===actionKey(advice.action));
 const values=names=>Object.fromEntries(names.map(name=>[name,model.layers[name].trainableWeights.map(w=>Array.from(w.val.dataSync()))]));
 const unchangedNames=['gru','value','actionValue','belief','diagnostic','teacherProposalValue'];
 const before=values(unchangedNames);
 const step={state:initial.stateEncoding,actions:initial.actionEncoding.slice(0,initial.legalCount*ACTION_DIM),
   initialMemory:initial.initialMemory,selectedIndex:index,legalCount:initial.legalCount,
   oldLogProbability:0,behaviorTemperature:1,advantage:1,return:0,imitation:true,beliefTarget:new Float32Array(CARD_BINS)};
 const batch=packPpoBatch([{steps:[step]}]);
 try{
  for(let i=0;i<12;i++)trainBehaviorCloningBatch(model,batch,optimizer,{policyInitializationOnly:true,entropyCoefficient:0.02});
  const after=read();
  assert.ok(after.probabilities[index]>initial.probabilities[index]+0.1);
  assert.deepEqual(values(unchangedNames),before);
  const held=after.legalActions.findIndex(a=>a.kind==='endTurn');
  assert.ok(held>=0&&after.probabilities[held]>0,'holding must remain learnable');
  const restored=deserializeNeuralModel(serializeNeuralModel(model));
  try{assert.deepEqual(createNeuralSession(restored).decide(game,'p1',legal,{temperature:1,greedy:true}).probabilities,after.probabilities);}
  finally{disposeNeuralModel(restored);}
  const policyStep={...step,imitation:false,selectedIndex:held,
    oldLogProbability:Math.log(after.probabilities[held]),advantage:1};
  const ppoBatch=packPpoBatch([{steps:[policyStep]}, {steps:[{...policyStep,selectedIndex:index,
    oldLogProbability:Math.log(after.probabilities[index]),advantage:-1}]}]);
  assert.ok(Math.abs(evaluatePpoBatchPolicyRatios(model,ppoBatch)[0]-1)<1e-5);
  const ppo=tf.train.adam(0.001);
  try{trainPpoBatch(model,ppoBatch,ppo,{entropyCoefficient:0.01,valueCoefficient:0,actionValueCoefficient:0,
    beliefCoefficient:0,diagnosticCoefficient:0,teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0});}
  finally{ppo.dispose();}
  assert.ok(read().probabilities[held]>after.probabilities[held],'PPO can override the initialized preference');
 }finally{optimizer.dispose();disposeNeuralModel(model);}
});

test('tactical review compares an initiating action with resource reserve',()=>{
 const {game}=tacticalPosition(),legal=enumerateAiPolicyActions(game);
 const action=recommendPublicTacticalAction(game,'p1',legal).action;
 const profile=criticalTacticalDecisionProfile(game,'p1',{action,legalActions:legal,legalCount:legal.length});
 assert.ok(profile.types.includes('tactical-action-versus-reserve'));
 assert.ok(profile.requiredActions.some(a=>a.kind==='endTurn'));
});
