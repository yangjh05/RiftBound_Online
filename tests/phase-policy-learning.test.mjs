import test from 'node:test';
import assert from 'node:assert/strict';
import {PHASE_POLICY_LEARNING,commitPhasePolicyLearning,rotatingPolicyRehearsal,PLAY_ONLY_ACTION_ROWS,applyPlayOnlyProjection,phasePpoLessonRetention} from '../scripts/phase-policy-learning.mjs';
import {createNeuralModel,serializeNeuralModel,deserializeNeuralModel,disposeNeuralModel,inferStep} from '../src/ai/neural/model.mjs';
import {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS,encodeAction} from '../src/ai/neural/encoding.mjs';
import {tf} from '../src/ai/neural/tf-runtime.mjs';
import {lessonInputKey,tacticalLessonDigest} from '../scripts/tactical-lesson-learning.mjs';
import {JOINT_POLICY_LEARNING,jointPpoLessonRetention} from '../scripts/joint-policy-learning.mjs';
import {PPO_BLOCK_RECOVERY,blockPpoLessonRetention} from '../scripts/ppo-block-recovery.mjs';
import {EFFICIENT_POLICY_LEARNING,efficientPpoLessonRetention} from '../scripts/efficient-policy-learning.mjs';
import {trainRecurrentPpo,restoreAdamOptimizer,serializeOptimizer} from '../src/ai/neural/trainer.mjs';
import {seededRandom} from '../src/ai/neural/selfplay.mjs';
import {measureLessonRetention,lessonSafetyGuard} from '../scripts/lesson-maintenance.mjs';
import {tacticalPosition} from './fixtures/ai-tactical-position.mjs';
const protocol=()=>({contract:PHASE_POLICY_LEARNING,afterIteration:280,efficientLearningHash:'a'.repeat(64),fractions:[1,.5,.25,.125,.0625,.03125,.015625],replayIterationStride:17,minimumDescentRatio:.01,maximumProjectionNormRatio:2});
const snapshot=m=>Object.fromEntries(Object.entries(m.layers).map(([n,l])=>[n,l.getWeights().map(w=>w.clone())]));
const release=s=>Object.values(s).flat().forEach(w=>w.dispose());
test('every full-policy route continues to a smaller proposal when the fixed-parent guard rejects a locally safe step',()=>{
 const source=createNeuralModel();
 try{
  for(const n of ['stateProjection','actionProjection','actionValue','actionBias'])tf.tidy(()=>source.layers[n].setWeights(source.layers[n].getWeights().map(w=>tf.zeros(w.shape))));
  const sample=lesson(91);delete sample.steps[0].mulliganLesson;sample.steps[0].localResourceLesson=true;
  sample.steps[0].actions[6]=1;sample.steps[0].actions[ACTION_DIM+20]=1;
  const frozen={source:'fixture',sourceSha256:'a'.repeat(64),bank:{training:[sample],validation:[]}};
  const maintenance={roundsPerEpoch:2,maximumStep:.0003,backtracks:6};
  const joint={contract:JOINT_POLICY_LEARNING,afterIteration:200,maintenanceHash:tacticalLessonDigest(maintenance),rehearsalCoefficient:.25,examplesPerType:2,maximumRetentionPasses:8,maximumRetentionStep:.0003,updateFractions:[1,.5,.25,.125,.0625,.03125,.015625]};
  const block={contract:PPO_BLOCK_RECOVERY,afterIteration:209,jointLearningHash:tacticalLessonDigest(joint),repairFractions:[0,.125,.25,.5,1],optimizerPolicy:'restore-epoch-start-on-projection'};
  const efficient={contract:EFFICIENT_POLICY_LEARNING,afterIteration:273,jointLearningHash:tacticalLessonDigest(joint),blockRecoveryHash:tacticalLessonDigest(block),minimumDescentRatio:.01,fractions:[1,.5,.25,.125,.0625,.03125,.015625],refreshFailuresBeforeSkip:2,maximumConsecutiveRefreshSkips:1};
  const phase={...protocol(),efficientLearningHash:tacticalLessonDigest(efficient)};
  const factories=[
   (m,o)=>jointPpoLessonRetention(m,source,frozen,maintenance,joint,o),
   (m,o)=>blockPpoLessonRetention(m,source,frozen,maintenance,joint,block,o),
   (m,o)=>efficientPpoLessonRetention(m,source,frozen,maintenance,joint,block,efficient,o),
   (m,o)=>phasePpoLessonRetention(m,source,frozen,maintenance,joint,block,efficient,phase,281,o)
  ];
  for(const factory of factories){
   const m=deserializeNeuralModel(serializeNeuralModel(source)),base=snapshot(m),seen=[];
   try{
    const guard=factory(m,{additionalGuard:()=>{const size=m.layers.actionBias.getWeights()[0].dataSync()[6];seen.push(size);return {passed:size<=.03};}});
    tf.tidy(()=>{const w=m.layers.actionBias.getWeights(),v=Float32Array.from(w[0].dataSync());v[6]=.1;m.layers.actionBias.setWeights([tf.tensor(v,w[0].shape),w[1]]);});
    guard.beforeEpochGuard({epochStartWeights:base});const result=guard.epochGuard();
    assert.equal(result.passed,true);assert.equal(result.additionalGuard.passed,true);
    assert.ok(seen[0]>.03&&seen.at(-1)<=.03);assert.ok(seen.length>=3);
    assert.ok(m.layers.actionBias.getWeights()[0].dataSync()[6]>0);
    if(result.report.phaseLearning)assert.equal(result.report.phaseLearning.mode,'full-policy');
   }finally{release(base);disposeNeuralModel(m);}
  }
 }finally{disposeNeuralModel(source);}
});
function lesson(i){
 const state=new Float32Array(STATE_DIM);state[0]=i;
 return {gameId:`case-${i}`,imitation:true,lessonRole:'training',steps:[{state,actions:new Float32Array(2*ACTION_DIM),initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),beliefTarget:new Float32Array(CARD_BINS),legalCount:2,legalActionKeys:['a','b'],selectedActionKey:'a',selectedIndex:0,imitation:true,mulliganLesson:true,winProbabilityLabel:false,return:0,value:0,advantage:1}]};
}
test('phase protocol is prospective, immutable and bound to the existing efficiency contract',()=>{
 const p=protocol(),s={iteration:280,efficientPolicyLearningHash:p.efficientLearningHash};commitPhasePolicyLearning(s,p);
 assert.throws(()=>commitPhasePolicyLearning(s,null));assert.throws(()=>commitPhasePolicyLearning(s,{...p,afterIteration:281}));
 assert.throws(()=>commitPhasePolicyLearning({iteration:281,efficientPolicyLearningHash:p.efficientLearningHash},p));
 assert.throws(()=>commitPhasePolicyLearning({iteration:280,efficientPolicyLearningHash:'b'.repeat(64)},p));
});
test('repeated first-epoch rejection cannot starve replay; rotation covers prime and composite banks and resumes exactly',()=>{
 const p=protocol(),joint={examplesPerType:2,rehearsalCoefficient:.25};
 for(const count of [4,12,17,34,64]){
  const bank={training:Array.from({length:count},(_,i)=>lesson(i)),validation:[]},seen=new Set();
  for(let iteration=281;iteration<281+count;iteration++){
   const schedule=rotatingPolicyRehearsal(bank,joint,iteration,p),a=schedule({epoch:1,batch:0});
   assert.deepEqual(a,rotatingPolicyRehearsal(bank,joint,iteration,p)({epoch:1,batch:0}));
   seen.add(a.batch.states[0]);seen.add(a.batch.states[STATE_DIM]);
  }
  assert.equal(seen.size,count);
 }
 const sample=lesson(0),held=structuredClone(sample);held.lessonRole='validation';
 assert.throws(()=>rotatingPolicyRehearsal({training:[sample],validation:[held]},joint,281,p),/overlap/i);
 assert.throws(()=>rotatingPolicyRehearsal({training:[sample],validation:[],protectedValidationKeys:[lessonInputKey(sample)]},joint,281,p),/overlap/i);
 assert.throws(()=>rotatingPolicyRehearsal({training:[held],validation:[]},joint,281,p));
});
test('play-only actor update preserves all mulligan logits and memory exactly without validation fitting',()=>{
 const m=createNeuralModel(),base=snapshot(m);let raw;
 try{
  const {game}=tacticalPosition();game.phase='mulligan';
  const hand=game.players[0].hand,actions=[];
  for(const kind of ['submitMulligan','toggleMulliganCard','confirmMulligan','skipMulligan']){
   for(const cardIds of [[],hand.slice(0,1).map(c=>c.instanceId),hand.slice(0,2).map(c=>c.instanceId)]){
    const a=encodeAction(game,'p1',{kind,cardIds,cardId:cardIds[0]});
    for(const row of PLAY_ONLY_ACTION_ROWS)assert.equal(a[row],0);actions.push(a);
   }
  }
  const state=Float32Array.from({length:STATE_DIM},(_,i)=>Math.sin(i)*.1),memory=Float32Array.from({length:NEURAL_HIDDEN_SIZE},(_,i)=>Math.cos(i)*.1);
  const encoded=Float32Array.from(actions.flatMap(a=>Array.from(a))),before=inferStep(m,state,encoded,actions.length,memory);
  const play=new Float32Array(2*ACTION_DIM);play[6]=1;play[ACTION_DIM+20]=1;const playBefore=inferStep(m,state,play,2,memory);
  for(const[n,w]of Object.entries(base))tf.tidy(()=>m.layers[n].setWeights(w.map(t=>tf.add(t,.003))));raw=snapshot(m);
  const tensors=tf.memory().numTensors,r=applyPlayOnlyProjection(m,base,raw,[]);assert.equal(r.feasible,true);
  const after=inferStep(m,state,encoded,actions.length,memory);assert.deepEqual(after.logits,before.logits);assert.equal(before.memory.length,NEURAL_HIDDEN_SIZE);assert.deepEqual(after.memory,before.memory);
  assert.notDeepEqual(inferStep(m,state,play,2,memory).logits,playBefore.logits);
  assert.equal(tf.memory().numTensors,tensors);
  const final=serializeNeuralModel(m).weights;for(const name of Object.keys(final))if(!['actionProjection','actionBias'].includes(name)){
   for(let i=0;i<base[name].length;i++)assert.deepEqual(m.layers[name].getWeights()[i].dataSync(),base[name][i].dataSync());
  }
 }finally{release(base);if(raw)release(raw);disposeNeuralModel(m);}
});
test('phase fallback checkpoints resume the exact model, Adam and RNG state',async()=>{
 const source=createNeuralModel();let full,first,resumed,a,b,c,saved;
 try{
  for(const n of ['stateProjection','actionProjection','actionValue','actionBias'])tf.tidy(()=>source.layers[n].setWeights(source.layers[n].getWeights().map(w=>tf.zeros(w.shape))));
  const setMulligan=(m,value)=>tf.tidy(()=>{const w=m.layers.actionBias.getWeights(),v=Float32Array.from(w[0].dataSync());v[3]=value;m.layers.actionBias.setWeights([tf.tensor(v,w[0].shape),w[1]]);});
  setMulligan(source,.001);
  const sample=lesson(1),step=sample.steps[0];delete step.mulliganLesson;step.localResourceLesson=true;
  step.actions[6]=1;step.actions[ACTION_DIM+20]=1;step.oldLogProbability=-Math.log(2);
  const held=lesson(2);held.lessonRole='validation';held.steps[0].actions[3]=1;
  const frozen={source:'fixture',sourceSha256:'a'.repeat(64),bank:{training:[sample],validation:[held]}};
  const trajectory=structuredClone(sample);delete trajectory.imitation;delete trajectory.steps[0].imitation;trajectory.steps[0].return=1;
  const maintenance={roundsPerEpoch:2,maximumStep:.0003,backtracks:6};
  const joint={contract:JOINT_POLICY_LEARNING,afterIteration:200,maintenanceHash:tacticalLessonDigest(maintenance),rehearsalCoefficient:.25,examplesPerType:2,maximumRetentionPasses:8,maximumRetentionStep:.0003,updateFractions:[1,.5,.25,.125,.0625,.03125,.015625]};
  const block={contract:PPO_BLOCK_RECOVERY,afterIteration:209,jointLearningHash:tacticalLessonDigest(joint),repairFractions:[0,.125,.25,.5,1],optimizerPolicy:'restore-epoch-start-on-projection'};
  const efficient={contract:EFFICIENT_POLICY_LEARNING,afterIteration:273,jointLearningHash:tacticalLessonDigest(joint),blockRecoveryHash:tacticalLessonDigest(block),minimumDescentRatio:.01,fractions:[1,.5,.25,.125,.0625,.03125,.015625],refreshFailuresBeforeSkip:2,maximumConsecutiveRefreshSkips:1};
  const p={...protocol(),efficientLearningHash:tacticalLessonDigest(efficient)};
  const options=m=>{const retention=phasePpoLessonRetention(m,source,frozen,maintenance,joint,block,efficient,p,281);
   return {...retention,epochs:2,batchSize:1,learningRate:.0001,random:seededRandom(79),teacherConsumptionPolicy:'record-only-v1',selectBestEpoch:false,
    beforeEpochGuard(args){setMulligan(m,-1);return retention.beforeEpochGuard(args);}};
  };
  full=deserializeNeuralModel(serializeNeuralModel(source));first=deserializeNeuralModel(serializeNeuralModel(source));
  const fullOptions=options(full);a=await trainRecurrentPpo(full,[trajectory],fullOptions);assert.equal(full.metadata.acceptedEpochs,2);
  assert.ok(a.epochGuards.every(g=>g.report.phaseLearning.mode==='play-only-action-rows'));
  b=await trainRecurrentPpo(first,[trajectory],{...options(first),epochs:1,onEpochCheckpoint(x){saved={...x,checkpoint:serializeNeuralModel(first)};}});
  saved.selectionState=JSON.parse(JSON.stringify(saved.selectionState));resumed=deserializeNeuralModel(saved.checkpoint);
  const opts=options(resumed);opts.random.setState(saved.randomState);
  c=await trainRecurrentPpo(resumed,[trajectory],{...opts,optimizer:await restoreAdamOptimizer(saved.optimizerState,.0001),resumeState:saved.selectionState});
  assert.deepEqual(serializeNeuralModel(full).weights,serializeNeuralModel(resumed).weights);
  assert.equal(full.generation,resumed.generation);assert.equal(full.gamesTrained,resumed.gamesTrained);
  assert.deepEqual(await serializeOptimizer(a.optimizer,full.generation),await serializeOptimizer(c.optimizer,resumed.generation));
  assert.equal(opts.random.getState(),fullOptions.random.getState());
 }finally{for(const result of [a,b,c])result?.optimizer.dispose();for(const model of [source,full,first,resumed])if(model)disposeNeuralModel(model);}
});

