import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {acceptTrainingStep,CONSTRAINED_DEFAULTS} from '../scripts/constrained-policy-learning.mjs';
test('acceptance requires policy improvement, rehearsal preservation and fixed champion bound',()=>{
  const b={policyObjective:1,rehearsalLoss:2,championKl:.001};
  assert.equal(acceptTrainingStep(b,{policyObjective:.9,rehearsalLoss:2,championKl:.002}),true);
  for(const a of [{...b},{...b,policyObjective:.9,rehearsalLoss:2.01},{...b,policyObjective:.9,championKl:.02},{...b,policyObjective:NaN}])assert.equal(acceptTrainingStep(b,a),false);
  assert.equal(acceptTrainingStep({...b,championKl:.03},{policyObjective:.9,rehearsalLoss:2,championKl:.031}),false);
});
const runtime=process.env.RIFTBOUND_CONSTRAINED_RUNTIME;
test('native constrained update preserves rollback and separates model memories',{skip:!runtime},async()=>{
  const load=f=>import(pathToFileURL(path.join(runtime,f)));
  const {tf}=await load('src/ai/neural/tf-runtime.mjs');
  const {createNeuralModel,serializeNeuralModel,deserializeNeuralModel,disposeNeuralModel,inferStep,trainPpoBatch}=await load('src/ai/neural/model.mjs');
  const {STATE_DIM,ACTION_DIM,NEURAL_HIDDEN_SIZE,CARD_BINS}=await load('src/ai/neural/encoding.mjs');
  const {packPpoBatch,serializeOptimizer}=await load('src/ai/neural/trainer.mjs');
  const {constrainedPolicyUpdater,trajectoryContexts,reconstructedBatchMemories}=await load('scripts/constrained-policy-learning.mjs');
  const source=createNeuralModel(),champion=deserializeNeuralModel(serializeNeuralModel(source)),model=deserializeNeuralModel(serializeNeuralModel(source));let optimizer=tf.train.adam(.0001);
  try{
    const state=Float32Array.from({length:STATE_DIM},(_,i)=>Math.sin(i)*.03),actions=new Float32Array(2*ACTION_DIM);actions[6]=1;actions[ACTION_DIM+20]=1;
    const make=i=>({state:state.slice(),actions:actions.slice(),initialMemory:new Float32Array(NEURAL_HIDDEN_SIZE),legalCount:2,
      selectedIndex:i%2,oldLogProbability:-Math.log(2),behaviorTemperature:1,advantage:i%2?-1:1,return:0,value:0,
      beliefTarget:new Float32Array(CARD_BINS),imitation:false,winProbabilityLabel:true});
    const trajectory={playerId:'p1',gameId:'fixture',steps:[make(0),make(1)]},batch=packPpoBatch([trajectory],{ignoreCorrectionSignals:true});
    const sample={playerId:'p1',steps:[{...make(0),imitation:true,winProbabilityLabel:false,advantage:1}]};
    const rehearsal=()=>({contract:'verified-training-policy-rehearsal-v1',coefficient:.25,batch:packPpoBatch([sample])});
    const options={teacherCoefficient:0,teacherRankingCoefficient:0,teacherActionValueCoefficient:0,beliefCoefficient:0,anchorCoefficient:.05,policyRehearsal:rehearsal()};
    // Nonempty Adam moments from ordinary training reproduce the checkpoint
    // layout that exposed the disconnected-gradient ordering regression.
    trainPpoBatch(model,batch,optimizer,options);
    const before=serializeNeuralModel(model).weights,count=tf.memory().numTensors;
    for(let n=0;n<3;n++)assert.ok(Number.isFinite(trainPpoBatch(model,batch,null,{...options,evaluateOnly:true}).loss));
    assert.deepEqual(serializeNeuralModel(model).weights,before);assert.equal(tf.memory().numTensors,count);
    const contexts=trajectoryContexts([trajectory]),chunk={...trajectory,steps:[trajectory.steps[1]]};
    const old=reconstructedBatchMemories(champion,[chunk],contexts);
    tf.tidy(()=>champion.layers.gru.setWeights(champion.layers.gru.getWeights().map(w=>tf.add(w,.002))));
    assert.notDeepEqual(reconstructedBatchMemories(champion,[chunk],contexts),old);
    assert.notDeepEqual(reconstructedBatchMemories(champion,[chunk],contexts),reconstructedBatchMemories(source,[chunk],contexts));
    assert.throws(()=>reconstructedBatchMemories(model,[{...chunk,steps:[{...chunk.steps[0]}]}],contexts),/prefix/);
    const reports=[],update=constrainedPolicyUpdater({trajectories:[trajectory],source,champion,rehearsalForBatch:rehearsal,
      config:{...CONSTRAINED_DEFAULTS,maximumProjectionNormRatio:0},onBatch:r=>reports.push(r)});
    const optimizerBefore=await serializeOptimizer(optimizer,model.generation);
    const out=await update({model,batch,chunks:[trajectory],optimizer,options,epoch:1,batchIndex:0});optimizer=out.optimizer;
    assert.equal(reports[0].accepted,false);assert.deepEqual(serializeNeuralModel(model).weights,before);
    assert.deepEqual(await serializeOptimizer(optimizer,model.generation),optimizerBefore);
    assert.ok(reports[0].diagnostics.norms.policy>0);assert.equal(reports[0].heldOutInputsUsed,false);
    const success=[];
    const normal=constrainedPolicyUpdater({trajectories:[trajectory],source,champion,rehearsalForBatch:rehearsal,onBatch:r=>success.push(r)});
    const accepted=await normal({model,batch,chunks:[trajectory],optimizer,options,epoch:1,batchIndex:0});optimizer=accepted.optimizer;
    assert.equal(success[0].accepted,true);
    assert.ok(success[0].after.policyObjective<success[0].before.policyObjective);
    assert.ok(success[0].after.rehearsalLoss<=success[0].before.rehearsalLoss+1e-7);
    assert.deepEqual(await serializeOptimizer(optimizer,model.generation),optimizerBefore);
  }finally{optimizer.dispose();[source,champion,model].forEach(disposeNeuralModel);}
});