test('a fixed-parent failure reaches the play-only fallback without fitting that held-out decision',async()=>{
 const source=createNeuralModel();let candidate,trained;
 try{
  for(const n of ['stateProjection','actionProjection','actionValue','actionBias'])tf.tidy(()=>source.layers[n].setWeights(source.layers[n].getWeights().map(w=>tf.zeros(w.shape))));
  const setMulligan=(m,value)=>tf.tidy(()=>{const w=m.layers.actionBias.getWeights(),v=Float32Array.from(w[0].dataSync());v[3]=value;m.layers.actionBias.setWeights([tf.tensor(v,w[0].shape),w[1]]);});
  setMulligan(source,.001);
  const sample=lesson(21),step=sample.steps[0];delete step.mulliganLesson;step.localResourceLesson=true;
  step.actions[6]=1;step.actions[ACTION_DIM+20]=1;step.oldLogProbability=-Math.log(2);
  // Only the fixed reference owns this scene. It is absent from replay and
  // from the local retention bank, reproducing a late external rejection.
  const held=lesson(22);held.lessonRole='validation';held.steps[0].actions[3]=1;
  const fixed=measureLessonRetention(source,[held]);
  const frozen={source:'fixture',sourceSha256:'a'.repeat(64),bank:{training:[sample],validation:[]}};
  const trajectory=structuredClone(sample);delete trajectory.imitation;delete trajectory.steps[0].imitation;trajectory.steps[0].return=1;
  const maintenance={roundsPerEpoch:2,maximumStep:.0003,backtracks:6};
  const joint={contract:JOINT_POLICY_LEARNING,afterIteration:200,maintenanceHash:tacticalLessonDigest(maintenance),rehearsalCoefficient:.25,examplesPerType:2,maximumRetentionPasses:8,maximumRetentionStep:.0003,updateFractions:[1,.5,.25,.125,.0625,.03125,.015625]};
  const block={contract:PPO_BLOCK_RECOVERY,afterIteration:209,jointLearningHash:tacticalLessonDigest(joint),repairFractions:[0,.125,.25,.5,1],optimizerPolicy:'restore-epoch-start-on-projection'};
  const efficient={contract:EFFICIENT_POLICY_LEARNING,afterIteration:273,jointLearningHash:tacticalLessonDigest(joint),blockRecoveryHash:tacticalLessonDigest(block),minimumDescentRatio:.01,fractions:[1,.5,.25,.125,.0625,.03125,.015625],refreshFailuresBeforeSkip:2,maximumConsecutiveRefreshSkips:1};
  const p={...protocol(),efficientLearningHash:tacticalLessonDigest(efficient)};
  candidate=deserializeNeuralModel(serializeNeuralModel(source));const observations=[];
  const retention=phasePpoLessonRetention(candidate,source,frozen,maintenance,joint,block,efficient,p,281,{additionalGuard:()=>{
   const result=lessonSafetyGuard(fixed,measureLessonRetention(candidate,[held]));observations.push(result);return result;
  }});
  const playBefore=inferStep(candidate,step.state,step.actions,2,step.initialMemory).logits;
  trained=await trainRecurrentPpo(candidate,[trajectory],{...retention,epochs:1,batchSize:1,learningRate:.0001,
   random:seededRandom(79),teacherConsumptionPolicy:'record-only-v1',selectBestEpoch:false,
   beforeEpochGuard(args){setMulligan(candidate,-1);return retention.beforeEpochGuard(args);}});
  assert.equal(observations[0].passed,false);assert.equal(observations.at(-1).passed,true);
  assert.equal(trained.epochGuards[0].passed,true);assert.equal(trained.epochGuards[0].report.phaseLearning.mode,'play-only-action-rows');
  assert.equal(trained.epochGuards[0].additionalGuard.passed,true);
  assert.deepEqual(measureLessonRetention(candidate,[held]),fixed);
  assert.notDeepEqual(inferStep(candidate,step.state,step.actions,2,step.initialMemory).logits,playBefore);
  // An impossible extra acceptance condition must also reject every fallback.
  const base=snapshot(candidate);let proposal;
  try{
   tf.tidy(()=>{const w=candidate.layers.actionBias.getWeights(),v=Float32Array.from(w[0].dataSync());v[6]+=.001;candidate.layers.actionBias.setWeights([tf.tensor(v,w[0].shape),w[1]]);});
   proposal=snapshot(candidate);
   const deny=phasePpoLessonRetention(candidate,source,frozen,maintenance,joint,block,efficient,p,282,{additionalGuard:()=>({passed:false,failures:['fixed-parent']})});
   deny.beforeEpochGuard({epochStartWeights:base});assert.equal(deny.epochGuard().passed,false);
   assert.equal(deny.epochGuard().additionalGuard.passed,false);
  }finally{release(base);if(proposal)release(proposal);}
 }finally{trained?.optimizer.dispose();for(const model of [source,candidate])if(model)disposeNeuralModel(model);}
});
